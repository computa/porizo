const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  buildRenderContract,
  resolveRenderContract,
  sanitizeProviderRoutingForContract,
  shouldSkipStep,
} = require("../../src/workflows/render-contract");

describe("provider lock integrity", () => {
  test("buildRenderContract always locks provider — never returns null provider_locked", () => {
    const providers = ["suno", "elevenlabs", "unknown", "", null, undefined];
    const voiceModes = ["ai_voice", "user_voice", "personalized", "unknown", null];

    for (const provider of providers) {
      for (const voiceMode of voiceModes) {
        const contract = buildRenderContract({ provider, voiceMode });
        assert.ok(
          contract.provider_locked === "suno" || contract.provider_locked === "elevenlabs",
          `provider_locked must be suno or elevenlabs, got "${contract.provider_locked}" for provider="${provider}" voiceMode="${voiceMode}"`
        );
      }
    }
  });

  test("unknown provider defaults to suno (not elevenlabs)", () => {
    const contract = buildRenderContract({ provider: "unknown", voiceMode: "ai_voice" });
    assert.equal(contract.provider_locked, "suno");
  });

  test("null/undefined provider defaults to suno", () => {
    assert.equal(buildRenderContract({ provider: null, voiceMode: "ai_voice" }).provider_locked, "suno");
    assert.equal(buildRenderContract({ provider: undefined, voiceMode: "ai_voice" }).provider_locked, "suno");
  });

  test("resolveRenderContract preserves locked provider from existing contract", () => {
    const contract = resolveRenderContract({
      track: { voice_mode: "user_voice" },
      musicPlan: {
        provider_resolved: "elevenlabs",
        render_contract: {
          provider_locked: "suno",
          voice_mode: "user_voice",
          pipeline: "provider_audio_personalized_convert",
        },
      },
    });

    // Even though provider_resolved says elevenlabs, existing contract's lock takes precedence
    assert.equal(contract.provider_locked, "suno");
  });

  test("resolveRenderContract falls back to suno when contract has no provider_locked", () => {
    const contract = resolveRenderContract({
      track: { voice_mode: "ai_voice" },
      musicPlan: {
        render_contract: {
          voice_mode: "ai_voice",
          pipeline: "provider_complete_audio",
        },
      },
    });

    assert.equal(contract.provider_locked, "suno");
  });

  test("resolveRenderContract without existing contract builds from provider_resolved", () => {
    const contract = resolveRenderContract({
      track: { voice_mode: "ai_voice" },
      musicPlan: { provider_resolved: "elevenlabs" },
    });
    assert.equal(contract.provider_locked, "elevenlabs");

    const sunoContract = resolveRenderContract({
      track: { voice_mode: "ai_voice" },
      musicPlan: { provider_resolved: "suno" },
    });
    assert.equal(sunoContract.provider_locked, "suno");
  });

  test("sanitizeProviderRoutingForContract forces routing to locked provider", () => {
    const routing = { provider: "elevenlabs", reason: "cost_optimization", switched: false };
    const contract = { provider_locked: "suno" };

    const sanitized = sanitizeProviderRoutingForContract(routing, contract);
    assert.equal(sanitized.provider, "suno", "Provider must match locked value");
    assert.equal(sanitized.switched, true, "switched flag must be true when overridden");
    assert.equal(sanitized.reason, "cost_optimization_locked", "reason gets _locked suffix");
  });

  test("sanitizeProviderRoutingForContract preserves pinned_provider reason", () => {
    const routing = { provider: "suno", reason: "pinned_provider", switched: false };
    const contract = { provider_locked: "suno" };

    const sanitized = sanitizeProviderRoutingForContract(routing, contract);
    assert.equal(sanitized.reason, "pinned_provider");
    assert.equal(sanitized.switched, false);
  });

  test("sanitizeProviderRoutingForContract returns null for null routing", () => {
    assert.equal(sanitizeProviderRoutingForContract(null, { provider_locked: "suno" }), null);
    assert.equal(sanitizeProviderRoutingForContract(undefined, { provider_locked: "suno" }), null);
  });

  test("sanitizeProviderRoutingForContract passes through when no lock", () => {
    const routing = { provider: "elevenlabs", reason: "runtime", switched: false };
    const result = sanitizeProviderRoutingForContract(routing, {});
    assert.equal(result.provider, "elevenlabs", "No lock = no override");
  });
});

describe("cross-provider fallback removal regression guard", () => {
  test("runner.js does not contain cross-provider fallback functions", () => {
    const runnerSource = fs.readFileSync(
      path.join(__dirname, "..", "..", "src", "workflows", "runner.js"),
      "utf-8"
    );

    const forbiddenPatterns = [
      "shouldFallbackFromElevenLabsToSuno",
      "shouldFallbackFromSunoToElevenLabs",
      "fallbackToSunoAfterElevenLabsValidation",
      "fallbackToElevenLabsAfterSunoPolicyRejection",
    ];

    for (const pattern of forbiddenPatterns) {
      assert.ok(
        !runnerSource.includes(pattern),
        `runner.js must NOT contain "${pattern}" — cross-provider fallback was removed by design`
      );
    }
  });

  test("provider_complete_audio mix branch accepts wav fallback outputs", () => {
    const runnerSource = fs.readFileSync(
      path.join(__dirname, "..", "..", "src", "workflows", "runner.js"),
      "utf-8"
    );

    assert.ok(
      runnerSource.includes('path.join(versionDir, isFull ? "inst_full.wav" : "inst_preview.wav")'),
      "provider_complete_audio mix branch must accept local wav outputs"
    );
  });
});

describe("personalized pipeline skip map integrity", () => {
  test("provider_audio_personalized_convert skips guide_vocal but keeps voice_convert", () => {
    assert.equal(shouldSkipStep("guide_vocal", "provider_audio_personalized_convert"), true);
    assert.equal(shouldSkipStep("guide_vocal_full", "provider_audio_personalized_convert"), true);
    assert.equal(shouldSkipStep("voice_convert", "provider_audio_personalized_convert"), false);
    assert.equal(shouldSkipStep("voice_convert_sections", "provider_audio_personalized_convert"), false);
    assert.equal(shouldSkipStep("mix", "provider_audio_personalized_convert"), false);
  });

  test("provider_complete_audio skips ALL vocal processing (ai_voice needs none)", () => {
    assert.equal(shouldSkipStep("guide_vocal", "provider_complete_audio"), true);
    assert.equal(shouldSkipStep("voice_convert", "provider_complete_audio"), true);
    assert.equal(shouldSkipStep("voice_convert_sections", "provider_complete_audio"), true);
  });

  test("suno_voice_persona_complete_audio skips local vocal processing", () => {
    assert.equal(shouldSkipStep("guide_vocal", "suno_voice_persona_complete_audio"), true);
    assert.equal(shouldSkipStep("guide_vocal_full", "suno_voice_persona_complete_audio"), true);
    assert.equal(shouldSkipStep("voice_convert", "suno_voice_persona_complete_audio"), true);
    assert.equal(shouldSkipStep("voice_convert_sections", "suno_voice_persona_complete_audio"), true);
    assert.equal(shouldSkipStep("mix", "suno_voice_persona_complete_audio"), false);
  });

  test("guide_tts_and_voice_convert skips nothing (full TTS pipeline)", () => {
    const steps = ["guide_vocal", "guide_vocal_full", "voice_convert", "voice_convert_sections", "mix"];
    for (const step of steps) {
      assert.equal(
        shouldSkipStep(step, "guide_tts_and_voice_convert"),
        false,
        `guide_tts_and_voice_convert should NOT skip ${step}`
      );
    }
  });
});
