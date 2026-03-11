"use strict";

const crypto = require("crypto");

const APP_STORE_CONNECT_BASE_URL = "https://api.appstoreconnect.apple.com/v1";
// App Store Connect UI says "Ready for Distribution", but the public API
// still expects the legacy enum value READY_FOR_SALE for released versions.
const READY_FOR_DISTRIBUTION = "READY_FOR_SALE";

function normalizePrivateKey(privateKey) {
  if (!privateKey) return "";
  if (privateKey.includes("-----BEGIN")) {
    return privateKey;
  }
  return `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function compareVersionStrings(a, b) {
  const left = String(a || "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = String(b || "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (left[index] || 0) - (right[index] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function createAppStoreConnectService(options = {}) {
  const config = {
    keyId: options.keyId || process.env.APPLE_APP_STORE_KEY_ID || "",
    issuerId: options.issuerId || process.env.APPLE_APP_STORE_ISSUER_ID || "",
    privateKey: normalizePrivateKey(options.privateKey || process.env.APPLE_APP_STORE_PRIVATE_KEY || ""),
    bundleId: options.bundleId || process.env.APPLE_BUNDLE_ID || "",
    fetchImpl: options.fetchImpl || global.fetch,
    cacheTtlMs: options.cacheTtlMs ?? 15 * 60 * 1000,
    now: options.now || (() => Date.now()),
  };

  let cache = {
    version: null,
    expiresAt: 0,
  };
  let inflight = null;

  function isConfigured() {
    return Boolean(
      config.keyId &&
        config.issuerId &&
        config.privateKey &&
        config.bundleId &&
        typeof config.fetchImpl === "function"
    );
  }

  function generateJWT() {
    if (!isConfigured()) {
      throw new Error("App Store Connect credentials are not configured");
    }

    const now = Math.floor(config.now() / 1000);
    const header = {
      alg: "ES256",
      kid: config.keyId,
      typ: "JWT",
    };
    const payload = {
      iss: config.issuerId,
      iat: now,
      exp: now + (60 * 20),
      aud: "appstoreconnect-v1",
    };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    const sign = crypto.createSign("SHA256");
    sign.update(signatureInput);
    sign.end();

    const signature = sign.sign({
      key: config.privateKey,
      dsaEncoding: "ieee-p1363",
    });

    return `${signatureInput}.${base64UrlEncode(signature)}`;
  }

  async function apiRequest(pathname) {
    const response = await config.fetchImpl(`${APP_STORE_CONNECT_BASE_URL}${pathname}`, {
      headers: {
        Authorization: `Bearer ${generateJWT()}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const error = new Error(`App Store Connect API error: ${response.status}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }

    return response.json();
  }

  async function fetchAppId() {
    const payload = await apiRequest(`/apps?filter[bundleId]=${encodeURIComponent(config.bundleId)}&limit=1`);
    const app = payload?.data?.[0];
    if (!app?.id) {
      throw new Error(`No App Store Connect app found for bundle ID ${config.bundleId}`);
    }
    return app.id;
  }

  async function fetchLatestReadyIOSVersion() {
    const appId = await fetchAppId();
    const payload = await apiRequest(
      `/apps/${appId}/appStoreVersions?filter[platform]=IOS&filter[appStoreState]=${READY_FOR_DISTRIBUTION}&limit=50`
    );
    const versions = (payload?.data || [])
      .map((item) => item?.attributes?.versionString)
      .filter(Boolean);

    if (versions.length === 0) {
      return null;
    }

    return versions.sort((left, right) => compareVersionStrings(right, left))[0];
  }

  async function getLatestReadyIOSVersion({ force = false } = {}) {
    if (!isConfigured()) {
      return null;
    }

    const now = config.now();
    if (!force && cache.version && cache.expiresAt > now) {
      return cache.version;
    }

    if (!force && inflight) {
      return inflight;
    }

    inflight = (async () => {
      try {
        const version = await fetchLatestReadyIOSVersion();
        cache = {
          version,
          expiresAt: now + config.cacheTtlMs,
        };
        return version;
      } finally {
        inflight = null;
      }
    })();

    return inflight;
  }

  return {
    isConfigured,
    getLatestReadyIOSVersion,
    compareVersionStrings,
  };
}

module.exports = {
  READY_FOR_DISTRIBUTION,
  compareVersionStrings,
  createAppStoreConnectService,
};
