/**
 * Porizo Writer Module
 *
 * Story-driven song and poem generation.
 *
 * The soul of Porizo: "Expressing to someone in a song that which is hard to do with words."
 *
 * Usage:
 *
 * 1. Start a story extraction session:
 *    const { story_id, first_question } = await writer.startStory({
 *      initial_prompt: "The first day we met",
 *      occasion: "anniversary",
 *      recipient_name: "Sarah"
 *    });
 *
 * 2. Continue the conversation (iterative Q&A):
 *    const result = await writer.continueStory({ story_id, answer: "At the coffee shop..." });
 *    // result.next_question or result.complete
 *
 * 3. When complete, get summary for confirmation:
 *    const summary = await writer.getStorySummary(story_id);
 *
 * 4. Confirm and generate lyrics:
 *    writer.confirmStory(story_id);
 *    const { lyrics } = await writer.writeSong(story_id);
 */

// Story engine
const v3Engine = require("./v3");

// Songwriter - Lyrics generation from confirmed story
const {
  writeSong,
  writeSongFromContext,
  assessSongReadiness,
} = require("./songwriter");

const { getStyleList } = require("../providers/style-registry");

// Story repository (for session lookups)
let storyRepository = null;
const DEFAULT_STORY_ENGINE_VERSION = "v3";
const SUPPORTED_STORY_ENGINE_VERSIONS = new Set(["v3"]);
const STORY_ENGINE_HANDLERS = {
  v3: {
    initialize: (repository) => v3Engine.initialize(repository),
    startStory: (options) => v3Engine.startStoryV3(options),
    continueStory: (options) => v3Engine.continueStoryV3(options),
    reviseStory: (storyId, revisionRequest, options) => v3Engine.reviseStoryV3(storyId, revisionRequest, options),
    getStoryContext: (storyId, options) => v3Engine.getStoryContextV3(storyId, options),
    getStorySession: (storyId) => v3Engine.getStorySessionV3(storyId),
    updateStoryStyle: (storyId, style) => v3Engine.updateStoryStyleV3(storyId, style),
    prepareStoryReview: (storyId) => v3Engine.prepareStoryReviewV3(storyId),
    confirmStory: (storyId, options) => v3Engine.confirmStoryV3(storyId, options),
  },
};

function normalizeStoryEngineVersion(value, fallback = DEFAULT_STORY_ENGINE_VERSION) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return SUPPORTED_STORY_ENGINE_VERSIONS.has(normalized) ? normalized : fallback;
}

function getStoryEngineHandler(engineVersion) {
  const normalizedVersion = normalizeStoryEngineVersion(engineVersion, DEFAULT_STORY_ENGINE_VERSION);
  return {
    engineVersion: normalizedVersion,
    handler: STORY_ENGINE_HANDLERS[normalizedVersion] || STORY_ENGINE_HANDLERS[DEFAULT_STORY_ENGINE_VERSION],
  };
}

function mapDraftMetadataFields(result) {
  return {
    draft_lifecycle: result.draftLifecycle || null,
    fact_inventory: result.factInventory || [],
    open_conflicts: result.openConflicts || [],
    revision_history: result.revisionHistory || [],
    draft_diff: result.draftDiff || null,
    pending_revision: result.pendingRevision || null,
    story_provenance: result.storyProvenance || null,
  };
}

function mapAnalysisFields(result) {
  return {
    readiness: result.readiness || null,
    target_slot: result.targetSlot || null,
    gap_reason: result.gapReason || null,
    slot_guidance: result.slotGuidance || null,
    missing_slots: result.missingSlots || [],
    weak_slots: result.weakSlots || [],
    readiness_score: typeof result.readinessScore === "number" ? result.readinessScore : 0,
    is_story_ready: Boolean(result.isStoryReady),
    can_proceed_anyway: Boolean(result.canProceedAnyway),
    narrative_version: typeof result.narrativeVersion === "number" ? result.narrativeVersion : 0,
    integration_delta: result.integrationDelta || null,
    story_elements: result.storyElements || [],
  };
}

async function getSessionEngineVersion(storyId, fallback = DEFAULT_STORY_ENGINE_VERSION) {
  if (!storyRepository || !storyId) {
    return normalizeStoryEngineVersion(null, fallback);
  }

  try {
    const session = await storyRepository.getSession(storyId);
    return normalizeStoryEngineVersion(session?.engineVersion, fallback);
  } catch (err) {
    console.warn("[Writer] Failed to read session engine version; using fallback.", {
      storyId,
      fallback,
      error: err.message,
    });
    return normalizeStoryEngineVersion(null, fallback);
  }
}

