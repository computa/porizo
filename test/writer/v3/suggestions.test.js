const test = require("node:test");
const assert = require("node:assert/strict");

const v3 = require("../../../src/writer/v3");

test("parseReasoningResponse sanitizes output suggestions", () => {
  const response = JSON.stringify({
    decision: { action: "ASK", question_target_slot: "who" },
    output: {
      question: "Who is this about?",
      suggestions: [
        "  My older brother  ",
        "",
        "My older brother",
        "This suggestion is intentionally made far too long to be rendered as a chip because it goes well beyond the eighty character limit",
        42,
        "My best friend",
      ],
    },
  });

  const parsed = v3.__internal.reasoner.parseReasoningResponse(response);

  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data.suggestions, [
    "My older brother",
    "My best friend",
  ]);
});

test("buildResponseSuggestions prefers aligned llmSuggestions", () => {
  const suggestions = v3.__internal.buildResponseSuggestions({
    action: "ASK",
    occasion: "birthday",
    targetSlot: "moment_destination",
    llmSuggestions: ["When they walked in", "At the restaurant", "That one surprise"],
  });

  assert.deepEqual(suggestions, [
    "When they walked in",
    "At the restaurant",
    "That one surprise",
  ]);
});

test("buildResponseSuggestions uses exact slot fallback for moment_destination", () => {
  const suggestions = v3.__internal.buildResponseSuggestions({
    action: "ASK",
    occasion: "birthday",
    targetSlot: "moment_destination",
    llmSuggestions: [],
  });

  assert.deepEqual(suggestions, [
    "The surprise party we planned",
    "When they blew out the candles",
    "The look on their face when they saw the gift",
  ]);
});

test("getSlotSuggestions returns shared tone fallback when occasion lacks tone entries", () => {
  const suggestions = v3.__internal.engine.getSlotSuggestions("apology", "tone");

  assert.deepEqual(suggestions, [
    "Warm and heartfelt",
    "Honest and a little raw",
    "Playful but still sincere",
  ]);
});

test("getSlotSuggestions normalizes underscore occasion variants", () => {
  const suggestions = v3.__internal.engine.getSlotSuggestions("i_love_you", "want");

  assert.deepEqual(suggestions, [
    "I just wanted to be near them",
    "I hoped this feeling would last",
    "I wanted them to know",
  ]);
});

test("getSlotSuggestions normalizes spaced and apostrophe occasion variants", () => {
  const suggestions = v3.__internal.engine.getSlotSuggestions("Mother's Day", "moment");

  assert.deepEqual(suggestions, [
    "When she comforted me",
    "The advice that changed everything",
    "A tradition we share",
  ]);
});
