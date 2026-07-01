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
let trackVersionCounter = 0;

function dateFromNow(deltaMs) {
  return new Date(NOW.getTime() + deltaMs).toISOString();
}

function isoAgo(ms) {
  return dateFromNow(-ms);
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

async function seedBaseTrack(db) {
  await db
    .prepare("INSERT INTO users (id, created_at, risk_level) VALUES (?, ?, 'low')")
    .run("render_metrics_owner", isoAgo(30 * DAYS));
  await db
    .prepare(
      `INSERT INTO tracks (
        id, user_id, status, title, latest_version, created_at, updated_at
      ) VALUES (?, 'render_metrics_owner', 'complete', 'Render Metrics Song', 1, ?, ?)`,
    )
    .run("render_metrics_track", isoAgo(30 * DAYS), isoAgo(30 * DAYS));
}

async function seedTrackVersion(db, { id, renderType, status, completedAt }) {
  trackVersionCounter += 1;
  await db
    .prepare(
      `INSERT INTO track_versions (
        id, track_id, version_num, status, render_type, params_hash, created_at, completed_at
      ) VALUES (?, 'render_metrics_track', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      trackVersionCounter,
      status,
      renderType,
      `${id}_hash`,
      completedAt || isoAgo(1 * DAYS),
      completedAt,
    );
}

async function seedJob(db, { id, status, step = null, errorCode = null, createdAt, updatedAt }) {
  await db
    .prepare(
      `INSERT INTO jobs (
        id, track_version_id, workflow_type, status, step, error_code, created_at, updated_at
      ) VALUES (?, 'render_metrics_preview_ready_recent', 'song_render', ?, ?, ?, ?, ?)`,
    )
    .run(id, status, step, errorCode, createdAt, updatedAt);
}

function countMap(rows, key = "error_code") {
  return Object.fromEntries(rows.map((row) => [row[key], row.count]));
}

describe("admin render pipeline metrics routes", () => {
  let db;
  let app;
  let adminHeaders;

  beforeEach(async () => {
    trackVersionCounter = 0;
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

  test("render pipeline metrics require an admin session", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/metrics/render-pipeline",
    });

    assert.equal(response.statusCode, 401, response.body);
    assert.equal(response.json().error, "UNAUTHORIZED");
  });

  test("render pipeline metrics preserve success, error, latency, and trend aggregates", async () => {
    await seedBaseTrack(db);

    const today = isoAgo(2 * HOURS);
    const twoDaysAgo = isoAgo(2 * DAYS);
    const old = isoAgo(9 * DAYS);

    await seedTrackVersion(db, {
      id: "render_metrics_preview_ready_recent",
      renderType: "preview",
      status: "ready",
      completedAt: today,
    });
    await seedTrackVersion(db, {
      id: "render_metrics_preview_failed_recent",
      renderType: "preview",
      status: "failed",
      completedAt: today,
    });
    await seedTrackVersion(db, {
      id: "render_metrics_preview_processing_recent",
      renderType: "preview",
      status: "processing",
      completedAt: today,
    });
    await seedTrackVersion(db, {
      id: "render_metrics_preview_ready_old",
      renderType: "preview",
      status: "ready",
      completedAt: old,
    });
    await seedTrackVersion(db, {
      id: "render_metrics_full_ready_recent",
      renderType: "full",
      status: "ready",
      completedAt: twoDaysAgo,
    });
    await seedTrackVersion(db, {
      id: "render_metrics_full_failed_recent",
      renderType: "full",
      status: "failed",
      completedAt: twoDaysAgo,
    });
    await seedTrackVersion(db, {
      id: "render_metrics_full_queued_no_completed_at",
      renderType: "full",
      status: "queued",
      completedAt: null,
    });

    await seedJob(db, {
      id: "render_metrics_error_timeout_a",
      status: "failed",
      errorCode: "E_TIMEOUT",
      createdAt: isoAgo(4 * HOURS),
      updatedAt: isoAgo(3 * HOURS),
    });
    await seedJob(db, {
      id: "render_metrics_error_timeout_b",
      status: "failed",
      errorCode: "E_TIMEOUT",
      createdAt: isoAgo(3 * HOURS),
      updatedAt: isoAgo(2 * HOURS),
    });
    await seedJob(db, {
      id: "render_metrics_error_quota",
      status: "failed",
      errorCode: "E_QUOTA",
      createdAt: isoAgo(2 * HOURS),
      updatedAt: isoAgo(1 * HOURS),
    });
    await seedJob(db, {
      id: "render_metrics_error_old",
      status: "failed",
      errorCode: "E_OLD",
      createdAt: old,
      updatedAt: old,
    });

    for (let index = 0; index < 6; index += 1) {
      const createdAt = dateFromNow(-1 * DAYS + index * HOURS);
      await seedJob(db, {
        id: `render_metrics_latency_mix_${index}`,
        status: "completed",
        step: "mix",
        createdAt,
        updatedAt: new Date(new Date(createdAt).getTime() + (index + 1) * 1000).toISOString(),
      });
    }
    for (let index = 0; index < 5; index += 1) {
      const createdAt = dateFromNow(-2 * DAYS + index * HOURS);
      await seedJob(db, {
        id: `render_metrics_latency_lyrics_${index}`,
        status: "completed",
        step: "lyrics",
        createdAt,
        updatedAt: new Date(new Date(createdAt).getTime() + 10000).toISOString(),
      });
    }

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/metrics/render-pipeline",
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.deepEqual(body.successRate, {
      preview: 50,
      full: 33.33,
    });
    assert.deepEqual(countMap(body.errorBreakdown), {
      E_TIMEOUT: 2,
      E_QUOTA: 1,
    });
    assert.equal(body.errorBreakdown[0].last_seen, isoAgo(2 * HOURS));
    assert.deepEqual(body.stepLatency, [
      {
        step: "mix",
        sample_count: 6,
        avg_ms: 3500,
      },
    ]);
    assert.deepEqual(
      Object.fromEntries(
        body.dailyTrend.map((row) => [
          row.date,
          { success: row.success, failed: row.failed },
        ]),
      ),
      {
        [isoDate(twoDaysAgo)]: { success: 1, failed: 1 },
        [isoDate(today)]: { success: 1, failed: 1 },
      },
    );
  });
});
