const jwt = require("jsonwebtoken");

const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";

function normalizePrivateKey(rawKey) {
  if (!rawKey) return null;
  // Support \n in env vars
  return rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;
}

function getAppleSignInConfig() {
  const clientId = process.env.APPLE_CLIENT_ID;
  const teamId = process.env.APPLE_SIGNIN_TEAM_ID;
  const keyId = process.env.APPLE_SIGNIN_KEY_ID;
  const privateKey = normalizePrivateKey(process.env.APPLE_SIGNIN_PRIVATE_KEY);

  return { clientId, teamId, keyId, privateKey };
}

function ensureAppleSignInConfigured() {
  const { clientId, teamId, keyId, privateKey } = getAppleSignInConfig();
  if (!clientId || !teamId || !keyId || !privateKey) {
    const missing = [];
    if (!clientId) missing.push("APPLE_CLIENT_ID");
    if (!teamId) missing.push("APPLE_SIGNIN_TEAM_ID");
    if (!keyId) missing.push("APPLE_SIGNIN_KEY_ID");
    if (!privateKey) missing.push("APPLE_SIGNIN_PRIVATE_KEY");
    const error = new Error(`APPLE_SIGNIN_NOT_CONFIGURED: missing ${missing.join(", ")}`);
    error.code = "APPLE_SIGNIN_NOT_CONFIGURED";
    throw error;
  }
  return { clientId, teamId, keyId, privateKey };
}

function buildClientSecret() {
  const { clientId, teamId, keyId, privateKey } = ensureAppleSignInConfigured();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: teamId,
    iat: now,
    exp: now + 60 * 5, // 5 minutes
    aud: "https://appleid.apple.com",
    sub: clientId,
  };

  return jwt.sign(payload, privateKey, {
    algorithm: "ES256",
    keyid: keyId,
  });
}

async function exchangeAppleAuthorizationCode(code) {
  if (!code) {
    const error = new Error("APPLE_AUTH_CODE_REQUIRED");
    error.code = "APPLE_AUTH_CODE_REQUIRED";
    throw error;
  }

  const { clientId } = ensureAppleSignInConfigured();
  const clientSecret = buildClientSecret();

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(APPLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const message = payload.error_description || payload.error || "Apple token exchange failed";
    const error = new Error(message);
    error.code = payload.error || "APPLE_TOKEN_EXCHANGE_FAILED";
    throw error;
  }

  return payload;
}

async function refreshAppleToken(refreshToken) {
  if (!refreshToken) {
    const error = new Error("APPLE_REFRESH_TOKEN_REQUIRED");
    error.code = "APPLE_REFRESH_TOKEN_REQUIRED";
    throw error;
  }

  const { clientId } = ensureAppleSignInConfigured();
  const clientSecret = buildClientSecret();

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(APPLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const message = payload.error_description || payload.error || "Apple refresh token validation failed";
    const error = new Error(message);
    error.code = payload.error || "APPLE_REFRESH_TOKEN_FAILED";
    throw error;
  }

  return payload;
}

module.exports = {
  exchangeAppleAuthorizationCode,
  refreshAppleToken,
  getAppleSignInConfig,
};
