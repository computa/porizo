/**
 * V2 Quality Tests
 * Tests for story completeness and quality checks
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  isStoryComplete,
  // shouldConfirm removed in V3 (Task 18) - see improved-heuristic.test.js
  getCompletionScore,
  getMissingBeats,
  getNextBeatToAsk,
  evaluatePoemReadiness,
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

  // Note: shouldConfirm tests removed in V3 (Task 18)
  // Confirmation logic now lives in generateSmartHeuristicFallback in engine.js
  // See improved-heuristic.test.js for equivalent tests

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

    it("should support v3 strength-based beats", () => {
      const state = {
        beats: [
          { id: "a", required: true, strength: 0.8 }, // covered (>= 0.6)
          { id: "b", required: true, strength: 0.4 }, // weak (>= 0.3)
        ],
      };

      // 1 + 0.5 = 1.5 / 2 = 75%
      assert.strictEqual(getCompletionScore(state), 75);
    });

    it("should support mixed status and strength beats", () => {
      const state = {
        beats: [
          { id: "a", required: true, status: "covered" },
          { id: "b", required: true, strength: 0.7 }, // covered via strength
        ],
      };

      assert.strictEqual(getCompletionScore(state), 100);
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

  describe("evaluatePoemReadiness", () => {
    it("should report gaps when narrative and core atoms are missing", () => {
      const result = evaluatePoemReadiness({
        atoms: {},
        primitives: {},
        narrative: "",
      });

      assert.strictEqual(result.is_complete, false);
      assert.ok(result.gaps.length >= 1, "Should report missing gaps");
      assert.ok(result.suggested_question, "Should provide a suggested question");
    });

    it("should pass when narrative and key fields are present", () => {
      const result = evaluatePoemReadiness({
        narrative: "We met on the rainy bridge and everything changed.",
        atoms: { who: "Chioma", turn: "We heard the second heartbeat", where: "clinic", when: "last winter" },
        primitives: {
          characters: [{ name: "Chioma", role: "partner" }],
          turning_point: "We heard the second heartbeat",
          setting: { place: "clinic", time: "last winter" },
        },
        last_reasoning: { story_readiness: { has_emotional_depth: true } },
      });

      assert.strictEqual(result.is_complete, true);
      assert.strictEqual(result.gaps.length, 0);
      assert.strictEqual(result.suggested_question, null);
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

    it("should support v3 strength-based beats", () => {
      const state = {
        beats: [
          { id: "a", required: true, strength: 0.8 }, // covered
          { id: "b", required: true, strength: 0.4 }, // weak
          { id: "c", required: true, strength: 0.1 }, // missing
        ],
      };

      const missing = getMissingBeats(state);
      const ids = missing.map(b => b.id);

      assert.ok(ids.includes("b"), "Should include weak strength");
      assert.ok(ids.includes("c"), "Should include missing strength");
      assert.ok(!ids.includes("a"), "Should not include covered strength");
      assert.strictEqual(missing[0].id, "c", "Lowest strength should come first");
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
