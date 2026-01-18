/**
 * Story Routes
 *
 * API routes for the story-driven songwriter module.
 * Handles the dynamic Q&A flow for story extraction and lyrics generation.
 */

const writer = require("../writer");

/**
 * Schema definitions for story routes
 */
const schemas = {
  startStory: {
    body: {
      type: "object",
      required: ["initial_prompt", "recipient_name"],
      properties: {
        initial_prompt: { type: "string", minLength: 3, maxLength: 500 },
        occasion: { type: "string", maxLength: 50 },
        recipient_name: { type: "string", minLength: 1, maxLength: 100 },
        style: { type: "string", maxLength: 50 },
      },
      additionalProperties: false,
    },
  },
  continueStory: {
    body: {
      type: "object",
      required: ["answer"],
      properties: {
        answer: { type: "string", minLength: 2, maxLength: 1000 },
      },
      additionalProperties: false,
    },
  },
  confirmStory: {
    body: {
      type: "object",
      properties: {
        additional_notes: { type: "string", maxLength: 500 },
      },
      additionalProperties: false,
    },
  },
  addDetails: {
    body: {
      type: "object",
      required: ["detail"],
      properties: {
        detail: { type: "string", minLength: 2, maxLength: 500 },
      },
      additionalProperties: false,
    },
  },
};

/**
 * Register story routes on Fastify app
 *
 * @param {Object} app - Fastify instance
 * @param {Object} options - Options object with db, helpers, etc.
 */
