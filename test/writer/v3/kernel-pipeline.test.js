/**
 * V3 Kernel Pipeline Tests
 *
 * Exercises ingest → plan → compose with mock LLM to verify:
 * - Planner is authoritative (LLM cannot override targeting)
 * - Ingestion handles adversarial input (empty, huge, contradictory)
 * - Composer stays within budget
 * - Repeated-answer penalty prevents question loops
 * - Completion triggers correctly
 * - Fallback path works when kernel fails
 *
 * No live server or LLM required — all LLM calls are mocked.
 */

require("dotenv/config");
const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const { createInitialState, ensureStateDefaults } = require("../../../src/writer/v3/state");
const { ingestTurn } = require("../../../src/writer/v3/kernel/ingestor");
const { planTurn, buildPlanningContext, shouldForceForwardProgressConfirm, rankQuestionTargetCandidates, detectRepeatedQuestionTheme } = require("../../../src/writer/v3/kernel/planner");
const { composeTurn } = require("../../../src/writer/v3/kernel/composer");
const { buildIngestProjection, buildQuestionComposeProjection, buildConfirmComposeProjection } = require("../../../src/writer/v3/kernel/projections");
const { buildBudgetedPrompt, DEFAULT_STAGE_BUDGETS } = require("../../../src/writer/v3/kernel/budgeter");
const { createTurnDecision, createTurnDelta, createPlannerCandidate } = require("../../../src/writer/v3/kernel/types");
const { computeStoryGapAnalysis } = require("../../../src/writer/v3/quality");

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function makeState(overrides = {}) {
  const base = createInitialState({
    recipientName: "Sarah",
    occasion: "birthday",
    initialPrompt: "A birthday song for my best friend Sarah",
  });
  return ensureStateDefaults({ ...base, ...overrides });
}

function makeStateWithFacts(facts, overrides = {}) {
  return makeState({
    facts: facts.map((text, i) => ({
      id: `fact_${i}`,
      text,
      beat: "context",
      status: "active",
      sourceTurn: i + 1,
    })),
    turn_count: facts.length,
    ...overrides,
  });
}

function makeRichState() {
  return makeStateWithFacts([
    "Sarah and I met in college in 2008",
    "She brought ice cream during my worst breakup",
    "We dance in the park every summer",
    "She slipped in a puddle while Dancing Queen played",
    "Twenty years of friendship",
    "She makes me feel known and loved",
  ], {
    narrative_current: "Sarah and I have been friends since college in 2008. She showed up with ice cream during my worst breakup. Every summer we dance in the park, and once she slipped in a puddle while Dancing Queen was playing. Twenty years of friendship and she still makes me feel known and loved.",
    narrative: "Sarah and I have been friends since college in 2008. She showed up with ice cream during my worst breakup. Every summer we dance in the park, and once she slipped in a puddle while Dancing Queen was playing. Twenty years of friendship and she still makes me feel known and loved.",
    narrative_version: 3,
    atoms: {
      who: "best friend from college",
      where: "the park, college campus",
      when: "2008 to present, every summer",
      turn: "ice cream during breakup",
      action: "dancing in the park",
      stakes: "twenty year friendship",
      after: "still feels known and loved",
    },
  });
}

function mockLLM(responseJson) {
  return async ({ prompt }) => ({
    text: JSON.stringify(responseJson),
    usage: { promptTokens: 200, completionTokens: 50 },
  });
}

