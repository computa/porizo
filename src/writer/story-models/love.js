/**
 * Love/Anniversary Story Arc Model
 *
 * Focus: What made you fall, what makes them irreplaceable
 *
 * This model defines the elements needed for a complete love story
 * that will make the receiver feel truly seen and cherished.
 */

/**
 * Required story elements for a love arc
 * Each element has:
 * - id: unique identifier
 * - name: human-readable name
 * - description: what this element captures
 * - priority: how important for this arc (1-10, 10 = essential)
 * - questionHints: guidance for generating questions about this element
 * - anchorWords: words in user answers that suggest this element is present
 */
const STORY_ELEMENTS = {
  setting: {
    id: "setting",
    name: "Setting",
    description: "Where and when the magic happened",
    priority: 8,
    questionHints: [
      "Where did this happen?",
      "What was the place like?",
      "When was this?",
    ],
    anchorWords: ["at", "in", "on", "place", "coffee", "park", "party", "work", "school"],
    exampleQuestion: "Where did you first see {recipient}?",
  },

  first_impression: {
    id: "first_impression",
    name: "First Impression",
    description: "What about THEM caught your attention",
    priority: 10, // Essential for love stories
    questionHints: [
      "What first caught your attention?",
      "What stood out about them?",
      "What drew you to them?",
    ],
    anchorWords: ["noticed", "saw", "looked", "eyes", "smile", "laugh", "voice", "way"],
    exampleQuestion: "What's the first thing you noticed about {recipient}?",
  },

  sensory_anchor: {
    id: "sensory_anchor",
    name: "Sensory Anchor",
    description: "A vivid sensory detail that transports back to the moment",
    priority: 9,
    questionHints: [
      "What did you see/hear/feel?",
      "What do you remember most vividly?",
      "What detail sticks with you?",
    ],
    anchorWords: ["remember", "still", "can", "hear", "see", "feel", "smell", "sound", "light"],
    exampleQuestion: "What do you remember most vividly about that moment?",
    // This element often emerges from digging deeper on first_impression
    canDeriveFrom: ["first_impression"],
  },

  emotional_moment: {
    id: "emotional_moment",
    name: "Emotional Moment",
    description: "When you KNEW this was different, this was special",
    priority: 10, // Essential - the heart of the story
    questionHints: [
      "When did you know?",
      "What moment made you realize?",
      "When did everything change?",
    ],
    anchorWords: ["knew", "realized", "felt", "moment", "then", "that's when", "changed"],
    exampleQuestion: "When did you know {recipient} was different from everyone else?",
  },

  connection_point: {
    id: "connection_point",
    name: "Connection Point",
    description: "What you shared or did together that bonded you",
    priority: 7,
    questionHints: [
      "What did you do together?",
      "What happened between you?",
      "How did you connect?",
    ],
    anchorWords: ["talked", "laughed", "shared", "together", "both", "we", "hours", "stayed"],
    exampleQuestion: "What happened after you first noticed each other?",
  },

  what_makes_them_special: {
    id: "what_makes_them_special",
    name: "What Makes Them Special",
    description: "Why them and no one else - the receiver-focused truth",
    priority: 10, // Essential - makes the song about THEM
    questionHints: [
      "What makes them different?",
      "Why them?",
      "What quality do you love most?",
    ],
    anchorWords: ["because", "only", "always", "never", "way", "how", "makes", "different"],
    exampleQuestion: "What is it about {recipient} that makes them irreplaceable to you?",
  },
};

/**
 * Element priority order for this arc
 * Questions should generally follow this order, but can adapt based on context
 */
const PRIORITY_ORDER = [
  "setting",
  "first_impression",
  "sensory_anchor",
  "emotional_moment",
  "connection_point",
  "what_makes_them_special",
];

/**
 * Minimum elements needed to consider the story "complete enough"
 */
const MINIMUM_REQUIRED = ["first_impression", "emotional_moment", "what_makes_them_special"];

/**
 * Maximum questions to ask (to avoid fatigue)
 */
const MAX_QUESTIONS = 6;

/**
 * Check if a story context has this element filled
 * @param {Object} storyContext - Current story context
 * @param {string} elementId - Element to check
 * @returns {boolean} Whether element has meaningful content
 */
function hasElement(storyContext, elementId) {
  const value = storyContext.elements?.[elementId];
  return value && value.trim().length > 10; // More than a few words
}

