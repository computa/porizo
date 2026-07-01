process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAdminDemoShareRepository,
} = require("../src/database/admin-demo-share-repository");

let db;
let repository;

const NOW = "2026-06-27T10:00:00.000Z";
const DEMO_EXPIRES_AT = "2125-01-01T00:00:00.000Z";

async function seedUser(id) {
  await db
    .prepare("INSERT INTO users (id, created_at, risk_level) VALUES (?, ?, 'low')")
    .run(id, NOW);
}

async function seedTrack({ id = "track_demo", userId = "user_demo", title = "Demo Song" } = {}) {
  await seedUser(userId);
  await db
    .prepare(
      `INSERT INTO tracks (
        id, user_id, status, title, occasion, recipient_name, style, created_at, updated_at
      ) VALUES (?, ?, 'complete', ?, 'birthday', 'Ada', 'pop', ?, ?)`,
    )
    .run(id, userId, title, NOW, NOW);
  await db
    .prepare(
      `INSERT INTO track_versions (
        id, track_id, version_num, status, render_type, params_hash, created_at
      ) VALUES (?, ?, ?, 'complete', 'full', ?, ?)`,
    )
    .run(`${id}_v1`, id, 1, `${id}_hash_1`, NOW);
  await db
    .prepare(
      `INSERT INTO track_versions (
        id, track_id, version_num, status, render_type, params_hash, created_at
      ) VALUES (?, ?, ?, 'complete', 'full', ?, ?)`,
    )
    .run(`${id}_v2`, id, 2, `${id}_hash_2`, NOW);
  return { id, userId, latestVersionId: `${id}_v2` };
}

async function seedPoem({ id = "poem_demo", userId = "poem_user", title = "Demo Poem" } = {}) {
  await seedUser(userId);
  await db
    .prepare(
      `INSERT INTO poems (
        id, user_id, title, recipient_name, occasion, tone, verses, status, created_at, updated_at
      ) VALUES (?, ?, ?, 'Ada', 'birthday', 'heartfelt', '[]', 'complete', ?, ?)`,
    )
    .run(id, userId, title, NOW, NOW);
  return { id, userId };
}

