/**
 * Google Receipt Validator Tests
 *
 * Tests configuration detection, status mapping, and tier extraction.
 * API calls are mocked since we can't hit Google's servers in tests.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  createGoogleReceiptValidator,
  SUBSCRIPTION_STATE,
  ACKNOWLEDGEMENT_STATE,
  mapSubscriptionStatus,
  mapProductIdToTier,
} = require("../src/services/google-receipt-validator");

// Sample service account credentials for testing (not real)
const TEST_CREDENTIALS = {
  type: "service_account",
  project_id: "test-project",
  private_key_id: "test-key-id",
  private_key: `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHB7MvXmIc7yJgGBVdFc
WMR8yVexRVMgJpqz0FKM5dC1d9qj5YUxFp5IohSw/rJu1+fJ+V4UG0KAsXsoHTfx
VxKRGNp47i/2m/WJz/9QQ3EXYcENx7C2g8WLl/G1TpxQGHzQTLv3Ml2xHu6qjjpB
O8mxmjCR5oIbNgUe2xRj2YiGNf6bQPl+9PN8WQHQ6v3IYnB5YnfHsEVZ/QKsKE5D
xEQl1N/0e9q6wPZNzaEvXU8y6HLrNTTX8z+9LJY8wZmxZuOCPy6CPoQW5t3CxqSB
8y5aSJKS4U7qOjEdSRnLpnVlr2sgxUZQMfUvTQIDAQABAoIBAAK7nxrJTvwfkjVS
C0s5vLJL4qmJ3rxC3t3CywXsC6nBx5p+T5HKL5B+cqIjEPjPDzQUv5uNW5H8PNrV
D5VD9Hy5xhzIP9NjBnMf5hTFvsOfCsZNt9oeTPH0aFV8gXLOYDuGFx8SYPXdVmzh
j3E6a9RXBB7CTv9gQ3fXGT3N8c5zj3qpC5fhCSIi5B0kQR3j/Vp8m5vAsmSj+hLf
j3n+lDTr8LxnNFmNjsqBrEjS+xLjYPlIRF8MZj8hJGKL3aJzFGh7nZDY3bMp7P/x
lVElvYBwjLV2AQohmSLu3fhQNNL5rU/jjVJwMXWnGhJPXyYOcm3oLoEFG8p9pZpL
xHB0Q4ECgYEA7bOJsE5j5Xp+3v/Xokt1nUDnWMSp3rjxBmXNv0FxK3rCHxLQ7ghF
ZwOKZj3VKf1zqP0mwVDfXd8x7VL8FJVoRE9FwID3wHqJLz8BvKZ4xLBp+R2z8k3Y
D3bZqMEb3nqBsUeDq8Y7CZNvkpvLnyLf0aBqV3UmTl+N2y1YL3mLlYECgYEA4gRH
XQsOv9E3yKYLxqKzBxLzWE+qUbDOtQ+MnJ1cFE8tG6u9KOIFz5xV1n4lzOk6LX7j
rSBH5QP4K3t6d3QnRTN8VXP6lqC5AwB2DdLJpGqFGm2lU/MJy8D0qEvEdqhPwZv0
b3fGy1c3EJKCv0fLMTNfdFWnP4YR8WCkFQqZFd0CgYEAz2ND7Ldf9a3Vy6k7cxXq
fYFGJv3KnJT6sI0Y2u8qfYCb3zKFQ9kkz2uc9tvCk8yDPS9o9P6xGjKE6xYqG0jG
i2sDWZ6nZ3rB3tg+6DqfqKyFNKBqI+ViLB8ofZAvGVnhCFv3lVii7qO0sRxZYJ8D
nz2wB0vFT5r8nRl9qD+F4AECgYEAk7QOjLop8VT8ki1u3O9W8oPNjRLNHVsAJlVL
WQ8VxnJl0i7U3HMkV1VvVqC0pSJl9BvGkLNPsNuNF3n8QHe9EUIs4+t8qVf5Brt1
8WHJ0sVuyC7TD8v8NLAZvxPjmOcDWA7l9P7s8Pt/oFLcQKqL0EWLQ+oQkVHCMvE6
V/vpN6ECgYBKEe+1m8v3gBTDr2O+wPrLhIDk+IbAC6v8TX+ez1n0sP3nAMSF2EIs
NeUGhm+xTTJxJeqTqrlUDl2wP5sSbNDj9cK3p2m7EfHi7VaJpNgOfq+7f8jGKS1x
s3E8NPkLpn6axTvfsCf7C3qKSin4EUfVpEqDOp+jPQeCaXqGQDPvtQ==
-----END RSA PRIVATE KEY-----`,
  client_email: "test@test-project.iam.gserviceaccount.com",
  client_id: "123456789",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
};

describe("Google Receipt Validator", () => {
  describe("isConfigured", () => {
    it("returns false when not configured", () => {
      const validator = createGoogleReceiptValidator({});
      assert.equal(validator.isConfigured(), false);
    });

    it("returns true when all credentials provided", () => {
      const validator = createGoogleReceiptValidator({
        packageName: "com.test.app",
        credentials: JSON.stringify(TEST_CREDENTIALS),
      });
      assert.equal(validator.isConfigured(), true);
    });

    it("returns false when missing packageName", () => {
      const validator = createGoogleReceiptValidator({
        credentials: JSON.stringify(TEST_CREDENTIALS),
      });
      assert.equal(validator.isConfigured(), false);
    });

    it("returns false when missing credentials", () => {
      const validator = createGoogleReceiptValidator({
        packageName: "com.test.app",
      });
      assert.equal(validator.isConfigured(), false);
    });

    it("returns false when credentials are invalid JSON", () => {
      const validator = createGoogleReceiptValidator({
        packageName: "com.test.app",
        credentials: "not-valid-json",
      });
      assert.equal(validator.isConfigured(), false);
    });

    it("returns false when credentials missing required fields", () => {
      const validator = createGoogleReceiptValidator({
        packageName: "com.test.app",
        credentials: JSON.stringify({ type: "service_account" }),
      });
      assert.equal(validator.isConfigured(), false);
    });
  });

  describe("mapSubscriptionStatus", () => {
    it("maps ACTIVE state correctly", () => {
      assert.equal(
        mapSubscriptionStatus(SUBSCRIPTION_STATE.SUBSCRIPTION_STATE_ACTIVE),
        "active"
      );
    });

    it("maps IN_GRACE_PERIOD state correctly", () => {
      assert.equal(
        mapSubscriptionStatus(SUBSCRIPTION_STATE.SUBSCRIPTION_STATE_IN_GRACE_PERIOD),
        "grace_period"
      );
    });

    it("maps ON_HOLD state correctly", () => {
      assert.equal(
        mapSubscriptionStatus(SUBSCRIPTION_STATE.SUBSCRIPTION_STATE_ON_HOLD),
        "on_hold"
      );
    });

    it("maps PAUSED state correctly", () => {
      assert.equal(
        mapSubscriptionStatus(SUBSCRIPTION_STATE.SUBSCRIPTION_STATE_PAUSED),
        "paused"
      );
    });

    it("maps CANCELED state correctly", () => {
      assert.equal(
        mapSubscriptionStatus(SUBSCRIPTION_STATE.SUBSCRIPTION_STATE_CANCELED),
        "cancelled"
      );
    });

    it("maps EXPIRED state correctly", () => {
      assert.equal(
        mapSubscriptionStatus(SUBSCRIPTION_STATE.SUBSCRIPTION_STATE_EXPIRED),
        "expired"
      );
    });

    it("maps PENDING state correctly", () => {
      assert.equal(
        mapSubscriptionStatus(SUBSCRIPTION_STATE.SUBSCRIPTION_STATE_PENDING),
        "pending"
      );
    });

    it("maps unknown state to unknown", () => {
      assert.equal(mapSubscriptionStatus(999), "unknown");
    });
  });

  describe("mapProductIdToTier", () => {
    it("maps premium product IDs correctly", () => {
      assert.equal(mapProductIdToTier("com.app.premium.monthly"), "premium");
      assert.equal(mapProductIdToTier("subscription_premium_annual"), "premium");
      assert.equal(mapProductIdToTier("pro_subscription"), "premium");
    });

    it("maps basic product IDs correctly", () => {
      assert.equal(mapProductIdToTier("com.app.basic.monthly"), "basic");
      assert.equal(mapProductIdToTier("starter_subscription"), "basic");
    });

    it("returns free for unknown product IDs", () => {
      assert.equal(mapProductIdToTier("com.app.subscription"), "free");
      assert.equal(mapProductIdToTier("standard_tier"), "free");
      assert.equal(mapProductIdToTier(""), "free");
    });

    it("returns free for null/undefined", () => {
      assert.equal(mapProductIdToTier(null), "free");
      assert.equal(mapProductIdToTier(undefined), "free");
    });

    it("is case insensitive", () => {
      assert.equal(mapProductIdToTier("PREMIUM_SUBSCRIPTION"), "premium");
      assert.equal(mapProductIdToTier("Basic_Monthly"), "basic");
    });
  });

  describe("SUBSCRIPTION_STATE constants", () => {
    it("has all expected states", () => {
      assert.equal(SUBSCRIPTION_STATE.SUBSCRIPTION_STATE_UNSPECIFIED, 0);
      assert.equal(SUBSCRIPTION_STATE.SUBSCRIPTION_STATE_PENDING, 1);
      assert.equal(SUBSCRIPTION_STATE.SUBSCRIPTION_STATE_ACTIVE, 2);
      assert.equal(SUBSCRIPTION_STATE.SUBSCRIPTION_STATE_PAUSED, 3);
      assert.equal(SUBSCRIPTION_STATE.SUBSCRIPTION_STATE_IN_GRACE_PERIOD, 4);
      assert.equal(SUBSCRIPTION_STATE.SUBSCRIPTION_STATE_ON_HOLD, 5);
      assert.equal(SUBSCRIPTION_STATE.SUBSCRIPTION_STATE_CANCELED, 6);
      assert.equal(SUBSCRIPTION_STATE.SUBSCRIPTION_STATE_EXPIRED, 7);
    });
  });

  describe("ACKNOWLEDGEMENT_STATE constants", () => {
    it("has all expected states", () => {
      assert.equal(ACKNOWLEDGEMENT_STATE.ACKNOWLEDGEMENT_STATE_UNSPECIFIED, 0);
      assert.equal(ACKNOWLEDGEMENT_STATE.ACKNOWLEDGEMENT_STATE_PENDING, 1);
      assert.equal(ACKNOWLEDGEMENT_STATE.ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED, 2);
    });
  });
});
