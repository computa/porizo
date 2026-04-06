const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildContextPrompt,
  buildSelectionPrompt,
  buildAlreadyKnown,
  buildAlreadyAsked,
} = require("../../../src/writer/v3/prompts/builder");

const {
  extractStoryState,
} = require("../../../src/writer/v3/index");

// ---------------------------------------------------------------------------
// extractStoryState — core derivation
// ---------------------------------------------------------------------------

test("extractStoryState returns empty structure for empty state", () => {
  const result = extractStoryState({});
  assert.ok(result);
  assert.deepEqual(result.recipient, { name: null, relationship: null });
  assert.deepEqual(result.sensoryDetails, []);
  assert.deepEqual(result.questionsAsked, []);
  assert.equal(result.occasion, undefined);
  assert.ok(result.labov);
});

test("extractStoryState extracts recipient name from atoms", () => {
  const state = {
    atoms: { who: "Sarah" },
    facts: [],
    conversation: [],
  };
  const result = extractStoryState(state);
  assert.equal(result.recipient.name, "Sarah");
});

test("extractStoryState detects relationship from facts", () => {
  const state = {
    atoms: { who: "Sarah" },
    facts: [
      { id: "f1", text: "Sarah is my best friend since college", status: "active" },
    ],
    conversation: [],
  };
  const result = extractStoryState(state);
  assert.equal(result.recipient.name, "Sarah");
  assert.equal(result.recipient.relationship, "friend");
});

test("extractStoryState detects 'mom' relationship from facts", () => {
  const state = {
    atoms: { who: "Helen" },
    facts: [
      { id: "f1", text: "Helen is my mom who raised me alone", status: "active" },
    ],
    conversation: [],
  };
  const result = extractStoryState(state);
  assert.equal(result.recipient.relationship, "mom");
});

test("extractStoryState extracts sensory details from facts", () => {
  const state = {
    atoms: { who: "Sarah", where: "Central Park" },
    facts: [
      { id: "f1", text: "They danced to Dancing Queen in Central Park", status: "active" },
      { id: "f2", text: "She brought mint chocolate chip ice cream", status: "active" },
    ],
    conversation: [],
  };
  const result = extractStoryState(state);
  // Should pull specific nouns/details from facts
  assert.ok(result.sensoryDetails.length > 0);
});

test("extractStoryState tracks questions asked by the assistant", () => {
  const state = {
    atoms: {},
    facts: [],
    conversation: [
      { role: "user", content: "Sarah and I used to dance in the park." },
      { role: "assistant", content: "That sounds wonderful! What flavor was the ice cream?" },
      { role: "user", content: "Mint chocolate chip" },
      { role: "assistant", content: "What song was playing when you danced?" },
    ],
  };
  const result = extractStoryState(state);
  assert.ok(result.questionsAsked.length >= 2, `Expected at least 2 questions, got ${result.questionsAsked.length}`);
  assert.ok(result.questionsAsked[0].question.includes("ice cream"));
  assert.equal(result.questionsAsked[0].answered, true);
  assert.ok(result.questionsAsked[1].question.includes("song"));
  assert.equal(result.questionsAsked[1].answered, false); // last question, no user response yet
});

test("extractStoryState marks last question as unanswered when no user follow-up", () => {
  const state = {
    atoms: {},
    facts: [],
    conversation: [
      { role: "user", content: "My story about dad" },
      { role: "assistant", content: "Tell me more about your dad. Where did this happen?" },
    ],
  };
  const result = extractStoryState(state);
  assert.equal(result.questionsAsked.length, 1);
  assert.equal(result.questionsAsked[0].answered, false);
});

test("extractStoryState preserves occasion", () => {
  const state = {
    atoms: {},
    facts: [],
    conversation: [],
    occasion: "birthday",
  };
  const result = extractStoryState(state);
  assert.equal(result.occasion, "birthday");
});

test("extractStoryState falls back to event.occasion", () => {
  const state = {
    atoms: {},
    facts: [],
    conversation: [],
    event: { occasion: "anniversary" },
  };
  const result = extractStoryState(state);
  assert.equal(result.occasion, "anniversary");
});

test("extractStoryState does not crash on null facts or conversation", () => {
  const result = extractStoryState({ facts: null, conversation: null, atoms: null });
  assert.ok(result);
  assert.deepEqual(result.sensoryDetails, []);
  assert.deepEqual(result.questionsAsked, []);
});

