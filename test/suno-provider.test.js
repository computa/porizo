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
      assert.equal(payload.model, "V5", "Should default to V5");
      assert.ok(payload.prompt.includes("Happy birthday"), "Prompt should include lyrics");
      assert.ok(!payload.prompt.includes("STYLE GUIDE:"), "Prompt should NOT include style directive");
      assert.ok(payload.style.length > 10, "Style field should be a rich descriptor");
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
      assert.equal(payload.model, "V5");
      assert.ok(payload.prompt.includes("Alex") || payload.prompt.includes("thank"),
        "Prompt should use track info as fallback");
    });

    test("uses configured Suno model when provided", () => {
      const { buildSunoPayload } = require("../src/providers/suno");

      const payload = buildSunoPayload({
        lyrics: null,
        musicPlan: { style: "pop", duration_sec: 60 },
        track: {
          title: "Birthday Song",
          recipient_name: "Sam",
          occasion: "birthday",
          message: "Wishing you the best",
        },
        sunoModel: "V5_5",
      });

      assert.equal(payload.model, "V5_5");
    });

    test("adds Suno voice persona fields without leaking them into prompt or style", () => {
      const { buildSunoPayload, normalizeSunoPersona } = require("../src/providers/suno");

      const persona = normalizeSunoPersona({
        provider_profile_id: "persona_live_123",
        persona_model: "voice_persona",
      });
      assert.deepEqual(persona, {
        personaId: "persona_live_123",
        personaModel: "voice_persona",
        audioWeight: null,
      });

      const payload = buildSunoPayload({
        lyrics: {
          title: "Voice Song",
          sections: [{ name: "chorus", lines: ["This is our chorus"] }],
        },
        musicPlan: { style: "pop", duration_sec: 60 },
        track: { title: "Voice Song" },
        sunoModel: "V5_5",
        sunoPersona: persona,
      });

      assert.equal(payload.model, "V5_5");
      assert.equal(payload.personaId, "persona_live_123");
      assert.equal(payload.personaModel, "voice_persona");
      assert.ok(!payload.prompt.includes("persona_live_123"));
      assert.ok(!payload.style.includes("persona_live_123"));
    });

    test("submitSunoTask sends persona audioWeight and camelCase negativeTags", async () => {
      const { submitSunoTask } = require("../src/providers/suno");
      let submitted;

      const taskId = await submitSunoTask({
        baseUrl: "https://api.sunoapi.org",
        apiKey: "secret",
        lyrics: {
          title: "Voice Song",
          sections: [{ name: "verse", lines: ["Sing this line"] }],
        },
        musicPlan: { style: "pop", duration_sec: 60, style_negative_constraints: ["Heavy Metal"] },
        track: { id: "track_1", user_id: "user_1", title: "Voice Song" },
        timeoutMs: 30000,
        sunoModel: "V5_5",
        sunoPersona: {
          personaId: "persona_live_123",
          personaModel: "voice_persona",
          audioWeight: 0.876,
        },
        fetchJsonFn: async (_url, options) => {
          submitted = JSON.parse(options.body);
          return { code: 200, msg: "success", data: { taskId: "task_123" } };
        },
      });

      assert.equal(taskId, "task_123");
      assert.equal(submitted.personaId, "persona_live_123");
      assert.equal(submitted.personaModel, "voice_persona");
      assert.equal(submitted.audioWeight, 0.88);
      assert.equal(submitted.negativeTags, "Heavy Metal");
      assert.equal(submitted.negative_tags, undefined);
    });

    test("falls back to V5 for invalid configured Suno model", () => {
      const { buildSunoPayload } = require("../src/providers/suno");

      const payload = buildSunoPayload({
        lyrics: null,
        musicPlan: { style: "pop", duration_sec: 60 },
        track: {
          title: "Birthday Song",
          recipient_name: "Sam",
          occasion: "birthday",
          message: "Wishing you the best",
        },
        sunoModel: "v6",
      });

      assert.equal(payload.model, "V5");
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

    test("normalizes underscore styles for provider and keeps style guidance", () => {
      const { buildSunoPayload } = require("../src/providers/suno");

      const payload = buildSunoPayload({
        lyrics: {
          title: "Noite de Amor",
          sections: [{ name: "chorus", lines: ["Danca comigo"] }],
        },
        musicPlan: {
          style: "bossa_nova",
          style_prompt: "bossa nova syncopation, nylon guitar, smooth Brazilian groove",
          duration_sec: 60,
        },
        track: {
          title: "Romance",
          recipient_name: "Ana",
          occasion: "anniversary",
          message: "Forever with you",
        },
      });

      assert.ok(payload.style.includes("bossa nova"), "Style field should contain genre descriptor");
      assert.ok(
        !payload.prompt.includes("STYLE GUIDE:"),
        "Prompt should NOT include style directive — lyrics only"
      );
    });
  });

  describe("policy sanitization", () => {
    test("generic sanitizer normalizes merged tens and ages for Suno", () => {
      const { sanitizeLyricsForProviderPolicy } = require("../src/services/lyrics-policy-sanitizer");

      const input = {
        title: "Ninety-Three Candles",
        anchor_line: "Celebrate ninetythree bright years",
        sections: [
          { name: "verse", lines: ["Happy ninetythree years with grace", "You are 93 years strong"] },
        ],
      };

      const result = sanitizeLyricsForProviderPolicy({ lyrics: input, provider: "suno" });
      assert.equal(result.changed, true);
      assert.ok(result.change_count >= 2);
      assert.equal(result.lyrics.title, "Ninety Three Candles");
      assert.equal(result.lyrics.anchor_line, "Celebrate ninety three bright years");
      assert.equal(result.lyrics.sections[0].lines[0], "Happy ninety three years with grace");
      assert.ok(result.lyrics.sections[0].lines[1].includes("ninety three"));
    });

    test("buildSunoPayload sanitizes title fallback from track metadata", () => {
      const { buildSunoPayload } = require("../src/providers/suno");

      const payload = buildSunoPayload({
        lyrics: null,
        musicPlan: { style: "highlife", duration_sec: 90 },
        track: {
          title: "Ninety-Three Candles",
          recipient_name: "Mum",
          occasion: "birthday",
          message: "A joyful celebration",
        },
      });

      assert.equal(payload.title, "Ninety Three Candles");
    });

    test("isSunoPolicyError detects policy rejection text", () => {
      const { isSunoPolicyError } = require("../src/providers/suno");

      assert.equal(
        isSunoPolicyError("Your lyrics contain producer tag ninetythree - please change your lyrics"),
        true
      );
      assert.equal(
        isSunoPolicyError("Generation failed due to network timeout"),
        false
      );
    });
  });

  describe("response readiness parsing", () => {
    test("classifySunoStatus separates provisional and terminal audio success", () => {
      const { classifySunoStatus } = require("../src/providers/suno");

      assert.equal(classifySunoStatus("TEXT_SUCCESS").phase, "provisional_success");
      assert.equal(classifySunoStatus("AUDIO_SUCCESS").phase, "audio_success");
      assert.equal(classifySunoStatus("FAILED").phase, "failed");
      assert.equal(classifySunoStatus("CREATE_TASK_FAILED").phase, "failed");
      assert.equal(classifySunoStatus("GENERATE_FAILED").phase, "failed");
      assert.equal(classifySunoStatus("PENDING").phase, "pending");
    });

    test("inspectSunoAudioReadiness supports snake_case and camelCase audio fields", () => {
      const { inspectSunoAudioReadiness } = require("../src/providers/suno");

      const snakeCase = inspectSunoAudioReadiness({
        data: {
          status: "TEXT_SUCCESS",
          response: {
            suno_data: [
              { source_audio_url: "https://cdn.example.com/audio-one.mp3" },
            ],
          },
        },
      });
      assert.equal(snakeCase.ready, true);
      assert.equal(snakeCase.audioUrl, "https://cdn.example.com/audio-one.mp3");

      const camelCase = inspectSunoAudioReadiness({
        data: {
          status: "SUCCESS",
          response: {
            sunoData: [
              { sourceAudioUrl: "https://cdn.example.com/audio-two.mp3" },
            ],
          },
        },
      });
      assert.equal(camelCase.ready, true);
      assert.equal(camelCase.audioUrl, "https://cdn.example.com/audio-two.mp3");
    });

    test("inspectSunoAudioReadiness identifies success without audio URL as incomplete", () => {
      const { inspectSunoAudioReadiness } = require("../src/providers/suno");

      const noAudioUrl = inspectSunoAudioReadiness({
        data: {
          status: "TEXT_SUCCESS",
          response: {
            sunoData: [{ id: "track-1", title: "demo" }],
          },
        },
      });
      assert.equal(noAudioUrl.ready, false);
      assert.equal(noAudioUrl.reason, "no_audio_url");

      const noData = inspectSunoAudioReadiness({
        data: {
          status: "TEXT_SUCCESS",
          response: {},
        },
      });
      assert.equal(noData.ready, false);
      assert.equal(noData.reason, "no_audio_data");
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