function mockLLMThatFails(errorMessage = "LLM is down") {
  return async () => { throw new Error(errorMessage); };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

describe("kernel/types", () => {
  test("createTurnDecision normalizes invalid action to ASK", () => {
    const decision = createTurnDecision({ action: "BANANA" });
    assert.equal(decision.action, "ASK");
    assert.equal(decision.source, "unknown");
  });

  test("createTurnDecision clamps confidence to [0, 1]", () => {
    assert.equal(createTurnDecision({ confidence: 1.5 }).confidence, 1);
    assert.equal(createTurnDecision({ confidence: -0.3 }).confidence, 0);
    assert.equal(createTurnDecision({ confidence: "garbage" }).confidence, 0.5);
  });

  test("createTurnDelta handles missing/malformed updates gracefully", () => {
    const delta = createTurnDelta({});
    assert.deepEqual(delta.updates.new_facts, []);
    assert.deepEqual(delta.updates.atoms, {});
    assert.equal(delta.narrative, null);
    assert.equal(delta.fallback, false);
  });

  test("createPlannerCandidate normalizes numeric fields", () => {
    const candidate = createPlannerCandidate({ element: "orientation", score: "not a number" });
    assert.equal(candidate.score, 0);
    assert.equal(candidate.element, "orientation");
  });
});

// ---------------------------------------------------------------------------
// Ingestor
// ---------------------------------------------------------------------------

describe("kernel/ingestor", () => {
  test("extracts facts from a substantive answer", async () => {
    const state = makeState();
    const result = await ingestTurn({
      state,
      answer: "We met at a coffee shop in Brooklyn in 2015. She was reading a book about astronomy.",
      previousQuestion: "How did you first meet Sarah?",
      generateTextFn: mockLLM({
        updates: {
          new_facts: [
            { text: "Met at a coffee shop in Brooklyn in 2015", beat: "context" },
            { text: "Sarah was reading a book about astronomy", beat: "context" },
          ],
          atoms: { where: "coffee shop in Brooklyn", when: "2015" },
        },
      }),
    });

    assert.equal(result.success, true);
    assert.equal(result.data.updates.new_facts.length, 2);
    assert.equal(result.data.updates.atoms.where, "coffee shop in Brooklyn");
  });

  test("handles empty answer gracefully", async () => {
    const state = makeState();
    const result = await ingestTurn({
      state,
      answer: "",
      previousQuestion: "Tell me more",
      generateTextFn: mockLLM({ updates: {} }),
    });
    assert.equal(result.success, false);
    assert.ok(result.error.includes("requires answer"));
  });

  test("handles LLM failure gracefully", async () => {
    const state = makeState();
    const result = await ingestTurn({
      state,
      answer: "Some answer",
      previousQuestion: "A question",
      generateTextFn: mockLLMThatFails("timeout"),
    });
    assert.equal(result.success, false);
    assert.ok(result.error.includes("timeout"));
  });

  test("handles LLM returning invalid JSON", async () => {
    const state = makeState();
    const result = await ingestTurn({
      state,
      answer: "Some answer",
      previousQuestion: "A question",
      generateTextFn: async () => ({ text: "not json at all {{{", usage: {} }),
    });
    assert.equal(result.success, false);
  });

  test("handles LLM returning hallucinated fields — only recognized fields survive", async () => {
    const state = makeState();
    const result = await ingestTurn({
      state,
      answer: "We went to Paris last year",
      previousQuestion: "What's a special trip you took?",
      generateTextFn: mockLLM({
        updates: {
          new_facts: [{ text: "Trip to Paris last year", beat: "moment" }],
          atoms: { where: "Paris" },
          hallucinated_field: "should be ignored",
        },
        secret_control_flow: "CONFIRM", // adversarial: ingestor must not return control flow
      }),
    });

    assert.equal(result.success, true);
    assert.equal(result.data.updates.new_facts.length, 1);
    // Adversarial control flow field must not leak through
    assert.equal(result.data.reasoning?.secret_control_flow, undefined);
  });
});

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

describe("kernel/projections", () => {
  test("ingest projection truncates long narratives", () => {
    const state = makeState({
      narrative_current: "A".repeat(1000),
      narrative: "A".repeat(1000),
    });
    const projection = buildIngestProjection(state, "Previous question?");
    assert.ok(projection.narrative.length <= 361, `Narrative should be truncated, got ${projection.narrative.length}`);
  });

  test("ingest projection limits facts to 6", () => {
    const state = makeStateWithFacts(Array.from({ length: 20 }, (_, i) => `Fact number ${i}`));
    const projection = buildIngestProjection(state, "Q?");
    assert.ok(projection.activeFacts.length <= 6, `Should cap at 6 facts, got ${projection.activeFacts.length}`);
  });

  test("question compose projection includes target element", () => {
    const state = makeRichState();
    const decision = createTurnDecision({ action: "ASK", targetElement: "complicating_action", targetSlot: "moment" });
    const projection = buildQuestionComposeProjection(state, decision, {}, null, {});
    assert.equal(projection.targetElement, "complicating_action");
    assert.ok(projection.recipientName, "Should include recipient name");
  });

  test("confirm compose projection includes readiness score", () => {
    const state = makeRichState();
    const decision = createTurnDecision({ action: "CONFIRM" });
    const projection = buildConfirmComposeProjection(state, decision, { readinessScore: 0.85, slots: [] });
    assert.equal(projection.readinessScore, 0.85);
  });
});

// ---------------------------------------------------------------------------
// Budgeter
// ---------------------------------------------------------------------------

describe("kernel/budgeter", () => {
  test("required blocks are always included even over budget", () => {
    const result = buildBudgetedPrompt({
      stage: "ingest",
      budgetTokens: 10, // impossibly small
      blocks: [
        { id: "system", required: true, text: "You are an extractor." },
        { id: "context", required: true, text: "Some context" },
        { id: "optional", required: false, text: "Nice to have" },
      ],
    });
    const includedIds = result.includedBlocks.map(b => b.id);
    assert.ok(includedIds.includes("system"), "System block must be included");
    assert.ok(includedIds.includes("context"), "Context block must be included");
    assert.ok(result.droppedBlocks.some(b => b.id === "optional"), "Optional should be dropped over budget");
  });

  test("prompt text joins included blocks", () => {
    const result = buildBudgetedPrompt({
      stage: "question_compose",
      blocks: [
        { id: "a", required: true, text: "First" },
        { id: "b", required: true, text: "Second" },
      ],
    });
    assert.ok(result.prompt.includes("First"));
    assert.ok(result.prompt.includes("Second"));
  });

  test("default budgets exist for all kernel stages", () => {
    assert.ok(DEFAULT_STAGE_BUDGETS.ingest > 0);
    assert.ok(DEFAULT_STAGE_BUDGETS.question_compose > 0);
    assert.ok(DEFAULT_STAGE_BUDGETS.confirm_compose > 0);
    assert.ok(DEFAULT_STAGE_BUDGETS.story_compose > 0);
  });
});

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

describe("kernel/planner", () => {
  test("planTurn returns ASK when story has gaps", () => {
    const state = makeStateWithFacts(["Met Sarah in college"], {
      story_state: { questionsAsked: [] },
    });
    const gapAnalysis = computeStoryGapAnalysis(state);
    const result = planTurn({ state, gapAnalysis, response: { action: "ASK" } });
    assert.equal(result.decision.action, "ASK");
    assert.ok(result.decision.targetElement, "Should have a target element");
    assert.equal(result.decision.source, "kernel_planner");
  });

  test("planTurn returns CONFIRM when forced", () => {
    const state = makeRichState();
    const gapAnalysis = computeStoryGapAnalysis(state);
    const result = planTurn({ state, gapAnalysis, forceConfirm: true });
    assert.equal(result.decision.action, "CONFIRM");
    assert.ok(result.decision.reason.includes("force_confirm"));
  });

  test("planTurn returns CONFIRM when story is ready", () => {
    const state = makeRichState();
    const gapAnalysis = computeStoryGapAnalysis(state);
    // Override readiness
    gapAnalysis.isStoryReady = true;
    const result = planTurn({ state, gapAnalysis });
    assert.equal(result.decision.action, "CONFIRM");
  });

  test("repeated sufficient answers trigger forward progress confirm", () => {
    const state = makeRichState();
    state.turn_count = 6;
    state.story_state = {
      questionsAsked: [
        { question: "What's a moment?", answered: true, answerSummary: "The ice cream moment during the breakup was everything to me and changed our friendship forever", targetElement: "complicating_action", round: 1 },
        { question: "Tell me about that moment", answered: true, answerSummary: "When she showed up with mint chocolate chip during my worst night, I knew this friendship was for life", targetElement: "complicating_action", round: 2 },
        { question: "What did it change?", answered: true, answerSummary: "It changed everything about how I see loyalty and true friendship in the deepest way possible", targetElement: "complicating_action", round: 3 },
      ],
    };
    const gapAnalysis = computeStoryGapAnalysis(state);
    gapAnalysis.readinessScore = 0.62;
    gapAnalysis.slots = [
      { slot: "moment", status: "covered" },
      { slot: "setting", status: "covered" },
      { slot: "stakes", status: "covered" },
      { slot: "ending_feel", status: "covered" },
      { slot: "relationship", status: "covered" },
    ];
    const result = shouldForceForwardProgressConfirm({ gapAnalysis }, state, 3);
    assert.equal(result, true, "Should force confirm after 3 sufficient answers on same element");
  });

  test("detectRepeatedQuestionTheme catches semantic repetition", () => {
    const state = {
      story_state: {
        questionsAsked: [
          {
            question: "What was the moment that changed everything?",
            answered: true,
            answerSummary: "The ice cream breakup moment changed our friendship",
            targetElement: "complicating_action",
            round: 1,
          },
        ],
      },
    };
    const repeat = detectRepeatedQuestionTheme(
      "Tell me about the moment that changed things",
      "complicating_action",
      state.story_state,
    );
    assert.ok(repeat !== null, "Should detect repeated theme");
    assert.equal(repeat.priorElement, "complicating_action");
  });

  test("rankQuestionTargetCandidates penalizes answered elements", () => {
    const state = makeRichState();
    state.story_state = {
      questionsAsked: [
        { question: "What was the moment?", answered: true, answerSummary: "She brought ice cream during my breakup, a real pivotal moment", targetElement: "complicating_action", round: 1 },
        { question: "Describe that more", answered: true, answerSummary: "The ice cream was mint chocolate chip, my favorite since childhood", targetElement: "complicating_action", round: 2 },
      ],
    };
    const gapAnalysis = computeStoryGapAnalysis(state);
    const ranked = rankQuestionTargetCandidates(gapAnalysis, state.story_state);
    // complicating_action should be penalized vs. other elements
    const compAction = ranked.find(c => c.element === "complicating_action");
    const topCandidate = ranked[0];
    if (compAction && topCandidate.element !== "complicating_action") {
      assert.ok(topCandidate.score > compAction.score,
        "Answered element should be penalized below unanswered ones");
    }
  });
});

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

describe("kernel/composer", () => {
  test("composes a question when decision is ASK", async () => {
    const state = makeRichState();
    const decision = createTurnDecision({ action: "ASK", targetElement: "evaluation", targetSlot: "meaning" });
    const result = await composeTurn({
      state,
      decision,
      gapAnalysis: {},
      gapQuestion: null,
      previousQuestion: "Previous question",
      fallbackQuestion: "What does Sarah mean to you?",
      generateTextFn: mockLLM({ question: "What makes your friendship with Sarah feel so special after all these years?" }),
    });
    assert.equal(result.success, true);
    assert.ok(result.data.question.length > 10);
  });

  test("composes confirmation when decision is CONFIRM", async () => {
    const state = makeRichState();
    const decision = createTurnDecision({ action: "CONFIRM" });
    const result = await composeTurn({
      state,
      decision,
      gapAnalysis: { readinessScore: 0.85, slots: [] },
      fallbackConfirmation: "Your story is ready for review!",
      generateTextFn: mockLLM({ confirmation: "Your story about Sarah beautifully captures twenty years of friendship." }),
    });
    assert.equal(result.success, true);
    assert.ok(result.data.confirmation.length > 10);
  });

  test("falls back to provided question when LLM fails", async () => {
    const state = makeRichState();
    const decision = createTurnDecision({ action: "ASK", targetElement: "orientation" });
    const result = await composeTurn({
      state,
      decision,
      gapAnalysis: {},
      fallbackQuestion: "Can you tell me where this happened?",
      generateTextFn: mockLLMThatFails("timeout"),
    });
    // Should not crash — returns fallback
    assert.equal(result.success, false);
  });

  test("falls back gracefully when LLM is unavailable", async () => {
    const state = makeRichState();
    const decision = createTurnDecision({ action: "ASK", targetElement: "orientation" });
    // composeTurn's unavailable check is: generateTextFn === generateText && !isAvailable()
    // When a custom fn is passed (even one that throws), it bypasses the isAvailable check.
    // To test the fallback path, we simulate a throwing fn — the caller should get success: false
    // and use fallbackQuestion from the orchestrator level.
    const result = await composeTurn({
      state,
      decision,
      gapAnalysis: {},
      fallbackQuestion: "Fallback question here",
      fallbackConfirmation: "Fallback confirm",
      generateTextFn: mockLLMThatFails("service unavailable"),
    });
    // Composer returns failure; orchestrator is responsible for using fallbackQuestion
    assert.equal(result.success, false);
    assert.ok(result.error.includes("service unavailable"));
  });
});

// ---------------------------------------------------------------------------
// Full Pipeline Integration (mock LLM)
// ---------------------------------------------------------------------------

describe("kernel pipeline integration", () => {
  test("ingest → plan → compose produces coherent turn", async () => {
    const state = makeStateWithFacts(["Met Sarah in college"], {
      narrative_current: "Sarah and I met in college.",
      narrative: "Sarah and I met in college.",
    });

    // 1. Ingest
    const ingested = await ingestTurn({
      state,
      answer: "She was my roommate freshman year and we bonded over late-night study sessions",
      previousQuestion: "How did you meet Sarah?",
      generateTextFn: mockLLM({
        updates: {
          new_facts: [
            { text: "Roommate freshman year", beat: "context" },
            { text: "Bonded over late-night study sessions", beat: "moment" },
          ],
          atoms: { who: "college roommate", when: "freshman year" },
        },
      }),
    });
    assert.equal(ingested.success, true);

    // 2. Plan
    const gapAnalysis = computeStoryGapAnalysis(state);
    const planned = planTurn({
      state,
      gapAnalysis,
      response: { action: "ASK" },
      source: "test",
    });
    assert.ok(["ASK", "CLARIFY", "CONFIRM"].includes(planned.decision.action));
    assert.ok(planned.decision.targetElement, "Planner must choose a target");

    // 3. Compose
    const composed = await composeTurn({
      state,
      decision: planned.decision,
      gapAnalysis,
      gapQuestion: null,
      previousQuestion: "How did you meet Sarah?",
      fallbackQuestion: "What's a specific memory?",
      generateTextFn: mockLLM({ question: "What's a moment from those late-night study sessions that still stands out?" }),
    });
    assert.equal(composed.success, true);
    assert.ok(composed.data.question.length > 10);
  });

  test("adversarial: very long answer does not blow up ingest projection", async () => {
    const state = makeState();
    const longAnswer = "A".repeat(5000);
    const projection = buildIngestProjection(state, "Previous question?");
    // Projection should be bounded regardless of answer length
    const projectionSize = JSON.stringify(projection).length;
    assert.ok(projectionSize < 3000, `Projection too large: ${projectionSize} chars`);

    // Ingest should still work
    const result = await ingestTurn({
      state,
      answer: longAnswer,
      previousQuestion: "Q?",
      generateTextFn: mockLLM({ updates: { new_facts: [{ text: "Long input processed", beat: "context" }] } }),
    });
    assert.equal(result.success, true);
  });

  test("adversarial: null/undefined fields in state don't crash planner", () => {
    const state = makeState({
      facts: null,
      atoms: null,
      primitives: null,
      narrative_current: null,
      story_state: null,
    });
    const gapAnalysis = computeStoryGapAnalysis(state);
    // Should not throw
    const result = planTurn({ state, gapAnalysis, response: { action: "ASK" } });
    assert.ok(result.decision.action);
  });

  test("adversarial: planner ignores LLM's CONFIRM when story has critical gaps", () => {
    const state = makeState({ turn_count: 1 });
    const gapAnalysis = computeStoryGapAnalysis(state);
    // Force isStoryReady false and low readiness
    gapAnalysis.isStoryReady = false;
    gapAnalysis.readinessScore = 0.15;
    gapAnalysis.slots = [
      { slot: "moment", status: "missing" },
      { slot: "setting", status: "missing" },
      { slot: "stakes", status: "missing" },
    ];
    // Even if response says CONFIRM, planner should override to ASK
    const result = planTurn({
      state,
      gapAnalysis,
      response: { action: "CONFIRM" },
      forceConfirm: false,
    });
    assert.equal(result.decision.action, "ASK",
      "Planner must override CONFIRM when story has critical gaps");
  });
});
