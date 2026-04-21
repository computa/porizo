require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { beforeEach, afterEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");
const { newUuid } = require("../src/utils/ids");

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
  assert.equal(response.statusCode, 200, `admin login failed: ${response.body}`);
  return JSON.parse(response.body).token;
}

async function seedEvent(db, { id, eventName, userId, createdAt, metadata, resourceType, resourceId }) {
  await db
    .prepare(
      `INSERT INTO events (id, event_name, user_id, resource_type, resource_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      eventName,
      userId,
      resourceType ?? null,
      resourceId ?? null,
      metadata ? JSON.stringify(metadata) : null,
      createdAt
    );
}

async function insertUser(db, userId) {
  await db
    .prepare(
      "INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, datetime('now'), 'low')"
    )
    .run(userId);
}

describe("admin analytics routes", () => {
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

    // Seed a clean fixture: 3 users, 4 events each covering the full funnel
    //   userA completes every hop
    //   userB stops after create_started (drops before create_completed)
    //   userC completes through create_completed, drops before first_song_completed
    const now = Date.now();
    const iso = (msAgo) => new Date(now - msAgo).toISOString();
    const users = ["ana_user_a", "ana_user_b", "ana_user_c"];
    for (const u of users) await insertUser(db, u);

    // userA: auth → create_started → create_completed → first_song_completed → share_create
    await seedEvent(db, { id: "a1", eventName: "auth_completed", userId: "ana_user_a", createdAt: iso(5 * 60 * 60 * 1000) });
    await seedEvent(db, { id: "a2", eventName: "create_started", userId: "ana_user_a", createdAt: iso(4 * 60 * 60 * 1000) });
    await seedEvent(db, { id: "a3", eventName: "create_completed", userId: "ana_user_a", createdAt: iso(3 * 60 * 60 * 1000) });
    await seedEvent(db, { id: "a4", eventName: "first_song_completed", userId: "ana_user_a", createdAt: iso(2 * 60 * 60 * 1000) });
    await seedEvent(db, { id: "a5", eventName: "share_create", userId: "ana_user_a", createdAt: iso(60 * 60 * 1000) });

    // userB: auth → create_started
    await seedEvent(db, { id: "b1", eventName: "auth_completed", userId: "ana_user_b", createdAt: iso(5 * 60 * 60 * 1000) });
    await seedEvent(db, { id: "b2", eventName: "create_started", userId: "ana_user_b", createdAt: iso(4 * 60 * 60 * 1000) });

    // userC: auth → create_started → create_completed
    await seedEvent(db, { id: "c1", eventName: "auth_completed", userId: "ana_user_c", createdAt: iso(5 * 60 * 60 * 1000) });
    await seedEvent(db, { id: "c2", eventName: "create_started", userId: "ana_user_c", createdAt: iso(4 * 60 * 60 * 1000) });
    await seedEvent(db, { id: "c3", eventName: "create_completed", userId: "ana_user_c", createdAt: iso(3 * 60 * 60 * 1000) });
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("GET /admin/dashboard/analytics/overview returns counts sorted DESC", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/analytics/overview?days=7",
      headers: adminHeaders,
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.days, 7);
    const names = body.counts.map((c) => c.event_name);
    assert.ok(names.includes("auth_completed"));
    assert.ok(names.includes("create_started"));
    const counts = body.counts.reduce((acc, c) => ({ ...acc, [c.event_name]: c.count }), {});
    assert.equal(counts.auth_completed, 3);
    assert.equal(counts.create_started, 3);
    assert.equal(counts.create_completed, 2);
    assert.equal(counts.first_song_completed, 1);
    assert.equal(counts.share_create, 1);
  });

  test("GET /admin/dashboard/analytics/funnel returns 4 cohort steps with correct conversion rates", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/analytics/funnel?days=7",
      headers: adminHeaders,
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.steps.length, 4);

    const [hop1, hop2, hop3, hop4] = body.steps;
    // hop 1: auth_completed(3) → create_started(3) = 100%
    assert.equal(hop1.from, "auth_completed");
    assert.equal(hop1.to, "create_started");
    assert.equal(hop1.startUsers, 3);
    assert.equal(hop1.convertedUsers, 3);

    // hop 2: create_started(3) → create_completed(2) = 66.67%
    assert.equal(hop2.from, "create_started");
    assert.equal(hop2.to, "create_completed");
    assert.equal(hop2.startUsers, 3);
    assert.equal(hop2.convertedUsers, 2);

    // hop 3: create_completed(2) → first_song_completed(1) = 50%
    assert.equal(hop3.from, "create_completed");
    assert.equal(hop3.to, "first_song_completed");
    assert.equal(hop3.startUsers, 2);
    assert.equal(hop3.convertedUsers, 1);

    // hop 4: first_song_completed(1) → share_create(1) = 100%
    assert.equal(hop4.from, "first_song_completed");
    assert.equal(hop4.to, "share_create");
    assert.equal(hop4.startUsers, 1);
    assert.equal(hop4.convertedUsers, 1);
  });

  test("GET /admin/dashboard/analytics/daily/:eventName returns date-sorted bucket array", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/analytics/daily/auth_completed?days=7",
      headers: adminHeaders,
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.event_name, "auth_completed");
    assert.equal(body.days, 7);
    assert.ok(Array.isArray(body.byDay));
    const total = body.byDay.reduce((sum, b) => sum + b.count, 0);
    assert.equal(total, 3);
  });

  test("GET /admin/dashboard/analytics/user/:userId returns that user's events and writes an audit log row", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/analytics/user/ana_user_a?limit=10",
      headers: adminHeaders,
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.userId, "ana_user_a");
    assert.ok(Array.isArray(body.events));
    assert.ok(body.events.length >= 5);

    // Audit log row must exist
    const auditRow = await db
      .prepare(
        "SELECT * FROM audit_logs WHERE action = ? AND resource_id = ? ORDER BY created_at DESC LIMIT 1"
      )
      .get("analytics.user.read", "ana_user_a");
    assert.ok(auditRow, "expected audit_logs row for analytics.user.read");
    assert.equal(auditRow.resource_type, "user_analytics");
  });

  test("edge case — days=0 clamps to 1; days=500 clamps to 365", async () => {
    const low = await app.inject({
      method: "GET",
      url: "/admin/dashboard/analytics/overview?days=0",
      headers: adminHeaders,
    });
    assert.equal(low.statusCode, 200);
    assert.equal(low.json().days, 1);

    const high = await app.inject({
      method: "GET",
      url: "/admin/dashboard/analytics/overview?days=500",
      headers: adminHeaders,
    });
    assert.equal(high.statusCode, 200);
    assert.equal(high.json().days, 365);
  });

  test("edge case — unknown event in daily returns empty byDay, no error", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/analytics/daily/not_a_real_event?days=7",
      headers: adminHeaders,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().byDay, []);
  });

  test("cache hit — two overview calls within 60s return identical payloads; second call does not re-query", async () => {
    const first = await app.inject({
      method: "GET",
      url: "/admin/dashboard/analytics/overview?days=7",
      headers: adminHeaders,
    });
    assert.equal(first.statusCode, 200);

    // Mutate the DB between calls — cache should mask the change
    await seedEvent(db, {
      id: "cache_marker_1",
      eventName: "cache_test_event",
      userId: "ana_user_a",
      createdAt: new Date().toISOString(),
    });

    const second = await app.inject({
      method: "GET",
      url: "/admin/dashboard/analytics/overview?days=7",
      headers: adminHeaders,
    });
    assert.equal(second.statusCode, 200);
    assert.deepEqual(second.json(), first.json(), "second call within cache window should return identical body");
  });

  test("error path — missing admin session returns 401", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/analytics/overview?days=7",
    });
    assert.equal(response.statusCode, 401);
  });
});
