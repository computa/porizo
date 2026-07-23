"use strict";

const { afterEach, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { initDb } = require("../../src/db");
const {
  createGiftWalletRepository,
} = require("../../src/database/gift-wallet-repository");
const {
  createEtsyRedemptionService,
} = require("../../src/services/etsy-redemption-service");

describe("etsy redemption codes", () => {
  let db;
  let wallet;
  let service;

  beforeEach(async () => {
    db = await initDb();
    wallet = createGiftWalletRepository(db);
    service = createEtsyRedemptionService({
      db,
      giftWalletRepository: wallet,
    });
    await db
      .prepare(
        "INSERT INTO users (id, created_at, account_status) VALUES (?, CURRENT_TIMESTAMP, 'guest'), (?, CURRENT_TIMESTAMP, 'guest')",
      )
      .run("buyer_a", "buyer_b");
  });

  afterEach(async () => {
    await db.close();
  });

  it("mints a batch of unique, well-formed codes", async () => {
    const codes = await service.mintBatch({
      batchLabel: "etsy-launch",
      count: 25,
    });
    assert.equal(codes.length, 25);
    assert.equal(new Set(codes).size, 25, "codes must be unique");
    for (const code of codes) {
      // Unambiguous alphabet: no 0/O/1/I to mis-type from a printed insert.
      assert.match(code, /^PZ-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      assert.doesNotMatch(code, /[01OI]/);
    }
    const stored = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM etsy_redemption_codes WHERE batch_label = 'etsy-launch' AND status = 'unredeemed'",
      )
      .get();
    assert.equal(Number(stored.count), 25);
  });

  it("issues exactly one auditable code per Etsy receipt", async () => {
    const issued = await service.issueForReceipt({
      receiptId: "receipt-1001",
      listingId: "listing-19",
      batchLabel: "manual-july",
      adminId: "admin-1",
    });
    assert.match(issued.code, /^PZ-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(issued.state, "assigned");

    await assert.rejects(
      service.issueForReceipt({
        receiptId: "receipt-1001",
        listingId: "listing-19",
        batchLabel: "manual-july",
        adminId: "admin-1",
      }),
      (error) => error.code === "RECEIPT_ALREADY_ASSIGNED",
    );

    const assignment = await db
      .prepare(
        "SELECT receipt_id, listing_id, state FROM etsy_code_assignments WHERE code = ?",
      )
      .get(issued.code);
    assert.deepEqual(assignment, {
      receipt_id: "receipt-1001",
      listing_id: "listing-19",
      state: "assigned",
    });
  });

  it("reveals only undelivered assignments and records delivery", async () => {
    const issued = await service.issueForReceipt({
      receiptId: "receipt-1002",
      batchLabel: "manual-july",
      adminId: "admin-1",
    });
    assert.equal(
      (await service.revealAssignedCode({ receiptId: "receipt-1002" })).code,
      issued.code,
    );
    await service.markDelivered({
      receiptId: "receipt-1002",
      deliveryReference: "etsy-message-55",
    });
    await assert.rejects(
      service.revealAssignedCode({ receiptId: "receipt-1002" }),
      (error) => error.code === "ASSIGNMENT_NOT_REVEALABLE",
    );
  });

  it("redeeming a valid code grants exactly one wallet credit and burns the code", async () => {
    const [code] = await service.mintBatch({ batchLabel: "b1", count: 1 });
    const result = await service.redeem({ code, userId: "buyer_a" });
    assert.equal(result.redeemed, true);
    assert.equal(result.idempotent, false);
    assert.equal(await wallet.getBalance("buyer_a"), 1);
    const row = await db
      .prepare(
        "SELECT status, redeemed_by_user_id, grant_transaction_id FROM etsy_redemption_codes WHERE code = ?",
      )
      .get(code);
    assert.equal(row.status, "redeemed");
    assert.equal(row.redeemed_by_user_id, "buyer_a");
    assert.ok(row.grant_transaction_id);
  });

  it("redemption converges manual delivery state to redeemed", async () => {
    const issued = await service.issueForReceipt({
      receiptId: "receipt-1003",
      batchLabel: "manual-july",
      adminId: "admin-1",
    });
    await service.markDelivered({
      receiptId: "receipt-1003",
      deliveryReference: "etsy-message-56",
    });
    await service.redeem({ code: issued.code, userId: "buyer_a" });
    const assignment = await db
      .prepare(
        "SELECT state FROM etsy_code_assignments WHERE receipt_id = ?",
      )
      .get("receipt-1003");
    assert.equal(assignment.state, "redeemed");
  });

  it("reverses an unredeemed assignment and prevents later claim", async () => {
    const issued = await service.issueForReceipt({
      receiptId: "receipt-refund-unclaimed",
      batchLabel: "manual-july",
      adminId: "admin-1",
    });
    const result = await service.reverseAssignment({
      receiptId: "receipt-refund-unclaimed",
      refundEvidence: "etsy-refund-1",
      reason: "buyer canceled",
    });
    assert.equal(result.state, "refunded");
    assert.equal(result.entitlementReversed, true);
    await assert.rejects(
      service.redeem({ code: issued.code, userId: "buyer_a" }),
      /CODE_VOID/,
    );
  });

  it("removes an unspent redeemed credit and flags a spent credit for manual review", async () => {
    const unspent = await service.issueForReceipt({
      receiptId: "receipt-refund-unspent",
      batchLabel: "manual-july",
      adminId: "admin-1",
    });
    await service.redeem({ code: unspent.code, userId: "buyer_a" });
    const reversed = await service.reverseAssignment({
      receiptId: "receipt-refund-unspent",
      refundEvidence: "etsy-refund-2",
      reason: "buyer refunded",
    });
    assert.equal(reversed.state, "refunded");
    assert.equal(reversed.entitlementReversed, true);
    assert.equal(await wallet.getBalance("buyer_a"), 0);

    const spent = await service.issueForReceipt({
      receiptId: "receipt-refund-spent",
      batchLabel: "manual-july",
      adminId: "admin-1",
    });
    await service.redeem({ code: spent.code, userId: "buyer_b" });
    await wallet.applyTransaction({
      userId: "buyer_b",
      type: "gift_reservation",
      amount: -1,
      source: "test",
      idempotencyKey: "spend-etsy-credit",
    });
    const review = await service.reverseAssignment({
      receiptId: "receipt-refund-spent",
      refundEvidence: "etsy-refund-3",
      reason: "buyer refunded after spend",
    });
    assert.equal(review.state, "manual_review");
    assert.equal(review.entitlementReversed, false);
  });

  it("redeem is case- and whitespace-forgiving (a buyer types it from a printout)", async () => {
    const [code] = await service.mintBatch({ batchLabel: "b1", count: 1 });
    const sloppy = `  ${code.toLowerCase()} `;
    const result = await service.redeem({ code: sloppy, userId: "buyer_a" });
    assert.equal(result.redeemed, true);
    assert.equal(await wallet.getBalance("buyer_a"), 1);
  });

  it("same buyer retrying the same code is idempotent — no second credit", async () => {
    const [code] = await service.mintBatch({ batchLabel: "b1", count: 1 });
    await service.redeem({ code, userId: "buyer_a" });
    const retry = await service.redeem({ code, userId: "buyer_a" });
    assert.equal(retry.redeemed, true);
    assert.equal(retry.idempotent, true);
    assert.equal(
      await wallet.getBalance("buyer_a"),
      1,
      "a retry must never grant a second credit",
    );
  });

  it("a code already redeemed by someone else is rejected", async () => {
    const [code] = await service.mintBatch({ batchLabel: "b1", count: 1 });
    await service.redeem({ code, userId: "buyer_a" });
    await assert.rejects(
      service.redeem({ code, userId: "buyer_b" }),
      /CODE_ALREADY_REDEEMED/,
    );
    assert.equal(await wallet.getBalance("buyer_b"), 0);
  });

  it("unknown and void codes are rejected without touching the wallet", async () => {
    await assert.rejects(
      service.redeem({ code: "PZ-XXXX-XXXX", userId: "buyer_a" }),
      /CODE_NOT_FOUND/,
    );
    const [code] = await service.mintBatch({ batchLabel: "b1", count: 1 });
    await service.voidCode({ code, reason: "etsy order refunded" });
    await assert.rejects(
      service.redeem({ code, userId: "buyer_a" }),
      /CODE_VOID/,
    );
    assert.equal(await wallet.getBalance("buyer_a"), 0);
  });

  it("concurrent redemption of one code by two buyers has exactly one winner", async () => {
    // Under sql.js the loser dies on the adapter's BEGIN collision rather than
    // reaching the CODE_ALREADY_REDEEMED branch (no transaction queueing in
    // the test adapter — same limitation that gates the wallet's own
    // concurrency test behind npm run test:pg). The invariant this test
    // protects is engine-independent: one winner, one owner, ONE credit total.
    // The CODE_ALREADY_REDEEMED loser path is covered by the sequential test
    // above; true parallel coverage runs on Postgres.
    const [code] = await service.mintBatch({ batchLabel: "b1", count: 1 });
    const outcomes = await Promise.allSettled([
      service.redeem({ code, userId: "buyer_a" }),
      service.redeem({ code, userId: "buyer_b" }),
    ]);
    const wins = outcomes.filter((o) => o.status === "fulfilled");
    assert.equal(wins.length, 1, "exactly one redemption may succeed");
    const row = await db
      .prepare(
        "SELECT status, redeemed_by_user_id FROM etsy_redemption_codes WHERE code = ?",
      )
      .get(code);
    assert.equal(row.status, "redeemed");
    const balances = [
      await wallet.getBalance("buyer_a"),
      await wallet.getBalance("buyer_b"),
    ];
    assert.deepEqual(
      balances.sort(),
      [0, 1],
      "exactly one credit granted in total",
    );
    const winnerId = wins[0].value.redeemed ? row.redeemed_by_user_id : null;
    assert.ok(
      winnerId === "buyer_a" || winnerId === "buyer_b",
      "the code must belong to exactly one of the two buyers",
    );
  });

  it("validate reports status without side effects", async () => {
    const [code] = await service.mintBatch({ batchLabel: "b1", count: 1 });
    assert.deepEqual(await service.validate(code), {
      valid: true,
      status: "unredeemed",
    });
    assert.deepEqual(await service.validate("PZ-XXXX-XXXX"), {
      valid: false,
      status: "not_found",
    });
    await service.redeem({ code, userId: "buyer_a" });
    assert.deepEqual(await service.validate(code), {
      valid: false,
      status: "redeemed",
    });
    assert.equal(
      await wallet.getBalance("buyer_a"),
      1,
      "validate must not grant",
    );
  });
});
