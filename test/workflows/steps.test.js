const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createStepRegistry } = require("../../src/workflows/steps");
const { createGuideVocalSteps } = require("../../src/workflows/steps/guide-vocal");
const { createLyricsSteps } = require("../../src/workflows/steps/lyrics");
const { createMusicPlanSteps } = require("../../src/workflows/steps/music-plan");
const { createModerationSteps } = require("../../src/workflows/steps/moderation");

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

describe("workflow step registry", () => {
  test("creates a lookup map from step factories", () => {
    const registry = createStepRegistry({
      ...createModerationSteps({
        moderationCheck: () => ({ allowed: true }),
        parseJson,
      }),
    });

    assert.equal(typeof registry.get("moderation"), "function");
    assert.equal(registry.get("missing"), undefined);
  });
});

describe("moderation step", () => {
  test("returns existing moderation status without rechecking content", () => {
    let called = false;
    const { moderation } = createModerationSteps({
      moderationCheck: () => {
        called = true;
        return { allowed: true };
      },
      parseJson,
    });

    const result = moderation({
      track: {},
      trackVersion: { moderation_status: "passed" },
    });

    assert.deepEqual(result, { moderation_status: "passed" });
    assert.equal(called, false);
  });

  test("blocks disallowed content", () => {
    const { moderation } = createModerationSteps({
      moderationCheck: () => ({ allowed: false, reason: "policy" }),
      parseJson,
    });

    assert.deepEqual(
      moderation({
        track: { title: "x", recipient_name: "y", message: "z" },
        trackVersion: { lyrics_json: JSON.stringify({ sections: [] }) },
      }),
      {
        moderation_status: "blocked",
        moderation_reason: "policy",
        status_override: "blocked",
      },
    );
  });
});

describe("lyrics step", () => {
  function createLyricsStep(overrides = {}) {
    const calls = [];
    const { lyrics } = createLyricsSteps({
      assertPolicySanitizerPreservedStoryDetails: (args) => {
        calls.push({ name: "assertPolicy", args });
      },
      buildLyricsContext: (track) => ({ trackId: track.id }),
      generateLyrics: async () => ({
        lyrics: { title: "Song", sections: [{ name: "v", lines: ["hi"] }] },
        lyrics_status: "generated",
        provider: "test-provider",
        model: "test-model",
        quality_score: 88,
        acceptance_reason: "ok",
      }),
      mergeProvenanceJson: (_existing, patch) => JSON.stringify(patch),
      nowIso: () => "2026-06-28T00:00:00.000Z",
      parseJson,
      sanitizeLyricsForAllMusicProviders: (lyricsValue) => ({
        lyrics: lyricsValue,
        changed: false,
        blocked: false,
        change_count: 0,
        reports: [],
      }),
      summarizeLyricsContextForLog: (context) => context,
      toJson: JSON.stringify,
      ...overrides,
    });
    return { lyrics, calls };
  }

  test("returns existing lyrics without regenerating", async () => {
    let generated = false;
    const { lyrics } = createLyricsStep({
      generateLyrics: async () => {
        generated = true;
        return {};
      },
    });

    const result = await lyrics({
      track: { id: "track_1" },
      trackVersion: {
        lyrics_json: JSON.stringify({ title: "Existing" }),
        provenance_json: JSON.stringify({ lyrics: { provider: "cached" } }),
      },
    });

    assert.deepEqual(result, {
      lyrics_json: JSON.stringify({ title: "Existing" }),
    });
    assert.equal(generated, false);
  });

  test("generates lyrics and provenance", async () => {
    const { lyrics } = createLyricsStep();

    const result = await lyrics({
      track: { id: "track_1", recipient_name: "Sam" },
      trackVersion: { lyrics_json: null, provenance_json: null },
    });

    assert.equal(result.lyrics_status, "generated");
    assert.equal(
      result.lyrics_json,
      JSON.stringify({ title: "Song", sections: [{ name: "v", lines: ["hi"] }] }),
    );
    const provenance = JSON.parse(result.provenance_json);
    assert.equal(provenance.lyrics.provider, "test-provider");
    assert.equal(provenance.timeline.length, 0);
  });

  test("maps provider availability errors to stable workflow error", async () => {
    const { lyrics } = createLyricsStep({
      generateLyrics: async () => {
        const err = new Error("AI_UNAVAILABLE");
        err.code = "AI_UNAVAILABLE";
        throw err;
      },
    });

    await assert.rejects(
      () =>
        lyrics({
          track: { id: "track_1" },
          trackVersion: { lyrics_json: null, provenance_json: null },
        }),
      /E201_LYRICS_ERROR: AI_UNAVAILABLE/,
    );
  });
});

