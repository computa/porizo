process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  computeDailyAggregates,
  getKPITrends,
} = require("../src/jobs/compute-daily-aggregates");

let db;

async function seedUser(id, createdAt) {
  await db
    .prepare("INSERT INTO users (id, created_at, risk_level) VALUES (?, ?, 'low')")
    .run(id, createdAt);
}

async function seedEvent(id, eventName, userId, createdAt) {
  await db
    .prepare(
      `INSERT INTO events (
        id, event_name, user_id, resource_type, resource_id, metadata_json, created_at
      ) VALUES (?, ?, ?, 'test', ?, '{}', ?)`,
    )
    .run(id, eventName, userId, `${id}_resource`, createdAt);
}

async function seedSubscription({
  id,
  userId,
  productId,
  status,
  createdAt,
  originalPurchaseDate = null,
  cancelledAt = null,
}) {
  await db
    .prepare(
      `INSERT INTO subscriptions (
        id, user_id, product_id, tier, status, platform,
        original_purchase_date, created_at, updated_at, cancelled_at
      ) VALUES (?, ?, ?, 'plus', ?, 'ios', ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      productId,
      status,
      originalPurchaseDate,
      createdAt,
      createdAt,
      cancelledAt,
    );
}

async function seedCreditTransaction(id, userId, type, amount, createdAt) {
  await db
    .prepare(
      `INSERT INTO credit_transactions (
        id, user_id, type, amount, balance_before, balance_after, created_at
      ) VALUES (?, ?, ?, ?, 0, 0, ?)`,
    )
    .run(id, userId, type, amount, createdAt);
}

async function seedDailyAggregate({
  id,
  date,
  dau = 0,
  newUsers = 0,
  rendersCompleted = 0,
  sharesCreated = 0,
  revenueCents = 0,
}) {
  await db
    .prepare(
      `INSERT INTO daily_aggregates (
        id, date, dau, wau, mau, new_users,
        active_subscriptions, new_subscriptions, cancellations,
        trial_starts, trial_conversions, revenue_cents,
        renders_started, renders_completed, shares_created,
        shares_claimed, teaser_views, stories_started,
        stories_confirmed, computed_at
      ) VALUES (?, ?, ?, 0, 0, ?, 0, 0, 0, 0, 0, ?, 0, ?, ?, 0, 0, 0, 0, ?)`,
    )
    .run(
      id,
      date,
      dau,
      newUsers,
      revenueCents,
      rendersCompleted,
      sharesCreated,
      `${date}T12:00:00.000Z`,
    );
}

describe("daily aggregate computations", () => {
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

  test("computeDailyAggregates preserves date windows and metric semantics", async () => {
    await seedUser("agg_user_new", "2026-06-26T12:00:00.000Z");
    await seedUser("agg_user_old", "2026-06-10T12:00:00.000Z");
    await seedUser("agg_user_next", "2026-06-27T00:00:00.000Z");

    await seedEvent("agg_evt_render_start", "render_start", "agg_user_new", "2026-06-26T00:00:00.000Z");
    await seedEvent("agg_evt_render_ready", "render_ready", "agg_user_new", "2026-06-26T23:59:59.999Z");
    await seedEvent("agg_evt_share_create", "share_create", "agg_user_new", "2026-06-26T10:00:00.000Z");
    await seedEvent("agg_evt_share_claim", "share_claim", "agg_user_old", "2026-06-26T11:00:00.000Z");
    await seedEvent("agg_evt_teaser", "teaser_viewed", null, "2026-06-26T12:00:00.000Z");
    await seedEvent("agg_evt_story_start", "story_start", "agg_user_old", "2026-06-25T12:00:00.000Z");
    await seedEvent("agg_evt_story_confirm", "story_confirm", "agg_user_old", "2026-06-26T13:00:00.000Z");
    await seedEvent("agg_evt_month", "auth_login", "agg_user_old", "2026-06-01T00:00:00.000Z");
    await seedEvent("agg_evt_too_old", "auth_login", "agg_user_old", "2026-05-26T23:59:59.999Z");

    await seedSubscription({
      id: "agg_sub_active",
      userId: "agg_user_new",
      productId: "plus_monthly",
      status: "active",
      createdAt: "2026-06-26T08:00:00.000Z",
      originalPurchaseDate: "2026-06-26T08:00:00.000Z",
    });
    await seedSubscription({
      id: "agg_sub_cancelled",
      userId: "agg_user_old",
      productId: "plus_annual",
      status: "cancelled",
      createdAt: "2026-06-01T08:00:00.000Z",
      cancelledAt: "2026-06-26T09:00:00.000Z",
    });
    await seedSubscription({
      id: "agg_sub_trial",
      userId: "agg_user_old",
      productId: "trial_monthly",
      status: "trial",
      createdAt: "2026-06-26T10:00:00.000Z",
    });

    await seedCreditTransaction("agg_credit_purchase", "agg_user_new", "purchase", 300, "2026-06-26T12:00:00.000Z");
    await seedCreditTransaction("agg_credit_subscription", "agg_user_new", "subscription", 500, "2026-06-26T13:00:00.000Z");
    await seedCreditTransaction("agg_credit_spend", "agg_user_new", "spend", -100, "2026-06-26T14:00:00.000Z");

    const result = await computeDailyAggregates(db, "2026-06-26");

    assert.equal(result.date, "2026-06-26");
    assert.equal(result.dau, 2);
    assert.equal(result.wau, 2);
    assert.equal(result.mau, 2);
    assert.equal(result.new_users, 1);
    assert.equal(result.active_subscriptions, 1);
    assert.equal(result.new_subscriptions, 2);
    assert.equal(result.cancellations, 1);
    assert.equal(result.trial_starts, 1);
    assert.equal(result.trial_conversions, 1);
    assert.equal(result.revenue_cents, 800);
    assert.equal(result.renders_started, 1);
    assert.equal(result.renders_completed, 1);
    assert.equal(result.shares_created, 1);
    assert.equal(result.shares_claimed, 1);
    assert.equal(result.teaser_views, 1);
    assert.equal(result.stories_started, 0);
    assert.equal(result.stories_confirmed, 1);

    const stored = await db
      .prepare("SELECT * FROM daily_aggregates WHERE date = ?")
      .get("2026-06-26");
    assert.equal(stored.id, result.id);
    assert.equal(stored.revenue_cents, 800);
  });

  test("computeDailyAggregates updates an existing aggregate id", async () => {
    await seedDailyAggregate({
      id: "agg_existing",
      date: "2026-06-26",
      dau: 99,
    });
    await seedEvent("agg_evt_existing", "render_start", "agg_user_new", "2026-06-26T12:00:00.000Z");

    const result = await computeDailyAggregates(db, "2026-06-26");

    assert.equal(result.id, "agg_existing");
    assert.equal(result.dau, 1);
    assert.equal(result.renders_started, 1);
  });

  test("getKPITrends returns weekly totals and percent changes", async () => {
    await seedDailyAggregate({
      id: "agg_this_week",
      date: "2026-06-26",
      dau: 10,
      newUsers: 4,
      rendersCompleted: 8,
      sharesCreated: 2,
      revenueCents: 1000,
    });
    await seedDailyAggregate({
      id: "agg_last_week",
      date: "2026-06-15",
      dau: 5,
      newUsers: 2,
      rendersCompleted: 4,
      sharesCreated: 1,
      revenueCents: 500,
    });

    const trends = await getKPITrends(db);

    assert.equal(Number(trends.thisWeek.total_dau), 10);
    assert.equal(Number(trends.lastWeek.total_dau), 5);
    assert.deepEqual(trends.changes, {
      dau: "100.0",
      newUsers: "100.0",
      renders: "100.0",
      shares: "100.0",
      revenue: "100.0",
    });
  });
});