describe("AdminDemoShareRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAdminDemoShareRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("creates song demo shares with the latest track version and lists them", async () => {
    const track = await seedTrack();

    const shareId = "song_demo_share";
    const latestVersion = await repository.getLatestTrackVersion(track.id);
    assert.equal(latestVersion.id, track.latestVersionId);

    await repository.createSongDemoShare({
      shareId,
      trackId: track.id,
      trackVersionId: latestVersion.id,
      creatorId: track.userId,
      expiresAt: DEMO_EXPIRES_AT,
      now: NOW,
    });
    await repository.linkTrackShareToken({ trackId: track.id, shareId });

    const share = await repository.getSongDemoShareById(shareId);
    assert.equal(share.track_id, track.id);
    assert.equal(share.track_version_id, track.latestVersionId);
    assert.equal(share.creator_id, track.userId);
    assert.equal(share.status, "unbound");
    assert.equal(share.share_type, "demo");
    assert.equal(share.claim_pin, null);
    assert.equal(share.web_stream_allowed, 1);

    assert.equal(
      (
        await db
          .prepare("SELECT share_token_id FROM tracks WHERE id = ?")
          .get(track.id)
      ).share_token_id,
      shareId,
    );

    const shares = await repository.listSongDemoShares();
    assert.deepEqual(shares, [
      {
        id: shareId,
        resource_id: track.id,
        resource_type: "song",
        title: "Demo Song",
        access_count: 0,
        created_at: NOW,
        status: "unbound",
      },
    ]);
  });

  test("converts existing song shares to demo and clears stale binding state", async () => {
    const track = await seedTrack({ id: "track_convert" });
    await repository.createSongDemoShare({
      shareId: "existing_song_share",
      trackId: track.id,
      trackVersionId: track.latestVersionId,
      creatorId: track.userId,
      expiresAt: "2026-07-01T00:00:00.000Z",
      now: NOW,
    });
    await db
      .prepare(
        `UPDATE share_tokens
         SET share_type = 'gift',
             claim_pin = '123456',
             status = 'claimed',
             web_stream_allowed = 0,
             bound_device_id = 'device-old',
             bound_device_platform = 'ios',
             bound_app_version = '1.0',
             bound_at = ?,
             bound_user_id = 'old_user'
         WHERE id = ?`,
      )
      .run(NOW, "existing_song_share");

    await repository.convertSongShareToDemo({
      shareId: "existing_song_share",
      expiresAt: DEMO_EXPIRES_AT,
    });

    assert.deepEqual(
      await db
        .prepare(
          `SELECT share_type, claim_pin, expires_at, status, web_stream_allowed,
                  bound_device_id, bound_device_platform, bound_app_version, bound_at, bound_user_id
           FROM share_tokens WHERE id = ?`,
        )
        .get("existing_song_share"),
      {
        share_type: "demo",
        claim_pin: null,
        expires_at: DEMO_EXPIRES_AT,
        status: "unbound",
        web_stream_allowed: 1,
        bound_device_id: null,
        bound_device_platform: null,
        bound_app_version: null,
        bound_at: null,
        bound_user_id: null,
      },
    );
  });

  test("does not select non-demo song shares as reusable demo shares", async () => {
    const track = await seedTrack({ id: "track_preserve_non_demo" });
    await repository.createSongDemoShare({
      shareId: "manual_song_share",
      trackId: track.id,
      trackVersionId: track.latestVersionId,
      creatorId: track.userId,
      expiresAt: "2026-07-01T00:00:00.000Z",
      now: NOW,
    });
    await db
      .prepare(
        `UPDATE share_tokens
         SET share_type = 'gift',
             status = 'claimed',
             claim_pin = '999999',
             bound_user_id = 'recipient_user'
         WHERE id = ?`,
      )
      .run("manual_song_share");

    assert.equal(await repository.getSongDemoShareByTrack(track.id), undefined);

    await repository.createSongDemoShare({
      shareId: "new_song_demo_share",
      trackId: track.id,
      trackVersionId: track.latestVersionId,
      creatorId: track.userId,
      expiresAt: DEMO_EXPIRES_AT,
      now: "2026-06-27T10:01:00.000Z",
    });

    assert.equal(
      (await repository.getSongDemoShareByTrack(track.id)).id,
      "new_song_demo_share",
    );
    assert.deepEqual(
      await db
        .prepare(
          "SELECT share_type, status, claim_pin, bound_user_id FROM share_tokens WHERE id = ?",
        )
        .get("manual_song_share"),
      {
        share_type: "gift",
        status: "claimed",
        claim_pin: "999999",
        bound_user_id: "recipient_user",
      },
    );
  });

  test("creates, converts, lists, and revokes poem demo shares", async () => {
    const poem = await seedPoem();

    await repository.createPoemDemoShare({
      shareId: "poem_demo_share",
      poemId: poem.id,
      creatorId: poem.userId,
      expiresAt: DEMO_EXPIRES_AT,
      now: NOW,
    });

    assert.deepEqual(await repository.listPoemDemoShares(), [
      {
        id: "poem_demo_share",
        resource_id: poem.id,
        resource_type: "poem",
        title: "Demo Poem",
        access_count: 0,
        created_at: NOW,
        status: "active",
      },
    ]);

    await db
      .prepare(
        `UPDATE poem_share_tokens
         SET claim_pin = '654321',
             status = 'claimed',
             bound_user_id = 'old_user',
             claim_attempts = 4
         WHERE id = ?`,
      )
      .run("poem_demo_share");

    await repository.convertPoemShareToDemo({
      shareId: "poem_demo_share",
      expiresAt: DEMO_EXPIRES_AT,
    });

    assert.deepEqual(
      await db
        .prepare(
          `SELECT share_type, claim_pin, expires_at, status, bound_user_id, claim_attempts
           FROM poem_share_tokens WHERE id = ?`,
        )
        .get("poem_demo_share"),
      {
        share_type: "demo",
        claim_pin: null,
        expires_at: DEMO_EXPIRES_AT,
        status: "active",
        bound_user_id: null,
        claim_attempts: 0,
      },
    );

    await repository.revokePoemDemoShare("poem_demo_share");
    assert.equal(
      (
        await db
          .prepare("SELECT status FROM poem_share_tokens WHERE id = ?")
          .get("poem_demo_share")
      ).status,
      "revoked",
    );
  });
});
