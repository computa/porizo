const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildRenderContract,
  resolveRenderContract,
  getProviderAudioUrl,
  extractProviderAudioUrl,
  sanitizeProviderRoutingForContract,
  sanitizeLyricsForAllMusicProviders,
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
      }
    );

    assert.equal(
      buildRenderContract({ provider: "suno", voiceMode: "user_voice" }).pipeline,
      "provider_audio_personalized_convert"
    );

    assert.equal(
      buildRenderContract({ provider: "elevenlabs", voiceMode: "user_voice" }).pipeline,
      "guide_tts_and_voice_convert"
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

    const built = resolveRenderContract({
      track: { voice_mode: "personalized" },
      musicPlan: { provider_resolved: "elevenlabs" },
    });
    assert.equal(built.provider_locked, "elevenlabs");
    assert.equal(built.voice_mode, "user_voice");
    assert.equal(built.pipeline, "guide_tts_and_voice_convert");
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
});
