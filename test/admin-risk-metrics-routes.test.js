require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");

const NOW = new Date();
const HOURS = 60 * 60 * 1000;
const DAYS = 24 * HOURS;

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

async function seedUser(db, { id, riskLevel, lockedUntil = null, deletedAt = null }) {
  await db
    .prepare(
      `INSERT INTO users (
        id, created_at, risk_level, locked_until, deleted_at
      ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, isoAgo(30 * DAYS), riskLevel, lockedUntil, deletedAt);
}

async function seedRiskAudit(db, { id, resourceId, metadataJson, createdAt }) {
  await db
    .prepare(
      `INSERT INTO audit_logs (
        id, user_id, action, resource_type, resource_id, metadata_json, created_at
      ) VALUES (?, 'admin_route_risk', 'admin_update_risk', 'user', ?, ?, ?)`,
    )
    .run(id, resourceId, metadataJson, createdAt);
}

function countMap(rows, key = "level") {
  return Object.fromEntries(rows.map((row) => [row[key], row.count]));
}

describe("admin risk metrics routes", () => {
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

  test("risk metrics require an admin session", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/security/risk-metrics",
    });

    assert.equal(response.statusCode, 401, response.body);
    assert.equal(response.json().error, "UNAUTHORIZED");
  });

  test("risk metrics preserve distribution, lock count, and escalation parsing", async () => {
    const futureLock = isoAgo(-1 * DAYS);
    const deletedAt = isoAgo(1 * DAYS);

    await seedUser(db, { id: "risk_route_low", riskLevel: "low" });
    await seedUser(db, {
      id: "risk_route_medium_locked",
      riskLevel: "medium",
      lockedUntil: futureLock,
    });
    await seedUser(db, { id: "risk_route_high", riskLevel: "high" });
    await seedUser(db, {
      id: "risk_route_deleted_locked",
      riskLevel: "blocked",
      lockedUntil: futureLock,
      deletedAt,
    });

    const newestAuditDate = isoAgo(2 * HOURS);
    const malformedAuditDate = isoAgo(3 * HOURS);
    await seedRiskAudit(db, {
      id: "risk_route_audit_newest",
      resourceId: "risk_route_medium_locked",
      metadataJson: JSON.stringify({ riskLevel: "medium", reason: "manual review" }),
      createdAt: newestAuditDate,
    });
    await seedRiskAudit(db, {
      id: "risk_route_audit_malformed",
      resourceId: "risk_route_high",
      metadataJson: "{not-json",
      createdAt: malformedAuditDate,
    });
    await seedRiskAudit(db, {
      id: "risk_route_audit_old",
      resourceId: "risk_route_low",
      metadataJson: JSON.stringify({ riskLevel: "low", reason: "old" }),
      createdAt: isoAgo(9 * DAYS),
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/security/risk-metrics",
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.deepEqual(countMap(body.distribution), {
      low: 1,
      medium: 1,
      high: 1,
    });
    assert.equal(body.lockedAccounts, 2);
    assert.deepEqual(body.recentEscalations, [
      {
        user_id: "risk_route_medium_locked",
        to: "medium",
        reason: "manual review",
        date: newestAuditDate,
      },
      {
        user_id: "risk_route_high",
        to: "unknown",
        reason: "[metadata parse error]",
        date: malformedAuditDate,
      },
    ]);
  });
});
