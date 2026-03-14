/**
 * OneSignal Service Tests
 *
 * Unit tests for the OneSignal marketing push notification service.
 * Tests tag bucketing, day calculation, and tag sync job lifecycle.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  songsCreatedBucket,
  daysSince,
  isConfigured,
} = require("../src/services/onesignal");

describe("OneSignal Service", () => {
  describe("songsCreatedBucket", () => {
    it("returns '0' for zero songs", () => {
      assert.strictEqual(songsCreatedBucket(0), "0");
    });

    it("returns '1' for exactly one song", () => {
      assert.strictEqual(songsCreatedBucket(1), "1");
    });

    it("returns '2' for 2-4 songs", () => {
      assert.strictEqual(songsCreatedBucket(2), "2");
      assert.strictEqual(songsCreatedBucket(3), "2");
      assert.strictEqual(songsCreatedBucket(4), "2");
    });

    it("returns '5+' for 5 or more songs", () => {
      assert.strictEqual(songsCreatedBucket(5), "5+");
      assert.strictEqual(songsCreatedBucket(10), "5+");
      assert.strictEqual(songsCreatedBucket(100), "5+");
    });
  });

  describe("daysSince", () => {
    it("returns null for null input", () => {
      assert.strictEqual(daysSince(null), null);
    });

    it("returns null for undefined input", () => {
      assert.strictEqual(daysSince(undefined), null);
    });

    it("returns 0 for today", () => {
      const today = new Date().toISOString();
      assert.strictEqual(daysSince(today), 0);
    });

    it("returns correct days for past dates", () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      assert.strictEqual(daysSince(threeDaysAgo), 3);
    });

    it("handles date strings without time component", () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const dateStr = yesterday.toISOString().split("T")[0];
      const days = daysSince(dateStr);
      // Allow for timezone edge cases (0 or 1 day difference)
      assert.ok(days >= 0 && days <= 2, `Expected 0-2 days, got ${days}`);
    });
  });

  describe("isConfigured", () => {
    it("returns false when env vars are not set", () => {
      const origAppId = process.env.ONESIGNAL_APP_ID;
      const origKey = process.env.ONESIGNAL_REST_API_KEY;
      delete process.env.ONESIGNAL_APP_ID;
      delete process.env.ONESIGNAL_REST_API_KEY;

      assert.strictEqual(isConfigured(), false);

      // Restore
      if (origAppId) process.env.ONESIGNAL_APP_ID = origAppId;
      if (origKey) process.env.ONESIGNAL_REST_API_KEY = origKey;
    });

    it("returns false when only app ID is set", () => {
      const origAppId = process.env.ONESIGNAL_APP_ID;
      const origKey = process.env.ONESIGNAL_REST_API_KEY;
      process.env.ONESIGNAL_APP_ID = "test-app-id";
      delete process.env.ONESIGNAL_REST_API_KEY;

      assert.strictEqual(isConfigured(), false);

      // Restore
      if (origAppId) {
        process.env.ONESIGNAL_APP_ID = origAppId;
      } else {
        delete process.env.ONESIGNAL_APP_ID;
      }
      if (origKey) process.env.ONESIGNAL_REST_API_KEY = origKey;
    });

    it("returns true when both env vars are set", () => {
      const origAppId = process.env.ONESIGNAL_APP_ID;
      const origKey = process.env.ONESIGNAL_REST_API_KEY;
      process.env.ONESIGNAL_APP_ID = "test-app-id";
      process.env.ONESIGNAL_REST_API_KEY = "test-api-key";

      assert.strictEqual(isConfigured(), true);

      // Restore
      if (origAppId) {
        process.env.ONESIGNAL_APP_ID = origAppId;
      } else {
        delete process.env.ONESIGNAL_APP_ID;
      }
      if (origKey) {
        process.env.ONESIGNAL_REST_API_KEY = origKey;
      } else {
        delete process.env.ONESIGNAL_REST_API_KEY;
      }
    });
  });
});
