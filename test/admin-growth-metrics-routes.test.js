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

function datePart(iso) {
  return iso.slice(0, 10);
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

async function seedEvent(db, id, eventName, createdAt) {
  await db
    .prepare(
      `INSERT INTO events (
        id, event_name, user_id, resource_type, resource_id, metadata_json, created_at
      ) VALUES (?, ?, NULL, NULL, NULL, NULL, ?)`,
    )
    .run(id, eventName, createdAt);
}

async function seedShare(db, fields) {
  await db
    .prepare(
      `INSERT INTO share_tokens (
        id, track_id, track_version_id, creator_id, status, bound_at,
        expires_at, created_at, access_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fields.id,
      fields.trackId ?? `${fields.id}_track`,
      fields.trackVersionId ?? `${fields.id}_version`,
      fields.creatorId ?? "growth_route_user",
      fields.status ?? "active",
      fields.boundAt ?? null,
      fields.expiresAt ?? isoAgo(-30 * DAYS),
      fields.createdAt,
      fields.accessCount ?? 0,
    );
}

describe("admin growth metrics routes", () => {
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

  test("growth metric routes require an admin session", async () => {
    const teaser = await app.inject({
      method: "GET",
      url: "/admin/dashboard/growth/teasers",
    });
    assert.equal(teaser.statusCode, 401, teaser.body);
    assert.equal(teaser.json().error, "UNAUTHORIZED");

    const shares = await app.inject({
      method: "GET",
      url: "/admin/dashboard/growth/shares",
    });
    assert.equal(shares.statusCode, 401, shares.body);
    assert.equal(shares.json().error, "UNAUTHORIZED");
  });

  test("teaser metrics preserve counts, rates, and daily trend", async () => {
    const teaserDay = isoAgo(2 * DAYS);
    await seedEvent(db, "growth_route_teaser_1", "teaser_viewed", teaserDay);
    await seedEvent(db, "growth_route_teaser_2", "teaser_viewed", teaserDay);
    await seedEvent(db, "growth_route_claim", "share_claim", isoAgo(2 * HOURS));
    await seedEvent(db, "growth_route_stream", "share_stream", isoAgo(1 * HOURS));
    await seedEvent(db, "growth_route_old", "teaser_viewed", isoAgo(9 * DAYS));

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/growth/teasers?days=7",
      headers: adminHeaders,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {
      teaserViews: 2,
      shareClaims: 1,
      shareStreams: 1,
      viewToClaimRate: "50.00",
      viewToStreamRate: "50.00",
      dailyViews: [{ date: datePart(teaserDay), count: 2 }],
    });
  });

  test("share metrics preserve created/claimed counts, rates, average access, and daily trend", async () => {
    const shareDay = isoAgo(2 * DAYS);
    await seedShare(db, {
      id: "growth_route_share_claimed",
      status: "claimed",
      boundAt: isoAgo(1 * DAYS),
      createdAt: shareDay,
      accessCount: 4,
    });
    await seedShare(db, {
      id: "growth_route_share_active",
      status: "active",
      createdAt: shareDay,
      accessCount: 2,
    });
    await seedShare(db, {
      id: "growth_route_share_old_claimed",
      status: "claimed",
      boundAt: isoAgo(1 * DAYS),
      createdAt: isoAgo(40 * DAYS),
      accessCount: 100,
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/growth/shares?days=30",
      headers: adminHeaders,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {
      created: 2,
      claimed: 2,
      claimRate: "100.00",
      byStatus: [
        { status: "active", count: 1 },
        { status: "claimed", count: 1 },
      ],
      avgAccessCount: "3.0",
      dailyCreated: [{ date: datePart(shareDay), count: 2 }],
    });
  });
});
