require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

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
  return JSON.parse(response.body).token;
}

describe("admin billing sales dashboard", () => {
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

  test("reports receipt-backed sales and current subscribers", async () => {
    const now = new Date().toISOString();
    const renewsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    await db.query(
      "INSERT INTO users (id, email, display_name, created_at, risk_level) VALUES (?, ?, ?, ?, ?)",
      [
        "user_subscriber",
        "subscriber@example.com",
        "Subscriber One",
        now,
        "low",
      ],
    );
    await db.query(
      "INSERT INTO users (id, email, display_name, created_at, risk_level) VALUES (?, ?, ?, ?, ?)",
      ["user_gift", "gift@example.com", "Gift Buyer", now, "low"],
    );
    await db.query(
      "INSERT INTO users (id, email, display_name, created_at, risk_level) VALUES (?, ?, ?, ?, ?)",
      [
        "user_expired",
        "expired@example.com",
        "Expired Subscriber",
        now,
        "low",
      ],
    );

    await db.query(
      `INSERT INTO subscriptions (
        id, user_id, product_id, tier, status, platform,
        original_transaction_id, latest_transaction_id, original_purchase_date,
        expires_at, auto_renew_enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "sub_active_1",
        "user_subscriber",
        "com.porizo.plus_monthly",
        "plus",
        "active",
        "apple",
        "orig_sub_1",
        "tx_sub_1",
        now,
        renewsAt,
        1,
        now,
        now,
      ],
    );
    await db.query(
      `INSERT INTO subscriptions (
        id, user_id, product_id, tier, status, platform,
        original_transaction_id, latest_transaction_id, original_purchase_date,
        expires_at, auto_renew_enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "sub_expired_1",
        "user_expired",
        "com.porizo.plus_monthly",
        "plus",
        "active",
        "apple",
        "orig_expired_1",
        "tx_expired_1",
        now,
        expiredAt,
        0,
        now,
        now,
      ],
    );

    await db.query(
      `INSERT INTO purchase_receipts (
        id, user_id, subscription_id, transaction_id, original_transaction_id,
        product_id, platform, receipt_data, verification_status, verification_response,
        purchase_date, expires_date, is_trial, is_upgrade, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "rcpt_sub_1",
        "user_subscriber",
        "sub_active_1",
        "tx_sub_1",
        "orig_sub_1",
        "com.porizo.plus_monthly",
        "apple",
        null,
        "verified",
        JSON.stringify({
          type: "subscription",
          environment: "production",
          price_millis: 6990,
          currency: "USD",
        }),
        now,
        renewsAt,
        0,
        0,
        now,
      ],
    );
    await db.query(
      `INSERT INTO purchase_receipts (
        id, user_id, subscription_id, transaction_id, original_transaction_id,
        product_id, platform, receipt_data, verification_status, verification_response,
        purchase_date, expires_date, is_trial, is_upgrade, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "rcpt_trial_1",
        "user_subscriber",
        "sub_active_1",
        "tx_trial_1",
        "orig_sub_1",
        "com.porizo.plus_monthly",
        "apple",
        null,
        "verified",
        JSON.stringify({
          type: "subscription",
          environment: "production",
          price_millis: 0,
          currency: "USD",
        }),
        now,
        renewsAt,
        1,
        0,
        now,
      ],
    );

    await db.query(
      `INSERT INTO purchase_receipts (
        id, user_id, subscription_id, transaction_id, original_transaction_id,
        product_id, platform, receipt_data, verification_status, verification_response,
        purchase_date, expires_date, is_trial, is_upgrade, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "rcpt_gift_1",
        "user_gift",
        null,
        "tx_gift_1",
        "orig_gift_1",
        "com.porizo.gift_bundle_3",
        "apple",
        null,
        "verified",
        JSON.stringify({
          type: "one_time_purchase",
          environment: "production",
          price_millis: 5990,
          currency: "USD",
        }),
        now,
        null,
        0,
        0,
        now,
      ],
    );
    await db.query(
      `INSERT INTO purchase_receipts (
        id, user_id, subscription_id, transaction_id, original_transaction_id,
        product_id, platform, receipt_data, verification_status, verification_response,
        purchase_date, expires_date, is_trial, is_upgrade, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "rcpt_zero_gift_1",
        "user_gift",
        null,
        "tx_zero_gift_1",
        "orig_zero_gift_1",
        "com.porizo.gift_bundle_3",
        "apple",
        null,
        "verified",
        JSON.stringify({
          type: "one_time_purchase",
          environment: "production",
          price_millis: 0,
          currency: "USD",
        }),
        now,
        null,
        0,
        0,
        now,
      ],
    );
    await db.query(
      `INSERT INTO purchase_receipts (
        id, user_id, subscription_id, transaction_id, original_transaction_id,
        product_id, platform, receipt_data, verification_status, verification_response,
        purchase_date, expires_date, is_trial, is_upgrade, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "rcpt_unknown_amount_1",
        "user_gift",
        null,
        "tx_unknown_amount_1",
        "orig_unknown_amount_1",
        "com.porizo.unknown_one_time",
        "apple",
        null,
        "verified",
        JSON.stringify({
          type: "one_time_purchase",
          environment: "production",
          price_millis: null,
          currency: "USD",
        }),
        now,
        null,
        0,
        0,
        now,
      ],
    );

    await db.query(
      `INSERT INTO gift_wallet_transactions (
        id, user_id, type, amount, balance_before, balance_after,
        source, reference_type, reference_id, description, metadata_json,
        idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "gwtx_gift_1",
        "user_gift",
        "gift_purchase",
        3,
        0,
        3,
        "apple_consumable",
        "receipt",
        "rcpt_gift_1",
        "3 Gifts",
        null,
        "gift_receipt_tx_gift_1",
        now,
      ],
    );

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/billing/sales?days=all&limit=10",
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();

    assert.equal(body.summary.totalSalesCount, 3);
    assert.equal(body.summary.subscriptionSalesCount, 1);
    assert.equal(body.summary.giftSalesCount, 1);
    assert.equal(body.summary.giftTokensGranted, 3);
    assert.equal(body.summary.payingUsers, 2);
    assert.equal(body.summary.activeSubscriberCount, 1);
    assert.equal(body.summary.unknownAmountCount, 1);

    assert.deepEqual(body.summary.revenueByCurrency, [
      { currency: "USD", amount: 12.98, count: 2 },
    ]);

    const subscriptionSale = body.recentSales.find(
      (sale) => sale.id === "rcpt_sub_1",
    );
    assert.equal(subscriptionSale.sale_type, "subscription");
    assert.equal(subscriptionSale.is_current_subscriber, true);
    assert.equal(subscriptionSale.user_email, "subscriber@example.com");

    const giftSale = body.recentSales.find((sale) => sale.id === "rcpt_gift_1");
    assert.equal(giftSale.sale_type, "gift");
    assert.equal(giftSale.gift_tokens_granted, 3);

    const unknownSale = body.recentSales.find(
      (sale) => sale.id === "rcpt_unknown_amount_1",
    );
    assert.equal(unknownSale.amount, null);
    assert.equal(unknownSale.amount_source, "unknown");
    assert.equal(
      body.recentSales.some((sale) => sale.id === "rcpt_trial_1"),
      false,
    );
    assert.equal(
      body.recentSales.some((sale) => sale.id === "rcpt_zero_gift_1"),
      false,
    );

    assert.equal(body.currentSubscribers.length, 1);
    assert.equal(body.currentSubscribers[0].user_id, "user_subscriber");
    assert.equal(body.currentSubscribers[0].status, "active");
    assert.equal(
      body.currentSubscribers.some((sub) => sub.user_id === "user_expired"),
      false,
    );
  });

  test("counts current subscribers beyond the preview limit", async () => {
    const now = new Date().toISOString();
    const renewsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    for (let i = 0; i < 101; i += 1) {
      await db.query(
        "INSERT INTO users (id, email, display_name, created_at, risk_level) VALUES (?, ?, ?, ?, ?)",
        [
          `current_user_${i}`,
          `current-${i}@example.com`,
          `Current User ${i}`,
          now,
          "low",
        ],
      );
      await db.query(
        `INSERT INTO subscriptions (
          id, user_id, product_id, tier, status, platform,
          original_transaction_id, latest_transaction_id, original_purchase_date,
          expires_at, auto_renew_enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `current_sub_${i}`,
          `current_user_${i}`,
          "com.porizo.plus_monthly",
          "plus",
          "active",
          "apple",
          `current_orig_${i}`,
          `current_tx_${i}`,
          now,
          renewsAt,
          1,
          now,
          now,
        ],
      );
    }

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/billing/sales?days=all&limit=10",
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();

    assert.equal(body.summary.totalSalesCount, 0);
    assert.equal(body.summary.activeSubscriberCount, 101);
    assert.equal(body.currentSubscribers.length, 100);
  });
});
