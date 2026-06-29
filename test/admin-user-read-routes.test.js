require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");

const NOW = "2026-06-27T10:00:00.000Z";

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
  assert.equal(response.statusCode, 200, response.body);
  return { Authorization: `Bearer ${response.json().token}` };
}

async function seedUser(
  db,
  {
    id,
    email = `${id}@example.com`,
    displayName = id,
    riskLevel = "low",
    createdAt = NOW,
    country = "AU",
  },
) {
  await db
    .prepare(
      `INSERT INTO users (
        id, email, display_name, created_at, risk_level, country
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, email, displayName, createdAt, riskLevel, country);
}

async function seedEntitlement(
  db,
  {
    userId,
    tier = "free",
    giftSongsUsedTotal = 0,
    updatedAt = NOW,
  },
) {
  await db
    .prepare(
      `INSERT INTO entitlements (
        user_id, tier, gift_songs_used_total, updated_at
      ) VALUES (?, ?, ?, ?)`,
    )
    .run(userId, tier, giftSongsUsedTotal, updatedAt);
}

async function seedTrack(
  db,
  {
    userId,
    trackId,
    title = "Admin User Song",
    recipientName = "Ada",
    occasion = "birthday",
    status = "complete",
    createdAt = NOW,
  },
) {
  await db
    .prepare(
      `INSERT INTO tracks (
        id, user_id, status, title, occasion, recipient_name, style, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pop', ?, ?)`,
    )
    .run(trackId, userId, status, title, occasion, recipientName, createdAt, createdAt);
  await db
    .prepare(
      `INSERT INTO track_versions (
        id, track_id, version_num, status, render_type, params_hash, created_at
      ) VALUES (?, ?, 1, 'complete', 'full', ?, ?)`,
    )
    .run(`${trackId}_v1`, trackId, `${trackId}_hash`, createdAt);
  return { trackId, versionId: `${trackId}_v1` };
}

async function seedShare(
  db,
  {
    shareId,
    trackId,
    versionId = `${trackId}_v1`,
    creatorId,
    status = "claimed",
    createdAt = NOW,
  },
) {
  await db
    .prepare(
      `INSERT INTO share_tokens (
        id, track_id, track_version_id, creator_id, status, expires_at, created_at, access_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 4)`,
    )
    .run(
      shareId,
      trackId,
      versionId,
      creatorId,
      status,
      "2026-07-27T10:00:00.000Z",
      createdAt,
    );
}

describe("admin user read routes", () => {
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
    adminHeaders = await loginAdmin(app);
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("user stats requires an admin session", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/users/stats",
    });

    assert.equal(response.statusCode, 401, response.body);
    assert.equal(response.json().error, "UNAUTHORIZED");
  });

  test("search users preserves filters, metrics, and pagination metadata", async () => {
    const userId = "admin_user_read_owner";
    await seedUser(db, {
      id: userId,
      email: "owner@example.com",
      displayName: "Owner",
      riskLevel: "medium",
      createdAt: "2026-06-20T10:00:00.000Z",
    });
    await seedEntitlement(db, {
      userId,
      tier: "pro",
      giftSongsUsedTotal: 3,
    });
    await db
      .prepare(
        `INSERT INTO voice_profiles (
          id, user_id, status, quality_score, created_at
        ) VALUES ('voice_owner', ?, 'active', 0.91, ?)`,
      )
      .run(userId, NOW);
    const track = await seedTrack(db, {
      userId,
      trackId: "admin_user_read_track",
      recipientName: "Ada Lovelace",
      createdAt: "2026-06-25T10:00:00.000Z",
    });
    await seedTrack(db, {
      userId,
      trackId: "admin_user_read_track_older",
      recipientName: "Maya",
      createdAt: "2026-06-24T10:00:00.000Z",
    });
    await seedShare(db, {
      shareId: "admin_user_read_share",
      trackId: track.trackId,
      versionId: track.versionId,
      creatorId: userId,
    });

    await seedUser(db, {
      id: "admin_user_read_other",
      email: "other@example.com",
      displayName: "Other",
      createdAt: "2026-06-26T10:00:00.000Z",
    });
    await seedEntitlement(db, {
      userId: "admin_user_read_other",
      tier: "free",
    });

    const response = await app.inject({
      method: "GET",
      url:
        "/admin/dashboard/users" +
        "?email=owner" +
        "&riskLevel=medium" +
        "&tier=pro" +
        `&trackId=${track.trackId}` +
        "&shareId=admin_user_read_share" +
        "&recipientName=Lovelace" +
        "&limit=5&offset=0",
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.total, 1);
    assert.equal(body.limit, 5);
    assert.equal(body.offset, 0);
    assert.equal(body.users.length, 1);
    assert.equal(body.users[0].id, userId);
    assert.equal(body.users[0].email, "owner@example.com");
    assert.equal(body.users[0].tier, "pro");
    assert.equal(body.users[0].gift_songs_used_total, 3);
    assert.equal(body.users[0].track_count, 2);
    assert.equal(body.users[0].voice_status, "active");
    assert.equal(body.users[0].last_active, "2026-06-25T10:00:00.000Z");
  });

  test("free-tier search includes users without entitlement rows", async () => {
    await seedUser(db, {
      id: "admin_user_read_free",
      email: "free@example.com",
      displayName: "Free",
    });
    await seedUser(db, {
      id: "admin_user_read_paid",
      email: "paid@example.com",
      displayName: "Paid",
    });
    await seedEntitlement(db, {
      userId: "admin_user_read_paid",
      tier: "plus",
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/users?tier=free",
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    const ids = response.json().users.map((user) => user.id);
    assert.ok(ids.includes("admin_user_read_free"));
    assert.ok(!ids.includes("admin_user_read_paid"));
  });

  test("user stats preserves tier counts and conversion rate", async () => {
    await seedUser(db, {
      id: "admin_user_stats_missing_entitlement",
      email: "stats-missing@example.com",
    });
    await seedUser(db, {
      id: "admin_user_stats_free",
      email: "stats-free@example.com",
    });
    await seedEntitlement(db, {
      userId: "admin_user_stats_free",
      tier: "free",
    });
    await seedUser(db, {
      id: "admin_user_stats_trial",
      email: "stats-trial@example.com",
    });
    await seedEntitlement(db, {
      userId: "admin_user_stats_trial",
      tier: "trial",
    });
    await seedUser(db, {
      id: "admin_user_stats_pro",
      email: "stats-pro@example.com",
    });
    await seedEntitlement(db, {
      userId: "admin_user_stats_pro",
      tier: "pro",
    });
    await seedUser(db, {
      id: "admin_user_stats_plus",
      email: "stats-plus@example.com",
    });
    await seedEntitlement(db, {
      userId: "admin_user_stats_plus",
      tier: "plus",
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/users/stats",
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {
      totalUsers: 5,
      paidUsers: 2,
      trialUsers: 1,
      freeUsers: 2,
      conversionRate: "40.0",
    });
  });

  test("user detail returns related rows and latest attribution reads", async () => {
    const userId = "admin_user_read_detail";
    await seedUser(db, {
      id: userId,
      email: "detail@example.com",
      displayName: "Detail",
    });
    await seedEntitlement(db, {
      userId,
      tier: "plus",
      giftSongsUsedTotal: 2,
    });
    await db
      .prepare(
        `INSERT INTO voice_profiles (
          id, user_id, status, quality_score, created_at
        ) VALUES ('voice_detail', ?, 'ready', 0.82, ?)`,
      )
      .run(userId, NOW);
    await db
      .prepare(
        `INSERT INTO subscriptions (
          id, user_id, product_id, tier, status, platform, created_at, updated_at
        ) VALUES
          ('sub_detail_old', ?, 'old_product', 'plus', 'cancelled', 'ios', '2026-06-20T10:00:00.000Z', ?),
          ('sub_detail_new', ?, 'new_product', 'plus', 'active', 'ios', '2026-06-26T10:00:00.000Z', ?)`,
      )
      .run(userId, NOW, userId, NOW);
    const newerTrack = await seedTrack(db, {
      userId,
      trackId: "admin_user_read_detail_new_track",
      title: "Newest Detail Song",
      createdAt: "2026-06-26T11:00:00.000Z",
    });
    await seedTrack(db, {
      userId,
      trackId: "admin_user_read_detail_old_track",
      title: "Old Detail Song",
      createdAt: "2026-06-25T11:00:00.000Z",
    });
    await seedShare(db, {
      shareId: "admin_user_read_detail_share",
      trackId: newerTrack.trackId,
      versionId: newerTrack.versionId,
      creatorId: userId,
      createdAt: "2026-06-26T12:00:00.000Z",
    });
    await db
      .prepare(
        `INSERT INTO download_events (
          id, ip_address, user_agent, utm_source, utm_medium, utm_campaign,
          utm_content, utm_term, country, referrer_url, matched_user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "download_detail",
        "203.0.113.7",
        "test-agent",
        "seo",
        "landing",
        "birthday_song",
        "hero",
        "gift",
        "AU",
        "https://porizo.co/birthday-song",
        userId,
        "2026-06-26T13:00:00.000Z",
      );
    await db
      .prepare(
        `INSERT INTO apple_ads_attribution (
          id, user_id, attribution_token_sha256, token_length, status,
          api_status_code, campaign_id, ad_group_id, keyword_id,
          country_or_region, created_at, updated_at, resolved_at
        ) VALUES (?, ?, ?, 64, 'resolved', 200, 123, 456, 789, 'AU', ?, ?, ?)`,
      )
      .run(
        "apple_detail",
        userId,
        "apple_detail_hash",
        "2026-06-26T14:00:00.000Z",
        "2026-06-26T14:00:00.000Z",
        "2026-06-26T14:00:00.000Z",
      );

    const response = await app.inject({
      method: "GET",
      url: `/admin/dashboard/users/${userId}`,
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.user.id, userId);
    assert.equal(body.user.acquisition_source, "seo");
    assert.equal(body.voiceProfile.id, "voice_detail");
    assert.equal(body.entitlements.tier, "plus");
    assert.equal(body.subscription.id, "sub_detail_new");
    assert.deepEqual(
      body.tracks.map((track) => track.id),
      ["admin_user_read_detail_new_track", "admin_user_read_detail_old_track"],
    );
    assert.deepEqual(body.shares, [
      {
        id: "admin_user_read_detail_share",
        status: "claimed",
        access_count: 4,
        title: "Newest Detail Song",
      },
    ]);
    assert.equal(body.attribution.id, "download_detail");
    assert.equal(body.appleAdsAttribution.id, "apple_detail");
  });

  test("missing user detail preserves 404 envelope", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/users/missing-user",
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 404, response.body);
    assert.equal(response.json().error, "NOT_FOUND");
  });
});
