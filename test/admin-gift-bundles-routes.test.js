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

async function seedGiftBundles(db) {
  await db.prepare("DELETE FROM gift_bundles").run();
  await db
    .prepare(
      `INSERT INTO gift_bundles (
        id, product_id, token_count, price_cents, display_name, description,
        sort_order, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "gb_route_second",
      "com.porizo.route_gift_second",
      3,
      1299,
      "Second Gift",
      "Second route bundle",
      20,
      1,
      NOW,
      NOW,
      "gb_route_first",
      "com.porizo.route_gift_first",
      1,
      499,
      "First Gift",
      "First route bundle",
      10,
      1,
      NOW,
      NOW,
    );
}

describe("admin gift bundle routes", () => {
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
    await seedGiftBundles(db);
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("lists gift bundles ordered by sort order", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/billing/gift-bundles",
      headers: superadminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(
      response.json().bundles.map((bundle) => bundle.id),
      ["gb_route_first", "gb_route_second"],
    );
  });

  test("requires superadmin role for gift bundle updates", async () => {
    const created = await adminAuthService.createAdmin(
      "gift-bundle-admin@example.com",
      "admin123",
      "Gift Bundle Admin",
      "admin",
    );
    assert.equal(created.success, true);
    const adminHeaders = await loginAdmin(app, "gift-bundle-admin@example.com");

    const response = await app.inject({
      method: "PUT",
      url: "/admin/billing/gift-bundles/gb_route_first",
      headers: adminHeaders,
      payload: { display_name: "Blocked" },
    });

    assert.equal(response.statusCode, 403, response.body);
    assert.equal(response.json().error, "FORBIDDEN");
  });

  test("updates a gift bundle and writes the existing audit payload", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/admin/billing/gift-bundles/gb_route_first",
      headers: superadminHeaders,
      payload: {
        token_count: "2",
        display_name: "First Gift Updated",
        sort_order: "30",
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().success, true);
    assert.equal(response.json().bundle.token_count, 2);
    assert.equal(response.json().bundle.display_name, "First Gift Updated");
    assert.equal(response.json().bundle.sort_order, 30);
    assert.ok(response.json().bundle.updated_by);

    const audit = await db
      .prepare(
        `SELECT action, resource_type, resource_id, metadata_json
           FROM audit_logs
          WHERE action = 'admin_update_gift_bundle'
          ORDER BY created_at DESC
          LIMIT 1`,
      )
      .get();
    assert.equal(audit.resource_type, "gift_bundle");
    assert.equal(audit.resource_id, "gb_route_first");
    const metadata = JSON.parse(audit.metadata_json);
    assert.equal(metadata.previous.display_name, "First Gift");
    assert.equal(metadata.updated.display_name, "First Gift Updated");
  });

  test("preserves validation and missing bundle error envelopes", async () => {
    const invalid = await app.inject({
      method: "PUT",
      url: "/admin/billing/gift-bundles/gb_route_first",
      headers: superadminHeaders,
      payload: { token_count: 0 },
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.equal(invalid.json().error, "INVALID_TOKEN_COUNT");

    const missing = await app.inject({
      method: "PUT",
      url: "/admin/billing/gift-bundles/missing_bundle",
      headers: superadminHeaders,
      payload: { display_name: "Missing" },
    });
    assert.equal(missing.statusCode, 404, missing.body);
    assert.equal(missing.json().error, "BUNDLE_NOT_FOUND");
  });
});
