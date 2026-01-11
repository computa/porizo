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

// Story Engine - Dynamic Q&A conversation
const {
  startStory,
  continueStory,
  getStorySummary,
  confirmStory,
  getStoryContext,
  addMoreDetails,
  cancelStory,
  cleanupOldSessions,
  initWithRepository,
  SESSION_STATES,
} = require("./story-engine");

// Songwriter - Lyrics generation from confirmed story
const {
  writeSong,
  writeSongFromContext,
  MUSIC_STYLES,
} = require("./songwriter");

// Story Models - Arc definitions
const {
  getModelForOccasion,
  getModelByArc,
  getSupportedOccasions,
  getArcNames,
} = require("./story-models");

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
    version: "2.0.0",
    features: [
      "dynamic_story_extraction",
      "arc_based_questioning",
      "story_confirmation",
      "story_aware_lyrics",
    ],
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
