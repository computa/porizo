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
const {
  createEtsyCodeClaimService,
  normalizeEmail,
} = require("../../src/services/etsy-code-claim-service");

describe("Etsy code claims", () => {
  let db;
  let redemption;
  let claims;

  beforeEach(async () => {
    db = await initDb();
    redemption = createEtsyRedemptionService({
      db,
      giftWalletRepository: createGiftWalletRepository(db),
    });
    claims = createEtsyCodeClaimService({ db });
  });

  afterEach(async () => db?.close());

  it("normalizes and validates the verified email", () => {
    assert.equal(normalizeEmail(" Buyer@Example.COM "), "buyer@example.com");
    assert.throws(() => normalizeEmail("not-an-email"), {
      code: "INVALID_EMAIL",
    });
  });

  it("stores a pending claim server-side without exposing the code", async () => {
    const [code] = await redemption.mintBatch({
      batchLabel: "claim-pending",
      count: 1,
    });
    const transactionId = "magic_claim_pending";
    const now = new Date();
    await db
      .prepare(
        `INSERT INTO magic_login_transactions
          (id, platform, purpose, email_normalized, link_secret_hash,
           request_secret_hash, requester_key_hash, status, max_attempts,
           created_at, expires_at)
         VALUES (?, 'web', 'login', ?, 'link', 'request', 'requester',
                 'pending', 5, ?, ?)`,
      )
      .run(
        transactionId,
        "buyer@example.com",
        now.toISOString(),
        new Date(now.getTime() + 900_000).toISOString(),
      );

    const claim = await claims.createPending({
      code,
      email: "Buyer@Example.com",
      magicTransactionId: transactionId,
      expiresAt: new Date(now.getTime() + 900_000).toISOString(),
    });

    assert.equal(claim.emailNormalized, "buyer@example.com");
    assert.equal(Object.hasOwn(claim, "code"), false);
    const stored = await claims.findPendingForTransaction(transactionId);
    assert.equal(stored.code, code);
    await claims.expirePendingForTransaction(transactionId);
    assert.equal(
      await claims.findPendingForTransaction(transactionId),
      undefined,
    );
  });

  it("does not create claims for unknown, void, or redeemed codes", async () => {
    await assert.rejects(() => claims.assertRedeemable("PZ-XXXX-XXXX"), {
      code: "CODE_NOT_FOUND",
    });
    const [voidCode, usedCode] = await redemption.mintBatch({
      batchLabel: "claim-invalid",
      count: 2,
    });
    await redemption.voidCode({ code: voidCode, reason: "refund" });
    await db
      .prepare(
        "INSERT INTO users (id, created_at, risk_level) VALUES ('used_owner', CURRENT_TIMESTAMP, 'low')",
      )
      .run();
    await redemption.redeem({ code: usedCode, userId: "used_owner" });
    await assert.rejects(() => claims.assertRedeemable(voidCode), {
      code: "CODE_VOID",
    });
    await assert.rejects(() => claims.assertRedeemable(usedCode), {
      code: "CODE_ALREADY_REDEEMED",
    });
  });
});
