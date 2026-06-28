process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { createGiftContentRepository } = require("../src/database/gift-content-repository");

let db;
let repository;

async function seedTrack({
  id = "gift_content_track",
  userId = "gift_content_user",
  deletedAt = null,
  latestVersion = 2,
} = {}) {
  const now = "2026-06-27T10:00:00.000Z";
  await db
    .prepare(
      `INSERT INTO tracks (
        id, user_id, status, title, occasion, recipient_name, style,
        duration_target, voice_mode, message, latest_version, deleted_at, created_at, updated_at
      ) VALUES (?, ?, 'complete', 'Birthday Song', 'birthday', 'Jordan', 'pop', 60,
        'ai_voice', 'Happy birthday', ?, ?, ?, ?)`,
    )
    .run(id, userId, latestVersion, deletedAt, now, now);
}

async function seedTrackVersion({
  id = "gift_content_track_v2",
  trackId = "gift_content_track",
  versionNum = 2,
  previewUrl = "https://cdn.test/preview.mp3",
  fullUrl = "https://cdn.test/full.mp3",
} = {}) {
  const now = "2026-06-27T10:05:00.000Z";
  await db
    .prepare(
      `INSERT INTO track_versions (
        id, track_id, version_num, status, render_type, params_json, params_hash,
        cost_estimate_json, storage_ref, created_at, completed_at, preview_url, full_url
      ) VALUES (?, ?, ?, 'complete', 'full', '{}', ?, '{}', ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      trackId,
      versionNum,
      `hash_${id}`,
      `tracks/${trackId}/v${versionNum}`,
      now,
      now,
      previewUrl,
      fullUrl,
    );
}

async function seedPoem({
  id = "gift_content_poem",
  userId = "gift_content_user",
  deletedAt = null,
} = {}) {
  const now = "2026-06-27T10:10:00.000Z";
  await db
    .prepare(
      `INSERT INTO poems (
        id, user_id, title, recipient_name, occasion, tone, verses, message,
        status, deleted_at, created_at, updated_at
      ) VALUES (?, ?, 'Birthday Poem', 'Jordan', 'birthday', 'heartfelt', ?, 'For you',
        'complete', ?, ?, ?)`,
    )
    .run(id, userId, '["Line one","Line two"]', deletedAt, now, now);
}

describe("GiftContentRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createGiftContentRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("getTrackForGiftContent returns the route-compatible track fields", async () => {
    await seedTrack({ deletedAt: "2026-06-27T11:00:00.000Z" });

    const track = await repository.getTrackForGiftContent("gift_content_track");

    assert.deepEqual(track, {
      id: "gift_content_track",
      user_id: "gift_content_user",
      title: "Birthday Song",
      recipient_name: "Jordan",
      occasion: "birthday",
      latest_version: 2,
      deleted_at: "2026-06-27T11:00:00.000Z",
    });
  });

  test("getTrackVersionForGiftContent returns the selected version media fields", async () => {
    await seedTrack();
    await seedTrackVersion();
    await seedTrackVersion({
      id: "gift_content_track_v1",
      versionNum: 1,
      previewUrl: "https://cdn.test/old-preview.mp3",
      fullUrl: "https://cdn.test/old-full.mp3",
    });

    const version = await repository.getTrackVersionForGiftContent({
      trackId: "gift_content_track",
      versionNum: 2,
    });

    assert.deepEqual(version, {
      id: "gift_content_track_v2",
      preview_url: "https://cdn.test/preview.mp3",
      full_url: "https://cdn.test/full.mp3",
    });
  });

  test("getPoemForGiftContent returns the route-compatible poem fields", async () => {
    await seedPoem({ deletedAt: "2026-06-27T11:05:00.000Z" });

    const poem = await repository.getPoemForGiftContent("gift_content_poem");

    assert.deepEqual(poem, {
      id: "gift_content_poem",
      user_id: "gift_content_user",
      title: "Birthday Poem",
      recipient_name: "Jordan",
      occasion: "birthday",
      tone: "heartfelt",
      verses: '["Line one","Line two"]',
      message: "For you",
      deleted_at: "2026-06-27T11:05:00.000Z",
    });
  });

  test("returns undefined for missing gift content rows like the prepared get adapter", async () => {
    assert.equal(await repository.getTrackForGiftContent("missing_track"), undefined);
    assert.equal(
      await repository.getTrackVersionForGiftContent({
        trackId: "missing_track",
        versionNum: 1,
      }),
      undefined,
    );
    assert.equal(await repository.getPoemForGiftContent("missing_poem"), undefined);
  });
});
