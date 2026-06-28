process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createOneSignalTagSyncRepository,
} = require("../src/database/one-signal-tag-sync-repository");

let db;
let repository;

async function insertUser(id) {
  await db
    .prepare("INSERT INTO users (id, created_at) VALUES (?, ?)")
    .run(id, "2026-06-27T00:00:00.000Z");
}

async function insertTrack(id, userId, createdAt) {
  await db
    .prepare(
      `INSERT INTO tracks (
         id, user_id, status, title, recipient_name, occasion, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      "completed",
      `Track ${id}`,
      "Ambrose",
      "birthday",
      createdAt,
      createdAt,
    );
}

describe("OneSignalTagSyncRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createOneSignalTagSyncRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("listUserTagSummaries preserves users without tracks and latest song date", async () => {
    await insertUser("user_without_tracks");
    await insertUser("user_with_tracks");
    await insertTrack(
      "track_old",
      "user_with_tracks",
      "2026-06-25T10:00:00.000Z",
    );
    await insertTrack(
      "track_new",
      "user_with_tracks",
      "2026-06-26T10:00:00.000Z",
    );

    const rows = await repository.listUserTagSummaries();
    const byId = new Map(rows.map((row) => [row.id, row]));

    assert.equal(Number(byId.get("user_without_tracks").song_count), 0);
    assert.equal(byId.get("user_without_tracks").last_song_at, null);
    assert.equal(Number(byId.get("user_with_tracks").song_count), 2);
    assert.equal(
      byId.get("user_with_tracks").last_song_at,
      "2026-06-26T10:00:00.000Z",
    );
  });

  test("listUserTagSummaries normalizes COUNT results to numbers", async () => {
    const queryOnlyRepository = createOneSignalTagSyncRepository(async () => ({
      rows: [
        {
          id: "user_pg_count",
          song_count: "1",
          last_song_at: "2026-06-26T10:00:00.000Z",
        },
      ],
    }));

    const rows = await queryOnlyRepository.listUserTagSummaries();

    assert.equal(rows[0].song_count, 1);
  });
});
