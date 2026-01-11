/**
 * Apple Receipt Validator Tests
 *
 * Tests JWT generation, JWS decoding, and status normalization.
 * API calls are mocked since we can't hit Apple's servers in tests.
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const {
  createAppleReceiptValidator,
  SUBSCRIPTION_STATUS,
  AUTO_RENEW_STATUS,
} = require("../src/services/apple-receipt-validator");

// Generate a valid P-256 key pair for testing
let TEST_PRIVATE_KEY;

// Generate key before tests run
const { privateKey } = crypto.generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
TEST_PRIVATE_KEY = privateKey;

describe("Apple Receipt Validator", () => {
  describe("isConfigured", () => {
    it("returns false when not configured", () => {
      const validator = createAppleReceiptValidator({});
      assert.equal(validator.isConfigured(), false);
    });

    it("returns true when all credentials provided", () => {
      const validator = createAppleReceiptValidator({
        keyId: "TESTKEY123",
        issuerId: "ISSUER-UUID",
        privateKey: TEST_PRIVATE_KEY,
        bundleId: "com.test.app",
      });
      assert.equal(validator.isConfigured(), true);
    });

    it("returns false when missing keyId", () => {
      const validator = createAppleReceiptValidator({
        issuerId: "ISSUER-UUID",
        privateKey: TEST_PRIVATE_KEY,
        bundleId: "com.test.app",
      });
      assert.equal(validator.isConfigured(), false);
    });
  });

  describe("generateJWT", () => {
    it("generates valid JWT structure", () => {
      const validator = createAppleReceiptValidator({
        keyId: "TESTKEY123",
        issuerId: "ISSUER-UUID",
        privateKey: TEST_PRIVATE_KEY,
        bundleId: "com.test.app",
      });

      const jwt = validator.generateJWT();

      // JWT should have 3 parts separated by dots
      const parts = jwt.split(".");
      assert.equal(parts.length, 3, "JWT should have 3 parts");

      // Decode and verify header
      const header = JSON.parse(base64UrlDecode(parts[0]));
      assert.equal(header.alg, "ES256");
      assert.equal(header.kid, "TESTKEY123");
      assert.equal(header.typ, "JWT");

      // Decode and verify payload
      const payload = JSON.parse(base64UrlDecode(parts[1]));
      assert.equal(payload.iss, "ISSUER-UUID");
      assert.equal(payload.aud, "appstoreconnect-v1");
      assert.equal(payload.bid, "com.test.app");
      assert.ok(payload.iat > 0, "Should have issued at timestamp");
      assert.ok(payload.exp > payload.iat, "Expiry should be after issued at");
    });

    it("throws when not configured", () => {
      const validator = createAppleReceiptValidator({});
      assert.throws(
        () => validator.generateJWT(),
        /Apple App Store credentials not configured/
      );
    });
  });

  describe("decodeJWS", () => {
    it("decodes valid JWS payload", () => {
      const validator = createAppleReceiptValidator({
        keyId: "TESTKEY123",
        issuerId: "ISSUER-UUID",
        privateKey: TEST_PRIVATE_KEY,
        bundleId: "com.test.app",
      });

      // Create a mock JWS (header.payload.signature)
      const mockPayload = {
        transactionId: "1000000123456789",
        productId: "com.porizo.plus_monthly",
        purchaseDate: 1704067200000,
      };

      const header = base64UrlEncode(JSON.stringify({ alg: "ES256" }));
      const payload = base64UrlEncode(JSON.stringify(mockPayload));
      const signature = base64UrlEncode("mock-signature");

      const jws = `${header}.${payload}.${signature}`;

      const decoded = validator.decodeJWS(jws);
      assert.deepEqual(decoded, mockPayload);
    });

    it("returns null for invalid JWS", () => {
      const validator = createAppleReceiptValidator({
        keyId: "TESTKEY123",
        issuerId: "ISSUER-UUID",
        privateKey: TEST_PRIVATE_KEY,
        bundleId: "com.test.app",
      });

      const result = validator.decodeJWS("invalid-jws");
      assert.equal(result, null);
    });
  });

  describe("SUBSCRIPTION_STATUS constants", () => {
    it("has correct status values", () => {
      assert.equal(SUBSCRIPTION_STATUS.ACTIVE, 1);
      assert.equal(SUBSCRIPTION_STATUS.EXPIRED, 2);
      assert.equal(SUBSCRIPTION_STATUS.BILLING_RETRY, 3);
      assert.equal(SUBSCRIPTION_STATUS.BILLING_GRACE_PERIOD, 4);
      assert.equal(SUBSCRIPTION_STATUS.REVOKED, 5);
    });
  });

  describe("AUTO_RENEW_STATUS constants", () => {
    it("has correct auto-renew values", () => {
      assert.equal(AUTO_RENEW_STATUS.OFF, 0);
      assert.equal(AUTO_RENEW_STATUS.ON, 1);
    });
  });
});

// Helper functions
function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padding = base64.length % 4;
  if (padding) {
    base64 += "=".repeat(4 - padding);
  }
  return Buffer.from(base64, "base64").toString("utf8");
}
