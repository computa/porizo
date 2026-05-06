/**
 * Tests for critical fixes identified in MVP review
 *
 * BATCH 1: Job & Voice Critical Fixes
 * - Stale job recovery
 * - AI voice model configuration
 * - Race condition prevention
 * - Null validation
 * - Voice mode standardization
 */

require("dotenv/config");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const {
  test,
  describe,
  after,
  before,
  beforeEach,
  afterEach,
} = require("node:test");
const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");
const { createStorageProvider } = require("../src/storage");
const { startJobRunner } = require("../src/workflows/runner");
const { convertVoice } = require("../src/providers/voice");
const {
  clearCache: clearFeatureFlagCache,
} = require("../src/services/feature-flags");
const { parseJson } = require("../src/utils/common");

// Test fixtures
let storageDir;
let db;
let app;
let runner;
let config;
let storage;

function insertActiveSunoPersona(userId, voiceProfileId = `vp_${userId}`) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO voice_provider_profiles (
      id, voice_profile_id, user_id, provider, provider_profile_id, status,
      model, consent_scope, created_at, updated_at, activated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `vpp_${userId}`,
    voiceProfileId,
    userId,
    "suno",
    "persona_live_test",
    "active",
    "V5_5",
    "voice_suno_persona_v1",
    now,
    now,
    now,
  );
}

function createTestWav(durationSec = 3, filename = null) {
  const sampleRate = 44100;
  const totalSamples = Math.floor(durationSec * sampleRate);
  const buffer = Buffer.alloc(44 + totalSamples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + totalSamples * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(totalSamples * 2, 40);
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * 440 * t);
    buffer.writeInt16LE(Math.round(sample * 0x7fff), 44 + i * 2);
  }
  return buffer;
}

// ============================================================================
// BATCH 1: Stale Job Recovery Tests
// ============================================================================

describe("Stale Job Recovery", () => {
  before(async () => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-recovery-"));
    config = {
      PREVIEW_ONLY: false,
      STREAM_BASE_URL: "http://stream.local",
      STORAGE_DIR: storageDir,
      STORAGE_PROVIDER: "local",
      UPLOAD_SIGNING_SECRET: "test-upload-secret",
      UPLOAD_URL_TTL_SEC: 900,
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
  });

  test("should recover jobs stuck in 'running' status after timeout", async () => {
    const userId = "user_recovery_test";

    // Create a user (schema: id, created_at, risk_level, locale, country)
    db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(
      userId,
      new Date().toISOString(),
    );

    // Create entitlements (user_id is primary key)
    db.prepare(
      "INSERT INTO entitlements (user_id, tier, songs_remaining, updated_at) VALUES (?, 'free', 100, ?)",
    ).run(userId, new Date().toISOString());

    // Insert a job that's been stuck in 'running' for 10 minutes
    const staleTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const jobId = `job_stale_${Date.now()}`;

    db.prepare(
      `
      INSERT INTO jobs (
        id, track_version_id, workflow_type, status, step, step_index,
        attempts, max_attempts, error_code, error_message, locked_by,
        locked_at, created_at, updated_at
      )
      VALUES (?, 'tv_fake', 'preview', 'running', 'instrumental', 2, 0, 3,
        'E302_PROVIDER_TIMEOUT', 'provider timed out', 'worker_stale', ?, ?, ?)
    `,
    ).run(jobId, staleTime, staleTime, staleTime);

    // Verify job is stuck in 'running'
    const beforeRecovery = db
      .prepare("SELECT status FROM jobs WHERE id = ?")
      .get(jobId);
    assert.equal(beforeRecovery.status, "running");

    // Start runner with recovery enabled
    runner = await startJobRunner({
      db,
      storageDir,
      streamBaseUrl: config.STREAM_BASE_URL,
      intervalMs: 1000000, // Don't auto-run
      recoverStaleJobs: true,
      staleJobTimeoutMinutes: 5,
    });

    // Check that job was recovered to 'queued'
    const afterRecovery = db
      .prepare(
        "SELECT status, attempts, error_code, error_message, locked_by, locked_at FROM jobs WHERE id = ?",
      )
      .get(jobId);
    assert.equal(
      afterRecovery.status,
      "queued",
      "Stale job should be recovered to queued status",
    );
    assert.equal(
      afterRecovery.attempts,
      1,
      "Recovery should increment attempt count",
    );
    assert.equal(afterRecovery.error_code, "E302_PROVIDER_TIMEOUT");
    assert.equal(afterRecovery.error_message, "provider timed out");
    assert.equal(afterRecovery.locked_by, null);
    assert.equal(afterRecovery.locked_at, null);

    runner.stop();
  });

  test("should NOT recover recently-running jobs", async () => {
    const recentTime = new Date().toISOString();
    const jobId = `job_recent_${Date.now()}`;

    db.prepare(
      `
      INSERT INTO jobs (id, track_version_id, workflow_type, status, step, step_index, attempts, max_attempts, created_at, updated_at)
      VALUES (?, 'tv_fake2', 'preview', 'running', 'mix', 5, 0, 3, ?, ?)
    `,
    ).run(jobId, recentTime, recentTime);

    runner = await startJobRunner({
      db,
      storageDir,
      streamBaseUrl: config.STREAM_BASE_URL,
      intervalMs: 1000000,
      recoverStaleJobs: true,
      staleJobTimeoutMinutes: 5,
    });

    // Recent job should NOT be recovered
    const job = db.prepare("SELECT status FROM jobs WHERE id = ?").get(jobId);
    assert.equal(
      job.status,
      "running",
      "Recently-running job should not be recovered",
    );

    runner.stop();
  });

  test("should complete queued jobs with terminal step index", async () => {
    const now = new Date().toISOString();
    const jobId = `job_terminal_${Date.now()}`;

    db.prepare(
      `
      INSERT INTO jobs (id, track_version_id, workflow_type, status, step, step_index, attempts, max_attempts, created_at, updated_at)
      VALUES (?, 'tv_terminal', 'preview_render', 'queued', 'ready', 9, 0, 3, ?, ?)
    `,
    ).run(jobId, now, now);

    runner = await startJobRunner({
      db,
      storageDir,
      streamBaseUrl: config.STREAM_BASE_URL,
      intervalMs: 1000000,
      recoverStaleJobs: false,
    });

    await runner.tick();

    const job = db.prepare("SELECT status FROM jobs WHERE id = ?").get(jobId);
    assert.equal(
      job.status,
      "completed",
      "Terminal queued jobs should be finalized",
    );

    runner.stop();
  });
});

