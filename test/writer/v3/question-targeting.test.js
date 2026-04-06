const test = require("node:test");
const assert = require("node:assert/strict");

// ---------------------------------------------------------------------------
// computeQuestionPriority
// ---------------------------------------------------------------------------

test("computeQuestionPriority returns null for null input", () => {
  const { computeQuestionPriority } = require("../../../src/writer/v3/quality");
  assert.equal(computeQuestionPriority(null), null);
});

test("computeQuestionPriority returns null for input without labov elements", () => {
  const { computeQuestionPriority } = require("../../../src/writer/v3/quality");
  assert.equal(computeQuestionPriority({}), null);
  assert.equal(computeQuestionPriority({ labov: {} }), null);
});

test("computeQuestionPriority targets highest weight * gap element", () => {
  const { computeQuestionPriority } = require("../../../src/writer/v3/quality");
  const analysis = {
    labov: {
      elements: [
        { element: "orientation", weight: 0.20, strength: 0.0 },     // priority: 0.20 * 1.0 = 0.20
        { element: "complicating_action", weight: 0.25, strength: 0.0 }, // priority: 0.25 * 1.0 = 0.25
        { element: "evaluation", weight: 0.35, strength: 0.0 },      // priority: 0.35 * 1.0 = 0.35 (highest)
        { element: "resolution", weight: 0.10, strength: 0.0 },
        { element: "coda", weight: 0.05, strength: 0.0 },
        { element: "specificity_bonus", weight: 0.05, strength: 0.0 },
      ],
    },
  };
  const result = computeQuestionPriority(analysis);
  assert.ok(result);
  assert.equal(result.element, "evaluation");
  assert.equal(result.priority, 0.35);
  assert.equal(result.weight, 0.35);
  assert.equal(result.currentStrength, 0.0);
  assert.ok(result.reason.includes("evaluation"));
  assert.ok(result.reason.includes("information gain"));
});

test("computeQuestionPriority skips elements with strength >= 0.6", () => {
  const { computeQuestionPriority } = require("../../../src/writer/v3/quality");
  const analysis = {
    labov: {
      elements: [
        { element: "orientation", weight: 0.20, strength: 0.8 },     // skip: >= 0.6
        { element: "complicating_action", weight: 0.25, strength: 0.7 }, // skip: >= 0.6
        { element: "evaluation", weight: 0.35, strength: 0.6 },      // skip: >= 0.6
        { element: "resolution", weight: 0.10, strength: 0.0 },      // priority: 0.10
        { element: "coda", weight: 0.05, strength: 0.0 },            // priority: 0.05
        { element: "specificity_bonus", weight: 0.05, strength: 0.0 },
      ],
    },
  };
  const result = computeQuestionPriority(analysis);
  assert.ok(result);
  assert.equal(result.element, "resolution");
});

test("computeQuestionPriority returns null when all elements are sufficiently covered", () => {
  const { computeQuestionPriority } = require("../../../src/writer/v3/quality");
  const analysis = {
    labov: {
      elements: [
        { element: "orientation", weight: 0.20, strength: 0.8 },
        { element: "complicating_action", weight: 0.25, strength: 0.7 },
        { element: "evaluation", weight: 0.35, strength: 0.9 },
        { element: "resolution", weight: 0.10, strength: 0.6 },
        { element: "coda", weight: 0.05, strength: 0.8 },
        { element: "specificity_bonus", weight: 0.05, strength: 0.7 },
      ],
    },
  };
  const result = computeQuestionPriority(analysis);
  assert.equal(result, null);
});

test("computeQuestionPriority correctly computes partial strength gap", () => {
  const { computeQuestionPriority } = require("../../../src/writer/v3/quality");
  // evaluation: 0.35 * (1 - 0.4) = 0.35 * 0.6 = 0.21
  // complicating_action: 0.25 * (1 - 0.1) = 0.25 * 0.9 = 0.225
  const analysis = {
    labov: {
      elements: [
        { element: "orientation", weight: 0.20, strength: 0.8 },
        { element: "complicating_action", weight: 0.25, strength: 0.1 },
        { element: "evaluation", weight: 0.35, strength: 0.4 },
        { element: "resolution", weight: 0.10, strength: 0.0 },
        { element: "coda", weight: 0.05, strength: 0.0 },
        { element: "specificity_bonus", weight: 0.05, strength: 0.0 },
      ],
    },
  };
  const result = computeQuestionPriority(analysis);
  assert.ok(result);
  // complicating_action has 0.225, evaluation has 0.21 — complicating_action wins
  assert.equal(result.element, "complicating_action");
  assert.equal(result.priority, 0.225);
});

