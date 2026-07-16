require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../../src/database");
const { buildServer } = require("../../src/server");
const { createOrGetShareToken } = require("../../src/services/share-service");

const NOW = "2026-07-15T10:00:00.000Z";
const LIFETIME = "9999-12-31T23:59:59.000Z";

async function seedTrack(db, { id = "gift_track", userId = "gift_user" } = {}) {
  await db
    .prepare(
      "INSERT INTO users (id, created_at, risk_level) VALUES (?, ?, 'low')",
    )
    .run(userId, NOW);
  await db
    .prepare(
      `INSERT INTO tracks (
        id, user_id, status, title, occasion, recipient_name, style, created_at, updated_at
      ) VALUES (?, ?, 'complete', 'Gift Song', 'i_love_you', 'Sarah', 'acoustic', ?, ?)`,
    )
    .run(id, userId, NOW, NOW);
  await db
    .prepare(
      `INSERT INTO track_versions (
        id, track_id, version_num, status, render_type, params_hash, created_at
      ) VALUES (?, ?, 1, 'complete', 'full', ?, ?)`,
    )
    .run(`${id}_v1`, id, `${id}_hash`, NOW);
  return { id, userId, versionId: `${id}_v1` };
}

async function seedShare(db, track, shareType) {
  const shareId = `sh_${shareType}_${track.id}`;
  await db
    .prepare(
      `INSERT INTO share_tokens (
        id, track_id, track_version_id, creator_id, status, share_type,
        web_stream_allowed, app_save_allowed, expires_at, created_at, access_count
      ) VALUES (?, ?, ?, ?, 'unbound', ?, 1, 1, ?, ?, 0)`,
    )
    .run(
      shareId,
      track.id,
      track.versionId,
      track.userId,
      shareType,
      LIFETIME,
      NOW,
    );
  return shareId;
}

describe("gift share web playback (U7)", () => {
  let db;
  let app;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildServer({
      db,
      config: {
        STORAGE_DIR: "/tmp/test-storage",
        PUBLIC_BASE_URL: "http://public.local",
      },
      storage: {
        put: async () => {},
        get: async () => null,
        exists: async () => false,
        delete: async () => {},
        getSignedUrl: async (key) => `http://localhost/${key}`,
      },
    });
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("gift share exposes web playback to a plain browser", async () => {
    const track = await seedTrack(db);
    const shareId = await seedShare(db, track, "gift");

    const info = await app.inject({ method: "GET", url: `/share/${shareId}` });
    assert.equal(info.statusCode, 200, info.body);
    const body = info.json();
    assert.equal(body.app_only, false);
    assert.ok(
      body.web_stream_url,
      "gift share must include web_stream_url for browsers",
    );

    // The browser gate must not fire; storage is stubbed empty so any
    // non-403 status proves the gate passed (byte serving is covered elsewhere).
    const audio = await app.inject({
      method: "GET",
      url: `/share/${shareId}/audio`,
    });
    assert.notEqual(audio.statusCode, 403, audio.body);
  });

  test("normal (lifetime) share keeps the app-only wall in browsers", async () => {
    const track = await seedTrack(db, { id: "app_track", userId: "app_user" });
    const shareId = await seedShare(db, track, "lifetime");

    const info = await app.inject({ method: "GET", url: `/share/${shareId}` });
    assert.equal(info.statusCode, 200, info.body);
    const body = info.json();
    assert.equal(body.app_only, true);
    assert.equal(body.web_stream_url ?? null, null);

    const audio = await app.inject({
      method: "GET",
      url: `/share/${shareId}/audio`,
    });
    assert.equal(audio.statusCode, 403);
    assert.equal(audio.json().code ?? audio.json().error, "APP_REQUIRED");
  });

  test("createOrGetShareToken persists shareType and never upgrades gift away", async () => {
    const track = await seedTrack(db, { id: "svc_track", userId: "svc_user" });

    const first = await createOrGetShareToken({
      db,
      trackId: track.id,
      trackVersionId: track.versionId,
      userId: track.userId,
      buildShareUrl: (id) => `http://public.local/play/${id}`,
      requirePin: false,
      shareType: "gift",
    });
    const row = await db
      .prepare("SELECT share_type, claim_pin FROM share_tokens WHERE id = ?")
      .get(first.shareId);
    assert.equal(row.share_type, "gift");
    assert.equal(row.claim_pin, null);

    // Idempotent reuse must not "upgrade" the gift token to lifetime.
    const second = await createOrGetShareToken({
      db,
      trackId: track.id,
      trackVersionId: track.versionId,
      userId: track.userId,
      buildShareUrl: (id) => `http://public.local/play/${id}`,
      requirePin: false,
    });
    assert.equal(second.shareId, first.shareId);
    assert.equal(second.existing, true);
    const after = await db
      .prepare("SELECT share_type FROM share_tokens WHERE id = ?")
      .get(first.shareId);
    assert.equal(after.share_type, "gift");
  });
});