// ============================================================================
// BATCH 1: AI Voice Model Configuration Tests
// ============================================================================

describe("AI Voice Model Configuration", () => {
  before(async () => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-voice-"));
    config = {
      PREVIEW_ONLY: false,
      STREAM_BASE_URL: "http://stream.local",
      STORAGE_DIR: storageDir,
      DEFAULT_AI_VOICE_MODEL: "custom_model_v1", // Configurable model
      STORAGE_PROVIDER: "local",
      UPLOAD_SIGNING_SECRET: "test-upload-secret",
      UPLOAD_URL_TTL_SEC: 900,
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
  });

  test("should use configured AI voice model instead of hardcoded Squidward", async () => {
    let capturedBody = null;
    const server = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/v1/predictions") {
        let raw = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => {
          raw += chunk;
        });
        req.on("end", () => {
          capturedBody = JSON.parse(raw);
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "stop_after_capture" }));
        });
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    try {
      const { port } = server.address();
      await assert.rejects(
        convertVoice({
          storageDir,
          track: { id: "track_ai_model", user_id: "user_ai_model" },
          trackVersion: { version_num: 1 },
          kind: "preview",
          providerConfig: {
            live: true,
            token: "replicate_token",
            modelVersion: "replicate_model_version",
            baseUrl: `http://127.0.0.1:${port}`,
            rvcModel: config.DEFAULT_AI_VOICE_MODEL,
            timeoutMs: 1000,
          },
          inputUrl: "https://example.test/guide.wav",
        }),
        /provider_error/,
      );
    } finally {
      server.close();
      await once(server, "close");
    }

    assert.equal(capturedBody.input.rvc_model, "custom_model_v1");
    assert.notEqual(capturedBody.input.rvc_model, "Squidward");
  });
});

// ============================================================================
// BATCH 1: Race Condition Prevention Tests
// ============================================================================

