/**
 * Security Remediation Tests — Units 4, 11, 12
 *
 * Unit 4:  FFmpeg drawtext injection prevention (textfile= + expansion=none)
 * Unit 11: Poem credit pre-check before LLM call
 * Unit 12: Cover image auth, health/providers admin gate, CORS warning, trial rate limit
 */

require("dotenv/config");
const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

// ============================================================
// Unit 4: FFmpeg drawtext injection prevention
// ============================================================

describe("Unit 4: FFmpeg drawtext textfile injection prevention", () => {
  const {
    FFMPEG_TEMP_DIR,
    cleanStaleTempFiles,
    writeTempTextFile,
  } = require("../src/utils/ffmpeg");

  it("FFMPEG_TEMP_DIR points inside os.tmpdir()", () => {
    assert.ok(FFMPEG_TEMP_DIR.startsWith(os.tmpdir()));
    assert.ok(FFMPEG_TEMP_DIR.includes("porizo-ffmpeg"));
  });

  it("FFMPEG_TEMP_DIR exists on disk", () => {
    assert.ok(fs.existsSync(FFMPEG_TEMP_DIR));
  });

  describe("writeTempTextFile", () => {
    const written = [];

    after(() => {
      for (const fp of written) {
        try { fs.unlinkSync(fp); } catch (_) {}
      }
    });

    it("writes text to a file in FFMPEG_TEMP_DIR and returns its path", () => {
      const fp = writeTempTextFile("Hello World");
      written.push(fp);
      assert.ok(fp.startsWith(FFMPEG_TEMP_DIR));
      assert.equal(fs.readFileSync(fp, "utf-8"), "Hello World");
    });

    it("handles special characters that would break inline text=", () => {
      const malicious = "Robert'; DROP TABLE tracks;--";
      const fp = writeTempTextFile(malicious);
      written.push(fp);
      assert.equal(fs.readFileSync(fp, "utf-8"), malicious);
    });

    it("handles FFmpeg %{expr} injection attempts", () => {
      const injection = "%{eif:1+1:d}";
      const fp = writeTempTextFile(injection);
      written.push(fp);
      // The text is written literally — expansion=none prevents evaluation
      assert.equal(fs.readFileSync(fp, "utf-8"), injection);
    });

    it("generates unique filenames for each call", () => {
      const fp1 = writeTempTextFile("a");
      const fp2 = writeTempTextFile("b");
      written.push(fp1, fp2);
      assert.notEqual(fp1, fp2);
    });
  });

  describe("cleanStaleTempFiles", () => {
    it("removes files older than 10 minutes", () => {
      // Create a temp file and backdate its mtime
      const name = `test_stale_${crypto.randomBytes(4).toString("hex")}.txt`;
      const fp = path.join(FFMPEG_TEMP_DIR, name);
      fs.writeFileSync(fp, "stale");

      // Backdate 15 minutes
      const past = new Date(Date.now() - 15 * 60 * 1000);
      fs.utimesSync(fp, past, past);

      cleanStaleTempFiles();
      assert.ok(!fs.existsSync(fp), "Stale file should have been removed");
    });

    it("keeps files newer than 10 minutes", () => {
      const name = `test_fresh_${crypto.randomBytes(4).toString("hex")}.txt`;
      const fp = path.join(FFMPEG_TEMP_DIR, name);
      fs.writeFileSync(fp, "fresh");

      cleanStaleTempFiles();
      assert.ok(fs.existsSync(fp), "Fresh file should be kept");

      // Clean up
      fs.unlinkSync(fp);
    });

    it("does not throw on empty directory", () => {
      // Just verify it doesn't throw
      assert.doesNotThrow(() => cleanStaleTempFiles());
    });
  });
});

// ============================================================
// Unit 11: Poem credit pre-check
// ============================================================

