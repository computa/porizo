/**
 * V3 Beat Generation
 *
 * Dynamic beat schema generation based on event type.
 * Beats are story elements that capture specific emotional moments.
 *
 * @module writer/v3/beats
 */

/**
 * Default beats used for any event type
 */
const DEFAULT_BEATS = [
  { id: "scene", purpose: "where and when it happened", required: true },
  { id: "stakes", purpose: "what was at risk or what mattered", required: true },
  { id: "turning_point", purpose: "the pivotal moment", required: true },
  { id: "meaning", purpose: "what it means now / why it matters", required: true },
  { id: "sensory", purpose: "a specific sensory detail", required: false },
];

/**
 * Event-specific beat schemas
 */
const EVENT_BEATS = {
  birth: [
    { id: "discovery", purpose: "finding out about the pregnancy", required: true },
    { id: "scare", purpose: "moment of fear or tension", required: false },
    { id: "turning_point", purpose: "the pivotal moment (hearing heartbeat, etc.)", required: true },
    { id: "challenges", purpose: "struggles during pregnancy/journey", required: false },
    { id: "birth_moment", purpose: "the moment of birth / meeting them", required: true },
    { id: "first_hold", purpose: "first time holding them", required: false },
    { id: "meaning", purpose: "what they mean to you / hopes for them", required: true },
  ],

  loss: [
    { id: "relationship", purpose: "who they were to you", required: true },
    { id: "memory", purpose: "a defining memory of them", required: true },
    { id: "character", purpose: "what made them special", required: true },
    { id: "last_moment", purpose: "a meaningful last interaction", required: false },
    { id: "legacy", purpose: "what they taught you / how they changed you", required: false },
    { id: "meaning", purpose: "what they still mean to you", required: true },
  ],

  illness: [
    { id: "diagnosis", purpose: "finding out about the illness", required: false },
    { id: "struggle", purpose: "the hardest moment", required: true },
    { id: "support", purpose: "who was there / how you supported each other", required: false },
    { id: "turning_point", purpose: "moment of hope or change", required: true },
    { id: "strength", purpose: "what kept you/them going", required: true },
    { id: "meaning", purpose: "what this journey taught you", required: true },
  ],

  anniversary: [
    { id: "meeting", purpose: "how you met", required: true },
    { id: "first_impression", purpose: "what you first noticed about them", required: false },
    { id: "falling", purpose: "when you knew you loved them", required: true },
    { id: "challenges", purpose: "what you've overcome together", required: false },
    { id: "moment", purpose: "a defining moment in your relationship", required: true },
    { id: "meaning", purpose: "what they mean to you now", required: true },
  ],

  birthday: [
    { id: "who", purpose: "who this person is to you", required: true },
    { id: "memory", purpose: "a favorite memory with them", required: true },
    { id: "character", purpose: "what makes them special", required: true },
    { id: "moment", purpose: "a specific moment that captures them", required: false },
    { id: "wish", purpose: "what you wish for them", required: false },
    { id: "meaning", purpose: "what they mean to you", required: true },
  ],

  celebration: [
    { id: "achievement", purpose: "what is being celebrated", required: true },
    { id: "journey", purpose: "the path to get here", required: false },
    { id: "struggle", purpose: "challenges overcome", required: false },
    { id: "moment", purpose: "the defining moment of success", required: true },
    { id: "supporters", purpose: "who helped along the way", required: false },
    { id: "meaning", purpose: "what this achievement means", required: true },
  ],

  gratitude: [
    { id: "who", purpose: "who you're thanking", required: true },
    { id: "what", purpose: "what they did", required: true },
    { id: "impact", purpose: "how it affected you", required: true },
    { id: "moment", purpose: "a specific moment of their kindness", required: false },
    { id: "meaning", purpose: "what they mean to you", required: true },
  ],

  farewell: [
    { id: "relationship", purpose: "your connection with them", required: true },
    { id: "memory", purpose: "a favorite shared memory", required: true },
    { id: "impact", purpose: "how they changed you", required: false },
    { id: "wish", purpose: "what you wish for their future", required: true },
    { id: "meaning", purpose: "what they mean to you", required: true },
  ],
};

/**
 * Generate beats appropriate for an event type
 *
 * For "custom" event type, returns empty array to let LLM generate
 * story-specific beats. For known event types, returns template beats
 * which can be overridden by LLM.
 *
 * @param {Object} event - Event information
 * @param {string} event.type - Event type (birth, loss, anniversary, custom, etc.)
 * @param {string} event.title - Event title
 * @returns {Array} Array of beat objects with strength and evidence
 */
