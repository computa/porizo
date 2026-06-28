const { describe, test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createStepRegistry } = require("../../src/workflows/steps");
const { createGuideVocalSteps } = require("../../src/workflows/steps/guide-vocal");
const {
  createInstrumentalSteps,
} = require("../../src/workflows/steps/instrumental");
const { createLyricsSteps } = require("../../src/workflows/steps/lyrics");
const { createMixSteps } = require("../../src/workflows/steps/mix");
const { createMusicPlanSteps } = require("../../src/workflows/steps/music-plan");
const { createModerationSteps } = require("../../src/workflows/steps/moderation");
const {
  createVoiceConversionSteps,
} = require("../../src/workflows/steps/voice-conversion");
const { createWatermarkSteps } = require("../../src/workflows/steps/watermark");
const { createReadySteps } = require("../../src/workflows/steps/ready");

const tempDirsToClean = [];

afterEach(() => {
  while (tempDirsToClean.length > 0) {
    fs.rmSync(tempDirsToClean.pop(), { recursive: true, force: true });
  }
});

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

describe("instrumental steps", () => {
  function createInstrumentalStep(overrides = {}) {
    const calls = [];
    const storageDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "porizo-instrumental-step-"),
    );
    tempDirsToClean.push(storageDir);
    const baseTrack = {
      id: "track_1",
      user_id: "user_1",
      recipient_name: "Bob",
      style: "pop",
      voice_mode: "ai_voice",
    };
    const basePlan = {
      style: "pop",
      provider_resolved: "suno",
      generation_mode: "compose_detailed",
      render_contract: {
        provider_locked: "suno",
        voice_mode: "ai_voice",
        pipeline: "provider_complete_audio",
      },
    };
    const baseTrackVersion = {
      id: "version_1",
      version_num: 1,
      lyrics_json: JSON.stringify({ sections: [{ lines: ["happy birthday"] }] }),
      music_plan_json: JSON.stringify(basePlan),
      provenance_json: null,
      instrumental_url: null,
    };
    const getVersionDir = (_storageDir, track, trackVersion) =>
      path.join(
        _storageDir,
        "tracks",
        track.user_id,
        track.id,
        `v${trackVersion.version_num}`,
      );
    const steps = createInstrumentalSteps({
      assertFrozenContract: (musicPlan) => {
        calls.push({ name: "assertFrozenContract", musicPlan });
      },
      assertPersonalizedContract: (renderContract, stepName) => {
        calls.push({ name: "assertPersonalizedContract", renderContract, stepName });
      },
      assertPolicySanitizerPreservedStoryDetails: (args) => {
        calls.push({ name: "assertPolicySanitizerPreservedStoryDetails", args });
      },
      buildLyricsContext: (track) => ({ trackId: track.id }),
      buildPolicyPreflightError: () =>
        new Error("E302_PROVIDER_POLICY_ERROR: blocked"),
      durabilityService: {
        executeWithDurability: async ({ fn }) => fn(),
      },
      extractProviderAudioUrl: (metadata) => metadata.instrumental_url || null,
      getMusicProviderConfig: async () => null,
      getProviderAudioKey: () => null,
      getProviderAudioUrl: () => null,
      getVersionDir,
      jobDurabilityRepository: {
        attachExternalTask: async (args) => {
          calls.push({ name: "attachExternalTask", args });
        },
      },
      logProviderRejection: (args) => {
        calls.push({ name: "logProviderRejection", args });
      },
      logSanitizerIntervention: (args) => {
        calls.push({ name: "logSanitizerIntervention", args });
      },
      lyricsHashSha256: () => "lyrics_hash",
      mergeProvenanceJson: (_existing, patch) => JSON.stringify(patch),
      nowIso: () => "2026-06-28T00:00:00.000Z",
      parseJson,
      pollOrSubmitSunoTask: async () => ({}),
      PROVIDERS: { SUNO: "suno", ELEVENLABS: "elevenlabs" },
      recoverSunoResultFromExistingTask: async () => null,
      renderGuideVocal: (args) => {
        calls.push({ name: "renderGuideVocal", args });
      },
      renderInstrumental: (args) => {
        calls.push({ name: "renderInstrumental", args });
      },
      renderWithProvider: async () => ({ raw: {} }),
      resolveRenderContract: ({ musicPlan }) => musicPlan.render_contract,
      resolveSunoPersonaForRender: async (args) => {
        calls.push({ name: "resolveSunoPersonaForRender", args });
        return null;
      },
      runnerId: "runner_1",
      sanitizeLyricsForProviderPolicy: ({ lyrics }) => ({ lyrics }),
      sanitizeProviderRoutingForContract: (routing) => routing,
      storageDir,
      storageProvider: null,
      summarizePolicyTerms: () => ["term"],
      toJson: JSON.stringify,
      ...overrides,
    });
    const versionDir = getVersionDir(storageDir, baseTrack, baseTrackVersion);
    fs.mkdirSync(versionDir, { recursive: true });
    return { ...steps, baseTrack, baseTrackVersion, basePlan, calls, versionDir };
  }

  test("reuses existing preview instrumental file without provider work", async () => {
    const { instrumental, baseTrack, baseTrackVersion, calls, versionDir } =
      createInstrumentalStep({
        getMusicProviderConfig: async () => ({ provider: "suno" }),
      });
    fs.writeFileSync(path.join(versionDir, "inst_preview.mp3"), "cached");

    const result = await instrumental({
      track: baseTrack,
      trackVersion: baseTrackVersion,
      job: { id: "job_1" },
    });

    assert.deepEqual(result, {});
    assert.equal(calls.some((call) => call.name === "resolveSunoPersonaForRender"), false);
  });

  test("requires lyrics before preview and full instrumental steps", async () => {
    const { instrumental, instrumental_full, baseTrack, baseTrackVersion } =
      createInstrumentalStep();
    const trackVersion = { ...baseTrackVersion, lyrics_json: null };

    await assert.rejects(
      () => instrumental({ track: baseTrack, trackVersion, job: null }),
      /lyrics_json is required before instrumental step/,
    );
    await assert.rejects(
      () => instrumental_full({ track: baseTrack, trackVersion, job: null }),
      /lyrics_json is required before instrumental_full step/,
    );
  });

  test("runs personalized contract guards", async () => {
    const { instrumental, baseTrack, baseTrackVersion, basePlan, calls } =
      createInstrumentalStep();

    await assert.rejects(
      () =>
        instrumental({
          track: { ...baseTrack, voice_mode: "user_voice" },
          trackVersion: {
            ...baseTrackVersion,
            music_plan_json: JSON.stringify({
              ...basePlan,
              render_contract: {
                provider_locked: "suno",
                voice_mode: "user_voice",
                pipeline: "suno_voice_persona_complete_audio",
              },
            }),
            lyrics_json: null,
          },
          job: null,
        }),
      /lyrics_json is required/,
    );
    assert.equal(
      calls.some((call) => call.name === "assertFrozenContract"),
      true,
    );
    assert.equal(
      calls.some((call) => call.name === "assertPersonalizedContract"),
      true,
    );
  });

  test("returns pending Suno result without provenance normalization", async () => {
    const { instrumental, baseTrack, baseTrackVersion } = createInstrumentalStep({
      getMusicProviderConfig: async () => ({
        provider: "suno",
        routing: { provider: "suno", reason: "pinned_provider" },
      }),
      pollOrSubmitSunoTask: async () => ({
        pending: true,
        task_id: "task_1",
      }),
    });

    const result = await instrumental({
      track: baseTrack,
      trackVersion: baseTrackVersion,
      job: { id: "job_1" },
    });

    assert.deepEqual(result, { pending: true, task_id: "task_1" });
  });

  test("normalizes Suno success with provenance", async () => {
    const { instrumental_full, baseTrack, baseTrackVersion, basePlan } =
      createInstrumentalStep({
        getMusicProviderConfig: async () => ({
          provider: "suno",
          routing: { provider: "suno", reason: "pinned_provider" },
        }),
        pollOrSubmitSunoTask: async () => ({
          instrumental_url: "https://provider.test/full.mp3",
          guide_vocal_url: "https://provider.test/guide.mp3",
          provider_audio_key: "tracks/provider/full.mp3",
        }),
      });

    const result = await instrumental_full({
      track: baseTrack,
      trackVersion: {
        ...baseTrackVersion,
        music_plan_json: JSON.stringify({
          ...basePlan,
          render_contract: {
            ...basePlan.render_contract,
            pipeline: "guide_tts_and_voice_convert",
          },
        }),
      },
      job: { id: "job_1" },
    });

    assert.equal(result.instrumental_url, "https://provider.test/full.mp3");
    assert.equal(result.guide_vocal_url, "https://provider.test/guide.mp3");
    const provenance = JSON.parse(result.provenance_json);
    assert.equal(provenance.music.provider_audio_key, "tracks/provider/full.mp3");
    assert.equal(provenance.timeline[0].step, "instrumental_full");
  });

  test("recovers Suno output after incomplete-output error", async () => {
    const { instrumental, baseTrack, baseTrackVersion } = createInstrumentalStep({
      getMusicProviderConfig: async () => ({
        provider: "suno",
        routing: { provider: "suno", reason: "pinned_provider" },
      }),
      pollOrSubmitSunoTask: async () => {
        throw new Error("E302_SUNO_INCOMPLETE_OUTPUT: status=complete");
      },
      recoverSunoResultFromExistingTask: async () => ({
        instrumental_url: "https://provider.test/recovered.mp3",
      }),
    });

    const result = await instrumental({
      track: baseTrack,
      trackVersion: baseTrackVersion,
      job: { id: "job_1" },
    });

    assert.equal(result.instrumental_url, "https://provider.test/recovered.mp3");
  });

  test("generic provider result includes provenance and attaches task id", async () => {
    const { instrumental, baseTrack, baseTrackVersion, calls } =
      createInstrumentalStep({
        getMusicProviderConfig: async () => ({
          provider: "elevenlabs",
          runtimeConfig: { elevenlabs_generation_mode: "composition_plan" },
          routing: { provider: "elevenlabs", reason: "supported" },
        }),
        renderWithProvider: async ({ onTaskId }) => {
          await onTaskId("provider_task_1");
          return {
            raw: {
              instrumental_url: "https://provider.test/preview.mp3",
              provider_audio_key: "tracks/provider/preview.mp3",
              generation_mode: "composition_plan",
            },
          };
        },
      });

    const result = await instrumental({
      track: baseTrack,
      trackVersion: baseTrackVersion,
      job: { id: "job_1" },
    });

    assert.equal(result.instrumental_url, "https://provider.test/preview.mp3");
    assert.equal(
      calls.find((call) => call.name === "attachExternalTask").args.externalTaskId,
      "provider_task_1",
    );
    const provenance = JSON.parse(result.provenance_json);
    assert.equal(provenance.music.provider, "elevenlabs");
  });

  test("records changed policy preflight metadata", async () => {
    const { instrumental, baseTrack, baseTrackVersion, calls } =
      createInstrumentalStep({
        getMusicProviderConfig: async () => ({
          provider: "elevenlabs",
          routing: { provider: "elevenlabs", reason: "supported" },
        }),
        sanitizeLyricsForProviderPolicy: ({ lyrics }) => ({
          lyrics,
          changed: true,
          rewrite_passes: 1,
          change_count: 2,
          violations: ["term"],
        }),
        renderWithProvider: async () => ({
          raw: { instrumental_url: "https://provider.test/preview.mp3" },
        }),
      });

    const result = await instrumental({
      track: baseTrack,
      trackVersion: baseTrackVersion,
      job: null,
    });

    assert.equal(result.policy_preflight, undefined);
    assert.equal(
      calls.some((call) => call.name === "assertPolicySanitizerPreservedStoryDetails"),
      true,
    );
    assert.equal(
      calls.some((call) => call.name === "logSanitizerIntervention"),
      true,
    );
    const provenance = JSON.parse(result.provenance_json);
    assert.equal(provenance.music.policy_preflight.changed, true);
  });

  test("throws policy preflight error when blocked", async () => {
    const { instrumental, baseTrack, baseTrackVersion, calls } =
      createInstrumentalStep({
        getMusicProviderConfig: async () => ({
          provider: "elevenlabs",
          routing: { provider: "elevenlabs", reason: "supported" },
        }),
        sanitizeLyricsForProviderPolicy: ({ lyrics }) => ({
          lyrics,
          blocked: true,
          violations: ["term"],
        }),
      });

    await assert.rejects(
      () =>
        instrumental({
          track: baseTrack,
          trackVersion: baseTrackVersion,
          job: null,
        }),
      /E302_PROVIDER_POLICY_ERROR/,
    );
    assert.equal(calls.some((call) => call.name === "logProviderRejection"), true);
  });

  test("uses local fallback renderers when no provider is live", async () => {
    const { instrumental_full, baseTrack, baseTrackVersion, calls } =
      createInstrumentalStep();

    await instrumental_full({
      track: baseTrack,
      trackVersion: baseTrackVersion,
      job: null,
    });

    assert.deepEqual(
      calls
        .filter((call) => ["renderInstrumental", "renderGuideVocal"].includes(call.name))
        .map((call) => `${call.name}:${call.args.kind}`),
      ["renderInstrumental:full", "renderGuideVocal:full"],
    );
  });
});

