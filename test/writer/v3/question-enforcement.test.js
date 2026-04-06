const test = require("node:test");
const assert = require("node:assert/strict");

const {
  generateTargetedFallbackQuestion,
  validateQuestionRelevance,
} = require("../../../src/writer/v3/quality");

// ---------------------------------------------------------------------------
// generateTargetedFallbackQuestion — null/empty inputs
// ---------------------------------------------------------------------------

test("generateTargetedFallbackQuestion returns null for null targetElement", () => {
  assert.equal(generateTargetedFallbackQuestion(null, {}, "hello"), null);
});

test("generateTargetedFallbackQuestion returns null for empty userMessage", () => {
  assert.equal(generateTargetedFallbackQuestion("orientation", {}, ""), null);
  assert.equal(generateTargetedFallbackQuestion("orientation", {}, null), null);
  assert.equal(generateTargetedFallbackQuestion("orientation", {}, undefined), null);
});

test("generateTargetedFallbackQuestion returns null for unknown element", () => {
  assert.equal(generateTargetedFallbackQuestion("nonexistent_element", {}, "My dad and I used to fish"), null);
});

// ---------------------------------------------------------------------------
// generateTargetedFallbackQuestion — orientation (who/where/when)
// ---------------------------------------------------------------------------

test("orientation fallback references user's specific content", () => {
  const q = generateTargetedFallbackQuestion("orientation", { turn_count: 1 }, "She showed up with ice cream during my breakup");
  assert.ok(q, "should return a question");
  assert.ok(q.length > 10, "question should be substantial");
  // Should reference something from the user's message
  assert.ok(
    /ice cream|breakup|showed up/i.test(q),
    `orientation question should reference user's content, got: "${q}"`
  );
});

test("orientation fallback asks about setting details (who/where/when)", () => {
  const q = generateTargetedFallbackQuestion("orientation", { turn_count: 2 }, "We were at grandma's house on Christmas Eve");
  assert.ok(q, "should return a question");
  // Should probe for more setting details
  assert.ok(
    /where|when|who|what time|what was|grandma|Christmas/i.test(q),
    `orientation question should ask about setting, got: "${q}"`
  );
});

// ---------------------------------------------------------------------------
// generateTargetedFallbackQuestion — complicating_action (what happened)
// ---------------------------------------------------------------------------

test("complicating_action fallback asks about a specific event/moment", () => {
  const q = generateTargetedFallbackQuestion("complicating_action", { turn_count: 1 }, "Sarah is my best friend since college");
  assert.ok(q, "should return a question");
  assert.ok(
    /moment|happened|Sarah|friend|college/i.test(q),
    `complicating_action question should reference event or user content, got: "${q}"`
  );
});

test("complicating_action fallback probes deeper at turn 2", () => {
  const q = generateTargetedFallbackQuestion("complicating_action", { turn_count: 2 }, "He got the job offer but it meant moving away");
  assert.ok(q, "should return a question");
  assert.ok(
    /job offer|moving|happened|after|then/i.test(q),
    `complicating_action probing question should reference content, got: "${q}"`
  );
});

// ---------------------------------------------------------------------------
// generateTargetedFallbackQuestion — evaluation (emotional meaning)
// ---------------------------------------------------------------------------

test("evaluation fallback asks about feelings and meaning", () => {
  const q = generateTargetedFallbackQuestion("evaluation", { turn_count: 1 }, "My dad taught me fishing every Saturday");
  assert.ok(q, "should return a question");
  assert.ok(
    /mean|feel|fishing|Saturday|dad|matter/i.test(q),
    `evaluation question should reference emotion or user content, got: "${q}"`
  );
});

test("evaluation fallback references specific detail from message", () => {
  const q = generateTargetedFallbackQuestion("evaluation", { turn_count: 2 }, "She stayed up all night making my costume by hand");
  assert.ok(q, "should return a question");
  assert.ok(
    /costume|stayed up|all night|by hand|mean|feel/i.test(q),
    `evaluation question should anchor to specific detail, got: "${q}"`
  );
});

// ---------------------------------------------------------------------------
// generateTargetedFallbackQuestion — resolution (how it ended/changed)
// ---------------------------------------------------------------------------

test("resolution fallback asks about what changed or outcome", () => {
  const q = generateTargetedFallbackQuestion("resolution", { turn_count: 1 }, "There was fear and uncertainty with the twins");
  assert.ok(q, "should return a question");
  assert.ok(
    /change|after|twins|fear|uncertainty|turn out|end|happen/i.test(q),
    `resolution question should ask about outcome, got: "${q}"`
  );
});

