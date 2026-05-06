/**
 * Tests for `resolveSunoPersonaForRenderImpl` (H22).
 *
 * The closure version inside `startJobRunner` delegates to this pure-resolution
 * helper. Each guard branch (no profile id, profile mismatch/inactive/deleted,
 * missing provider_profile_id, missing consent) needs to throw the documented
 * E302 error code. The verification report flagged these branches as
 * unreachable from existing tests because the closure was not exported.
 */

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  _testing: { resolveSunoPersonaForRenderImpl },
} = require("../../src/workflows/runner");

const SUNO_PIPELINE = "suno_voice_persona_complete_audio";
const VALID_CONSENT = "voice_suno_persona_v1";

function makeDb(profile) {
  return {
    prepare(_sql) {
      return {
        async get(_id) {
          return profile || null;
        },
      };
    },
  };
}

function activeProfile(overrides = {}) {
  return {
    id: "vpp_1",
    user_id: "user_1",
    voice_profile_id: "vp_1",
    provider: "suno",
    status: "active",
    deleted_at: null,
    provider_profile_id: "persona_remote_42",
    consent_scope: VALID_CONSENT,
    ...overrides,
  };
}

const baseTrack = { user_id: "user_1" };
const baseContract = {
  pipeline: SUNO_PIPELINE,
  voice_provider_profile_id: "vpp_1",
};
const runtimeConfig = {
  suno_voice_persona_persona_model: "voice_persona",
  suno_voice_persona_audio_weight: 0.85,
};

describe("resolveSunoPersonaForRenderImpl (H22 guard branches)", () => {
  test("returns null when pipeline is not the persona pipeline", async () => {
    const result = await resolveSunoPersonaForRenderImpl({
      db: makeDb(activeProfile()),
      track: baseTrack,
      renderContract: { ...baseContract, pipeline: "ai_voice_pipeline" },
      runtimeConfig,
    });
    assert.equal(result, null);
  });

  test("returns the persona triple on the happy path", async () => {
    const result = await resolveSunoPersonaForRenderImpl({
      db: makeDb(activeProfile()),
      track: baseTrack,
      renderContract: baseContract,
      runtimeConfig,
    });
    assert.deepStrictEqual(result, {
      personaId: "persona_remote_42",
      personaModel: "voice_persona",
      audioWeight: 0.85,
    });
  });

  test("throws NOT_READY when renderContract has no voice_provider_profile_id", async () => {
    await assert.rejects(
      () =>
        resolveSunoPersonaForRenderImpl({
          db: makeDb(activeProfile()),
          track: baseTrack,
          renderContract: { ...baseContract, voice_provider_profile_id: null },
          runtimeConfig,
        }),
      /E302_SUNO_PERSONA_NOT_READY.*Missing frozen voice provider profile/,
    );
  });

  test("throws NOT_READY when provider profile is missing", async () => {
    await assert.rejects(
      () =>
        resolveSunoPersonaForRenderImpl({
          db: makeDb(null),
          track: baseTrack,
          renderContract: baseContract,
          runtimeConfig,
        }),
      /E302_SUNO_PERSONA_NOT_READY.*Active Suno voice persona profile not found/,
    );
  });

  test("throws NOT_READY when profile.user_id mismatches track.user_id (IDOR guard)", async () => {
    await assert.rejects(
      () =>
        resolveSunoPersonaForRenderImpl({
          db: makeDb(activeProfile({ user_id: "other_user" })),
          track: baseTrack,
          renderContract: baseContract,
          runtimeConfig,
        }),
      /E302_SUNO_PERSONA_NOT_READY/,
    );
  });

  test("throws NOT_READY when status is not active", async () => {
    for (const status of ["pending", "failed", "manual_cleanup_required"]) {
      await assert.rejects(
        () =>
          resolveSunoPersonaForRenderImpl({
            db: makeDb(activeProfile({ status })),
            track: baseTrack,
            renderContract: baseContract,
            runtimeConfig,
          }),
        /E302_SUNO_PERSONA_NOT_READY/,
      );
    }
  });

  test("throws NOT_READY when deleted_at is set (soft-deleted profile)", async () => {
    await assert.rejects(
      () =>
        resolveSunoPersonaForRenderImpl({
          db: makeDb(activeProfile({ deleted_at: "2026-05-07T00:00:00Z" })),
          track: baseTrack,
          renderContract: baseContract,
          runtimeConfig,
        }),
      /E302_SUNO_PERSONA_NOT_READY/,
    );
  });

  test("throws NOT_READY when provider_profile_id is null (persona create lost)", async () => {
    await assert.rejects(
      () =>
        resolveSunoPersonaForRenderImpl({
          db: makeDb(activeProfile({ provider_profile_id: null })),
          track: baseTrack,
          renderContract: baseContract,
          runtimeConfig,
        }),
      /E302_SUNO_PERSONA_NOT_READY.*Suno voice persona id is not ready/,
    );
  });

  test("throws CONSENT_REQUIRED when consent_scope is missing or wrong scope", async () => {
    for (const consent_scope of [null, "", "voice_other_v1"]) {
      await assert.rejects(
        () =>
          resolveSunoPersonaForRenderImpl({
            db: makeDb(activeProfile({ consent_scope })),
            track: baseTrack,
            renderContract: baseContract,
            runtimeConfig,
          }),
        /E302_SUNO_PERSONA_CONSENT_REQUIRED/,
      );
    }
  });

  test("falls back to defaults when runtimeConfig fields are missing", async () => {
    const result = await resolveSunoPersonaForRenderImpl({
      db: makeDb(activeProfile()),
      track: baseTrack,
      renderContract: baseContract,
      runtimeConfig: {}, // empty
    });
    assert.equal(result.personaModel, "voice_persona");
    assert.equal(result.audioWeight, 0.85);
  });
});
