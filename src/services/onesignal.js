/**
 * OneSignal Marketing Push Service
 *
 * Handles engagement/marketing push notifications via OneSignal REST API.
 * Complements the native APNs service (push-notification.js) which handles
 * transactional "song ready" notifications.
 *
 * Uses OneSignal REST API directly (no SDK) for reliability — all published
 * SDK versions are beta.
 */

const API_BASE = "https://api.onesignal.com";

function getConfig() {
  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  return { appId, apiKey };
}

function isConfigured() {
  const { appId, apiKey } = getConfig();
  return !!(appId && apiKey);
}

async function apiRequest(method, path, body = null) {
  const { appId, apiKey } = getConfig();
  if (!appId || !apiKey) {
    throw new Error("OneSignal not configured: ONESIGNAL_APP_ID and ONESIGNAL_REST_API_KEY required");
  }

  const url = `${API_BASE}${path}`;
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${apiKey}`,
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = new Error(`OneSignal API error: ${response.status}`);
    error.status = response.status;
    error.response = data;
    throw error;
  }

  return data;
}

/**
 * Send a push notification to a segment.
 *
 * @param {Object} options
 * @param {string[]} options.segments - OneSignal segment names (e.g., ["Dormant 7-14 Days"])
 * @param {string} options.title - Notification title
 * @param {string} options.body - Notification body (supports emojis)
 * @param {Object} [options.data] - Custom data payload for deep linking
 * @param {string} [options.imageUrl] - Rich notification image URL
 * @returns {Promise<Object>} OneSignal API response with notification ID
 */
async function sendToSegment({ segments, title, body, data, imageUrl, name }) {
  const { appId } = getConfig();

  const payload = {
    app_id: appId,
    target_channel: "push",
    included_segments: segments,
    headings: { en: title },
    contents: { en: body },
  };

  if (name) {
    payload.name = name;
  }

  if (data) {
    payload.data = data;
  }

  if (imageUrl) {
    payload.ios_attachments = { image: imageUrl };
  }

  return apiRequest("POST", "/notifications", payload);
}

/**
 * Send a push notification to specific users by external ID.
 *
 * @param {Object} options
 * @param {string[]} options.userIds - Porizo user IDs (mapped as OneSignal external IDs)
 * @param {string} options.title - Notification title
 * @param {string} options.body - Notification body
 * @param {Object} [options.data] - Custom data payload
 * @param {string} [options.imageUrl] - Rich notification image URL
 * @returns {Promise<Object>} OneSignal API response
 */
async function sendToUsers({ userIds, title, body, data, imageUrl, name }) {
  const { appId } = getConfig();

  const payload = {
    app_id: appId,
    include_aliases: { external_id: userIds },
    target_channel: "push",
    headings: { en: title },
    contents: { en: body },
  };

  if (name) {
    payload.name = name;
  }

  if (data) {
    payload.data = data;
  }

  if (imageUrl) {
    payload.ios_attachments = { image: imageUrl };
  }

  return apiRequest("POST", "/notifications", payload);
}

/**
 * Update tags for a user identified by external ID.
 * Tags are used for segmentation (e.g., songs_created, days_since_last_song).
 *
 * @param {string} externalId - The Porizo user ID
 * @param {Object} tags - Key-value pairs to set (e.g., { songs_created: "5+", days_since_last_song: "3" })
 * @returns {Promise<Object>} OneSignal API response
 */
async function setUserTags(externalId, tags) {
  const { appId } = getConfig();
  return apiRequest("PUT", `/apps/${appId}/users/by/external_id/${externalId}`, {
    properties: { tags },
  });
}

/**
 * Compute the songs_created tag bucket for a count.
 * Maps raw count to OneSignal tag values: "0", "1", "2", "5+"
 */
function songsCreatedBucket(count) {
  if (count === 0) return "0";
  if (count === 1) return "1";
  if (count <= 4) return "2";
  return "5+";
}

/**
 * Compute days since a given date.
 * Returns null if no date provided.
 */
function daysSince(dateString) {
  if (!dateString) return null;
  const then = new Date(dateString);
  const now = new Date();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

/**
 * Start the daily tag sync cron job.
 * Updates OneSignal tags for all users based on their activity.
 *
 * Runs every 24 hours. Updates:
 * - songs_created: "0" | "1" | "2" | "5+"
 * - days_since_last_song: string number of days
 *
 * @param {Object} options
 * @param {Object} options.db - Database instance
 * @param {Object} [options.logger] - Logger instance
 * @param {number} [options.intervalMs] - Sync interval (default: 24 hours)
 * @returns {{ stop: () => void }} Job handle with stop method
 */
function startTagSyncJob({ db, logger, intervalMs = 24 * 60 * 60 * 1000 }) {
  const log = logger || console;

  async function syncTags() {
    if (!isConfigured()) {
      return;
    }

    try {
      // Get all users with their song count and most recent track creation date
      const users = await db
        .prepare(
          `SELECT u.id,
                  COUNT(t.id) as song_count,
                  MAX(t.created_at) as last_song_at
           FROM users u
           LEFT JOIN tracks t ON t.user_id = u.id
           GROUP BY u.id`
        )
        .all();

      let updated = 0;
      let errors = 0;

      for (const user of users) {
        try {
          const tags = {
            songs_created: songsCreatedBucket(user.song_count),
          };

          const days = daysSince(user.last_song_at);
          if (days !== null) {
            tags.days_since_last_song = String(days);
          } else {
            tags.days_since_last_song = "never";
          }

          await setUserTags(user.id, tags);
          updated++;
        } catch (err) {
          // Individual user failures shouldn't stop the sync
          errors++;
          if (errors <= 5) {
            log.warn({ userId: user.id, err: err.message }, "Failed to sync tags for user");
          }
        }
      }

      log.info({ updated, errors, total: users.length }, "[OneSignal] Tag sync completed");
    } catch (err) {
      log.error({ err: err.message }, "[OneSignal] Tag sync failed");
    }
  }

  // Run immediately on startup, then on interval
  syncTags();
  const timer = setInterval(syncTags, intervalMs);

  return {
    stop() {
      clearInterval(timer);
    },
    syncNow: syncTags,
  };
}

module.exports = {
  isConfigured,
  sendToSegment,
  sendToUsers,
  setUserTags,
  songsCreatedBucket,
  daysSince,
  startTagSyncJob,
};