test("computeQuestionPriority skips optional elements that have some coverage", () => {
  const { computeQuestionPriority } = require("../../../src/writer/v3/quality");
  // coda has weight 0.05, strength 0.1 (> 0) → skipped
  // specificity_bonus has weight 0.05, strength 0.1 (> 0) → skipped
  const analysis = {
    labov: {
      elements: [
        { element: "orientation", weight: 0.20, strength: 0.8 },
        { element: "complicating_action", weight: 0.25, strength: 0.8 },
        { element: "evaluation", weight: 0.35, strength: 0.9 },
        { element: "resolution", weight: 0.10, strength: 0.0 },   // priority: 0.10
        { element: "coda", weight: 0.05, strength: 0.1 },          // skipped: weight <= 0.05, strength > 0
        { element: "specificity_bonus", weight: 0.05, strength: 0.1 }, // skipped: same
      ],
    },
  };
  const result = computeQuestionPriority(analysis);
  assert.ok(result);
  assert.equal(result.element, "resolution");
});

// ---------------------------------------------------------------------------
// getQuestionStage
// ---------------------------------------------------------------------------

test("getQuestionStage returns OPEN for turn 0", () => {
  const { getQuestionStage } = require("../../../src/writer/v3/quality");
  const result = getQuestionStage(0);
  assert.equal(result.stage, "OPEN");
  assert.ok(result.description.includes("Broad"));
});

test("getQuestionStage returns OPEN for turn 1", () => {
  const { getQuestionStage } = require("../../../src/writer/v3/quality");
  const result = getQuestionStage(1);
  assert.equal(result.stage, "OPEN");
});

test("getQuestionStage returns OPEN for null/undefined", () => {
  const { getQuestionStage } = require("../../../src/writer/v3/quality");
  assert.equal(getQuestionStage(null).stage, "OPEN");
  assert.equal(getQuestionStage(undefined).stage, "OPEN");
});

test("getQuestionStage returns PROBING for turn 2", () => {
  const { getQuestionStage } = require("../../../src/writer/v3/quality");
  const result = getQuestionStage(2);
  assert.equal(result.stage, "PROBING");
  assert.ok(result.description.includes("specifics"));
});

test("getQuestionStage returns CLOSED for turn 3+", () => {
  const { getQuestionStage } = require("../../../src/writer/v3/quality");
  assert.equal(getQuestionStage(3).stage, "CLOSED");
  assert.equal(getQuestionStage(5).stage, "CLOSED");
  assert.equal(getQuestionStage(10).stage, "CLOSED");
});

// ---------------------------------------------------------------------------
// detectEmotionalIntensity
// ---------------------------------------------------------------------------

test("detectEmotionalIntensity returns low for null/empty input", () => {
  const { detectEmotionalIntensity } = require("../../../src/writer/v3/quality");
  assert.deepEqual(detectEmotionalIntensity(null), { intensity: "low", signals: [] });
  assert.deepEqual(detectEmotionalIntensity(""), { intensity: "low", signals: [] });
});

test("detectEmotionalIntensity returns low for neutral message", () => {
  const { detectEmotionalIntensity } = require("../../../src/writer/v3/quality");
  const result = detectEmotionalIntensity("We went to the park on Saturday.");
  assert.equal(result.intensity, "low");
  assert.equal(result.signals.length, 0);
});

test("detectEmotionalIntensity detects vulnerability keywords", () => {
  const { detectEmotionalIntensity } = require("../../../src/writer/v3/quality");
  const result = detectEmotionalIntensity("After the divorce, everything changed for us.");
  assert.equal(result.signals.length, 1);
  assert.ok(result.signals.includes("vulnerability"));
  assert.equal(result.intensity, "medium");
});

test("detectEmotionalIntensity detects intensifiers", () => {
  const { detectEmotionalIntensity } = require("../../../src/writer/v3/quality");
  const result = detectEmotionalIntensity("She meant the world to me and always will.");
  assert.ok(result.signals.includes("intensifier"));
  assert.equal(result.intensity, "medium");
});

test("detectEmotionalIntensity detects first-person emotion", () => {
  const { detectEmotionalIntensity } = require("../../../src/writer/v3/quality");
  const result = detectEmotionalIntensity("I felt like nothing would ever be the same.");
  assert.ok(result.signals.includes("first_person_emotion"));
  assert.equal(result.intensity, "medium");
});

