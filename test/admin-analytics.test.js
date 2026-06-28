require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { beforeEach, afterEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");
const { AdminService } = require("../src/services/admin-service");
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

describe("AdminService analytics repository boundary", () => {
  test("delegates admin audit writes to EventsRepository", async () => {
    let auditPayload;
    const fakeEventsRepository = {
      async insertAuditLog(payload) {
        auditPayload = payload;
        return { changes: 1 };
      },
    };

    const service = new AdminService(
      { prepare: () => { throw new Error("unexpected db access"); } },
      { eventsRepository: fakeEventsRepository },
    );

    await service._audit("admin_2", "admin_lock_user", "user", "user_2", {
      reason: "risk review",
    });

    assert.ok(auditPayload, "expected delegated audit insert");
    assert.match(auditPayload.id, /^audit_[a-f0-9]{24}$/);
    assert.equal(auditPayload.userId, "admin_2");
    assert.equal(auditPayload.action, "admin_lock_user");
    assert.equal(auditPayload.resourceType, "user");
    assert.equal(auditPayload.resourceId, "user_2");
    assert.match(auditPayload.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(JSON.parse(auditPayload.metadataJson), {
      actor: "admin",
      admin_id: "admin_2",
      reason: "risk review",
    });
  });

  test("delegates admin analytics reads to EventsRepository and keeps service-owned policy", async () => {
    const calls = [];
    const fakeEventsRepository = {
      async getAdminEventCountsAfter(startDate) {
        calls.push(["overview", startDate]);
        return [{ event_name: "auth_completed", count: 2 }];
      },
      async getAdminDailyEventCountsAfter(eventName, startDate) {
        calls.push(["daily", eventName, startDate]);
        return [{ date: "2026-06-25", count: 2 }];
      },
      async countDistinctUsersForEventAfter(eventName, startDate) {
        calls.push(["funnel-start", eventName, startDate]);
        return { c: eventName === "first_song_completed" ? 1 : 2 };
      },
      async countDistinctUsersConvertedAfter(startEvent, endEvent, startDate) {
        calls.push(["funnel-converted", startEvent, endEvent, startDate]);
        return { c: startEvent === "create_started" ? 1 : 2 };
      },
      async getAdminUserEvents(userId, limit) {
        calls.push(["user-events", userId, limit]);
        return [
          {
            id: "evt_admin_boundary",
            event_name: "auth_completed",
            user_id: userId,
            resource_type: "track",
            resource_id: "track_1",
            metadata_json: "{}",
            created_at: "2026-06-25T12:00:00.000Z",
          },
        ];
      },
      async insertUserAnalyticsReadAudit(payload) {
        calls.push(["audit", payload]);
      },
    };

    const service = new AdminService(
      { prepare: () => { throw new Error("unexpected db access"); } },
      { eventsRepository: fakeEventsRepository },
    );

    const overview = await service.getAnalyticsOverview(0);
    assert.equal(overview.days, 1);
    assert.deepEqual(overview.counts, [{ event_name: "auth_completed", count: 2 }]);

    const cachedOverview = await service.getAnalyticsOverview(0);
    assert.deepEqual(cachedOverview, overview);
    assert.equal(calls.filter(([name]) => name === "overview").length, 1);

    const daily = await service.getAnalyticsDaily("auth_completed", 500);
    assert.equal(daily.days, 365);
    assert.equal(daily.event_name, "auth_completed");
    assert.deepEqual(daily.byDay, [{ date: "2026-06-25", count: 2 }]);

    const funnel = await service.getFunnelCohort(7);
    assert.equal(funnel.steps.length, 4);
    assert.deepEqual(funnel.steps[1], {
      from: "create_started",
      to: "create_completed",
      startUsers: 2,
      convertedUsers: 1,
      conversionRate: "50.00",
    });

    const userAnalytics = await service.getUserAnalytics(
      "admin_1",
      "admin@porizo.app",
      "user_1",
      999,
    );
    assert.equal(userAnalytics.limit, 200);
    assert.equal(userAnalytics.events[0].id, "evt_admin_boundary");

    const userEventsCall = calls.find(([name]) => name === "user-events");
    assert.deepEqual(userEventsCall, ["user-events", "user_1", 200]);

    const auditCall = calls.find(([name]) => name === "audit");
    assert.ok(auditCall, "expected analytics read audit call");
    assert.equal(auditCall[1].adminId, "admin_1");
    assert.equal(auditCall[1].targetUserId, "user_1");
    const auditMetadata = JSON.parse(auditCall[1].metadataJson);
    assert.deepEqual(auditMetadata, {
      admin_id: "admin_1",
      admin_email: "admin@porizo.app",
      target_user_id: "user_1",
      event_count: 1,
    });
  });
});
