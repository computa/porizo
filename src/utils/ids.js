const crypto = require("crypto");

function newUuid() {
  return crypto.randomUUID();
}

function newShareId() {
  return crypto.randomBytes(9).toString("base64url");
}

function generatePrefixedId(prefix, bytes = 8) {
  return `${prefix}_${crypto.randomBytes(bytes).toString("hex")}`;
}

/**
 * Generate a prefixed ID with 12 random bytes (24 hex chars).
 * Used for auth providers, contacts, sessions, etc.
 * Equivalent to the former inline generateId() in service files.
 */
function generateId(prefix) {
  return generatePrefixedId(prefix, 12);
}

module.exports = {
  newUuid,
  newShareId,
  generatePrefixedId,
  generateId,
};
