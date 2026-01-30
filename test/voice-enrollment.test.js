/**
 * Voice Enrollment Test Suite
 *
 * Comprehensive tests for the voice enrollment flow including:
 * - POST /voice/enrollment/start
 * - POST /voice/enrollment/chunk_uploaded
 * - POST /voice/enrollment/complete
 * - GET /voice/profile
 *
 * Tests cover success paths, error cases, edge cases, and integration scenarios.
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

// ============================================================
// Test Utilities
// ============================================================

function uniqueUserId(prefix = "enroll_user") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * Create a valid WAV file buffer for testing
 */
function createTestWav(options = {}) {
  const {
    durationSec = 3,
    frequencyHz = 440,
    sampleRate = 44100,
    noiseLevel = 0,
    silent = false,
  } = options;

  const totalSamples = Math.floor(durationSec * sampleRate);
  const buffer = Buffer.alloc(44 + totalSamples * 2);

  // WAV header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + totalSamples * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // Mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34); // 16-bit
  buffer.write("data", 36);
  buffer.writeUInt32LE(totalSamples * 2, 40);

  // Audio samples
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    let sample;
    if (silent) {
      sample = 0;
    } else {
      const signal = Math.sin(2 * Math.PI * frequencyHz * t) * (1 - noiseLevel);
      const noise = (Math.random() * 2 - 1) * noiseLevel;
      sample = signal + noise;
    }
    const intSample = Math.round(Math.max(-1, Math.min(1, sample)) * 0x7fff);
    buffer.writeInt16LE(intSample, 44 + i * 2);
  }

  return buffer;
}

/**
 * Clear rate limits for a user in the database
 */
async function clearRateLimits(db, userId) {
  await db.prepare("DELETE FROM rate_limits WHERE user_id = ?").run(userId);
}

// ============================================================
// Test Suite
// ============================================================

