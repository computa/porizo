const test = require("node:test");
const assert = require("node:assert/strict");

const { generateStorySpecificSuggestions } = require("../../../src/writer/v3/quality");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides = {}) {
  return {
    facts: [],
    conversation: [],
    atoms: {},
    event: { occasion: "birthday", people: ["Sarah"] },
    ...overrides,
  };
}

function stateWithConversation(messages, overrides = {}) {
  const conversation = messages.map((content, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content,
  }));
  return makeState({ conversation, ...overrides });
}

// ---------------------------------------------------------------------------
// Core extraction: proper nouns
// ---------------------------------------------------------------------------

test("extracts proper nouns from user message", () => {
  const state = makeState();
  const suggestions = generateStorySpecificSuggestions(
    state,
    "My dad Michael taught me everything about fishing at Lake Tahoe."
  );

  assert.equal(suggestions.length, 3);
  // At least one suggestion should reference extracted details (Michael, Lake Tahoe, fishing)
  const joined = suggestions.join(" ").toLowerCase();
  const referencesDetail =
    joined.includes("michael") ||
    joined.includes("lake tahoe") ||
    joined.includes("fishing") ||
    joined.includes("dad");
  assert.equal(referencesDetail, true, `Suggestions should reference user details but got: ${suggestions.join(", ")}`);
});

// ---------------------------------------------------------------------------
// Core extraction: activities/events
// ---------------------------------------------------------------------------

test("extracts activities and events from user message", () => {
  const state = makeState();
  const suggestions = generateStorySpecificSuggestions(
    state,
    "We used to go camping every summer at the old cabin."
  );

  assert.equal(suggestions.length, 3);
  const joined = suggestions.join(" ").toLowerCase();
  const referencesActivity =
    joined.includes("camping") ||
    joined.includes("summer") ||
    joined.includes("cabin");
  assert.equal(referencesActivity, true, `Suggestions should reference activities but got: ${suggestions.join(", ")}`);
});

// ---------------------------------------------------------------------------
// Always returns exactly 3 suggestions
// ---------------------------------------------------------------------------

test("generates exactly 3 suggestions", () => {
  const state = makeState();
  const suggestions = generateStorySpecificSuggestions(
    state,
    "My dad taught me everything about fishing. We used to go every Saturday morning."
  );

  assert.equal(suggestions.length, 3);
});

// ---------------------------------------------------------------------------
// Each suggestion under 8 words
// ---------------------------------------------------------------------------

test("each suggestion is under 8 words", () => {
  const state = makeState();
  const suggestions = generateStorySpecificSuggestions(
    state,
    "Sarah showed up with mint chocolate chip ice cream during my worst breakup at the apartment downtown."
  );

  assert.equal(suggestions.length, 3);
  for (const s of suggestions) {
    const wordCount = s.split(/\s+/).length;
    assert.ok(wordCount <= 8, `Suggestion "${s}" has ${wordCount} words (max 8)`);
  }
});

// ---------------------------------------------------------------------------
// Suggestions reference user content, not generic phrases
// ---------------------------------------------------------------------------

test("suggestions reference user's actual content, not generic phrases", () => {
  const state = makeState();
  const suggestions = generateStorySpecificSuggestions(
    state,
    "My dad taught me everything about fishing. We used to go every Saturday morning."
  );

  const generic = [
    "add more detail",
    "describe the setting",
    "share a memory",
    "tell me more",
    "what happened next",
  ];

  for (const s of suggestions) {
    const lower = s.toLowerCase();
    for (const g of generic) {
      assert.notEqual(lower, g, `Suggestion "${s}" is generic`);
    }
  }
});

// ---------------------------------------------------------------------------
// Fallback to occasion templates when input is sparse
// ---------------------------------------------------------------------------

test("falls back to occasion templates when input is very sparse", () => {
  const state = makeState({ event: { occasion: "birthday" } });
  const suggestions = generateStorySpecificSuggestions(state, "Yes");

  assert.equal(suggestions.length, 3);
  // Each should still be a valid chip
  for (const s of suggestions) {
    assert.ok(s.length > 0, "Suggestion should not be empty");
    assert.ok(s.split(/\s+/).length <= 8, `Suggestion "${s}" exceeds 8 words`);
  }
});

// ---------------------------------------------------------------------------
// Different occasions produce different fallback suggestions
// ---------------------------------------------------------------------------

