"use strict";

process.env.NODE_ENV = "test";

const { afterEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  decryptValue,
  encryptValue,
  lookupHashes,
} = require("../../src/services/etsy-secrets");

const ORIGINAL_ENV = {
  key: process.env.ETSY_DATA_ENCRYPTION_KEY,
  keyId: process.env.ETSY_DATA_ENCRYPTION_KEY_ID,
  keyring: process.env.ETSY_DATA_ENCRYPTION_KEYRING,
};

afterEach(() => {
  if (ORIGINAL_ENV.key === undefined) delete process.env.ETSY_DATA_ENCRYPTION_KEY;
  else process.env.ETSY_DATA_ENCRYPTION_KEY = ORIGINAL_ENV.key;
  if (ORIGINAL_ENV.keyId === undefined) delete process.env.ETSY_DATA_ENCRYPTION_KEY_ID;
  else process.env.ETSY_DATA_ENCRYPTION_KEY_ID = ORIGINAL_ENV.keyId;
  if (ORIGINAL_ENV.keyring === undefined) {
    delete process.env.ETSY_DATA_ENCRYPTION_KEYRING;
  } else {
    process.env.ETSY_DATA_ENCRYPTION_KEYRING = ORIGINAL_ENV.keyring;
  }
});

describe("Etsy encrypted-data key rotation", () => {
  it("decrypts old envelopes and finds old lookup hashes after rotation", () => {
    process.env.ETSY_DATA_ENCRYPTION_KEY_ID = "etsy-2026-01";
    process.env.ETSY_DATA_ENCRYPTION_KEY =
      "old-etsy-key-material-that-is-at-least-32-bytes";
    delete process.env.ETSY_DATA_ENCRYPTION_KEYRING;
    const oldEnvelope = encryptValue("buyer@example.com");
    const [oldHash] = lookupHashes("buyer@example.com");

    process.env.ETSY_DATA_ENCRYPTION_KEY_ID = "etsy-2026-07";
    process.env.ETSY_DATA_ENCRYPTION_KEY =
      "new-etsy-key-material-that-is-at-least-32-bytes";
    process.env.ETSY_DATA_ENCRYPTION_KEYRING = JSON.stringify({
      "etsy-2026-01": "old-etsy-key-material-that-is-at-least-32-bytes",
    });

    assert.equal(decryptValue(oldEnvelope), "buyer@example.com");
    assert.ok(lookupHashes("buyer@example.com").includes(oldHash));
    assert.match(encryptValue("new@example.com"), /etsy-2026-07/);
  });
});
