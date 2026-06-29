require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAdminMetricsRepository,
} = require("../src/database/admin-metrics-repository");
const {
  createAdminMetricsService,
} = require("../src/services/admin/metrics-service");

const NOW = "2026-06-27T10:00:00.000Z";
const WEEK_AGO = "2026-06-20T10:00:00.000Z";
const THIRTY_DAYS_AGO = "2026-05-28T10:00:00.000Z";

function createGrowthMetricsService(adminMetricsRepository) {
  return createAdminMetricsService({
    adminMetricsRepository,
    now: () => new Date(NOW),
  });
}

async function seedEvent(db, id, eventName, createdAt) {
  await db
    .prepare(
      `INSERT INTO events (
        id, event_name, user_id, resource_type, resource_id, metadata_json, created_at
      ) VALUES (?, ?, NULL, NULL, NULL, NULL, ?)`,
    )
    .run(id, eventName, createdAt);
}

async function seedShare(db, fields) {
  await db
    .prepare(
      `INSERT INTO share_tokens (
        id, track_id, track_version_id, creator_id, status, bound_at,
        expires_at, created_at, access_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fields.id,
      fields.trackId ?? `${fields.id}_track`,
      fields.trackVersionId ?? `${fields.id}_version`,
      fields.creatorId ?? "growth_repo_user",
      fields.status ?? "active",
      fields.boundAt ?? null,
      fields.expiresAt ?? "2026-07-27T10:00:00.000Z",
      fields.createdAt ?? NOW,
      fields.accessCount ?? 0,
    );
}

describe("admin growth metrics repository", () => {
  let db;
  let repository;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAdminMetricsRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("teaser metrics count events and daily teaser views after the window", async () => {
    const daysAgo = "2026-06-20T10:00:00.000Z";
    await seedEvent(db, "growth_repo_teaser_1", "teaser_viewed", "2026-06-21T08:00:00.000Z");
    await seedEvent(db, "growth_repo_teaser_2", "teaser_viewed", "2026-06-21T09:00:00.000Z");
    await seedEvent(db, "growth_repo_claim", "share_claim", "2026-06-22T08:00:00.000Z");
    await seedEvent(db, "growth_repo_stream", "share_stream", "2026-06-23T08:00:00.000Z");
    await seedEvent(db, "growth_repo_old", "teaser_viewed", "2026-06-19T08:00:00.000Z");

    const result = await repository.getTeaserMetrics({ daysAgo });

    assert.equal(result.teaserViews, 2);
    assert.equal(result.shareClaims, 1);
    assert.equal(result.shareStreams, 1);
    assert.deepEqual(result.dailyViews, [{ date: "2026-06-21", count: 2 }]);
  });

  test("share metrics count created/claimed/status, average access, and daily trend", async () => {
    const daysAgo = "2026-06-20T10:00:00.000Z";
    await seedShare(db, {
      id: "growth_repo_share_claimed",
      status: "claimed",
      boundAt: "2026-06-22T10:00:00.000Z",
      createdAt: "2026-06-21T08:00:00.000Z",
      accessCount: 4,
    });
    await seedShare(db, {
      id: "growth_repo_share_active",
      status: "active",
      createdAt: "2026-06-21T09:00:00.000Z",
      accessCount: 2,
    });
    await seedShare(db, {
      id: "growth_repo_share_old",
      status: "claimed",
      boundAt: "2026-06-22T10:00:00.000Z",
      createdAt: "2026-06-19T08:00:00.000Z",
      accessCount: 100,
    });

    const result = await repository.getShareMetrics({ daysAgo });

    assert.equal(result.created, 2);
    assert.equal(result.claimed, 2);
    assert.deepEqual(
      Object.fromEntries(result.byStatus.map((row) => [row.status, row.count])),
      { active: 1, claimed: 1 },
    );
    assert.equal(result.avgAccess, 3);
    assert.deepEqual(result.dailyCreated, [{ date: "2026-06-21", count: 2 }]);
  });
});

describe("admin growth metrics service", () => {
  test("teaser metrics delegate the cutoff and format conversion rates", async () => {
    const calls = [];
    const service = createGrowthMetricsService({
      async getTeaserMetrics({ daysAgo }) {
        calls.push({ daysAgo });
        return {
          teaserViews: 4,
          shareClaims: 1,
          shareStreams: 2,
          dailyViews: [{ date: "2026-06-21", count: 4 }],
        };
      },
    });

    const result = await service.getTeaserMetrics(7);

    assert.deepEqual(calls, [{ daysAgo: WEEK_AGO }]);
    assert.deepEqual(result, {
      teaserViews: 4,
      shareClaims: 1,
      shareStreams: 2,
      viewToClaimRate: "25.00",
      viewToStreamRate: "50.00",
      dailyViews: [{ date: "2026-06-21", count: 4 }],
    });
  });

  test("share metrics delegate the cutoff and format aggregate rates", async () => {
    const calls = [];
    const service = createGrowthMetricsService({
      async getShareMetrics({ daysAgo }) {
        calls.push({ daysAgo });
        return {
          created: 4,
          claimed: 3,
          byStatus: [{ status: "claimed", count: 3 }],
          avgAccess: 2.25,
          dailyCreated: [{ date: "2026-06-21", count: 4 }],
        };
      },
    });

    const result = await service.getShareMetrics(30);

    assert.deepEqual(calls, [{ daysAgo: THIRTY_DAYS_AGO }]);
    assert.deepEqual(result, {
      created: 4,
      claimed: 3,
      claimRate: "75.00",
      byStatus: [{ status: "claimed", count: 3 }],
      avgAccessCount: "2.3",
      dailyCreated: [{ date: "2026-06-21", count: 4 }],
    });
  });

});
