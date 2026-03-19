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

module.exports = {
  newUuid,
  newShareId,
  generatePrefixedId,
};
