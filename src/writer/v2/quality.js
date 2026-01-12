/**
 * V2 Quality Checks
 *
 * V3 Update: Trust LLM decisions. Harness only provides safety bounds.
 * No fatigue threshold overrides. Content-based fallback heuristics.
 *
 * @module writer/v2/quality
 */

/**
 * Safety bounds - the only things the harness can override
 */
const SAFETY_BOUNDS = {
  maxTurns: 20,
};

/**
 * Check if story has all required beats covered
 * Supports both status (legacy) and strength (v3) schemas
 *
 * @param {Object} state - V2 state
 * @returns {boolean} True if all required beats are covered
 */
function isStoryComplete(state) {
  if (!state.beats || state.beats.length === 0) return false;

  const requiredBeats = state.beats.filter(b => b.required);

  // Support both schemas: status === "covered" OR strength >= 0.6
  const isCovered = (b) =>
    b.status === "covered" || (typeof b.strength === "number" && b.strength >= 0.6);

  return requiredBeats.every(isCovered);
}

/**
 * V3: Determine if should confirm - trusts LLM decision with safety bounds
 *
 * @param {Object} state - V2 state
 * @param {Object} llmDecision - LLM's decision { action, confidence }
 * @returns {{shouldConfirm: boolean, source: string, confidence?: number, reason?: string}}
 */
function shouldConfirmFromLLM(state, llmDecision) {
  // Safety bound: force confirm after max turns
  if (state.turn_count >= SAFETY_BOUNDS.maxTurns) {
    return {
      shouldConfirm: true,
      source: "safety_bound",
      reason: `Turn limit (${SAFETY_BOUNDS.maxTurns}) reached`,
    };
  }

  // Trust LLM decision
  const shouldConfirm = llmDecision.action === "CONFIRM" ||
                        llmDecision.action === "STOP";

  return {
    shouldConfirm,
    source: "llm",
    confidence: llmDecision.confidence,
  };
}

/**
 * V3: Fallback confirmation logic when LLM unavailable
 * Content-based, NOT fatigue-based
 *
 * @param {Object} state - V2 state
 * @returns {boolean} True if should confirm
 */
function shouldConfirmFallback(state) {
  // Content-based heuristics
  const hasContent = (state.facts?.length || 0) >= 3;
  const narrativeRich = (state.narrative?.length || 0) > 100;
  const turnsHigh = state.turn_count >= 6;

  return hasContent && narrativeRich && turnsHigh;
}

/**
 * Original shouldConfirm - kept for backward compatibility
 * Now delegates to content-based heuristics (no fatigue threshold)
 *
 * @param {Object} state - V2 state
 * @returns {boolean} True if should confirm
 */
function shouldConfirm(state) {
  if (isStoryComplete(state)) return true;

  // V3: Use content-based fallback heuristics instead of fatigue threshold
  return shouldConfirmFallback(state);
}

/**
 * V3: Get completion assessment from LLM reasoning
 *
 * Uses LLM's holistic story_readiness assessment, not beat counting formula.
 * The LLM evaluates emotional depth and identifies strong/weak elements.
 *
 * @param {Object} llmReasoning - LLM's reasoning output with story_readiness
 * @returns {Object} Completion assessment { hasEmotionalDepth, strongElements, weakElements, score }
 */
function getCompletionFromLLM(llmReasoning) {
  const readiness = llmReasoning?.story_readiness || {};

  // LLM's holistic assessment is primary
  const hasDepth = readiness.has_emotional_depth === true;
  const strongElements = readiness.strong_elements || [];
  const weakElements = readiness.weak_elements || [];
  const strongCount = strongElements.length;

  // Score based on LLM assessment, not formula
  // Priority: emotional depth > strong element count
  let score;
  if (hasDepth && strongCount >= 2) {
    // Great: has depth + multiple strong elements
    score = 80 + Math.min(20, strongCount * 5);
  } else if (hasDepth) {
    // Good: has depth, fewer strong elements
    score = 60 + Math.min(20, strongCount * 5);
  } else if (strongCount >= 2) {
    // Decent: strong elements but no emotional depth
    score = 40 + Math.min(20, strongCount * 5);
  } else {
    // Weak: little content
    score = Math.max(10, strongCount * 15);
  }

  return {
    hasEmotionalDepth: hasDepth,
    strongElements,
    weakElements,
    score: Math.min(100, score),
  };
}

/**
 * Check if minimum story elements are covered (FALLBACK)
 *
 * V3: This is a fallback heuristic for when LLM is unavailable.
 * Prefer getCompletionFromLLM() for holistic assessment.
 *
 * Supports both status (legacy) and strength (v3) schemas.
 * Minimum = scene + at least one of (stakes/turning_point) + meaning
 *
 * @param {Object} state - V2 state
 * @returns {boolean} True if minimum coverage met
 */
