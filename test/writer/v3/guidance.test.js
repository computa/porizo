const test = require("node:test");
const assert = require("node:assert/strict");

const {
  generateElementGuidance,
  buildGuidancePrompt,
  parseGuidanceResponse,
  buildTemplateFallback,
  findElementDefinition,
} = require("../../../src/writer/v3/guidance");

const { STORY_ELEMENT_DEFINITIONS } = require("../../../src/writer/v3/quality");

// --- Test Fixtures ---

function buildTestState(overrides = {}) {
  return {
    narrative:
      "When I was twelve, Dad took me fishing at Lake Volta. He taught me to tie a bowline knot and we watched the sun set over the water.",
    recipient_name: "Dad",
    occasion: "birthday",
    story_mode: "default",
    facts: [
      {
        text: "went fishing at Lake Volta",
        beat: "moment_destination",
        status: "active",
      },
      {
        text: "taught me to tie a bowline knot",
        beat: "turn",
        status: "active",
      },
    ],
    atoms: {
      moment_destination: "Lake Volta",
      turn: "taught me to tie a bowline knot",
    },
    story_elements: [
      { id: "setting", strength: 0.9 },
      { id: "feeling", strength: 0.3 },
      { id: "bond", strength: 0.5 },
      { id: "moment", strength: 0.8 },
      { id: "details", strength: 0.2 },
    ],
    ...overrides,
  };
}

function makeMockGenerateText(response) {
  return async () => ({ text: JSON.stringify(response) });
}

function makeMockGenerateTextFailing(errorMsg = "LLM unavailable") {
  return async () => {
    throw new Error(errorMsg);
  };
}

// --- generateElementGuidance ---

test("generateElementGuidance returns null for unknown element", async () => {
  const state = buildTestState();
  const result = await generateElementGuidance(state, "nonexistent_element");
  assert.equal(result, null);
});

test("generateElementGuidance returns minimal response for strong element", async () => {
  const state = buildTestState();
  const result = await generateElementGuidance(state, "setting", {
    _generateTextFn: makeMockGenerateText({}),
  });

  assert.equal(result.element_id, "setting");
  assert.equal(result.state, "strong");
  assert.equal(result.diagnosis, null);
  assert.equal(result.suggestion, null);
});

test("generateElementGuidance calls LLM for weak element", async () => {
  const state = buildTestState();
  const mockResponse = {
    diagnosis:
      "The story mentions Dad but doesn't capture the emotional tone of the memory.",
    story_anchor: "taught me to tie a bowline knot",
    suggestion: "How did it feel when Dad taught you that knot?",
    examples: [
      "Maybe it felt like a quiet rite of passage at the lake",
      "Perhaps there was a sense of pride when you finally got the knot right",
    ],
  };

  const result = await generateElementGuidance(state, "feeling", {
    _generateTextFn: makeMockGenerateText(mockResponse),
  });

  assert.equal(result.element_id, "feeling");
  assert.equal(result.element_name, "The Feeling");
  assert.equal(result.state, "weak");
  assert.equal(result.diagnosis, mockResponse.diagnosis);
  assert.equal(result.story_anchor, mockResponse.story_anchor);
  assert.equal(result.suggestion, mockResponse.suggestion);
  assert.equal(result.examples.length, 2);
});

test("generateElementGuidance returns missing state for zero-strength element", async () => {
  const state = buildTestState({
    story_elements: [
      { id: "setting", strength: 0.9 },
      { id: "feeling", strength: 0 },
    ],
  });
  const mockResponse = {
    diagnosis: "No emotional tone has been established.",
    story_anchor: null,
    suggestion: "How do you want someone to feel hearing this story about Dad?",
    examples: ["warm and nostalgic", "proud and inspired"],
  };

  const result = await generateElementGuidance(state, "feeling", {
    _generateTextFn: makeMockGenerateText(mockResponse),
  });

  assert.equal(result.state, "missing");
  assert.equal(result.story_anchor, null);
});

