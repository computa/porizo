/**
 * V2 Holistic Completion Assessment Tests
 *
 * V3: Completion is assessed holistically by the LLM, not by formula.
 * The LLM provides story_readiness with has_emotional_depth and element lists.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

describe("Holistic Completion Assessment", () => {
  const { getCompletionFromLLM } = require("../../../src/writer/v2/quality");

  describe("getCompletionFromLLM", () => {
    it("should use LLM story_readiness assessment", () => {
      const llmReasoning = {
        story_readiness: {
          has_emotional_depth: true,
          strong_elements: ["memory", "meaning"],
          weak_elements: ["scene"],
        },
      };

      const result = getCompletionFromLLM(llmReasoning);

      assert.strictEqual(result.hasEmotionalDepth, true);
      assert.ok(result.score >= 0 && result.score <= 100, "Score should be 0-100");
      assert.deepStrictEqual(result.strongElements, ["memory", "meaning"]);
      assert.deepStrictEqual(result.weakElements, ["scene"]);
    });

    it("should NOT use beat counting formula", () => {
      // Old formula would penalize for only having 1 strong element
      // V3 should respect LLM's holistic assessment
      const llmReasoning = {
        story_readiness: {
          has_emotional_depth: true, // LLM says story has emotional depth
          strong_elements: ["meaning"], // Only 1 strong element
          weak_elements: ["scene", "stakes"],
        },
      };

      const result = getCompletionFromLLM(llmReasoning);

      // Should respect LLM's "has_emotional_depth: true"
      assert.ok(result.score >= 50, `Should not penalize based on beat count alone, got ${result.score}`);
      assert.strictEqual(result.hasEmotionalDepth, true);
    });

    it("should give higher score when has depth AND strong elements", () => {
      const withDepthAndStrong = {
        story_readiness: {
          has_emotional_depth: true,
          strong_elements: ["scene", "meaning", "stakes"],
          weak_elements: [],
        },
      };

      const withDepthOnly = {
        story_readiness: {
          has_emotional_depth: true,
          strong_elements: [],
          weak_elements: ["scene", "meaning"],
        },
      };

      const resultStrong = getCompletionFromLLM(withDepthAndStrong);
      const resultDepthOnly = getCompletionFromLLM(withDepthOnly);

      assert.ok(resultStrong.score > resultDepthOnly.score,
        `Strong+depth (${resultStrong.score}) should score higher than depth-only (${resultDepthOnly.score})`);
    });

    it("should handle missing story_readiness gracefully", () => {
      const llmReasoning = {}; // No story_readiness

      const result = getCompletionFromLLM(llmReasoning);

      assert.strictEqual(result.hasEmotionalDepth, false);
      assert.ok(result.score >= 0 && result.score <= 100);
      assert.deepStrictEqual(result.strongElements, []);
      assert.deepStrictEqual(result.weakElements, []);
    });

    it("should handle null/undefined input", () => {
      assert.doesNotThrow(() => getCompletionFromLLM(null));
      assert.doesNotThrow(() => getCompletionFromLLM(undefined));

      const resultNull = getCompletionFromLLM(null);
      const resultUndef = getCompletionFromLLM(undefined);

      assert.strictEqual(resultNull.score >= 0, true);
      assert.strictEqual(resultUndef.score >= 0, true);
    });

    it("should cap score at 100", () => {
      const llmReasoning = {
        story_readiness: {
          has_emotional_depth: true,
          strong_elements: ["a", "b", "c", "d", "e", "f"], // Many strong elements
          weak_elements: [],
        },
      };

      const result = getCompletionFromLLM(llmReasoning);

      assert.strictEqual(result.score, 100);
    });
  });
});

describe("hasMinimumCoverage Fallback (v3 - strength support)", () => {
  const { hasMinimumCoverage } = require("../../../src/writer/v2/quality");

  it("should support strength-based beats", () => {
    const state = {
      beats: [
        { id: "scene", strength: 0.7, required: true }, // covered (>=0.6)
        { id: "meaning", strength: 0.8, required: true },
        { id: "turning_point", strength: 0.4, required: true }, // weak (0.3-0.59)
      ],
    };

    const result = hasMinimumCoverage(state);

    // Should pass: 3 beats, has meaning, has scene, has turning_point (pivot)
    assert.strictEqual(result, true);
  });

  it("should support legacy status-based beats", () => {
    const state = {
      beats: [
        { id: "scene", status: "covered", required: true },
        { id: "meaning", status: "covered", required: true },
        { id: "stakes", status: "weak", required: true },
      ],
    };

    const result = hasMinimumCoverage(state);

    assert.strictEqual(result, true);
  });

  it("should return false when meaning is missing", () => {
    const state = {
      beats: [
        { id: "scene", strength: 0.8, required: true },
        { id: "stakes", strength: 0.7, required: true },
        { id: "turning_point", strength: 0.6, required: true },
        // No meaning beat
      ],
    };

    const result = hasMinimumCoverage(state);

    assert.strictEqual(result, false);
  });

  it("should return false with fewer than 3 covered/weak beats", () => {
    const state = {
      beats: [
        { id: "scene", strength: 0.7, required: true },
        { id: "meaning", strength: 0.8, required: true },
        // Only 2 beats
      ],
    };

    const result = hasMinimumCoverage(state);

    assert.strictEqual(result, false);
  });
});
