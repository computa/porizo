const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const {
  getProviderStyleCapability,
  getSupportScore,
} = require("../src/providers/style-registry");
const { resolveMusicProvider } = require("../src/providers/provider-style-routing");

describe("Style capability registry", () => {
  test("returns provider-specific Ogene capability", () => {
    const suno = getProviderStyleCapability({ style: "ogene", provider: "suno" });
    const elevenlabs = getProviderStyleCapability({ style: "ogene", provider: "elevenlabs" });

    assert.equal(suno.support, "weak");
    assert.equal(elevenlabs.support, "medium");
    assert.ok(Array.isArray(suno.negative_constraints));
    assert.ok(suno.negative_constraints.length > 0);
  });

  test("returns unknown support for unlisted style", () => {
    const cap = getProviderStyleCapability({ style: "neo_soul_ballad", provider: "suno" });
    assert.equal(cap.support, "unknown");
    assert.equal(cap.support_score, getSupportScore("unknown"));
  });
});

describe("Provider style routing", () => {
  const providerConfig = {
    elevenlabs: { live: true },
    suno: { live: true },
  };

  test("keeps default provider when support is acceptable", () => {
    const resolved = resolveMusicProvider({
      requestedStyle: "highlife",
      defaultProvider: "elevenlabs",
      providerConfig,
      autoStyleRouting: true,
    });

    assert.equal(resolved.provider, "elevenlabs");
    assert.equal(resolved.switched, false);
    assert.equal(resolved.reason, "default_provider");
  });

  test("auto-switches when default provider style support is weak", () => {
    const resolved = resolveMusicProvider({
      requestedStyle: "ogene",
      defaultProvider: "suno",
      providerConfig,
      autoStyleRouting: true,
    });

    assert.equal(resolved.provider, "elevenlabs");
    assert.equal(resolved.switched, true);
    assert.equal(resolved.reason, "auto_switch_style_support");
    assert.equal(resolved.support, "medium");
  });

  test("respects admin style override support scores when routing", () => {
    const resolved = resolveMusicProvider({
      requestedStyle: "ogene",
      defaultProvider: "suno",
      providerConfig,
      autoStyleRouting: true,
      styleOverrides: {
        ogene: {
          suno: {
            support: "strong",
          },
        },
      },
    });

    assert.equal(resolved.provider, "suno");
    assert.equal(resolved.reason, "default_provider");
    assert.equal(resolved.support, "strong");
  });

  test("falls back when configured default is unavailable", () => {
    const resolved = resolveMusicProvider({
      requestedStyle: "pop",
      defaultProvider: "suno",
      providerConfig: {
        elevenlabs: { live: true },
        suno: { live: false },
      },
      autoStyleRouting: true,
    });

    assert.equal(resolved.provider, "elevenlabs");
    assert.equal(resolved.reason, "default_unavailable_fallback");
  });

  test("returns no provider when none are live", () => {
    const resolved = resolveMusicProvider({
      requestedStyle: "pop",
      defaultProvider: "elevenlabs",
      providerConfig: {
        elevenlabs: { live: false },
        suno: { live: false },
      },
      autoStyleRouting: true,
    });

    assert.equal(resolved.provider, null);
    assert.equal(resolved.reason, "no_live_music_providers");
  });
});
