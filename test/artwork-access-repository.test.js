process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createArtworkAccessRepository,
} = require("../src/database/artwork-access-repository");

let db;
let repository;

async function seedArtworkAccessRows() {
  await db
    .prepare("INSERT INTO users (id, created_at) VALUES (?, ?)")
    .run("user_artwork_access", "2026-06-27T00:00:00.000Z");
  await db
    .prepare(
      `INSERT INTO tracks (
         id, user_id, status, title, recipient_name, occasion, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "track_artwork_access",
      "user_artwork_access",
      "completed",
      "Artwork Access",
      "Ambrose",
      "birthday",
      "2026-06-27T00:00:00.000Z",
      "2026-06-27T00:00:00.000Z",
    );
  await db
    .prepare(
      `INSERT INTO track_versions (
         id, track_id, version_num, status, render_type, params_hash, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "version_artwork_access",
      "track_artwork_access",
      1,
      "ready",
      "full",
      "artwork_access_hash",
      "2026-06-27T00:01:00.000Z",
    );
  await db
    .prepare(
      `INSERT INTO share_tokens (
         id, track_id, track_version_id, creator_id, status, share_type,
         web_stream_allowed, app_save_allowed, expires_at, created_at,
         access_count, stream_key_id, stream_key, claim_pin, claim_attempts
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "share_artwork_access",
      "track_artwork_access",
      "version_artwork_access",
      "user_artwork_access",
      "unbound",
      "lifetime",
      1,
      1,
      "9999-12-31T23:59:59.000Z",
      "2026-06-27T00:02:00.000Z",
      0,
      "stream_key_id",
      "stream_key",
      "123456",
      0,
    );
}

describe("ArtworkAccessRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createArtworkAccessRepository(db);
    await seedArtworkAccessRows();
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("reads the track owner needed for artwork authorization and storage keys", async () => {
    const owner = await repository.getTrackOwnerForArtwork("track_artwork_access");
    assert.deepEqual(owner, { user_id: "user_artwork_access" });
  });

  test("reads only the share-token fields needed by artwork authorization", async () => {
    const share =
      await repository.getShareTokenForArtwork("share_artwork_access");
    assert.deepEqual(share, {
      track_id: "track_artwork_access",
      status: "unbound",
      expires_at: "9999-12-31T23:59:59.000Z",
    });
  });

  test("returns no row for missing artwork access records", async () => {
    assert.equal(
      await repository.getTrackOwnerForArtwork("missing_track"),
      undefined,
    );
    assert.equal(
      await repository.getShareTokenForArtwork("missing_share"),
      undefined,
    );
  });
});
