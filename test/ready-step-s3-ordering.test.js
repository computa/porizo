require("dotenv/config");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { beforeEach, afterEach, describe, test } = require("node:test");
const { initDb } = require("../src/db");

let db;
let storageDir;
let runner;
let restoreRunnerModule = null;
let originalNodeEnv;
let counter = 0;

function loadRunnerWithMockedAlignLyrics(mockAlignLyrics = null) {
  const runnerPath = require.resolve("../src/workflows/runner");
  const whisperPath = require.resolve("../src/providers/whisper");
  delete require.cache[runnerPath];
  const whisper = require(whisperPath);
  const originalAlignLyrics = whisper.alignLyrics;
  if (mockAlignLyrics) {
    whisper.alignLyrics = mockAlignLyrics;
  }
  const runnerModule = require(runnerPath);
  return {
    startJobRunner: runnerModule.startJobRunner,
    restore: () => {
      whisper.alignLyrics = originalAlignLyrics;
      delete require.cache[runnerPath];
    },
  };
}

async function waitForJobTerminal(jobId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const job = await db.prepare("SELECT status FROM jobs WHERE id = ?").get(jobId);
    if (job && ["failed", "completed", "dead_letter", "blocked"].includes(job.status)) {
      return job.status;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

async function seedReadyFixture({
  workflowType = "preview_render",
  lyricsJson = null,
  withBillingHold = false,
}) {
  counter += 1;
  const now = new Date().toISOString();
  const userId = `ready-user-${counter}`;
  const trackId = `ready-track-${counter}`;
  const versionId = `ready-tv-${counter}`;
  const jobId = `ready-job-${counter}`;
  const holdId = withBillingHold ? `hold-${counter}` : null;
  const isFull = workflowType === "full_render";

  await db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(userId, now);
  await db.prepare(
    "INSERT INTO tracks (id, user_id, title, recipient_name, message, occasion, style, voice_mode, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(trackId, userId, "Ready Test", "Bob", "Happy day", "birthday", "pop", "ai_voice", "rendering", now, now);
  await db.prepare(
    "INSERT INTO track_versions (id, track_id, version_num, status, render_type, params_hash, created_at, lyrics_json, billing_hold_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(versionId, trackId, 1, "processing", isFull ? "full" : "preview", `hash-${counter}`, now, lyricsJson, holdId);
  await db.prepare(
    "INSERT INTO jobs (id, track_version_id, workflow_type, status, step, attempts, max_attempts, step_index, created_at, updated_at) VALUES (?, ?, ?, 'queued', 'ready', 0, 3, 8, ?, ?)"
  ).run(jobId, versionId, workflowType, now, now);
  if (withBillingHold) {
    await db.prepare(
      "INSERT INTO billing_holds (id, user_id, track_version_id, credits_held, status, created_at, expires_at) VALUES (?, ?, ?, 1, 'pending', ?, ?)"
    ).run(holdId, userId, versionId, now, new Date(Date.now() + 3600_000).toISOString());
  }

  const versionDir = path.join(storageDir, "tracks", userId, trackId, "v1");
  fs.mkdirSync(versionDir, { recursive: true });
  fs.writeFileSync(path.join(versionDir, isFull ? "full.m4a" : "preview.m4a"), Buffer.from("fake-audio"));

  return { userId, trackId, versionId, jobId, holdId };
}

describe("ready step upload-before-commit ordering", () => {
  beforeEach(async () => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-ready-order-"));
    db = await initDb({ dbPath: ":memory:", migrationsDir: path.join(process.cwd(), "migrations") });
  });

  afterEach(async () => {
    if (runner) {
      runner.stop();
      runner = null;
    }
    if (restoreRunnerModule) {
      restoreRunnerModule();
      restoreRunnerModule = null;
    }
    if (db) {
      db.close();
      db = null;
    }
    if (storageDir) {
      fs.rmSync(storageDir, { recursive: true, force: true });
      storageDir = null;
    }
    process.env.NODE_ENV = originalNodeEnv;
  });

  test("preview upload failure leaves track and version in processing state", async () => {
    const { startJobRunner, restore } = loadRunnerWithMockedAlignLyrics();
    restoreRunnerModule = restore;
    const fixture = await seedReadyFixture({});
    process.env.NODE_ENV = "production";

    runner = await startJobRunner({
      db,
      storageDir,
      streamBaseUrl: "http://stream.local",
      intervalMs: 1_000_000,
      storageProvider: {
        type: "s3",
        putFile: async () => {
          throw new Error("simulated upload failure");
        },
      },
    });

    await runner.tick();
    await waitForJobTerminal(fixture.jobId);

    const version = await db.prepare("SELECT status, preview_url, full_url FROM track_versions WHERE id = ?").get(fixture.versionId);
    const track = await db.prepare("SELECT status FROM tracks WHERE id = ?").get(fixture.trackId);
    const job = await db.prepare("SELECT status, error_code FROM jobs WHERE id = ?").get(fixture.jobId);

    assert.equal(version.status, "processing");
    assert.equal(version.preview_url, null);
    assert.equal(version.full_url, null);
    assert.equal(track.status, "rendering");
    assert.equal(job.status, "failed");
    assert.equal(job.error_code, "S3_UPLOAD_FAILED");
  });

  test("full upload failure does not capture billing hold", async () => {
    const { startJobRunner, restore } = loadRunnerWithMockedAlignLyrics();
    restoreRunnerModule = restore;
    const fixture = await seedReadyFixture({ workflowType: "full_render", withBillingHold: true });
    process.env.NODE_ENV = "production";

    runner = await startJobRunner({
      db,
      storageDir,
      streamBaseUrl: "http://stream.local",
      intervalMs: 1_000_000,
      storageProvider: {
        type: "s3",
        putFile: async () => {
          throw new Error("simulated upload failure");
        },
      },
    });

    await runner.tick();
    await waitForJobTerminal(fixture.jobId);

    const hold = await db.prepare("SELECT status, resolved_at FROM billing_holds WHERE id = ?").get(fixture.holdId);
    const version = await db.prepare("SELECT status, full_url FROM track_versions WHERE id = ?").get(fixture.versionId);
    assert.equal(hold.status, "pending");
    assert.equal(hold.resolved_at, null);
    assert.equal(version.status, "processing");
    assert.equal(version.full_url, null);
  });

  test("lyrics alignment writes timestamps without advancing ready status before upload", async () => {
    const { startJobRunner, restore } = loadRunnerWithMockedAlignLyrics(async () => ({
      words: [
        { word: "we", start: 0.0, end: 0.2 },
        { word: "remember", start: 0.2, end: 0.5 },
        { word: "home", start: 0.5, end: 0.8 },
      ],
      segments: [],
    }));
    restoreRunnerModule = restore;
    const fixture = await seedReadyFixture({
      lyricsJson: JSON.stringify({
        sections: [{ name: "verse1", lines: ["We remember home"] }],
      }),
    });
    process.env.NODE_ENV = "production";

    runner = await startJobRunner({
      db,
      storageDir,
      streamBaseUrl: "http://stream.local",
      intervalMs: 1_000_000,
      storageProvider: {
        type: "s3",
        putFile: async () => {
          throw new Error("simulated upload failure");
        },
      },
    });

    await runner.tick();
    await waitForJobTerminal(fixture.jobId);

    const version = await db.prepare("SELECT status, lyrics_json FROM track_versions WHERE id = ?").get(fixture.versionId);
    const lyrics = JSON.parse(version.lyrics_json);

    assert.equal(version.status, "processing");
    assert.equal(lyrics.sections[0].startTime, 0);
    assert.equal(lyrics.sections[0].endTime, 0.8);
    assert.deepEqual(lyrics.sections[0].lines[0], {
      text: "We remember home",
      startTime: 0,
      endTime: 0.8,
    });
  });
});
