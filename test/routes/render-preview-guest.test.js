"use strict";

// Env must exist BEFORE requiring src/server (auth.js asserts JWT_SECRET at
// require time); ambient-shell env is not guaranteed in CI.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET ||= "test-jwt-secret-web-funnel-32-bytes!!";

const { afterEach, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { initDb } = require("../../src/db");
const { buildServer } = require("../../src/server");
const { clearCache, setFeatureFlag } = require("../../src/services/feature-flags");

function storageStub() {
  return {
    put: async () => {},
    get: async () => null,
    exists: async () => false,
    delete: async () => {},
    getSignedUrl: async (key) => `http://localhost/${key}`,
  };
}

function subscriptionManagerStub(onSpend) {
  return {
    syncSubscription: async () => ({}),
    syncFromGoogle: async () => ({}),
    activateTrial: async () => ({}),
    handleExpiration: async () => ({}),
    handleGracePeriod: async () => ({}),
    handleRevocation: async () => ({}),
    spendSong: async () => {
      throw new Error("spendSong should not be called directly");
    },
    spendSongInTransaction: async (...args) => onSpend(...args),
    adminGrantSongs: async () => ({}),
    createFreeEntitlements: async () => ({}),
    getActiveSubscription: async () => null,
    getSubscriptionByOriginalTx: async () => null,
    getEntitlements: async () => null,
  };
}

describe("guest render-preview entitlement bypass and cost guards", () => {
  let db;
  let app;
  let spendCalls;
  let lyricsCalls;
  let previewTurnstileValid;

  beforeEach(async () => {
    process.env.JWT_SECRET = "test-jwt-secret-guest-render-preview-32";
    process.env.ALLOW_ANON_USER_ID = "true";
    clearCache();
    db = await initDb();
    await setFeatureFlag(db, "web_funnel_enabled", true, "test");
    process.env.TRUST_CLOUDFLARE_CLIENT_IP = "true";
    spendCalls = 0;
    lyricsCalls = 0;
    previewTurnstileValid = true;
    app = buildServer({
      db,
      config: {
        STORAGE_DIR: "/tmp/test-storage",
        ALLOW_ANON_USER_ID: true,
        enqueueArtworkJobFn: () => ({ promise: Promise.resolve() }),
        generateLyricsFn: async () => {
          lyricsCalls += 1;
          return {
            lyrics: {
              title: "Always Jordan",
              anchor_line: "Jordan, this song is for you",
              sections: [
                { name: "Chorus", lines: ["Jordan, this song is for you"] },
              ],
            },
            lyrics_status: "draft",
            provider: "stub",
            model: "test",
            quality_score: 0.9,
          };
        },
      },
      storage: storageStub(),
      billingServices: {
        subscriptionManager: subscriptionManagerStub(async () => {
          spendCalls += 1;
          const error = new Error("No songs remaining");
          error.code = "INSUFFICIENT_SONGS";
          throw error;
        }),
      },
      webFunnelServices: {
        turnstileVerifier: {
          verify: async ({ token }) => ({
            success:
              token === "valid-session" ||
              (previewTurnstileValid && token === "valid-preview"),
          }),
        },
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
    if (db) await db.close();
    clearCache();
    delete process.env.TRUST_CLOUDFLARE_CLIENT_IP;
  });

  async function startGuest(ip) {
    const response = await app.inject({
      method: "POST",
      url: "/web/session",
      headers: { "cf-connecting-ip": ip },
      payload: {
        turnstile_token: "valid-session",
        entry_url: "https://porizo.co/create",
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  }

  async function createTrack(accessToken, recipient = "Jordan") {
    const response = await app.inject({
      method: "POST",
      url: "/tracks",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        title: `Always ${recipient}`,
        occasion: "birthday",
        recipient_name: recipient,
        style: "acoustic, warm",
        duration_target: 60,
        voice_mode: "ai_voice",
        message: "Sunday cooking and laughing together.",
      },
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().track_id;
  }

  async function createApprovedVersion(accessToken, trackId) {
    const response = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        params: {
          lyrics_style: `warm-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
        render_type: "preview",
      },
    });
    assert.equal(response.statusCode, 201, response.body);
    const body = response.json();
    await db.query(
      `UPDATE track_versions
       SET lyrics_status = 'approved', moderation_status = 'passed',
           lyrics_json = ?, lyrics_updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [JSON.stringify({ sections: [{ name: "chorus", lines: ["Jordan, this is for you"] }] }), body.track_version_id],
    );
    return body.version_num;
  }

  async function renderPreview(accessToken, trackId, versionNum, ip) {
    return app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/${versionNum}/render_preview`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "cf-connecting-ip": ip,
      },
      payload: { turnstile_token: "valid-preview" },
    });
  }

  it("rejects an invalid spend-point Turnstile token before consuming preview budgets", async () => {
    const ip = "203.0.113.29";
    const guest = await startGuest(ip);
    const trackId = await createTrack(guest.access_token);
    const versionNum = await createApprovedVersion(
      guest.access_token,
      trackId,
    );
    previewTurnstileValid = false;

    const response = await renderPreview(
      guest.access_token,
      trackId,
      versionNum,
      ip,
    );

    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().error, "TURNSTILE_INVALID");
    const counters = await db.query(
      "SELECT COUNT(*) AS count FROM rate_limits WHERE action_type LIKE 'web_preview_%'",
    );
    assert.equal(Number(counters.rows[0].count), 0);
  });

  it("queues a guest preview with zero entitlements and leaves the spend stamp null", async () => {
    const ip = "203.0.113.30";
    const guest = await startGuest(ip);
    const trackId = await createTrack(guest.access_token);
    const versionNum = await createApprovedVersion(guest.access_token, trackId);

    const response = await renderPreview(guest.access_token, trackId, versionNum, ip);
    assert.equal(response.statusCode, 202, response.body);
    assert.equal(spendCalls, 0);
    const row = await db.query(
      "SELECT song_entitlement_consumed_at, preview_job_id FROM track_versions WHERE track_id = ? AND version_num = ?",
      [trackId, versionNum],
    );
    assert.equal(row.rows[0].song_entitlement_consumed_at, null);
    assert.ok(row.rows[0].preview_job_id);
  });

  it("blocks the third preview for one guest before enqueue", async () => {
    const ip = "203.0.113.31";
    const guest = await startGuest(ip);
    const trackId = await createTrack(guest.access_token);
    const statuses = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const versionNum = await createApprovedVersion(guest.access_token, trackId);
      const response = await renderPreview(guest.access_token, trackId, versionNum, ip);
      statuses.push([response.statusCode, response.json().error]);
    }
    assert.deepEqual(statuses, [
      [202, undefined],
      [202, undefined],
      [429, "WEB_PREVIEW_LIMIT_REACHED"],
    ]);
    assert.equal(spendCalls, 0);
  });

  it("blocks the fourth guest lyric generation before calling the provider", async () => {
    const guest = await startGuest("203.0.113.34");
    const trackId = await createTrack(guest.access_token);
    const version = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions`,
      headers: { authorization: `Bearer ${guest.access_token}` },
      payload: { params: { lyrics_style: "warm" }, render_type: "preview" },
    });
    assert.equal(version.statusCode, 201, version.body);
    const versionNum = version.json().version_num;
    const statuses = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/versions/${versionNum}/lyrics/generate`,
        headers: {
          authorization: `Bearer ${guest.access_token}`,
          "cf-connecting-ip": "203.0.113.34",
        },
        payload: {},
      });
      statuses.push([response.statusCode, response.json().error]);
    }
    assert.deepEqual(statuses, [
      [200, undefined],
      [200, undefined],
      [200, undefined],
      [429, "WEB_LYRICS_LIMIT_REACHED"],
    ]);
    assert.equal(lyricsCalls, 3);
  });

  it("applies the global cost breaker before a failed preview retry", async () => {
    await setFeatureFlag(db, "web_funnel_daily_preview_budget", 1, "test");
    const guest = await startGuest("203.0.113.35");
    const trackId = await createTrack(guest.access_token);
    const versionNum = await createApprovedVersion(guest.access_token, trackId);
    const initial = await renderPreview(
      guest.access_token,
      trackId,
      versionNum,
      "203.0.113.35",
    );
    assert.equal(initial.statusCode, 202, initial.body);
    await db.query(
      "UPDATE jobs SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = ?",
      [initial.json().job_id],
    );
    await db.query(
      "UPDATE track_versions SET status = 'failed' WHERE track_id = ? AND version_num = ?",
      [trackId, versionNum],
    );

    const retry = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/${versionNum}/retry`,
      headers: {
        authorization: `Bearer ${guest.access_token}`,
        "cf-connecting-ip": "203.0.113.35",
      },
      payload: {
        render_type: "preview",
        turnstile_token: "valid-preview",
      },
    });
    assert.equal(retry.statusCode, 503, retry.body);
    assert.equal(retry.json().error, "FUNNEL_PAUSED");
  });

  it("fails closed before enqueue when the durable cost counter is unavailable", async () => {
    const guest = await startGuest("203.0.113.36");
    const trackId = await createTrack(guest.access_token);
    const versionNum = await createApprovedVersion(guest.access_token, trackId);
    await db.query("DROP TABLE rate_limits");

    const response = await renderPreview(
      guest.access_token,
      trackId,
      versionNum,
      "203.0.113.36",
    );
    assert.equal(response.statusCode, 503, response.body);
    assert.equal(response.json().error, "FUNNEL_GUARD_UNAVAILABLE");
    const jobs = await db.query("SELECT COUNT(*) AS count FROM jobs");
    assert.equal(Number(jobs.rows[0].count), 0);
  });

  it("trips the global daily breaker across guest identities", async () => {
    await setFeatureFlag(db, "web_funnel_daily_preview_budget", 1, "test");
    const first = await startGuest("203.0.113.32");
    const second = await startGuest("203.0.113.33");
    const firstTrack = await createTrack(first.access_token, "Ari");
    const secondTrack = await createTrack(second.access_token, "Mina");
    const firstVersion = await createApprovedVersion(first.access_token, firstTrack);
    const secondVersion = await createApprovedVersion(second.access_token, secondTrack);

    const accepted = await renderPreview(
      first.access_token,
      firstTrack,
      firstVersion,
      "203.0.113.32",
    );
    const paused = await renderPreview(
      second.access_token,
      secondTrack,
      secondVersion,
      "203.0.113.33",
    );
    assert.equal(accepted.statusCode, 202, accepted.body);
    assert.equal(paused.statusCode, 503, paused.body);
    assert.equal(paused.json().error, "FUNNEL_PAUSED");
    assert.equal(spendCalls, 0);
    const guestSpend = await db.query(
      "SELECT SUM(count) AS count FROM rate_limits WHERE action_type = 'web_preview_guest_lifetime'",
    );
    const ipSpend = await db.query(
      "SELECT SUM(count) AS count FROM rate_limits WHERE action_type = 'web_preview_ip_daily'",
    );
    assert.equal(Number(guestSpend.rows[0].count), 1);
    assert.equal(Number(ipSpend.rows[0].count), 1);
  });

  it("blocks the eleventh preview from one trusted client IP across guests", async () => {
    const previewIp = "203.0.113.90";
    let lastResponse;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const guest = await startGuest(`198.51.100.${attempt + 1}`);
      const trackId = await createTrack(guest.access_token, `Guest${attempt}`);
      const versionNum = await createApprovedVersion(guest.access_token, trackId);
      lastResponse = await renderPreview(
        guest.access_token,
        trackId,
        versionNum,
        previewIp,
      );
      if (attempt < 10) assert.equal(lastResponse.statusCode, 202, lastResponse.body);
    }
    assert.equal(lastResponse.statusCode, 429, lastResponse.body);
    assert.equal(lastResponse.json().error, "WEB_PREVIEW_IP_LIMIT_REACHED");
  });

  it("keeps the token-free native entitlement path for a non-guest user", async () => {
    const userId = "user_active_preview_contract";
    await db.query(
      "INSERT INTO users (id, created_at, account_status) VALUES (?, CURRENT_TIMESTAMP, 'active')",
      [userId],
    );
    const trackId = await createTrackForDevUser(userId);
    const versionNum = await createApprovedVersionForDevUser(userId, trackId);
    const response = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/${versionNum}/render_preview`,
      headers: { "x-user-id": userId },
      payload: {},
    });
    assert.equal(response.statusCode, 402, response.body);
    assert.equal(response.json().error, "INSUFFICIENT_CREDITS");
    assert.equal(spendCalls, 1);
  });

  async function createTrackForDevUser(userId) {
    const response = await app.inject({
      method: "POST",
      url: "/tracks",
      headers: { "x-user-id": userId },
      payload: {
        title: "Active user song",
        occasion: "birthday",
        recipient_name: "Sam",
        style: "pop",
        duration_target: 60,
        voice_mode: "ai_voice",
        message: "A real memory for Sam.",
      },
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().track_id;
  }

  async function createApprovedVersionForDevUser(userId, trackId) {
    const response = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions`,
      headers: { "x-user-id": userId },
      payload: { params: {}, render_type: "preview" },
    });
    assert.equal(response.statusCode, 201, response.body);
    const body = response.json();
    await db.query(
      `UPDATE track_versions
       SET lyrics_status = 'approved', moderation_status = 'passed', lyrics_json = ?
       WHERE id = ?`,
      [JSON.stringify({ sections: [{ name: "chorus", lines: ["For Sam"] }] }), body.track_version_id],
    );
    return body.version_num;
  }
});
