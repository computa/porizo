"use strict";

function createGiftPurchaseReversalService({ giftWalletRepository }) {
  async function reverseGiftPurchaseGrant({
    userId,
    purchaseTransactionId,
    tokenCount,
    provider,
    providerEventId,
    reversed = false,
    externalQuery = null,
  }) {
    if (!userId || !purchaseTransactionId || !provider || !providerEventId) {
      const err = new Error("INVALID_GIFT_PURCHASE_REVERSAL");
      err.code = "INVALID_GIFT_PURCHASE_REVERSAL";
      throw err;
    }
    const count = Number(tokenCount);
    if (!Number.isInteger(count) || count <= 0) {
      const err = new Error("INVALID_GIFT_PURCHASE_TOKEN_COUNT");
      err.code = "INVALID_GIFT_PURCHASE_TOKEN_COUNT";
      throw err;
    }
    return giftWalletRepository.applyPurchaseReversal({
      userId,
      purchaseTransactionId,
      amount: reversed ? count : -count,
      type: reversed ? "purchase_reversal_reversed" : "purchase_reversal",
      source: provider,
      referenceType: "purchase_transaction",
      referenceId: purchaseTransactionId,
      metadata: { provider, reversed },
      idempotencyKey: `gift_purchase_reversal:${provider}:${providerEventId}:${reversed ? "reversed" : "refund"}`,
      externalQuery,
    });
  }

  return { reverseGiftPurchaseGrant };
}

module.exports = { createGiftPurchaseReversalService };
