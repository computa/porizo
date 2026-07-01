require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");

const NOW = new Date();
const HOURS = 60 * 60 * 1000;

function isoAgo(ms) {
  return new Date(NOW.getTime() - ms).toISOString();
}

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

async function loginAdmin(app) {
  const response = await app.inject({
    method: "POST",
    url: "/admin/auth/login",
    payload: { email: "admin@porizo.app", password: "admin123" },
  });
  assert.equal(response.statusCode, 200, response.body);
  return { Authorization: `Bearer ${response.json().token}` };
}

async function seedAudit(db, fields) {
  await db
    .prepare(
      `INSERT INTO audit_logs (
        id, user_id, action, resource_type, resource_id, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fields.id,
      fields.userId ?? "admin_webhook_route",
      fields.action,
      fields.resourceType ?? "webhook",
      fields.resourceId ?? fields.id,
      fields.metadataJson ?? "{}",
      fields.createdAt,
    );
}

describe("admin webhook health route", () => {
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
    adminHeaders = await loginAdmin(app);
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("requires an admin session", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/webhooks/health",
    });
    assert.equal(response.statusCode, 401, response.body);
    assert.equal(response.json().error, "UNAUTHORIZED");
  });

  test("returns last webhook, type counts, failed count, and pending retry placeholder", async () => {
    const latestWebhookAt = isoAgo(1 * HOURS);
    await seedAudit(db, {
      id: "webhook_route_apple_1",
      action: "webhook_apple_processed",
      createdAt: isoAgo(3 * HOURS),
    });
    await seedAudit(db, {
      id: "webhook_route_apple_2",
      action: "webhook_apple_processed",
      createdAt: isoAgo(2 * HOURS),
    });
    await seedAudit(db, {
      id: "webhook_route_google_error",
      action: "webhook_google_failed",
      metadataJson: JSON.stringify({ error: "bad signature" }),
      createdAt: latestWebhookAt,
    });
    await seedAudit(db, {
      id: "webhook_route_non_webhook_error",
      action: "admin_update_risk",
      metadataJson: JSON.stringify({ error: "ignored" }),
      createdAt: isoAgo(30 * 60 * 1000),
    });
    await seedAudit(db, {
      id: "webhook_route_old",
      action: "webhook_apple_processed",
      metadataJson: JSON.stringify({ error: "old ignored" }),
      createdAt: isoAgo(30 * HOURS),
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/webhooks/health",
      headers: adminHeaders,
    });
    assert.equal(response.statusCode, 200, response.body);

    const body = response.json();
    assert.equal(body.lastWebhookReceived, latestWebhookAt);
    assert.equal(body.failedWebhooks, 1);
    assert.equal(body.pendingRetries, 0);
    assert.deepEqual(
      Object.fromEntries(
        body.webhooksByType.map((row) => [row.webhook_type, row.count]),
      ),
      {
        webhook_apple_processed: 2,
        webhook_google_failed: 1,
      },
    );
  });
});
