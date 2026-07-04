require("dotenv/config");
process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");
const { createStorageProvider } = require("../src/storage");

test("Google consumable receipt credits gift wallet idempotently", async (t) => {
  const storageDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "porizo-google-consumable-test-"),
  );
  t.after(() => fs.rmSync(storageDir, { recursive: true, force: true }));
  const db = await initDb({
    dbPath: ":memory:",
    migrationsDir: path.join(process.cwd(), "migrations"),
  });
  const acknowledged = [];
  const googleValidator = {
    isConfigured: () => true,
    verifyPurchase: async (purchaseToken, productId) => ({
      valid: true,
      purchaseState: 0,
      consumptionState: 0,
      acknowledged: false,
      orderId: "GPA.1234-5678-9012-34567",
      purchaseTimeMillis: "1767225600000",
      raw: { purchaseToken, productId },
    }),
    acknowledgePurchase: async (purchaseToken, productId, type) => {
      acknowledged.push({ purchaseToken, productId, type });
    },
  };
  const appConfig = {
    STORAGE_DIR: storageDir,
    STORAGE_PROVIDER: "local",
    STREAM_BASE_URL: "http://stream.local",
    PUBLIC_BASE_URL: "http://public.local",
    ALLOW_ANON_USER_ID: true,
    GIFT_TOKEN_PRODUCT_ID: "com.porizo.gift_token_oneoff",
  };
  const app = buildServer({
    db,
    config: appConfig,
    storage: createStorageProvider(appConfig),
    billingServices: { googleValidator },
  });
  t.after(() => app.close());
  db.prepare(
    "INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, ?)",
  ).run("google_gift_user", new Date().toISOString(), "low");

  const first = await app.inject({
    method: "POST",
    url: "/billing/receipt/google/consumable",
    headers: { "x-user-id": "google_gift_user" },
    payload: {
      purchase_token: "google_purchase_token_1",
      product_id: "com.porizo.gift_token_oneoff",
    },
  });
  assert.equal(first.statusCode, 200, first.body);
  const firstBody = JSON.parse(first.body);
  assert.equal(firstBody.success, true);
  assert.equal(firstBody.already_processed, false);
  assert.equal(firstBody.balance, 1);
  assert.deepEqual(acknowledged, [
    {
      purchaseToken: "google_purchase_token_1",
      productId: "com.porizo.gift_token_oneoff",
      type: "product",
    },
  ]);

  const retry = await app.inject({
    method: "POST",
    url: "/billing/receipt/google/consumable",
    headers: { "x-user-id": "google_gift_user" },
    payload: {
      purchase_token: "google_purchase_token_1",
      product_id: "com.porizo.gift_token_oneoff",
    },
  });
  assert.equal(retry.statusCode, 200, retry.body);
  const retryBody = JSON.parse(retry.body);
  assert.equal(retryBody.success, true);
  assert.equal(retryBody.already_processed, true);
  assert.equal(retryBody.balance, 1);
});
