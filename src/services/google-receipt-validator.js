/**
 * Google Play Receipt Validator (Stub)
 *
 * This is a placeholder for Google Play billing validation.
 * Implementation will use Google Play Developer API when Android is supported.
 *
 * Required for implementation:
 * - Google Cloud service account with Play Developer API access
 * - GOOGLE_PLAY_PACKAGE_NAME in environment
 * - GOOGLE_PLAY_CREDENTIALS_JSON (service account credentials)
 */

class GoogleReceiptValidator {
  constructor(config = {}) {
    this.packageName = config.packageName || process.env.GOOGLE_PLAY_PACKAGE_NAME;
    // Google Play Developer API client would be initialized here
  }

  /**
   * Verify a Google Play purchase token
   * @param {string} purchaseToken - The purchase token from the client
   * @param {string} productId - The product ID (subscription or one-time)
   * @returns {Promise<object>} Purchase verification result
   * @throws {Error} Always throws NOT_IMPLEMENTED for stub
   */
  async verifyPurchase(purchaseToken, productId) {
    throw new Error("GOOGLE_BILLING_NOT_IMPLEMENTED");
  }

  /**
   * Verify a Google Play subscription
   * @param {string} purchaseToken - The subscription purchase token
   * @param {string} subscriptionId - The subscription product ID
   * @returns {Promise<object>} Subscription details
   * @throws {Error} Always throws NOT_IMPLEMENTED for stub
   */
  async verifySubscription(purchaseToken, subscriptionId) {
    throw new Error("GOOGLE_BILLING_NOT_IMPLEMENTED");
  }

  /**
   * Acknowledge a purchase (required within 3 days)
   * @param {string} purchaseToken - The purchase token
   * @param {string} productId - The product ID
   * @returns {Promise<void>}
   * @throws {Error} Always throws NOT_IMPLEMENTED for stub
   */
  async acknowledgePurchase(purchaseToken, productId) {
    throw new Error("GOOGLE_BILLING_NOT_IMPLEMENTED");
  }
}

function createGoogleReceiptValidator(config = {}) {
  return new GoogleReceiptValidator(config);
}

module.exports = { createGoogleReceiptValidator, GoogleReceiptValidator };
