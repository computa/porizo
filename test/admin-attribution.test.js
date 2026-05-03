require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { beforeEach, afterEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");

function buildTestApp(db) {
  return buildServer({
    db,
    config: {
      STORAGE_DIR: "/tmp/test-storage",
      PUBLIC_BASE_URL: "http://public.local",
      STREAM_BASE_URL: "http://stream.local",
      ALLOW_ANON_USER_ID: true,
    },
    storage: {
      put: async () => {},
      get: async () => null,
      exists: async () => false,
      delete: async () => {},
      getSignedUrl: async (key) => `http://localhost/${key}`,
    },
  });
}

async function loginAdmin(app) {
  const response = await app.inject({
    method: "POST",
    url: "/admin/auth/login",
    payload: { email: "admin@porizo.app", password: "admin123" },
  });
  assert.equal(response.statusCode, 200, `admin login failed: ${response.body}`);
  return response.json().token;
}

async function insertUser(db, userId) {
  await db.prepare(
    "INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, 'low')"
  ).run(userId, new Date().toISOString());
}

async function insertAppleAdsAttribution(db, {
  id,
  userId,
  status,
  campaignId = null,
  country = null,
  createdAt = new Date().toISOString(),
}) {
  await db.prepare(`
    INSERT INTO apple_ads_attribution (
      id, user_id, attribution_token_sha256, token_length, status, api_status_code,
      campaign_id, country_or_region, created_at, updated_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userId,
    `${id}_token_hash`,
    64,
    status,
    status === "resolved" ? 200 : (status === "not_found" ? 404 : null),
    campaignId,
    country,
    createdAt,
    createdAt,
    status === "pending" ? null : createdAt
  );
}

describe("admin attribution contract", () => {
  let db;
  let app;
  let adminHeaders;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildTestApp(db);
    const token = await loginAdmin(app);
    adminHeaders = { Authorization: `Bearer ${token}` };
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("admin user list and detail resolve Apple Ads attribution without relying on users columns", async () => {
    const userId = "admin_attr_apple";
    await insertUser(db, userId);
    await insertAppleAdsAttribution(db, {
      id: "aaa_admin_attr_apple",
      userId,
      status: "resolved",
      campaignId: 321,
      country: "AU",
    });

    const listResponse = await app.inject({
      method: "GET",
      url: `/admin/dashboard/users?userId=${userId}`,
      headers: adminHeaders,
    });
    assert.equal(listResponse.statusCode, 200, listResponse.body);
    const listedUser = listResponse.json().users[0];
    assert.equal(listedUser.acquisition_source, "Apple Ads");
    assert.equal(listedUser.acquisition_campaign, "321");
    assert.equal(listedUser.acquisition_country, "AU");
    assert.equal(listedUser.attribution_status, "attributed");
    assert.equal(listedUser.attribution_confidence, "apple_ads");

    const detailResponse = await app.inject({
      method: "GET",
      url: `/admin/dashboard/users/${userId}`,
      headers: adminHeaders,
    });
    assert.equal(detailResponse.statusCode, 200, detailResponse.body);
    const detailUser = detailResponse.json().user;
    assert.equal(detailUser.acquisition_source, "Apple Ads");
    assert.equal(detailUser.acquisition_campaign, "321");
    assert.equal(detailUser.acquisition_country, "AU");
    assert.equal(detailUser.attribution_status, "attributed");
    assert.match(detailUser.attribution_reason, /Apple Ads/);
  });

  test("admin user list exposes organic and unknown attribution states explicitly", async () => {
    const organicUserId = "admin_attr_organic";
    const unknownUserId = "admin_attr_unknown";
    await insertUser(db, organicUserId);
    await insertUser(db, unknownUserId);
    await insertAppleAdsAttribution(db, {
      id: "aaa_admin_attr_organic",
      userId: organicUserId,
      status: "not_found",
    });

    const organicResponse = await app.inject({
      method: "GET",
      url: `/admin/dashboard/users?userId=${organicUserId}`,
      headers: adminHeaders,
    });
    assert.equal(organicResponse.statusCode, 200, organicResponse.body);
    assert.equal(organicResponse.json().users[0].acquisition_source, "Organic / direct");
    assert.equal(organicResponse.json().users[0].attribution_status, "organic");

    const unknownResponse = await app.inject({
      method: "GET",
      url: `/admin/dashboard/users?userId=${unknownUserId}`,
      headers: adminHeaders,
    });
    assert.equal(unknownResponse.statusCode, 200, unknownResponse.body);
    assert.equal(unknownResponse.json().users[0].acquisition_source, "Unknown");
    assert.equal(unknownResponse.json().users[0].attribution_status, "unknown");
  });

  test("admin attribution health reports Apple Ads and display mismatch metrics", async () => {
    const resolvedUserId = "admin_attr_health_resolved";
    const pendingUserId = "admin_attr_health_pending";
    await insertUser(db, resolvedUserId);
    await insertUser(db, pendingUserId);
    await insertAppleAdsAttribution(db, {
      id: "aaa_admin_attr_health_resolved",
      userId: resolvedUserId,
      status: "resolved",
      campaignId: 456,
      country: "US",
    });
    await insertAppleAdsAttribution(db, {
      id: "aaa_admin_attr_health_pending",
      userId: pendingUserId,
      status: "pending",
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/attribution/health",
      headers: adminHeaders,
    });
    assert.equal(response.statusCode, 200, response.body);
    const health = response.json();
    assert.equal(health.appleAds.totalTokens, 2);
    assert.equal(health.appleAds.resolved, 1);
    assert.equal(health.appleAds.resolvedWithCountry, 1);
    assert.equal(health.appleAds.pending, 1);
    assert.equal(health.appleAds.resolvedRowsNotBackfilled, 1);
    assert.equal(health.users.withAnyAttributionSignal, 2);
  });
});
