"use strict";

const crypto = require("crypto");
const authService = require("../services/auth-service");
const { generateId } = require("../utils/ids");
const { getGuardClientIp } = require("../utils/client-ip");
const { parseCookieHeader } = require("../utils/http-cookies");
const {
  createAuthSessionRepository,
} = require("../database/auth-session-repository");
const {
  createAuthRefreshTokenRepository,
} = require("../database/auth-refresh-token-repository");
const {
  createWebFunnelRepository,
} = require("../database/web-funnel-repository");
const { getFeatureFlag } = require("../services/feature-flags");
const {
  TurnstileUnavailableError,
  createTurnstileVerifier,
} = require("../services/turnstile");

const DAY_MS = 24 * 60 * 60 * 1000;
const GUEST_TTL_MS = 365 * DAY_MS;

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function registerWebFunnelRoutes(
  app,
  {
    db,
    appConfig = {},
    rateLimitRepository,
    sendError,
    turnstileVerifier = createTurnstileVerifier({
      secretKey: appConfig.TURNSTILE_SECRET_KEY,
      environment: appConfig.NODE_ENV || process.env.NODE_ENV,
    }),
  },
) {
  const repository = createWebFunnelRepository(db);

  app.post("/web/session", async (request, reply) => {
    let funnelEnabled;
    try {
      funnelEnabled = await getFeatureFlag(db, "web_funnel_enabled", {
        throwOnError: true,
      });
    } catch (error) {
      request.log.error({ err: error }, "Web funnel flag lookup failed");
      return sendError(
        reply,
        503,
        "FUNNEL_CONFIG_UNAVAILABLE",
        "Song creation is temporarily unavailable.",
      );
    }
    if (funnelEnabled !== true) {
      return sendError(reply, 404, "NOT_FOUND", "Not found.");
    }

    const clientIp = getGuardClientIp(request);
    let sessionLimit;
    try {
      sessionLimit = await rateLimitRepository.consume({
        key: { subject: "ip", value: `ip:${clientIp}` },
        action: "web_session_daily",
        max: 5,
        windowMs: DAY_MS,
      });
    } catch (error) {
      request.log.error({ err: error }, "Web session rate limit failed");
      return sendError(
        reply,
        503,
        "FUNNEL_GUARD_UNAVAILABLE",
        "We couldn't verify this request. Please try again.",
      );
    }
    if (!sessionLimit.allowed) {
      const retryAfter = Math.max(
        1,
        Math.ceil((Date.parse(sessionLimit.resetAt) - Date.now()) / 1000),
      );
      reply.header("Retry-After", String(retryAfter));
      return sendError(
        reply,
        429,
        "WEB_SESSION_LIMIT_REACHED",
        "Too many song sessions were started from this connection.",
        { retry_at: sessionLimit.resetAt },
      );
    }

    let verification;
    try {
      verification = await turnstileVerifier.verify({
        token: request.body?.turnstile_token,
        remoteIp: clientIp,
      });
    } catch (error) {
      if (!(error instanceof TurnstileUnavailableError)) {
        request.log.error({ err: error }, "Unexpected Turnstile failure");
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

    const cookies = parseCookieHeader(request.headers.cookie);
    let deviceToken = cookies["__Host-porizo_guest"];
    if (!deviceToken) deviceToken = crypto.randomBytes(32).toString("base64url");
    const deviceTokenHash = sha256(deviceToken);
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + GUEST_TTL_MS).toISOString();
    const rawEntryUrl = String(request.body?.entry_url || "");
    const entryUrl = rawEntryUrl.slice(0, 2048) || null;

    let issued;
    try {
      issued = await repository.transaction(async (txRepository, txDb) => {
        const device =
          await txRepository.findGuestDeviceForUpdate(deviceTokenHash);
        let existing = null;
        if (device) {
          const expiresAtMs = Date.parse(device.expires_at || "");
          if (
            device.account_status === "guest" &&
            !device.deleted_at &&
            expiresAtMs > now.getTime()
          ) {
            existing = device;
          }
        }
        const userId = existing?.user_id || generateId("user");
        if (!existing) {
          await txRepository.insertGuestUser({ userId, createdAt: nowIso });
          await txRepository.ensureZeroEntitlements({
            userId,
            resetAt: new Date(now.getTime() + DAY_MS).toISOString(),
            updatedAt: nowIso,
          });
        }

        const sessionTokens =
          await authService.createSessionAndRefreshTokenInTransaction(
            userId,
            {
              platform: "web",
              authMethod: "web_guest",
              deviceName: request.headers["user-agent"],
              userAgent: request.headers["user-agent"],
              ipAddress: clientIp,
            },
            {
              sessionRepository: createAuthSessionRepository(txDb),
              refreshTokenRepository: createAuthRefreshTokenRepository(txDb),
            },
          );
        await txRepository.upsertGuestDevice({
          deviceTokenHash,
          userId,
          sessionId: sessionTokens.sessionId,
          funnelEnabledAtEntry:
            existing?.funnel_enabled_at_entry ?? funnelEnabled,
          entryUrl,
          createdAt: nowIso,
          lastActiveAt: nowIso,
          expiresAt,
        });
        return { userId, ...sessionTokens };
      });
    } catch (error) {
      request.log.error({ err: error }, "Guest session transaction failed");
      return sendError(
        reply,
        503,
        "SESSION_CREATION_FAILED",
        "We couldn't save your place. Please try again.",
      );
    }

    reply.header("Cache-Control", "no-store");
    reply.header(
      "Set-Cookie",
      `__Host-porizo_guest=${encodeURIComponent(deviceToken)}; Max-Age=31536000; Path=/; Secure; HttpOnly; SameSite=Lax`,
    );
    return reply.send({
      user_id: issued.userId,
      access_token: authService.generateAccessToken(issued.userId, {
        sessionId: issued.sessionId,
      }),
      refresh_token: issued.refreshToken,
      expires_in: 900,
      session_expires_at: issued.absoluteExpiresAt,
    });
  });
}

module.exports = { registerWebFunnelRoutes };