describe("Version Increment Race Condition", () => {
  before(async () => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-race-"));
    config = {
      PREVIEW_ONLY: false,
      STREAM_BASE_URL: "http://stream.local",
      STORAGE_DIR: storageDir,
      STORAGE_PROVIDER: "local",
      UPLOAD_SIGNING_SECRET: "test-upload-secret",
      UPLOAD_URL_TTL_SEC: 900,
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
  });

  test("should handle concurrent version increments atomically", async () => {
    const userId = "user_race_test";

    // Create user and entitlements
    db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(
      userId,
      new Date().toISOString(),
    );
    db.prepare(
      "INSERT INTO entitlements (user_id, tier, songs_remaining, updated_at) VALUES (?, 'premium', 1000, ?)",
    ).run(userId, new Date().toISOString());

    // Create voice profile (no updated_at in schema)
    db.prepare(
      `
      INSERT INTO voice_profiles (id, user_id, status, quality_score, model_version, consent_version, created_at)
      VALUES (?, ?, 'active', 85, 'v1', 'v1', ?)
    `,
    ).run(`vp_${userId}`, userId, new Date().toISOString());

    // Create track
    const trackRes = await app.inject({
      method: "POST",
      url: "/tracks",
      headers: { "x-user-id": userId },
      payload: {
        title: "Race Test Song",
        recipient_name: "Test",
        message: "Testing race conditions",
        occasion: "birthday",
        style: "pop",
        voice_mode: "ai_voice",
      },
    });

    assert.equal(trackRes.statusCode, 201);
    const track = trackRes.json();
    const trackId = track.track_id;

    // Simulate concurrent version creation requests
    const concurrentRequests = Array(5)
      .fill(null)
      .map((_, index) =>
        app.inject({
          method: "POST",
          url: `/tracks/${trackId}/versions`,
          headers: { "x-user-id": userId },
          payload: { params: { variant_index: index } },
        }),
      );

    const results = await Promise.all(concurrentRequests);

    // Check that all succeeded and got unique version numbers
    const successResults = results.filter((r) => r.statusCode === 201);
    const versions = successResults.map((r) => r.json().version_num);
    const uniqueVersions = [...new Set(versions)];

    assert.equal(
      successResults.length,
      5,
      "All concurrent version creation requests should succeed",
    );
    assert.equal(
      versions.length,
      uniqueVersions.length,
      `All version numbers should be unique. Got: ${versions.join(", ")}`,
    );
    assert.deepEqual(
      versions.slice().sort((a, b) => a - b),
      [1, 2, 3, 4, 5],
      "Concurrent inserts should allocate a gap-free sequence",
    );
    const versionRows = db
      .prepare(
        "SELECT version_num FROM track_versions WHERE track_id = ? ORDER BY version_num ASC",
      )
      .all(trackId)
      .map((row) => row.version_num);
    assert.deepEqual(versionRows, [1, 2, 3, 4, 5]);
  });
});

// ============================================================================
// BATCH 1: Voice Mode Standardization Tests
// ============================================================================

