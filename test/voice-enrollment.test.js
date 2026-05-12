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
const {
  __test: { attachChunkQualityResults, buildSunoPersonaCalibration },
} = require("../src/routes/enrollment");
const {
  REQUIRED_CONSENT_SCOPE,
  runSunoVoicePersonaJob,
} = require("../src/services/suno-voice-persona-service");
const {
  createPendingProviderProfile,
  markProviderProfileActive,
} = require("../src/services/voice-provider-profile-service");

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

async function clearEnrollmentBurstLimit(db, userId) {
  await db
    .prepare(
      "DELETE FROM rate_limits WHERE user_id = ? AND action_type = 'voice_enrollment_start_burst'",
    )
    .run(userId);
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
    storageDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "porizo-enrollment-test-"),
    );
    config = {
      PREVIEW_ONLY: false,
      STREAM_BASE_URL: "http://stream.local",
      STORAGE_DIR: storageDir,
      STORAGE_PROVIDER: "local",
      UPLOAD_SIGNING_SECRET: "test-upload-secret",
      UPLOAD_URL_TTL_SEC: 900,
      LIVE_PROVIDERS: false, // Disable external API calls for tests
    };
    db = await initDb({
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
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

  describe("Suno persona calibration", () => {
    it("matches processed QC filenames back to original sung chunks", () => {
      const chunkEntries = [
        {
          chunkId: "p5",
          filePath: "/tmp/session/p5.wav",
          prompt: { id: "p5", type: "sung" },
        },
        {
          chunkId: "p6",
          filePath: "/tmp/session/p6.wav",
          prompt: { id: "p6", type: "sung" },
        },
      ];

      attachChunkQualityResults(chunkEntries, {
        preprocessingResults: {
          results: [
            {
              path: "/tmp/session/p5.wav",
              outputPath: "/tmp/session/p5_processed.wav",
            },
            {
              path: "/tmp/session/p6.wav",
              outputPath: "/tmp/session/p6_processed.wav",
            },
          ],
        },
        metrics: {
          chunk_results: [
            {
              file: "p5_processed.wav",
              metrics: { is_singing: true },
            },
            {
              file: "p6_processed.wav",
              metrics: { is_singing: false },
            },
          ],
        },
      });

      assert.equal(chunkEntries[0].quality.metrics.is_singing, true);
      assert.equal(chunkEntries[1].quality.metrics.is_singing, false);
    });

    it("does not build persona calibration from sung prompts whose recordings are near-silent", async () => {
      // vad_ratio is the content gate (>0.2 required). Sung prompts whose
      // recordings are mostly silence (e.g. mic dropouts, accidental taps)
      // must be rejected so the persona job never ships empty audio to Suno.
      const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), "porizo-suno-calibration-test-"),
      );
      try {
        const p5 = path.join(dir, "p5.wav");
        const p6 = path.join(dir, "p6.wav");
        fs.writeFileSync(p5, createTestWav({ durationSec: 6 }));
        fs.writeFileSync(p6, createTestWav({ durationSec: 6 }));

        const result = await buildSunoPersonaCalibration({
          outputPath: path.join(dir, "suno-persona.wav"),
          chunkEntries: [
            {
              chunkId: "p5",
              filePath: p5,
              prompt: { id: "p5", type: "sung" },
              quality: { metrics: { is_singing: false, vad_ratio: 0.05 } },
            },
            {
              chunkId: "p6",
              filePath: p6,
              prompt: { id: "p6", type: "sung" },
              quality: { metrics: { is_singing: false, vad_ratio: 0.05 } },
            },
          ],
        });

        assert.strictEqual(result, null);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("builds persona calibration from sung prompts that QC did not flag as singing, when audio content is substantive", async () => {
      // Real-world false-negative case: user sings "Ooh ooh ooh" but the
      // is_singing detector classifies the recording as speech-like (because
      // preprocessing's VAD trim + spoken-target noise suppression strips
      // sustained-note envelopes before the detector runs). vad_ratio>0.2
      // confirms substantive voiced content; the prompt-type + duration
      // contract carries the rest.
      const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), "porizo-suno-calibration-test-"),
      );
      try {
        const p5 = path.join(dir, "p5.wav");
        const p6 = path.join(dir, "p6.wav");
        const outputPath = path.join(dir, "suno-persona.wav");
        fs.writeFileSync(p5, createTestWav({ durationSec: 8 }));
        fs.writeFileSync(p6, createTestWav({ durationSec: 8 }));

        const result = await buildSunoPersonaCalibration({
          outputPath,
          chunkEntries: [
            {
              chunkId: "p5",
              filePath: p5,
              prompt: { id: "p5", type: "sung" },
              quality: { metrics: { is_singing: false, vad_ratio: 0.6 } },
            },
            {
              chunkId: "p6",
              filePath: p6,
              prompt: { id: "p6", type: "sung" },
              quality: { metrics: { is_singing: false, vad_ratio: 0.6 } },
            },
          ],
        });

        assert.ok(result, "calibration should be built");
        assert.strictEqual(result.chunkCount, 2);
        assert.ok(fs.existsSync(outputPath));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("builds persona calibration when sung prompts are QC-confirmed singing", async () => {
      const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), "porizo-suno-calibration-test-"),
      );
      try {
        const p5 = path.join(dir, "p5.wav");
        const p6 = path.join(dir, "p6.wav");
        const outputPath = path.join(dir, "suno-persona.wav");
        fs.writeFileSync(p5, createTestWav({ durationSec: 6 }));
        fs.writeFileSync(p6, createTestWav({ durationSec: 6 }));

        const result = await buildSunoPersonaCalibration({
          outputPath,
          chunkEntries: [
            {
              chunkId: "p5",
              filePath: p5,
              prompt: { id: "p5", type: "sung" },
              quality: { metrics: { is_singing: true } },
            },
            {
              chunkId: "p6",
              filePath: p6,
              prompt: { id: "p6", type: "sung" },
              quality: { metrics: { is_singing: true } },
            },
          ],
        });

        assert.ok(result);
        assert.strictEqual(result.chunkCount, 2);
        assert.ok(fs.existsSync(outputPath));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("returns null when post-trim duration falls below the persona minimum window", async () => {
      // Per Codex adversarial review: silence removal can shrink the
      // concatenated output below the 10s persona window. Without a
      // post-trim re-gate we'd ship a too-short calibration source that
      // Suno's generate-persona rejects. Construct two chunks dominated by
      // silence (a tone burst surrounded by quiet) so the trim collapses
      // the total below 10s.
      const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), "porizo-suno-calibration-test-"),
      );
      try {
        const p5 = path.join(dir, "p5.wav");
        const p6 = path.join(dir, "p6.wav");
        // Each chunk: 7s total with only 2.5s of actual tone at the start.
        // Tone (2.5s) + silence (4.5s) per chunk → after silenceremove,
        // ~5s combined → below the 10s minimum.
        fs.writeFileSync(
          p5,
          createTestWav({ durationSec: 2.5, frequencyHz: 440 }),
        );
        // Build a 7s file by padding the 2.5s tone with silence:
        // ffmpeg-free synthesis using the createTestWav helper twice and
        // truncating is overkill — instead use a manual silent tail.
        const tonePart = createTestWav({ durationSec: 2.5, frequencyHz: 440 });
        const silentTail = createTestWav({ durationSec: 4.5, silent: true });
        // WAV concat at byte level: copy 44-byte header + data from first,
        // append only the data section of the second (skip its 44-byte
        // header). This intentionally produces a single-chunk silent-tail
        // WAV that the test pipeline can feed into the calibration filter.
        const wav5Combined = Buffer.concat([tonePart, silentTail.subarray(44)]);
        // Patch RIFF + data chunk sizes so the combined WAV is well-formed.
        const dataLen = wav5Combined.length - 44;
        wav5Combined.writeUInt32LE(36 + dataLen, 4);
        wav5Combined.writeUInt32LE(dataLen, 40);
        fs.writeFileSync(p5, wav5Combined);
        fs.writeFileSync(p6, wav5Combined);

        const outputPath = path.join(dir, "suno-persona.wav");
        const result = await buildSunoPersonaCalibration({
          outputPath,
          chunkEntries: [
            {
              chunkId: "p5",
              filePath: p5,
              prompt: { id: "p5", type: "sung" },
              quality: { metrics: { is_singing: true, vad_ratio: 0.5 } },
            },
            {
              chunkId: "p6",
              filePath: p6,
              prompt: { id: "p6", type: "sung" },
              quality: { metrics: { is_singing: true, vad_ratio: 0.5 } },
            },
          ],
        });

        assert.strictEqual(
          result,
          null,
          "should reject when trimmed output is below the 10s window",
        );
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("propagates ffmpeg failure instead of silently falling back to a known-weak persona source", async () => {
      // Per Codex adversarial review: a silent fallback to naive byte-concat
      // on ffmpeg failure just defers the failure to Suno and creates
      // provider retry/cleanup noise. ffmpeg failure must surface as an
      // internal error so the caller can fail cleanly. Force ffmpeg failure
      // by passing a directory path as outputPath (ffmpeg cannot write a
      // file with the same path as an existing directory).
      const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), "porizo-suno-calibration-test-"),
      );
      try {
        const p5 = path.join(dir, "p5.wav");
        const p6 = path.join(dir, "p6.wav");
        fs.writeFileSync(p5, createTestWav({ durationSec: 8 }));
        fs.writeFileSync(p6, createTestWav({ durationSec: 8 }));
        const dirAsOutput = path.join(dir, "is-a-directory");
        fs.mkdirSync(dirAsOutput);

        await assert.rejects(
          () =>
            buildSunoPersonaCalibration({
              outputPath: dirAsOutput,
              chunkEntries: [
                {
                  chunkId: "p5",
                  filePath: p5,
                  prompt: { id: "p5", type: "sung" },
                  quality: { metrics: { vad_ratio: 0.6 } },
                },
                {
                  chunkId: "p6",
                  filePath: p6,
                  prompt: { id: "p6", type: "sung" },
                  quality: { metrics: { vad_ratio: 0.6 } },
                },
              ],
            }),
          /FFmpeg/i,
          "ffmpeg failure must propagate, not silently fall back to naive concat",
        );
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
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
      assert.ok(
        firstPrompt.duration_hint_sec,
        "prompt should have duration_hint_sec",
      );

      // Verify upload URLs
      assert.ok(
        Array.isArray(body.upload_urls),
        "should return upload_urls array",
      );
      assert.strictEqual(
        body.upload_urls.length,
        body.prompts.length,
        "upload_urls should match prompts",
      );

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
        await clearEnrollmentBurstLimit(db, userId);
        const response = await app.inject({
          method: "POST",
          url: "/voice/enrollment/start",
          headers: { "x-user-id": userId },
          payload: { consent_accepted: true },
        });
        assert.strictEqual(
          response.statusCode,
          200,
          `request ${i + 1} should succeed`,
        );
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
        await clearEnrollmentBurstLimit(db, userId);
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

    it("should block enrollment for blocked accounts", async () => {
      const userId = uniqueUserId("blocked_user");

      // First request creates the user with default risk_level='low'
      const setup = await app.inject({
        method: "POST",
        url: "/voice/enrollment/start",
        headers: { "x-user-id": userId },
        payload: { consent_accepted: true },
      });
      assert.strictEqual(setup.statusCode, 200, "setup request should succeed");

      // Set user to blocked
      await db
        .prepare("UPDATE users SET risk_level = 'blocked' WHERE id = ?")
        .run(userId);

      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/start",
        headers: { "x-user-id": userId },
        payload: { consent_accepted: true },
      });

      assert.strictEqual(
        response.statusCode,
        403,
        "should return 403 for blocked accounts",
      );
      const body = response.json();
      assert.strictEqual(body.error, "ACCOUNT_BLOCKED");
    });

    it("should block enrollment for high-risk accounts", async () => {
      const userId = uniqueUserId("highrisk_user");

      // First request creates the user
      const setup = await app.inject({
        method: "POST",
        url: "/voice/enrollment/start",
        headers: { "x-user-id": userId },
        payload: { consent_accepted: true },
      });
      assert.strictEqual(setup.statusCode, 200, "setup request should succeed");

      // Set user to high risk
      await db
        .prepare("UPDATE users SET risk_level = 'high' WHERE id = ?")
        .run(userId);

      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/start",
        headers: { "x-user-id": userId },
        payload: { consent_accepted: true },
      });

      assert.strictEqual(
        response.statusCode,
        403,
        "should return 403 for high-risk accounts",
      );
      const body = response.json();
      assert.strictEqual(body.error, "ACCOUNT_BLOCKED");
    });

    it("should allow enrollment for medium-risk accounts", async () => {
      const userId = uniqueUserId("medrisk_user");

      // First request creates the user
      await app.inject({
        method: "POST",
        url: "/voice/enrollment/start",
        headers: { "x-user-id": userId },
        payload: { consent_accepted: true },
      });

      // Set user to medium risk
      await db
        .prepare("UPDATE users SET risk_level = 'medium' WHERE id = ?")
        .run(userId);
      await clearEnrollmentBurstLimit(db, userId);

      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/start",
        headers: { "x-user-id": userId },
        payload: { consent_accepted: true },
      });

      assert.strictEqual(
        response.statusCode,
        200,
        "should allow medium-risk accounts",
      );
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
      const chunkDir = path.join(
        storageDir,
        "enrollment",
        "raw",
        testUserId,
        testSessionId,
      );
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
      const chunkDir = path.join(
        storageDir,
        "enrollment",
        "raw",
        testUserId,
        testSessionId,
      );
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
      assert.strictEqual(body.reason, "DURATION_OUT_OF_RANGE");
      assert.ok(body.re_record, "should indicate re_record needed");
    });

    it("should reject sung chunks that are shorter than the prompt contract", async () => {
      const chunkId = "p5";

      const chunkDir = path.join(
        storageDir,
        "enrollment",
        "raw",
        testUserId,
        testSessionId,
      );
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

      assert.strictEqual(response.statusCode, 400);
      const body = response.json();
      assert.strictEqual(body.error, "QC_FAILED");
      assert.strictEqual(body.reason, "SUNG_DURATION_TOO_SHORT");
      assert.strictEqual(body.details.reason, "SUNG_DURATION_TOO_SHORT");
      assert.ok(
        body.re_record,
        "should ask the app to re-record this sung line",
      );
    });

    it("should reject chunk notifications that are not in the enrollment prompts", async () => {
      const chunkId = "unexpected_chunk";

      const chunkDir = path.join(
        storageDir,
        "enrollment",
        "raw",
        testUserId,
        testSessionId,
      );
      fs.mkdirSync(chunkDir, { recursive: true });
      fs.writeFileSync(
        path.join(chunkDir, `${chunkId}.wav`),
        createTestWav({ durationSec: 5 }),
      );

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

      assert.strictEqual(response.statusCode, 400);
      const body = response.json();
      assert.strictEqual(body.error, "QC_FAILED");
      assert.strictEqual(body.reason, "INVALID_PROMPT_CHUNK");
      assert.ok(
        body.re_record,
        "should ask the app to discard the unexpected chunk",
      );
    });

    it("should update session chunk count and quality metrics", async () => {
      const chunkId = "p1";

      // Create the chunk file
      const chunkDir = path.join(
        storageDir,
        "enrollment",
        "raw",
        testUserId,
        testSessionId,
      );
      fs.mkdirSync(chunkDir, { recursive: true });
      fs.writeFileSync(
        path.join(chunkDir, `${chunkId}.wav`),
        createTestWav({ durationSec: 4 }),
      );

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

      assert.strictEqual(
        session.chunk_count,
        1,
        "chunk_count should be incremented",
      );
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

      const chunkDir = path.join(
        storageDir,
        "enrollment",
        "raw",
        testUserId,
        testSessionId,
      );
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

    it("should reject notification for finalized session", async () => {
      await db
        .prepare("UPDATE enrollment_sessions SET status = ? WHERE id = ?")
        .run("completed", testSessionId);

      const chunkDir = path.join(
        storageDir,
        "enrollment",
        "raw",
        testUserId,
        testSessionId,
      );
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

      assert.strictEqual(response.statusCode, 409);
      const body = response.json();
      assert.strictEqual(body.error, "SESSION_ALREADY_FINALIZED");
    });

    it("should reject notification from different user", async () => {
      const differentUser = uniqueUserId("different");

      const chunkDir = path.join(
        storageDir,
        "enrollment",
        "raw",
        testUserId,
        testSessionId,
      );
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

      assert.strictEqual(
        response.statusCode,
        404,
        "should not find session for different user",
      );
    });
  });

  // ============================================================
  // POST /voice/enrollment/complete
  // ============================================================
  describe("POST /voice/enrollment/complete", () => {
    /**
     * Helper to set up a complete enrollment session with audio files
     */
    async function setupEnrollmentWithChunks(userId, numChunksOrOptions = 4) {
      const options =
        typeof numChunksOrOptions === "object"
          ? numChunksOrOptions
          : { numChunks: numChunksOrOptions };
      const numChunks = options.numChunks || 4;
      await clearEnrollmentBurstLimit(db, userId);
      // Start enrollment
      const startResponse = await app.inject({
        method: "POST",
        url: "/voice/enrollment/start",
        headers: { "x-user-id": userId },
        payload: {
          consent_accepted: true,
          consent_version: options.consentVersion,
          // U2/U17: when the test wants persona consent, pass an explicit
          // scope grant. Legacy consent_version "1.0" also grants persona
          // consent for app builds that predate consent_scopes.
          ...(options.consentScopes
            ? { consent_scopes: options.consentScopes }
            : {}),
          ...(options.voiceSunoPersonaConsent
            ? { voice_suno_persona_consent: true }
            : {}),
        },
      });
      const sessionId = startResponse.json().session_id;
      const prompts = startResponse.json().prompts || [];

      // Create chunk files
      const chunkDir = path.join(
        storageDir,
        "enrollment",
        "raw",
        userId,
        sessionId,
      );
      fs.mkdirSync(chunkDir, { recursive: true });

      for (const prompt of prompts.slice(0, numChunks)) {
        const durationSec =
          prompt.type === "sung" ? options.sungDurationSec || 8 : 4;
        const isSung = prompt.type === "sung";
        const silent = isSung && options.sungSilent === true;
        fs.writeFileSync(
          path.join(chunkDir, `${prompt.id}.wav`),
          createTestWav({
            durationSec,
            silent,
            noiseLevel: silent
              ? 0
              : isSung
                ? options.sungNoiseLevel || 0
                : options.spokenNoiseLevel || 0,
          }),
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

      assert.strictEqual(
        response.statusCode,
        202,
        "should return 202 Accepted",
      );
      const body = response.json();

      // Verify response structure
      assert.strictEqual(body.status, "processing");
      assert.ok(body.job_id, "should return job_id");
      assert.ok(body.voice_profile_id, "should return voice_profile_id");
      assert.ok(body.quality, "should return quality info");
      assert.ok(body.quality.tier, "should have quality tier");
      assert.ok(
        typeof body.quality.score === "number",
        "should have quality score",
      );
      assert.ok(
        typeof body.quality.stars === "number",
        "should have quality stars",
      );
      assert.ok(body.quality.label, "should have quality label");
      assert.ok(
        body.estimated_completion_sec,
        "should have estimated completion",
      );
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
      assert.strictEqual(
        oldProfile.status,
        "deleted",
        "old profile should be deleted",
      );

      // New profile should be active
      const newProfile = await db
        .prepare("SELECT * FROM voice_profiles WHERE id = ?")
        .get(profileId2);
      assert.strictEqual(
        newProfile.status,
        "active",
        "new profile should be active",
      );
    });

    it("accepts My Voice enrollment when sung prompts have substantive audio even if not QC-confirmed singing", async () => {
      // Regression: production users who sang "Ooh ooh ooh" got hard-failed
      // at /complete with E107_SUNG_AUDIO_REQUIRED because the is_singing
      // detector returned false on their preprocessed audio. The new contract
      // gates persona calibration on vad_ratio (substantive voiced content),
      // not the unreliable is_singing classifier. Noisy sung audio (sine +
      // 20% noise) is exactly the kind of input that flipped is_singing false
      // historically; under the new contract it must succeed.
      const userId = uniqueUserId("suno_persona");
      const sessionId = await setupEnrollmentWithChunks(userId, {
        numChunks: 6,
        consentVersion: "1.0",
        sungNoiseLevel: 0.2,
        voiceSunoPersonaConsent: true,
      });

      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/complete",
        headers: { "x-user-id": userId },
        payload: { session_id: sessionId },
      });

      assert.strictEqual(response.statusCode, 202);
      const body = response.json();
      assert.ok(body.voice_profile_id);
      assert.equal(body.voice_provider_profile.provider, "suno");
      assert.equal(
        body.voice_provider_profile.source_audio,
        "sung_calibration",
      );

      const session = await db
        .prepare("SELECT status FROM enrollment_sessions WHERE id = ?")
        .get(sessionId);
      assert.equal(session.status, "completed");

      // Profile is created with status=pending_provider when a Suno persona
      // job is queued (it transitions to active once the persona prepare job
      // completes — see enrollment.js:1712-1714).
      const voiceProfileCount = await db
        .prepare(
          "SELECT COUNT(*) AS count FROM voice_profiles WHERE user_id = ? AND status = 'pending_provider'",
        )
        .get(userId);
      assert.equal(voiceProfileCount.count, 1);
    });

    it("preserves the existing active voice profile when a re-enrollment session fails QC", async () => {
      // Profile-preservation contract: any QC failure on a re-enrollment
      // session must leave the previously active profile untouched. Under
      // the new sung-calibration contract, the realistic failure trigger is
      // silent sung audio — which fails at the per-chunk grade gate
      // (overall grade F → 422 E101) before reaching the sung-calibration
      // path. This test exercises that failure path and verifies the
      // existing profile is preserved.
      const userId = uniqueUserId("suno_persona_preserve");
      const existingSessionId = await setupEnrollmentWithChunks(userId);
      const existingResponse = await app.inject({
        method: "POST",
        url: "/voice/enrollment/complete",
        headers: { "x-user-id": userId },
        payload: { session_id: existingSessionId },
      });
      assert.strictEqual(existingResponse.statusCode, 202);
      const existingProfileId = existingResponse.json().voice_profile_id;

      const failedSessionId = await setupEnrollmentWithChunks(userId, {
        numChunks: 6,
        consentVersion: "1.0",
        sungSilent: true,
        voiceSunoPersonaConsent: true,
      });
      const failedResponse = await app.inject({
        method: "POST",
        url: "/voice/enrollment/complete",
        headers: { "x-user-id": userId },
        payload: { session_id: failedSessionId },
      });

      assert.strictEqual(failedResponse.statusCode, 422);

      const existingProfile = await db
        .prepare("SELECT status FROM voice_profiles WHERE id = ?")
        .get(existingProfileId);
      assert.equal(existingProfile.status, "active");

      const activeProfileCount = await db
        .prepare(
          "SELECT COUNT(*) AS count FROM voice_profiles WHERE user_id = ? AND status = 'active'",
        )
        .get(userId);
      assert.equal(activeProfileCount.count, 1);
    });

    it("queues Suno persona preparation from uploaded sung calibration when sung prompts pass", async () => {
      const userId = uniqueUserId("suno_persona_ready");
      const sessionId = await setupEnrollmentWithChunks(userId, {
        numChunks: 6,
        voiceSunoPersonaConsent: true,
      });

      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/complete",
        headers: { "x-user-id": userId },
        payload: { session_id: sessionId },
      });

      assert.strictEqual(response.statusCode, 202);
      const body = response.json();
      assert.equal(body.voice_provider_profile.provider, "suno");
      assert.equal(body.voice_provider_profile.status, "pending");
      assert.ok(body.voice_provider_profile.job_id);
      assert.equal(
        body.voice_provider_profile.source_audio,
        "sung_calibration",
      );
      assert.ok(body.voice_provider_profile.source_duration_sec >= 10);

      const job = await db
        .prepare("SELECT step_data FROM voice_provider_jobs WHERE id = ?")
        .get(body.voice_provider_profile.job_id);
      assert.ok(job);
      const stepData = JSON.parse(job.step_data);
      assert.match(stepData.source_audio_key, /suno-persona\.wav$/);
      assert.equal(stepData.source_audio_name, "suno-persona.wav");
    });

    it("does not create or replace a profile when sung calibration upload fails", async () => {
      const userId = uniqueUserId("suno_persona_upload_fail");
      const sessionId = await setupEnrollmentWithChunks(userId, {
        numChunks: 6,
        voiceSunoPersonaConsent: true,
      });
      const originalPutFile = storage.putFile.bind(storage);
      storage.putFile = async (args) => {
        if (String(args?.key || "").endsWith("/suno-persona.wav")) {
          throw new Error("simulated suno-persona upload failure");
        }
        return originalPutFile(args);
      };

      try {
        const response = await app.inject({
          method: "POST",
          url: "/voice/enrollment/complete",
          headers: { "x-user-id": userId },
          payload: { session_id: sessionId },
        });

        assert.strictEqual(response.statusCode, 500);
        const body = response.json();
        assert.equal(body.error, "STORAGE_ERROR");
        assert.equal(body.details.reason, "sung_calibration_upload_failed");

        const voiceProfileCount = await db
          .prepare(
            "SELECT COUNT(*) AS count FROM voice_profiles WHERE user_id = ?",
          )
          .get(userId);
        assert.equal(voiceProfileCount.count, 0);

        const jobCount = await db
          .prepare(
            "SELECT COUNT(*) AS count FROM voice_provider_jobs WHERE user_id = ?",
          )
          .get(userId);
        assert.equal(jobCount.count, 0);
      } finally {
        storage.putFile = originalPutFile;
      }
    });

    it("does not queue Suno persona preparation without Suno-specific consent", async () => {
      const userId = uniqueUserId("suno_no_consent");
      const sessionId = await setupEnrollmentWithChunks(userId, {
        consentVersion: "app_v3_without_persona_scope",
      });

      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/complete",
        headers: { "x-user-id": userId },
        payload: { session_id: sessionId },
      });

      assert.strictEqual(response.statusCode, 202);
      assert.deepEqual(response.json().voice_provider_profile, {
        provider: "suno",
        status: "consent_required",
        job_id: null,
      });
      const count = await db
        .prepare(
          "SELECT COUNT(*) AS count FROM voice_provider_jobs WHERE user_id = ?",
        )
        .get(userId);
      assert.equal(count.count, 0);
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

    it("should reject duplicate completion once the session is claimed", async () => {
      const userId = uniqueUserId("claimed");
      const sessionId = await setupEnrollmentWithChunks(userId);

      await db
        .prepare("UPDATE enrollment_sessions SET status = ? WHERE id = ?")
        .run("finalizing", sessionId);

      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/complete",
        headers: { "x-user-id": userId },
        payload: { session_id: sessionId },
      });

      assert.strictEqual(response.statusCode, 409);
      assert.strictEqual(response.json().error, "SESSION_ALREADY_FINALIZED");
    });

    it("should mark missing uploaded audio as failed instead of leaving finalizing stuck", async () => {
      const userId = uniqueUserId("missing_audio");
      const startResponse = await app.inject({
        method: "POST",
        url: "/voice/enrollment/start",
        headers: { "x-user-id": userId },
        payload: { consent_accepted: true },
      });
      const sessionId = startResponse.json().session_id;

      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/complete",
        headers: { "x-user-id": userId },
        payload: { session_id: sessionId },
      });

      assert.strictEqual(response.statusCode, 500);
      assert.strictEqual(response.json().error, "STORAGE_ERROR");
      const session = await db
        .prepare(
          "SELECT status, completed_at FROM enrollment_sessions WHERE id = ?",
        )
        .get(sessionId);
      assert.strictEqual(session.status, "failed_internal");
      assert.ok(session.completed_at);
    });

    it("should mark storage resolution errors as failed instead of leaving finalizing stuck", async () => {
      const userId = uniqueUserId("storage_resolution_error");
      const sessionId = await setupEnrollmentWithChunks(userId);
      const originalObjectExists = storage.objectExists.bind(storage);
      storage.objectExists = async () => {
        throw new Error("simulated objectExists failure");
      };

      try {
        const response = await app.inject({
          method: "POST",
          url: "/voice/enrollment/complete",
          headers: { "x-user-id": userId },
          payload: { session_id: sessionId },
        });

        assert.strictEqual(response.statusCode, 500);
        assert.strictEqual(response.json().error, "STORAGE_ERROR");
        assert.strictEqual(
          response.json().details.reason,
          "chunk_resolution_failed",
        );
        const session = await db
          .prepare(
            "SELECT status, completed_at FROM enrollment_sessions WHERE id = ?",
          )
          .get(sessionId);
        assert.strictEqual(session.status, "failed_internal");
        assert.ok(session.completed_at);
      } finally {
        storage.objectExists = originalObjectExists;
      }
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
      const chunkDir = path.join(
        storageDir,
        "enrollment",
        "raw",
        userId,
        sessionId,
      );
      fs.mkdirSync(chunkDir, { recursive: true });
      for (let i = 0; i < 4; i++) {
        fs.writeFileSync(
          path.join(chunkDir, `p${i + 1}.wav`),
          createTestWav({ durationSec: 4, silent: true }),
        );
      }

      const response = await app.inject({
        method: "POST",
        url: "/voice/enrollment/complete",
        headers: { "x-user-id": userId },
        payload: { session_id: sessionId },
      });

      // Silent audio must be rejected (spec: score >= 70 to pass).
      // The route returns E103 if the QC pipeline detected the silence
      // explicitly, otherwise the score-threshold gate returns E101.
      assert.strictEqual(response.statusCode, 422);
      const body = response.json();
      assert.ok(
        body.error === "E103_NO_AUDIO_DETECTED" ||
          body.error === "E101_AUDIO_TOO_NOISY",
        `expected E101 or E103 rejection for silent audio, got ${body.error}`,
      );
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
      assert.ok(
        ["minimal", "basic", "fair", "good", "excellent"].includes(
          body.quality.tier,
        ),
      );
      assert.ok(body.quality.score >= 0 && body.quality.score <= 100);
      assert.ok(
        typeof body.quality.stars === "number" &&
          body.quality.stars >= 0 &&
          body.quality.stars <= 3,
      );
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
      const chunkDir = path.join(
        storageDir,
        "enrollment",
        "raw",
        userId,
        sessionId,
      );
      fs.mkdirSync(chunkDir, { recursive: true });
      for (let i = 0; i < 4; i++) {
        fs.writeFileSync(
          path.join(chunkDir, `p${i + 1}.wav`),
          createTestWav({ durationSec: 4 }),
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
      assert.strictEqual(body.local_voice_ready, true);
      assert.strictEqual(body.my_voice_ready, false);
    });

    it("should report My Voice ready only after Suno persona is active", async () => {
      const userId = uniqueUserId("profile_persona_ready");
      await app.inject({
        method: "GET",
        url: "/voice/profile",
        headers: { "x-user-id": userId },
      });
      const voiceProfileId = crypto.randomUUID();
      await db
        .prepare(
          "INSERT INTO voice_profiles (id, user_id, status, embedding_ref, quality_score, quality_tier, quality_metrics_json, model_version, consent_version, consent_at, last_verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          voiceProfileId,
          userId,
          "active",
          `voice_profiles/${userId}/${voiceProfileId}/embedding.bin`,
          90,
          "excellent",
          JSON.stringify({ average_score: 90 }),
          "embed_stub",
          "1.0",
          new Date().toISOString(),
          new Date().toISOString(),
          new Date().toISOString(),
        );
      const providerProfile = await createPendingProviderProfile(db, {
        voiceProfileId,
        userId,
        provider: "suno",
        consentScope: REQUIRED_CONSENT_SCOPE,
        metadata: { source: "test" },
      });
      const providerProfileId = providerProfile.id;

      const pendingResponse = await app.inject({
        method: "GET",
        url: "/voice/profile",
        headers: { "x-user-id": userId },
      });
      assert.strictEqual(pendingResponse.statusCode, 200);
      assert.strictEqual(pendingResponse.json().my_voice_ready, false);
      assert.strictEqual(
        pendingResponse.json().pending_voice_provider_profile.ready,
        false,
      );
      assert.strictEqual(
        pendingResponse.json().pending_voice_provider_profile.readiness,
        "preparing",
      );

      const immediatePollResponse = await app.inject({
        method: "GET",
        url: "/voice/profile",
        headers: { "x-user-id": userId },
      });
      assert.strictEqual(
        immediatePollResponse.statusCode,
        200,
        "voice setup polling must not share the delete-profile rate limiter",
      );

      await db
        .prepare(
          "UPDATE voice_provider_profiles SET status = ?, source_task_id = ?, source_audio_id = ? WHERE id = ?",
        )
        .run("persona_submitted", "task_123", "audio_456", providerProfileId);
      await markProviderProfileActive(db, providerProfileId, {
        providerProfileId: "persona_live_test_123",
        model: "voice_persona",
      });

      const readyResponse = await app.inject({
        method: "GET",
        url: "/voice/profile",
        headers: { "x-user-id": userId },
      });
      assert.strictEqual(readyResponse.statusCode, 200);
      assert.strictEqual(readyResponse.json().my_voice_ready, true);
      assert.strictEqual(
        readyResponse.json().voice_provider_profile.ready,
        true,
      );
      assert.strictEqual(
        readyResponse.json().voice_provider_profile.readiness,
        "ready",
      );
    });

    it("should keep current active persona visible while replacement is pending", async () => {
      const userId = uniqueUserId("profile_replacement_pending");
      const now = new Date().toISOString();
      const activeVoiceProfileId = crypto.randomUUID();
      const replacementVoiceProfileId = crypto.randomUUID();

      await db
        .prepare("INSERT INTO users (id, created_at) VALUES (?, ?)")
        .run(userId, now);
      await db
        .prepare(
          "INSERT INTO voice_profiles (id, user_id, status, embedding_ref, quality_score, quality_tier, quality_metrics_json, model_version, consent_version, consent_at, last_verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          activeVoiceProfileId,
          userId,
          "active",
          `voice_profiles/${userId}/${activeVoiceProfileId}/embedding.bin`,
          91,
          "excellent",
          JSON.stringify({ average_score: 91 }),
          "embed_stub",
          "ios_v1",
          now,
          now,
          now,
        );
      await db
        .prepare(
          "INSERT INTO voice_provider_profiles (id, voice_profile_id, user_id, provider, provider_profile_id, status, model, consent_scope, metadata_json, created_at, updated_at, activated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          `vpp_active_${Date.now()}`,
          activeVoiceProfileId,
          userId,
          "suno",
          "persona_live_existing",
          "active",
          "V5_5",
          REQUIRED_CONSENT_SCOPE,
          "{}",
          now,
          now,
          now,
        );
      await db
        .prepare(
          "INSERT INTO voice_profiles (id, user_id, status, embedding_ref, quality_score, quality_tier, quality_metrics_json, model_version, consent_version, consent_at, last_verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          replacementVoiceProfileId,
          userId,
          "pending_provider",
          `voice_profiles/${userId}/${replacementVoiceProfileId}/embedding.bin`,
          96,
          "excellent",
          JSON.stringify({ average_score: 96 }),
          "embed_stub",
          "ios_v1",
          now,
          now,
          new Date(Date.now() + 1000).toISOString(),
        );
      const replacementProvider = await createPendingProviderProfile(db, {
        voiceProfileId: replacementVoiceProfileId,
        userId,
        provider: "suno",
        consentScope: REQUIRED_CONSENT_SCOPE,
        metadata: { source: "replacement_test" },
      });

      const response = await app.inject({
        method: "GET",
        url: "/voice/profile",
        headers: { "x-user-id": userId },
      });

      assert.strictEqual(response.statusCode, 200);
      const body = response.json();
      assert.strictEqual(body.my_voice_ready, true);
      assert.strictEqual(
        body.voice_provider_profile.provider_profile_id,
        "persona_live_existing",
      );
      assert.strictEqual(body.voice_provider_profile.readiness, "ready");
      assert.strictEqual(
        body.pending_voice_provider_profile.id,
        replacementProvider.id,
      );
      assert.strictEqual(
        body.pending_voice_provider_profile.readiness,
        "preparing",
      );
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

      const chunkDir = path.join(
        storageDir,
        "enrollment",
        "raw",
        userId,
        sessionId,
      );
      fs.mkdirSync(chunkDir, { recursive: true });
      for (let i = 0; i < 4; i++) {
        fs.writeFileSync(
          path.join(chunkDir, `p${i + 1}.wav`),
          createTestWav({ durationSec: 4 }),
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
      const chunkDir = path.join(
        storageDir,
        "enrollment",
        "raw",
        userId,
        session_id,
      );
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

      const chunkDir1 = path.join(
        storageDir,
        "enrollment",
        "raw",
        userId,
        session1,
      );
      fs.mkdirSync(chunkDir1, { recursive: true });
      for (let i = 1; i <= 4; i++) {
        fs.writeFileSync(
          path.join(chunkDir1, `p${i}.wav`),
          createTestWav({ durationSec: 4 }),
        );
      }

      const complete1 = await app.inject({
        method: "POST",
        url: "/voice/enrollment/complete",
        headers: { "x-user-id": userId },
        payload: { session_id: session1 },
      });
      const profile1 = complete1.json().voice_profile_id;

      // Second enrollment (should replace first)
      await clearEnrollmentBurstLimit(db, userId);
      const start2 = await app.inject({
        method: "POST",
        url: "/voice/enrollment/start",
        headers: { "x-user-id": userId },
        payload: { consent_accepted: true },
      });
      const session2 = start2.json().session_id;

      const chunkDir2 = path.join(
        storageDir,
        "enrollment",
        "raw",
        userId,
        session2,
      );
      fs.mkdirSync(chunkDir2, { recursive: true });
      for (let i = 1; i <= 4; i++) {
        fs.writeFileSync(
          path.join(chunkDir2, `p${i}.wav`),
          createTestWav({ durationSec: 4 }),
        );
      }

      const complete2 = await app.inject({
        method: "POST",
        url: "/voice/enrollment/complete",
        headers: { "x-user-id": userId },
        payload: { session_id: session2 },
      });
      const profile2 = complete2.json().voice_profile_id;

      // Verify first profile is deleted, second is active
      const dbProfile1 = await db
        .prepare("SELECT status FROM voice_profiles WHERE id = ?")
        .get(profile1);
      const dbProfile2 = await db
        .prepare("SELECT status FROM voice_profiles WHERE id = ?")
        .get(profile2);

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