test("detectEmotionalIntensity returns high when 2+ signals present", () => {
  const { detectEmotionalIntensity } = require("../../../src/writer/v3/quality");
  // vulnerability (death) + first_person_emotion (I felt)
  const result = detectEmotionalIntensity("When grandma died, I felt like I lost everything.");
  assert.equal(result.intensity, "high");
  assert.ok(result.signals.length >= 2);
});

test("detectEmotionalIntensity returns high for triple signals", () => {
  const { detectEmotionalIntensity } = require("../../../src/writer/v3/quality");
  // vulnerability (grief) + intensifier (never forget) + first_person_emotion (I cried)
  const result = detectEmotionalIntensity("The grief was overwhelming. I'll never forget when I cried at her bedside.");
  assert.equal(result.intensity, "high");
  assert.equal(result.signals.length, 3);
});

test("detectEmotionalIntensity is case-insensitive", () => {
  const { detectEmotionalIntensity } = require("../../../src/writer/v3/quality");
  const result = detectEmotionalIntensity("After the BREAKUP, I FELT like everything was over.");
  assert.equal(result.intensity, "high");
});

// ---------------------------------------------------------------------------
// buildQuestionTargeting (in builder.js)
// ---------------------------------------------------------------------------

test("buildQuestionTargeting returns empty string for legacy session (no labov)", () => {
  const { buildQuestionTargeting } = require("../../../src/writer/v3/prompts/builder");
  const result = buildQuestionTargeting({}, null, "hello");
  assert.equal(result, "");
});

test("buildQuestionTargeting includes question target element", () => {
  const { buildQuestionTargeting } = require("../../../src/writer/v3/prompts/builder");
  const labovAnalysis = {
    labov: {
      elements: [
        { element: "orientation", weight: 0.20, strength: 0.0 },
        { element: "complicating_action", weight: 0.25, strength: 0.0 },
        { element: "evaluation", weight: 0.35, strength: 0.0 },
        { element: "resolution", weight: 0.10, strength: 0.0 },
        { element: "coda", weight: 0.05, strength: 0.0 },
        { element: "specificity_bonus", weight: 0.05, strength: 0.0 },
      ],
    },
  };
  const state = { turn_count: 1 };
  const result = buildQuestionTargeting(state, labovAnalysis, "My friend Sarah");
  assert.ok(result.includes("QUESTION TARGET: evaluation"));
  assert.ok(result.includes("information gain"));
});

test("buildQuestionTargeting includes funnel stage", () => {
  const { buildQuestionTargeting } = require("../../../src/writer/v3/prompts/builder");
  const labovAnalysis = {
    labov: {
      elements: [
        { element: "evaluation", weight: 0.35, strength: 0.0 },
      ],
    },
  };
  const state = { turn_count: 2 };
  const result = buildQuestionTargeting(state, labovAnalysis, "test");
  assert.ok(result.includes("QUESTION STAGE: PROBING"));
});

test("buildQuestionTargeting includes emotional intensity for high emotion", () => {
  const { buildQuestionTargeting } = require("../../../src/writer/v3/prompts/builder");
  const labovAnalysis = {
    labov: {
      elements: [
        { element: "orientation", weight: 0.20, strength: 0.0 },
        { element: "complicating_action", weight: 0.25, strength: 0.0 },
        { element: "evaluation", weight: 0.35, strength: 0.0 },
        { element: "resolution", weight: 0.10, strength: 0.0 },
        { element: "coda", weight: 0.05, strength: 0.0 },
        { element: "specificity_bonus", weight: 0.05, strength: 0.0 },
      ],
    },
  };
  const state = { turn_count: 2 };
  // High emotion: vulnerability + first_person_emotion
  const msg = "When she died, I felt like I lost everything.";
  const result = buildQuestionTargeting(state, labovAnalysis, msg);
  assert.ok(result.includes("EMOTIONAL INTENSITY: high"));
  assert.ok(result.includes("Deepen this emotional thread"));
});

test("buildQuestionTargeting includes emotion override when high emotion and target is not evaluation", () => {
  const { buildQuestionTargeting } = require("../../../src/writer/v3/prompts/builder");
  const labovAnalysis = {
    labov: {
      elements: [
        { element: "orientation", weight: 0.20, strength: 0.0 },
        { element: "complicating_action", weight: 0.25, strength: 0.0 },
        // evaluation already covered — so another element will be targeted
        { element: "evaluation", weight: 0.35, strength: 0.9 },
        { element: "resolution", weight: 0.10, strength: 0.0 },
        { element: "coda", weight: 0.05, strength: 0.0 },
        { element: "specificity_bonus", weight: 0.05, strength: 0.0 },
      ],
    },
  };
  const state = { turn_count: 2 };
  const msg = "When she died, I felt like I lost everything.";
  const result = buildQuestionTargeting(state, labovAnalysis, msg);
  assert.ok(result.includes("EMOTION OVERRIDE"));
  assert.ok(result.includes("evaluation"));
});

