/**
 * V2 Monitoring Module
 *
 * Provides observability into the reasoning system without affecting behavior.
 * Detects anomalies and calculates health scores for monitoring dashboards.
 *
 * Philosophy: Observe and report, don't override.
 * The safety module handles interventions; this module handles visibility.
 */

/**
 * Thresholds for anomaly detection.
 * These are observation thresholds, not intervention triggers.
 */
const ANOMALY_THRESHOLDS = {
  /** Turns above this warrant attention (below safety max of 20) */
  highTurnThreshold: 10,

  /** Expected content per turn (facts + narrative chars / 100) */
  minContentPerTurn: 0.5,

  /** Consecutive same-beat asks before flagging as stuck */
  stuckThreshold: 3,

  /** Approaching max turns warning threshold */
  approachingMaxTurns: 17,

  /** Recent history window for stuck detection */
  recentHistoryWindow: 4,
};

/**
 * Calculates a content density score.
 * Higher is better - more content gathered relative to effort.
 *
 * @param {Object} state - Current conversation state
 * @returns {number} Content density (0-1 scale, higher = more efficient)
 */
function calculateContentDensity(state) {
  const factCount = state.facts?.length || 0;
  const narrativeLength = state.narrative?.length || 0;
  const turnCount = Math.max(state.turn_count || 1, 1);

  // Weight: each fact = 1 point, each 100 chars of narrative = 0.5 points
  const contentPoints = factCount + narrativeLength / 200;

  // Expected: at least 0.5 content points per turn
  const expectedContent = turnCount * ANOMALY_THRESHOLDS.minContentPerTurn;

  if (expectedContent === 0) return 1;

  return Math.min(contentPoints / expectedContent, 1);
}

/**
 * Checks for anomalies in the conversation state.
 * Returns a list of detected anomalies with severity levels.
 *
 * @param {Object} state - Current conversation state
 * @returns {Array<{type: string, severity: 'info'|'warning'|'critical', message: string}>}
 */
function checkForAnomalies(state) {
  const anomalies = [];
  const turnCount = state.turn_count || 0;
  const factCount = state.facts?.length || 0;
  const narrativeLength = state.narrative?.length || 0;

  // Check: High turn count with low content
  if (turnCount >= ANOMALY_THRESHOLDS.highTurnThreshold) {
    const density = calculateContentDensity(state);
    if (density < 0.4) {
      anomalies.push({
        type: "high_turn_low_content",
        severity: density < 0.2 ? "critical" : "warning",
        message: `Turn ${turnCount} with low content density (${(density * 100).toFixed(0)}%)`,
      });
    }
  }

  // Check: Very low content ratio (regardless of turn count)
  if (turnCount >= 5 && factCount === 0 && narrativeLength < 20) {
    anomalies.push({
      type: "low_content_ratio",
      severity: "warning",
      message: `Turn ${turnCount} with no facts and minimal narrative`,
    });
  }

  // Check: Approaching maximum turns
  if (turnCount >= ANOMALY_THRESHOLDS.approachingMaxTurns) {
    anomalies.push({
      type: "approaching_max_turns",
      severity: turnCount >= 19 ? "critical" : "warning",
      message: `Turn ${turnCount} approaching max (20)`,
    });
  }

  return anomalies;
}

/**
 * Detects if the conversation is stuck on a particular beat.
 * A stuck pattern occurs when the same beat is targeted multiple times
 * in recent history without progress.
 *
 * @param {Array<{action: string, beat_target?: string}>} history - Decision history
 * @returns {{isStuck: boolean, stuckOn?: string, count?: number}}
 */
function detectStuckPattern(history) {
  if (!history || history.length < ANOMALY_THRESHOLDS.stuckThreshold) {
    return { isStuck: false };
  }

  // Only consider recent history
  const recentWindow = ANOMALY_THRESHOLDS.recentHistoryWindow;
  const recent = history.slice(-recentWindow);

  // Filter to ASK actions only (CLARIFY breaks the pattern)
  const recentAsks = [];
  for (const entry of recent) {
    if (entry.action === "ASK" && entry.beat_target) {
      recentAsks.push(entry.beat_target);
    } else if (entry.action === "CLARIFY") {
      // CLARIFY breaks any stuck pattern - reset
      recentAsks.length = 0;
    }
  }

  if (recentAsks.length < ANOMALY_THRESHOLDS.stuckThreshold) {
    return { isStuck: false };
  }

  // Check if all recent asks target the same beat
  const targetBeat = recentAsks[recentAsks.length - 1];
  const consecutiveCount = recentAsks.filter((b) => b === targetBeat).length;

  if (consecutiveCount >= ANOMALY_THRESHOLDS.stuckThreshold) {
    return {
      isStuck: true,
      stuckOn: targetBeat,
      count: consecutiveCount,
    };
  }

  return { isStuck: false };
}

/**
 * Calculates an overall health score for the conversation.
 * Useful for dashboards and alerting.
 *
 * @param {Object} state - Current conversation state
 * @returns {number} Health score 0-100 (higher = healthier)
 */
function calculateHealthScore(state) {
  const turnCount = state.turn_count || 0;
  const factCount = state.facts?.length || 0;
  const narrativeLength = state.narrative?.length || 0;
  const beats = state.beats || [];

  // Component 1: Content richness (0-40 points)
  // Target: 4+ facts, 100+ chars narrative
  const factScore = Math.min(factCount / 4, 1) * 20;
  const narrativeScore = Math.min(narrativeLength / 100, 1) * 20;
  const contentScore = factScore + narrativeScore;

  // Component 2: Beat coverage (0-30 points)
  // Average strength across beats
  let beatScore = 0;
  if (beats.length > 0) {
    const avgStrength =
      beats.reduce((sum, b) => sum + (b.strength || 0), 0) / beats.length;
    beatScore = avgStrength * 30;
  }

  // Component 3: Efficiency (0-30 points)
  // Penalize high turns with low content
  const density = calculateContentDensity(state);
  let efficiencyScore = density * 30;

  // Extra penalty for very high turn counts
  if (turnCount > 10) {
    const turnPenalty = Math.min((turnCount - 10) * 3, 20);
    efficiencyScore = Math.max(efficiencyScore - turnPenalty, 0);
  }

  const total = contentScore + beatScore + efficiencyScore;

  // Clamp to 0-100
  return Math.max(0, Math.min(100, Math.round(total)));
}

module.exports = {
  ANOMALY_THRESHOLDS,
  checkForAnomalies,
  detectStuckPattern,
  calculateHealthScore,
};