describe("music plan step", () => {
  function createMusicPlanStep(overrides = {}) {
    const calls = [];
    const { music_plan } = createMusicPlanSteps({
      buildMusicPlan: (args) => {
        calls.push({ name: "buildMusicPlan", args });
        return {
          style: args.style,
          provider_resolved: args.provider,
          generation_mode: args.generationMode,
          plan_schema_version: 2,
          style_prompt_compact: "compact",
          provider_style_hint: "hint",
          style_intent: "intent",
        };
      },
      buildRenderContract: (args) => ({
        provider_locked: args.provider,
        voice_mode: args.voiceMode,
        pipeline:
          args.userVoiceEngine === "suno_voice_persona"
            ? "suno_voice_persona_complete_audio"
            : "provider_complete_audio",
        user_voice_engine: args.userVoiceEngine || null,
        voice_provider_profile_id: args.voiceProviderProfileId || null,
      }),
      db: {},
      findActiveProviderProfileForUser: async () => null,
      findActiveVoiceProfileForUser: async () => null,
      getMusicProviderConfig: async () => ({
        provider: "suno",
        runtimeConfig: {
          elevenlabs_generation_mode: "composition_plan",
          style_overrides: { mood: "bright" },
        },
        routing: {
          requested_provider: "auto",
          provider: "suno",
          support: "native",
          support_score: 1,
          switched: false,
          degraded: false,
          reason: "supported",
          style: "pop",
        },
      }),
      getProviderProfileById: async () => null,
      hasPersonaConsentScope: () => false,
      mergeProvenanceJson: (_existing, patch) => JSON.stringify(patch),
      nowIso: () => "2026-06-28T00:00:00.000Z",
      parseJson,
      PERSONALIZED_VOICE_MODES: new Set(["user_voice", "personalized"]),
      toJson: JSON.stringify,
      ...overrides,
    });
    return { music_plan, calls };
  }

  test("builds an AI voice music plan with render contract provenance", async () => {
    const { music_plan, calls } = createMusicPlanStep();

    const result = await music_plan({
      track: {
        id: "track_1",
        latest_version: 2,
        style: "pop",
        duration_target: 60,
        voice_mode: "ai_voice",
        voice_gender: "female",
      },
      trackVersion: { provenance_json: null },
      job: { step_data: null },
    });

    const plan = JSON.parse(result.music_plan_json);
    assert.equal(plan.provider_resolved, "suno");
    assert.equal(plan.provider_requested, "auto");
    assert.equal(plan.voice_gender, "female");
    assert.equal(plan.render_contract.pipeline, "provider_complete_audio");
    assert.equal(calls[0].args.seed, "track_1:2:pop");

    const provenance = JSON.parse(result.provenance_json);
    assert.equal(provenance.music.provider, "suno");
    assert.equal(provenance.timeline[0].step, "music_plan");
  });

  test("requires an active local voice profile for personalized mode", async () => {
    const { music_plan } = createMusicPlanStep();

    await assert.rejects(
      () =>
        music_plan({
          track: {
            id: "track_1",
            user_id: "user_1",
            style: "pop",
            voice_mode: "user_voice",
          },
          trackVersion: {},
          job: { step_data: null },
        }),
      /E302_VOICE_PROFILE_REQUIRED/,
    );
  });

  test("uses active Suno persona profile for personalized mode", async () => {
    const { music_plan } = createMusicPlanStep({
      findActiveVoiceProfileForUser: async () => ({ id: "voice_1" }),
      findActiveProviderProfileForUser: async () => ({
        id: "vpp_1",
        provider_profile_id: "persona_1",
        consent_scope: "voice_suno_persona_v1",
      }),
      hasPersonaConsentScope: () => true,
    });

    const result = await music_plan({
      track: {
        id: "track_1",
        user_id: "user_1",
        style: "pop",
        voice_mode: "user_voice",
      },
      trackVersion: {},
      job: { step_data: null },
    });

    const plan = JSON.parse(result.music_plan_json);
    assert.equal(plan.render_contract.user_voice_engine, "suno_voice_persona");
    assert.equal(plan.render_contract.voice_provider_profile_id, "vpp_1");
    assert.equal(
      plan.render_contract.pipeline,
      "suno_voice_persona_complete_audio",
    );
  });
});

