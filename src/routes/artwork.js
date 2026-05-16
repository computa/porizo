const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { trackArtworkKey } = require("../storage");

const TRACK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function resolveHmacSecret() {
  const explicit =
    process.env.ARTWORK_HMAC_SECRET ||
    process.env.SHARE_HMAC_SECRET ||
    process.env.SHARE_TOKEN_SECRET;
  if (explicit) return explicit;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ARTWORK_HMAC_SECRET (or SHARE_HMAC_SECRET / SHARE_TOKEN_SECRET) must be set in production. " +
        "Refusing to boot with the dev fallback — artwork signature forgery would be trivial.",
    );
  }
  // Local dev only — deterministic so tests are reproducible.
  return ["dev", "artwork", "hmac", "local-only"].join("-");
}

const ARTWORK_HMAC_SECRET = resolveHmacSecret();
const STORAGE_ROOT =
  process.env.STORAGE_ROOT || path.resolve(process.cwd(), "storage");

function signArtworkUrl({ trackId, expiryUnix }) {
  return crypto
    .createHmac("sha256", ARTWORK_HMAC_SECRET)
    .update(`${trackId}:${expiryUnix}`)
    .digest("base64url");
}

function verifyArtworkSignature({ trackId, expiryUnix, sig }) {
  if (!sig || !expiryUnix) return false;
  const now = Math.floor(Date.now() / 1000);
  if (expiryUnix < now) return false;
  const expected = signArtworkUrl({ trackId, expiryUnix });
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/**
 * Register the artwork serving route on a Fastify-ish app.
 *
 * @param {Object} app    Fastify app
 * @param {Object} deps
 * @param {Object} deps.db                Database wrapper
 * @param {Function} [deps.requireUserId] Resolves a userId or sends a 401 itself
 * @param {Function} [deps.sendError]     Project-standard error response helper
 * @param {Object} [deps.storageProvider] Storage provider for S3 hydration
 * @param {Function} [deps.ensureLocalFileFromStorage] Hydrates remote storage objects locally
 */
function registerArtworkRoutes(
  app,
  {
    db,
    requireUserId,
    sendError,
    storageProvider,
    ensureLocalFileFromStorage,
  } = {},
) {
  const respondError = sendError || defaultSendError;

  app.get("/tracks/:trackId/artwork.jpg", async (request, reply) => {
    const { trackId } = request.params;
    if (!TRACK_ID_RE.test(trackId)) {
      return respondError(
        reply,
        400,
        "INVALID_TRACK_ID",
        "Invalid track identifier.",
      );
    }
    const { share_token: shareToken, sig, exp, v } = request.query || {};

    // Auth path 1: signed anonymous unfurl (capability URL).
    let authorized = false;
    if (sig && exp) {
      const expiryUnix = parseInt(exp, 10);
      if (
        Number.isFinite(expiryUnix) &&
        verifyArtworkSignature({ trackId, expiryUnix, sig })
      ) {
        authorized = true;
      }
    }

    // Auth path 2: share_token still active. Match on `id` only (not stream_key)
    // so artwork-serving and audio-streaming capabilities stay decoupled.
    if (!authorized && shareToken) {
      try {
        const share = await db
          .prepare(
            "SELECT track_id, status, expires_at FROM share_tokens WHERE id = ?",
          )
          .get(shareToken);
        if (
          share &&
          share.track_id === trackId &&
          share.status !== "revoked" &&
          (!share.expires_at || new Date(share.expires_at) > new Date())
        ) {
          authorized = true;
        }
      } catch (err) {
        request.log &&
          request.log.warn({ err }, "[Artwork] share_token lookup failed");
      }
    }

    // Auth path 3: owner bearer JWT — only attempt when an Authorization header
    // is actually present. requireUserId writes its own 401 and returns null,
    // so calling it on anonymous requests caused a double-send → 500 on
    // iMessage/WhatsApp unfurls.
    if (
      !authorized &&
      requireUserId &&
      request.headers &&
      request.headers.authorization
    ) {
      try {
        const userId = await requireUserId(request, reply);
        if (reply.sent) return;
        if (userId) {
          const owner = await db
            .prepare("SELECT user_id FROM tracks WHERE id = ?")
            .get(trackId);
          if (owner && owner.user_id === userId) {
            authorized = true;
          }
        }
      } catch (err) {
        if (reply.sent) return;
        request.log && request.log.warn({ err }, "[Artwork] owner auth failed");
      }
    }

    if (!authorized) {
      return respondError(
        reply,
        401,
        "UNAUTHORIZED",
        "Authentication required for this artwork.",
      );
    }

    // Resolve owner for the storage key — after auth so we don't leak user_ids
    // via cross-track enumeration attempts.
    let userId;
    try {
      const owner = await db
        .prepare("SELECT user_id FROM tracks WHERE id = ?")
        .get(trackId);
      if (!owner) {
        return respondError(
          reply,
          404,
          "TRACK_NOT_FOUND",
          "Track no longer exists.",
        );
      }
      userId = owner.user_id;
    } catch (err) {
      request.log && request.log.warn({ err }, "[Artwork] track lookup failed");
      return respondError(
        reply,
        500,
        "INTERNAL_ERROR",
        "Failed to load track.",
      );
    }

    const objectKey = trackArtworkKey({ userId, trackId });
    const localFilePath = path.join(STORAGE_ROOT, objectKey);

    // Defense-in-depth: ensure the joined path stays under STORAGE_ROOT.
    if (!localFilePath.startsWith(path.resolve(STORAGE_ROOT) + path.sep)) {
      request.log &&
        request.log.error(
          { trackId, localFilePath },
          "[Artwork] path traversal blocked",
        );
      return respondError(
        reply,
        400,
        "INVALID_TRACK_ID",
        "Invalid track identifier.",
      );
    }

    let exists = await fileExists(localFilePath);
    if (
      !exists &&
      ensureLocalFileFromStorage &&
      storageProvider &&
      storageProvider.type !== "local"
    ) {
      try {
        await ensureLocalFileFromStorage({
          key: objectKey,
          localPath: localFilePath,
        });
        exists = await fileExists(localFilePath);
      } catch (err) {
        request.log &&
          request.log.warn({ err, objectKey }, "[Artwork] S3 hydration failed");
      }
    }

    if (!exists) {
      return respondError(
        reply,
        404,
        "ARTWORK_NOT_READY",
        "Artwork not yet generated for this track.",
      );
    }

    if (v) {
      reply.header("Cache-Control", "public, max-age=86400, immutable");
    } else {
      reply.header("Cache-Control", "public, max-age=300");
    }
    reply.header("Content-Type", "image/jpeg");
    return reply.send(fs.createReadStream(localFilePath));
  });
}

async function fileExists(p) {
  try {
    await fs.promises.stat(p);
    return true;
  } catch {
    return false;
  }
}

// Minimal sendError fallback. Project standard is `{error: UPPER_SNAKE, message}`.
function defaultSendError(reply, status, code, message) {
  return reply.code(status).send({ error: code, message });
}

module.exports = {
  registerArtworkRoutes,
  signArtworkUrl,
  verifyArtworkSignature,
  resolveHmacSecret,
};