describe("Voice Mode Standardization", () => {
  before(async () => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-voicemode-"));
    config = {
      PREVIEW_ONLY: false,
      STREAM_BASE_URL: "http://stream.local",
      STORAGE_DIR: storageDir,
      DEFAULT_VOICE_MODE: "ai_voice", // Config default
      STORAGE_PROVIDER: "local",
      UPLOAD_SIGNING_SECRET: "test-upload-secret",
      UPLOAD_URL_TTL_SEC: 900,
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
  });

  test("should apply DEFAULT_VOICE_MODE from config when not specified", async () => {
    const userId = "user_voicemode_test";

    // Setup user
    db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(
      userId,
      new Date().toISOString(),
    );
    db.prepare(
      "INSERT INTO entitlements (user_id, tier, songs_remaining, updated_at) VALUES (?, 'free', 100, ?)",
    ).run(userId, new Date().toISOString());

    // Create track WITHOUT specifying voice_mode
    const trackRes = await app.inject({
      method: "POST",
      url: "/tracks",
      headers: { "x-user-id": userId },
      payload: {
        title: "Default Mode Song",
        recipient_name: "Test",
        message: "Testing default mode",
        occasion: "birthday",
        style: "pop",
        // voice_mode NOT specified
      },
    });

    assert.equal(trackRes.statusCode, 201);
    const track = trackRes.json();

    // Should use config default
    assert.equal(
      track.voice_mode,
      "ai_voice",
      "Should use DEFAULT_VOICE_MODE from config when not specified",
    );
  });

  test("should accept user_voice as voice_mode", async () => {
    const userId = "user_voicemode_user_voice_test";
    const now = new Date().toISOString();

    db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(
      userId,
      now,
    );
    db.prepare(
      "INSERT INTO entitlements (user_id, tier, songs_remaining, updated_at) VALUES (?, 'free', 100, ?)",
    ).run(userId, now);

    // Create voice profile first (required for user_voice mode)
    db.prepare(
      `
      INSERT OR IGNORE INTO voice_profiles (id, user_id, status, quality_score, model_version, consent_version, created_at)
      VALUES (?, ?, 'active', 85, 'v1', 'v1', ?)
    `,
    ).run(`vp_${userId}`, userId, now);
    insertActiveSunoPersona(userId);

    const trackRes = await app.inject({
      method: "POST",
      url: "/tracks",
      headers: { "x-user-id": userId },
      payload: {
        title: "User Voice Song",
        recipient_name: "Test",
        message: "Testing user voice mode",
        occasion: "birthday",
        style: "pop",
        voice_mode: "user_voice",
      },
    });

    assert.equal(trackRes.statusCode, 201);
    const track = trackRes.json();
    assert.equal(track.voice_mode, "user_voice");
  });

  test("should coerce user_voice to ai_voice when my_voice_enabled is disabled", async () => {
    const userId = "user_voicemode_disabled_test";
    const now = new Date().toISOString();

    db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(
      userId,
      now,
    );
    db.prepare(
      "INSERT INTO entitlements (user_id, tier, songs_remaining, updated_at) VALUES (?, 'free', 100, ?)",
    ).run(userId, now);
    db.prepare(
      `
      INSERT INTO voice_profiles (id, user_id, status, quality_score, model_version, consent_version, created_at)
      VALUES (?, ?, 'active', 85, 'v1', 'v1', ?)
    `,
    ).run(`vp_${userId}`, userId, now);

    db.prepare(
      "INSERT OR REPLACE INTO feature_flags (id, value, updated_at, updated_by) VALUES ('my_voice_enabled', ?, ?, 'test')",
    ).run(JSON.stringify(false), now);

    const createRes = await app.inject({
      method: "POST",
      url: "/tracks",
      headers: { "x-user-id": userId },
      payload: {
        title: "My Voice Disabled Song",
        recipient_name: "Test",
        message: "Should downgrade to AI voice",
        occasion: "birthday",
        style: "pop",
        voice_mode: "user_voice",
      },
    });

    assert.equal(createRes.statusCode, 201);
    const createdTrack = createRes.json();
    assert.equal(createdTrack.voice_mode, "ai_voice");

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/tracks/${createdTrack.track_id}/voice_mode`,
      headers: { "x-user-id": userId },
      payload: { voice_mode: "user_voice" },
    });

    assert.equal(patchRes.statusCode, 200);
    assert.equal(patchRes.json().voice_mode, "ai_voice");
  });

  test("should require enrollment when switching an existing track to user_voice without a profile", async () => {
    const userId = "user_voice_patch_no_profile_test";
    const now = new Date().toISOString();

    db.prepare(
      "INSERT OR REPLACE INTO feature_flags (id, value, updated_at, updated_by) VALUES ('my_voice_enabled', ?, ?, 'test')",
    ).run(JSON.stringify(true), now);
    clearFeatureFlagCache();

    const createRes = await app.inject({
      method: "POST",
      url: "/tracks",
      headers: { "x-user-id": userId },
      payload: {
        title: "Patch Needs Voice",
        recipient_name: "Test",
        message: "Should request voice enrollment",
        occasion: "birthday",
        style: "pop",
        voice_mode: "ai_voice",
      },
    });
    assert.equal(createRes.statusCode, 201);

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/tracks/${createRes.json().track_id}/voice_mode`,
      headers: { "x-user-id": userId },
      payload: { voice_mode: "user_voice" },
    });

    assert.equal(patchRes.statusCode, 422);
    assert.equal(patchRes.json().error, "NO_VOICE_PROFILE");
    assert.equal(patchRes.json().requires_voice_enrollment, true);
  });

  test("should require voice setup when switching to user_voice with only a legacy local profile", async () => {
    const userId = "user_voice_patch_legacy_profile_test";
    const now = new Date().toISOString();

    db.prepare(
      "INSERT OR REPLACE INTO feature_flags (id, value, updated_at, updated_by) VALUES ('my_voice_enabled', ?, ?, 'test')",
    ).run(JSON.stringify(true), now);
    clearFeatureFlagCache();

    db.prepare(
      `
      INSERT OR IGNORE INTO voice_profiles (id, user_id, status, quality_score, model_version, consent_version, created_at)
      VALUES (?, ?, 'active', 85, 'v1', 'v1', ?)
    `,
    ).run(`vp_${userId}`, userId, now);

    const createRes = await app.inject({
      method: "POST",
      url: "/tracks",
      headers: { "x-user-id": userId },
      payload: {
        title: "Patch Needs Persona",
        recipient_name: "Test",
        message: "Should request voice setup",
        occasion: "birthday",
        style: "pop",
        voice_mode: "ai_voice",
      },
    });
    assert.equal(createRes.statusCode, 201);

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/tracks/${createRes.json().track_id}/voice_mode`,
      headers: { "x-user-id": userId },
      payload: { voice_mode: "user_voice" },
    });

    assert.equal(patchRes.statusCode, 422);
    assert.equal(patchRes.json().error, "SUNO_VOICE_PERSONA_SETUP_REQUIRED");
    assert.equal(patchRes.json().requires_voice_enrollment, true);
  });
});

// ============================================================================
// BATCH 2: Error Handling Tests
// ============================================================================

describe("Error Handling - Lyrics Unavailable", () => {
  let savedLlmEnv;

  before(async () => {
    savedLlmEnv = {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    };
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;

    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-lyrics-"));
    config = {
      PREVIEW_ONLY: false,
      STREAM_BASE_URL: "http://stream.local",
      STORAGE_DIR: storageDir,
      STORAGE_PROVIDER: "local",
      UPLOAD_SIGNING_SECRET: "test-upload-secret",
      UPLOAD_URL_TTL_SEC: 900,
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
    if (savedLlmEnv) {
      if (savedLlmEnv.GEMINI_API_KEY === undefined)
        delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = savedLlmEnv.GEMINI_API_KEY;
      if (savedLlmEnv.ANTHROPIC_API_KEY === undefined)
        delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = savedLlmEnv.ANTHROPIC_API_KEY;
      if (savedLlmEnv.OPENAI_API_KEY === undefined)
        delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = savedLlmEnv.OPENAI_API_KEY;
    }
  });

  test("should return AI_UNAVAILABLE when LLM is not available", async () => {
    const userId = "user_lyrics_test";

    // Setup
    db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(
      userId,
      new Date().toISOString(),
    );
    db.prepare(
      "INSERT INTO entitlements (user_id, tier, songs_remaining, updated_at) VALUES (?, 'free', 100, ?)",
    ).run(userId, new Date().toISOString());

    // Create track
    const trackRes = await app.inject({
      method: "POST",
      url: "/tracks",
      headers: { "x-user-id": userId },
      payload: {
        title: "Lyrics Test",
        recipient_name: "Test",
        message: "Testing lyrics",
        occasion: "birthday",
        style: "pop",
        voice_mode: "ai_voice",
      },
    });

    const track = trackRes.json();

    // Create a version first (required before generating lyrics)
    const versionRes = await app.inject({
      method: "POST",
      url: `/tracks/${track.track_id}/versions`,
      headers: { "x-user-id": userId },
      payload: {},
    });
    assert.equal(versionRes.statusCode, 201, "Version creation should succeed");

    // Generate lyrics (should return AI_UNAVAILABLE since no LLM key configured)
    const lyricsRes = await app.inject({
      method: "POST",
      url: `/tracks/${track.track_id}/versions/1/lyrics/generate`,
      headers: { "x-user-id": userId },
      payload: {}, // Empty object body required by schema
    });

    assert.equal(lyricsRes.statusCode, 503);
    const body = lyricsRes.json();
    assert.equal(body.error, "AI_UNAVAILABLE");
  });
});

// ============================================================================
// BATCH 2: Parse JSON Required Mode Tests
// ============================================================================

describe("parseJson with required mode", () => {
  test("required=true throws on invalid JSON with E501 prefix", () => {
    assert.throws(
      () => parseJson("not valid json", null, "test_ctx", { required: true }),
      /E501_PARSE_ERROR.*test_ctx/,
    );
  });
  test("required=true throws on empty value", () => {
    assert.throws(
      () => parseJson("", null, "empty_ctx", { required: true }),
      /E501_PARSE_ERROR.*empty_ctx.*empty/,
    );
    assert.throws(
      () => parseJson(null, null, "null_ctx", { required: true }),
      /E501_PARSE_ERROR.*null_ctx.*empty/,
    );
  });
  test("required=false (default) returns fallback on invalid JSON", () => {
    const fallback = { default: true };
    assert.deepStrictEqual(
      parseJson("not valid json", fallback, "lenient"),
      fallback,
    );
  });
  test("returns parsed value on valid JSON regardless of required flag", () => {
    assert.deepStrictEqual(parseJson('{"a":1}', {}, "ok"), { a: 1 });
    assert.deepStrictEqual(parseJson('{"a":1}', {}, "ok", { required: true }), {
      a: 1,
    });
  });
});

// ============================================================================
// BATCH 3: Rate Limiting Tests
// ============================================================================

describe("Rate Limiting - Lyrics Generation", () => {
  before(async () => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-ratelimit-"));
    config = {
      PREVIEW_ONLY: false,
      STREAM_BASE_URL: "http://stream.local",
      STORAGE_DIR: storageDir,
      STORAGE_PROVIDER: "local",
      UPLOAD_SIGNING_SECRET: "test-upload-secret",
      UPLOAD_URL_TTL_SEC: 900,
      generateLyricsFn: async () => ({
        lyrics: {
          title: "For Test",
          anchor_line: "Test, this bright birthday song is for you",
          sections: [
            {
              name: "Verse",
              lines: ["Test, this bright birthday song is for you"],
            },
          ],
        },
        lyrics_status: "draft",
        provider: "stub",
        model: "test",
        quality_score: 0.9,
      }),
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
  });

  test("should rate limit lyrics generation", async () => {
    const userId = "user_ratelimit_test";

    // Setup
    db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(
      userId,
      new Date().toISOString(),
    );
    db.prepare(
      "INSERT INTO entitlements (user_id, tier, songs_remaining, updated_at) VALUES (?, 'free', 100, ?)",
    ).run(userId, new Date().toISOString());

    // Create track
    const trackRes = await app.inject({
      method: "POST",
      url: "/tracks",
      headers: { "x-user-id": userId },
      payload: {
        title: "Rate Limit Test",
        recipient_name: "Test",
        message: "Testing rate limits",
        occasion: "birthday",
        style: "pop",
        voice_mode: "ai_voice",
      },
    });

    const track = trackRes.json();

    // Create a version first (required before generating lyrics)
    const versionRes = await app.inject({
      method: "POST",
      url: `/tracks/${track.track_id}/versions`,
      headers: { "x-user-id": userId },
      payload: {},
    });
    assert.equal(versionRes.statusCode, 201, "Version creation should succeed");

    // Make enough sequential requests to prove the successful window and the
    // blocked window. The generator is stubbed so this test is about rate
    // limiting, not external LLM availability.
    const results = [];
    for (let i = 0; i < 35; i++) {
      results.push(
        await app.inject({
          method: "POST",
          url: `/tracks/${track.track_id}/versions/1/lyrics/generate`,
          headers: { "x-user-id": userId },
          payload: {}, // Empty object body required by schema
        }),
      );
    }

    const firstWindow = results.slice(0, 30);
    const overLimit = results.slice(30);

    assert.ok(
      firstWindow.every((r) => r.statusCode === 200),
      `Expected first 30 requests to succeed, got ${firstWindow
        .map((r) => r.statusCode)
        .join(", ")}`,
    );
    assert.ok(
      overLimit.every((r) => r.statusCode === 429),
      `Expected requests after the quota to be 429, got ${overLimit
        .map((r) => r.statusCode)
        .join(", ")}`,
    );
  });
});

// ============================================================================
// BATCH 4: Voice Provider Lane Tests
// ============================================================================

describe("Voice Provider Runner Lane", () => {
  let oldLimit;

  beforeEach(() => {
    oldLimit = process.env.MAX_CONCURRENT_VOICE_PROVIDER_JOBS;
  });

  afterEach(() => {
    if (oldLimit === undefined) {
      delete process.env.MAX_CONCURRENT_VOICE_PROVIDER_JOBS;
    } else {
      process.env.MAX_CONCURRENT_VOICE_PROVIDER_JOBS = oldLimit;
    }
  });

  test("should claim no more than MAX_CONCURRENT_VOICE_PROVIDER_JOBS", async () => {
    process.env.MAX_CONCURRENT_VOICE_PROVIDER_JOBS = "2";
    const localDb = await initDb({
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    const now = new Date().toISOString();
    localDb
      .prepare("INSERT INTO users (id, created_at) VALUES (?, ?)")
      .run("vp_lane_user", now);
    for (let i = 1; i <= 3; i++) {
      localDb
        .prepare(
          `INSERT INTO voice_profiles (
            id, user_id, status, quality_score, model_version, consent_version, created_at
          ) VALUES (?, ?, 'active', 90, 'test', 'voice_suno_persona_v1', ?)`,
        )
        .run(`vp_lane_voice_${i}`, "vp_lane_user", now);
      localDb
        .prepare(
          `INSERT INTO voice_provider_profiles (
            id, voice_profile_id, user_id, provider, status, consent_scope, created_at, updated_at
          ) VALUES (?, ?, ?, 'suno', 'pending', 'voice_suno_persona_v1', ?, ?)`,
        )
        .run(`vpp_lane_${i}`, `vp_lane_voice_${i}`, "vp_lane_user", now, now);
      localDb
        .prepare(
          `INSERT INTO voice_provider_jobs (
            id, voice_profile_id, user_id, provider, voice_provider_profile_id,
            status, step, attempts, max_attempts, step_data, created_at, updated_at
          ) VALUES (?, ?, ?, 'suno', ?, 'pending', 'prepare_persona', 0, 3, '{}', ?, ?)`,
        )
        .run(
          `vpj_lane_${i}`,
          `vp_lane_voice_${i}`,
          "vp_lane_user",
          `vpp_lane_${i}`,
          now,
          now,
        );
    }

    const blockers = [];
    let started = 0;
    const laneRunner = await startJobRunner({
      db: localDb,
      storageDir: os.tmpdir(),
      streamBaseUrl: "http://stream.local",
      intervalMs: 1_000_000,
      recoverStaleJobs: false,
      voiceProviderJobRunner: async () => {
        started++;
        await new Promise((resolve) => blockers.push(resolve));
      },
    });

    try {
      await laneRunner.tickVoiceProviderJobs();
      assert.equal(started, 2);
      assert.equal(laneRunner.getActiveVoiceProviderJobs(), 2);
      assert.equal(laneRunner.getProcessingVoiceProviderJobIds().length, 2);
      const pending = localDb
        .prepare(
          "SELECT COUNT(*) AS count FROM voice_provider_jobs WHERE status = 'pending'",
        )
        .get();
      assert.equal(
        pending.count,
        3,
        "Lane runner should not mark jobs running before the worker claims them",
      );
    } finally {
      blockers.forEach((resolve) => resolve());
      await new Promise((resolve) => setImmediate(resolve));
      laneRunner.stop();
      localDb.close();
    }
  });

  test("should disable the voice-provider lane when its table is unavailable", async () => {
    process.env.MAX_CONCURRENT_VOICE_PROVIDER_JOBS = "1";
    const localDb = await initDb({
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    localDb.prepare("DROP TABLE voice_provider_jobs").run();
    const laneRunner = await startJobRunner({
      db: localDb,
      storageDir: os.tmpdir(),
      streamBaseUrl: "http://stream.local",
      intervalMs: 1_000_000,
      recoverStaleJobs: false,
    });

    try {
      await laneRunner.tickVoiceProviderJobs();
      assert.equal(laneRunner.isVoiceProviderLaneDisabled(), true);
      await laneRunner.tickVoiceProviderJobs();
    } finally {
      laneRunner.stop();
      localDb.close();
    }
  });
});

console.log("Critical fixes tests loaded");
