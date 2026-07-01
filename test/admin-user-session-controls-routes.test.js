require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");
const adminAuthService = require("../src/services/admin-auth-service");

const NOW = "2026-06-27T10:00:00.000Z";

function buildTestApp(db) {
  return buildServer({
    db,
    config: {
      STORAGE_DIR: "/tmp/test-storage",
      PUBLIC_BASE_URL: "http://public.local",
      STREAM_BASE_URL: "http://stream.local",
      ALLOW_ANON_USER_ID: true,
    },
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
  return { Authorization: `Bearer ${response.json().token}` };
}

async function seedUser(db, id, fields = {}) {
  await db
    .prepare(
      `INSERT INTO users (
        id, email, display_name, created_at, risk_level, country
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      fields.email ?? `${id}@example.com`,
      fields.displayName ?? id,
      fields.createdAt ?? NOW,
      fields.riskLevel ?? "low",
      fields.country ?? "US",
    );
}

async function seedSession(db, fields) {
  await db
    .prepare(
      `INSERT INTO user_sessions (
        id, user_id, device_name, ip_address, user_agent,
        last_active_at, revoked_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fields.id,
      fields.userId,
      fields.deviceName ?? null,
      fields.ipAddress ?? null,
      fields.userAgent ?? null,
      fields.lastActiveAt ?? NOW,
      fields.revokedAt ?? null,
      fields.createdAt ?? NOW,
    );
}

async function seedVoiceProfile(db, fields) {
  await db
    .prepare(
      `INSERT INTO voice_profiles (
        id, user_id, status, embedding_ref, quality_score, model_version,
        consent_version, consent_at, last_verified_at, created_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fields.id,
      fields.userId,
      fields.status ?? "active",
      fields.embeddingRef ?? null,
      fields.qualityScore ?? 0.95,
      fields.modelVersion ?? "test-model",
      fields.consentVersion ?? "2026-01",
      fields.consentAt ?? NOW,
      fields.lastVerifiedAt ?? NOW,
      fields.createdAt ?? NOW,
      fields.deletedAt ?? null,
    );
}

async function latestAudit(db, action, resourceId) {
  const row = await db
    .prepare(
      `SELECT user_id, action, resource_type, resource_id, metadata_json
       FROM audit_logs
       WHERE action = ? AND resource_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(action, resourceId);
  assert.ok(row, `expected audit row ${action} for ${resourceId}`);
  return { ...row, metadata: JSON.parse(row.metadata_json) };
}

describe("admin user session control routes", () => {
  let db;
  let app;
  let superadminHeaders;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildTestApp(db);
    superadminHeaders = await loginAdmin(app);
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("session routes require admin session and superadmin for revocation", async () => {
    const userId = "admin_session_guard_user";
    await seedUser(db, userId);

    const unauthenticatedList = await app.inject({
      method: "GET",
      url: `/admin/dashboard/users/${userId}/sessions`,
    });
    assert.equal(unauthenticatedList.statusCode, 401, unauthenticatedList.body);
    assert.equal(unauthenticatedList.json().error, "UNAUTHORIZED");

    const created = await adminAuthService.createAdmin(
      "session-guard-admin@example.com",
      "admin123",
      "Session Guard Admin",
      "admin",
    );
    assert.equal(created.success, true);
    const adminHeaders = await loginAdmin(app, "session-guard-admin@example.com");

    const forbiddenRevoke = await app.inject({
      method: "POST",
      url: `/admin/dashboard/users/${userId}/sessions/session_guard/revoke`,
      headers: adminHeaders,
      payload: { reason: "not allowed" },
    });
    assert.equal(forbiddenRevoke.statusCode, 403, forbiddenRevoke.body);
    assert.equal(forbiddenRevoke.json().error, "FORBIDDEN");

    const forbiddenRevokeAll = await app.inject({
      method: "POST",
      url: `/admin/dashboard/users/${userId}/sessions/revoke-all`,
      headers: adminHeaders,
      payload: { reason: "not allowed" },
    });
    assert.equal(forbiddenRevokeAll.statusCode, 403, forbiddenRevokeAll.body);
    assert.equal(forbiddenRevokeAll.json().error, "FORBIDDEN");
  });

  test("lists only active sessions in last-active order", async () => {
    const userId = "admin_session_list_user";
    await seedUser(db, userId);
    await seedSession(db, {
      id: "session_old",
      userId,
      deviceName: "Old iPhone",
      ipAddress: "203.0.113.10",
      userAgent: "Porizo/1.0 old",
      lastActiveAt: "2026-06-20T10:00:00.000Z",
    });
    await seedSession(db, {
      id: "session_new",
      userId,
      deviceName: "New iPhone",
      ipAddress: "203.0.113.11",
      userAgent: "Porizo/1.0 new",
      lastActiveAt: "2026-06-27T09:00:00.000Z",
    });
    await seedSession(db, {
      id: "session_revoked",
      userId,
      revokedAt: "2026-06-25T10:00:00.000Z",
      lastActiveAt: "2026-06-27T10:00:00.000Z",
    });

    const response = await app.inject({
      method: "GET",
      url: `/admin/dashboard/users/${userId}/sessions`,
      headers: superadminHeaders,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().sessions, [
      {
        id: "session_new",
        device_name: "New iPhone",
        ip_address: "203.0.113.11",
        user_agent: "Porizo/1.0 new",
        created_at: NOW,
        last_active_at: "2026-06-27T09:00:00.000Z",
      },
      {
        id: "session_old",
        device_name: "Old iPhone",
        ip_address: "203.0.113.10",
        user_agent: "Porizo/1.0 old",
        created_at: NOW,
        last_active_at: "2026-06-20T10:00:00.000Z",
      },
    ]);
  });

  test("revokes one active session and writes audit metadata", async () => {
    const userId = "admin_session_revoke_user";
    await seedUser(db, userId);
    await seedSession(db, { id: "session_target", userId });
    await seedSession(db, { id: "session_keep", userId });

    const response = await app.inject({
      method: "POST",
      url: `/admin/dashboard/users/${userId}/sessions/session_target/revoke`,
      headers: superadminHeaders,
      payload: { reason: "lost device" },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { success: true });

    const target = await db
      .prepare("SELECT revoked_at FROM user_sessions WHERE id = ?")
      .get("session_target");
    assert.ok(target.revoked_at, "target session should be revoked");

    const keep = await db
      .prepare("SELECT revoked_at FROM user_sessions WHERE id = ?")
      .get("session_keep");
    assert.equal(keep.revoked_at, null);

    const audit = await latestAudit(db, "admin_revoke_session", "session_target");
    assert.equal(audit.resource_type, "session");
    assert.equal(audit.metadata.targetUserId, userId);
    assert.equal(audit.metadata.reason, "lost device");
  });

  test("returns not found when revoking a missing or already revoked session", async () => {
    const userId = "admin_session_missing_user";
    await seedUser(db, userId);
    await seedSession(db, {
      id: "session_already_revoked",
      userId,
      revokedAt: "2026-06-25T10:00:00.000Z",
    });

    const missing = await app.inject({
      method: "POST",
      url: `/admin/dashboard/users/${userId}/sessions/session_missing/revoke`,
      headers: superadminHeaders,
      payload: { reason: "lost device" },
    });
    assert.equal(missing.statusCode, 404, missing.body);
    assert.equal(missing.json().error, "SESSION_NOT_FOUND");
    assert.equal(missing.json().message, "Session not found or already revoked");

    const alreadyRevoked = await app.inject({
      method: "POST",
      url: `/admin/dashboard/users/${userId}/sessions/session_already_revoked/revoke`,
      headers: superadminHeaders,
      payload: { reason: "repeat" },
    });
    assert.equal(alreadyRevoked.statusCode, 404, alreadyRevoked.body);
    assert.equal(alreadyRevoked.json().error, "SESSION_NOT_FOUND");
  });

  test("revokes all active sessions and audits the affected count", async () => {
    const userId = "admin_session_revoke_all_user";
    await seedUser(db, userId);
    await seedSession(db, { id: "session_one", userId });
    await seedSession(db, { id: "session_two", userId });
    await seedSession(db, {
      id: "session_previously_revoked",
      userId,
      revokedAt: "2026-06-25T10:00:00.000Z",
    });

    const response = await app.inject({
      method: "POST",
      url: `/admin/dashboard/users/${userId}/sessions/revoke-all`,
      headers: superadminHeaders,
      payload: { reason: "account compromise" },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { success: true, sessionsRevoked: 2 });

    const rows = await db
      .prepare("SELECT id, revoked_at FROM user_sessions WHERE user_id = ?")
      .all(userId);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row.revoked_at]));
    assert.ok(byId.session_one, "first active session should be revoked");
    assert.ok(byId.session_two, "second active session should be revoked");
    assert.equal(byId.session_previously_revoked, "2026-06-25T10:00:00.000Z");

    const audit = await latestAudit(db, "admin_revoke_all_sessions", userId);
    assert.equal(audit.resource_type, "user");
    assert.equal(audit.metadata.sessionsRevoked, 2);
    assert.equal(audit.metadata.reason, "account compromise");
  });

  test("force voice reverify requires superadmin and preserves status/audit contract", async () => {
    const userId = "admin_voice_reverify_user";
    await seedUser(db, userId);
    await seedVoiceProfile(db, {
      id: "voice_active",
      userId,
      status: "active",
      lastVerifiedAt: "2026-06-26T10:00:00.000Z",
    });

    const created = await adminAuthService.createAdmin(
      "voice-guard-admin@example.com",
      "admin123",
      "Voice Guard Admin",
      "admin",
    );
    assert.equal(created.success, true);
    const adminHeaders = await loginAdmin(app, "voice-guard-admin@example.com");

    const forbidden = await app.inject({
      method: "POST",
      url: `/admin/dashboard/users/${userId}/voice/force-reverify`,
      headers: adminHeaders,
      payload: { reason: "not allowed" },
    });
    assert.equal(forbidden.statusCode, 403, forbidden.body);
    assert.equal(forbidden.json().error, "FORBIDDEN");

    const response = await app.inject({
      method: "POST",
      url: `/admin/dashboard/users/${userId}/voice/force-reverify`,
      headers: superadminHeaders,
      payload: { reason: "consent review" },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {
      success: true,
      voiceProfileId: "voice_active",
    });

    const profile = await db
      .prepare("SELECT status, last_verified_at FROM voice_profiles WHERE id = ?")
      .get("voice_active");
    assert.equal(profile.status, "pending_reverification");
    assert.equal(profile.last_verified_at, null);

    const audit = await latestAudit(db, "admin_force_reverify", "voice_active");
    assert.equal(audit.resource_type, "voice_profile");
    assert.equal(audit.metadata.targetUserId, userId);
    assert.equal(audit.metadata.previousStatus, "active");
    assert.equal(audit.metadata.reason, "consent review");
  });

  test("force voice reverify ignores deleted or non-ready profiles", async () => {
    const userId = "admin_voice_missing_user";
    await seedUser(db, userId);
    await seedVoiceProfile(db, {
      id: "voice_pending",
      userId,
      status: "pending",
    });
    await seedVoiceProfile(db, {
      id: "voice_deleted",
      userId,
      status: "active",
      deletedAt: "2026-06-25T10:00:00.000Z",
    });

    const response = await app.inject({
      method: "POST",
      url: `/admin/dashboard/users/${userId}/voice/force-reverify`,
      headers: superadminHeaders,
      payload: { reason: "consent review" },
    });
    assert.equal(response.statusCode, 404, response.body);
    assert.equal(response.json().error, "VOICE_PROFILE_NOT_FOUND");
    assert.equal(response.json().message, "No active voice profile found");
  });
});