// ---------------------------------------------------------------------------
// Labov classification in extractStoryState
// ---------------------------------------------------------------------------

test("extractStoryState classifies orientation facts (who/where/when)", () => {
  const state = {
    atoms: { who: "Sarah", where: "Central Park" },
    facts: [
      { id: "f1", text: "Sarah is my best friend since college", status: "active" },
      { id: "f2", text: "We met at Central Park in summer 2018", status: "active" },
    ],
    conversation: [],
  };
  const result = extractStoryState(state);
  assert.ok(result.labov.orientation.key_facts.length > 0, "Should have orientation facts");
  assert.ok(result.labov.orientation.strength > 0, "Orientation strength should be positive");
});

test("extractStoryState classifies complicating action facts", () => {
  const state = {
    atoms: {},
    facts: [
      { id: "f1", text: "Everything changed when she showed up unannounced at 2am", status: "active" },
      { id: "f2", text: "Then suddenly the phone rang with terrible news", status: "active" },
    ],
    conversation: [],
  };
  const result = extractStoryState(state);
  assert.ok(result.labov.complicating_action.key_facts.length > 0, "Should have complicating action facts");
});

test("extractStoryState classifies evaluation facts (emotional language)", () => {
  const state = {
    atoms: {},
    facts: [
      { id: "f1", text: "I felt grateful and proud watching her walk across the stage", status: "active" },
      { id: "f2", text: "It meant everything to finally hear those words", status: "active" },
    ],
    conversation: [],
  };
  const result = extractStoryState(state);
  assert.ok(result.labov.evaluation.key_facts.length > 0, "Should have evaluation facts");
  assert.ok(result.labov.evaluation.strength > 0, "Evaluation strength should be positive");
});

// ---------------------------------------------------------------------------
// buildAlreadyKnown — template variable builder
// ---------------------------------------------------------------------------

test("buildAlreadyKnown returns empty string when story_state is null", () => {
  const result = buildAlreadyKnown(null);
  assert.equal(result, "");
});

test("buildAlreadyKnown returns empty string when story_state is undefined", () => {
  const result = buildAlreadyKnown(undefined);
  assert.equal(result, "");
});

test("buildAlreadyKnown formats known facts from story_state", () => {
  const storyState = {
    recipient: { name: "Sarah", relationship: "friend" },
    labov: {
      orientation: { strength: 0.8, key_facts: ["best friends since college"] },
      complicating_action: { strength: 0.5, key_facts: ["breakup in 2020"] },
      evaluation: { strength: 0.6, key_facts: ["grateful for her support"] },
      resolution: { strength: 0, key_facts: [] },
    },
    sensoryDetails: ["mint chocolate chip", "Dancing Queen"],
  };
  const result = buildAlreadyKnown(storyState);
  assert.ok(result.includes("ALREADY KNOWN"), "Should have header");
  assert.ok(result.includes("Sarah"), "Should mention recipient");
  assert.ok(result.includes("friend"), "Should mention relationship");
  assert.ok(result.includes("best friends since college"), "Should include orientation fact");
  assert.ok(result.includes("mint chocolate chip"), "Should include sensory detail");
});

test("buildAlreadyKnown caps at 10 items", () => {
  const storyState = {
    recipient: { name: "Sarah", relationship: "friend" },
    labov: {
      orientation: { strength: 0.8, key_facts: ["fact1", "fact2", "fact3"] },
      complicating_action: { strength: 0.5, key_facts: ["fact4", "fact5", "fact6"] },
      evaluation: { strength: 0.6, key_facts: ["fact7", "fact8", "fact9"] },
      resolution: { strength: 0.3, key_facts: ["fact10", "fact11"] },
    },
    sensoryDetails: ["detail1", "detail2", "detail3"],
  };
  const result = buildAlreadyKnown(storyState);
  // Count lines starting with "- "
  const bulletLines = result.split("\n").filter(line => line.startsWith("- "));
  assert.ok(bulletLines.length <= 10, `Should cap at 10, got ${bulletLines.length}`);
});

test("buildAlreadyKnown omits recipient line when name is null", () => {
  const storyState = {
    recipient: { name: null, relationship: null },
    labov: {
      orientation: { strength: 0, key_facts: [] },
      complicating_action: { strength: 0, key_facts: [] },
      evaluation: { strength: 0, key_facts: [] },
      resolution: { strength: 0, key_facts: [] },
    },
    sensoryDetails: [],
  };
  const result = buildAlreadyKnown(storyState);
  assert.equal(result, "");
});

