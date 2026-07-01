"use strict";

const DEFAULT_COVERED_THRESHOLD = 0.6;

/**
 * Compute the highest-value next question target from Labov gap analysis.
 *
 * Priority = element.weight * (1 - element.strength)
 * Skips elements already sufficiently covered (strength >= 0.6).
 * Skips optional elements (weight <= 0.05) that have any coverage.
 *
 * @param {Object|null} labovAnalysis - Return value of computeLabovGapAnalysis()
 * @param {Object} [options]
 * @param {number} [options.coveredThreshold=0.6]
 * @returns {Object|null} Target with { element, priority, weight, currentStrength, reason }, or null if all covered
 */
function computeQuestionPriority(labovAnalysis, options = {}) {
  if (!labovAnalysis?.labov?.elements) return null;

  const coveredThreshold = Number.isFinite(options.coveredThreshold)
    ? options.coveredThreshold
    : DEFAULT_COVERED_THRESHOLD;
  const elements = labovAnalysis.labov.elements;
  let bestTarget = null;
  let bestPriority = -1;

  for (const el of elements) {
    if (el.strength >= coveredThreshold) continue;
    if (el.weight <= 0.05 && el.strength > 0) continue;

    const priority = el.weight * (1 - el.strength);
    if (priority > bestPriority) {
      bestPriority = priority;
      bestTarget = el;
    }
  }

  return bestTarget
    ? {
        element: bestTarget.element,
        priority: Number(bestPriority.toFixed(3)),
        weight: bestTarget.weight,
        currentStrength: bestTarget.strength,
        reason: `${bestTarget.element} has highest information gain (weight ${bestTarget.weight} \u00d7 gap ${(1 - bestTarget.strength).toFixed(2)} = ${bestPriority.toFixed(3)})`,
      }
    : null;
}

/**
 * Determine the question funnel stage based on conversation turn count.
 *
 * - Turn 0-1: OPEN (broad, inviting questions)
 * - Turn 2: PROBING (build on specifics they mentioned)
 * - Turn 3+: CLOSED (specific detail extraction)
 *
 * @param {number|null|undefined} turnCount - Current turn count
 * @returns {{ stage: string, description: string }}
 */
function getQuestionStage(turnCount) {
  if (!turnCount || turnCount <= 1) {
    return {
      stage: "OPEN",
      description: "Broad, inviting questions. Let them share freely.",
    };
  }
  if (turnCount === 2) {
    return {
      stage: "PROBING",
      description: "Build on specifics they mentioned. Deepen their details.",
    };
  }
  return {
    stage: "CLOSED",
    description: "Specific detail extraction. Fill in vivid details.",
  };
}

const VULNERABILITY_REGEX =
  /\b(breakup|divorce|loss|death|died|funeral|cancer|sick|hospital|depression|anxiety|lonely|scared|crying|tears|grief|heartbreak|betrayal)\b/i;
const INTENSIFIER_REGEX =
  /\b(never forget|always remember|changed everything|meant the world|most important|deeply|truly|absolutely|completely|forever)\b/i;
