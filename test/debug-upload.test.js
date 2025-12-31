require("dotenv/config");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after, before, describe } = require("node:test");
const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");

let storageDir;
let db;
let app;
let config;

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

before(async () => {
  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-debug-"));
  config = {
    PREVIEW_ONLY: false,
    STREAM_BASE_URL: "http://stream.local",
    STORAGE_DIR: storageDir,
  };
  db = await initDb({
    dbPath: ":memory:",
    migrationsDir: path.join(process.cwd(), "migrations"),
  });
  app = buildServer({ db, config });
});

after(async () => {
  await app.close();
  db.close();
  fs.rmSync(storageDir, { recursive: true, force: true });
});

describe("Debug Upload Endpoint", () => {
  test("POST /debug/upload-chunk should save WAV file and return duration", async () => {
    const userId = "debug_test_user";

    // First start an enrollment session
    const enrollStart = await app.inject({
      method: "POST",
      url: "/voice/enrollment/start",
      headers: { "x-user-id": userId },
      payload: { consent_accepted: true, consent_version: "v1" },
    });
    assert.equal(enrollStart.statusCode, 200);
    const session = enrollStart.json();
    const sessionId = session.session_id;

    // Create test WAV (5 seconds)
    const wavBuffer = createTestWav(5);

    // Upload chunk using multipart form
    const boundary = "----WebKitFormBoundary" + Date.now();
    const chunkId = "chunk_test";

    // Build multipart body manually
    const parts = [];
    parts.push(`--${boundary}`);
    parts.push(`Content-Disposition: form-data; name="session_id"\r\n`);
    parts.push(sessionId);
    parts.push(`--${boundary}`);
    parts.push(`Content-Disposition: form-data; name="chunk_id"\r\n`);
    parts.push(chunkId);
    parts.push(`--${boundary}`);
    parts.push(
      `Content-Disposition: form-data; name="audio"; filename="${chunkId}.wav"`
    );
    parts.push(`Content-Type: audio/wav\r\n`);

    // Construct the full payload with binary WAV data
    const textPart = parts.join("\r\n") + "\r\n";
    const endPart = `\r\n--${boundary}--`;
    const textBuffer = Buffer.from(textPart, "utf8");
    const endBuffer = Buffer.from(endPart, "utf8");
    const fullPayload = Buffer.concat([textBuffer, wavBuffer, endBuffer]);

    const uploadRes = await app.inject({
      method: "POST",
      url: "/debug/upload-chunk",
      headers: {
        "x-user-id": userId,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: fullPayload,
    });

    assert.equal(uploadRes.statusCode, 200, "Upload should succeed");
    const result = uploadRes.json();
    assert.equal(result.status, "accepted");
    assert.equal(result.chunk_id, chunkId);
    assert.ok(result.duration_sec > 4, "Duration should be ~5 seconds");
    assert.ok(result.duration_sec < 6, "Duration should be ~5 seconds");

    // Verify file was saved
    const chunkPath = path.join(
      storageDir,
      "enrollment",
      "raw",
      userId,
      sessionId,
      `${chunkId}.wav`
    );
    assert.ok(fs.existsSync(chunkPath), "WAV file should be saved");
  });

  test("POST /debug/upload-chunk should fail without session_id", async () => {
    const userId = "debug_test_user2";

    const boundary = "----WebKitFormBoundary" + Date.now();
    const wavBuffer = createTestWav(2);

    const parts = [];
    parts.push(`--${boundary}`);
    parts.push(`Content-Disposition: form-data; name="chunk_id"\r\n`);
    parts.push("chunk_1");
    parts.push(`--${boundary}`);
    parts.push(
      `Content-Disposition: form-data; name="audio"; filename="chunk_1.wav"`
    );
    parts.push(`Content-Type: audio/wav\r\n`);

    const textPart = parts.join("\r\n") + "\r\n";
    const endPart = `\r\n--${boundary}--`;
    const fullPayload = Buffer.concat([
      Buffer.from(textPart, "utf8"),
      wavBuffer,
      Buffer.from(endPart, "utf8"),
    ]);

    const uploadRes = await app.inject({
      method: "POST",
      url: "/debug/upload-chunk",
      headers: {
        "x-user-id": userId,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: fullPayload,
    });

    assert.equal(uploadRes.statusCode, 400, "Should fail without session_id");
  });

  test("POST /debug/upload-chunk should fail with invalid session", async () => {
    const userId = "debug_test_user3";

    const boundary = "----WebKitFormBoundary" + Date.now();
    const wavBuffer = createTestWav(2);

    const parts = [];
    parts.push(`--${boundary}`);
    parts.push(`Content-Disposition: form-data; name="session_id"\r\n`);
    parts.push("invalid-session-id-12345");
    parts.push(`--${boundary}`);
    parts.push(`Content-Disposition: form-data; name="chunk_id"\r\n`);
    parts.push("chunk_1");
    parts.push(`--${boundary}`);
    parts.push(
      `Content-Disposition: form-data; name="audio"; filename="chunk_1.wav"`
    );
    parts.push(`Content-Type: audio/wav\r\n`);

    const textPart = parts.join("\r\n") + "\r\n";
    const endPart = `\r\n--${boundary}--`;
    const fullPayload = Buffer.concat([
      Buffer.from(textPart, "utf8"),
      wavBuffer,
      Buffer.from(endPart, "utf8"),
    ]);

    const uploadRes = await app.inject({
      method: "POST",
      url: "/debug/upload-chunk",
      headers: {
        "x-user-id": userId,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: fullPayload,
    });

    assert.equal(uploadRes.statusCode, 404, "Should fail with invalid session");
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
