require("dotenv/config");
const assert = require("node:assert/strict");
const { test, describe } = require("node:test");

describe("Suno Provider", () => {
  describe("buildSunoPayload", () => {
    test("builds payload with lyrics and music plan", () => {
      const { buildSunoPayload } = require("../src/providers/suno");

      const payload = buildSunoPayload({
        lyrics: {
          title: "Happy Birthday",
          sections: [
            { name: "chorus", lines: ["Happy birthday to you", "Happy birthday dear Sam"] },
          ],
        },
        musicPlan: {
          style: "pop",
          duration_sec: 60,
          bpm: 120,
        },
        track: {
          title: "Birthday Song",
          recipient_name: "Sam",
          occasion: "birthday",
          message: "Wishing you the best",
        },
      });

      assert.ok(payload.prompt, "Should have a prompt");
      assert.ok(payload.prompt.includes("Happy birthday"), "Prompt should include lyrics");
      assert.equal(payload.style, "pop", "Should have style from music plan");
      assert.ok(payload.title, "Should have a title");
    });

    test("handles missing lyrics gracefully", () => {
      const { buildSunoPayload } = require("../src/providers/suno");

      const payload = buildSunoPayload({
        lyrics: null,
        musicPlan: { style: "rock", duration_sec: 90 },
        track: {
          title: "Rock Song",
          recipient_name: "Alex",
          occasion: "thank_you",
          message: "Thanks for everything",
        },
      });

      assert.ok(payload.prompt, "Should have a prompt from track message");
      assert.ok(payload.prompt.includes("Alex") || payload.prompt.includes("thank"),
        "Prompt should use track info as fallback");
    });

    test("sets instrumental flag when no vocals needed", () => {
      const { buildSunoPayload } = require("../src/providers/suno");

      const payload = buildSunoPayload({
        lyrics: { title: "Instrumental", sections: [] },
        musicPlan: { style: "ambient", duration_sec: 60 },
        track: { title: "Chill", recipient_name: "Me", occasion: "relax" },
        instrumental: true,
      });

      assert.equal(payload.instrumental, true, "Should be instrumental");
    });
  });

  describe("generateMusicWithSuno", () => {
    test("throws error when API key is missing", async () => {
      const { generateMusicWithSuno } = require("../src/providers/suno");

      await assert.rejects(
        () => generateMusicWithSuno({
          baseUrl: "https://api.sunoapi.org",
          apiKey: null,
          storageDir: "/tmp",
          track: { id: "t1", user_id: "u1" },
          trackVersion: { version_num: 1 },
          lyrics: null,
          musicPlan: { style: "pop" },
          timeoutMs: 5000,
          kind: "preview",
        }),
        /E302_SUNO_ERROR.*API key/,
        "Should throw error for missing API key"
      );
    });

    test("throws error when base URL is missing", async () => {
      const { generateMusicWithSuno } = require("../src/providers/suno");

      await assert.rejects(
        () => generateMusicWithSuno({
          baseUrl: null,
          apiKey: "test-key",
          storageDir: "/tmp",
          track: { id: "t1", user_id: "u1" },
          trackVersion: { version_num: 1 },
          lyrics: null,
          musicPlan: { style: "pop" },
          timeoutMs: 5000,
          kind: "preview",
        }),
        /E302_SUNO_ERROR.*URL/,
        "Should throw error for missing base URL"
      );
    });

    test("throws error when track is invalid", async () => {
      const { generateMusicWithSuno } = require("../src/providers/suno");

      await assert.rejects(
        () => generateMusicWithSuno({
          baseUrl: "https://api.sunoapi.org",
          apiKey: "test-key",
          storageDir: "/tmp",
          track: null,
          trackVersion: { version_num: 1 },
          lyrics: null,
          musicPlan: { style: "pop" },
          timeoutMs: 5000,
          kind: "preview",
        }),
        /E302_SUNO_ERROR.*track/,
        "Should throw error for invalid track"
      );
    });
  });

  describe("logSunoCreditUsage", () => {
    test("logs credit info from response", () => {
      const { logSunoCreditUsage } = require("../src/providers/suno");

      // Should not throw with valid response
      logSunoCreditUsage("task-123", {
        credits_used: 5,
        credits_remaining: 95,
      });
    });

    test("handles missing credit info gracefully", () => {
      const { logSunoCreditUsage } = require("../src/providers/suno");

      // Should not throw with null/undefined
      logSunoCreditUsage("task-456", null);
      logSunoCreditUsage("task-789", {});
    });
  });
});
