"use strict";

const crypto = require("crypto");

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeBase64UrlJson(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function timingSafeStringEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function resolveNonceSecret(appConfig) {
  return (
    appConfig.PLAY_INTEGRITY_NONCE_SECRET ||
    appConfig.JWT_SECRET ||
    process.env.PLAY_INTEGRITY_NONCE_SECRET ||
    process.env.JWT_SECRET ||
    (process.env.NODE_ENV === "test" ? "test-play-integrity-nonce-secret" : "")
  );
}

function signNonce(payload, secret) {
  const encoded = base64UrlJson(payload);
  const signature = crypto
    .createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function integrityRequestHashForNonce(nonce) {
  return crypto
    .createHash("sha256")
    .update(String(nonce || ""))
    .digest("base64url");
}

function verifyNonce(nonce, secret) {
  const [encoded, signature] = String(nonce || "").split(".");
  if (!encoded || !signature) {
    throw new Error("malformed_nonce");
  }
  const expected = crypto
    .createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  if (!timingSafeStringEqual(signature, expected)) {
    throw new Error("invalid_nonce_signature");
  }
  return decodeBase64UrlJson(encoded);
}

/**
 * In-process single-use guard for integrity nonces. Nonces already carry a jti
 * and an exp, so we record consumed jtis until their exp passes. This makes a
 * verified nonce non-replayable without a persistent store; a durable table is
 * the follow-up if verify needs to survive process restarts / horizontal scale.
 */
function createUsedNonceStore(now) {
  const consumed = new Map(); // jti -> exp (ms)
  function evictExpired() {
    const current = now();
    for (const [jti, exp] of consumed) {
      if (exp <= current) consumed.delete(jti);
    }
  }
  return {
    // Returns true if newly consumed, false if the jti was already consumed.
    consume(jti, exp) {
      evictExpired();
      if (consumed.has(jti)) return false;
      consumed.set(jti, exp);
      return true;
    },
  };
}

function isEnforced(appConfig) {
  return (
    appConfig.PLAY_INTEGRITY_ENFORCE === true ||
    appConfig.PLAY_INTEGRITY_ENFORCE === "true" ||
    process.env.PLAY_INTEGRITY_ENFORCE === "true"
  );
}

function registerDeviceTrustRoutes(
  app,
  {
    appConfig = {},
    requireUserId,
    sendError,
    playIntegrityVerifier = null,
    now = () => Date.now(),
  },
) {
  if (typeof requireUserId !== "function") {
    throw new Error("registerDeviceTrustRoutes requires requireUserId");
  }
  if (typeof sendError !== "function") {
    throw new Error("registerDeviceTrustRoutes requires sendError");
  }
  const secret = resolveNonceSecret(appConfig);
  if (!secret) {
    throw new Error("PLAY_INTEGRITY_NONCE_SECRET or JWT_SECRET is required");
  }
  const ttlMs = Number(appConfig.PLAY_INTEGRITY_NONCE_TTL_MS || 10 * 60 * 1000);
  const usedNonceStore = createUsedNonceStore(now);

  app.post("/device/integrity/nonce", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;
    const body = request.body || {};
    const issuedAt = now();
    const expiresAt = issuedAt + ttlMs;
    const payload = {
      jti: crypto.randomUUID(),
      user_id: userId,
      device_id:
        typeof body.device_id === "string"
          ? body.device_id
          : request.headers["x-device-id"] || null,
      platform:
        typeof body.platform === "string"
          ? body.platform
          : request.headers["x-platform"] || null,
      iat: issuedAt,
      exp: expiresAt,
    };
    const nonce = signNonce(payload, secret);
    reply.send({
      nonce,
      request_hash: integrityRequestHashForNonce(nonce),
      expires_at: new Date(expiresAt).toISOString(),
    });
  });

  app.post("/device/integrity/verify", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;
    const body = request.body || {};
    const nonce = typeof body.nonce === "string" ? body.nonce.trim() : "";
    const integrityToken =
      typeof body.integrity_token === "string"
        ? body.integrity_token.trim()
        : "";
    if (!nonce || !integrityToken) {
      sendError(
        reply,
        400,
        "INVALID_REQUEST",
        "nonce and integrity_token are required.",
      );
      return;
    }

    let noncePayload;
    try {
      noncePayload = verifyNonce(nonce, secret);
    } catch (_err) {
      sendError(
        reply,
        400,
        "INVALID_INTEGRITY_NONCE",
        "Integrity nonce is invalid.",
      );
      return;
    }
    if (noncePayload.exp < now()) {
      sendError(
        reply,
        400,
        "INTEGRITY_NONCE_EXPIRED",
        "Integrity nonce expired.",
      );
      return;
    }
    if (noncePayload.user_id !== userId) {
      sendError(
        reply,
        403,
        "INTEGRITY_NONCE_USER_MISMATCH",
        "Integrity nonce belongs to a different user.",
      );
      return;
    }

    // Single-use: reject a nonce whose jti was already consumed (replay). A store
    // failure is treated conservatively — do not mark the nonce consumed and fail
    // the verify rather than silently allowing a potential replay through.
    try {
      if (!usedNonceStore.consume(noncePayload.jti, noncePayload.exp)) {
        sendError(
          reply,
          409,
          "INTEGRITY_NONCE_REPLAYED",
          "Integrity nonce has already been used.",
        );
        return;
      }
    } catch (err) {
      request.log.warn({ err }, "Integrity nonce replay guard failed");
      sendError(
        reply,
        409,
        "INTEGRITY_NONCE_REPLAYED",
        "Integrity nonce could not be validated for reuse.",
      );
      return;
    }

    const verifierConfigured =
      playIntegrityVerifier &&
      (typeof playIntegrityVerifier.isConfigured !== "function" ||
        playIntegrityVerifier.isConfigured());
    if (!verifierConfigured) {
      if (isEnforced(appConfig)) {
        sendError(
          reply,
          503,
          "PLAY_INTEGRITY_NOT_CONFIGURED",
          "Play Integrity verification is not configured.",
        );
        return;
      }
      reply.send({
        verified: false,
        nonce_valid: true,
        status: "verification_not_configured",
        app_set_id: body.app_set_id || null,
      });
      return;
    }

    let verification;
    try {
      verification = await playIntegrityVerifier.verify({
        integrityToken,
        requestHash: integrityRequestHashForNonce(nonce),
        nonce,
        userId,
        packageName: body.package_name || appConfig.GOOGLE_PLAY_PACKAGE_NAME,
      });
    } catch (err) {
      request.log.warn({ err }, "Play Integrity verification failed");
      sendError(
        reply,
        502,
        "PLAY_INTEGRITY_UPSTREAM_FAILED",
        "Play Integrity verification failed.",
      );
      return;
    }
    if (!verification?.ok) {
      sendError(
        reply,
        403,
        "PLAY_INTEGRITY_FAILED",
        "Play Integrity verdict failed.",
        { reason: verification?.reason || "unknown" },
      );
      return;
    }

    reply.send({
      verified: true,
      nonce_valid: true,
      status: "verified",
      app_set_id: body.app_set_id || null,
      request_details: verification.requestDetails || null,
      app_integrity: verification.appIntegrity || null,
      device_integrity: verification.deviceIntegrity || null,
      account_details: verification.accountDetails || null,
    });
  });
}

module.exports = { registerDeviceTrustRoutes };