// ---------------------------------------------------------------------------
// buildAlreadyAsked — template variable builder
// ---------------------------------------------------------------------------

test("buildAlreadyAsked returns empty string when story_state is null", () => {
  const result = buildAlreadyAsked(null);
  assert.equal(result, "");
});

test("buildAlreadyAsked formats questions from story_state", () => {
  const storyState = {
    questionsAsked: [
      { round: 1, question: "What flavor was the ice cream?", answered: true, answerSummary: "mint chocolate chip" },
      { round: 1, question: "What song was playing?", answered: true, answerSummary: "Dancing Queen" },
    ],
  };
  const result = buildAlreadyAsked(storyState);
  assert.ok(result.includes("ALREADY ASKED"), "Should have header");
  assert.ok(result.includes("ice cream"), "Should mention ice cream question");
  assert.ok(result.includes("mint chocolate chip"), "Should include answer");
  assert.ok(result.includes("Dancing Queen"), "Should include second answer");
});

test("buildAlreadyAsked caps at 5 items", () => {
  const storyState = {
    questionsAsked: [
      { round: 1, question: "Q1?", answered: true, answerSummary: "A1" },
      { round: 1, question: "Q2?", answered: true, answerSummary: "A2" },
      { round: 2, question: "Q3?", answered: true, answerSummary: "A3" },
      { round: 2, question: "Q4?", answered: true, answerSummary: "A4" },
      { round: 3, question: "Q5?", answered: true, answerSummary: "A5" },
      { round: 3, question: "Q6?", answered: true, answerSummary: "A6" },
      { round: 4, question: "Q7?", answered: true, answerSummary: "A7" },
    ],
  };
  const result = buildAlreadyAsked(storyState);
  const bulletLines = result.split("\n").filter(line => line.startsWith("- "));
  assert.ok(bulletLines.length <= 5, `Should cap at 5, got ${bulletLines.length}`);
});

test("buildAlreadyAsked shows unanswered questions", () => {
  const storyState = {
    questionsAsked: [
      { round: 1, question: "What happened next?", answered: false },
    ],
  };
  const result = buildAlreadyAsked(storyState);
  assert.ok(result.includes("What happened next"), "Should include unanswered question");
  assert.ok(result.includes("Unanswered") || result.includes("Pending"), "Should mark as unanswered");
});

// ---------------------------------------------------------------------------
// Template injection — buildContextPrompt includes new variables
// ---------------------------------------------------------------------------

test("buildContextPrompt injects already_known when story_state is present", () => {
  const state = {
    recipient_name: "Sarah",
    event: { occasion: "birthday" },
    narrative: "Sarah is my best friend.",
    facts: [{ id: "f1", text: "best friends since college", status: "active" }],
    atoms: { who: "Sarah" },
    primitives: {},
    motifs: [],
    dials: {},
    beats: [],
    conversation: [],
    story_state: {
      recipient: { name: "Sarah", relationship: "friend" },
      labov: {
        orientation: { strength: 0.8, key_facts: ["best friends since college"] },
        complicating_action: { strength: 0, key_facts: [] },
        evaluation: { strength: 0, key_facts: [] },
        resolution: { strength: 0, key_facts: [] },
      },
      sensoryDetails: [],
      questionsAsked: [],
      occasion: "birthday",
    },
  };
  const prompt = buildContextPrompt(state, "She loves mint chocolate chip");
  assert.ok(prompt.includes("ALREADY KNOWN"), "Should inject already_known section");
  assert.ok(prompt.includes("Sarah"), "Should include recipient name in already_known");
});

test("buildContextPrompt gracefully degrades when story_state is absent", () => {
  const state = {
    recipient_name: "Sarah",
    event: { occasion: "birthday" },
    narrative: "Sarah is my best friend.",
    facts: [{ id: "f1", text: "best friends since college", status: "active" }],
    atoms: { who: "Sarah" },
    primitives: {},
    motifs: [],
    dials: {},
    beats: [],
    conversation: [],
    // No story_state
  };
  const prompt = buildContextPrompt(state, "Tell me about Sarah");
  // Should not crash, and should not have ALREADY KNOWN
  assert.ok(typeof prompt === "string");
  assert.ok(!prompt.includes("ALREADY KNOWN"), "Should not inject already_known without story_state");
  // Template placeholder should be replaced with empty string
  assert.ok(!prompt.includes("{{already_known}}"), "Template var should be replaced");
  assert.ok(!prompt.includes("{{already_asked}}"), "Template var should be replaced");
});

