"use strict";

const crypto = require("crypto");
const { nowIso, toJson, parseJson } = require("../utils/common");
const { getFeatureFlag } = require("../services/feature-flags");

function registerBillingRoutes(app, {
  db,
  appConfig,
  requireUserId,
  sendError,
  addAuditEntry,
  eventsService,
  requireAdminRole,
  subscriptionManager,
  appleValidator,
  googleValidator,
  giftTokenProductId,
  getGiftWalletSummary,
  applyGiftWalletTransaction,
  appleWebhookHandler,
  planConfigService,
}) {
// ============ Billing API Routes ============

function parseBooleanQuery(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function isAppleAuthError(err) {
  const status = Number(err?.status);
  if (status === 401 || status === 403) {
    return true;
  }
  const errorCode = Number(err?.data?.errorCode || err?.data?.error_code);
  return [4010000, 4010001, 4010002, 4010003].includes(errorCode);
}

function sendAppleAuthFailure(reply, err) {
  if (!isAppleAuthError(err)) {
    return false;
  }
  sendError(
    reply,
    503,
    "APPLE_VALIDATION_AUTH_FAILED",
    "Apple validation auth failed. Check APPLE_APP_STORE_KEY_ID, APPLE_APP_STORE_ISSUER_ID, APPLE_APP_STORE_PRIVATE_KEY, and APPLE_BUNDLE_ID."
  );
  return true;
}

const GOOGLE_NOTIFICATION_TYPE = {
  SUBSCRIPTION_RECOVERED: 1,
  SUBSCRIPTION_RENEWED: 2,
  SUBSCRIPTION_CANCELED: 3,
  SUBSCRIPTION_PURCHASED: 4,
  SUBSCRIPTION_ON_HOLD: 5,
  SUBSCRIPTION_IN_GRACE_PERIOD: 6,
  SUBSCRIPTION_RESTARTED: 7,
  SUBSCRIPTION_PRICE_CHANGE_CONFIRMED: 8,
  SUBSCRIPTION_DEFERRED: 9,
  SUBSCRIPTION_PAUSED: 10,
  SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED: 11,
  SUBSCRIPTION_REVOKED: 12,
  SUBSCRIPTION_EXPIRED: 13,
};

function decodeGoogleWebhookPayload(body) {
  if (body?.message?.data && typeof body.message.data === "string") {
    try {
      return JSON.parse(Buffer.from(body.message.data, "base64").toString("utf8"));
    } catch {
      return null;
    }
  }
  return body || null;
}

function buildEntitlementsPayload(entitlements, subscription = null) {
  const toSafeInt = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
  };
  const toIsoOrNull = (value) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  };

  if (!entitlements) {
    return {
      tier: "free",
      base_songs_remaining: 0,
      songs_remaining: 0,
      songs_allowance: 0,
      songs_used_total: 0,
      poems_remaining: 0,
      poems_allowance: 0,
      poems_used_total: 0,
      trial_songs_remaining: 0,
      trial_expires_at: null,
      plan_id: null,
      billing_period: null,
      subscription_starts_at: null,
      subscription_renews_at: null,
      auto_renew_enabled: false,
      is_in_grace_period: false,
      admin_upgrade_tier: null,
      admin_upgrade_expires_at: null,
    };
  }

  return {
    tier: entitlements.tier,
    base_songs_remaining: toSafeInt(entitlements.baseSongsRemaining),
    songs_remaining: toSafeInt(entitlements.songsRemaining),
    songs_allowance: toSafeInt(entitlements.songsAllowance),
    songs_used_total: toSafeInt(entitlements.songsUsedTotal),
    poems_remaining: toSafeInt(entitlements.poemsRemaining),
    poems_allowance: toSafeInt(entitlements.poemsAllowance),
    poems_used_total: toSafeInt(entitlements.poemsUsedTotal),
    trial_songs_remaining: toSafeInt(entitlements.trialSongsRemaining),
    trial_expires_at: toIsoOrNull(entitlements.trialExpiresAt),
    plan_id: entitlements.planId,
    billing_period: entitlements.billingPeriod,
    subscription_starts_at: toIsoOrNull(entitlements.subscriptionStartsAt),
    subscription_renews_at: toIsoOrNull(entitlements.subscriptionRenewsAt),
    auto_renew_enabled: subscription?.auto_renew_enabled || false,
    is_in_grace_period: subscription?.status === "grace_period" || false,
    admin_upgrade_tier: entitlements.adminUpgradeTier || null,
    admin_upgrade_expires_at: toIsoOrNull(entitlements.adminUpgradeExpiresAt),
  };
}

async function handleGoogleSubscriptionValidation({
  userId,
  purchaseToken,
  subscriptionId,
}) {
  const validation = await googleValidator.verifySubscription(purchaseToken, subscriptionId);
  if (!validation.valid) {
    const err = new Error(validation.reason || "Receipt validation failed.");
    err.code = "INVALID_RECEIPT";
    throw err;
  }

  const resolvedSubscriptionId =
    subscriptionId ||
    validation.raw?.lineItems?.[0]?.productId ||
    null;

  if (!resolvedSubscriptionId) {
    const err = new Error("Could not resolve Google subscription product ID.");
    err.code = "INVALID_RECEIPT";
    throw err;
  }

  if (!validation.acknowledged) {
    try {
      await googleValidator.acknowledgePurchase(
        purchaseToken,
        resolvedSubscriptionId,
        "subscription"
      );
    } catch (ackErr) {
      app.log.warn(
        { err: ackErr.message, purchaseToken, subscriptionId: resolvedSubscriptionId },
        "[Billing] Failed to acknowledge Google purchase during restore/sync"
      );
    }
  }

  const subscription = await subscriptionManager.syncFromGoogle({
    userId,
    purchaseToken,
    subscriptionId: resolvedSubscriptionId,
    orderId: validation.orderId,
    tier: validation.tier,
    status: validation.status,
    expiresAt: validation.expiryTime,
    autoRenewing: validation.autoRenewing,
  });

  return {
    validation,
    subscription,
    subscriptionId: resolvedSubscriptionId,
  };
}

function isUniqueConstraintError(err) {
  const code = String(err?.code || "").toUpperCase();
  const message = String(err?.message || "");
  if (code === "23505" || code.includes("SQLITE_CONSTRAINT")) {
    return true;
  }
  return message.includes("UNIQUE") || message.toLowerCase().includes("duplicate");
}

async function resolveGiftBundle(productId) {
  const normalizedProductId =
    typeof productId === "string" ? productId.trim() : "";

  if (!normalizedProductId) {
    return { tokenCount: 1, bundleDisplayName: "1 Gift (Legacy)" };
  }

  try {
    const bundle = await db.prepare(
      "SELECT token_count, display_name FROM gift_bundles WHERE product_id = ?"
    ).get(normalizedProductId);

    if (bundle) {
      const tokenCount = Number(bundle.token_count || 0);
      if (!Number.isFinite(tokenCount) || tokenCount < 1 || tokenCount > 10) {
        const err = new Error("Token count exceeds maximum allowed (10).");
        err.code = "INVALID_BUNDLE";
        throw err;
      }
      return {
        tokenCount: Math.trunc(tokenCount),
        bundleDisplayName: bundle.display_name || `${tokenCount} Gift Tokens`,
      };
    }

    if (normalizedProductId !== giftTokenProductId) {
      const err = new Error(`Unsupported consumable product: ${normalizedProductId}`);
      err.code = "INVALID_PRODUCT";
      throw err;
    }

    return { tokenCount: 1, bundleDisplayName: "1 Gift Token" };
  } catch (err) {
    if (err?.code === "INVALID_PRODUCT" || err?.code === "INVALID_BUNDLE") {
      throw err;
    }

    // Zero-downtime fallback while gift_bundles migration rolls out.
    app.log.warn(
      { err: err.message, productId: normalizedProductId },
      "[Billing] gift_bundles lookup failed; falling back to legacy consumable handling"
    );

    if (normalizedProductId !== giftTokenProductId) {
      const invalidProductErr = new Error(
        `Unsupported consumable product: ${normalizedProductId}`
      );
      invalidProductErr.code = "INVALID_PRODUCT";
      throw invalidProductErr;
    }

    return { tokenCount: 1, bundleDisplayName: "1 Gift (Legacy)" };
  }
}

