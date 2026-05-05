/**
 * Render Endpoint Integration Tests
 *
 * Covers:
 * 1. POST /tracks/:id/versions/:version/render_preview — happy path
 * 2. POST /tracks/:id/versions/:version/render_full — insufficient credits
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
process.env.JWT_SECRET = "test-jwt-secret-render-endpoints";
process.env.ALLOW_ANON_USER_ID = "true";
process.env.NODE_ENV = "test";
const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");
const { _testing: runnerTesting } = require("../src/workflows/runner");

describe("Render Endpoints", async () => {
  let db;
  let app;
  let userId;
  let spendCalls;
  let spendBehavior;

  function createMockSubscriptionManager() {
    return {
      syncSubscription: async () => ({ subscriptionId: "sub_mock", tier: "free", status: "active", songsGranted: 0 }),
      syncFromGoogle: async () => ({ id: "sub_mock", tier: "free", status: "active", is_new: false }),
      activateTrial: async () => ({ songsGranted: 0, durationDays: 0, trialExpiresAt: new Date() }),
      handleExpiration: async () => ({}),
      handleGracePeriod: async () => ({}),
      handleRevocation: async () => ({}),
      spendSong: async () => {
        throw new Error("spendSong should not be called directly");
      },
      spendSongInTransaction: async (...args) => {
        spendCalls += 1;
        if (typeof spendBehavior === "function") {
          return spendBehavior(...args);
        }
        return { songsRemaining: 0, source: "subscription" };
      },
      adminGrantSongs: async () => ({}),
      createFreeEntitlements: async () => ({}),
      getActiveSubscription: async () => null,
      getSubscriptionByOriginalTx: async () => null,
      getEntitlements: async () => null,
    };
  }

  async function createTrackAndVersion() {
    const createTrack = await app.inject({
      method: "POST",
      url: "/tracks",
      headers: { "x-user-id": userId },
      payload: {
        title: "Render Test Song",
        occasion: "birthday",
        recipient_name: "Jordan",
        style: "pop",
        duration_target: 60,
        voice_mode: "ai_voice",
        message: "Happy birthday!",
      },
    });
    assert.equal(createTrack.statusCode, 201, `Track creation failed: ${createTrack.body}`);
    const trackId = createTrack.json().track_id;

    const createVersion = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions`,
      headers: { "x-user-id": userId },
      payload: { params: { lyrics_style: "warm" }, render_type: "preview" },
    });
    assert.equal(createVersion.statusCode, 201, `Version creation failed: ${createVersion.body}`);

    const versionRow = await db.query(
      "SELECT id FROM track_versions WHERE track_id = ? AND version_num = 1",
      [trackId]
    );
    assert.equal(versionRow.rows.length, 1);

    return {
      trackId,
      trackVersionId: versionRow.rows[0].id,
    };
  }

  beforeEach(async () => {
    process.env.JWT_SECRET = "test-jwt-secret-render-endpoints";
    process.env.ALLOW_ANON_USER_ID = "true";
    process.env.NODE_ENV = "test";
    db = await initDb();
    userId = `user_render_ep_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    spendCalls = 0;
    spendBehavior = null;

    await db.query(
      "INSERT INTO users (id, created_at) VALUES (?, datetime('now'))",
      [userId]
    );

    app = buildServer({
      db,
      config: {
        STORAGE_DIR: "/tmp/test-storage",
        ALLOW_ANON_USER_ID: true,
      },
      storage: {
        put: async () => {},
        get: async () => null,
        exists: async () => false,
        delete: async () => {},
        getSignedUrl: async (key) => `http://localhost/${key}`,
      },
      billingServices: {
        subscriptionManager: createMockSubscriptionManager(),
      },
    });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    if (db) {
      await db.close();
    }
  });

  it("POST /tracks/:id/versions/:version/render_preview — happy path creates job", async () => {
    const { trackId, trackVersionId } = await createTrackAndVersion();

    // Set up the version to be in a renderable state
    await db.query(
      `UPDATE track_versions
       SET status = 'queued',
           lyrics_status = 'approved'
       WHERE id = ?`,
      [trackVersionId]
    );

    const response = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/render_preview`,
      headers: { "x-user-id": userId },
    });

    assert.equal(response.statusCode, 202, `Expected 202, got ${response.statusCode}: ${response.body}`);

    const body = response.json();
    assert.ok(body.job_id, "Response should contain a job_id");
    assert.equal(typeof body.estimated_completion_sec, "number", "Should include estimated_completion_sec");
    assert.ok(body.poll_url, "Should include poll_url");
    assert.ok(body.poll_url.includes(body.job_id), "poll_url should reference the job_id");

    // Verify the job was inserted into the database
    const jobRows = await db.query(
      "SELECT id, workflow_type, status FROM jobs WHERE id = ?",
      [body.job_id]
    );
    assert.equal(jobRows.rows.length, 1, "Job should exist in database");
    assert.equal(jobRows.rows[0].workflow_type, "preview_render");
    assert.equal(jobRows.rows[0].status, "queued");

    // Verify the track version was updated
    const versionRows = await db.query(
      "SELECT status, preview_job_id, song_entitlement_consumed_at FROM track_versions WHERE id = ?",
      [trackVersionId]
    );
    assert.equal(versionRows.rows.length, 1);
    assert.equal(versionRows.rows[0].status, "processing");
    assert.equal(versionRows.rows[0].preview_job_id, body.job_id);
    assert.ok(versionRows.rows[0].song_entitlement_consumed_at, "Entitlement should be consumed");

    // Verify entitlement was spent exactly once
    assert.equal(spendCalls, 1, "Should spend exactly one entitlement");
  });

  it("POST /tracks/:id/versions/:version/render_preview falls back when Suno persona is missing", async () => {
    const { trackId, trackVersionId } = await createTrackAndVersion();
    const now = new Date().toISOString();
    await db.query(
      `INSERT INTO voice_profiles (
        id, user_id, status, quality_score, model_version, consent_version,
        consent_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["voice_render_persona_missing", userId, "active", 0.9, "test", "voice_v1", now, now]
    );
    await db.query(
      "UPDATE tracks SET voice_mode = 'user_voice' WHERE id = ?",
      [trackId]
    );
    await db.query(
      `UPDATE track_versions
       SET status = 'queued',
           lyrics_status = 'approved'
       WHERE id = ?`,
      [trackVersionId]
    );
    const response = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/render_preview`,
      headers: { "x-user-id": userId },
    });

    assert.equal(response.statusCode, 202, `Expected 202, got ${response.statusCode}: ${response.body}`);
    assert.equal(spendCalls, 1, "Should spend entitlement through legacy voice conversion fallback");

    const jobRows = await db.query(
      "SELECT id, workflow_type, status, step_data FROM jobs WHERE track_version_id = ?",
      [trackVersionId]
    );
    assert.equal(jobRows.rows.length, 1, "Should create a render job");
    assert.equal(jobRows.rows[0].workflow_type, "preview_render");
    assert.equal(jobRows.rows[0].status, "queued");
    assert.equal(
      JSON.parse(jobRows.rows[0].step_data).render_request.user_voice_engine,
      "seedvc"
    );
    const versionRows = await db.query(
      "SELECT status, song_entitlement_consumed_at FROM track_versions WHERE id = ?",
      [trackVersionId]
    );
    assert.equal(versionRows.rows[0].status, "processing");
    assert.ok(versionRows.rows[0].song_entitlement_consumed_at);
  });

  it("POST /tracks/:id/versions/:version/render_full falls back when Suno persona is missing", async () => {
    const { trackId, trackVersionId } = await createTrackAndVersion();
    const now = new Date().toISOString();
    await db.query(
      `INSERT INTO voice_profiles (
        id, user_id, status, quality_score, model_version, consent_version,
        consent_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["voice_render_full_persona_missing", userId, "active", 0.9, "test", "voice_v1", now, now]
    );
    await db.query(
      "UPDATE tracks SET voice_mode = 'user_voice' WHERE id = ?",
      [trackId]
    );
    await db.query(
      `UPDATE track_versions
       SET status = 'queued',
           lyrics_status = 'approved',
           song_entitlement_consumed_at = NULL
       WHERE id = ?`,
      [trackVersionId]
    );
    const response = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/render_full`,
      headers: { "x-user-id": userId },
    });

    assert.equal(response.statusCode, 202, `Expected 202, got ${response.statusCode}: ${response.body}`);
    assert.equal(spendCalls, 1, "Should spend entitlement through legacy voice conversion fallback");

    const jobRows = await db.query(
      "SELECT id, status, step_data FROM jobs WHERE track_version_id = ? AND workflow_type = 'full_render'",
      [trackVersionId]
    );
    assert.equal(jobRows.rows.length, 1, "Should create a full render job");
    assert.equal(jobRows.rows[0].status, "queued");
    assert.equal(
      JSON.parse(jobRows.rows[0].step_data).render_request.user_voice_engine,
      "seedvc"
    );
    const versionRows = await db.query(
      "SELECT status, full_job_id, song_entitlement_consumed_at FROM track_versions WHERE id = ?",
      [trackVersionId]
    );
    assert.equal(versionRows.rows[0].status, "processing");
    assert.equal(versionRows.rows[0].full_job_id, jobRows.rows[0].id);
    assert.ok(versionRows.rows[0].song_entitlement_consumed_at);
  });

  it("POST /tracks/:id/versions/:version/render_preview falls back when Suno consent is invalid", async () => {
    const { trackId, trackVersionId } = await createTrackAndVersion();
    const now = new Date().toISOString();
    await db.query(
      `INSERT INTO voice_profiles (
        id, user_id, status, quality_score, model_version, consent_version,
        consent_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["voice_render_bad_consent", userId, "active", 0.9, "test", "voice_v1", now, now]
    );
    await db.query(
      `INSERT INTO voice_provider_profiles (
        id, voice_profile_id, user_id, provider, provider_profile_id, status,
        model, consent_scope, created_at, updated_at, activated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "vpp_bad_consent",
        "voice_render_bad_consent",
        userId,
        "suno",
        "persona_live_123",
        "active",
        "V5_5",
        "not_voice_suno_persona_v1",
        now,
        now,
        now,
      ]
    );
    await db.query("UPDATE tracks SET voice_mode = 'user_voice' WHERE id = ?", [trackId]);
    await db.query(
      `UPDATE track_versions
       SET status = 'queued',
           lyrics_status = 'approved',
           song_entitlement_consumed_at = NULL
       WHERE id = ?`,
      [trackVersionId]
    );
    const response = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/render_preview`,
      headers: { "x-user-id": userId },
    });

    assert.equal(response.statusCode, 202, `Expected 202, got ${response.statusCode}: ${response.body}`);
    assert.equal(spendCalls, 1);
    const jobs = await db.query("SELECT id FROM jobs WHERE track_version_id = ?", [trackVersionId]);
    assert.equal(jobs.rows.length, 1);
  });

  it("POST /tracks/:id/versions/:version/render_preview blocks completed-but-inactive voice profile", async () => {
    const { trackId, trackVersionId } = await createTrackAndVersion();
    const now = new Date().toISOString();
    await db.query(
      `INSERT INTO voice_profiles (
        id, user_id, status, quality_score, model_version, consent_version,
        consent_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["voice_render_completed", userId, "completed", 0.9, "test", "voice_v1", now, now]
    );
    await db.query("UPDATE tracks SET voice_mode = 'user_voice' WHERE id = ?", [trackId]);
    await db.query(
      `UPDATE track_versions
       SET status = 'queued',
           lyrics_status = 'approved',
           song_entitlement_consumed_at = NULL
       WHERE id = ?`,
      [trackVersionId]
    );

    const response = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/render_preview`,
      headers: { "x-user-id": userId },
    });

    assert.equal(response.statusCode, 422, `Expected 422, got ${response.statusCode}: ${response.body}`);
    assert.match(response.body, /VOICE_PROFILE_REQUIRED/);
    assert.equal(spendCalls, 0);
    const jobs = await db.query("SELECT id FROM jobs WHERE track_version_id = ?", [trackVersionId]);
    assert.equal(jobs.rows.length, 0);
  });

  it("POST /tracks/:id/versions/:version/render_preview blocks My Voice with no enrolled voice profile", async () => {
    const { trackId, trackVersionId } = await createTrackAndVersion();
    await db.query("UPDATE tracks SET voice_mode = 'user_voice' WHERE id = ?", [trackId]);
    await db.query(
      `UPDATE track_versions
       SET status = 'queued',
           lyrics_status = 'approved',
           song_entitlement_consumed_at = NULL
       WHERE id = ?`,
      [trackVersionId]
    );

    const response = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/render_preview`,
      headers: { "x-user-id": userId },
    });

    assert.equal(response.statusCode, 422, `Expected 422, got ${response.statusCode}: ${response.body}`);
    assert.match(response.body, /VOICE_PROFILE_REQUIRED/);
    assert.equal(spendCalls, 0, "Should not spend entitlement without an enrolled voice profile");
    const jobs = await db.query("SELECT id FROM jobs WHERE track_version_id = ?", [trackVersionId]);
    assert.equal(jobs.rows.length, 0);
  });

  it("POST /tracks/:id/versions/:version/render_full — insufficient credits returns 402", async () => {
    const { trackId, trackVersionId } = await createTrackAndVersion();

    // Set up version in a state where full render can be attempted
    await db.query(
      `UPDATE track_versions
       SET status = 'queued',
           lyrics_status = 'approved'
       WHERE id = ?`,
      [trackVersionId]
    );

    // Configure the mock to reject with insufficient songs
    spendBehavior = async () => {
      const err = new Error("Insufficient songs remaining");
      err.code = "INSUFFICIENT_SONGS";
      throw err;
    };

    const response = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/render_full`,
      headers: { "x-user-id": userId },
      payload: {},
    });

    assert.equal(response.statusCode, 402, `Expected 402, got ${response.statusCode}: ${response.body}`);

    const body = response.json();
    assert.equal(body.error, "INSUFFICIENT_CREDITS");

    // Verify the spend was attempted
    assert.equal(spendCalls, 1, "Should have attempted to spend");

    // Verify the version was NOT moved to processing (transaction rolled back)
    const versionRows = await db.query(
      "SELECT status, full_job_id, song_entitlement_consumed_at FROM track_versions WHERE id = ?",
      [trackVersionId]
    );
    assert.equal(versionRows.rows.length, 1);
    assert.equal(versionRows.rows[0].status, "queued", "Status should remain queued after rollback");
    assert.equal(versionRows.rows[0].full_job_id, null, "No job should be assigned");
    assert.equal(versionRows.rows[0].song_entitlement_consumed_at, null, "No entitlement should be consumed");

    // Verify no job was created
    const jobRows = await db.query(
      "SELECT id FROM jobs WHERE track_version_id = ? AND workflow_type = 'full_render'",
      [trackVersionId]
    );
    assert.equal(jobRows.rows.length, 0, "No full_render job should exist");
  });

  it("POST /tracks/:id/versions/:version/render_full — gift-funded track skips subscription spend", async () => {
    const { trackId, trackVersionId } = await createTrackAndVersion();

    await db.query(
      `INSERT INTO gift_reservations (
        id, user_id, status, content_type, content_id, version_num,
        token_transaction_id, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "gres_render_gift",
        userId,
        "reserved",
        "song",
        trackId,
        1,
        "gift_tx_render",
        new Date(Date.now() + 60_000).toISOString(),
        new Date().toISOString(),
        new Date().toISOString(),
      ]
    );
    await db.query(
      `UPDATE tracks
       SET funding_source = 'gift_token',
           gift_reservation_id = 'gres_render_gift'
       WHERE id = ?`,
      [trackId]
    );
    await db.query(
      `UPDATE track_versions
       SET status = 'queued',
           lyrics_status = 'approved'
       WHERE id = ?`,
      [trackVersionId]
    );

    const response = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/render_full`,
      headers: { "x-user-id": userId },
      payload: {},
    });

    assert.equal(response.statusCode, 202, `Expected 202, got ${response.statusCode}: ${response.body}`);
    assert.equal(spendCalls, 0, "Gift-funded render should not consume subscription entitlement");

    const versionRows = await db.query(
      "SELECT status, full_job_id, song_entitlement_consumed_at FROM track_versions WHERE id = ?",
      [trackVersionId]
    );
    assert.equal(versionRows.rows.length, 1);
    assert.equal(versionRows.rows[0].status, "processing");
    assert.ok(versionRows.rows[0].full_job_id);
    assert.ok(versionRows.rows[0].song_entitlement_consumed_at, "Gift-funded render should still mark version as funded");
  });

  it("render-ready share pre-generation works with a query-only adapter", async () => {
    const { trackId, trackVersionId } = await createTrackAndVersion();
    const queryOnlyDb = { query: db.query };

    const result = await runnerTesting.ensureRenderSharePreGeneration({
      db: queryOnlyDb,
      trackReady: { id: trackId, user_id: userId },
      trackVersionReady: { id: trackVersionId },
      streamBaseUrl: "http://stream.local",
      renderType: "full",
    });

    assert.equal(result.ok, true);
    const shareRows = await db.query(
      "SELECT id FROM share_tokens WHERE track_id = ? AND track_version_id = ?",
      [trackId, trackVersionId]
    );
    assert.equal(shareRows.rows.length, 1);
  });

  it("render-ready share pre-generation failures create operator-visible incidents", async () => {
    const { trackId, trackVersionId } = await createTrackAndVersion();

    const result = await runnerTesting.ensureRenderSharePreGeneration({
      db,
      trackReady: { id: trackId, user_id: userId },
      trackVersionReady: { id: trackVersionId },
      streamBaseUrl: "http://stream.local",
      renderType: "preview",
      createShareToken: async () => {
        throw new Error("simulated share generation failure");
      },
    });

    assert.equal(result.ok, false);
    const incidentRows = await db.query(
      "SELECT incident_type, detail FROM gift_delivery_incidents WHERE incident_key = ?",
      [`share_pre_generation:${trackVersionId}`]
    );
    assert.equal(incidentRows.rows.length, 1);
    assert.equal(incidentRows.rows[0].incident_type, "share_pre_generation_failed");
    assert.match(incidentRows.rows[0].detail, /simulated share generation failure/);
  });
});
