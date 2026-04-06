/**
 * Autoresearch Story Tests
 *
 * Tests for the autoresearch optimization system's core logic.
 * These test the pure functions extracted from the runner script
 * without requiring a running server or LLM calls.
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");

// We'll import from the runner's exported module
// The runner exports its pure functions for testing
const {
  TEST_INPUTS,
  EVAL_NAMES,
  parseEvalResponse,
  computeScore,
  computePerEvalBreakdown,
  shouldKeepExperiment,
  buildEvalPrompt,
  buildResultsJson,
  createExperimentEntry,
  parseCliArgs,
  evaluateThreshold,
} = require("../scripts/autoresearch-story");

describe("Autoresearch Story", () => {
  describe("TEST_INPUTS", () => {
    it("has exactly 5 test inputs", () => {
      assert.strictEqual(TEST_INPUTS.length, 5);
    });

    it("each input has required fields", () => {
      for (const input of TEST_INPUTS) {
        assert.ok(input.id, `input missing id`);
        assert.ok(input.name, `input ${input.id} missing name`);
        assert.ok(input.message, `input ${input.id} missing message`);
        assert.ok(input.occasion, `input ${input.id} missing occasion`);
        assert.ok(input.recipient_name, `input ${input.id} missing recipient_name`);
      }
    });

    it("covers different scenarios (rich, moderate, sparse, emotional, humor)", () => {
      const names = TEST_INPUTS.map(i => i.name.toLowerCase());
      assert.ok(names.some(n => n.includes("rich")), "missing rich scenario");
      assert.ok(names.some(n => n.includes("moderate")), "missing moderate scenario");
      assert.ok(names.some(n => n.includes("sparse")), "missing sparse scenario");
      assert.ok(names.some(n => n.includes("emotional")), "missing emotional scenario");
      assert.ok(names.some(n => n.includes("friendship") || n.includes("humor")), "missing humor/friendship scenario");
    });

    it("includes different occasions", () => {
      const occasions = new Set(TEST_INPUTS.map(i => i.occasion));
      assert.ok(occasions.has("birthday"), "missing birthday occasion");
      assert.ok(occasions.has("mothers_day"), "missing mothers_day occasion");
      assert.ok(occasions.has("friendship"), "missing friendship occasion");
    });
  });

  describe("EVAL_NAMES", () => {
    it("has exactly 6 eval names", () => {
      assert.strictEqual(EVAL_NAMES.length, 6);
    });
  });

  describe("parseEvalResponse", () => {
    it("parses a valid JSON eval response", () => {
      const raw = JSON.stringify({
        eval1: true,
        eval2: true,
        eval3: false,
        eval4: true,
        eval5: false,
        eval6: true,
      });
      const result = parseEvalResponse(raw);
      assert.deepStrictEqual(result, {
        eval1: true,
        eval2: true,
        eval3: false,
        eval4: true,
        eval5: false,
        eval6: true,
      });
    });

    it("extracts JSON from markdown code block", () => {
      const raw = 'Here is the result:\n```json\n{"eval1": true, "eval2": false, "eval3": true, "eval4": true, "eval5": false, "eval6": true}\n```';
      const result = parseEvalResponse(raw);
      assert.strictEqual(result.eval1, true);
      assert.strictEqual(result.eval2, false);
    });

    it("returns all-false for unparseable response", () => {
      const result = parseEvalResponse("I cannot evaluate this");
      assert.deepStrictEqual(result, {
        eval1: false,
        eval2: false,
        eval3: false,
        eval4: false,
        eval5: false,
        eval6: false,
      });
    });

    it("handles YES/NO string responses", () => {
      const raw = JSON.stringify({
        eval1: "YES",
        eval2: "NO",
        eval3: "yes",
        eval4: "no",
        eval5: true,
        eval6: false,
      });
      const result = parseEvalResponse(raw);
      assert.strictEqual(result.eval1, true);
      assert.strictEqual(result.eval2, false);
      assert.strictEqual(result.eval3, true);
      assert.strictEqual(result.eval4, false);
      assert.strictEqual(result.eval5, true);
      assert.strictEqual(result.eval6, false);
    });

    it("handles partial JSON (missing keys default to false)", () => {
      const raw = JSON.stringify({ eval1: true, eval3: true });
      const result = parseEvalResponse(raw);
      assert.strictEqual(result.eval1, true);
      assert.strictEqual(result.eval2, false);
      assert.strictEqual(result.eval3, true);
      assert.strictEqual(result.eval4, false);
    });
  });

  describe("computeScore", () => {
    it("computes correct score for all-pass", () => {
      const perInput = [
        { evals: { eval1: true, eval2: true, eval3: true, eval4: true, eval5: true, eval6: true } },
        { evals: { eval1: true, eval2: true, eval3: true, eval4: true, eval5: true, eval6: true } },
      ];
      const result = computeScore(perInput);
      assert.strictEqual(result.score, 12);
      assert.strictEqual(result.maxScore, 12);
      assert.strictEqual(result.passRate, 100);
    });

    it("computes correct score for mixed results", () => {
      const perInput = [
        { evals: { eval1: true, eval2: false, eval3: true, eval4: false, eval5: true, eval6: false } },
        { evals: { eval1: false, eval2: true, eval3: false, eval4: true, eval5: false, eval6: true } },
      ];
      const result = computeScore(perInput);
      assert.strictEqual(result.score, 6);
      assert.strictEqual(result.maxScore, 12);
      assert.strictEqual(result.passRate, 50);
    });

    it("computes correct score for all-fail", () => {
      const perInput = [
        { evals: { eval1: false, eval2: false, eval3: false, eval4: false, eval5: false, eval6: false } },
      ];
      const result = computeScore(perInput);
      assert.strictEqual(result.score, 0);
      assert.strictEqual(result.maxScore, 6);
      assert.strictEqual(result.passRate, 0);
    });
  });

  describe("computePerEvalBreakdown", () => {
    it("counts passes per eval across all inputs", () => {
      const perInput = [
        { evals: { eval1: true, eval2: true, eval3: false, eval4: false, eval5: true, eval6: false } },
        { evals: { eval1: true, eval2: false, eval3: false, eval4: true, eval5: true, eval6: false } },
        { evals: { eval1: false, eval2: true, eval3: true, eval4: false, eval5: false, eval6: true } },
      ];
      const breakdown = computePerEvalBreakdown(perInput);
      assert.strictEqual(breakdown.length, 6);
      // eval1: 2 pass out of 3
      assert.strictEqual(breakdown[0].pass, 2);
      assert.strictEqual(breakdown[0].total, 3);
      // eval3: 1 pass out of 3
      assert.strictEqual(breakdown[2].pass, 1);
      assert.strictEqual(breakdown[2].total, 3);
    });

    it("returns eval names in breakdown", () => {
      const perInput = [
        { evals: { eval1: true, eval2: true, eval3: true, eval4: true, eval5: true, eval6: true } },
      ];
      const breakdown = computePerEvalBreakdown(perInput);
      assert.ok(breakdown[0].eval, "missing eval name");
      assert.ok(breakdown[5].eval, "missing eval name for last eval");
    });
  });

  describe("shouldKeepExperiment", () => {
    it("keeps experiment when score improves", () => {
      assert.strictEqual(shouldKeepExperiment(80, 70), true);
    });

    it("discards experiment when score decreases", () => {
      assert.strictEqual(shouldKeepExperiment(65, 70), false);
    });

    it("discards experiment when score stays the same", () => {
      assert.strictEqual(shouldKeepExperiment(70, 70), false);
    });
  });

  describe("parseCliArgs", () => {
    it("parses baseline-only flag and threshold score", () => {
      const result = parseCliArgs(["--baseline-only", "--threshold-score=27"]);
      assert.deepStrictEqual(result, {
        baselineOnly: true,
        thresholdScore: 27,
      });
    });

    it("ignores malformed threshold values", () => {
      const result = parseCliArgs(["--threshold-score=nope"]);
      assert.deepStrictEqual(result, {
        baselineOnly: false,
        thresholdScore: null,
      });
    });
  });

  describe("evaluateThreshold", () => {
    it("passes when score meets threshold", () => {
      assert.deepStrictEqual(evaluateThreshold(27, 27), {
        passed: true,
        thresholdScore: 27,
      });
    });

    it("fails when score is below threshold", () => {
      assert.deepStrictEqual(evaluateThreshold(26, 27), {
        passed: false,
        thresholdScore: 27,
      });
    });
  });

  describe("buildEvalPrompt", () => {
    it("includes user input in eval prompt", () => {
      const prompt = buildEvalPrompt("my story about Sarah", {
        narrative: "A beautiful story",
        question: "What happened next?",
        suggestions: ["The ice cream", "The park"],
      });
      assert.ok(prompt.includes("my story about Sarah"), "eval prompt must include user input");
    });

    it("includes AI response fields", () => {
      const prompt = buildEvalPrompt("test input", {
        narrative: "Test narrative",
        question: "Test question?",
        suggestions: ["Sug 1", "Sug 2"],
      });
      assert.ok(prompt.includes("Test narrative"), "must include narrative");
      assert.ok(prompt.includes("Test question?"), "must include question");
      assert.ok(prompt.includes("Sug 1"), "must include suggestions");
    });

    it("handles missing suggestions gracefully", () => {
      const prompt = buildEvalPrompt("test", {
        narrative: "Narrative",
        question: "Question?",
        suggestions: [],
      });
      assert.ok(prompt.includes("(none)") || prompt.includes("[]"), "should handle empty suggestions");
    });
  });

  describe("createExperimentEntry", () => {
    it("creates a properly structured experiment entry", () => {
      const perInput = [
        { input_id: 1, name: "Rich birthday", evals: { eval1: true, eval2: true, eval3: true, eval4: true, eval5: true, eval6: true } },
      ];
      const entry = createExperimentEntry({
        id: 0,
        status: "baseline",
        description: "original prompts",
        mutation: null,
        perInput,
      });
      assert.strictEqual(entry.id, 0);
      assert.strictEqual(entry.status, "baseline");
      assert.ok(entry.score >= 0, "must have score");
      assert.ok(entry.max_score > 0, "must have max_score");
      assert.ok(typeof entry.pass_rate === "number", "must have pass_rate");
      assert.ok(Array.isArray(entry.per_input), "must have per_input array");
      assert.ok(Array.isArray(entry.per_eval), "must have per_eval array");
    });
  });

  describe("buildResultsJson", () => {
    it("creates the correct top-level structure", () => {
      const experiments = [
        createExperimentEntry({
          id: 0,
          status: "baseline",
          description: "original prompts",
          mutation: null,
          perInput: [
            { input_id: 1, name: "Rich birthday", evals: { eval1: true, eval2: true, eval3: true, eval4: true, eval5: true, eval6: true } },
          ],
        }),
      ];
      const changelog = [];
      const result = buildResultsJson({
        status: "running",
        currentExperiment: 1,
        experiments,
        changelog,
      });
      assert.strictEqual(result.status, "running");
      assert.strictEqual(result.current_experiment, 1);
      assert.ok(typeof result.baseline_score === "number");
      assert.ok(typeof result.best_score === "number");
      assert.ok(Array.isArray(result.experiments));
      assert.ok(Array.isArray(result.changelog));
    });

    it("computes baseline_score from experiment 0", () => {
      const experiments = [
        createExperimentEntry({
          id: 0,
          status: "baseline",
          description: "original",
          mutation: null,
          perInput: [
            { input_id: 1, name: "test", evals: { eval1: true, eval2: false, eval3: true, eval4: false, eval5: true, eval6: false } },
          ],
        }),
      ];
      const result = buildResultsJson({
        status: "complete",
        currentExperiment: 0,
        experiments,
        changelog: [],
      });
      assert.strictEqual(result.baseline_score, 50);
    });

    it("computes best_score as the max pass_rate across experiments", () => {
      const exp0 = createExperimentEntry({
        id: 0,
        status: "baseline",
        description: "baseline",
        mutation: null,
        perInput: [
          { input_id: 1, name: "test", evals: { eval1: true, eval2: false, eval3: false, eval4: false, eval5: false, eval6: false } },
        ],
      });
      const exp1 = createExperimentEntry({
        id: 1,
        status: "keep",
        description: "improved",
        mutation: "added instruction",
        perInput: [
          { input_id: 1, name: "test", evals: { eval1: true, eval2: true, eval3: true, eval4: false, eval5: false, eval6: false } },
        ],
      });
      const result = buildResultsJson({
        status: "complete",
        currentExperiment: 1,
        experiments: [exp0, exp1],
        changelog: [],
      });
      assert.strictEqual(result.best_score, 50); // exp1: 3/6 = 50%
      assert.ok(result.baseline_score < result.best_score || result.baseline_score === result.best_score);
    });
  });
});
