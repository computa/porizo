/**
 * Auth Schema Tests (migration 019)
 *
 * Tests that the authentication schema is correctly created with all
 * required tables, columns, constraints, and indexes.
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { initDb } = require("../src/db");

describe("Auth Schema (migration 019)", () => {
  let db;
  let dbPath;
  let tmpDir;

  before(async () => {
    // Create temp db file
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-auth-test-"));
    dbPath = path.join(tmpDir, "test.db");

    // Initialize db with migrations from project root
    const migrationsDir = path.join(__dirname, "..", "migrations");
    db = await initDb({ dbPath, migrationsDir });
  });

  after(async () => {
    // Cleanup temp db file
    if (db && db.close) {
      db.close();
    }
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Helper to get column names from a table
  function getColumns(tableName) {
    const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
    return rows.map((row) => row.name);
  }

  // Helper to get all indexes
  function getIndexes() {
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all();
    return rows.map((row) => row.name);
  }

  describe("users table", () => {
    it("should have auth-related columns", () => {
      const columns = getColumns("users");

      assert.ok(columns.includes("email"), "users should have email column");
      assert.ok(columns.includes("email_verified"), "users should have email_verified column");
      assert.ok(columns.includes("display_name"), "users should have display_name column");
      assert.ok(columns.includes("avatar_url"), "users should have avatar_url column");
      assert.ok(columns.includes("failed_login_count"), "users should have failed_login_count column");
      assert.ok(columns.includes("locked_until"), "users should have locked_until column");
    });
  });

  describe("user_auth_providers table", () => {
    it("should exist with correct columns", () => {
      const columns = getColumns("user_auth_providers");

      assert.ok(columns.includes("id"), "should have id column");
      assert.ok(columns.includes("user_id"), "should have user_id column");
      assert.ok(columns.includes("provider"), "should have provider column");
      assert.ok(columns.includes("provider_user_id"), "should have provider_user_id column");
      assert.ok(columns.includes("provider_data"), "should have provider_data column");
    });

    it("should enforce provider check constraint", () => {
      // Insert valid user first
      db.prepare("INSERT INTO users (id, created_at, risk_level) VALUES (?, datetime('now'), 'low')").run("test-user-1");

      // Valid provider should work
      db.prepare("INSERT INTO user_auth_providers (id, user_id, provider, provider_user_id) VALUES (?, ?, ?, ?)").run("ap-1", "test-user-1", "apple", "apple-sub-123");

      // Invalid provider should fail
      assert.throws(() => {
        db.prepare("INSERT INTO user_auth_providers (id, user_id, provider, provider_user_id) VALUES (?, ?, ?, ?)").run("ap-2", "test-user-1", "invalid", "xxx");
      }, /CHECK constraint failed/);
    });

    it("should enforce unique provider+provider_user_id", () => {
      db.prepare("INSERT INTO users (id, created_at, risk_level) VALUES (?, datetime('now'), 'low')").run("test-user-2");
      db.prepare("INSERT INTO user_auth_providers (id, user_id, provider, provider_user_id) VALUES (?, ?, ?, ?)").run("ap-3", "test-user-2", "google", "google-sub-123");

      assert.throws(() => {
        db.prepare("INSERT INTO user_auth_providers (id, user_id, provider, provider_user_id) VALUES (?, ?, ?, ?)").run("ap-4", "test-user-2", "google", "google-sub-123");
      }, /UNIQUE constraint failed/);
    });
  });

  describe("user_credentials table", () => {
    it("should exist with correct columns", () => {
      const columns = getColumns("user_credentials");

      assert.ok(columns.includes("user_id"), "should have user_id column");
      assert.ok(columns.includes("password_hash"), "should have password_hash column");
      assert.ok(columns.includes("password_changed_at"), "should have password_changed_at column");
    });
  });

  describe("user_sessions table", () => {
    it("should exist with correct columns", () => {
      const columns = getColumns("user_sessions");

      assert.ok(columns.includes("id"), "should have id column");
      assert.ok(columns.includes("user_id"), "should have user_id column");
      assert.ok(columns.includes("device_name"), "should have device_name column");
      assert.ok(columns.includes("ip_address"), "should have ip_address column");
      assert.ok(columns.includes("revoked_at"), "should have revoked_at column");
    });
  });

  describe("token_families table", () => {
    it("should exist with correct columns", () => {
      const columns = getColumns("token_families");

      assert.ok(columns.includes("id"), "should have id column");
      assert.ok(columns.includes("user_id"), "should have user_id column");
      assert.ok(columns.includes("session_id"), "should have session_id column");
      assert.ok(columns.includes("compromised_at"), "should have compromised_at column");
    });
  });

  describe("refresh_tokens table", () => {
    it("should exist with correct columns", () => {
      const columns = getColumns("refresh_tokens");

      assert.ok(columns.includes("id"), "should have id column");
      assert.ok(columns.includes("user_id"), "should have user_id column");
      assert.ok(columns.includes("token_hash"), "should have token_hash column");
      assert.ok(columns.includes("token_family"), "should have token_family column");
      assert.ok(columns.includes("generation"), "should have generation column");
      assert.ok(columns.includes("expires_at"), "should have expires_at column");
      assert.ok(columns.includes("revoked_at"), "should have revoked_at column");
    });

    it("should enforce unique token_hash", () => {
      db.prepare("INSERT INTO users (id, created_at, risk_level) VALUES (?, datetime('now'), 'low')").run("test-user-rt");
      db.prepare("INSERT INTO user_sessions (id, user_id) VALUES (?, ?)").run("sess-1", "test-user-rt");
      db.prepare("INSERT INTO token_families (id, user_id, session_id) VALUES (?, ?, ?)").run("tf-1", "test-user-rt", "sess-1");
      db.prepare("INSERT INTO refresh_tokens (id, user_id, token_hash, token_family, expires_at) VALUES (?, ?, ?, ?, ?)").run("rt-1", "test-user-rt", "hash123", "tf-1", "2025-12-31T00:00:00Z");

      assert.throws(() => {
        db.prepare("INSERT INTO refresh_tokens (id, user_id, token_hash, token_family, expires_at) VALUES (?, ?, ?, ?, ?)").run("rt-2", "test-user-rt", "hash123", "tf-1", "2025-12-31T00:00:00Z");
      }, /UNIQUE constraint failed/);
    });
  });

  describe("password_reset_tokens table", () => {
    it("should exist with correct columns", () => {
      const columns = getColumns("password_reset_tokens");

      assert.ok(columns.includes("id"), "should have id column");
      assert.ok(columns.includes("user_id"), "should have user_id column");
      assert.ok(columns.includes("token_hash"), "should have token_hash column");
      assert.ok(columns.includes("expires_at"), "should have expires_at column");
      assert.ok(columns.includes("used_at"), "should have used_at column");
      assert.ok(columns.includes("requested_ip"), "should have requested_ip column");
    });
  });

  describe("email_verification_tokens table", () => {
    it("should exist with correct columns", () => {
      const columns = getColumns("email_verification_tokens");

      assert.ok(columns.includes("id"), "should have id column");
      assert.ok(columns.includes("user_id"), "should have user_id column");
      assert.ok(columns.includes("token_hash"), "should have token_hash column");
      assert.ok(columns.includes("expires_at"), "should have expires_at column");
      assert.ok(columns.includes("used_at"), "should have used_at column");
    });
  });

  describe("auth_events table", () => {
    it("should exist with correct columns", () => {
      const columns = getColumns("auth_events");

      assert.ok(columns.includes("id"), "should have id column");
      assert.ok(columns.includes("user_id"), "should have user_id column");
      assert.ok(columns.includes("event_type"), "should have event_type column");
      assert.ok(columns.includes("ip_address"), "should have ip_address column");
      assert.ok(columns.includes("user_agent"), "should have user_agent column");
      assert.ok(columns.includes("metadata"), "should have metadata column");
    });

    it("should enforce event_type check constraint", () => {
      db.prepare("INSERT INTO auth_events (id, event_type) VALUES (?, ?)").run("evt-1", "login_success");

      assert.throws(() => {
        db.prepare("INSERT INTO auth_events (id, event_type) VALUES (?, ?)").run("evt-2", "invalid_event");
      }, /CHECK constraint failed/);
    });
  });

  describe("indexes", () => {
    it("should have token hash indexes for O(1) lookup", () => {
      const indexes = getIndexes();

      assert.ok(indexes.includes("idx_refresh_tokens_hash"), "should have refresh_tokens hash index");
      assert.ok(indexes.includes("idx_password_reset_hash"), "should have password_reset_tokens hash index");
      assert.ok(indexes.includes("idx_email_verify_hash"), "should have email_verification_tokens hash index");
    });
  });
});
