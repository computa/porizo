"use strict";

const crypto = require("node:crypto");
const { getGuardClientIp } = require("../utils/client-ip");
const { getFeatureFlag } = require("../services/feature-flags");
const {
  createEtsyRedemptionService,
} = require("../services/etsy-redemption-service");
const { normalizeReceiptId } = require("../services/etsy-order-service");
const {
  TurnstileUnavailableError,
  createTurnstileVerifier,
} = require("../services/turnstile");

const HOUR_MS = 60 * 60 * 1000;
// Brute-force guard: a buyer types one code from a printed insert. Ten attempts
// per IP per hour absorbs typos without letting anyone enumerate the space.
const REDEEM_ATTEMPTS_MAX = 10;
const CLAIM_PROOF_TTL_MS = 5 * 60 * 1000;

// Service error code -> public HTTP status. Anything unmapped is a 500.
const ERROR_STATUS = {
  CODE_NOT_FOUND: 404,
  CODE_ALREADY_REDEEMED: 409,
  CODE_VOID: 410,
  USER_REQUIRED: 401,
};

function claimProofSecret() {
  const secret =
    process.env.ETSY_CLAIM_PROOF_SECRET || process.env.JWT_SECRET || "";
  if (!secret) throw new Error("ETSY_CLAIM_PROOF_SECRET is not configured");
  return secret;
}

function claimProofSubject(receiptId, clientIp) {
  return crypto
    .createHash("sha256")
    .update(`${String(receiptId || "").trim()}\n${clientIp}`)
    .digest("hex");
}

function mintClaimProof(receiptId, clientIp, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({
      sub: claimProofSubject(receiptId, clientIp),
      exp: now + CLAIM_PROOF_TTL_MS,
      nonce: crypto.randomBytes(12).toString("hex"),
    }),
  ).toString("base64url");
  const signature = crypto
    .createHmac("sha256", claimProofSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function verifyClaimProof(proof, receiptId, clientIp, now = Date.now()) {
  const [payload, signature, extra] = String(proof || "").split(".");
  if (!payload || !signature || extra) return false;
  const expected = crypto
    .createHmac("sha256", claimProofSecret())
    .update(payload)
    .digest();
  let actual;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return false;
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    return false;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return (
      parsed.sub === claimProofSubject(receiptId, clientIp) &&
      Number.isFinite(parsed.exp) &&
      parsed.exp >= now
    );
  } catch {
    return false;
  }
}

