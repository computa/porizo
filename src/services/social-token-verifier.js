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
 * Verify Apple Sign-In ID token
 *
 * @param {string} idToken - The JWT from Apple Sign-In
 * @param {object} options - Verification options
 * @param {string} options.clientId - Your Apple App ID (e.g., "com.porizo.app")
 * @returns {Promise<object>} Decoded and verified token payload
 * @throws {Error} If token is invalid, expired, or forged
 */
async function verifyAppleToken(idToken, options = {}) {
  const clientId = options.clientId || process.env.APPLE_CLIENT_ID || "com.porizo.app";

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
    audience: clientId,
  });

  // Additional security checks
  if (!payload.sub) {
    throw new Error("INVALID_TOKEN: Missing subject claim");
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
    isPrivateEmail: payload.is_private_email === "true" || payload.is_private_email === true,
    authTime: payload.auth_time,
    iat: payload.iat,
    exp: payload.exp,
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
      // Apple doesn't require extra config beyond having the app set up
      return true;
    case "google":
      return !!process.env.GOOGLE_CLIENT_ID;
    default:
      return false;
  }
}

module.exports = {
  verifyAppleToken,
  verifyGoogleToken,
  verifySocialToken,
  isProviderConfigured,
};
