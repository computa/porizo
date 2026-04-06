const test = require("node:test");
const assert = require("node:assert/strict");

const { createInitialState } = require("../../../src/writer/v3/state");
const {
  buildReasoningPrompt,
  buildWriterStagePrompt,
  buildPromptWithinBudget,
  estimatePromptTokens,
  reason,
} = require("../../../src/writer/v3/reasoner");
const { buildConversationHistory } = require("../../../src/writer/v3/prompts/builder");

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
    buildReasoningPrompt(state, userInput, {
      ...limits,
      promptVariant: "compact",
      conversationMode: "recent",
      currentUserInput: userInput,
      maxNarrativeChars: Math.min(limits.maxNarrativeChars ?? Number.MAX_SAFE_INTEGER, 1800),
      maxFacts: Math.min(limits.maxFacts ?? Number.MAX_SAFE_INTEGER, 12),
      maxFactChars: Math.min(limits.maxFactChars ?? Number.MAX_SAFE_INTEGER, 140),
      maxRetainedDetails: Math.min(limits.maxRetainedDetails ?? Number.MAX_SAFE_INTEGER, 10),
      maxRetainedDetailChars: Math.min(limits.maxRetainedDetailChars ?? Number.MAX_SAFE_INTEGER, 96),
    })
  );
  const estimatedTokens = estimatePromptTokens(prompt);

  assert.ok(estimatedTokens <= 3300, `expected <= 3300 tokens, got ~${estimatedTokens}`);
  assert.match(prompt, /Conversation (trimmed|compressed)/i);
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
            "Emeka still sees the elevator lights in that corridor, and when visiting hours ended, he knew they had to hold each other through the fear.",
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

test("buildConversationHistory recent mode keeps only recent exchange and drops duplicated current input", () => {
  const conversation = [
    { role: "assistant", content: "Tell me about how the hospital hallway felt." },
    { role: "user", content: "It smelled like soap and fear." },
    { role: "assistant", content: "What changed in that moment?" },
    { role: "user", content: "He squeezed my hand again and said we could survive this night." },
  ];

  const history = buildConversationHistory(conversation, {
    conversationMode: "recent",
    currentUserInput: "He squeezed my hand again and said we could survive this night.",
  });

  assert.match(history, /Conversation compressed/i);
  assert.ok(!history.includes("He squeezed my hand again and said we could survive this night."));
  assert.ok(history.includes("What changed in that moment?"));
});

test("buildReasoningPrompt recent mode relies on canonical story plus recent exchange", () => {
  const state = buildLargeState();
  const userInput = "He squeezed my hand again and said we could survive this night.";

  const prompt = buildReasoningPrompt(state, userInput, {
    conversationMode: "recent",
    currentUserInput: userInput,
  });

  assert.match(prompt, /Conversation compressed/i);
  assert.ok(!prompt.includes("Turn 1 with extra detail"));
  assert.ok(prompt.includes("Turn 49 with extra detail") || prompt.includes("Turn 50 with extra detail"));
  assert.match(prompt, /Story so far:/i);
  assert.match(prompt, /User's new input:/i);
});

test("buildWriterStagePrompt drops raw transcript and keeps artifact context", () => {
  const state = buildLargeState();
  const prompt = buildWriterStagePrompt(
    state,
    "He squeezed my hand again and said we could survive this night.",
    { selection: { best_details: ["hospital corridor", "squeezed my hand"] } },
    { outline: { structure: "3-act" } },
    {}
  );

  assert.match(prompt, /Conversation compressed into story\/facts/i);
  assert.ok(!prompt.includes("Turn 1 with extra detail"));
  assert.match(prompt, /Selection output \(JSON\):/i);
  assert.match(prompt, /Outline output \(JSON\):/i);
});
