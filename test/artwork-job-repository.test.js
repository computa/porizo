process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createArtworkJobRepository,
} = require("../src/database/artwork-job-repository");

let db;
let repository;

async function seedArtworkTrack() {
  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, created_at, risk_level)
       VALUES ('user_artwork', 'artwork@example.com', 'Avery', ?, 'low')`,
    )
    .run("2026-06-27T09:00:00.000Z");
  await db
    .prepare(
      `INSERT INTO tracks (
        id, user_id, status, occasion, recipient_name, style, latest_version,
        created_at, updated_at
      ) VALUES (?, ?, 'created', 'birthday', 'Sarah', 'pop', 2, ?, ?)`,
    )
    .run(
      "track_artwork",
      "user_artwork",
      "2026-06-27T09:05:00.000Z",
      "2026-06-27T09:05:00.000Z",
    );
  await db
    .prepare(
      `INSERT INTO track_versions (
        id, track_id, version_num, status, render_type, params_hash,
        lyrics_json, created_at
      ) VALUES
        ('tv_artwork_1', 'track_artwork', 1, 'completed', 'preview', 'hash_1', ?, ?),
        ('tv_artwork_2', 'track_artwork', 2, 'completed', 'full', 'hash_2', ?, ?)`,
    )
    .run(
      JSON.stringify({ text: "first version" }),
      "2026-06-27T09:06:00.000Z",
      JSON.stringify({ text: "latest version" }),
      "2026-06-27T09:07:00.000Z",
    );
  await db
    .prepare(
      `INSERT INTO entitlements (user_id, tier, updated_at)
       VALUES ('user_artwork', 'pro', ?)`,
    )
    .run("2026-06-27T09:08:00.000Z");
}

describe("ArtworkJobRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createArtworkJobRepository(db);
    await seedArtworkTrack();
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("reads track, latest version, version lyrics, and entitlement", async () => {
    const track = await repository.getTrack("track_artwork");
    assert.equal(track.user_id, "user_artwork");
    assert.equal(track.sender_display_name, "Avery");

    const latestVersion = await repository.getLatestVersionForTrack("track_artwork");
    assert.equal(latestVersion.id, "tv_artwork_2");

    const lyrics = await repository.getVersionLyrics("tv_artwork_2");
    assert.equal(JSON.parse(lyrics.lyrics_json).text, "latest version");

    const entitlement = await repository.getEntitlement("user_artwork");
    assert.equal(entitlement.tier, "pro");
  });

  test("persists artwork fields and per-version artwork readiness", async () => {
    await repository.updateArtwork({
      trackId: "track_artwork",
      artworkUrl: "/artwork/track.jpg",
      artworkStyleVariant: null,
      artworkSource: "generated",
      artworkProvider: "flux",
      artworkPrompt: "prompt text",
      artworkContentHash: "hash_artwork",
      artworkModerationPassed: 1,
      artworkGeneratedAt: "2026-06-27T10:00:00.000Z",
    });
    await repository.updateArtworkVars({
      trackVersionId: "tv_artwork_2",
      artworkVarsJson: JSON.stringify({ species: "peony" }),
      artworkProvider: "flux",
      artworkPromptVersion: "v1",
    });
    await repository.markArtworkReady({
      trackVersionId: "tv_artwork_2",
      ready: 1,
    });

    const track = db
      .prepare(
        "SELECT artwork_url, artwork_provider, artwork_moderation_passed FROM tracks WHERE id = ?",
      )
      .get("track_artwork");
    assert.deepEqual(track, {
      artwork_url: "/artwork/track.jpg",
      artwork_provider: "flux",
      artwork_moderation_passed: 1,
    });

    const version = db
      .prepare(
        "SELECT artwork_ready, artwork_provider, artwork_prompt_version, artwork_vars_json FROM track_versions WHERE id = ?",
      )
      .get("tv_artwork_2");
    assert.equal(version.artwork_ready, 1);
    assert.equal(version.artwork_provider, "flux");
    assert.equal(version.artwork_prompt_version, "v1");
    assert.equal(JSON.parse(version.artwork_vars_json).species, "peony");
  });

  test("persists and recovers durable artwork job rows", async () => {
    await repository.insertArtworkJob({
      jobId: "job_artwork",
      trackVersionId: "tv_artwork_2",
      maxAttempts: 3,
      stepData: JSON.stringify({ trackId: "track_artwork" }),
      createdAt: "2026-06-27T09:10:00.000Z",
      updatedAt: "2026-06-27T09:10:00.000Z",
    });
    assert.equal(
      db.prepare("SELECT queue_name FROM jobs WHERE id = ?").get("job_artwork")
        .queue_name,
      "q.default",
    );

    let recoverable = await repository.listRecoverableJobs({
      now: "2026-06-27T09:11:00.000Z",
      staleCutoff: "2026-06-27T09:00:00.000Z",
    });
    assert.equal(recoverable.length, 1);
    assert.equal(recoverable[0].id, "job_artwork");
    assert.equal(recoverable[0].track_id, "track_artwork");

    await repository.markJobRunning({
      jobId: "job_artwork",
      now: "2026-06-27T09:12:00.000Z",
    });
    await repository.requeueJob({
      jobId: "job_artwork",
      attempts: 1,
      nextAttemptAt: "2026-06-27T09:13:00.000Z",
      message: "retry later",
      now: "2026-06-27T09:12:30.000Z",
    });

    recoverable = await repository.listRecoverableJobs({
      now: "2026-06-27T09:12:59.000Z",
      staleCutoff: "2026-06-27T09:00:00.000Z",
    });
    assert.equal(recoverable.length, 0);

    await repository.markJobFailed({
      jobId: "job_artwork",
      code: "TEST_FAILURE",
      message: "failed",
      now: "2026-06-27T09:14:00.000Z",
    });
    const failed = db
      .prepare("SELECT status, error_code, error_message FROM jobs WHERE id = ?")
      .get("job_artwork");
    assert.deepEqual(failed, {
      status: "failed",
      error_code: "TEST_FAILURE",
      error_message: "failed",
    });
  });

  test("job status transitions do not regress terminal artwork jobs", async () => {
    await repository.insertArtworkJob({
      jobId: "job_terminal",
      trackVersionId: "tv_artwork_2",
      maxAttempts: 3,
      stepData: JSON.stringify({ trackId: "track_artwork" }),
      createdAt: "2026-06-27T09:10:00.000Z",
      updatedAt: "2026-06-27T09:10:00.000Z",
    });
    const completed = await repository.markJobCompleted({
      jobId: "job_terminal",
      now: "2026-06-27T09:11:00.000Z",
    });
    assert.equal(completed.changes, 1);

    assert.equal(
      (
        await repository.markJobRunning({
          jobId: "job_terminal",
          now: "2026-06-27T09:12:00.000Z",
        })
      ).changes,
      0,
    );
    assert.equal(
      (
        await repository.requeueJob({
          jobId: "job_terminal",
          attempts: 1,
          nextAttemptAt: "2026-06-27T09:13:00.000Z",
          message: "retry",
          now: "2026-06-27T09:12:30.000Z",
        })
      ).changes,
      0,
    );
    assert.equal(
      (
        await repository.markJobFailed({
          jobId: "job_terminal",
          code: "LATE_FAILURE",
          message: "late failure",
          now: "2026-06-27T09:14:00.000Z",
        })
      ).changes,
      0,
    );

    const row = db
      .prepare("SELECT status, error_code, error_message FROM jobs WHERE id = ?")
      .get("job_terminal");
    assert.deepEqual(row, {
      status: "completed",
      error_code: null,
      error_message: null,
    });
  });
});