test("different occasions produce different fallback suggestions", () => {
  const birthdayState = makeState({ event: { occasion: "birthday" } });
  const memorialState = makeState({ event: { occasion: "bereavement" } });

  const birthdaySuggestions = generateStorySpecificSuggestions(birthdayState, "OK");
  const memorialSuggestions = generateStorySpecificSuggestions(memorialState, "OK");

  // At least one should differ
  const birthdaySet = new Set(birthdaySuggestions);
  const allSame = memorialSuggestions.every((s) => birthdaySet.has(s));
  assert.equal(allSame, false, "Birthday and memorial suggestions should differ");
});

// ---------------------------------------------------------------------------
// Handles null/empty state gracefully
// ---------------------------------------------------------------------------

test("handles null state gracefully", () => {
  const suggestions = generateStorySpecificSuggestions(null, "My dad taught me fishing");
  assert.equal(suggestions.length, 3);
});

test("handles empty state gracefully", () => {
  const suggestions = generateStorySpecificSuggestions({}, "My dad taught me fishing");
  assert.equal(suggestions.length, 3);
});

test("handles null userMessage gracefully", () => {
  const state = makeState();
  const suggestions = generateStorySpecificSuggestions(state, null);
  assert.equal(suggestions.length, 3);
});

test("handles empty string userMessage", () => {
  const state = makeState();
  const suggestions = generateStorySpecificSuggestions(state, "");
  assert.equal(suggestions.length, 3);
});

// ---------------------------------------------------------------------------
// Extracts relationships mentioned
// ---------------------------------------------------------------------------

test("extracts relationships from user message", () => {
  const state = makeState();
  const suggestions = generateStorySpecificSuggestions(
    state,
    "My best friend Sarah always knew when I needed her."
  );

  assert.equal(suggestions.length, 3);
  const joined = suggestions.join(" ").toLowerCase();
  const referencesRelation =
    joined.includes("sarah") ||
    joined.includes("best friend") ||
    joined.includes("friend");
  assert.equal(referencesRelation, true, `Suggestions should reference relationships but got: ${suggestions.join(", ")}`);
});

// ---------------------------------------------------------------------------
// Extracts places and times
// ---------------------------------------------------------------------------

test("extracts places and times from user message", () => {
  const state = makeState();
  const suggestions = generateStorySpecificSuggestions(
    state,
    "Every Saturday morning at the park near our house, we'd run together."
  );

  assert.equal(suggestions.length, 3);
  const joined = suggestions.join(" ").toLowerCase();
  const referencesPlaceOrTime =
    joined.includes("saturday") ||
    joined.includes("park") ||
    joined.includes("morning");
  assert.equal(referencesPlaceOrTime, true, `Suggestions should reference places/times but got: ${suggestions.join(", ")}`);
});

// ---------------------------------------------------------------------------
// Extracts named items (quoted text, specific things)
// ---------------------------------------------------------------------------

test("extracts specific named items from user message", () => {
  const state = makeState();
  const suggestions = generateStorySpecificSuggestions(
    state,
    "Sarah showed up with mint chocolate chip ice cream during my worst breakup."
  );

  assert.equal(suggestions.length, 3);
  const joined = suggestions.join(" ").toLowerCase();
  const referencesItem =
    joined.includes("mint chocolate chip") ||
    joined.includes("ice cream") ||
    joined.includes("sarah") ||
    joined.includes("breakup");
  assert.equal(referencesItem, true, `Suggestions should reference specific items but got: ${suggestions.join(", ")}`);
});

// ---------------------------------------------------------------------------
// Uses conversation history for richer extraction
// ---------------------------------------------------------------------------

test("uses conversation history alongside current message", () => {
  const state = stateWithConversation([
    "My dad Michael is an amazing cook",
    "Tell me more about a cooking moment",
  ]);
  const suggestions = generateStorySpecificSuggestions(
    state,
    "He always made jollof rice every Sunday after church."
  );

  assert.equal(suggestions.length, 3);
  const joined = suggestions.join(" ").toLowerCase();
  const referencesConversation =
    joined.includes("jollof") ||
    joined.includes("sunday") ||
    joined.includes("church") ||
    joined.includes("cook") ||
    joined.includes("michael");
  assert.equal(referencesConversation, true, `Should reference conversation details but got: ${suggestions.join(", ")}`);
});

// ---------------------------------------------------------------------------
// Suggestions are unique (no duplicates)
// ---------------------------------------------------------------------------

test("suggestions are unique with no duplicates", () => {
  const state = makeState();
  const suggestions = generateStorySpecificSuggestions(
    state,
    "My dad taught me everything about fishing. Fishing is our thing."
  );

  const unique = new Set(suggestions);
  assert.equal(unique.size, 3, `Suggestions should be unique but got: ${suggestions.join(", ")}`);
});
