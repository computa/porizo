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

describe("Auth API Endpoints", () => {
  let app;
  let db;
  let tmpDir;
  let dbPath;
  let storageDir;

  before(async () => {
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

  beforeEach(() => {
    // Clear rate limits before each test to prevent cross-test interference
    clearRateLimits();
  });

  function uniqueEmail() {
    return `test-${crypto.randomBytes(8).toString("hex")}@example.com`;
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
      assert.strictEqual(body.expires_in, 900);
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

    before(async () => {
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
      assert.notEqual(body.refresh_token, refreshToken, "should return new refresh token");
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
      assert.strictEqual(body.email, userEmail);
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
  });

  describe("POST /auth/logout", () => {
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
      assert.ok(body.message.includes("success") || body.message.includes("Logged out"));
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
      assert.ok(body.sessions.length >= 1, "should have at least one session from signup");
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
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should accept valid JWT format (mock)", async () => {
      // Create a mock JWT (header.payload.signature)
      const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
      const payload = Buffer.from(
        JSON.stringify({
          sub: `apple-user-${crypto.randomBytes(8).toString("hex")}`,
          email: uniqueEmail(),
        })
      ).toString("base64url");
      const signature = Buffer.from("mock-signature").toString("base64url");
      const mockToken = `${header}.${payload}.${signature}`;

      const response = await app.inject({
        method: "POST",
        url: "/auth/social",
        payload: {
          provider: "apple",
          id_token: mockToken,
          name: "Apple User",
        },
      });

      // In production, this would verify the signature. For MVP, we accept valid JWT format.
      assert.strictEqual(response.statusCode, 201);
      const body = JSON.parse(response.body);
      assert.ok(body.user_id);
      assert.ok(body.access_token);
      assert.strictEqual(body.is_new_user, true);
    });
  });
});
