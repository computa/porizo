/**
 * Auth API Endpoint Tests
 *
 * Integration tests for authentication API endpoints.
 */

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");
const { createStorageProvider } = require("../src/storage");
const { clearRateLimits } = require("../src/routes/auth");
const authService = require("../src/services/auth-service");

describe("Auth API Endpoints", () => {
  let app;
  let db;
  let tmpDir;
  let dbPath;
  let storageDir;

  before(async () => {
    // Configure social auth for test mode (no external JWKS calls).
    process.env.APPLE_CLIENT_ID =
      process.env.APPLE_CLIENT_ID || "com.porizo.app.test";
    process.env.ALLOW_MOCK_SOCIAL_AUTH = "true";

    // Create temp directories
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-auth-api-test-"));
    dbPath = path.join(tmpDir, "test.db");
    storageDir = path.join(tmpDir, "storage");
    fs.mkdirSync(storageDir, { recursive: true });

    // Initialize database
    const migrationsDir = path.join(__dirname, "..", "migrations");
    db = await initDb({ dbPath, migrationsDir });

    // Create storage provider
    const storage = createStorageProvider({
      type: "local",
      basePath: storageDir,
    });

    // Build server
    app = buildServer({
      db,
      config: {
        PORT: 0,
        HOST: "127.0.0.1",
        STORAGE_BASE_URL: "",
        UPLOAD_SIGNING_SECRET: "test-secret",
        CLEANUP_INTERVAL_MS: 0, // Disable cleanup
      },
      storage,
    });

    await app.ready();
  });

  after(async () => {
    if (app) {
      await app.close();
    }
    if (db && db.close) {
      db.close();
    }
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    // Clear rate limits before each test to prevent cross-test interference.
    // Must pass db: the AUTHORITATIVE rate-limit store is the rate_limits table,
    // not just the in-memory map. Without db, signup's 5/hour limit accumulates
    // across the file's many signups and later beforeEach signups get 429,
    // cascading into the refresh/me/logout/sessions tests (no token issued).
    await clearRateLimits(db);
  });

  function uniqueEmail() {
    return `test-${crypto.randomBytes(8).toString("hex")}@example.com`;
  }

  function sha256Hex(value) {
    return crypto.createHash("sha256").update(value, "utf8").digest("hex");
  }

  describe("POST /auth/signup", () => {
    it("should create new user account", async () => {
      const email = uniqueEmail();
      const response = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: {
          email,
          password: "SecurePassword123",
          name: "Test User",
        },
      });

      assert.strictEqual(response.statusCode, 201);
      const body = JSON.parse(response.body);
      assert.ok(body.user_id, "should return user_id");
      assert.ok(body.access_token, "should return access_token");
      assert.ok(body.refresh_token, "should return refresh_token");
      assert.strictEqual(body.expires_in, 3600);
    });

    it("should reject duplicate email", async () => {
      const email = uniqueEmail();

      // First signup
      await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: { email, password: "SecurePassword123" },
      });

      // Second signup with same email
      const response = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: { email, password: "AnotherPassword123" },
      });

      assert.strictEqual(response.statusCode, 409);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, "EMAIL_EXISTS");
    });

    it("should reject weak password", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: {
          email: uniqueEmail(),
          password: "short", // Less than 8 chars
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject invalid email format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: {
          email: "not-an-email",
          password: "SecurePassword123",
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });
  });

  describe("POST /auth/login", () => {
    let testEmail;
    const testPassword = "SecurePassword123";

    beforeEach(async () => {
      testEmail = uniqueEmail();
      await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: { email: testEmail, password: testPassword },
      });
    });

    it("should login with valid credentials", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: {
          email: testEmail,
          password: testPassword,
        },
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(body.user_id);
      assert.ok(body.access_token);
      assert.ok(body.refresh_token);
    });

    it("should reject invalid password", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: {
          email: testEmail,
          password: "WrongPassword123",
        },
      });

      assert.strictEqual(response.statusCode, 401);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, "INVALID_CREDENTIALS");
    });

    it("should reject non-existent email", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: {
          email: "nonexistent@example.com",
          password: "SomePassword123",
        },
      });

      assert.strictEqual(response.statusCode, 401);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, "INVALID_CREDENTIALS");
    });
  });

  describe("POST /auth/refresh", () => {
    let refreshToken;

    beforeEach(async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: {
          email: uniqueEmail(),
          password: "SecurePassword123",
        },
      });
      const body = JSON.parse(response.body);
      refreshToken = body.refresh_token;
    });

    it("should refresh tokens", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refresh_token: refreshToken },
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(body.access_token);
      assert.ok(body.refresh_token);
      assert.notEqual(
        body.refresh_token,
        refreshToken,
        "should return new refresh token",
      );
    });

    it("should reject used refresh token (rotation)", async () => {
      // First refresh
      const firstResponse = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refresh_token: refreshToken },
      });

      // Try to use original token again (should fail - already rotated)
      const response = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refresh_token: refreshToken },
      });

      assert.strictEqual(response.statusCode, 401);
    });

    it("should reject invalid refresh token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refresh_token: "invalid-token" },
      });

      assert.strictEqual(response.statusCode, 401);
    });

    it("should reject legacy refresh tokens without a bound session", async () => {
      const userId = `user_legacy_${crypto.randomBytes(4).toString("hex")}`;
      db.prepare(
        "INSERT INTO users (id, created_at, risk_level) VALUES (?, datetime('now'), 'low')",
      ).run(userId);
      const { token } = await authService.createRefreshToken(userId);

      const response = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refresh_token: token },
      });

      assert.strictEqual(response.statusCode, 401);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, "SESSION_EXPIRED");
    });
  });

  describe("GET /auth/me", () => {
    let accessToken;
    let userEmail;

    before(async () => {
      userEmail = uniqueEmail();
      const response = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: {
          email: userEmail,
          password: "SecurePassword123",
          name: "Test User",
        },
      });
      const body = JSON.parse(response.body);
      accessToken = body.access_token;
    });

    it("should return current user info", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      // /auth/me surfaces the email via primary_email (incl. unverified signup
      // contacts); there is no top-level `email` field in the identity-model
      // response.
      assert.strictEqual(body.primary_email, userEmail);
      assert.strictEqual(body.display_name, "Test User");
      assert.ok(Array.isArray(body.providers));
      assert.ok(body.providers.includes("email"));
    });

    it("should reject missing authorization", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/me",
      });

      assert.strictEqual(response.statusCode, 401);
    });

    it("should reject invalid token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: {
          Authorization: "Bearer invalid-token",
        },
      });

      assert.strictEqual(response.statusCode, 401);
    });

    it("should reject access tokens without a bound session id", async () => {
      const userId = `user_sidless_${crypto.randomBytes(4).toString("hex")}`;
      db.prepare(
        "INSERT INTO users (id, created_at, risk_level) VALUES (?, datetime('now'), 'low')",
      ).run(userId);
      const sidlessToken = authService.generateAccessToken(userId);

      const response = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: {
          Authorization: `Bearer ${sidlessToken}`,
        },
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("POST /auth/logout", () => {
    let accessToken;
    let refreshToken;
    let sessionId;

    before(async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: {
          email: uniqueEmail(),
          password: "SecurePassword123",
        },
      });
      const body = JSON.parse(response.body);
      accessToken = body.access_token;
      refreshToken = body.refresh_token;

      const sessionsResponse = await app.inject({
        method: "GET",
        url: "/auth/sessions",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      sessionId = JSON.parse(sessionsResponse.body).sessions[0].id;
    });

    it("should logout successfully", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/logout",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(
        body.message.includes("success") || body.message.includes("Logged out"),
      );
    });

    it("should succeed even with invalid token", async () => {
      // Logout should always succeed (user wants to logout)
      const response = await app.inject({
        method: "POST",
        url: "/auth/logout",
        headers: {
          Authorization: "Bearer invalid-token",
        },
      });

      assert.strictEqual(response.statusCode, 200);
    });

    it("should invalidate the current session access and refresh tokens", async () => {
      const logoutResponse = await app.inject({
        method: "POST",
        url: "/auth/logout",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      assert.strictEqual(logoutResponse.statusCode, 200);

      const meResponse = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      assert.strictEqual(meResponse.statusCode, 401);

      const refreshResponse = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refresh_token: refreshToken },
      });
      assert.strictEqual(refreshResponse.statusCode, 401);

      const session = db
        .prepare("SELECT revoked_at FROM user_sessions WHERE id = ?")
        .get(sessionId);
      assert.ok(session.revoked_at, "logout should revoke the backing session");
    });
  });

  describe("POST /auth/forgot-password", () => {
    it("should always return success (prevent enumeration)", async () => {
      // With existing email
      const response1 = await app.inject({
        method: "POST",
        url: "/auth/forgot-password",
        payload: { email: "nonexistent@example.com" },
      });

      assert.strictEqual(response1.statusCode, 200);
      const body = JSON.parse(response1.body);
      assert.ok(body.message);
    });
  });

  describe("GET /auth/sessions", () => {
    let accessToken;

    before(async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: {
          email: uniqueEmail(),
          password: "SecurePassword123",
        },
      });
      const body = JSON.parse(response.body);
      accessToken = body.access_token;
    });

    it("should list user sessions", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/sessions",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body.sessions));
      assert.ok(
        body.sessions.length >= 1,
        "should have at least one session from signup",
      );
    });
  });

  describe("DELETE /auth/sessions/:id", () => {
    let accessToken;
    let sessionId;

    before(async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: {
          email: uniqueEmail(),
          password: "SecurePassword123",
        },
      });
      const body = JSON.parse(response.body);
      accessToken = body.access_token;

      // Get session ID
      const sessionsResponse = await app.inject({
        method: "GET",
        url: "/auth/sessions",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const sessionsBody = JSON.parse(sessionsResponse.body);
      sessionId = sessionsBody.sessions[0].id;
    });

    it("should revoke session", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/auth/sessions/${sessionId}`,
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      assert.strictEqual(response.statusCode, 200);
    });

    it("should invalidate revoked session credentials", async () => {
      const loginResponse = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: {
          email: uniqueEmail(),
          password: "SecurePassword123",
        },
      });
      const loginBody = JSON.parse(loginResponse.body);
      const currentAccessToken = loginBody.access_token;
      const currentRefreshToken = loginBody.refresh_token;

      const sessionsResponse = await app.inject({
        method: "GET",
        url: "/auth/sessions",
        headers: { Authorization: `Bearer ${currentAccessToken}` },
      });
      const currentSessionId = JSON.parse(sessionsResponse.body).sessions[0].id;

      const revokeResponse = await app.inject({
        method: "DELETE",
        url: `/auth/sessions/${currentSessionId}`,
        headers: {
          Authorization: `Bearer ${currentAccessToken}`,
        },
      });
      assert.strictEqual(revokeResponse.statusCode, 200);

      const meResponse = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: {
          Authorization: `Bearer ${currentAccessToken}`,
        },
      });
      assert.strictEqual(meResponse.statusCode, 401);

      const refreshResponse = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refresh_token: currentRefreshToken },
      });
      assert.strictEqual(refreshResponse.statusCode, 401);
      const refreshBody = JSON.parse(refreshResponse.body);
      assert.strictEqual(refreshBody.error, "SESSION_REVOKED");
    });

    it("should reject non-existent session", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/auth/sessions/nonexistent-session-id",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      assert.strictEqual(response.statusCode, 404);
    });
  });

  describe("POST /auth/social", () => {
    it("should reject invalid token format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/social",
        payload: {
          provider: "apple",
          id_token: "not-a-jwt",
          nonce: "test-nonce-invalid-format",
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should accept valid JWT format (mock)", async () => {
      // Create a mock JWT (header.payload.signature)
      const header = Buffer.from(
        JSON.stringify({ alg: "RS256", typ: "JWT" }),
      ).toString("base64url");
      const rawNonce = `nonce-${crypto.randomBytes(8).toString("hex")}`;
      const payload = Buffer.from(
        JSON.stringify({
          sub: `apple-user-${crypto.randomBytes(8).toString("hex")}`,
          email: uniqueEmail(),
          email_verified: true,
          iss: "https://appleid.apple.com",
          aud: process.env.APPLE_CLIENT_ID,
          nonce: sha256Hex(rawNonce),
        }),
      ).toString("base64url");
      const signature = Buffer.from("mock-signature").toString("base64url");
      const mockToken = `${header}.${payload}.${signature}`;

      const response = await app.inject({
        method: "POST",
        url: "/auth/social",
        payload: {
          provider: "apple",
          id_token: mockToken,
          nonce: rawNonce,
          name: "Apple User",
        },
      });

      // In production, this would verify the signature. In tests, we bypass JWKS
      // but still validate critical claims (audience, issuer, nonce, subject).
      assert.strictEqual(response.statusCode, 201);
      const body = JSON.parse(response.body);
      assert.ok(body.user_id);
      assert.ok(body.access_token);
      assert.strictEqual(body.is_new_user, true);
    });
  });

  describe("Email verification token binding", () => {
    it("should invalidate an old verification token when the pending email changes", async () => {
      const signupEmail = uniqueEmail();
      const signupResponse = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: {
          email: signupEmail,
          password: "SecurePassword123",
          name: "Ambrose",
        },
      });
      assert.strictEqual(signupResponse.statusCode, 201);
      const signupBody = JSON.parse(signupResponse.body);
      const accessToken = signupBody.access_token;
      const userId = signupBody.user_id;

      const rawToken = `verify-${crypto.randomBytes(12).toString("hex")}`;
      db.prepare(
        `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, email_normalized)
         VALUES (?, ?, ?, datetime('now', '+1 day'), ?)`,
      ).run(
        `evt_test_${crypto.randomBytes(4).toString("hex")}`,
        userId,
        sha256Hex(rawToken),
        signupEmail.toLowerCase(),
      );

      const newEmail = uniqueEmail();
      const profileResponse = await app.inject({
        method: "PATCH",
        url: "/auth/profile",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        payload: {
          // PATCH /auth/profile takes contact_email (identity-model field), not email.
          contact_email: newEmail,
        },
      });
      assert.strictEqual(profileResponse.statusCode, 200);

      const verifyResponse = await app.inject({
        method: "POST",
        url: "/auth/verify-email",
        payload: {
          token: rawToken,
        },
      });
      assert.strictEqual(verifyResponse.statusCode, 400);

      const contacts = db
        .prepare(
          "SELECT value_normalized, verified_at FROM user_contacts WHERE user_id = ? AND type = 'email' ORDER BY created_at ASC",
        )
        .all(userId);
      const oldContact = contacts.find(
        (contact) => contact.value_normalized === signupEmail.toLowerCase(),
      );
      const updatedContact = contacts.find(
        (contact) => contact.value_normalized === newEmail.toLowerCase(),
      );

      // The original signup email is an UNVERIFIED contact (signup never verifies
      // it; the old token here is intentionally invalidated -> 400). Changing the
      // pending email must not delete it — it should still exist, unverified.
      assert.ok(oldContact, "original signup email contact should still exist");
      assert.strictEqual(
        oldContact.verified_at,
        null,
        "original signup email stays unverified (it was never verified)",
      );
      assert.ok(updatedContact, "new pending email contact should exist");
      assert.strictEqual(
        updatedContact.verified_at,
        null,
        "new pending email must remain unverified",
      );
    });

    it("should reject resend verification when no pending email contact exists even if users.email remains populated", async () => {
      const signupEmail = uniqueEmail();
      const signupResponse = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: {
          email: signupEmail,
          password: "SecurePassword123",
          name: "Contactless User",
        },
      });
      assert.strictEqual(signupResponse.statusCode, 201);
      const { access_token: accessToken, user_id: userId } = JSON.parse(
        signupResponse.body,
      );

      db.prepare(
        "DELETE FROM user_contacts WHERE user_id = ? AND type = 'email'",
      ).run(userId);
      db.prepare(
        "UPDATE users SET email = ?, email_verified = 0 WHERE id = ?",
      ).run(signupEmail.toLowerCase(), userId);

      const resendResponse = await app.inject({
        method: "POST",
        url: "/auth/email/resend-verification",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      assert.strictEqual(resendResponse.statusCode, 400);
      const body = JSON.parse(resendResponse.body);
      assert.strictEqual(body.error, "NO_PENDING_VERIFICATION");
    });
  });
});