test("resolution fallback at turn 3+ asks closed question", () => {
  const q = generateTargetedFallbackQuestion("resolution", { turn_count: 3 }, "We almost didn't make it to the airport in time");
  assert.ok(q, "should return a question");
  assert.ok(
    /airport|make it|did|were|was/i.test(q),
    `resolution closed question should be specific, got: "${q}"`
  );
});

// ---------------------------------------------------------------------------
// generateTargetedFallbackQuestion — funnel staging
// ---------------------------------------------------------------------------

test("turn 0-1 generates open-style question", () => {
  const q = generateTargetedFallbackQuestion("evaluation", { turn_count: 0 }, "My mom always believed in me");
  assert.ok(q, "should return a question");
  // Open questions tend to be broader / "tell me" style
  assert.ok(q.length > 15, "open question should be substantial");
});

test("turn 2 generates probing-style question", () => {
  const q = generateTargetedFallbackQuestion("complicating_action", { turn_count: 2 }, "The proposal was at the restaurant where we first met");
  assert.ok(q, "should return a question");
  // Probing: builds on specifics they mentioned
  assert.ok(
    /proposal|restaurant|first met|happened|what|then/i.test(q),
    `probing question should build on detail, got: "${q}"`
  );
});

test("turn 3+ generates closed-style question", () => {
  const q = generateTargetedFallbackQuestion("orientation", { turn_count: 4 }, "We were sitting on the porch watching the sunset");
  assert.ok(q, "should return a question");
  // Closed questions tend to be more pointed
  assert.ok(q.length > 10, "closed question should be meaningful");
});

// ---------------------------------------------------------------------------
// generateTargetedFallbackQuestion — detail extraction from userMessage
// ---------------------------------------------------------------------------

test("extracts proper nouns for question grounding", () => {
  const q = generateTargetedFallbackQuestion("evaluation", { turn_count: 1 }, "My brother Marcus flew in from Lagos for the ceremony");
  assert.ok(q, "should return a question");
  assert.ok(
    /Marcus|Lagos|ceremony|brother/i.test(q),
    `should reference proper noun or named detail, got: "${q}"`
  );
});

test("extracts sensory/specific details for question grounding", () => {
  const q = generateTargetedFallbackQuestion("orientation", { turn_count: 1 }, "It was a cold December morning and she was wearing that red scarf");
  assert.ok(q, "should return a question");
  assert.ok(
    /December|cold|morning|red scarf|wearing/i.test(q),
    `should reference sensory detail, got: "${q}"`
  );
});

test("handles message with no distinctive details gracefully", () => {
  const q = generateTargetedFallbackQuestion("evaluation", { turn_count: 1 }, "It was nice");
  assert.ok(q, "should still return a question even with minimal input");
  assert.ok(q.length > 10, "fallback should be meaningful");
});

// ---------------------------------------------------------------------------
// generateTargetedFallbackQuestion — uses facts from state when available
// ---------------------------------------------------------------------------

test("incorporates state facts when userMessage is thin", () => {
  const state = {
    turn_count: 2,
    facts: [
      { text: "Dad used to take me fishing at Lake Okonkwo every summer", status: "active" },
      { text: "He taught me how to be patient", status: "active" },
    ],
  };
  const q = generateTargetedFallbackQuestion("complicating_action", state, "Yeah that's right");
  assert.ok(q, "should return a question");
  // Should fall back to facts when user message is thin
  assert.ok(
    /fishing|Lake|Okonkwo|Dad|patient|summer|happened|moment/i.test(q),
    `should ground in state facts when message is thin, got: "${q}"`
  );
});

// ---------------------------------------------------------------------------
// validateQuestionRelevance
// ---------------------------------------------------------------------------

test("validateQuestionRelevance returns true for on-target orientation question", () => {
  assert.equal(validateQuestionRelevance("Where were you when this happened?", "orientation"), true);
  assert.equal(validateQuestionRelevance("Who was with you that evening?", "orientation"), true);
  assert.equal(validateQuestionRelevance("When did this take place?", "orientation"), true);
});

test("validateQuestionRelevance returns true for on-target complicating_action question", () => {
  assert.equal(validateQuestionRelevance("What happened when you arrived?", "complicating_action"), true);
  assert.equal(validateQuestionRelevance("Was there a moment that really changed things?", "complicating_action"), true);
});

