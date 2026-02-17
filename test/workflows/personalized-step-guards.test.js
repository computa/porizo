const { describe, test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveRenderContract,
  assertPersonalizedContract,
  buildRenderContract,
} = require("../../src/workflows/render-contract");

const { _testing } = require("../../src/workflows/runner");
const { performVoiceConversion } = _testing;
const { clearCache } = require("../../src/services/feature-flags");

function createMockDb(flagOverrides = {}) {
  const flags = {
    voice_conversion_provider: "seedvc",
    seedvc_cfg_rate: 0.65,
    seedvc_diffusion_steps_preview: 60,
    seedvc_diffusion_steps_full: 90,
    seedvc_auto_f0_adjust: false,
    seedvc_f0_condition: true,
    seedvc_pitch_shift: 0,
    timbre_blend_ratio: 0.25,
    timbre_cfg_rate: 0.35,
    vocal_polish_enabled: false,
    ...flagOverrides,
  };

  return {
    prepare(sql) {
      return {
        get(...args) {
          if (sql.includes("feature_flags")) {
            const flagId = args[0];
            const value = flags[flagId];
            return value !== undefined ? { value: JSON.stringify(value) } : undefined;
          }
          if (sql.includes("voice_profiles")) {
            return null;
          }
          return undefined;
        },
      };
    },
  };
}

function createMockDurabilityService() {
  const calls = [];
  return {
    calls,
    executeWithDurability({ provider, fn }) {
      calls.push({ provider });
      return { output_url: "https://example.com/converted.wav" };
    },
  };
}

beforeEach(() => {
  clearCache();
});

describe("personalized render step guards", () => {
  test("personalized render with corrupt music_plan_json fails with E302_CONTRACT_MISSING", () => {
    assert.throws(
      () => resolveRenderContract({
        track: { voice_mode: "user_voice" },
        musicPlan: { provider_resolved: "suno", render_contract: "not-an-object" },
        strict: true,
      }),
      (err) => err.message.includes("E302_CONTRACT_MISSING")
    );
  });

  test("personalized render with null music_plan_json fails with E302_CONTRACT_MISSING", () => {
    assert.throws(
      () => resolveRenderContract({
        track: { voice_mode: "user_voice" },
        musicPlan: null,
        strict: true,
      }),
      (err) => err.message.includes("E302_CONTRACT_MISSING")
    );
  });

  test("personalized render with missing render_contract fails with E302_CONTRACT_MISSING", () => {
    assert.throws(
      () => resolveRenderContract({
        track: { voice_mode: "user_voice" },
        musicPlan: { provider_resolved: "suno" },
        strict: true,
      }),
      (err) => err.message.includes("E302_CONTRACT_MISSING")
    );
  });

  test("guard catches voice_mode mismatch in frozen contract", () => {
    const contract = resolveRenderContract({
      track: { voice_mode: "ai_voice" },
      musicPlan: {
        render_contract: {
          provider_locked: "suno",
          voice_mode: "ai_voice",
          pipeline: "provider_complete_audio",
        },
      },
    });
    assert.throws(
      () => assertPersonalizedContract(contract, "voice_convert"),
      (err) => err.message.includes("E302_PERSONALIZED_DIVERSION")
    );
  });
});

describe("performVoiceConversion contract provider preference", () => {
  test("uses contract voice_conversion_provider over DB flag", async () => {
    const db = createMockDb({ voice_conversion_provider: "seedvc" });
    const durabilityService = createMockDurabilityService();
    const contract = buildRenderContract({
      provider: "suno",
      voiceMode: "user_voice",
      voiceConversionProvider: "elevenlabs",
    });

    // performVoiceConversion will throw because we don't have real ElevenLabs config,
    // but the error message confirms it routed to ElevenLabs (not Seed-VC)
    await assert.rejects(
      () => performVoiceConversion({
        db,
        track: { id: 1, user_id: 1, voice_mode: "user_voice" },
        trackVersion: { id: 1 },
        kind: "preview",
        versionDir: "/tmp/test",
        conversionSourceUrl: "https://example.com/audio.mp3",
        providerConfig: { replicate: { live: true } },
        durabilityService,
        storageDir: "/tmp",
        storageProvider: null,
        renderContract: contract,
      }),
      (err) => err.message.includes("ELEVENLABS")
    );
  });

  test("falls back to DB flag when contract has null voice_conversion_provider", async () => {
    const db = createMockDb({ voice_conversion_provider: "seedvc" });
    const durabilityService = createMockDurabilityService();
    const contract = buildRenderContract({
      provider: "suno",
      voiceMode: "user_voice",
    });
    assert.equal(contract.voice_conversion_provider, null);

    // With null contract provider and DB flag = seedvc, should route to Seed-VC
    // Seed-VC path calls convertVoice which needs replicate config
    const result = await performVoiceConversion({
      db,
      track: { id: 1, user_id: 1, voice_mode: "user_voice" },
      trackVersion: { id: 1 },
      kind: "preview",
      versionDir: "/tmp/test",
      conversionSourceUrl: "https://example.com/audio.mp3",
      providerConfig: { replicate: { live: true } },
      durabilityService,
      storageDir: "/tmp",
      storageProvider: null,
      renderContract: contract,
    });
    // Seed-VC path goes through durabilityService with provider="seedvc"
    assert.equal(durabilityService.calls.length, 1);
    assert.equal(durabilityService.calls[0].provider, "seedvc");
  });
});