/**
 * Start a story extraction session
 *
 * @param {Object} options
 * @param {string} options.initial_prompt - User's initial story prompt
 * @param {string} options.occasion - The occasion (birthday, anniversary, etc.)
 * @param {string} options.recipient_name - Who the song is for
 * @param {string} options.style - Music style preference
 * @param {string} options.user_id - User ID for session tracking
 * @returns {Promise<Object>} Session with first question
 */
async function startStory(options) {
  const { engineVersion: requestedEngineVersion, handler: engineHandler } = getStoryEngineHandler(
    options.engine_version || options.engineVersion
  );
  const result = await engineHandler.startStory({
    userId: options.user_id,
    recipientName: options.recipient_name,
    occasion: options.occasion || "custom",
    initialPrompt: options.initial_prompt,
    style: options.style || null,
    engineVersion: requestedEngineVersion,
  });

  // Map runtime response to API format
  const isComplete = result.action === "CONFIRM" || result.action === "STOP";
  return {
    story_id: result.sessionId,
    first_question: result.question,
    complete: isComplete,
    ready_for_confirmation: isComplete,
    action: result.action || null,
    confirmation_message: isComplete ? result.question : null,
    narrative: result.narrative || null,
    arc: result.narrative ? "unified" : options.occasion,
    arc_display_name: "Story Collection",
    recipient_name: options.recipient_name,
    engine_version: normalizeStoryEngineVersion(
      result.engineVersion || result.engine_version,
      requestedEngineVersion
    ),
    completion_score: result.completionScore,
    fallback: result.fallback,
    suggestions: result.suggestions || [],
    ...mapAnalysisFields(result),
    ...mapDraftMetadataFields(result),
  };
}

/**
 * Continue a story session with user's answer
 *
 * @param {Object} options
 * @param {string} options.story_id - Session ID
 * @param {string} options.answer - User's answer
 * @returns {Promise<Object>} Next question or completion status
 */
async function continueStory(options) {
  const { story_id, answer } = options;
  const sessionEngineVersion = await getSessionEngineVersion(
    story_id,
    normalizeStoryEngineVersion(options.engine_version || options.engineVersion, DEFAULT_STORY_ENGINE_VERSION)
  );
  const { handler: engineHandler } = getStoryEngineHandler(sessionEngineVersion);

  const result = await engineHandler.continueStory({
    sessionId: story_id,
    answer,
    expectedSessionVersion: options.expected_session_version,
  });

  // Check if ready for confirmation
  const isComplete = result.action === "CONFIRM" || result.action === "STOP";

  return {
    complete: isComplete,
    next_question: isComplete ? null : result.question,
    story_summary: isComplete ? result.narrative : null,
    narrative: result.narrative,
    soul_of_story: isComplete ? result.narrative : null,
    progress: result.completionScore,
    questions_asked: result.turnCount,
    engine_version: normalizeStoryEngineVersion(
      result.engineVersion || result.engine_version,
      sessionEngineVersion
    ),
    action: result.action,
    fallback: result.fallback,
    suggestions: result.suggestions || [],
    ...mapAnalysisFields(result),
    ...mapDraftMetadataFields(result),
  };
}

/**
 * Get story summary for confirmation
 *
 * @param {string} storyId - Session ID
 * @returns {Promise<Object>} Story summary
 */
async function getStorySummary(storyId) {
  const sessionEngineVersion = await getSessionEngineVersion(storyId, DEFAULT_STORY_ENGINE_VERSION);
  const { handler: engineHandler } = getStoryEngineHandler(sessionEngineVersion);
  const context = await engineHandler.getStoryContext(storyId);
  return {
    story_id: storyId,
    summary_text: context.narrative,
    soul_of_story: context.narrative,
    facts: context.facts,
    beats_covered: context.beats?.filter(b =>
      b.status === "covered" || (typeof b.strength === "number" && b.strength >= 0.7)
    ).length || 0,
    completion_score: context.completionScore,
    engine_version: normalizeStoryEngineVersion(
      context.engineVersion || context.engine_version,
      sessionEngineVersion
    ),
  };
}

/**
 * Confirm story and mark ready for lyrics
 *
 * @param {string} storyId - Session ID
 * @returns {Promise<Object>} Confirmation result
 */
