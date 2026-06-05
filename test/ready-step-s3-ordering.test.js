require("dotenv/config");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { beforeEach, afterEach, describe, test } = require("node:test");
const { initDb } = require("../src/db");
const { getFFmpegPath } = require("../src/utils/ffmpeg");

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
  musicPlanJson = null,
  maxAttempts = 3,
}) {
  counter += 1;
  const now = new Date().toISOString();
  const userId = `ready-user-${counter}`;
  const trackId = `ready-track-${counter}`;
  const versionId = `ready-tv-${counter}`;
  const jobId = `ready-job-${counter}`;
  const isFull = workflowType === "full_render";

  await db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(userId, now);
  await db.prepare(
    "INSERT INTO tracks (id, user_id, title, recipient_name, message, occasion, style, voice_mode, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(trackId, userId, "Ready Test", "Bob", "Happy day", "birthday", "pop", "ai_voice", "rendering", now, now);
  await db.prepare(
    "INSERT INTO track_versions (id, track_id, version_num, status, render_type, params_hash, created_at, lyrics_json, music_plan_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(versionId, trackId, 1, "processing", isFull ? "full" : "preview", `hash-${counter}`, now, lyricsJson, musicPlanJson);
  await db.prepare(
    "INSERT INTO jobs (id, track_version_id, workflow_type, status, step, attempts, max_attempts, step_index, created_at, updated_at) VALUES (?, ?, ?, 'queued', 'ready', 0, ?, 8, ?, ?)"
  ).run(jobId, versionId, workflowType, maxAttempts, now, now);

  const versionDir = path.join(storageDir, "tracks", userId, trackId, "v1");
  fs.mkdirSync(versionDir, { recursive: true });
  fs.writeFileSync(path.join(versionDir, isFull ? "full.m4a" : "preview.m4a"), Buffer.from("fake-audio"));

  return { userId, trackId, versionId, jobId };
}

function writeValidM4a(filePath, durationSec = 60) {
  execFileSync(getFFmpegPath(), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=44100",
    "-t",
    String(durationSec),
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    filePath,
  ], { stdio: "ignore" });
}

async function setMusicProviderConfig(config) {
  await db.prepare(
    "INSERT OR REPLACE INTO app_config (key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?)"
  ).run(
    "music_provider_config",
    JSON.stringify(config),
    new Date().toISOString(),
    "test",
  );
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

  test("preview upload failure fails the render without publishing ready URLs", async () => {
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

    assert.equal(version.status, "failed");
    assert.equal(version.preview_url, null);
    assert.equal(version.full_url, null);
    assert.equal(track.status, "failed");
    assert.equal(job.status, "dead_letter");
    assert.equal(job.error_code, "S3_UPLOAD_FAILED");
  });

  test("lyrics alignment writes timestamps but upload failure does not publish ready URLs", async () => {
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

    assert.equal(version.status, "failed");
    assert.equal(lyrics.sections[0].startTime, 0);
    assert.equal(lyrics.sections[0].endTime, 0.8);
    assert.deepEqual(lyrics.sections[0].lines[0], {
      text: "We remember home",
      startTime: 0,
      endTime: 0.8,
    });
  });

  test("provider-complete Suno final audio passes ready gate after mix artifacts are cleaned", async () => {
    const { startJobRunner, restore } = loadRunnerWithMockedAlignLyrics();
    restoreRunnerModule = restore;
    const fixture = await seedReadyFixture({
      workflowType: "full_render",
      musicPlanJson: JSON.stringify({
        provider_resolved: "suno",
        provider_support: "strong",
        duration_sec: 60,
        generation_mode: "compose_detailed",
        style_prompt_compact: "Igbo highlife, warm celebration",
        provider_style_hint: "Igbo highlife, clear lead vocal",
        render_contract: {
          provider_locked: "suno",
          voice_mode: "ai_voice",
          pipeline: "provider_complete_audio",
          fallback_allowed_until_step: "instrumental",
          voice_conversion_provider: null,
          user_voice_engine: null,
          voice_provider_profile_id: null,
        },
      }),
    });
    const versionDir = path.join(storageDir, "tracks", fixture.userId, fixture.trackId, "v1");
    writeValidM4a(path.join(versionDir, "full.m4a"), 60);
    fs.rmSync(path.join(versionDir, "mix.wav"), { force: true });
    fs.rmSync(path.join(versionDir, "guide_vocal_full.mp3"), { force: true });
    await setMusicProviderConfig({
      default_provider: "suno",
      auto_style_routing: true,
      quality_threshold: 80,
      max_rerolls: 0,
    });
    await db.prepare("UPDATE track_versions SET artwork_ready = 1 WHERE id = ?").run(fixture.versionId);

    runner = await startJobRunner({
      db,
      storageDir,
      streamBaseUrl: "http://stream.local",
      intervalMs: 1_000_000,
      providerConfig: { suno: { live: true } },
    });

    await runner.tick();
    await waitForJobTerminal(fixture.jobId);

    const version = await db.prepare("SELECT status, preview_url, full_url, provenance_json FROM track_versions WHERE id = ?").get(fixture.versionId);
    const track = await db.prepare("SELECT status FROM tracks WHERE id = ?").get(fixture.trackId);
    const job = await db.prepare("SELECT status, error_code, error_message FROM jobs WHERE id = ?").get(fixture.jobId);
    const provenance = JSON.parse(version.provenance_json);

    assert.equal(version.status, "full_ready");
    assert.equal(track.status, "ready");
    assert.equal(job.status, "completed");
    assert.equal(job.error_code, null);
    assert.equal(version.preview_url, null);
    assert.ok(version.full_url);
    assert.equal(provenance.quality.last_evaluation.passed, true);
    assert.equal(
      provenance.quality.last_evaluation.issues.includes("vocal_intelligibility_low"),
      false,
    );
    assert.equal(
      provenance.quality.last_evaluation.issues.includes("mix_balance_low"),
      false,
    );
    assert.ok(
      provenance.quality.last_evaluation.vocal_intelligibility_score >= 85
    );
    assert.ok(
      provenance.quality.last_evaluation.instrumental_balance_score >= 80
    );
    assert.ok(
      provenance.quality.last_evaluation.total_score >=
        provenance.quality.last_evaluation.threshold
    );
  });

  test("provider-complete Suno final audio fails ready gate when output is not valid audio", async () => {
    const { startJobRunner, restore } = loadRunnerWithMockedAlignLyrics();
    restoreRunnerModule = restore;
    const fixture = await seedReadyFixture({
      workflowType: "full_render",
      maxAttempts: 1,
      musicPlanJson: JSON.stringify({
        provider_resolved: "suno",
        provider_support: "strong",
        duration_sec: 60,
        generation_mode: "compose_detailed",
        style_prompt_compact: "Igbo highlife, warm celebration",
        provider_style_hint: "Igbo highlife, clear lead vocal",
        render_contract: {
          provider_locked: "suno",
          voice_mode: "ai_voice",
          pipeline: "provider_complete_audio",
          fallback_allowed_until_step: "instrumental",
          voice_conversion_provider: null,
          user_voice_engine: null,
          voice_provider_profile_id: null,
        },
      }),
    });
    await setMusicProviderConfig({
      default_provider: "suno",
      auto_style_routing: true,
      quality_threshold: 72,
      max_rerolls: 0,
    });
    await db.prepare("UPDATE track_versions SET artwork_ready = 1 WHERE id = ?").run(fixture.versionId);

    runner = await startJobRunner({
      db,
      storageDir,
      streamBaseUrl: "http://stream.local",
      intervalMs: 1_000_000,
      providerConfig: { suno: { live: true } },
    });

    await runner.tick();
    await waitForJobTerminal(fixture.jobId);

    const version = await db.prepare("SELECT status, preview_url, full_url FROM track_versions WHERE id = ?").get(fixture.versionId);
    const track = await db.prepare("SELECT status FROM tracks WHERE id = ?").get(fixture.trackId);
    const job = await db.prepare("SELECT status, error_code, error_message FROM jobs WHERE id = ?").get(fixture.jobId);

    assert.equal(version.status, "failed");
    assert.equal(track.status, "failed");
    assert.equal(job.status, "dead_letter");
    assert.equal(job.error_code, "E302_QUALITY_GATE_FAILED");
    assert.equal(version.preview_url, null);
    assert.equal(version.full_url, null);
    assert.match(job.error_message, /technical_quality_low/);
  });
});
