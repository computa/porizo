/**
 * Story Model Selector
 *
 * Maps occasions to the appropriate story arc model.
 * The arc determines WHICH details we extract from the user's story.
 */

const loveModel = require("./love");
const gratitudeModel = require("./gratitude");
const celebrationModel = require("./celebration");

/**
 * Map occasions to their story arc
 */
const OCCASION_TO_ARC = {
  // Love arc - focus on connection, attraction, what makes them irreplaceable
  anniversary: "love",
  valentines: "love",
  wedding: "love",
  proposal: "love",
  love: "love",

  // Gratitude arc - focus on what they DID and how it changed things
  thank_you: "gratitude",
  appreciation: "gratitude",
  farewell: "gratitude",
  retirement: "gratitude",
  mentor: "gratitude",

  // Celebration arc - focus on who they ARE, their journey
  birthday: "celebration",
  graduation: "celebration",
  achievement: "celebration",
  promotion: "celebration",
  new_job: "celebration",
  new_baby: "celebration",
  celebration: "celebration",
  milestone: "celebration",
};

/**
 * Arc models
 */
const ARC_MODELS = {
  love: loveModel,
  gratitude: gratitudeModel,
  celebration: celebrationModel,
};

/**
 * Get the story model for an occasion
 * @param {string} occasion - The occasion (e.g., "birthday", "anniversary", "thank_you")
 * @returns {Object} The appropriate story model
 */
function getModelForOccasion(occasion) {
  const normalizedOccasion = (occasion || "").toLowerCase().replace(/[^a-z_]/g, "_");
  const arcName = OCCASION_TO_ARC[normalizedOccasion] || "celebration"; // Default to celebration
  return {
    arc: arcName,
    model: ARC_MODELS[arcName],
  };
}

/**
 * Get story model by arc name directly
 * @param {string} arcName - The arc name (love, gratitude, celebration)
 * @returns {Object} The story model
 */
function getModelByArc(arcName) {
  return ARC_MODELS[arcName] || ARC_MODELS.celebration;
}

/**
 * Get all supported occasions
 * @returns {Object} Map of occasion to arc
 */
function getSupportedOccasions() {
  return { ...OCCASION_TO_ARC };
}

/**
 * Get all arc names
 * @returns {Array} List of arc names
 */
function getArcNames() {
  return Object.keys(ARC_MODELS);
}

module.exports = {
  getModelForOccasion,
  getModelByArc,
  getSupportedOccasions,
  getArcNames,
  OCCASION_TO_ARC,
  ARC_MODELS,
};
