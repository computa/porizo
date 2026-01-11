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
  async function apiRequest(path, method = "GET", body = null) {
    const baseUrl = ENDPOINTS[config.environment] || ENDPOINTS.production;
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
  async function getTransactionInfo(transactionId) {
    const response = await apiRequest(`/inApps/v1/transactions/${transactionId}`);

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
  async function getSubscriptionStatus(originalTransactionId) {
    const response = await apiRequest(
      `/inApps/v1/subscriptions/${originalTransactionId}`
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
      `/inApps/v1/history/${transactionId}${query}`
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
    // First, get the transaction info
    const transactionInfo = await getTransactionInfo(transactionId);

    if (!transactionInfo) {
      return {
        valid: false,
        error: "Transaction not found",
      };
    }

    // For subscriptions, get full subscription status
    if (transactionInfo.type === "Auto-Renewable Subscription") {
      const subscriptionStatus = await getSubscriptionStatus(
        transactionInfo.originalTransactionId
      );

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
      environment: transactionInfo.environment?.toLowerCase() || "production",
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
    const now = new Date();
    const isValid = isActive || isInGracePeriod || isInBillingRetry;

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
   * Decode a JWS (JSON Web Signature) from Apple
   * Apple signs responses with JWS, we need to decode the payload
   *
   * @param {string} jws - JWS string
   * @returns {Object} Decoded payload
   */
  function decodeJWS(jws) {
    try {
      const parts = jws.split(".");
      if (parts.length !== 3) {
        throw new Error("Invalid JWS format");
      }

      // Decode payload (second part)
      const payload = base64UrlDecode(parts[1]);
      return JSON.parse(payload);
    } catch (err) {
      console.error("[Apple Validator] Failed to decode JWS:", err.message);
      return null;
    }
  }

  /**
   * Look up all subscriptions for a user by any transaction ID
   * @param {string} transactionId - Any transaction ID from the user
   * @returns {Promise<Array>} Array of active subscriptions
   */
  async function getAllSubscriptions(transactionId) {
    const history = await getTransactionHistory(transactionId);

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
        const status = await getSubscriptionStatus(originalTxId);
        if (status) {
          subscriptions.push(normalizeSubscriptionStatus(status));
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
  const str = typeof data === "string" ? data : data.toString("base64");
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
