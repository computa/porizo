process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-registration-country-0123456789abcdef";
process.env.APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID || "com.porizo.app.test";
process.env.ALLOW_MOCK_SOCIAL_AUTH = "true";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function uniqueEmail() {
  return `country-${crypto.randomBytes(8).toString("hex")}@example.com`;
}

function buildMockAppleToken({ sub, email, nonce }) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub,
    email,
    email_verified: true,
    iss: "https://appleid.apple.com",
    aud: process.env.APPLE_CLIENT_ID,
    nonce: sha256Hex(nonce),
  })).toString("base64url");
  const signature = Buffer.from("mock-signature").toString("base64url");
  return `${header}.${payload}.${signature}`;
}

async function seedPhoneVerification(db, phoneNumber, code = "123456") {
  await db.prepare(
    `INSERT INTO phone_verifications (id, phone_number, code, code_hash, expires_at, attempts)
     VALUES (?, ?, ?, ?, ?, 0)`
  ).run(
    `pv_${crypto.randomBytes(8).toString("hex")}`,
    phoneNumber,
    code,
    sha256Hex(code),
    new Date(Date.now() + 10 * 60 * 1000).toISOString()
  );
}

describe("registration country capture", () => {
  let db;
  let app;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildServer({
      db,
      config: {
        STORAGE_DIR: "/tmp/test-storage",
        PUBLIC_BASE_URL: "http://public.local",
        STREAM_BASE_URL: "http://stream.local",
        ALLOW_ANON_USER_ID: true,
      },
      storage: {
        put: async () => {},
        get: async () => null,
        exists: async () => false,
        delete: async () => {},
        getSignedUrl: async (key) => `http://localhost/${key}`,
      },
    });
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("captures explicit locale and country on Apple social registration", async () => {
    const nonce = `nonce-${crypto.randomBytes(8).toString("hex")}`;
    const token = buildMockAppleToken({
      sub: `apple-country-${crypto.randomBytes(8).toString("hex")}`,
      email: uniqueEmail(),
      nonce,
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/social",
      payload: {
        provider: "apple",
        id_token: token,
        nonce,
        name: "Country User",
        locale: "en-AU",
        country: "au",
      },
    });

    assert.equal(response.statusCode, 201, response.body);
    const body = response.json();
    const user = await db.prepare("SELECT locale, country FROM users WHERE id = ?").get(body.user_id);
    assert.equal(user.locale, "en-AU");
    assert.equal(user.country, "AU");
  });

  test("captures explicit locale and country on phone registration", async () => {
    const phoneNumber = `+614${String(crypto.randomInt(0, 10 ** 8)).padStart(8, "0")}`;
    const code = "123456";
    await seedPhoneVerification(db, phoneNumber, code);

    const verifyResponse = await app.inject({
      method: "POST",
      url: "/auth/phone/verify",
      payload: { phone_number: phoneNumber, code },
    });
    assert.equal(verifyResponse.statusCode, 200, verifyResponse.body);
    const registrationToken = verifyResponse.json().registration_token;
    assert.ok(registrationToken);

    const registerResponse = await app.inject({
      method: "POST",
      url: "/auth/phone/register",
      payload: {
        registration_token: registrationToken,
        phone_number: phoneNumber,
        name: "Phone Country User",
        locale: "en-AU",
        country: "au",
      },
    });

    assert.equal(registerResponse.statusCode, 201, registerResponse.body);
    const user = await db.prepare("SELECT locale, country FROM users WHERE id = ?").get(registerResponse.json().user_id);
    assert.equal(user.locale, "en-AU");
    assert.equal(user.country, "AU");
  });
});