async function confirmStory(storyId, additionalNotesOrOptions) {
  const sessionEngineVersion = await getSessionEngineVersion(storyId, DEFAULT_STORY_ENGINE_VERSION);
  const { handler: engineHandler } = getStoryEngineHandler(sessionEngineVersion);
  const options = additionalNotesOrOptions && typeof additionalNotesOrOptions === "object"
    ? additionalNotesOrOptions
    : { additionalNotes: additionalNotesOrOptions };
  const normalizedNotes = typeof options.additionalNotes === "string" ? options.additionalNotes.trim() : "";
  const forceConfirm = options.forceConfirm === true;
  const targetContentType = typeof options.targetContentType === "string"
    ? options.targetContentType.trim().toLowerCase()
    : "";

  if (normalizedNotes) {
    const revisionResult = await engineHandler.reviseStory(storyId, normalizedNotes, {
      source: "confirm_notes",
      operation: {
        type: "final_notes",
        target_type: "narrative",
      },
    });
    if (revisionResult.action !== "CONFIRM" && revisionResult.action !== "STOP") {
      const followUp = revisionResult.question || "Your final edit needs one more clarification before confirmation.";
      const err = new Error(followUp);
      err.code = "STORY_REVISION_CLARIFY_REQUIRED";
      throw err;
    }
  }

  if (targetContentType === "song") {
    const storyContext = await engineHandler.getStoryContext(storyId, {
      includeReadiness: false,
      includeMetadata: false,
    });
    const songReadiness = assessSongReadiness({
      recipient_name: storyContext.recipientName,
      occasion: storyContext.occasion,
      style: storyContext.style,
      initial_prompt: storyContext.initialPrompt,
      narrative: storyContext.narrative,
      summary: storyContext.summary,
      facts: storyContext.facts,
      elements: storyContext.elements,
      beats: storyContext.beats,
      atoms: storyContext.atoms,
      primitives: storyContext.primitives,
      motifs: storyContext.motifs,
      song_map: storyContext.song_map,
      evaluation: storyContext.evaluation,
      dials: storyContext.dials,
      completed_story_package: storyContext.completed_story_package,
    });
    if (!songReadiness.ready) {
      const question = songReadiness.follow_up_question ||
        "Before I make this a song, give me one more concrete detail that must not be lost.";
      const err = new Error(question);
      err.code = "STORY_NEEDS_INPUT";
      err.question = question;
      err.suggestions = songReadiness.suggestions || [];
      err.missingBlocks = (songReadiness.blockers || []).map((blocker) => blocker.code || blocker.message).filter(Boolean);
      err.songReadiness = songReadiness;
      throw err;
    }
  }

  const result = await engineHandler.confirmStory(storyId, {
    additionalNotes: normalizedNotes || undefined,
    forceConfirm,
  });
  return {
    story_id: storyId,
    confirmed: true,
    narrative: result.narrative,
    completion_score: result.completionScore,
    engine_version: normalizeStoryEngineVersion(
      result.engineVersion || result.engine_version,
      sessionEngineVersion
    ),
    narrative_version: typeof result.narrativeVersion === "number" ? result.narrativeVersion : 0,
    readiness: result.readiness || null,
    story_elements: result.storyElements || [],
    ...mapDraftMetadataFields(result),
  };
}

async function reviseStory(storyId, revisionRequest, options = {}) {
  const sessionEngineVersion = await getSessionEngineVersion(storyId, DEFAULT_STORY_ENGINE_VERSION);
  const { handler: engineHandler } = getStoryEngineHandler(sessionEngineVersion);
  const result = await engineHandler.reviseStory(storyId, revisionRequest, options);
  const isComplete = result.action === "CONFIRM" || result.action === "STOP";

  return {
    complete: isComplete,
    next_question: isComplete ? null : result.question,
    story_summary: isComplete ? result.narrative : null,
    narrative: result.narrative,
    soul_of_story: isComplete ? result.narrative : null,
    progress: result.completionScore,
    questions_asked: result.turnCount,
    engine_version: normalizeStoryEngineVersion(
      result.engineVersion || result.engine_version,
      sessionEngineVersion
    ),
    action: result.action,
    fallback: result.fallback,
    suggestions: result.suggestions || [],
    ...mapAnalysisFields(result),
    revision_request: result.revisionRequest || null,
    ...mapDraftMetadataFields(result),
  };
}

async function prepareStoryReview(storyId) {
  const sessionEngineVersion = await getSessionEngineVersion(storyId, DEFAULT_STORY_ENGINE_VERSION);
  const { handler: engineHandler } = getStoryEngineHandler(sessionEngineVersion);
  const result = await engineHandler.prepareStoryReview(storyId);

  return {
    complete: true,
    next_question: null,
    story_summary: result.narrative,
    narrative: result.narrative,
    soul_of_story: result.narrative,
    progress: result.completionScore,
    questions_asked: result.turnCount,
    ready_for_confirmation: true,
    action: "CONFIRM",
    suggestions: [],
    ...mapAnalysisFields(result),
    ...mapDraftMetadataFields(result),
  };
}

