/**
 * Song generation entitlement tests.
 *
 * Verifies that a single song entitlement is consumed once per version when
 * generation starts, and reused for same-version full renders/retries.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");

describe("Song Generation Entitlement", async () => {
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
        title: "Entitlement Test",
        occasion: "birthday",
        recipient_name: "Alex",
        style: "pop",
        duration_target: 60,
        voice_mode: "ai_voice",
        message: "Happy birthday!",
      },
    });
    assert.equal(createTrack.statusCode, 201);
    const trackId = createTrack.json().track_id;

    const createVersion = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions`,
      headers: { "x-user-id": userId },
      payload: { params: { lyrics_style: "warm" }, render_type: "preview" },
    });
    assert.equal(createVersion.statusCode, 201);

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
    process.env.JWT_SECRET = "test-jwt-secret-render-entitlement";
    process.env.ALLOW_ANON_USER_ID = "true";
    process.env.NODE_ENV = "test";
    db = await initDb();
    userId = `user_song_entitlement_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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

  it("spends once when preview generation starts successfully", async () => {
    const { trackId, trackVersionId } = await createTrackAndVersion();

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

    assert.equal(response.statusCode, 202);
    assert.equal(spendCalls, 1);
    const body = JSON.parse(response.body);
    assert.ok(body.job_id);

    const versionRows = await db.query(
      "SELECT status, preview_job_id, song_entitlement_consumed_at FROM track_versions WHERE id = ?",
      [trackVersionId]
    );
    assert.equal(versionRows.rows.length, 1);
    assert.equal(versionRows.rows[0].status, "processing");
    assert.equal(versionRows.rows[0].preview_job_id, body.job_id);
    assert.ok(versionRows.rows[0].song_entitlement_consumed_at);
  });

  it("rolls back preview start when entitlement spend fails", async () => {
    const { trackId, trackVersionId } = await createTrackAndVersion();

    await db.query(
      `UPDATE track_versions
       SET status = 'queued',
           lyrics_status = 'approved'
       WHERE id = ?`,
      [trackVersionId]
    );

    spendBehavior = async () => {
      const err = new Error("Insufficient songs remaining");
      err.code = "INSUFFICIENT_SONGS";
      throw err;
    };

    const response = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/render_preview`,
      headers: { "x-user-id": userId },
    });

    assert.equal(response.statusCode, 402);
    assert.equal(response.json().error, "INSUFFICIENT_CREDITS");
    assert.equal(spendCalls, 1);

    const versionRows = await db.query(
      "SELECT status, preview_job_id, song_entitlement_consumed_at FROM track_versions WHERE id = ?",
      [trackVersionId]
    );
    assert.equal(versionRows.rows.length, 1);
    assert.equal(versionRows.rows[0].status, "queued");
    assert.equal(versionRows.rows[0].preview_job_id, null);
    assert.equal(versionRows.rows[0].song_entitlement_consumed_at, null);

    const jobs = await db.query(
      "SELECT id FROM jobs WHERE track_version_id = ? AND workflow_type = 'preview_render'",
      [trackVersionId]
    );
    assert.equal(jobs.rows.length, 0);
  });

  it("allows direct full render without prior preview and spends once", async () => {
    const { trackId, trackVersionId } = await createTrackAndVersion();

    await db.query(
      `UPDATE track_versions
       SET status = 'queued',
           lyrics_status = 'approved',
           preview_url = NULL,
           song_entitlement_consumed_at = NULL
       WHERE id = ?`,
      [trackVersionId]
    );

    const response = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/render_full`,
      headers: { "x-user-id": userId },
      payload: {},
    });

    assert.equal(response.statusCode, 202);
    assert.equal(spendCalls, 1);

    const versionRows = await db.query(
      "SELECT status, full_job_id, preview_job_id, song_entitlement_consumed_at FROM track_versions WHERE id = ?",
      [trackVersionId]
    );
    assert.equal(versionRows.rows.length, 1);
    assert.equal(versionRows.rows[0].status, "processing");
    assert.ok(versionRows.rows[0].full_job_id);
    assert.equal(versionRows.rows[0].preview_job_id, null);
    assert.ok(versionRows.rows[0].song_entitlement_consumed_at);
  });

  it("does not spend again when full render starts for a version already spent at preview", async () => {
    const { trackId, trackVersionId } = await createTrackAndVersion();

    await db.query(
      `UPDATE track_versions
       SET status = 'preview_ready',
           lyrics_status = 'approved',
           preview_url = ?,
           song_entitlement_consumed_at = ?
       WHERE id = ?`,
      ["http://localhost/preview.mp3", new Date().toISOString(), trackVersionId]
    );

    const response = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/render_full`,
      headers: { "x-user-id": userId },
      payload: {},
    });

    assert.equal(response.statusCode, 202);
    assert.equal(spendCalls, 0);
    assert.equal(response.json().credits_reserved, 0);
    assert.equal(response.json().billing_hold_id, null);

    const versionRows = await db.query(
      "SELECT status, full_job_id, song_entitlement_consumed_at, billing_hold_id FROM track_versions WHERE id = ?",
      [trackVersionId]
    );
    assert.equal(versionRows.rows.length, 1);
    assert.equal(versionRows.rows[0].status, "processing");
    assert.ok(versionRows.rows[0].full_job_id);
    assert.ok(versionRows.rows[0].song_entitlement_consumed_at);
    assert.equal(versionRows.rows[0].billing_hold_id, null);
  });

  it("spends once at full render for legacy preview-ready versions without an entitlement marker", async () => {
    const { trackId, trackVersionId } = await createTrackAndVersion();

    await db.query(
      `UPDATE track_versions
       SET status = 'preview_ready',
           lyrics_status = 'approved',
           preview_url = ?,
           song_entitlement_consumed_at = NULL
       WHERE id = ?`,
      ["http://localhost/preview.mp3", trackVersionId]
    );

    const response = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/render_full`,
      headers: { "x-user-id": userId },
      payload: {},
    });

    assert.equal(response.statusCode, 202);
    assert.equal(spendCalls, 1);
    assert.equal(response.json().credits_reserved, 0);

    const versionRows = await db.query(
      "SELECT status, full_job_id, song_entitlement_consumed_at FROM track_versions WHERE id = ?",
      [trackVersionId]
    );
    assert.equal(versionRows.rows.length, 1);
    assert.equal(versionRows.rows[0].status, "processing");
    assert.ok(versionRows.rows[0].full_job_id);
    assert.ok(versionRows.rows[0].song_entitlement_consumed_at);
  });

  it("spends separately for a new version", async () => {
    const { trackId, trackVersionId } = await createTrackAndVersion();
    const now = new Date().toISOString();

    await db.query(
      `UPDATE track_versions
       SET status = 'preview_ready',
           lyrics_status = 'approved',
           preview_url = ?,
           song_entitlement_consumed_at = ?
       WHERE id = ?`,
      ["http://localhost/preview.mp3", now, trackVersionId]
    );

    await db.query(
      `INSERT INTO track_versions
         (id, track_id, version_num, parent_version_id, status, render_type, params_hash, created_at, lyrics_status)
       VALUES (?, ?, 2, ?, 'queued', 'preview', ?, ?, 'approved')`,
      [`${trackVersionId}-v2`, trackId, trackVersionId, "hash-v2", now]
    );

    const response = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/2/render_preview`,
      headers: { "x-user-id": userId },
    });

    assert.equal(response.statusCode, 202);
    assert.equal(spendCalls, 1);

    const versionRows = await db.query(
      "SELECT song_entitlement_consumed_at FROM track_versions WHERE track_id = ? AND version_num = 2",
      [trackId]
    );
    assert.equal(versionRows.rows.length, 1);
    assert.ok(versionRows.rows[0].song_entitlement_consumed_at);
  });
});
