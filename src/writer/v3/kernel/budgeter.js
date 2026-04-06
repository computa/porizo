const { createStageBudgetResult } = require("./types");

const DEFAULT_STAGE_BUDGETS = {
  ingest: 1800,
  question_compose: 900,
  confirm_compose: 700,
  story_compose: 2200,
};

function estimateTextTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

function buildBudgetedPrompt({ stage, blocks, budgetTokens }) {
  const limit = Number.isFinite(Number(budgetTokens))
    ? Number(budgetTokens)
    : (DEFAULT_STAGE_BUDGETS[stage] || 1200);
  const normalizedBlocks = Array.isArray(blocks) ? blocks : [];
  const includedBlocks = [];
  const droppedBlocks = [];
  let totalEstimatedTokens = 0;

  const ordered = [
    ...normalizedBlocks.filter((block) => block?.required),
    ...normalizedBlocks
      .filter((block) => !block?.required)
      .sort((a, b) => Number(b?.priority || 0) - Number(a?.priority || 0)),
  ];

  for (const block of ordered) {
    const text = typeof block?.text === "string" ? block.text.trim() : "";
    if (!text) continue;
    const estimatedTokens = estimateTextTokens(text);
    const projectedTotal = totalEstimatedTokens + estimatedTokens;
    const metadata = {
      id: block.id || "block",
      estimatedTokens,
      priority: Number(block.priority || 0),
      required: Boolean(block.required),
    };
    if (!block.required && projectedTotal > limit) {
      droppedBlocks.push(metadata);
      continue;
    }
    includedBlocks.push({ ...metadata, text });
    totalEstimatedTokens = projectedTotal;
  }

  return createStageBudgetResult({
    stage,
    budgetTokens: limit,
    totalEstimatedTokens,
    includedBlocks: includedBlocks.map(({ text: _text, ...meta }) => meta),
    droppedBlocks,
    prompt: includedBlocks.map((block) => block.text).join("\n\n"),
  });
}

module.exports = {
  DEFAULT_STAGE_BUDGETS,
  estimateTextTokens,
  buildBudgetedPrompt,
};
