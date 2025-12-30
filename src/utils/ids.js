const crypto = require("crypto");

function newUuid() {
  return crypto.randomUUID();
}

function newShareId() {
  return crypto.randomBytes(9).toString("base64url");
}

module.exports = {
  newUuid,
  newShareId,
};
