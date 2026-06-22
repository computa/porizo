/**
 * Social Auth Token Verifier
 *
 * Cryptographically verifies Apple and Google Sign-In JWT tokens
 * using JWKS (JSON Web Key Sets) from each provider.
 *
 * Security: This module prevents authentication bypass attacks by verifying
 * that tokens are genuinely signed by Apple/Google, not forged.
 */

const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");
const crypto = require("crypto");

async function fetchJson(url, options = {}) {
  // Bound the upstream call: a slow/hung provider API (Facebook/Google token
  // exchange + profile lookups) must not hang the login request indefinitely.
  // Fail fast (AbortError) instead — the caller surfaces a clean auth error.
  const { timeoutMs = 8000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, { ...fetchOptions, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.error || response.statusText;
    const error = new Error(message || "REQUEST_FAILED");
    error.statusCode = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

// Apple JWKS client - caches keys for performance
const appleJwksClient = jwksClient({
  jwksUri: "https://appleid.apple.com/auth/keys",
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 86400000, // 24 hours
});

// Google JWKS client
const googleJwksClient = jwksClient({
  jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 86400000, // 24 hours
});

/**
 * Get signing key from Apple's JWKS
 * @param {object} header - JWT header containing kid
 * @returns {Promise<string>} Public key for verification
 */
async function getAppleSigningKey(header) {
  const key = await appleJwksClient.getSigningKey(header.kid);
  return key.getPublicKey();
}

/**
 * Get signing key from Google's JWKS
 * @param {object} header - JWT header containing kid
 * @returns {Promise<string>} Public key for verification
 */
async function getGoogleSigningKey(header) {
  const key = await googleJwksClient.getSigningKey(header.kid);
  return key.getPublicKey();
}

/**
 * Parse Apple client IDs from environment.
 * Supports a comma-separated APPLE_CLIENT_IDS or a single APPLE_CLIENT_ID.
 * @returns {string[]} Non-empty client IDs
 */
function getAppleClientIdsFromEnv() {
  const multi = process.env.APPLE_CLIENT_IDS;
  const single = process.env.APPLE_CLIENT_ID;

  const parsed = (multi || single || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return parsed;
}

/**
 * SHA-256 hash helper (hex).
 */
function sha256Hex(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Check if an audience claim matches any allowed client IDs.
 * Supports string or array audience values.
 */
function audienceMatches(aud, allowedClientIds) {
  if (!aud) return false;
  if (Array.isArray(aud)) {
    return aud.some((value) => allowedClientIds.includes(String(value)));
  }
  return allowedClientIds.includes(String(aud));
}

/**
 * Verify Apple Sign-In ID token
 *
 * @param {string} idToken - The JWT from Apple Sign-In
 * @param {object} options - Verification options
 * @param {string} options.clientId - Your Apple App ID (e.g., "com.porizo.app")
 * @returns {Promise<object>} Decoded and verified token payload
 * @throws {Error} If token is invalid, expired, or forged
 */
async function verifyAppleToken(idToken, options = {}) {
  const clientIds = (() => {
    if (Array.isArray(options.clientIds)) {
      return options.clientIds.filter(Boolean);
    }
    if (typeof options.clientId === "string" && options.clientId.trim()) {
      return [options.clientId.trim()];
    }
    return getAppleClientIdsFromEnv();
  })();

  if (clientIds.length === 0) {
    throw new Error("APPLE_CLIENT_ID_NOT_CONFIGURED");
  }

  const rawNonce = options.rawNonce;
  if (!rawNonce || !String(rawNonce).trim()) {
    throw new Error("NONCE_REQUIRED");
  }

  // Test-mode bypass: allow mocked tokens without JWKS verification.
  // SECURITY: intentionally skips issuer signature check (JWKS) so unit tests can run without
  // network access. Two explicit guards prevent this from activating in production:
  //   1. NODE_ENV must equal "test" (never set in Railway/production deployments)
  //   2. ALLOW_MOCK_SOCIAL_AUTH must be "true" (never set outside test env)
  // The issuer *value* is still validated below (payload.iss check) — only the cryptographic
  // signature verification is bypassed.
  if (
    process.env.NODE_ENV === "test" &&
    process.env.ALLOW_MOCK_SOCIAL_AUTH === "true"
  ) {
    const payload = jwt.decode(idToken);
    if (!payload) {
      throw new Error("INVALID_TOKEN_FORMAT: Could not decode token");
    }

    // Minimal claim validation even in test mode
    if (payload.iss && payload.iss !== "https://appleid.apple.com") {
      throw new Error("INVALID_TOKEN: Invalid issuer");
    }
    if (!audienceMatches(payload.aud, clientIds)) {
      throw new Error("INVALID_TOKEN: Invalid audience");
    }
    if (!payload.sub) {
      throw new Error("INVALID_TOKEN: Missing subject claim");
    }

    const expectedNonce = sha256Hex(String(rawNonce));
    const tokenNonce = payload.nonce ? String(payload.nonce).toLowerCase() : "";
    if (!tokenNonce || tokenNonce !== expectedNonce) {
      throw new Error("INVALID_NONCE");
    }

    return {
      sub: payload.sub,
      email: payload.email_verified ? payload.email : null,
      emailVerified: !!payload.email_verified,
      isPrivateEmail:
        payload.is_private_email === "true" ||
        payload.is_private_email === true,
      authTime: payload.auth_time,
      iat: payload.iat,
      exp: payload.exp,
      nonceVerified: true,
    };
  }

  // Decode header to get key ID (kid)
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || !decoded.header || !decoded.header.kid) {
    throw new Error("INVALID_TOKEN_FORMAT: Missing header or kid");
  }

  // Get the public key from Apple's JWKS
  const publicKey = await getAppleSigningKey(decoded.header);

  // Verify the token
  const payload = jwt.verify(idToken, publicKey, {
    algorithms: ["RS256"],
    issuer: "https://appleid.apple.com",
    audience: clientIds.length === 1 ? clientIds[0] : clientIds,
  });

  // Additional security checks
  if (!payload.sub) {
    throw new Error("INVALID_TOKEN: Missing subject claim");
  }

  // Nonce verification (prevents replay attacks)
  // Apple returns the SHA-256 hash of the raw nonce provided in the request.
  const expectedNonce = sha256Hex(String(rawNonce));
  const tokenNonce = payload.nonce ? String(payload.nonce).toLowerCase() : "";
  if (!tokenNonce || tokenNonce !== expectedNonce) {
    throw new Error("INVALID_NONCE");
  }

  // Apple tokens must have email_verified for email claim to be trusted
  if (payload.email && !payload.email_verified) {
    console.warn("[AppleAuth] Email not verified by Apple:", payload.email);
    // Still allow auth, but log warning - email shouldn't be trusted
  }

  return {
    sub: payload.sub,
    email: payload.email_verified ? payload.email : null, // Only trust verified emails
    emailVerified: !!payload.email_verified,
    isPrivateEmail:
      payload.is_private_email === "true" || payload.is_private_email === true,
    authTime: payload.auth_time,
    iat: payload.iat,
    exp: payload.exp,
    nonceVerified: true,
  };
}

/**
 * Verify Google Sign-In ID token
 *
 * @param {string} idToken - The JWT from Google Sign-In
 * @param {object} options - Verification options
 * @param {string} options.clientId - Your Google OAuth Client ID
 * @returns {Promise<object>} Decoded and verified token payload
 * @throws {Error} If token is invalid, expired, or forged
 */
async function verifyGoogleToken(idToken, options = {}) {
  const clientId = options.clientId || process.env.GOOGLE_CLIENT_ID;

  if (!clientId) {
    throw new Error("GOOGLE_CLIENT_ID not configured");
  }

  // Test-mode bypass: allow mocked tokens without JWKS verification.
  if (
    process.env.NODE_ENV === "test" &&
    process.env.ALLOW_MOCK_SOCIAL_AUTH === "true"
  ) {
    const payload = jwt.decode(idToken);
    if (!payload) {
      throw new Error("INVALID_TOKEN_FORMAT: Could not decode token");
    }
    if (
      payload.iss &&
      !["accounts.google.com", "https://accounts.google.com"].includes(
        payload.iss,
      )
    ) {
      throw new Error("INVALID_TOKEN: Invalid issuer");
    }
    if (!audienceMatches(payload.aud, [clientId])) {
      throw new Error("INVALID_TOKEN: Invalid audience");
    }
    if (!payload.sub) {
      throw new Error("INVALID_TOKEN: Missing subject claim");
    }

    return {
      sub: payload.sub,
      email: payload.email_verified ? payload.email : null,
      emailVerified: !!payload.email_verified,
      name: payload.name,
      picture: payload.picture,
      iat: payload.iat,
      exp: payload.exp,
    };
  }

  // Decode header to get key ID
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || !decoded.header || !decoded.header.kid) {
    throw new Error("INVALID_TOKEN_FORMAT: Missing header or kid");
  }

  // Get the public key from Google's JWKS
  const publicKey = await getGoogleSigningKey(decoded.header);

  // Verify the token
  const payload = jwt.verify(idToken, publicKey, {
    algorithms: ["RS256"],
    issuer: ["accounts.google.com", "https://accounts.google.com"],
    audience: clientId,
  });

  if (!payload.sub) {
    throw new Error("INVALID_TOKEN: Missing subject claim");
  }

  return {
    sub: payload.sub,
    email: payload.email_verified ? payload.email : null,
    emailVerified: !!payload.email_verified,
    name: payload.name,
    picture: payload.picture,
    iat: payload.iat,
    exp: payload.exp,
  };
}

async function exchangeGoogleAuthorizationCode(code, options = {}) {
  const clientId = options.clientId || process.env.GOOGLE_CLIENT_ID;
  const redirectUri = options.redirectUri || process.env.GOOGLE_REDIRECT_URI;
  const clientSecret = options.clientSecret || process.env.GOOGLE_CLIENT_SECRET;
  const codeVerifier = options.codeVerifier;

  if (!clientId || !redirectUri) {
    throw new Error("GOOGLE_OAUTH_NOT_CONFIGURED");
  }

  const params = new URLSearchParams({
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  if (clientSecret) {
    params.set("client_secret", clientSecret);
  }

  if (codeVerifier) {
    params.set("code_verifier", codeVerifier);
  }

  return fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
}

async function exchangeFacebookAuthorizationCode(code, options = {}) {
  const appId = options.appId || process.env.FACEBOOK_APP_ID;
  const appSecret = options.appSecret || process.env.FACEBOOK_APP_SECRET;
  const redirectUri = options.redirectUri || process.env.FACEBOOK_REDIRECT_URI;

  if (!appId || !appSecret || !redirectUri) {
    throw new Error("FACEBOOK_OAUTH_NOT_CONFIGURED");
  }

  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  });

  const url = `https://graph.facebook.com/v19.0/oauth/access_token?${params.toString()}`;
  return fetchJson(url);
}

async function verifyFacebookToken(accessToken, options = {}) {
  const appId = options.appId || process.env.FACEBOOK_APP_ID;
  const appSecret = options.appSecret || process.env.FACEBOOK_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error("FACEBOOK_APP_NOT_CONFIGURED");
  }

  const appToken = `${appId}|${appSecret}`;
  const debugUrl = `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(
    accessToken,
  )}&access_token=${encodeURIComponent(appToken)}`;
  const debug = await fetchJson(debugUrl);

  if (!debug?.data?.is_valid) {
    throw new Error("INVALID_FACEBOOK_TOKEN");
  }

  if (debug.data.app_id && debug.data.app_id !== appId) {
    throw new Error("FACEBOOK_APP_MISMATCH");
  }

  const meUrl = `https://graph.facebook.com/${debug.data.user_id}?fields=id,name,email&access_token=${encodeURIComponent(
    accessToken,
  )}`;
  const me = await fetchJson(meUrl);

  // Facebook deprecated the `verified` field for most apps (it's no longer returned
  // in the Graph API response for standard permissions). Log a warning if it's
  // explicitly false, but do not block auth — absence of the field is normal.
  if (me.verified === false) {
    console.warn(
      "[FacebookAuth] Profile verified field is explicitly false for user:",
      me.id,
    );
  }

  return {
    sub: me.id || debug.data.user_id,
    email: me.email || null,
    emailVerified: false,
    name: me.name,
    iat: debug.data.issued_at,
    exp: debug.data.expires_at,
  };
}

/**
 * Verify a social auth token from any supported provider
 *
 * @param {string} provider - "apple" or "google"
 * @param {string} idToken - The JWT from the provider
 * @param {object} options - Provider-specific options
 * @returns {Promise<object>} Standardized user info
 * @throws {Error} If token is invalid or provider unsupported
 */
async function verifySocialToken(provider, idToken, options = {}) {
  switch (provider) {
    case "apple":
      return await verifyAppleToken(idToken, options);
    case "google":
      return await verifyGoogleToken(idToken, options);
    case "facebook":
      return await verifyFacebookToken(idToken, options);
    default:
      throw new Error(`UNSUPPORTED_PROVIDER: ${provider}`);
  }
}

/**
 * Check if social auth is properly configured
 * @param {string} provider - "apple" or "google"
 * @returns {boolean} True if provider is configured
 */
function isProviderConfigured(provider) {
  switch (provider) {
    case "apple":
      return getAppleClientIdsFromEnv().length > 0;
    case "google":
      return !!process.env.GOOGLE_CLIENT_ID;
    case "facebook":
      return !!process.env.FACEBOOK_APP_ID && !!process.env.FACEBOOK_APP_SECRET;
    default:
      return false;
  }
}

module.exports = {
  verifyAppleToken,
  verifyGoogleToken,
  verifyFacebookToken,
  exchangeGoogleAuthorizationCode,
  exchangeFacebookAuthorizationCode,
  verifySocialToken,
  isProviderConfigured,
};
