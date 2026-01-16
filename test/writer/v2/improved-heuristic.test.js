/**
 * V2 Improved Heuristic Fallback Tests
 *
 * V3 Update (Task 14): Removed keyword-based done detection.
 * Tests now verify:
 * - Content-based richness scoring
 * - LLM semantic done detection (via llmReasoning parameter)
 * - Contextual questions referencing narrative
 *
 * Note: detectDoneSignal and DONE_SIGNALS were removed in V3 (Task 14).
 * Done detection now relies on LLM's semantic assessment (user_state.seems_done).
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  generateSmartHeuristicFallback,
} = require("../../../src/writer/v2/engine");

describe("Improved Heuristic Fallback", () => {

  describe("generateSmartHeuristicFallback", () => {

    it("should confirm when richness score is high (content-based)", () => {
      // V3: Uses content-based richness scoring, not keyword matching
      const state = {
        recipient_name: "Dad",
        facts: [
          { id: "f1", text: "fact one - dad loves fishing" },
          { id: "f2", text: "fact two - summers at the lake" },
          { id: "f3", text: "fact three - patience and life lessons" },
          { id: "f4", text: "fact four - our special bond" },
        ],
        narrative: "A story with sufficient content about dad and fishing at the lake. He taught me so much about patience and life during those summers. Every weekend we would get up early and drive out to the lake together.",
        conversation: [],
        turn_count: 5,
        beats: [
          { id: "meaning", strength: 0.6 },
          { id: "memory", strength: 0.7 },
        ],
      };

      const response = generateSmartHeuristicFallback(state);

      assert.strictEqual(response.action, "CONFIRM");
      assert.strictEqual(response.fallback, true);
      assert.strictEqual(response.tier, "heuristic");
      assert.ok(response.heuristic_score >= 0.6,
        `Richness score should be >= 0.6: ${response.heuristic_score}`);
    });

    it("should confirm when LLM reasoning says user is done", () => {
      // V3: Trusts LLM semantic detection
      const state = {
        recipient_name: "Dad",
        facts: [
          { id: "f1", text: "fact one" },
          { id: "f2", text: "fact two" },
        ],
        narrative: "Some story content.",
        conversation: [],
        turn_count: 4,
        beats: [],
      };

      const llmReasoning = {
        user_state: {
          seems_done: true,
          engagement: "low",
          tone: "wrapping up",
        }
      };

      const response = generateSmartHeuristicFallback(state, llmReasoning);

      assert.strictEqual(response.action, "CONFIRM");
      assert.ok(response.reason.includes("LLM"),
        `Reason should mention LLM: ${response.reason}`);
    });

    it("should ask contextual question when content is thin", () => {
      const state = {
        recipient_name: "Dad",
        facts: [{ id: "f1", text: "Dad loves fishing" }],
        narrative: "Short story about fishing.",
        beats: [
          { id: "meaning", purpose: "what it means", strength: 0.1, required: true },
        ],
        conversation: [
          { role: "user", content: "He's a great fisherman" }
        ],
        turn_count: 2,
      };

      const response = generateSmartHeuristicFallback(state);

      assert.strictEqual(response.action, "ASK");
      assert.ok(response.question, "Should have a question");
      // Should reference content from narrative or facts
      assert.ok(
        response.question.includes("fishing") ||
        response.question.includes("mean") ||
        response.question.toLowerCase().includes("dad"),
        `Question should reference context: ${response.question}`
      );
      assert.strictEqual(response.tier, "heuristic");
    });

    it("should confirm after high turn count regardless of content", () => {
      // Safety: high turns should eventually confirm
      const state = {
        recipient_name: "Mom",
        facts: [{ id: "f1", text: "one fact" }],
        narrative: "Short.",
        beats: [],
        conversation: [],
        turn_count: 10, // High turns
      };

      const response = generateSmartHeuristicFallback(state);

      assert.strictEqual(response.action, "CONFIRM");
      assert.strictEqual(response.tier, "heuristic");
      assert.strictEqual(response.reason, "high_turn_count");
    });

    it("should NOT confirm with thin content below turn threshold", () => {
      const state = {
        recipient_name: "Dad",
        facts: [{ id: "f1", text: "single fact" }],
        narrative: "Short.",
        beats: [],
        conversation: [],
        turn_count: 5, // Below threshold
      };

      const response = generateSmartHeuristicFallback(state);

      assert.strictEqual(response.action, "ASK");
      assert.strictEqual(response.tier, "heuristic");
    });

    it("should NOT use keyword matching for done detection", () => {
      // V3: Keywords alone should not trigger CONFIRM
      const state = {
        recipient_name: "Dad",
        facts: [],
        narrative: "",
        conversation: [
          { role: "user", content: "that's all" } // Keyword present but no content
        ],
        beats: [],
        turn_count: 1,
      };

      const response = generateSmartHeuristicFallback(state);

      // Should NOT confirm with no content, keyword is ignored
      assert.strictEqual(response.action, "ASK");
    });

    it("should include heuristic_score in response", () => {
      const state = {
        recipient_name: "Dad",
        facts: [{ id: "f1", text: "one" }],
        narrative: "Some narrative content here.",
        conversation: [],
        beats: [],
        turn_count: 3,
      };

      const response = generateSmartHeuristicFallback(state);

      assert.ok(typeof response.heuristic_score === "number",
        "Should include numeric heuristic_score");
      assert.ok(response.heuristic_score >= 0 && response.heuristic_score <= 1,
        `Score should be 0-1: ${response.heuristic_score}`);
    });

    it("should reference weak beat purpose in question when available", () => {
      const state = {
        recipient_name: "Dad",
        facts: [{ id: "f1", text: "loves fishing" }],
        narrative: "Dad loves fishing at the lake.",
        beats: [
          { id: "meaning", purpose: "what it means", strength: 0.2, required: true },
          { id: "scene", purpose: "where it happened", strength: 0.8, required: true },
        ],
        conversation: [],
        turn_count: 3,
      };

      const response = generateSmartHeuristicFallback(state);

      assert.strictEqual(response.action, "ASK");
      // Should reference the weak beat's purpose or narrative content
      assert.ok(response.question.length > 10, "Should have a meaningful question");
    });

  });

});