describe("guide vocal steps", () => {
  function createGuideVocalStep(overrides = {}) {
    const calls = [];
    const storageDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "porizo-guide-step-"),
    );
    tempDirsToClean.push(storageDir);
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

  test("does not reuse a zero-byte full guide vocal", async () => {
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
    fs.writeFileSync(path.join(versionDir, "guide_vocal_full.mp3"), "");

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
      true,
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

describe("voice conversion steps", () => {
  function createVoiceConversionStep(overrides = {}) {
    const calls = [];
    const storageDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "porizo-voice-step-"),
    );
    tempDirsToClean.push(storageDir);
    const baseTrack = {
      id: "track_1",
      user_id: "user_1",
      voice_mode: "ai_voice",
    };
    const baseTrackVersion = {
      id: "version_1",
      version_num: 1,
      guide_vocal_url: "https://stream.test/guide/version_1?token=token_123",
      music_plan_json: JSON.stringify({
        render_contract: {
          provider_locked: "elevenlabs",
          voice_mode: "ai_voice",
          pipeline: "guide_tts_and_voice_convert",
        },
      }),
      provider_audio_url: null,
    };
    const steps = createVoiceConversionSteps({
      applyVocalPolish: async (args) => {
        calls.push({ name: "applyVocalPolish", args });
      },
      assertFrozenContract: (musicPlan) => {
        calls.push({ name: "assertFrozenContract", musicPlan });
      },
      assertPersonalizedContract: (renderContract, stepName) => {
        calls.push({ name: "assertPersonalizedContract", renderContract, stepName });
      },
      convertVoice: async (args) => {
        calls.push({ name: "convertVoice", args });
        return { output_url: "https://replicate.test/output.wav" };
      },
      db: {},
      durabilityService: {
        executeWithDurability: async ({ provider, fn }) => {
          calls.push({ name: "executeWithDurability", provider });
          return fn();
        },
      },
      ensureUserVocalFromGuide: async (args) => {
        calls.push({ name: "ensureUserVocalFromGuide", args });
        return path.join(args.versionDir, "user_vocal.wav");
      },
      getProviderAudioUrl: (trackVersion) => trackVersion.provider_audio_url,
      getVersionDir: (_storageDir, track, trackVersion) =>
        path.join(
          _storageDir,
          "tracks",
          track.user_id,
          track.id,
          `v${trackVersion.version_num}`,
        ),
      parseJson,
      performVoiceConversion: async (args) => {
        calls.push({ name: "performVoiceConversion", args });
        return { output_url: "https://seedvc.test/output.wav" };
      },
      providerConfig: { replicate: { live: false, token: "replicate_token" } },
      PROVIDERS: { REPLICATE: "replicate" },
      resolveRenderContract: ({ track, musicPlan }) =>
        musicPlan.render_contract || {
          provider_locked: "elevenlabs",
          voice_mode: track.voice_mode === "user_voice" ? "user_voice" : "ai_voice",
          pipeline: "guide_tts_and_voice_convert",
        },
      shouldSkipStep: () => false,
      storageDir,
      storageProvider: { name: "storage" },
      ...overrides,
    });
    return { ...steps, baseTrack, baseTrackVersion, calls, storageDir };
  }

  test("reuses an existing full converted vocal without parsing contract", async () => {
    let parsed = false;
    const {
      voice_convert_sections,
      baseTrack,
      baseTrackVersion,
      storageDir,
      calls,
    } = createVoiceConversionStep({
      parseJson: () => {
        parsed = true;
        return null;
      },
    });
    const versionDir = path.join(
      storageDir,
      "tracks",
      baseTrack.user_id,
      baseTrack.id,
      `v${baseTrackVersion.version_num}`,
    );
    fs.mkdirSync(versionDir, { recursive: true });
    fs.writeFileSync(path.join(versionDir, "user_vocal_full.wav"), "cached");

    const result = await voice_convert_sections({
      track: baseTrack,
      trackVersion: baseTrackVersion,
    });

    assert.deepEqual(result, { voice_conversion_url: null });
    assert.equal(parsed, false);
    assert.equal(calls.length, 0);
  });

  test("skips voice conversion when the render contract pipeline excludes it", async () => {
    const { voice_convert, baseTrack, baseTrackVersion, calls } =
      createVoiceConversionStep({
        shouldSkipStep: (stepName, pipeline) =>
          stepName === "voice_convert" && pipeline === "provider_complete_audio",
      });

    const result = await voice_convert({
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
    assert.equal(
      calls.some((call) => call.name === "convertVoice"),
      false,
    );
  });

  test("uses live Replicate for AI preview voice conversion", async () => {
    const { voice_convert, baseTrack, baseTrackVersion, calls } =
      createVoiceConversionStep({
        providerConfig: { replicate: { live: true, token: "replicate_token" } },
      });

    const result = await voice_convert({
      track: baseTrack,
      trackVersion: baseTrackVersion,
    });

    assert.deepEqual(result, {
      voice_conversion_url: "https://replicate.test/output.wav",
    });
    assert.deepEqual(
      calls.find((call) => call.name === "executeWithDurability"),
      { name: "executeWithDurability", provider: "replicate" },
    );
    const convertCall = calls.find((call) => call.name === "convertVoice");
    assert.equal(convertCall.args.kind, "preview");
    assert.equal(convertCall.args.inputUrl, baseTrackVersion.guide_vocal_url);
  });

  test("builds full AI vocal from local guide when live conversion is disabled", async () => {
    const { voice_convert_sections, baseTrack, baseTrackVersion, calls } =
      createVoiceConversionStep();

    const result = await voice_convert_sections({
      track: baseTrack,
      trackVersion: baseTrackVersion,
    });

    assert.deepEqual(result, {
      voice_conversion_url: baseTrackVersion.guide_vocal_url,
    });
    const ensureCall = calls.find(
      (call) => call.name === "ensureUserVocalFromGuide",
    );
    assert.equal(ensureCall.args.kind, "full");
  });

  test("uses provider audio and applies polish for personalized conversion", async () => {
    const { voice_convert_sections, baseTrack, baseTrackVersion, calls } =
      createVoiceConversionStep();
    const trackVersion = {
      ...baseTrackVersion,
      provider_audio_url: "https://provider.test/song.wav",
      music_plan_json: JSON.stringify({
        render_contract: {
          provider_locked: "elevenlabs",
          voice_mode: "user_voice",
          pipeline: "provider_audio_personalized_convert",
        },
      }),
    };

    const result = await voice_convert_sections({
      track: { ...baseTrack, voice_mode: "user_voice" },
      trackVersion,
    });

    assert.deepEqual(result, {
      voice_conversion_url: "https://seedvc.test/output.wav",
    });
    const conversionCall = calls.find(
      (call) => call.name === "performVoiceConversion",
    );
    assert.equal(conversionCall.args.kind, "full");
    assert.equal(
      conversionCall.args.conversionSourceUrl,
      "https://provider.test/song.wav",
    );
    assert.equal(
      calls.find((call) => call.name === "applyVocalPolish").args.kind,
      "full",
    );
    assert.equal(
      calls.some((call) => call.name === "assertPersonalizedContract"),
      true,
    );
  });

  test("personalized conversion reports whether provider audio or guide vocal is missing", async () => {
    const { voice_convert, baseTrack, baseTrackVersion } =
      createVoiceConversionStep();

    await assert.rejects(
      () =>
        voice_convert({
          track: { ...baseTrack, voice_mode: "user_voice" },
          trackVersion: {
            ...baseTrackVersion,
            guide_vocal_url: null,
            music_plan_json: JSON.stringify({
              render_contract: {
                provider_locked: "elevenlabs",
                voice_mode: "user_voice",
                pipeline: "guide_tts_and_voice_convert",
              },
            }),
          },
        }),
      /Guide vocal URL required for voice conversion/,
    );
  });
});

describe("mix step", () => {
  function createMixStep(overrides = {}) {
    const calls = [];
    const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-mix-step-"));
    tempDirsToClean.push(storageDir);
    const baseTrack = {
      id: "track_1",
      user_id: "user_1",
      style: "pop",
      voice_mode: "ai_voice",
    };
    const basePlan = {
      style: "pop",
      provider_resolved: null,
      render_contract: {
        provider_locked: "suno",
        voice_mode: "ai_voice",
        pipeline: "guide_tts_and_voice_convert",
      },
    };
    const baseTrackVersion = {
      id: "version_1",
      version_num: 1,
      music_plan_json: JSON.stringify(basePlan),
      provenance_json: null,
      instrumental_url: null,
    };
    const getVersionDir = (_storageDir, track, trackVersion) =>
      path.join(
        _storageDir,
        "tracks",
        track.user_id,
        track.id,
        `v${trackVersion.version_num}`,
      );
    const steps = createMixSteps({
      assertFrozenContract: (musicPlan) => {
        calls.push({ name: "assertFrozenContract", musicPlan });
      },
      assertPersonalizedContract: (renderContract, stepName) => {
        calls.push({ name: "assertPersonalizedContract", renderContract, stepName });
      },
      blendVocals: async (args) => {
        calls.push({ name: "blendVocals", args });
        fs.copyFileSync(args.convertedVocalPath, args.outputPath);
      },
      db: {},
      ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
      ensureUserVocalFromGuide: async () => false,
      getFeatureFlags: async () => ({}),
      getMusicProviderConfig: async () => null,
      getProviderAudioKey: () => null,
      getProviderAudioUrl: () => null,
      getVersionDir,
      isProviderCompleteAudioPipeline: (pipeline) =>
        pipeline === "provider_complete_audio" ||
        pipeline === "suno_voice_persona_complete_audio",
      mixTracks: async (args) => {
        calls.push({ name: "mixTracks", args });
        fs.writeFileSync(args.outputPath, "mixed");
      },
      mixTracksPersonalized: async (args) => {
        calls.push({ name: "mixTracksPersonalized", args });
        fs.writeFileSync(args.outputPath, "personalized-mixed");
      },
      parseJson,
      providerConfig: { replicate: { live: false } },
      resolveRenderContract: ({ musicPlan }) => musicPlan.render_contract,
      runFFmpeg: async (args) => {
        calls.push({ name: "runFFmpeg", args });
        fs.writeFileSync(args[args.length - 1], "ffmpeg-output");
      },
      storageDir,
      storageProvider: null,
      writeWav: (filePath) => {
        calls.push({ name: "writeWav", filePath });
        fs.writeFileSync(filePath, "placeholder");
      },
      ...overrides,
    });
    const versionDir = getVersionDir(storageDir, baseTrack, baseTrackVersion);
    fs.mkdirSync(versionDir, { recursive: true });
    return { ...steps, baseTrack, baseTrackVersion, basePlan, calls, versionDir };
  }

  test("provider-complete audio accepts local wav fallback output", async () => {
    const { mix, baseTrack, baseTrackVersion, basePlan, calls, versionDir } =
      createMixStep();
    fs.writeFileSync(path.join(versionDir, "inst_preview.wav"), "provider wav");

    await mix({
      track: baseTrack,
      trackVersion: {
        ...baseTrackVersion,
        music_plan_json: JSON.stringify({
          ...basePlan,
          render_contract: {
            ...basePlan.render_contract,
            pipeline: "provider_complete_audio",
          },
        }),
      },
      workflow: "preview_render",
    });

    const ffmpegCall = calls.find((call) => call.name === "runFFmpeg");
    assert.ok(ffmpegCall);
    assert.equal(ffmpegCall.args[2], path.join(versionDir, "inst_preview.wav"));
    assert.equal(fs.readFileSync(path.join(versionDir, "mix.wav"), "utf8"), "ffmpeg-output");
  });

  test("AI voice builds missing vocal from guide before standard mixing", async () => {
    const { mix, baseTrack, baseTrackVersion, calls, versionDir } =
      createMixStep({
        ensureUserVocalFromGuide: async ({ versionDir: dir }) => {
          calls.push({ name: "ensureUserVocalFromGuide", versionDir: dir });
          fs.writeFileSync(path.join(dir, "user_vocal.wav"), "guide vocal");
          return true;
        },
      });
    fs.writeFileSync(path.join(versionDir, "inst_preview.mp3"), "instrumental");

    await mix({
      track: baseTrack,
      trackVersion: baseTrackVersion,
      workflow: "preview_render",
    });

    assert.equal(
      calls.some((call) => call.name === "ensureUserVocalFromGuide"),
      true,
    );
    assert.equal(calls.find((call) => call.name === "mixTracks").args.vocalPath, path.join(versionDir, "user_vocal.wav"));
  });

  test("personalized Suno mix requires Demucs instrumental stems", async () => {
    const { mix, baseTrack, baseTrackVersion, basePlan, versionDir } =
      createMixStep();
    fs.writeFileSync(path.join(versionDir, "user_vocal.wav"), "converted vocal");

    await assert.rejects(
      () =>
        mix({
          track: { ...baseTrack, voice_mode: "user_voice" },
          trackVersion: {
            ...baseTrackVersion,
            music_plan_json: JSON.stringify({
              ...basePlan,
              render_contract: {
                provider_locked: "suno",
                voice_mode: "user_voice",
                pipeline: "guide_tts_and_voice_convert",
              },
            }),
          },
          workflow: "preview_render",
        }),
      /E301_MISSING_STEMS/,
    );
  });

  test("throws when live provider output is required and mix inputs are missing", async () => {
    const { mix, baseTrack, baseTrackVersion } = createMixStep({
      providerConfig: { replicate: { live: true } },
    });

    await assert.rejects(
      () =>
        mix({
          track: baseTrack,
          trackVersion: baseTrackVersion,
          workflow: "preview_render",
        }),
      /E301_MISSING_INPUTS: Vocal or instrumental missing for mix/,
    );
  });

  test("writes placeholder mix when no live provider requires real audio", async () => {
    const { mix, baseTrack, baseTrackVersion, calls, versionDir } =
      createMixStep();

    await mix({
      track: baseTrack,
      trackVersion: baseTrackVersion,
      workflow: "preview_render",
    });

    assert.equal(calls.find((call) => call.name === "writeWav").filePath, path.join(versionDir, "mix.wav"));
    assert.equal(fs.readFileSync(path.join(versionDir, "mix.wav"), "utf8"), "placeholder");
  });
});

describe("watermark step", () => {
  function createWatermarkStep(overrides = {}) {
    const calls = [];
    const storageDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "porizo-watermark-step-"),
    );
    tempDirsToClean.push(storageDir);
    const baseTrack = {
      id: "track_1",
      user_id: "user_1",
      style: "pop",
    };
    const baseTrackVersion = {
      id: "version_1",
      version_num: 1,
      music_plan_json: JSON.stringify({
        style: "pop",
        provider_resolved: null,
      }),
    };
    const getVersionDir = (_storageDir, track, trackVersion) =>
      path.join(
        _storageDir,
        "tracks",
        track.user_id,
        track.id,
        `v${trackVersion.version_num}`,
      );
    const steps = createWatermarkSteps({
      createHLSPlaylist: async (outputPath, hlsDir, segmentSeconds) => {
        calls.push({
          name: "createHLSPlaylist",
          outputPath,
          hlsDir,
          segmentSeconds,
        });
        fs.mkdirSync(hlsDir, { recursive: true });
        fs.writeFileSync(path.join(hlsDir, "index.m3u8"), "#EXTM3U");
      },
      embedWatermark: async (inputPath, outputPath, trackVersionId) => {
        calls.push({
          name: "embedWatermark",
          inputPath,
          outputPath,
          trackVersionId,
        });
        fs.writeFileSync(outputPath, "watermarked");
      },
      encodeToAAC: async (inputPath, outputPath, bitrate) => {
        calls.push({ name: "encodeToAAC", inputPath, outputPath, bitrate });
        fs.writeFileSync(outputPath, "aac");
      },
      ensureDir: (dirPath) => fs.mkdirSync(dirPath, { recursive: true }),
      getMusicProviderConfig: async (args) => {
        calls.push({ name: "getMusicProviderConfig", args });
        return null;
      },
      getVersionDir,
      parseJson,
      providerConfig: { replicate: { live: false } },
      storageDir,
      writeWav: (filePath, options) => {
        calls.push({ name: "writeWav", filePath, options });
        fs.writeFileSync(filePath, "wav");
      },
      ...overrides,
    });
    return {
      ...steps,
      baseTrack,
      baseTrackVersion,
      calls,
      getVersionDir,
      storageDir,
    };
  }

  test("embeds watermark, encodes AAC, creates HLS, and removes intermediates", async () => {
    const {
      watermark,
      baseTrack,
      baseTrackVersion,
      calls,
      getVersionDir,
      storageDir,
    } = createWatermarkStep();
    const versionDir = getVersionDir(storageDir, baseTrack, baseTrackVersion);
    fs.mkdirSync(versionDir, { recursive: true });
    fs.writeFileSync(path.join(versionDir, "mix.wav"), "mix");

    const result = await watermark({
      track: baseTrack,
      trackVersion: baseTrackVersion,
      workflow: "preview_render",
    });

    assert.deepEqual(result, {});
    assert.equal(fs.existsSync(path.join(versionDir, "preview.m4a")), true);
    assert.equal(
      fs.existsSync(path.join(versionDir, "hls", "index.m3u8")),
      true,
    );
    assert.equal(fs.existsSync(path.join(versionDir, "mix.wav")), false);
    assert.equal(
      fs.existsSync(path.join(versionDir, "watermarked.wav")),
      false,
    );
    assert.deepEqual(
      calls
        .map((call) => call.name)
        .filter((name) => name !== "getMusicProviderConfig"),
      ["embedWatermark", "encodeToAAC", "createHLSPlaylist"],
    );
  });

  test("writes full AAC output from a real mix during full render", async () => {
    const {
      watermark,
      baseTrack,
      baseTrackVersion,
      calls,
      getVersionDir,
      storageDir,
    } = createWatermarkStep();
    const versionDir = getVersionDir(storageDir, baseTrack, baseTrackVersion);
    fs.mkdirSync(versionDir, { recursive: true });
    fs.writeFileSync(path.join(versionDir, "mix.wav"), "mix");

    await watermark({
      track: baseTrack,
      trackVersion: baseTrackVersion,
      workflow: "full_render",
    });

    assert.equal(fs.existsSync(path.join(versionDir, "full.m4a")), true);
    assert.equal(fs.existsSync(path.join(versionDir, "preview.m4a")), false);
    assert.equal(
      calls.find((call) => call.name === "encodeToAAC").outputPath,
      path.join(versionDir, "full.m4a"),
    );
  });

  test("keeps encoded output when HLS creation fails", async () => {
    const { watermark, baseTrack, baseTrackVersion, getVersionDir, storageDir } =
      createWatermarkStep({
        createHLSPlaylist: async () => {
          throw new Error("hls failed");
        },
      });
    const versionDir = getVersionDir(storageDir, baseTrack, baseTrackVersion);
    fs.mkdirSync(versionDir, { recursive: true });
    fs.writeFileSync(path.join(versionDir, "mix.wav"), "mix");

    await watermark({
      track: baseTrack,
      trackVersion: baseTrackVersion,
      workflow: "preview_render",
    });

    assert.equal(fs.existsSync(path.join(versionDir, "preview.m4a")), true);
    assert.equal(fs.existsSync(path.join(versionDir, "mix.wav")), false);
    assert.equal(
      fs.existsSync(path.join(versionDir, "watermarked.wav")),
      false,
    );
  });

  test("writes a placeholder full output when mix is missing and no live provider is required", async () => {
    const {
      watermark,
      baseTrack,
      baseTrackVersion,
      calls,
      getVersionDir,
      storageDir,
    } = createWatermarkStep();

    const result = await watermark({
      track: baseTrack,
      trackVersion: baseTrackVersion,
      workflow: "full_render",
    });

    const versionDir = getVersionDir(storageDir, baseTrack, baseTrackVersion);
    assert.deepEqual(result, {});
    assert.equal(fs.existsSync(path.join(versionDir, "full.m4a")), true);
    assert.deepEqual(
      calls.find((call) => call.name === "writeWav").options,
      { durationSec: 12, frequencyHz: 280 },
    );
  });

  test("throws when mix is missing and live provider output is required", async () => {
    const { watermark, baseTrack, baseTrackVersion } = createWatermarkStep({
      getMusicProviderConfig: async () => ({ provider: "suno" }),
    });

    await assert.rejects(
      () =>
        watermark({
          track: baseTrack,
          trackVersion: baseTrackVersion,
          workflow: "preview_render",
        }),
      /E301_MISSING_INPUTS: Mix missing for watermark/,
    );
  });

  test("throws when mix is missing and live Replicate conversion is enabled", async () => {
    const { watermark, baseTrack, baseTrackVersion } = createWatermarkStep({
      providerConfig: { replicate: { live: true } },
    });

    await assert.rejects(
      () =>
        watermark({
          track: baseTrack,
          trackVersion: baseTrackVersion,
          workflow: "preview_render",
        }),
      /E301_MISSING_INPUTS: Mix missing for watermark/,
    );
  });
});

describe("ready step", () => {
  function createReadyStep(overrides = {}) {
    const calls = [];
    const baseTrack = {
      id: "track_1",
      style: "pop",
    };
    const baseTrackVersion = {
      id: "version_1",
      music_plan_json: JSON.stringify({ style: "pop" }),
      provenance_json: JSON.stringify({ quality: { reroll_count: 0 } }),
    };
    const steps = createReadySteps({
      clampNumber: (value, min, max, fallback) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return fallback;
        return Math.max(min, Math.min(max, numeric));
      },
      evaluateRenderQuality: async (args) => {
        calls.push({ name: "evaluateRenderQuality", args });
        return {
          passed: true,
          threshold: args.qualityThreshold,
          total_score: 91,
          summary: "Quality gate passed.",
        };
      },
      getRuntimeMusicRoutingConfig: async () => ({
        quality_threshold: 80,
        max_rerolls: 1,
        auto_reroll_enabled: true,
      }),
      mergeProvenanceJson: (_existing, patch) => JSON.stringify(patch),
      nowIso: () => "2026-06-28T00:00:00.000Z",
      parseJson,
      providerConfig: { suno: { live: true }, elevenlabs: { live: false } },
      tightenMusicPlanForReroll: (musicPlan, qualityReport) => {
        calls.push({ name: "tightenMusicPlanForReroll", musicPlan, qualityReport });
        return { ...musicPlan, reroll: true };
      },
      toJson: JSON.stringify,
      ...overrides,
    });
    return { ...steps, baseTrack, baseTrackVersion, calls };
  }

  test("skips quality gate when no live music provider is available", async () => {
    const { ready, baseTrack, baseTrackVersion, calls } = createReadyStep({
      providerConfig: { suno: { live: false }, elevenlabs: { live: false } },
    });

    const result = await ready({
      track: baseTrack,
      trackVersion: {
        ...baseTrackVersion,
        provenance_json: JSON.stringify({ quality: { reroll_count: 2 } }),
      },
      workflow: "preview_render",
    });

    assert.deepEqual(result.quality_gate, {
      passed: true,
      skipped: true,
      reason: "live_music_provider_unavailable",
      threshold: 80,
      total_score: 100,
    });
    const provenance = JSON.parse(result.provenance_json);
    assert.equal(provenance.quality.reroll_count, 2);
    assert.equal(provenance.timeline[0].event, "quality_gate_skipped");
    assert.equal(
      calls.some((call) => call.name === "evaluateRenderQuality"),
      false,
    );
  });

  test("returns provenance and quality report when quality passes", async () => {
    const { ready, baseTrack, baseTrackVersion, calls } = createReadyStep();

    const result = await ready({
      track: baseTrack,
      trackVersion: baseTrackVersion,
      workflow: "full_render",
    });

    assert.equal(result.quality_gate.passed, true);
    assert.equal(result.quality_gate.total_score, 91);
    assert.equal(
      calls.find((call) => call.name === "evaluateRenderQuality").args.workflowType,
      "full_render",
    );
    const provenance = JSON.parse(result.provenance_json);
    assert.equal(provenance.timeline[0].event, "quality_gate_passed");
    assert.equal(provenance.quality.reroll_count, 0);
  });

  test("requests reroll and tightens the music plan when quality fails below retry limit", async () => {
    const { ready, baseTrack, baseTrackVersion, calls } = createReadyStep({
      evaluateRenderQuality: async (args) => {
        calls.push({ name: "evaluateRenderQuality", args });
        return {
          passed: false,
          threshold: args.qualityThreshold,
          total_score: 61,
          summary: "Quality gate failed.",
        };
      },
    });

    const result = await ready({
      track: baseTrack,
      trackVersion: baseTrackVersion,
      workflow: "preview_render",
    });

    assert.equal(result.reroll_requested, true);
    assert.equal(result.reroll_count, 1);
    assert.equal(result.reroll_reason, "Quality gate failed.");
    assert.deepEqual(JSON.parse(result.music_plan_json), {
      style: "pop",
      reroll: true,
    });
    assert.equal(
      calls.some((call) => call.name === "tightenMusicPlanForReroll"),
      true,
    );
  });

  test("throws terminal quality error when reroll is disabled", async () => {
    const { ready, baseTrack, baseTrackVersion } = createReadyStep({
      evaluateRenderQuality: async () => ({
        passed: false,
        total_score: 50,
        summary: "mix balance low",
      }),
      getRuntimeMusicRoutingConfig: async () => ({
        quality_threshold: 80,
        max_rerolls: 3,
        auto_reroll_enabled: false,
      }),
    });

    await assert.rejects(
      () =>
        ready({
          track: baseTrack,
          trackVersion: baseTrackVersion,
          workflow: "preview_render",
        }),
      /E302_QUALITY_GATE_FAILED: mix balance low/,
    );
  });
});
