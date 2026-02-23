/**
 * V2 Lightweight LLM Fallback Tests
 *
 * V3: When primary LLM fails, use a lightweight model (Haiku/GPT-3.5)
 * with a concise prompt before falling back to heuristics.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

describe("Lightweight LLM Fallback", () => {
  const {
    buildLightweightPrompt,
    parseLightweightResponse,
  } = require("../../../src/writer/v3/fallback-llm");

  describe("buildLightweightPrompt", () => {
    it("should build a concise prompt for lightweight model", () => {
      const state = {
        recipient_name: "Dad",
        facts: [
          { id: "f1", text: "Loves fishing" },
          { id: "f2", text: "Taught me patience" },
        ],
        beats: [
          { id: "meaning", purpose: "what it means", strength: 0.2 },
          { id: "scene", purpose: "where it happened", strength: 0.5 },
        ],
        turn_count: 3,
      };

      const prompt = buildLightweightPrompt(state, "He taught me patience");

      // Should be concise (< 500 chars for efficient lightweight model use)
      assert.ok(prompt.length < 600, `Prompt should be concise, got ${prompt.length} chars`);
      assert.ok(prompt.includes("Dad"), "Should include recipient");
      assert.ok(prompt.includes("fishing") || prompt.includes("patience"), "Should include facts");
      assert.ok(prompt.includes("3"), "Should include turn count");
    });

    it("should include weak beat purposes", () => {
      const state = {
        recipient_name: "Mom",
        facts: [],
        beats: [
          { id: "meaning", purpose: "what it means", strength: 0.1 },
          { id: "scene", purpose: "where it happened", strength: 0.8 }, // Not weak
        ],
        turn_count: 2,
      };

      const prompt = buildLightweightPrompt(state, "She's the best");

      assert.ok(prompt.includes("what it means"), "Should include weak beat purpose");
    });

    it("should handle empty state gracefully", () => {
      const state = {
        recipient_name: "Friend",
        facts: [],
        beats: [],
        turn_count: 1,
      };

      const prompt = buildLightweightPrompt(state, "Test input");

      assert.ok(prompt.length > 0, "Should generate a prompt");
      assert.ok(prompt.includes("Friend"), "Should include recipient");
    });

    it("should include user input in prompt", () => {
      const state = {
        recipient_name: "Dad",
        facts: [],
        beats: [],
        turn_count: 1,
      };

      const prompt = buildLightweightPrompt(state, "He loves golf and reading");

      assert.ok(prompt.includes("golf") || prompt.includes("reading"), "Should include user input");
    });
  });

  describe("parseLightweightResponse", () => {
    it("should parse valid JSON response", () => {
      const response = JSON.stringify({
        action: "ASK",
        message: "What does fishing mean to you now?",
      });

      const result = parseLightweightResponse(response);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.action, "ASK");
      assert.strictEqual(result.data.message, "What does fishing mean to you now?");
    });

    it("should accept CONFIRM action", () => {
      const response = JSON.stringify({
        action: "CONFIRM",
        message: "I have captured 5 details. Does this feel complete?",
      });

      const result = parseLightweightResponse(response);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.action, "CONFIRM");
    });

    it("should accept CLARIFY action", () => {
      const response = JSON.stringify({
        action: "CLARIFY",
        message: "Could you tell me more about that?",
      });

      const result = parseLightweightResponse(response);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.action, "CLARIFY");
    });

    it("should accept STOP action", () => {
      const response = JSON.stringify({
        action: "STOP",
        message: "I understand you want to stop.",
      });

      const result = parseLightweightResponse(response);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.action, "STOP");
    });

    it("should reject invalid action", () => {
      const response = JSON.stringify({
        action: "INVALID",
        message: "Something",
      });

      const result = parseLightweightResponse(response);

      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes("action"));
    });

    it("should reject missing action", () => {
      const response = JSON.stringify({
        message: "Something",
      });

      const result = parseLightweightResponse(response);

      assert.strictEqual(result.success, false);
    });

    it("should handle malformed JSON gracefully", () => {
      const response = "not valid json";

      const result = parseLightweightResponse(response);

      assert.strictEqual(result.success, false);
      assert.ok(result.error, "Should have error message");
    });

    it("should extract JSON from markdown code block", () => {
      const response = `Here's my response:
\`\`\`json
{"action": "ASK", "message": "Tell me more?"}
\`\`\``;

      const result = parseLightweightResponse(response);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.action, "ASK");
    });
  });
});