const FIRST_PERSON_EMOTION_REGEX =
  /\b(i felt|i feel|made me feel|i couldn't|i was so|i cried|i laughed|broke my heart|fills my heart|i knew then)\b/i;

/**
 * Detect emotional intensity from the user's latest message.
 *
 * Counts signal categories (vulnerability, intensifier, first-person emotion).
 * - 0 signals: low
 * - 1 signal: medium
 * - 2+ signals: high
 *
 * @param {string|null} userMessage - The user's latest message
 * @returns {{ intensity: string, signals: string[] }}
 */
function detectEmotionalIntensity(userMessage) {
  if (!userMessage) return { intensity: "low", signals: [] };
  const text = userMessage.toLowerCase();
  const signals = [];

  if (VULNERABILITY_REGEX.test(text)) signals.push("vulnerability");
  if (INTENSIFIER_REGEX.test(text)) signals.push("intensifier");
  if (FIRST_PERSON_EMOTION_REGEX.test(text)) {
    signals.push("first_person_emotion");
  }

  const intensity =
    signals.length >= 2 ? "high" : signals.length === 1 ? "medium" : "low";
  return { intensity, signals };
}

const RELEVANCE_KEYWORDS = {
  orientation:
    /\b(where|when|who|setting|place|time of|day|night|morning|evening|season|year|city|town|house|room|with you|together|at the|around|scene)\b/i,
  complicating_action:
    /\b(what happened|moment|happened|event|then what|what did|how did|turning point|came next|first time|remember when|did .+ (say|do|react)|one time|was there a time|specific time|stands? out|what.s the story|keep coming back)\b/i,
  evaluation:
    /\b(feel\w*|felt|mean\w*|meant|matter\w*|emotion\w*|why .+ (important|special|significant)|what .+ (mean|matter)|heart|soul|cherish|value|love|miss|grateful|proud|bittersweet)\b/i,
  resolution:
    /\b(change\w*|after\b|different|now\b|end\w*|outcome|result|became|turn out|since then|looking back|today|ultimately|in the end|what.s different|how .+ (turn|work) out)\b/i,
};

/**
 * Check if the LLM's generated question actually targets the intended Labov element.
 * Returns true if the question addresses the target, false if it's off-target or generic.
 *
 * @param {string} question - The LLM-generated question
 * @param {string} targetElement - The intended Labov element
 * @returns {boolean}
 */
function validateQuestionRelevance(question, targetElement) {
  if (!question || !targetElement) return false;
  const pattern = RELEVANCE_KEYWORDS[targetElement];
  if (!pattern) return false;
  return pattern.test(question);
}

/**
 * Extract the most salient anchor phrase from the user's message.
 * Prefers proper nouns, named events, and sensory details.
 * Falls back to the first noun phrase of 2+ words.
 *
 * @param {string} text - Raw user message
 * @returns {string|null} The best anchor phrase, or null
 */
function extractAnchor(text) {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed.length < 3) return null;

  const COMMON_STARTERS = new Set([
    "I",
    "It",
    "My",
    "We",
    "He",
    "She",
    "The",
    "They",
    "Our",
    "His",
    "Her",
    "There",
    "This",
    "That",
    "When",
    "After",
    "Before",
    "One",
    "So",
    "But",
    "And",
    "Then",
    "Yeah",
    "Yes",
    "No",
  ]);
  const properNouns = [];
  const sentences = trimmed.split(/[.!?]+/).filter(Boolean);
  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const clean = words[i].replace(/[^a-zA-Z'-]/g, "");
      if (clean.length >= 2 && /^[A-Z]/.test(clean)) {
        if (i === 0 && COMMON_STARTERS.has(clean)) continue;
        let phrase = clean;
        for (let j = i + 1; j < words.length; j++) {
          const next = words[j].replace(/[^a-zA-Z'-]/g, "");
          if (next.length >= 2 && /^[A-Z]/.test(next)) {
            phrase += " " + next;
            i = j;
          } else {
            break;
          }
        }
        properNouns.push(phrase);
      }
    }
  }
  if (properNouns.length > 0) return properNouns[0];

  const specificPatterns = [
    /(?:that|the|my|his|her|our|their)\s+(?:\w+\s+){0,2}(?:morning|evening|night|day|summer|winter|birthday|wedding|ceremony|graduation|funeral|holiday|trip|vacation|Christmas|anniversary)/i,
    /(?:red|blue|green|yellow|white|black|old|little|small|big)\s+\w+/i,
    /(?:at|in|on|by|near)\s+(?:the|a|my|our|his|her)\s+\w+/i,
  ];
  for (const pattern of specificPatterns) {
    const match = trimmed.match(pattern);
    if (match) return match[0].trim();
  }

  const actionMatch = trimmed.match(
    /(?:taught me|showed me|gave me|took me|brought me|made me|told me|called me|carried me|showed up|flew in|stayed up|woke up|drove to|walked to|ran to)\s*(?:\w+(?:\s+\w+)?)?/i,
  );
  if (actionMatch) return actionMatch[0].trim();

  const STOP_WORDS = new Set([
    "the",
    "and",
    "but",
    "for",
    "with",
    "that",
    "this",
    "was",
    "were",
    "been",
    "have",
    "has",
    "had",
    "are",
    "not",
    "its",
    "also",
    "than",
    "just",
    "very",
    "really",
    "yeah",
    "yes",
  ]);
  const contentWords = trimmed.split(/\s+/).filter((w) => {
    const clean = w.replace(/[^a-zA-Z]/g, "").toLowerCase();
    return clean.length >= 3 && !STOP_WORDS.has(clean);
  });
  if (contentWords.length > 0) {
    return contentWords
      .slice(0, Math.min(2, contentWords.length))
      .join(" ")
      .replace(/[^a-zA-Z0-9' -]/g, "");
  }

  return null;
}

const TARGETED_QUESTION_TEMPLATES = {
  orientation: {
    OPEN: [
      "Tell me more about {anchor} -- where were you, and who was there?",
      "{anchor} -- can you paint the scene for me? Where and when was this?",
    ],
    PROBING: [
      "{anchor} -- what was the setting like? What time of day, what was happening around you?",
      "When you think about {anchor}, what do you see around you?",
    ],
    CLOSED: [
      "Was {anchor} during the day or at night?",
      "Were you alone for {anchor}, or was someone with you?",
    ],
  },
  complicating_action: {
    OPEN: [
      "Was there a moment that really stands out with {anchor}?",
      "Tell me about a specific time with {anchor} that you keep coming back to.",
    ],
    PROBING: [
      "{anchor} -- what happened right after that?",
      "The part about {anchor} -- what did they do or say next?",
    ],
    CLOSED: [
      "Did something specific happen with {anchor} that changed the direction of things?",
      "Was there one moment with {anchor} where everything shifted?",
    ],
  },
  evaluation: {
    OPEN: [
      "{anchor} -- what does that mean to you now, looking back?",
      "When you think about {anchor}, what feelings come up?",
    ],
    PROBING: [
      "{anchor} -- why does that matter so much to you?",
      "What is it about {anchor} that stays with you?",
    ],
    CLOSED: [
      "Does {anchor} still feel the same way it did back then?",
      "Is {anchor} something you feel grateful for, or is it more bittersweet?",
    ],
  },
  resolution: {
    OPEN: [
      "After {anchor}, how did things change?",
      "What's different now because of {anchor}?",
    ],
    PROBING: [
      "{anchor} -- what happened in the end? How did it turn out?",
      "Looking back at {anchor}, what changed after that?",
    ],
    CLOSED: [
      "Did {anchor} end the way you expected?",
      "After {anchor}, were things better or just different?",
    ],
  },
};

/**
 * Generate a fallback question that specifically targets the given Labov element,
 * grounded in the user's actual story content. Used when the LLM ignores the
 * question_targeting injection.
 *
 * @param {string} targetElement - The Labov element to target (orientation, complicating_action, evaluation, resolution)
 * @param {Object} state - Story state with facts, conversation, atoms, turn_count
 * @param {string} userMessage - The user's latest message
 * @returns {string|null} A targeted, story-specific question, or null if inputs are invalid
 */
function generateTargetedFallbackQuestion(targetElement, state, userMessage) {
  if (!targetElement || !TARGETED_QUESTION_TEMPLATES[targetElement]) {
    return null;
  }
  if (
    !userMessage ||
    typeof userMessage !== "string" ||
    userMessage.trim().length === 0
  ) {
    return null;
  }

  const turnCount = state?.turn_count ?? 0;
  const { stage } = getQuestionStage(turnCount);

  const wordCount = (userMessage || "").split(/\s+/).filter(Boolean).length;
  let anchor;
  if (wordCount < 5) {
    anchor =
      (state?.atoms?.who || state?.recipient_name || "").split(/\s/)[0] || null;
  }
  if (!anchor) {
    anchor = extractAnchor(userMessage);
  }

  if (!anchor && state?.facts) {
    const activeFacts = (state.facts || []).filter(
      (f) => (f?.status || "active") === "active" && f?.text,
    );
    for (const fact of activeFacts) {
      anchor = extractAnchor(fact.text);
      if (anchor) break;
    }
  }

  if (!anchor) {
    const words = userMessage
      .trim()
      .split(/\s+/)
      .filter((w) => w.length >= 3);
    anchor = words.length > 0 ? words.slice(0, 2).join(" ") : "that";
  }

  const templates = TARGETED_QUESTION_TEMPLATES[targetElement][stage];
  if (!templates || templates.length === 0) return null;
  const templateIndex = turnCount % templates.length;
  const template = templates[templateIndex];

  return template.replace(/\{anchor\}/g, anchor);
}

module.exports = {
  computeQuestionPriority,
  detectEmotionalIntensity,
  generateTargetedFallbackQuestion,
  getQuestionStage,
  validateQuestionRelevance,
};
