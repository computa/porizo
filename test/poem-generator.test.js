/**
 * Poem Generator Tests
 *
 * Tests for the poem generation service using LLM.
 * No fallback templates - LLM is required for quality consistency.
 */

require("dotenv/config");
const { describe, test, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { generatePoem, POEM_TONES, OCCASIONS } = require("../src/services/poem-generator");

describe("Poem Generator", () => {
  describe("generatePoem", () => {
    const originalGeminiKey = process.env.GEMINI_API_KEY;
    const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
    const originalOpenAIKey = process.env.OPENAI_API_KEY;

    afterEach(() => {
      process.env.GEMINI_API_KEY = originalGeminiKey;
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
      process.env.OPENAI_API_KEY = originalOpenAIKey;
    });

    test("throws AI_UNAVAILABLE when no LLM key available", async () => {
      // Remove all provider keys
      process.env.GEMINI_API_KEY = "";
      process.env.ANTHROPIC_API_KEY = "";
      process.env.OPENAI_API_KEY = "";

      await assert.rejects(
        generatePoem({
          recipient_name: "Sarah",
          occasion: "birthday",
          tone: "heartfelt",
          message: "You're the best!",
        }),
        (err) => {
          assert.strictEqual(err.code, "AI_UNAVAILABLE", "Should have AI_UNAVAILABLE error code");
          return true;
        },
        "Should reject with AI_UNAVAILABLE when no LLM configured"
      );
    });

    test("validates required fields", async () => {
      await assert.rejects(
        generatePoem({}),
        /occasion is required/i,
        "Should reject missing occasion"
      );
    });
  });

  describe("POEM_TONES", () => {
    test("has expected tones", () => {
      assert.ok(POEM_TONES.heartfelt, "Should have heartfelt tone");
      assert.ok(POEM_TONES.funny, "Should have funny tone");
      assert.ok(POEM_TONES.inspirational, "Should have inspirational tone");
    });
  });

  describe("OCCASIONS", () => {
    test("has expected occasions", () => {
      assert.ok(OCCASIONS.birthday, "Should have birthday occasion");
      assert.ok(OCCASIONS.anniversary, "Should have anniversary occasion");
      assert.ok(OCCASIONS.thank_you, "Should have thank_you occasion");
    });
  });
});
