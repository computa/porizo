/**
 * Common utility functions shared across the application.
 * Consolidates duplicated helpers from server.js, runner.js, and providers.
 */

const fs = require("fs");
const path = require("path");

/**
 * Create a directory and all parent directories if they don't exist.
 * Safe to call multiple times on the same path.
 *
 * @param {string} dirPath - Directory path to create
 */
function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Parse JSON safely with fallback and optional error logging.
 *
 * @param {string|null|undefined} value - JSON string to parse
 * @param {*} fallback - Value to return if parsing fails or value is empty
 * @param {string} [context="unknown"] - Description for error logging
 * @param {Object} [options={}] - Options
 * @param {boolean} [options.required=false] - If true, throw on empty/invalid value
 * @returns {*} Parsed value or fallback
 * @throws {Error} If required=true and value is empty or invalid
 */
function parseJson(value, fallback, context = "unknown", { required = false } = {}) {
  if (!value) {
    if (required) {
      throw new Error(`E501_PARSE_ERROR: ${context} is required but was empty`);
    }
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch (err) {
    console.error(
      `[parseJson] Failed to parse JSON for ${context}:`,
      err.message,
      "Value prefix:",
      String(value).slice(0, 100)
    );
    if (required) {
      throw new Error(`E501_PARSE_ERROR: Failed to parse ${context}: ${err.message}`);
    }
    return fallback;
  }
}

/**
 * Serialize value to JSON, returning null for undefined.
 * Prevents "undefined" string in database columns.
 *
 * @param {*} value - Value to serialize
 * @returns {string|null} JSON string or null
 */
function toJson(value) {
  if (value === undefined) {
    return null;
  }
  return JSON.stringify(value);
}

/**
 * Build the storage path for a track version's files.
 *
 * @param {string} storageDir - Base storage directory
 * @param {Object} track - Track object with user_id and id
 * @param {Object} trackVersion - Track version with version_num
 * @returns {string} Full path to version directory
 */
const SAFE_ID_RE = /^[a-zA-Z0-9._-]+$/;

function getVersionDir(storageDir, track, trackVersion) {
  if (!SAFE_ID_RE.test(track.user_id) || !SAFE_ID_RE.test(track.id)) {
    throw new Error("[SecurityGuard:PathTraversal] Invalid ID format in path construction");
  }
  return path.join(
    storageDir,
    "tracks",
    track.user_id,
    track.id,
    `v${trackVersion.version_num}`
  );
}

/**
 * Get current timestamp in ISO 8601 format.
 *
 * @returns {string} ISO timestamp (e.g., "2024-01-15T10:30:00.000Z")
 */
function nowIso() {
  return new Date().toISOString();
}

/**
 * Clamp a value to [min, max], returning fallback if value is not a finite number.
 */
function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numeric));
}

module.exports = {
  ensureDir,
  parseJson,
  toJson,
  getVersionDir,
  nowIso,
  clampNumber,
};