test("validateQuestionRelevance returns true for on-target evaluation question", () => {
  assert.equal(validateQuestionRelevance("How did that make you feel?", "evaluation"), true);
  assert.equal(validateQuestionRelevance("What does this memory mean to you now?", "evaluation"), true);
  assert.equal(validateQuestionRelevance("Why does this matter so much?", "evaluation"), true);
});

test("validateQuestionRelevance returns true for on-target resolution question", () => {
  assert.equal(validateQuestionRelevance("How did things change after that?", "resolution"), true);
  assert.equal(validateQuestionRelevance("What happened in the end?", "resolution"), true);
  assert.equal(validateQuestionRelevance("What's different now because of this?", "resolution"), true);
});

test("validateQuestionRelevance returns false for off-target questions", () => {
  // Asking about feelings when targeting orientation
  assert.equal(validateQuestionRelevance("How did that make you feel?", "orientation"), false);
  // Asking about setting when targeting evaluation
  assert.equal(validateQuestionRelevance("Where were you when this happened?", "evaluation"), false);
  // Asking about emotions when targeting complicating_action
  assert.equal(validateQuestionRelevance("What does this memory mean to you?", "complicating_action"), false);
  // Asking about events when targeting resolution
  assert.equal(validateQuestionRelevance("Tell me about the first time you met", "resolution"), false);
});

test("validateQuestionRelevance returns false for generic questions", () => {
  assert.equal(validateQuestionRelevance("Can you tell me more?", "orientation"), false);
  assert.equal(validateQuestionRelevance("What else would you like to share?", "evaluation"), false);
  assert.equal(validateQuestionRelevance("Is there anything else?", "complicating_action"), false);
});

test("validateQuestionRelevance handles null/empty inputs gracefully", () => {
  assert.equal(validateQuestionRelevance(null, "orientation"), false);
  assert.equal(validateQuestionRelevance("", "orientation"), false);
  assert.equal(validateQuestionRelevance("Where were you?", null), false);
  assert.equal(validateQuestionRelevance("Where were you?", ""), false);
  assert.equal(validateQuestionRelevance(null, null), false);
});

// ---------------------------------------------------------------------------
// Integration: fallback replaces generic LLM question
// ---------------------------------------------------------------------------

test("integration: validateQuestionRelevance correctly flags LLM question as off-target, fallback provides on-target replacement", () => {
  // Simulate: LLM asked a generic question, but target is evaluation
  const llmQuestion = "Can you tell me more about that?";
  const targetElement = "evaluation";
  const userMessage = "My dad taught me fishing every Saturday morning";

  // Step 1: Validate — LLM question is generic, should be off-target
  const isRelevant = validateQuestionRelevance(llmQuestion, targetElement);
  assert.equal(isRelevant, false, "generic LLM question should be flagged as off-target");

  // Step 2: Generate fallback
  const fallback = generateTargetedFallbackQuestion(targetElement, { turn_count: 1 }, userMessage);
  assert.ok(fallback, "fallback should be generated");

  // Step 3: Fallback should be on-target
  const fallbackIsRelevant = validateQuestionRelevance(fallback, targetElement);
  assert.equal(fallbackIsRelevant, true, `fallback "${fallback}" should be on-target for ${targetElement}`);
});

test("integration: on-target LLM question passes validation, no replacement needed", () => {
  const llmQuestion = "Those Saturday fishing mornings - what do they mean to you now?";
  const targetElement = "evaluation";

  const isRelevant = validateQuestionRelevance(llmQuestion, targetElement);
  assert.equal(isRelevant, true, "on-target LLM question should pass validation");
});

test("integration: fallback for each element type passes its own relevance check", () => {
  const elements = ["orientation", "complicating_action", "evaluation", "resolution"];
  const messages = [
    "We met at a coffee shop downtown",
    "Sarah is my best friend since college",
    "My dad taught me fishing every Saturday",
    "There was fear and uncertainty with the twins",
  ];

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    const msg = messages[i];
    const fallback = generateTargetedFallbackQuestion(element, { turn_count: 1 }, msg);
    assert.ok(fallback, `fallback for ${element} should exist`);

    const isRelevant = validateQuestionRelevance(fallback, element);
    assert.equal(
      isRelevant, true,
      `fallback for ${element} should pass its own relevance check. Got: "${fallback}"`
    );
  }
});
