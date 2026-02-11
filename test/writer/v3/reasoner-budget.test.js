const test = require("node:test");
const assert = require("node:assert/strict");

const { createInitialState } = require("../../../src/writer/v3/state");
const {
  buildReasoningPrompt,
  buildPromptWithinBudget,
  estimatePromptTokens,
  reason,
} = require("../../../src/writer/v3/reasoner");

function buildLargeState() {
  const state = createInitialState({
    recipientName: "Emeka",
    occasion: "bereavement",
    initialPrompt: "I want this song to hold all the details that matter.",
  });

  state.narrative = Array.from({ length: 40 })
    .map((_, i) => `Sentence ${i + 1}: we remember the hallway light, the scent of soap, and the quiet promise we made.`)
    .join(" ");
  state.narrative_current = state.narrative;

  state.facts = Array.from({ length: 50 }).map((_, i) => ({
    id: `f_${i + 1}`,
    text: `Fact ${i + 1}: We stood in Lagos hospital corridor section ${i + 1} and repeated one promise to each other.`,
    beat: "moment",
    status: "active",
    source_turn: i + 1,
  }));

  state.conversation = Array.from({ length: 50 }).map((_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `Turn ${i + 1} with extra detail about fear, courage, and timing in the story arc.`,
  }));

  return state;
}

test("buildPromptWithinBudget compacts large single-stage prompts under token budget", () => {
  const state = buildLargeState();
  const userInput = "He squeezed my hand again and said we could survive this night.";

  const prompt = buildPromptWithinBudget("single", (limits) =>
    buildReasoningPrompt(state, userInput, limits)
  );
  const estimatedTokens = estimatePromptTokens(prompt);

  assert.ok(estimatedTokens <= 3300, `expected <= 3300 tokens, got ~${estimatedTokens}`);
  assert.match(prompt, /Conversation trimmed/i);
  assert.match(prompt, /fact\(s\) omitted/i);
});

test("reason() with injected model uses compacted prompt for oversized context", async () => {
  const state = buildLargeState();
  const userInput = "It happened near the elevator right before visiting hours ended.";

  let capturedPrompt = "";
  const mockGenerate = async ({ prompt }) => {
    capturedPrompt = prompt;
    return {
      text: JSON.stringify({
        action: "ASK",
        question: "What did that moment change for you?",
        updates: {
          narrative_mode: "rewritten",
          narrative:
            "I still see the elevator lights in that corridor, and when visiting hours ended, I knew we had to hold each other through the fear.",
        },
      }),
    };
  };

  const result = await reason(state, userInput, {
    _generateTextFn: mockGenerate,
    maxRetries: 0,
  });

  assert.equal(result.success, true);
  const estimatedTokens = estimatePromptTokens(capturedPrompt);
  assert.ok(estimatedTokens <= 3300, `expected <= 3300 tokens, got ~${estimatedTokens}`);
});
