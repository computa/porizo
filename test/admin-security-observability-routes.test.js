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

async function loginAdminEmail(app, email) {
  const response = await app.inject({
    method: "POST",
    url: "/admin/auth/login",
    payload: { email, password: "admin123" },
  });
  assert.equal(response.statusCode, 200, response.body);
  return { Authorization: `Bearer ${response.json().token}` };
}

async function seedUser(db, id, email = `${id}@example.com`) {
  await db
    .prepare(
      `INSERT INTO users (id, email, created_at, risk_level)
       VALUES (?, ?, ?, 'low')`,
    )
    .run(id, email, new Date().toISOString());
}

function isoMinutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("admin security observability routes", () => {
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

  test("security routes require admin session and keep reset superadmin-only", async () => {
    const unauthenticated = await app.inject({
      method: "GET",
      url: "/admin/dashboard/security/auth-events",
    });
    assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);
    assert.equal(unauthenticated.json().error, "UNAUTHORIZED");

    const created = await adminAuthService.createAdmin(
      "security-reader@example.com",
      "admin123",
      "Security Reader",
      "admin",
    );
    assert.equal(created.success, true);
    const adminHeaders = await loginAdminEmail(app, "security-reader@example.com");

    const read = await app.inject({
      method: "GET",
      url: "/admin/dashboard/security/auth-events",
      headers: adminHeaders,
    });
    assert.equal(read.statusCode, 200, read.body);
    assert.deepEqual(read.json(), { events: [] });

    const reset = await app.inject({
      method: "POST",
      url: "/admin/dashboard/security/rate-limits/some_user/share_create/reset",
      headers: adminHeaders,
      payload: { reason: "admin should not reset" },
    });
    assert.equal(reset.statusCode, 403, reset.body);
    assert.equal(reset.json().error, "FORBIDDEN");
  });

  test("security health returns operational counters", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/security/health",
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.deepEqual(body.jobs, { running: 0, queued: 0, failed: 0 });
    assert.equal(body.dlqCount, 0);
    assert.deepEqual(body.recentErrors, []);
    assert.match(body.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  test("auth events preserve filters, user-email join, ordering, and stats", async () => {
    const userId = "security_auth_user";
    await seedUser(db, userId, "auth-user@example.com");
    await seedUser(db, "security_auth_other", "auth-other@example.com");

    await db
      .prepare(
        `INSERT INTO auth_events (
          id, user_id, event_type, ip_address, user_agent, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "auth_evt_old",
        userId,
        "login_failed",
        "203.0.113.1",
        "old-ua",
        "{}",
        isoDaysAgo(2),
      );
    await db
      .prepare(
        `INSERT INTO auth_events (
          id, user_id, event_type, ip_address, user_agent, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "auth_evt_failed",
        userId,
        "login_failed",
        "203.0.113.2",
        "failed-ua",
        '{"reason":"bad_password"}',
        isoMinutesAgo(10),
      );
    await db
      .prepare(
        `INSERT INTO auth_events (
          id, user_id, event_type, ip_address, user_agent, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "auth_evt_success",
        userId,
        "login_success",
        "203.0.113.3",
        "success-ua",
        "{}",
        isoMinutesAgo(5),
      );
    await db
      .prepare(
        `INSERT INTO auth_events (
          id, user_id, event_type, ip_address, user_agent, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "auth_evt_other_user",
        "security_auth_other",
        "login_failed",
        "203.0.113.4",
        "other-ua",
        "{}",
        isoMinutesAgo(1),
      );

    const list = await app.inject({
      method: "GET",
      url:
        "/admin/dashboard/security/auth-events" +
        `?eventType=login_failed&userId=${userId}` +
        `&startDate=${encodeURIComponent(isoDaysAgo(1))}` +
        `&endDate=${encodeURIComponent(isoMinutesAgo(0))}`,
      headers: adminHeaders,
    });
    assert.equal(list.statusCode, 200, list.body);
    const events = list.json().events;
    assert.equal(events.length, 1);
    assert.equal(events[0].id, "auth_evt_failed");
    assert.equal(events[0].user_email, "auth-user@example.com");

    const stats = await app.inject({
      method: "GET",
      url: "/admin/dashboard/security/auth-events/stats",
      headers: adminHeaders,
    });
    assert.equal(stats.statusCode, 200, stats.body);
    const statsBody = stats.json();
    assert.equal(statsBody.loginSuccess, 1);
    assert.equal(statsBody.loginFailed, 2);
    assert.ok(
      statsBody.byType.some(
        (row) => row.event_type === "login_failed" && Number(row.count) === 2,
      ),
    );
  });

  test("audit routes preserve escaped action search and Apple refresh stats", async () => {
    await db
      .prepare(
        `INSERT INTO audit_logs (
          id, user_id, action, resource_type, resource_id, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "audit_literal",
        "adm_initial",
        "admin_%literal",
        "user",
        "audit_target",
        '{"ok":true}',
        isoMinutesAgo(20),
      );
    await db
      .prepare(
        `INSERT INTO audit_logs (
          id, user_id, action, resource_type, resource_id, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "audit_wildcard_decoy",
        "adm_initial",
        "admin_Xliteral",
        "user",
        "audit_target",
        "{}",
        isoMinutesAgo(10),
      );
    await db
      .prepare(
        `INSERT INTO audit_logs (
          id, user_id, action, resource_type, resource_id, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "apple_valid",
        "adm_initial",
        "apple_refresh_token_validated",
        "auth",
        "apple",
        "{}",
        isoMinutesAgo(9),
      );
    await db
      .prepare(
        `INSERT INTO audit_logs (
          id, user_id, action, resource_type, resource_id, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "apple_invalid",
        "adm_initial",
        "apple_refresh_token_invalid",
        "auth",
        "apple",
        "{}",
        isoMinutesAgo(8),
      );
    await db
      .prepare(
        `INSERT INTO audit_logs (
          id, user_id, action, resource_type, resource_id, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "apple_old",
        "adm_initial",
        "apple_refresh_token_invalid",
        "auth",
        "apple",
        "{}",
        isoDaysAgo(8),
      );

    const audit = await app.inject({
      method: "GET",
      url:
        "/admin/dashboard/security/audit-logs" +
        `?action=${encodeURIComponent("admin_%")}&resourceType=user`,
      headers: adminHeaders,
    });
    assert.equal(audit.statusCode, 200, audit.body);
    const logs = audit.json().logs;
    assert.equal(logs.length, 1);
    assert.equal(logs[0].id, "audit_literal");
    assert.equal(logs[0].admin_email, "admin@porizo.app");

    const apple = await app.inject({
      method: "GET",
      url: "/admin/dashboard/security/apple-refresh?days=7",
      headers: adminHeaders,
    });
    assert.equal(apple.statusCode, 200, apple.body);
    const appleStats = apple.json();
    assert.equal(appleStats.validated, 1);
    assert.equal(appleStats.invalid, 1);
    assert.equal(appleStats.lastValidated, await currentCreatedAt("apple_valid"));
    assert.equal(appleStats.lastInvalid, await currentCreatedAt("apple_invalid"));
  });

  test("rate-limit list and reset preserve filters, near-limit math, and audit", async () => {
    const userId = "security_rate_user";
    const nowMs = Date.now();
    await seedUser(db, userId, "rate-user@example.com");
    await db
      .prepare(
        `INSERT INTO rate_limits (
          user_id, action_type, window_start_ms, window_seconds, count, limit_count
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, "share_create", nowMs - 1000, 60, 8, 10);
    await db
      .prepare(
        `INSERT INTO rate_limits (
          user_id, action_type, window_start_ms, window_seconds, count, limit_count
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, "story_start", nowMs - 1000, 60, 2, 10);
    await db
      .prepare(
        `INSERT INTO rate_limits (
          user_id, action_type, window_start_ms, window_seconds, count, limit_count
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, "old_action", nowMs - 2 * 24 * 60 * 60 * 1000, 60, 10, 10);

    const list = await app.inject({
      method: "GET",
      url:
        "/admin/dashboard/security/rate-limits" +
        `?userId=${userId}&nearLimit=true`,
      headers: adminHeaders,
    });
    assert.equal(list.statusCode, 200, list.body);
    const limits = list.json().limits;
    assert.equal(limits.length, 1);
    assert.equal(limits[0].action_type, "share_create");
    assert.equal(limits[0].user_email, "rate-user@example.com");

    const reset = await app.inject({
      method: "POST",
      url:
        `/admin/dashboard/security/rate-limits/${userId}` +
        "/share_create/reset",
      headers: adminHeaders,
      payload: { reason: "clear failed share burst" },
    });
    assert.equal(reset.statusCode, 200, reset.body);
    assert.deepEqual(reset.json(), { success: true });

    const remaining = await db
      .prepare(
        "SELECT action_type FROM rate_limits WHERE user_id = ? ORDER BY action_type",
      )
      .all(userId);
    assert.deepEqual(
      remaining.map((row) => row.action_type),
      ["old_action", "story_start"],
    );

    const audit = await db
      .prepare(
        `SELECT user_id, resource_type, resource_id, metadata_json
         FROM audit_logs
         WHERE action = 'admin_reset_rate_limit'
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get();
    assert.equal(audit.user_id, "adm_initial");
    assert.equal(audit.resource_type, "user");
    assert.equal(audit.resource_id, userId);
    assert.deepEqual(JSON.parse(audit.metadata_json), {
      actor: "admin",
      admin_id: "adm_initial",
      actionType: "share_create",
      reason: "clear failed share burst",
    });
  });

  test("consent logs preserve version/date filters, user-email join, and ordering", async () => {
    const userId = "security_consent_user";
    await seedUser(db, userId, "consent-user@example.com");
    await seedUser(db, "security_consent_other", "other-consent@example.com");
    await db
      .prepare(
        `INSERT INTO voice_profiles (
          id, user_id, status, consent_version, consent_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "voice_consent_old",
        userId,
        "active",
        "v1",
        isoDaysAgo(2),
        isoDaysAgo(2),
      );
    await db
      .prepare(
        `INSERT INTO voice_profiles (
          id, user_id, status, consent_version, consent_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "voice_consent_match",
        userId,
        "active",
        "v2",
        isoMinutesAgo(10),
        isoMinutesAgo(10),
      );
    await db
      .prepare(
        `INSERT INTO voice_profiles (
          id, user_id, status, consent_version, consent_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "voice_consent_null",
        "security_consent_other",
        "active",
        "v2",
        null,
        isoMinutesAgo(5),
      );

    const response = await app.inject({
      method: "GET",
      url:
        "/admin/dashboard/security/consent-logs" +
        "?consentVersion=v2" +
        `&startDate=${encodeURIComponent(isoDaysAgo(1))}` +
        `&endDate=${encodeURIComponent(isoMinutesAgo(0))}`,
      headers: adminHeaders,
    });
    assert.equal(response.statusCode, 200, response.body);
    const consents = response.json().consents;
    assert.equal(consents.length, 1);
    assert.equal(consents[0].id, "voice_consent_match");
    assert.equal(consents[0].user_email, "consent-user@example.com");
  });

  async function currentCreatedAt(id) {
    const row = await db
      .prepare("SELECT created_at FROM audit_logs WHERE id = ?")
      .get(id);
    return row.created_at;
  }
});