/**
 * Get story context for lyrics generation
 *
 * @param {string} storyId - Session ID
 * @returns {Promise<Object>} Story context
 */
async function getStoryContext(storyId, options) {
  const sessionEngineVersion = await getSessionEngineVersion(storyId, DEFAULT_STORY_ENGINE_VERSION);
  const { handler: engineHandler } = getStoryEngineHandler(sessionEngineVersion);
  return engineHandler.getStoryContext(storyId, options);
}

/**
 * Add more details to a story after seeing summary
 *
 * @param {string} storyId - Session ID
 * @param {string} detail - Additional detail to add
 * @returns {Promise<Object>} Updated story state
 */
async function addMoreDetails(storyId, detail) {
  const sessionEngineVersion = await getSessionEngineVersion(storyId, DEFAULT_STORY_ENGINE_VERSION);
  const { handler: engineHandler } = getStoryEngineHandler(sessionEngineVersion);
  const result = await engineHandler.continueStory({
    sessionId: storyId,
    answer: detail,
  });

  // Transform to match iOS continue story response format
  const isComplete = result.action === "CONFIRM" || result.action === "STOP";

  return {
    complete: isComplete,
    next_question: isComplete ? null : result.question,
    story_summary: isComplete ? result.narrative : null,
    narrative: result.narrative,
    soul_of_story: isComplete ? result.narrative : null,
    progress: result.completionScore,
    questions_asked: result.turnCount,
    engine_version: normalizeStoryEngineVersion(
      result.engineVersion || result.engine_version,
      sessionEngineVersion
    ),
    action: result.action,
    fallback: result.fallback,
    suggestions: result.suggestions || [],
    ...mapAnalysisFields(result),
    ...mapDraftMetadataFields(result),
  };
}

/**
 * Cancel a story session
 *
 * @param {string} storyId - Session ID
 */
function cancelStory(_storyId) {
  // V2 sessions are cleaned up automatically or can be abandoned
  // No explicit cleanup needed for in-memory sessions
}

/**
 * Cleanup old sessions (called periodically)
 *
 * @param {number} maxAgeHours - Max session age in hours (default: 24)
 * @returns {number} Number of sessions expired
 */
function cleanupOldSessions(maxAgeHours = 24) {
  if (!storyRepository) {
    console.warn("[Writer] Cannot cleanup sessions: repository not initialized");
    return 0;
  }

  const expiredCount = storyRepository.expireStaleSessions(maxAgeHours);
  if (expiredCount > 0) {
    console.log(`[Writer] Expired ${expiredCount} stale session(s)`);
  }
  return expiredCount;
}

/**
 * Initialize writer module with repository
 *
 * @param {Object} repository - Story repository instance
 */
function initWithRepository(repository) {
  storyRepository = repository;
  v3Engine.initialize(repository);
  console.log("[Writer] Initialized with repository (V3 story runtime ready)");
}

/**
 * Get the current story session state for resume
 *
 * @param {string} storyId - Session ID
 * @returns {Promise<Object>} Story state snapshot
 */
async function getStoryState(storyId) {
  const sessionEngineVersion = await getSessionEngineVersion(storyId, DEFAULT_STORY_ENGINE_VERSION);
  const { handler: engineHandler } = getStoryEngineHandler(sessionEngineVersion);
  return engineHandler.getStorySession(storyId);
}

async function updateStoryStyle(storyId, style) {
  const sessionEngineVersion = await getSessionEngineVersion(storyId, DEFAULT_STORY_ENGINE_VERSION);
  const { handler: engineHandler } = getStoryEngineHandler(sessionEngineVersion);
  if (typeof engineHandler.updateStoryStyle !== "function") {
    throw new Error(`Story engine ${sessionEngineVersion} does not support style updates`);
  }
  return engineHandler.updateStoryStyle(storyId, style);
}

/**
 * List active story sessions for a user
 *
 * @param {string} userId - User ID
 * @returns {Array<Object>} Active sessions
 */
