const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const {
  assertPersonalizedContract,
  buildRenderContract,
  resolveRenderContract,
} = require("../../src/workflows/render-contract");

describe("assertPersonalizedContract", () => {
  test("throws E302 on voice_mode mismatch", () => {
    const contract = {
      voice_mode: "ai_voice",
      pipeline: "provider_audio_personalized_convert",
      provider_locked: "suno",
    };
    assert.throws(
      () => assertPersonalizedContract(contract, "voice_convert"),
      (err) =>
        err.message.includes("E302_PERSONALIZED_DIVERSION") &&
        err.message.includes("voice_convert") &&
        err.message.includes("ai_voice")
    );
  });

  test("throws E302 on invalid pipeline", () => {
    const contract = {
      voice_mode: "user_voice",
      pipeline: "provider_complete_audio",
      provider_locked: "suno",
    };
    assert.throws(
      () => assertPersonalizedContract(contract, "mix"),
      (err) =>
        err.message.includes("E302_PERSONALIZED_DIVERSION") &&
        err.message.includes("provider_complete_audio")
    );
  });

  test("throws E302 on missing provider_locked", () => {
    const contract = {
      voice_mode: "user_voice",
      pipeline: "guide_tts_and_voice_convert",
      provider_locked: null,
    };
    assert.throws(
      () => assertPersonalizedContract(contract, "instrumental"),
      (err) =>
        err.message.includes("E302_PERSONALIZED_DIVERSION") &&
        err.message.includes("no provider_locked")
    );
  });

  test("passes for valid suno personalized contract", () => {
    const contract = {
      voice_mode: "user_voice",
      pipeline: "provider_audio_personalized_convert",
      provider_locked: "suno",
    };
    assert.doesNotThrow(() => assertPersonalizedContract(contract, "instrumental"));
  });

  test("passes for valid elevenlabs personalized contract", () => {
    const contract = {
      voice_mode: "user_voice",
      pipeline: "guide_tts_and_voice_convert",
      provider_locked: "elevenlabs",
    };
    assert.doesNotThrow(() => assertPersonalizedContract(contract, "guide_vocal"));
  });
});

describe("resolveRenderContract strict mode", () => {
  test("strict: true throws on missing contract", () => {
    assert.throws(
      () => resolveRenderContract({
        track: { voice_mode: "user_voice" },
        musicPlan: { provider_resolved: "suno" },
        strict: true,
      }),
      (err) => err.message.includes("E302_CONTRACT_MISSING")
    );
  });

  test("strict: true throws on non-object contract (string)", () => {
    assert.throws(
      () => resolveRenderContract({
        track: { voice_mode: "user_voice" },
        musicPlan: { provider_resolved: "suno", render_contract: "corrupt" },
        strict: true,
      }),
      (err) => err.message.includes("E302_CONTRACT_MISSING")
    );
  });

  test("strict: false still falls back (backward compat)", () => {
    const result = resolveRenderContract({
      track: { voice_mode: "user_voice" },
      musicPlan: { provider_resolved: "suno" },
      strict: false,
    });
    assert.equal(result.voice_mode, "user_voice");
    assert.equal(result.pipeline, "provider_audio_personalized_convert");
  });

  test("forwards voice_conversion_provider from existing contract", () => {
    const result = resolveRenderContract({
      track: { voice_mode: "user_voice" },
      musicPlan: {
        render_contract: {
          provider_locked: "suno",
          voice_mode: "user_voice",
          pipeline: "provider_audio_personalized_convert",
          voice_conversion_provider: "elevenlabs",
        },
      },
    });
    assert.equal(result.voice_conversion_provider, "elevenlabs");
  });

  test("returns voice_conversion_provider: null when field absent in stored contract", () => {
    const result = resolveRenderContract({
      track: { voice_mode: "user_voice" },
      musicPlan: {
        render_contract: {
          provider_locked: "suno",
          voice_mode: "user_voice",
          pipeline: "provider_audio_personalized_convert",
        },
      },
    });
    assert.equal(result.voice_conversion_provider, null);
  });
});

describe("buildRenderContract voiceConversionProvider", () => {
  test("freezes voiceConversionProvider when provided", () => {
    const result = buildRenderContract({
      provider: "suno",
      voiceMode: "user_voice",
      voiceConversionProvider: "elevenlabs",
    });
    assert.equal(result.voice_conversion_provider, "elevenlabs");
    assert.equal(result.pipeline, "provider_audio_personalized_convert");
  });

  test("sets voiceConversionProvider to null when omitted", () => {
    const result = buildRenderContract({
      provider: "suno",
      voiceMode: "user_voice",
    });
    assert.equal(result.voice_conversion_provider, null);
  });
});
