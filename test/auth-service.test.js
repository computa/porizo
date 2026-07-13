/**
 * Auth Service Tests
 *
 * Tests for authentication service: password hashing, JWT tokens,
 * password reset tokens, and email verification tokens.
 */

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { initDb } = require("../src/db");
const { createLocalStorage } = require("../src/storage/local");

// Generate unique test user ID
function uniqueUserId(prefix = "user") {
  return `${prefix}-${crypto.randomBytes(8).toString("hex")}`;
}

// Import auth service (will be created)
const authService = require("../src/services/auth-service");

describe("Auth Service", () => {
  let db;
  let dbPath;
  let tmpDir;

  before(async () => {
    // Create temp db file
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-auth-svc-test-"));
    dbPath = path.join(tmpDir, "test.db");

    // Initialize db with migrations
    const migrationsDir = path.join(__dirname, "..", "migrations");
    db = await initDb({ dbPath, migrationsDir });

    // Initialize auth service with db
    authService.initialize(db);
  });

  after(async () => {
    if (db && db.close) {
      db.close();
    }
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("Password Hashing", () => {
    it("should hash password with bcrypt", async () => {
      const password = "SecureP@ssword123";
      const hash = await authService.hashPassword(password);

      assert.ok(hash, "should return a hash");
      assert.ok(hash.startsWith("$2"), "hash should be bcrypt format");
      assert.notEqual(hash, password, "hash should differ from password");
    });

    it("should verify correct password", async () => {
      const password = "SecureP@ssword123";
      const hash = await authService.hashPassword(password);

      const isValid = await authService.verifyPassword(password, hash);
      assert.strictEqual(isValid, true, "should verify correct password");
    });

    it("should reject incorrect password", async () => {
      const password = "SecureP@ssword123";
      const hash = await authService.hashPassword(password);

      const isValid = await authService.verifyPassword("wrongpassword", hash);
      assert.strictEqual(isValid, false, "should reject incorrect password");
    });

    it("should use constant-time comparison (timing attack prevention)", async () => {
      // This test verifies behavior exists, not actual timing
      // In production, bcrypt.compare is inherently constant-time
      const hash = await authService.hashPassword("password123");
      const result = await authService.verifyPassword("wrong", hash);
      assert.strictEqual(result, false);
    });
  });

  describe("JWT Access Tokens", () => {
    it("should generate access token with userId", () => {
      const userId = "user-123";
      const token = authService.generateAccessToken(userId);

      assert.ok(token, "should return a token");
      assert.ok(token.split(".").length === 3, "should be valid JWT format");
    });

    it("should verify valid access token", () => {
      const userId = "user-456";
      const token = authService.generateAccessToken(userId);

      const payload = authService.verifyAccessToken(token);
      assert.strictEqual(payload.sub, userId, "should have correct userId");
      assert.ok(payload.exp, "should have expiration");
      assert.ok(payload.iat, "should have issued at");
    });

    it("should include session id when provided", () => {
      const token = authService.generateAccessToken("user-sid", {
        sessionId: "sess-123",
      });
      const payload = authService.verifyAccessToken(token);

      assert.strictEqual(payload.sub, "user-sid");
      assert.strictEqual(payload.sid, "sess-123");
    });

    it("should reject expired token", async () => {
      // Generate token with very short expiry for testing
      const token = authService.generateAccessToken("user-789", {
        expiresIn: "1ms",
      });

      // Wait for expiry
      await new Promise((r) => setTimeout(r, 10));

      assert.throws(() => {
        authService.verifyAccessToken(token);
      }, /expired|invalid/i);
    });

    it("should reject invalid token", () => {
      assert.throws(() => {
        authService.verifyAccessToken("invalid.token.here");
      }, /invalid/i);
    });

    it("should reject tampered token", () => {
      const token = authService.generateAccessToken("user-111");
      const parts = token.split(".");
      parts[1] = Buffer.from(JSON.stringify({ sub: "hacked" })).toString(
        "base64url",
      );
      const tamperedToken = parts.join(".");

      assert.throws(() => {
        authService.verifyAccessToken(tamperedToken);
      }, /invalid signature/i);
    });
  });

  describe("Refresh Tokens", () => {
    let testUserId;

    beforeEach(() => {
      testUserId = uniqueUserId("user-rt");
      // Create test user
      db.prepare(
        "INSERT INTO users (id, created_at, risk_level) VALUES (?, datetime('now'), 'low')",
      ).run(testUserId);
    });

    it("should create refresh token and store hashed in DB", async () => {
      const { token, tokenId, expiresAt } =
        await authService.createRefreshToken(testUserId);

      assert.ok(token, "should return raw token");
      assert.ok(tokenId, "should return token ID");
      assert.ok(expiresAt, "should return expiration");

      // Verify stored in DB as hash
      const stored = db
        .prepare("SELECT * FROM refresh_tokens WHERE id = ?")
        .get(tokenId);
      assert.ok(stored, "should be stored in DB");
      assert.notEqual(
        stored.token_hash,
        token,
        "should store hash, not raw token",
      );
      assert.strictEqual(stored.user_id, testUserId);
    });

    it("should bind refresh token family to session when provided", async () => {
      const session = await authService.createSession(testUserId, {
        deviceName: "Test iPhone",
      });
      const { tokenFamily } = await authService.createRefreshToken(testUserId, {
        sessionId: session.id,
      });

      const family = db
        .prepare("SELECT session_id FROM token_families WHERE id = ?")
        .get(tokenFamily);
      assert.strictEqual(family.session_id, session.id);
    });

    it("should verify valid refresh token", async () => {
      const session = await authService.createSession(testUserId, {
        deviceName: "Test Device",
      });
      const { token } = await authService.createRefreshToken(testUserId, {
        sessionId: session.id,
      });

      const result = await authService.verifyRefreshToken(token);
      assert.strictEqual(result.userId, testUserId);
      assert.ok(result.tokenId, "should return token ID");
      assert.ok(result.tokenFamily, "should return token family");
      assert.strictEqual(
        result.sessionId,
        session.id,
        "should return bound session ID",
      );
    });

    it("should reject refresh tokens without a bound session", async () => {
      const { token } = await authService.createRefreshToken(testUserId);

      await assert.rejects(
        async () => {
          await authService.verifyRefreshToken(token);
        },
        (error) => error?.code === "SESSION_BINDING_REQUIRED",
      );
    });

    it("should reject invalid refresh token", async () => {
      await assert.rejects(async () => {
        await authService.verifyRefreshToken("invalid-token");
      }, /invalid|not found/i);
    });

    it("should reject revoked refresh token", async () => {
      // Bind a session: verifyRefreshToken checks session binding first, so a
      // token created without one fails as "session binding missing" before the
      // revoked check is ever reached.
      const session = await authService.createSession(testUserId, {
        deviceName: "Revoke Device",
      });
      const { token, tokenId } = await authService.createRefreshToken(
        testUserId,
        { sessionId: session.id },
      );

      // Revoke the token
      await authService.revokeRefreshToken(tokenId);

      await assert.rejects(async () => {
        await authService.verifyRefreshToken(token);
      }, /revoked/i);
    });

    it("should reject expired refresh token", async () => {
      // Bind a session (see revoked test) then create a token with past expiry.
      const session = await authService.createSession(testUserId, {
        deviceName: "Expire Device",
      });
      const { token } = await authService.createRefreshToken(testUserId, {
        expiresIn: -1,
        sessionId: session.id,
      });

      await assert.rejects(async () => {
        await authService.verifyRefreshToken(token);
      }, /expired/i);
    });

    it("should rotate refresh token (generate new, revoke old)", async () => {
      const session = await authService.createSession(testUserId, {
        deviceName: "Rotate Device",
      });
      const {
        token: oldToken,
        tokenId: oldTokenId,
        tokenFamily,
      } = await authService.createRefreshToken(testUserId, {
        sessionId: session.id,
      });

      // Rotate the token
      const {
        token: newToken,
        tokenId: newTokenId,
        tokenFamily: newFamily,
      } = await authService.rotateRefreshToken(oldToken);

      assert.notEqual(newToken, oldToken, "new token should differ");
      assert.strictEqual(
        newFamily,
        tokenFamily,
        "should keep same token family",
      );
      const rotated = await authService.verifyRefreshToken(newToken);
      assert.strictEqual(
        rotated.userId,
        testUserId,
        "rotated token should keep the same user",
      );

      // Old token should be revoked
      await assert.rejects(async () => {
        await authService.verifyRefreshToken(oldToken);
      }, /revoked/i);

      // New token should work
      const result = await authService.rotateRefreshToken(newToken);
      assert.strictEqual(
        result.userId,
        testUserId,
        "rotation result must include userId for access token minting",
      );
    });

    it("should reject rotation for refresh token families without a bound session", async () => {
      const { token } = await authService.createRefreshToken(testUserId);

      await assert.rejects(
        async () => {
          await authService.rotateRefreshToken(token);
        },
        (error) => error?.code === "SESSION_BINDING_REQUIRED",
      );
    });

    it("should detect token reuse attack and revoke entire family", async () => {
      // Create initial token
      const session = await authService.createSession(testUserId, {
        deviceName: "Reuse Device",
      });
      const { token: token1, tokenFamily } =
        await authService.createRefreshToken(testUserId, {
          sessionId: session.id,
        });

      // Rotate to get token2
      const { token: token2 } = await authService.rotateRefreshToken(token1);

      // Attacker tries to reuse token1 (already rotated)
      let reuseError = null;
      await assert.rejects(
        async () => {
          await authService.rotateRefreshToken(token1);
        },
        (err) => {
          reuseError = err;
          return /reuse detected|revoked|already rotated|compromised/i.test(
            err.message || "",
          );
        },
      );

      // Token family should be marked compromised
      const family = db
        .prepare("SELECT * FROM token_families WHERE id = ?")
        .get(tokenFamily);
      if (family.compromised_at) {
        // Strict policy: reuse compromises the whole family
        await assert.rejects(async () => {
          await authService.verifyRefreshToken(token2);
        }, /compromised|revoked/i);
      } else {
        // Grace-window policy: reuse shortly after rotation returns re-auth error
        assert.ok(
          /already rotated|conflict/i.test(reuseError?.message || ""),
          "Expected graceful rotation conflict behavior when family is not compromised",
        );
        const stillValid = await authService.verifyRefreshToken(token2);
        assert.strictEqual(stillValid.userId, testUserId);
      }
    });
  });

  describe("Password Reset Tokens", () => {
    let testUserId;

    beforeEach(() => {
      testUserId = uniqueUserId("user-prt");
      db.prepare(
        "INSERT INTO users (id, created_at, risk_level) VALUES (?, datetime('now'), 'low')",
      ).run(testUserId);
    });

    it("should create password reset token", async () => {
      const { token, tokenId, expiresAt } =
        await authService.createPasswordResetToken(testUserId);

      assert.ok(token, "should return raw token");
      assert.ok(tokenId, "should return token ID");
      assert.ok(expiresAt, "should return expiration");

      // Verify stored hashed
      const stored = db
        .prepare("SELECT * FROM password_reset_tokens WHERE id = ?")
        .get(tokenId);
      assert.ok(stored, "should be stored in DB");
      assert.notEqual(
        stored.token_hash,
        token,
        "should store hash, not raw token",
      );
    });

    it("should verify valid password reset token", async () => {
      const { token } = await authService.createPasswordResetToken(testUserId);

      const result = await authService.verifyPasswordResetToken(token);
      assert.strictEqual(result.userId, testUserId);
      assert.ok(result.tokenId);
    });

    it("should reject already used token", async () => {
      const { token, tokenId } =
        await authService.createPasswordResetToken(testUserId);

      // Mark as used
      await authService.markPasswordResetTokenUsed(tokenId);

      await assert.rejects(async () => {
        await authService.verifyPasswordResetToken(token);
      }, /used|invalid/i);
    });

    it("should reject expired token", async () => {
      const { token } = await authService.createPasswordResetToken(testUserId, {
        expiresIn: -1,
      });

      await assert.rejects(async () => {
        await authService.verifyPasswordResetToken(token);
      }, /expired/i);
    });

    it("should invalidate all tokens when password is reset", async () => {
      // Create multiple reset tokens
      const { token: token1 } =
        await authService.createPasswordResetToken(testUserId);
      const { token: token2 } =
        await authService.createPasswordResetToken(testUserId);

      // Reset password (invalidates all)
      await authService.invalidateAllPasswordResetTokens(testUserId);

      await assert.rejects(async () => {
        await authService.verifyPasswordResetToken(token1);
      }, /used|invalid/i);

      await assert.rejects(async () => {
        await authService.verifyPasswordResetToken(token2);
      }, /used|invalid/i);
    });
  });

  describe("Email Verification Tokens", () => {
    let testUserId;

    beforeEach(() => {
      testUserId = uniqueUserId("user-evt");
      db.prepare(
        "INSERT INTO users (id, created_at, risk_level) VALUES (?, datetime('now'), 'low')",
      ).run(testUserId);
    });

    it("should create email verification token", async () => {
      const { token, tokenId, expiresAt } =
        await authService.createEmailVerificationToken(testUserId);

      assert.ok(token, "should return raw token");
      assert.ok(tokenId, "should return token ID");
      assert.ok(expiresAt, "should return expiration");
    });

    it("should bind email verification token to the intended email", async () => {
      const { tokenId, emailNormalized } =
        await authService.createEmailVerificationToken(testUserId, {
          email: " Ambrose@Example.com ",
        });

      assert.strictEqual(emailNormalized, "ambrose@example.com");
      const stored = db
        .prepare(
          "SELECT email_normalized FROM email_verification_tokens WHERE id = ?",
        )
        .get(tokenId);
      assert.strictEqual(stored.email_normalized, "ambrose@example.com");
    });

    it("should verify valid email verification token", async () => {
      const { token } = await authService.createEmailVerificationToken(
        testUserId,
        {
          email: "recipient@example.com",
        },
      );

      const result = await authService.verifyEmailVerificationToken(token);
      assert.strictEqual(result.userId, testUserId);
      assert.strictEqual(result.email_normalized, "recipient@example.com");
    });

    it("should reject already used token", async () => {
      const { token, tokenId } =
        await authService.createEmailVerificationToken(testUserId);

      await authService.markEmailVerificationTokenUsed(tokenId);

      await assert.rejects(async () => {
        await authService.verifyEmailVerificationToken(token);
      }, /used|invalid/i);
    });
  });

  describe("Session Management", () => {
    let testUserId;

    beforeEach(() => {
      testUserId = uniqueUserId("user-sess");
      db.prepare(
        "INSERT INTO users (id, created_at, risk_level) VALUES (?, datetime('now'), 'low')",
      ).run(testUserId);
    });

    it("should create session for user", async () => {
      const sessionData = {
        deviceName: "iPhone 15 Pro",
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      };

      const session = await authService.createSession(testUserId, sessionData);

      assert.ok(session.id, "should return session ID");
      assert.strictEqual(session.userId, testUserId);
      assert.strictEqual(session.deviceName, sessionData.deviceName);
    });

    it("should list active sessions for user", async () => {
      // Create multiple sessions
      await authService.createSession(testUserId, { deviceName: "iPhone" });
      await authService.createSession(testUserId, { deviceName: "iPad" });

      const sessions = await authService.listSessions(testUserId);

      assert.strictEqual(sessions.length, 2);
      assert.ok(sessions.some((s) => s.deviceName === "iPhone"));
      assert.ok(sessions.some((s) => s.deviceName === "iPad"));
    });

    it("should revoke session", async () => {
      const session = await authService.createSession(testUserId, {
        deviceName: "Test",
      });

      await authService.revokeSession(session.id);

      const sessions = await authService.listSessions(testUserId);
      assert.strictEqual(
        sessions.length,
        0,
        "should not list revoked sessions",
      );
    });

    it("should revoke all sessions except current", async () => {
      const session1 = await authService.createSession(testUserId, {
        deviceName: "iPhone",
      });
      const session2 = await authService.createSession(testUserId, {
        deviceName: "iPad",
      });
      const session3 = await authService.createSession(testUserId, {
        deviceName: "Mac",
      });

      await authService.revokeAllSessionsExcept(testUserId, session1.id);

      const sessions = await authService.listSessions(testUserId);
      assert.strictEqual(sessions.length, 1);
      assert.strictEqual(sessions[0].id, session1.id);
    });
  });

  describe("Auth Events", () => {
    let testUserId;

    beforeEach(() => {
      testUserId = uniqueUserId("user-evt");
      db.prepare(
        "INSERT INTO users (id, created_at, risk_level) VALUES (?, datetime('now'), 'low')",
      ).run(testUserId);
    });

    it("should log auth event", async () => {
      await authService.logAuthEvent({
        userId: testUserId,
        eventType: "login_success",
        ipAddress: "192.168.1.1",
        userAgent: "Test/1.0",
        metadata: { method: "email" },
      });

      const events = db
        .prepare("SELECT * FROM auth_events WHERE user_id = ?")
        .all(testUserId);

      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].event_type, "login_success");
      assert.strictEqual(events[0].ip_address, "192.168.1.1");
    });

    it("should log event without userId for failed attempts", async () => {
      await authService.logAuthEvent({
        eventType: "login_failed",
        ipAddress: "192.168.1.1",
        metadata: { email: "test@example.com" },
      });

      const events = db
        .prepare("SELECT * FROM auth_events WHERE event_type = 'login_failed'")
        .all();

      assert.ok(events.length > 0);
      assert.strictEqual(events[0].user_id, null);
    });
  });

  describe("Account Deletion", () => {
    it("should roll back account deletion when the GDPR audit insert fails", async () => {
      const userId = uniqueUserId("user-delete-audit");
      const email = `delete-${crypto.randomBytes(8).toString("hex")}@example.com`;
      const duplicateAuditId = `audit-${crypto.randomBytes(8).toString("hex")}`;

      db.prepare(
        "INSERT INTO users (id, email, created_at, risk_level) VALUES (?, ?, datetime('now'), 'low')",
      ).run(userId, email);
      db.prepare(
        `INSERT INTO audit_logs (
          id, user_id, action, resource_type, resource_id, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        duplicateAuditId,
        userId,
        "PREEXISTING_AUDIT_ROW",
        "user",
        userId,
        "{}",
        new Date().toISOString(),
      );

      await assert.rejects(
        () =>
          authService.deleteUserAccount(userId, {
            accountDeletionAuditLog: {
              id: duplicateAuditId,
              userId,
              action: "ACCOUNT_DELETION",
              resourceType: "user",
              resourceId: userId,
              metadataJson: JSON.stringify({ gdpr_request: true }),
              createdAt: new Date().toISOString(),
            },
          }),
        /audit_logs|constraint|duplicate|UNIQUE/i,
      );

      const user = db
        .prepare("SELECT email, display_name, deleted_at FROM users WHERE id = ?")
        .get(userId);
      assert.ok(user, "user row should remain after rollback");
      assert.strictEqual(user.email, email);
      assert.strictEqual(user.display_name, null);
      assert.strictEqual(user.deleted_at, null);
    });

    it("should not delete storage when a later DB audit write fails", async () => {
      const userId = uniqueUserId("user-delete-audit-storage");
      const email = `delete-${crypto.randomBytes(8).toString("hex")}@example.com`;
      const duplicateAuditId = `audit-${crypto.randomBytes(8).toString("hex")}`;
      const deletedKeys = [];
      const storageProvider = {
        listObjects: async ({ prefix }) => ({
          keys:
            prefix === `tracks/${userId}/`
              ? [`tracks/${userId}/track_1/v1/preview.m4a`]
              : [],
          prefixes: [],
        }),
        deleteObject: async ({ key }) => {
          deletedKeys.push(key);
        },
      };

      db.prepare(
        "INSERT INTO users (id, email, created_at, risk_level) VALUES (?, ?, datetime('now'), 'low')",
      ).run(userId, email);
      db.prepare(
        `INSERT INTO audit_logs (
          id, user_id, action, resource_type, resource_id, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        duplicateAuditId,
        userId,
        "PREEXISTING_AUDIT_ROW",
        "user",
        userId,
        "{}",
        new Date().toISOString(),
      );

      await assert.rejects(
        () =>
          authService.deleteUserAccount(userId, {
            storageProvider,
            accountDeletionAuditLog: {
              id: duplicateAuditId,
              userId,
              action: "ACCOUNT_DELETION",
              resourceType: "user",
              resourceId: userId,
              metadataJson: JSON.stringify({ gdpr_request: true }),
              createdAt: new Date().toISOString(),
            },
          }),
        /audit_logs|constraint|duplicate|UNIQUE/i,
      );

      assert.deepStrictEqual(deletedKeys, []);

      const user = db
        .prepare("SELECT email, display_name, deleted_at FROM users WHERE id = ?")
        .get(userId);
      assert.ok(user, "user row should remain after rollback");
      assert.strictEqual(user.email, email);
      assert.strictEqual(user.display_name, null);
      assert.strictEqual(user.deleted_at, null);
    });

    it("should scrub voice-provider evidence and remove provider jobs during account deletion", async () => {
      const userId = uniqueUserId("user-delete-voice-provider");
      db.prepare(
        "INSERT INTO users (id, email, created_at, risk_level) VALUES (?, ?, datetime('now'), 'low')",
      ).run(userId, `${userId}@example.com`);
      db.prepare(
        `INSERT INTO voice_profiles (
          id, user_id, status, quality_score, model_version, consent_version, created_at
        ) VALUES (?, ?, 'active', 90, 'test', 'voice_suno_persona_v1', datetime('now'))`,
      ).run("delete_voice_provider_voice", userId);
      db.prepare(
        `INSERT INTO voice_provider_profiles (
          id, voice_profile_id, user_id, provider, provider_profile_id, status,
          source_upload_url, source_task_id, source_audio_id, consent_scope,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'suno', ?, 'active', ?, ?, ?, 'voice_suno_persona_v1',
          datetime('now'), datetime('now'))`,
      ).run(
        "delete_voice_provider_profile",
        "delete_voice_provider_voice",
        userId,
        "remote_persona_secret",
        "https://files.example.com/raw-user-voice.wav",
        "remote_task_secret",
        "remote_audio_secret",
      );
      db.prepare(
        `INSERT INTO voice_provider_jobs (
          id, voice_profile_id, user_id, provider, voice_provider_profile_id,
          status, step, attempts, max_attempts, step_data, created_at, updated_at
        ) VALUES (?, ?, ?, 'suno', ?, 'pending', 'prepare_persona', 0, 3, '{}',
          datetime('now'), datetime('now'))`,
      ).run(
        "delete_voice_provider_job",
        "delete_voice_provider_voice",
        userId,
        "delete_voice_provider_profile",
      );

      await authService.deleteUserAccount(userId);

      const jobCount = db
        .prepare("SELECT COUNT(*) AS count FROM voice_provider_jobs WHERE user_id = ?")
        .get(userId);
      const voiceCount = db
        .prepare("SELECT COUNT(*) AS count FROM voice_profiles WHERE user_id = ?")
        .get(userId);
      assert.strictEqual(jobCount.count, 0);
      assert.strictEqual(voiceCount.count, 0);

      const audit = db
        .prepare(
          "SELECT metadata_json FROM audit_logs WHERE user_id = ? AND action = ?",
        )
        .get(userId, "voice_provider_profiles_deleted");
      assert.ok(audit, "voice-provider deletion audit should be retained");
      const metadata = JSON.parse(audit.metadata_json);
      assert.strictEqual(metadata.reason, "account_deletion");
      assert.deepStrictEqual(metadata.provider_profiles_deleted, [
        {
          id: "delete_voice_provider_profile",
          voice_profile_id: "delete_voice_provider_voice",
          provider: "suno",
          status: "active",
        },
      ]);
      assert.doesNotMatch(audit.metadata_json, /remote_persona_secret/);
      assert.doesNotMatch(audit.metadata_json, /remote_task_secret/);
      assert.doesNotMatch(audit.metadata_json, /remote_audio_secret/);
      assert.doesNotMatch(audit.metadata_json, /raw-user-voice/);
    });

    it("should queue durable storage cleanup without deleting artifacts inside account deletion", async () => {
      const userId = uniqueUserId("user-delete-storage");
      const otherUserId = uniqueUserId("other-storage");
      const storageRoot = fs.mkdtempSync(path.join(tmpDir, "account-storage-"));
      const storageProvider = createLocalStorage({ STORAGE_DIR: storageRoot });
      const sourcePath = path.join(storageRoot, "source-artifact.txt");
      fs.writeFileSync(sourcePath, "artifact");

      const targetKeys = [
        `tracks/${userId}/track_1/v1/preview.m4a`,
        `tracks/${userId}/track_1/v1/master.aac`,
        `poems/${userId}/poem_1/og_1200x630_v1_default.png`,
        `enrollment/raw/${userId}/session_1/p1.wav`,
        `enrollment/clean/${userId}/session_1/clean.wav`,
        `voice_profiles/${userId}/profile_1/embedding.bin`,
      ];
      const retainedKey = `tracks/${otherUserId}/track_1/v1/preview.m4a`;

      for (const key of [...targetKeys, retainedKey]) {
        await storageProvider.putFile({ key, filePath: sourcePath });
      }

      db.prepare(
        "INSERT INTO users (id, email, created_at, risk_level) VALUES (?, ?, datetime('now'), 'low')",
      ).run(userId, `${userId}@example.com`);
      db.prepare(
        "INSERT INTO tracks (id, user_id, status, title, created_at, updated_at) VALUES (?, ?, 'ready', 'Storage Song', datetime('now'), datetime('now'))",
      ).run("track_delete_storage_success", userId);
      db.prepare(
        "INSERT INTO track_versions (id, track_id, version_num, status, render_type, params_hash, created_at) VALUES (?, ?, 1, 'ready', 'preview', 'hash_storage_success', datetime('now'))",
      ).run("tv_delete_storage_success", "track_delete_storage_success");
      db.prepare(
        `INSERT INTO voice_profiles (
          id, user_id, status, quality_score, model_version, consent_version, created_at
        ) VALUES (?, ?, 'active', 90, 'test', 'voice_suno_persona_v1', datetime('now'))`,
      ).run("voice_delete_storage_success", userId);

      await authService.deleteUserAccount(userId, { storageProvider });

      const queued = db
        .prepare("SELECT status FROM account_cleanup_jobs WHERE user_id = ?")
        .get(userId);
      assert.ok(queued, "durable cleanup job should be committed with the tombstone");

      for (const key of targetKeys) {
        assert.strictEqual(
          await storageProvider.objectExists({ key }),
          true,
          `${key} must remain until the post-commit cleanup worker runs`,
        );
      }
      assert.strictEqual(
        await storageProvider.objectExists({ key: retainedKey }),
        true,
        "other user's artifact should survive",
      );

      const user = db
        .prepare("SELECT deleted_at FROM users WHERE id = ?")
        .get(userId);
      assert.ok(user.deleted_at, "user should be tombstoned");
      assert.strictEqual(
        db
          .prepare("SELECT COUNT(*) AS count FROM tracks WHERE user_id = ?")
          .get(userId).count,
        0,
      );
      assert.strictEqual(
        db
          .prepare("SELECT COUNT(*) AS count FROM voice_profiles WHERE user_id = ?")
          .get(userId).count,
        0,
      );
    });

    it("should commit the account tombstone without invoking external storage inline", async () => {
      const userId = uniqueUserId("user-delete-storage-failure");
      const email = `${userId}@example.com`;
      const deletedKeys = [];
      const storageProvider = {
        listObjects: async ({ prefix }) => ({
          keys:
            prefix === `tracks/${userId}/`
              ? [`tracks/${userId}/track_1/v1/preview.m4a`]
              : [],
          prefixes: [],
        }),
        deleteObject: async ({ key }) => {
          deletedKeys.push(key);
          throw new Error("simulated storage delete failure");
        },
      };

      db.prepare(
        "INSERT INTO users (id, email, created_at, risk_level) VALUES (?, ?, datetime('now'), 'low')",
      ).run(userId, email);

      await authService.deleteUserAccount(userId, { storageProvider });
      assert.deepStrictEqual(deletedKeys, []);

      const user = db
        .prepare("SELECT email, display_name, deleted_at FROM users WHERE id = ?")
        .get(userId);
      assert.ok(user, "tombstoned user row should remain for retained evidence");
      assert.match(user.email, /^deleted_.+@deleted\.local$/);
      assert.notStrictEqual(user.email, email);
      assert.strictEqual(user.display_name, "Deleted User");
      assert.ok(user.deleted_at);

      const deletedEvent = db
        .prepare(
          "SELECT COUNT(*) AS count FROM auth_events WHERE user_id = ? AND event_type = 'account_deleted'",
        )
        .get(userId);
      assert.strictEqual(deletedEvent.count, 1);
      const cleanupJob = db
        .prepare("SELECT status, attempt_count FROM account_cleanup_jobs WHERE user_id = ?")
        .get(userId);
      assert.ok(["pending", "running", "completed"].includes(cleanupJob.status));
      assert.ok(cleanupJob.attempt_count >= 0);
    });
  });

  describe("Account Lockout", () => {
    let testUserId;

    beforeEach(() => {
      testUserId = uniqueUserId("user-lock");
      db.prepare(
        "INSERT INTO users (id, email, created_at, risk_level) VALUES (?, ?, datetime('now'), 'low')",
      ).run(
        testUserId,
        `test-${crypto.randomBytes(8).toString("hex")}@example.com`,
      );
    });

    it("should increment failed login count", async () => {
      await authService.incrementFailedLoginCount(testUserId);
      await authService.incrementFailedLoginCount(testUserId);

      const user = db
        .prepare("SELECT failed_login_count FROM users WHERE id = ?")
        .get(testUserId);
      assert.strictEqual(user.failed_login_count, 2);
    });

    it("should lock account after 5 failed attempts", async () => {
      for (let i = 0; i < 5; i++) {
        await authService.incrementFailedLoginCount(testUserId);
      }

      const isLocked = await authService.isAccountLocked(testUserId);
      assert.strictEqual(isLocked, true);
    });

    it("should unlock after lockout period", async () => {
      // Lock account
      for (let i = 0; i < 5; i++) {
        await authService.incrementFailedLoginCount(testUserId);
      }

      // Set locked_until to past
      db.prepare(
        "UPDATE users SET locked_until = datetime('now', '-1 hour') WHERE id = ?",
      ).run(testUserId);

      const isLocked = await authService.isAccountLocked(testUserId);
      assert.strictEqual(isLocked, false);
    });

    it("should reset failed count on successful login", async () => {
      await authService.incrementFailedLoginCount(testUserId);
      await authService.incrementFailedLoginCount(testUserId);

      await authService.resetFailedLoginCount(testUserId);

      const user = db
        .prepare(
          "SELECT failed_login_count, locked_until FROM users WHERE id = ?",
        )
        .get(testUserId);
      assert.strictEqual(user.failed_login_count, 0);
      assert.strictEqual(user.locked_until, null);
    });

    it("should use atomic increment (no lost updates under concurrent calls)", async () => {
      // Fire multiple increments concurrently — atomic SQL prevents lost updates
      const concurrentCount = 5;
      await Promise.all(
        Array.from({ length: concurrentCount }, () =>
          authService.incrementFailedLoginCount(testUserId),
        ),
      );

      const user = db
        .prepare("SELECT failed_login_count FROM users WHERE id = ?")
        .get(testUserId);
      assert.strictEqual(
        user.failed_login_count,
        concurrentCount,
        `Expected ${concurrentCount} increments, got ${user.failed_login_count} — indicates lost updates`,
      );
    });

    it("should apply escalating lockout on repeated threshold hits", async () => {
      // Hit threshold twice (10 failures = 2x threshold of 5)
      for (let i = 0; i < 10; i++) {
        await authService.incrementFailedLoginCount(testUserId);
      }

      const user = db
        .prepare(
          "SELECT failed_login_count, locked_until FROM users WHERE id = ?",
        )
        .get(testUserId);
      assert.strictEqual(user.failed_login_count, 10);
      assert.ok(user.locked_until, "should be locked after 10 failures");

      // Second lockout should be longer than base 15 minutes
      // lockoutCount = floor(10/5) = 2, escalated = 15 * 2^(2-1) = 30 min
      const lockedUntil = new Date(user.locked_until);
      const expectedMinLockout = new Date();
      expectedMinLockout.setMinutes(expectedMinLockout.getMinutes() + 25); // at least 25 min (30 minus some slack)
      assert.ok(
        lockedUntil > expectedMinLockout,
        "Second lockout should be escalated (>25 min from now)",
      );
    });

    it("should handle null failed_login_count gracefully", async () => {
      // Explicitly set failed_login_count to NULL to test COALESCE
      db.prepare("UPDATE users SET failed_login_count = NULL WHERE id = ?").run(
        testUserId,
      );

      await authService.incrementFailedLoginCount(testUserId);

      const user = db
        .prepare("SELECT failed_login_count FROM users WHERE id = ?")
        .get(testUserId);
      assert.strictEqual(
        user.failed_login_count,
        1,
        "should increment from NULL to 1",
      );
    });
  });

  describe("Token Generation", () => {
    it("should generate cryptographically secure random tokens", () => {
      const token1 = authService.generateSecureToken();
      const token2 = authService.generateSecureToken();

      assert.ok(token1.length >= 32, "token should be at least 32 chars");
      assert.notEqual(token1, token2, "tokens should be unique");
    });

    it("should hash tokens with SHA-256", () => {
      const token = "test-token-123";
      const hash = authService.hashToken(token);

      assert.strictEqual(hash.length, 64, "SHA-256 produces 64-char hex");
      assert.strictEqual(
        hash,
        authService.hashToken(token),
        "hashing should be deterministic",
      );
    });
  });
});
