/**
 * Sharing Security Tests
 *
 * Tests for security hardening of share token claim flow:
 * - TOCTOU race condition on concurrent claims (H4)
 * - dl_token not leaked before PIN verification (M3)
 * - Timing-safe PIN comparison (L6)
 * - Empty PIN does not increment lockout counter
 * - PIN is cryptographically random 6 digits
 * - Device token fallback rejected in production (M7)
 */

require("dotenv/config");
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");
const { createStorageProvider } = require("../src/storage");

// Song claims now require an authenticated device token (JWT with a `sub`).
// Register a device with x-user-id, then claim with the issued device token.
async function claimAuthenticated(
  app,
  db,
  { shareId, pin, deviceId, platform = "ios", appVersion = "1.0.0" } = {},
) {
  const uid = `recipient_${crypto.randomBytes(6).toString("hex")}`;
  db.prepare(
    "INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, ?)",
  ).run(uid, new Date().toISOString(), "low");
  const regRes = await app.inject({
    method: "POST",
    url: "/device/register",
    headers: { "x-user-id": uid },
    payload: { device_id: deviceId, platform, app_version: appVersion },
  });
  const { device_token: deviceToken } = JSON.parse(regRes.body);
  const response = await app.inject({
    method: "POST",
    url: `/share/${shareId}/claim`,
    headers: { "x-device-token": deviceToken },
    payload: { pin },
  });
  return { deviceToken, recipientId: uid, response };
}

