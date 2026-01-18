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

// Story Engine V2 - Unified reasoning engine
const v2Engine = require("./v2");

// Songwriter - Lyrics generation from confirmed story
const {
  writeSong,
  writeSongFromContext,
  MUSIC_STYLES,
} = require("./songwriter");

// Story repository (for session lookups)
let storyRepository = null;

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
  const result = await v2Engine.startStoryV2({
    userId: options.user_id,
    recipientName: options.recipient_name,
    occasion: options.occasion || "celebration",
    initialPrompt: options.initial_prompt,
  });

  // Map V2 response to API format
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

  const result = await v2Engine.continueStoryV2({
    sessionId: story_id,
    answer,
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
    engine_version: "v2",
    action: result.action,
    fallback: result.fallback,
  };
}

/**
 * Get story summary for confirmation
 *
 * @param {string} storyId - Session ID
 * @returns {Promise<Object>} Story summary
 */
async function getStorySummary(storyId) {
  const context = await v2Engine.getStoryContextV2(storyId);
  return {
    story_id: storyId,
    summary_text: context.narrative,
    soul_of_story: context.narrative,
    facts: context.facts,
    beats_covered: context.beats?.filter(b =>
      b.status === "covered" || (typeof b.strength === "number" && b.strength >= 0.6)
    ).length || 0,
    completion_score: context.completionScore,
    engine_version: "v2",
  };
}

/**
 * Confirm story and mark ready for lyrics
 *
 * @param {string} storyId - Session ID
 * @returns {Promise<Object>} Confirmation result
 */
async function confirmStory(storyId) {
  const result = await v2Engine.confirmStoryV2(storyId);
  return {
    story_id: storyId,
    confirmed: true,
    narrative: result.narrative,
    completion_score: result.completionScore,
    engine_version: "v2",
  };
}

/**
 * Get story context for lyrics generation
 *
 * @param {string} storyId - Session ID
 * @returns {Promise<Object>} Story context
 */
async function getStoryContext(storyId) {
  return v2Engine.getStoryContextV2(storyId);
}

/**
 * Add more details to a story after seeing summary
 *
 * @param {string} storyId - Session ID
 * @param {string} detail - Additional detail to add
 * @returns {Promise<Object>} Updated story state
 */
async function addMoreDetails(storyId, detail) {
  // V2 engine handles this through continueStoryV2
  return v2Engine.continueStoryV2({
    sessionId: storyId,
    answer: detail,
  });
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

  // Initialize V2 engine
  v2Engine.initialize(repository);

  console.log("[Writer] Initialized with repository (V2 engine ready)");
}

/**
 * Get the current story session state for resume
 *
 * @param {string} storyId - Session ID
 * @returns {Promise<Object>} Story state snapshot
 */
async function getStoryState(storyId) {
  return v2Engine.getStorySessionV2(storyId);
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
    engine_version: session.engineVersion || "v2",
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
 * Get supported music styles
 * @returns {Object} Map of style key to display name
 */
function getStyles() {
  return { ...MUSIC_STYLES };
}

/**
 * Get supported occasions with their info
 * @returns {Object} Map of occasion to details
 */
function getOccasions() {
  // V2 occasions - simplified from arc-based model
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
    version: "2.0.0",
    features: [
      "unified_reasoning_engine",
      "dynamic_story_extraction",
      "story_confirmation",
      "story_aware_lyrics",
    ],
    arcs: ["celebration", "love", "gratitude"],
    styles: Object.keys(MUSIC_STYLES).length,
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
  addMoreDetails,
  cancelStory,
  getStoryState,
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

  // Constants
  MUSIC_STYLES,
};