/**
 * Get user's billing entitlements (flat format for iOS BillingEntitlements model)
 * GET /billing/entitlements
 */
app.get("/billing/entitlements", async (request, reply) => {
  const userId = await requireUserId(request, reply);
  if (!userId) return;

  try {
    const entitlements = await subscriptionManager.getEntitlements(userId);
    const subscription = await subscriptionManager.getActiveSubscription(userId);
    reply.send(buildEntitlementsPayload(entitlements, subscription));
  } catch (err) {
    console.error("[Billing] Error fetching billing entitlements:", err);
    sendError(reply, 500, "BILLING_ERROR", err.message);
  }
});

/**
 * Get one-off gift wallet state
 * GET /billing/gift-wallet
 */
app.get("/billing/gift-wallet", async (request, reply) => {
  const userId = await requireUserId(request, reply);
  if (!userId) return;

  try {
    const summary = await getGiftWalletSummary(userId, Math.max(1, Math.min(100, parseInt(request.query?.limit) || 20)));
    reply.send({
      balance: summary.balance,
      updated_at: summary.updated_at,
      transactions: summary.transactions,
    });
  } catch (err) {
    console.error("[Billing] Gift wallet fetch error:", err);
    sendError(reply, 500, "GIFT_WALLET_ERROR", err.message);
  }
});

/**
 * Validate an Apple consumable purchase and credit one gift token.
 * POST /billing/receipt/apple/consumable
 */
