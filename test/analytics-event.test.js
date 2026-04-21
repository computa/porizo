require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { beforeEach, afterEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");

function buildTestApp(db, overrides = {}) {
  return buildServer({
    db,
    config: {
      STORAGE_DIR: "/tmp/test-storage",
      PUBLIC_BASE_URL: "http://public.local",
      STREAM_BASE_URL: "http://stream.local",
      ALLOW_ANON_USER_ID: true,
      ...overrides,
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

async function insertUser(db, userId) {
  await db
    .prepare(
      "INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, datetime('now'), 'low')"
    )
    .run(userId);
}

describe("POST /analytics/event", () => {
  let db;
  let app;
  const userId = "analytics_test_user";

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildTestApp(db);
    await insertUser(db, userId);
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("happy path — authed POST with event_id, event_name, properties returns 202 accepted and writes row", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/analytics/event",
      headers: { "x-user-id": userId },
      payload: {
        event_id: "evt_test_11111111",
        event_name: "auth_completed",
        properties: { method: "apple" },
      },
    });

    assert.equal(response.statusCode, 202, response.body);
    assert.equal(response.json().status, "accepted");
    assert.equal(response.json().id, "evt_test_11111111");

    const row = await db
      .prepare("SELECT * FROM events WHERE id = ?")
      .get("evt_test_11111111");
    assert.ok(row, "expected events row");
    assert.equal(row.event_name, "auth_completed");
    assert.equal(row.user_id, userId);
    assert.ok(row.metadata_json);
    const metadata = JSON.parse(row.metadata_json);
    assert.equal(metadata.method, "apple");
  });

  test("happy path — same event posted twice returns duplicate on the second call and writes only one row", async () => {
    const payload = {
      event_id: "evt_dup_22222222",
      event_name: "create_started",
      properties: { type: "song", variation: "false" },
    };

    const first = await app.inject({
      method: "POST",
      url: "/analytics/event",
      headers: { "x-user-id": userId },
      payload,
    });
    assert.equal(first.statusCode, 202);
    assert.equal(first.json().status, "accepted");

    const second = await app.inject({
      method: "POST",
      url: "/analytics/event",
      headers: { "x-user-id": userId },
      payload,
    });
    assert.equal(second.statusCode, 202);
    assert.equal(second.json().status, "duplicate");

    const rows = await db
      .prepare("SELECT id FROM events WHERE id = ?")
      .all("evt_dup_22222222");
    assert.equal(rows.length, 1, "expected exactly one row after duplicate POST");
  });

  test("happy path — optional resource_type and resource_id are forwarded", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/analytics/event",
      headers: { "x-user-id": userId },
      payload: {
        event_id: "evt_resource_33333333",
        event_name: "first_song_completed",
        resource_type: "track",
        resource_id: "track_abc",
        properties: { trackId: "track_abc", status: "ready" },
      },
    });
    assert.equal(response.statusCode, 202, response.body);

    const row = await db
      .prepare("SELECT * FROM events WHERE id = ?")
      .get("evt_resource_33333333");
    assert.equal(row.resource_type, "track");
    assert.equal(row.resource_id, "track_abc");
  });

  test("happy path — properties is optional", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/analytics/event",
      headers: { "x-user-id": userId },
      payload: {
        event_id: "evt_noprops_44444444",
        event_name: "session_resumed",
      },
    });
    assert.equal(response.statusCode, 202, response.body);

    const row = await db
      .prepare("SELECT metadata_json FROM events WHERE id = ?")
      .get("evt_noprops_44444444");
    assert.ok(row);
    assert.equal(row.metadata_json, null);
  });

  test("edge case — properties with 9 keys is rejected with 413", async () => {
    const properties = {};
    for (let i = 0; i < 9; i += 1) {
      properties[`k${i}`] = "v";
    }
    const response = await app.inject({
      method: "POST",
      url: "/analytics/event",
      headers: { "x-user-id": userId },
      payload: {
        event_id: "evt_toomany_55555555",
        event_name: "auth_completed",
        properties,
      },
    });
    assert.equal(response.statusCode, 413, response.body);
  });

  test("edge case — property value over 256 chars is rejected with 413", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/analytics/event",
      headers: { "x-user-id": userId },
      payload: {
        event_id: "evt_toolong_66666666",
        event_name: "auth_completed",
        properties: { blob: "x".repeat(300) },
      },
    });
    assert.equal(response.statusCode, 413, response.body);
  });

  test("edge case — PII-flagged key in properties is rejected with 400", async () => {
    for (const key of ["email", "phone", "name", "recipient_name", "message", "lyrics", "raw_text"]) {
      const response = await app.inject({
        method: "POST",
        url: "/analytics/event",
        headers: { "x-user-id": userId },
        payload: {
          event_id: `evt_pii_${key}`,
          event_name: "create_started",
          properties: { [key]: "sarah" },
        },
      });
      assert.equal(
        response.statusCode,
        400,
        `expected 400 for forbidden key ${key}, got ${response.statusCode} body=${response.body}`
      );
    }
  });

  test("edge case — event_name with uppercase rejected with 400", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/analytics/event",
      headers: { "x-user-id": userId },
      payload: {
        event_id: "evt_case_77777777",
        event_name: "Auth_Completed",
      },
    });
    assert.equal(response.statusCode, 400);
  });

  test("edge case — event_name over 64 chars rejected with 400", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/analytics/event",
      headers: { "x-user-id": userId },
      payload: {
        event_id: "evt_long_88888888",
        event_name: "a".repeat(100),
      },
    });
    assert.equal(response.statusCode, 400);
  });

  test("edge case — missing event_id rejected with 400", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/analytics/event",
      headers: { "x-user-id": userId },
      payload: {
        event_name: "auth_completed",
      },
    });
    assert.equal(response.statusCode, 400);
  });

  test("edge case — non-string property value rejected with 400", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/analytics/event",
      headers: { "x-user-id": userId },
      payload: {
        event_id: "evt_nonstring_99999999",
        event_name: "auth_completed",
        properties: { count: 42 },
      },
    });
    assert.equal(response.statusCode, 400);
  });

  test("error path — missing event_name rejected with 400", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/analytics/event",
      headers: { "x-user-id": userId },
      payload: {
        event_id: "evt_missing_name",
      },
    });
    assert.equal(response.statusCode, 400);
  });
});

describe("POST /analytics/event — kill switch", () => {
  let db;
  let app;
  const userId = "analytics_killswitch_user";

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildTestApp(db, { ANALYTICS_INGEST_ENABLED: "false" });
    await insertUser(db, userId);
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("returns 503 and writes no row when ANALYTICS_INGEST_ENABLED=false", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/analytics/event",
      headers: { "x-user-id": userId },
      payload: {
        event_id: "evt_kill_aaaaaaa",
        event_name: "auth_completed",
      },
    });
    assert.equal(response.statusCode, 503);

    const row = await db
      .prepare("SELECT id FROM events WHERE id = ?")
      .get("evt_kill_aaaaaaa");
    assert.equal(row, undefined);
  });
});