describe("guide vocal steps", () => {
  function createGuideVocalStep(overrides = {}) {
    const calls = [];
    const storageDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "porizo-guide-step-"),
    );
    const baseTrack = {
      id: "track_1",
      user_id: "user_1",
      style: "pop",
      voice_mode: "ai_voice",
    };
    const baseTrackVersion = {
      id: "version_1",
      version_num: 1,
      guide_access_token: null,
      lyrics_json: JSON.stringify({
        sections: [
          { name: "verse", lines: ["verse line"] },
          { name: "chorus", lines: ["chorus line"] },
        ],
      }),
      music_plan_json: JSON.stringify({
        style: "pop",
        provider_resolved: "elevenlabs",
        render_contract: {
          provider_locked: "elevenlabs",
          voice_mode: "ai_voice",
          pipeline: "guide_tts_and_voice_convert",
        },
      }),
    };
    const steps = createGuideVocalSteps({
      assertFrozenContract: (musicPlan) => {
        calls.push({ name: "assertFrozenContract", musicPlan });
      },
      assertPersonalizedContract: (renderContract, stepName) => {
        calls.push({ name: "assertPersonalizedContract", renderContract, stepName });
      },
      createGuideAccessToken: () => "token_123",
      durabilityService: {
        executeWithDurability: async ({ provider, fn }) => {
          calls.push({ name: "executeWithDurability", provider });
          return fn();
        },
      },
      ensureDir: (dirPath) => fs.mkdirSync(dirPath, { recursive: true }),
      generateSpeech: async (args) => {
        calls.push({ name: "generateSpeech", args });
        fs.writeFileSync(args.outputPath, "mp3");
      },
      getMusicProviderConfig: async (args) => {
        calls.push({ name: "getMusicProviderConfig", args });
        return { provider: "elevenlabs" };
      },
      getVersionDir: (_storageDir, track, trackVersion) =>
        path.join(
          _storageDir,
          "tracks",
          track.user_id,
          track.id,
          `v${trackVersion.version_num}`,
        ),
      lyricsToText: (lyrics, options) => {
        calls.push({ name: "lyricsToText", options });
        if (options?.chorusOnly) {
          return lyrics.sections
            .filter((section) => section.name === "chorus")
            .flatMap((section) => section.lines)
            .join("\n");
        }
        return lyrics.sections.flatMap((section) => section.lines).join("\n");
      },
      parseJson,
      providerConfig: {
        elevenlabs: {
          apiKey: "key",
          baseUrl: "https://elevenlabs.test",
          timeoutMs: 1234,
          ttsVoiceId: "voice_1",
        },
      },
      PROVIDERS: { ELEVENLABS: "elevenlabs" },
      resolveRenderContract: ({ track, musicPlan }) =>
        musicPlan.render_contract || {
          provider_locked: "elevenlabs",
          voice_mode: track.voice_mode === "user_voice" ? "user_voice" : "ai_voice",
          pipeline: "guide_tts_and_voice_convert",
        },
      shouldSkipStep: () => false,
      storageDir,
      streamBaseUrl: "https://stream.test",
      writeWav: (filePath, options) => {
        calls.push({ name: "writeWav", filePath, options });
        fs.writeFileSync(filePath, "wav");
      },
      ...overrides,
    });
    return { ...steps, baseTrack, baseTrackVersion, calls, storageDir };
  }

  test("skips guide vocal when the render contract pipeline excludes it", async () => {
    let speechGenerated = false;
    const { guide_vocal, baseTrack, baseTrackVersion } = createGuideVocalStep({
      generateSpeech: async () => {
        speechGenerated = true;
      },
      shouldSkipStep: (stepName, pipeline) =>
        stepName === "guide_vocal" && pipeline === "provider_complete_audio",
    });

    const result = await guide_vocal({
      track: baseTrack,
      trackVersion: {
        ...baseTrackVersion,
        music_plan_json: JSON.stringify({
          render_contract: {
            provider_locked: "suno",
            voice_mode: "ai_voice",
            pipeline: "provider_complete_audio",
          },
        }),
      },
    });

    assert.deepEqual(result, {});
    assert.equal(speechGenerated, false);
  });

  test("reuses an existing full guide vocal without generating TTS", async () => {
    const {
      guide_vocal_full,
      baseTrack,
      baseTrackVersion,
      calls,
      storageDir,
    } = createGuideVocalStep();
    const versionDir = path.join(
      storageDir,
      "tracks",
      baseTrack.user_id,
      baseTrack.id,
      `v${baseTrackVersion.version_num}`,
    );
    fs.mkdirSync(versionDir, { recursive: true });
    fs.writeFileSync(path.join(versionDir, "guide_vocal_full.mp3"), "cached");

    const result = await guide_vocal_full({
      track: baseTrack,
      trackVersion: baseTrackVersion,
    });

    assert.deepEqual(result, {
      guide_vocal_url:
        "https://stream.test/guide/version_1?token=token_123&kind=full",
      guide_access_token: "token_123",
    });
    assert.equal(
      calls.some((call) => call.name === "generateSpeech"),
      false,
    );
  });

  test("generates preview guide vocal from chorus lyrics", async () => {
    const { guide_vocal, baseTrack, baseTrackVersion, calls } =
      createGuideVocalStep();

    const result = await guide_vocal({
      track: baseTrack,
      trackVersion: baseTrackVersion,
    });

    assert.deepEqual(result, {
      guide_vocal_url: "https://stream.test/guide/version_1?token=token_123",
      guide_access_token: "token_123",
    });
    assert.deepEqual(
      calls.find((call) => call.name === "executeWithDurability"),
      { name: "executeWithDurability", provider: "elevenlabs" },
    );
    assert.deepEqual(
      calls.find((call) => call.name === "lyricsToText").options,
      { chorusOnly: true },
    );
    assert.equal(
      calls.find((call) => call.name === "generateSpeech").args.text,
      "chorus line",
    );
  });

  test("requires TTS config for personalized guide vocal", async () => {
    const { guide_vocal, baseTrack, baseTrackVersion } = createGuideVocalStep({
      providerConfig: { elevenlabs: {} },
    });

    await assert.rejects(
      () =>
        guide_vocal({
          track: { ...baseTrack, voice_mode: "user_voice" },
          trackVersion: {
            ...baseTrackVersion,
            music_plan_json: JSON.stringify({
              render_contract: {
                provider_locked: "elevenlabs",
                voice_mode: "user_voice",
                pipeline: "guide_tts_and_voice_convert",
              },
            }),
          },
        }),
      /E302_PERSONALIZED_NO_TTS/,
    );
  });
});