function listActiveStorySessions(userId) {
  if (!storyRepository) {
    throw new Error("Story repository not initialized");
  }
  const sessions = storyRepository.getActiveSessionsForUser(userId);
  return sessions.map((session) => ({
    story_id: session.id,
    engine_version: normalizeStoryEngineVersion(
      session.engineVersion || session.engine_version,
      DEFAULT_STORY_ENGINE_VERSION
    ),
    status: session.status,
    occasion: session.occasion,
    recipient_name: session.recipientName,
    updated_at: session.updatedAt,
    created_at: session.createdAt,
  }));
}

/**
 * Quick lyrics generation (bypasses story extraction)
 * For backwards compatibility or when story is already complete
 *
 * @param {Object} options
 * @param {string} options.recipient_name - Who the song is for
 * @param {string} options.message - The core message/story
 * @param {string} options.occasion - The occasion
 * @param {string} options.style - Music style
 * @returns {Promise<Object>} { lyrics, quality_score }
 */
async function quickGenerate({ recipient_name, message, occasion, style }) {
  return writeSongFromContext({
    recipient_name,
    message,
    occasion: occasion || "celebration",
    style: style || "pop",
    initial_prompt: message,
    elements: {
      initial: message,
    },
    summary: {
      soul: message,
      summary_text: message,
    },
  });
}

/**
 * Get supported music styles as a structured list.
 * @returns {Array<{key: string, displayName: string, energy: string, category: string}>}
 */
function getStyles() {
  return getStyleList();
}

/**
 * Get supported occasions with their info
 * @returns {Object} Map of occasion to details
 */
function getOccasions() {
  // Story occasions used by the V3 collection flow
  return {
    birthday: {
      arc: "celebration",
      displayName: "Birthday",
      description: "Celebrate their special day",
      emotionalGoal: "Make them feel celebrated and loved",
    },
    anniversary: {
      arc: "love",
      displayName: "Anniversary",
      description: "Celebrate your journey together",
      emotionalGoal: "Relive the moments that matter",
    },
    thank_you: {
      arc: "gratitude",
      displayName: "Thank You",
      description: "Express heartfelt gratitude",
      emotionalGoal: "Show deep appreciation",
    },
    i_love_you: {
      arc: "love",
      displayName: "I Love You",
      description: "Express your love",
      emotionalGoal: "Capture your unique love story",
    },
    wedding: {
      arc: "love",
      displayName: "Wedding",
      description: "Celebrate the union",
      emotionalGoal: "Honor the journey to this moment",
    },
    graduation: {
      arc: "celebration",
      displayName: "Graduation",
      description: "Celebrate their achievement",
      emotionalGoal: "Mark this milestone",
    },
    celebration: {
      arc: "celebration",
      displayName: "Celebration",
      description: "General celebration",
      emotionalGoal: "Make them feel special",
    },
    apology: {
      arc: "gratitude",
      displayName: "Apology",
      description: "Express sincere apology",
      emotionalGoal: "Show genuine remorse and care",
    },
    encouragement: {
      arc: "gratitude",
      displayName: "Encouragement",
      description: "Lift them up",
      emotionalGoal: "Inspire and support",
    },
    advice: {
      arc: "gratitude",
      displayName: "Advice",
      description: "Share guidance for their next chapter",
      emotionalGoal: "Offer wisdom with care and clarity",
    },
    bereavement: {
      arc: "love",
      displayName: "Bereavement",
      description: "Offer comfort during loss",
      emotionalGoal: "Honor memory and provide gentle support",
    },
    custom: {
      arc: "celebration",
      displayName: "Custom",
      description: "Your own occasion",
      emotionalGoal: "Express what matters to you",
    },
  };
}

/**
 * Health check for the writer module
 * @returns {Object} Status information
 */
function getStatus() {
  return {
    available: true,
    version: "3.0.0",
    story_engine_versions: Array.from(SUPPORTED_STORY_ENGINE_VERSIONS),
    features: [
      "unified_reasoning_engine",
      "v3_runtime_dispatch",
      "dynamic_story_extraction",
      "story_confirmation",
      "story_aware_lyrics",
    ],
    arcs: ["celebration", "love", "gratitude"],
    styles: getStyleList().length,
    occasions: Object.keys(getOccasions()).length,
  };
}

// Export public API
module.exports = {
  // Story Extraction (Primary Flow)
  startStory,
  continueStory,
  getStorySummary,
  confirmStory,
  prepareStoryReview,
  reviseStory,
  addMoreDetails,
  cancelStory,
  getStoryState,
  updateStoryStyle,
  listActiveStorySessions,

  // Lyrics Generation
  writeSong,
  quickGenerate,

  // Utilities
  getStoryContext,
  getStyles,
  getOccasions,
  getStatus,
  cleanupOldSessions,
  initWithRepository,

};
