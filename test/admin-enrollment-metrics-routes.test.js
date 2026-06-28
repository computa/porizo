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

function isoDate(isoString) {
  return isoString.slice(0, 10);
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

async function seedUser(db, id) {
  await db
    .prepare("INSERT INTO users (id, created_at, risk_level) VALUES (?, ?, 'low')")
    .run(id, isoAgo(30 * DAYS));
}

async function seedEnrollmentSession(db, { id, userId, status, startedAt }) {
  await db
    .prepare(
      `INSERT INTO enrollment_sessions (
        id, user_id, status, started_at, expires_at
      ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, userId, status, startedAt, isoAgo(-1 * DAYS));
}

async function seedVoiceProfile(db, { id, userId, score }) {
  await db
    .prepare(
      `INSERT INTO voice_profiles (
        id, user_id, status, quality_score, created_at
      ) VALUES (?, ?, 'active', ?, ?)`,
    )
    .run(id, userId, score, isoAgo(1 * DAYS));
}

function countMap(rows, key = "bucket") {
  return Object.fromEntries(rows.map((row) => [row[key], row.count]));
}

describe("admin enrollment metrics routes", () => {
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

  test("enrollment metrics require an admin session", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/metrics/enrollment",
    });

    assert.equal(response.statusCode, 401, response.body);
    assert.equal(response.json().error, "UNAUTHORIZED");
  });

  test("enrollment metrics preserve totals, quality buckets, abandonment, and trend aggregates", async () => {
    const users = ["enroll_route_a", "enroll_route_b", "enroll_route_c", "enroll_route_d", "enroll_route_e"];
    for (const userId of users) {
      await seedUser(db, userId);
    }

    const today = isoAgo(3 * HOURS);
    const twoDaysAgo = isoAgo(2 * DAYS);
    const threeDaysAgo = isoAgo(3 * DAYS);
    const sixDaysAgo = isoAgo(6 * DAYS);
    const nineDaysAgo = isoAgo(9 * DAYS);

    await seedEnrollmentSession(db, {
      id: "enroll_route_completed_today",
      userId: "enroll_route_a",
      status: "completed",
      startedAt: today,
    });
    await seedEnrollmentSession(db, {
      id: "enroll_route_completed_two_days",
      userId: "enroll_route_b",
      status: "completed",
      startedAt: twoDaysAgo,
    });
    await seedEnrollmentSession(db, {
      id: "enroll_route_recording",
      userId: "enroll_route_c",
      status: "recording",
      startedAt: threeDaysAgo,
    });
    await seedEnrollmentSession(db, {
      id: "enroll_route_processing",
      userId: "enroll_route_d",
      status: "processing",
      startedAt: sixDaysAgo,
    });
    await seedEnrollmentSession(db, {
      id: "enroll_route_failed_old",
      userId: "enroll_route_e",
      status: "failed",
      startedAt: nineDaysAgo,
    });

    await seedVoiceProfile(db, {
      id: "enroll_route_quality_poor",
      userId: "enroll_route_a",
      score: 45,
    });
    await seedVoiceProfile(db, {
      id: "enroll_route_quality_fair",
      userId: "enroll_route_b",
      score: 65,
    });
    await seedVoiceProfile(db, {
      id: "enroll_route_quality_good",
      userId: "enroll_route_c",
      score: 80,
    });
    await seedVoiceProfile(db, {
      id: "enroll_route_quality_excellent",
      userId: "enroll_route_d",
      score: 91,
    });
    await seedVoiceProfile(db, {
      id: "enroll_route_quality_ignored",
      userId: "enroll_route_e",
      score: null,
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/metrics/enrollment",
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.totalEnrollments, 5);
    assert.equal(body.completedEnrollments, 2);
    assert.equal(body.completionRate, 40);
    assert.equal(body.averageQualityScore, 70.3);
    assert.deepEqual(countMap(body.qualityDistribution), {
      "Poor (<50)": 1,
      "Fair (50-69)": 1,
      "Good (70-84)": 1,
      "Excellent (85+)": 1,
    });
    assert.deepEqual(countMap(body.abandonmentByStep, "step"), {
      failed: 1,
      processing: 1,
      recording: 1,
    });
    assert.deepEqual(
      Object.fromEntries(
        body.last7Days.map((row) => [
          row.date,
          { started: row.started, completed: row.completed },
        ]),
      ),
      {
        [isoDate(sixDaysAgo)]: { started: 1, completed: 0 },
        [isoDate(threeDaysAgo)]: { started: 1, completed: 0 },
        [isoDate(twoDaysAgo)]: { started: 1, completed: 1 },
        [isoDate(today)]: { started: 1, completed: 1 },
      },
    );
  });
});
