/**
 * V2 Fallback Chain Tests
 *
 * Tests for three-tier fallback: Primary → Lightweight → Heuristic
 */

const { describe, it, beforeEach, mock } = require("node:test");
const assert = require("node:assert");

describe("Fallback Chain", () => {
  const { reasonWithFallback } = require("../../../src/writer/v2/reasoner");

  /**
   * Create a test state with customizable properties
   */
  function createTestState(overrides = {}) {
    return {
      recipient_name: "Dad",
      event: { occasion: "birthday", type: "birthday" },
      narrative: "Dad loves fishing at the lake.",
      facts: [
        { id: "f1", text: "loves fishing" },
        { id: "f2", text: "at the lake" },
      ],
      beats: [
        { id: "meaning", purpose: "what it means", strength: 0.3, required: true },
        { id: "scene", purpose: "where it happened", strength: 0.7, required: true },
      ],
      conversation: [],
      turn_count: 3,
      user_model: { style: "conversational" },
      ...overrides,
    };
  }

  describe("reasonWithFallback", () => {
    it("should use primary result when successful", async () => {
      const state = createTestState();
      const mockPrimary = {
        success: true,
        data: {
          action: "ASK",
          question: "What does fishing mean to you?",
        },
      };

      const result = await reasonWithFallback(state, "test input", {
        mockPrimaryResult: mockPrimary,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.action, "ASK");
      assert.strictEqual(result.tier, "primary");
      assert.strictEqual(result.fallback, false);
    });

    it("should fall back to lightweight when primary fails", async () => {
      const state = createTestState();
      const mockLightweight = {
        success: true,
        data: {
          action: "ASK",
          message: "Tell me more about fishing?",
        },
      };

      const result = await reasonWithFallback(state, "test input", {
        mockPrimaryResult: { success: false, error: "Primary failed" },
        mockLightweightResult: mockLightweight,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.action, "ASK");
      assert.strictEqual(result.tier, "lightweight");
      assert.strictEqual(result.fallback, true);
    });

    it("should fall back to heuristic when both LLMs fail", async () => {
      const state = createTestState();

      const result = await reasonWithFallback(state, "test input", {
        mockPrimaryResult: { success: false, error: "Primary failed" },
        mockLightweightResult: { success: false, error: "Lightweight failed" },
      });

      assert.strictEqual(result.success, true);
      assert.ok(result.data.action === "ASK" || result.data.action === "CONFIRM");
      assert.strictEqual(result.tier, "heuristic");
      assert.strictEqual(result.fallback, true);
    });

    it("should preserve primary confidence when available", async () => {
      const state = createTestState();
      const mockPrimary = {
        success: true,
        data: {
          action: "CONFIRM",
          confirmation: "I think we have enough.",
          decision: { confidence: 0.85 },
        },
      };

      const result = await reasonWithFallback(state, "test", {
        mockPrimaryResult: mockPrimary,
      });

      assert.strictEqual(result.data.decision.confidence, 0.85);
    });

    it("should normalize lightweight response format", async () => {
      const state = createTestState();
      // Lightweight returns { action, message } instead of { action, question }
      const mockLightweight = {
        success: true,
        data: {
          action: "ASK",
          message: "What does it mean?",
        },
      };

      const result = await reasonWithFallback(state, "test input", {
        mockPrimaryResult: { success: false, error: "Primary failed" },
        mockLightweightResult: mockLightweight,
      });

      // Should normalize message → question
      assert.strictEqual(result.data.action, "ASK");
      assert.ok(result.data.question || result.data.message, "Should have question or message");
    });

    it("should include tier info in all responses", async () => {
      const state = createTestState();

      // Test primary
      const primaryResult = await reasonWithFallback(state, "test", {
        mockPrimaryResult: {
          success: true,
          data: { action: "ASK", question: "test?" },
        },
      });
      assert.ok(primaryResult.tier, "Primary should have tier");

      // Test lightweight
      const lightResult = await reasonWithFallback(state, "test", {
        mockPrimaryResult: { success: false },
        mockLightweightResult: {
          success: true,
          data: { action: "ASK", message: "test?" },
        },
      });
      assert.ok(lightResult.tier, "Lightweight should have tier");

      // Test heuristic
      const heuristicResult = await reasonWithFallback(state, "test", {
        mockPrimaryResult: { success: false },
        mockLightweightResult: { success: false },
      });
      assert.ok(heuristicResult.tier, "Heuristic should have tier");
    });

    it("should handle CONFIRM action from lightweight", async () => {
      const state = createTestState({
        facts: [
          { id: "f1", text: "fact 1" },
          { id: "f2", text: "fact 2" },
          { id: "f3", text: "fact 3" },
        ],
        turn_count: 5,
      });

      const mockLightweight = {
        success: true,
        data: {
          action: "CONFIRM",
          message: "I have enough to work with.",
        },
      };

      const result = await reasonWithFallback(state, "that's all", {
        mockPrimaryResult: { success: false },
        mockLightweightResult: mockLightweight,
      });

      assert.strictEqual(result.data.action, "CONFIRM");
      assert.strictEqual(result.tier, "lightweight");
    });

    it("should NOT use keyword matching for done detection (V3)", async () => {
      // V3: Keywords alone don't trigger CONFIRM - need LLM reasoning or content richness
      const state = createTestState({
        facts: [
          { id: "f1", text: "fact one" },
          { id: "f2", text: "fact two" },
        ],
        narrative: "A sufficient story about dad and fishing.",
        conversation: [{ role: "user", content: "that's all I can think of" }],
        turn_count: 3,
      });

      const result = await reasonWithFallback(state, "that's all I can think of", {
        mockPrimaryResult: { success: false },
        mockLightweightResult: { success: false },
      });

      // V3: Should ASK because content is thin, keyword matching is removed
      assert.strictEqual(result.data.action, "ASK");
      assert.strictEqual(result.tier, "heuristic");
    });

    it("should CONFIRM in heuristic when content is rich enough", async () => {
      // V3: CONFIRM based on content richness, not keyword matching
      const state = createTestState({
        facts: [
          { id: "f1", text: "Dad taught me to fish at the lake every summer" },
          { id: "f2", text: "He showed me patience and love" },
          { id: "f3", text: "Those mornings are my best memories" },
          { id: "f4", text: "He always believed in me" },
        ],
        narrative: "A substantial story about dad teaching fishing at the lake. He was patient and kind. Those summer mornings together are my most treasured memories.",
        beats: [
          { id: "meaning", strength: 0.7 },
          { id: "memory", strength: 0.6 },
        ],
        conversation: [{ role: "user", content: "He really meant a lot to me" }],
        turn_count: 6,
      });

      const result = await reasonWithFallback(state, "He really meant a lot to me", {
        mockPrimaryResult: { success: false },
        mockLightweightResult: { success: false },
      });

      // V3: CONFIRM based on high richness score
      assert.strictEqual(result.data.action, "CONFIRM");
      assert.strictEqual(result.tier, "heuristic");
    });
  });
});