test("generateElementGuidance falls back to template when LLM fails", async () => {
  const state = buildTestState();
  const result = await generateElementGuidance(state, "feeling", {
    _generateTextFn: makeMockGenerateTextFailing(),
  });

  assert.equal(result.element_id, "feeling");
  assert.equal(result.state, "weak");
  assert.ok(result.diagnosis, "should have fallback diagnosis");
  assert.ok(result.suggestion, "should have fallback suggestion");
});

test("generateElementGuidance uses reflective definitions for reflective_tribute mode", async () => {
  const state = buildTestState({ story_mode: "reflective_tribute" });
  const mockResponse = {
    diagnosis: "The tribute doesn't yet capture the emotional core.",
    story_anchor: null,
    suggestion: "What feeling best captures what Dad meant to you?",
    examples: ["deep gratitude", "quiet admiration"],
  };

  const result = await generateElementGuidance(state, "feeling", {
    _generateTextFn: makeMockGenerateText(mockResponse),
  });

  assert.equal(result.element_id, "feeling");
  assert.equal(result.diagnosis, mockResponse.diagnosis);
});

// --- buildGuidancePrompt ---

test("buildGuidancePrompt includes narrative excerpt", () => {
  const state = buildTestState();
  const elementDef = STORY_ELEMENT_DEFINITIONS.find((d) => d.id === "feeling");
  const prompt = buildGuidancePrompt(state, elementDef, "weak");

  assert.ok(prompt.includes("Lake Volta"), "should include narrative content");
  assert.ok(prompt.includes("Dad"), "should include recipient name");
  assert.ok(prompt.includes("birthday"), "should include occasion");
  assert.ok(prompt.includes("The Feeling"), "should include element name");
  // The prompt was redesigned (clinical → warm-friend tone) to NOT echo the
  // raw element state ("weak"/"missing"); it incorporates the element's purpose
  // instead. Assert the purpose, which is the element-definition signal it does use.
  assert.ok(
    prompt.includes(elementDef.purpose),
    "should include element purpose",
  );
});

test("buildGuidancePrompt truncates long narratives", () => {
  const longNarrative = "A".repeat(1000);
  const state = buildTestState({ narrative: longNarrative });
  const elementDef = STORY_ELEMENT_DEFINITIONS.find((d) => d.id === "feeling");
  const prompt = buildGuidancePrompt(state, elementDef, "weak");

  assert.ok(prompt.includes("..."), "should truncate with ellipsis");
  assert.ok(
    !prompt.includes("A".repeat(700)),
    "should not include full 1000-char narrative",
  );
});

test("buildGuidancePrompt handles empty narrative", () => {
  const state = buildTestState({ narrative: "" });
  const elementDef = STORY_ELEMENT_DEFINITIONS.find((d) => d.id === "feeling");
  const prompt = buildGuidancePrompt(state, elementDef, "missing");

  assert.ok(
    prompt.includes("(Just getting started)"),
    "should show placeholder for empty narrative",
  );
});

test("buildGuidancePrompt includes related facts", () => {
  const state = buildTestState({
    facts: [
      { text: "the sunset was golden", beat: "ending_feel", status: "active" },
      { text: "felt peaceful", beat: "ending_feel", status: "active" },
    ],
  });
  const elementDef = STORY_ELEMENT_DEFINITIONS.find((d) => d.id === "feeling");
  const prompt = buildGuidancePrompt(state, elementDef, "weak");

  assert.ok(
    prompt.includes("the sunset was golden"),
    "should include related fact",
  );
  assert.ok(prompt.includes("felt peaceful"), "should include related fact");
});

// --- parseGuidanceResponse ---

test("parseGuidanceResponse parses valid JSON", () => {
  const input = JSON.stringify({
    diagnosis: "The story lacks emotional grounding.",
    story_anchor: "watched the sun set",
    suggestion: "How did that sunset make you feel?",
    examples: ["peaceful", "nostalgic"],
  });

  const result = parseGuidanceResponse(input);
  assert.ok(result);
  assert.equal(result.diagnosis, "The story lacks emotional grounding.");
  assert.equal(result.story_anchor, "watched the sun set");
  assert.equal(result.suggestion, "How did that sunset make you feel?");
  assert.deepEqual(result.examples, ["peaceful", "nostalgic"]);
});

