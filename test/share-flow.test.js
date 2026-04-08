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
  const originalNodeEnv = process.env.NODE_ENV;

  before(async () => {
    process.env.NODE_ENV = "test";
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-share-test-"));
    config = {
      PREVIEW_ONLY: false,
      STREAM_BASE_URL: "http://stream.local",
      STORAGE_DIR: storageDir,
      STORAGE_PROVIDER: "local",
      UPLOAD_SIGNING_SECRET: "test-upload-secret",
      UPLOAD_URL_TTL_SEC: 900,
      ALLOW_DEVICE_TOKEN_FALLBACK: true,
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
    process.env.NODE_ENV = originalNodeEnv;
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
        res.body.toLowerCase().includes("someone made you a song"),
        "Should contain player title"
      );
    });

    it("keeps mobile share links on the web player instead of auto-redirecting to the app", async () => {
      const { trackId, versionNum } = await createShareableTrack();

      const createRes = await app.inject({
        method: "POST",
        url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": testUserId },
        payload: { version_num: versionNum },
      });
      const { share_id } = JSON.parse(createRes.body);

      const res = await app.inject({
        method: "GET",
        url: `/play/${share_id}`,
        headers: {
          "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        },
      });

      assert.strictEqual(res.statusCode, 200);
      assert.ok(
        (res.headers["content-type"] || "").includes("text/html"),
        "Mobile share links should stay on the web player"
      );
      assert.strictEqual(res.headers.location, undefined);
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
    const statsTestUserId = `share_stats_user_${Date.now()}`;

    // Helper function to create a shareable track
    async function createShareableTrack() {
      db.prepare(
        "INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, ?)"
      ).run(statsTestUserId, new Date().toISOString(), "low");

      const createTrackRes = await app.inject({
        method: "POST",
        url: "/tracks",
        headers: { "x-user-id": statsTestUserId },
        payload: {
          title: "Stats Test Song " + Date.now(),
          recipient_name: "Test",
          message: "Test message",
          style: "pop",
          occasion: "birthday",
        },
      });
      assert.strictEqual(createTrackRes.statusCode, 201, createTrackRes.body);
      const track = JSON.parse(createTrackRes.body);

      const createVersionRes = await app.inject({
        method: "POST",
        url: `/tracks/${track.track_id}/versions`,
        headers: { "x-user-id": statsTestUserId },
        payload: { style: "pop" },
      });
      assert.strictEqual(createVersionRes.statusCode, 201, createVersionRes.body);
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
        headers: { "x-user-id": statsTestUserId },
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
        headers: { "x-user-id": statsTestUserId },
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
        headers: { "x-user-id": statsTestUserId },
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
        headers: { "x-user-id": statsTestUserId },
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
        headers: { "x-user-id": statsTestUserId },
        payload: { version_num: versionNum },
      });

      // Get stats without claiming
      const statsRes = await app.inject({
        method: "GET",
        url: `/tracks/${trackId}/share/stats`,
        headers: { "x-user-id": statsTestUserId },
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
        headers: { "x-user-id": statsTestUserId },
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
        headers: { "x-user-id": statsTestUserId },
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

  // ================================================================
  // Share Link Hardening Validations
  // ================================================================

  describe("Lifetime share hardening", () => {
    const hardenUserId = "harden_test_user";

    async function createShareableTrackAndShare() {
      db.prepare("INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, ?)")
        .run(hardenUserId, new Date().toISOString(), "low");

      const trackRes = await app.inject({
        method: "POST", url: "/tracks",
        headers: { "x-user-id": hardenUserId },
        payload: { title: "Harden Song " + Date.now(), recipient_name: "Tester", message: "Test", style: "pop", occasion: "birthday" },
      });
      const trackId = JSON.parse(trackRes.body).track_id;

      const verRes = await app.inject({
        method: "POST", url: `/tracks/${trackId}/versions`,
        headers: { "x-user-id": hardenUserId },
        payload: { style: "pop" },
      });
      const versionNum = JSON.parse(verRes.body).version_num;

      db.prepare("UPDATE track_versions SET preview_url = ? WHERE track_id = ? AND version_num = ?")
        .run("http://stream.local/test.m3u8", trackId, versionNum);

      const shareRes = await app.inject({
        method: "POST", url: `/tracks/${trackId}/share`,
        headers: { "x-user-id": hardenUserId },
        payload: { version_num: versionNum },
      });
      assert.strictEqual(shareRes.statusCode, 200);
      const share = JSON.parse(shareRes.body);
      return { trackId, versionNum, ...share };
    }

    // Validation 1: Song share is lifetime with correct fields
    it("V1: song share is created as lifetime with correct fields", async () => {
      const { share_id } = await createShareableTrackAndShare();
      const row = db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(share_id);
      assert.strictEqual(row.share_type, "lifetime", "share_type must be lifetime");
      assert.strictEqual(row.expires_at, "9999-12-31T23:59:59.000Z", "expires_at must be far-future");
      assert.strictEqual(row.status, "unbound");
      assert.ok(row.claim_pin, "must have a claim PIN");
      assert.strictEqual(row.claim_pin.length, 6, "PIN must be 6 digits");
    });

    // Validation 2: Song app claim requires PIN
    it("V2: song claim without PIN is rejected", async () => {
      const { share_id } = await createShareableTrackAndShare();
      const res = await app.inject({
        method: "POST", url: `/share/${share_id}/claim`,
        headers: { "x-device-id": "test-device-v2", "x-platform": "ios" },
        payload: {},
      });
      // 401 = authentication required (PIN is the credential)
      assert.strictEqual(res.statusCode, 401);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.error, "INVALID_PIN");
    });

    it("V2: song claim with correct PIN succeeds", async () => {
      const { share_id, claim_pin } = await createShareableTrackAndShare();
      const res = await app.inject({
        method: "POST", url: `/share/${share_id}/claim`,
        headers: { "x-device-id": "test-device-v2b", "x-platform": "ios" },
        payload: { pin: claim_pin },
      });
      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.status, "claimed");
    });

    // Validation 3: Song web playback does NOT require PIN
    it("V3: song web playback serves audio without PIN", async () => {
      const { share_id } = await createShareableTrackAndShare();
      // GET /share/:shareId should return web_stream_url for unbound shares
      const infoRes = await app.inject({
        method: "GET", url: `/share/${share_id}`,
      });
      assert.strictEqual(infoRes.statusCode, 200);
      const info = JSON.parse(infoRes.body);
      assert.strictEqual(info.status, "unbound");
      assert.ok(info.web_stream_url, "web_stream_url must be populated for unbound share");
      assert.ok(info.web_stream_url.includes("/audio"), "stream URL must point to audio endpoint");
    });

    // Regression: Lifetime auto-heal recovers corrupted shares
    it("auto-heals lifetime share incorrectly marked expired", async () => {
      const { share_id } = await createShareableTrackAndShare();
      // Corrupt: simulate the old bug writing status='expired'
      db.prepare("UPDATE share_tokens SET status = ? WHERE id = ?").run("expired", share_id);

      const res = await app.inject({
        method: "GET", url: `/share/${share_id}`,
      });
      assert.strictEqual(res.statusCode, 200, "auto-heal should recover the share");
      // Verify DB was healed
      const row = db.prepare("SELECT status FROM share_tokens WHERE id = ?").get(share_id);
      assert.strictEqual(row.status, "unbound", "status should be healed back to unbound");
    });

    it("does NOT auto-heal genuinely expired normal shares", async () => {
      const { share_id } = await createShareableTrackAndShare();
      // Set to normal with past expiry — genuinely expired
      db.prepare("UPDATE share_tokens SET share_type = ?, expires_at = ?, status = ? WHERE id = ?")
        .run("normal", "2020-01-01T00:00:00.000Z", "expired", share_id);

      const res = await app.inject({
        method: "GET", url: `/share/${share_id}`,
      });
      assert.strictEqual(res.statusCode, 410, "genuinely expired share must stay expired");
    });
  });

  describe("Poem share hardening", () => {
    const poemUserId = "11111111-1111-4111-8111-111111111111";

    async function createPoemAndShare() {
      db.prepare("INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, ?)")
        .run(poemUserId, new Date().toISOString(), "low");

      // Create poem directly in DB (poem creation route may require story context)
      const poemId = "poem_" + Date.now();
      const verses = JSON.stringify(["Roses are red", "Violets are blue", "This is a test", "Just for you"]);
      db.prepare(
        "INSERT INTO poems (id, user_id, title, recipient_name, occasion, verses, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(poemId, poemUserId, "Test Poem", "PoemRecipient", "birthday", verses, "completed", new Date().toISOString(), new Date().toISOString());

      const shareRes = await app.inject({
        method: "POST", url: `/poems/${poemId}/share`,
        headers: { "x-user-id": poemUserId },
        payload: {},
      });
      assert.strictEqual(shareRes.statusCode, 200);
      const share = JSON.parse(shareRes.body);
      return { poemId, ...share };
    }

    // Validation 4: Poem app claim requires PIN
    it("V4: poem claim without PIN is rejected", async () => {
      const { share_id } = await createPoemAndShare();
      const res = await app.inject({
        method: "POST", url: `/poem-share/${share_id}/claim`,
        headers: { "x-user-id": poemUserId },
        payload: {},
      });
      assert.strictEqual(res.statusCode, 401, "Poem claim without PIN must return 401");
    });

    it("V4: poem claim with correct PIN succeeds", async () => {
      const { share_id, claim_pin } = await createPoemAndShare();
      const res = await app.inject({
        method: "POST", url: `/poem-share/${share_id}/claim`,
        headers: { "x-user-id": poemUserId },
        payload: { pin: claim_pin },
      });
      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.status, "claimed");
    });

    // Validation 5: Poem social display does NOT require PIN
    it("V5: poem share info returns preview without PIN", async () => {
      const { share_id } = await createPoemAndShare();
      const res = await app.inject({
        method: "GET", url: `/poem-share/${share_id}`,
      });
      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.ok(body.poem, "must return poem data");
      assert.ok(body.poem.preview_lines, "must return preview_lines");
      assert.ok(body.poem.preview_lines.length > 0, "preview must have content");
      // PIN is required for claiming, but content is visible
      assert.strictEqual(body.requires_pin, true, "requires_pin should be true (gating claim, not display)");
    });

    // Poem lifetime: shares created via service should be lifetime
    it("poem share is created as lifetime with correct fields", async () => {
      const { share_id } = await createPoemAndShare();
      const row = db.prepare("SELECT * FROM poem_share_tokens WHERE id = ?").get(share_id);
      assert.strictEqual(row.share_type, "lifetime", "share_type must be lifetime");
      assert.strictEqual(row.expires_at, "9999-12-31T23:59:59.000Z", "expires_at must be far-future");
      assert.ok(row.claim_pin, "must have claim PIN");
    });
  });

  describe("Gift share hardening", () => {
    const giftUserId = "gift_share_test_user";

    // Validation 6: Gift shares follow same claim/playback rules
    it("V6: gift song share (app_only) blocks web stream and requires PIN to claim", async () => {
      db.prepare("INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, ?)")
        .run(giftUserId, new Date().toISOString(), "low");

      // Create track + version
      const trackRes = await app.inject({
        method: "POST", url: "/tracks",
        headers: { "x-user-id": giftUserId },
        payload: { title: "Gift Song " + Date.now(), recipient_name: "GiftRecipient", message: "Happy Birthday", style: "pop", occasion: "birthday" },
      });
      const trackId = JSON.parse(trackRes.body).track_id;
      const verRes = await app.inject({
        method: "POST", url: `/tracks/${trackId}/versions`,
        headers: { "x-user-id": giftUserId },
        payload: { style: "pop" },
      });
      const versionNum = JSON.parse(verRes.body).version_num;
      const versionId = db.prepare("SELECT id FROM track_versions WHERE track_id = ? AND version_num = ?").get(trackId, versionNum).id;
      db.prepare("UPDATE track_versions SET preview_url = ? WHERE track_id = ? AND version_num = ?")
        .run("http://stream.local/gift-preview.m3u8", trackId, versionNum);

      // Simulate gift share by inserting directly (ensureTrackGiftShareToken is in server.js closure)
      const shareId = "gift_" + Date.now();
      const pin = "123456";
      db.prepare(
        `INSERT INTO share_tokens (id, track_id, track_version_id, creator_id, status, share_type, claim_policy,
         web_stream_allowed, app_save_allowed, expires_at, created_at, access_count, claim_pin, claim_attempts,
         stream_key_id, stream_key, delivery_source)
         VALUES (?, ?, ?, ?, 'unbound', 'normal', 'app_only', 0, 1, ?, ?, 0, ?, 0, ?, ?, 'gift')`
      ).run(
        shareId, trackId, versionId, giftUserId,
        new Date(Date.now() + 30 * 86400000).toISOString(),
        new Date().toISOString(),
        pin,
        require("crypto").randomUUID(),
        require("crypto").randomBytes(16).toString("base64")
      );
      db.prepare("UPDATE tracks SET share_token_id = ? WHERE id = ?").run(shareId, trackId);

      // GET /share/:shareId — app_only gift should have no web_stream_url
      const infoRes = await app.inject({ method: "GET", url: `/share/${shareId}` });
      assert.strictEqual(infoRes.statusCode, 200);
      const info = JSON.parse(infoRes.body);
      assert.strictEqual(info.app_required, true, "app_only gift must require app");
      assert.strictEqual(info.web_stream_url, null, "app_only gift must not have web stream URL");

      // Claim without PIN should fail (401 = auth required, PIN is the credential)
      const claimNoPin = await app.inject({
        method: "POST", url: `/share/${shareId}/claim`,
        headers: { "x-device-id": "gift-device", "x-platform": "ios" },
        payload: {},
      });
      assert.strictEqual(claimNoPin.statusCode, 401, "claim without PIN must fail");

      // Claim with PIN should succeed
      const claimWithPin = await app.inject({
        method: "POST", url: `/share/${shareId}/claim`,
        headers: { "x-device-id": "gift-device", "x-platform": "ios" },
        payload: { pin },
      });
      assert.strictEqual(claimWithPin.statusCode, 200, "claim with correct PIN must succeed");
      assert.strictEqual(JSON.parse(claimWithPin.body).status, "claimed");
    });

    it("V6: gift song share (default policy) allows web preview playback", async () => {
      db.prepare("INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, ?)")
        .run(giftUserId, new Date().toISOString(), "low");

      const trackRes = await app.inject({
        method: "POST", url: "/tracks",
        headers: { "x-user-id": giftUserId },
        payload: { title: "Gift Default " + Date.now(), recipient_name: "Recipient", message: "Hi", style: "pop", occasion: "birthday" },
      });
      const trackId = JSON.parse(trackRes.body).track_id;
      const verRes = await app.inject({
        method: "POST", url: `/tracks/${trackId}/versions`,
        headers: { "x-user-id": giftUserId },
        payload: { style: "pop" },
      });
      const versionNum = JSON.parse(verRes.body).version_num;
      const versionId = db.prepare("SELECT id FROM track_versions WHERE track_id = ? AND version_num = ?").get(trackId, versionNum).id;
      db.prepare("UPDATE track_versions SET preview_url = ? WHERE track_id = ? AND version_num = ?")
        .run("http://stream.local/gift-default.m3u8", trackId, versionNum);

      // Gift share with default policy (web streaming allowed)
      const shareId = "giftdef_" + Date.now();
      db.prepare(
        `INSERT INTO share_tokens (id, track_id, track_version_id, creator_id, status, share_type, claim_policy,
         web_stream_allowed, app_save_allowed, expires_at, created_at, access_count, claim_pin, claim_attempts,
         stream_key_id, stream_key, delivery_source)
         VALUES (?, ?, ?, ?, 'unbound', 'normal', 'default', 1, 1, ?, ?, 0, ?, 0, ?, ?, 'gift')`
      ).run(
        shareId, trackId, versionId, giftUserId,
        new Date(Date.now() + 30 * 86400000).toISOString(),
        new Date().toISOString(),
        "654321",
        require("crypto").randomUUID(),
        require("crypto").randomBytes(16).toString("base64")
      );
      db.prepare("UPDATE tracks SET share_token_id = ? WHERE id = ?").run(shareId, trackId);

      const infoRes = await app.inject({ method: "GET", url: `/share/${shareId}` });
      assert.strictEqual(infoRes.statusCode, 200);
      const info = JSON.parse(infoRes.body);
      assert.ok(info.web_stream_url, "default-policy gift must have web_stream_url");
      assert.strictEqual(info.app_required, false, "default-policy gift should not require app");
    });
  });
});
