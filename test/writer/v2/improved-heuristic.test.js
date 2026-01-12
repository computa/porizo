/**
 * V2 Improved Heuristic Fallback Tests
 *
 * Tests for smarter heuristic fallback when all LLMs fail:
 * - Done signal detection
 * - Content-based confirmation
 * - Contextual questions referencing narrative
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  generateSmartHeuristicFallback,
  detectDoneSignal,
} = require("../../../src/writer/v2/engine");

describe("Improved Heuristic Fallback", () => {
  describe("detectDoneSignal", () => {
    it("should detect 'that's all' as done", () => {
      assert.strictEqual(detectDoneSignal("That's all I can think of"), true);
    });

    it("should detect 'I'm done' as done", () => {
      assert.strictEqual(detectDoneSignal("I'm done for now"), true);
    });

    it("should detect 'nothing else' as done", () => {
      assert.strictEqual(detectDoneSignal("Nothing else comes to mind"), true);
    });

    it("should detect 'that covers it' as done", () => {
      assert.strictEqual(detectDoneSignal("I think that covers it"), true);
    });

    it("should NOT detect normal content as done", () => {
      assert.strictEqual(detectDoneSignal("He taught me to fish"), false);
    });

    it("should handle empty input", () => {
      assert.strictEqual(detectDoneSignal(""), false);
      assert.strictEqual(detectDoneSignal(null), false);
      assert.strictEqual(detectDoneSignal(undefined), false);
    });
  });

  describe("generateSmartHeuristicFallback", () => {
    it("should detect done signals and confirm", () => {
      const state = {
        recipient_name: "Dad",
        facts: [
          { id: "f1", text: "fact one" },
          { id: "f2", text: "fact two" },
          { id: "f3", text: "fact three" },
        ],
        narrative: "A story with sufficient content about dad and fishing at the lake.",
        conversation: [
          { role: "user", content: "that's pretty much it" }
        ],
        turn_count: 4,
        beats: [],
      };

      const response = generateSmartHeuristicFallback(state);

      assert.strictEqual(response.action, "CONFIRM");
      assert.strictEqual(response.fallback, true);
      assert.strictEqual(response.tier, "heuristic");
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

    it("should confirm after many turns with content", () => {
      const state = {
        recipient_name: "Mom",
        facts: [
          { id: "f1", text: "one" },
          { id: "f2", text: "two" },
          { id: "f3", text: "three" },
        ],
        narrative: "A substantial narrative about mom with enough detail to work with.",
        beats: [],
        conversation: [],
        turn_count: 8,
      };

      const response = generateSmartHeuristicFallback(state);

      assert.strictEqual(response.action, "CONFIRM");
      assert.strictEqual(response.tier, "heuristic");
    });

    it("should NOT confirm with thin content even after many turns", () => {
      const state = {
        recipient_name: "Dad",
        facts: [{ id: "f1", text: "single fact" }],
        narrative: "Short.",
        beats: [],
        conversation: [],
        turn_count: 10,
      };

      const response = generateSmartHeuristicFallback(state);

      assert.strictEqual(response.action, "ASK");
      assert.strictEqual(response.tier, "heuristic");
    });

    it("should NOT confirm done signal if content is too thin", () => {
      const state = {
        recipient_name: "Dad",
        facts: [],
        narrative: "",
        conversation: [
          { role: "user", content: "that's all" }
        ],
        beats: [],
        turn_count: 1,
      };

      const response = generateSmartHeuristicFallback(state);

      // Should NOT confirm with no content, even if user says done
      assert.strictEqual(response.action, "ASK");
    });

    it("should include fact count in confirmation message", () => {
      const state = {
        recipient_name: "Dad",
        facts: [
          { id: "f1", text: "one" },
          { id: "f2", text: "two" },
          { id: "f3", text: "three" },
        ],
        narrative: "A rich story about dad with sufficient content for a song.",
        conversation: [
          { role: "user", content: "I think that covers everything" }
        ],
        beats: [],
        turn_count: 5,
      };

      const response = generateSmartHeuristicFallback(state);

      assert.strictEqual(response.action, "CONFIRM");
      assert.ok(response.confirmation.includes("3"), "Should mention fact count");
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
