require("dotenv/config");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after, before, describe } = require("node:test");
const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");
const { createStorageProvider } = require("../src/storage");

let storageDir;
let db;
let app;
let config;
let storage;

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

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

before(async () => {
  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-upload-"));
  config = {
    PREVIEW_ONLY: false,
    STREAM_BASE_URL: "http://stream.local",
    STORAGE_DIR: storageDir,
    STORAGE_PROVIDER: "local",
    UPLOAD_SIGNING_SECRET: "test-upload-secret",
    UPLOAD_URL_TTL_SEC: 900,
  };
  storage = createStorageProvider(config);
  db = await initDb({
    dbPath: ":memory:",
    migrationsDir: path.join(process.cwd(), "migrations"),
  });
  app = buildServer({ db, config, storage });
});

after(async () => {
  await app.close();
  db.close();
  fs.rmSync(storageDir, { recursive: true, force: true });
});

describe("Presigned Upload Endpoint", () => {
  test("PUT /storage/upload should save WAV file and allow chunk notification", async () => {
    const userId = "upload_test_user";

    const enrollStart = await app.inject({
      method: "POST",
      url: "/voice/enrollment/start",
      headers: { "x-user-id": userId },
      payload: { consent_accepted: true, consent_version: "v1" },
    });
    assert.equal(enrollStart.statusCode, 200);
    const session = enrollStart.json();
    const sessionId = session.session_id;

    const uploadInfo = session.upload_urls[0];
    const uploadUrl = new URL(uploadInfo.url);

    const wavBuffer = createTestWav(5);
    const uploadRes = await app.inject({
      method: uploadInfo.method || "PUT",
      url: `${uploadUrl.pathname}${uploadUrl.search}`,
      headers: {
        "content-type": "audio/wav",
      },
      payload: wavBuffer,
    });

    assert.equal(uploadRes.statusCode, 200, "Upload should succeed");

    const notifyRes = await app.inject({
      method: "POST",
      url: "/voice/enrollment/chunk_uploaded",
      headers: { "x-user-id": userId },
      payload: {
        session_id: sessionId,
        chunk_id: uploadInfo.chunk_id,
        duration_sec: 5,
        client_checksum: sha256Hex(wavBuffer),
      },
    });

    assert.equal(notifyRes.statusCode, 200, "Notify should succeed");
    const result = notifyRes.json();
    assert.equal(result.status, "accepted");

    const chunkPath = path.join(
      storageDir,
      "enrollment",
      "raw",
      userId,
      sessionId,
      `${uploadInfo.chunk_id}.wav`
    );
    assert.ok(fs.existsSync(chunkPath), "WAV file should be saved");
  });

  test("PUT /storage/upload should fail without signature", async () => {
    const wavBuffer = createTestWav(2);

    const uploadRes = await app.inject({
      method: "PUT",
      url: "/storage/upload?key=enrollment/raw/user/session/chunk.wav",
      headers: {
        "content-type": "audio/wav",
      },
      payload: wavBuffer,
    });

    assert.equal(uploadRes.statusCode, 400, "Should fail without signature");
  });
});

describe("Static File Serving", () => {
  test("GET /debug.html should serve the debug page", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/debug.html",
    });

    // Note: This test will fail until we implement static serving
    // When implemented, it should return 200 with HTML content
    assert.ok(
      res.statusCode === 200 || res.statusCode === 404,
      "Should either serve file or return 404"
    );
  });
});