test("parseGuidanceResponse extracts JSON from code blocks", () => {
  const input =
    '```json\n{"diagnosis": "test", "suggestion": "test?", "examples": []}\n```';
  const result = parseGuidanceResponse(input);
  assert.ok(result);
  assert.equal(result.diagnosis, "test");
});

test("parseGuidanceResponse returns null for invalid JSON", () => {
  assert.equal(parseGuidanceResponse("not json at all"), null);
});

test("parseGuidanceResponse returns null when diagnosis missing", () => {
  const input = JSON.stringify({ suggestion: "test?", examples: [] });
  assert.equal(parseGuidanceResponse(input), null);
});

test("parseGuidanceResponse returns null when suggestion missing", () => {
  const input = JSON.stringify({ diagnosis: "test", examples: [] });
  assert.equal(parseGuidanceResponse(input), null);
});

test("parseGuidanceResponse truncates oversized fields", () => {
  const input = JSON.stringify({
    diagnosis: "D".repeat(500),
    story_anchor: "A".repeat(200),
    suggestion: "S".repeat(300),
    examples: ["E".repeat(300), "F".repeat(300), "G".repeat(300)],
  });

  const result = parseGuidanceResponse(input);
  assert.equal(result.diagnosis.length, 300);
  assert.equal(result.story_anchor.length, 100);
  assert.equal(result.suggestion.length, 200);
  assert.equal(result.examples.length, 2, "should cap at 2 examples");
  assert.equal(result.examples[0].length, 200);
});

test("parseGuidanceResponse handles null story_anchor", () => {
  const input = JSON.stringify({
    diagnosis: "test",
    story_anchor: null,
    suggestion: "test?",
    examples: [],
  });

  const result = parseGuidanceResponse(input);
  assert.equal(result.story_anchor, null);
});

// --- buildTemplateFallback ---

test("buildTemplateFallback returns guidance from templates", () => {
  const elementDef = STORY_ELEMENT_DEFINITIONS.find((d) => d.id === "moment");
  const result = buildTemplateFallback(elementDef, "weak", 0.4, {});

  assert.equal(result.element_id, "moment");
  assert.equal(result.element_name, "The Moment");
  assert.equal(result.strength, 0.4);
  assert.equal(result.state, "weak");
  assert.ok(result.diagnosis, "should have diagnosis from template");
  assert.ok(result.suggestion, "should have suggestion from template");
  assert.equal(
    result.story_anchor,
    null,
    "template fallback has no story anchor",
  );
});

test("buildTemplateFallback handles missing template gracefully", () => {
  const fakeDef = {
    id: "fake",
    displayName: "Fake",
    primarySlot: "nonexistent",
    bonusSlots: [],
  };
  const result = buildTemplateFallback(fakeDef, "missing", 0, {});

  assert.equal(result.element_id, "fake");
  assert.equal(result.state, "missing");
  assert.ok(result.diagnosis, "should have default diagnosis");
});

// --- findElementDefinition ---

test("findElementDefinition finds default elements", () => {
  const state = { story_mode: "default" };
  const result = findElementDefinition("bond", state);
  assert.ok(result);
  assert.equal(result.id, "bond");
  assert.equal(result.displayName, "Your Bond");
});

test("findElementDefinition finds reflective elements", () => {
  const state = { story_mode: "reflective_tribute" };
  const result = findElementDefinition("moment", state);
  assert.ok(result);
  assert.equal(result.id, "moment");
  assert.ok(
    result.bonusSlots.includes("moment_destination"),
    "reflective moment should have moment_destination bonus",
  );
});

test("findElementDefinition returns null for unknown element", () => {
  const result = findElementDefinition("nonexistent", {});
  assert.equal(result, null);
});