describe("Voice Enrollment API", () => {
  let db;
  let app;
  let storageDir;
  let config;
  let storage;

  before(async () => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-enrollment-test-"));
    config = {
      PREVIEW_ONLY: false,
      STREAM_BASE_URL: "http://stream.local",
      STORAGE_DIR: storageDir,
      STORAGE_PROVIDER: "local",
      UPLOAD_SIGNING_SECRET: "test-upload-secret",
      UPLOAD_URL_TTL_SEC: 900,
      LIVE_PROVIDERS: false, // Disable external API calls for tests
    };
    db = await initDb({ dbPath: ":memory:", migrationsDir: path.join(process.cwd(), "migrations") });
    storage = createStorageProvider(config);
    app = buildServer({ db, config, storage });
  });

  after(async () => {
    await app.close();
    db.close();
    if (storageDir && fs.existsSync(storageDir)) {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
  });

  // ============================================================
  // POST /voice/enrollment/start
  // ============================================================
  describe("POST /voice/enrollment/start", () => {
    it("should start enrollment session with valid consent", async () => {
      const userId = uniqueUserId();

      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/start",
        headers: { "x-user-id": userId },
        payload: { consent_accepted: true, consent_version: "v1.0" },
      });

      assert.strictEqual(response.statusCode, 200, "should return 200");
      const body = response.json();

      // Verify session data
      assert.ok(body.session_id, "should return session_id");
      assert.ok(body.prompt_set_id, "should return prompt_set_id");
      assert.ok(body.session_expires_at, "should return session_expires_at");

      // Verify prompts
      assert.ok(Array.isArray(body.prompts), "should return prompts array");
      assert.ok(body.prompts.length >= 6, "should have at least 6 prompts");

      // Verify prompt structure
      const firstPrompt = body.prompts[0];
      assert.ok(firstPrompt.id, "prompt should have id");
      assert.ok(firstPrompt.type, "prompt should have type (spoken/sung)");
      assert.ok(firstPrompt.text, "prompt should have text");
      assert.ok(firstPrompt.duration_hint_sec, "prompt should have duration_hint_sec");

      // Verify upload URLs
      assert.ok(Array.isArray(body.upload_urls), "should return upload_urls array");
      assert.strictEqual(body.upload_urls.length, body.prompts.length, "upload_urls should match prompts");

      const firstUpload = body.upload_urls[0];
      assert.ok(firstUpload.chunk_id, "upload should have chunk_id");
      assert.ok(firstUpload.url, "upload should have url");
      assert.ok(firstUpload.method, "upload should have method");
      assert.ok(firstUpload.expires_at, "upload should have expires_at");

      // Verify recording settings
      assert.ok(body.recording_settings, "should return recording_settings");
      assert.strictEqual(body.recording_settings.sample_rate, 44100);
      assert.strictEqual(body.recording_settings.channels, 1);
      assert.strictEqual(body.recording_settings.format, "wav");
    });

    it("should reject enrollment without consent", async () => {
      const userId = uniqueUserId();

      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/start",
        headers: { "x-user-id": userId },
        payload: { consent_accepted: false },
      });

      // Schema validation rejects false value (consent_accepted must be true)
      assert.strictEqual(response.statusCode, 400, "should return 400");
    });

    it("should reject enrollment without user ID", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/start",
        payload: { consent_accepted: true },
      });

      assert.strictEqual(response.statusCode, 401, "should return 401");
    });

    it("should create enrollment_sessions database record", async () => {
      const userId = uniqueUserId();

      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/start",
        headers: { "x-user-id": userId },
        payload: { consent_accepted: true, consent_version: "v2.0" },
      });

      const body = response.json();
      const session = await db
        .prepare("SELECT * FROM enrollment_sessions WHERE id = ?")
        .get(body.session_id);

      assert.ok(session, "session should exist in database");
      assert.strictEqual(session.user_id, userId);
      assert.strictEqual(session.status, "recording");
      assert.strictEqual(session.consent_version, "v2.0");
      assert.strictEqual(session.chunk_count, 0);
    });

    it("should create audit log entry", async () => {
      const userId = uniqueUserId();

      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/start",
        headers: { "x-user-id": userId },
        payload: { consent_accepted: true },
      });

      const body = response.json();
      const audit = await db
        .prepare("SELECT * FROM audit_logs WHERE resource_id = ?")
        .get(body.session_id);

      assert.ok(audit, "audit log should exist");
      assert.strictEqual(audit.action, "enrollment_started");
      assert.strictEqual(audit.resource_type, "enrollment_session");
    });

    it("should enforce rate limiting (10 per 24 hours)", async () => {
      const userId = uniqueUserId();

      // Make 10 successful requests
      for (let i = 0; i < 10; i++) {
        const response = await app.inject({
          method: "POST",
          url: "/voice/enrollment/start",
          headers: { "x-user-id": userId },
          payload: { consent_accepted: true },
        });
        assert.strictEqual(response.statusCode, 200, `request ${i + 1} should succeed`);
      }

      // 11th request should be rate limited
      const blocked = await app.inject({
        method: "POST",
        url: "/voice/enrollment/start",
        headers: { "x-user-id": userId },
        payload: { consent_accepted: true },
      });

      assert.strictEqual(blocked.statusCode, 429, "should return 429");
      const body = blocked.json();
      assert.strictEqual(body.error, "RATE_LIMITED");
      assert.ok(body.retry_at, "should include retry_at");
    });

    it("should allow enrollment after rate limit reset", async () => {
      const userId = uniqueUserId();

      // Exhaust rate limit
      for (let i = 0; i < 10; i++) {
        await app.inject({
          method: "POST",
          url: "/voice/enrollment/start",
          headers: { "x-user-id": userId },
          payload: { consent_accepted: true },
        });
      }

      // Clear rate limits (simulates admin reset or time passing)
      await clearRateLimits(db, userId);

      // Should now be allowed
      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/start",
        headers: { "x-user-id": userId },
        payload: { consent_accepted: true },
      });

      assert.strictEqual(response.statusCode, 200, "should allow after reset");
    });
  });

  // ============================================================
  // POST /voice/enrollment/chunk_uploaded
  // ============================================================
  describe("POST /voice/enrollment/chunk_uploaded", () => {
    let testUserId;
    let testSessionId;

    beforeEach(async () => {
      testUserId = uniqueUserId("chunk_user");

      // Create a fresh enrollment session
      const startResponse = await app.inject({
        method: "POST",
        url: "/voice/enrollment/start",
        headers: { "x-user-id": testUserId },
        payload: { consent_accepted: true },
      });
      testSessionId = startResponse.json().session_id;
    });

    it("should accept valid chunk upload notification", async () => {
      const chunkId = "p1";

      // Create the chunk file in storage
      const chunkDir = path.join(storageDir, "enrollment", "raw", testUserId, testSessionId);
      fs.mkdirSync(chunkDir, { recursive: true });
      const chunkPath = path.join(chunkDir, `${chunkId}.wav`);
      fs.writeFileSync(chunkPath, createTestWav({ durationSec: 5 }));

      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/chunk_uploaded",
        headers: { "x-user-id": testUserId },
        payload: {
          session_id: testSessionId,
          chunk_id: chunkId,
          duration_sec: 5,
        },
      });

      assert.strictEqual(response.statusCode, 200);
      const body = response.json();
      assert.strictEqual(body.status, "accepted");
      assert.strictEqual(body.chunk_id, chunkId);
    });

    it("should reject notification without chunk_id", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/chunk_uploaded",
        headers: { "x-user-id": testUserId },
        payload: { session_id: testSessionId },
      });

      assert.strictEqual(response.statusCode, 400);
      const body = response.json();
      assert.strictEqual(body.error, "MISSING_CHUNK_ID");
    });

    it("should reject notification for non-existent session", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/chunk_uploaded",
        headers: { "x-user-id": testUserId },
        payload: {
          session_id: "00000000-0000-0000-0000-000000000000",
          chunk_id: "p1",
        },
      });

      assert.strictEqual(response.statusCode, 404);
      const body = response.json();
      assert.strictEqual(body.error, "SESSION_NOT_FOUND");
    });

    it("should reject notification when chunk file not found in storage", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/chunk_uploaded",
        headers: { "x-user-id": testUserId },
        payload: {
          session_id: testSessionId,
          chunk_id: "missing_chunk",
        },
      });

      assert.strictEqual(response.statusCode, 404);
      const body = response.json();
      assert.strictEqual(body.error, "CHUNK_NOT_FOUND");
    });

    it("should reject chunk with duration out of range (too short)", async () => {
      const chunkId = "p1";

      // Create a very short chunk (1 second, min is 2)
      const chunkDir = path.join(storageDir, "enrollment", "raw", testUserId, testSessionId);
      fs.mkdirSync(chunkDir, { recursive: true });
      const chunkPath = path.join(chunkDir, `${chunkId}.wav`);
      fs.writeFileSync(chunkPath, createTestWav({ durationSec: 1 }));

      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/chunk_uploaded",
        headers: { "x-user-id": testUserId },
        payload: {
          session_id: testSessionId,
          chunk_id: chunkId,
          duration_sec: 1,
        },
      });

      assert.strictEqual(response.statusCode, 400);
      const body = response.json();
      assert.strictEqual(body.error, "QC_FAILED");
      assert.ok(body.re_record, "should indicate re_record needed");
    });

    it("should update session chunk count and quality metrics", async () => {
      const chunkId = "p1";

      // Create the chunk file
      const chunkDir = path.join(storageDir, "enrollment", "raw", testUserId, testSessionId);
      fs.mkdirSync(chunkDir, { recursive: true });
      fs.writeFileSync(path.join(chunkDir, `${chunkId}.wav`), createTestWav({ durationSec: 4 }));

      await app.inject({
        method: "POST",
        url: "/voice/enrollment/chunk_uploaded",
        headers: { "x-user-id": testUserId },
        payload: {
          session_id: testSessionId,
          chunk_id: chunkId,
        },
      });

      // Verify database was updated
      const session = await db
        .prepare("SELECT * FROM enrollment_sessions WHERE id = ?")
        .get(testSessionId);

      assert.strictEqual(session.chunk_count, 1, "chunk_count should be incremented");
      const metrics = JSON.parse(session.quality_metrics);
      assert.ok(metrics[chunkId], "chunk should be in quality_metrics");
      assert.strictEqual(metrics[chunkId].accepted, true);
    });

    it("should reject notification for expired session", async () => {
      // Manually expire the session
      const pastDate = new Date(Date.now() - 1000).toISOString();
      await db
        .prepare("UPDATE enrollment_sessions SET expires_at = ? WHERE id = ?")
        .run(pastDate, testSessionId);

      const chunkDir = path.join(storageDir, "enrollment", "raw", testUserId, testSessionId);
      fs.mkdirSync(chunkDir, { recursive: true });
      fs.writeFileSync(path.join(chunkDir, "p1.wav"), createTestWav());

      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/chunk_uploaded",
        headers: { "x-user-id": testUserId },
        payload: {
          session_id: testSessionId,
          chunk_id: "p1",
        },
      });

      assert.strictEqual(response.statusCode, 410);
      const body = response.json();
      assert.strictEqual(body.error, "SESSION_EXPIRED");
    });

    it("should reject notification from different user", async () => {
      const differentUser = uniqueUserId("different");

      const chunkDir = path.join(storageDir, "enrollment", "raw", testUserId, testSessionId);
      fs.mkdirSync(chunkDir, { recursive: true });
      fs.writeFileSync(path.join(chunkDir, "p1.wav"), createTestWav());

      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/chunk_uploaded",
        headers: { "x-user-id": differentUser },
        payload: {
          session_id: testSessionId,
          chunk_id: "p1",
        },
      });

      assert.strictEqual(response.statusCode, 404, "should not find session for different user");
    });
  });

  // ============================================================
  // POST /voice/enrollment/complete
  // ============================================================
  describe("POST /voice/enrollment/complete", () => {
    /**
     * Helper to set up a complete enrollment session with audio files
     */
    async function setupEnrollmentWithChunks(userId, numChunks = 4) {
      // Start enrollment
      const startResponse = await app.inject({
        method: "POST",
        url: "/voice/enrollment/start",
        headers: { "x-user-id": userId },
        payload: { consent_accepted: true },
      });
      const sessionId = startResponse.json().session_id;

      // Create chunk files
      const chunkDir = path.join(storageDir, "enrollment", "raw", userId, sessionId);
      fs.mkdirSync(chunkDir, { recursive: true });

      for (let i = 0; i < numChunks; i++) {
        const chunkId = `p${i + 1}`;
        fs.writeFileSync(
          path.join(chunkDir, `${chunkId}.wav`),
          createTestWav({ durationSec: 4 })
        );
      }

      return sessionId;
    }

    it("should complete enrollment and create voice profile", async () => {
      const userId = uniqueUserId("complete");
      const sessionId = await setupEnrollmentWithChunks(userId, 4);

      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/complete",
        headers: { "x-user-id": userId },
        payload: { session_id: sessionId },
      });

      assert.strictEqual(response.statusCode, 202, "should return 202 Accepted");
      const body = response.json();

      // Verify response structure
      assert.strictEqual(body.status, "processing");
      assert.ok(body.job_id, "should return job_id");
      assert.ok(body.voice_profile_id, "should return voice_profile_id");
      assert.ok(body.quality, "should return quality info");
      assert.ok(body.quality.tier, "should have quality tier");
      assert.ok(typeof body.quality.score === "number", "should have quality score");
      assert.ok(typeof body.quality.stars === "number", "should have quality stars");
      assert.ok(body.quality.label, "should have quality label");
      assert.ok(body.estimated_completion_sec, "should have estimated completion");
    });

    it("should update session status to completed", async () => {
      const userId = uniqueUserId("status");
      const sessionId = await setupEnrollmentWithChunks(userId);

      await app.inject({
        method: "POST",
        url: "/voice/enrollment/complete",
        headers: { "x-user-id": userId },
        payload: { session_id: sessionId },
      });

      const session = await db
        .prepare("SELECT * FROM enrollment_sessions WHERE id = ?")
        .get(sessionId);

      assert.strictEqual(session.status, "completed");
      assert.ok(session.completed_at, "should have completed_at timestamp");
    });

    it("should create voice_profiles database record", async () => {
      const userId = uniqueUserId("profile_db");
      const sessionId = await setupEnrollmentWithChunks(userId);

      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/complete",
        headers: { "x-user-id": userId },
        payload: { session_id: sessionId },
      });

      const body = response.json();
      const profile = await db
        .prepare("SELECT * FROM voice_profiles WHERE id = ?")
        .get(body.voice_profile_id);

      assert.ok(profile, "voice profile should exist");
      assert.strictEqual(profile.user_id, userId);
      assert.strictEqual(profile.status, "active");
      assert.ok(profile.quality_score >= 0, "should have quality_score");
      assert.ok(profile.quality_tier, "should have quality_tier");
    });

    it("should replace existing voice profile", async () => {
      const userId = uniqueUserId("replace");

      // Create first profile
      const sessionId1 = await setupEnrollmentWithChunks(userId);
      const response1 = await app.inject({
        method: "POST",
        url: "/voice/enrollment/complete",
        headers: { "x-user-id": userId },
        payload: { session_id: sessionId1 },
      });
      const profileId1 = response1.json().voice_profile_id;

      // Create second profile
      const sessionId2 = await setupEnrollmentWithChunks(userId);
      const response2 = await app.inject({
        method: "POST",
        url: "/voice/enrollment/complete",
        headers: { "x-user-id": userId },
        payload: { session_id: sessionId2 },
      });
      const profileId2 = response2.json().voice_profile_id;

      // First profile should be deleted
      const oldProfile = await db
        .prepare("SELECT * FROM voice_profiles WHERE id = ?")
        .get(profileId1);
      assert.strictEqual(oldProfile.status, "deleted", "old profile should be deleted");

      // New profile should be active
      const newProfile = await db
        .prepare("SELECT * FROM voice_profiles WHERE id = ?")
        .get(profileId2);
      assert.strictEqual(newProfile.status, "active", "new profile should be active");
    });

    it("should reject completion for non-existent session", async () => {
      const userId = uniqueUserId();

      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/complete",
        headers: { "x-user-id": userId },
        payload: { session_id: "00000000-0000-0000-0000-000000000000" },
      });

      assert.strictEqual(response.statusCode, 404);
      assert.strictEqual(response.json().error, "SESSION_NOT_FOUND");
    });

    it("should reject completion for expired session", async () => {
      const userId = uniqueUserId("expired");
      const sessionId = await setupEnrollmentWithChunks(userId);

      // Expire the session
      const pastDate = new Date(Date.now() - 1000).toISOString();
      await db
        .prepare("UPDATE enrollment_sessions SET expires_at = ? WHERE id = ?")
        .run(pastDate, sessionId);

      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/complete",
        headers: { "x-user-id": userId },
        payload: { session_id: sessionId },
      });

      assert.strictEqual(response.statusCode, 410);
      assert.strictEqual(response.json().error, "SESSION_EXPIRED");
    });

    it("should handle silent audio with low quality score", async () => {
      const userId = uniqueUserId("silent");

      // Start enrollment
      const startResponse = await app.inject({
        method: "POST",
        url: "/voice/enrollment/start",
        headers: { "x-user-id": userId },
        payload: { consent_accepted: true },
      });
      const sessionId = startResponse.json().session_id;

      // Create silent chunk files
      const chunkDir = path.join(storageDir, "enrollment", "raw", userId, sessionId);
      fs.mkdirSync(chunkDir, { recursive: true });
      for (let i = 0; i < 4; i++) {
        fs.writeFileSync(
          path.join(chunkDir, `p${i + 1}.wav`),
          createTestWav({ durationSec: 4, silent: true })
        );
      }

      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/complete",
        headers: { "x-user-id": userId },
        payload: { session_id: sessionId },
      });

      // Silent audio may pass with low quality or fail with E103
      // The QC is lenient to allow users to complete enrollment
      if (response.statusCode === 422) {
        const body = response.json();
        assert.ok(body.error.includes("E103"), "should have E103 error code");
      } else {
        assert.strictEqual(response.statusCode, 202);
        const body = response.json();
        // Should have minimal/basic tier for poor quality audio
        assert.ok(["minimal", "basic"].includes(body.quality.tier), "should have low quality tier");
      }
    });

    it("should return quality tier information", async () => {
      const userId = uniqueUserId("quality");
      const sessionId = await setupEnrollmentWithChunks(userId);

      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/complete",
        headers: { "x-user-id": userId },
        payload: { session_id: sessionId },
      });

      const body = response.json();

      // Verify quality tier structure
      assert.ok(["minimal", "basic", "fair", "good", "excellent"].includes(body.quality.tier));
      assert.ok(body.quality.score >= 0 && body.quality.score <= 100);
      assert.ok(typeof body.quality.stars === "number" && body.quality.stars >= 0 && body.quality.stars <= 3);
      assert.ok(body.quality.label);
      assert.ok(body.quality.disclosure);
      assert.ok(typeof body.quality.can_improve === "boolean");
    });

    it("should create audit log entry for completion", async () => {
      const userId = uniqueUserId("audit");
      const sessionId = await setupEnrollmentWithChunks(userId);

      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/complete",
        headers: { "x-user-id": userId },
        payload: { session_id: sessionId },
      });

      const body = response.json();
      const audit = await db
        .prepare("SELECT * FROM audit_logs WHERE resource_id = ?")
        .get(body.voice_profile_id);

      assert.ok(audit, "audit log should exist");
      assert.strictEqual(audit.action, "enrollment_completed");
      assert.strictEqual(audit.resource_type, "voice_profile");
    });
  });

  // ============================================================
  // GET /voice/profile
  // ============================================================
  describe("GET /voice/profile", () => {
    it("should return active voice profile", async () => {
      const userId = uniqueUserId("get_profile");

      // Create enrollment and complete it
      const startResponse = await app.inject({
        method: "POST",
        url: "/voice/enrollment/start",
        headers: { "x-user-id": userId },
        payload: { consent_accepted: true },
      });
      const sessionId = startResponse.json().session_id;

      // Create chunks
      const chunkDir = path.join(storageDir, "enrollment", "raw", userId, sessionId);
      fs.mkdirSync(chunkDir, { recursive: true });
      for (let i = 0; i < 4; i++) {
        fs.writeFileSync(
          path.join(chunkDir, `p${i + 1}.wav`),
          createTestWav({ durationSec: 4 })
        );
      }

      await app.inject({
        method: "POST",
        url: "/voice/enrollment/complete",
        headers: { "x-user-id": userId },
        payload: { session_id: sessionId },
      });

      // Get profile
      const response = await app.inject({
        method: "GET",
        url: "/voice/profile",
        headers: { "x-user-id": userId },
      });

      assert.strictEqual(response.statusCode, 200);
      const body = response.json();
      assert.ok(body.profile_id, "should have profile_id");
      assert.strictEqual(body.status, "active");
      assert.ok(body.quality_score >= 0, "should have quality_score");
    });

    it("should return 404 for user without profile", async () => {
      const userId = uniqueUserId("no_profile");

      const response = await app.inject({
        method: "GET",
        url: "/voice/profile",
        headers: { "x-user-id": userId },
      });

      assert.strictEqual(response.statusCode, 404);
      assert.strictEqual(response.json().error, "NO_VOICE_PROFILE");
    });

    it("should not return deleted profiles", async () => {
      const userId = uniqueUserId("deleted_profile");

      // Create and complete enrollment
      const startResponse = await app.inject({
        method: "POST",
        url: "/voice/enrollment/start",
        headers: { "x-user-id": userId },
        payload: { consent_accepted: true },
      });
      const sessionId = startResponse.json().session_id;

      const chunkDir = path.join(storageDir, "enrollment", "raw", userId, sessionId);
      fs.mkdirSync(chunkDir, { recursive: true });
      for (let i = 0; i < 4; i++) {
        fs.writeFileSync(
          path.join(chunkDir, `p${i + 1}.wav`),
          createTestWav({ durationSec: 4 })
        );
      }

      const completeResponse = await app.inject({
        method: "POST",
        url: "/voice/enrollment/complete",
        headers: { "x-user-id": userId },
        payload: { session_id: sessionId },
      });
      const profileId = completeResponse.json().voice_profile_id;

      // Manually delete the profile
      await db
        .prepare("UPDATE voice_profiles SET status = 'deleted' WHERE id = ?")
        .run(profileId);

      // Get profile should return 404
      const response = await app.inject({
        method: "GET",
        url: "/voice/profile",
        headers: { "x-user-id": userId },
      });

      assert.strictEqual(response.statusCode, 404);
      assert.strictEqual(response.json().error, "NO_VOICE_PROFILE");
    });
  });

  // ============================================================
  // Full Flow Integration Tests
  // ============================================================
  describe("Full Enrollment Flow", () => {
    it("should complete full enrollment flow: start -> chunks -> complete -> profile", async () => {
      const userId = uniqueUserId("full_flow");

      // Step 1: Start enrollment
      const startResponse = await app.inject({
        method: "POST",
        url: "/voice/enrollment/start",
        headers: { "x-user-id": userId },
        payload: { consent_accepted: true, consent_version: "v1.0" },
      });
      assert.strictEqual(startResponse.statusCode, 200);
      const { session_id, prompts, upload_urls } = startResponse.json();
      assert.ok(session_id);
      assert.ok(prompts.length >= 6);
      assert.strictEqual(upload_urls.length, prompts.length);

      // Step 2: Upload chunks (simulated)
      const chunkDir = path.join(storageDir, "enrollment", "raw", userId, session_id);
      fs.mkdirSync(chunkDir, { recursive: true });

      for (const prompt of prompts) {
        const chunkPath = path.join(chunkDir, `${prompt.id}.wav`);
        const durationSec = prompt.type === "sung" ? 8 : 5;
        fs.writeFileSync(chunkPath, createTestWav({ durationSec }));

        // Notify server of upload
        const chunkResponse = await app.inject({
          method: "POST",
          url: "/voice/enrollment/chunk_uploaded",
          headers: { "x-user-id": userId },
          payload: {
            session_id,
            chunk_id: prompt.id,
            duration_sec: durationSec,
          },
        });
        assert.strictEqual(chunkResponse.statusCode, 200);
      }

      // Verify all chunks were recorded
      const sessionMid = await db
        .prepare("SELECT chunk_count FROM enrollment_sessions WHERE id = ?")
        .get(session_id);
      assert.strictEqual(sessionMid.chunk_count, prompts.length);

      // Step 3: Complete enrollment
      const completeResponse = await app.inject({
        method: "POST",
        url: "/voice/enrollment/complete",
        headers: { "x-user-id": userId },
        payload: { session_id },
      });
      assert.strictEqual(completeResponse.statusCode, 202);
      const { voice_profile_id, quality } = completeResponse.json();
      assert.ok(voice_profile_id);
      assert.ok(quality.tier);

      // Step 4: Verify profile exists
      const profileResponse = await app.inject({
        method: "GET",
        url: "/voice/profile",
        headers: { "x-user-id": userId },
      });
      assert.strictEqual(profileResponse.statusCode, 200);
      assert.strictEqual(profileResponse.json().profile_id, voice_profile_id);
      assert.strictEqual(profileResponse.json().status, "active");
    });

    it("should allow re-enrollment after deleting profile", async () => {
      const userId = uniqueUserId("re_enroll");

      // First enrollment
      const start1 = await app.inject({
        method: "POST",
        url: "/voice/enrollment/start",
        headers: { "x-user-id": userId },
        payload: { consent_accepted: true },
      });
      const session1 = start1.json().session_id;

      const chunkDir1 = path.join(storageDir, "enrollment", "raw", userId, session1);
      fs.mkdirSync(chunkDir1, { recursive: true });
      for (let i = 1; i <= 4; i++) {
        fs.writeFileSync(path.join(chunkDir1, `p${i}.wav`), createTestWav({ durationSec: 4 }));
      }

      const complete1 = await app.inject({
        method: "POST",
        url: "/voice/enrollment/complete",
        headers: { "x-user-id": userId },
        payload: { session_id: session1 },
      });
      const profile1 = complete1.json().voice_profile_id;

      // Second enrollment (should replace first)
      const start2 = await app.inject({
        method: "POST",
        url: "/voice/enrollment/start",
        headers: { "x-user-id": userId },
        payload: { consent_accepted: true },
      });
      const session2 = start2.json().session_id;

      const chunkDir2 = path.join(storageDir, "enrollment", "raw", userId, session2);
      fs.mkdirSync(chunkDir2, { recursive: true });
      for (let i = 1; i <= 4; i++) {
        fs.writeFileSync(path.join(chunkDir2, `p${i}.wav`), createTestWav({ durationSec: 4 }));
      }

      const complete2 = await app.inject({
        method: "POST",
        url: "/voice/enrollment/complete",
        headers: { "x-user-id": userId },
        payload: { session_id: session2 },
      });
      const profile2 = complete2.json().voice_profile_id;

      // Verify first profile is deleted, second is active
      const dbProfile1 = await db.prepare("SELECT status FROM voice_profiles WHERE id = ?").get(profile1);
      const dbProfile2 = await db.prepare("SELECT status FROM voice_profiles WHERE id = ?").get(profile2);

      assert.strictEqual(dbProfile1.status, "deleted");
      assert.strictEqual(dbProfile2.status, "active");

      // Get profile should return the new one
      const profileResponse = await app.inject({
        method: "GET",
        url: "/voice/profile",
        headers: { "x-user-id": userId },
      });
      assert.strictEqual(profileResponse.json().profile_id, profile2);
    });
  });
});