function registerStoryRoutes(app, { db, requireUserId, sendError, consumeRateLimit, addAuditEntry }) {
  /**
   * GET /story/info
   * Get information about the story module (occasions, styles, etc.)
   */
  app.get("/story/info", async (request, reply) => {
    reply.send({
      status: writer.getStatus(),
      occasions: writer.getOccasions(),
      styles: writer.getStyles(),
    });
  });

  /**
   * GET /story/active
   * List active story sessions for the current user
   */
  app.get("/story/active", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    try {
      const sessions = writer.listActiveStorySessions(userId);
      reply.send({ sessions });
    } catch (err) {
      console.error("[Story] Active sessions failed:", err);
      sendError(reply, 500, "STORY_ACTIVE_FAILED", err.message);
    }
  });

  /**
   * POST /story/start
   * Start a new story extraction session
   */
  app.post("/story/start", { schema: schemas.startStory }, async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    // Rate limit: 20 story starts per hour
    const limit = consumeRateLimit(userId, "story_start", 20, 60 * 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Story creation rate limit reached.", {
        retry_after: limit.reset_at,
      });
      return;
    }

    const body = request.body || {};

    try {
      const result = await writer.startStory({
        initial_prompt: body.initial_prompt,
        occasion: body.occasion || "celebration",
        recipient_name: body.recipient_name,
        style: body.style || "pop",
        user_id: userId,
      });

      // Log the story start
      addAuditEntry({
        userId,
        action: "story_started",
        resourceType: "story",
        resourceId: result.story_id,
        metadata: {
          occasion: body.occasion,
          arc: result.arc,
        },
      });

      reply.send({
        story_id: result.story_id,
        first_question: result.first_question,
        arc: result.arc,
        arc_display_name: result.arc_display_name,
        recipient_name: result.recipient_name,
        progress: 0,
        engine_version: result.engine_version,
      });
    } catch (err) {
      console.error("[Story] Start failed:", err);
      sendError(reply, 400, "STORY_START_FAILED", err.message);
    }
  });

  /**
   * GET /story/:story_id
   * Get current story session state for resume
   */
  app.get("/story/:story_id", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    const { story_id } = request.params;

    try {
      const state = await writer.getStoryState(story_id);
      reply.send(state);
    } catch (err) {
      console.error("[Story] Get state failed:", err);
      if (err.message.includes("not found")) {
        sendError(reply, 404, "STORY_NOT_FOUND", "Story session not found.");
      } else {
        sendError(reply, 400, "STORY_STATE_FAILED", err.message);
      }
    }
  });

  /**
   * POST /story/:story_id/continue
   * Submit an answer and get the next question (or completion status)
   */
  app.post("/story/:story_id/continue", { schema: schemas.continueStory }, async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    // Rate limit: 60 answers per hour (allows for rapid Q&A)
    const limit = consumeRateLimit(userId, "story_continue", 60, 60 * 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Story answer rate limit reached.", {
        retry_after: limit.reset_at,
      });
      return;
    }

    const { story_id } = request.params;
    const { answer } = request.body;

    try {
      const result = await writer.continueStory({ story_id, answer });

      if (result.error) {
        reply.send({
          error: result.error,
          current_question: result.current_question,
          progress: result.progress,
        });
        return;
      }

      if (result.complete) {
        reply.send({
          complete: true,
          story_summary: result.story_summary,
          narrative: result.narrative || result.story_summary,
          soul_of_story: result.soul_of_story,
          progress: result.progress,
          ready_for_confirmation: true,
        });
      } else {
        reply.send({
          complete: false,
          next_question: result.next_question,
          narrative: result.narrative,
          progress: result.progress,
          questions_asked: result.questions_asked,
        });
      }
    } catch (err) {
      console.error("[Story] Continue failed:", err);
      if (err.message.includes("not found")) {
        sendError(reply, 404, "STORY_NOT_FOUND", "Story session not found.");
      } else {
        sendError(reply, 400, "STORY_CONTINUE_FAILED", err.message);
      }
    }
  });

  /**
   * GET /story/:story_id/summary
   * Get the story summary for user confirmation
   */
  app.get("/story/:story_id/summary", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    const { story_id } = request.params;

    try {
      const summary = await writer.getStorySummary(story_id);
      reply.send(summary);
    } catch (err) {
      console.error("[Story] Summary failed:", err);
      if (err.message.includes("not found")) {
        sendError(reply, 404, "STORY_NOT_FOUND", "Story session not found.");
      } else {
        sendError(reply, 400, "STORY_SUMMARY_FAILED", err.message);
      }
    }
  });

  /**
   * POST /story/:story_id/confirm
   * Confirm the story and mark ready for lyrics generation
   */
  app.post("/story/:story_id/confirm", { schema: schemas.confirmStory }, async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    const { story_id } = request.params;
    const { additional_notes } = request.body || {};

    try {
      const result = writer.confirmStory(story_id, additional_notes);

      addAuditEntry({
        userId,
        action: "story_confirmed",
        resourceType: "story",
        resourceId: story_id,
      });

      reply.send(result);
    } catch (err) {
      console.error("[Story] Confirm failed:", err);
      if (err.message.includes("not found")) {
        sendError(reply, 404, "STORY_NOT_FOUND", "Story session not found.");
      } else {
        sendError(reply, 400, "STORY_CONFIRM_FAILED", err.message);
      }
    }
  });

  /**
   * POST /story/:story_id/add-details
   * Add more details to a story (after seeing summary)
   */
  app.post("/story/:story_id/add-details", { schema: schemas.addDetails }, async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    const { story_id } = request.params;
    const { detail } = request.body;

    try {
      const result = await writer.addMoreDetails(story_id, detail);
      reply.send(result);
    } catch (err) {
      console.error("[Story] Add details failed:", err);
      if (err.message.includes("not found")) {
        sendError(reply, 404, "STORY_NOT_FOUND", "Story session not found.");
      } else {
        sendError(reply, 400, "STORY_ADD_DETAILS_FAILED", err.message);
      }
    }
  });

  /**
   * POST /story/:story_id/lyrics
   * Generate lyrics from the confirmed story
   */
  app.post("/story/:story_id/lyrics", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    // Rate limit: 30 lyrics generations per hour
    const limit = consumeRateLimit(userId, "story_lyrics", 30, 60 * 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Lyrics generation rate limit reached.", {
        retry_after: limit.reset_at,
      });
      return;
    }

    const { story_id } = request.params;

    try {
      const result = await writer.writeSong(story_id);

      addAuditEntry({
        userId,
        action: "story_lyrics_generated",
        resourceType: "story",
        resourceId: story_id,
        metadata: {
          arc: result.arc_used,
          quality_score: result.quality_score,
        },
      });

      reply.send({
        lyrics: result.lyrics,
        quality_score: result.quality_score,
        arc_used: result.arc_used,
        validation_issues: result.validation_issues,
      });
    } catch (err) {
      console.error("[Story] Lyrics generation failed:", err);
      if (err.message.includes("not found")) {
        sendError(reply, 404, "STORY_NOT_FOUND", "Story session not found.");
      } else if (err.message.includes("must be confirmed")) {
        sendError(reply, 400, "STORY_NOT_CONFIRMED", "Story must be confirmed before generating lyrics.");
      } else {
        sendError(reply, 500, "LYRICS_GENERATION_FAILED", err.message);
      }
    }
  });

  /**
   * DELETE /story/:story_id
   * Cancel a story session
   */
  app.delete("/story/:story_id", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    const { story_id } = request.params;

    try {
      writer.cancelStory(story_id);
      reply.send({ cancelled: true });
    } catch (err) {
      // Ignore errors on cancel - session might already be gone
      reply.send({ cancelled: true });
    }
  });

  /**
   * POST /story/:story_id/to-track
   * Create a track from a confirmed story
   * This bridges the story flow to the existing track/render flow
   */
  app.post("/story/:story_id/to-track", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    const { story_id } = request.params;

    try {
      // Get the story context
      const storyContext = writer.getStoryContext(story_id);

      if (storyContext.state !== "confirmed") {
        sendError(reply, 400, "STORY_NOT_CONFIRMED", "Story must be confirmed first.");
        return;
      }

      // Create a track with the story context
      const trackId = require("../utils/ids").newUuid();
      const now = new Date().toISOString();

      // Compute params_hash for version reproducibility
      const crypto = require("crypto");
      const paramsJson = JSON.stringify({});
      const paramsHash = crypto.createHash("sha256").update(paramsJson).digest("hex").slice(0, 16);

      db.prepare(`
        INSERT INTO tracks (id, user_id, status, title, occasion, recipient_name, style, message, story_context_json, voice_mode, latest_version, created_at, updated_at)
        VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        trackId,
        userId,
        `Song for ${storyContext.recipient_name}`,
        storyContext.occasion,
        storyContext.recipient_name,
        storyContext.style,
        storyContext.initial_prompt,
        JSON.stringify({
          story_id,
          elements: storyContext.elements,
          summary: storyContext.summary,
          arc: storyContext.arc,
        }),
        "ai_voice", // Default to AI voice
        now,
        now
      );

      // Create initial version with all required fields
      const versionId = require("../utils/ids").newUuid();
      db.prepare(`
        INSERT INTO track_versions (id, track_id, version_num, status, render_type, params_json, params_hash, created_at)
        VALUES (?, ?, 1, 'draft', 'preview', ?, ?, ?)
      `).run(versionId, trackId, paramsJson, paramsHash, now);

      addAuditEntry({
        userId,
        action: "story_to_track",
        resourceType: "track",
        resourceId: trackId,
        metadata: { story_id },
      });

      reply.send({
        track_id: trackId,
        version_id: versionId,
        version_num: 1,
      });
    } catch (err) {
      console.error("[Story] To-track failed:", err);
      sendError(reply, 500, "STORY_TO_TRACK_FAILED", err.message);
    }
  });
}

module.exports = { registerStoryRoutes };
