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

// Story Engine V1 - Dynamic Q&A conversation
const {
  startStory: startStoryV1,
  continueStory: continueStoryV1,
  getStorySummary: getStorySummaryV1,
  confirmStory: confirmStoryV1,
  getStoryContext: getStoryContextV1,
  addMoreDetails,
  cancelStory,
  cleanupOldSessions,
  initWithRepository: initV1WithRepository,
  SESSION_STATES,
} = require("./story-engine");

// Story Engine V2 - Unified reasoning engine
const v2Engine = require("./v2");

// Session registry to track which engine owns each session
const sessionRegistry = new Map();

// Songwriter - Lyrics generation from confirmed story
const {
  writeSong,
  writeSongFromContext,
  MUSIC_STYLES,
} = require("./songwriter");

// Story Models - Arc definitions
const {
  getModelByArc,
  getSupportedOccasions,
  getArcNames,
} = require("./story-models");

/**
 * Start a story extraction session (version dispatch)
 *
 * @param {Object} options
 * @param {string} options.initial_prompt - User's initial story prompt
 * @param {string} options.occasion - The occasion (birthday, anniversary, etc.)
 * @param {string} options.recipient_name - Who the song is for
 * @param {string} options.style - Music style preference
 * @param {string} options.user_id - User ID for session tracking
 * @param {string} [options.engine_version] - "v1" (default) or "v2" for new reasoning engine
 * @returns {Promise<Object>} Session with first question
 */
async function startStory(options) {
  const engineVersion = options.engine_version || "v1";

  if (engineVersion === "v2") {
    // Use V2 reasoning engine
    const result = await v2Engine.startStoryV2({
      userId: options.user_id,
      recipientName: options.recipient_name,
      occasion: options.occasion || "celebration",
      initialPrompt: options.initial_prompt,
    });

    // Register session with V2 engine
    sessionRegistry.set(result.sessionId, "v2");

    // Map V2 response to V1 format for API compatibility
    return {
      story_id: result.sessionId,
      first_question: result.question,
      arc: result.narrative ? "unified" : options.occasion,
      arc_display_name: "Story Collection",
      recipient_name: options.recipient_name,
      engine_version: "v2",
      completion_score: result.completionScore,
      fallback: result.fallback,
    };
  }

  // Default: Use V1 engine
  const result = await startStoryV1(options);
  sessionRegistry.set(result.story_id, "v1");
  return {
    ...result,
    engine_version: "v1",
  };
}

/**
 * Continue a story session with user's answer (version dispatch)
 *
 * @param {Object} options
 * @param {string} options.story_id - Session ID
 * @param {string} options.answer - User's answer
 * @returns {Promise<Object>} Next question or completion status
 */
async function continueStory(options) {
  const { story_id, answer } = options;
  const engineVersion = sessionRegistry.get(story_id) || "v1";

  if (engineVersion === "v2") {
    const result = await v2Engine.continueStoryV2({
      sessionId: story_id,
      answer,
    });

    // Check if ready for confirmation
    const isComplete = result.action === "CONFIRM";

    return {
      complete: isComplete,
      next_question: isComplete ? null : result.question,
      story_summary: isComplete ? result.narrative : null,
      soul_of_story: isComplete ? result.narrative : null,
      progress: Math.round(result.completionScore * 100),
      questions_asked: result.turnCount,
      engine_version: "v2",
      action: result.action,
      fallback: result.fallback,
    };
  }

  // Default: Use V1 engine
  return continueStoryV1(options);
}

/**
 * Get story summary for confirmation (version dispatch)
 *
 * @param {string} storyId - Session ID
 * @returns {Promise<Object>} Story summary
 */
async function getStorySummary(storyId) {
  const engineVersion = sessionRegistry.get(storyId) || "v1";

  if (engineVersion === "v2") {
    const context = await v2Engine.getStoryContextV2(storyId);
    return {
      story_id: storyId,
      summary_text: context.narrative,
      soul_of_story: context.narrative,
      facts: context.facts,
      beats_covered: context.beats?.filter(b => b.status === "covered").length || 0,
      completion_score: context.completionScore,
      engine_version: "v2",
    };
  }

  // Default: Use V1 engine
  return getStorySummaryV1(storyId);
}

/**
 * Confirm story and mark ready for lyrics (version dispatch)
 *
 * @param {string} storyId - Session ID
 * @returns {Promise<Object>} Confirmation result
 */
async function confirmStory(storyId) {
  const engineVersion = sessionRegistry.get(storyId) || "v1";

  if (engineVersion === "v2") {
    const result = await v2Engine.confirmStoryV2(storyId);
    return {
      story_id: storyId,
      confirmed: true,
      narrative: result.narrative,
      completion_score: result.completionScore,
      engine_version: "v2",
    };
  }

  // Default: Use V1 engine
  return confirmStoryV1(storyId);
}

/**
 * Get story context for lyrics generation (version dispatch)
 *
 * @param {string} storyId - Session ID
 * @returns {Promise<Object>} Story context
 */
async function getStoryContext(storyId) {
  const engineVersion = sessionRegistry.get(storyId) || "v1";

  if (engineVersion === "v2") {
    return v2Engine.getStoryContextV2(storyId);
  }

  // Default: Use V1 engine
  return getStoryContextV1(storyId);
}

/**
 * Initialize writer module with repository
 *
 * @param {Object} repository - Story repository instance
 */
function initWithRepository(repository) {
  // Initialize V1 engine
  initV1WithRepository(repository);

  // Initialize V2 engine
  v2Engine.initialize(repository);

  console.log("[Writer] Initialized with repository (V1 + V2 engines ready)");
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
 * Get supported music styles
 * @returns {Object} Map of style key to display name
 */
function getStyles() {
  return { ...MUSIC_STYLES };
}

/**
 * Get supported occasions with their arc info
 * @returns {Object} Map of occasion to arc details
 */
function getOccasions() {
  const occasions = getSupportedOccasions();
  const result = {};

  for (const [occasion, arcName] of Object.entries(occasions)) {
    const model = getModelByArc(arcName);
    const arcContext = model.getArcContext();
    result[occasion] = {
      arc: arcName,
      displayName: arcContext.arcDisplayName,
      description: arcContext.arcDescription,
      emotionalGoal: arcContext.emotionalGoal,
    };
  }

  return result;
}

/**
 * Health check for the writer module
 * @returns {Object} Status information
 */
function getStatus() {
  return {
    available: true,
    version: "2.1.0",
    features: [
      "dynamic_story_extraction",
      "arc_based_questioning",
      "story_confirmation",
      "story_aware_lyrics",
      "v2_reasoning_engine",
    ],
    engines: {
      v1: "arc-based Q&A",
      v2: "unified reasoning (opt-in via engine_version='v2')",
    },
    arcs: getArcNames(),
    styles: Object.keys(MUSIC_STYLES).length,
    occasions: Object.keys(getSupportedOccasions()).length,
  };
}

// Export public API
module.exports = {
  // Story Extraction (Primary Flow)
  startStory,
  continueStory,
  getStorySummary,
  confirmStory,
  addMoreDetails,
  cancelStory,

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

  // Constants
  MUSIC_STYLES,
  SESSION_STATES,
};
