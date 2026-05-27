/**
 * Stateless one-click unsubscribe tokens.
 *
 * The token is an HMAC-SHA256 of the user id under a purpose-prefixed message,
 * so it cannot be cross-used with other signing (auth) even though it may share
 * the same underlying secret. No token table needed — verification is recomputed.
 *
 * Secret precedence: UNSUBSCRIBE_SECRET, falling back to JWT_SECRET (always set
 * in production because auth depends on it). The purpose prefix provides domain
 * separation when the JWT secret is reused.
 */

const crypto = require("crypto");

const PURPOSE = "unsubscribe:v1:";

function getSecret() {
  const secret = process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "unsubscribe-token: neither UNSUBSCRIBE_SECRET nor JWT_SECRET is set",
    );
  }
  return secret;
}

function signUnsubscribeToken(userId) {
  return crypto
    .createHmac("sha256", getSecret())
    .update(PURPOSE + String(userId))
    .digest("base64url");
}

function verifyUnsubscribeToken(userId, token) {
  if (!userId || !token) return false;
  const expected = signUnsubscribeToken(userId);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function buildUnsubscribeUrl(baseUrl, userId) {
  const u = encodeURIComponent(String(userId));
  const t = signUnsubscribeToken(userId);
  return `${baseUrl}/unsubscribe?u=${u}&t=${t}`;
}

module.exports = {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
};
