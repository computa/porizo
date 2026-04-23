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
    assert.ok(typeof suno.prompt_compact === "string" && suno.prompt_compact.length > 0);
    assert.ok(typeof suno.hint === "string" && suno.hint.length > 0);
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
    suno: { live: true },
  };

  test("falls back to Suno when legacy default provider is requested", () => {
    const resolved = resolveMusicProvider({
      requestedStyle: "pop",
      defaultProvider: "elevenlabs",
      providerConfig,
      autoStyleRouting: true,
    });

    assert.equal(resolved.provider, "suno");
    assert.equal(resolved.switched, false);
    assert.equal(resolved.reason, "default_unavailable_fallback");
  });

  test("marks weak Suno-only routing as degraded instead of pretending a switch exists", () => {
    const resolved = resolveMusicProvider({
      requestedStyle: "ogene",
      defaultProvider: "suno",
      providerConfig,
      autoStyleRouting: true,
    });

    assert.equal(resolved.provider, "suno");
    assert.equal(resolved.switched, false);
    assert.equal(resolved.reason, "degraded_style_support");
    assert.equal(resolved.support, "weak");
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
        suno: { live: false },
      },
      autoStyleRouting: true,
    });

    assert.equal(resolved.provider, null);
    assert.equal(resolved.reason, "no_live_music_providers");
  });

  test("returns no provider when none are live", () => {
    const resolved = resolveMusicProvider({
      requestedStyle: "pop",
      defaultProvider: "elevenlabs",
      providerConfig: {
        suno: { live: false },
      },
      autoStyleRouting: true,
    });

    assert.equal(resolved.provider, null);
    assert.equal(resolved.reason, "no_live_music_providers");
  });
});
