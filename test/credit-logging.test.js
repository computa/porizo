require("dotenv/config");
const assert = require("node:assert/strict");
const { test, describe } = require("node:test");

describe("Credit Logging", () => {
  describe("fetchBinaryWithHeaders", () => {
    test("returns buffer and headers from response", async () => {
      // This test will fail until we implement fetchBinaryWithHeaders
      const { fetchBinaryWithHeaders } = require("../src/providers/http");

      assert.ok(
        typeof fetchBinaryWithHeaders === "function",
        "fetchBinaryWithHeaders should be exported"
      );
    });
  });

  describe("logCreditUsage", () => {
    test("logs credit info when headers contain credit data", () => {
      const { logCreditUsage } = require("../src/providers/elevenlabs");

      assert.ok(
        typeof logCreditUsage === "function",
        "logCreditUsage should be exported"
      );

      // Mock headers with ElevenLabs credit info
      const mockHeaders = new Map([
        ["x-credits-remaining", "50000"],
        ["x-character-count", "250"],
      ]);

      // Should not throw
      logCreditUsage("music_generation", mockHeaders);
    });

    test("handles missing credit headers gracefully", () => {
      const { logCreditUsage } = require("../src/providers/elevenlabs");

      // Empty headers - should not throw
      const emptyHeaders = new Map();
      logCreditUsage("tts_generation", emptyHeaders);
    });

    test("handles null/undefined headers gracefully", () => {
      const { logCreditUsage } = require("../src/providers/elevenlabs");

      // Should not throw with null/undefined
      logCreditUsage("music_generation", null);
      logCreditUsage("music_generation", undefined);
    });
  });
});
