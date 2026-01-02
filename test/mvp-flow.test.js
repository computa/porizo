require("dotenv/config");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after, before } = require("node:test");
const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");
const { startJobRunner } = require("../src/workflows/runner");

let storageDir;
let db;
let app;
let runner;
let config;

before(async () => {
  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-"));
  config = {
    PREVIEW_ONLY: false,
    STREAM_BASE_URL: "http://stream.local",
    STORAGE_DIR: storageDir,
  };
  db = await initDb({ dbPath: ":memory:", migrationsDir: path.join(process.cwd(), "migrations") });
  app = buildServer({ db, config });
  runner = startJobRunner({
    db,
    storageDir,
    streamBaseUrl: config.STREAM_BASE_URL,
    intervalMs: 1000000,
  });
});

after(async () => {
  runner.stop();
  await app.close();
  db.close();
});

// Helper to create test WAV files
function createTestWav(durationSec = 3) {
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

test("mvp flow: enrollment -> preview -> share -> full render", async () => {
  const userId = "user_123";
  const enrollStart = await app.inject({
    method: "POST",
    url: "/voice/enrollment/start",
    headers: { "x-user-id": userId },
    payload: { consent_accepted: true, consent_version: "v1" },
  });
  assert.equal(enrollStart.statusCode, 200);
  const session = enrollStart.json();

  // Create test audio chunks for QC validation
  const chunkDir = path.join(storageDir, "enrollment", "raw", userId, session.session_id);
  fs.mkdirSync(chunkDir, { recursive: true });
  for (let i = 0; i < 4; i++) {
    fs.writeFileSync(path.join(chunkDir, `chunk_${i}.wav`), createTestWav(3));
  }

  const enrollComplete = await app.inject({
    method: "POST",
    url: "/voice/enrollment/complete",
    headers: { "x-user-id": userId },
    payload: { session_id: session.session_id },
  });
  assert.equal(enrollComplete.statusCode, 202);

  const profile = await app.inject({
    method: "GET",
    url: "/voice/profile",
    headers: { "x-user-id": userId },
  });
  assert.equal(profile.statusCode, 200);

  const track = await app.inject({
    method: "POST",
    url: "/tracks",
    headers: { "x-user-id": userId },
    payload: {
      title: "Happy Birthday",
      occasion: "birthday",
      recipient_name: "Sam",
      style: "pop",
      duration_target: 60,
      voice_mode: "ai_voice", // Use RVC (Replicate) instead of Seed-VC to avoid HuggingFace GPU quota issues
      message: "Thanks for being amazing!",
    },
  });
  assert.equal(track.statusCode, 201);
  const trackId = track.json().track_id;

  const version = await app.inject({
    method: "POST",
    url: `/tracks/${trackId}/versions`,
    headers: { "x-user-id": userId },
    payload: { params: { lyrics_style: "heartfelt" }, render_type: "preview" },
  });
  assert.equal(version.statusCode, 201);

  const generateLyrics = await app.inject({
    method: "POST",
    url: `/tracks/${trackId}/versions/1/lyrics/generate`,
    headers: { "x-user-id": userId },
    payload: {},
  });
  assert.equal(generateLyrics.statusCode, 200);

  const approveLyrics = await app.inject({
    method: "POST",
    url: `/tracks/${trackId}/versions/1/lyrics/approve`,
    headers: { "x-user-id": userId },
    payload: {},
  });
  assert.equal(approveLyrics.statusCode, 200);

  const renderPreview = await app.inject({
    method: "POST",
    url: `/tracks/${trackId}/versions/1/render_preview`,
    headers: { "x-user-id": userId },
    payload: {},
  });
  assert.equal(renderPreview.statusCode, 202);
  const previewJobId = renderPreview.json().job_id;

  for (let i = 0; i < 12; i += 1) {
    await runner.tick();
  }

  const previewJob = await app.inject({
    method: "GET",
    url: `/jobs/${previewJobId}`,
    headers: { "x-user-id": userId },
  });
  assert.equal(previewJob.statusCode, 200);
  assert.equal(previewJob.json().status, "completed");

  const share = await app.inject({
    method: "POST",
    url: `/tracks/${trackId}/share`,
    headers: { "x-user-id": userId },
    payload: { version_num: 1 },
  });
  assert.equal(share.statusCode, 200);
  const shareId = share.json().share_id;
  const claimPin = share.json().claim_pin; // PIN required for claim security

  const shareGet = await app.inject({
    method: "GET",
    url: `/share/${shareId}`,
  });
  assert.equal(shareGet.statusCode, 200);
  assert.equal(shareGet.json().status, "unbound");

  const claim = await app.inject({
    method: "POST",
    url: `/share/${shareId}/claim`,
    payload: { device_id: "ios-idfv-123", platform: "ios", app_version: "1.0.0", pin: claimPin },
  });
  assert.equal(claim.statusCode, 200);

  const stream = await app.inject({
    method: "GET",
    url: `/share/${shareId}/stream`,
    headers: { "x-device-id": "ios-idfv-123", "x-platform": "ios" },
  });
  assert.equal(stream.statusCode, 200);

  const key = await app.inject({
    method: "GET",
    url: `/share/${shareId}/key`,
    headers: { "x-device-id": "ios-idfv-123", "x-platform": "ios" },
  });
  assert.equal(key.statusCode, 200);

  const renderFull = await app.inject({
    method: "POST",
    url: `/tracks/${trackId}/versions/1/render_full`,
    headers: { "x-user-id": userId },
    payload: { confirm_credit_spend: true },
  });
  assert.equal(renderFull.statusCode, 202);
  const fullJobId = renderFull.json().job_id;

  for (let i = 0; i < 12; i += 1) {
    await runner.tick();
  }

  const fullJob = await app.inject({
    method: "GET",
    url: `/jobs/${fullJobId}`,
    headers: { "x-user-id": userId },
  });
  assert.equal(fullJob.statusCode, 200);
  assert.equal(fullJob.json().status, "completed");
});
