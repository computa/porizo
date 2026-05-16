const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { trackArtworkKey } = require("../storage");

const TRACK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Key-versioned HMAC. `kid` identifies which secret produced a signature so we
// can rotate the live key while still accepting in-the-wild signed URLs
// (iMessage / WhatsApp link previews) until they age out.
//
// Production MUST set ARTWORK_HMAC_SECRET as a dedicated key (no fallback to
// share-token secrets — coupling them means rotating share secrets nukes every
// artwork URL embedded in any link preview).
//
// To rotate: set ARTWORK_HMAC_SECRET=<new> and ARTWORK_HMAC_SECRET_PREV=<old>
// for one signed-URL TTL (default 14d). Then remove the PREV.
const DEFAULT_KID = "v1";
const LEGACY_KID = "v0";

function resolveHmacKeys() {
  const current = process.env.ARTWORK_HMAC_SECRET;
  const previous = process.env.ARTWORK_HMAC_SECRET_PREV;
  if (!current) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "ARTWORK_HMAC_SECRET must be set in production (no fallback to share secrets — " +
          "coupling them means rotating share secrets nukes every signed artwork URL). " +
          "Refusing to boot.",
      );
    }
    // Local dev only — deterministic so tests are reproducible.
    return {
      [DEFAULT_KID]: ["dev", "artwork", "hmac", "local-only"].join("-"),
    };
  }
  const keys = { [DEFAULT_KID]: current };
  if (previous) keys[LEGACY_KID] = previous;
  return keys;
}

const HMAC_KEYS = resolveHmacKeys();
const STORAGE_ROOT =
  process.env.STORAGE_ROOT || path.resolve(process.cwd(), "storage");

function signArtworkUrl({ trackId, expiryUnix, kid = DEFAULT_KID } = {}) {
  const secret = HMAC_KEYS[kid];
  if (!secret) {
    throw new Error(`Unknown HMAC kid: ${kid}`);
  }
  return crypto
    .createHmac("sha256", secret)
    .update(`${kid}:${trackId}:${expiryUnix}`)
    .digest("base64url");
}

function verifyArtworkSignature({ trackId, expiryUnix, sig, kid } = {}) {
  if (!sig || !expiryUnix) return false;
  const now = Math.floor(Date.now() / 1000);
  if (expiryUnix < now) return false;
  // Default kid keeps old (pre-rotation) signed URLs validating during the
  // migration window — those were issued without a kid param so they map to v1.
  const tryKid = kid || DEFAULT_KID;
  if (!HMAC_KEYS[tryKid]) return false;
  let expected;
  try {
    expected = signArtworkUrl({ trackId, expiryUnix, kid: tryKid });
  } catch {
    return false;
  }
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
    const { share_token: shareToken, sig, exp, kid, v } = request.query || {};

    // Auth path 1: signed anonymous unfurl (capability URL). When a
    // share_token is also present, require it to be non-revoked — otherwise
    // revoking a share would not invalidate already-issued HMAC URLs.
    let authorized = false;
    if (sig && exp) {
      const expiryUnix = parseInt(exp, 10);
      if (
        Number.isFinite(expiryUnix) &&
        verifyArtworkSignature({ trackId, expiryUnix, sig, kid })
      ) {
        if (shareToken) {
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
              request.log.warn(
                { err },
                "[Artwork] share_token coupling check failed",
              );
          }
        } else {
          // Bare HMAC capability — accepted for back-compat with already-
          // distributed unfurl URLs that pre-date share-token coupling. Issuers
          // SHOULD include share_token going forward (see buildSignedArtworkUrl).
          authorized = true;
        }
      }
    }

    // Auth path 2: share_token alone (no HMAC). Mirrors the legacy path used
    // by share-landing-page clients. Decoupled from HLS stream_key so artwork
    // and audio capabilities can be revoked separately.
    if (!authorized && shareToken && !sig) {
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
};