function generateBeatsForEvent(event) {
  const type = normalizeEventType(event.type);

  // For "custom" event type, return empty array
  // LLM will generate story-specific beats from scratch
  if (type === "custom") {
    return [];
  }

  const baseBeats = EVENT_BEATS[type] || DEFAULT_BEATS;

  // Initialize all beats with strength 0 and empty evidence
  // Note: Using strength (0-1) instead of categorical status
  // LLM determines strength; harness only validates structure
  return baseBeats.map(beat => ({
    ...beat,
    strength: 0, // 0.0-1.0 scale, LLM determines
    evidence: [], // Fact IDs supporting this beat
  }));
}

/**
 * Derive categorical status from strength for backward compatibility
 *
 * This allows existing code that uses status to work with new strength-based beats.
 * Thresholds:
 * - 0.0 - 0.29: missing
 * - 0.3 - 0.59: weak
 * - 0.6 - 1.0: covered
 *
 * @param {number} strength - Numeric strength (0-1)
 * @returns {string} Categorical status: "missing" | "weak" | "covered"
 */
function getStatusFromStrength(strength) {
  // Handle edge cases: undefined, null, NaN, negative
  if (strength === undefined || strength === null || Number.isNaN(strength) || strength < 0) {
    return "missing";
  }
  if (strength >= 0.6) {
    return "covered";
  }
  if (strength >= 0.3) {
    return "weak";
  }
  return "missing";
}

/**
 * Normalize event type to known category
 *
 * @param {string} type - Raw event type
 * @returns {string} Normalized event type
 */
function normalizeEventType(type) {
  if (!type) return "default";

  const normalized = type.toLowerCase().trim();

  // Map common variations to canonical types
  const typeMap = {
    "birth": "birth",
    "baby": "birth",
    "pregnancy": "birth",
    "twins": "birth",
    "newborn": "birth",

    "death": "loss",
    "loss": "loss",
    "passing": "loss",
    "memorial": "loss",
    "funeral": "loss",
    "remembrance": "loss",

    "sick": "illness",
    "illness": "illness",
    "cancer": "illness",
    "recovery": "illness",
    "surgery": "illness",
    "hospital": "illness",

    "anniversary": "anniversary",
    "wedding": "anniversary",
    "engagement": "anniversary",

    "birthday": "birthday",
    "bday": "birthday",

    "celebration": "celebration",
    "achievement": "celebration",
    "graduation": "celebration",
    "promotion": "celebration",

    "gratitude": "gratitude",
    "thank": "gratitude",
    "appreciation": "gratitude",

    "farewell": "farewell",
    "goodbye": "farewell",
    "retirement": "farewell",
    "moving": "farewell",

    // Custom event type - LLM generates story-specific beats
    "custom": "custom",
    "other": "custom",
    "unique": "custom",
  };

  return typeMap[normalized] || "default";
}

/**
 * Get minimum required beats for a complete story
 *
 * @returns {string[]} Array of required beat IDs
 */
function getMinimumRequiredBeats() {
  return ["scene", "stakes", "turning_point", "meaning"];
}

/**
 * Check if beats meet minimum story requirements
 *
 * The minimum story has: scene + stakes + turning_point + meaning
 * But different event types use equivalent beats (e.g., "discovery" = "scene")
 *
 * NOTE: For custom event types with LLM-generated beats, this function
 * may return false because LLM-invented beat IDs (e.g., "career_shift")
 * don't map to the hardcoded equivalents. For custom events, trust the
 * LLM's CONFIRM decision rather than this function.
 *
 * Supports both old status and new strength schema:
 * - status === "covered" OR strength >= 0.6 counts as covered
 *
 * @param {Array} beats - Array of beat objects
 * @returns {boolean} True if minimum requirements are met
 */
function hasMinimumBeats(beats) {
  // Support both old status and new strength schema
  const isCovered = (b) => b.status === "covered" || (typeof b.strength === "number" && b.strength >= 0.6);
  const covered = beats.filter(isCovered).map(b => b.id);

  // Check if we have equivalents for the minimum required
  const hasScene = covered.some(id =>
    ["scene", "meeting", "discovery", "diagnosis", "who", "relationship", "achievement"].includes(id)
  );
  const hasStakes = covered.some(id =>
    ["stakes", "scare", "struggle", "challenges", "what", "impact"].includes(id)
  );
  const hasTurningPoint = covered.some(id =>
    ["turning_point", "moment", "birth_moment", "first_hold", "falling"].includes(id)
  );
  const hasMeaning = covered.includes("meaning");

  return hasScene && hasStakes && hasTurningPoint && hasMeaning;
}

module.exports = {
  DEFAULT_BEATS,
  EVENT_BEATS,
  generateBeatsForEvent,
  getStatusFromStrength,
  normalizeEventType,
  getMinimumRequiredBeats,
  hasMinimumBeats,
};
