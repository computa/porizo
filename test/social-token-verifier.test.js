process.env.NODE_ENV = "test";
process.env.ALLOW_MOCK_SOCIAL_AUTH = "true";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { afterEach, describe, test } = require("node:test");

const {
  verifyGoogleToken,
  getGoogleClientIdsFromEnv,
} = require("../src/services/social-token-verifier");

function mockJwt(payload) {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = Buffer.from("mock-signature").toString("base64url");
  return `${header}.${body}.${signature}`;
}

describe("social-token-verifier Google support", () => {
  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_IDS;
  });

  test("parses comma-separated Google client ids", () => {
    process.env.GOOGLE_CLIENT_IDS = "android-client, ios-client , web-client";
    assert.deepEqual(getGoogleClientIdsFromEnv(), [
      "android-client",
      "ios-client",
      "web-client",
    ]);
  });

  test("combines rollout Google client ids with the legacy single client id", () => {
    process.env.GOOGLE_CLIENT_IDS = "android-client,web-client";
    process.env.GOOGLE_CLIENT_ID = "web-client";
    assert.deepEqual(getGoogleClientIdsFromEnv(), [
      "android-client",
      "web-client",
    ]);
  });

  test("accepts any configured Google audience", async () => {
    process.env.GOOGLE_CLIENT_IDS = "android-client,web-client";
    const token = mockJwt({
      iss: "https://accounts.google.com",
      aud: "web-client",
      sub: `google-user-${crypto.randomBytes(4).toString("hex")}`,
      email: "google@example.com",
      email_verified: true,
    });

    const verified = await verifyGoogleToken(token);

    assert.equal(verified.email, "google@example.com");
    assert.equal(verified.emailVerified, true);
  });

  test("verifies raw Google nonce when provided", async () => {
    process.env.GOOGLE_CLIENT_ID = "android-client";
    const token = mockJwt({
      iss: "accounts.google.com",
      aud: "android-client",
      sub: "google-nonce-user",
      nonce: "server-nonce",
    });

    const verified = await verifyGoogleToken(token, { rawNonce: "server-nonce" });
    assert.equal(verified.nonceVerified, true);

    await assert.rejects(
      () => verifyGoogleToken(token, { rawNonce: "other-nonce" }),
      /INVALID_NONCE/,
    );
  });
});