test("buildQuestionTargeting includes Yes-And instruction with user message", () => {
  const { buildQuestionTargeting } = require("../../../src/writer/v3/prompts/builder");
  const labovAnalysis = {
    labov: {
      elements: [
        { element: "evaluation", weight: 0.35, strength: 0.0 },
      ],
    },
  };
  const state = { turn_count: 1 };
  const msg = "Sarah is my best friend from college.";
  const result = buildQuestionTargeting(state, labovAnalysis, msg);
  assert.ok(result.includes("The user just said"));
  assert.ok(result.includes("Sarah is my best friend"));
  assert.ok(result.includes("Yes, And"));
});

test("buildQuestionTargeting truncates long user messages", () => {
  const { buildQuestionTargeting } = require("../../../src/writer/v3/prompts/builder");
  const labovAnalysis = {
    labov: {
      elements: [
        { element: "evaluation", weight: 0.35, strength: 0.0 },
      ],
    },
  };
  const state = { turn_count: 1 };
  const msg = "A".repeat(300);
  const result = buildQuestionTargeting(state, labovAnalysis, msg);
  assert.ok(result.includes("..."));
  // Should not contain 300 A's
  assert.ok(!result.includes("A".repeat(300)));
});

test("buildQuestionTargeting reports story ready when all elements covered", () => {
  const { buildQuestionTargeting } = require("../../../src/writer/v3/prompts/builder");
  const labovAnalysis = {
    labov: {
      elements: [
        { element: "orientation", weight: 0.20, strength: 0.8 },
        { element: "complicating_action", weight: 0.25, strength: 0.7 },
        { element: "evaluation", weight: 0.35, strength: 0.9 },
        { element: "resolution", weight: 0.10, strength: 0.6 },
        { element: "coda", weight: 0.05, strength: 0.8 },
        { element: "specificity_bonus", weight: 0.05, strength: 0.7 },
      ],
    },
  };
  const state = { turn_count: 3 };
  const result = buildQuestionTargeting(state, labovAnalysis, "test");
  assert.ok(result.includes("None"));
  assert.ok(result.includes("sufficiently covered"));
});

// ---------------------------------------------------------------------------
// Integration: {{question_targeting}} appears in built prompt
// ---------------------------------------------------------------------------

test("buildContextPrompt replaces {{question_targeting}} placeholder", () => {
  const { buildContextPrompt } = require("../../../src/writer/v3/prompts/builder");
  const { createInitialState } = require("../../../src/writer/v3/state");
  const state = createInitialState({
    recipientName: "Sarah",
    occasion: "birthday",
    initialPrompt: "seed",
  });
  // Attach labov_analysis as if from a previous turn
  state.labov_analysis = {
    labov: {
      elements: [
        { element: "orientation", weight: 0.20, strength: 0.0 },
        { element: "complicating_action", weight: 0.25, strength: 0.0 },
        { element: "evaluation", weight: 0.35, strength: 0.0 },
        { element: "resolution", weight: 0.10, strength: 0.0 },
        { element: "coda", weight: 0.05, strength: 0.0 },
        { element: "specificity_bonus", weight: 0.05, strength: 0.0 },
      ],
    },
  };
  const prompt = buildContextPrompt(state, "Sarah is my best friend");
  // Should NOT contain the raw placeholder
  assert.ok(!prompt.includes("{{question_targeting}}"));
  // Should contain targeting content when labov data exists
  assert.ok(prompt.includes("QUESTION TARGET") || prompt.includes("QUESTION STAGE"));
});

test("buildContextPrompt renders empty question_targeting for non-labov sessions", () => {
  const { buildContextPrompt } = require("../../../src/writer/v3/prompts/builder");
  const { createInitialState } = require("../../../src/writer/v3/state");
  const state = createInitialState({
    recipientName: "Sarah",
    occasion: "birthday",
    initialPrompt: "seed",
  });
  // No labov_analysis on state = legacy session
  const prompt = buildContextPrompt(state, "hello");
  assert.ok(!prompt.includes("{{question_targeting}}"));
});
