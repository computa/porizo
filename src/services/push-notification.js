/**
 * Push Notification Service
 *
 * APNs (Apple Push Notification service) integration for iOS devices.
 * Sends silent push notifications when renders complete so iOS can
 * refresh content in the background.
 *
 * Configuration:
 *   APNS_KEY_ID - APNs key ID (from Apple Developer Portal)
 *   APNS_TEAM_ID - Apple Team ID
 *   APNS_PRIVATE_KEY - APNs auth key (.p8 contents)
 *   APNS_BUNDLE_ID - App bundle ID (default: porizo.ios.app.PorizoApp)
 *   APNS_PRODUCTION - Set to "true" for production APNs server
 */

const apn = require("@parse/node-apn");

// Configuration (loaded from environment)
function getConfig() {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const bundleId = process.env.APNS_BUNDLE_ID || "porizo.ios.app.PorizoApp";
  const privateKey = normalizePrivateKey(process.env.APNS_PRIVATE_KEY);
  const production = process.env.APNS_PRODUCTION === "true";

  return { keyId, teamId, bundleId, privateKey, production };
}

/**
 * Normalize private key (handle escaped newlines from env vars)
 */
function normalizePrivateKey(rawKey) {
  if (!rawKey) return null;
  return rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;
}

/**
 * Check if APNs is configured
 */
function isConfigured() {
  const { keyId, teamId, privateKey } = getConfig();
  return Boolean(keyId && teamId && privateKey);
}

// APNs provider (lazy-initialized with credential rotation)
let apnProvider = null;
let apnProviderInitTime = 0;
// APNs JWT tokens expire after 60 min; re-init at 50 min to rotate before expiry
const APNS_TOKEN_TTL_MS = 50 * 60 * 1000;

/**
 * Create a new APNs provider instance
 */
function createProvider() {
  const { keyId, teamId, privateKey, production } = getConfig();
  if (!keyId || !teamId || !privateKey) {
    return null;
  }
  return new apn.Provider({
    token: {
      key: privateKey,
      keyId: keyId,
      teamId: teamId,
    },
    production: production,
  });
}

/**
 * Get APNs provider (lazy initialization with automatic credential rotation)
 */
function getProvider() {
  // SVC-09: Re-init if not yet created or credentials are older than 50 minutes
  if (!apnProvider || Date.now() - apnProviderInitTime > APNS_TOKEN_TTL_MS) {
    if (apnProvider) {
      apnProvider.shutdown();
    }
    apnProvider = createProvider();
    apnProviderInitTime = Date.now();
  }
  return apnProvider;
}

/**
 * Send a silent push notification
 *
 * Silent pushes wake the app in the background without showing
 * a user-visible notification. iOS will call the app delegate's
 * didReceiveRemoteNotification method.
 *
 * @param {string} pushToken - Device push token
 * @param {object} payload - Custom payload data
 * @returns {Promise<{success: boolean, error?: string, response?: object}>}
 */
async function sendSilentPush(pushToken, payload) {
  if (!pushToken) {
    return { success: false, error: "MISSING_PUSH_TOKEN" };
  }

  if (!isConfigured()) {
    console.warn("[PushNotification] APNs not configured - skipping notification");
    return { success: false, error: "APNS_NOT_CONFIGURED" };
  }

  const provider = getProvider();
  if (!provider) {
    return { success: false, error: "APNS_NOT_CONFIGURED" };
  }

  const { bundleId } = getConfig();

  try {
    const notification = new apn.Notification();

    // Silent push configuration
    notification.contentAvailable = true; // Required for background fetch
    notification.pushType = "background"; // iOS 13+ requires explicit push type
    notification.topic = bundleId;
    notification.priority = 5; // Low priority for silent pushes (required)

    // Custom payload
    notification.payload = payload || {};

    // Expiration: 24 hours from now
    notification.expiry = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

    const result = await provider.send(notification, pushToken);

    if (result.failed && result.failed.length > 0) {
      const failure = result.failed[0];
      console.error("[PushNotification] Failed to send:", {
        pushToken: pushToken.substring(0, 8) + "...",
        error: failure.response?.reason || failure.error?.message || "Unknown error",
        status: failure.status,
      });
      return {
        success: false,
        error: failure.response?.reason || "APNS_SEND_FAILED",
        response: failure,
      };
    }

    console.log("[PushNotification] Sent silent push:", {
      pushToken: pushToken.substring(0, 8) + "...",
      type: payload?.type || "unknown",
    });

    return { success: true, response: result };
  } catch (error) {
    console.error("[PushNotification] Exception:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Send render complete notification
 *
 * Notifies iOS device that a track render has completed.
 * The app should refresh its state to show the new content.
 *
 * @param {string} pushToken - Device push token
 * @param {string} trackId - Track ID that completed
 * @param {string} trackTitle - Track title (for logging/debugging)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendRenderComplete(pushToken, trackId, trackTitle) {
  if (!pushToken) {
    return { success: false, error: "MISSING_PUSH_TOKEN" };
  }

  if (!trackId) {
    return { success: false, error: "MISSING_TRACK_ID" };
  }

  if (!isConfigured()) {
    console.warn("[PushNotification] APNs not configured - skipping render_complete notification");
    return { success: false, error: "APNS_NOT_CONFIGURED" };
  }

  // SVC-10: Truncate title to stay within APNs payload size limits
  const safeTitle = (trackTitle || '').slice(0, 100);

  const payload = {
    type: "render_complete",
    trackId: trackId,
    trackTitle: safeTitle,
    timestamp: new Date().toISOString(),
  };

  console.log("[PushNotification] Sending render_complete:", {
    trackId,
    trackTitle: trackTitle || "(untitled)",
  });

  return sendSilentPush(pushToken, payload);
}

/**
 * Shutdown the APNs provider (for graceful shutdown)
 */
function shutdown() {
  if (apnProvider) {
    apnProvider.shutdown();
    apnProvider = null;
  }
}

module.exports = {
  isConfigured,
  getConfig,
  sendSilentPush,
  sendRenderComplete,
  shutdown,
};
