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

async function seedUser(db, id) {
  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, created_at, risk_level)
       VALUES (?, ?, ?, ?, 'low')`,
    )
    .run(id, `${id}@example.com`, id, NOW);
}

async function seedEntitlement(db, userId, tier, updatedAt = NOW) {
  await db
    .prepare(
      `INSERT INTO entitlements (
        user_id, tier, updated_at
      ) VALUES (?, ?, ?)`,
    )
    .run(userId, tier, updatedAt);
}

async function latestEntitlementAudit(db, userId) {
  const row = await db
    .prepare(
      `SELECT user_id, action, resource_type, resource_id, metadata_json
       FROM audit_logs
       WHERE action = 'admin_update_entitlements' AND resource_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(userId);
  assert.ok(row, "expected admin_update_entitlements audit row");
  return { ...row, metadata: JSON.parse(row.metadata_json) };
}

describe("admin entitlement update route", () => {
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

  test("requires an admin session and superadmin role", async () => {
    const userId = "entitlement_route_guard_user";
    await seedUser(db, userId);

    const unauthenticated = await app.inject({
      method: "PUT",
      url: `/admin/dashboard/users/${userId}/entitlements`,
      payload: { tier: "plus" },
    });
    assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);
    assert.equal(unauthenticated.json().error, "UNAUTHORIZED");

    const created = await adminAuthService.createAdmin(
      "entitlement-admin@example.com",
      "admin123",
      "Entitlement Admin",
      "admin",
    );
    assert.equal(created.success, true);
    const adminHeaders = await loginAdmin(app, "entitlement-admin@example.com");

    const forbidden = await app.inject({
      method: "PUT",
      url: `/admin/dashboard/users/${userId}/entitlements`,
      headers: adminHeaders,
      payload: { tier: "plus" },
    });
    assert.equal(forbidden.statusCode, 403, forbidden.body);
    assert.equal(forbidden.json().error, "FORBIDDEN");
  });

  test("rejects invalid tiers and empty entitlement updates", async () => {
    const userId = "entitlement_invalid_user";
    await seedUser(db, userId);

    const invalid = await app.inject({
      method: "PUT",
      url: `/admin/dashboard/users/${userId}/entitlements`,
      headers: superadminHeaders,
      payload: { tier: "premium" },
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.equal(invalid.json().error, "INVALID_PARAMS");
    assert.match(invalid.json().message, /tier must be one of/);

    const empty = await app.inject({
      method: "PUT",
      url: `/admin/dashboard/users/${userId}/entitlements`,
      headers: superadminHeaders,
      payload: {},
    });
    assert.equal(empty.statusCode, 400, empty.body);
    assert.equal(empty.json().error, "INVALID_PARAMS");
    assert.equal(empty.json().message, "No valid fields provided");
  });

  test("updates an existing entitlement tier and writes old/new audit metadata", async () => {
    const userId = "entitlement_existing_user";
    const oldUpdatedAt = "2026-06-01T00:00:00.000Z";
    await seedUser(db, userId);
    await seedEntitlement(db, userId, "free", oldUpdatedAt);

    const response = await app.inject({
      method: "PUT",
      url: `/admin/dashboard/users/${userId}/entitlements`,
      headers: superadminHeaders,
      payload: { tier: "plus" },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { success: true });

    const entitlement = await db
      .prepare(
        `SELECT tier, updated_at
         FROM entitlements
         WHERE user_id = ?`,
      )
      .get(userId);
    assert.equal(entitlement.tier, "plus");
    assert.equal(entitlement.updated_at, oldUpdatedAt);

    const audit = await latestEntitlementAudit(db, userId);
    assert.equal(audit.user_id, audit.metadata.admin_id);
    assert.equal(audit.resource_type, "user");
    assert.equal(audit.resource_id, userId);
    assert.deepEqual(audit.metadata.previous, { tier: "free" });
    assert.deepEqual(audit.metadata.updated, { tier: "plus" });
  });

  test("inserts a missing entitlement row and audits default free previous tier", async () => {
    const userId = "entitlement_missing_user";
    await seedUser(db, userId);

    const response = await app.inject({
      method: "PUT",
      url: `/admin/dashboard/users/${userId}/entitlements`,
      headers: superadminHeaders,
      payload: { tier: "pro" },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { success: true });

    const entitlement = await db
      .prepare(
        `SELECT tier
         FROM entitlements
         WHERE user_id = ?`,
      )
      .get(userId);
    assert.equal(entitlement.tier, "pro");

    const audit = await latestEntitlementAudit(db, userId);
    assert.deepEqual(audit.metadata.previous, { tier: "free" });
    assert.deepEqual(audit.metadata.updated, { tier: "pro" });
  });
});
