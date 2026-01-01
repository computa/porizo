/**
 * Share Flow Tests
 *
 * Tests for the device-bound track sharing functionality:
 * - Share token creation
 * - PIN verification
 * - Device binding
 * - Stream authorization
 */

require("dotenv/config");
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");

describe("Share Flow", () => {
  let app;
  let db;
  let storageDir;
  let config;
  let testTrackId;
  let testVersionNum;
  const testUserId = "share_test_user";

  before(async () => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-share-test-"));
    config = {
      PREVIEW_ONLY: false,
      STREAM_BASE_URL: "http://stream.local",
      STORAGE_DIR: storageDir,
    };
    db = await initDb({
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildServer({ db, config });

    // Create test user (users table has: id, created_at, risk_level, locale, country)
    db.prepare(
      "INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, ?)"
    ).run(testUserId, new Date().toISOString(), "low");

    // Create test track
    const createTrackRes = await app.inject({
      method: "POST",
      url: "/tracks",
      headers: { "x-user-id": testUserId },
      payload: {
        title: "Share Test Song",
        recipient_name: "Recipient",
        message: "Test message for sharing",
        style: "pop",
        occasion: "birthday",
      },
    });

    const track = JSON.parse(createTrackRes.body);
    testTrackId = track.track_id; // Server returns track_id, not id

    // Create version
    const createVersionRes = await app.inject({
      method: "POST",
      url: `/tracks/${testTrackId}/versions`,
      headers: { "x-user-id": testUserId },
      payload: { style: "pop" },
    });

    const version = JSON.parse(createVersionRes.body);
    testVersionNum = version.version_num; // Server returns version_num

    // Share requires a rendered version (preview_url or full_url must exist)
    // Mock it by updating the database directly
    db.prepare(
      "UPDATE track_versions SET preview_url = ? WHERE track_id = ? AND version_num = ?"
    ).run("http://stream.local/test-preview.m3u8", testTrackId, testVersionNum);
  });

  after(async () => {
    if (storageDir && fs.existsSync(storageDir)) {
      fs.rmSync(storageDir, { recursive: true });
    }
  });

  describe("POST /tracks/:id/share", () => {
    it("creates share token for track version", async () => {
      // Create a fresh track/version for this test (existing may be reused)
      const createTrackRes = await app.inject({
        method: "POST",
        url: "/tracks",
        headers: { "x-user-id": testUserId },
        payload: {
          title: "Share Test Song 2",
          recipient_name: "Test Recipient",
          message: "Test message",
          style: "pop",
          occasion: "birthday",
        },
      });
      const track = JSON.parse(createTrackRes.body);
      const trackId = track.track_id;

      // Create version
      const createVersionRes = await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/versions`,
        headers: { "x-user-id": testUserId },
        payload: { style: "pop" },
      });
      const version = JSON.parse(createVersionRes.body);

      // Mock render completion
      db.prepare(
        "UPDATE track_versions SET preview_url = ? WHERE track_id = ? AND version_num = ?"
      ).run("http://stream.local/test.m3u8", trackId, version.version_num);

      const res = await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": testUserId },
        payload: {
          version_num: version.version_num,
          expires_in_days: 7,
          web_stream_allowed: true,
        },
      });

      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.ok(body.share_id, "Should have share_id");
      assert.ok(body.share_url, "Should have share_url");
      assert.ok(body.expires_at, "Should have expires_at");
      assert.ok(body.claim_pin, "Should have claim_pin");
      assert.strictEqual(body.claim_pin.length, 6, "PIN should be 6 digits");
    });

    it("rejects share for non-existent track", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/tracks/nonexistent-track/share",
        headers: { "x-user-id": testUserId },
        payload: { version_num: 1 },
      });

      assert.strictEqual(res.statusCode, 404);
    });
  });

  describe("GET /share/:shareId", () => {
    it("returns 404 for non-existent share", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/share/nonexistent_share_id",
      });

      assert.strictEqual(res.statusCode, 404);
    });
  });

  describe("POST /share/:shareId/claim - PIN verification", () => {
    // Helper to create a shareable track
    async function createShareableTrack() {
      const createTrackRes = await app.inject({
        method: "POST",
        url: "/tracks",
        headers: { "x-user-id": testUserId },
        payload: {
          title: "Claim Test Song " + Date.now(),
          recipient_name: "Test",
          message: "Test message",
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

      // Mock render completion
      db.prepare(
        "UPDATE track_versions SET preview_url = ? WHERE track_id = ? AND version_num = ?"
      ).run("http://stream.local/test.m3u8", track.track_id, version.version_num);

      return { trackId: track.track_id, versionNum: version.version_num };
    }

    it("rejects claim without required fields", async () => {
      const { trackId, versionNum } = await createShareableTrack();

      // Create share
      const createRes = await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": testUserId },
        payload: { version_num: versionNum },
      });
      const { share_id } = JSON.parse(createRes.body);

      // Claim without device_id
      const res = await app.inject({
        method: "POST",
        url: `/share/${share_id}/claim`,
        payload: {
          platform: "ios",
          pin: "123456",
        },
      });

      assert.strictEqual(res.statusCode, 400);
    });

    it("rejects claim with wrong PIN", async () => {
      const { trackId, versionNum } = await createShareableTrack();

      // Create share
      const createRes = await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": testUserId },
        payload: { version_num: versionNum },
      });
      const { share_id } = JSON.parse(createRes.body);

      // Claim with wrong PIN (6-digit)
      const res = await app.inject({
        method: "POST",
        url: `/share/${share_id}/claim`,
        payload: {
          device_id: "test-device-123",
          platform: "ios",
          pin: "000000", // Wrong PIN
        },
      });

      assert.strictEqual(res.statusCode, 401);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.error, "INVALID_PIN");
    });

    it("claims share with correct PIN", async () => {
      const { trackId, versionNum } = await createShareableTrack();

      // Create share
      const createRes = await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": testUserId },
        payload: { version_num: versionNum },
      });
      const { share_id, claim_pin } = JSON.parse(createRes.body);

      // Claim with correct PIN
      const res = await app.inject({
        method: "POST",
        url: `/share/${share_id}/claim`,
        payload: {
          device_id: "claim-test-device-" + Date.now(),
          platform: "ios",
          app_version: "1.0.0",
          pin: claim_pin,
        },
      });

      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.status, "claimed");
      assert.strictEqual(body.app_save_allowed, true);
    });
  });

  describe("Device binding enforcement", () => {
    // Helper to create a shareable track
    async function createShareableTrack() {
      const createTrackRes = await app.inject({
        method: "POST",
        url: "/tracks",
        headers: { "x-user-id": testUserId },
        payload: {
          title: "Binding Test Song " + Date.now(),
          recipient_name: "Test",
          message: "Test message",
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

      // Mock render completion
      db.prepare(
        "UPDATE track_versions SET preview_url = ? WHERE track_id = ? AND version_num = ?"
      ).run("http://stream.local/test.m3u8", track.track_id, version.version_num);

      return { trackId: track.track_id, versionNum: version.version_num };
    }

    it("allows same device to re-claim", async () => {
      const deviceId = "rebind-test-device-" + Date.now();
      const { trackId, versionNum } = await createShareableTrack();

      // Create share
      const createRes = await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": testUserId },
        payload: { version_num: versionNum },
      });
      const { share_id, claim_pin } = JSON.parse(createRes.body);

      // First claim
      await app.inject({
        method: "POST",
        url: `/share/${share_id}/claim`,
        payload: {
          device_id: deviceId,
          platform: "ios",
          pin: claim_pin,
        },
      });

      // Same device re-claims (should succeed or return already claimed)
      const res = await app.inject({
        method: "POST",
        url: `/share/${share_id}/claim`,
        payload: {
          device_id: deviceId,
          platform: "ios",
          pin: claim_pin,
        },
      });

      // Should succeed (either 200 or already claimed)
      assert.ok(res.statusCode === 200 || res.statusCode === 409);
    });

    it("rejects different device after binding", async () => {
      const { trackId, versionNum } = await createShareableTrack();

      // Create share
      const createRes = await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": testUserId },
        payload: { version_num: versionNum },
      });
      const { share_id, claim_pin } = JSON.parse(createRes.body);

      // First device claims
      await app.inject({
        method: "POST",
        url: `/share/${share_id}/claim`,
        payload: {
          device_id: "device-A-" + Date.now(),
          platform: "ios",
          pin: claim_pin,
        },
      });

      // Second device tries to claim
      const res = await app.inject({
        method: "POST",
        url: `/share/${share_id}/claim`,
        payload: {
          device_id: "device-B-" + Date.now(),
          platform: "android",
          pin: claim_pin,
        },
      });

      assert.strictEqual(res.statusCode, 409);
    });
  });

  describe("Stream authorization", () => {
    // Helper to create a shareable track
    async function createShareableTrack() {
      const createTrackRes = await app.inject({
        method: "POST",
        url: "/tracks",
        headers: { "x-user-id": testUserId },
        payload: {
          title: "Stream Test Song " + Date.now(),
          recipient_name: "Test",
          message: "Test message",
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

      // Mock render completion
      db.prepare(
        "UPDATE track_versions SET preview_url = ? WHERE track_id = ? AND version_num = ?"
      ).run("http://stream.local/test.m3u8", track.track_id, version.version_num);

      return { trackId: track.track_id, versionNum: version.version_num };
    }

    it("requires device headers for stream access", async () => {
      const { trackId, versionNum } = await createShareableTrack();

      // Create share
      const createRes = await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": testUserId },
        payload: { version_num: versionNum },
      });
      const { share_id } = JSON.parse(createRes.body);

      // Request stream without headers
      const res = await app.inject({
        method: "GET",
        url: `/share/${share_id}/stream`,
      });

      assert.strictEqual(res.statusCode, 400);
    });

    it("rejects stream for unclaimed share", async () => {
      const { trackId, versionNum } = await createShareableTrack();

      // Create share (not claimed)
      const createRes = await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": testUserId },
        payload: { version_num: versionNum },
      });
      const { share_id } = JSON.parse(createRes.body);

      // Request stream without claiming
      const res = await app.inject({
        method: "GET",
        url: `/share/${share_id}/stream`,
        headers: {
          "x-device-id": "some-device",
          "x-platform": "ios",
        },
      });

      assert.strictEqual(res.statusCode, 403);
    });

    it("rejects stream from wrong device", async () => {
      const boundDeviceId = "bound-device-" + Date.now();
      const { trackId, versionNum } = await createShareableTrack();

      // Create and claim share
      const createRes = await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": testUserId },
        payload: { version_num: versionNum },
      });
      const { share_id, claim_pin } = JSON.parse(createRes.body);

      await app.inject({
        method: "POST",
        url: `/share/${share_id}/claim`,
        payload: {
          device_id: boundDeviceId,
          platform: "ios",
          pin: claim_pin,
        },
      });

      // Wrong device requests stream
      const res = await app.inject({
        method: "GET",
        url: `/share/${share_id}/stream`,
        headers: {
          "x-device-id": "wrong-device",
          "x-platform": "ios",
        },
      });

      assert.strictEqual(res.statusCode, 403);
    });

    it("returns stream URL for bound device", async () => {
      const deviceId = "stream-device-" + Date.now();
      const { trackId, versionNum } = await createShareableTrack();

      // Create and claim share
      const createRes = await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": testUserId },
        payload: { version_num: versionNum },
      });
      const { share_id, claim_pin } = JSON.parse(createRes.body);

      await app.inject({
        method: "POST",
        url: `/share/${share_id}/claim`,
        payload: {
          device_id: deviceId,
          platform: "ios",
          pin: claim_pin,
        },
      });

      // Bound device requests stream
      const res = await app.inject({
        method: "GET",
        url: `/share/${share_id}/stream`,
        headers: {
          "x-device-id": deviceId,
          "x-platform": "ios",
        },
      });

      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.ok(body.stream_url, "Should have stream_url");
      // Note: key_url is optional based on server implementation
      assert.ok(body.expires_at, "Should have expires_at");
    });
  });
});
