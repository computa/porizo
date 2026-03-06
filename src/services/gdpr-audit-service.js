/**
 * GDPR Audit Service
 *
 * Logs compliance events for account deletion per spec section 8.1.3.
 * Maintains audit trail for regulatory compliance (7-year retention).
 */

const crypto = require("crypto");

let db;

/**
 * Initialize the service with database instance
 */
function initialize(database) {
  db = database;
}

/**
 * Generate unique event ID
 */
function generateEventId() {
  return `gdpr_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

/**
 * SVC-17: Hash IP address before storage for GDPR compliance.
 * Uses a truncated SHA-256 with optional salt so the raw IP is never persisted.
 * @param {string|null} ip - Raw IP address
 * @returns {string|null} 16-char hex hash, or null if no IP provided
 */
function hashIp(ip) {
  if (!ip) return null;
  return crypto
    .createHash("sha256")
    .update(ip + (process.env.IP_HASH_SALT || ""))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Log account deletion event for GDPR compliance
 * @param {string} userId - User ID being deleted
 * @param {string} ipAddress - IP address of the request
 * @returns {string} Event ID for reference
 */
async function logAccountDeletion(userId, ipAddress) {
  // SVC-16: Guard against calls before initialize()
  if (!db) throw new Error("GDPR audit service not initialized — call init() first");

  const now = new Date().toISOString();
  const eventId = generateEventId();

  await db.prepare(`
    INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at)
    VALUES (?, ?, 'ACCOUNT_DELETION', 'user', ?, ?, ?)
  `).run(
    eventId,
    userId,
    userId,
    JSON.stringify({
      gdpr_request: true,
      ip_address: hashIp(ipAddress),
      deletion_type: "full_cascade",
      retention_policy: {
        audit_logs: "7_years",
        embeddings: "24_hours",
        raw_recordings: "7_days",
      },
    }),
    now
  );

  return eventId;
}

/**
 * Log data export request (GDPR Article 20)
 * @param {string} userId - User ID requesting export
 * @param {string} ipAddress - IP address of the request
 * @param {string} exportFormat - Format of export (json, csv, etc.)
 * @returns {string} Event ID for reference
 */
async function logDataExportRequest(userId, ipAddress, exportFormat = "json") {
  // SVC-16: Guard against calls before initialize()
  if (!db) throw new Error("GDPR audit service not initialized — call init() first");

  const now = new Date().toISOString();
  const eventId = generateEventId();

  await db.prepare(`
    INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at)
    VALUES (?, ?, 'DATA_EXPORT_REQUESTED', 'user', ?, ?, ?)
  `).run(
    eventId,
    userId,
    userId,
    JSON.stringify({
      gdpr_request: true,
      ip_address: hashIp(ipAddress),
      export_format: exportFormat,
    }),
    now
  );

  return eventId;
}

/**
 * Log consent changes (GDPR Article 7)
 * @param {string} userId - User ID
 * @param {string} consentType - Type of consent (voice_enrollment, marketing, etc.)
 * @param {boolean} granted - Whether consent was granted or revoked
 * @param {string} ipAddress - IP address of the request
 * @returns {string} Event ID for reference
 */
async function logConsentChange(userId, consentType, granted, ipAddress) {
  // SVC-16: Guard against calls before initialize()
  if (!db) throw new Error("GDPR audit service not initialized — call init() first");

  const now = new Date().toISOString();
  const eventId = generateEventId();

  await db.prepare(`
    INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at)
    VALUES (?, ?, ?, 'consent', ?, ?, ?)
  `).run(
    eventId,
    userId,
    granted ? "CONSENT_GRANTED" : "CONSENT_REVOKED",
    consentType,
    JSON.stringify({
      gdpr_request: true,
      ip_address: hashIp(ipAddress),
      consent_type: consentType,
      granted,
    }),
    now
  );

  return eventId;
}

module.exports = {
  initialize,
  logAccountDeletion,
  logDataExportRequest,
  logConsentChange,
};
