const test = require("node:test");
const assert = require("node:assert/strict");

const { createInitialState } = require("../../../src/writer/v3/state");
const {
  computeLabovGapAnalysis,
  computeStoryElements,
  computeQuestionPriority,
  STRENGTH_THRESHOLDS,
  EVALUATION_REGEX,
  SENSORY_REGEX,
  PAST_ACTION_REGEX,
} = require("../../../src/writer/v3/quality");

const { extractStoryState } = require("../../../src/writer/v3/index");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildEmptyState() {
  return createInitialState({
    recipientName: "Sarah",
    occasion: "birthday",
    initialPrompt: "seed",
  });
}

function buildRichState() {
  const state = buildEmptyState();
  state.narrative = [
    "We met in college during freshman orientation.",
    "Sarah was the first person who said hi to me.",
    "When I got sick junior year, she drove three hours to bring me soup.",
    "That moment changed everything - I realized she wasn't just a friend, she was family.",
    "I felt so grateful and loved.",
  ].join(" ");
  state.narrative_current = state.narrative;
  state.atoms = {
    ...state.atoms,
    who: "my best friend Sarah",
    where: "in college",
    when: "freshman orientation",
    action: "she drove three hours to bring me soup when I got sick",
    after: "grateful and loved",
    turn: "I realized she wasn't just a friend, she was family",
  };
  state.facts = [
    { id: "f1", text: "We met in college during freshman orientation.", status: "active" },
    { id: "f2", text: "Sarah drove three hours to bring me soup when I was sick.", status: "active" },
    { id: "f3", text: "I realized she wasn't just a friend, she was family.", status: "active" },
    { id: "f4", text: "I felt so grateful and loved.", status: "active" },
  ];
  state.conversation = [
    { role: "assistant", content: "What's a special memory with Sarah?" },
    { role: "user", content: "We met in college and she drove three hours to bring me soup when I was sick." },
    { role: "assistant", content: "How did that make you feel?" },
    { role: "user", content: "I felt so grateful. She's family." },
  ];
  state.turn_count = 3;
  return state;
}

// ===========================================================================
// Fix 1: extractStoryState() populates state.story_state
// ===========================================================================

test("extractStoryState returns structured story state with labov, sensory, questions", () => {
  const state = buildRichState();
  const storyState = extractStoryState(state);

  assert.ok(storyState, "extractStoryState should return a non-null object");
  assert.ok(storyState.recipient, "should have recipient");
  assert.equal(storyState.recipient.name, "my best friend Sarah");
  assert.ok(storyState.labov, "should have labov classification");
  assert.ok(storyState.labov.orientation, "should have orientation");
  assert.ok(storyState.labov.evaluation, "should have evaluation");
  assert.ok(Array.isArray(storyState.questionsAsked), "should have questionsAsked array");
  assert.ok(storyState.questionsAsked.length > 0, "should have extracted questions from conversation");
});

test("extractStoryState labov classifies facts into correct elements", () => {
  const state = buildRichState();
  const storyState = extractStoryState(state);

  // "met in college during freshman orientation" should match ORIENTATION_REGEX
  assert.ok(storyState.labov.orientation.key_facts.length > 0, "orientation should have key facts");

  // "felt so grateful and loved" should match EVALUATION_REGEX
  assert.ok(storyState.labov.evaluation.key_facts.length > 0, "evaluation should have key facts");
});

test("extractStoryState captures already-asked questions from conversation", () => {
  const state = buildRichState();
  const storyState = extractStoryState(state);

  const questions = storyState.questionsAsked;
  assert.ok(questions.length >= 2, "should capture at least 2 questions from assistant turns");

  // First question should be answered (there's a user turn after it)
  const firstQ = questions.find((q) => q.question.includes("special memory"));
  assert.ok(firstQ, "should capture the special memory question");
  assert.equal(firstQ.answered, true, "first question should be marked answered");
});

test("extractStoryState returns empty structures for empty state", () => {
  const state = buildEmptyState();
  const storyState = extractStoryState(state);

  assert.ok(storyState, "should return an object even for empty state");
  assert.equal(storyState.labov.orientation.key_facts.length, 0);
  assert.equal(storyState.labov.evaluation.key_facts.length, 0);
  assert.equal(storyState.questionsAsked.length, 0);
});

