/**
 * V2 Quality Tests
 * Tests for story completeness and quality checks
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  isStoryComplete,
  shouldConfirm,
  getCompletionScore,
  getMissingBeats,
  getNextBeatToAsk,
} = require("../../../src/writer/v2/quality");

describe("V2 Quality Checks", () => {
  describe("isStoryComplete", () => {
    it("should return true when all required beats are covered", () => {
      const state = {
        beats: [
          { id: "scene", required: true, status: "covered", evidence: ["f1"] },
          { id: "stakes", required: true, status: "covered", evidence: ["f2"] },
          { id: "turning_point", required: true, status: "covered", evidence: ["f3"] },
          { id: "meaning", required: true, status: "covered", evidence: ["f4"] },
          { id: "sensory", required: false, status: "missing", evidence: [] },
        ],
      };

      assert.strictEqual(isStoryComplete(state), true);
    });

    it("should return false when required beats are missing", () => {
      const state = {
        beats: [
          { id: "scene", required: true, status: "covered", evidence: ["f1"] },
          { id: "stakes", required: true, status: "missing", evidence: [] },
          { id: "turning_point", required: true, status: "weak", evidence: [] },
          { id: "meaning", required: true, status: "covered", evidence: ["f4"] },
        ],
      };

      assert.strictEqual(isStoryComplete(state), false);
    });

    it("should return false when beats array is empty", () => {
      const state = { beats: [] };
      assert.strictEqual(isStoryComplete(state), false);
    });

    it("should return false when beats is undefined", () => {
      const state = {};
      assert.strictEqual(isStoryComplete(state), false);
    });
  });

  describe("shouldConfirm", () => {
    it("should return true when complete and no fatigue", () => {
      const state = {
        beats: [
          { id: "scene", required: true, status: "covered", evidence: ["f1"] },
          { id: "stakes", required: true, status: "covered", evidence: ["f2"] },
          { id: "turning_point", required: true, status: "covered", evidence: ["f3"] },
          { id: "meaning", required: true, status: "covered", evidence: ["f4"] },
        ],
        user_model: { fatigue_signals: 0 },
      };

      assert.strictEqual(shouldConfirm(state), true);
    });

    it("should return true when fatigued and minimum beats met", () => {
      const state = {
        beats: [
          { id: "scene", required: true, status: "covered", evidence: ["f1"] },
          { id: "stakes", required: true, status: "weak", evidence: [] },
          { id: "turning_point", required: true, status: "covered", evidence: ["f3"] },
          { id: "meaning", required: true, status: "covered", evidence: ["f4"] },
        ],
        user_model: { fatigue_signals: 2 },
      };

      // Should confirm because fatigued, even with one weak beat
      const result = shouldConfirm(state);
      assert.strictEqual(result, true);
    });

    it("should return false when not complete and no fatigue", () => {
      const state = {
        beats: [
          { id: "scene", required: true, status: "covered", evidence: ["f1"] },
          { id: "stakes", required: true, status: "missing", evidence: [] },
        ],
        user_model: { fatigue_signals: 0 },
      };

      assert.strictEqual(shouldConfirm(state), false);
    });

    it("should return false when fatigued but minimum not met", () => {
      const state = {
        beats: [
          { id: "scene", required: true, status: "missing", evidence: [] },
          { id: "meaning", required: true, status: "missing", evidence: [] },
        ],
        user_model: { fatigue_signals: 3 },
      };

      assert.strictEqual(shouldConfirm(state), false);
    });
  });

  describe("getCompletionScore", () => {
    it("should return 100 when all beats covered", () => {
      const state = {
        beats: [
          { id: "a", required: true, status: "covered" },
          { id: "b", required: true, status: "covered" },
        ],
      };

      assert.strictEqual(getCompletionScore(state), 100);
    });

    it("should return 50 when half beats covered", () => {
      const state = {
        beats: [
          { id: "a", required: true, status: "covered" },
          { id: "b", required: true, status: "missing" },
        ],
      };

      assert.strictEqual(getCompletionScore(state), 50);
    });

    it("should count weak as partial coverage", () => {
      const state = {
        beats: [
          { id: "a", required: true, status: "covered" },
          { id: "b", required: true, status: "weak" },
        ],
      };

      // covered = 1, weak = 0.5, total = 1.5 / 2 = 75%
      assert.strictEqual(getCompletionScore(state), 75);
    });

    it("should return 0 for empty beats", () => {
      const state = { beats: [] };
      assert.strictEqual(getCompletionScore(state), 0);
    });

    it("should only count required beats", () => {
      const state = {
        beats: [
          { id: "a", required: true, status: "covered" },
          { id: "b", required: false, status: "missing" },
        ],
      };

      // Only 1 required beat, and it's covered
      assert.strictEqual(getCompletionScore(state), 100);
    });
  });

  describe("getMissingBeats", () => {
    it("should return only missing and weak required beats", () => {
      const state = {
        beats: [
          { id: "a", required: true, status: "covered" },
          { id: "b", required: true, status: "missing" },
          { id: "c", required: true, status: "weak" },
          { id: "d", required: false, status: "missing" },
        ],
      };

      const missing = getMissingBeats(state);
      const ids = missing.map(b => b.id);

      assert.ok(ids.includes("b"), "Should include missing required");
      assert.ok(ids.includes("c"), "Should include weak required");
      assert.ok(!ids.includes("a"), "Should not include covered");
      assert.ok(!ids.includes("d"), "Should not include optional");
    });

    it("should sort missing before weak", () => {
      const state = {
        beats: [
          { id: "weak1", required: true, status: "weak" },
          { id: "missing1", required: true, status: "missing" },
          { id: "weak2", required: true, status: "weak" },
        ],
      };

      const missing = getMissingBeats(state);
      assert.strictEqual(missing[0].id, "missing1", "Missing should come first");
    });

    it("should return empty array when all required beats covered", () => {
      const state = {
        beats: [
          { id: "a", required: true, status: "covered" },
          { id: "b", required: true, status: "covered" },
        ],
      };

      const missing = getMissingBeats(state);
      assert.strictEqual(missing.length, 0);
    });
  });

  describe("getNextBeatToAsk", () => {
    it("should return null when no missing beats", () => {
      const state = {
        beats: [
          { id: "a", required: true, status: "covered" },
        ],
      };

      assert.strictEqual(getNextBeatToAsk(state), null);
    });

    it("should prioritize turning_point over scene", () => {
      const state = {
        beats: [
          { id: "scene", required: true, status: "missing" },
          { id: "turning_point", required: true, status: "missing" },
        ],
      };

      const next = getNextBeatToAsk(state);
      assert.strictEqual(next.id, "turning_point");
    });

    it("should prioritize meaning over stakes", () => {
      const state = {
        beats: [
          { id: "stakes", required: true, status: "missing" },
          { id: "meaning", required: true, status: "missing" },
        ],
      };

      const next = getNextBeatToAsk(state);
      assert.strictEqual(next.id, "meaning");
    });
  });
});
