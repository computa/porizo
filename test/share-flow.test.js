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
const { createStorageProvider } = require("../src/storage");

describe("Share Flow", () => {
  let app;
  let db;
  let storageDir;
  let config;
  let storage;
  let testTrackId;
  let testVersionNum;
  const testUserId = "share_test_user";

  before(async () => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-share-test-"));
    config = {
      PREVIEW_ONLY: false,
      STREAM_BASE_URL: "http://stream.local",
      STORAGE_DIR: storageDir,
      STORAGE_PROVIDER: "local",
      UPLOAD_SIGNING_SECRET: "test-upload-secret",
      UPLOAD_URL_TTL_SEC: 900,
    };
    db = await initDb({
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    storage = createStorageProvider(config);
    app = buildServer({ db, config, storage });

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
      // Share URL must use /play/ route (not /s/ which doesn't exist)
      assert.ok(
        body.share_url.includes(`/play/${body.share_id}`),
        `share_url should use /play/ route, got: ${body.share_url}`
      );
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
    // Helper to create a shareable track
    async function createShareableTrackForGet() {
      const createTrackRes = await app.inject({
        method: "POST",
        url: "/tracks",
        headers: { "x-user-id": testUserId },
        payload: {
          title: "Get Share Test " + Date.now(),
          recipient_name: "TestRecipient",
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

    it("returns 404 for non-existent share", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/share/nonexistent_share_id",
      });

      assert.strictEqual(res.statusCode, 404);
    });

    it("returns track and can_access fields for web player compatibility", async () => {
      const { trackId, versionNum } = await createShareableTrackForGet();

      // Create share
      const createRes = await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": testUserId },
        payload: { version_num: versionNum },
      });
      const { share_id } = JSON.parse(createRes.body);

      // Get share info
      const res = await app.inject({
        method: "GET",
        url: `/share/${share_id}`,
      });

      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.body);

      // Web player expects these fields
      assert.ok(body.track, "Should have track field (alias for track_preview)");
      assert.ok(body.track.title, "track.title should exist");
      assert.ok(body.track.recipient_name, "track.recipient_name should exist");
      assert.strictEqual(typeof body.can_access, "boolean", "should have can_access boolean field");
    });

    it("includes recipient_name in track info", async () => {
      const { trackId, versionNum } = await createShareableTrackForGet();

      // Create share
      const createRes = await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": testUserId },
        payload: { version_num: versionNum },
      });
      const { share_id } = JSON.parse(createRes.body);

      // Get share info
      const res = await app.inject({
        method: "GET",
        url: `/share/${share_id}`,
      });

      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.body);

      // Should include recipient_name (starts with "TestRecipient")
      assert.ok(
        body.track.recipient_name.startsWith("TestRecipient"),
        `recipient_name should be included, got: ${body.track.recipient_name}`
      );
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

    it("allows header-less streaming for unclaimed web share with web_stream_allowed", async () => {
      const { trackId, versionNum } = await createShareableTrack();

      // Create share with web_stream_allowed (default is true)
      const createRes = await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": testUserId },
        payload: { version_num: versionNum },
      });
      const { share_id } = JSON.parse(createRes.body);

      // Request stream WITHOUT headers - should work for unclaimed web shares
      const res = await app.inject({
        method: "GET",
        url: `/share/${share_id}/stream`,
      });

      // Should succeed - returns direct audio URL for browser playback
      assert.strictEqual(res.statusCode, 200, "Should allow streaming for unclaimed share");
      const body = JSON.parse(res.body);
      assert.ok(body.stream_url, "Should return stream_url");
      // Should be direct audio format, not HLS (for browser compatibility)
      assert.strictEqual(body.format, "audio", "Should return audio format for unclaimed web shares");
    });

    it("requires device headers for CLAIMED shares", async () => {
      const deviceId = "claimed-stream-device-" + Date.now();
      const { trackId, versionNum } = await createShareableTrack();

      // Create and claim share
      const createRes = await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": testUserId },
        payload: { version_num: versionNum },
      });
      const { share_id, claim_pin } = JSON.parse(createRes.body);

      // Claim it
      await app.inject({
        method: "POST",
        url: `/share/${share_id}/claim`,
        payload: {
          device_id: deviceId,
          platform: "ios",
          pin: claim_pin,
        },
      });

      // Request stream WITHOUT headers - should fail for claimed shares
      const res = await app.inject({
        method: "GET",
        url: `/share/${share_id}/stream`,
      });

      assert.strictEqual(res.statusCode, 400, "Should require headers for claimed shares");
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

  describe("GET /play/:shareId (Web Player)", () => {
    // Helper function to create a shareable track
    async function createShareableTrack() {
      const createTrackRes = await app.inject({
        method: "POST",
        url: "/tracks",
        headers: { "x-user-id": testUserId },
        payload: {
          title: "Web Player Test Song " + Date.now(),
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

    it("returns HTML page for valid share", async () => {
      const { trackId, versionNum } = await createShareableTrack();

      // Create share
      const createRes = await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": testUserId },
        payload: { version_num: versionNum },
      });
      const { share_id } = JSON.parse(createRes.body);

      // Request web player
      const res = await app.inject({
        method: "GET",
        url: `/play/${share_id}`,
      });

      assert.strictEqual(res.statusCode, 200);
      assert.ok(
        res.headers["content-type"].includes("text/html"),
        "Should return HTML"
      );
      assert.ok(res.body.includes("<!DOCTYPE html>"), "Should be HTML document");
      assert.ok(
        res.body.includes("Someone Made You a Song"),
        "Should contain player title"
      );
    });

    it("returns 404 for non-existent share", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/play/non-existent-share-id",
      });

      assert.strictEqual(res.statusCode, 404);
      assert.ok(
        res.headers["content-type"].includes("text/html"),
        "Should return HTML"
      );
      assert.ok(
        res.body.includes("Not Found"),
        "Should indicate not found"
      );
    });

    it("logs access when web player is opened", async () => {
      const { trackId, versionNum } = await createShareableTrack();

      // Create share
      const createRes = await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": testUserId },
        payload: { version_num: versionNum },
      });
      const { share_id } = JSON.parse(createRes.body);

      // Request web player
      await app.inject({
        method: "GET",
        url: `/play/${share_id}`,
        headers: { "user-agent": "Test Browser/1.0" },
      });

      // Check that access was logged
      const logs = db
        .prepare(
          "SELECT * FROM share_access_log WHERE share_token_id = ? AND event_type = ?"
        )
        .all(share_id, "web_player_opened");

      assert.ok(logs.length > 0, "Should have logged web player access");
      const log = logs[logs.length - 1];
      const metadata = JSON.parse(log.metadata || "{}");
      assert.strictEqual(
        metadata.user_agent,
        "Test Browser/1.0",
        "Should log user agent"
      );
    });
  });

  describe("GET /tracks/:id/share/stats", () => {
    // Helper function to create a shareable track
    async function createShareableTrack() {
      const createTrackRes = await app.inject({
        method: "POST",
        url: "/tracks",
        headers: { "x-user-id": testUserId },
        payload: {
          title: "Stats Test Song " + Date.now(),
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

    it("returns share statistics for track owner", async () => {
      const { trackId, versionNum } = await createShareableTrack();

      // Create share
      const createRes = await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": testUserId },
        payload: { version_num: versionNum },
      });
      const { share_id, claim_pin } = JSON.parse(createRes.body);

      // Generate some activity - open the share info endpoint
      await app.inject({
        method: "GET",
        url: `/share/${share_id}`,
      });

      // Claim the share
      await app.inject({
        method: "POST",
        url: `/share/${share_id}/claim`,
        payload: {
          device_id: "stats-test-device",
          platform: "ios",
          pin: claim_pin,
        },
      });

      // Get stats
      const statsRes = await app.inject({
        method: "GET",
        url: `/tracks/${trackId}/share/stats`,
        headers: { "x-user-id": testUserId },
      });

      assert.strictEqual(statsRes.statusCode, 200);
      const stats = JSON.parse(statsRes.body);

      assert.strictEqual(stats.share_id, share_id);
      assert.strictEqual(stats.status, "claimed");
      assert.ok(stats.created_at);
      assert.ok(stats.expires_at);
      assert.strictEqual(stats.is_expired, false);

      // Check flattened access stats
      assert.ok(stats.total_events >= 2); // At least link_opened and claim_success
      assert.ok(stats.event_counts);

      // Check flattened claim info
      assert.strictEqual(stats.is_claimed, true);
      assert.ok(stats.bound_device);
      assert.ok(stats.bound_device.bound_at);
      assert.strictEqual(stats.bound_device.platform, "ios");

      // Check recent activity
      assert.ok(Array.isArray(stats.recent_activity));
      assert.ok(stats.recent_activity.length > 0);
    });

    it("returns flat iOS-compatible structure (no nested access_stats/claim_info)", async () => {
      const { trackId, versionNum } = await createShareableTrack();

      // Create share
      const createRes = await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": testUserId },
        payload: { version_num: versionNum },
      });
      const { share_id, claim_pin } = JSON.parse(createRes.body);

      // Claim the share
      await app.inject({
        method: "POST",
        url: `/share/${share_id}/claim`,
        payload: {
          device_id: "ios-compat-test-device",
          platform: "ios",
          pin: claim_pin,
        },
      });

      // Get stats
      const statsRes = await app.inject({
        method: "GET",
        url: `/tracks/${trackId}/share/stats`,
        headers: { "x-user-id": testUserId },
      });

      assert.strictEqual(statsRes.statusCode, 200);
      const stats = JSON.parse(statsRes.body);

      // iOS expects these fields at ROOT level (not nested)
      assert.strictEqual(typeof stats.total_events, "number", "total_events must be at root");
      assert.ok("event_counts" in stats, "event_counts must be at root");
      assert.strictEqual(typeof stats.is_claimed, "boolean", "is_claimed must be at root");
      assert.ok("bound_device" in stats, "bound_device must be at root (can be null)");

      // These MUST NOT exist (old nested structure breaks iOS decoding)
      assert.strictEqual(stats.access_stats, undefined, "access_stats should NOT exist");
      assert.strictEqual(stats.claim_info, undefined, "claim_info should NOT exist");

      // Verify bound_device has correct shape when claimed
      assert.ok(stats.bound_device, "bound_device should exist when claimed");
      assert.strictEqual(stats.bound_device.platform, "ios");
      assert.ok(stats.bound_device.bound_at);
    });

    it("returns is_claimed=false and bound_device=null for unclaimed share", async () => {
      const { trackId, versionNum } = await createShareableTrack();

      // Create share but don't claim it
      await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": testUserId },
        payload: { version_num: versionNum },
      });

      // Get stats without claiming
      const statsRes = await app.inject({
        method: "GET",
        url: `/tracks/${trackId}/share/stats`,
        headers: { "x-user-id": testUserId },
      });

      assert.strictEqual(statsRes.statusCode, 200);
      const stats = JSON.parse(statsRes.body);

      // Verify unclaimed state
      assert.strictEqual(stats.is_claimed, false, "is_claimed should be false");
      assert.strictEqual(stats.bound_device, null, "bound_device should be null");
      assert.ok(stats.total_events >= 0, "total_events should exist");
    });

    it("returns 404 when no share exists", async () => {
      const { trackId } = await createShareableTrack();

      const res = await app.inject({
        method: "GET",
        url: `/tracks/${trackId}/share/stats`,
        headers: { "x-user-id": testUserId },
      });

      assert.strictEqual(res.statusCode, 404);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.error, "SHARE_NOT_FOUND");
    });

    it("returns 404 for non-owner", async () => {
      const { trackId, versionNum } = await createShareableTrack();

      // Create share
      await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": testUserId },
        payload: { version_num: versionNum },
      });

      // Try to get stats as different user
      const res = await app.inject({
        method: "GET",
        url: `/tracks/${trackId}/share/stats`,
        headers: { "x-user-id": "other-user" },
      });

      assert.strictEqual(res.statusCode, 404); // Track not found for other user
    });
  });

  describe("GET /tracks/:id/share/qr", () => {
    // Use a separate user to avoid rate limits from other tests
    const qrTestUserId = "qr_test_user_" + Date.now();

    // Helper function to create a shareable track
    async function createShareableTrack() {
      // Ensure user exists
      db.prepare(
        "INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, ?)"
      ).run(qrTestUserId, new Date().toISOString(), "low");

      const createTrackRes = await app.inject({
        method: "POST",
        url: "/tracks",
        headers: { "x-user-id": qrTestUserId },
        payload: {
          title: "QR Test Song " + Date.now(),
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
        headers: { "x-user-id": qrTestUserId },
        payload: { style: "pop" },
      });
      const version = JSON.parse(createVersionRes.body);

      // Mock render completion
      db.prepare(
        "UPDATE track_versions SET preview_url = ? WHERE track_id = ? AND version_num = ?"
      ).run("http://stream.local/test.m3u8", track.track_id, version.version_num);

      return { trackId: track.track_id, versionNum: version.version_num };
    }

    it("returns PNG QR code by default", async () => {
      const { trackId, versionNum } = await createShareableTrack();

      // Create share
      await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": qrTestUserId },
        payload: { version_num: versionNum },
      });

      // Get QR code
      const res = await app.inject({
        method: "GET",
        url: `/tracks/${trackId}/share/qr`,
        headers: { "x-user-id": qrTestUserId },
      });

      assert.strictEqual(res.statusCode, 200);
      assert.ok(
        res.headers["content-type"].includes("image/png"),
        "Should return PNG image"
      );
      // PNG files start with specific magic bytes
      assert.ok(
        res.rawPayload[0] === 0x89 && res.rawPayload[1] === 0x50,
        "Should be valid PNG data"
      );
    });

    it("returns SVG when format=svg", async () => {
      const { trackId, versionNum } = await createShareableTrack();

      // Create share
      await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": qrTestUserId },
        payload: { version_num: versionNum },
      });

      // Get QR code as SVG
      const res = await app.inject({
        method: "GET",
        url: `/tracks/${trackId}/share/qr?format=svg`,
        headers: { "x-user-id": qrTestUserId },
      });

      assert.strictEqual(res.statusCode, 200);
      assert.ok(
        res.headers["content-type"].includes("image/svg+xml"),
        "Should return SVG image"
      );
      assert.ok(res.body.includes("<svg"), "Should contain SVG element");
    });

    it("respects custom size parameter", async () => {
      const { trackId, versionNum } = await createShareableTrack();

      // Create share
      await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": qrTestUserId },
        payload: { version_num: versionNum },
      });

      // Get QR code with custom size as SVG (easier to verify size in SVG)
      const res = await app.inject({
        method: "GET",
        url: `/tracks/${trackId}/share/qr?format=svg&size=500`,
        headers: { "x-user-id": qrTestUserId },
      });

      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.body.includes('width="500"'), "Should use custom width");
    });

    it("returns 404 when no share exists", async () => {
      const { trackId } = await createShareableTrack();

      const res = await app.inject({
        method: "GET",
        url: `/tracks/${trackId}/share/qr`,
        headers: { "x-user-id": qrTestUserId },
      });

      assert.strictEqual(res.statusCode, 404);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.error, "SHARE_NOT_FOUND");
    });

    it("returns 410 when share is revoked", async () => {
      const { trackId, versionNum } = await createShareableTrack();

      // Create share
      const createRes = await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": qrTestUserId },
        payload: { version_num: versionNum },
      });
      const { share_id } = JSON.parse(createRes.body);

      // Revoke the share
      await app.inject({
        method: "DELETE",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": qrTestUserId },
      });

      // Try to get QR code
      const res = await app.inject({
        method: "GET",
        url: `/tracks/${trackId}/share/qr`,
        headers: { "x-user-id": qrTestUserId },
      });

      assert.strictEqual(res.statusCode, 410);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.error, "SHARE_REVOKED");
    });
  });

  describe("GET /tracks/:id/share/qr-data", () => {
    // Use a separate user to avoid rate limits from other tests
    const qrDataTestUserId = "qr_data_test_user_" + Date.now();

    // Helper function to create a shareable track
    async function createShareableTrack() {
      // Ensure user exists
      db.prepare(
        "INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, ?)"
      ).run(qrDataTestUserId, new Date().toISOString(), "low");

      const createTrackRes = await app.inject({
        method: "POST",
        url: "/tracks",
        headers: { "x-user-id": qrDataTestUserId },
        payload: {
          title: "QR Data Test Song " + Date.now(),
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
        headers: { "x-user-id": qrDataTestUserId },
        payload: { style: "pop" },
      });
      const version = JSON.parse(createVersionRes.body);

      // Mock render completion
      db.prepare(
        "UPDATE track_versions SET preview_url = ? WHERE track_id = ? AND version_num = ?"
      ).run("http://stream.local/test.m3u8", track.track_id, version.version_num);

      return { trackId: track.track_id, versionNum: version.version_num };
    }

    it("returns JSON with data URL", async () => {
      const { trackId, versionNum } = await createShareableTrack();

      // Create share
      const createRes = await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": qrDataTestUserId },
        payload: { version_num: versionNum },
      });
      const { share_id } = JSON.parse(createRes.body);

      // Get QR data
      const res = await app.inject({
        method: "GET",
        url: `/tracks/${trackId}/share/qr-data`,
        headers: { "x-user-id": qrDataTestUserId },
      });

      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.body);

      assert.ok(data.share_url, "Should include share URL");
      assert.ok(data.share_url.includes(`/play/${share_id}`), "Share URL should point to web player");
      assert.ok(data.qr_data_url, "Should include QR data URL");
      assert.ok(
        data.qr_data_url.startsWith("data:image/png;base64,"),
        "Data URL should be base64 PNG"
      );
      assert.strictEqual(data.size, 300, "Should use default size");
    });

    it("respects custom size parameter", async () => {
      const { trackId, versionNum } = await createShareableTrack();

      // Create share
      await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": qrDataTestUserId },
        payload: { version_num: versionNum },
      });

      // Get QR data with custom size
      const res = await app.inject({
        method: "GET",
        url: `/tracks/${trackId}/share/qr-data?size=500`,
        headers: { "x-user-id": qrDataTestUserId },
      });

      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.strictEqual(data.size, 500, "Should use custom size");
    });

    it("clamps size to valid range", async () => {
      const { trackId, versionNum } = await createShareableTrack();

      // Create share
      await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": qrDataTestUserId },
        payload: { version_num: versionNum },
      });

      // Get QR data with too large size
      const res = await app.inject({
        method: "GET",
        url: `/tracks/${trackId}/share/qr-data?size=5000`,
        headers: { "x-user-id": qrDataTestUserId },
      });

      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.strictEqual(data.size, 1000, "Should clamp to max size");
    });

    it("returns 404 when no share exists", async () => {
      const { trackId } = await createShareableTrack();

      const res = await app.inject({
        method: "GET",
        url: `/tracks/${trackId}/share/qr-data`,
        headers: { "x-user-id": qrDataTestUserId },
      });

      assert.strictEqual(res.statusCode, 404);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.error, "SHARE_NOT_FOUND");
    });
  });
});
