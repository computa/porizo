"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const {
  createGiftWalletRepository,
} = require("../src/database/gift-wallet-repository");

let db;
let repository;
let userId;

before(async () => {
  if (process.env.DB_PROVIDER !== "postgres") return;
  const { getDatabase } = require("../src/database");
  db = await getDatabase({ provider: "postgres" });
  repository = createGiftWalletRepository(db);
  userId = `wallet_pg_race_${Date.now()}`;
  await db.query(
    `INSERT INTO users (id, created_at, risk_level, account_status)
     VALUES ($1, CURRENT_TIMESTAMP, 'low', 'active')`,
    [userId],
  );
});

after(async () => {
  if (!db) return;
  await db.query("DELETE FROM users WHERE id = $1", [userId]);
  await db.close?.();
});

test(
  "PostgreSQL serializes concurrent wallet idempotency replays",
  async (t) => {
    if (process.env.DB_PROVIDER !== "postgres") {
      t.skip("real PostgreSQL concurrency coverage runs under npm run test:pg");
      return;
    }

    const input = {
      userId,
      type: "purchase",
      amount: 1,
      source: "stripe_checkout",
      referenceType: "web_order",
      referenceId: "worder_pg_race",
      idempotencyKey: "wallet_pg_same_key",
    };
    const [first, second] = await Promise.all([
      repository.applyTransaction(input),
      repository.applyTransaction(input),
    ]);

    assert.equal(first.transactionId, second.transactionId);
    assert.equal([first.idempotent, second.idempotent].filter(Boolean).length, 1);
    assert.equal(await repository.getBalance(userId), 1);
    const result = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM gift_wallet_transactions
       WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, input.idempotencyKey],
    );
    assert.equal(result.rows[0].count, 1);
  },
);
