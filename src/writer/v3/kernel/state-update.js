const { composeNarrativeFromFacts, getActiveFacts } = require("../narrative");
const { applyReasoningResult, enforceGrounding } = require("../engine");

function getCanonicalNarrative(state) {
  if (!state || typeof state !== "object") return "";
  return state.narrative_current || state.narrative || "";
}

function ensureNarrativeAfterStateUpdate(state) {
  if (!getCanonicalNarrative(state) && getActiveFacts(state.facts || []).length > 0) {
    const recomposed = composeNarrativeFromFacts(state);
    if (recomposed) {
      return {
        ...state,
        narrative: recomposed,
        narrative_current: recomposed,
      };
    }
  }
  return state;
}

function applyTurnStateUpdate(state, reasoningPayload, normalizedAnswer) {
  return ensureNarrativeAfterStateUpdate(
    enforceGrounding(
      applyReasoningResult(state, reasoningPayload, normalizedAnswer)
    )
  );
}

module.exports = {
  ensureNarrativeAfterStateUpdate,
  applyTurnStateUpdate,
};