/**
 * Find gaps in the story - elements that are missing or thin
 * @param {Object} storyContext - Current story context
 * @returns {Array} List of missing element IDs, prioritized
 */
function findGaps(storyContext) {
  const gaps = [];

  for (const elementId of PRIORITY_ORDER) {
    if (!hasElement(storyContext, elementId)) {
      gaps.push({
        elementId,
        element: STORY_ELEMENTS[elementId],
        priority: STORY_ELEMENTS[elementId].priority,
      });
    }
  }

  // Sort by priority (highest first)
  gaps.sort((a, b) => b.priority - a.priority);

  return gaps;
}

/**
 * Check if story is complete enough to proceed
 * @param {Object} storyContext - Current story context
 * @returns {Object} { complete: boolean, missingRequired: string[], progress: number }
 */
function isStoryComplete(storyContext) {
  const missingRequired = MINIMUM_REQUIRED.filter(
    (elementId) => !hasElement(storyContext, elementId)
  );

  const filledCount = PRIORITY_ORDER.filter(
    (elementId) => hasElement(storyContext, elementId)
  ).length;

  const progress = Math.round((filledCount / PRIORITY_ORDER.length) * 100);

  // Also check if we've asked enough questions (prevent endless loop)
  const questionCount = storyContext.questionCount || 0;
  const reachedMaxQuestions = questionCount >= MAX_QUESTIONS;

  return {
    complete: missingRequired.length === 0 || reachedMaxQuestions,
    missingRequired,
    progress,
    filledElements: filledCount,
    totalElements: PRIORITY_ORDER.length,
    reachedMaxQuestions,
  };
}

/**
 * Extract anchors from user's answer that might warrant follow-up
 * Only extracts meaningful words that can lead to deeper story details
 * @param {string} answer - User's answer
 * @returns {Array} Detected anchors that could be explored deeper
 */
function extractAnchors(answer) {
  const anchors = [];
  const lowerAnswer = answer.toLowerCase();

  // Only look for truly meaningful sensory words - things we can dig into
  const sensoryIndicators = {
    laugh: "What was it about that laugh?",
    laughing: "What was it about that laugh?",
    smile: "What was it about that smile?",
    smiled: "What was it about that smile?",
    eyes: "What was it about their eyes?",
    voice: "What was it about their voice?",
  };

  for (const [word, followUp] of Object.entries(sensoryIndicators)) {
    // Use word boundary to avoid partial matches
    const regex = new RegExp(`\\b${word}\\b`, "i");
    if (regex.test(lowerAnswer)) {
      anchors.push({
        word,
        type: "sensory",
        followUp,
        element: "sensory_anchor",
      });
      break; // Only one sensory anchor follow-up per answer
    }
  }

  // Only look for emotional turning points
  const emotionalIndicators = {
    knew: "When did you know? What happened in that moment?",
    realized: "What made you realize that?",
    changed: "How did things change after that?",
  };

  for (const [word, followUp] of Object.entries(emotionalIndicators)) {
    const regex = new RegExp(`\\b${word}\\b`, "i");
    if (regex.test(lowerAnswer)) {
      anchors.push({
        word,
        type: "emotional",
        followUp,
        element: "emotional_moment",
      });
      break; // Only one emotional anchor per answer
    }
  }

  // Return max 1 anchor to avoid overwhelming
  return anchors.slice(0, 1);
}

/**
 * Get the arc-specific context for LLM prompts
 */
function getArcContext() {
  return {
    arcName: "love",
    arcDisplayName: "Love Story",
    arcDescription: "A story of connection, attraction, and what makes someone irreplaceable",
    emotionalGoal: "Make the receiver feel deeply seen and cherished",
    toneGuidance: "Warm, intimate, specific rather than generic",
    avoidPhrases: [
      "you mean the world to me",
      "you're amazing",
      "you're the best",
      "I love you so much",
    ],
    seekPhrases: [
      "specific moments",
      "sensory details",
      "what makes them unique",
      "the exact instant you knew",
    ],
  };
}

module.exports = {
  STORY_ELEMENTS,
  PRIORITY_ORDER,
  MINIMUM_REQUIRED,
  MAX_QUESTIONS,
  hasElement,
  findGaps,
  isStoryComplete,
  extractAnchors,
  getArcContext,
};
