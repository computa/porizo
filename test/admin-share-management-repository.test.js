process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAdminShareManagementRepository,
} = require("../src/database/admin-share-management-repository");

const NOW = "2026-06-27T10:00:00.000Z";

async function seedUser(db, id) {
  await db
    .prepare(
      "INSERT OR IGNORE INTO users (id, email, display_name, created_at, risk_level) VALUES (?, ?, ?, ?, 'low')",
    )
    .run(id, `${id}@example.com`, id, NOW);
}

async function seedTrackShare(
  db,
  {
    userId = "repo_share_user",
    trackId = "repo_share_track",
    versionId = `${trackId}_v1`,
    shareId = `${trackId}_share`,
    status = "claimed",
    boundDeviceId = "repo-device",
    streamKey = "repo-stream",
    createdAt = NOW,
  } = {},
) {
  await seedUser(db, userId);
  await db
    .prepare(
      `INSERT INTO tracks (
        id, user_id, status, title, occasion, recipient_name, style, created_at, updated_at
      ) VALUES (?, ?, 'complete', 'Repository Share Song', 'birthday', 'Ada', 'pop', ?, ?)`,
    )
    .run(trackId, userId, NOW, NOW);
  await db
    .prepare(
      `INSERT INTO track_versions (
        id, track_id, version_num, status, render_type, params_hash, created_at
      ) VALUES (?, ?, 1, 'complete', 'full', ?, ?)`,
    )
    .run(versionId, trackId, `${trackId}_hash`, NOW);
  await db
    .prepare(
      `INSERT INTO share_tokens (
        id, track_id, track_version_id, creator_id, status, bound_device_id,
        stream_key, expires_at, created_at, access_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 9)`,
    )
    .run(
      shareId,
      trackId,
      versionId,
      userId,
      status,
      boundDeviceId,
      streamKey,
      "2026-07-27T10:00:00.000Z",
      createdAt,
    );
  return { userId, trackId, shareId };
}

async function seedPoemShare(
  db,
  {
    userId = "repo_poem_user",
    poemId = "repo_poem",
    shareId = `${poemId}_share`,
    status = "active",
    claimAttempts = 3,
    createdAt = NOW,
  } = {},
) {
  await seedUser(db, userId);
  await db
    .prepare(
      `INSERT INTO poems (
        id, user_id, title, recipient_name, occasion, tone, verses, status, created_at, updated_at
      ) VALUES (?, ?, 'Repository Poem', 'Ada', 'birthday', 'warm', '[]', 'complete', ?, ?)`,
    )
    .run(poemId, userId, NOW, NOW);
  await db
    .prepare(
      `INSERT INTO poem_share_tokens (
        id, poem_id, creator_id, status, claim_pin, claim_attempts, allow_save,
        claim_policy, expires_at, created_at, access_count
      ) VALUES (?, ?, ?, ?, '123456', ?, 1, 'default', ?, ?, 4)`,
    )
    .run(
      shareId,
      poemId,
      userId,
      status,
      claimAttempts,
      "2026-07-27T10:00:00.000Z",
      createdAt,
    );
  return { userId, poemId, shareId };
}

describe("AdminShareManagementRepository", () => {
  let db;
  let repository;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAdminShareManagementRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("lists song shares with existing selected fields, filters, and order", async () => {
    const oldShare = await seedTrackShare(db, {
      userId: "repo_owner_a",
      trackId: "repo_track_a",
      shareId: "repo_share_a",
      status: "claimed",
      streamKey: "stream-a",
      createdAt: "2026-06-27T10:00:00.000Z",
    });
    const newShare = await seedTrackShare(db, {
      userId: "repo_owner_a",
      trackId: "repo_track_b",
      shareId: "repo_share_b",
      status: "claimed",
      streamKey: "stream-b",
      createdAt: "2026-06-27T10:01:00.000Z",
    });
    await seedTrackShare(db, {
      userId: "repo_owner_c",
      trackId: "repo_track_c",
      shareId: "repo_share_c",
      status: "unbound",
      createdAt: "2026-06-27T10:02:00.000Z",
    });

    const shares = await repository.listShares({
      status: "claimed",
      userId: oldShare.userId,
      limit: 10,
      offset: 0,
    });

    assert.deepEqual(
      shares.map((share) => share.id),
      [newShare.shareId, oldShare.shareId],
    );
    assert.deepEqual(shares[0], {
      id: newShare.shareId,
      track_id: newShare.trackId,
      status: "claimed",
      access_count: 9,
      bound_device_id: "repo-device",
      stream_key: "stream-b",
      created_at: "2026-06-27T10:01:00.000Z",
      expires_at: "2026-07-27T10:00:00.000Z",
      track_title: "Repository Share Song",
    });
  });

  test("rebindShareDevice updates only bound_device_id", async () => {
    const share = await seedTrackShare(db, {
      shareId: "repo_rebind_share",
      boundDeviceId: "old-device",
    });
    await db
      .prepare(
        "UPDATE share_tokens SET bound_device_platform = 'ios', bound_user_id = 'recipient', bound_at = ? WHERE id = ?",
      )
      .run("2026-06-27T09:00:00.000Z", share.shareId);

    const before = await repository.getShareById(share.shareId);
    assert.equal(before.bound_device_id, "old-device");

    await repository.rebindShareDevice({
      shareId: share.shareId,
      newDeviceId: "new-device",
    });

    const after = await db
      .prepare(
        "SELECT bound_device_id, bound_device_platform, bound_user_id, bound_at FROM share_tokens WHERE id = ?",
      )
      .get(share.shareId);
    assert.deepEqual(after, {
      bound_device_id: "new-device",
      bound_device_platform: "ios",
      bound_user_id: "recipient",
      bound_at: "2026-06-27T09:00:00.000Z",
    });
  });

  test("lists poem shares with existing selected fields and filters", async () => {
    const first = await seedPoemShare(db, {
      userId: "repo_poem_owner_a",
      poemId: "repo_poem_a",
      shareId: "repo_poem_share_a",
      status: "active",
      claimAttempts: 5,
    });
    await seedPoemShare(db, {
      userId: "repo_poem_owner_b",
      poemId: "repo_poem_b",
      shareId: "repo_poem_share_b",
      status: "revoked",
    });

    const shares = await repository.listPoemShares({
      status: "active",
      poemId: first.poemId,
      userId: first.userId,
      limit: 10,
      offset: 0,
    });

    assert.deepEqual(shares, [
      {
        id: first.shareId,
        poem_id: first.poemId,
        creator_id: first.userId,
        status: "active",
        claim_pin: "123456",
        claim_attempts: 5,
        access_count: 4,
        bound_user_id: null,
        allow_save: 1,
        claim_policy: "default",
        created_at: NOW,
        expires_at: "2026-07-27T10:00:00.000Z",
        poem_title: "Repository Poem",
        recipient_name: "Ada",
      },
    ]);
  });

  test("resets and revokes poem shares", async () => {
    const share = await seedPoemShare(db, {
      shareId: "repo_poem_mutation_share",
      claimAttempts: 8,
    });

    assert.equal(
      (await repository.getPoemShareById(share.shareId)).claim_attempts,
      8,
    );
    await repository.resetPoemShareAttempts(share.shareId);
    assert.equal(
      (await repository.getPoemShareById(share.shareId)).claim_attempts,
      0,
    );

    await repository.revokePoemShare(share.shareId);
    assert.equal(
      (await repository.getPoemShareById(share.shareId)).status,
      "revoked",
    );
  });
});