function registerWebEtsyRoutes(
  app,
  {
    db,
    rateLimitRepository,
    sendError,
    requireUserId,
    giftWalletRepository,
    etsyOrderService = null,
    turnstileVerifier = createTurnstileVerifier({
      secretKey: process.env.TURNSTILE_SECRET_KEY,
      environment: process.env.NODE_ENV,
    }),
    etsyRedemptionService = createEtsyRedemptionService({
      db,
      giftWalletRepository,
    }),
  },
) {
  async function funnelEnabled(request, reply) {
    let enabled;
    try {
      enabled = await getFeatureFlag(db, "web_funnel_enabled", {
        throwOnError: true,
      });
    } catch (error) {
      request.log.error({ err: error }, "Web funnel flag lookup failed");
      sendError(
        reply,
        503,
        "FUNNEL_CONFIG_UNAVAILABLE",
        "Song creation is temporarily unavailable.",
      );
      return false;
    }
    if (enabled !== true) {
      sendError(reply, 404, "NOT_FOUND", "Not found.");
      return false;
    }
    return true;
  }

  async function etsyEntryEnabled(request, reply) {
    let enabled;
    try {
      enabled = await getFeatureFlag(db, "etsy_entry_enabled", {
        throwOnError: true,
      });
    } catch (error) {
      request.log.error({ err: error }, "Etsy entry flag lookup failed");
      sendError(
        reply,
        503,
        "ETSY_CONFIG_UNAVAILABLE",
        "Etsy fulfilment is temporarily unavailable.",
      );
      return false;
    }
    if (enabled !== true) {
      sendError(reply, 404, "ETSY_ENTRY_DISABLED", "Not found.");
      return false;
    }
    return true;
  }

  async function legacyRedemptionEnabled() {
    return getFeatureFlag(db, "etsy_legacy_code_redemption_enabled", {
      throwOnError: true,
    });
  }

  async function withinRedeemLimit(request, reply) {
    const clientIp = getGuardClientIp(request);
    let limit;
    try {
      limit = await rateLimitRepository.consume({
        key: { subject: "ip", value: `ip:${clientIp}` },
        action: "etsy_redeem_attempts",
        max: REDEEM_ATTEMPTS_MAX,
        windowMs: HOUR_MS,
      });
    } catch (error) {
      request.log.error({ err: error }, "Etsy redeem rate limit failed");
      sendError(
        reply,
        503,
        "FUNNEL_GUARD_UNAVAILABLE",
        "We couldn't verify this request. Please try again.",
      );
      return false;
    }
    if (!limit.allowed) {
      const retryAfter = Math.max(
        1,
        Math.ceil((Date.parse(limit.resetAt) - Date.now()) / 1000),
      );
      reply.header("Retry-After", String(retryAfter));
      sendError(
        reply,
        429,
        "ETSY_REDEEM_LIMIT_REACHED",
        "Too many code attempts from this connection.",
        { retry_at: limit.resetAt },
      );
      return false;
    }
    return true;
  }

  app.post("/web/etsy/redeem", async (request, reply) => {
    if (!(await funnelEnabled(request, reply))) return;
    if (!(await legacyRedemptionEnabled())) {
      return sendError(
        reply,
        410,
        "ETSY_LEGACY_REDEMPTION_DISABLED",
        "Printed redemption codes have been retired.",
      );
    }
    if (!(await withinRedeemLimit(request, reply))) return;

    const userId = await requireUserId(request, reply);
    if (!userId) return;

    try {
      const result = await etsyRedemptionService.redeem({
        code: request.body?.code,
        userId,
      });
      reply.header("Cache-Control", "no-store");
      return reply.send({
        redeemed: result.redeemed,
        idempotent: result.idempotent,
        balance_after: result.balance_after,
      });
    } catch (error) {
      const status = ERROR_STATUS[error?.code];
      if (status) {
        return sendError(reply, status, error.code, error.message);
      }
      request.log.error({ err: error }, "Etsy code redemption failed");
      return sendError(
        reply,
        500,
        "ETSY_REDEEM_FAILED",
        "We couldn't redeem that code. Please try again.",
      );
    }
  });

  // Legacy compatibility uses a body so the bearer code never enters request
  // paths, browser history, referrers, or routine URL logs. This route is dark
  // by default and must be removed after migration inventory is reconciled.
  app.post("/web/etsy/code/check", async (request, reply) => {
    if (!(await funnelEnabled(request, reply))) return;
    if (!(await legacyRedemptionEnabled())) {
      return sendError(
        reply,
        410,
        "ETSY_LEGACY_REDEMPTION_DISABLED",
        "Printed redemption codes have been retired.",
      );
    }

    let result;
    try {
      result = await etsyRedemptionService.validate(request.body?.code);
    } catch (error) {
      request.log.error({ err: error }, "Etsy code validation failed");
      return sendError(
        reply,
        503,
        "FUNNEL_GUARD_UNAVAILABLE",
        "We couldn't check that code. Please try again.",
      );
    }
    reply.header("Cache-Control", "no-store");
    return reply.send(result);
  });

  // Constant-shape receipt initiation. It intentionally does not disclose
  // whether a guessed receipt exists; identity proof happens through the
  // normal verified-email session before claim.
  app.post("/web/etsy/order/check", async (request, reply) => {
    if (!(await funnelEnabled(request, reply))) return;
    if (!(await etsyEntryEnabled(request, reply))) return;
    const clientIp = getGuardClientIp(request);
    let verification;
    try {
      verification = await turnstileVerifier.verify({
        token: request.body?.turnstile_token,
        remoteIp: clientIp,
      });
    } catch (error) {
      if (!(error instanceof TurnstileUnavailableError)) {
        request.log.error({ err: error }, "Unexpected Etsy Turnstile failure");
      }
      return sendError(
        reply,
        503,
        "TURNSTILE_UNAVAILABLE",
        "We couldn't verify this request. Please try again.",
      );
    }
    if (!verification.success) {
      return sendError(
        reply,
        400,
        "TURNSTILE_INVALID",
        "We couldn't verify this request. Please try again.",
      );
    }
    try {
      normalizeReceiptId(request.body?.receipt_id);
    } catch {
      // Keep the same response shape and status as a valid-looking reference.
    }
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
    return reply.send({
      accepted: true,
      claim_proof: mintClaimProof(request.body?.receipt_id, clientIp),
    });
  });

  app.post("/web/etsy/order/claim", async (request, reply) => {
    if (!(await funnelEnabled(request, reply))) return;
    if (!(await etsyEntryEnabled(request, reply))) return;
    const clientIp = getGuardClientIp(request);
    if (
      !verifyClaimProof(
        request.body?.claim_proof,
        request.body?.receipt_id,
        clientIp,
      )
    ) {
      return sendError(
        reply,
        400,
        "ETSY_CLAIM_PROOF_REQUIRED",
        "Please verify this Etsy receipt again.",
      );
    }
    if (!(await withinRedeemLimit(request, reply))) return;
    if (!etsyOrderService) {
      return sendError(
        reply,
        503,
        "ETSY_CONFIG_UNAVAILABLE",
        "Etsy fulfilment is temporarily unavailable.",
      );
    }
    const userId = await requireUserId(request, reply);
    if (!userId) return;
    const verifiedEmails = await db
      .prepare(
        `SELECT provider_user_id AS email
           FROM user_auth_providers
          WHERE user_id = ? AND provider = 'email' AND status = 'active'
            AND verified_at IS NOT NULL
         UNION
         SELECT value_normalized AS email
           FROM user_contacts
          WHERE user_id = ? AND type = 'email' AND verified_at IS NOT NULL`,
      )
      .all(userId, userId);
    if (verifiedEmails.length === 0) {
      return sendError(
        reply,
        401,
        "ETSY_VERIFIED_EMAIL_REQUIRED",
        "Sign in with the email on your Etsy receipt.",
      );
    }
    try {
      const result = await etsyOrderService.claimByVerifiedEmail({
        receiptId: request.body?.receipt_id,
        emails: verifiedEmails.map((row) => row.email),
        userId,
      });
      reply.header("Cache-Control", "no-store");
      reply.header("Referrer-Policy", "no-referrer");
      return reply.send({
        claimed: true,
        order_reference: result.orderId,
        unit_ids: result.unitIds,
        wallet_balance: result.balance,
        commerce_free: true,
      });
    } catch (error) {
      if (
        error?.code === "ETSY_ORDER_NOT_FOUND" ||
        error?.code === "INVALID_ETSY_RECEIPT"
      ) {
        return sendError(
          reply,
          404,
          "ETSY_ORDER_NOT_FOUND",
          "We couldn't match that receipt to this email.",
        );
      }
      if (error?.code === "ETSY_ORDER_ALREADY_CLAIMED") {
        return sendError(
          reply,
          409,
          error.code,
          "This order belongs to another account.",
        );
      }
      request.log.error({ err: error }, "Etsy order claim failed");
      return sendError(
        reply,
        503,
        "ETSY_CLAIM_UNAVAILABLE",
        "We couldn't claim that order just now.",
      );
    }
  });

  app.get("/web/etsy/order/context", async (request, reply) => {
    if (!(await funnelEnabled(request, reply))) return;
    if (!etsyOrderService) return reply.send({ commerce_free: false });
    const userId = await requireUserId(request, reply);
    if (!userId) return;
    const order = await etsyOrderService.findActiveForOwner(userId);
    reply.header("Cache-Control", "no-store");
    return reply.send({
      commerce_free: Boolean(order),
      order_reference: order?.order_id,
      unit_count: order ? Number(order.unit_count) : 0,
      journey_id: order?.journey_id || undefined,
    });
  });

  app.get("/web/etsy/order/unit/:unitId", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;
    const status = await etsyOrderService?.describeUnitForOwner(
      request.params.unitId,
      userId,
    );
    if (!status) {
      return sendError(reply, 404, "ORDER_NOT_FOUND", "Order not found.");
    }
    reply.header("Cache-Control", "no-store");
    return reply.send(status);
  });
}

module.exports = {
  registerWebEtsyRoutes,
  mintClaimProof,
  verifyClaimProof,
};
