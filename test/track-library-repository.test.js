process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const { afterEach, beforeEach, describe, test } = require("node:test");

const {
  createTrackLibraryRepository,
} = require("../src/database/track-library-repository");
const { createSqliteAdapter } = require("../src/database/sqlite");

let db;
let repository;

function createSchema(database) {
  database.exec(`
    CREATE TABLE tracks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT,
      funding_source TEXT,
      share_token_id TEXT,
      latest_version INTEGER DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE track_library_entries (
      user_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      origin TEXT NOT NULL CHECK(origin IN ('created', 'received')),
      share_token_id TEXT,
      added_at TEXT NOT NULL,
      removed_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, track_id)
    );
    CREATE TABLE share_tokens (
      id TEXT PRIMARY KEY,
      track_id TEXT,
      status TEXT,
      claim_pin TEXT,
      expires_at TEXT
    );
  `);
}

async function seedTrack({
  id,
  userId,
  title,
  fundingSource = "standard",
  shareTokenId = null,
  deletedAt = null,
}) {
  await db
    .prepare(
      `INSERT INTO tracks (
        id,
        user_id,
        status,
        title,
        funding_source,
        share_token_id,
        latest_version,
        deleted_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      "generated",
      title,
      fundingSource,
      shareTokenId,
      1,
      deletedAt,
      "2026-06-28T04:00:00.000Z",
      "2026-06-28T04:00:00.000Z",
    );
}

async function seedLibraryEntry({
  userId,
  trackId,
  origin,
  shareTokenId = null,
  addedAt,
  removedAt = null,
}) {
  await db
    .prepare(
      `INSERT INTO track_library_entries (
        user_id,
        track_id,
        origin,
        share_token_id,
        added_at,
        removed_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, trackId, origin, shareTokenId, addedAt, removedAt, addedAt);
}

async function seedShareToken({
  id,
  trackId,
  status = "active",
  claimPin = "123456",
  expiresAt = "2026-06-29T04:00:00.000Z",
}) {
  await db
    .prepare(
      "INSERT INTO share_tokens (id, track_id, status, claim_pin, expires_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(id, trackId, status, claimPin, expiresAt);
}

describe("TrackLibraryRepository", () => {
  beforeEach(() => {
    db = createSqliteAdapter({ dbPath: ":memory:" });
    createSchema(db);
    repository = createTrackLibraryRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("listTracksForUser returns active library rows ordered by added_at", async () => {
    await seedTrack({
      id: "track_old",
      userId: "user_repo",
      title: "Old Track",
    });
    await seedTrack({
      id: "track_new",
      userId: "user_repo",
      title: "New Track",
    });
    await seedTrack({
      id: "track_other_user",
      userId: "other_user",
      title: "Other User Track",
    });
    await seedTrack({
      id: "track_deleted",
      userId: "user_repo",
      title: "Deleted Track",
      deletedAt: "2026-06-28T04:30:00.000Z",
    });
    await seedTrack({
      id: "track_gift_created",
      userId: "user_repo",
      title: "Gift Created Track",
      fundingSource: "gift_token",
    });
    await seedTrack({
      id: "track_removed",
      userId: "user_repo",
      title: "Removed Track",
    });

    await seedLibraryEntry({
      userId: "user_repo",
      trackId: "track_old",
      origin: "created",
      addedAt: "2026-06-28T04:01:00.000Z",
    });
    await seedLibraryEntry({
      userId: "user_repo",
      trackId: "track_new",
      origin: "created",
      addedAt: "2026-06-28T04:02:00.000Z",
    });
    await seedLibraryEntry({
      userId: "user_repo",
      trackId: "track_other_user",
      origin: "received",
      shareTokenId: "track_share_repo",
      addedAt: "2026-06-28T04:03:00.000Z",
    });
    await seedLibraryEntry({
      userId: "user_repo",
      trackId: "track_deleted",
      origin: "created",
      addedAt: "2026-06-28T04:04:00.000Z",
    });
    await seedLibraryEntry({
      userId: "user_repo",
      trackId: "track_gift_created",
      origin: "created",
      addedAt: "2026-06-28T04:05:00.000Z",
    });
    await seedLibraryEntry({
      userId: "user_repo",
      trackId: "track_removed",
      origin: "created",
      addedAt: "2026-06-28T04:06:00.000Z",
      removedAt: "2026-06-28T04:07:00.000Z",
    });

    const rows = await repository.listTracksForUser({
      userId: "user_repo",
      limit: 20,
      offset: 0,
    });

    assert.deepEqual(
      rows.map((row) => ({
        id: row.id,
        title: row.title,
        library_origin: row.library_origin,
        library_share_token_id: row.library_share_token_id,
        can_edit: row.can_edit,
        can_share: row.can_share,
        can_delete: row.can_delete,
      })),
      [
        {
          id: "track_other_user",
          title: "Other User Track",
          library_origin: "received",
          library_share_token_id: "track_share_repo",
          can_edit: 0,
          can_share: 0,
          can_delete: 1,
        },
        {
          id: "track_new",
          title: "New Track",
          library_origin: "created",
          library_share_token_id: null,
          can_edit: 1,
          can_share: 1,
          can_delete: 1,
        },
        {
          id: "track_old",
          title: "Old Track",
          library_origin: "created",
          library_share_token_id: null,
          can_edit: 1,
          can_share: 1,
          can_delete: 1,
        },
      ],
    );
  });

  test("getTrackForLibrary returns one active row with share metadata", async () => {
    await seedTrack({
      id: "track_detail",
      userId: "other_user",
      title: "Shared Detail",
      shareTokenId: "track_share_detail",
    });
    await seedShareToken({
      id: "track_share_detail",
      trackId: "track_detail",
      claimPin: "654321",
    });
    await seedLibraryEntry({
      userId: "user_repo",
      trackId: "track_detail",
      origin: "received",
      shareTokenId: "track_share_detail",
      addedAt: "2026-06-28T04:10:00.000Z",
    });

    const row = await repository.getTrackForLibrary({
      userId: "user_repo",
      trackId: "track_detail",
    });

    assert.equal(row.id, "track_detail");
    assert.equal(row.library_origin, "received");
    assert.equal(row.library_share_token_id, "track_share_detail");
    assert.equal(row.share_claim_pin, "654321");
    assert.equal(row.share_status, "active");
    assert.equal(row.can_edit, 0);
    assert.equal(row.can_share, 0);
    assert.equal(row.can_delete, 1);
  });

  test("upsertTrackLibraryEntry restores removed rows without downgrading created origin", async () => {
    await seedTrack({
      id: "track_restore",
      userId: "user_repo",
      title: "Restore Track",
    });
    await seedLibraryEntry({
      userId: "user_repo",
      trackId: "track_restore",
      origin: "created",
      shareTokenId: "old_share",
      addedAt: "2026-06-28T04:20:00.000Z",
      removedAt: "2026-06-28T04:21:00.000Z",
    });

    await repository.upsertTrackLibraryEntry({
      userId: "user_repo",
      trackId: "track_restore",
      origin: "received",
      shareTokenId: "new_share",
      addedAt: "2026-06-28T04:22:00.000Z",
    });

    const row = await db
      .prepare(
        "SELECT origin, share_token_id, added_at, removed_at FROM track_library_entries WHERE user_id = ? AND track_id = ?",
      )
      .get("user_repo", "track_restore");

    assert.deepEqual(row, {
      origin: "created",
      share_token_id: "new_share",
      added_at: "2026-06-28T04:22:00.000Z",
      removed_at: null,
    });
  });

  test("removeTrackFromLibrary is idempotent for already removed rows", async () => {
    await seedTrack({
      id: "track_remove",
      userId: "user_repo",
      title: "Remove Track",
    });
    await seedLibraryEntry({
      userId: "user_repo",
      trackId: "track_remove",
      origin: "created",
      addedAt: "2026-06-28T04:30:00.000Z",
    });

    await repository.removeTrackFromLibrary({
      userId: "user_repo",
      trackId: "track_remove",
      removedAt: "2026-06-28T04:31:00.000Z",
    });
    await repository.removeTrackFromLibrary({
      userId: "user_repo",
      trackId: "track_remove",
      removedAt: "2026-06-28T04:32:00.000Z",
    });

    const row = await db
      .prepare(
        "SELECT removed_at FROM track_library_entries WHERE user_id = ? AND track_id = ?",
      )
      .get("user_repo", "track_remove");

    assert.deepEqual(row, {
      removed_at: "2026-06-28T04:31:00.000Z",
    });
  });
});
