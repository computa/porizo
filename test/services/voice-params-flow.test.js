const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const { getAdaptiveConversionParams } = require("../../src/services/audio-preprocessing");

describe("getAdaptiveConversionParams", () => {
  test("Grade A returns 80 diffusion steps", () => {
    const params = getAdaptiveConversionParams("A");
    assert.equal(params.diffusionSteps, 80);
    assert.equal(params.cfgRate, 0.7);
  });

  test("Grade B returns 60 diffusion steps", () => {
    const params = getAdaptiveConversionParams("B");
    assert.equal(params.diffusionSteps, 60);
    assert.equal(params.cfgRate, 0.65);
  });

  test("Grade C returns 50 diffusion steps", () => {
    const params = getAdaptiveConversionParams("C");
    assert.equal(params.diffusionSteps, 50);
    assert.equal(params.cfgRate, 0.55);
  });

  test("Grade F returns null (AI voice fallback)", () => {
    const params = getAdaptiveConversionParams("F");
    assert.equal(params, null);
  });

  test("unknown grade returns default (90 steps)", () => {
    const params = getAdaptiveConversionParams("X");
    assert.equal(params.diffusionSteps, 90);
    assert.equal(params.cfgRate, 0.7);
  });

  test("undefined grade returns default", () => {
    const params = getAdaptiveConversionParams(undefined);
    assert.equal(params.diffusionSteps, 90);
  });
});

describe("voice layer param capping simulation", () => {
  // These tests simulate the capping logic from voice.js:631-632 to verify
  // that feature flag values flow through correctly within the cap bounds.
  //
  // The actual voice.js code:
  //   const cfgRate = Math.min(0.85, Math.max(0.5, baseCfgRate));
  //   const diffusionStepsMax = kind === "preview" ? 80 : 100;
  //   const diffusionSteps = Math.min(diffusionStepsMax, Math.max(30, Math.round(baseSteps)));

  function simulateVoiceLayerCapping({ flagParams, adaptiveParams, kind }) {
    const baseCfgRate = Number.isFinite(flagParams.cfgRate)
      ? flagParams.cfgRate
      : (adaptiveParams.cfgRate ?? 0.65);
    const baseSteps = Number.isFinite(flagParams.diffusionSteps)
      ? flagParams.diffusionSteps
      : (adaptiveParams.diffusionSteps ?? (kind === "preview" ? 60 : 90));

    const cfgRate = Math.min(0.85, Math.max(0.5, baseCfgRate));
    const diffusionStepsMax = kind === "preview" ? 80 : 100;
    const diffusionSteps = Math.min(diffusionStepsMax, Math.max(30, Math.round(baseSteps)));

    return { cfgRate, diffusionSteps };
  }

  test("feature flag values within range pass through uncapped", () => {
    const result = simulateVoiceLayerCapping({
      flagParams: { diffusionSteps: 75, cfgRate: 0.7 },
      adaptiveParams: { diffusionSteps: 80, cfgRate: 0.7 },
      kind: "full",
    });

    assert.equal(result.diffusionSteps, 75, "75 is within [30, 100] — should pass through");
    assert.equal(result.cfgRate, 0.7, "0.7 is within [0.5, 0.85] — should pass through");
  });

  test("feature flag 95 steps passes through for full render (cap is 100)", () => {
    const result = simulateVoiceLayerCapping({
      flagParams: { diffusionSteps: 95, cfgRate: 0.8 },
      adaptiveParams: { diffusionSteps: 80, cfgRate: 0.7 },
      kind: "full",
    });

    assert.equal(result.diffusionSteps, 95, "95 should not be capped for full render");
    assert.equal(result.cfgRate, 0.8, "0.8 should not be capped");
  });

  test("feature flag 95 steps is capped to 80 for preview", () => {
    const result = simulateVoiceLayerCapping({
      flagParams: { diffusionSteps: 95, cfgRate: 0.8 },
      adaptiveParams: { diffusionSteps: 80, cfgRate: 0.7 },
      kind: "preview",
    });

    assert.equal(result.diffusionSteps, 80, "95 capped to 80 for preview");
    assert.equal(result.cfgRate, 0.8, "cfg unaffected by kind");
  });

  test("feature flag overrides adaptive params", () => {
    const result = simulateVoiceLayerCapping({
      flagParams: { diffusionSteps: 60, cfgRate: 0.6 },
      adaptiveParams: { diffusionSteps: 80, cfgRate: 0.7 },
      kind: "full",
    });

    assert.equal(result.diffusionSteps, 60, "Flag value 60 overrides adaptive 80");
    assert.equal(result.cfgRate, 0.6, "Flag value 0.6 overrides adaptive 0.7");
  });

  test("adaptive params used when no feature flag", () => {
    const result = simulateVoiceLayerCapping({
      flagParams: {},
      adaptiveParams: { diffusionSteps: 80, cfgRate: 0.7 },
      kind: "full",
    });

    assert.equal(result.diffusionSteps, 80, "Adaptive steps used when flag absent");
    assert.equal(result.cfgRate, 0.7, "Adaptive cfg used when flag absent");
  });

  test("defaults used when both flag and adaptive are missing", () => {
    const previewResult = simulateVoiceLayerCapping({
      flagParams: {},
      adaptiveParams: {},
      kind: "preview",
    });
    assert.equal(previewResult.diffusionSteps, 60, "Preview default is 60");
    assert.equal(previewResult.cfgRate, 0.65, "Default cfg is 0.65");

    const fullResult = simulateVoiceLayerCapping({
      flagParams: {},
      adaptiveParams: {},
      kind: "full",
    });
    assert.equal(fullResult.diffusionSteps, 90, "Full default is 90");
  });

  test("extreme values are clamped safely", () => {
    const result = simulateVoiceLayerCapping({
      flagParams: { diffusionSteps: 999, cfgRate: 1.5 },
      adaptiveParams: {},
      kind: "full",
    });

    assert.equal(result.diffusionSteps, 100, "999 steps clamped to 100 (full max)");
    assert.equal(result.cfgRate, 0.85, "1.5 cfg clamped to 0.85");
  });

  test("very low values are floored", () => {
    const result = simulateVoiceLayerCapping({
      flagParams: { diffusionSteps: 5, cfgRate: 0.1 },
      adaptiveParams: {},
      kind: "full",
    });

    assert.equal(result.diffusionSteps, 30, "5 steps floored to 30");
    assert.equal(result.cfgRate, 0.5, "0.1 cfg floored to 0.5");
  });

  test("NaN/Infinity in flags falls back to adaptive", () => {
    const result = simulateVoiceLayerCapping({
      flagParams: { diffusionSteps: NaN, cfgRate: Infinity },
      adaptiveParams: { diffusionSteps: 80, cfgRate: 0.7 },
      kind: "full",
    });

    assert.equal(result.diffusionSteps, 80, "NaN falls back to adaptive");
    assert.equal(result.cfgRate, 0.7, "Infinity falls back to adaptive");
  });
});
