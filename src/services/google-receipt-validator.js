/**
 * Google Play Receipt Validator
 *
 * Validates Google Play purchases and subscriptions using Android Publisher API v3.
 * Handles service account authentication, purchase verification, and subscription status.
 *
 * Required environment variables:
 * - GOOGLE_PLAY_PACKAGE_NAME: Your app's package name (e.g., com.example.app)
 * - GOOGLE_PLAY_CREDENTIALS_JSON: Service account credentials JSON (or path to file)
 *
 * Usage:
 *   const validator = createGoogleReceiptValidator();
 *   const result = await validator.verifySubscription(purchaseToken, subscriptionId);
 */

const crypto = require("crypto");

/**
 * Google Play API endpoints
 */
const ENDPOINTS = {
  auth: "https://oauth2.googleapis.com/token",
  api: "https://androidpublisher.googleapis.com/androidpublisher/v3",
};

/**
 * Subscription state values from Google Play
 * https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2
 */
const SUBSCRIPTION_STATE = {
  SUBSCRIPTION_STATE_UNSPECIFIED: 0,
  SUBSCRIPTION_STATE_PENDING: 1,
  SUBSCRIPTION_STATE_ACTIVE: 2,
  SUBSCRIPTION_STATE_PAUSED: 3,
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: 4,
  SUBSCRIPTION_STATE_ON_HOLD: 5,
  SUBSCRIPTION_STATE_CANCELED: 6,
  SUBSCRIPTION_STATE_EXPIRED: 7,
};

/**
 * Acknowledgment state values
 */
const ACKNOWLEDGEMENT_STATE = {
  ACKNOWLEDGEMENT_STATE_UNSPECIFIED: 0,
  ACKNOWLEDGEMENT_STATE_PENDING: 1,
  ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED: 2,
};

/**
 * Map Google subscription state to our internal status
 */
function mapSubscriptionStatus(googleState) {
  switch (googleState) {
    case SUBSCRIPTION_STATE.SUBSCRIPTION_STATE_ACTIVE:
      return "active";
    case SUBSCRIPTION_STATE.SUBSCRIPTION_STATE_IN_GRACE_PERIOD:
      return "grace_period";
    case SUBSCRIPTION_STATE.SUBSCRIPTION_STATE_ON_HOLD:
      return "on_hold";
    case SUBSCRIPTION_STATE.SUBSCRIPTION_STATE_PAUSED:
      return "paused";
    case SUBSCRIPTION_STATE.SUBSCRIPTION_STATE_CANCELED:
      return "cancelled";
    case SUBSCRIPTION_STATE.SUBSCRIPTION_STATE_EXPIRED:
      return "expired";
    case SUBSCRIPTION_STATE.SUBSCRIPTION_STATE_PENDING:
      return "pending";
    default:
      return "unknown";
  }
}

/**
 * Map Google product ID to our tier
 */
function mapProductIdToTier(productId) {
  if (!productId) return "free";

  const id = productId.toLowerCase();
  if (id.includes("premium") || id.includes("pro")) {
    return "premium";
  }
  if (id.includes("basic") || id.includes("starter")) {
    return "basic";
  }
  return "free";
}

/**
 * Create a Google Receipt Validator instance
 * @param {Object} options - Configuration options
 * @returns {Object} Validator interface
 */