// ===========================================================================
// Fix 2: canProceedAnyway flows to response
// ===========================================================================

test("computeLabovGapAnalysis returns canProceedAnyway when turnCount >= 2", () => {
  const state = buildRichState();
  state.turn_count = 3;
  const result = computeLabovGapAnalysis(state, { turnCount: 3 });
  assert.equal(result.canProceedAnyway, true, "should set canProceedAnyway for turn >= 2");
});

test("computeLabovGapAnalysis does NOT return canProceedAnyway when turnCount < 2", () => {
  const state = buildRichState();
  state.turn_count = 1;
  const result = computeLabovGapAnalysis(state, { turnCount: 1 });
  assert.equal(result.canProceedAnyway, undefined, "should not have canProceedAnyway for turn < 2");
});

test("computeLabovGapAnalysis does NOT return canProceedAnyway when turnCount is null", () => {
  const state = buildRichState();
  const result = computeLabovGapAnalysis(state, {});
  assert.equal(result.canProceedAnyway, undefined, "should not have canProceedAnyway without turnCount");
});

// ===========================================================================
// Fix 3: EVALUATION_REGEX consistency between quality.js and extractStoryState
// ===========================================================================

test("quality.js exports EVALUATION_REGEX", () => {
  assert.ok(EVALUATION_REGEX instanceof RegExp, "EVALUATION_REGEX should be exported from quality.js");
});

test("quality.js exports SENSORY_REGEX", () => {
  assert.ok(SENSORY_REGEX instanceof RegExp, "SENSORY_REGEX should be exported from quality.js");
});

test("quality.js exports PAST_ACTION_REGEX", () => {
  assert.ok(PAST_ACTION_REGEX instanceof RegExp, "PAST_ACTION_REGEX should be exported from quality.js");
});

test("extractStoryState uses same EVALUATION_REGEX as quality.js scoring", () => {
  // The test verifies that "felt" (in quality.js EVALUATION_REGEX) is matched
  // AND that "grateful" (in quality.js EVALUATION_REGEX) is also matched.
  // If extractStoryState used a different regex, these could diverge.
  const state = buildEmptyState();
  state.facts = [
    { id: "f1", text: "I felt connected to her in that moment.", status: "active" },
  ];
  const storyState = extractStoryState(state);

  // "felt" and "connected" are both in quality.js EVALUATION_REGEX
  assert.ok(
    storyState.labov.evaluation.key_facts.length > 0,
    "extractStoryState should classify 'felt connected' as evaluation using the shared regex"
  );
});

// ===========================================================================
// Fix 4: SPECIFIC_DETAIL_REGEX /g flag with .test() in loop
// ===========================================================================

test("extractStoryState finds specific details across multiple facts consistently", () => {
  const state = buildEmptyState();
  state.facts = [
    { id: "f1", text: "She always ordered vanilla ice cream.", status: "active" },
    { id: "f2", text: "He played the guitar at sunset.", status: "active" },
    { id: "f3", text: "The coffee shop where we met.", status: "active" },
    { id: "f4", text: "She wore a ring from her grandmother.", status: "active" },
    { id: "f5", text: "We listened to our song on the beach.", status: "active" },
  ];
  const storyState = extractStoryState(state);

  // With the /g bug, some of these would be missed on alternating .test() calls
  const details = storyState.sensoryDetails.map((d) => d.toLowerCase());
  assert.ok(details.includes("vanilla"), "should find vanilla");
  assert.ok(details.includes("guitar"), "should find guitar");
  assert.ok(details.includes("coffee"), "should find coffee");
  assert.ok(details.includes("ring"), "should find ring");
  assert.ok(details.includes("beach") || details.includes("song"), "should find beach or song");
});

test("extractStoryState finds specific details in consecutive facts without skipping", () => {
  // Regression test for /g flag + .test() bug: every other .test() call
  // would silently fail because lastIndex advances
  const state = buildEmptyState();
  state.facts = Array.from({ length: 10 }, (_, i) => ({
    id: `f${i}`,
    text: `Fact ${i}: the sunset was beautiful.`,
    status: "active",
  }));
  const storyState = extractStoryState(state);
  const details = storyState.sensoryDetails.map((d) => d.toLowerCase());
  assert.ok(details.includes("sunset"), "should find sunset even with many repeated facts");
});

