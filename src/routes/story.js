/**
 * Story Routes
 *
 * API routes for the story-driven songwriter module.
 * Handles the dynamic Q&A flow for story extraction and lyrics generation.
 */

const crypto = require("crypto");
const writer = require("../writer");
const { moderationCheck, validateGeneratedLyrics } = require("../providers/moderation");
const { getFeatureFlag } = require("../services/feature-flags");
const { generatePoemFromStory } = require("../writer/poem");
const { evaluatePoemReadiness } = require("../writer/v3/quality");
const { transcribeAudio } = require("../providers/whisper");
const {
  buildPlanningEnvelope,
  normalizePlanningOutput,
  buildBackendTaskEnvelope,
  runDebugFeedbackLoop,
  extractPatternEnvelope,
  buildTrajectoryEnvelope,
  executeBackendTask,
} = require("../writer/v3/orchestration");
const { runHttpChecks } = require("../writer/v3/orchestration/http-debugger");
const { newUuid } = require("../utils/ids");
const { generateElementGuidance } = require("../writer/v3/guidance");
const { normalizeStyle } = require("../providers/style-registry");
const {
  findGiftFundingContent,
  validateGiftFundingReservation,
} = require("../services/gift-funding");
const { buildTrackStoryContextPayload } = require("../writer/story-context-serialization");

const STORY_INITIAL_PROMPT_WARNING_THRESHOLD = 8000;
const STORY_INITIAL_PROMPT_MAX_LENGTH = 12000;
const STORY_INITIAL_PROMPT_ACCEPT_MAX_LENGTH = 12000;
const STORY_CONTINUE_ANSWER_MAX_LENGTH = 6000;
const V3_ORCHESTRATION_MAX_DEBUG_ATTEMPTS = 5;

function spreadStoryAnalysisFields(result) {
  return {
    readiness: result.readiness || null,
    target_slot: result.target_slot || null,
    gap_reason: result.gap_reason || null,
    slot_guidance: result.slot_guidance || null,
    missing_slots: result.missing_slots || [],
    weak_slots: result.weak_slots || [],
    readiness_score: typeof result.readiness_score === "number" ? result.readiness_score : 0,
    is_story_ready: Boolean(result.is_story_ready),
    can_proceed_anyway: Boolean(result.can_proceed_anyway),
    narrative_version: typeof result.narrative_version === "number" ? result.narrative_version : 0,
    integration_delta: result.integration_delta || null,
    draft_lifecycle: result.draft_lifecycle || null,
    fact_inventory: result.fact_inventory || [],
    open_conflicts: result.open_conflicts || [],
    revision_history: result.revision_history || [],
    draft_diff: result.draft_diff || null,
    pending_revision: result.pending_revision || null,
    story_provenance: result.story_provenance || null,
    story_elements: result.story_elements || [],
  };
}

function extractLyricsText(lyrics) {
  if (!lyrics || typeof lyrics !== "object") return "";

  const parts = [];
  if (typeof lyrics.title === "string") parts.push(lyrics.title);
  if (typeof lyrics.anchor_line === "string") parts.push(lyrics.anchor_line);
  if (Array.isArray(lyrics.sections)) {
    for (const section of lyrics.sections) {
      if (Array.isArray(section?.lines)) {
        parts.push(...section.lines.filter((line) => typeof line === "string"));
      }
    }
  }
  return parts.join(" ");
}
const V3_ORCHESTRATION_MAX_DEBUG_CHECKS = 12;
const V3_ORCHESTRATION_MAX_LIST_LIMIT = 100;
const V3_ORCHESTRATION_MAX_EVENT_LIST_LIMIT = 500;

function mapGiftFundingError(reply, err) {
  if (!err?.code) {
    return false;
  }
  const statusCode = Number(err.statusCode) || 409;
  switch (err.code) {
    case "GIFT_RESERVATION_NOT_FOUND":
    case "GIFT_RESERVATION_EXPIRED":
    case "GIFT_RESERVATION_FINALIZED":
    case "GIFT_RESERVATION_NOT_ACTIVE":
    case "GIFT_RESERVATION_CONTENT_MISMATCH":
    case "GIFT_RESERVATION_CONTENT_ALREADY_CREATED":
      reply.code(statusCode).send({
        error: err.code,
        message: err.message,
      });
      return true;
    default:
      return false;
  }
}

/**
 * Sanitize story state for client consumption.
 * Strips internal AI reasoning metadata, raw analysis objects, and fields
 * not present in the iOS StorySessionStateResponse contract.
 *
 * @param {Object} state - Raw story state from the engine
 * @returns {Object} Client-safe story state
 */
