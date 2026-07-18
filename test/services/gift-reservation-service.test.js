process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");
const { initDb } = require("../../src/database/sqlite");
const { createGiftWalletRepository } = require("../../src/database/gift-wallet-repository");
const { createGiftReservationRepository } = require("../../src/database/gift-reservation-repository");
const { createGiftReservationService } = require("../../src/services/gift-reservation-service");

describe("GiftReservationService", () => {
  let db;
  let wallet;
  let service;
  beforeEach(async () => {
    db = await initDb({ dbPath: ":memory:", migrationsDir: path.join(process.cwd(), "migrations") });
    wallet = createGiftWalletRepository(db);
    service = createGiftReservationService({
      db,
      giftWalletRepository: wallet,
      giftReservationRepository: createGiftReservationRepository(db),
    });
    await wallet.applyTransaction({
      userId: "owner_1", type: "gift_purchase", amount: 3,
      idempotencyKey: "bundle_purchase",
    });
  });
  afterEach(async () => db.close?.());

  test("interactive draft and distinct paid web orders share one fungible wallet", async () => {
    const expiry = "2026-07-19T00:00:00.000Z";
    await service.reserveGiftCredit({
      userId: "owner_1", idempotencyKey: "app_draft", expiresAt: expiry,
    });
    const webOne = await service.reserveGiftCredit({
      userId: "owner_1", idempotencyKey: "web_1", expiresAt: expiry,
      purpose: "paid_web_order", originWebOrderId: "order_1",
    });
    const replay = await service.reserveGiftCredit({
      userId: "owner_1", idempotencyKey: "web_1_again", expiresAt: expiry,
      purpose: "paid_web_order", originWebOrderId: "order_1",
    });
    await service.reserveGiftCredit({
      userId: "owner_1", idempotencyKey: "web_2", expiresAt: expiry,
      purpose: "paid_web_order", originWebOrderId: "order_2",
    });

    assert.equal(replay.reservation.id, webOne.reservation.id);
    assert.equal(replay.idempotent, true);
    assert.equal(await wallet.getBalance("owner_1"), 0);
    const count = await db.prepare("SELECT COUNT(*) AS count FROM gift_reservations").get();
    assert.equal(Number(count.count), 3);
  });

  test("reservation insert failure rolls back the wallet debit", async () => {
    const failingService = createGiftReservationService({
      db,
      giftWalletRepository: wallet,
      giftReservationRepository: {
        findByOriginWebOrderId: async () => null,
        findByIdempotencyKey: async () => null,
        createReservation: async () => {
          throw new Error("simulated reservation insert failure");
        },
      },
    });

    await assert.rejects(
      () =>
        failingService.reserveGiftCredit({
          userId: "owner_1",
          idempotencyKey: "atomic_insert_failure",
          expiresAt: "2026-07-19T00:00:00.000Z",
        }),
      /simulated reservation insert failure/,
    );
    assert.equal(await wallet.getBalance("owner_1"), 3);
    const ledger = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM gift_wallet_transactions WHERE idempotency_key = ?",
      )
      .get("gift_reserve:atomic_insert_failure");
    assert.equal(Number(ledger.count), 0);
  });
});
