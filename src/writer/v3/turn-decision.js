const { createTurnDecision } = require("./kernel/types");

// Assemble the canonical return shape for resolveTurnDecision.
// Keeps all analytics fields present for downstream consumers (telemetry, iOS, tests).
function buildDecisionResult({
  adjustedResponse,
  ctx,
  decisionSource,
  llmSuggestions = [],
  forcedGapQuestion = false,
  forcedConfirm = false,
  targetElement = null,
  targetDecision = null,
  repeatEscapeApplied = false,
}) {
  const {
    gapAnalysis,
    gapQuestion,
    elements,
    elementBlock,
    hardElementBlock,
    llmReadySignal,
    hybridReady,
    hardCriticalBlock,
    criticalCoverage,
    hardSemanticBlock,
  } = ctx;
  const turnDecision = createTurnDecision({
    action: adjustedResponse?.action,
    targetElement,
    targetSlot: adjustedResponse?.targetSlot || gapQuestion?.targetSlot || null,
    reason: targetDecision?.winner?.reason || decisionSource,
    alternatives: targetDecision?.alternatives || [],
    confidence: adjustedResponse?.action === "CONFIRM" ? 0.85 : 0.7,
    source: decisionSource,
  });
  return {
    response: adjustedResponse,
    turnDecision,
    gapAnalysis,
    gapQuestion,
    forcedGapQuestion,
    forcedConfirm,
    repeatEscapeApplied,
    decisionSource,
    targetElement,
    targetDecision,
    llmSuggestions,
    llmReadySignal,
    hybridReady,
    criticalSlotBlock: hardCriticalBlock,
    criticalBlockingSlots: criticalCoverage.blockingSlots,
    elements,
    elementBlock: hardElementBlock,
    blockedElements: elementBlock.blockedElements,
    semanticBlock: hardSemanticBlock,
    semanticBlockSignature: ctx._semanticBlockSignature || null,
  };
}

module.exports = {
  buildDecisionResult,
};