function sanitizeStoryStateForClient(state) {
  if (!state) return state;
  return {
    sessionId: state.sessionId,
    engineVersion: state.engineVersion,
    recipientName: state.recipientName,
    occasion: state.occasion,
    style: state.style,
    eventType: state.eventType,
    initialPrompt: state.initialPrompt,
    narrative: state.narrative,
    facts: state.facts,
    beats: state.beats,
    userModel: state.userModel,
    status: state.status,
    turnCount: state.turnCount,
    completionScore: state.completionScore,
    narrativeVersion: state.narrativeVersion,
    integrationDelta: state.integrationDelta,
    draftLifecycle: state.draftLifecycle,
    factInventory: state.factInventory,
    openConflicts: state.openConflicts,
    revisionHistory: state.revisionHistory,
    draftDiff: state.draftDiff,
    pendingRevision: state.pendingRevision,
    storyProvenance: state.storyProvenance,
    storyElements: state.storyElements,
    readiness: state.readiness,
    conversation: state.conversation,
    currentQuestion: state.currentQuestion,
    updatedAt: state.updatedAt,
    createdAt: state.createdAt,
  };
}

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
      } else if (claimResult.changes === 0 && !state.userId) {
        const fresh = await db.prepare(
          "SELECT user_id FROM story_sessions WHERE id = ?"
        ).get(storyId);
        state.userId = fresh?.user_id;
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
      sendError(reply, 500, "STORY_STATE_FAILED", "Something went wrong loading your story. Please try again.");
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
        initial_prompt: { type: "string", minLength: 1, maxLength: STORY_INITIAL_PROMPT_ACCEPT_MAX_LENGTH },
        occasion: { type: "string", maxLength: 50 },
        recipient_name: { type: "string", minLength: 1, maxLength: 100 },
        style: { type: "string", maxLength: 50 },
        engine_version: { type: "string", maxLength: 10 },
      },
      additionalProperties: false,
    },
  },
  continueStory: {
    body: {
      type: "object",
      required: ["answer"],
      properties: {
        answer: { type: "string", minLength: 2, maxLength: STORY_CONTINUE_ANSWER_MAX_LENGTH },
        expected_session_version: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
  },
  updateStoryStyle: {
    body: {
      type: "object",
      required: ["style"],
      properties: {
        style: {
          anyOf: [
            { type: "string", maxLength: 50 },
            { type: "null" },
          ],
        },
      },
      additionalProperties: false,
    },
  },
  confirmStory: {
    body: {
      type: "object",
      properties: {
        additional_notes: { type: "string", maxLength: 500 },
        force_confirm: { type: "boolean" },
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
  reviseStory: {
    body: {
      type: "object",
      required: ["revision_request"],
      properties: {
        revision_request: { type: "string", minLength: 2, maxLength: 600 },
        source: { type: "string", enum: ["review_edit", "confirm_notes", "reopen_edit"] },
        operation: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["append", "replace", "remove", "resolve_conflict", "final_notes"] },
            target_type: { type: "string", enum: ["narrative", "fact", "beat", "section", "conflict"] },
            target_id: { type: "string", minLength: 1, maxLength: 200 },
            target_text: { type: "string", minLength: 1, maxLength: 500 },
            replacement_text: { type: "string", minLength: 1, maxLength: 800 },
            resolution: { type: "string", minLength: 1, maxLength: 800 },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
  reviewStory: {
    body: {
      type: "object",
      additionalProperties: false,
    },
  },
  elementGuidance: {
    params: {
      type: "object",
      required: ["story_id", "element_id"],
      properties: {
        story_id: { type: "string", minLength: 1 },
        element_id: { type: "string", minLength: 1, maxLength: 50 },
      },
    },
  },
  toTrack: {
    body: {
      type: "object",
      properties: {
        voice_mode: { type: "string", enum: ["ai_voice", "user_voice"] },
        voice_gender: { type: "string", enum: ["male", "female"] },
        style: { type: "string", maxLength: 50 },
        gift_reservation_id: { type: "string", minLength: 1, maxLength: 64 },
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
        gift_reservation_id: { type: "string", minLength: 1, maxLength: 64 },
        force: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  audioTranscribe: {
    params: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", minLength: 1 },
      },
    },
  },
  v3OrchestrationPlanningEnvelope: {
    body: {
      type: "object",
      properties: {
        task_id: { type: "string", minLength: 1, maxLength: 120 },
        repo: { type: "string", minLength: 1, maxLength: 120 },
        objective: { type: "string", minLength: 1, maxLength: 500 },
        constraints: { type: "object" },
      },
      additionalProperties: true,
    },
  },
  v3OrchestrationPlanningNormalize: {
    body: {
      type: "object",
      properties: {
        planning_output: { type: "object" },
      },
      additionalProperties: true,
    },
  },
  v3OrchestrationBackendTask: {
    body: {
      type: "object",
      properties: {
        milestone: { type: "string", minLength: 1, maxLength: 200 },
        design_refs: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 300 },
          minItems: 1,
          maxItems: 30,
        },
        target_files: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 400 },
          minItems: 1,
          maxItems: 60,
        },
      },
      additionalProperties: true,
    },
  },
  v3OrchestrationDebugLoop: {
    body: {
      type: "object",
      required: ["checks"],
      properties: {
        checks: {
          type: "array",
          minItems: 1,
          maxItems: V3_ORCHESTRATION_MAX_DEBUG_CHECKS,
          items: {
            type: "object",
            required: ["path"],
            properties: {
              name: { type: "string", minLength: 1, maxLength: 120 },
              method: { type: "string", minLength: 3, maxLength: 10 },
              path: { type: "string", minLength: 1, maxLength: 400 },
              expectedStatus: {
                anyOf: [
                  { type: "integer", minimum: 100, maximum: 599 },
                  {
                    type: "array",
                    minItems: 1,
                    maxItems: 6,
                    items: { type: "integer", minimum: 100, maximum: 599 },
                  },
                ],
              },
              expectJson: { type: "object" },
              expectTextIncludes: {
                type: "array",
                items: { type: "string", minLength: 1, maxLength: 200 },
                maxItems: 10,
              },
              headers: { type: "object" },
              body: {},
            },
            additionalProperties: true,
          },
        },
        max_attempts: { type: "integer", minimum: 1, maximum: V3_ORCHESTRATION_MAX_DEBUG_ATTEMPTS },
        debug_user_id: { type: "string", minLength: 1, maxLength: 200 },
      },
      additionalProperties: true,
    },
  },
  v3OrchestrationBackendTaskExecute: {
    body: {
      type: "object",
      properties: {
        milestone: { type: "string", minLength: 1, maxLength: 200 },
        design_refs: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 300 },
          minItems: 1,
          maxItems: 30,
        },
        target_files: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 400 },
          minItems: 1,
          maxItems: 60,
        },
        objective: { type: "string", minLength: 1, maxLength: 500 },
        repository: { type: "string", minLength: 1, maxLength: 200 },
        plan: { type: "object" },
        runtime_mode: { type: "string", enum: ["local", "external"] },
        reconstruction_steps: {
          type: "array",
          maxItems: 30,
          items: {
            type: "object",
            required: ["id", "instruction"],
            properties: {
              id: { type: "string", minLength: 1, maxLength: 80 },
              instruction: { type: "string", minLength: 1, maxLength: 1000 },
            },
            additionalProperties: false,
          },
        },
        debug_checks: {
          type: "array",
          maxItems: V3_ORCHESTRATION_MAX_DEBUG_CHECKS,
          items: {
            type: "object",
            required: ["path"],
            properties: {
              name: { type: "string", minLength: 1, maxLength: 120 },
              method: { type: "string", minLength: 3, maxLength: 10 },
              path: { type: "string", minLength: 1, maxLength: 400 },
              expectedStatus: {
                anyOf: [
                  { type: "integer", minimum: 100, maximum: 599 },
                  {
                    type: "array",
                    minItems: 1,
                    maxItems: 6,
                    items: { type: "integer", minimum: 100, maximum: 599 },
                  },
                ],
              },
              expectJson: { type: "object" },
              expectTextIncludes: {
                type: "array",
                items: { type: "string", minLength: 1, maxLength: 200 },
                maxItems: 10,
              },
              headers: { type: "object" },
              body: {},
            },
            additionalProperties: true,
          },
        },
        max_attempts: { type: "integer", minimum: 1, maximum: V3_ORCHESTRATION_MAX_DEBUG_ATTEMPTS },
        debug_user_id: { type: "string", minLength: 1, maxLength: 200 },
      },
      additionalProperties: false,
    },
  },
  v3OrchestrationPatternExtract: {
    body: {
      type: "object",
      required: ["repository", "files"],
      properties: {
        repository: { type: "string", minLength: 1, maxLength: 200 },
        files: {
          type: "array",
          minItems: 1,
          maxItems: 80,
          items: {
            type: "object",
            required: ["path", "content"],
            properties: {
              path: { type: "string", minLength: 1, maxLength: 400 },
              content: { type: "string", minLength: 1, maxLength: 100000 },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  v3OrchestrationTrajectoryBuild: {
    body: {
      type: "object",
      required: ["objective", "plan", "reconstruction_steps"],
      properties: {
        objective: { type: "string", minLength: 1, maxLength: 500 },
        plan: { type: "object" },
        pattern_extraction: { type: "object" },
        repository: { type: "string", minLength: 1, maxLength: 200 },
        files: {
          type: "array",
          maxItems: 80,
          items: {
            type: "object",
            required: ["path", "content"],
            properties: {
              path: { type: "string", minLength: 1, maxLength: 400 },
              content: { type: "string", minLength: 1, maxLength: 100000 },
            },
            additionalProperties: false,
          },
        },
        reconstruction_steps: {
          type: "array",
          minItems: 1,
          maxItems: 30,
          items: {
            type: "object",
            required: ["id", "instruction"],
            properties: {
              id: { type: "string", minLength: 1, maxLength: 80 },
              instruction: { type: "string", minLength: 1, maxLength: 1000 },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  v3OrchestrationExecutionList: {
    querystring: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: V3_ORCHESTRATION_MAX_LIST_LIMIT },
        offset: { type: "integer", minimum: 0, maximum: 1000000 },
        status: { type: "string", minLength: 1, maxLength: 80 },
      },
      additionalProperties: false,
    },
  },
  v3OrchestrationExecutionParams: {
    params: {
      type: "object",
      required: ["execution_id"],
      properties: {
        execution_id: { type: "string", minLength: 1, maxLength: 120 },
      },
      additionalProperties: false,
    },
  },
  v3OrchestrationExecutionGet: {
    params: {
      type: "object",
      required: ["execution_id"],
      properties: {
        execution_id: { type: "string", minLength: 1, maxLength: 120 },
      },
      additionalProperties: false,
    },
    querystring: {
      type: "object",
      properties: {
        include_events: { type: "boolean" },
        event_limit: { type: "integer", minimum: 1, maximum: V3_ORCHESTRATION_MAX_EVENT_LIST_LIMIT },
        event_offset: { type: "integer", minimum: 0, maximum: 1000000 },
      },
      additionalProperties: false,
    },
  },
  v3OrchestrationExecutionEventsList: {
    params: {
      type: "object",
      required: ["execution_id"],
      properties: {
        execution_id: { type: "string", minLength: 1, maxLength: 120 },
      },
      additionalProperties: false,
    },
    querystring: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: V3_ORCHESTRATION_MAX_EVENT_LIST_LIMIT },
        offset: { type: "integer", minimum: 0, maximum: 1000000 },
      },
      additionalProperties: false,
    },
  },
  v3OrchestrationExecutionReplay: {
    params: {
      type: "object",
      required: ["execution_id"],
      properties: {
        execution_id: { type: "string", minLength: 1, maxLength: 120 },
      },
      additionalProperties: false,
    },
    body: {
      type: "object",
      properties: {
        runtime_mode: { type: "string", enum: ["local", "external"] },
        debug_checks: {
          type: "array",
          maxItems: V3_ORCHESTRATION_MAX_DEBUG_CHECKS,
          items: {
            type: "object",
            required: ["path"],
            properties: {
              name: { type: "string", minLength: 1, maxLength: 120 },
              method: { type: "string", minLength: 3, maxLength: 10 },
              path: { type: "string", minLength: 1, maxLength: 400 },
              expectedStatus: {
                anyOf: [
                  { type: "integer", minimum: 100, maximum: 599 },
                  {
                    type: "array",
                    minItems: 1,
                    maxItems: 6,
                    items: { type: "integer", minimum: 100, maximum: 599 },
                  },
                ],
              },
              expectJson: { type: "object" },
              expectTextIncludes: {
                type: "array",
                items: { type: "string", minLength: 1, maxLength: 200 },
                maxItems: 10,
              },
              headers: { type: "object" },
              body: {},
            },
            additionalProperties: true,
          },
        },
        max_attempts: { type: "integer", minimum: 1, maximum: V3_ORCHESTRATION_MAX_DEBUG_ATTEMPTS },
        debug_user_id: { type: "string", minLength: 1, maxLength: 200 },
      },
      additionalProperties: false,
    },
  },
};

function normalizeStoryInitialPrompt(initialPrompt, occasion, recipientName) {
  const trimmedPrompt = typeof initialPrompt === "string" ? initialPrompt.trim() : "";
  const safeOccasion = typeof occasion === "string" && occasion.trim() ? occasion.trim() : "celebration";
  const safeRecipient = typeof recipientName === "string" && recipientName.trim() ? recipientName.trim() : "someone special";
  const fallback = `A heartfelt ${safeOccasion} story for ${safeRecipient}.`;
  const basePrompt = trimmedPrompt || fallback;
  return {
    prompt: basePrompt,
    truncated: false,
    originalLength: basePrompt.length,
    usedLength: basePrompt.length,
  };
}

function parseMaxDebugAttempts(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 1;
  }
  return Math.min(parsed, V3_ORCHESTRATION_MAX_DEBUG_ATTEMPTS);
}

function normalizeDebugCheckPayloads(rawChecks) {
  if (!Array.isArray(rawChecks) || rawChecks.length === 0) {
    throw new Error("checks must be a non-empty array.");
  }
  if (rawChecks.length > V3_ORCHESTRATION_MAX_DEBUG_CHECKS) {
    throw new Error(`checks cannot exceed ${V3_ORCHESTRATION_MAX_DEBUG_CHECKS}.`);
  }

  return rawChecks.map((check, index) => {
    if (!check || typeof check !== "object" || Array.isArray(check)) {
      throw new Error(`checks[${index}] must be an object.`);
    }

    const path = typeof check.path === "string" ? check.path.trim() : "";
    if (!path.startsWith("/") || path.includes("://")) {
      throw new Error(`checks[${index}].path must be an internal route path starting with '/'.`);
    }
    if (path.startsWith("/story/v3/orchestration/debug-loop")) {
      throw new Error("debug-loop checks cannot target /story/v3/orchestration/debug-loop.");
    }

    return {
      ...check,
      path,
      method: typeof check.method === "string" ? check.method.toUpperCase() : "GET",
      name: typeof check.name === "string" && check.name.trim() ? check.name.trim() : undefined,
    };
  });
}

function parseOptionalJson(value, fallback = null) {
  if (typeof value !== "string" || value.length === 0) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function clampInt(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

function resolveRuntimeMode(requestedMode, defaultMode) {
  const mode = typeof requestedMode === "string" && requestedMode.trim()
    ? requestedMode.trim().toLowerCase()
    : String(defaultMode || "local").toLowerCase();

  if (mode !== "local" && mode !== "external") {
    throw new Error("runtime_mode must be 'local' or 'external'.");
  }
  return mode;
}

function createInternalInjectFetch(app, defaultHeaders = {}) {
  return async function injectedFetch(url, init = {}) {
    const parsed = new URL(url, "http://porizo.internal");
    const headers = { ...defaultHeaders, ...(init.headers || {}) };

    const response = await app.inject({
      method: init.method || "GET",
      url: `${parsed.pathname}${parsed.search || ""}`,
      headers,
      payload: init.body,
    });

    return {
      status: response.statusCode,
      text: async () => response.body || "",
    };
  };
}

/**
 * Register story routes on Fastify app
 *
 * @param {Object} app - Fastify instance
 * @param {Object} options - Options object with db, helpers, etc.
 */
function registerStoryRoutes(app, {
  db,
  requireUserId,
  requireAdminRole = null,
  sendError,
  consumeRateLimit,
  addAuditEntry,
  eventsService,
  getUserRiskLevel = async () => "low",
  subscriptionManager = null,
  enableV3OrchestrationRoutes = false,
  orchestrationExecutorMode = "local",
  orchestrationExternalCommandJson = "",
  orchestrationExternalTimeoutMs = 120000,
  storyEngineDefault: _storyEngineDefault = "v3",
}) {
  const normalizedStoryEngineDefault = "v3";

  async function upsertTrackLibraryEntry({
    userId,
    trackId,
    origin,
    shareTokenId = null,
    addedAt = new Date().toISOString(),
  }) {
    const now = new Date().toISOString();
    const updateResult = await db.prepare(
      `UPDATE track_library_entries
       SET origin = CASE WHEN origin = 'created' THEN origin ELSE ? END,
           share_token_id = COALESCE(?, share_token_id),
           added_at = CASE WHEN removed_at IS NOT NULL THEN ? ELSE added_at END,
           removed_at = NULL, updated_at = ?
       WHERE user_id = ? AND track_id = ?`
    ).run(origin, shareTokenId, addedAt, now, userId, trackId);

    if (updateResult.changes > 0) {
      return;
    }

    await db.prepare(
      `INSERT INTO track_library_entries
       (user_id, track_id, origin, share_token_id, added_at, removed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`
    ).run(userId, trackId, origin, shareTokenId, addedAt, now);
  }

  async function upsertPoemLibraryEntry({
    userId,
    poemId,
    origin,
    shareTokenId = null,
    addedAt = new Date().toISOString(),
  }) {
    const now = new Date().toISOString();
    const updateResult = await db.prepare(
      `UPDATE poem_library_entries
       SET origin = CASE WHEN origin = 'created' THEN origin ELSE ? END,
           share_token_id = COALESCE(?, share_token_id),
           added_at = CASE WHEN removed_at IS NOT NULL THEN ? ELSE added_at END,
           removed_at = NULL, updated_at = ?
       WHERE user_id = ? AND poem_id = ?`
    ).run(origin, shareTokenId, addedAt, now, userId, poemId);

    if (updateResult.changes > 0) {
      return;
    }

    await db.prepare(
      `INSERT INTO poem_library_entries
       (user_id, poem_id, origin, share_token_id, added_at, removed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`
    ).run(userId, poemId, origin, shareTokenId, addedAt, now);
  }

  async function removeTrackLibraryEntry({
    userId,
    trackId,
    removedAt = new Date().toISOString(),
  }) {
    await db.prepare(
      `UPDATE track_library_entries
       SET removed_at = COALESCE(removed_at, ?), updated_at = ?
       WHERE user_id = ? AND track_id = ? AND removed_at IS NULL`
    ).run(removedAt, removedAt, userId, trackId);
  }

  async function removePoemLibraryEntry({
    userId,
    poemId,
    removedAt = new Date().toISOString(),
  }) {
    await db.prepare(
      `UPDATE poem_library_entries
       SET removed_at = COALESCE(removed_at, ?), updated_at = ?
       WHERE user_id = ? AND poem_id = ? AND removed_at IS NULL`
    ).run(removedAt, removedAt, userId, poemId);
  }

  async function requireV3OrchestrationAdmin(request, reply) {
    if (typeof requireAdminRole !== "function") {
      sendError(reply, 503, "ADMIN_AUTH_UNAVAILABLE", "Admin auth is required for orchestration routes.");
      return null;
    }
    return requireAdminRole(request, reply, ["admin", "superadmin"]);
  }

  async function createOrchestrationExecutionRecord({
    executionId,
    adminId,
    status,
    endpoint,
    runtimeMode,
    requestPayload,
    replayOf = null,
  }) {
    const now = new Date().toISOString();
    await db.prepare(
      `INSERT INTO orchestration_executions
       (id, admin_id, status, endpoint, runtime_mode, request_json, result_json, debug_json, error_json, replay_of, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)`
    ).run(
      executionId,
      adminId,
      status,
      endpoint,
      runtimeMode,
      JSON.stringify(requestPayload || {}),
      replayOf,
      now,
      now
    );
  }

  async function updateOrchestrationExecutionRecord({
    executionId,
    status,
    result = null,
    debug = null,
    error = null,
  }) {
    await db.prepare(
      `UPDATE orchestration_executions
       SET status = ?, result_json = ?, debug_json = ?, error_json = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      status,
      result ? JSON.stringify(result) : null,
      debug ? JSON.stringify(debug) : null,
      error ? JSON.stringify(error) : null,
      new Date().toISOString(),
      executionId
    );
  }

  async function appendOrchestrationExecutionEvent({
    executionId,
    sequence,
    eventType,
    level = "info",
    message = "",
    payload = null,
  }) {
    try {
      await db.prepare(
        `INSERT INTO orchestration_execution_events
         (id, execution_id, sequence, event_type, level, message, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        crypto.randomUUID(),
        executionId,
        sequence,
        eventType,
        level,
        message || null,
        payload ? JSON.stringify(payload) : null,
        new Date().toISOString()
      );
    } catch (err) {
      console.warn("[Story V3 Orchestration] failed to persist execution event:", {
        executionId,
        sequence,
        eventType,
        error: err.message,
      });
    }
  }

  function toExecutionEventResponseRecord(row) {
    if (!row) return null;
    return {
      id: row.id,
      execution_id: row.execution_id,
      sequence: row.sequence,
      event_type: row.event_type,
      level: row.level,
      message: row.message,
      payload: parseOptionalJson(row.payload_json, null),
      created_at: row.created_at,
    };
  }

  async function listOrchestrationExecutionEvents({
    executionId,
    limit = 100,
    offset = 0,
  }) {
    const safeLimit = clampInt(limit, 1, V3_ORCHESTRATION_MAX_EVENT_LIST_LIMIT, 100);
    const safeOffset = clampInt(offset, 0, 1000000, 0);

    const countRow = await db.prepare(
      "SELECT COUNT(*) as total FROM orchestration_execution_events WHERE execution_id = ?"
    ).get(executionId);

    const rows = await db.prepare(
      `SELECT id, execution_id, sequence, event_type, level, message, payload_json, created_at
       FROM orchestration_execution_events
       WHERE execution_id = ?
       ORDER BY sequence ASC, created_at ASC
       LIMIT ? OFFSET ?`
    ).all(executionId, safeLimit, safeOffset);

    return {
      items: rows.map(toExecutionEventResponseRecord),
      pagination: {
        limit: safeLimit,
        offset: safeOffset,
        total: Number(countRow?.total || 0),
      },
    };
  }

  function toExecutionResponseRecord(row) {
    if (!row) return null;
    return {
      id: row.id,
      admin_id: row.admin_id,
      status: row.status,
      endpoint: row.endpoint,
      runtime_mode: row.runtime_mode,
      replay_of: row.replay_of,
      request: parseOptionalJson(row.request_json, {}),
      result: parseOptionalJson(row.result_json, null),
      debug: parseOptionalJson(row.debug_json, null),
      error: parseOptionalJson(row.error_json, null),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async function fetchOrchestrationExecutionRecord(executionId, {
    includeEvents = false,
    eventLimit = 100,
    eventOffset = 0,
  } = {}) {
    const row = await db.prepare(
      "SELECT * FROM orchestration_executions WHERE id = ?"
    ).get(executionId);
    const record = toExecutionResponseRecord(row);
    if (!record || !includeEvents) {
      return record;
    }

    const events = await listOrchestrationExecutionEvents({
      executionId,
      limit: eventLimit,
      offset: eventOffset,
    });
    return {
      ...record,
      events: events.items,
      events_pagination: events.pagination,
    };
  }

  function buildInternalDebugFetchOptions(requestHeaders, debugUserId, adminId) {
    const defaultHeaders = {};
    if (requestHeaders.authorization) {
      defaultHeaders.authorization = requestHeaders.authorization;
    }
    if (debugUserId) {
      defaultHeaders["x-user-id"] = debugUserId;
      console.warn(`[Security] Admin ${adminId || "unknown"} impersonating user ${debugUserId}`);
      try {
        addAuditEntry({
          userId: adminId || "unknown",
          action: "admin_impersonation",
          resourceType: "user",
          resourceId: debugUserId,
          metadata: {
            admin_id: adminId || "unknown",
            impersonated_user_id: debugUserId,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (auditErr) {
        console.error("[Security] Failed to write impersonation audit log:", auditErr.message);
      }
    }
    return defaultHeaders;
  }

  async function runV3BackendTaskExecution({
    payload,
    admin,
    requestHeaders,
    replayOf = null,
  }) {
    const backendTask = buildBackendTaskEnvelope({
      milestone: payload.milestone,
      design_refs: payload.design_refs,
      target_files: payload.target_files,
    });
    const runtimeMode = resolveRuntimeMode(payload.runtime_mode, orchestrationExecutorMode);
    const executionId = crypto.randomUUID();
    const requestPayload = {
      milestone: backendTask.milestone,
      design_refs: backendTask.design_refs,
      target_files: backendTask.target_files,
      objective: payload.objective || `Implement ${backendTask.milestone}`,
      repository: payload.repository || "porizo",
      plan: payload.plan || {},
      reconstruction_steps: Array.isArray(payload.reconstruction_steps) ? payload.reconstruction_steps : [],
      runtime_mode: runtimeMode,
      debug_checks: Array.isArray(payload.debug_checks) ? payload.debug_checks : [],
      max_attempts: payload.max_attempts,
      debug_user_id: typeof payload.debug_user_id === "string" ? payload.debug_user_id.trim() : "",
    };
    let eventSequence = 0;
    const writeEvent = async ({
      eventType,
      level = "info",
      message = "",
      payload: eventPayload = null,
    }) => {
      eventSequence += 1;
      await appendOrchestrationExecutionEvent({
        executionId,
        sequence: eventSequence,
        eventType,
        level,
        message,
        payload: eventPayload,
      });
    };

    await createOrchestrationExecutionRecord({
      executionId,
      adminId: admin.adminId,
      status: "running",
      endpoint: "backend_task_execute",
      runtimeMode,
      requestPayload,
      replayOf,
    });
    await writeEvent({
      eventType: "execution_created",
      message: "Execution record persisted and marked running.",
      payload: {
        endpoint: "backend_task_execute",
        runtime_mode: runtimeMode,
        replay_of: replayOf,
      },
    });

    try {
      await writeEvent({
        eventType: "backend_task_prepared",
        message: "Backend task envelope prepared.",
        payload: {
          milestone: backendTask.milestone,
          design_ref_count: backendTask.design_refs.length,
          target_file_count: backendTask.target_files.length,
        },
      });

      await writeEvent({
        eventType: "runtime_execution_started",
        message: "Backend task execution started.",
        payload: {
          runtime_mode: runtimeMode,
          repository: requestPayload.repository,
        },
      });

      const execution = await executeBackendTask({
        task: backendTask,
        objective: requestPayload.objective,
        plan: requestPayload.plan,
        repository: requestPayload.repository,
        reconstructionSteps: requestPayload.reconstruction_steps,
        repoRoot: process.cwd(),
        executionId,
        runtime: {
          mode: runtimeMode,
          commandJson: orchestrationExternalCommandJson,
          timeoutMs: clampInt(orchestrationExternalTimeoutMs, 1000, 600000, 120000),
        },
      });
      await writeEvent({
        eventType: "runtime_execution_completed",
        level: execution.status === "implemented" ? "success" : "warning",
        message: "Backend task execution completed.",
        payload: {
          status: execution.status,
          files_changed_count: Array.isArray(execution.files_changed) ? execution.files_changed.length : 0,
          tests_added_count: Array.isArray(execution.tests_added) ? execution.tests_added.length : 0,
          missing_target_count: Array.isArray(execution.missing_targets) ? execution.missing_targets.length : 0,
          runtime: execution.runtime || null,
        },
      });

      let debug = null;
      if (Array.isArray(requestPayload.debug_checks) && requestPayload.debug_checks.length > 0) {
        const checks = normalizeDebugCheckPayloads(requestPayload.debug_checks);
        const maxAttempts = parseMaxDebugAttempts(requestPayload.max_attempts);
        await writeEvent({
          eventType: "debug_loop_started",
          message: "Debug feedback loop started.",
          payload: {
            check_count: checks.length,
            max_attempts: maxAttempts,
          },
        });
        const fetchImpl = createInternalInjectFetch(
          app,
          buildInternalDebugFetchOptions(requestHeaders, requestPayload.debug_user_id)
        );
        debug = await runDebugFeedbackLoop({
          baseUrl: "http://porizo.internal",
          checks,
          maxAttempts,
          runChecks: ({ baseUrl, checks: checksToRun }) =>
            runHttpChecks({
              baseUrl,
              checks: checksToRun,
              fetchImpl,
              timeoutMs: 8000,
            }),
          onAttempt: async ({ attempt, report }) => {
            await writeEvent({
              eventType: "debug_attempt_completed",
              level: report.passed ? "success" : "warning",
              message: report.passed
                ? `Debug attempt ${attempt} passed.`
                : `Debug attempt ${attempt} failed.`,
              payload: {
                attempt,
                passed: report.passed,
                check_count: Array.isArray(report.checks) ? report.checks.length : 0,
                failure_count: Array.isArray(report.failures) ? report.failures.length : 0,
              },
            });
          },
        });
        await writeEvent({
          eventType: "debug_loop_completed",
          level: debug.passed ? "success" : "warning",
          message: debug.passed
            ? "Debug feedback loop passed."
            : "Debug feedback loop finished with failing checks.",
          payload: {
            attempts: debug.attempts,
            passed: debug.passed,
          },
        });
      }

      const finalStatus = debug && !debug.passed && execution.status === "implemented"
        ? "needs_debug"
        : execution.status;
      const executionPayload = { ...execution, status: finalStatus };

      await updateOrchestrationExecutionRecord({
        executionId,
        status: finalStatus,
        result: executionPayload,
        debug,
      });
      await writeEvent({
        eventType: "execution_completed",
        level: finalStatus === "implemented" ? "success" : "warning",
        message: `Execution finished with status '${finalStatus}'.`,
        payload: {
          status: finalStatus,
          runtime_mode: runtimeMode,
        },
      });

      if (typeof addAuditEntry === "function") {
        addAuditEntry({
          userId: admin.adminId,
          action: "admin_story_orchestration_execute",
          resourceType: "orchestration_execution",
          resourceId: executionId,
          metadata: {
            actor: "admin",
            runtime_mode: runtimeMode,
            replay_of: replayOf,
            status: finalStatus,
          },
        });
      }

      return {
        backendTask,
        execution: executionPayload,
        debug,
        persisted_execution_id: executionId,
        event_count: eventSequence,
      };
    } catch (err) {
      await writeEvent({
        eventType: "execution_failed",
        level: "error",
        message: err.message,
        payload: {
          code: err.code || null,
        },
      });
      await updateOrchestrationExecutionRecord({
        executionId,
        status: "failed",
        error: {
          message: err.message,
          code: err.code || null,
          stack: process.env.NODE_ENV === "production" ? null : err.stack,
        },
      });
      throw err;
    }
  }

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

  if (enableV3OrchestrationRoutes) {
    app.post(
      "/story/v3/orchestration/planning/envelope",
      { schema: schemas.v3OrchestrationPlanningEnvelope },
      async (request, reply) => {
        const admin = await requireV3OrchestrationAdmin(request, reply);
        if (!admin) return;

        try {
          const planningEnvelope = buildPlanningEnvelope(request.body || {});
          reply.send({ planning_envelope: planningEnvelope });
        } catch (err) {
          console.error("[Story V3 Orchestration] planning envelope failed:", {
            adminId: admin.adminId,
            error: err.message,
          });
          sendError(reply, 400, "V3_ORCHESTRATION_PLANNING_ENVELOPE_FAILED", err.message);
        }
      }
    );

    app.post(
      "/story/v3/orchestration/planning/normalize",
      { schema: schemas.v3OrchestrationPlanningNormalize },
      async (request, reply) => {
        const admin = await requireV3OrchestrationAdmin(request, reply);
        if (!admin) return;

        try {
          const candidate = request.body?.planning_output || request.body || {};
          const planningOutput = normalizePlanningOutput(candidate);
          reply.send({ planning_output: planningOutput });
        } catch (err) {
          console.error("[Story V3 Orchestration] planning normalize failed:", {
            adminId: admin.adminId,
            error: err.message,
          });
          sendError(reply, 400, "V3_ORCHESTRATION_PLANNING_NORMALIZE_FAILED", err.message);
        }
      }
    );

    app.post(
      "/story/v3/orchestration/backend-task",
      { schema: schemas.v3OrchestrationBackendTask },
      async (request, reply) => {
        const admin = await requireV3OrchestrationAdmin(request, reply);
        if (!admin) return;

        try {
          const backendTask = buildBackendTaskEnvelope(request.body || {});
          reply.send({ backend_task: backendTask });
        } catch (err) {
          console.error("[Story V3 Orchestration] backend task envelope failed:", {
            adminId: admin.adminId,
            error: err.message,
          });
          sendError(reply, 400, "V3_ORCHESTRATION_BACKEND_TASK_FAILED", err.message);
        }
      }
    );

    app.post(
      "/story/v3/orchestration/backend-task/execute",
      { schema: schemas.v3OrchestrationBackendTaskExecute },
      async (request, reply) => {
        const admin = await requireV3OrchestrationAdmin(request, reply);
        if (!admin) return;

        try {
          const payload = request.body || {};
          const result = await runV3BackendTaskExecution({
            payload,
            admin,
            requestHeaders: request.headers,
          });
          reply.send({
            backend_task: result.backendTask,
            execution: result.execution,
            debug: result.debug,
            persisted_execution_id: result.persisted_execution_id,
            event_count: result.event_count,
          });
        } catch (err) {
          console.error("[Story V3 Orchestration] backend task execute failed:", {
            adminId: admin.adminId,
            error: err.message,
          });
          const statusCode = err.code === "EXTERNAL_EXECUTOR_FAILED" ? 502 : 400;
          sendError(reply, statusCode, "V3_ORCHESTRATION_BACKEND_TASK_EXECUTE_FAILED", err.message);
        }
      }
    );

    app.get(
      "/story/v3/orchestration/executions",
      { schema: schemas.v3OrchestrationExecutionList },
      async (request, reply) => {
        const admin = await requireV3OrchestrationAdmin(request, reply);
        if (!admin) return;

        try {
          const limit = clampInt(request.query?.limit, 1, V3_ORCHESTRATION_MAX_LIST_LIMIT, 20);
          const offset = clampInt(request.query?.offset, 0, 1000000, 0);
          const statusFilter = typeof request.query?.status === "string" && request.query.status.trim()
            ? request.query.status.trim()
            : null;

          const whereSql = statusFilter ? "WHERE status = ?" : "";
          const countRow = statusFilter
            ? await db.prepare(`SELECT COUNT(*) as total FROM orchestration_executions ${whereSql}`).get(statusFilter)
            : await db.prepare("SELECT COUNT(*) as total FROM orchestration_executions").get();

          const rows = statusFilter
            ? await db.prepare(
              `SELECT id, admin_id, status, endpoint, runtime_mode, replay_of, created_at, updated_at
               FROM orchestration_executions ${whereSql}
               ORDER BY created_at DESC
               LIMIT ? OFFSET ?`
            ).all(statusFilter, limit, offset)
            : await db.prepare(
              `SELECT id, admin_id, status, endpoint, runtime_mode, replay_of, created_at, updated_at
               FROM orchestration_executions
               ORDER BY created_at DESC
               LIMIT ? OFFSET ?`
            ).all(limit, offset);

          reply.send({
            items: rows,
            pagination: {
              limit,
              offset,
              total: Number(countRow?.total || 0),
            },
          });
        } catch (err) {
          console.error("[Story V3 Orchestration] execution list failed:", {
            adminId: admin.adminId,
            error: err.message,
          });
          sendError(reply, 500, "V3_ORCHESTRATION_EXECUTION_LIST_FAILED", err.message);
        }
      }
    );

    app.get(
      "/story/v3/orchestration/executions/:execution_id",
      { schema: schemas.v3OrchestrationExecutionGet },
      async (request, reply) => {
        const admin = await requireV3OrchestrationAdmin(request, reply);
        if (!admin) return;

        try {
          const includeEvents = parseBoolean(request.query?.include_events, false);
          const eventLimit = clampInt(
            request.query?.event_limit,
            1,
            V3_ORCHESTRATION_MAX_EVENT_LIST_LIMIT,
            100
          );
          const eventOffset = clampInt(request.query?.event_offset, 0, 1000000, 0);
          const record = await fetchOrchestrationExecutionRecord(request.params.execution_id, {
            includeEvents,
            eventLimit,
            eventOffset,
          });
          if (!record) {
            sendError(reply, 404, "V3_ORCHESTRATION_EXECUTION_NOT_FOUND", "Execution record not found.");
            return;
          }
          reply.send({ execution: record });
        } catch (err) {
          console.error("[Story V3 Orchestration] execution get failed:", {
            adminId: admin.adminId,
            executionId: request.params.execution_id,
            error: err.message,
          });
          sendError(reply, 500, "V3_ORCHESTRATION_EXECUTION_GET_FAILED", err.message);
        }
      }
    );

    app.get(
      "/story/v3/orchestration/executions/:execution_id/events",
      { schema: schemas.v3OrchestrationExecutionEventsList },
      async (request, reply) => {
        const admin = await requireV3OrchestrationAdmin(request, reply);
        if (!admin) return;

        try {
          const existing = await fetchOrchestrationExecutionRecord(request.params.execution_id);
          if (!existing) {
            sendError(reply, 404, "V3_ORCHESTRATION_EXECUTION_NOT_FOUND", "Execution record not found.");
            return;
          }

          const limit = clampInt(
            request.query?.limit,
            1,
            V3_ORCHESTRATION_MAX_EVENT_LIST_LIMIT,
            100
          );
          const offset = clampInt(request.query?.offset, 0, 1000000, 0);
          const timeline = await listOrchestrationExecutionEvents({
            executionId: request.params.execution_id,
            limit,
            offset,
          });

          reply.send({
            execution_id: request.params.execution_id,
            items: timeline.items,
            pagination: timeline.pagination,
          });
        } catch (err) {
          console.error("[Story V3 Orchestration] execution events list failed:", {
            adminId: admin.adminId,
            executionId: request.params.execution_id,
            error: err.message,
          });
          sendError(reply, 500, "V3_ORCHESTRATION_EXECUTION_EVENTS_LIST_FAILED", err.message);
        }
      }
    );

    app.post(
      "/story/v3/orchestration/executions/:execution_id/replay",
      { schema: schemas.v3OrchestrationExecutionReplay },
      async (request, reply) => {
        const admin = await requireV3OrchestrationAdmin(request, reply);
        if (!admin) return;

        try {
          const existing = await fetchOrchestrationExecutionRecord(request.params.execution_id);
          if (!existing) {
            sendError(reply, 404, "V3_ORCHESTRATION_EXECUTION_NOT_FOUND", "Execution record not found.");
            return;
          }

          const priorPayload = existing.request || {};
          const payload = {
            ...priorPayload,
            ...(request.body || {}),
            debug_checks: Array.isArray(request.body?.debug_checks)
              ? request.body.debug_checks
              : priorPayload.debug_checks,
            max_attempts: request.body?.max_attempts ?? priorPayload.max_attempts,
            debug_user_id: request.body?.debug_user_id ?? priorPayload.debug_user_id,
          };

          const result = await runV3BackendTaskExecution({
            payload,
            admin,
            requestHeaders: request.headers,
            replayOf: existing.id,
          });

          reply.send({
            replay_of: existing.id,
            backend_task: result.backendTask,
            execution: result.execution,
            debug: result.debug,
            persisted_execution_id: result.persisted_execution_id,
            event_count: result.event_count,
          });
        } catch (err) {
          console.error("[Story V3 Orchestration] execution replay failed:", {
            adminId: admin.adminId,
            executionId: request.params.execution_id,
            error: err.message,
          });
          const statusCode = err.code === "EXTERNAL_EXECUTOR_FAILED" ? 502 : 400;
          sendError(reply, statusCode, "V3_ORCHESTRATION_EXECUTION_REPLAY_FAILED", err.message);
        }
      }
    );

    app.post(
      "/story/v3/orchestration/debug-loop",
      { schema: schemas.v3OrchestrationDebugLoop },
      async (request, reply) => {
        const admin = await requireV3OrchestrationAdmin(request, reply);
        if (!admin) return;

        try {
          const checks = normalizeDebugCheckPayloads(request.body?.checks);
          const maxAttempts = parseMaxDebugAttempts(request.body?.max_attempts);
          const debugUserId = typeof request.body?.debug_user_id === "string"
            ? request.body.debug_user_id.trim()
            : "";
          const defaultHeaders = {};
          if (request.headers.authorization) {
            defaultHeaders.authorization = request.headers.authorization;
          }
          if (debugUserId) {
            defaultHeaders["x-user-id"] = debugUserId;
            console.warn(`[Security] Admin ${admin.adminId} impersonating user ${debugUserId} in debug-loop`);
          }
          const fetchImpl = createInternalInjectFetch(app, defaultHeaders);

          const result = await runDebugFeedbackLoop({
            baseUrl: "http://porizo.internal",
            checks,
            maxAttempts,
            runChecks: ({ baseUrl, checks: checksToRun }) =>
              runHttpChecks({
                baseUrl,
                checks: checksToRun,
                fetchImpl,
                timeoutMs: 8000,
              }),
          });

          reply.send({
            passed: result.passed,
            attempts: result.attempts,
            reports: result.reports,
            final_report: result.final_report,
          });
        } catch (err) {
          console.error("[Story V3 Orchestration] debug loop failed:", {
            adminId: admin.adminId,
            error: err.message,
          });
          sendError(reply, 400, "V3_ORCHESTRATION_DEBUG_LOOP_FAILED", err.message);
        }
      }
    );

    app.post(
      "/story/v3/orchestration/patterns/extract",
      { schema: schemas.v3OrchestrationPatternExtract },
      async (request, reply) => {
        const admin = await requireV3OrchestrationAdmin(request, reply);
        if (!admin) return;

        try {
          const patternExtraction = extractPatternEnvelope({
            repository: request.body.repository,
            files: request.body.files,
          });
          reply.send({ pattern_extraction: patternExtraction });
        } catch (err) {
          console.error("[Story V3 Orchestration] pattern extraction failed:", {
            adminId: admin.adminId,
            error: err.message,
          });
          sendError(reply, 400, "V3_ORCHESTRATION_PATTERN_EXTRACT_FAILED", err.message);
        }
      }
    );

    app.post(
      "/story/v3/orchestration/trajectory/build",
      { schema: schemas.v3OrchestrationTrajectoryBuild },
      async (request, reply) => {
        const admin = await requireV3OrchestrationAdmin(request, reply);
        if (!admin) return;

        try {
          const patternExtraction =
            request.body.pattern_extraction ||
            extractPatternEnvelope({
              repository: request.body.repository || "porizo",
              files: Array.isArray(request.body.files) ? request.body.files : [],
            });

          const trajectoryExample = buildTrajectoryEnvelope({
            objective: request.body.objective,
            plan: request.body.plan,
            patternExtraction,
            reconstructionSteps: request.body.reconstruction_steps,
          });

          reply.send({ trajectory_example: trajectoryExample });
        } catch (err) {
          console.error("[Story V3 Orchestration] trajectory build failed:", {
            adminId: admin.adminId,
            error: err.message,
          });
          sendError(reply, 400, "V3_ORCHESTRATION_TRAJECTORY_BUILD_FAILED", err.message);
        }
      }
    );
  }

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
    const normalizedPromptInfo = normalizeStoryInitialPrompt(
      body.initial_prompt,
      body.occasion,
      body.recipient_name
    );
    const normalizedInitialPrompt = normalizedPromptInfo.prompt;

    // Moderate user input before processing
    try {
      const modResult = moderationCheck({
        recipient_name: body.recipient_name,
        story_context: normalizedInitialPrompt,
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
      sendError(reply, 500, "MODERATION_FAILED", "We're having trouble checking your content right now. Please try again in a moment.");
      return;
    }

    try {
      const requestedEngineVersionRaw =
        typeof body.engine_version === "string" && body.engine_version.trim()
          ? body.engine_version.trim().toLowerCase()
          : normalizedStoryEngineDefault;

      if (requestedEngineVersionRaw !== "v3") {
        sendError(
          reply,
          400,
          "STORY_ENGINE_UNSUPPORTED",
          "Only story engine 'v3' is supported.",
          {
            requested_engine_version: requestedEngineVersionRaw,
            supported_engine_versions: ["v3"],
          }
        );
        return;
      }
      const requestedEngineVersion = "v3";

      const result = await writer.startStory({
        initial_prompt: normalizedInitialPrompt,
        occasion: body.occasion || "custom",
        recipient_name: body.recipient_name,
        style: body.style || null,
        engine_version: requestedEngineVersion,
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
          initial_prompt_truncated: normalizedPromptInfo.truncated,
          initial_prompt_original_length: normalizedPromptInfo.originalLength,
          initial_prompt_used_length: normalizedPromptInfo.usedLength,
          engine_version: result.engine_version || requestedEngineVersion,
        },
      });

      // Emit story_start event for analytics
      if (eventsService) {
        eventsService.emit("story_start", {
          userId,
          resourceType: "story",
          resourceId: result.story_id,
          metadata: {
            occasion: body.occasion,
            arc: result.arc,
            style: body.style || null,
            initial_prompt_truncated: normalizedPromptInfo.truncated,
            initial_prompt_original_length: normalizedPromptInfo.originalLength,
            initial_prompt_used_length: normalizedPromptInfo.usedLength,
            engine_version: result.engine_version || requestedEngineVersion,
          },
          ip: request.ip,
          userAgent: request.headers["user-agent"],
        });
      }

      reply.send({
        story_id: result.story_id,
        first_question: result.first_question,
        complete: Boolean(result.complete),
        ready_for_confirmation: Boolean(result.ready_for_confirmation),
        action: result.action || null,
        confirmation_message: result.confirmation_message || null,
        narrative: result.narrative || null,
        arc: result.arc,
        arc_display_name: result.arc_display_name,
        recipient_name: result.recipient_name,
        progress: typeof result.completion_score === "number" ? result.completion_score : 0,
        engine_version: result.engine_version,
        suggestions: result.suggestions || [],
        ...spreadStoryAnalysisFields(result),
        initial_prompt_truncated: normalizedPromptInfo.truncated,
        initial_prompt_original_length: normalizedPromptInfo.originalLength,
        initial_prompt_used_length: normalizedPromptInfo.usedLength,
      });
    } catch (err) {
      console.error("[Story] Start failed:", { userId, occasion: body.occasion, error: err.message });
      sendError(reply, 500, "STORY_START_FAILED", "Something went wrong starting your story. Nothing was lost — please try again.");
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

    reply.send(sanitizeStoryStateForClient(state));
  });

  /**
   * POST /story/:story_id/style
   * Persist a mid-story style change so resume/to-track stay in sync.
   */
  app.post("/story/:story_id/style", { schema: schemas.updateStoryStyle }, async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const { story_id } = request.params;

    const state = await verifyStoryOwnership(story_id, userId, sendError, reply, db);
    if (!state) return;

    try {
      const requestedStyle = typeof request.body?.style === "string"
        ? request.body.style.trim() || null
        : null;
      const result = await writer.updateStoryStyle(story_id, requestedStyle);
      reply.send({
        story_id,
        style: result.style ?? null,
      });
    } catch (err) {
      console.error("[Story] Style update failed:", { story_id, userId, error: err.message });
      sendError(reply, 500, "STYLE_UPDATE_FAILED", "Something went wrong updating the style. Your story is saved — please try again.");
    }
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
    const { answer, expected_session_version } = request.body;

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
      sendError(reply, 500, "MODERATION_FAILED", "We're having trouble checking your content right now. Your story is saved — please try again in a moment.");
      return;
    }

    try {
      const result = await writer.continueStory({ story_id, answer, expected_session_version });

      if (result.error) {
        reply.send({
          complete: false,
          ready_for_confirmation: false,
          action: "ASK",
          error: result.error,
          next_question: result.current_question || null,
          current_question: result.current_question,
          narrative: result.narrative || null,
          progress: typeof result.progress === "number" ? result.progress : 0,
          questions_asked: result.questions_asked || 0,
          suggestions: [],
          ...spreadStoryAnalysisFields(result),
        });
        return;
      }

      if (result.complete) {
        reply.send({
          complete: true,
          action: "CONFIRM",
          story_summary: result.story_summary,
          narrative: result.narrative || result.story_summary,
          soul_of_story: result.soul_of_story,
          progress: result.progress,
          ready_for_confirmation: true,
          suggestions: [],
          ...spreadStoryAnalysisFields(result),
        });
      } else {
        reply.send({
          complete: false,
          action: result.action || "ASK",
          next_question: result.next_question,
          narrative: result.narrative,
          progress: result.progress,
          questions_asked: result.questions_asked,
          ready_for_confirmation: false,
          suggestions: result.suggestions || [],
          ...spreadStoryAnalysisFields(result),
        });
      }
    } catch (err) {
      if (err.name === "StoryVersionConflictError") {
        sendError(reply, 409, "STORY_VERSION_CONFLICT", "Session was modified by another request. Please retry.");
        return;
      }
      console.error("[Story] Continue failed:", { story_id, userId, error: err.message });
      sendError(reply, 500, "STORY_CONTINUE_FAILED", "Something went wrong processing your answer. Your story is saved — please try again.", {
        retryable: true,
      });
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
      sendError(reply, 500, "STORY_SUMMARY_FAILED", "Something went wrong loading your story summary. Please try again.");
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
    const { additional_notes, force_confirm } = request.body || {};

    // Rate limit confirm attempts (prevents guidance loop abuse)
    const confirmLimit = await consumeRateLimit(userId, "story_confirm", 20, 60 * 60);
    if (!confirmLimit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Too many confirmation attempts. Please wait a moment.", {
        retry_at: confirmLimit.reset_at,
      });
      return;
    }

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
        sendError(reply, 500, "MODERATION_FAILED", "We're having trouble checking your content right now. Your story is saved — please try again in a moment.");
        return;
      }
    }

    try {
      const result = await writer.confirmStory(story_id, {
        additionalNotes: additional_notes,
        forceConfirm: force_confirm === true,
      });

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
          metadata: {
            has_additional_notes: Boolean(additional_notes),
            force_confirm: force_confirm === true,
          },
          ip: request.ip,
          userAgent: request.headers["user-agent"],
        });
      }

      reply.send(result);
    } catch (err) {
      if (err.name === "StoryVersionConflictError") {
        sendError(reply, 409, "STORY_VERSION_CONFLICT", "Session was modified by another request. Please retry.");
        return;
      }
      console.error("[Story] Confirm failed:", { story_id, userId, error: err.message });
      if (err.code === "STORY_NEEDS_INPUT") {
        sendError(
          reply,
          422,
          "STORY_NEEDS_INPUT",
          err.question || err.message || "Before I lock this in, give me one more line about what changed or what this story means to you.",
          {
            recovery: {
              question: err.question || err.message || "Before I lock this in, give me one more line about what changed or what this story means to you.",
              suggestions: Array.isArray(err.suggestions) ? err.suggestions : [],
              missing_blocks: Array.isArray(err.missingBlocks) ? err.missingBlocks : [],
              session_version: Number.isFinite(Number(err.sessionVersion)) ? Number(err.sessionVersion) : null,
            },
          }
        );
        return;
      }
      if (err.code === "STORY_REVISION_CLARIFY_REQUIRED") {
        sendError(reply, 409, "STORY_REVISION_CLARIFY_REQUIRED", "Story revision needs clarification before confirmation.", {
          follow_up_question: err.message,
        });
        return;
      }
      const retryable = !additional_notes && force_confirm !== true;
      sendError(
        reply,
        500,
        "STORY_CONFIRM_FAILED",
        retryable
          ? "Something went wrong confirming your story. Your story is saved. Please try again."
          : "Something went wrong confirming your story after applying your latest notes. Your story is saved. Please review the draft and try again.",
        { retryable }
      );
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
      sendError(reply, 500, "MODERATION_FAILED", "We're having trouble checking your content right now. Your story is saved — please try again in a moment.");
      return;
    }

    try {
      const result = await writer.addMoreDetails(story_id, detail);
      reply.send(result);
    } catch (err) {
      console.error("[Story] Add details failed:", { story_id, userId, error: err.message });
      sendError(reply, 500, "STORY_ADD_DETAILS_FAILED", "Something went wrong adding details. Your story is saved — please try again.");
    }
  });

  /**
   * POST /story/:story_id/revise
   * Apply an explicit revision request to the current story draft.
   */
  app.post("/story/:story_id/revise", { schema: schemas.reviseStory }, async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const limit = await consumeRateLimit(userId, "story_continue", 60, 60 * 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Story answer rate limit reached.", {
        retry_after: limit.reset_at,
      });
      return;
    }

    const { story_id } = request.params;
    const { revision_request, source, operation } = request.body;

    const state = await verifyStoryOwnership(story_id, userId, sendError, reply, db);
    if (!state) return;

    try {
      const modResult = moderationCheck({ story_context: revision_request });
      if (!modResult.allowed) {
        sendError(reply, 400, "CONTENT_BLOCKED", modResult.reason || "Content not allowed", {
          category: modResult.category,
          severity: modResult.severity,
        });
        return;
      }
    } catch (modErr) {
      console.error("[Story] Revision moderation failed:", { story_id, userId, error: modErr.message });
      sendError(reply, 500, "MODERATION_FAILED", "We're having trouble checking your content right now. Your story is saved — please try again in a moment.");
      return;
    }

    try {
      const result = await writer.reviseStory(story_id, revision_request, {
        source: source || "review_edit",
        operation,
      });
      reply.send(result);
    } catch (err) {
      if (err.name === "StoryVersionConflictError") {
        sendError(reply, 409, "STORY_VERSION_CONFLICT", "Session was modified by another request. Please retry.");
        return;
      }
      console.error("[Story] Revision failed:", { story_id, userId, error: err.message });
      sendError(reply, 500, "STORY_REVISE_FAILED", "Something went wrong with the revision. Your story is saved — please try again.");
    }
  });

  /**
   * GET /story/:story_id/element-guidance/:element_id
   * Fetch LLM-generated guidance for a weak story element.
   */
  app.get("/story/:story_id/element-guidance/:element_id", { schema: schemas.elementGuidance }, async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const limit = await consumeRateLimit(userId, "element_guidance", 20, 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Element guidance rate limit reached.", {
        retry_after: limit.reset_at,
      });
      return;
    }

    const { story_id, element_id } = request.params;

    const state = await verifyStoryOwnership(story_id, userId, sendError, reply, db);
    if (!state) return;

    try {
      const guidance = await generateElementGuidance(state, element_id);
      if (!guidance) {
        sendError(reply, 404, "ELEMENT_NOT_FOUND", `Element "${element_id}" not found.`);
        return;
      }
      reply.send(guidance);
    } catch (err) {
      console.error("[Story] Element guidance failed:", { story_id, element_id, userId, error: err.message });
      sendError(reply, 500, "GUIDANCE_FAILED", "Something went wrong generating guidance. Your story is saved — please try again.");
    }
  });

  /**
   * POST /story/:story_id/review
   * Canonically mark the draft ready for review without confirming it.
   */
  app.post("/story/:story_id/review", { schema: schemas.reviewStory }, async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const { story_id } = request.params;

    const state = await verifyStoryOwnership(story_id, userId, sendError, reply, db);
    if (!state) return;

    try {
      const result = await writer.prepareStoryReview(story_id);
      reply.send(result);
    } catch (err) {
      console.error("[Story] Review-ready transition failed:", { story_id, userId, error: err.message });
      sendError(reply, 500, "STORY_REVIEW_PREP_FAILED", "Something went wrong preparing your review. Your story is saved — please try again.");
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
      const lyricsText = extractLyricsText(result.lyrics);
      const validation = validateGeneratedLyrics(lyricsText, state.recipient_name);

      if (!validation.allowed) {
        console.error("[Story] Generated story lyrics failed moderation:", {
          story_id,
          userId,
          reason: validation.reason,
          details: validation.details || null,
        });
        addAuditEntry({
          userId,
          action: "story_lyrics_moderation_blocked",
          resourceType: "story",
          resourceId: story_id,
          metadata: {
            reason: validation.reason,
          },
        });
        sendError(reply, 422, "GENERATION_BLOCKED", "Generated lyrics failed moderation.", {
          reason: validation.reason,
        });
        return;
      }

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
        has_anchor: validation.hasAnchor,
      });
    } catch (err) {
      console.error("[Story] Lyrics generation failed:", { story_id, userId, error: err.message });
      if (err.message && err.message.includes("must be confirmed")) {
        sendError(reply, 400, "STORY_NOT_CONFIRMED", "Story must be confirmed before generating lyrics.");
      } else if (err.code === "AI_UNAVAILABLE" || err.message === "AI_UNAVAILABLE") {
        sendError(reply, 503, "AI_UNAVAILABLE", "Lyrics generation is temporarily unavailable.");
      } else {
        sendError(reply, 500, "LYRICS_GENERATION_FAILED", "Something went wrong creating your lyrics. Your story is saved — please try again.");
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
    const { tone, style, gift_reservation_id: giftReservationId, force } = request.body || {};
    const existingGiftPoem = giftReservationId
      ? await findGiftFundingContent(db, {
        reservationId: giftReservationId,
        contentType: "poem",
      })
      : null;
    if (existingGiftPoem?.contentType === "poem") {
      const existingPoem = await db.prepare(
        `SELECT id, user_id, title, recipient_name, occasion, tone, verses, status, created_at, updated_at
         FROM poems
         WHERE id = ? AND deleted_at IS NULL`
      ).get(existingGiftPoem.contentId);
      if (existingPoem && existingPoem.user_id === userId) {
        await removePoemLibraryEntry({
          userId,
          poemId: existingPoem.id,
        });
        reply.send({
          poem: {
            id: existingPoem.id,
            user_id: existingPoem.user_id,
            title: existingPoem.title,
            recipient_name: existingPoem.recipient_name,
            occasion: existingPoem.occasion,
            tone: existingPoem.tone,
            verses: JSON.parse(existingPoem.verses || "[]"),
            status: existingPoem.status,
            created_at: existingPoem.created_at,
            updated_at: existingPoem.updated_at,
          },
          provider: null,
          model: null,
          idempotent: true,
        });
        return;
      }
    }
    const giftFundingReservation = giftReservationId
      ? await validateGiftFundingReservation(db, {
        userId,
        reservationId: giftReservationId,
        contentType: "poem",
      }).catch((err) => {
        if (mapGiftFundingError(reply, err)) {
          return "__handled__";
        }
        throw err;
      })
      : null;
    if (giftFundingReservation === "__handled__") {
      return;
    }

    // C1: Read-only poem credit check BEFORE the LLM call
    if (subscriptionManager && !giftFundingReservation) {
      try {
        const entitlements = await subscriptionManager.getEntitlements(userId);
        if (!entitlements || entitlements.poemsRemaining <= 0) {
          console.warn("[SecurityGuard:CreditCheck] Poem credit check blocked request for user", userId);
          sendError(reply, 402, "INSUFFICIENT_POEM_CREDITS", "No poem credits remaining.");
          return;
        }
      } catch (creditErr) {
        console.warn("[SecurityGuard:CreditCheck] Poem credit check blocked request for user", userId);
        sendError(reply, 402, "INSUFFICIENT_POEM_CREDITS", "No poem credits remaining.");
        return;
      }
    }

    // Verify ownership
    const state = await verifyStoryOwnership(story_id, userId, sendError, reply, db);
    if (!state) return;

    try {
      const context = await writer.getStoryContext(story_id, { includeReadiness: false, includeMetadata: false });
      if (context.status !== "confirmed") {
        sendError(reply, 400, "STORY_NOT_CONFIRMED", "Story must be confirmed before generating a poem.");
        return;
      }

      if (force !== true) {
        const readiness = evaluatePoemReadiness(context);
        if (!readiness.is_complete) {
          sendError(reply, 422, "STORY_INCOMPLETE", "Story is missing required details.", {
            gaps: readiness.gaps,
            suggested_question: readiness.suggested_question,
          });
          return;
        }
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

      await db.prepare(
        `INSERT INTO poems (id, user_id, title, recipient_name, occasion, tone, verses, message, status, funding_source, gift_reservation_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        giftFundingReservation ? "gift_token" : "standard",
        giftFundingReservation?.id || null,
        now,
        now
      );
      if (giftFundingReservation) {
        await removePoemLibraryEntry({
          userId,
          poemId,
          removedAt: now,
        });
      } else {
        await upsertPoemLibraryEntry({
          userId,
          poemId,
          origin: "created",
          shareTokenId: null,
          addedAt: now,
        });
      }

      // Spend poem credit after successful generation (mirrors poems.js pattern)
      if (subscriptionManager && !giftFundingReservation) {
        try {
          await subscriptionManager.spendPoem(userId, poemId);
        } catch (spendErr) {
          // Generation succeeded but credit spend failed — don't give away free content
          await db.prepare("UPDATE poems SET status = 'generation_failed' WHERE id = ?").run(poemId);
          sendError(reply, 503, "CREDIT_ERROR", "Unable to process credit. Please try again.");
          return;
        }
      }

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
        sendError(reply, 500, "POEM_GENERATION_FAILED", "Something went wrong creating your poem. Your story is saved — please try again.");
      }
    }
  });

  /**
   * POST /v2/story/:id/audio
   * Transcribe audio input for story answers using speech-to-text
   */
  const SUPPORTED_AUDIO_FORMATS = ["m4a", "mp3", "wav", "webm", "ogg"];
  const MAX_AUDIO_SIZE = 10 * 1024 * 1024; // 10MB

  app.post("/v2/story/:id/audio", { schema: schemas.audioTranscribe }, async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    // H7: Rate limit audio transcription (Whisper API cost protection)
    const audioLimit = await consumeRateLimit(userId, "audio_transcribe", 10, 60 * 60);
    if (!audioLimit.allowed) {
      console.warn("[SecurityGuard:RateLimit] Audio transcription rate limit blocked user", userId);
      sendError(reply, 429, "RATE_LIMITED", "Audio transcription rate limit reached.", {
        retry_after: audioLimit.reset_at,
      });
      return;
    }

    const { id: storyId } = request.params;

    // Verify ownership
    const state = await verifyStoryOwnership(storyId, userId, sendError, reply, db);
    if (!state) return;

    // Parse multipart file upload
    let fileData;
    try {
      fileData = await request.file();
    } catch (err) {
      console.error("[Story Audio] Multipart parse error:", { storyId, userId, error: err.message });
      sendError(reply, 400, "INVALID_REQUEST", "Invalid multipart request.");
      return;
    }

    if (!fileData) {
      sendError(reply, 400, "NO_FILE", "No audio file uploaded.");
      return;
    }

    // Validate file format
    const filename = fileData.filename || "audio.m4a";
    const ext = filename.split(".").pop()?.toLowerCase();
    if (!ext || !SUPPORTED_AUDIO_FORMATS.includes(ext)) {
      sendError(reply, 415, "UNSUPPORTED_FORMAT", `Unsupported audio format. Supported: ${SUPPORTED_AUDIO_FORMATS.join(", ")}`);
      return;
    }

    // Read file stream into buffer with size limit check
    const chunks = [];
    let totalSize = 0;
    try {
      for await (const chunk of fileData.file) {
        totalSize += chunk.length;
        if (totalSize > MAX_AUDIO_SIZE) {
          sendError(reply, 413, "FILE_TOO_LARGE", `Audio file exceeds maximum size of ${MAX_AUDIO_SIZE / (1024 * 1024)}MB.`);
          return;
        }
        chunks.push(chunk);
      }
    } catch (err) {
      console.error("[Story Audio] File read error:", { storyId, userId, error: err.message });
      sendError(reply, 500, "FILE_READ_ERROR", "Something went wrong reading your audio file. Please try recording again.");
      return;
    }

    const audioBuffer = Buffer.concat(chunks);

    if (audioBuffer.length === 0) {
      sendError(reply, 400, "EMPTY_FILE", "Uploaded audio file is empty.");
      return;
    }

    // Transcribe audio using Whisper
    let transcription;
    try {
      console.log("[Story Audio] Starting transcription:", { storyId, userId, size: audioBuffer.length, format: ext });
      transcription = await transcribeAudio(audioBuffer, { filename });
    } catch (err) {
      console.error("[Story Audio] Transcription failed:", { storyId, userId, error: err.message });
      sendError(reply, 500, "TRANSCRIPTION_FAILED", "Something went wrong transcribing your audio. Please try recording again.");
      return;
    }

    // Log successful transcription
    const transcriptionText = transcription.text || "";
    const transcriptionLength = transcriptionText.length;
    const exceedsStoryStartLimit = transcriptionLength > STORY_INITIAL_PROMPT_MAX_LENGTH;
    addAuditEntry({
      userId,
      action: "story_audio_transcribed",
      resourceType: "story",
      resourceId: storyId,
      metadata: {
        duration: transcription.duration,
        language: transcription.language,
        text_length: transcriptionLength,
        exceeds_story_start_limit: exceedsStoryStartLimit,
      },
    });

    reply.send({
      success: true,
      transcription: transcriptionText,
      language: transcription.language,
      duration: transcription.duration,
      text_length: transcriptionLength,
      story_start_warning_threshold: STORY_INITIAL_PROMPT_WARNING_THRESHOLD,
      story_start_limit: STORY_INITIAL_PROMPT_MAX_LENGTH,
      exceeds_story_start_limit: exceedsStoryStartLimit,
    });
  });

  /**
   * POST /v2/audio/transcribe
   * Standalone audio transcription (no story context required)
   * Used for voice input in flows where no story exists yet (e.g., Simple create flow)
   */
  app.post("/v2/audio/transcribe", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    // H7: Rate limit audio transcription (Whisper API cost protection)
    const audioLimit = await consumeRateLimit(userId, "audio_transcribe", 10, 60 * 60);
    if (!audioLimit.allowed) {
      console.warn("[SecurityGuard:RateLimit] Audio transcription rate limit blocked user", userId);
      sendError(reply, 429, "RATE_LIMITED", "Audio transcription rate limit reached.", {
        retry_after: audioLimit.reset_at,
      });
      return;
    }

    // Parse multipart file upload
    let fileData;
    try {
      fileData = await request.file();
    } catch (err) {
      console.error("[Audio Transcribe] Multipart parse error:", { userId, error: err.message });
      sendError(reply, 400, "INVALID_REQUEST", "Invalid multipart request.");
      return;
    }

    if (!fileData) {
      sendError(reply, 400, "NO_FILE", "No audio file uploaded.");
      return;
    }

    // Validate file format
    const filename = fileData.filename || "audio.m4a";
    const ext = filename.split(".").pop()?.toLowerCase();
    if (!ext || !SUPPORTED_AUDIO_FORMATS.includes(ext)) {
      sendError(reply, 415, "UNSUPPORTED_FORMAT", `Unsupported audio format. Supported: ${SUPPORTED_AUDIO_FORMATS.join(", ")}`);
      return;
    }

    // Read file stream into buffer with size limit check
    const chunks = [];
    let totalSize = 0;
    try {
      for await (const chunk of fileData.file) {
        totalSize += chunk.length;
        if (totalSize > MAX_AUDIO_SIZE) {
          sendError(reply, 413, "FILE_TOO_LARGE", `Audio file exceeds maximum size of ${MAX_AUDIO_SIZE / (1024 * 1024)}MB.`);
          return;
        }
        chunks.push(chunk);
      }
    } catch (err) {
      console.error("[Audio Transcribe] File read error:", { userId, error: err.message });
      sendError(reply, 500, "FILE_READ_ERROR", "Something went wrong reading your audio file. Please try recording again.");
      return;
    }

    const audioBuffer = Buffer.concat(chunks);

    if (audioBuffer.length === 0) {
      sendError(reply, 400, "EMPTY_FILE", "Uploaded audio file is empty.");
      return;
    }

    // Transcribe audio using Whisper
    let transcription;
    try {
      console.log("[Audio Transcribe] Starting transcription:", { userId, size: audioBuffer.length, format: ext });
      transcription = await transcribeAudio(audioBuffer, { filename });
    } catch (err) {
      console.error("[Audio Transcribe] Transcription failed:", { userId, error: err.message });
      sendError(reply, 500, "TRANSCRIPTION_FAILED", "Something went wrong transcribing your audio. Please try recording again.");
      return;
    }

    // Log successful transcription (no story context)
    const transcriptionText = transcription.text || "";
    const transcriptionLength = transcriptionText.length;
    const exceedsStoryStartLimit = transcriptionLength > STORY_INITIAL_PROMPT_MAX_LENGTH;
    addAuditEntry({
      userId,
      action: "audio_transcribed",
      resourceType: "audio",
      resourceId: null,
      metadata: {
        duration: transcription.duration,
        language: transcription.language,
        text_length: transcriptionLength,
        exceeds_story_start_limit: exceedsStoryStartLimit,
      },
    });

    reply.send({
      success: true,
      transcription: transcriptionText,
      language: transcription.language,
      duration: transcription.duration,
      text_length: transcriptionLength,
      story_start_warning_threshold: STORY_INITIAL_PROMPT_WARNING_THRESHOLD,
      story_start_limit: STORY_INITIAL_PROMPT_MAX_LENGTH,
      exceeds_story_start_limit: exceedsStoryStartLimit,
    });
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
  app.post("/story/:story_id/to-track", { schema: schemas.toTrack }, async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    // H3: Rate limit track creation (mirrors tracks.js pattern)
    const limit = await consumeRateLimit(userId, "track_create", 20, 60 * 60);
    if (!limit.allowed) {
      console.warn("[SecurityGuard:RateLimit] Track creation rate limit blocked user", userId);
      sendError(reply, 429, "RATE_LIMITED", "Track creation rate limit reached.", {
        retry_after: limit.reset_at,
      });
      return;
    }

    const { story_id } = request.params;
    const requestedVoiceModeRaw = request.body?.voice_mode;
    const giftReservationId = request.body?.gift_reservation_id || null;
    const existingGiftTrack = giftReservationId
      ? await findGiftFundingContent(db, {
        reservationId: giftReservationId,
        contentType: "song",
      })
      : null;
    if (existingGiftTrack?.contentType === "song") {
      const existingVersion = await db.prepare(
        `SELECT id, version_num
         FROM track_versions
         WHERE track_id = ? AND version_num = ?
         LIMIT 1`
      ).get(existingGiftTrack.contentId, existingGiftTrack.versionNum || 1);
      if (existingVersion) {
        await removeTrackLibraryEntry({
          userId,
          trackId: existingGiftTrack.contentId,
        });
        reply.send({
          track_id: existingGiftTrack.contentId,
          version_id: existingVersion.id,
          version_num: Number(existingVersion.version_num || 1),
          idempotent: true,
        });
        return;
      }
    }
    const giftFundingReservation = giftReservationId
      ? await validateGiftFundingReservation(db, {
        userId,
        reservationId: giftReservationId,
        contentType: "song",
      }).catch((err) => {
        if (mapGiftFundingError(reply, err)) {
          return "__handled__";
        }
        throw err;
      })
      : null;
    if (giftFundingReservation === "__handled__") {
      return;
    }

    // Verify ownership
    const state = await verifyStoryOwnership(story_id, userId, sendError, reply, db);
    if (!state) return;

    try {
      // Style resolution (three-layer priority):
      //   1. request.body.style  — explicit override at track-creation time,
      //      run through normalizeStyle() which lowercases, normalizes separators,
      //      and resolves aliases (e.g. "R&B" -> "rnb")
      //   2. storyContext.style   — captured during story collection
      //      (v2State.dials?.style || session.style, see writer/v3/index.js)
      //   3. null                 — no style; downstream picks server default
      const storyContext = await writer.getStoryContext(story_id, { includeReadiness: false, includeMetadata: false });
      const requestedStyle = normalizeStyle(request.body?.style) || null;
      const effectiveStyle = requestedStyle || storyContext.style || null;

      if (storyContext.status !== "confirmed") {
        sendError(reply, 400, "STORY_NOT_CONFIRMED", "Story must be confirmed first.");
        return;
      }

      const riskLevel = await getUserRiskLevel(userId);
      if (riskLevel === "blocked") {
        sendError(reply, 403, "ACCOUNT_BLOCKED", "Account is blocked.");
        return;
      }

      const myVoiceEnabled = await getFeatureFlag(db, "my_voice_enabled");
      let requestedVoiceMode = requestedVoiceModeRaw === "user_voice" ? "user_voice" : "ai_voice";
      if (!myVoiceEnabled && requestedVoiceMode === "user_voice") {
        requestedVoiceMode = "ai_voice";
      }

      if (requestedVoiceMode === "user_voice") {
        if (riskLevel === "high") {
          sendError(reply, 403, "VOICE_MODE_DISABLED", "Voice mode disabled for high-risk accounts.");
          return;
        }

        const profile = await db
          .prepare("SELECT id FROM voice_profiles WHERE user_id = ? AND status = 'active'")
          .get(userId);
        if (!profile) {
          sendError(reply, 403, "VOICE_PROFILE_REQUIRED", "Voice profile required for user_voice.");
          return;
        }
      }

      // Create a track with the story context
      const trackId = newUuid();
      const now = new Date().toISOString();

      // Compute params_hash for version reproducibility
      const paramsJson = JSON.stringify({
        story_id,
        occasion: storyContext.occasion,
        style: effectiveStyle,
        voice_mode: requestedVoiceMode,
        voice_gender: request.body?.voice_gender || null,
        arc: storyContext.eventType || "unified",
        narrative_version: typeof storyContext.narrativeVersion === "number" ? storyContext.narrativeVersion : 0,
      });
      const paramsHash = crypto.createHash("sha256").update(paramsJson).digest("hex").slice(0, 16);

      await db.prepare(`
        INSERT INTO tracks (id, user_id, status, title, occasion, recipient_name, style, message, story_context_json, voice_mode, voice_gender, funding_source, gift_reservation_id, latest_version, created_at, updated_at)
        VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        trackId,
        userId,
        `Song for ${storyContext.recipientName}`,
        storyContext.occasion,
        storyContext.recipientName,
        effectiveStyle,
        storyContext.initialPrompt,
        JSON.stringify(buildTrackStoryContextPayload(storyContext, { storyId: story_id })),
        requestedVoiceMode,
        request.body?.voice_gender || null,
        giftFundingReservation ? "gift_token" : "standard",
        giftFundingReservation?.id || null,
        now,
        now
      );
      if (giftFundingReservation) {
        await removeTrackLibraryEntry({
          userId,
          trackId,
          removedAt: now,
        });
      } else {
        await upsertTrackLibraryEntry({
          userId,
          trackId,
          origin: "created",
          shareTokenId: null,
          addedAt: now,
        });
      }

      // Create initial version with all required fields
      const versionId = newUuid();
      await db.prepare(`
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
        voice_mode: requestedVoiceMode,
      });
    } catch (err) {
      console.error("[Story] To-track failed:", { story_id, userId, error: err.message });
      sendError(reply, 500, "STORY_TO_TRACK_FAILED", "Something went wrong creating your song. Your story is saved — please try again.");
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // DEBUG ENDPOINTS — dev-mode only, for story algorithm tuning
  // Remove these when autoresearch optimization is complete.
  // ═══════════════════════════════════════════════════════════════════

  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
    const {
      computeLabovGapAnalysis,
      computeStoryGapAnalysis,
      computeStoryElements,
      computeQuestionPriority,
      getQuestionStage,
      detectEmotionalIntensity,
    } = require("../writer/v3/quality");
    const { extractStoryState } = require("../writer/v3");

    // GET /debug/story/:id/state — Full Labov analysis for a story session
    app.get("/debug/story/:id/state", async (request, reply) => {
      const { id } = request.params;
      try {
        const state = await writer.getStoryState(id);
        if (!state) {
          sendError(reply, 404, "NOT_FOUND", "Story session not found.");
          return;
        }

        const occasion = state.event?.occasion || state.occasion || "celebration";
        const turnCount = state.turn_count || 0;

        const labovAnalysis = computeLabovGapAnalysis(state, { occasion, turnCount });
        const legacyAnalysis = computeStoryGapAnalysis(state);
        const storyState = extractStoryState(state);
        const elements = computeStoryElements(labovAnalysis);
        const questionPriority = computeQuestionPriority(labovAnalysis);
        const questionStage = getQuestionStage(turnCount);

        reply.send({
          session_id: id,
          turn_count: turnCount,
          occasion,
          labov: {
            elements: labovAnalysis.labov?.elements || [],
            weighted_score: labovAnalysis.labov?.weightedScore || 0,
            is_ready: labovAnalysis.isStoryReady,
            can_proceed_anyway: labovAnalysis.canProceedAnyway || false,
            readiness_score: labovAnalysis.readinessScore,
          },
          legacy: {
            readiness_score: legacyAnalysis.readinessScore,
            is_ready: legacyAnalysis.isStoryReady,
            profile: legacyAnalysis.readinessProfile,
          },
          display_elements: elements,
          question_targeting: {
            priority: questionPriority,
            stage: questionStage,
          },
          fact_tracking: {
            known_facts: storyState?.labov || {},
            sensory_details: storyState?.sensoryDetails || [],
            questions_asked: storyState?.questionsAsked || [],
          },
          recipient: storyState?.recipient || {},
        });
      } catch (err) {
        console.error("[Debug] Story state failed:", err.message);
        sendError(reply, 500, "DEBUG_ERROR", err.message);
      }
    });

    // POST /debug/story/simulate — Run one round through the algorithm without DB write
    app.post("/debug/story/simulate", async (request, reply) => {
      const { message, occasion, recipient_name, prior_state } = request.body || {};

      if (!message) {
        sendError(reply, 400, "MISSING_INPUT", "message is required.");
        return;
      }

      try {
        // Build a minimal state for simulation
        const state = prior_state || {
          facts: [],
          conversation: [],
          atoms: { who: recipient_name || null },
          primitives: {},
          dials: {},
          motifs: [],
          narrative: "",
          turn_count: 0,
          event: { occasion: occasion || "birthday" },
          recipient_name: recipient_name || "someone",
          occasion: occasion || "birthday",
          flags: { labov_scoring: true },
        };

        // Add user message to conversation
        const updatedConversation = [
          ...(state.conversation || []),
          { role: "user", content: message },
        ];
        state.conversation = updatedConversation;
        state.turn_count = (state.turn_count || 0) + 1;

        // Run Labov analysis
        const labovAnalysis = computeLabovGapAnalysis(state, {
          occasion: state.occasion || "birthday",
          turnCount: state.turn_count,
        });

        // Extract story state for anti-repetition
        const storyState = extractStoryState(state);
        state.story_state = storyState;

        // Compute question targeting
        const questionPriority = computeQuestionPriority(labovAnalysis);
        const questionStage = getQuestionStage(state.turn_count);
        const emotionalIntensity = detectEmotionalIntensity(message);

        // Compute display elements
        const elements = computeStoryElements(labovAnalysis);

        reply.send({
          turn_count: state.turn_count,
          labov: {
            elements: labovAnalysis.labov?.elements || [],
            weighted_score: labovAnalysis.labov?.weightedScore || 0,
            is_ready: labovAnalysis.isStoryReady,
            can_proceed_anyway: labovAnalysis.canProceedAnyway || false,
          },
          display_elements: elements,
          question_targeting: {
            priority: questionPriority,
            stage: questionStage,
            emotional_intensity: emotionalIntensity,
          },
          fact_tracking: {
            known_facts: storyState?.labov || {},
            sensory_details: storyState?.sensoryDetails || [],
            questions_asked: storyState?.questionsAsked || [],
          },
          // Return state for multi-round simulation
          prior_state: state,
        });
      } catch (err) {
        console.error("[Debug] Simulate failed:", err.message);
        sendError(reply, 500, "DEBUG_ERROR", err.message);
      }
    });

    // GET /debug/story/:id/transcript — Full conversation with per-round analysis
    app.get("/debug/story/:id/transcript", async (request, reply) => {
      const { id } = request.params;
      try {
        const state = await writer.getStoryState(id);
        if (!state) {
          sendError(reply, 404, "NOT_FOUND", "Story session not found.");
          return;
        }

        const conversation = state.conversation || [];
        const turns = [];
        let turnNum = 0;

        for (const msg of conversation) {
          if (msg.role === "user") {
            turnNum++;
            const emotionalIntensity = detectEmotionalIntensity(msg.content);
            turns.push({
              turn: turnNum,
              role: "user",
              content: msg.content,
              emotional_intensity: emotionalIntensity,
            });
          } else if (msg.role === "assistant") {
            turns.push({
              turn: turnNum,
              role: "assistant",
              content: msg.content?.slice(0, 500) || "",
              action: msg.action || null,
              suggestions: msg.suggestions || [],
            });
          }
        }

        const labovAnalysis = computeLabovGapAnalysis(state, {
          occasion: state.event?.occasion || state.occasion,
          turnCount: state.turn_count || 0,
        });

        reply.send({
          session_id: id,
          total_turns: turnNum,
          current_readiness: {
            labov_score: labovAnalysis.labov?.weightedScore || 0,
            is_ready: labovAnalysis.isStoryReady,
            can_proceed: labovAnalysis.canProceedAnyway || false,
          },
          conversation: turns,
        });
      } catch (err) {
        console.error("[Debug] Transcript failed:", err.message);
        sendError(reply, 500, "DEBUG_ERROR", err.message);
      }
    });

    // POST /debug/story/full-round — Run the REAL writer pipeline (LLM calls)
    // Tests the complete algorithm: scoring + fact extraction + anti-repetition + tone + question targeting
    // This creates a real DB session. Use for testing the full guidance experience.
    app.post("/debug/story/full-round", async (request, reply) => {
      const { message, occasion, recipient_name, session_id } = request.body || {};

      if (!message) {
        sendError(reply, 400, "MISSING_INPUT", "message is required.");
        return;
      }

      // Get userId through the auth system (same as other endpoints)
      const userId = await requireUserId(request, reply);
      if (!userId) return;

      try {
        let result;
        let storyId = session_id;

        if (!storyId) {
          // First round — start a new story session
          result = await writer.startStory({
            user_id: userId,
            recipient_name: recipient_name || "someone",
            occasion: occasion || "birthday",
            initial_prompt: message,
          });
          storyId = result.story_id || result.session_id || result.id;
        } else {
          // Continue an existing session
          result = await writer.continueStory({
            story_id: storyId,
            answer: message,
          });
        }

        // Now fetch the full state to get Labov analysis
        const state = await writer.getStoryState(storyId);
        const labovAnalysis = state
          ? computeLabovGapAnalysis(state, {
              occasion: state.event?.occasion || occasion || "birthday",
              turnCount: state.turn_count || 1,
            })
          : null;
        const storyState = state ? extractStoryState(state) : null;
        const elements = labovAnalysis ? computeStoryElements(labovAnalysis) : [];
        const questionPriority = labovAnalysis ? computeQuestionPriority(labovAnalysis) : null;
        const questionStage = getQuestionStage(state?.turn_count || 1);

        reply.send({
          session_id: storyId,
          turn_count: state?.turn_count || 1,
          // The AI's actual response (the guidance the user sees)
          ai_response: {
            question: result.next_question || result.question || result.first_question || null,
            narrative: result.narrative || null,
            action: result.action || null,
            complete: result.complete || false,
            ready_for_confirmation: result.ready_for_confirmation || false,
            can_proceed_anyway: result.can_proceed_anyway || false,
            suggestions: result.suggestions || [],
          },
          // Labov scoring
          labov: labovAnalysis ? {
            elements: labovAnalysis.labov?.elements || [],
            weighted_score: labovAnalysis.labov?.weightedScore || 0,
            is_ready: labovAnalysis.isStoryReady,
            can_proceed_anyway: labovAnalysis.canProceedAnyway || false,
          } : null,
          display_elements: elements,
          // Question targeting (what the algo decided to ask about)
          question_targeting: {
            priority: questionPriority,
            stage: questionStage,
            emotional_intensity: detectEmotionalIntensity(message),
          },
          // Fact tracking (anti-repetition state)
          fact_tracking: {
            known_facts: storyState?.labov || {},
            sensory_details: storyState?.sensoryDetails || [],
            questions_asked: storyState?.questionsAsked || [],
          },
        });
      } catch (err) {
        console.error("[Debug] Full-round failed:", err.message);
        sendError(reply, 500, "DEBUG_ERROR", err.message);
      }
    });

    console.log("[Debug] Story debug endpoints registered: /debug/story/:id/state, /debug/story/simulate, /debug/story/full-round, /debug/story/:id/transcript");
  }
}

module.exports = { registerStoryRoutes };
