/**
 * Apple Receipt Validation Service
 *
 * Validates App Store receipts and subscriptions using App Store Server API v2.
 * Handles JWT authentication, transaction lookup, and subscription status parsing.
 *
 * Required environment variables:
 * - APPLE_APP_STORE_KEY_ID: Key ID from App Store Connect
 * - APPLE_APP_STORE_ISSUER_ID: Issuer ID from App Store Connect
 * - APPLE_APP_STORE_PRIVATE_KEY: Contents of .p8 file (or path to file)
 * - APPLE_BUNDLE_ID: Your app's bundle identifier
 *
 * Usage:
 *   const validator = createAppleReceiptValidator();
 *   const result = await validator.verifyTransaction(transactionId);
 */

const crypto = require("crypto");

/**
 * App Store Server API endpoints
 */
const ENDPOINTS = {
  production: "https://api.storekit.itunes.apple.com",
  sandbox: "https://api.storekit-sandbox.itunes.apple.com",
};

/**
 * Subscription status values from Apple
 */
const SUBSCRIPTION_STATUS = {
  ACTIVE: 1,
  EXPIRED: 2,
  BILLING_RETRY: 3,
  BILLING_GRACE_PERIOD: 4,
  REVOKED: 5,
};

/**
 * Auto-renew status values
 */
const AUTO_RENEW_STATUS = {
  OFF: 0,
  ON: 1,
};

/**
 * Create an Apple Receipt Validator instance
 * @param {Object} options - Configuration options
 * @returns {Object} Validator interface
 */
