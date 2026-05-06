const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildRenderContract,
  resolveRenderContract,
  getProviderAudioUrl,
  extractProviderAudioUrl,
  isProviderCompleteAudioPipeline,
  sanitizeProviderRoutingForContract,
  sanitizeLyricsForAllMusicProviders,
  shouldSkipStep,
} = require("../../src/workflows/render-contract");

describe("render contract helpers", () => {
  test("buildRenderContract maps provider and voice mode to pipeline", () => {
    assert.deepEqual(
      buildRenderContract({ provider: "suno", voiceMode: "ai_voice" }),
      {
        provider_locked: "suno",
        voice_mode: "ai_voice",
        pipeline: "provider_complete_audio",
        fallback_allowed_until_step: "instrumental",
        voice_conversion_provider: null,
        user_voice_engine: null,
        voice_provider_profile_id: null,
      }
    );

    assert.throws(
      () => buildRenderContract({ provider: "suno", voiceMode: "user_voice" }),
      (err) => err.message.includes("E302_SUNO_PERSONA_REQUIRED")
    );

    const personaContract = buildRenderContract({
      provider: "suno",
      voiceMode: "user_voice",
      voiceConversionProvider: "seedvc",
      userVoiceEngine: "suno_voice_persona",
      voiceProviderProfileId: "vpp_123",
    });
    assert.equal(personaContract.pipeline, "suno_voice_persona_complete_audio");
    assert.equal(personaContract.user_voice_engine, "suno_voice_persona");
    assert.equal(personaContract.voice_provider_profile_id, "vpp_123");

    assert.throws(
      () =>
        buildRenderContract({
          provider: "elevenlabs",
          voiceMode: "user_voice",
        }),
      (err) => err.message.includes("E302_SUNO_PERSONA_REQUIRED")
    );
  });

  test("resolveRenderContract normalizes existing and fallback values", () => {
    const fromExisting = resolveRenderContract({
      track: { voice_mode: "personalized" },
      musicPlan: {
        provider_resolved: "suno",
        render_contract: {
          provider_locked: "suno",
          voice_mode: "personalized",
          pipeline: "provider_audio_personalized_convert",
        },
      },
    });
    assert.equal(fromExisting.voice_mode, "user_voice");
    assert.equal(fromExisting.provider_locked, "suno");
    assert.equal(fromExisting.pipeline, "provider_audio_personalized_convert");
    assert.equal(fromExisting.user_voice_engine, null);
    assert.equal(fromExisting.voice_provider_profile_id, null);

    assert.throws(
      () =>
        resolveRenderContract({
          track: { voice_mode: "personalized" },
          musicPlan: { provider_resolved: "elevenlabs" },
        }),
      (err) => err.message.includes("E302_SUNO_PERSONA_REQUIRED")
    );
  });

  test("getProviderAudioUrl reads provenance first then instrumental URL", () => {
    const fromProvenance = getProviderAudioUrl({
      provenance_json: JSON.stringify({
        music: { provider_audio_url: "https://cdn.example.com/from-prov.mp3" },
      }),
      instrumental_url: "https://cdn.example.com/from-inst.mp3",
    });
    assert.equal(fromProvenance, "https://cdn.example.com/from-prov.mp3");

    const fromInst = getProviderAudioUrl({
      provenance_json: "{invalid",
      instrumental_url: "https://cdn.example.com/from-inst.mp3",
    });
    assert.equal(fromInst, "https://cdn.example.com/from-inst.mp3");
  });

  test("extractProviderAudioUrl selects first valid URL candidate", () => {
    const url = extractProviderAudioUrl({
      provider_audio_url: "",
      audio_url: "https://cdn.example.com/a.mp3",
      guide_vocal_url: "https://cdn.example.com/b.mp3",
    });
    assert.equal(url, "https://cdn.example.com/a.mp3");
    assert.equal(extractProviderAudioUrl({ audio_url: "not-a-url" }), null);
  });

  test("sanitizeProviderRoutingForContract locks provider and reason", () => {
    const locked = sanitizeProviderRoutingForContract(
      { provider: "elevenlabs", reason: "runtime", switched: false },
      { provider_locked: "suno" }
    );
    assert.equal(locked.provider, "suno");
    assert.equal(locked.reason, "runtime_locked");
    assert.equal(locked.switched, true);

    const pinned = sanitizeProviderRoutingForContract(
      { provider: "suno", reason: "pinned_provider", switched: false },
      { provider_locked: "suno" }
    );
    assert.equal(pinned.reason, "pinned_provider");
  });

  test("sanitizeLyricsForAllMusicProviders chains providers and aggregates", () => {
    const inputLyrics = {
      title: "Demo",
      sections: [{ name: "verse", lines: ["line one"] }],
    };
    const calls = [];
    const result = sanitizeLyricsForAllMusicProviders(inputLyrics, {
      sanitizeLyricsForProviderPolicyFn: ({ lyrics, provider }) => {
        calls.push(provider);
        if (provider === "suno") {
          return {
            lyrics: { ...lyrics, title: "Demo Safe" },
            changed: true,
            change_count: 1,
            blocked: false,
            rewrite_passes: 1,
            violations: [{ term: "risk-one" }],
            suggestions: ["adjust wording"],
          };
        }
        return {
          lyrics,
          changed: false,
          change_count: 0,
          blocked: true,
          rewrite_passes: 0,
          violations: [{ term: "risk-two" }],
          suggestions: ["remove term"],
        };
      },
    });

    assert.deepEqual(calls, ["suno", "elevenlabs"]);
    assert.equal(result.changed, true);
    assert.equal(result.change_count, 1);
    assert.equal(result.blocked, true);
    assert.equal(result.reports.length, 2);
    assert.equal(result.lyrics.title, "Demo Safe");
    assert.ok(result.suggestions.includes("adjust wording"));
    assert.ok(result.suggestions.includes("remove term"));
  });

  test("shouldSkipStep maps pipeline to skipped steps", () => {
    // provider_complete_audio skips guide_vocal, guide_vocal_full, voice_convert, voice_convert_sections
    assert.equal(shouldSkipStep("guide_vocal", "provider_complete_audio"), true);
    assert.equal(shouldSkipStep("guide_vocal_full", "provider_complete_audio"), true);
    assert.equal(shouldSkipStep("voice_convert", "provider_complete_audio"), true);
    assert.equal(shouldSkipStep("voice_convert_sections", "provider_complete_audio"), true);
    assert.equal(shouldSkipStep("mix", "provider_complete_audio"), false);

    // Suno voice persona is provider-complete personalized audio and skips local conversion
    assert.equal(shouldSkipStep("guide_vocal", "suno_voice_persona_complete_audio"), true);
    assert.equal(shouldSkipStep("voice_convert", "suno_voice_persona_complete_audio"), true);
    assert.equal(shouldSkipStep("voice_convert_sections", "suno_voice_persona_complete_audio"), true);
    assert.equal(isProviderCompleteAudioPipeline("suno_voice_persona_complete_audio"), true);

    // provider_audio_personalized_convert skips guide_vocal only
    assert.equal(shouldSkipStep("guide_vocal", "provider_audio_personalized_convert"), true);
    assert.equal(shouldSkipStep("guide_vocal_full", "provider_audio_personalized_convert"), true);
    assert.equal(shouldSkipStep("voice_convert", "provider_audio_personalized_convert"), false);

    // guide_tts_and_voice_convert skips nothing
    assert.equal(shouldSkipStep("guide_vocal", "guide_tts_and_voice_convert"), false);
    assert.equal(shouldSkipStep("voice_convert", "guide_tts_and_voice_convert"), false);

    // Unknown pipeline skips nothing (safe default)
    assert.equal(shouldSkipStep("guide_vocal", "unknown_pipeline"), false);
  });

  test("sanitizeLyricsForAllMusicProviders catches real policy violations", () => {
    const violatingLyrics = {
      title: "Song for Taylor Swift",
      sections: [{
        name: "verse",
        lines: [
          "Singing like Drake on a Friday night",
          "She turned 14 years old today",
        ],
      }],
    };

    const result = sanitizeLyricsForAllMusicProviders(violatingLyrics);

    assert.equal(result.changed, true);
    assert.ok(result.change_count >= 2);
    assert.ok(!result.lyrics.title.toLowerCase().includes("taylor swift"));
    assert.ok(!result.lyrics.sections[0].lines[0].toLowerCase().includes("drake"));
    assert.ok(!result.lyrics.sections[0].lines[1].includes("14"));
  });
});