test("buildContextPrompt injects already_asked when questions exist", () => {
  const state = {
    recipient_name: "Sarah",
    event: { occasion: "birthday" },
    narrative: "Sarah is my best friend.",
    facts: [{ id: "f1", text: "best friends since college", status: "active" }],
    atoms: { who: "Sarah" },
    primitives: {},
    motifs: [],
    dials: {},
    beats: [],
    conversation: [],
    story_state: {
      recipient: { name: "Sarah", relationship: "friend" },
      labov: {
        orientation: { strength: 0.8, key_facts: ["best friends since college"] },
        complicating_action: { strength: 0, key_facts: [] },
        evaluation: { strength: 0, key_facts: [] },
        resolution: { strength: 0, key_facts: [] },
      },
      sensoryDetails: [],
      questionsAsked: [
        { round: 1, question: "What flavor was the ice cream?", answered: true, answerSummary: "mint chocolate chip" },
      ],
      occasion: "birthday",
    },
  };
  const prompt = buildContextPrompt(state, "She also loves Dancing Queen");
  assert.ok(prompt.includes("ALREADY ASKED"), "Should inject already_asked section");
  assert.ok(prompt.includes("ice cream"), "Should mention past question");
});

// ---------------------------------------------------------------------------
// Template injection — buildSelectionPrompt includes new variables
// ---------------------------------------------------------------------------

test("buildSelectionPrompt injects already_known when story_state is present", () => {
  const state = {
    recipient_name: "Sarah",
    event: { occasion: "birthday" },
    narrative: "Sarah is my best friend.",
    facts: [{ id: "f1", text: "best friends since college", status: "active" }],
    atoms: { who: "Sarah" },
    primitives: {},
    motifs: [],
    dials: {},
    beats: [],
    conversation: [],
    story_state: {
      recipient: { name: "Sarah", relationship: "friend" },
      labov: {
        orientation: { strength: 0.8, key_facts: ["best friends since college"] },
        complicating_action: { strength: 0, key_facts: [] },
        evaluation: { strength: 0, key_facts: [] },
        resolution: { strength: 0, key_facts: [] },
      },
      sensoryDetails: [],
      questionsAsked: [],
      occasion: "birthday",
    },
  };
  const prompt = buildSelectionPrompt(state, "She loves mint chocolate chip");
  assert.ok(prompt.includes("ALREADY KNOWN"), "Should inject already_known in selection prompt");
});

test("buildSelectionPrompt gracefully degrades when story_state is absent", () => {
  const state = {
    recipient_name: "Sarah",
    event: { occasion: "birthday" },
    narrative: "Sarah is my best friend.",
    facts: [{ id: "f1", text: "best friends since college", status: "active" }],
    atoms: { who: "Sarah" },
    primitives: {},
    motifs: [],
    dials: {},
    beats: [],
    conversation: [],
  };
  const prompt = buildSelectionPrompt(state, "Tell me about Sarah");
  assert.ok(typeof prompt === "string");
  assert.ok(!prompt.includes("{{already_known}}"), "Template var should be replaced");
});

// ---------------------------------------------------------------------------
// Anti-repetition rule injection in prompts
// ---------------------------------------------------------------------------

test("buildContextPrompt includes ANTI-REPETITION RULE when story_state has facts", () => {
  const state = {
    recipient_name: "Sarah",
    event: { occasion: "birthday" },
    narrative: "Sarah is my best friend.",
    facts: [{ id: "f1", text: "best friends since college", status: "active" }],
    atoms: { who: "Sarah" },
    primitives: {},
    motifs: [],
    dials: {},
    beats: [],
    conversation: [],
    story_state: {
      recipient: { name: "Sarah", relationship: "friend" },
      labov: {
        orientation: { strength: 0.8, key_facts: ["best friends since college"] },
        complicating_action: { strength: 0, key_facts: [] },
        evaluation: { strength: 0, key_facts: [] },
        resolution: { strength: 0, key_facts: [] },
      },
      sensoryDetails: ["mint chocolate chip"],
      questionsAsked: [],
      occasion: "birthday",
    },
  };
  const prompt = buildContextPrompt(state, "More details");
  assert.ok(prompt.includes("ANTI-REPETITION"), "Should include anti-repetition rule");
});