function hasMinimumCoverage(state) {
  if (!state.beats || state.beats.length === 0) return false;

  // Support both schemas: status-based OR strength-based
  const isCoveredOrWeak = (b) =>
    b.status === "covered" ||
    b.status === "weak" ||
    (typeof b.strength === "number" && b.strength >= 0.3);

  const covered = state.beats.filter(isCoveredOrWeak);
  const coveredIds = covered.map(b => b.id);

  // Need at least 3 beats covered/weak
  if (covered.length < 3) return false;

  // Need meaning
  const hasMeaning = coveredIds.includes("meaning");
  if (!hasMeaning) return false;

  // Need some scene-like beat
  const sceneBeats = ["scene", "meeting", "discovery", "who", "relationship"];
  const hasScene = sceneBeats.some(id => coveredIds.includes(id));

  // Need some turning point or stakes
  const pivotBeats = ["turning_point", "stakes", "moment", "impact", "struggle"];
  const hasPivot = pivotBeats.some(id => coveredIds.includes(id));

  return hasScene && hasPivot;
}

/**
 * Calculate completion score (0-100)
 *
 * @param {Object} state - V2 state
 * @returns {number} Completion percentage
 */
function getCompletionScore(state) {
  if (!state.beats || state.beats.length === 0) return 0;

  const requiredBeats = state.beats.filter(b => b.required);
  if (requiredBeats.length === 0) return 100;

  let score = 0;
  for (const beat of requiredBeats) {
    if (beat.status === "covered") score += 1;
    else if (beat.status === "weak") score += 0.5;
  }

  return Math.round((score / requiredBeats.length) * 100);
}

/**
 * Get missing or weak required beats, sorted by priority
 *
 * @param {Object} state - V2 state
 * @returns {Array} Array of beats that need attention
 */
function getMissingBeats(state) {
  if (!state.beats || state.beats.length === 0) return [];

  return state.beats
    .filter(b => b.required && (b.status === "missing" || b.status === "weak"))
    .sort((a, b) => {
      // Missing before weak
      if (a.status === "missing" && b.status === "weak") return -1;
      if (a.status === "weak" && b.status === "missing") return 1;
      return 0;
    });
}

/**
 * V3: Get next beat to ask about - follows LLM's contextual assessment
 *
 * Uses the LLM's weak_elements order from story_readiness, not a hardcoded
 * priority array. The LLM understands story context and can prioritize
 * beats that make sense for this specific story.
 *
 * @param {Object} state - V2 state
 * @param {Object} llmReasoning - LLM's reasoning output with story_readiness
 * @returns {Object|null} Next beat to ask about, or null if all covered
 */
function getNextBeatFromLLM(state, llmReasoning) {
  const beats = state?.beats || [];
  if (beats.length === 0) return null;

  const weakElements = llmReasoning?.story_readiness?.weak_elements || [];

  // Helper to check if beat needs work
  const needsWork = (b) => {
    // Strength-based: needs work if < 0.6
    if (typeof b.strength === "number") return b.strength < 0.6;
    // Status-based: needs work if not covered
    return b.status !== "covered";
  };

  // If LLM specified weak elements, follow that order
  if (weakElements.length > 0) {
    for (const weakId of weakElements) {
      const beat = beats.find(b => b.id === weakId);
      if (beat && needsWork(beat)) {
        return beat;
      }
    }
  }

  // Fallback: pick required beat with lowest strength
  const uncovered = beats
    .filter(b => b.required !== false && needsWork(b));

  if (uncovered.length === 0) return null;

  // Sort by strength (lowest first), defaulting to 0 for status-based
  uncovered.sort((a, b) => {
    const aStrength = typeof a.strength === "number" ? a.strength : (a.status === "weak" ? 0.4 : 0);
    const bStrength = typeof b.strength === "number" ? b.strength : (b.status === "weak" ? 0.4 : 0);
    return aStrength - bStrength;
  });

  return uncovered[0];
}

/**
 * Get the most important beat to ask about next (FALLBACK)
 *
 * V3: This is a fallback heuristic for when LLM is unavailable.
 * Prefer getNextBeatFromLLM() for contextual assessment.
 *
 * Prioritizes emotionally important beats first:
 * 1. Turning point / pivotal moment
 * 2. Meaning (core to the song)
 * 3. Scene / foundation
 * 4. Stakes / tension
 *
 * @param {Object} state - V2 state
 * @returns {Object|null} Next beat to ask about, or null if none
 */
function getNextBeatToAsk(state) {
  const missing = getMissingBeats(state);
  if (missing.length === 0) return null;

  // Priority order for beats (fallback only)
  const priorityOrder = [
    "turning_point", "moment", "birth_moment", "falling",  // Most emotionally important
    "meaning",  // Core to the song
    "scene", "meeting", "discovery", "who",  // Foundation
    "stakes", "scare", "struggle",  // Tension
  ];

  // Sort by priority
  missing.sort((a, b) => {
    const aIndex = priorityOrder.indexOf(a.id);
    const bIndex = priorityOrder.indexOf(b.id);
    const aPriority = aIndex === -1 ? 999 : aIndex;
    const bPriority = bIndex === -1 ? 999 : bIndex;
    return aPriority - bPriority;
  });

  return missing[0];
}

module.exports = {
  SAFETY_BOUNDS,
  isStoryComplete,
  shouldConfirm,
  shouldConfirmFromLLM,
  shouldConfirmFallback,
  getCompletionFromLLM,
  hasMinimumCoverage,
  getCompletionScore,
  getMissingBeats,
  getNextBeatFromLLM,
  getNextBeatToAsk,
};
