process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAdminBillingRepository,
} = require("../src/database/admin-billing-repository");

async function seedUser(db, id, { email = `${id}@example.com`, name = id } = {}) {
  await db
    .prepare(
      "INSERT INTO users (id, email, display_name, created_at, risk_level) VALUES (?, ?, ?, ?, 'low')",
    )
    .run(id, email, name, "2026-06-01T00:00:00.000Z");
}

async function seedSubscription(
  db,
  id,
  userId,
  { status = "active", productId = "com.porizo.plus_monthly", expiresAt, gracePeriodExpiresAt, updatedAt } = {},
) {
  await db
    .prepare(
      `INSERT INTO subscriptions (
        id, user_id, product_id, tier, status, platform,
        original_transaction_id, latest_transaction_id, original_purchase_date,
        expires_at, auto_renew_enabled, grace_period_expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'plus', ?, 'apple', ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      productId,
      status,
      `orig_${id}`,
      `tx_${id}`,
      "2026-06-01T00:00:00.000Z",
      expiresAt,
      gracePeriodExpiresAt || null,
      "2026-06-01T00:00:00.000Z",
      updatedAt || "2026-06-01T00:00:00.000Z",
    );
}

describe("AdminBillingRepository", () => {
  let db;
  let repo;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repo = createAdminBillingRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("lists gift bundle and plan product catalog rows", async () => {
    const now = "2026-06-01T00:00:00.000Z";
    await db
      .prepare(
        "INSERT INTO gift_bundles (product_id, token_count, price_cents, display_name, sort_order, is_active) VALUES (?, 2, 899, ?, 50, 1)",
      )
      .run("com.porizo.test_gift_2", "2 Test Gifts");
    await db
      .prepare(
        `INSERT INTO subscription_plans (
          id, name, tier, songs_per_month, previews_per_day,
          price_monthly_cents, price_annual_cents, created_at, updated_at
        ) VALUES (?, ?, 'plus', 10, 20, 699, 6999, ?, ?)`,
      )
      .run("plan_test_plus", "Test Plus", now, now);
    await db
      .prepare(
        "INSERT INTO plan_products (id, plan_id, platform, product_id, billing_period, created_at) VALUES (?, ?, 'apple', ?, 'annual', ?)",
      )
      .run(
        "plan_product_test_plus_annual",
        "plan_test_plus",
        "com.porizo.test_plus_annual",
        now,
      );

    const giftProducts = await repo.listGiftBundleProducts();
    const planProducts = await repo.listPlanProducts();

    assert.deepEqual(
      giftProducts.find((row) => row.product_id === "com.porizo.test_gift_2"),
      {
        product_id: "com.porizo.test_gift_2",
        display_name: "2 Test Gifts",
        price_cents: 899,
      },
    );
    assert.deepEqual(
      planProducts.find(
        (row) => row.product_id === "com.porizo.test_plus_annual",
      ),
      {
        product_id: "com.porizo.test_plus_annual",
        billing_period: "annual",
        name: "Test Plus",
        tier: "plus",
        price_monthly_cents: 699,
        price_annual_cents: 6999,
      },
    );
  });

  test("lists and updates admin gift bundle rows", async () => {
    const now = "2026-06-01T00:00:00.000Z";
    await db.prepare("DELETE FROM gift_bundles").run();
    await db
      .prepare(
        `INSERT INTO gift_bundles (
          id, product_id, token_count, price_cents, display_name,
          description, sort_order, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "gb_admin_second",
        "com.porizo.test_gift_second",
        3,
        1299,
        "Second",
        "Second bundle",
        20,
        1,
        now,
        now,
        "gb_admin_first",
        "com.porizo.test_gift_first",
        1,
        499,
        "First",
        "First bundle",
        10,
        1,
        now,
        now,
      );

    const bundles = await repo.listGiftBundlesForAdmin();
    assert.deepEqual(
      bundles.map((bundle) => bundle.id),
      ["gb_admin_first", "gb_admin_second"],
    );

    const previous = await repo.getGiftBundleById("gb_admin_first");
    assert.equal(previous.display_name, "First");

    await repo.updateGiftBundleFields({
      id: "gb_admin_first",
      updates: {
        token_count: 2,
        display_name: "First Updated",
        sort_order: 30,
      },
      updatedAt: "2026-06-01T01:00:00.000Z",
      updatedBy: "admin_billing_repo",
    });

    const updated = await repo.getGiftBundleById("gb_admin_first");
    assert.equal(updated.token_count, 2);
    assert.equal(updated.display_name, "First Updated");
    assert.equal(updated.sort_order, 30);
    assert.equal(updated.updated_by, "admin_billing_repo");
    assert.equal(updated.updated_at, "2026-06-01T01:00:00.000Z");
  });

  test("lists verified receipt sale rows with strict period filtering and joins", async () => {
    const since = "2026-06-01T00:00:00.000Z";
    const purchaseDate = "2026-06-02T00:00:00.000Z";
    await seedUser(db, "billing_user", {
      email: "fallback@example.com",
      name: "Billing User",
    });
    await db
      .prepare(
        `INSERT INTO user_contacts (
          id, user_id, type, value_normalized, value_display, verified_at,
          source, is_primary, created_at
        ) VALUES (?, ?, 'email', ?, ?, ?, 'manual', 1, ?)`,
      )
      .run(
        "contact_billing_user",
        "billing_user",
        "primary@example.com",
        "primary@example.com",
        since,
        since,
      );
    await seedSubscription(db, "sub_billing_user", "billing_user", {
      expiresAt: "2026-07-01T00:00:00.000Z",
    });

    await db
      .prepare(
        `INSERT INTO purchase_receipts (
          id, user_id, subscription_id, transaction_id, original_transaction_id,
          product_id, platform, receipt_data, verification_status,
          verification_response, purchase_date, expires_date, is_trial,
          is_upgrade, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'apple', NULL, ?, ?, ?, NULL, 0, 0, ?)`,
      )
      .run(
        "receipt_included",
        "billing_user",
        "sub_billing_user",
        "tx_included",
        "orig_included",
        "com.porizo.plus_monthly",
        "verified",
        JSON.stringify({ price_millis: 6990, currency: "USD" }),
        purchaseDate,
        purchaseDate,
      );
    await db
      .prepare(
        `INSERT INTO purchase_receipts (
          id, user_id, transaction_id, original_transaction_id, product_id,
          platform, verification_status, purchase_date, is_trial, is_upgrade,
          created_at
        ) VALUES (?, ?, ?, ?, ?, 'apple', ?, ?, 0, 0, ?)`,
      )
      .run(
        "receipt_at_boundary",
        "billing_user",
        "tx_boundary",
        "orig_boundary",
        "com.porizo.plus_monthly",
        "verified",
        since,
        since,
      );
    await db
      .prepare(
        `INSERT INTO purchase_receipts (
          id, user_id, transaction_id, original_transaction_id, product_id,
          platform, verification_status, purchase_date, is_trial, is_upgrade,
          created_at
        ) VALUES (?, ?, ?, ?, ?, 'apple', ?, ?, 0, 0, ?)`,
      )
      .run(
        "receipt_pending",
        "billing_user",
        "tx_pending",
        "orig_pending",
        "com.porizo.plus_monthly",
        "pending",
        purchaseDate,
        purchaseDate,
      );
    await db
      .prepare(
        `INSERT INTO gift_wallet_transactions (
          id, user_id, type, amount, balance_before, balance_after, source,
          reference_type, reference_id, idempotency_key, created_at
        ) VALUES (?, ?, 'gift_purchase', 3, 0, 3, 'apple_consumable', 'receipt', ?, ?, ?)`,
      )
      .run(
        "gift_tx_included",
        "billing_user",
        "receipt_included",
        "gift_receipt_tx_included",
        purchaseDate,
      );

    const rows = await repo.listReceiptSaleRows({
      since,
      limit: 10,
      offset: 0,
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "receipt_included");
    assert.equal(rows[0].primary_email, "primary@example.com");
    assert.equal(rows[0].subscription_status, "active");
    assert.equal(rows[0].gift_wallet_transaction_id, "gift_tx_included");
    assert.equal(rows[0].gift_tokens_granted, 3);
  });

  test("counts and lists only current subscribers in deterministic order", async () => {
    const now = "2026-06-15T00:00:00.000Z";
    const future = "2026-07-15T00:00:00.000Z";
    const past = "2026-06-01T00:00:00.000Z";

    for (const userId of [
      "active_user",
      "grace_user",
      "retry_user",
      "expired_user",
    ]) {
      await seedUser(db, userId);
    }
    await seedSubscription(db, "sub_active", "active_user", {
      status: "active",
      expiresAt: future,
      updatedAt: "2026-06-10T00:00:00.000Z",
    });
    await seedSubscription(db, "sub_grace", "grace_user", {
      status: "grace_period",
      expiresAt: past,
      gracePeriodExpiresAt: future,
      updatedAt: "2026-06-11T00:00:00.000Z",
    });
    await seedSubscription(db, "sub_retry", "retry_user", {
      status: "billing_retry",
      expiresAt: past,
      gracePeriodExpiresAt: future,
      updatedAt: "2026-06-12T00:00:00.000Z",
    });
    await seedSubscription(db, "sub_expired", "expired_user", {
      status: "active",
      expiresAt: past,
      updatedAt: "2026-06-13T00:00:00.000Z",
    });

    assert.equal(await repo.countCurrentSubscribers({ now }), 3);

    const subscribers = await repo.listCurrentSubscribers({ now, limit: 2 });
    assert.deepEqual(
      subscribers.map((row) => [row.id, row.status]),
      [
        ["sub_active", "active"],
        ["sub_grace", "grace_period"],
      ],
    );
  });

  test("returns revenue and subscription health aggregate rows", async () => {
    const now = "2026-06-15T00:00:00.000Z";
    const weekFromNow = "2026-06-22T00:00:00.000Z";
    const weekAgo = "2026-06-08T00:00:00.000Z";

    for (const userId of ["active_a", "active_b", "trial_a", "cancelled_a"]) {
      await seedUser(db, userId);
    }
    await seedSubscription(db, "agg_active_a", "active_a", {
      status: "active",
      expiresAt: "2026-06-20T00:00:00.000Z",
    });
    await seedSubscription(db, "agg_active_b", "active_b", {
      status: "active",
      productId: "com.porizo.pro_monthly",
      expiresAt: "2026-07-15T00:00:00.000Z",
    });
    await seedSubscription(db, "agg_trial_a", "trial_a", {
      status: "trial",
      expiresAt: "2026-07-15T00:00:00.000Z",
    });
    await seedSubscription(db, "agg_cancelled_a", "cancelled_a", {
      status: "cancelled",
      expiresAt: "2026-06-01T00:00:00.000Z",
    });
    await db
      .prepare(
        "UPDATE subscriptions SET cancelled_at = ? WHERE id = ?",
      )
      .run("2026-06-12T00:00:00.000Z", "agg_cancelled_a");

    const byTier = await repo.listSubscriptionsByTierSince({
      since: "2026-05-01T00:00:00.000Z",
    });
    const trialStats = await repo.getTrialConversionStatsSince({
      since: "2026-05-01T00:00:00.000Z",
    });
    const health = await repo.getSubscriptionHealthCounts({
      now,
      weekFromNow,
      weekAgo,
    });

    assert.equal(byTier.find((row) => row.tier === "plus").count, 4);
    assert.equal(Number(trialStats.current_trials), 1);
    assert.equal(
      await repo.countCancelledSubscriptionsSince({
        since: "2026-05-01T00:00:00.000Z",
      }),
      1,
    );
    assert.equal(await repo.countActiveSubscriptions(), 2);
    assert.equal(health.trialCount, 1);
    assert.equal(health.expiringThisWeek, 1);
    assert.equal(health.recentCancellations, 1);
    assert.equal(health.inGracePeriod, 0);
  });

  test("returns user billing snapshot rows for latest subscription and recent receipts", async () => {
    await seedUser(db, "snapshot_user");
    await seedSubscription(db, "snapshot_old", "snapshot_user", {
      productId: "com.porizo.plus_monthly",
      expiresAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z",
    });
    await seedSubscription(db, "snapshot_new", "snapshot_user", {
      productId: "com.porizo.pro_monthly",
      expiresAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
    });

    for (const [id, createdAt] of [
      ["receipt_old", "2026-06-10T00:00:00.000Z"],
      ["receipt_new", "2026-06-20T00:00:00.000Z"],
      ["receipt_third", "2026-06-15T00:00:00.000Z"],
    ]) {
      await db
        .prepare(
          `INSERT INTO purchase_receipts (
            id, user_id, transaction_id, original_transaction_id, product_id,
            platform, verification_status, purchase_date, expires_date,
            is_trial, is_upgrade, created_at
          ) VALUES (?, ?, ?, ?, ?, 'apple', 'verified', ?, NULL, 0, 0, ?)`,
        )
        .run(
          id,
          "snapshot_user",
          `tx_${id}`,
          `orig_${id}`,
          "com.porizo.plus_monthly",
          createdAt,
          createdAt,
        );
    }

    const latest =
      await repo.getLatestSubscriptionForUser("snapshot_user");
    const receipts = await repo.listRecentReceiptsForUser({
      userId: "snapshot_user",
      limit: 2,
    });

    assert.equal(latest.id, "snapshot_new");
    assert.deepEqual(
      receipts.map((row) => row.transaction_id),
      ["tx_receipt_new", "tx_receipt_third"],
    );
    assert.deepEqual(Object.keys(receipts[0]).sort(), [
      "created_at",
      "expires_date",
      "original_transaction_id",
      "platform",
      "product_id",
      "purchase_date",
      "transaction_id",
      "verification_status",
    ]);
  });
});
