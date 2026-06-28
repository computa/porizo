require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");
const adminAuthService = require("../src/services/admin-auth-service");

const NOW = "2026-06-27T10:00:00.000Z";
const DEMO_EXPIRES_AT = "2125-01-01T00:00:00.000Z";

async function seedUser(db, id) {
  await db
    .prepare("INSERT INTO users (id, created_at, risk_level) VALUES (?, ?, 'low')")
    .run(id, NOW);
}

async function seedTrack(db, { id = "route_track", userId = "route_user" } = {}) {
  await seedUser(db, userId);
  await db
    .prepare(
      `INSERT INTO tracks (
        id, user_id, status, title, occasion, recipient_name, style, created_at, updated_at
      ) VALUES (?, ?, 'complete', 'Route Song', 'birthday', 'Ada', 'pop', ?, ?)`,
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

async function seedPoem(db, { id = "route_poem", userId = "route_poem_user" } = {}) {
  await seedUser(db, userId);
  await db
    .prepare(
      `INSERT INTO poems (
        id, user_id, title, recipient_name, occasion, tone, verses, status, created_at, updated_at
      ) VALUES (?, ?, 'Route Poem', 'Ada', 'birthday', 'heartfelt', '[]', 'complete', ?, ?)`,
    )
    .run(id, userId, NOW, NOW);
  return { id, userId };
}

describe("admin demo-share routes", () => {
  let db;
  let app;
  let adminToken;
  let viewerToken;

  async function loginAdmin(email = "admin@porizo.app", password = "admin123") {
    const response = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: { email, password },
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json().token;
  }

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
    adminToken = await loginAdmin();
    const createdViewer = await adminAuthService.createAdmin(
      "demo-viewer@example.com",
      "admin123",
      "Demo Viewer",
      "viewer",
    );
    assert.equal(createdViewer.success, true);
    viewerToken = await loginAdmin("demo-viewer@example.com", "admin123");
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("creates and lists song demo shares with audit logging", async () => {
    const track = await seedTrack(db);

    const createResponse = await app.inject({
      method: "POST",
      url: "/admin/dashboard/demo-shares",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { resource_type: "song", resource_id: track.id },
    });

    assert.equal(createResponse.statusCode, 200, createResponse.body);
    const created = createResponse.json();
    assert.equal(created.success, true);
    assert.equal(created.resource_type, "song");
    assert.equal(created.resource_id, track.id);
    assert.match(created.share_url, /^http:\/\/public\.local\/play\/.+\?web=1$/);

    const share = await db
      .prepare(
        `SELECT id, track_id, track_version_id, creator_id, status, share_type,
                expires_at, web_stream_allowed, created_at
         FROM share_tokens WHERE id = ?`,
      )
      .get(created.share_id);
    assert.deepEqual(share, {
      id: created.share_id,
      track_id: track.id,
      track_version_id: track.versionId,
      creator_id: track.userId,
      status: "unbound",
      share_type: "demo",
      expires_at: DEMO_EXPIRES_AT,
      web_stream_allowed: 1,
      created_at: share.created_at,
    });

    const audit = await db
      .prepare(
        "SELECT action, resource_type, resource_id, metadata_json FROM audit_logs WHERE resource_id = ?",
      )
      .get(created.share_id);
    assert.equal(audit.action, "admin_create_demo_share");
    assert.equal(audit.resource_type, "share_token");
    assert.deepEqual(JSON.parse(audit.metadata_json), {
      actor: "admin",
      admin_id: "adm_initial",
      resource_type: "song",
      resource_id: track.id,
      action: "created_new",
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/admin/dashboard/demo-shares",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(listResponse.statusCode, 200, listResponse.body);
    assert.deepEqual(listResponse.json().demo_shares, [
      {
        id: created.share_id,
        resource_id: track.id,
        resource_type: "song",
        title: "Route Song",
        access_count: 0,
        created_at: share.created_at,
        status: "unbound",
        share_url: `http://public.local/play/${created.share_id}?web=1`,
      },
    ]);
  });

  test("creates poem demo shares without mutating existing non-demo shares and revokes them", async () => {
    const poem = await seedPoem(db);
    await db
      .prepare(
        `INSERT INTO poem_share_tokens (
          id, poem_id, creator_id, status, share_type, claim_pin, bound_user_id,
          claim_attempts, expires_at, allow_save, created_at
        ) VALUES (?, ?, ?, 'claimed', 'gift', '123456', 'recipient_user', 5, ?, 1, ?)`,
      )
      .run("route_poem_share", poem.id, poem.userId, NOW, NOW);

    const createResponse = await app.inject({
      method: "POST",
      url: "/admin/dashboard/demo-shares",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { resource_type: "poem", resource_id: poem.id },
    });

    assert.equal(createResponse.statusCode, 200, createResponse.body);
    const created = createResponse.json();
    assert.equal(created.success, true);
    assert.notEqual(created.share_id, "route_poem_share");
    assert.deepEqual(created, {
      success: true,
      share_id: created.share_id,
      share_url: `http://public.local/poem/${created.share_id}?web=1`,
      resource_type: "poem",
      resource_id: poem.id,
    });

    assert.deepEqual(
      await db
        .prepare(
          `SELECT status, share_type, claim_pin, bound_user_id, claim_attempts, expires_at
           FROM poem_share_tokens WHERE id = ?`,
        )
        .get(created.share_id),
      {
        status: "active",
        share_type: "demo",
        claim_pin: null,
        bound_user_id: null,
        claim_attempts: 0,
        expires_at: DEMO_EXPIRES_AT,
      },
    );
    assert.deepEqual(
      await db
        .prepare(
          `SELECT status, share_type, claim_pin, bound_user_id, claim_attempts
           FROM poem_share_tokens WHERE id = ?`,
        )
        .get("route_poem_share"),
      {
        status: "claimed",
        share_type: "gift",
        claim_pin: "123456",
        bound_user_id: "recipient_user",
        claim_attempts: 5,
      },
    );

    const revokeResponse = await app.inject({
      method: "POST",
      url: `/admin/dashboard/demo-share/${created.share_id}/revoke`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(revokeResponse.statusCode, 200, revokeResponse.body);
    assert.deepEqual(revokeResponse.json(), { success: true, revoked: true });
    assert.equal(
      (
        await db
          .prepare("SELECT status FROM poem_share_tokens WHERE id = ?")
          .get(created.share_id)
      ).status,
      "revoked",
    );

    const audit = await db
      .prepare(
        "SELECT action, resource_type, resource_id, metadata_json FROM audit_logs WHERE action = 'admin_revoke_demo_share'",
      )
      .get();
    assert.equal(audit.resource_type, "poem_share_token");
    assert.equal(audit.resource_id, created.share_id);
    assert.deepEqual(JSON.parse(audit.metadata_json), {
      actor: "admin",
      admin_id: "adm_initial",
      resource_type: "poem",
      poem_id: poem.id,
    });
  });

  test("converts existing stale song demo shares and revokes song shares", async () => {
    const track = await seedTrack(db, { id: "existing_song_demo" });
    await db
      .prepare(
        `INSERT INTO share_tokens (
          id, track_id, track_version_id, creator_id, status, share_type,
          claim_pin, expires_at, web_stream_allowed, bound_device_id,
          bound_device_platform, bound_app_version, bound_at, bound_user_id,
          created_at
        ) VALUES (
          'existing_song_demo_share', ?, ?, ?, 'claimed', 'demo',
          '123456', ?, 0, 'device_1', 'ios', '1.0.0', ?, 'bound_user', ?
        )`,
      )
      .run(track.id, track.versionId, track.userId, NOW, NOW, NOW);

    const createResponse = await app.inject({
      method: "POST",
      url: "/admin/dashboard/demo-shares",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { resource_type: "song", resource_id: track.id },
    });

    assert.equal(createResponse.statusCode, 200, createResponse.body);
    assert.deepEqual(createResponse.json(), {
      success: true,
      share_id: "existing_song_demo_share",
      share_url: "http://public.local/play/existing_song_demo_share?web=1",
      resource_type: "song",
      resource_id: track.id,
    });

    assert.deepEqual(
      await db
        .prepare(
          `SELECT status, share_type, claim_pin, expires_at, web_stream_allowed,
                  bound_device_id, bound_device_platform, bound_app_version,
                  bound_at, bound_user_id
           FROM share_tokens WHERE id = ?`,
        )
        .get("existing_song_demo_share"),
      {
        status: "unbound",
        share_type: "demo",
        claim_pin: null,
        expires_at: DEMO_EXPIRES_AT,
        web_stream_allowed: 1,
        bound_device_id: null,
        bound_device_platform: null,
        bound_app_version: null,
        bound_at: null,
        bound_user_id: null,
      },
    );

    const createAudit = await db
      .prepare(
        "SELECT metadata_json FROM audit_logs WHERE action = 'admin_create_demo_share' AND resource_id = ?",
      )
      .get("existing_song_demo_share");
    assert.deepEqual(JSON.parse(createAudit.metadata_json), {
      actor: "admin",
      admin_id: "adm_initial",
      resource_type: "song",
      resource_id: track.id,
      action: "converted_existing",
    });

    const revokeResponse = await app.inject({
      method: "POST",
      url: "/admin/dashboard/demo-share/existing_song_demo_share/revoke",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(revokeResponse.statusCode, 200, revokeResponse.body);
    assert.deepEqual(revokeResponse.json(), { success: true, revoked: true });
    assert.equal(
      (
        await db
          .prepare("SELECT status FROM share_tokens WHERE id = ?")
          .get("existing_song_demo_share")
      ).status,
      "revoked",
    );

    const revokeAudit = await db
      .prepare(
        "SELECT resource_type, resource_id, metadata_json FROM audit_logs WHERE action = 'admin_revoke_demo_share'",
      )
      .get();
    assert.equal(revokeAudit.resource_type, "share_token");
    assert.equal(revokeAudit.resource_id, "existing_song_demo_share");
    assert.deepEqual(JSON.parse(revokeAudit.metadata_json), {
      actor: "admin",
      admin_id: "adm_initial",
      resource_type: "song",
      track_id: track.id,
    });
  });

  test("converts existing stale poem demo shares without creating a new token", async () => {
    const poem = await seedPoem(db, { id: "existing_poem_demo" });
    await db
      .prepare(
        `INSERT INTO poem_share_tokens (
          id, poem_id, creator_id, status, share_type, claim_pin,
          bound_user_id, claim_attempts, expires_at, allow_save, created_at
        ) VALUES (
          'existing_poem_demo_share', ?, ?, 'claimed', 'demo', '654321',
          'bound_poem_user', 4, ?, 1, ?
        )`,
      )
      .run(poem.id, poem.userId, NOW, NOW);

    const response = await app.inject({
      method: "POST",
      url: "/admin/dashboard/demo-shares",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { resource_type: "poem", resource_id: poem.id },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {
      success: true,
      share_id: "existing_poem_demo_share",
      share_url: "http://public.local/poem/existing_poem_demo_share?web=1",
      resource_type: "poem",
      resource_id: poem.id,
    });

    assert.deepEqual(
      await db
        .prepare(
          `SELECT status, share_type, claim_pin, bound_user_id, claim_attempts, expires_at
           FROM poem_share_tokens WHERE id = ?`,
        )
        .get("existing_poem_demo_share"),
      {
        status: "active",
        share_type: "demo",
        claim_pin: null,
        bound_user_id: null,
        claim_attempts: 0,
        expires_at: DEMO_EXPIRES_AT,
      },
    );

    const audit = await db
      .prepare(
        "SELECT metadata_json FROM audit_logs WHERE action = 'admin_create_demo_share' AND resource_id = ?",
      )
      .get("existing_poem_demo_share");
    assert.deepEqual(JSON.parse(audit.metadata_json), {
      actor: "admin",
      admin_id: "adm_initial",
      resource_type: "poem",
      resource_id: poem.id,
      action: "converted_existing",
    });
  });

  test("blocks viewer admins from mutating demo shares", async () => {
    const track = await seedTrack(db, { id: "viewer_track" });

    const createResponse = await app.inject({
      method: "POST",
      url: "/admin/dashboard/demo-shares",
      headers: { Authorization: `Bearer ${viewerToken}` },
      payload: { resource_type: "song", resource_id: track.id },
    });
    assert.equal(createResponse.statusCode, 403, createResponse.body);

    const revokeResponse = await app.inject({
      method: "POST",
      url: "/admin/dashboard/demo-share/anything/revoke",
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    assert.equal(revokeResponse.statusCode, 403, revokeResponse.body);
  });

  test("rejects invalid and missing demo-share resources", async () => {
    const invalidType = await app.inject({
      method: "POST",
      url: "/admin/dashboard/demo-shares",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { resource_type: "video", resource_id: "anything" },
    });
    assert.equal(invalidType.statusCode, 400, invalidType.body);
    assert.equal(invalidType.json().error, "INVALID_PARAMS");

    const missingResourceId = await app.inject({
      method: "POST",
      url: "/admin/dashboard/demo-shares",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { resource_type: "song" },
    });
    assert.equal(missingResourceId.statusCode, 400, missingResourceId.body);
    assert.equal(missingResourceId.json().error, "INVALID_PARAMS");

    const missingSong = await app.inject({
      method: "POST",
      url: "/admin/dashboard/demo-shares",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { resource_type: "song", resource_id: "missing_track" },
    });
    assert.equal(missingSong.statusCode, 404, missingSong.body);
    assert.equal(missingSong.json().error, "TRACK_NOT_FOUND");

    const trackWithoutVersion = await seedTrack(db, {
      id: "track_without_version",
    });
    await db
      .prepare("DELETE FROM track_versions WHERE track_id = ?")
      .run(trackWithoutVersion.id);
    const noVersion = await app.inject({
      method: "POST",
      url: "/admin/dashboard/demo-shares",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { resource_type: "song", resource_id: trackWithoutVersion.id },
    });
    assert.equal(noVersion.statusCode, 400, noVersion.body);
    assert.equal(noVersion.json().error, "NO_VERSION");

    const missingShare = await app.inject({
      method: "POST",
      url: "/admin/dashboard/demo-share/missing_share/revoke",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(missingShare.statusCode, 404, missingShare.body);
    assert.equal(missingShare.json().error, "DEMO_SHARE_NOT_FOUND");
  });
});
