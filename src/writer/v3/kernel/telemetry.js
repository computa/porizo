function buildBudgetTelemetry(stageResult) {
  if (!stageResult) return null;
  return {
    stage: stageResult.stage,
    budgetTokens: stageResult.budgetTokens,
    totalEstimatedTokens: stageResult.totalEstimatedTokens,
    includedBlocks: Array.isArray(stageResult.includedBlocks)
      ? stageResult.includedBlocks.map((block) => `${block.id}:${block.estimatedTokens}`)
      : [],
    droppedBlocks: Array.isArray(stageResult.droppedBlocks)
      ? stageResult.droppedBlocks.map((block) => `${block.id}:${block.estimatedTokens}`)
      : [],
  };
}

function buildPlannerTelemetry(decision, targetDecision) {
  return {
    action: decision?.action || null,
    source: decision?.source || null,
    targetElement: decision?.targetElement || null,
    targetSlot: decision?.targetSlot || null,
    reason: decision?.reason || null,
    alternatives: Array.isArray(targetDecision?.alternatives)
      ? targetDecision.alternatives.map((candidate) => ({
        element: candidate.element,
        score: candidate.score,
        reason: candidate.reason,
      }))
      : [],
  };
}

module.exports = {
  buildBudgetTelemetry,
  buildPlannerTelemetry,
};
