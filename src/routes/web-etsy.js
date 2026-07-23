"use strict";

const { getGuardClientIp } = require("../utils/client-ip");
const { getFeatureFlag } = require("../services/feature-flags");
const {
  createEtsyRedemptionService,
} = require("../services/etsy-redemption-service");

const HOUR_MS = 60 * 60 * 1000;
// Brute-force guard: a buyer types one code from a printed insert. Ten attempts
// per IP per hour absorbs typos without letting anyone enumerate the space.
const REDEEM_ATTEMPTS_MAX = 10;

// Service error code -> public HTTP status. Anything unmapped is a 500.
const ERROR_STATUS = {
  CODE_NOT_FOUND: 404,
  CODE_ALREADY_REDEEMED: 409,
  CODE_VOID: 410,
  USER_REQUIRED: 401,
};

function registerWebEtsyRoutes(
  app,
  {
    db,
    rateLimitRepository,
    sendError,
    requireUserId,
    giftWalletRepository,
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

  app.get("/web/etsy/code/:code", async (request, reply) => {
    if (!(await funnelEnabled(request, reply))) return;
    if (!(await withinRedeemLimit(request, reply))) return;

    let result;
    try {
      result = await etsyRedemptionService.validate(request.params.code);
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
}

module.exports = { registerWebEtsyRoutes };
