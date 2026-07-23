"use strict";

const crypto = require("node:crypto");

function currentKeyId() {
  return process.env.ETSY_DATA_ENCRYPTION_KEY_ID || "etsy-v2";
}

function previousKeys() {
  const raw = process.env.ETSY_DATA_ENCRYPTION_KEYRING;
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("ETSY_DATA_ENCRYPTION_KEYRING_INVALID");
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("ETSY_DATA_ENCRYPTION_KEYRING_INVALID");
  }
  return parsed;
}

function keyMaterial(keyId = currentKeyId()) {
  const isCurrent = keyId === currentKeyId();
  const value =
    isCurrent
      ? process.env.ETSY_DATA_ENCRYPTION_KEY
      : previousKeys()[keyId];
  if (!isCurrent && !value) {
    throw new Error("ETSY_DATA_ENCRYPTION_KEY_ID_UNKNOWN");
  }
  if ((!value || String(value).length < 32) && process.env.NODE_ENV !== "test") {
    const error = new Error("ETSY_DATA_ENCRYPTION_KEY_REQUIRED");
    error.code = "ETSY_DATA_ENCRYPTION_KEY_REQUIRED";
    throw error;
  }
  return Buffer.from(String(value || "test-etsy-data-key-at-least-32-bytes"), "utf8");
}

function derivedKey(purpose, keyId = currentKeyId()) {
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      keyMaterial(keyId),
      Buffer.from("porizo-etsy-v2", "utf8"),
      Buffer.from(purpose, "utf8"),
      32,
    ),
  );
}

function lookupHash(value) {
  return crypto
    .createHmac("sha256", derivedKey("lookup"))
    .update(String(value || "").trim().toLowerCase(), "utf8")
    .digest("hex");
}

function lookupHashes(value) {
  const keyIds = [currentKeyId(), ...Object.keys(previousKeys())];
  return [...new Set(
    keyIds.map((keyId) =>
      crypto
        .createHmac("sha256", derivedKey("lookup", keyId))
        .update(String(value || "").trim().toLowerCase(), "utf8")
        .digest("hex"),
    ),
  )];
}

function encryptValue(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    derivedKey("encryption"),
    iv,
  );
  const ciphertext = Buffer.concat([
    cipher.update(String(value), "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    v: 2,
    kid: currentKeyId(),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  });
}

function decryptValue(value) {
  if (!value) return null;
  const envelope = typeof value === "string" ? JSON.parse(value) : value;
  if (envelope?.v !== 2 || !envelope?.kid) {
    throw new Error("INVALID_ETSY_ENCRYPTED_VALUE");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    derivedKey("encryption", envelope.kid),
    Buffer.from(envelope.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

module.exports = {
  currentKeyId,
  lookupHash,
  lookupHashes,
  encryptValue,
  decryptValue,
};
