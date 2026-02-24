/**
 * Render full billing atomicity tests.
 *
 * Ensures entitlement spend happens only after render lock acquisition and
 * remains atomic with hold/job creation.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");

describe("Render Full Billing Atomicity", async () => {
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
        throw new Error("spendSong should not be called directly from render_full");
      },
      spendSongInTransaction: async (...args) => {
        spendCalls += 1;
        if (typeof spendBehavior === "function") {
          return spendBehavior(...args);
        }
        return { songsRemaining: 0, source: "subscription" };
      },
      adminGrantSongs: async () => ({}),
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
        title: "Atomic Billing Test",
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
    db = await getDatabase();
    userId = `user_render_atomic_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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

  it("does not spend when version is already processing without an active full job", async () => {
    const { trackId, trackVersionId } = await createTrackAndVersion();

    await db.query(
      `UPDATE track_versions
       SET status = 'processing',
           lyrics_status = 'approved',
           preview_url = ?,
           full_job_id = NULL,
           billing_hold_id = NULL
       WHERE id = ?`,
      ["http://localhost/preview.mp3", trackVersionId]
    );

    const response = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/render_full`,
      headers: { "x-user-id": userId },
      payload: { confirm_credit_spend: true },
    });

    assert.equal(response.statusCode, 409);
    const body = JSON.parse(response.body);
    assert.equal(body.error, "ALREADY_RENDERING");
    assert.equal(spendCalls, 0);

    const holds = await db.query(
      "SELECT id FROM billing_holds WHERE track_version_id = ?",
      [trackVersionId]
    );
    assert.equal(holds.rows.length, 0);
  });

  it("spends once and creates hold/job when render_full starts successfully", async () => {
    const { trackId, trackVersionId } = await createTrackAndVersion();

    await db.query(
      `UPDATE track_versions
       SET status = 'preview_ready',
           lyrics_status = 'approved',
           preview_url = ?,
           full_job_id = NULL,
           billing_hold_id = NULL
       WHERE id = ?`,
      ["http://localhost/preview.mp3", trackVersionId]
    );

    const response = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/render_full`,
      headers: { "x-user-id": userId },
      payload: { confirm_credit_spend: true },
    });

    assert.equal(response.statusCode, 202);
    assert.equal(spendCalls, 1);
    const body = JSON.parse(response.body);
    assert.ok(body.job_id);
    assert.ok(body.billing_hold_id);

    const holds = await db.query(
      "SELECT id, status FROM billing_holds WHERE id = ?",
      [body.billing_hold_id]
    );
    assert.equal(holds.rows.length, 1);
    assert.equal(holds.rows[0].status, "held");

    const jobs = await db.query(
      "SELECT id, workflow_type, status FROM jobs WHERE id = ?",
      [body.job_id]
    );
    assert.equal(jobs.rows.length, 1);
    assert.equal(jobs.rows[0].workflow_type, "full_render");
    assert.equal(jobs.rows[0].status, "queued");
  });

  it("rolls back lock/hold/job when spend fails with insufficient credits", async () => {
    const { trackId, trackVersionId } = await createTrackAndVersion();

    await db.query(
      `UPDATE track_versions
       SET status = 'preview_ready',
           lyrics_status = 'approved',
           preview_url = ?,
           full_job_id = NULL,
           billing_hold_id = NULL
       WHERE id = ?`,
      ["http://localhost/preview.mp3", trackVersionId]
    );

    spendBehavior = async () => {
      throw new Error("Insufficient songs remaining");
    };

    const response = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/render_full`,
      headers: { "x-user-id": userId },
      payload: { confirm_credit_spend: true },
    });

    assert.equal(response.statusCode, 402);
    const body = JSON.parse(response.body);
    assert.equal(body.error, "INSUFFICIENT_CREDITS");
    assert.equal(spendCalls, 1);

    const versionRows = await db.query(
      "SELECT status, billing_hold_id, full_job_id FROM track_versions WHERE id = ?",
      [trackVersionId]
    );
    assert.equal(versionRows.rows.length, 1);
    assert.equal(versionRows.rows[0].status, "preview_ready");
    assert.equal(versionRows.rows[0].billing_hold_id, null);
    assert.equal(versionRows.rows[0].full_job_id, null);

    const holds = await db.query(
      "SELECT id FROM billing_holds WHERE track_version_id = ?",
      [trackVersionId]
    );
    assert.equal(holds.rows.length, 0);

    const jobs = await db.query(
      "SELECT id FROM jobs WHERE track_version_id = ? AND workflow_type = 'full_render'",
      [trackVersionId]
    );
    assert.equal(jobs.rows.length, 0);
  });
});