// ===========================================================================
// Fix 5: resolution mapped to display element (blended into moment)
// ===========================================================================

test("computeStoryElements Labov branch blends resolution into moment when resolution > complicating", () => {
  // When resolution is stronger than complicating, the blend should increase moment
  // beyond complicating_action alone. This is the key test:
  // Without the fix, moment = complicating.strength = 0.3
  // With the fix (blendStrength(0.3, 0.9, 0.25)):
  //   Math.max(0.3, (0.75 * 0.3) + (0.25 * 0.9)) = Math.max(0.3, 0.45) = 0.45
  const gapAnalysis = {
    readinessProfile: "labov",
    storyMode: "default",
    labov: {
      elements: [
        { element: "orientation", weight: 0.20, strength: 0.5 },
        { element: "complicating_action", weight: 0.25, strength: 0.3 },
        { element: "evaluation", weight: 0.35, strength: 0.4 },
        { element: "resolution", weight: 0.10, strength: 0.9 },
        { element: "specificity_bonus", weight: 0.05, strength: 0.2 },
        { element: "coda", weight: 0.05, strength: 0 },
      ],
    },
  };

  const elements = computeStoryElements(gapAnalysis);
  const moment = elements.find((el) => el.id === "moment");
  assert.ok(moment, "should have moment element");
  // With resolution blended in: blendStrength(0.3, 0.9, 0.25) = 0.45
  // Without fix: moment = 0.3 (just complicating)
  assert.ok(
    moment.strength > 0.3,
    `moment (${moment.strength}) should be > 0.3 (complicating alone) when resolution is 0.9`
  );
});

test("computeStoryElements Labov branch: resolution with 0 strength does not hurt moment", () => {
  // Even if resolution is 0, the blend formula should use Math.max so moment >= complicating
  const gapAnalysis = {
    readinessProfile: "labov",
    storyMode: "default",
    labov: {
      elements: [
        { element: "orientation", weight: 0.20, strength: 0.5 },
        { element: "complicating_action", weight: 0.25, strength: 0.6 },
        { element: "evaluation", weight: 0.35, strength: 0.3 },
        { element: "resolution", weight: 0.10, strength: 0 },
        { element: "specificity_bonus", weight: 0.05, strength: 0.2 },
        { element: "coda", weight: 0.05, strength: 0 },
      ],
    },
  };

  const elements = computeStoryElements(gapAnalysis);
  const moment = elements.find((el) => el.id === "moment");
  assert.ok(moment, "should have moment element");
  // Complicating action is 0.6. Resolution is 0. With blendStrength(0.6, 0, 0.25):
  // Math.max(0.6, (0.75 * 0.6) + (0.25 * 0)) = Math.max(0.6, 0.45) = 0.6
  // So moment should still be 0.6
  assert.equal(moment.strength, 0.6, "moment should equal complicating_action when resolution is 0");
});

// ===========================================================================
// Fix 6: computeQuestionPriority uses STRENGTH_THRESHOLDS.covered not 0.6
// ===========================================================================

test("computeQuestionPriority skips elements at STRENGTH_THRESHOLDS.covered", () => {
  // Verify the threshold constant is 0.6
  assert.equal(STRENGTH_THRESHOLDS.covered, 0.6, "covered threshold should be 0.6");

  const analysis = {
    labov: {
      elements: [
        { element: "orientation", weight: 0.20, strength: 0.6 },      // exactly at covered — should skip
        { element: "complicating_action", weight: 0.25, strength: 0.7 }, // above covered — should skip
        { element: "evaluation", weight: 0.35, strength: 0.3 },        // below covered — candidate
        { element: "resolution", weight: 0.10, strength: 0.1 },
      ],
    },
  };

  const result = computeQuestionPriority(analysis);
  assert.ok(result, "should return a target");
  // Only evaluation (0.35 * 0.7 = 0.245) and resolution (0.10 * 0.9 = 0.09) are candidates
  assert.equal(result.element, "evaluation", "should target evaluation as highest priority");
});
