process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  buildUserSearchFilter,
  createAdminUserReadRepository,
} = require("../src/database/admin-user-read-repository");
const { AdminService } = require("../src/services/admin-service");

const NOW = "2026-06-27T10:00:00.000Z";

let db;
let repository;

async function seedUser({
  id,
  email = `${id}@example.com`,
  displayName = id,
  riskLevel = "low",
  createdAt = NOW,
  country = "AU",
}) {
  await db
    .prepare(
      `INSERT INTO users (
        id, email, display_name, created_at, risk_level, country
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, email, displayName, createdAt, riskLevel, country);
}

async function seedEntitlement({
  userId,
  tier = "free",
  giftSongsUsedTotal = 0,
  updatedAt = NOW,
}) {
  await db
    .prepare(
      `INSERT INTO entitlements (
        user_id, tier, credits_balance, credits_used_total, gift_songs_used_total, updated_at
      ) VALUES (?, ?, 0, 0, ?, ?)`,
    )
    .run(userId, tier, giftSongsUsedTotal, updatedAt);
}

async function seedVoiceProfile({
  id,
  userId,
  status = "active",
  qualityScore = 0.9,
  createdAt = NOW,
  deletedAt = null,
}) {
  await db
    .prepare(
      `INSERT INTO voice_profiles (
        id, user_id, status, quality_score, created_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, userId, status, qualityScore, createdAt, deletedAt);
}

async function seedTrack({
  userId,
  trackId,
  title = "Repository User Song",
  recipientName = "Ada",
  occasion = "birthday",
  status = "complete",
  createdAt = NOW,
}) {
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

async function seedShare({
  shareId,
  trackId,
  versionId = `${trackId}_v1`,
  creatorId,
  status = "claimed",
  createdAt = NOW,
}) {
  await db
    .prepare(
      `INSERT INTO share_tokens (
        id, track_id, track_version_id, creator_id, status, expires_at, created_at, access_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 7)`,
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

describe("AdminUserReadRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAdminUserReadRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("buildUserSearchFilter escapes LIKE wildcards and preserves free-tier semantics", () => {
    const filter = buildUserSearchFilter({
      email: "ada_%\\test",
      recipientName: "Lovelace_%",
      tier: "free",
    });

    assert.match(filter.whereSql, /u\.email LIKE \? ESCAPE/);
    assert.match(filter.whereSql, /recipient_name LIKE \? ESCAPE/);
    assert.match(filter.whereSql, /\(e\.tier = 'free' OR e\.tier IS NULL\)/);
    assert.deepEqual(filter.params, ["%ada\\_\\%\\\\test%", "%Lovelace\\_\\%%"]);
  });

  test("searchUsers preserves filters, selected metrics, count, and ordering", async () => {
    const ownerId = "repo_user_read_owner";
    await seedUser({
      id: ownerId,
      email: "owner@example.com",
      displayName: "Owner",
      riskLevel: "medium",
      createdAt: "2026-06-20T10:00:00.000Z",
    });
    await seedEntitlement({
      userId: ownerId,
      tier: "plus",
      giftSongsUsedTotal: 5,
    });
    await seedVoiceProfile({
      id: "repo_voice_deleted",
      userId: ownerId,
      status: "deleted",
      deletedAt: "2026-06-26T10:00:00.000Z",
    });
    await seedVoiceProfile({
      id: "repo_voice_active",
      userId: ownerId,
      status: "ready",
      qualityScore: 0.84,
    });
    const matchingTrack = await seedTrack({
      userId: ownerId,
      trackId: "repo_user_read_track_new",
      recipientName: "Ada Lovelace",
      createdAt: "2026-06-26T11:00:00.000Z",
    });
    await seedTrack({
      userId: ownerId,
      trackId: "repo_user_read_track_old",
      recipientName: "Maya",
      createdAt: "2026-06-25T11:00:00.000Z",
    });
    await seedShare({
      shareId: "repo_user_read_share",
      trackId: matchingTrack.trackId,
      versionId: matchingTrack.versionId,
      creatorId: ownerId,
      createdAt: "2026-06-26T12:00:00.000Z",
    });
    await seedUser({
      id: "repo_user_read_other",
      email: "other@example.com",
      displayName: "Other",
      createdAt: "2026-06-27T10:00:00.000Z",
    });
    await seedEntitlement({
      userId: "repo_user_read_other",
      tier: "free",
    });

    const result = await repository.searchUsers({
      email: "owner",
      riskLevel: "medium",
      tier: "plus",
      trackId: matchingTrack.trackId,
      shareId: "repo_user_read_share",
      recipientName: "Lovelace",
      limit: 10,
      offset: 0,
    });

    assert.equal(result.total, 1);
    assert.deepEqual(result.users, [
      {
        id: ownerId,
        email: "owner@example.com",
        display_name: "Owner",
        risk_level: "medium",
        locked_until: null,
        created_at: "2026-06-20T10:00:00.000Z",
        country: "AU",
        acquisition_source: null,
        acquisition_medium: null,
        acquisition_campaign: null,
        acquisition_content: null,
        acquisition_term: null,
        acquisition_country: null,
        acquisition_referrer: null,
        acquisition_at: null,
        tier: "plus",
        gift_songs_used_total: 5,
        track_count: 2,
        voice_status: "ready",
        last_active: "2026-06-26T11:00:00.000Z",
      },
    ]);
  });

  test("searchUsers collapses duplicate live voice profiles deterministically", async () => {
    const userId = "repo_user_read_duplicate_voice";
    await seedUser({
      id: userId,
      email: "duplicate-voice@example.com",
      createdAt: "2026-06-26T10:00:00.000Z",
    });
    await seedVoiceProfile({
      id: "repo_voice_live_old",
      userId,
      status: "old_live",
      createdAt: "2026-06-24T10:00:00.000Z",
    });
    await seedVoiceProfile({
      id: "repo_voice_live_new",
      userId,
      status: "new_live",
      createdAt: "2026-06-25T10:00:00.000Z",
    });

    const result = await repository.searchUsers({
      userId,
      limit: 10,
      offset: 0,
    });

    assert.equal(result.total, 1);
    assert.equal(result.users.length, 1);
    assert.equal(result.users[0].id, userId);
    assert.equal(result.users[0].voice_status, "new_live");
    assert.deepEqual(await repository.getUserVoiceProfile(userId), {
      id: "repo_voice_live_new",
      status: "new_live",
      quality_score: 0.9,
      created_at: "2026-06-25T10:00:00.000Z",
    });
  });

  test("searchUsers includes users without entitlement rows for free tier", async () => {
    await seedUser({
      id: "repo_user_read_free",
      email: "free@example.com",
    });
    await seedUser({
      id: "repo_user_read_paid",
      email: "paid@example.com",
    });
    await seedEntitlement({
      userId: "repo_user_read_paid",
      tier: "pro",
    });

    const result = await repository.searchUsers({
      tier: "free",
      limit: 20,
      offset: 0,
    });

    assert.equal(result.total, 1);
    assert.deepEqual(
      result.users.map((user) => user.id),
      ["repo_user_read_free"],
    );
    assert.equal(result.users[0].tier, "free");
  });

  test("getUserStats returns tier counts and normalizes empty sums", async () => {
    assert.deepEqual(await repository.getUserStats(), {
      totalUsers: 0,
      paidUsers: 0,
      trialUsers: 0,
      freeUsers: 0,
    });

    await seedUser({
      id: "repo_user_stats_missing_entitlement",
      email: "stats-missing@example.com",
    });
    await seedUser({
      id: "repo_user_stats_free",
      email: "stats-free@example.com",
    });
    await seedEntitlement({
      userId: "repo_user_stats_free",
      tier: "free",
    });
    await seedUser({
      id: "repo_user_stats_trial",
      email: "stats-trial@example.com",
    });
    await seedEntitlement({
      userId: "repo_user_stats_trial",
      tier: "trial",
    });
    await seedUser({
      id: "repo_user_stats_pro",
      email: "stats-pro@example.com",
    });
    await seedEntitlement({
      userId: "repo_user_stats_pro",
      tier: "pro",
    });
    await seedUser({
      id: "repo_user_stats_plus",
      email: "stats-plus@example.com",
    });
    await seedEntitlement({
      userId: "repo_user_stats_plus",
      tier: "plus",
    });

    assert.deepEqual(await repository.getUserStats(), {
      totalUsers: 5,
      paidUsers: 2,
      trialUsers: 1,
      freeUsers: 2,
    });
  });

  test("getUserStats preserves stored-tier-only semantics", async () => {
    await seedUser({
      id: "repo_user_stats_admin_upgrade",
      email: "stats-admin-upgrade@example.com",
    });
    await seedEntitlement({
      userId: "repo_user_stats_admin_upgrade",
      tier: "free",
    });
    await db
      .prepare(
        "UPDATE entitlements SET admin_upgrade_tier = 'pro', admin_upgrade_expires_at = ? WHERE user_id = ?",
      )
      .run("2026-07-27T10:00:00.000Z", "repo_user_stats_admin_upgrade");

    await seedUser({
      id: "repo_user_stats_legacy_premium",
      email: "stats-legacy-premium@example.com",
    });
    await seedEntitlement({
      userId: "repo_user_stats_legacy_premium",
      tier: "premium",
    });

    assert.deepEqual(await repository.getUserStats(), {
      totalUsers: 2,
      paidUsers: 0,
      trialUsers: 0,
      freeUsers: 1,
    });
  });

  test("detail read methods preserve latest and related-row behavior", async () => {
    const userId = "repo_user_read_detail";
    await seedUser({
      id: userId,
      email: "detail@example.com",
      displayName: "Detail",
    });
    await seedEntitlement({
      userId,
      tier: "plus",
      giftSongsUsedTotal: 2,
    });
    await seedVoiceProfile({
      id: "repo_detail_voice_deleted",
      userId,
      status: "deleted",
      deletedAt: "2026-06-26T10:00:00.000Z",
    });
    await seedVoiceProfile({
      id: "repo_detail_voice_active",
      userId,
      status: "ready",
      qualityScore: 0.82,
    });
    await db
      .prepare(
        `INSERT INTO subscriptions (
          id, user_id, product_id, tier, status, platform, created_at, updated_at
        ) VALUES
          ('repo_sub_old', ?, 'old_product', 'plus', 'cancelled', 'ios', '2026-06-20T10:00:00.000Z', ?),
          ('repo_sub_new', ?, 'new_product', 'plus', 'active', 'ios', '2026-06-26T10:00:00.000Z', ?)`,
      )
      .run(userId, NOW, userId, NOW);
    const newestTrack = await seedTrack({
      userId,
      trackId: "repo_detail_track_new",
      title: "Newest Detail Song",
      createdAt: "2026-06-26T11:00:00.000Z",
    });
    await seedTrack({
      userId,
      trackId: "repo_detail_track_old",
      title: "Old Detail Song",
      createdAt: "2026-06-25T11:00:00.000Z",
    });
    await seedShare({
      shareId: "repo_detail_share",
      trackId: newestTrack.trackId,
      versionId: newestTrack.versionId,
      creatorId: userId,
      createdAt: "2026-06-26T12:00:00.000Z",
    });
    await db
      .prepare(
        `INSERT INTO download_events (
          id, ip_address, user_agent, utm_source, utm_medium, utm_campaign,
          utm_content, utm_term, country, referrer_url, matched_user_id, created_at
        ) VALUES
          ('repo_download_old', '203.0.113.8', 'agent', 'old', 'landing', 'old_campaign', 'hero', 'gift', 'AU', 'https://old.example', ?, '2026-06-25T13:00:00.000Z'),
          ('repo_download_new', '203.0.113.9', 'agent', 'seo', 'landing', 'birthday_song', 'hero', 'gift', 'AU', 'https://new.example', ?, '2026-06-26T13:00:00.000Z')`,
      )
      .run(userId, userId);
    await db
      .prepare(
        `INSERT INTO apple_ads_attribution (
          id, user_id, attribution_token_sha256, token_length, status,
          api_status_code, campaign_id, ad_group_id, keyword_id,
          country_or_region, created_at, updated_at, resolved_at
        ) VALUES
          ('repo_apple_old', ?, 'apple_old_hash', 64, 'resolved', 200, 111, 222, 333, 'AU', '2026-06-25T14:00:00.000Z', ?, ?),
          ('repo_apple_pending', ?, 'apple_pending_hash', 64, 'pending', 200, 444, 555, 666, 'AU', '2026-06-27T14:00:00.000Z', ?, ?),
          ('repo_apple_new', ?, 'apple_new_hash', 64, 'resolved', 200, 777, 888, 999, 'AU', '2026-06-26T14:00:00.000Z', ?, ?)`,
      )
      .run(userId, NOW, NOW, userId, NOW, NOW, userId, NOW, NOW);

    assert.equal((await repository.getUserById(userId)).email, "detail@example.com");
    assert.deepEqual(await repository.getUserVoiceProfile(userId), {
      id: "repo_detail_voice_active",
      status: "ready",
      quality_score: 0.82,
      created_at: NOW,
    });
    assert.equal((await repository.getUserEntitlements(userId)).tier, "plus");
    assert.equal((await repository.getLatestUserSubscription(userId)).id, "repo_sub_new");
    assert.deepEqual(
      (await repository.listUserTracks(userId)).map((track) => track.id),
      ["repo_detail_track_new", "repo_detail_track_old"],
    );
    assert.deepEqual(await repository.listUserShares(userId), [
      {
        id: "repo_detail_share",
        status: "claimed",
        access_count: 7,
        title: "Newest Detail Song",
      },
    ]);
    assert.equal(
      (await repository.getLatestUserDownloadAttribution(userId)).id,
      "repo_download_new",
    );
    assert.equal(
      (await repository.getLatestResolvedAppleAdsAttribution(userId)).id,
      "repo_apple_new",
    );
  });
});

describe("AdminService user-read repository boundary", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("searchUsers delegates bounded filters and attaches attribution", async () => {
    let capturedFilters;
    const service = new AdminService(db, {
      adminUserReadRepository: {
        async searchUsers(filters) {
          capturedFilters = filters;
          return {
            users: [{ id: "service_user", acquisition_source: "direct" }],
            total: 1,
          };
        },
      },
      attributionService: {
        async attachAttributionToUsers(users) {
          return users.map((user) => ({ ...user, attribution: "attached" }));
        },
      },
    });

    const result = await service.searchUsers({
      email: "owner",
      userId: "service_user",
      riskLevel: "medium",
      tier: "plus",
      trackId: "service_track",
      shareId: "service_share",
      recipientName: "Ada",
      limit: 500,
      offset: -20,
    });

    assert.deepEqual(capturedFilters, {
      email: "owner",
      userId: "service_user",
      riskLevel: "medium",
      tier: "plus",
      trackId: "service_track",
      shareId: "service_share",
      recipientName: "Ada",
      limit: 100,
      offset: 0,
    });
    assert.deepEqual(result, {
      users: [
        {
          id: "service_user",
          acquisition_source: "direct",
          attribution: "attached",
        },
      ],
      total: 1,
      limit: 100,
      offset: 0,
    });
  });

  test("getUserStats delegates stats reads and preserves conversion formatting", async () => {
    const service = new AdminService(db, {
      adminUserReadRepository: {
        async getUserStats() {
          return {
            totalUsers: 6,
            paidUsers: 2,
            trialUsers: 1,
            freeUsers: 3,
          };
        },
      },
    });

    assert.deepEqual(await service.getUserStats(), {
      totalUsers: 6,
      paidUsers: 2,
      trialUsers: 1,
      freeUsers: 3,
      conversionRate: "33.3",
    });
  });

  test("getUserStats preserves zero-user conversion formatting", async () => {
    const service = new AdminService(db, {
      adminUserReadRepository: {
        async getUserStats() {
          return {
            totalUsers: 0,
            paidUsers: 0,
            trialUsers: 0,
            freeUsers: 0,
          };
        },
      },
    });

    assert.deepEqual(await service.getUserStats(), {
      totalUsers: 0,
      paidUsers: 0,
      trialUsers: 0,
      freeUsers: 0,
      conversionRate: "0.0",
    });
  });

  test("getUserDetail delegates all reads and merges canonical attribution", async () => {
    const calls = [];
    const service = new AdminService(db, {
      adminUserReadRepository: {
        async getUserById(userId) {
          calls.push(["getUserById", userId]);
          return { id: userId, acquisition_source: "direct" };
        },
        async getUserVoiceProfile(userId) {
          calls.push(["getUserVoiceProfile", userId]);
          return { id: "voice" };
        },
        async getUserEntitlements(userId) {
          calls.push(["getUserEntitlements", userId]);
          return { tier: "plus" };
        },
        async getLatestUserSubscription(userId) {
          calls.push(["getLatestUserSubscription", userId]);
          return { id: "subscription" };
        },
        async listUserTracks(userId) {
          calls.push(["listUserTracks", userId]);
          return [{ id: "track" }];
        },
        async listUserShares(userId) {
          calls.push(["listUserShares", userId]);
          return [{ id: "share" }];
        },
        async getLatestUserDownloadAttribution(userId) {
          calls.push(["getLatestUserDownloadAttribution", userId]);
          return { id: "download" };
        },
        async getLatestResolvedAppleAdsAttribution(userId) {
          calls.push(["getLatestResolvedAppleAdsAttribution", userId]);
          return { id: "apple" };
        },
      },
      attributionService: {
        async getUserAttribution(user) {
          calls.push(["getUserAttribution", user.id]);
          return { acquisition_source: "seo", acquisition_medium: "landing" };
        },
      },
    });

    const result = await service.getUserDetail("service_detail_user");

    assert.deepEqual(result, {
      user: {
        id: "service_detail_user",
        acquisition_source: "seo",
        acquisition_medium: "landing",
      },
      voiceProfile: { id: "voice" },
      entitlements: { tier: "plus" },
      subscription: { id: "subscription" },
      tracks: [{ id: "track" }],
      shares: [{ id: "share" }],
      attribution: { id: "download" },
      appleAdsAttribution: { id: "apple" },
    });
    assert.deepEqual(calls, [
      ["getUserById", "service_detail_user"],
      ["getUserVoiceProfile", "service_detail_user"],
      ["getUserEntitlements", "service_detail_user"],
      ["getLatestUserSubscription", "service_detail_user"],
      ["listUserTracks", "service_detail_user"],
      ["listUserShares", "service_detail_user"],
      ["getLatestUserDownloadAttribution", "service_detail_user"],
      ["getLatestResolvedAppleAdsAttribution", "service_detail_user"],
      ["getUserAttribution", "service_detail_user"],
    ]);
  });

  test("getUserDetail returns null without fan-out when user is missing", async () => {
    let fanOutCalled = false;
    const service = new AdminService(db, {
      adminUserReadRepository: {
        async getUserById() {
          return null;
        },
        async getUserVoiceProfile() {
          fanOutCalled = true;
        },
      },
      attributionService: {
        async getUserAttribution() {
          fanOutCalled = true;
        },
      },
    });

    assert.equal(await service.getUserDetail("missing_service_user"), null);
    assert.equal(fanOutCalled, false);
  });
});
