const test = require("node:test");
const assert = require("node:assert/strict");

const {
  narrativeNeedsPovAlignment,
  rewriteNarrativeToRecipientFocus,
} = require("../../../src/writer/v3/narrative");
const { applyReasoningResult } = require("../../../src/writer/v3/engine");
const { createInitialState } = require("../../../src/writer/v3/state");

test("narrativeNeedsPovAlignment flags writer-centric voice for recipient mode", () => {
  const narrative = "I fought through hard years and my family depended on me.";
  assert.equal(narrativeNeedsPovAlignment(narrative, "Osita", "recipient"), true);
});

test("rewriteNarrativeToRecipientFocus rewrites I/my pronouns to recipient", () => {
  const rewritten = rewriteNarrativeToRecipientFocus(
    "I hustled for good grades and my family depended on me.",
    "Osita"
  );

  assert.match(rewritten, /\bOsita\b/);
  assert.match(rewritten, /\bOsita's family\b/);
  assert.doesNotMatch(rewritten, /\bmy\b/i);
  assert.doesNotMatch(rewritten, /\bI\b/);
});

test("applyReasoningResult enforces recipient-focused rewrite by default", () => {
  const state = createInitialState({
    recipientName: "Osita",
    occasion: "custom",
    initialPrompt: "Story seed",
  });

  const next = applyReasoningResult(
    state,
    {
      action: "ASK",
      updates: {
        narrative: "I hustled for good grades and my family depended on me.",
        narrative_mode: "rewritten",
      },
      new_facts: [
        { text: "Osita hustled for good grades.", beat: "moment" },
      ],
    },
    "Osita hustled for good grades."
  );

  assert.ok(typeof next.narrative === "string" && next.narrative.length > 0);
  assert.match(next.narrative, /\bOsita\b/);
  assert.doesNotMatch(next.narrative, /\bmy\b/i);
  assert.doesNotMatch(next.narrative, /\b(i|me|my|mine|we|our|us)\b/i);
});