function createAppleReceiptValidator(options = {}) {
  const config = {
    keyId: options.keyId || process.env.APPLE_APP_STORE_KEY_ID,
    issuerId: options.issuerId || process.env.APPLE_APP_STORE_ISSUER_ID,
    privateKey: options.privateKey || process.env.APPLE_APP_STORE_PRIVATE_KEY,
    bundleId: options.bundleId || process.env.APPLE_BUNDLE_ID,
    environment: options.environment || "production",
  };

  /**
   * Check if validator is configured
   */
  function isConfigured() {
    return Boolean(config.keyId && config.issuerId && config.privateKey && config.bundleId);
  }

  /**
   * Generate JWT for App Store Server API authentication
   * @returns {string} JWT token
   */
  function generateJWT() {
    if (!isConfigured()) {
      throw new Error("Apple App Store credentials not configured");
    }

    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 60 * 20; // 20 minutes

    // Header
    const header = {
      alg: "ES256",
      kid: config.keyId,
      typ: "JWT",
    };

    // Payload
    const payload = {
      iss: config.issuerId,
      iat: now,
      exp: expiry,
      aud: "appstoreconnect-v1",
      bid: config.bundleId,
    };

    // Encode header and payload
    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signatureInput = `${encodedHeader}.${encodedPayload}`;

    // Sign with ES256 (ECDSA using P-256 and SHA-256)
    const privateKey = config.privateKey.includes("-----BEGIN")
      ? config.privateKey
      : `-----BEGIN PRIVATE KEY-----\n${config.privateKey}\n-----END PRIVATE KEY-----`;

    const sign = crypto.createSign("SHA256");
    sign.update(signatureInput);
    sign.end();

    // Get DER signature and convert to P1363 format (64 bytes for ES256)
    const derSignature = sign.sign({
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    });

    const signature = base64UrlEncode(derSignature);
    return `${signatureInput}.${signature}`;
  }

  /**
   * Make authenticated request to App Store Server API
   * @param {string} path - API path
   * @param {string} method - HTTP method
   * @param {Object} body - Request body (for POST)
   * @returns {Promise<Object>} API response
   */
  async function apiRequest(path, method = "GET", body = null, options = {}) {
    const environment = options.environment || config.environment;
    const baseUrl = ENDPOINTS[environment] || ENDPOINTS.production;
    const url = `${baseUrl}${path}`;

    const headers = {
      Authorization: `Bearer ${generateJWT()}`,
      "Content-Type": "application/json",
    };

    const fetchOptions = {
      method,
      headers,
    };

    if (body) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { message: errorText };
      }

      const error = new Error(`App Store API error: ${response.status}`);
      error.status = response.status;
      error.data = errorData;
      throw error;
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  /**
   * Get transaction info by transaction ID
   * @param {string} transactionId - The transaction ID
   * @returns {Promise<Object>} Transaction info
   */
  async function getTransactionInfo(transactionId, options = {}) {
    const response = await apiRequest(
      `/inApps/v1/transactions/${transactionId}`,
      "GET",
      null,
      options
    );

    if (!response || !response.signedTransactionInfo) {
      return null;
    }

    // Decode the signed transaction (JWS)
    const transactionInfo = decodeJWS(response.signedTransactionInfo);
    return transactionInfo;
  }

  /**
   * Get subscription status by original transaction ID
   * @param {string} originalTransactionId - The original transaction ID
   * @returns {Promise<Object>} Subscription status
   */
  async function getSubscriptionStatus(originalTransactionId, options = {}) {
    const response = await apiRequest(
      `/inApps/v1/subscriptions/${originalTransactionId}`,
      "GET",
      null,
      options
    );

    if (!response || !response.data || response.data.length === 0) {
      return null;
    }

    // Parse the subscription group data
    const subscriptionGroup = response.data[0];
    const lastTransaction = subscriptionGroup.lastTransactions?.[0];

    if (!lastTransaction) {
      return null;
    }

    // Decode the signed transaction and renewal info
    const transactionInfo = decodeJWS(lastTransaction.signedTransactionInfo);
    const renewalInfo = lastTransaction.signedRenewalInfo
      ? decodeJWS(lastTransaction.signedRenewalInfo)
      : null;

    return {
      status: lastTransaction.status,
      transactionInfo,
      renewalInfo,
      environment: subscriptionGroup.environment,
      bundleId: subscriptionGroup.bundleId,
    };
  }

  /**
   * Get transaction history for a transaction
   * @param {string} transactionId - Any transaction ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Transaction history
   */
  async function getTransactionHistory(transactionId, options = {}) {
    const queryParams = new URLSearchParams();

    if (options.startDate) {
      queryParams.set("startDate", options.startDate.toString());
    }
    if (options.endDate) {
      queryParams.set("endDate", options.endDate.toString());
    }
    if (options.productId) {
      queryParams.set("productId", options.productId);
    }

    const query = queryParams.toString() ? `?${queryParams}` : "";
    const response = await apiRequest(
      `/inApps/v1/history/${transactionId}${query}`,
      "GET",
      null,
      options
    );

    if (!response || !response.signedTransactions) {
      return [];
    }

    // Decode all transactions
    return response.signedTransactions.map((signed) => decodeJWS(signed));
  }

  /**
   * Verify a transaction and return normalized subscription status
   * This is the main entry point for receipt validation
   *
   * @param {string} transactionId - Transaction ID from StoreKit
   * @returns {Promise<Object>} Normalized subscription status
   */
  async function verifyTransaction(transactionId) {
    // First, get the transaction info with production->sandbox fallback.
    const txLookup = await getTransactionInfoWithFallback(transactionId);
    const transactionInfo = txLookup?.transactionInfo;

    if (!transactionInfo) {
      return {
        valid: false,
        error: "Transaction not found",
      };
    }

    // For subscriptions, get full subscription status
    if (transactionInfo.type === "Auto-Renewable Subscription") {
      const statusLookup = await getSubscriptionStatusWithFallback(
        transactionInfo.originalTransactionId,
        txLookup.environment
      );
      const subscriptionStatus = statusLookup?.subscriptionStatus;

      if (!subscriptionStatus) {
        return {
          valid: false,
          error: "Subscription status not found",
        };
      }

      return normalizeSubscriptionStatus(subscriptionStatus);
    }

    // For non-subscription purchases
    return {
      valid: true,
      type: "one_time_purchase",
      transactionId: transactionInfo.transactionId,
      originalTransactionId: transactionInfo.originalTransactionId,
      productId: transactionInfo.productId,
      purchaseDate: new Date(transactionInfo.purchaseDate),
      environment:
        transactionInfo.environment?.toLowerCase() ||
        txLookup.environment ||
        "production",
    };
  }

  function getEnvironmentOrder(preferredEnvironment = config.environment) {
    const normalized =
      preferredEnvironment === "sandbox" ? "sandbox" : "production";
    return normalized === "sandbox"
      ? ["sandbox", "production"]
      : ["production", "sandbox"];
  }

  function isEnvironmentNotFoundError(err) {
    if (!err) return false;
    if (err.status === 404) return true;
    if (err.status === 401) return true; // Key may only be valid for one environment
    const errorCode = Number(err.data?.errorCode);
    return [
      4000006, // ORIGINAL_TRANSACTION_ID_NOT_FOUND
      4040005, // ORIGINAL_TRANSACTION_ID_NOT_FOUND
      4040006, // TRANSACTION_ID_NOT_FOUND
      4040009, // SUBSCRIPTION_NOT_FOUND
      4040010, // TRANSACTION_NOT_FOUND
      4040011, // ORIGINAL_TRANSACTION_NOT_FOUND
    ].includes(errorCode);
  }

  async function withEnvironmentFallback(fn, preferredEnvironment = config.environment) {
    const environments = getEnvironmentOrder(preferredEnvironment);
    let lastError = null;

    for (let i = 0; i < environments.length; i++) {
      const environment = environments[i];
      try {
        const value = await fn(environment);
        if (value) {
          return { value, environment };
        }
      } catch (err) {
        lastError = err;
        const isLastEnvironment = i === environments.length - 1;
        if (isLastEnvironment || !isEnvironmentNotFoundError(err)) {
          throw err;
        }
      }
    }

    if (lastError) {
      throw lastError;
    }

    return { value: null, environment: environments[0] };
  }

  async function getTransactionInfoWithFallback(transactionId, preferredEnvironment = config.environment) {
    const lookup = await withEnvironmentFallback(
      (environment) => getTransactionInfo(transactionId, { environment }),
      preferredEnvironment
    );
    if (!lookup.value) {
      return null;
    }
    return {
      transactionInfo: lookup.value,
      environment: lookup.environment,
    };
  }

  async function getSubscriptionStatusWithFallback(
    originalTransactionId,
    preferredEnvironment = config.environment
  ) {
    const lookup = await withEnvironmentFallback(
      (environment) => getSubscriptionStatus(originalTransactionId, { environment }),
      preferredEnvironment
    );
    if (!lookup.value) {
      return null;
    }
    return {
      subscriptionStatus: lookup.value,
      environment: lookup.environment,
    };
  }

  /**
   * Normalize subscription status to a consistent format
   * @param {Object} subscriptionStatus - Raw subscription status from Apple
   * @returns {Object} Normalized status
   */
  function normalizeSubscriptionStatus(subscriptionStatus) {
    const { status, transactionInfo, renewalInfo, environment } = subscriptionStatus;

    const isActive = status === SUBSCRIPTION_STATUS.ACTIVE;
    const isInGracePeriod = status === SUBSCRIPTION_STATUS.BILLING_GRACE_PERIOD;
    const isInBillingRetry = status === SUBSCRIPTION_STATUS.BILLING_RETRY;
    const isExpired = status === SUBSCRIPTION_STATUS.EXPIRED;
    const isRevoked = status === SUBSCRIPTION_STATUS.REVOKED;

    // Parse expiration dates
    const expiresAt = transactionInfo.expiresDate
      ? new Date(transactionInfo.expiresDate)
      : null;

    const gracePeriodExpiresAt = renewalInfo?.gracePeriodExpiresDate
      ? new Date(renewalInfo.gracePeriodExpiresDate)
      : null;

    // Determine if subscription should be considered valid
    return {
      valid: true,
      type: "subscription",
      platform: "apple",

      // Transaction identifiers
      transactionId: transactionInfo.transactionId,
      originalTransactionId: transactionInfo.originalTransactionId,
      productId: transactionInfo.productId,

      // Status
      status: mapStatusToString(status),
      isActive,
      isExpired,
      isRevoked,
      isInGracePeriod,
      isInBillingRetry,

      // Dates
      purchaseDate: new Date(transactionInfo.purchaseDate),
      originalPurchaseDate: new Date(transactionInfo.originalPurchaseDate),
      expiresAt,
      gracePeriodExpiresAt,

      // Renewal info
      autoRenewEnabled: renewalInfo?.autoRenewStatus === AUTO_RENEW_STATUS.ON,
      autoRenewProductId: renewalInfo?.autoRenewProductId || null,

      // Trial/Intro offer
      isTrialPeriod: transactionInfo.offerType === 1, // Introductory offer
      isInIntroOfferPeriod: transactionInfo.offerType === 2,

      // Environment
      environment: environment?.toLowerCase() || "production",

      // Raw data for debugging
      _raw: {
        status,
        transactionInfo,
        renewalInfo,
      },
    };
  }

  /**
   * Map Apple status code to string
   */
  function mapStatusToString(status) {
    switch (status) {
      case SUBSCRIPTION_STATUS.ACTIVE:
        return "active";
      case SUBSCRIPTION_STATUS.EXPIRED:
        return "expired";
      case SUBSCRIPTION_STATUS.BILLING_RETRY:
        return "billing_retry";
      case SUBSCRIPTION_STATUS.BILLING_GRACE_PERIOD:
        return "grace_period";
      case SUBSCRIPTION_STATUS.REVOKED:
        return "revoked";
      default:
        return "unknown";
    }
  }

  /**
   * Verify and decode a JWS (JSON Web Signature) from Apple
   * Apple signs responses with JWS using ES256 and an x5c certificate chain.
   * We MUST verify the signature to prevent forged subscription status.
   *
   * @param {string} jws - JWS string
   * @param {Object} options - Options
   * @param {boolean} options.skipVerification - Skip verification (ONLY for testing)
   * @returns {Object} Decoded payload or null if verification fails
   */
  function decodeJWS(jws, options = {}) {
    try {
      const parts = jws.split(".");
      if (parts.length !== 3) {
        throw new Error("Invalid JWS format");
      }

      const [headerB64, payloadB64, signatureB64] = parts;

      // Decode header to get certificate chain
      const header = JSON.parse(base64UrlDecode(headerB64));

      // Apple uses x5c (X.509 certificate chain) for signing
      if (!header.x5c || !Array.isArray(header.x5c) || header.x5c.length === 0) {
        // Allow explicit skip for unit tests and implicit skip in NODE_ENV=test.
        // Production/sandbox traffic must include x5c and verify signatures.
        if (options.skipVerification || process.env.NODE_ENV === "test") {
          console.warn("[Apple Validator] Skipping JWS verification (test mode only)");
          const payload = base64UrlDecode(payloadB64);
          return JSON.parse(payload);
        }
        throw new Error("Missing x5c certificate chain in JWS header");
      }

      // Verify the signature using the leaf certificate
      const leafCertPEM = convertX5cToPEM(header.x5c[0]);
      const signatureInput = `${headerB64}.${payloadB64}`;
      const signature = base64UrlDecodeBuffer(signatureB64);

      // Verify ES256 signature
      const isValid = crypto.verify(
        "sha256",
        Buffer.from(signatureInput),
        {
          key: leafCertPEM,
          dsaEncoding: "ieee-p1363", // Apple uses IEEE P1363 format for ES256
        },
        signature
      );

      if (!isValid) {
        console.error("[Apple Validator] JWS signature verification failed");
        throw new Error("JWS signature verification failed");
      }

      // Verify certificate chain (basic validation)
      // In production, you should also verify the chain leads to Apple's root CA
      if (!verifyCertificateChain(header.x5c)) {
        console.error("[Apple Validator] Certificate chain validation failed");
        throw new Error("Certificate chain validation failed");
      }

      // Signature valid, return payload
      const payload = base64UrlDecode(payloadB64);
      return JSON.parse(payload);
    } catch (err) {
      console.error("[Apple Validator] Failed to verify/decode JWS:", err.message);
      return null;
    }
  }

  /**
   * Convert base64-encoded X.509 certificate to PEM format
   */
  function convertX5cToPEM(base64Cert) {
    const lines = base64Cert.match(/.{1,64}/g) || [];
    return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`;
  }

  /**
   * Decode base64url to Buffer (for signature)
   */
  function base64UrlDecodeBuffer(str) {
    let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    const padding = base64.length % 4;
    if (padding) {
      base64 += "=".repeat(4 - padding);
    }
    return Buffer.from(base64, "base64");
  }

  // Known Apple Root CA certificate fingerprints (SHA-256)
  // Source: https://www.apple.com/certificateauthority/
  const APPLE_ROOT_CA_FINGERPRINTS = new Set([
    // Apple Root CA (used for App Store Server API)
    "b0b1730ecbc7ff4505142c49f1295e6eda6bcaed7e2c68c5be91b5a11001f024",
    // Apple Root CA - G2
    "c2b9b042dd57830e7d117dac55ac8ae19407d38e41d88f3215bc3a890444a050",
    // Apple Root CA - G3
    "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179",
  ]);

  /**
   * Verify certificate chain validity
   * Checks that certificates form a valid chain, are not expired,
   * and chain terminates at a known Apple Root CA
   */
  function verifyCertificateChain(x5c) {
    if (!x5c || x5c.length === 0) {
      return false;
    }

    try {
      // Parse each certificate and verify basic validity
      for (let i = 0; i < x5c.length; i++) {
        const certPEM = convertX5cToPEM(x5c[i]);
        const cert = new crypto.X509Certificate(certPEM);

        // Check certificate is not expired
        const now = new Date();
        if (now < new Date(cert.validFrom) || now > new Date(cert.validTo)) {
          console.error(`[Apple Validator] Certificate ${i} is expired or not yet valid`);
          return false;
        }

        // Verify chain: each cert should be signed by the next (issuer)
        if (i < x5c.length - 1) {
          const issuerPEM = convertX5cToPEM(x5c[i + 1]);
          const issuerCert = new crypto.X509Certificate(issuerPEM);
          if (!cert.verify(issuerCert.publicKey)) {
            console.error(`[Apple Validator] Certificate ${i} not signed by issuer`);
            return false;
          }
        }
      }

      // Verify root certificate is a known Apple Root CA (fingerprint pinning)
      const rootCertPEM = convertX5cToPEM(x5c[x5c.length - 1]);
      const rootCert = new crypto.X509Certificate(rootCertPEM);

      // Get the SHA-256 fingerprint in lowercase hex
      const fingerprint = rootCert.fingerprint256
        .replace(/:/g, "")
        .toLowerCase();

      if (!APPLE_ROOT_CA_FINGERPRINTS.has(fingerprint)) {
        console.error(
          "[Apple Validator] Root certificate fingerprint not recognized as Apple Root CA:",
          fingerprint
        );
        return false;
      }

      return true;
    } catch (err) {
      console.error("[Apple Validator] Certificate chain verification error:", err.message);
      return false;
    }
  }

  /**
   * Look up all subscriptions for a user by any transaction ID
   * @param {string} transactionId - Any transaction ID from the user
   * @returns {Promise<Array>} Array of active subscriptions
   */
  async function getAllSubscriptions(transactionId) {
    const historyLookup = await withEnvironmentFallback(
      (environment) => getTransactionHistory(transactionId, { environment }),
      config.environment
    );
    const history = historyLookup.value || [];
    const historyEnvironment = historyLookup.environment;

    // Group by original transaction ID and get latest for each
    const subscriptionMap = new Map();

    for (const tx of history) {
      if (tx.type === "Auto-Renewable Subscription") {
        const existing = subscriptionMap.get(tx.originalTransactionId);
        if (!existing || tx.purchaseDate > existing.purchaseDate) {
          subscriptionMap.set(tx.originalTransactionId, tx);
        }
      }
    }

    // Get full status for each subscription
    const subscriptions = [];
    for (const [originalTxId] of subscriptionMap) {
      try {
        const statusLookup = await getSubscriptionStatusWithFallback(
          originalTxId,
          historyEnvironment
        );
        if (statusLookup?.subscriptionStatus) {
          subscriptions.push(normalizeSubscriptionStatus(statusLookup.subscriptionStatus));
        }
      } catch (err) {
        console.error(
          `[Apple Validator] Failed to get status for ${originalTxId}:`,
          err.message
        );
      }
    }

    return subscriptions;
  }

  /**
   * Request a test notification (sandbox only)
   * Useful for testing webhook integration
   * @returns {Promise<Object>} Test notification token
   */
  async function requestTestNotification() {
    if (config.environment !== "sandbox") {
      throw new Error("Test notifications only available in sandbox");
    }

    const response = await apiRequest(
      "/inApps/v1/notifications/test",
      "POST",
      {}
    );
    return response;
  }

  return {
    // Configuration
    isConfigured,

    // Core validation
    verifyTransaction,
    getTransactionInfo,
    getSubscriptionStatus,
    getTransactionHistory,
    getAllSubscriptions,

    // Utilities
    generateJWT,
    decodeJWS,

    // Testing
    requestTestNotification,

    // Constants
    SUBSCRIPTION_STATUS,
    AUTO_RENEW_STATUS,
  };
}

/**
 * Base64 URL encode
 */
function base64UrlEncode(data) {
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Base64 URL decode
 */
function base64UrlDecode(str) {
  // Add padding if necessary
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padding = base64.length % 4;
  if (padding) {
    base64 += "=".repeat(4 - padding);
  }
  return Buffer.from(base64, "base64").toString("utf8");
}

module.exports = {
  createAppleReceiptValidator,
  ENDPOINTS,
  SUBSCRIPTION_STATUS,
  AUTO_RENEW_STATUS,
};
