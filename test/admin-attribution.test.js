require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { beforeEach, afterEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");
const { AttributionService } = require("../src/services/attribution-service");

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
  adGroupId = null,
  keywordId = null,
  country = null,
  clickDate = null,
  createdAt = new Date().toISOString(),
}) {
  await db.prepare(`
    INSERT INTO apple_ads_attribution (
      id, user_id, attribution_token_sha256, token_length, status, api_status_code,
      campaign_id, ad_group_id, keyword_id, country_or_region, click_date, created_at, updated_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userId,
    `${id}_token_hash`,
    64,
    status,
    status === "resolved" ? 200 : (status === "not_found" ? 404 : null),
    campaignId,
    adGroupId,
    keywordId,
    country,
    clickDate,
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
      adGroupId: 654,
      keywordId: 987,
      country: "AU",
      clickDate: "2026-04-11T10:00:00Z",
    });

    const listResponse = await app.inject({
      method: "GET",
      url: `/admin/dashboard/users?userId=${userId}`,
      headers: adminHeaders,
    });
    assert.equal(listResponse.statusCode, 200, listResponse.body);
    const listedUser = listResponse.json().users[0];
    assert.equal(listedUser.acquisition_source, "Apple Ads");
    assert.equal(listedUser.acquisition_medium, "cpc");
    assert.equal(listedUser.acquisition_campaign, "321");
    assert.equal(listedUser.acquisition_content, "654");
    assert.equal(listedUser.acquisition_term, "987");
    assert.equal(listedUser.acquisition_country, "AU");
    assert.equal(listedUser.acquisition_at, "2026-04-11T10:00:00Z");
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
    assert.equal(detailUser.acquisition_medium, "cpc");
    assert.equal(detailUser.acquisition_campaign, "321");
    assert.equal(detailUser.acquisition_content, "654");
    assert.equal(detailUser.acquisition_term, "987");
    assert.equal(detailUser.acquisition_country, "AU");
    assert.equal(detailUser.acquisition_at, "2026-04-11T10:00:00Z");
    assert.equal(detailUser.attribution_status, "attributed");
    assert.match(detailUser.attribution_reason, /Apple Ads/);
  });

  test("admin user list returns pagination metadata for page controls", async () => {
    await insertUser(db, "admin_attr_page_1");
    await insertUser(db, "admin_attr_page_2");
    await insertUser(db, "admin_attr_page_3");

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/users?limit=2&offset=1",
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.users.length, 2);
    assert.equal(body.total, 3);
    assert.equal(body.limit, 2);
    assert.equal(body.offset, 1);
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

  test("stored non-Apple source overrides resolved Apple Ads display attribution", async () => {
    const userId = "admin_attr_founder_override";
    await insertUser(db, userId);
    await db.prepare(
      "UPDATE users SET acquisition_source = ?, acquisition_campaign = ?, acquisition_country = ? WHERE id = ?"
    ).run("Founder outreach", "friends_test", "US", userId);
    await insertAppleAdsAttribution(db, {
      id: "aaa_admin_attr_founder_override",
      userId,
      status: "resolved",
      campaignId: 321,
      country: "US",
    });

    const response = await app.inject({
      method: "GET",
      url: `/admin/dashboard/users?userId=${userId}`,
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    const user = response.json().users[0];
    assert.equal(user.acquisition_source, "Founder outreach");
    assert.equal(user.acquisition_campaign, "friends_test");
    assert.equal(user.acquisition_country, "US");
    assert.equal(user.attribution_confidence, "stored");
  });

  test("matched download registration attribution overrides a stored Apple Ads install source", async () => {
    const userId = "admin_attr_download_over_apple";
    await insertUser(db, userId);
    await db.prepare(
      `UPDATE users
       SET acquisition_source = ?, acquisition_medium = ?, acquisition_campaign = ?,
           acquisition_content = ?, acquisition_term = ?, acquisition_country = ?
       WHERE id = ?`
    ).run("Apple Ads", "cpc", "321", "654", "987", "US", userId);
    await insertAppleAdsAttribution(db, {
      id: "aaa_admin_attr_download_over_apple",
      userId,
      status: "resolved",
      campaignId: 321,
      adGroupId: 654,
      keywordId: 987,
      country: "US",
    });

    const now = new Date().toISOString();
    const download = {
      id: "dl_admin_attr_download_over_apple",
      utm_source: "seo",
      utm_medium: "landing_page",
      utm_campaign: "birthday_song_gift",
      utm_content: "hero",
      utm_term: null,
      country: "AU",
      referrer_url: "https://porizo.co/birthday-song-maker",
      created_at: now,
    };
    await db.prepare(`
      INSERT INTO download_events (
        id, ip_address, user_agent, utm_source, utm_medium, utm_campaign,
        utm_content, utm_term, country, referrer_url, matched_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      download.id,
      "203.0.113.44",
      "test-agent",
      download.utm_source,
      download.utm_medium,
      download.utm_campaign,
      download.utm_content,
      download.utm_term,
      download.country,
      download.referrer_url,
      userId,
      download.created_at
    );

    const response = await app.inject({
      method: "GET",
      url: `/admin/dashboard/users?userId=${userId}`,
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    const user = response.json().users[0];
    assert.equal(user.acquisition_source, "seo");
    assert.equal(user.acquisition_medium, "landing_page");
    assert.equal(user.acquisition_campaign, "birthday_song_gift");
    assert.equal(user.acquisition_content, "hero");
    assert.equal(user.acquisition_term, null);
    assert.equal(user.acquisition_country, "AU");
    assert.equal(user.acquisition_referrer, "https://porizo.co/birthday-song-maker");
    assert.equal(user.attribution_confidence, "download_event_over_apple_ads");

    const attributionService = new AttributionService(db);
    await attributionService.backfillUserAcquisitionFromDownload(userId, download);
    const stored = await db.prepare(`
      SELECT acquisition_source, acquisition_medium, acquisition_campaign, acquisition_country
      FROM users
      WHERE id = ?
    `).get(userId);
    assert.equal(stored.acquisition_source, "seo");
    assert.equal(stored.acquisition_medium, "landing_page");
    assert.equal(stored.acquisition_campaign, "birthday_song_gift");
    assert.equal(stored.acquisition_country, "AU");
  });

  test("manual attribution override writes an old/new audit contract entry", async () => {
    const userId = "admin_attr_audit_override";
    await insertUser(db, userId);

    const updateResponse = await app.inject({
      method: "PUT",
      url: `/admin/dashboard/users/${userId}/profile`,
      headers: adminHeaders,
      payload: {
        acquisition_source: "Founder outreach",
        acquisition_medium: "email",
        acquisition_campaign: "friends_test",
        acquisition_content: "may_followup",
        acquisition_term: "song_gift",
        acquisition_country: "US",
        acquisition_referrer: "https://porizo.co/mothers-day-song",
      },
    });
    assert.equal(updateResponse.statusCode, 200, updateResponse.body);

    const auditRow = await db.prepare(`
      SELECT action, resource_type, resource_id, metadata_json
      FROM audit_logs
      WHERE action = ? AND resource_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get("admin_update_user_attribution", userId);

    assert.ok(auditRow, "expected attribution override audit log");
    assert.equal(auditRow.resource_type, "user");
    const metadata = JSON.parse(auditRow.metadata_json);
    assert.equal(metadata.contract, "attribution-source-precedence-v1");
    assert.equal(metadata.previous.acquisition_source, null);
    assert.equal(metadata.previous.acquisition_medium, null);
    assert.equal(metadata.previous.acquisition_campaign, null);
    assert.equal(metadata.previous.acquisition_content, null);
    assert.equal(metadata.previous.acquisition_term, null);
    assert.equal(metadata.previous.acquisition_country, null);
    assert.equal(metadata.previous.acquisition_referrer, null);
    assert.equal(metadata.next.acquisition_source, "Founder outreach");
    assert.equal(metadata.next.acquisition_medium, "email");
    assert.equal(metadata.next.acquisition_campaign, "friends_test");
    assert.equal(metadata.next.acquisition_content, "may_followup");
    assert.equal(metadata.next.acquisition_term, "song_gift");
    assert.equal(metadata.next.acquisition_country, "US");
    assert.equal(metadata.next.acquisition_referrer, "https://porizo.co/mothers-day-song");
    assert.deepEqual(metadata.changedFields, {
      acquisition_source: "Founder outreach",
      acquisition_medium: "email",
      acquisition_campaign: "friends_test",
      acquisition_content: "may_followup",
      acquisition_term: "song_gift",
      acquisition_country: "US",
      acquisition_referrer: "https://porizo.co/mothers-day-song",
    });
  });

  test("admin attribution health reports Apple Ads and display mismatch metrics", async () => {
    const resolvedUserId = "admin_attr_health_resolved";
    const pendingUserId = "admin_attr_health_pending";
    const testUserId = "admin_attr_health_test";
    await insertUser(db, resolvedUserId);
    await insertUser(db, pendingUserId);
    await insertUser(db, testUserId);
    await insertAppleAdsAttribution(db, {
      id: "aaa_admin_attr_health_resolved",
      userId: resolvedUserId,
      status: "resolved",
      campaignId: 456,
      adGroupId: 789,
      keywordId: 101,
      country: "US",
    });
    await insertAppleAdsAttribution(db, {
      id: "aaa_admin_attr_health_pending",
      userId: pendingUserId,
      status: "pending",
    });
    await insertAppleAdsAttribution(db, {
      id: "aaa_admin_attr_health_test",
      userId: testUserId,
      status: "test",
      campaignId: 1234567890,
      country: "US",
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/attribution/health",
      headers: adminHeaders,
    });
    assert.equal(response.statusCode, 200, response.body);
    const health = response.json();
    assert.equal(health.appleAds.totalTokens, 3);
    assert.equal(health.appleAds.resolved, 1);
    assert.equal(health.appleAds.resolvedUsers, 1);
    assert.equal(health.appleAds.resolvedWithCountry, 1);
    assert.equal(health.appleAds.resolvedMissingCountry, 0);
    assert.equal(health.appleAds.pending, 1);
    assert.equal(health.appleAds.testData, 1);
    assert.equal(health.appleAds.resolvedRowsNotBackfilled, 1);
    assert.equal(health.users.withAnyAttributionSignal, 2);
  });

  test("growth attribution includes SEO download campaigns and matched registrations", async () => {
    const userId = "admin_attr_seo_signup";
    await insertUser(db, userId);
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();

    await db.prepare(`
      INSERT INTO download_events (
        id, ip_address, user_agent, utm_source, utm_medium, utm_campaign,
        utm_content, country, referrer_url, matched_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "dl_seo_mothers_1",
      "203.0.113.10",
      "test-agent",
      "seo",
      "landing_page",
      "mothers_day_song",
      "hero",
      "AU",
      "https://porizo.co/mothers-day-song",
      userId,
      now
    );

    await db.prepare(`
      INSERT INTO download_events (
        id, ip_address, user_agent, utm_source, utm_medium, utm_campaign,
        utm_content, country, referrer_url, matched_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "dl_seo_mothers_2",
      "203.0.113.11",
      "test-agent",
      "seo",
      "landing_page",
      "mothers_day_song",
      "nav",
      "AU",
      "https://porizo.co/mothers-day-song",
      null,
      now
    );

    await db.prepare(`
      INSERT INTO download_events (
        id, ip_address, user_agent, utm_source, utm_medium, utm_campaign,
        utm_content, country, referrer_url, matched_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "dl_old_custom",
      "203.0.113.12",
      "test-agent",
      "seo",
      "landing_page",
      "custom_song_gift",
      "hero",
      "US",
      "https://porizo.co/custom-song-gift",
      null,
      old
    );

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/growth/attribution?days=30",
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.totalDownloads, 2);
    assert.equal(body.downloadsWithAttribution, 2);
    assert.equal(body.attributedRegistrations, 1);

    const campaign = body.byCampaign.find((row) => row.utm_campaign === "mothers_day_song");
    assert.ok(campaign, "expected mothers_day_song campaign row");
    assert.equal(campaign.download_count, 2);
    assert.equal(campaign.registration_count, 1);
    assert.equal(campaign.share_count, 0);
    assert.equal(campaign.claim_count, 0);
    assert.equal(
      body.byCampaign.some((row) => row.utm_campaign === "custom_song_gift"),
      false,
      "old download should not be included in a 30-day report"
    );
  });

  test("growth attribution resolves Apple Ads keyword ids to readable keyword names", async () => {
    const userId = "admin_attr_keyword_map";
    await insertUser(db, userId);
    await insertAppleAdsAttribution(db, {
      id: "aaa_admin_attr_keyword_map",
      userId,
      status: "resolved",
      campaignId: 321,
      adGroupId: 654,
      keywordId: 987,
      country: "US",
    });

    const syncResponse = await app.inject({
      method: "POST",
      url: "/admin/dashboard/growth/apple-ads-keyword-map",
      headers: adminHeaders,
      payload: {
        keywords: [{
          keyword_id: "987",
          campaign_id: "321",
          campaign_name: "Porizo - Category US",
          ad_group_id: "654",
          ad_group_name: "High-Intent Keywords",
          keyword_text: "gift song",
          match_type: "EXACT",
          bid_amount: "1.80",
          status: "ENABLED",
        }],
      },
    });
    assert.equal(syncResponse.statusCode, 200, syncResponse.body);
    assert.equal(syncResponse.json().upserted, 1);

    const mapResponse = await app.inject({
      method: "GET",
      url: "/admin/dashboard/growth/apple-ads-keyword-map",
      headers: adminHeaders,
    });
    assert.equal(mapResponse.statusCode, 200, mapResponse.body);
    assert.equal(mapResponse.json().rows[0].keyword_text, "gift song");

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/growth/attribution?days=30",
      headers: adminHeaders,
    });
    assert.equal(response.statusCode, 200, response.body);
    const row = response.json().appleAdsByCampaign[0];
    assert.equal(String(row.campaign_id), "321");
    assert.equal(String(row.ad_group_id), "654");
    assert.equal(String(row.keyword_id), "987");
    assert.equal(row.campaign_name, "Porizo - Category US");
    assert.equal(row.ad_group_name, "High-Intent Keywords");
    assert.equal(row.keyword_text, "gift song");
    assert.equal(row.match_type, "EXACT");
    assert.equal(row.resolved_count, 1);
  });
});
