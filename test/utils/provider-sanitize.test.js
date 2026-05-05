const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  sanitizeProviderError,
  MAX_LENGTH,
} = require("../../src/utils/provider-sanitize");

describe("provider-sanitize (U5)", () => {
  test("redacts Bearer tokens", () => {
    const result = sanitizeProviderError(
      "auth failed: Bearer abc.def.ghi-jkl_mno=pqr returned 401",
    );
    assert.match(result, /Bearer \[redacted\]/);
    assert.doesNotMatch(result, /abc\.def\.ghi/);
  });

  test("redacts URLs", () => {
    const result = sanitizeProviderError(
      "POST https://sunoapi.org/api/v1/generate returned 500",
    );
    assert.match(result, /\[redacted_url\]/);
    assert.doesNotMatch(result, /sunoapi\.org/);
  });

  test("redacts persona / task / audio IDs", () => {
    const result = sanitizeProviderError(
      "task task_abc123 produced audio audio_xyz789 for persona persona_qrs456",
    );
    assert.match(result, /task_\[redacted\]/);
    assert.match(result, /audio_\[redacted\]/);
    assert.match(result, /persona_\[redacted\]/);
  });

  test("U5: caps output at 1000 characters (regression guard for missing-cap asymmetry)", () => {
    const longInput = "x".repeat(2500);
    const result = sanitizeProviderError(longInput);
    assert.equal(result.length, MAX_LENGTH);
    assert.equal(MAX_LENGTH, 1000);
  });

  test("returns 'unknown_error' for null/undefined input", () => {
    assert.equal(sanitizeProviderError(null), "unknown_error");
    assert.equal(sanitizeProviderError(undefined), "unknown_error");
    assert.equal(sanitizeProviderError(""), "unknown_error");
  });

  test("accepts Error instance and extracts .message", () => {
    const err = new Error("Bearer xyz123 leaked at https://api.example/foo");
    const result = sanitizeProviderError(err);
    assert.match(result, /Bearer \[redacted\]/);
    assert.match(result, /\[redacted_url\]/);
  });

  test("U5: re-exports retired — both consumer modules now import from the canonical util", () => {
    // After review fix #9: suno-persona and voice-provider-profile-service no
    // longer re-export sanitize under their own names. Callers must import
    // from src/utils/provider-sanitize directly.
    const personaExports = require("../../src/providers/suno-persona");
    const serviceExports = require("../../src/services/voice-provider-profile-service");
    assert.equal(personaExports.sanitizeProviderMessage, undefined);
    assert.equal(serviceExports.sanitizeProviderError, undefined);
  });
});
