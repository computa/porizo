process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const { afterEach, beforeEach, describe, test } = require("node:test");
const { createSqliteAdapter } = require("../../src/database/sqlite");
const { createGiftWalletRepository } = require("../../src/database/gift-wallet-repository");
const { createGiftPurchaseReversalService } = require("../../src/services/gift-purchase-reversal");

describe("GiftPurchaseReversalService", () => {
  let db;
  let wallet;
  let service;
  beforeEach(() => {
    db = createSqliteAdapter({ dbPath: ":memory:" });
    db.exec(`
      CREATE TABLE gift_wallet (user_id TEXT PRIMARY KEY, balance INTEGER NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE gift_wallet_transactions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, amount INTEGER NOT NULL,
        balance_before INTEGER NOT NULL, balance_after INTEGER NOT NULL, source TEXT,
        reference_type TEXT, reference_id TEXT, description TEXT, metadata_json TEXT,
        idempotency_key TEXT, created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX gift_wallet_reversal_idem ON gift_wallet_transactions(user_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
    `);
    wallet = createGiftWalletRepository(db);
    service = createGiftPurchaseReversalService({ giftWalletRepository: wallet });
  });
  afterEach(async () => db.close?.());

  test("Stripe and Apple use one bounded reversal contract", async () => {
    const purchase = await wallet.applyTransaction({
      userId: "owner", type: "gift_purchase", amount: 2, idempotencyKey: "purchase",
    });
    await service.reverseGiftPurchaseGrant({
      userId: "owner", purchaseTransactionId: purchase.transactionId, tokenCount: 2,
      provider: "stripe", providerEventId: "evt_refund",
    });
    await assert.rejects(() => service.reverseGiftPurchaseGrant({
      userId: "owner", purchaseTransactionId: purchase.transactionId, tokenCount: 1,
      provider: "apple", providerEventId: "evt_over_refund",
    }), { code: "GIFT_PURCHASE_REVERSAL_EXCEEDS_GRANT" });
    await service.reverseGiftPurchaseGrant({
      userId: "owner", purchaseTransactionId: purchase.transactionId, tokenCount: 2,
      provider: "stripe", providerEventId: "evt_refund_reversed", reversed: true,
    });
    assert.equal(await wallet.getBalance("owner"), 2);
  });
});
