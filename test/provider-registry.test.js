const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const {
  getProvider,
  hasProviderCapability,
  listProviderNames,
  MUSIC_PROVIDER_ORDER,
} = require("../src/providers");
const {
  listAvailableProviders,
  resolveMusicProvider,
} = require("../src/providers/provider-style-routing");

describe("Provider registry", () => {
  test("lists only provider-complete song generators for music routing", () => {
    assert.deepEqual(MUSIC_PROVIDER_ORDER, ["suno"]);
    assert.deepEqual(listProviderNames({ capability: "musicGeneration" }), [
      "suno",
    ]);
    assert.equal(hasProviderCapability("elevenlabs", "musicGeneration"), false);
    assert.equal(hasProviderCapability("elevenlabs", "voiceConversion"), true);
    assert.equal(hasProviderCapability("whisper", "speechToText"), true);
  });

  test("normalizes provider lookup without exposing unknown providers", () => {
    assert.equal(getProvider(" SUNO ").name, "suno");
    assert.equal(getProvider("unknown"), null);
  });

  test("music routing excludes ElevenLabs even when live in runtime config", () => {
    const providerConfig = {
      suno: { live: true },
      elevenlabs: { live: true },
    };

    assert.deepEqual(listAvailableProviders(providerConfig), ["suno"]);

    const resolved = resolveMusicProvider({
      requestedStyle: "pop",
      defaultProvider: "elevenlabs",
      providerConfig,
      autoStyleRouting: true,
    });

    assert.equal(resolved.provider, "suno");
    assert.deepEqual(resolved.available_providers, ["suno"]);
    assert.equal(resolved.reason, "default_unavailable_fallback");
  });
});
