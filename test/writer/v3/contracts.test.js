const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  validatePlanningOutput,
  validateBackendTask,
  validateDebugReport,
  validatePatternExtraction,
  validateTrajectoryExample,
  assertValid,
} = require("../../../src/writer/v3/orchestration/contracts");

describe("V3 Orchestration Contracts", () => {
  it("validates planning output", () => {
    const result = validatePlanningOutput({
      architecture: {
        new_modules: ["a"],
        modified_modules: ["b"],
        api_changes: ["c"],
      },
      milestones: [{ id: "M1", name: "Gap model" }],
    });

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.value.milestones[0].id, "M1");
  });

  it("rejects invalid backend task payload", () => {
    const result = validateBackendTask({ milestone: "" });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it("validates debug report shape", () => {
    const result = validateDebugReport({
      run_id: "run-1",
      passed: false,
      checks: [
        { name: "GET /health", passed: true, expected_status: 200, actual_status: 200 },
        { name: "POST /story/start", passed: false, expected_status: 200, actual_status: 500, error: "boom" },
      ],
    });

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.value.failures.length, 1);
  });

  it("validates pattern extraction payload", () => {
    const result = validatePatternExtraction({
      repository: "porizo",
      patterns: [{ type: "http_route", pattern: "POST /story/start", evidence: ["src/routes/story.js"] }],
    });
    assert.strictEqual(result.valid, true);
  });

  it("validates trajectory example payload", () => {
    const result = validateTrajectoryExample({
      objective: "rebuild story flow",
      steps: [{ id: "1", instruction: "Create route" }],
      metadata: {},
    });
    assert.strictEqual(result.valid, true);
  });

  it("assertValid throws for invalid payload", () => {
    const invalid = validatePlanningOutput({});
    assert.throws(() => assertValid("planning_output", invalid), /Invalid planning_output/);
  });
});
