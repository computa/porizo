require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");
const adminAuthService = require("../src/services/admin-auth-service");

function buildTestApp(db) {
  return buildServer({
    db,
    config: { STORAGE_DIR: "/tmp/test-storage" },
    storage: {
      put: async () => {},
      get: async () => null,
      exists: async () => false,
      delete: async () => {},
      getSignedUrl: async (key) => `http://localhost/${key}`,
    },
  });
}

async function loginAdmin(app, email = "admin@porizo.app") {
  const response = await app.inject({
    method: "POST",
    url: "/admin/auth/login",
    payload: { email, password: "admin123" },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().token;
}

async function seedVersion(
  db,
  {
    userId = "user_mod_route",
    trackId,
    versionId,
    moderationStatus = "blocked",
    createdAt,
    title,
  },
) {
  await db
    .prepare("INSERT OR IGNORE INTO users (id, email, created_at) VALUES (?, ?, ?)")
    .run(userId, `${userId}@example.com`, "2026-06-27T08:00:00.000Z");
  await db
    .prepare(
      `INSERT OR IGNORE INTO tracks
        (id, user_id, status, title, occasion, recipient_name, latest_version, created_at, updated_at)
       VALUES (?, ?, 'ready', ?, 'birthday', 'Maya', 1, ?, ?)`,
    )
    .run(
      trackId,
      userId,
      title,
      "2026-06-27T08:30:00.000Z",
      "2026-06-27T08:30:00.000Z",
    );
  await db
    .prepare(
      `INSERT INTO track_versions
        (id, track_id, version_num, status, render_type, params_hash, moderation_status, moderation_reason, moderation_details_json, created_at)
       VALUES (?, ?, 1, 'failed', 'preview', ?, ?, 'policy', '{"category":"lyrics"}', ?)`,
    )
    .run(
      versionId,
      trackId,
      `${versionId}_hash`,
      moderationStatus,
      createdAt,
    );
}

describe("admin moderation routes", () => {
  let db;
  let app;
  let adminHeaders;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildTestApp(db);
    const token = await loginAdmin(app);
    adminHeaders = { Authorization: `Bearer ${token}` };
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("GET /admin/dashboard/moderation/queue returns blocked versions only in newest-first order", async () => {
    await seedVersion(db, {
      trackId: "track_mod_route_old",
      versionId: "version_mod_route_old",
      moderationStatus: "blocked",
      createdAt: "2026-06-27T09:00:00.000Z",
      title: "Old Blocked",
    });
    await seedVersion(db, {
      trackId: "track_mod_route_new",
      versionId: "version_mod_route_new",
      moderationStatus: "blocked",
      createdAt: "2026-06-27T10:00:00.000Z",
      title: "New Blocked",
    });
    await seedVersion(db, {
      trackId: "track_mod_route_approved",
      versionId: "version_mod_route_approved",
      moderationStatus: "approved",
      createdAt: "2026-06-27T11:00:00.000Z",
      title: "Approved",
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/moderation/queue?limit=500&offset=-10",
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(
      response.json().items.map((item) => ({
        id: item.id,
        track_id: item.track_id,
        title: item.title,
        moderation_status: item.moderation_status,
      })),
      [
        {
          id: "version_mod_route_new",
          track_id: "track_mod_route_new",
          title: "New Blocked",
          moderation_status: "blocked",
        },
        {
          id: "version_mod_route_old",
          track_id: "track_mod_route_old",
          title: "Old Blocked",
          moderation_status: "blocked",
        },
      ],
    );
  });

  test("GET /admin/dashboard/moderation/queue requires an admin session", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/moderation/queue",
    });

    assert.equal(response.statusCode, 401, response.body);
    assert.equal(response.json().error, "UNAUTHORIZED");
  });

  test("POST /admin/dashboard/moderation/:versionId/override approves blocked content and audits it", async () => {
    await seedVersion(db, {
      trackId: "track_mod_route_override",
      versionId: "version_mod_route_override",
      moderationStatus: "blocked",
      createdAt: "2026-06-27T09:00:00.000Z",
      title: "Override Me",
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/dashboard/moderation/version_mod_route_override/override",
      headers: adminHeaders,
      payload: { reason: "manual review passed" },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { success: true });
    assert.deepEqual(
      await db
        .prepare(
          "SELECT moderation_status, moderation_reason FROM track_versions WHERE id = ?",
        )
        .get("version_mod_route_override"),
      {
        moderation_status: "approved",
        moderation_reason: "Admin override: manual review passed",
      },
    );

    const auditRow = await db
      .prepare(
        "SELECT action, resource_type, resource_id, metadata_json FROM audit_logs WHERE action = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get("admin_moderation_override");
    assert.equal(auditRow.resource_type, "track_version");
    assert.equal(auditRow.resource_id, "version_mod_route_override");
    assert.equal(JSON.parse(auditRow.metadata_json).reason, "manual review passed");
  });

  test("POST /admin/dashboard/moderation/:versionId/override requires superadmin", async () => {
    await seedVersion(db, {
      trackId: "track_mod_route_guard",
      versionId: "version_mod_route_guard",
      moderationStatus: "blocked",
      createdAt: "2026-06-27T09:00:00.000Z",
      title: "Guarded Override",
    });

    const unauthenticated = await app.inject({
      method: "POST",
      url: "/admin/dashboard/moderation/version_mod_route_guard/override",
      payload: { reason: "manual review passed" },
    });
    assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);
    assert.equal(unauthenticated.json().error, "UNAUTHORIZED");

    const createdAdmin = await adminAuthService.createAdmin(
      "moderation-admin@example.com",
      "admin123",
      "Moderation Admin",
      "admin",
    );
    assert.equal(createdAdmin.success, true);
    const adminToken = await loginAdmin(app, "moderation-admin@example.com");
    const forbidden = await app.inject({
      method: "POST",
      url: "/admin/dashboard/moderation/version_mod_route_guard/override",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { reason: "manual review passed" },
    });

    assert.equal(forbidden.statusCode, 403, forbidden.body);
    assert.equal(forbidden.json().error, "FORBIDDEN");
    assert.deepEqual(
      await db
        .prepare(
          "SELECT moderation_status, moderation_reason FROM track_versions WHERE id = ?",
        )
        .get("version_mod_route_guard"),
      {
        moderation_status: "blocked",
        moderation_reason: "policy",
      },
    );
  });

  test("POST /admin/dashboard/moderation/:versionId/override rejects missing and non-blocked versions", async () => {
    await seedVersion(db, {
      trackId: "track_mod_route_nonblocked",
      versionId: "version_mod_route_nonblocked",
      moderationStatus: "approved",
      createdAt: "2026-06-27T09:00:00.000Z",
      title: "Already Approved",
    });

    const missing = await app.inject({
      method: "POST",
      url: "/admin/dashboard/moderation/missing_version/override",
      headers: adminHeaders,
      payload: { reason: "manual review passed" },
    });
    assert.equal(missing.statusCode, 404, missing.body);
    assert.match(missing.body, /TRACK_VERSION_NOT_FOUND/);

    const nonBlocked = await app.inject({
      method: "POST",
      url: "/admin/dashboard/moderation/version_mod_route_nonblocked/override",
      headers: adminHeaders,
      payload: { reason: "manual review passed" },
    });
    assert.equal(nonBlocked.statusCode, 409, nonBlocked.body);
    assert.match(nonBlocked.body, /TRACK_VERSION_NOT_BLOCKED/);

    assert.deepEqual(
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'admin_moderation_override'",
        )
        .get(),
      { count: 0 },
    );
  });

  test("POST /admin/dashboard/moderation/:versionId/override rejects weak reasons before mutating", async () => {
    await seedVersion(db, {
      trackId: "track_mod_route_weak_reason",
      versionId: "version_mod_route_weak_reason",
      moderationStatus: "blocked",
      createdAt: "2026-06-27T09:00:00.000Z",
      title: "Weak Reason",
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/dashboard/moderation/version_mod_route_weak_reason/override",
      headers: adminHeaders,
      payload: { reason: "   " },
    });

    assert.equal(response.statusCode, 400, response.body);
    assert.match(response.body, /MISSING_REASON/);
    assert.deepEqual(
      await db
        .prepare(
          "SELECT moderation_status, moderation_reason FROM track_versions WHERE id = ?",
        )
        .get("version_mod_route_weak_reason"),
      {
        moderation_status: "blocked",
        moderation_reason: "policy",
      },
    );
  });
});
