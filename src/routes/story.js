/**
 * Story Routes
 *
 * API routes for the story-driven songwriter module.
 * Handles the dynamic Q&A flow for story extraction and lyrics generation.
 */

const crypto = require("crypto");
const writer = require("../writer");
const { moderationCheck } = require("../providers/moderation");
const { generatePoemFromStory } = require("../writer/poem");
const { evaluatePoemReadiness } = require("../writer/v2/quality");

/**
 * Verify that a user owns a story session
 * @param {string} storyId - Story session ID
 * @param {string} userId - User ID
 * @param {Function} sendError - Error response function
 * @param {Object} reply - Fastify reply object
 * @returns {Object|null} Story state if authorized, null if error sent
 */
async function verifyStoryOwnership(storyId, userId, sendError, reply, db) {
  try {
    const state = await writer.getStoryState(storyId);
    if (!state) {
      sendError(reply, 404, "STORY_NOT_FOUND", "Story session not found.");
      return null;
    }
    if (!state.userId && db) {
      const claimResult = await db.prepare(
        "UPDATE story_sessions SET user_id = ? WHERE id = ? AND user_id IS NULL"
      ).run(userId, storyId);
      if (claimResult.changes > 0) {
        state.userId = userId;
        console.warn("[Story] Claimed unowned session:", { storyId, userId });
      }
    }
    if (state.userId !== userId) {
      console.warn("[Story] Authorization denied:", { storyId, requestingUserId: userId, ownerUserId: state.userId });
      sendError(reply, 403, "UNAUTHORIZED", "You don't own this story session.");
      return null;
    }
    return state;
  } catch (err) {
    if (err.message && err.message.includes("not found")) {
      sendError(reply, 404, "STORY_NOT_FOUND", "Story session not found.");
    } else {
      console.error("[Story] Ownership verification failed:", { storyId, userId, error: err.message });
      sendError(reply, 500, "STORY_STATE_FAILED", "Failed to verify story ownership.");
    }
    return null;
  }
}

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
  toPoem: {
    body: {
      type: "object",
      properties: {
        tone: { type: "string", maxLength: 50 },
        style: { type: "string", maxLength: 50 },
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
function registerStoryRoutes(app, { db, requireUserId, sendError, consumeRateLimit, addAuditEntry, eventsService }) {
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
    const userId = await requireUserId(request, reply);
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
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    // Rate limit: 20 story starts per hour
    const limit = await consumeRateLimit(userId, "story_start", 20, 60 * 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Story creation rate limit reached.", {
        retry_after: limit.reset_at,
      });
      return;
    }

    const body = request.body || {};

    // Moderate user input before processing
    try {
      const modResult = moderationCheck({
        recipient_name: body.recipient_name,
        story_context: body.initial_prompt,
        occasion: body.occasion,
      });
      if (!modResult.allowed) {
        sendError(reply, 400, "CONTENT_BLOCKED", modResult.reason || "Content not allowed", {
          category: modResult.category,
          severity: modResult.severity,
        });
        return;
      }
    } catch (modErr) {
      console.error("[Story] Moderation check failed:", { userId, error: modErr.message });
      sendError(reply, 500, "MODERATION_FAILED", "Unable to validate content.");
      return;
    }

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

      // Emit story_start event for analytics
      if (eventsService) {
        eventsService.emit("story_start", {
          userId,
          resourceType: "story",
          resourceId: result.story_id,
          metadata: { occasion: body.occasion, arc: result.arc, style: body.style || "pop" },
          ip: request.ip,
          userAgent: request.headers["user-agent"],
        });
      }

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
      console.error("[Story] Start failed:", { userId, occasion: body.occasion, error: err.message });
      sendError(reply, 400, "STORY_START_FAILED", "Failed to start story session.");
    }
  });

  /**
   * GET /story/:story_id
   * Get current story session state for resume
   */
  app.get("/story/:story_id", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const { story_id } = request.params;

    // Verify ownership (returns state if authorized, sends error otherwise)
    const state = await verifyStoryOwnership(story_id, userId, sendError, reply, db);
    if (!state) return;

    reply.send(state);
  });

  /**
   * POST /story/:story_id/continue
   * Submit an answer and get the next question (or completion status)
   */
  app.post("/story/:story_id/continue", { schema: schemas.continueStory }, async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    // Rate limit: 60 answers per hour (allows for rapid Q&A)
    const limit = await consumeRateLimit(userId, "story_continue", 60, 60 * 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Story answer rate limit reached.", {
        retry_after: limit.reset_at,
      });
      return;
    }

    const { story_id } = request.params;
    const { answer } = request.body;

    // Verify ownership
    const state = await verifyStoryOwnership(story_id, userId, sendError, reply, db);
    if (!state) return;

    // Moderate answer content
    try {
      const modResult = moderationCheck({ story_context: answer });
      if (!modResult.allowed) {
        sendError(reply, 400, "CONTENT_BLOCKED", modResult.reason || "Content not allowed", {
          category: modResult.category,
          severity: modResult.severity,
        });
        return;
      }
    } catch (modErr) {
      console.error("[Story] Moderation check failed:", { story_id, userId, error: modErr.message });
      sendError(reply, 500, "MODERATION_FAILED", "Unable to validate content.");
      return;
    }

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
      console.error("[Story] Continue failed:", { story_id, userId, error: err.message });
      sendError(reply, 400, "STORY_CONTINUE_FAILED", "Failed to process story answer.");
    }
  });

  /**
   * GET /story/:story_id/summary
   * Get the story summary for user confirmation
   */
  app.get("/story/:story_id/summary", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const { story_id } = request.params;

    // Verify ownership
    const state = await verifyStoryOwnership(story_id, userId, sendError, reply, db);
    if (!state) return;

    try {
      const summary = await writer.getStorySummary(story_id);
      reply.send(summary);
    } catch (err) {
      console.error("[Story] Summary failed:", err);
      sendError(reply, 400, "STORY_SUMMARY_FAILED", "Failed to get story summary.");
    }
  });

  /**
   * POST /story/:story_id/confirm
   * Confirm the story and mark ready for lyrics generation
   */
  app.post("/story/:story_id/confirm", { schema: schemas.confirmStory }, async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const { story_id } = request.params;
    const { additional_notes } = request.body || {};

    // Verify ownership
    const state = await verifyStoryOwnership(story_id, userId, sendError, reply, db);
    if (!state) return;

    // Moderate additional notes if provided
    if (additional_notes) {
      try {
        const modResult = moderationCheck({ story_context: additional_notes });
        if (!modResult.allowed) {
          sendError(reply, 400, "CONTENT_BLOCKED", modResult.reason || "Content not allowed", {
            category: modResult.category,
            severity: modResult.severity,
          });
          return;
        }
      } catch (modErr) {
        console.error("[Story] Moderation check failed:", { story_id, userId, error: modErr.message });
        sendError(reply, 500, "MODERATION_FAILED", "Unable to validate content.");
        return;
      }
    }

    try {
      const result = await writer.confirmStory(story_id, additional_notes);

      addAuditEntry({
        userId,
        action: "story_confirmed",
        resourceType: "story",
        resourceId: story_id,
      });

      // Emit story_confirm event for analytics
      if (eventsService) {
        eventsService.emit("story_confirm", {
          userId,
          resourceType: "story",
          resourceId: story_id,
          metadata: { has_additional_notes: Boolean(additional_notes) },
          ip: request.ip,
          userAgent: request.headers["user-agent"],
        });
      }

      reply.send(result);
    } catch (err) {
      console.error("[Story] Confirm failed:", { story_id, userId, error: err.message });
      sendError(reply, 400, "STORY_CONFIRM_FAILED", "Failed to confirm story.");
    }
  });

  /**
   * POST /story/:story_id/add-details
   * Add more details to a story (after seeing summary)
   */
  app.post("/story/:story_id/add-details", { schema: schemas.addDetails }, async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const { story_id } = request.params;
    const { detail } = request.body;

    // Verify ownership
    const state = await verifyStoryOwnership(story_id, userId, sendError, reply, db);
    if (!state) return;

    // Moderate detail content
    try {
      const modResult = moderationCheck({ story_context: detail });
      if (!modResult.allowed) {
        sendError(reply, 400, "CONTENT_BLOCKED", modResult.reason || "Content not allowed", {
          category: modResult.category,
          severity: modResult.severity,
        });
        return;
      }
    } catch (modErr) {
      console.error("[Story] Moderation check failed:", { story_id, userId, error: modErr.message });
      sendError(reply, 500, "MODERATION_FAILED", "Unable to validate content.");
      return;
    }

    try {
      const result = await writer.addMoreDetails(story_id, detail);
      reply.send(result);
    } catch (err) {
      console.error("[Story] Add details failed:", { story_id, userId, error: err.message });
      sendError(reply, 400, "STORY_ADD_DETAILS_FAILED", "Failed to add story details.");
    }
  });

  /**
   * POST /story/:story_id/lyrics
   * Generate lyrics from the confirmed story
   */
  app.post("/story/:story_id/lyrics", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    // Rate limit: 30 lyrics generations per hour
    const limit = await consumeRateLimit(userId, "story_lyrics", 30, 60 * 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Lyrics generation rate limit reached.", {
        retry_after: limit.reset_at,
      });
      return;
    }

    const { story_id } = request.params;

    // Verify ownership
    const state = await verifyStoryOwnership(story_id, userId, sendError, reply, db);
    if (!state) return;

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
      console.error("[Story] Lyrics generation failed:", { story_id, userId, error: err.message });
      if (err.message && err.message.includes("must be confirmed")) {
        sendError(reply, 400, "STORY_NOT_CONFIRMED", "Story must be confirmed before generating lyrics.");
      } else if (err.code === "AI_UNAVAILABLE" || err.message === "AI_UNAVAILABLE") {
        sendError(reply, 503, "AI_UNAVAILABLE", "Lyrics generation is temporarily unavailable.");
      } else {
        sendError(reply, 500, "LYRICS_GENERATION_FAILED", "Failed to generate lyrics.");
      }
    }
  });

  /**
   * POST /story/:story_id/to-poem
   * Generate a poem from a confirmed story
   */
  app.post("/story/:story_id/to-poem", { schema: schemas.toPoem }, async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    // Rate limit: 20 poem generations per hour
    const limit = await consumeRateLimit(userId, "story_poem", 20, 60 * 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Poem generation rate limit reached.", {
        retry_after: limit.reset_at,
      });
      return;
    }

    const { story_id } = request.params;
    const { tone, style } = request.body || {};

    // Verify ownership
    const state = await verifyStoryOwnership(story_id, userId, sendError, reply, db);
    if (!state) return;

    try {
      const context = await writer.getStoryContext(story_id);
      if (context.status !== "confirmed") {
        sendError(reply, 400, "STORY_NOT_CONFIRMED", "Story must be confirmed before generating a poem.");
        return;
      }

      const readiness = evaluatePoemReadiness(context);
      if (!readiness.is_complete) {
        sendError(reply, 422, "STORY_INCOMPLETE", "Story is missing required details.", {
          gaps: readiness.gaps,
          suggested_question: readiness.suggested_question,
        });
        return;
      }

      const finalTone = tone || context.dials?.tone || "heartfelt";
      const finalStyle = style || context.dials?.style || "free verse";

      const result = await generatePoemFromStory({
        narrative: context.narrative,
        primitives: context.primitives,
        motifs: context.motifs,
        recipient_name: context.recipientName,
        occasion: context.occasion,
        tone: finalTone,
        style: finalStyle,
      });

      const poemId = crypto.randomUUID();
      const now = new Date().toISOString();
      const provenance = {
        source: "story_v2",
        story_id,
        narrative: context.narrative,
        primitives: context.primitives,
        atoms: context.atoms,
        motifs: context.motifs,
        tone: finalTone,
        style: finalStyle,
      };

      db.prepare(
        `INSERT INTO poems (id, user_id, title, recipient_name, occasion, tone, verses, message, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        poemId,
        userId,
        result.title || `For ${context.recipientName || "you"}`,
        context.recipientName,
        context.occasion,
        finalTone,
        JSON.stringify(result.lines),
        JSON.stringify(provenance),
        "generated",
        now,
        now
      );

      addAuditEntry({
        userId,
        action: "poem_generated_from_story",
        resourceType: "poem",
        resourceId: poemId,
        metadata: { story_id, tone: finalTone, style: finalStyle },
      });

      if (eventsService) {
        eventsService.emit("poem_generated", {
          userId,
          resourceType: "poem",
          resourceId: poemId,
          metadata: { story_id, tone: finalTone, style: finalStyle },
          ip: request.ip,
          userAgent: request.headers["user-agent"],
        });
      }

      reply.send({
        poem: {
          id: poemId,
          user_id: userId,
          title: result.title || `For ${context.recipientName || "you"}`,
          recipient_name: context.recipientName,
          occasion: context.occasion,
          tone: finalTone,
          verses: result.lines,
          status: "generated",
          created_at: now,
          updated_at: now,
        },
        provider: result.provider,
        model: result.model,
      });
    } catch (err) {
      console.error("[Story] Poem generation failed:", { story_id, userId, error: err.message });
      if (err.code === "AI_UNAVAILABLE" || err.message === "AI_UNAVAILABLE") {
        sendError(reply, 503, "AI_UNAVAILABLE", "Poem generation is temporarily unavailable.");
      } else if (err.message && err.message.includes("STORY_NARRATIVE_MISSING")) {
        sendError(reply, 400, "STORY_INCOMPLETE", "Story narrative is missing.");
      } else {
        sendError(reply, 500, "POEM_GENERATION_FAILED", "Failed to generate poem.");
      }
    }
  });

  /**
   * DELETE /story/:story_id
   * Cancel a story session
   */
  app.delete("/story/:story_id", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const { story_id } = request.params;

    // Verify ownership (but if story doesn't exist, still return success for idempotency)
    try {
      const state = await writer.getStoryState(story_id);
      if (state && state.userId !== userId) {
        sendError(reply, 403, "UNAUTHORIZED", "You don't own this story session.");
        return;
      }
    } catch (err) {
      // Only ignore "not found" errors - log other issues
      if (!err.message || !err.message.includes("not found")) {
        console.error("[Story] Cancel ownership check failed:", { story_id, userId, error: err.message });
      }
      // Continue to cancellation attempt (idempotent)
    }

    try {
      await writer.cancelStory(story_id);
      reply.send({ cancelled: true });
    } catch (err) {
      // Log but return success for idempotency
      console.warn("[Story] Cancel error (returning success anyway):", { story_id, userId, error: err.message });
      reply.send({ cancelled: true });
    }
  });

  /**
   * POST /story/:story_id/to-track
   * Create a track from a confirmed story
   * This bridges the story flow to the existing track/render flow
   */
  app.post("/story/:story_id/to-track", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const { story_id } = request.params;

    // Verify ownership
    const state = await verifyStoryOwnership(story_id, userId, sendError, reply, db);
    if (!state) return;

    try {
      // Get the story context
      const storyContext = await writer.getStoryContext(story_id);

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
      console.error("[Story] To-track failed:", { story_id, userId, error: err.message });
      sendError(reply, 500, "STORY_TO_TRACK_FAILED", "Failed to create track from story.");
    }
  });
}

module.exports = { registerStoryRoutes };