app.post("/billing/receipt/apple/consumable", async (request, reply) => {
  const userId = await requireUserId(request, reply);
  if (!userId) return;

  const {
    transactionId,
    transaction_id: legacyTransactionId,
  } = request.body || {};
  const effectiveTransactionId = transactionId || legacyTransactionId;

  if (!effectiveTransactionId) {
    sendError(reply, 400, "MISSING_TRANSACTION_ID", "transactionId is required.");
    return;
  }

  if (!appleValidator.isConfigured()) {
    sendError(reply, 503, "APPLE_NOT_CONFIGURED", "Apple App Store validation not configured.");
    return;
  }

  try {
    const existingReceipt = await db.prepare(
      "SELECT id, user_id, product_id FROM purchase_receipts WHERE transaction_id = ?"
    ).get(effectiveTransactionId);
    if (existingReceipt) {
      if (existingReceipt.user_id !== userId) {
        sendError(
          reply,
          409,
          "PURCHASE_CONFLICT",
          "This purchase is already linked to a different account."
        );
        return;
      }

      let recoveredMissingCredit = false;
      const existingCredit = await db.prepare(
        `SELECT id
         FROM gift_wallet_transactions
         WHERE user_id = ?
           AND reference_type = 'receipt'
           AND reference_id = ?
         LIMIT 1`
      ).get(userId, existingReceipt.id);

      if (!existingCredit) {
        let existingBundle;
        try {
          existingBundle = await resolveGiftBundle(
            existingReceipt.product_id || giftTokenProductId
          );
        } catch (bundleErr) {
          if (bundleErr?.code === "INVALID_PRODUCT") {
            sendError(reply, 400, "INVALID_PRODUCT", bundleErr.message);
            return;
          }
          if (bundleErr?.code === "INVALID_BUNDLE") {
            sendError(reply, 400, "INVALID_BUNDLE", bundleErr.message);
            return;
          }
          throw bundleErr;
        }

        await applyGiftWalletTransaction({
          userId,
          type: "gift_purchase",
          amount: existingBundle.tokenCount,
          source: "apple_consumable_reconcile",
          referenceType: "receipt",
          referenceId: existingReceipt.id,
          description: `${existingBundle.bundleDisplayName} — Apple consumable gift purchase (reconciled)`,
          metadata: {
            transaction_id: effectiveTransactionId,
            product_id: existingReceipt.product_id,
            bundle_token_count: existingBundle.tokenCount,
            bundle_display_name: existingBundle.bundleDisplayName,
            recovered_from_missing_credit: true,
          },
          idempotencyKey: `gift_receipt_${effectiveTransactionId}`,
        });
        recoveredMissingCredit = true;
      }

      const summary = await getGiftWalletSummary(userId, 20);
      reply.send({
        success: true,
        already_processed: true,
        recovered_missing_credit: recoveredMissingCredit,
        balance: summary.balance,
        transactions: summary.transactions,
      });
      return;
    }

    const validation = await appleValidator.verifyTransaction(effectiveTransactionId);
    if (!validation.valid) {
      sendError(reply, 400, "INVALID_RECEIPT", validation.error || "Receipt validation failed.");
      return;
    }
    if (validation.type !== "one_time_purchase") {
      sendError(
        reply,
        400,
        "INVALID_RECEIPT_TYPE",
        "Transaction is not a consumable purchase."
      );
      return;
    }
    let tokenCount;
    let bundleDisplayName;
    try {
      const bundle = await resolveGiftBundle(validation.productId);
      tokenCount = bundle.tokenCount;
      bundleDisplayName = bundle.bundleDisplayName;
    } catch (bundleErr) {
      if (bundleErr?.code === "INVALID_PRODUCT") {
        sendError(reply, 400, "INVALID_PRODUCT", bundleErr.message);
        return;
      }
      if (bundleErr?.code === "INVALID_BUNDLE") {
        sendError(reply, 400, "INVALID_BUNDLE", bundleErr.message);
        return;
      }
      throw bundleErr;
    }

    const normalizedTransactionId = validation.transactionId || effectiveTransactionId;
    let receiptId = `rcpt_${crypto.randomBytes(12).toString("hex")}`;

    // C2: Wrap receipt INSERT + wallet credit in a single transaction to prevent
    // partial writes (receipt exists but balance not credited) on crash.
    await db.transaction(async (query) => {
      try {
        await query(
          `INSERT INTO purchase_receipts (
            id, user_id, subscription_id, transaction_id, original_transaction_id,
            product_id, platform, receipt_data, verification_status, verification_response,
            purchase_date, expires_date, is_trial, is_upgrade, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            receiptId,
            userId,
            null,
            normalizedTransactionId,
            validation.originalTransactionId || normalizedTransactionId,
            validation.productId,
            "apple",
            null,
            "verified",
            toJson({ type: validation.type, environment: validation.environment || "production" }),
            (validation.purchaseDate instanceof Date ? validation.purchaseDate : new Date()).toISOString(),
            null,
            0,
            0,
            nowIso(),
          ]
        );
      } catch (insertErr) {
        if (!isUniqueConstraintError(insertErr)) {
          throw insertErr;
        }
        const dedupResult = await query(
          "SELECT id, user_id, product_id FROM purchase_receipts WHERE transaction_id = ?",
          [normalizedTransactionId]
        );
        const dedupReceipt = dedupResult?.rows?.[0];
        if (!dedupReceipt) {
          throw insertErr;
        }
        if (dedupReceipt.user_id !== userId) {
          const err = new Error("PURCHASE_CONFLICT");
          err.statusCode = 409;
          throw err;
        }
        receiptId = dedupReceipt.id;
        if (dedupReceipt.product_id && dedupReceipt.product_id !== validation.productId) {
          const dedupBundle = await resolveGiftBundle(dedupReceipt.product_id);
          tokenCount = dedupBundle.tokenCount;
          bundleDisplayName = dedupBundle.bundleDisplayName;
        }
      }

      await applyGiftWalletTransaction({
        userId,
        type: "gift_purchase",
        amount: tokenCount,
        source: "apple_consumable",
        referenceType: "receipt",
        referenceId: receiptId,
        description: `${bundleDisplayName} — Apple consumable gift purchase`,
        metadata: {
          transaction_id: normalizedTransactionId,
          product_id: validation.productId,
          bundle_token_count: tokenCount,
          bundle_display_name: bundleDisplayName,
        },
        idempotencyKey: `gift_receipt_${normalizedTransactionId}`,
        externalQuery: query,
      });
    }).catch((txErr) => {
      if (txErr.statusCode === 409) {
        sendError(reply, 409, "PURCHASE_CONFLICT", "This purchase is already linked to a different account.");
        return null;
      }
      throw txErr;
    });
    if (reply.sent) return;

    await addAuditEntry({
      userId,
      action: "gift_token_purchased",
      resourceType: "purchase_receipt",
      resourceId: receiptId,
      metadata: { product_id: validation.productId, token_count: tokenCount },
    });
    eventsService.emit("gift_token_purchased", {
      userId,
      resourceType: "purchase_receipt",
      resourceId: receiptId,
      metadata: { product_id: validation.productId, token_count: tokenCount },
    });

    const summary = await getGiftWalletSummary(userId, 20);
    reply.send({
      success: true,
      already_processed: false,
      balance: summary.balance,
      transactions: summary.transactions,
    });
  } catch (err) {
    console.error("[Billing] Apple consumable sync error:", err.message);
    if (sendAppleAuthFailure(reply, err)) {
      return;
    }
    sendError(reply, 500, "GIFT_PURCHASE_SYNC_ERROR", err.message);
  }
});

/**
 * Validate Apple receipt and sync subscription
 * POST /billing/receipt/apple
 */
app.post("/billing/receipt/apple", async (request, reply) => {
  const userId = await requireUserId(request, reply);
  if (!userId) return;

  const {
    transactionId,
    transaction_id: legacyTransactionId,
  } = request.body || {};
  const effectiveTransactionId = transactionId || legacyTransactionId;

  if (!effectiveTransactionId) {
    sendError(
      reply,
      400,
      "MISSING_TRANSACTION_ID",
      "transactionId (or transaction_id) is required."
    );
    return;
  }

  if (!appleValidator.isConfigured()) {
    sendError(reply, 503, "APPLE_NOT_CONFIGURED", "Apple App Store validation not configured.");
    return;
  }

  try {
    // Validate with Apple
    const validation = await appleValidator.verifyTransaction(
      effectiveTransactionId
    );

    if (!validation.valid) {
      sendError(reply, 400, "INVALID_RECEIPT", validation.error || "Receipt validation failed.");
      return;
    }
    if (validation.type && validation.type !== "subscription") {
      sendError(
        reply,
        400,
        "INVALID_RECEIPT_TYPE",
        "Transaction is not an auto-renewable subscription."
      );
      return;
    }

    // Sync subscription to database
    const result = await subscriptionManager.syncSubscription(userId, validation);

    // Add audit entry
    await addAuditEntry({
      userId,
      action: "subscription_synced",
      resourceType: "subscription",
      resourceId: result.subscriptionId,
      metadata: {
        tier: result.tier,
        isNew: result.isNewSubscription,
        isRenewal: result.isRenewal,
        platform: "apple",
      },
    });

    // Fetch full entitlements after sync
    const entitlements = await subscriptionManager.getEntitlements(userId);
    const subscription = await subscriptionManager.getActiveSubscription(userId);

    reply.send({
      success: true,
      subscription: {
        id: result.subscriptionId,
        tier: result.tier,
        status: result.status,
        songs_granted: result.songsGranted,     // snake_case for iOS
        expires_at: result.expiresAt,           // snake_case for iOS
      },
      entitlements: {
        ...buildEntitlementsPayload(entitlements, subscription),
      },
    });
  } catch (err) {
    if (err.code === "INVALID_RECEIPT") {
      sendError(reply, 400, "INVALID_RECEIPT", err.message);
      return;
    }
    if (err.message === "SUBSCRIPTION_BELONGS_TO_ANOTHER_USER") {
      sendError(
        reply,
        409,
        "SUBSCRIPTION_CONFLICT",
        "This App Store subscription is already linked to a different account."
      );
      return;
    }
    if (sendAppleAuthFailure(reply, err)) {
      return;
    }
    console.error("[Billing] Apple receipt validation error:", err);
    sendError(reply, 500, "VALIDATION_ERROR", err.message);
  }
});

/**
 * Validate Google Play receipt and sync subscription
 * POST /billing/receipt/google
 *
 * Request body:
 * - purchase_token: string (required) - Google Play purchase token
 * - subscription_id: string (required) - Google Play subscription product ID
 */
app.post("/billing/receipt/google", async (request, reply) => {
  const userId = await requireUserId(request, reply);
  if (!userId) return;

  try {
    if (!googleValidator.isConfigured()) {
      sendError(reply, 501, "NOT_IMPLEMENTED", "Google Play validation is not configured.");
      return;
    }

    const {
      purchase_token,
      purchaseToken,
      subscription_id,
      subscriptionId,
    } = request.body || {};
    const resolvedPurchaseToken = purchase_token || purchaseToken;
    const resolvedSubscriptionId = subscription_id || subscriptionId;

    if (!resolvedPurchaseToken || !resolvedSubscriptionId) {
      sendError(reply, 400, "MISSING_PARAMS", "purchase_token and subscription_id are required.");
      return;
    }

    const { subscription } = await handleGoogleSubscriptionValidation({
      userId,
      purchaseToken: resolvedPurchaseToken,
      subscriptionId: resolvedSubscriptionId,
    });

    // Add audit entry for compliance (matching Apple endpoint pattern)
    await addAuditEntry({
      userId,
      action: "subscription_synced",
      resourceType: "subscription",
      resourceId: subscription.id,
      metadata: {
        tier: subscription.tier,
        isNew: subscription.is_new,
        platform: "google",
      },
    });

    // Fetch full entitlements after sync (matching Apple endpoint pattern)
    const entitlements = await subscriptionManager.getEntitlements(userId);

    reply.send({
      success: true,
      subscription: {
        id: subscription.id,
        tier: subscription.tier,
        status: subscription.status,
        expires_at: subscription.expires_at,
        auto_renewing: subscription.auto_renewing,
      },
      entitlements: entitlements ? buildEntitlementsPayload(entitlements) : null,
    });
  } catch (err) {
    if (err.code === "INVALID_RECEIPT") {
      sendError(reply, 400, "INVALID_RECEIPT", err.message);
      return;
    }
    if (err.message === "SUBSCRIPTION_BELONGS_TO_ANOTHER_USER") {
      sendError(
        reply,
        409,
        "RECEIPT_BELONGS_TO_OTHER_USER",
        "This Google Play subscription is already linked to a different account."
      );
      return;
    }
    console.error("[Billing] Google receipt validation error:", err);
    sendError(reply, 500, "VALIDATION_ERROR", err.message);
  }
});

/**
 * Get available subscription plans (public endpoint for clients)
 * GET /billing/plans
 */
app.get("/billing/plans", async (request, reply) => {
  try {
    const plans = await planConfigService.getPlans();
    const trialConfig = await planConfigService.getTrialConfig();
    const productMappings = await planConfigService.getProductMappings();

    const productIdsByPlan = new Map();
    for (const mapping of productMappings.values()) {
      const planEntry = productIdsByPlan.get(mapping.plan_id) || {
        apple: { monthly: null, annual: null },
        google: { monthly: null, annual: null },
      };
      if (mapping.platform === "apple" || mapping.platform === "google") {
        if (mapping.billing_period === "monthly" || mapping.billing_period === "annual") {
          planEntry[mapping.platform][mapping.billing_period] = mapping.product_id;
        }
      }
      productIdsByPlan.set(mapping.plan_id, planEntry);
    }

    // Filter to active plans and format for client consumption (snake_case for iOS)
    const activePlans = plans
      .filter((p) => p.is_active)
      .map((p) => {
        const productIds = productIdsByPlan.get(p.id) || {
          apple: { monthly: null, annual: null },
          google: { monthly: null, annual: null },
        };
        return {
          id: p.id,
          name: p.name,
          tier: p.tier,
          songs_per_month: p.songs_per_month,
          poems_per_month: p.poems_per_month,
          price_monthly_cents: p.price_monthly_cents || null,  // Keep in cents!
          price_annual_cents: p.price_annual_cents || null,    // Keep in cents!
          description: p.description,
          features: parseJson(p.features_json, [], "plan_features"),
          is_active: p.is_active,
          sort_order: p.sort_order,
          apple_product_ids: {
            monthly: productIds.apple.monthly,
            annual: productIds.apple.annual,
          },
          google_product_ids: {
            monthly: productIds.google.monthly,
            annual: productIds.google.annual,
          },
        };
      });

    reply.send({
      plans: activePlans,
      trial: trialConfig
        ? {
            songsAllowed: trialConfig.songs_allowed,
            durationDays: trialConfig.duration_days,
            isActive: Boolean(trialConfig.is_active),
          }
        : null,
    });
  } catch (err) {
    console.error("[Billing] Get plans error:", err);
    sendError(reply, 500, "PLANS_ERROR", err.message);
  }
});

/**
 * Get current subscription status
 * GET /billing/subscription-status
 */
const handleSubscriptionStatusGet = async (request, reply) => {
  const userId = await requireUserId(request, reply);
  if (!userId) return;

  try {
    const subscription = await subscriptionManager.getActiveSubscription(userId);
    const entitlements = await subscriptionManager.getEntitlements(userId);
    const hasActiveSubscription = Boolean(subscription);

    reply.send({
      hasActiveSubscription,
      has_subscription: hasActiveSubscription,
      subscription: subscription
        ? {
            id: subscription.id,
            tier: subscription.tier,
            status: subscription.status,
            productId: subscription.product_id,
            product_id: subscription.product_id,
            platform: subscription.platform,
            expiresAt: subscription.expires_at,
            expires_at: subscription.expires_at,
            autoRenewEnabled: Boolean(subscription.auto_renew_enabled),
            auto_renew_enabled: Boolean(subscription.auto_renew_enabled),
            isInGracePeriod: subscription.status === "grace_period",
            is_in_grace_period: subscription.status === "grace_period",
            gracePeriodExpiresAt: subscription.grace_period_expires_at,
            grace_period_expires_at: subscription.grace_period_expires_at,
            createdAt: subscription.created_at,
            created_at: subscription.created_at,
          }
        : null,
      entitlements: entitlements
        ? {
            tier: entitlements.tier,
            baseSongsRemaining: entitlements.baseSongsRemaining,
            base_songs_remaining: entitlements.baseSongsRemaining,
            songsRemaining: entitlements.songsRemaining,
            songs_remaining: entitlements.songsRemaining,
            songsAllowance: entitlements.songsAllowance,
            songs_allowance: entitlements.songsAllowance,
            songsUsedTotal: entitlements.songsUsedTotal,
            songs_used_total: entitlements.songsUsedTotal,
            trialSongsRemaining: entitlements.trialSongsRemaining,
            trial_songs_remaining: entitlements.trialSongsRemaining,
            trialExpiresAt: entitlements.trialExpiresAt,
            trial_expires_at: entitlements.trialExpiresAt,
            planId: entitlements.planId,
            plan_id: entitlements.planId,
            billingPeriod: entitlements.billingPeriod,
            billing_period: entitlements.billingPeriod,
            subscriptionStartsAt: entitlements.subscriptionStartsAt,
            subscription_starts_at: entitlements.subscriptionStartsAt,
            subscriptionRenewsAt: entitlements.subscriptionRenewsAt,
            subscription_renews_at: entitlements.subscriptionRenewsAt,
          }
        : null,
    });
  } catch (err) {
    console.error("[Billing] Get subscription status error:", err);
    sendError(reply, 500, "STATUS_ERROR", err.message);
  }
};

app.get("/billing/subscription-status", handleSubscriptionStatusGet);
// Backward-compatible alias used by older iOS clients.
app.get("/billing/subscription", handleSubscriptionStatusGet);

/**
 * Restore purchases from Apple/Google
 * POST /billing/restore
 */
app.post("/billing/restore", async (request, reply) => {
  const userId = await requireUserId(request, reply);
  if (!userId) return;

  const {
    platform,
    transactionId,
    transaction_id: legacyTransactionId,
    purchaseToken,
    purchase_token: legacyPurchaseToken,
    subscriptionId,
    subscription_id: legacySubscriptionId,
  } = request.body || {};
  const effectiveTransactionId = transactionId || legacyTransactionId;
  const effectivePurchaseToken = purchaseToken || legacyPurchaseToken || effectiveTransactionId;
  const effectiveSubscriptionId = subscriptionId || legacySubscriptionId || null;

  if (!platform || (platform === "apple" && !effectiveTransactionId) || (platform === "google" && !effectivePurchaseToken)) {
    sendError(
      reply,
      400,
      "MISSING_PARAMS",
      "platform and transactionId are required for Apple restore. Google restore requires purchaseToken (or transactionId) and optionally subscriptionId."
    );
    return;
  }

  if (platform !== "apple" && platform !== "google") {
    sendError(reply, 400, "INVALID_PLATFORM", "platform must be 'apple' or 'google'.");
    return;
  }

  try {
    let validation;

    if (platform === "apple") {
      if (!appleValidator.isConfigured()) {
        sendError(reply, 503, "APPLE_NOT_CONFIGURED", "Apple App Store validation not configured.");
        return;
      }
      validation = await appleValidator.verifyTransaction(effectiveTransactionId);
    } else {
      if (!googleValidator.isConfigured()) {
        sendError(reply, 501, "NOT_IMPLEMENTED", "Google Play validation is not configured.");
        return;
      }
      const { subscription } = await handleGoogleSubscriptionValidation({
        userId,
        purchaseToken: effectivePurchaseToken,
        subscriptionId: effectiveSubscriptionId,
      });

      await addAuditEntry({
        userId,
        action: "subscription_restored",
        resourceType: "subscription",
        resourceId: subscription.id,
        metadata: { platform, tier: subscription.tier },
      });

      reply.send({
        success: true,
        restored: true,
        subscription: {
          id: subscription.id,
          tier: subscription.tier,
          status: subscription.status,
          expiresAt: subscription.expires_at,
          songsRemaining: null,
        },
      });
      return;
    }

    if (!validation.valid) {
      sendError(reply, 400, "INVALID_RECEIPT", validation.error || "Receipt validation failed.");
      return;
    }
    if (validation.type && validation.type !== "subscription") {
      sendError(
        reply,
        400,
        "INVALID_RECEIPT_TYPE",
        "Transaction is not an auto-renewable subscription."
      );
      return;
    }

    // Sync subscription
    const result = await subscriptionManager.syncSubscription(userId, validation);

    await addAuditEntry({
      userId,
      action: "subscription_restored",
      resourceType: "subscription",
      resourceId: result.subscriptionId,
      metadata: { platform, tier: result.tier },
    });

    reply.send({
      success: true,
      restored: true,
      subscription: {
        id: result.subscriptionId,
        tier: result.tier,
        status: result.status,
        expiresAt: result.expiresAt,
        songsRemaining: result.songsRemaining,
      },
    });
  } catch (err) {
    if (err.message === "SUBSCRIPTION_BELONGS_TO_ANOTHER_USER") {
      sendError(
        reply,
        409,
        "SUBSCRIPTION_CONFLICT",
        "This App Store subscription is already linked to a different account."
      );
      return;
    }
    if (sendAppleAuthFailure(reply, err)) {
      return;
    }
    console.error("[Billing] Restore error:", err);
    sendError(reply, 500, "RESTORE_ERROR", err.message);
  }
});

/**
 * Activate free trial
 * POST /billing/trial/activate
 */
app.post("/billing/trial/activate", async (request, reply) => {
  const userId = await requireUserId(request, reply);
  if (!userId) return;

  try {
    const result = await subscriptionManager.activateTrial(userId);

    await addAuditEntry({
      userId,
      action: "trial_activated",
      resourceType: "entitlements",
      resourceId: userId,
      metadata: {
        songsGranted: result.songsGranted,
        durationDays: result.durationDays,
      },
    });

    // Flat structure with snake_case for iOS ActivateTrialResponse
    reply.send({
      success: true,
      trial: {
        songsGranted: result.songsGranted,
        songsRemaining: result.songsRemaining,
        expiresAt: result.trialExpiresAt,
        trialExpiresAt: result.trialExpiresAt,
        durationDays: result.durationDays,
      },
      songs_granted: result.songsGranted,
      songs_remaining: result.songsRemaining,
      trial_expires_at: result.trialExpiresAt,  // iOS expects trial_expires_at
      duration_days: result.durationDays,
    });
  } catch (err) {
    console.error("[Billing] Trial activation error:", err);
    // Check for user-friendly errors
    if (err.message.includes("already used")) {
      sendError(reply, 409, "TRIAL_ALREADY_USED", err.message);
    } else if (err.message.includes("disabled")) {
      sendError(reply, 503, "TRIAL_DISABLED", err.message);
    } else {
      sendError(reply, 500, "TRIAL_ERROR", err.message);
    }
  }
});

/**
 * Apple App Store Server Notifications v2 webhook
 * POST /billing/webhooks/apple
 */
app.post("/billing/webhooks/apple", async (request, reply) => {
  const { signedPayload } = request.body || {};

  if (!signedPayload) {
    console.error("[Apple Webhook] Missing signedPayload");
    return reply.status(400).send({ error: "Missing signedPayload" });
  }

  try {
    const result = await appleWebhookHandler.processNotification(signedPayload);

    if (!result.success) {
      const isInvalidPayload = result.error === "INVALID_PAYLOAD";
      if (!isInvalidPayload) {
        console.error("[Apple Webhook] Processing failed:", result);
      } else {
        console.warn("[Apple Webhook] Invalid payload received; acknowledging to prevent retry storms");
      }

      return reply.status(isInvalidPayload ? 200 : 400).send({
        received: true,
        processed: false,
        error: result.error,
        message: result.message,
      });
    }

    console.log("[Apple Webhook] Processed notification:", {
      notificationType: result.notificationType,
      subtype: result.subtype,
      notificationUUID: result.notificationUUID,
      skipped: result.skipped,
      action: result.result?.action,
    });

    reply.send({
      received: true,
      notificationUUID: result.notificationUUID,
      processed: !result.skipped,
    });
  } catch (err) {
    console.error("[Apple Webhook] Error:", err);
    reply.status(500).send({ error: "Webhook processing error" });
  }
});

/**
 * Google Play Real-time Developer Notifications webhook
 * POST /billing/webhooks/google
 */
app.post("/billing/webhooks/google", async (request, reply) => {
  try {
    const notification = decodeGoogleWebhookPayload(request.body);
    const subNotification = notification?.subscriptionNotification;

    if (!subNotification?.purchaseToken) {
      reply.send({ received: true, processed: false, message: "Ignored non-subscription Google webhook" });
      return;
    }

    const purchaseToken = subNotification.purchaseToken;
    const subscriptionId = subNotification.subscriptionId || null;
    const notificationType = Number(subNotification.notificationType);

    const existing = await db.prepare(
      "SELECT id, user_id FROM subscriptions WHERE platform = 'google' AND original_transaction_id = ? LIMIT 1"
    ).get(purchaseToken);

    if (!existing?.user_id) {
      reply.send({
        received: true,
        processed: false,
        deferred: true,
        message: "Google subscription not linked to a user yet",
      });
      return;
    }

    if (notificationType === GOOGLE_NOTIFICATION_TYPE.SUBSCRIPTION_REVOKED) {
      await subscriptionManager.handleRevocation(existing.id);
    } else {
      const { subscription } = await handleGoogleSubscriptionValidation({
        userId: existing.user_id,
        purchaseToken,
        subscriptionId,
      });

      if (
        notificationType === GOOGLE_NOTIFICATION_TYPE.SUBSCRIPTION_EXPIRED ||
        notificationType === GOOGLE_NOTIFICATION_TYPE.SUBSCRIPTION_CANCELED
      ) {
        await subscriptionManager.handleExpiration(subscription.id);
      }
    }

    reply.send({
      received: true,
      processed: true,
      notificationType,
    });
  } catch (err) {
    console.error("[Google Webhook] Error:", err);
    reply.status(500).send({ error: "Webhook processing error" });
  }
});

/**
 * Admin: Inspect a user's subscription + entitlements + recent receipt history.
 * GET /admin/billing/users/:targetUserId
 */
app.get("/admin/billing/users/:targetUserId", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ["admin", "superadmin"]);
  if (!admin) return;

  const { targetUserId } = request.params || {};
  if (!targetUserId) {
    sendError(reply, 400, "INVALID_PARAMS", "targetUserId is required.");
    return;
  }

  try {
    const entitlements = await subscriptionManager.getEntitlements(targetUserId);
    const activeSubscription = await subscriptionManager.getActiveSubscription(
      targetUserId
    );
    const latestSubscription = await db.prepare(
      `SELECT * FROM subscriptions
       WHERE user_id = ?
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 1`
    ).get(targetUserId);
    const recentReceipts = await db.prepare(
      `SELECT transaction_id, original_transaction_id, product_id, platform,
              verification_status, purchase_date, expires_date, created_at
       FROM purchase_receipts
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 20`
    ).all(targetUserId);

    reply.send({
      userId: targetUserId,
      entitlements,
      activeSubscription,
      latestSubscription,
      recentReceipts,
    });
  } catch (err) {
    console.error("[Admin] Get user billing snapshot error:", err);
    sendError(reply, 500, "BILLING_LOOKUP_ERROR", err.message);
  }
});

/**
 * Admin: Pull subscription state from App Store and sync to a target user.
 * POST /admin/billing/sync/apple
 *
 * body:
 * - targetUserId: string
 * - transactionId OR transaction_id: string
 * - sync_all_subscriptions: boolean (optional, default false)
 */
app.post("/admin/billing/sync/apple", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ["admin", "superadmin"]);
  if (!admin) return;

  const {
    targetUserId,
    transactionId,
    transaction_id: legacyTransactionId,
    sync_all_subscriptions: syncAllSubscriptions = false,
  } = request.body || {};
  const effectiveTransactionId = transactionId || legacyTransactionId;

  if (!targetUserId || !effectiveTransactionId) {
    sendError(
      reply,
      400,
      "INVALID_PARAMS",
      "targetUserId and transactionId (or transaction_id) are required."
    );
    return;
  }

  if (!appleValidator.isConfigured()) {
    sendError(
      reply,
      503,
      "APPLE_NOT_CONFIGURED",
      "Apple App Store validation not configured."
    );
    return;
  }

  try {
    const syncResults = [];
    const syncErrors = [];

    if (syncAllSubscriptions) {
      const subscriptions = await appleValidator.getAllSubscriptions(
        effectiveTransactionId
      );
      if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
        sendError(
          reply,
          404,
          "SUBSCRIPTIONS_NOT_FOUND",
          "No subscriptions were found for the provided transaction."
        );
        return;
      }

      for (const validation of subscriptions) {
      if (!validation?.valid || (validation.type && validation.type !== "subscription")) {
        continue;
      }
        try {
          const result = await subscriptionManager.syncSubscription(
            targetUserId,
            validation
          );
          syncResults.push(result);
        } catch (err) {
          syncErrors.push({
            productId: validation.productId || null,
            error: err.message,
          });
        }
      }
    } else {
      const validation = await appleValidator.verifyTransaction(
        effectiveTransactionId
      );
      if (!validation.valid) {
        sendError(
          reply,
          400,
          "INVALID_RECEIPT",
          validation.error || "Receipt validation failed."
        );
        return;
      }
      if (validation.type && validation.type !== "subscription") {
        sendError(
          reply,
          400,
          "INVALID_RECEIPT_TYPE",
          "Transaction is not an auto-renewable subscription."
        );
        return;
      }

      const result = await subscriptionManager.syncSubscription(
        targetUserId,
        validation
      );
      syncResults.push(result);
    }

    if (syncResults.length === 0) {
      const firstError = syncErrors[0]?.error || "No subscriptions were synced.";
      if (firstError === "SUBSCRIPTION_BELONGS_TO_ANOTHER_USER") {
        sendError(
          reply,
          409,
          "SUBSCRIPTION_CONFLICT",
          "The provided App Store subscription belongs to another user."
        );
        return;
      }
      sendError(reply, 400, "SYNC_FAILED", firstError);
      return;
    }

    const entitlements = await subscriptionManager.getEntitlements(targetUserId);
    const activeSubscription = await subscriptionManager.getActiveSubscription(
      targetUserId
    );

    await addAuditEntry({
      userId: admin.adminId,
      action: "admin_subscription_sync",
      resourceType: "subscription",
      resourceId: activeSubscription?.id || syncResults[0].subscriptionId || null,
      metadata: {
        target_user_id: targetUserId,
        transaction_id: effectiveTransactionId,
        sync_all_subscriptions: Boolean(syncAllSubscriptions),
        synced_count: syncResults.length,
        failed_count: syncErrors.length,
        failed: syncErrors,
        admin_email: admin.email,
        actor: "admin",
      },
    });

    reply.send({
      success: true,
      targetUserId,
      syncedCount: syncResults.length,
      failedCount: syncErrors.length,
      results: syncResults,
      errors: syncErrors,
      entitlements,
      activeSubscription,
    });
  } catch (err) {
    if (err.message === "SUBSCRIPTION_BELONGS_TO_ANOTHER_USER") {
      sendError(
        reply,
        409,
        "SUBSCRIPTION_CONFLICT",
        "The provided App Store subscription belongs to another user."
      );
      return;
    }
    if (sendAppleAuthFailure(reply, err)) {
      return;
    }
    console.error("[Admin] Apple subscription sync error:", err);
    sendError(reply, 500, "SYNC_ERROR", err.message);
  }
});

/**
 * Admin: Grant songs to user
 * POST /admin/billing/grant-songs
 */
app.post("/admin/billing/grant-songs", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ["superadmin"]);
  if (!admin) return;

  const { targetUserId, amount, reason } = request.body || {};

  if (!targetUserId || !amount || amount <= 0) {
    sendError(reply, 400, "INVALID_PARAMS", "targetUserId and amount (positive) are required.");
    return;
  }

  try {
    const result = await subscriptionManager.adminGrantSongs(
      targetUserId,
      amount,
      reason || "Admin grant"
    );

    await addAuditEntry({
      userId: admin.adminId,
      action: "admin_grant_songs",
      resourceType: "entitlements",
      resourceId: targetUserId,
      metadata: { amount, reason, grantedBy: admin.adminId, admin_email: admin.email, actor: "admin" },
    });

    reply.send({
      success: true,
      songsGranted: result.songsGranted,
      songsRemaining: result.songsRemaining,
    });
  } catch (err) {
    console.error("[Admin] Grant songs error:", err);
    sendError(reply, 500, "GRANT_ERROR", err.message);
  }
});

/**
 * Admin: Grant poems to a user
 * POST /admin/billing/grant-poems
 */
app.post("/admin/billing/grant-poems", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ["superadmin"]);
  if (!admin) return;

  const { targetUserId, amount, reason } = request.body || {};

  if (!targetUserId || !amount || amount <= 0) {
    sendError(reply, 400, "INVALID_PARAMS", "targetUserId and amount (positive) are required.");
    return;
  }

  try {
    const result = await subscriptionManager.adminGrantPoems(
      targetUserId,
      amount,
      reason || "Admin grant"
    );

    await addAuditEntry({
      userId: admin.adminId,
      action: "admin_grant_poems",
      resourceType: "entitlements",
      resourceId: targetUserId,
      metadata: { amount, reason, grantedBy: admin.adminId, admin_email: admin.email, actor: "admin" },
    });

    reply.send({
      success: true,
      poemsGranted: result.poemsGranted,
      poemsRemaining: result.poemsRemaining,
    });
  } catch (err) {
    console.error("[Admin] Grant poems error:", err);
    sendError(reply, 500, "GRANT_ERROR", err.message);
  }
});

/**
 * Admin: Reset user preview count
 * POST /admin/billing/reset-previews
 */
app.post("/admin/billing/reset-previews", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ["superadmin"]);
  if (!admin) return;

  const { targetUserId } = request.body || {};

  if (!targetUserId) {
    sendError(reply, 400, "INVALID_PARAMS", "targetUserId is required.");
    return;
  }

  try {
    const result = await db.prepare(
      "UPDATE entitlements SET preview_count_today = 0, updated_at = ? WHERE user_id = ?"
    ).run(nowIso(), targetUserId);

    if (result.changes === 0) {
      sendError(reply, 404, "USER_NOT_FOUND", "No entitlements found for user.");
      return;
    }

    await addAuditEntry({
      userId: admin.adminId,
      action: "admin_reset_previews",
      resourceType: "entitlements",
      resourceId: targetUserId,
      metadata: { resetBy: admin.adminId, admin_email: admin.email, actor: "admin" },
    });

    console.log(`[Admin] Reset preview count for user ${targetUserId} by ${admin.email}`);
    reply.send({ success: true, userId: targetUserId, preview_count_today: 0 });
  } catch (err) {
    console.error("[Admin] Reset previews error:", err);
    sendError(reply, 500, "RESET_ERROR", err.message);
  }
});

/**
 * Dev: Reset preview count with secret (for testing)
 * POST /dev/reset-previews
 */
if (appConfig.DEV_MODE) {
  app.post("/dev/reset-previews", async (request, reply) => {
    const secret = request.headers["x-dev-secret"];
    const expectedSecret = process.env.DEV_SECRET;

    if (!expectedSecret || secret !== expectedSecret) {
      sendError(reply, 403, "FORBIDDEN", "Invalid or missing dev secret");
      return;
    }

    const { userId } = request.body || {};
    if (!userId) {
      sendError(reply, 400, "INVALID_PARAMS", "userId is required");
      return;
    }

    try {
      const result = await db.prepare(
        "UPDATE entitlements SET preview_count_today = 0, updated_at = ? WHERE user_id = ?"
      ).run(nowIso(), userId);

      if (result.changes === 0) {
        sendError(reply, 404, "NOT_FOUND", "User entitlements not found");
        return;
      }

      console.log(`[Dev] Reset previews for user ${userId}`);
      reply.send({ success: true, userId, preview_count_today: 0 });
    } catch (err) {
      console.error("[Dev] Reset error:", err);
      sendError(reply, 500, "ERROR", "Reset failed");
    }
  });
}

/**
 * Admin: Get subscription plans
 * GET /admin/plans
 */
app.get("/admin/plans", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ["admin", "superadmin"]);
  if (!admin) return;

  try {
    const plans = await planConfigService.getPlans({ includeInactive: true });
    const trialConfig = await planConfigService.getTrialConfig();
    const freeTierGrant = {
      songs: (await getFeatureFlag(db, "free_tier_songs_grant")) ?? 1,
      poems: (await getFeatureFlag(db, "free_tier_poems_grant")) ?? 1,
    };

    reply.send({ plans, trialConfig, freeTierGrant });
  } catch (err) {
    console.error("[Admin] Get plans error:", err);
    sendError(reply, 500, "PLANS_ERROR", err.message);
  }
});

/**
 * Admin: Update trial configuration
 * PUT /admin/trial/config
 */
app.put("/admin/trial/config", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ["superadmin"]);
  if (!admin) return;

  const { songs_allowed, duration_days, is_active } = request.body || {};

  try {
    const result = await planConfigService.updateTrialConfig({
      songs_allowed,
      duration_days,
      is_active,
    });

    await addAuditEntry({
      userId: admin.adminId,
      action: "admin_update_trial_config",
      resourceType: "trial_config",
      resourceId: "1",
      metadata: { songs_allowed, duration_days, is_active, admin_email: admin.email, actor: "admin" },
    });

    reply.send({ success: true, trialConfig: result });
  } catch (err) {
    console.error("[Admin] Update trial config error:", err);
    sendError(reply, 500, "UPDATE_ERROR", err.message);
  }
});

/**
 * Admin: Update a subscription plan
 * PUT /admin/plans/:planId
 */
app.put("/admin/plans/:planId", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ["superadmin"]);
  if (!admin) return;

  const { planId } = request.params;
  const updates = request.body || {};

  const allowedFields = [
    "name", "songs_per_month", "poems_per_month", "previews_per_day",
    "price_monthly_cents", "price_annual_cents",
    "description", "features_json", "is_active", "sort_order"
  ];
  const filteredUpdates = {};
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      filteredUpdates[field] = updates[field];
    }
  }

  if (Object.keys(filteredUpdates).length === 0) {
    sendError(reply, 400, "NO_UPDATES", "No valid fields to update.");
    return;
  }

  try {
    const result = await planConfigService.updatePlan(planId, filteredUpdates);

    await addAuditEntry({
      userId: admin.adminId,
      action: "admin_update_plan",
      resourceType: "subscription_plan",
      resourceId: planId,
      metadata: { ...filteredUpdates, admin_email: admin.email, actor: "admin" },
    });

    reply.send({ success: true, plan: result });
  } catch (err) {
    console.error("[Admin] Update plan error:", err);
    if (err.message.includes("not found")) {
      sendError(reply, 404, "PLAN_NOT_FOUND", err.message);
    } else {
      sendError(reply, 500, "UPDATE_ERROR", err.message);
    }
  }
});

/**
 * Admin: Create a new subscription plan
 * POST /admin/plans
 */
app.post("/admin/plans", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ["superadmin"]);
  if (!admin) return;

  const { id, name, tier, songs_per_month, poems_per_month, previews_per_day,
    price_monthly_cents, price_annual_cents, description,
    features_json, is_active, sort_order } = request.body || {};

  if (!name || !tier || songs_per_month === undefined) {
    sendError(reply, 400, "MISSING_FIELDS", "name, tier, and songs_per_month are required.");
    return;
  }

  const validTiers = ["free", "trial", "plus", "pro"];
  if (!validTiers.includes(tier)) {
    sendError(reply, 400, "INVALID_TIER", `tier must be one of: ${validTiers.join(", ")}`);
    return;
  }

  let featuresArray = features_json;
  if (typeof features_json === "string") {
    try { featuresArray = JSON.parse(features_json); } catch { featuresArray = null; }
  }

  try {
    const plan = await planConfigService.createPlan({
      id, name, tier, songs_per_month, poems_per_month, previews_per_day,
      price_monthly_cents, price_annual_cents, description,
      features_json: featuresArray, is_active, sort_order,
    });

    await addAuditEntry({
      userId: admin.adminId,
      action: "admin_create_plan",
      resourceType: "subscription_plan",
      resourceId: plan.id,
      metadata: { name, tier, songs_per_month, poems_per_month, admin_email: admin.email, actor: "admin" },
    });

    reply.send({ success: true, plan });
  } catch (err) {
    console.error("[Admin] Create plan error:", err);
    const errMsg = err?.message || String(err);
    if (errMsg.includes("UNIQUE") || errMsg.includes("duplicate")) {
      sendError(reply, 409, "DUPLICATE_PLAN", "A plan with this ID already exists.");
    } else {
      sendError(reply, 500, "CREATE_ERROR", errMsg);
    }
  }
});

/**
 * Admin: Add product mapping to a plan
 * POST /admin/plans/:planId/products
 */
app.post("/admin/plans/:planId/products", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ["superadmin"]);
  if (!admin) return;

  const { planId } = request.params;
  const { platform, product_id, billing_period } = request.body || {};

  if (!platform || !product_id || !billing_period) {
    sendError(reply, 400, "MISSING_FIELDS", "platform, product_id, and billing_period are required.");
    return;
  }

  if (!["apple", "google"].includes(platform)) {
    sendError(reply, 400, "INVALID_PLATFORM", "platform must be 'apple' or 'google'.");
    return;
  }

  if (!["monthly", "annual"].includes(billing_period)) {
    sendError(reply, 400, "INVALID_BILLING_PERIOD", "billing_period must be 'monthly' or 'annual'.");
    return;
  }

  try {
    const result = await planConfigService.addProductMapping({
      plan_id: planId,
      platform,
      product_id,
      billing_period,
    });

    await addAuditEntry({
      userId: admin.adminId,
      action: "admin_add_product_mapping",
      resourceType: "plan_product",
      resourceId: result.id,
      metadata: { plan_id: planId, platform, product_id, billing_period, admin_email: admin.email, actor: "admin" },
    });

    reply.send({ success: true, productMapping: result });
  } catch (err) {
    console.error("[Admin] Add product mapping error:", err);
    if (err.message.includes("already exists")) {
      sendError(reply, 409, "DUPLICATE_MAPPING", err.message);
    } else {
      sendError(reply, 500, "ADD_ERROR", err.message);
    }
  }
});

/**
 * Admin: Remove product mapping
 * DELETE /admin/products/:platform/:productId
 */
app.delete("/admin/products/:platform/:productId", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ["superadmin"]);
  if (!admin) return;

  const { platform, productId } = request.params;

  try {
    await planConfigService.removeProductMapping(platform, productId);

    await addAuditEntry({
      userId: admin.adminId,
      action: "admin_remove_product_mapping",
      resourceType: "plan_product",
      resourceId: productId,
      metadata: { platform, product_id: productId, admin_email: admin.email, actor: "admin" },
    });

    reply.send({ success: true });
  } catch (err) {
    console.error("[Admin] Remove product mapping error:", err);
    sendError(reply, 500, "REMOVE_ERROR", err.message);
  }
});

/**
 * Admin: Get products for a specific plan
 * GET /admin/plans/:planId/products
 */
app.get("/admin/plans/:planId/products", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ["admin", "superadmin"]);
  if (!admin) return;

  const { planId } = request.params;

  try {
    const products = await planConfigService.getProductsForPlan(planId);
    reply.send({ products });
  } catch (err) {
    console.error("[Admin] Get plan products error:", err);
    sendError(reply, 500, "GET_ERROR", err.message);
  }
});

/**
 * Admin: Billing preflight checks for TestFlight rollout readiness
 * GET /admin/billing/preflight
 * Optional query:
 * - expected_bundle_id: exact bundle ID expected in runtime config
 * - verify_apple_auth: when truthy, runs a live App Store API auth probe
 */
app.get("/admin/billing/preflight", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ["admin", "superadmin"]);
  if (!admin) return;

  const expectedBundleId =
    typeof request.query?.expected_bundle_id === "string"
      ? request.query.expected_bundle_id.trim()
      : "";
  const verifyAppleAuth = parseBooleanQuery(request.query?.verify_apple_auth);

  try {
    const plans = await planConfigService.getPlans({ includeInactive: true });
    const productMappings = await planConfigService.getProductMappings();

    const issues = [];
    const warnings = [];
    const appleMappings = [];
    const seenProductIds = new Map();
    const requiredByPlan = [];

    for (const mapping of productMappings.values()) {
      if (mapping.platform !== "apple") continue;
      appleMappings.push(mapping);

      const previousPlanId = seenProductIds.get(mapping.product_id);
      if (previousPlanId && previousPlanId !== mapping.plan_id) {
        issues.push({
          code: "DUPLICATE_APPLE_PRODUCT_ID",
          message: `Apple product ID '${mapping.product_id}' is mapped to multiple plans.`,
          details: {
            product_id: mapping.product_id,
            first_plan_id: previousPlanId,
            duplicate_plan_id: mapping.plan_id,
          },
        });
      } else {
        seenProductIds.set(mapping.product_id, mapping.plan_id);
      }
    }

    const activePaidPlans = plans.filter((plan) => plan.is_active && plan.tier !== "free");
    for (const plan of activePaidPlans) {
      const planMappings = appleMappings.filter((mapping) => mapping.plan_id === plan.id);
      const monthly = planMappings.find((mapping) => mapping.billing_period === "monthly");
      const annual = planMappings.find((mapping) => mapping.billing_period === "annual");
      const needsMonthly = plan.price_monthly_cents !== null;
      const needsAnnual = plan.price_annual_cents !== null;

      requiredByPlan.push({
        plan_id: plan.id,
        tier: plan.tier,
        requires: {
          monthly: needsMonthly,
          annual: needsAnnual,
        },
        found: {
          monthly: monthly?.product_id || null,
          annual: annual?.product_id || null,
        },
      });

      if (needsMonthly && !monthly) {
        issues.push({
          code: "MISSING_APPLE_MONTHLY_MAPPING",
          message: `Plan '${plan.id}' is active with monthly price but has no Apple monthly product mapping.`,
          details: { plan_id: plan.id, tier: plan.tier },
        });
      }
      if (needsAnnual && !annual) {
        issues.push({
          code: "MISSING_APPLE_ANNUAL_MAPPING",
          message: `Plan '${plan.id}' is active with annual price but has no Apple annual product mapping.`,
          details: { plan_id: plan.id, tier: plan.tier },
        });
      }
    }

    const configuredBundleId =
      appConfig.APPLE_BUNDLE_ID || process.env.APPLE_BUNDLE_ID || null;
    const appleValidatorConfigured = appleValidator.isConfigured();
    let appleAuthProbe = null;

    if (!configuredBundleId) {
      issues.push({
        code: "MISSING_APPLE_BUNDLE_ID",
        message: "APPLE_BUNDLE_ID is not configured at runtime.",
        details: null,
      });
    }

    if (!appleValidatorConfigured) {
      issues.push({
        code: "APPLE_VALIDATOR_NOT_CONFIGURED",
        message: "Apple receipt validator is not fully configured (missing key/issuer/private-key/bundle-id).",
        details: null,
      });
    }

    if (expectedBundleId && configuredBundleId && configuredBundleId !== expectedBundleId) {
      issues.push({
        code: "APPLE_BUNDLE_ID_MISMATCH",
        message: "Runtime APPLE_BUNDLE_ID does not match expected bundle ID.",
        details: {
          expected_bundle_id: expectedBundleId,
          configured_bundle_id: configuredBundleId,
        },
      });
    }

    if (!expectedBundleId) {
      warnings.push({
        code: "EXPECTED_BUNDLE_ID_NOT_PROVIDED",
        message: "No expected_bundle_id query parameter supplied; bundle match check was skipped.",
      });
    }

    if (verifyAppleAuth) {
      if (typeof appleValidator.probeAuthentication !== "function") {
        warnings.push({
          code: "APPLE_AUTH_PROBE_NOT_SUPPORTED",
          message: "Current validator does not support auth probing.",
        });
      } else if (appleValidatorConfigured) {
        appleAuthProbe = await appleValidator.probeAuthentication();
        if (!appleAuthProbe?.ok) {
          issues.push({
            code: "APPLE_AUTH_PROBE_FAILED",
            message: "Apple App Store Server API auth probe failed.",
            details: appleAuthProbe,
          });
        }
      }
    }

    reply.send({
      ok: issues.length === 0,
      checked_at: new Date().toISOString(),
      checks: {
        apple_bundle_id: {
          configured: configuredBundleId,
          expected: expectedBundleId || null,
          matches_expected: expectedBundleId
            ? configuredBundleId === expectedBundleId
            : null,
          validator_configured: appleValidatorConfigured,
        },
        apple_auth: {
          requested: verifyAppleAuth,
          probe: appleAuthProbe,
        },
        apple_products: {
          active_paid_plan_count: activePaidPlans.length,
          apple_mapping_count: appleMappings.length,
          unique_apple_product_id_count: seenProductIds.size,
          required_by_plan: requiredByPlan,
        },
      },
      issues,
      warnings,
    });
  } catch (err) {
    console.error("[Admin] Billing preflight error:", err);
    sendError(reply, 500, "BILLING_PREFLIGHT_ERROR", err.message);
  }
});

}

module.exports = { registerBillingRoutes };
