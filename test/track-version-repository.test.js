process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { createTrackVersionRepository } = require("../src/database/track-version-repository");

let db;
let repository;

async function seedTrack({
  id = "track_repo_test",
  userId = "track_repo_user",
  latestVersion = 0,
} = {}) {
  const now = "2026-06-27T10:00:00.000Z";
  await db.prepare(`
    INSERT INTO tracks (
      id, user_id, status, title, occasion, recipient_name, style,
      duration_target, voice_mode, message, latest_version, created_at, updated_at
    ) VALUES (?, ?, 'draft', 'Repo Track', 'birthday', 'Jordan', 'pop', 60,
      'ai_voice', 'Happy birthday', ?, ?, ?)
  `).run(id, userId, latestVersion, now, now);
}

async function seedTrackVersion({
  id,
  trackId = "track_repo_test",
  versionNum,
  status = "complete",
  renderType = "preview",
  paramsHash = `hash_${id}`,
  createdAt = "2026-06-27T10:00:00.000Z",
  coverImageUrl = null,
  coverImageSmallUrl = null,
  coverImageLargeUrl = null,
} = {}) {
  await db
    .prepare(
      `INSERT INTO track_versions (
        id,
        track_id,
        version_num,
        status,
        render_type,
        params_json,
        params_hash,
        storage_ref,
        created_at,
        cover_image_url,
        cover_image_small_url,
        cover_image_large_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      trackId,
      versionNum,
      status,
      renderType,
      "{}",
      paramsHash,
      `tracks/${trackId}/v${versionNum}`,
      createdAt,
      coverImageUrl,
      coverImageSmallUrl,
      coverImageLargeUrl,
    );
}

describe("TrackVersionRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createTrackVersionRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("createVersionWithNextNumber increments the track and inserts the queued version atomically", async () => {
    await seedTrack();

    const created = await repository.createVersionWithNextNumber({
      id: "tv_repo_1",
      trackId: "track_repo_test",
      parentVersionId: null,
      renderType: "preview",
      paramsJson: '{"lyrics_style":"warm"}',
      paramsHash: "hash_repo_1",
      costEstimateJson: '{"credits":1,"usd":0.15}',
      storageRefPrefix: "tracks/track_repo_user/track_repo_test/v",
      createdAt: "2026-06-27T10:05:00.000Z",
      lyricsUpdatedAt: "2026-06-27T10:05:00.000Z",
      streamBaseUrl: "http://stream.local",
    });

    assert.deepEqual(created, {
      trackVersionId: "tv_repo_1",
      versionNum: 1,
    });

    const track = await repository.findTrackById("track_repo_test");
    assert.equal(track.latest_version, 1);
    assert.equal(track.updated_at, "2026-06-27T10:05:00.000Z");

    const duplicate = await repository.findDuplicateVersion({
      trackId: "track_repo_test",
      paramsHash: "hash_repo_1",
      renderType: "preview",
    });
    assert.equal(duplicate.id, "tv_repo_1");
    assert.equal(duplicate.version_num, 1);

    const row = await db
      .prepare(
        `SELECT status, render_type, params_hash, storage_ref, lyrics_status,
                lyrics_updated_at, stream_base_url
         FROM track_versions WHERE id = ?`,
      )
      .get("tv_repo_1");
    assert.deepEqual(row, {
      status: "queued",
      render_type: "preview",
      params_hash: "hash_repo_1",
      storage_ref: "tracks/track_repo_user/track_repo_test/v1",
      lyrics_status: "draft",
      lyrics_updated_at: "2026-06-27T10:05:00.000Z",
      stream_base_url: "http://stream.local",
    });
  });

  test("finds and lists track versions for render read helpers", async () => {
    await seedTrack({ latestVersion: 2 });
    await seedTrackVersion({
      id: "tv_read_1",
      versionNum: 1,
      coverImageUrl: "https://cdn.example/v1.jpg",
    });
    await seedTrackVersion({
      id: "tv_read_2",
      versionNum: 2,
      coverImageUrl: "https://cdn.example/v2.jpg",
      coverImageSmallUrl: "https://cdn.example/v2-small.jpg",
      coverImageLargeUrl: "https://cdn.example/v2-large.jpg",
    });
    await seedTrack({
      id: "track_repo_other",
      userId: "track_repo_user",
      latestVersion: 1,
    });
    await seedTrackVersion({
      id: "tv_other_1",
      trackId: "track_repo_other",
      versionNum: 1,
      coverImageUrl: "https://cdn.example/other.jpg",
    });

    const byId = await repository.findById("tv_read_2");
    assert.equal(byId.track_id, "track_repo_test");
    assert.equal(byId.version_num, 2);

    const byNumber = await repository.findByTrackIdAndVersion({
      trackId: "track_repo_test",
      versionNum: 1,
    });
    assert.equal(byNumber.id, "tv_read_1");

    const versions = await repository.listByTrackId("track_repo_test");
    assert.deepEqual(
      versions.map((version) => version.id),
      ["tv_read_1", "tv_read_2"],
    );

    const covers = await repository.listLatestCoverVersionsForTracks([
      "track_repo_test",
      "track_repo_other",
      "track_repo_test",
    ]);
    const byTrack = Object.fromEntries(
      covers.map((version) => [version.track_id, version]),
    );
    assert.equal(byTrack.track_repo_test.version_num, 2);
    assert.equal(
      byTrack.track_repo_test.cover_image_small_url,
      "https://cdn.example/v2-small.jpg",
    );
    assert.equal(byTrack.track_repo_other.version_num, 1);
    assert.equal(
      byTrack.track_repo_other.cover_image_url,
      "https://cdn.example/other.jpg",
    );
  });

  test("finds tracks and versions through a transaction query adapter", async () => {
    await seedTrack({ latestVersion: 1 });
    await seedTrackVersion({
      id: "tv_transaction_1",
      versionNum: 1,
      coverImageUrl: "https://cdn.example/transaction.jpg",
    });

    await db.transaction(async (query) => {
      const track = await repository.findTrackById("track_repo_test", query);
      assert.equal(track.id, "track_repo_test");

      const version = await repository.findByTrackIdAndVersion({
        trackId: "track_repo_test",
        versionNum: 1,
        query,
      });
      assert.equal(version.id, "tv_transaction_1");

      const byId = await repository.findById("tv_transaction_1", query);
      assert.equal(byId.cover_image_url, "https://cdn.example/transaction.jpg");
    });
  });

  test("createVersionWithNextNumber rolls back latest_version when insert fails", async () => {
    await seedTrack();
    await repository.createVersionWithNextNumber({
      id: "tv_duplicate_id",
      trackId: "track_repo_test",
      renderType: "preview",
      paramsJson: "{}",
      paramsHash: "hash_repo_1",
      costEstimateJson: '{"credits":1,"usd":0.15}',
      storageRefPrefix: "tracks/track_repo_user/track_repo_test/v",
      createdAt: "2026-06-27T10:05:00.000Z",
      streamBaseUrl: "http://stream.local",
    });

    await assert.rejects(
      () =>
        repository.createVersionWithNextNumber({
          id: "tv_duplicate_id",
          trackId: "track_repo_test",
          renderType: "preview",
          paramsJson: "{}",
          paramsHash: "hash_repo_2",
          costEstimateJson: '{"credits":1,"usd":0.15}',
          storageRefPrefix: "tracks/track_repo_user/track_repo_test/v",
          createdAt: "2026-06-27T10:06:00.000Z",
          streamBaseUrl: "http://stream.local",
        }),
      /UNIQUE|constraint/i,
    );

    const track = await repository.findTrackById("track_repo_test");
    assert.equal(track.latest_version, 1);

    const rows = await db
      .prepare("SELECT version_num FROM track_versions WHERE track_id = ?")
      .all("track_repo_test");
    assert.deepEqual(rows.map((row) => row.version_num), [1]);
  });
});
