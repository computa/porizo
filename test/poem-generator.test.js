/**
 * Poem Generator Tests
 *
 * Tests for the poem generation service using LLM
 */

require("dotenv/config");
const { describe, test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");

const { generatePoem, buildPoemFallback, POEM_TONES, OCCASIONS } = require("../src/services/poem-generator");

describe("Poem Generator", () => {
  describe("buildPoemFallback", () => {
    test("generates verses with recipient name", () => {
      const result = buildPoemFallback({
        recipient_name: "Sarah",
        occasion: "birthday",
        tone: "heartfelt",
        message: "You bring so much joy to everyone around you",
      });

      assert.ok(result.verses, "Should have verses");
      assert.ok(Array.isArray(result.verses), "Verses should be an array");
      assert.ok(result.verses.length >= 2, "Should have at least 2 verses");

      // Check that recipient name appears somewhere
      const versesText = result.verses.map(v => v.lines.join(" ")).join(" ");
      assert.ok(versesText.includes("Sarah"), "Should include recipient name");
    });

    test("generates different verses for different occasions", () => {
      const birthdayResult = buildPoemFallback({
        recipient_name: "Mom",
        occasion: "birthday",
        tone: "heartfelt",
      });

      const anniversaryResult = buildPoemFallback({
        recipient_name: "Mom",
        occasion: "anniversary",
        tone: "heartfelt",
      });

      // Different occasions should produce different poems
      const birthdayText = birthdayResult.verses.map(v => v.lines.join(" ")).join(" ");
      const anniversaryText = anniversaryResult.verses.map(v => v.lines.join(" ")).join(" ");

      assert.notEqual(birthdayText, anniversaryText, "Different occasions should produce different poems");
    });

    test("handles missing recipient name gracefully", () => {
      const result = buildPoemFallback({
        occasion: "birthday",
        tone: "heartfelt",
      });

      assert.ok(result.verses, "Should still generate verses");
      assert.ok(result.verses.length >= 2, "Should have at least 2 verses");
    });

    test("generates poems with different tones", () => {
      const heartfeltResult = buildPoemFallback({
        recipient_name: "John",
        occasion: "birthday",
        tone: "heartfelt",
      });

      const funnyResult = buildPoemFallback({
        recipient_name: "John",
        occasion: "birthday",
        tone: "funny",
      });

      const heartfeltText = heartfeltResult.verses.map(v => v.lines.join(" ")).join(" ");
      const funnyText = funnyResult.verses.map(v => v.lines.join(" ")).join(" ");

      // Different tones should produce different poems
      assert.notEqual(heartfeltText, funnyText, "Different tones should produce different poems");
    });

    test("includes message context in verses", () => {
      const result = buildPoemFallback({
        recipient_name: "Dad",
        occasion: "thank_you",
        tone: "heartfelt",
        message: "Thank you for always being there for me",
      });

      // The message theme should be reflected in the poem
      const versesText = result.verses.map(v => v.lines.join(" ")).join(" ");
      assert.ok(
        versesText.toLowerCase().includes("thank") ||
        versesText.toLowerCase().includes("there") ||
        versesText.toLowerCase().includes("always"),
        "Should reflect message theme in verses"
      );
    });
  });

  describe("generatePoem", () => {
    const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
    const originalOpenAIKey = process.env.OPENAI_API_KEY;

    afterEach(() => {
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
      process.env.OPENAI_API_KEY = originalOpenAIKey;
    });

    test("uses fallback when no LLM key available", async () => {
      // Remove both API keys to force fallback
      process.env.ANTHROPIC_API_KEY = "";
      process.env.OPENAI_API_KEY = "";

      const result = await generatePoem({
        recipient_name: "Sarah",
        occasion: "birthday",
        tone: "heartfelt",
        message: "You're the best!",
      });

      assert.ok(result.verses, "Should have verses");
      assert.ok(result.verses.length >= 2, "Should have at least 2 verses");
      assert.strictEqual(result.usedFallback, true, "Should indicate fallback was used");
    });

    test("validates required fields", async () => {
      await assert.rejects(
        generatePoem({}),
        /occasion is required/i,
        "Should reject missing occasion"
      );
    });

    test("returns structured verse format", async () => {
      // Remove both API keys to force fallback (faster test)
      process.env.ANTHROPIC_API_KEY = "";
      process.env.OPENAI_API_KEY = "";

      const result = await generatePoem({
        recipient_name: "Mom",
        occasion: "birthday",
        tone: "heartfelt",
      });

      // Verify verse structure
      for (const verse of result.verses) {
        assert.ok(verse.name, "Each verse should have a name");
        assert.ok(Array.isArray(verse.lines), "Each verse should have lines array");
        assert.ok(verse.lines.length >= 2, "Each verse should have at least 2 lines");
      }
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
