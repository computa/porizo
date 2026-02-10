const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  normalizePlanningOutput,
  buildBackendTaskEnvelope,
  runDebugFeedbackLoop,
  extractPatternEnvelope,
  buildTrajectoryEnvelope,
} = require("../../../src/writer/v3/orchestration");

describe("V3 Orchestration Pipeline", () => {
  it("normalizes valid planning output", () => {
    const output = normalizePlanningOutput({
      architecture: {
        new_modules: ["src/writer/v3/orchestration/index.js"],
        modified_modules: ["src/writer/v2/index.js"],
        api_changes: ["optional metadata"],
      },
      milestones: [{ id: "M1", name: "Gap model" }],
    });

    assert.strictEqual(output.milestones.length, 1);
  });

  it("validates backend task envelope", () => {
    const task = buildBackendTaskEnvelope({
      milestone: "M2",
      design_refs: ["specv3#7"],
      target_files: ["src/writer/v2/index.js"],
    });

    assert.strictEqual(task.milestone, "M2");
  });

  it("runs debug feedback loop until pass", async () => {
    let calls = 0;
    const fakeRunner = async () => {
      calls += 1;
      return {
        run_id: `run-${calls}`,
        passed: calls >= 2,
        checks: [
          {
            name: "check",
            passed: calls >= 2,
            expected_status: 200,
            actual_status: calls >= 2 ? 200 : 500,
          },
        ],
      };
    };

    const result = await runDebugFeedbackLoop({
      baseUrl: "http://localhost:3000",
      checks: [{ method: "GET", path: "/health", expectedStatus: 200 }],
      runChecks: fakeRunner,
      maxAttempts: 3,
    });

    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.attempts, 2);
  });

  it("extracts repository patterns and builds trajectory envelope", () => {
    const patternExtraction = extractPatternEnvelope({
      repository: "porizo",
      files: [
        {
          path: "src/routes/story.js",
          content: "app.post('/story/start', async () => {});",
        },
        {
          path: "test/story.test.js",
          content: "const { describe } = require('node:test');",
        },
      ],
    });

    assert.ok(patternExtraction.patterns.length >= 1);

    const trajectory = buildTrajectoryEnvelope({
      objective: "Rebuild story flow from extracted patterns",
      plan: { milestones: ["M1"] },
      patternExtraction,
      reconstructionSteps: [
        { id: "1", instruction: "Create story route skeleton" },
      ],
    });

    assert.strictEqual(trajectory.steps.length, 1);
    assert.ok(trajectory.extracted_patterns.patterns.length >= 1);
  });
});
