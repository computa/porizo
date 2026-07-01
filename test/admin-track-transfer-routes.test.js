require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");
const adminAuthService = require("../src/services/admin-auth-service");

const NOW = "2026-06-27T10:00:00.000Z";

async function seedUser(
  db,
  {
    id,
    email = `${id}@example.com`,
    displayName = id,
    deletedAt = null,
  },
) {
  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, created_at, risk_level, deleted_at)
       VALUES (?, ?, ?, ?, 'low', ?)`,
    )
    .run(id, email, displayName, NOW, deletedAt);
}

async function seedTrackForTransfer(
  db,
  {
    sourceUserId = "route_source_user",
    targetUserId = "route_target_user",
    trackId = "route_transfer_track",
    versionId = "route_transfer_track_v1",
    shareId = "route_transfer_share",
    targetDeletedAt = null,
  } = {},
) {
  await seedUser(db, {
    id: sourceUserId,
    email: "route-source@example.com",
    displayName: "Route Source",
  });
  await seedUser(db, {
    id: targetUserId,
    email: "route-target@example.com",
    displayName: "Route Target",
    deletedAt: targetDeletedAt,
  });
  await db
    .prepare(
      `INSERT INTO tracks (
        id, user_id, status, title, occasion, recipient_name, style, created_at, updated_at
      ) VALUES (?, ?, 'complete', 'Route Transfer Song', 'birthday', 'Ada', 'pop', ?, ?)`,
    )
    .run(trackId, sourceUserId, NOW, NOW);
  await db
    .prepare(
      `INSERT INTO track_versions (
        id, track_id, version_num, status, render_type, params_hash, created_at
      ) VALUES (?, ?, 1, 'complete', 'full', ?, ?)`,
    )
    .run(versionId, trackId, `${trackId}_hash`, NOW);
  await db
    .prepare(
      `INSERT INTO track_library_entries (
        user_id, track_id, origin, added_at, updated_at
      ) VALUES (?, ?, 'created', ?, ?)`,
    )
    .run(sourceUserId, trackId, NOW, NOW);
  await db
    .prepare(
      `INSERT INTO share_tokens (
        id, track_id, track_version_id, creator_id, status, bound_device_id,
        bound_device_platform, bound_app_version, bound_user_id, bound_at,
        claim_pin, claim_attempts, expires_at, created_at
      ) VALUES (?, ?, ?, ?, 'claimed', 'route-device', 'ios', '1.2.3', 'route_recipient', ?, '654321', 6, ?, ?)`,
    )
    .run(
      shareId,
      trackId,
      versionId,
      sourceUserId,
      "2026-06-27T09:30:00.000Z",
      "2026-07-27T10:00:00.000Z",
      NOW,
    );
  await seedUser(db, {
    id: "route_recipient",
    email: "route-recipient@example.com",
    displayName: "Route Recipient",
  });
  await db
    .prepare(
      `INSERT INTO track_library_entries (
        user_id, track_id, origin, share_token_id, added_at, updated_at
      ) VALUES ('route_recipient', ?, 'received', ?, ?, ?)`,
    )
    .run(trackId, shareId, NOW, NOW);
  return { sourceUserId, targetUserId, trackId, versionId, shareId };
}

describe("admin track-transfer routes", () => {
  let db;
  let app;
  let superadminToken;
  let adminToken;

  async function loginAdmin(email, password = "admin123") {
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
    superadminToken = await loginAdmin("admin@porizo.app");
    const createdAdmin = await adminAuthService.createAdmin(
      "route-admin@example.com",
      "admin123",
      "Route Admin",
      "admin",
    );
    assert.equal(createdAdmin.success, true);
    adminToken = await loginAdmin("route-admin@example.com");
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("superadmin transfers a track and receives verification of moved state", async () => {
    const graph = await seedTrackForTransfer(db);

    const response = await app.inject({
      method: "POST",
      url: `/admin/dashboard/tracks/${graph.trackId}/transfer`,
      headers: { Authorization: `Bearer ${superadminToken}` },
      payload: { target_user_id: graph.targetUserId },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {
      transferred: true,
      track_id: graph.trackId,
      title: "Route Transfer Song",
      from_user: graph.sourceUserId,
      to_user: graph.targetUserId,
      to_name: "Route Target",
      verification: {
        track_owner: graph.targetUserId,
        library_owner: graph.targetUserId,
        library_origin: "created",
        source_library_entries: 0,
        active_received_entries: 0,
        share_creator: graph.targetUserId,
        share_status: "unbound",
        share_bound_device_id: null,
        share_bound_device_platform: null,
        share_bound_app_version: null,
        share_bound_user_id: null,
        share_bound_at: null,
      },
    });

    assert.equal(
      await db
        .prepare("SELECT user_id FROM tracks WHERE id = ?")
        .get(graph.trackId).user_id,
      graph.targetUserId,
    );
    assert.equal(
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM track_library_entries WHERE track_id = ? AND user_id = ?",
        )
        .get(graph.trackId, graph.sourceUserId).count,
      0,
    );
    assert.deepEqual(
      await db
        .prepare(
          `SELECT creator_id, status, bound_device_id, bound_device_platform,
                  bound_app_version, bound_user_id, bound_at, claim_pin, claim_attempts
           FROM share_tokens WHERE id = ?`,
        )
        .get(graph.shareId),
      {
        creator_id: graph.targetUserId,
        status: "unbound",
        bound_device_id: null,
        bound_device_platform: null,
        bound_app_version: null,
        bound_user_id: null,
        bound_at: null,
        claim_pin: "654321",
        claim_attempts: 0,
      },
    );
    assert.equal(
      await db
        .prepare(
          "SELECT removed_at FROM track_library_entries WHERE track_id = ? AND user_id = 'route_recipient'",
        )
        .get(graph.trackId).removed_at !== null,
      true,
    );
    const audit = await db
      .prepare(
        "SELECT user_id, action, resource_type, resource_id, metadata_json FROM audit_logs WHERE action = 'track_transferred'",
      )
      .get();
    assert.equal(audit.user_id, "adm_initial");
    assert.equal(audit.resource_type, "track");
    assert.equal(audit.resource_id, graph.trackId);
    assert.deepEqual(JSON.parse(audit.metadata_json), {
      actor: "admin",
      admin_id: "adm_initial",
      admin_email: "admin@porizo.app",
      from_user: graph.sourceUserId,
      to_user: graph.targetUserId,
    });
  });

  test("plain admins cannot transfer tracks", async () => {
    const graph = await seedTrackForTransfer(db);

    const response = await app.inject({
      method: "POST",
      url: `/admin/dashboard/tracks/${graph.trackId}/transfer`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { target_user_id: graph.targetUserId },
    });

    assert.equal(response.statusCode, 403, response.body);
  });

  test("blocks transfers while a track has queued, processing, or running jobs", async () => {
    const graph = await seedTrackForTransfer(db);
    await db
      .prepare(
        `INSERT INTO jobs (
          id, track_version_id, workflow_type, status, created_at, updated_at
        ) VALUES ('route_active_job', ?, 'song_render', 'running', ?, ?)`,
      )
      .run(graph.versionId, NOW, NOW);

    const response = await app.inject({
      method: "POST",
      url: `/admin/dashboard/tracks/${graph.trackId}/transfer`,
      headers: { Authorization: `Bearer ${superadminToken}` },
      payload: { target_user_id: graph.targetUserId },
    });

    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json().error, "ACTIVE_JOB");
    assert.equal(
      await db
        .prepare("SELECT user_id FROM tracks WHERE id = ?")
        .get(graph.trackId).user_id,
      graph.sourceUserId,
    );
  });

  test("rejects soft-deleted target users before transfer writes begin", async () => {
    const graph = await seedTrackForTransfer(db, {
      targetUserId: "route_deleted_target",
      targetDeletedAt: "2026-06-27T09:00:00.000Z",
    });

    const response = await app.inject({
      method: "POST",
      url: `/admin/dashboard/tracks/${graph.trackId}/transfer`,
      headers: { Authorization: `Bearer ${superadminToken}` },
      payload: { target_user_id: graph.targetUserId },
    });

    assert.equal(response.statusCode, 404, response.body);
    assert.equal(response.json().error, "USER_NOT_FOUND");
    assert.equal(
      await db
        .prepare("SELECT user_id FROM tracks WHERE id = ?")
        .get(graph.trackId).user_id,
      graph.sourceUserId,
    );
    assert.equal(
      await db
        .prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = ?")
        .get("track_transferred").count,
      0,
    );
  });
});
