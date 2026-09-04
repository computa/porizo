"use strict";

const crypto = require("crypto");
const fs = require("fs");

const ENDPOINTS = {
  auth: "https://oauth2.googleapis.com/token",
  api: "https://playintegrity.googleapis.com/v1",
};

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function parseCredentials(credentialsSource) {
  if (!credentialsSource) return null;
  if (typeof credentialsSource === "object") return credentialsSource;
  const raw = String(credentialsSource);
  try {
    return JSON.parse(raw);
  } catch (_err) {
    try {
      return JSON.parse(fs.readFileSync(raw, "utf8"));
    } catch (_readErr) {
      return null;
    }
  }
}

function createPlayIntegrityVerifier(options = {}) {
  const config = {
    packageName:
      options.packageName ||
      process.env.GOOGLE_PLAY_PACKAGE_NAME ||
      process.env.ANDROID_PACKAGE_NAME,
    credentials: parseCredentials(
      options.credentials || process.env.GOOGLE_PLAY_CREDENTIALS_JSON,
    ),
    fetchImpl: options.fetchImpl || globalThis.fetch,
  };

  let accessToken = null;
  let tokenExpiry = 0;

  function isConfigured() {
    return Boolean(
      config.packageName &&
        config.credentials?.client_email &&
        config.credentials?.private_key &&
        typeof config.fetchImpl === "function",
    );
  }

  function generateServiceAccountJwt() {
    if (!isConfigured()) {
      throw new Error("Google Play Integrity credentials not configured");
    }
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT" };
    const payload = {
      iss: config.credentials.client_email,
      sub: config.credentials.client_email,
      aud: ENDPOINTS.auth,
      iat: now,
      exp: now + 3600,
      scope: "https://www.googleapis.com/auth/playintegrity",
    };
    const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
      JSON.stringify(payload),
    )}`;
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(unsigned);
    signer.end();
    return `${unsigned}.${base64UrlEncode(signer.sign(config.credentials.private_key))}`;
  }

  async function getAccessToken() {
    if (accessToken && Date.now() < tokenExpiry - 300000) {
      return accessToken;
    }
    const jwt = generateServiceAccountJwt();
    const response = await config.fetchImpl(ENDPOINTS.auth, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });
    if (!response.ok) {
      throw new Error(`Google OAuth token request failed: ${response.status}`);
    }
    const body = await response.json();
    accessToken = body.access_token;
    tokenExpiry = Date.now() + Number(body.expires_in || 3600) * 1000;
    return accessToken;
  }

  async function decodeIntegrityToken(integrityToken) {
    const token = await getAccessToken();
    const packageName = encodeURIComponent(config.packageName);
    const response = await config.fetchImpl(
      `${ENDPOINTS.api}/${packageName}:decodeIntegrityToken`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ integrityToken }),
      },
    );
    if (!response.ok) {
      throw new Error(`Play Integrity decode failed: ${response.status}`);
    }
    return response.json();
  }

  async function verify({ integrityToken, requestHash, packageName }) {
    if (!isConfigured()) {
      return { ok: false, reason: "not_configured" };
    }
    const decoded = await decodeIntegrityToken(integrityToken);
    const payload = decoded.tokenPayloadExternal || decoded;
    const requestDetails = payload.requestDetails || {};
    const appIntegrity = payload.appIntegrity || {};
    const deviceIntegrity = payload.deviceIntegrity || {};
    const expectedPackageName = packageName || config.packageName;
    const payloadRequestHash = requestDetails.requestHash || requestDetails.nonce;

    if (!payloadRequestHash || payloadRequestHash !== requestHash) {
      return {
        ok: false,
        reason: payloadRequestHash ? "request_hash_mismatch" : "request_hash_missing",
        payload,
      };
    }
    if (
      expectedPackageName &&
      requestDetails.requestPackageName &&
      requestDetails.requestPackageName !== expectedPackageName
    ) {
      return {
        ok: false,
        reason: "request_package_mismatch",
        payload,
      };
    }
    if (
      expectedPackageName &&
      appIntegrity.packageName &&
      appIntegrity.packageName !== expectedPackageName
    ) {
      return {
        ok: false,
        reason: "package_mismatch",
        payload,
      };
    }
    if (appIntegrity.appRecognitionVerdict !== "PLAY_RECOGNIZED") {
      return {
        ok: false,
        reason: "app_not_recognized",
        payload,
        appIntegrity,
      };
    }
    const deviceVerdicts = Array.isArray(deviceIntegrity.deviceRecognitionVerdict)
      ? deviceIntegrity.deviceRecognitionVerdict
      : [];
    if (
      !deviceVerdicts.includes("MEETS_DEVICE_INTEGRITY") &&
      !deviceVerdicts.includes("MEETS_STRONG_INTEGRITY")
    ) {
      return {
        ok: false,
        reason: "device_integrity_failed",
        payload,
        appIntegrity,
        deviceIntegrity,
      };
    }

    return {
      ok: true,
      reason: "verified",
      payload,
      requestDetails,
      appIntegrity,
      deviceIntegrity,
      accountDetails: payload.accountDetails || null,
    };
  }

  return {
    isConfigured,
    verify,
  };
}

module.exports = { createPlayIntegrityVerifier };
