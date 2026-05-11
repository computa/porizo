require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { beforeEach, afterEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");

describe("apple ads attribution route", () => {
  let db;
  let app;
  let originalFetch;
  const userId = "apple_ads_user";
  const attributionToken = "apple_ads_test_token_12345678901234567890";

  beforeEach(async () => {
    originalFetch = global.fetch;
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildServer({
      db,
      config: {
        STORAGE_DIR: "/tmp/test-storage",
        PUBLIC_BASE_URL: "http://public.local",
        STREAM_BASE_URL: "http://stream.local",
        ALLOW_ANON_USER_ID: true,
        APPLE_ADS_ATTRIBUTION_URL: "https://mock.apple.test/api/v1/",
        APPLE_ADS_ATTRIBUTION_TIMEOUT_MS: 1000,
      },
      storage: {
        put: async () => {},
        get: async () => null,
        exists: async () => false,
        delete: async () => {},
        getSignedUrl: async (key) => `http://localhost/${key}`,
      },
    });

    await db.prepare(
      "INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, datetime('now'), 'low')"
    ).run(userId);
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await app.close();
    await db.close?.();
  });

  test("resolves Apple Ads attribution and dedupes repeated submissions", async () => {
    let fetchCalls = 0;
    global.fetch = async (url, options) => {
      if (url !== "https://mock.apple.test/api/v1/") {
        return {
          status: 200,
          ok: true,
          async json() {
            return {};
          },
          async text() {
            return "{}";
          },
        };
      }
      fetchCalls += 1;
      assert.equal(url, "https://mock.apple.test/api/v1/");
      assert.equal(options.method, "POST");
      assert.equal(options.headers["content-type"], "text/plain");
      assert.equal(options.body, attributionToken);
      return {
        status: 200,
        async text() {
          return JSON.stringify({
            campaignId: 123,
            adGroupId: 456,
            keywordId: 789,
            orgId: 321,
            conversionType: "Download",
            countryOrRegion: "AU",
            clickDate: "2026-04-11T10:00:00Z",
            impressionDate: "2026-04-11T09:55:00Z",
            isRedownload: false,
          });
        },
      };
    };

    const response = await app.inject({
      method: "POST",
      url: "/analytics/apple-ads-attribution",
      headers: { "x-user-id": userId },
      payload: { attributionToken },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().deduped, false);
    assert.equal(response.json().attribution.status, "resolved");
    assert.equal(response.json().attribution.campaign_id ?? response.json().attribution.campaignId, 123);
    assert.equal(fetchCalls, 1);

    const row = await db.prepare(
      "SELECT status, campaign_id, ad_group_id, keyword_id, org_id, api_status_code, resolved_at FROM apple_ads_attribution WHERE user_id = ?"
    ).get(userId);
    assert.equal(row.status, "resolved");
    assert.equal(row.campaign_id, 123);
    assert.equal(row.ad_group_id, 456);
    assert.equal(row.keyword_id, 789);
    assert.equal(row.org_id, 321);
    assert.equal(row.api_status_code, 200);
    assert.ok(row.resolved_at);

    const user = await db.prepare(
      `SELECT acquisition_source, acquisition_medium, acquisition_campaign,
              acquisition_content, acquisition_term, acquisition_country,
              acquisition_at
       FROM users WHERE id = ?`
    ).get(userId);
    assert.equal(user.acquisition_source, "Apple Ads");
    assert.equal(user.acquisition_medium, "cpc");
    assert.equal(user.acquisition_campaign, "123");
    assert.equal(user.acquisition_content, "456");
    assert.equal(user.acquisition_term, "789");
    assert.equal(user.acquisition_country, "AU");
    assert.equal(user.acquisition_at, "2026-04-11T10:00:00Z");

    const deduped = await app.inject({
      method: "POST",
      url: "/analytics/apple-ads-attribution",
      headers: { "x-user-id": userId },
      payload: { attributionToken },
    });
    assert.equal(deduped.statusCode, 200, deduped.body);
    assert.equal(deduped.json().deduped, true);
    assert.equal(fetchCalls, 1);
  });

  test("does not overwrite existing download attribution on Apple Ads resolution", async () => {
    await db.prepare(
      "UPDATE users SET acquisition_source = ?, acquisition_campaign = ?, acquisition_country = ? WHERE id = ?"
    ).run("TikTok", "mothersday", "US", userId);

    global.fetch = async () => ({
      status: 200,
      async text() {
        return JSON.stringify({
          campaignId: 123,
          countryOrRegion: "AU",
        });
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/analytics/apple-ads-attribution",
      headers: { "x-user-id": userId },
      payload: { attributionToken },
    });

    assert.equal(response.statusCode, 200, response.body);

    const user = await db.prepare(
      "SELECT acquisition_source, acquisition_campaign, acquisition_country FROM users WHERE id = ?"
    ).get(userId);
    assert.equal(user.acquisition_source, "TikTok");
    assert.equal(user.acquisition_campaign, "mothersday");
    assert.equal(user.acquisition_country, "US");
  });

  test("ignores Apple Ads developer-mode test attribution data", async () => {
    global.fetch = async () => ({
      status: 200,
      async text() {
        return JSON.stringify({
          attribution: true,
          orgId: 1234567890,
          campaignId: 1234567890,
          conversionType: "Download",
          claimType: "Click",
          adGroupId: 1234567890,
          countryOrRegion: "US",
          keywordId: 12323222,
          adId: 1234567890,
          supplyPlacement: "APPSTORE_SEARCH_RESULTS",
        });
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/analytics/apple-ads-attribution",
      headers: { "x-user-id": userId },
      payload: { attributionToken },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().attribution.status, "test");
    assert.equal(response.json().attribution.campaign_id ?? response.json().attribution.campaignId, 1234567890);

    const user = await db.prepare(
      "SELECT acquisition_source, acquisition_campaign, acquisition_country FROM users WHERE id = ?"
    ).get(userId);
    assert.equal(user.acquisition_source, null);
    assert.equal(user.acquisition_campaign, null);
    assert.equal(user.acquisition_country, null);

    const row = await db.prepare(
      "SELECT status, last_error FROM apple_ads_attribution WHERE user_id = ?"
    ).get(userId);
    assert.equal(row.status, "test");
    assert.match(row.last_error, /developer-mode test/i);
  });

  test("does not backfill Apple Ads attribution for an existing user captured long after signup", async () => {
    const oldUserId = "old_apple_ads_user";
    await db.prepare(
      "INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, 'low')"
    ).run(oldUserId, "2026-01-24T07:31:11.455Z");

    global.fetch = async () => ({
      status: 200,
      async text() {
        return JSON.stringify({
          campaignId: 123,
          countryOrRegion: "US",
        });
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/analytics/apple-ads-attribution",
      headers: { "x-user-id": oldUserId },
      payload: { attributionToken: `${attributionToken}_late` },
    });

    assert.equal(response.statusCode, 200, response.body);

    await db.prepare(
      "UPDATE apple_ads_attribution SET created_at = ?, updated_at = ?, resolved_at = ? WHERE user_id = ?"
    ).run("2026-04-11T08:51:35.304Z", "2026-04-11T08:51:35.304Z", "2026-04-11T08:51:35.304Z", oldUserId);

    const { AttributionService } = require("../src/services/attribution-service");
    const service = new AttributionService(db);
    const row = await db.prepare("SELECT * FROM apple_ads_attribution WHERE user_id = ?").get(oldUserId);
    await service.backfillUserAcquisitionFromAppleAds(row);

    const user = await db.prepare(
      "SELECT acquisition_source, acquisition_campaign, acquisition_country FROM users WHERE id = ?"
    ).get(oldUserId);
    assert.equal(user.acquisition_source, null);
    assert.equal(user.acquisition_campaign, null);
    assert.equal(user.acquisition_country, null);
  });

  test("stores not_found responses without retrying forever", async () => {
    let fetchCalls = 0;
    global.fetch = async (url) => {
      if (url !== "https://mock.apple.test/api/v1/") {
        return {
          status: 200,
          ok: true,
          async json() {
            return {};
          },
          async text() {
            return "{}";
          },
        };
      }
      fetchCalls += 1;
      return {
        status: 404,
        async text() {
          return JSON.stringify({ message: "No attribution found" });
        },
      };
    };

    const response = await app.inject({
      method: "POST",
      url: "/analytics/apple-ads-attribution",
      headers: { "x-user-id": userId },
      payload: { attributionToken },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().attribution.status, "not_found");
    assert.equal(fetchCalls, 1);

    const row = await db.prepare(
      "SELECT status, api_status_code, last_error FROM apple_ads_attribution WHERE user_id = ?"
    ).get(userId);
    assert.equal(row.status, "not_found");
    assert.equal(row.api_status_code, 404);
    assert.equal(row.last_error, null);

    const deduped = await app.inject({
      method: "POST",
      url: "/analytics/apple-ads-attribution",
      headers: { "x-user-id": userId },
      payload: { attributionToken },
    });
    assert.equal(deduped.statusCode, 200, deduped.body);
    assert.equal(deduped.json().deduped, true);
    assert.equal(fetchCalls, 1);
  });
});
