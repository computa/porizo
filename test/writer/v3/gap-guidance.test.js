const test = require("node:test");
const assert = require("node:assert/strict");

const { createInitialState } = require("../../../src/writer/v3/state");
const {
  computeStoryGapAnalysis,
  pickDeterministicGapQuestion,
  getCriticalConfirmSlotCoverage,
} = require("../../../src/writer/v3/quality");

function buildWeakMomentState() {
  const state = createInitialState({
    recipientName: "Osita",
    occasion: "custom",
    initialPrompt: "seed",
  });
  state.narrative = "In Lagos, we pushed through a hard season.";
  state.narrative_current = state.narrative;
  state.atoms = {
    ...state.atoms,
    where: "Lagos",
    action: "we pushed through a hard season",
    // no time => moment_destination remains weak
  };
  return state;
}

test("critical confirm coverage blocks when moment_destination is weak", () => {
  const state = buildWeakMomentState();
  const gapAnalysis = computeStoryGapAnalysis(state);
  const coverage = getCriticalConfirmSlotCoverage(gapAnalysis);

  assert.equal(coverage.hasBlockingGap, true);
  assert.deepEqual(coverage.blockingSlots, ["moment_destination"]);
});

test("deterministic gap question returns separate slot guidance metadata", () => {
  const state = buildWeakMomentState();
  const gapAnalysis = {
    slots: [
      {
        slot: "moment_destination",
        status: "weak",
        confidence: 0.48,
        reason: "Partial setting is present but the destination moment needs precision.",
        evidence: ["Lagos"],
      },
    ],
    missingSlots: [],
    weakSlots: ["moment_destination"],
  };
  const question = pickDeterministicGapQuestion(gapAnalysis, state);

  assert.ok(question);
  assert.equal(question.targetSlot, "moment_destination");
  assert.equal(question.prompt, "Tell me more about where and when this takes place.");
  assert.ok(question.slotGuidance);
  assert.equal(question.slotGuidance.slot, "moment_destination");
  assert.equal(question.slotGuidance.state, "weak");
  assert.ok(typeof question.slotGuidance.answerTemplate === "string" && question.slotGuidance.answerTemplate.length > 0);
  assert.ok(Array.isArray(question.slotGuidance.examples));
  assert.ok(question.slotGuidance.examples.length > 0);
});
