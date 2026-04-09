/**
 * Render Endpoint Integration Tests
 *
 * Covers:
 * 1. POST /tracks/:id/versions/:version/render_preview — happy path
 * 2. POST /tracks/:id/versions/:version/render_full — insufficient credits
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");

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
});
