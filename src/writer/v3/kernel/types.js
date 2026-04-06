/**
 * Writer V3 kernel contracts.
 *
 * These are intentionally lightweight runtime-normalized shapes rather than a
 * full schema framework so they can be introduced without destabilizing the
 * existing runtime.
 */

const TURN_ACTIONS = new Set(["ASK", "CLARIFY", "CONFIRM", "STOP", "CREATE"]);

function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function clampConfidence(value, fallback = 0.5) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function createPlannerCandidate(input = {}) {
  return {
    element: normalizeOptionalString(input.element),
    score: Number.isFinite(Number(input.score)) ? Number(input.score) : 0,
    reason: normalizeOptionalString(input.reason) || "",
    reasons: Array.isArray(input.reasons)
      ? input.reasons.map((reason) => normalizeOptionalString(reason)).filter(Boolean)
      : [],
    weight: Number.isFinite(Number(input.weight)) ? Number(input.weight) : 0,
    currentStrength: Number.isFinite(Number(input.currentStrength)) ? Number(input.currentStrength) : 0,
    missingSlotCount: Number.isFinite(Number(input.missingSlotCount)) ? Number(input.missingSlotCount) : 0,
    weakSlotCount: Number.isFinite(Number(input.weakSlotCount)) ? Number(input.weakSlotCount) : 0,
    answeredCount: Number.isFinite(Number(input.answeredCount)) ? Number(input.answeredCount) : 0,
    substantiveAnswerCount: Number.isFinite(Number(input.substantiveAnswerCount)) ? Number(input.substantiveAnswerCount) : 0,
    sufficientAnswerCount: Number.isFinite(Number(input.sufficientAnswerCount)) ? Number(input.sufficientAnswerCount) : 0,
    bestSlot: normalizeOptionalString(input.bestSlot),
    bestSlotState: normalizeOptionalString(input.bestSlotState),
    lastAnsweredRound: Number.isFinite(Number(input.lastAnsweredRound)) ? Number(input.lastAnsweredRound) : 0,
  };
}

function createTurnDecision(input = {}) {
  const action = normalizeOptionalString(input.action) || "ASK";
  return {
    action: TURN_ACTIONS.has(action) ? action : "ASK",
    targetElement: normalizeOptionalString(input.targetElement),
    targetSlot: normalizeOptionalString(input.targetSlot),
    reason: normalizeOptionalString(input.reason) || "",
    alternatives: Array.isArray(input.alternatives)
      ? input.alternatives.map((candidate) => createPlannerCandidate(candidate))
      : [],
    confidence: clampConfidence(input.confidence),
    source: normalizeOptionalString(input.source) || "unknown",
  };
}

function createTurnDelta(input = {}) {
  const updates = input.updates && typeof input.updates === "object" ? input.updates : {};
  return {
    updates: {
      new_facts: Array.isArray(updates.new_facts) ? updates.new_facts : [],
      atoms: updates.atoms && typeof updates.atoms === "object" && !Array.isArray(updates.atoms) ? updates.atoms : {},
      primitives: updates.primitives && typeof updates.primitives === "object" && !Array.isArray(updates.primitives) ? updates.primitives : {},
      motifs: Array.isArray(updates.motifs) ? updates.motifs : [],
      dials: updates.dials && typeof updates.dials === "object" && !Array.isArray(updates.dials) ? updates.dials : {},
      evaluation: updates.evaluation && typeof updates.evaluation === "object" && !Array.isArray(updates.evaluation) ? updates.evaluation : null,
    },
    reasoning: input.reasoning && typeof input.reasoning === "object" ? input.reasoning : {},
    narrative: normalizeOptionalString(input.narrative),
    narrative_mode: normalizeOptionalString(input.narrative_mode),
    fallback: Boolean(input.fallback),
    stageTelemetry: input.stageTelemetry && typeof input.stageTelemetry === "object" ? input.stageTelemetry : null,
  };
}

function createStageProjection(input = {}) {
  return input && typeof input === "object" ? { ...input } : {};
}

function createStageBudgetResult(input = {}) {
  return {
    stage: normalizeOptionalString(input.stage) || "unknown",
    budgetTokens: Number.isFinite(Number(input.budgetTokens)) ? Number(input.budgetTokens) : 0,
    totalEstimatedTokens: Number.isFinite(Number(input.totalEstimatedTokens)) ? Number(input.totalEstimatedTokens) : 0,
    includedBlocks: Array.isArray(input.includedBlocks) ? input.includedBlocks : [],
    droppedBlocks: Array.isArray(input.droppedBlocks) ? input.droppedBlocks : [],
    prompt: typeof input.prompt === "string" ? input.prompt : "",
  };
}

module.exports = {
  TURN_ACTIONS,
  createPlannerCandidate,
  createTurnDecision,
  createTurnDelta,
  createStageProjection,
  createStageBudgetResult,
};
