const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const { sanitizeProviderError } = require("../../src/utils/provider-sanitize");

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
    assert.equal(result.length, 1000);
  });

  test("redacts generic provider IDs, API keys, JWTs, and long hex IDs", () => {
    const result = sanitizeProviderError(
      "sk-live_secret1234567890 persona abcdefabcdefabcdefabcdefabcdefab eyJabc.def.ghi task_abcdefghijklmnopqrst",
    );
    assert.doesNotMatch(result, /sk-live_secret/);
    assert.doesNotMatch(result, /abcdefabcdef/);
    assert.doesNotMatch(result, /eyJabc/);
    assert.doesNotMatch(result, /task_abcdefghijklmnopqrst/);
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

  test("M6: redacts dashed UUIDs (8-4-4-4-12) embedded in error text", () => {
    const result = sanitizeProviderError(
      "fetch failed for asset 4f8a2b1e-9c3d-4e5f-9012-abcdef123456 (status=502)",
    );
    assert.match(result, /\[redacted_uuid\]/);
    assert.doesNotMatch(result, /4f8a2b1e-9c3d-4e5f-9012-abcdef123456/);
  });

  test("S14: redacts multiple Bearer tokens in one message", () => {
    const result = sanitizeProviderError(
      "old=Bearer aaaaaaaaaaaaaaaa new=Bearer bbbbbbbbbbbbbbbb",
    );
    const matches = result.match(/Bearer \[redacted\]/g) || [];
    assert.equal(matches.length, 2);
    assert.doesNotMatch(result, /aaaaaaaa/);
    assert.doesNotMatch(result, /bbbbbbbb/);
  });

  test("S14: redacts URL containing a prefixed task id (compound match)", () => {
    const result = sanitizeProviderError(
      "GET https://api.suno.ai/v1/tasks/task_abcdefghijklmnopqrst/audio returned 404",
    );
    // The whole URL is replaced first; the inner task_ never escapes.
    assert.match(result, /\[redacted_url\]/);
    assert.doesNotMatch(result, /task_abcdefghijklmnopqrst/);
    assert.doesNotMatch(result, /api\.suno\.ai/);
  });

  test("S14: boundary at exactly MAX_LENGTH does not truncate, MAX_LENGTH+1 does", () => {
    const exact = sanitizeProviderError("y".repeat(1000));
    assert.equal(exact.length, 1000);
    const over = sanitizeProviderError("y".repeat(1001));
    assert.equal(over.length, 1000);
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
