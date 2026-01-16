/**
 * Trust LLM Confirmation Decision Tests
 *
 * V3: The harness trusts the LLM's confirmation decision.
 * Only safety bounds (max turns) can override.
 * No fatigue threshold overrides.
 *
 * Note: shouldConfirmFallback was removed in V3 (Task 18).
 * Fallback confirmation logic now lives in generateSmartHeuristicFallback (engine.js).
 * See improved-heuristic.test.js for fallback behavior tests.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

describe("Trust LLM Confirmation Decision", () => {
  // shouldConfirmFallback removed in V3 - see improved-heuristic.test.js
  const { shouldConfirmFromLLM, SAFETY_BOUNDS } = require("../../../src/writer/v2/quality");

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

    it("should handle null llmDecision gracefully", () => {
      const state = { turn_count: 5 };

      const result = shouldConfirmFromLLM(state, null);

      assert.strictEqual(result.shouldConfirm, false);
      assert.strictEqual(result.source, "error");
      assert.ok(result.reason.includes("No LLM decision"));
    });

    it("should handle undefined llmDecision gracefully", () => {
      const state = { turn_count: 5 };

      const result = shouldConfirmFromLLM(state, undefined);

      assert.strictEqual(result.shouldConfirm, false);
      assert.strictEqual(result.source, "error");
    });
  });

  // Note: shouldConfirmFallback tests removed in V3 (Task 18)
  // Fallback confirmation behavior is now tested in improved-heuristic.test.js
  // using generateSmartHeuristicFallback which has graduated richness scoring

  describe("SAFETY_BOUNDS", () => {
    it("should have maxTurns defined", () => {
      assert.ok(SAFETY_BOUNDS.maxTurns, "maxTurns should be defined");
      assert.strictEqual(typeof SAFETY_BOUNDS.maxTurns, "number");
      assert.ok(SAFETY_BOUNDS.maxTurns >= 10, "maxTurns should be at least 10");
    });
  });
});
