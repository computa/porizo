const test = require("node:test");
const assert = require("node:assert/strict");

const v3 = require("../../../src/writer/v3");
const { createInitialState } = require("../../../src/writer/v3/state");
const { addTurnToState, applyDeterministicFallbackExtraction } = require("../../../src/writer/v3/engine");
const { computeStoryGapAnalysis, pickDeterministicGapQuestion } = require("../../../src/writer/v3/quality");

const CHIOMA_PROMPT = `Chioma, my Chy, when I think about our family, I think about you. You are hardworking,
dependable, and the one who keeps so much of our home and lives together. From morning to night, you carry responsibilities that are easy to overlook but
impossible to replace. You keep track of appointments, think ahead about what everyone will eat, organise the home, and still manage the demands of work. In
the middle of all the noise and pressure, you keep showing up for all of us.

I see it in the everyday chaos of raising four children, especially in those busy moments when the house is full of competing demands. Yet you bring order,
care, and stability. You do more than manage tasks. You make this house feel like a real home.

I will never forget the high-risk pregnancy of the twins. There was fear, pain, and uncertainty, especially with the bleeding and the constant worry. But you
stayed strong. You followed every instruction, kept every appointment, endured every discomfort, and did everything you could to carry them safely. That was
love in action. That was sacrifice. That was motherhood at its deepest level.

Watching you become a mother has made me love and respect you even more. I knew you as a young girl, but I have watched you grow into a strong woman who rose
to the demands of motherhood with courage and grace. Because of you, our children are growing up in a home filled with warmth, care, and structure.

This Mother's Day, I want you to know that I see you, I appreciate you, and I am deeply grateful for all you do for me, for our children, and for this family.`;

function buildChiomaState() {
  let state = createInitialState({
    recipientName: "Chioma",
    occasion: "mother's day",
    initialPrompt: CHIOMA_PROMPT,
  });

  state = addTurnToState(state, "user", CHIOMA_PROMPT);
  state = applyDeterministicFallbackExtraction(state, CHIOMA_PROMPT);
  return state;
}

test("deterministic fallback extraction captures the Chioma turning-point scene", () => {
  const state = buildChiomaState();

  assert.match(state.atoms.turn, /high-risk pregnancy of the twins/i);
  assert.match(state.primitives.turning_point, /high-risk pregnancy of the twins/i);
});

test("Chioma prompt marks turn covered and avoids the turn fallback question", () => {
  const state = buildChiomaState();
  const gapAnalysis = computeStoryGapAnalysis(state);
  const turnSlot = gapAnalysis.slots.find((slot) => slot.slot === "turn");
  const gapQuestion = pickDeterministicGapQuestion(gapAnalysis);
  const resolution = v3.__internal.resolveTurnDecision(
    { action: "ASK", question: "Tell me more about her.", narrative: "" },
    state
  );

  assert.equal(turnSlot?.status, "covered");
  assert.notEqual(gapQuestion?.targetSlot, "turn");
  assert.notEqual(resolution.gapQuestion?.targetSlot, "turn");
  assert.notEqual(resolution.response.question, "What happened in that moment, and what changed after it?");
});