function createGoogleReceiptValidator(options = {}) {
  const config = {
    packageName: options.packageName || process.env.GOOGLE_PLAY_PACKAGE_NAME,
    credentials: null,
  };

  // Parse credentials from options or environment
  const credentialsSource = options.credentials || process.env.GOOGLE_PLAY_CREDENTIALS_JSON;
  if (credentialsSource) {
    try {
      config.credentials = JSON.parse(credentialsSource);
    } catch {
      config.credentials = null;
    }
  }

  // Cache for access token
  let accessToken = null;
  let tokenExpiry = 0;

  /**
   * Check if validator is configured with required credentials
   */
  function isConfigured() {
    const { packageName, credentials } = config;
    return Boolean(
      packageName &&
      credentials?.client_email &&
      credentials?.private_key
    );
  }

  /**
   * Generate JWT for service account authentication
   * @returns {string} JWT token for OAuth2 exchange
   */
  function generateServiceAccountJWT() {
    if (!isConfigured()) {
      throw new Error("Google Play credentials not configured");
    }

    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 3600; // 1 hour

    const header = {
      alg: "RS256",
      typ: "JWT",
    };

    const payload = {
      iss: config.credentials.client_email,
      sub: config.credentials.client_email,
      aud: ENDPOINTS.auth,
      iat: now,
      exp: expiry,
      scope: "https://www.googleapis.com/auth/androidpublisher",
    };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signatureInput = `${encodedHeader}.${encodedPayload}`;

    // Sign with RS256
    const sign = crypto.createSign("RSA-SHA256");
    sign.update(signatureInput);
    sign.end();

    const signature = sign.sign(config.credentials.private_key);
    const encodedSignature = base64UrlEncode(signature);

    return `${signatureInput}.${encodedSignature}`;
  }

  /**
   * Get OAuth2 access token using service account JWT
   * @returns {Promise<string>} Access token
   */
  async function getAccessToken() {
    // Return cached token if still valid (with 5 minute buffer)
    if (accessToken && Date.now() < tokenExpiry - 300000) {
      return accessToken;
    }

    const jwt = generateServiceAccountJWT();

    const response = await fetch(ENDPOINTS.auth, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`Google OAuth2 error: ${response.status}`);
      error.status = response.status;
      error.data = errorText;
      throw error;
    }

    const data = await response.json();
    accessToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in * 1000);

    return accessToken;
  }

  /**
   * Make authenticated request to Android Publisher API
   * @param {string} path - API path (after /applications/{packageName})
   * @param {string} method - HTTP method
   * @param {Object} body - Request body (for POST)
   * @returns {Promise<Object>} API response
   */
  async function apiRequest(path, method = "GET", body = null) {
    const token = await getAccessToken();
    const url = `${ENDPOINTS.api}/applications/${config.packageName}${path}`;

    const headers = {
      Authorization: `Bearer ${token}`,
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

      const error = new Error(`Google Play API error: ${response.status}`);
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

  // Pattern for valid Google Play tokens and product IDs (alphanumeric with dots, hyphens, underscores)
  const VALID_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

  /**
   * Validate purchase token format to prevent URL injection
   */
  function isValidTokenFormat(token) {
    return typeof token === "string" && token.length <= 500 && VALID_ID_PATTERN.test(token);
  }

  /**
   * Validate product ID format
   */
  function isValidProductId(productId) {
    return typeof productId === "string" && productId.length <= 150 && VALID_ID_PATTERN.test(productId);
  }

  /**
   * Verify a one-time product purchase
   * @param {string} purchaseToken - The purchase token from the client
   * @param {string} productId - The product ID
   * @returns {Promise<Object>} Purchase verification result
   */
  async function verifyPurchase(purchaseToken, productId) {
    if (!isConfigured()) {
      throw new Error("GOOGLE_BILLING_NOT_CONFIGURED");
    }

    if (!isValidTokenFormat(purchaseToken)) {
      throw new Error("INVALID_PURCHASE_TOKEN_FORMAT");
    }
    if (!isValidProductId(productId)) {
      throw new Error("INVALID_PRODUCT_ID_FORMAT");
    }

    const response = await apiRequest(
      `/purchases/products/${productId}/tokens/${purchaseToken}`
    );

    if (!response) {
      return { valid: false, reason: "Purchase not found" };
    }

    return {
      valid: response.purchaseState === 0, // 0 = Purchased
      purchaseState: response.purchaseState,
      consumptionState: response.consumptionState,
      acknowledged: response.acknowledgementState === ACKNOWLEDGEMENT_STATE.ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED,
      orderId: response.orderId,
      purchaseTimeMillis: response.purchaseTimeMillis,
      raw: response,
    };
  }

  /**
   * Verify a subscription purchase (v2 API)
   * @param {string} purchaseToken - The subscription purchase token
   * @param {string} subscriptionId - The subscription product ID
   * @returns {Promise<Object>} Subscription details
   */
  async function verifySubscription(purchaseToken, subscriptionId) {
    if (!isConfigured()) {
      throw new Error("GOOGLE_BILLING_NOT_CONFIGURED");
    }

    if (!isValidTokenFormat(purchaseToken)) {
      throw new Error("INVALID_PURCHASE_TOKEN_FORMAT");
    }
    if (subscriptionId && !isValidProductId(subscriptionId)) {
      throw new Error("INVALID_SUBSCRIPTION_ID_FORMAT");
    }

    // Use subscriptions v2 API for more detailed info
    const response = await apiRequest(
      `/purchases/subscriptionsv2/tokens/${purchaseToken}`
    );

    if (!response) {
      return { valid: false, reason: "Subscription not found" };
    }

    const status = mapSubscriptionStatus(response.subscriptionState);
    const isActive = ["active", "grace_period"].includes(status);

    // Extract line items for multi-product subscriptions
    const lineItems = response.lineItems || [];
    const primaryItem = lineItems[0] || {};

    return {
      valid: true,
      active: isActive,
      status,
      tier: mapProductIdToTier(primaryItem.productId || subscriptionId),
      orderId: response.latestOrderId,
      startTime: response.startTime,
      expiryTime: primaryItem.expiryTime,
      autoRenewing: primaryItem.autoRenewingPlan?.autoRenewEnabled || false,
      acknowledged: response.acknowledgementState === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
      linkedPurchaseToken: response.linkedPurchaseToken,
      cancelReason: response.canceledStateContext?.userInitiatedCancellation ? "user_cancelled" : null,
      raw: response,
    };
  }

  /**
   * Acknowledge a purchase (required within 3 days)
   * @param {string} purchaseToken - The purchase token
   * @param {string} productId - The product ID
   * @param {string} type - "product" or "subscription"
   * @returns {Promise<void>}
   */
  async function acknowledgePurchase(purchaseToken, productId, type = "subscription") {
    if (!isConfigured()) {
      throw new Error("GOOGLE_BILLING_NOT_CONFIGURED");
    }

    const path = type === "subscription"
      ? `/purchases/subscriptions/${productId}/tokens/${purchaseToken}:acknowledge`
      : `/purchases/products/${productId}/tokens/${purchaseToken}:acknowledge`;

    await apiRequest(path, "POST", {});
  }

  /**
   * Cancel a subscription (for admin use)
   * @param {string} purchaseToken - The subscription purchase token
   * @param {string} subscriptionId - The subscription product ID
   * @returns {Promise<void>}
   */
  async function cancelSubscription(purchaseToken, subscriptionId) {
    if (!isConfigured()) {
      throw new Error("GOOGLE_BILLING_NOT_CONFIGURED");
    }

    await apiRequest(
      `/purchases/subscriptions/${subscriptionId}/tokens/${purchaseToken}:cancel`,
      "POST",
      {}
    );
  }

  /**
   * Revoke a subscription (for admin use - immediate revocation)
   * @param {string} purchaseToken - The subscription purchase token
   * @param {string} subscriptionId - The subscription product ID
   * @returns {Promise<void>}
   */
  async function revokeSubscription(purchaseToken, subscriptionId) {
    if (!isConfigured()) {
      throw new Error("GOOGLE_BILLING_NOT_CONFIGURED");
    }

    await apiRequest(
      `/purchases/subscriptions/${subscriptionId}/tokens/${purchaseToken}:revoke`,
      "POST",
      {}
    );
  }

  return {
    isConfigured,
    verifyPurchase,
    verifySubscription,
    acknowledgePurchase,
    cancelSubscription,
    revokeSubscription,
    // Expose for testing
    getAccessToken,
  };
}

/**
 * Base64 URL encode
 */
function base64UrlEncode(data) {
  const buffer = typeof data === "string" ? Buffer.from(data) : data;
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

module.exports = {
  createGoogleReceiptValidator,
  SUBSCRIPTION_STATE,
  ACKNOWLEDGEMENT_STATE,
  mapSubscriptionStatus,
  mapProductIdToTier,
};
