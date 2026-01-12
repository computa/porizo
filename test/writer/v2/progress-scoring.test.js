/**
 * V2 Progress Scoring Tests
 *
 * Tests that progress scoring is consistent and on 0-100 scale.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

describe("V2 Progress Scoring", () => {
  const { getCompletionScore } = require("../../../src/writer/v2/quality");

  it("should return 0-100 scale consistently", () => {
    const state = {
      beats: [
        { id: "scene", status: "covered", required: true },
        { id: "meaning", status: "missing", required: true },
        { id: "turning_point", status: "weak", required: true },
        { id: "sensory", status: "missing", required: false }, // Not required, ignored
      ],
    };

    const score = getCompletionScore(state);

    // 1 covered + 0.5 weak = 1.5 out of 3 required = 50%
    assert.ok(score >= 0 && score <= 100, `Score should be 0-100, got ${score}`);
    assert.strictEqual(score, 50, "Should be 50% with 1 covered + 1 weak out of 3 required");
  });

  it("should return 0 for no beats", () => {
    const state = { beats: [] };
    assert.strictEqual(getCompletionScore(state), 0);
  });

  it("should return 100 when all required beats covered", () => {
    const state = {
      beats: [
        { id: "scene", status: "covered", required: true },
        { id: "meaning", status: "covered", required: true },
        { id: "stakes", status: "covered", required: true },
      ],
    };

    const score = getCompletionScore(state);
    assert.strictEqual(score, 100, "Should be 100% when all required beats covered");
  });

  it("should return 100 when no required beats (all optional)", () => {
    const state = {
      beats: [
        { id: "sensory", status: "missing", required: false },
        { id: "memory", status: "missing", required: false },
      ],
    };

    const score = getCompletionScore(state);
    assert.strictEqual(score, 100, "Should be 100% when no required beats");
  });

  it("should count weak as 0.5", () => {
    const state = {
      beats: [
        { id: "scene", status: "weak", required: true },
        { id: "meaning", status: "weak", required: true },
      ],
    };

    const score = getCompletionScore(state);
    // 0.5 + 0.5 = 1 out of 2 = 50%
    assert.strictEqual(score, 50, "Should be 50% with 2 weak out of 2 required");
  });

  it("should incorporate reasoning confidence when available", () => {
    const stateBase = {
      beats: [
        { id: "scene", status: "covered", required: true },
        { id: "meaning", status: "covered", required: true },
      ],
    };

    // Without confidence
    const scoreNoConfidence = getCompletionScore(stateBase);

    // With high confidence
    const stateHighConfidence = {
      ...stateBase,
      last_reasoning: { confidence: 0.9 },
    };
    const scoreHighConfidence = getCompletionScore(stateHighConfidence);

    // With low confidence
    const stateLowConfidence = {
      ...stateBase,
      last_reasoning: { confidence: 0.3 },
    };
    const scoreLowConfidence = getCompletionScore(stateLowConfidence);

    // Base score should be 100% (all covered)
    assert.strictEqual(scoreNoConfidence, 100);

    // High confidence should not decrease score much
    assert.ok(scoreHighConfidence >= 90, `High confidence should give >= 90, got ${scoreHighConfidence}`);

    // Low confidence can decrease but should stay reasonable
    assert.ok(scoreLowConfidence >= 50 && scoreLowConfidence <= 100,
      `Low confidence score should be 50-100, got ${scoreLowConfidence}`);
  });
});

describe("V2 Progress in API Response", () => {
  // This tests that the wrapper doesn't double-multiply the score
  it("should not double-multiply completion score", () => {
    const { getCompletionScore } = require("../../../src/writer/v2/quality");

    const state = {
      beats: [
        { id: "scene", status: "covered", required: true },
        { id: "meaning", status: "missing", required: true },
      ],
    };

    const score = getCompletionScore(state);

    // Score should be 50 (1 out of 2 covered = 50%)
    assert.strictEqual(score, 50);

    // If someone does score * 100, they'd get 5000 which is wrong
    assert.ok(score <= 100, "Score must not exceed 100 - do not multiply by 100 again");
  });
});
