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
        id, email, display_name, phone_number, created_at, risk_level,
        acquisition_source, acquisition_medium, acquisition_campaign,
        acquisition_content, acquisition_term, acquisition_country,
        acquisition_referrer, acquisition_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      fields.email ?? `${id}@example.com`,
      fields.displayName ?? id,
      fields.phoneNumber ?? null,
      fields.createdAt ?? NOW,
      fields.riskLevel ?? "low",
      fields.acquisition_source ?? null,
      fields.acquisition_medium ?? null,
      fields.acquisition_campaign ?? null,
      fields.acquisition_content ?? null,
      fields.acquisition_term ?? null,
      fields.acquisition_country ?? null,
      fields.acquisition_referrer ?? null,
      fields.acquisition_at ?? null,
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

describe("admin user mutation routes", () => {
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

  test("risk update is admin-readable, validates level, and writes audit metadata", async () => {
    const userId = "admin_mutation_risk_user";
    await seedUser(db, userId);

    const created = await adminAuthService.createAdmin(
      "risk-admin@example.com",
      "admin123",
      "Risk Admin",
      "admin",
    );
    assert.equal(created.success, true);
    const adminHeaders = await loginAdmin(app, "risk-admin@example.com");

    const invalid = await app.inject({
      method: "PUT",
      url: `/admin/dashboard/users/${userId}/risk`,
      headers: adminHeaders,
      payload: { riskLevel: "critical" },
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.equal(invalid.json().error, "INVALID_PARAMS");

    const response = await app.inject({
      method: "PUT",
      url: `/admin/dashboard/users/${userId}/risk`,
      headers: adminHeaders,
      payload: { riskLevel: "high", reason: "chargeback pattern" },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { success: true });

    const user = await db
      .prepare("SELECT risk_level FROM users WHERE id = ?")
      .get(userId);
    assert.equal(user.risk_level, "high");

    const audit = await latestAudit(db, "admin_update_risk", userId);
    assert.equal(audit.user_id, created.id);
    assert.equal(audit.resource_type, "user");
    assert.deepEqual(audit.metadata, {
      actor: "admin",
      admin_id: created.id,
      riskLevel: "high",
      reason: "chargeback pattern",
    });
  });

  test("lock route is superadmin-only and preserves lock/unlock audit behavior", async () => {
    const userId = "admin_mutation_lock_user";
    await seedUser(db, userId);
    const created = await adminAuthService.createAdmin(
      "lock-admin@example.com",
      "admin123",
      "Lock Admin",
      "admin",
    );
    assert.equal(created.success, true);
    const adminHeaders = await loginAdmin(app, "lock-admin@example.com");

    const forbidden = await app.inject({
      method: "POST",
      url: `/admin/dashboard/users/${userId}/lock`,
      headers: adminHeaders,
      payload: { locked: true, reason: "not allowed" },
    });
    assert.equal(forbidden.statusCode, 403, forbidden.body);

    const locked = await app.inject({
      method: "POST",
      url: `/admin/dashboard/users/${userId}/lock`,
      headers: superadminHeaders,
      payload: { locked: true, reason: "manual review" },
    });
    assert.equal(locked.statusCode, 200, locked.body);
    assert.equal(locked.json().success, true);
    assert.ok(Date.parse(locked.json().lockedUntil) > Date.now());

    let user = await db
      .prepare("SELECT locked_until FROM users WHERE id = ?")
      .get(userId);
    assert.equal(user.locked_until, locked.json().lockedUntil);

    const lockAudit = await latestAudit(db, "admin_lock_user", userId);
    assert.equal(lockAudit.metadata.reason, "manual review");

    const unlocked = await app.inject({
      method: "POST",
      url: `/admin/dashboard/users/${userId}/lock`,
      headers: superadminHeaders,
      payload: { locked: false, reason: "cleared" },
    });
    assert.equal(unlocked.statusCode, 200, unlocked.body);
    assert.deepEqual(unlocked.json(), { success: true, lockedUntil: null });

    user = await db.prepare("SELECT locked_until FROM users WHERE id = ?").get(userId);
    assert.equal(user.locked_until, null);

    const unlockAudit = await latestAudit(db, "admin_unlock_user", userId);
    assert.equal(unlockAudit.metadata.reason, "cleared");
  });

  test("bulk action validates payload and preserves lock audit behavior", async () => {
    await seedUser(db, "admin_mutation_bulk_one");
    await seedUser(db, "admin_mutation_bulk_two");

    const invalid = await app.inject({
      method: "POST",
      url: "/admin/dashboard/users/bulk-action",
      headers: superadminHeaders,
      payload: { action: "lock", userIds: [] },
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.equal(invalid.json().error, "INVALID_PARAMS");

    const response = await app.inject({
      method: "POST",
      url: "/admin/dashboard/users/bulk-action",
      headers: superadminHeaders,
      payload: {
        action: "lock",
        userIds: ["admin_mutation_bulk_one", "admin_mutation_bulk_two"],
        reason: "bulk risk review",
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {
      succeeded: ["admin_mutation_bulk_one", "admin_mutation_bulk_two"],
      failed: [],
    });

    const users = await db
      .prepare(
        `SELECT id, locked_until FROM users
         WHERE id IN ('admin_mutation_bulk_one', 'admin_mutation_bulk_two')
         ORDER BY id`,
      )
      .all();
    assert.equal(users.length, 2);
    assert.ok(users.every((user) => Date.parse(user.locked_until) > Date.now()));

    const audit = await latestAudit(db, "admin_bulk_lock", "bulk");
    assert.equal(audit.resource_type, "user");
    assert.deepEqual(audit.metadata, {
      actor: "admin",
      admin_id: "adm_initial",
      action: "lock",
      requestedCount: 2,
      succeededCount: 2,
      failedCount: 0,
      reason: "bulk risk review",
    });
  });

  test("profile update ignores unknown fields, updates allowed fields, and audits attribution contract", async () => {
    const userId = "admin_mutation_profile_user";
    await seedUser(db, userId, {
      email: "old-profile@example.com",
      displayName: "Old Profile",
      acquisition_source: "old-source",
      acquisition_medium: "old-medium",
      acquisition_campaign: "old-campaign",
      acquisition_content: "old-content",
      acquisition_term: "old-term",
      acquisition_country: "AU",
      acquisition_referrer: "https://old.example",
      acquisition_at: "2026-06-01T00:00:00.000Z",
    });

    const empty = await app.inject({
      method: "PUT",
      url: `/admin/dashboard/users/${userId}/profile`,
      headers: superadminHeaders,
      payload: { ignored_field: "ignored" },
    });
    assert.equal(empty.statusCode, 400, empty.body);
    assert.equal(empty.json().error, "INVALID_PARAMS");
    assert.equal(empty.json().message, "No valid fields provided");

    const response = await app.inject({
      method: "PUT",
      url: `/admin/dashboard/users/${userId}/profile`,
      headers: superadminHeaders,
      payload: {
        display_name: "New Profile",
        email: "new-profile@example.com",
        phone_number: "+15555550123",
        acquisition_source: "Founder outreach",
        acquisition_medium: "email",
        acquisition_campaign: "friends_test",
        ignored_field: "ignored",
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {
      success: true,
      updated: {
        display_name: "New Profile",
        email: "new-profile@example.com",
        phone_number: "+15555550123",
        acquisition_source: "Founder outreach",
        acquisition_medium: "email",
        acquisition_campaign: "friends_test",
      },
    });

    const user = await db
      .prepare(
        `SELECT display_name, email, phone_number, acquisition_source,
                acquisition_medium, acquisition_campaign, acquisition_country
         FROM users
         WHERE id = ?`,
      )
      .get(userId);
    assert.equal(user.display_name, "New Profile");
    assert.equal(user.email, "new-profile@example.com");
    assert.equal(user.phone_number, "+15555550123");
    assert.equal(user.acquisition_source, "Founder outreach");
    assert.equal(user.acquisition_medium, "email");
    assert.equal(user.acquisition_campaign, "friends_test");
    assert.equal(user.acquisition_country, "AU");

    const profileAudit = await latestAudit(db, "admin_update_user_profile", userId);
    assert.deepEqual(profileAudit.metadata.changedFields, response.json().updated);

    const attributionAudit = await latestAudit(
      db,
      "admin_update_user_attribution",
      userId,
    );
    assert.equal(attributionAudit.metadata.contract, "attribution-source-precedence-v1");
    assert.equal(attributionAudit.metadata.previous.acquisition_source, "old-source");
    assert.equal(attributionAudit.metadata.next.acquisition_source, "Founder outreach");
    assert.deepEqual(attributionAudit.metadata.changedFields, {
      acquisition_source: "Founder outreach",
      acquisition_medium: "email",
      acquisition_campaign: "friends_test",
    });
  });

  test("delete user preserves missing-user envelope, deletion snapshot, and audit-before-delete", async () => {
    const userId = "admin_mutation_delete_user";
    await seedUser(db, userId, {
      email: "delete-me@example.com",
      displayName: "Delete Me",
    });

    const missing = await app.inject({
      method: "DELETE",
      url: "/admin/dashboard/users/missing-delete-user",
      headers: superadminHeaders,
      payload: { reason: "not found" },
    });
    assert.equal(missing.statusCode, 404, missing.body);
    assert.equal(missing.json().error, "USER_NOT_FOUND");

    const response = await app.inject({
      method: "DELETE",
      url: `/admin/dashboard/users/${userId}`,
      headers: superadminHeaders,
      payload: { reason: "user requested admin purge" },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {
      success: true,
      deleted: {
        id: userId,
        email: "delete-me@example.com",
        displayName: "Delete Me",
      },
    });

    const user = await db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
    assert.equal(user, undefined);

    const audit = await latestAudit(db, "admin_delete_user", userId);
    assert.equal(audit.metadata.reason, "user requested admin purge");
    assert.equal(audit.metadata.deleted_email, "delete-me@example.com");
    assert.equal(audit.metadata.deleted_display_name, "Delete Me");
  });
});
