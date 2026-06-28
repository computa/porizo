process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const { afterEach, beforeEach, describe, test } = require("node:test");

const {
  createGiftWalletRepository,
} = require("../src/database/gift-wallet-repository");
const { createSqliteAdapter } = require("../src/database/sqlite");

let db;
let repository;

function createSchema(database) {
  database.exec(`
    CREATE TABLE gift_wallet (
      user_id TEXT PRIMARY KEY,
      balance INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE gift_wallet_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      balance_before INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      source TEXT,
      reference_type TEXT,
      reference_id TEXT,
      description TEXT,
      metadata_json TEXT,
      idempotency_key TEXT,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX gift_wallet_tx_idempotency_key_user_idx
      ON gift_wallet_transactions(user_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `);
}

describe("GiftWalletRepository", () => {
  beforeEach(() => {
    db = createSqliteAdapter({ dbPath: ":memory:" });
    createSchema(db);
    repository = createGiftWalletRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("ensureRow creates a zero-balance wallet and preserves existing balance", async () => {
    const created = await repository.ensureRow("wallet_user");
    assert.equal(created.userId, "wallet_user");
    assert.equal(created.balance, 0);

    await repository.applyTransaction({
      userId: "wallet_user",
      type: "gift_purchase",
      amount: 2,
      idempotencyKey: "purchase_1",
    });

    const existing = await repository.ensureRow("wallet_user");
    assert.equal(existing.balance, 2);
  });

  test("applyTransaction records credit, debit, and idempotent replay without balance drift", async () => {
    const credit = await repository.applyTransaction({
      userId: "wallet_user",
      type: "gift_purchase",
      amount: 3,
      source: "apple_consumable",
      referenceType: "receipt",
      referenceId: "receipt_1",
      metadata: { bundle_token_count: 3 },
      idempotencyKey: "gift_receipt_1",
    });

    const replay = await repository.applyTransaction({
      userId: "wallet_user",
      type: "gift_purchase",
      amount: 3,
      idempotencyKey: "gift_receipt_1",
    });

    const debit = await repository.applyTransaction({
      userId: "wallet_user",
      type: "gift_reserve",
      amount: -1,
      idempotencyKey: "gift_reserve_1",
    });

    assert.equal(credit.balanceAfter, 3);
    assert.equal(replay.transactionId, credit.transactionId);
    assert.equal(replay.idempotent, true);
    assert.equal(debit.balanceAfter, 2);
    assert.equal(await repository.getBalance("wallet_user"), 2);
  });

  test("applyTransaction rejects overdrafts and over-cap credits", async () => {
    await assert.rejects(
      () =>
        repository.applyTransaction({
          userId: "wallet_user",
          type: "gift_reserve",
          amount: -1,
        }),
      { code: "INSUFFICIENT_GIFT_TOKENS" },
    );

    await assert.rejects(
      () =>
        repository.applyTransaction({
          userId: "wallet_user",
          type: "gift_purchase",
          amount: 100001,
        }),
      { code: "INSUFFICIENT_GIFT_TOKENS" },
    );
  });

  test("externalQuery participates in caller rollback", async () => {
    await assert.rejects(
      () =>
        db.transaction(async (query) => {
          await repository.applyTransaction({
            userId: "wallet_user",
            type: "gift_purchase",
            amount: 1,
            idempotencyKey: "tx_rollback",
            externalQuery: query,
          });
          throw new Error("rollback");
        }),
      /rollback/,
    );

    assert.equal(await repository.getBalance("wallet_user"), 0);
    const count = await db
      .prepare(
        "SELECT COUNT(*) AS total FROM gift_wallet_transactions WHERE user_id = ?",
      )
      .get("wallet_user");
    assert.equal(Number(count.total), 0);
  });

  test("spendSongTokenInTransaction debits wallet and writes deterministic ledger key", async () => {
    await repository.applyTransaction({
      userId: "wallet_user",
      type: "gift_purchase",
      amount: 1,
      idempotencyKey: "purchase_for_song",
    });

    const spend = await db.transaction((query) =>
      repository.spendSongTokenInTransaction(query, {
        userId: "wallet_user",
        trackId: "track_1",
        trackVersionId: "version_1",
      }),
    );

    assert.equal(spend.balanceBefore, 1);
    assert.equal(spend.balanceAfter, 0);

    const ledger = await db
      .prepare(
        `SELECT type, amount, balance_before, balance_after, source, reference_type, reference_id, idempotency_key
         FROM gift_wallet_transactions
         WHERE id = ?`,
      )
      .get(spend.transactionId);

    assert.deepEqual(
      {
        type: ledger.type,
        amount: Number(ledger.amount),
        balance_before: Number(ledger.balance_before),
        balance_after: Number(ledger.balance_after),
        source: ledger.source,
        reference_type: ledger.reference_type,
        reference_id: ledger.reference_id,
        idempotency_key: ledger.idempotency_key,
      },
      {
        type: "song_spend",
        amount: -1,
        balance_before: 1,
        balance_after: 0,
        source: "gift_token",
        reference_type: "track",
        reference_id: "track_1",
        idempotency_key: "song_spend_version_1",
      },
    );
  });

  test("getSummary returns normalized transaction metadata", async () => {
    await repository.applyTransaction({
      userId: "wallet_user",
      type: "gift_purchase",
      amount: 2,
      source: "apple_consumable",
      referenceType: "receipt",
      referenceId: "receipt_1",
      description: "Gift purchase",
      metadata: { product_id: "bundle_2" },
      idempotencyKey: "gift_receipt_summary",
    });

    const summary = await repository.getSummary("wallet_user", 10);

    assert.equal(summary.balance, 2);
    assert.equal(summary.transactions.length, 1);
    assert.deepEqual(summary.transactions[0].metadata, {
      product_id: "bundle_2",
    });
    assert.equal(summary.transactions[0].amount, 2);
  });

  test("hasReceiptCredit checks receipt-backed ledger rows only", async () => {
    assert.equal(
      await repository.hasReceiptCredit({
        userId: "wallet_user",
        receiptId: "receipt_1",
      }),
      false,
    );

    await repository.applyTransaction({
      userId: "wallet_user",
      type: "gift_purchase",
      amount: 1,
      referenceType: "receipt",
      referenceId: "receipt_1",
      idempotencyKey: "receipt_credit_1",
    });
    await repository.applyTransaction({
      userId: "wallet_user",
      type: "gift_purchase",
      amount: 1,
      referenceType: "gift_order",
      referenceId: "receipt_2",
      idempotencyKey: "not_receipt_credit",
    });

    assert.equal(
      await repository.hasReceiptCredit({
        userId: "wallet_user",
        receiptId: "receipt_1",
      }),
      true,
    );
    assert.equal(
      await repository.hasReceiptCredit({
        userId: "wallet_user",
        receiptId: "receipt_2",
      }),
      false,
    );
  });
});