describe("Unit 11: Poem credit pre-check before LLM call", () => {
  const { initDb } = require("../src/db");
  const { buildServer } = require("../src/server");

  let db;
  let app;

  function uid(prefix = "poem_test") {
    return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
  }

  beforeEach(async () => {
    db = await initDb({
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildServer({
      db,
      config: { STORAGE_DIR: "/tmp/test-storage" },
      storage: {
        put: async () => {},
        get: async () => null,
        exists: async () => false,
        delete: async () => {},
        getSignedUrl: async (key) => `http://localhost/${key}`,
      },
    });
  });

  it("rejects poem generation when user has zero poems_remaining", async () => {
    const userId = uid();
    const poemId = `poem_${crypto.randomBytes(8).toString("hex")}`;
    const now = new Date().toISOString();

    // Create user
    await db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(userId, now);

    // Set entitlements with zero poems_remaining
    await db.prepare(
      "INSERT INTO entitlements (user_id, tier, credits_balance, poems_remaining, updated_at) VALUES (?, 'free', 0, 0, ?)"
    ).run(userId, now);

    // Create poem
    await db.prepare(
      "INSERT INTO poems (id, user_id, title, recipient_name, occasion, tone, status, created_at, updated_at) VALUES (?, ?, 'Test Poem', 'Test', 'birthday', 'heartfelt', 'draft', ?, ?)"
    ).run(poemId, userId, now, now);

    const response = await app.inject({
      method: "POST",
      url: `/poems/${poemId}/generate`,
      headers: { "x-user-id": userId },
    });

    assert.equal(response.statusCode, 402);
    const body = JSON.parse(response.body);
    assert.equal(body.error, "INSUFFICIENT_POEM_CREDITS");
  });

  it("rejects poem generation when user has no entitlements row", async () => {
    const userId = uid();
    const poemId = `poem_${crypto.randomBytes(8).toString("hex")}`;
    const now = new Date().toISOString();

    // Create user without entitlements
    await db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(userId, now);

    // Create poem
    await db.prepare(
      "INSERT INTO poems (id, user_id, title, recipient_name, occasion, tone, status, created_at, updated_at) VALUES (?, ?, 'Test Poem', 'Test', 'birthday', 'heartfelt', 'draft', ?, ?)"
    ).run(poemId, userId, now, now);

    const response = await app.inject({
      method: "POST",
      url: `/poems/${poemId}/generate`,
      headers: { "x-user-id": userId },
    });

    assert.equal(response.statusCode, 402);
    const body = JSON.parse(response.body);
    assert.equal(body.error, "INSUFFICIENT_POEM_CREDITS");
  });

  it("allows poem generation when user has poems_remaining > 0", async () => {
    const userId = uid();
    const poemId = `poem_${crypto.randomBytes(8).toString("hex")}`;
    const now = new Date().toISOString();

    // Create user
    await db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(userId, now);

    // Set entitlements with positive poems_remaining
    await db.prepare(
      "INSERT INTO entitlements (user_id, tier, credits_balance, poems_remaining, updated_at) VALUES (?, 'pro', 10, 5, ?)"
    ).run(userId, now);

    // Create poem
    await db.prepare(
      "INSERT INTO poems (id, user_id, title, recipient_name, occasion, tone, status, created_at, updated_at) VALUES (?, ?, 'Test Poem', 'Test', 'birthday', 'heartfelt', 'draft', ?, ?)"
    ).run(poemId, userId, now, now);

    const response = await app.inject({
      method: "POST",
      url: `/poems/${poemId}/generate`,
      headers: { "x-user-id": userId },
    });

    // Should NOT be 402 — it will likely fail at LLM call (503/500) in test env,
    // but the credit pre-check passed
    assert.notEqual(response.statusCode, 402, "Should pass credit pre-check");
  });
});

// ============================================================
// Unit 12: Cover auth, health/providers, CORS, trial rate limit
// ============================================================

describe("Unit 12: Cover auth + admin + CORS + misc", () => {
  const { initDb } = require("../src/db");
  const { buildServer } = require("../src/server");

  let db;
  let app;

  function uid(prefix = "u12_test") {
    return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
  }

  async function loginAdmin(appInstance) {
    const response = await appInstance.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: { email: "admin@porizo.app", password: "admin123" },
    });
    if (response.statusCode !== 200) return null;
    const body = JSON.parse(response.body);
    return body.token;
  }

  beforeEach(async () => {
    db = await initDb({
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildServer({
      db,
      config: { STORAGE_DIR: "/tmp/test-storage" },
      storage: {
        put: async () => {},
        get: async () => null,
        exists: async () => false,
        delete: async () => {},
        getSignedUrl: async (key) => `http://localhost/${key}`,
      },
    });
  });

  // ---- Cover image auth ----

  describe("GET /cover/:trackVersionId/:size", () => {
    it("requires authentication for cover images", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cover/nonexistent/256",
        // No auth header
      });

      // Should get 401 (no auth) or 404 (not found after auth), not 200
      assert.ok([401, 404].includes(response.statusCode),
        `Expected 401 or 404, got ${response.statusCode}`);
    });

    it("rejects cover access for wrong user", async () => {
      const userId = uid("cover_owner");
      const otherUserId = uid("cover_other");
      const now = new Date().toISOString();
      const trackId = `trk_${crypto.randomBytes(8).toString("hex")}`;
      const tvId = `tv_${crypto.randomBytes(8).toString("hex")}`;

      // Create users
      await db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(userId, now);
      await db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(otherUserId, now);

      // Create track + version directly in DB
      await db.prepare(
        "INSERT INTO tracks (id, user_id, title, recipient_name, occasion, style, message, status, created_at, updated_at) VALUES (?, ?, 'Test', 'Rec', 'birthday', 'pop', 'msg', 'draft', ?, ?)"
      ).run(trackId, userId, now, now);
      await db.prepare(
        "INSERT INTO track_versions (id, track_id, version_num, status, created_at, updated_at) VALUES (?, ?, 1, 'draft', ?, ?)"
      ).run(tvId, trackId, now, now);

      // Other user tries to access cover
      const response = await app.inject({
        method: "GET",
        url: `/cover/${tvId}/256`,
        headers: { "x-user-id": otherUserId },
      });

      assert.equal(response.statusCode, 403);
    });

    it("allows cover access via valid share token", async () => {
      const userId = uid("cover_share");
      const now = new Date().toISOString();
      const trackId = `trk_${crypto.randomBytes(8).toString("hex")}`;
      const tvId = `tv_${crypto.randomBytes(8).toString("hex")}`;
      const shareTokenId = `share_${crypto.randomBytes(8).toString("hex")}`;
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      await db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(userId, now);

      // Create track + version directly in DB
      await db.prepare(
        "INSERT INTO tracks (id, user_id, title, recipient_name, occasion, style, message, status, created_at, updated_at) VALUES (?, ?, 'Test', 'Rec', 'birthday', 'pop', 'msg', 'draft', ?, ?)"
      ).run(trackId, userId, now, now);
      await db.prepare(
        "INSERT INTO track_versions (id, track_id, version_num, status, created_at, updated_at) VALUES (?, ?, 1, 'draft', ?, ?)"
      ).run(tvId, trackId, now, now);

      // Create a share token
      await db.prepare(
        "INSERT INTO share_tokens (id, track_id, track_version_id, creator_id, status, expires_at, created_at) VALUES (?, ?, ?, ?, 'active', ?, ?)"
      ).run(shareTokenId, trackId, tvId, userId, futureDate, now);

      // Access cover with share token (no auth header) — should pass auth check
      // Will 404 on disk because no image file, but shouldn't 401/403
      const response = await app.inject({
        method: "GET",
        url: `/cover/${tvId}/256?share_token=${shareTokenId}`,
        // No auth header
      });

      // Should NOT be 401 or 403
      assert.ok(![401, 403].includes(response.statusCode),
        `Share token should bypass auth, got ${response.statusCode}`);
    });

    it("rejects cover access via revoked share token", async () => {
      const userId = uid("cover_revoked");
      const now = new Date().toISOString();
      const trackId = `trk_${crypto.randomBytes(8).toString("hex")}`;
      const tvId = `tv_${crypto.randomBytes(8).toString("hex")}`;
      const shareTokenId = `share_${crypto.randomBytes(8).toString("hex")}`;
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      await db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(userId, now);

      // Create track + version directly in DB
      await db.prepare(
        "INSERT INTO tracks (id, user_id, title, recipient_name, occasion, style, message, status, created_at, updated_at) VALUES (?, ?, 'Test', 'Rec', 'birthday', 'pop', 'msg', 'draft', ?, ?)"
      ).run(trackId, userId, now, now);
      await db.prepare(
        "INSERT INTO track_versions (id, track_id, version_num, status, created_at, updated_at) VALUES (?, ?, 1, 'draft', ?, ?)"
      ).run(tvId, trackId, now, now);

      // Create a revoked share token
      await db.prepare(
        "INSERT INTO share_tokens (id, track_id, track_version_id, creator_id, status, expires_at, created_at) VALUES (?, ?, ?, ?, 'revoked', ?, ?)"
      ).run(shareTokenId, trackId, tvId, userId, futureDate, now);

      // Access with revoked token and no auth
      const response = await app.inject({
        method: "GET",
        url: `/cover/${tvId}/256?share_token=${shareTokenId}`,
      });

      // Should be 401 — revoked token is not valid, falls through to requireUserId
      assert.equal(response.statusCode, 401);
    });
  });

  // ---- Health/providers admin gate ----

  describe("GET /health/providers", () => {
    it("rejects unauthenticated access", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/providers",
      });

      // Should require admin auth
      assert.ok([401, 403].includes(response.statusCode),
        `Expected 401 or 403, got ${response.statusCode}`);
    });

    it("allows admin access", async () => {
      const adminToken = await loginAdmin(app);
      if (!adminToken) {
        // Skip if admin login not available in test env
        return;
      }

      const response = await app.inject({
        method: "GET",
        url: "/health/providers",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      // Admin should get through auth — may get 503 if providers not configured,
      // but not 401/403
      assert.ok(![401, 403].includes(response.statusCode),
        `Admin should pass auth, got ${response.statusCode}`);
    });
  });

  // ---- Trial activation rate limit ----

  describe("POST /billing/trial/activate rate limit", () => {
    it("allows first trial activation attempt", async () => {
      const userId = uid("trial_rl");
      const now = new Date().toISOString();

      await db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(userId, now);

      const response = await app.inject({
        method: "POST",
        url: "/billing/trial/activate",
        headers: { "x-user-id": userId },
      });

      // Should succeed (200) or fail for business logic (409 already used),
      // but NOT 429
      assert.notEqual(response.statusCode, 429, "First attempt should not be rate limited");
    });

    it("blocks after exceeding rate limit", async () => {
      const userId = uid("trial_rl_exceed");
      const now = new Date().toISOString();

      await db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(userId, now);

      // Fire 4 requests (limit is 3 per hour)
      for (let i = 0; i < 3; i++) {
        await app.inject({
          method: "POST",
          url: "/billing/trial/activate",
          headers: { "x-user-id": userId },
        });
      }

      // 4th request should be rate limited
      const response = await app.inject({
        method: "POST",
        url: "/billing/trial/activate",
        headers: { "x-user-id": userId },
      });

      assert.equal(response.statusCode, 429);
      const body = JSON.parse(response.body);
      assert.equal(body.error, "RATE_LIMITED");
      // retry_at may be null in SQLite test env due to GREATEST() not being available
    });
  });
});
