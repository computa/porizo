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
  sendToSegment,
  sendToUsers,
  sendRecipientPlayed,
  startTagSyncJob,
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

  describe("send payloads", () => {
    async function withMockedOneSignal(fn) {
      const origAppId = process.env.ONESIGNAL_APP_ID;
      const origKey = process.env.ONESIGNAL_REST_API_KEY;
      const origFetch = global.fetch;
      const calls = [];

      process.env.ONESIGNAL_APP_ID = "app-id";
      process.env.ONESIGNAL_REST_API_KEY = "rest-key";
      global.fetch = async (url, options) => {
        calls.push({ url, options, body: JSON.parse(options.body) });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: "notification-1", recipients: 3 }),
        };
      };

      try {
        return await fn(calls);
      } finally {
        global.fetch = origFetch;
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
      }
    }

    it("sends segment pushes through the push channel", async () => {
      await withMockedOneSignal(async (calls) => {
        const result = await sendToSegment({
          segments: ["All"],
          title: "Hello",
          body: "World",
          name: "Launch push",
        });

        assert.strictEqual(result.id, "notification-1");
        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0].url, "https://api.onesignal.com/notifications");
        assert.strictEqual(calls[0].options.headers.Authorization, "Key rest-key");
        assert.deepStrictEqual(calls[0].body, {
          app_id: "app-id",
          target_channel: "push",
          included_segments: ["All"],
          headings: { en: "Hello" },
          contents: { en: "World" },
          name: "Launch push",
        });
      });
    });

    it("targets users by external ID for direct pushes", async () => {
      await withMockedOneSignal(async (calls) => {
        await sendToUsers({
          userIds: ["user_1", "user_2"],
          title: "Song ready",
          body: "Open Porizo",
          data: { screen: "songs" },
          name: "Direct push",
        });

        assert.deepStrictEqual(calls[0].body, {
          app_id: "app-id",
          include_aliases: { external_id: ["user_1", "user_2"] },
          target_channel: "push",
          headings: { en: "Song ready" },
          contents: { en: "Open Porizo" },
          name: "Direct push",
          data: { screen: "songs" },
        });
      });
    });

    it("sends recipient-played events to the sender external ID", async () => {
      await withMockedOneSignal(async (calls) => {
        await sendRecipientPlayed({
          userId: "sender_1",
          trackId: "track_1",
          trackTitle: "A Song for Sarah",
          recipientName: "Sarah",
        });

        assert.deepStrictEqual(calls[0].body.include_aliases, {
          external_id: ["sender_1"],
        });
        assert.deepStrictEqual(calls[0].body.data, {
          type: "recipient_played",
          trackId: "track_1",
          trackTitle: "A Song for Sarah",
          recipientName: "Sarah",
        });
        assert.strictEqual(calls[0].body.contents.en, 'Sarah just finished listening to "A Song for Sarah"');
      });
    });

    it("rejects recipient-played sends with no subscribed external ID", async () => {
      const origAppId = process.env.ONESIGNAL_APP_ID;
      const origKey = process.env.ONESIGNAL_REST_API_KEY;
      const origFetch = global.fetch;
      process.env.ONESIGNAL_APP_ID = "app-id";
      process.env.ONESIGNAL_REST_API_KEY = "rest-key";
      global.fetch = async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "", recipients: 0 }),
      });

      try {
        await assert.rejects(
          sendRecipientPlayed({ userId: "missing", trackId: "track_1" }),
          { code: "ONESIGNAL_RECIPIENT_NOT_SUBSCRIBED" },
        );
      } finally {
        global.fetch = origFetch;
        if (origAppId) process.env.ONESIGNAL_APP_ID = origAppId;
        else delete process.env.ONESIGNAL_APP_ID;
        if (origKey) process.env.ONESIGNAL_REST_API_KEY = origKey;
        else delete process.env.ONESIGNAL_REST_API_KEY;
      }
    });
  });

  describe("tag sync job", () => {
    it("syncs tags from an injected repository", async () => {
      const origAppId = process.env.ONESIGNAL_APP_ID;
      const origKey = process.env.ONESIGNAL_REST_API_KEY;
      const origFetch = global.fetch;
      const calls = [];
      let job;
      let finish;
      let fail;
      const done = new Promise((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
      const timeout = setTimeout(
        () => fail(new Error("Timed out waiting for OneSignal tag sync")),
        2000,
      );

      process.env.ONESIGNAL_APP_ID = "app-id";
      process.env.ONESIGNAL_REST_API_KEY = "rest-key";
      global.fetch = async (url, options) => {
        calls.push({ url, options, body: JSON.parse(options.body) });
        if (calls.length === 2) {
          clearTimeout(timeout);
          finish();
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: "tag-sync" }),
        };
      };

      try {
        job = startTagSyncJob({
          db: null,
          logger: { info() {}, warn() {}, error() {} },
          intervalMs: 60 * 60 * 1000,
          repository: {
            listUserTagSummaries: async () => [
              {
                id: "user_without_tracks",
                song_count: 0,
                last_song_at: null,
              },
              {
                id: "user_power",
                song_count: 5,
                last_song_at: null,
              },
            ],
          },
        });

        await done;

        assert.deepStrictEqual(
          calls.map((call) => call.url),
          [
            "https://api.onesignal.com/apps/app-id/users/by/external_id/user_without_tracks",
            "https://api.onesignal.com/apps/app-id/users/by/external_id/user_power",
          ],
        );
        assert.deepStrictEqual(calls[0].body, {
          properties: {
            tags: {
              songs_created: "0",
              days_since_last_song: "never",
            },
          },
        });
        assert.deepStrictEqual(calls[1].body, {
          properties: {
            tags: {
              songs_created: "5+",
              days_since_last_song: "never",
            },
          },
        });
      } finally {
        clearTimeout(timeout);
        job?.stop();
        global.fetch = origFetch;
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
      }
    });
  });
});
