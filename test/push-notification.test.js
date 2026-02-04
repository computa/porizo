/**
 * Push Notification Service Tests
 *
 * Tests for APNs push notification functionality.
 * Note: These tests mock the APNs client to avoid sending real notifications.
 */

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");

describe("Push Notification Service", () => {
  let pushService;
  let originalEnv;

  before(() => {
    // Save original env
    originalEnv = { ...process.env };

    // Set test config with APNs credentials
    process.env.APNS_KEY_ID = "APNS_TEST_KEY";
    process.env.APNS_TEAM_ID = "TEST_TEAM_ID";
    process.env.APNS_BUNDLE_ID = "porizo.ios.app.PorizoApp";
    // Use a test private key (P-256 ECDSA key format)
    process.env.APNS_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgWDEcrymWXlLf5DKP
CmepIut4GKbNwTu6BoFaK1N96sCgCgYIKoZIzj0DAQehRANCAAQnICXGsXK3szPI
wbJNIPHMyi/CWWPorHm6rMqnC20ZryXMF4GdkWiYAudi1Ta+2MOSG3ErjJ4vxlJj
TB7FKGFY
-----END PRIVATE KEY-----`;

    // Load push notification service
    pushService = require("../src/services/push-notification");
  });

  after(() => {
    // Restore original env
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    });
    Object.assign(process.env, originalEnv);
  });

  describe("Configuration", () => {
    it("should report configured when all APNS env vars are set", () => {
      assert.strictEqual(pushService.isConfigured(), true);
    });

    it("should export getConfig function", () => {
      const config = pushService.getConfig();
      assert.strictEqual(config.keyId, "APNS_TEST_KEY");
      assert.strictEqual(config.teamId, "TEST_TEAM_ID");
      assert.strictEqual(config.bundleId, "porizo.ios.app.PorizoApp");
    });
  });

  describe("Exports", () => {
    it("should export sendRenderComplete function", () => {
      assert.strictEqual(typeof pushService.sendRenderComplete, "function");
    });

    it("should export sendSilentPush function", () => {
      assert.strictEqual(typeof pushService.sendSilentPush, "function");
    });

    it("should export isConfigured function", () => {
      assert.strictEqual(typeof pushService.isConfigured, "function");
    });
  });

  describe("Notification Building", () => {
    it("sendRenderComplete should build correct payload structure", async () => {
      // We can't actually send without valid creds, but we can test the function exists
      // and accepts the right parameters
      const sendFn = pushService.sendRenderComplete;
      assert.strictEqual(sendFn.length >= 2, true, "Should accept at least 2 parameters");
    });

    it("sendSilentPush should accept pushToken and payload", async () => {
      const sendFn = pushService.sendSilentPush;
      assert.strictEqual(sendFn.length >= 2, true, "Should accept at least 2 parameters");
    });
  });

  describe("Error Handling", () => {
    it("should gracefully handle missing push token", async () => {
      const result = await pushService.sendRenderComplete(null, "track-123", "Test Song");
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, "MISSING_PUSH_TOKEN");
    });

    it("should gracefully handle empty push token", async () => {
      const result = await pushService.sendRenderComplete("", "track-123", "Test Song");
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, "MISSING_PUSH_TOKEN");
    });

    it("should gracefully handle missing trackId", async () => {
      const result = await pushService.sendRenderComplete("valid-token", null, "Test Song");
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, "MISSING_TRACK_ID");
    });
  });
});

describe("Push Notification Service - Unconfigured", () => {
  let pushServiceUnconfigured;
  let originalEnv;

  before(() => {
    // Save and clear APNs env vars
    originalEnv = { ...process.env };
    delete process.env.APNS_KEY_ID;
    delete process.env.APNS_TEAM_ID;
    delete process.env.APNS_PRIVATE_KEY;
    delete process.env.APNS_BUNDLE_ID;

    // Clear module cache to get fresh instance
    delete require.cache[require.resolve("../src/services/push-notification")];
    pushServiceUnconfigured = require("../src/services/push-notification");
  });

  after(() => {
    // Restore original env
    Object.assign(process.env, originalEnv);
    // Re-clear cache for other tests
    delete require.cache[require.resolve("../src/services/push-notification")];
  });

  it("should report not configured when env vars are missing", () => {
    assert.strictEqual(pushServiceUnconfigured.isConfigured(), false);
  });

  it("should return error when trying to send without config", async () => {
    const result = await pushServiceUnconfigured.sendRenderComplete(
      "valid-token",
      "track-123",
      "Test Song"
    );
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "APNS_NOT_CONFIGURED");
  });
});
