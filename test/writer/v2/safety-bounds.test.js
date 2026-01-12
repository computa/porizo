/**
 * V2 Safety Bounds Tests
 *
 * Tests for safety-only validation (no quality judgments).
 * Safety bounds are the only things the harness can override.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  SAFETY_BOUNDS,
  validateStructure,
  applySafetyBounds,
} = require("../../../src/writer/v2/safety");

describe("Safety Bounds", () => {
  describe("SAFETY_BOUNDS constants", () => {
    it("should have maxTurns defined", () => {
      assert.ok(SAFETY_BOUNDS.maxTurns, "maxTurns should be defined");
      assert.strictEqual(typeof SAFETY_BOUNDS.maxTurns, "number");
      assert.ok(SAFETY_BOUNDS.maxTurns >= 10, "maxTurns should be at least 10");
    });

    it("should have maxFactsPerTurn defined", () => {
      assert.ok(SAFETY_BOUNDS.maxFactsPerTurn, "maxFactsPerTurn should be defined");
      assert.strictEqual(typeof SAFETY_BOUNDS.maxFactsPerTurn, "number");
    });

    it("should have minQuestionLength defined", () => {
      assert.ok(typeof SAFETY_BOUNDS.minQuestionLength === "number");
    });

    it("should have maxQuestionLength defined", () => {
      assert.ok(SAFETY_BOUNDS.maxQuestionLength, "maxQuestionLength should be defined");
      assert.strictEqual(typeof SAFETY_BOUNDS.maxQuestionLength, "number");
    });
  });

  describe("validateStructure", () => {
    it("should validate valid ASK response", () => {
      const response = {
        action: "ASK",
        question: "What does this mean to you?",
      };

      const result = validateStructure(response);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it("should validate valid CONFIRM response", () => {
      const response = {
        action: "CONFIRM",
        confirmation: "I've captured your story. Does this feel complete?",
      };

      const result = validateStructure(response);

      assert.strictEqual(result.valid, true);
    });

    it("should validate valid CLARIFY response", () => {
      const response = {
        action: "CLARIFY",
        question: "Could you explain what you mean by that?",
      };

      const result = validateStructure(response);

      assert.strictEqual(result.valid, true);
    });

    it("should validate valid STOP response", () => {
      const response = {
        action: "STOP",
      };

      const result = validateStructure(response);

      assert.strictEqual(result.valid, true);
    });

    it("should reject missing action", () => {
      const response = {
        question: "What does this mean?",
      };

      const result = validateStructure(response);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes("action")));
    });

    it("should reject invalid action", () => {
      const response = {
        action: "INVALID",
        question: "Test?",
      };

      const result = validateStructure(response);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes("action")));
    });

    it("should reject ASK without question", () => {
      const response = {
        action: "ASK",
      };

      const result = validateStructure(response);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes("question")));
    });

    it("should reject CONFIRM without confirmation", () => {
      const response = {
        action: "CONFIRM",
      };

      const result = validateStructure(response);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes("confirmation")));
    });

    it("should reject question that is too short", () => {
      const response = {
        action: "ASK",
        question: "Hi?",
      };

      const result = validateStructure(response);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes("short")));
    });

    it("should reject question that is too long", () => {
      const response = {
        action: "ASK",
        question: "x".repeat(600),
      };

      const result = validateStructure(response);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes("long")));
    });

    it("should NOT make quality judgments", () => {
      // Structurally valid but low quality - should pass
      const response = {
        action: "ASK",
        question: "Tell me more about stuff and things?",
      };

      const result = validateStructure(response);

      // Structure is valid, so should pass (no quality judgment)
      assert.strictEqual(result.valid, true);
    });
  });

  describe("applySafetyBounds", () => {
    it("should force confirm at max turns", () => {
      const state = { turn_count: 20 };
      const decision = { action: "ASK", question: "More?" };

      const result = applySafetyBounds(state, decision);

      assert.strictEqual(result.decision.action, "CONFIRM");
      assert.strictEqual(result.decision.forced, true);
      assert.ok(result.warnings.length > 0);
    });

    it("should NOT override action below max turns", () => {
      const state = { turn_count: 5 };
      const decision = { action: "ASK", question: "More?" };

      const result = applySafetyBounds(state, decision);

      assert.strictEqual(result.decision.action, "ASK");
      assert.strictEqual(result.decision.forced, undefined);
    });

    it("should NOT override CONFIRM at any turn count", () => {
      const state = { turn_count: 2 };
      const decision = { action: "CONFIRM", confirmation: "All set!" };

      const result = applySafetyBounds(state, decision);

      assert.strictEqual(result.decision.action, "CONFIRM");
      assert.strictEqual(result.decision.forced, undefined);
    });

    it("should NOT override STOP action", () => {
      const state = { turn_count: 5 };
      const decision = { action: "STOP" };

      const result = applySafetyBounds(state, decision);

      assert.strictEqual(result.decision.action, "STOP");
    });

    it("should add default confirmation when forcing CONFIRM", () => {
      const state = { turn_count: 20, recipient_name: "Dad" };
      const decision = { action: "ASK", question: "More?" };

      const result = applySafetyBounds(state, decision);

      assert.strictEqual(result.decision.action, "CONFIRM");
      assert.ok(result.decision.confirmation, "Should have confirmation message");
    });

    it("should preserve original question when not overriding", () => {
      const state = { turn_count: 5 };
      const decision = { action: "ASK", question: "Original question?" };

      const result = applySafetyBounds(state, decision);

      assert.strictEqual(result.decision.question, "Original question?");
    });

    it("should handle missing state gracefully", () => {
      const decision = { action: "ASK", question: "Test?" };

      const result = applySafetyBounds({}, decision);

      assert.strictEqual(result.decision.action, "ASK");
    });

    it("should handle missing turn_count gracefully", () => {
      const state = { recipient_name: "Mom" };
      const decision = { action: "ASK", question: "Test?" };

      const result = applySafetyBounds(state, decision);

      assert.strictEqual(result.decision.action, "ASK");
    });
  });
});
