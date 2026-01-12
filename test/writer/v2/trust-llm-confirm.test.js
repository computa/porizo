/**
 * Trust LLM Confirmation Decision Tests
 *
 * V3: The harness trusts the LLM's confirmation decision.
 * Only safety bounds (max turns) can override.
 * No fatigue threshold overrides.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

describe("Trust LLM Confirmation Decision", () => {
  // Will be updated after implementation
  const { shouldConfirmFromLLM, shouldConfirmFallback, SAFETY_BOUNDS } = require("../../../src/writer/v2/quality");

  describe("shouldConfirmFromLLM", () => {
    it("should trust LLM CONFIRM even with low fatigue signals", () => {
      const state = { user_model: { fatigue_signals: 0 }, turn_count: 3 };
      const llmDecision = { action: "CONFIRM", confidence: 0.9 };

      const result = shouldConfirmFromLLM(state, llmDecision);

      assert.strictEqual(result.shouldConfirm, true);
      assert.strictEqual(result.source, "llm");
    });

    it("should trust LLM ASK even with high fatigue signals", () => {
      const state = { user_model: { fatigue_signals: 5 }, turn_count: 3 };
      const llmDecision = { action: "ASK", confidence: 0.8 };

      const result = shouldConfirmFromLLM(state, llmDecision);

      assert.strictEqual(result.shouldConfirm, false);
      assert.strictEqual(result.source, "llm");
    });

    it("should apply safety bound at max turns", () => {
      const state = { turn_count: 20 }; // Safety limit
      const llmDecision = { action: "ASK", confidence: 0.9 };

      const result = shouldConfirmFromLLM(state, llmDecision);

      assert.strictEqual(result.shouldConfirm, true);
      assert.strictEqual(result.source, "safety_bound");
    });

    it("should NOT override below max turns", () => {
      const state = { turn_count: 5 };
      const llmDecision = { action: "ASK", confidence: 0.9 };

      const result = shouldConfirmFromLLM(state, llmDecision);

      assert.strictEqual(result.shouldConfirm, false);
      assert.strictEqual(result.source, "llm");
    });

    it("should treat STOP as confirm", () => {
      const state = { turn_count: 3 };
      const llmDecision = { action: "STOP", confidence: 0.95 };

      const result = shouldConfirmFromLLM(state, llmDecision);

      assert.strictEqual(result.shouldConfirm, true);
      assert.strictEqual(result.source, "llm");
    });

    it("should preserve LLM confidence in result", () => {
      const state = { turn_count: 5 };
      const llmDecision = { action: "CONFIRM", confidence: 0.85 };

      const result = shouldConfirmFromLLM(state, llmDecision);

      assert.strictEqual(result.confidence, 0.85);
    });
  });

  describe("shouldConfirmFallback (when LLM unavailable)", () => {
    it("should NOT use fatigue threshold in fallback", () => {
      // Old behavior: fatigue >= 2 && minCoverage → confirm
      // New behavior: content-based, not fatigue-based
      const state = {
        user_model: { fatigue_signals: 3 },
        facts: [{ id: "f1", text: "fact" }],
        narrative: "Short.",
        beats: [{ id: "meaning", strength: 0.3, evidence: [] }],
        turn_count: 2,
      };

      // Should NOT confirm just because of fatigue
      const result = shouldConfirmFallback(state);

      // This state doesn't have enough content to confirm
      assert.strictEqual(result, false, "Should not confirm based on fatigue alone");
    });

    it("should confirm when content is rich enough", () => {
      const state = {
        facts: [{ id: "f1", text: "one" }, { id: "f2", text: "two" }, { id: "f3", text: "three" }],
        narrative: "A rich story about dad teaching fishing at the lake. He was patient and kind. Those summers meant everything.",
        beats: [
          { id: "scene", strength: 0.7, evidence: ["f1"] },
          { id: "meaning", strength: 0.8, evidence: ["f2"] },
        ],
        turn_count: 6,
      };

      const result = shouldConfirmFallback(state);

      assert.strictEqual(result, true, "Should confirm when content is rich");
    });

    it("should NOT confirm with insufficient content", () => {
      const state = {
        facts: [{ id: "f1", text: "one" }],
        narrative: "Short.",
        beats: [{ id: "meaning", strength: 0.2, evidence: [] }],
        turn_count: 2,
      };

      const result = shouldConfirmFallback(state);

      assert.strictEqual(result, false, "Should not confirm with thin content");
    });
  });

  describe("SAFETY_BOUNDS", () => {
    it("should have maxTurns defined", () => {
      assert.ok(SAFETY_BOUNDS.maxTurns, "maxTurns should be defined");
      assert.strictEqual(typeof SAFETY_BOUNDS.maxTurns, "number");
      assert.ok(SAFETY_BOUNDS.maxTurns >= 10, "maxTurns should be at least 10");
    });
  });
});
