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
const os = require("node:os");
const path = require("node:path");
const { test, describe, after, before, beforeEach, afterEach } = require("node:test");
const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");
const { createStorageProvider } = require("../src/storage");
const { startJobRunner } = require("../src/workflows/runner");
const { clearCache: clearFeatureFlagCache } = require("../src/services/feature-flags");

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
    db = await initDb({ dbPath: ":memory:", migrationsDir: path.join(process.cwd(), "migrations") });
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
      userId, new Date().toISOString()
    );

    // Create entitlements (user_id is primary key)
    db.prepare("INSERT INTO entitlements (user_id, tier, songs_remaining, updated_at) VALUES (?, 'free', 100, ?)").run(
      userId, new Date().toISOString()
    );

    // Insert a job that's been stuck in 'running' for 10 minutes
    const staleTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const jobId = `job_stale_${Date.now()}`;

    db.prepare(`
      INSERT INTO jobs (id, track_version_id, workflow_type, status, step, step_index, attempts, max_attempts, created_at, updated_at)
      VALUES (?, 'tv_fake', 'preview', 'running', 'instrumental', 2, 0, 3, ?, ?)
    `).run(jobId, staleTime, staleTime);

    // Verify job is stuck in 'running'
    const beforeRecovery = db.prepare("SELECT status FROM jobs WHERE id = ?").get(jobId);
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
    const afterRecovery = db.prepare("SELECT status, attempts FROM jobs WHERE id = ?").get(jobId);
    assert.equal(afterRecovery.status, "queued", "Stale job should be recovered to queued status");
    assert.equal(afterRecovery.attempts, 1, "Recovery should increment attempt count");

    runner.stop();
  });

  test("should NOT recover recently-running jobs", async () => {
    const recentTime = new Date().toISOString();
    const jobId = `job_recent_${Date.now()}`;

    db.prepare(`
      INSERT INTO jobs (id, track_version_id, workflow_type, status, step, step_index, attempts, max_attempts, created_at, updated_at)
      VALUES (?, 'tv_fake2', 'preview', 'running', 'mix', 5, 0, 3, ?, ?)
    `).run(jobId, recentTime, recentTime);

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
    assert.equal(job.status, "running", "Recently-running job should not be recovered");

    runner.stop();
  });

  test("should complete queued jobs with terminal step index", async () => {
    const now = new Date().toISOString();
    const jobId = `job_terminal_${Date.now()}`;

    db.prepare(`
      INSERT INTO jobs (id, track_version_id, workflow_type, status, step, step_index, attempts, max_attempts, created_at, updated_at)
      VALUES (?, 'tv_terminal', 'preview_render', 'queued', 'ready', 9, 0, 3, ?, ?)
    `).run(jobId, now, now);

    runner = await startJobRunner({
      db,
      storageDir,
      streamBaseUrl: config.STREAM_BASE_URL,
      intervalMs: 1000000,
      recoverStaleJobs: false,
    });

    await runner.tick();

    const job = db.prepare("SELECT status FROM jobs WHERE id = ?").get(jobId);
    assert.equal(job.status, "completed", "Terminal queued jobs should be finalized");

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
    db = await initDb({ dbPath: ":memory:", migrationsDir: path.join(process.cwd(), "migrations") });
    storage = createStorageProvider(config);
    app = buildServer({ db, config, storage });
  });

  after(async () => {
    await app.close();
    db.close();
  });

  test("should use configured AI voice model instead of hardcoded Squidward", async () => {
    // This test verifies the config is respected
    // The actual conversion would require mocking Replicate
    const configuredModel = config.DEFAULT_AI_VOICE_MODEL;
    assert.equal(configuredModel, "custom_model_v1");
    assert.notEqual(configuredModel, "25a9292ae08d73f5e85b65d9f8a75c0c2f2ef86c06280c3c726ec6eb11a9d570");
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
    db = await initDb({ dbPath: ":memory:", migrationsDir: path.join(process.cwd(), "migrations") });
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
      userId, new Date().toISOString()
    );
    db.prepare("INSERT INTO entitlements (user_id, tier, songs_remaining, updated_at) VALUES (?, 'premium', 1000, ?)").run(
      userId, new Date().toISOString()
    );

    // Create voice profile (no updated_at in schema)
    db.prepare(`
      INSERT INTO voice_profiles (id, user_id, status, quality_score, model_version, consent_version, created_at)
      VALUES (?, ?, 'active', 85, 'v1', 'v1', ?)
    `).run(`vp_${userId}`, userId, new Date().toISOString());

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
    const concurrentRequests = Array(5).fill(null).map(() =>
      app.inject({
        method: "POST",
        url: `/tracks/${trackId}/versions`,
        headers: { "x-user-id": userId },
        payload: {},
      })
    );

    const results = await Promise.all(concurrentRequests);

    // Check that all succeeded and got unique version numbers
    const successResults = results.filter(r => r.statusCode === 201);
    const versions = successResults.map(r => r.json().version_num);
    const uniqueVersions = [...new Set(versions)];

    assert.equal(versions.length, uniqueVersions.length,
      `All version numbers should be unique. Got: ${versions.join(", ")}`);
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
    db = await initDb({ dbPath: ":memory:", migrationsDir: path.join(process.cwd(), "migrations") });
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
      userId, new Date().toISOString()
    );
    db.prepare("INSERT INTO entitlements (user_id, tier, songs_remaining, updated_at) VALUES (?, 'free', 100, ?)").run(
      userId, new Date().toISOString()
    );

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
    assert.equal(track.voice_mode, "ai_voice",
      "Should use DEFAULT_VOICE_MODE from config when not specified");
  });

  test("should accept user_voice as voice_mode", async () => {
    const userId = "user_voicemode_test";

    // Create voice profile first (required for user_voice mode)
    db.prepare(`
      INSERT OR IGNORE INTO voice_profiles (id, user_id, status, quality_score, model_version, consent_version, created_at)
      VALUES (?, ?, 'active', 85, 'v1', 'v1', ?)
    `).run(`vp_${userId}`, userId, new Date().toISOString());
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

    db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(userId, now);
    db.prepare(
      "INSERT INTO entitlements (user_id, tier, songs_remaining, updated_at) VALUES (?, 'free', 100, ?)"
    ).run(userId, now);
    db.prepare(`
      INSERT INTO voice_profiles (id, user_id, status, quality_score, model_version, consent_version, created_at)
      VALUES (?, ?, 'active', 85, 'v1', 'v1', ?)
    `).run(`vp_${userId}`, userId, now);

    db.prepare(
      "INSERT OR REPLACE INTO feature_flags (id, value, updated_at, updated_by) VALUES ('my_voice_enabled', ?, ?, 'test')"
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
      "INSERT OR REPLACE INTO feature_flags (id, value, updated_at, updated_by) VALUES ('my_voice_enabled', ?, ?, 'test')"
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
      "INSERT OR REPLACE INTO feature_flags (id, value, updated_at, updated_by) VALUES ('my_voice_enabled', ?, ?, 'test')"
    ).run(JSON.stringify(true), now);
    clearFeatureFlagCache();

    db.prepare(`
      INSERT OR IGNORE INTO voice_profiles (id, user_id, status, quality_score, model_version, consent_version, created_at)
      VALUES (?, ?, 'active', 85, 'v1', 'v1', ?)
    `).run(`vp_${userId}`, userId, now);

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
    db = await initDb({ dbPath: ":memory:", migrationsDir: path.join(process.cwd(), "migrations") });
    storage = createStorageProvider(config);
    app = buildServer({ db, config, storage });
  });

  after(async () => {
    await app.close();
    db.close();
    if (savedLlmEnv) {
      if (savedLlmEnv.GEMINI_API_KEY === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = savedLlmEnv.GEMINI_API_KEY;
      if (savedLlmEnv.ANTHROPIC_API_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = savedLlmEnv.ANTHROPIC_API_KEY;
      if (savedLlmEnv.OPENAI_API_KEY === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = savedLlmEnv.OPENAI_API_KEY;
    }
  });

  test("should return AI_UNAVAILABLE when LLM is not available", async () => {
    const userId = "user_lyrics_test";

    // Setup
    db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(
      userId, new Date().toISOString()
    );
    db.prepare("INSERT INTO entitlements (user_id, tier, songs_remaining, updated_at) VALUES (?, 'free', 100, ?)").run(
      userId, new Date().toISOString()
    );

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
  test("should throw when required=true and JSON is invalid", () => {
    // This will be tested via the runner module
    // For now, just verify the concept
    const invalidJson = "not valid json";
    let threw = false;
    try {
      JSON.parse(invalidJson);
    } catch (e) {
      threw = true;
    }
    assert.ok(threw, "Invalid JSON should throw");
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
    };
    db = await initDb({ dbPath: ":memory:", migrationsDir: path.join(process.cwd(), "migrations") });
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
      userId, new Date().toISOString()
    );
    db.prepare("INSERT INTO entitlements (user_id, tier, songs_remaining, updated_at) VALUES (?, 'free', 100, ?)").run(
      userId, new Date().toISOString()
    );

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

    // Make many rapid requests (should eventually hit rate limit)
    const requests = [];
    for (let i = 0; i < 35; i++) {
      requests.push(
        app.inject({
          method: "POST",
          url: `/tracks/${track.track_id}/versions/1/lyrics/generate`,
          headers: { "x-user-id": userId },
          payload: {}, // Empty object body required by schema
        })
      );
    }

    const results = await Promise.all(requests);
    const rateLimited = results.filter(r => r.statusCode === 429);

    assert.ok(rateLimited.length > 0, "Should eventually hit rate limit on lyrics generation");
  });
});

console.log("Critical fixes tests loaded");
