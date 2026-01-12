/**
 * V2 Quality Checks
 *
 * Evaluates story completeness and determines when to confirm.
 *
 * @module writer/v2/quality
 */

/**
 * Check if story has all required beats covered
 *
 * @param {Object} state - V2 state
 * @returns {boolean} True if all required beats are covered
 */
function isStoryComplete(state) {
  if (!state.beats || state.beats.length === 0) return false;

  const requiredBeats = state.beats.filter(b => b.required);
  return requiredBeats.every(b => b.status === "covered");
}

/**
 * Determine if we should confirm with the user
 *
 * Confirms when:
 * - All required beats are covered, OR
 * - User is fatigued (>=2 signals) AND minimum beats are covered
 *
 * @param {Object} state - V2 state
 * @returns {boolean} True if should confirm
 */
function shouldConfirm(state) {
  if (isStoryComplete(state)) return true;

  const fatigued = state.user_model?.fatigue_signals >= 2;
  if (fatigued && hasMinimumCoverage(state)) {
    return true;
  }

  return false;
}

/**
 * Check if minimum story elements are covered
 *
 * Minimum = scene + at least one of (stakes/turning_point) + meaning
 *
 * @param {Object} state - V2 state
 * @returns {boolean} True if minimum coverage met
 */
function hasMinimumCoverage(state) {
  const covered = state.beats.filter(b =>
    b.status === "covered" || b.status === "weak"
  );
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
 * Get the most important beat to ask about next
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

  // Priority order for beats
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
  isStoryComplete,
  shouldConfirm,
  hasMinimumCoverage,
  getCompletionScore,
  getMissingBeats,
  getNextBeatToAsk,
};
