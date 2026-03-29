const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyError,
  isProviderStep,
  isLocalStep,
  PROVIDER_STEPS,
} = require("../src/utils/step-classification");

describe("step-classification", () => {
  // ── Step classification ──

  describe("isProviderStep", () => {
    it("recognizes provider steps", () => {
      for (const step of ["instrumental", "instrumental_full", "guide_vocal", "guide_vocal_full", "voice_convert", "voice_convert_sections"]) {
        assert.equal(isProviderStep(step), true, `${step} should be a provider step`);
      }
    });

    it("rejects local steps", () => {
      for (const step of ["mix", "watermark", "lyrics", "music_plan", "moderation"]) {
        assert.equal(isProviderStep(step), false, `${step} should not be a provider step`);
      }
    });

    it("rejects null/undefined", () => {
      assert.equal(isProviderStep(null), false);
      assert.equal(isProviderStep(undefined), false);
    });
  });

  describe("isLocalStep", () => {
    it("recognizes local processing steps", () => {
      for (const step of ["mix", "watermark", "lyrics", "music_plan", "moderation"]) {
        assert.equal(isLocalStep(step), true, `${step} should be a local step`);
      }
    });

    it("rejects provider steps", () => {
      for (const step of PROVIDER_STEPS) {
        assert.equal(isLocalStep(step), false, `${step} should not be a local step`);
      }
    });

    it("rejects queued/ready/null", () => {
      assert.equal(isLocalStep("queued"), false);
      assert.equal(isLocalStep("ready"), false);
      assert.equal(isLocalStep(null), false);
      assert.equal(isLocalStep(undefined), false);
      assert.equal(isLocalStep(""), false);
    });
  });

  // ── Error classification ──

  describe("classifyError", () => {
    // Policy errors
    it("classifies policy content errors", () => {
      const r = classifyError("", "E302_PROVIDER_POLICY_ERROR", "instrumental");
      assert.equal(r.category, "policy_content");
      assert.equal(r.retryable, false);
      assert.equal(r.canAutoRewrite, true);
    });

    it("classifies Suno policy errors", () => {
      const r = classifyError("", "E302_SUNO_POLICY_ERROR", "instrumental");
      assert.equal(r.category, "policy_content");
    });

    it("classifies ElevenLabs validation", () => {
      const r = classifyError("", "E301_ELEVENLABS_VALIDATION", "guide_vocal");
      assert.equal(r.category, "policy_validation");
      assert.equal(r.canAutoRewrite, true);
    });

    // Quality gate
    it("classifies quality gate failures", () => {
      const r = classifyError("", "E302_QUALITY_GATE_FAILED", "mix");
      assert.equal(r.category, "quality_gate");
      assert.equal(r.retryable, true);
    });

    // Provider transient
    it("classifies rate limits", () => {
      const r = classifyError("", "PROVIDER_ERROR_429", "instrumental");
      assert.equal(r.category, "provider_transient");
      assert.equal(r.retryable, true);
    });

    // Provider retryable (incomplete output)
    it("classifies incomplete Suno output", () => {
      const r = classifyError("", "E302_SUNO_INCOMPLETE_OUTPUT", "instrumental");
      assert.equal(r.category, "provider_retryable");
      assert.equal(r.retryable, true);
    });

    // Missing inputs (deterministic)
    it("classifies missing inputs as non-retryable", () => {
      const r = classifyError("E301_MISSING_INPUTS: Provider-complete audio missing", "E301_MISSING_INPUTS", "mix");
      assert.equal(r.category, "input_missing");
      assert.equal(r.retryable, false);
    });

    it("classifies missing stems as non-retryable", () => {
      const r = classifyError("E301_MISSING_STEMS: Demucs required", "E301_MISSING_STEMS", "mix");
      assert.equal(r.category, "input_missing");
      assert.equal(r.retryable, false);
    });

    it("classifies missing guide vocal as non-retryable", () => {
      const r = classifyError("E301_GUIDE_VOCAL_MISSING: guide vocal needed", "E301_GUIDE_VOCAL_MISSING", "voice_convert");
      assert.equal(r.category, "input_missing");
      assert.equal(r.retryable, false);
    });

    // FFmpeg errors — distinct codes
    it("classifies FFmpeg timeout as processing_retryable", () => {
      const r = classifyError("E301_FFMPEG_TIMEOUT: timed out after 30s", "E301_FFMPEG_TIMEOUT", "mix");
      assert.equal(r.category, "processing_retryable");
      assert.equal(r.retryable, true);
    });

    it("classifies FFmpeg spawn as processing_retryable", () => {
      const r = classifyError("E301_FFMPEG_SPAWN: spawn ENOENT", "E301_FFMPEG_SPAWN", "watermark");
      assert.equal(r.category, "processing_retryable");
      assert.equal(r.retryable, true);
    });

    it("classifies FFmpeg error as processing_terminal (not retryable)", () => {
      const r = classifyError("E301_FFMPEG_ERROR: Invalid codec", "E301_FFMPEG_ERROR", "mix");
      assert.equal(r.category, "processing_terminal");
      assert.equal(r.retryable, false);
    });

    // Lyrics errors — AI_UNAVAILABLE is transient
    it("classifies lyrics AI_UNAVAILABLE as processing_retryable", () => {
      const r = classifyError("E201_LYRICS_ERROR: AI_UNAVAILABLE", "E201_LYRICS_ERROR", "lyrics");
      assert.equal(r.category, "processing_retryable");
      assert.equal(r.retryable, true);
    });

    it("classifies other lyrics errors as processing_terminal", () => {
      const r = classifyError("E201_LYRICS_ERROR: quality too low", "E201_LYRICS_ERROR", "lyrics");
      assert.equal(r.category, "processing_terminal");
      assert.equal(r.retryable, false);
    });

    // Workflow errors
    it("classifies workflow errors as processing_terminal", () => {
      const r = classifyError("E302_WORKFLOW_ERROR: step precondition", "E302_WORKFLOW_ERROR", "instrumental");
      assert.equal(r.category, "processing_terminal");
      assert.equal(r.retryable, false);
    });

    // Entitlement limits
    it("classifies insufficient credits", () => {
      const r = classifyError("", "INSUFFICIENT_CREDITS", null);
      assert.equal(r.category, "entitlement_limit");
      assert.equal(r.retryable, false);
    });

    // Step-aware fallbacks
    it("falls back to provider_terminal for unrecognized error on provider step", () => {
      const r = classifyError("Something unexpected", "UNKNOWN_CODE", "instrumental");
      assert.equal(r.category, "provider_terminal");
      assert.equal(r.retryable, false);
    });

    it("falls back to processing_terminal for unrecognized error on local step", () => {
      const r = classifyError("Something unexpected", "UNKNOWN_CODE", "mix");
      assert.equal(r.category, "processing_terminal");
      assert.equal(r.retryable, false);
    });

    it("falls back to unknown_terminal when step is null", () => {
      const r = classifyError("Something unexpected", "UNKNOWN_CODE", null);
      assert.equal(r.category, "unknown_terminal");
      assert.equal(r.retryable, false);
    });

    // E301_GUIDE_VOCAL_MISSING on provider step → still input_missing (not provider_terminal)
    it("classifies guide vocal missing on provider step as input_missing", () => {
      const r = classifyError("", "E301_GUIDE_VOCAL_MISSING", "voice_convert");
      assert.equal(r.category, "input_missing");
    });

    // E302_WORKFLOW_ERROR on provider step → still processing_terminal (not provider_terminal)
    it("classifies workflow error on provider step as processing_terminal", () => {
      const r = classifyError("", "E302_WORKFLOW_ERROR", "instrumental");
      assert.equal(r.category, "processing_terminal");
    });
  });

  // ── Round-trip test: getErrorInfo → classifyError ──

  describe("round-trip through getErrorInfo normalization", () => {
    // Simulate what getErrorInfo does, then feed to classifyError
    function simulateGetErrorInfo(rawMessage) {
      if (rawMessage.startsWith("E301_FFMPEG_TIMEOUT:")) return { code: "E301_FFMPEG_TIMEOUT", message: "Audio processing timed out." };
      if (rawMessage.startsWith("E301_FFMPEG_SPAWN:")) return { code: "E301_FFMPEG_SPAWN", message: "Audio processor failed to start." };
      if (rawMessage.startsWith("E301_FFMPEG_ERROR:")) return { code: "E301_FFMPEG_ERROR", message: "Audio processing failed." };
      if (rawMessage.startsWith("E301_MISSING_INPUTS:")) return { code: "E301_MISSING_INPUTS", message: rawMessage.replace("E301_MISSING_INPUTS:", "").trim() };
      if (rawMessage.startsWith("E301_MISSING_STEMS:")) return { code: "E301_MISSING_STEMS", message: rawMessage.replace("E301_MISSING_STEMS:", "").trim() };
      return { code: rawMessage.split(":")[0], message: rawMessage };
    }

    const roundTripCases = [
      { raw: "E301_FFMPEG_TIMEOUT: timed out after 30s", step: "mix", expectedCategory: "processing_retryable" },
      { raw: "E301_FFMPEG_SPAWN: spawn ENOENT", step: "watermark", expectedCategory: "processing_retryable" },
      { raw: "E301_FFMPEG_ERROR: Invalid data found", step: "mix", expectedCategory: "processing_terminal" },
      { raw: "E301_MISSING_INPUTS: Provider-complete audio missing", step: "mix", expectedCategory: "input_missing" },
      { raw: "E301_MISSING_STEMS: Demucs required", step: "mix", expectedCategory: "input_missing" },
    ];

    for (const { raw, step, expectedCategory } of roundTripCases) {
      it(`round-trips ${raw.split(":")[0]} through normalization`, () => {
        const normalized = simulateGetErrorInfo(raw);
        const result = classifyError(normalized.message, normalized.code, step);
        assert.equal(result.category, expectedCategory, `Expected ${expectedCategory} for normalized ${normalized.code}`);
      });
    }
  });
});
