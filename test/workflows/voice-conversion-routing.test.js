const { describe, test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");

const { _testing } = require("../../src/workflows/runner");
const { performVoiceConversion, applyVocalPolish } = _testing;
const { clearCache } = require("../../src/services/feature-flags");

/**
 * Tests for the extracted performVoiceConversion helper.
 * Validates that both preview and full render correctly route
 * between Seed-VC and ElevenLabs based on the voice_conversion_provider flag.
 */

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
    vocal_polish_enabled: false, // Disable polish for routing tests
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
            if (flags.voice_conversion_provider === "elevenlabs") {
              return { elevenlabs_voice_id: "test_voice_id_123" };
            }
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
      // Don't actually call fn — just record the routing decision
      return Promise.resolve({ output_url: `mock://${provider}/output.wav` });
    },
  };
}

describe("performVoiceConversion routing", () => {
  let tempDir;

  beforeEach(() => {
    clearCache();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-vc-test-"));
  });

  test("routes to Seed-VC for preview when flag is seedvc", async () => {
    const db = createMockDb({ voice_conversion_provider: "seedvc" });
    const durabilityService = createMockDurabilityService();

    const result = await performVoiceConversion({
      db,
      track: { id: "t1", user_id: "u1" },
      trackVersion: { version_num: 1 },
      kind: "preview",
      versionDir: tempDir,
      conversionSourceUrl: "https://example.com/guide.wav",
      providerConfig: { replicate: { token: "test", timeoutMs: 5000 }, hfToken: "test" },
      durabilityService,
      storageDir: tempDir,
      storageProvider: null,
    });

    assert.equal(durabilityService.calls.length, 1);
    assert.equal(durabilityService.calls[0].provider, "seedvc");
    assert.ok(result.output_url.includes("seedvc"));
  });

  test("routes to Seed-VC for full render when flag is seedvc", async () => {
    const db = createMockDb({ voice_conversion_provider: "seedvc" });
    const durabilityService = createMockDurabilityService();

    const result = await performVoiceConversion({
      db,
      track: { id: "t1", user_id: "u1" },
      trackVersion: { version_num: 1 },
      kind: "full",
      versionDir: tempDir,
      conversionSourceUrl: "https://example.com/guide.wav",
      providerConfig: { replicate: { token: "test", timeoutMs: 5000 }, hfToken: "test" },
      durabilityService,
      storageDir: tempDir,
      storageProvider: null,
    });

    assert.equal(durabilityService.calls.length, 1);
    assert.equal(durabilityService.calls[0].provider, "seedvc");
    assert.ok(result.output_url.includes("seedvc"));
  });

  test("routes to ElevenLabs for preview when flag is elevenlabs", async () => {
    // Pre-create files so downloadAndExtractVocals skips download + Demucs
    fs.writeFileSync(path.join(tempDir, "source_for_conversion.mp3"), "fake");
    const stemsDir = path.join(tempDir, "stems");
    fs.mkdirSync(stemsDir, { recursive: true });
    fs.writeFileSync(path.join(stemsDir, "vocals.wav"), "fake");
    fs.writeFileSync(path.join(stemsDir, "vocals_compressed.mp3"), "fake");

    const db = createMockDb({ voice_conversion_provider: "elevenlabs" });
    const durabilityService = createMockDurabilityService();

    const result = await performVoiceConversion({
      db,
      track: { id: "t1", user_id: "u1" },
      trackVersion: { version_num: 1 },
      kind: "preview",
      versionDir: tempDir,
      conversionSourceUrl: "https://example.com/guide.wav",
      providerConfig: { elevenlabs: { apiKey: "test_key" }, replicate: { token: "test", timeoutMs: 5000 } },
      durabilityService,
      storageDir: tempDir,
      storageProvider: null,
    });

    assert.equal(durabilityService.calls.length, 1);
    assert.equal(durabilityService.calls[0].provider, "elevenlabs");
    assert.ok(result.output_url.includes("elevenlabs"));
  });

  test("routes to ElevenLabs for FULL render when flag is elevenlabs (bug fix)", async () => {
    // This is the critical test — before the fix, full render was hardcoded to Seed-VC
    fs.writeFileSync(path.join(tempDir, "source_for_conversion.mp3"), "fake");
    const stemsDir = path.join(tempDir, "stems");
    fs.mkdirSync(stemsDir, { recursive: true });
    fs.writeFileSync(path.join(stemsDir, "vocals.wav"), "fake");
    fs.writeFileSync(path.join(stemsDir, "vocals_compressed.mp3"), "fake");

    const db = createMockDb({ voice_conversion_provider: "elevenlabs" });
    const durabilityService = createMockDurabilityService();

    const result = await performVoiceConversion({
      db,
      track: { id: "t1", user_id: "u1" },
      trackVersion: { version_num: 1 },
      kind: "full",
      versionDir: tempDir,
      conversionSourceUrl: "https://example.com/guide.wav",
      providerConfig: { elevenlabs: { apiKey: "test_key" }, replicate: { token: "test", timeoutMs: 5000 } },
      durabilityService,
      storageDir: tempDir,
      storageProvider: null,
    });

    assert.equal(durabilityService.calls.length, 1);
    assert.equal(durabilityService.calls[0].provider, "elevenlabs",
      "Full render must route to ElevenLabs when flag is set");
    assert.ok(result.output_url.includes("elevenlabs"));
  });

  test("throws E305 when ElevenLabs selected but no API key", async () => {
    const db = createMockDb({ voice_conversion_provider: "elevenlabs" });
    const durabilityService = createMockDurabilityService();

    await assert.rejects(
      () => performVoiceConversion({
        db,
        track: { id: "t1", user_id: "u1" },
        trackVersion: { version_num: 1 },
        kind: "preview",
        versionDir: tempDir,
        conversionSourceUrl: "https://example.com/guide.wav",
        providerConfig: { replicate: { token: "test" } },
        durabilityService,
        storageDir: tempDir,
        storageProvider: null,
      }),
      { message: /E305_ELEVENLABS_VOICE_ERROR.*ELEVENLABS_API_KEY/ },
    );
  });

  test("throws E305 when ElevenLabs selected but no voice clone", async () => {
    // Override db to return null voice profile
    const db = createMockDb({ voice_conversion_provider: "elevenlabs" });
    db.prepare = (sql) => ({
      get(...args) {
        if (sql.includes("feature_flags")) {
          const flagId = args[0];
          if (flagId === "voice_conversion_provider") return { value: '"elevenlabs"' };
          return undefined;
        }
        if (sql.includes("voice_profiles")) {
          return null; // No voice clone
        }
        return undefined;
      },
    });
    const durabilityService = createMockDurabilityService();

    await assert.rejects(
      () => performVoiceConversion({
        db,
        track: { id: "t1", user_id: "u1" },
        trackVersion: { version_num: 1 },
        kind: "full",
        versionDir: tempDir,
        conversionSourceUrl: "https://example.com/guide.wav",
        providerConfig: { elevenlabs: { apiKey: "test_key" }, replicate: { token: "test" } },
        durabilityService,
        storageDir: tempDir,
        storageProvider: null,
      }),
      { message: /E305_ELEVENLABS_VOICE_ERROR.*Re-enroll/ },
    );
  });
});