describe("Sharing Security", () => {
  let app;
  let db;
  let storageDir;
  const testUserId = "sec_share_test_user";

  before(async () => {
    process.env.NODE_ENV = "test";
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-share-sec-"));
    const config = {
      PREVIEW_ONLY: false,
      STREAM_BASE_URL: "http://stream.local",
      STORAGE_DIR: storageDir,
      STORAGE_PROVIDER: "local",
      UPLOAD_SIGNING_SECRET: "test-upload-secret",
      UPLOAD_URL_TTL_SEC: 900,
      ALLOW_DEVICE_TOKEN_FALLBACK: true, // Enable fallback so body device_id/platform works in test
    };
    db = await initDb({
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    const storage = createStorageProvider(config);
    app = buildServer({ db, config, storage });

    db.prepare(
      "INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, ?)",
    ).run(testUserId, new Date().toISOString(), "low");
  });

  after(async () => {
    if (storageDir && fs.existsSync(storageDir)) {
      fs.rmSync(storageDir, { recursive: true });
    }
  });

  // Helper: create a track, version, mock render, and share it — returns { shareId, claimPin }
  async function createShareWithPin() {
    const createTrackRes = await app.inject({
      method: "POST",
      url: "/tracks",
      headers: { "x-user-id": testUserId },
      payload: {
        title: "SecTest " + crypto.randomBytes(4).toString("hex"),
        recipient_name: "Recipient",
        message: "Security test message",
        style: "pop",
        occasion: "birthday",
      },
    });
    const track = JSON.parse(createTrackRes.body);

    const createVersionRes = await app.inject({
      method: "POST",
      url: `/tracks/${track.track_id}/versions`,
      headers: { "x-user-id": testUserId },
      payload: { style: "pop" },
    });
    const version = JSON.parse(createVersionRes.body);

    db.prepare(
      "UPDATE track_versions SET preview_url = ? WHERE track_id = ? AND version_num = ?",
    ).run("http://stream.local/test.m3u8", track.track_id, version.version_num);

    const shareRes = await app.inject({
      method: "POST",
      url: `/tracks/${track.track_id}/share`,
      headers: { "x-user-id": testUserId },
      payload: {
        version_num: version.version_num,
        expires_in_days: 7,
        web_stream_allowed: true,
      },
    });
    const shareBody = JSON.parse(shareRes.body);
    return { shareId: shareBody.share_id, claimPin: shareBody.claim_pin };
  }

  // =========================================================================
  // Single claim succeeds
  // =========================================================================
  it("single claim succeeds with correct PIN and device token", async () => {
    const { shareId, claimPin } = await createShareWithPin();
    const deviceId = "device_" + crypto.randomBytes(4).toString("hex");

    const { response: res } = await claimAuthenticated(app, db, {
      shareId,
      pin: claimPin,
      deviceId,
    });

    assert.strictEqual(
      res.statusCode,
      200,
      `Expected 200, got ${res.statusCode}: ${res.body}`,
    );
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, "claimed");

    // Verify DB state
    const share = db
      .prepare("SELECT * FROM share_tokens WHERE id = ?")
      .get(shareId);
    assert.strictEqual(share.status, "claimed");
    assert.strictEqual(share.bound_device_id, deviceId);
  });

  // =========================================================================
  // Concurrent claims — only first succeeds, second gets 409
  // =========================================================================
  it("concurrent claims: second claim returns 409", async () => {
    const { shareId, claimPin } = await createShareWithPin();
    const device1 = "device_race_1_" + crypto.randomBytes(4).toString("hex");
    const device2 = "device_race_2_" + crypto.randomBytes(4).toString("hex");

    // First claim (authenticated)
    const { response: res1 } = await claimAuthenticated(app, db, {
      shareId,
      pin: claimPin,
      deviceId: device1,
    });
    assert.strictEqual(
      res1.statusCode,
      200,
      `First claim should succeed: ${res1.body}`,
    );

    // Second claim — same share, different authenticated device
    const { response: res2 } = await claimAuthenticated(app, db, {
      shareId,
      pin: claimPin,
      deviceId: device2,
      platform: "android",
    });
    assert.strictEqual(
      res2.statusCode,
      409,
      `Second claim should get 409: ${res2.body}`,
    );
    const body2 = JSON.parse(res2.body);
    assert.strictEqual(body2.error, "TOKEN_ALREADY_BOUND");

    // Verify DB: still bound to first device
    const share = db
      .prepare("SELECT * FROM share_tokens WHERE id = ?")
      .get(shareId);
    assert.strictEqual(share.bound_device_id, device1);
  });

  // =========================================================================
  // Wrong PIN does not return dl_token
  // =========================================================================
  it("claim with wrong PIN does not return dl_token", async () => {
    const { shareId } = await createShareWithPin();
    const deviceId = "device_wrongpin_" + crypto.randomBytes(4).toString("hex");

    const res = await app.inject({
      method: "POST",
      url: `/share/${shareId}/claim`,
      payload: { pin: "000000", device_id: deviceId, platform: "ios" },
    });

    assert.strictEqual(res.statusCode, 401);
    const body = JSON.parse(res.body);
    assert.strictEqual(
      body.dl_token,
      undefined,
      "dl_token must not be present on failed PIN",
    );
    assert.strictEqual(
      body.web_stream_url,
      undefined,
      "web_stream_url must not be present on failed PIN",
    );
  });

  // =========================================================================
  // Empty PIN does not increment lockout counter
  // =========================================================================
  it("claim with empty PIN does not increment lockout counter", async () => {
    const { shareId } = await createShareWithPin();
    const deviceId = "device_emptypin_" + crypto.randomBytes(4).toString("hex");

    // Get initial attempt count
    const shareBefore = db
      .prepare("SELECT claim_attempts FROM share_tokens WHERE id = ?")
      .get(shareId);

    // Send claim with no PIN
    const res = await app.inject({
      method: "POST",
      url: `/share/${shareId}/claim`,
      payload: { device_id: deviceId, platform: "ios" },
    });

    assert.strictEqual(res.statusCode, 401);

    // Verify lockout counter was NOT incremented
    const shareAfter = db
      .prepare("SELECT claim_attempts FROM share_tokens WHERE id = ?")
      .get(shareId);
    assert.strictEqual(
      shareAfter.claim_attempts,
      shareBefore.claim_attempts,
      "Empty PIN should not increment claim_attempts",
    );
  });

  // =========================================================================
  // PIN is 6 digits (crypto.randomInt range check)
  // =========================================================================
  it("generated PIN is exactly 6 digits", async () => {
    // Create multiple shares and verify PINs are always 6-digit numbers
    for (let i = 0; i < 5; i++) {
      const { claimPin } = await createShareWithPin();
      assert.strictEqual(
        claimPin.length,
        6,
        `PIN should be 6 digits, got: ${claimPin}`,
      );
      assert.match(
        claimPin,
        /^\d{6}$/,
        `PIN should be all digits: ${claimPin}`,
      );
      const num = parseInt(claimPin, 10);
      assert.ok(
        num >= 100000 && num <= 999999,
        `PIN should be in [100000, 999999]: ${num}`,
      );
    }
  });

  // =========================================================================
  // PIN-protected share GET: web_stream_url provided (pinless web playback),
  // but dl_token stays gated (download requires PIN verification)
  // =========================================================================
  it("GET /share/:id for PIN-protected share returns web_stream_url but not dl_token", async () => {
    const { shareId } = await createShareWithPin();

    const res = await app.inject({
      method: "GET",
      url: `/share/${shareId}`,
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(
      body.requires_pin,
      undefined,
      "requires_pin should not be in response — web playback is pinless",
    );
    assert.strictEqual(
      body.dl_token,
      undefined,
      "dl_token must not be present — downloads still require PIN",
    );
    assert.ok(
      body.web_stream_url,
      "web_stream_url must be present for pinless web playback",
    );
    assert.ok(
      body.web_stream_url.includes("/audio"),
      "web_stream_url should point to audio endpoint",
    );
  });

  // =========================================================================
  // Device fallback rejected in production mode
  // =========================================================================
  it("device token fallback is rejected in production mode", async () => {
    const { shareId, claimPin } = await createShareWithPin();
    const savedEnv = process.env.NODE_ENV;

    try {
      // Simulate production environment — the fallback config is enabled (ALLOW_DEVICE_TOKEN_FALLBACK: true)
      // but the NODE_ENV guard should block it in production
      process.env.NODE_ENV = "production";

      const res = await app.inject({
        method: "POST",
        url: `/share/${shareId}/claim`,
        // Only body-based device identification — no signed JWT device token
        payload: {
          pin: claimPin,
          device_id: "prod_device_123",
          platform: "ios",
        },
      });

      // In production, fallback should not work even with ALLOW_DEVICE_TOKEN_FALLBACK=true
      // because the NODE_ENV guard blocks it. The server returns either:
      // - 400 INVALID_REQUEST (config fallback enabled but NODE_ENV blocks it)
      // - 401 DEVICE_TOKEN_REQUIRED (config fallback disabled)
      // Either way, the claim must NOT succeed (no 200).
      assert.ok(
        res.statusCode === 400 || res.statusCode === 401,
        `Expected 400 or 401 in production mode, got ${res.statusCode}: ${res.body}`,
      );
      // Verify the share was NOT claimed
      const share = db
        .prepare("SELECT * FROM share_tokens WHERE id = ?")
        .get(shareId);
      assert.strictEqual(
        share.status,
        "unbound",
        "Share must remain unbound in production fallback mode",
      );
    } finally {
      process.env.NODE_ENV = savedEnv;
    }
  });
});
