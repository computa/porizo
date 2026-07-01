require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");

function buildTestApp(db) {
  return buildServer({
    db,
    config: { STORAGE_DIR: "/tmp/test-storage" },
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
  return response.json().token;
}

async function seedUser(db, id, email) {
  await db
    .prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)")
    .run(id, email, "2026-06-27T08:00:00.000Z");
}

async function seedSession(
  db,
  {
    id,
    userId,
    status = "active",
    engineVersion = "v3",
    recipientName = "Maya",
    updatedAt,
  },
) {
  await db
    .prepare(
      `INSERT INTO story_sessions (
        id,
        user_id,
        status,
        arc,
        occasion,
        recipient_name,
        initial_prompt,
        elements_json,
        question_count,
        engine_version,
        created_at,
        updated_at,
        expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      status,
      "tribute",
      "birthday",
      recipientName,
      `Tell me about ${recipientName}`,
      "{}",
      2,
      engineVersion,
      "2026-06-27T08:30:00.000Z",
      updatedAt,
      "2026-06-28T08:30:00.000Z",
    );
}

async function seedTurn(db, { id, sessionId, turnNumber, question }) {
  await db
    .prepare(
      `INSERT INTO story_turns (
        id,
        session_id,
        turn_number,
        question,
        asked_at
      ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      sessionId,
      turnNumber,
      question,
      `2026-06-27T09:0${turnNumber}:00.000Z`,
    );
}

describe("admin story session routes", () => {
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

    await seedUser(db, "story_route_user_a", "route-a@example.com");
    await seedUser(db, "story_route_user_b", "route-b@example.com");
    await seedSession(db, {
      id: "story_route_old",
      userId: "story_route_user_a",
      status: "active",
      engineVersion: "v2",
      recipientName: "Ava",
      updatedAt: "2026-06-27T09:00:00.000Z",
    });
    await seedSession(db, {
      id: "story_route_new",
      userId: "story_route_user_b",
      status: "confirmed",
      engineVersion: "v3",
      recipientName: "Nia",
      updatedAt: "2026-06-27T10:00:00.000Z",
    });
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("GET /admin/dashboard/story/sessions filters sessions and omits turns", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/story/sessions?status=active&engineVersion=v2&limit=500&offset=-20",
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.deepEqual(
      body.sessions.map((session) => ({
        id: session.id,
        user_email: session.user_email,
        recipient_name: session.recipient_name,
      })),
      [
        {
          id: "story_route_old",
          user_email: "route-a@example.com",
          recipient_name: "Ava",
        },
      ],
    );
    assert.equal(Object.hasOwn(body.sessions[0], "initial_prompt"), false);
    assert.equal(Object.hasOwn(body.sessions[0], "turns"), false);
  });

  test("GET /admin/dashboard/story/sessions requires an admin session", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/story/sessions",
    });

    assert.equal(response.statusCode, 401, response.body);
    assert.equal(response.json().error, "UNAUTHORIZED");
  });

  test("GET /admin/dashboard/story/sessions preserves default ordering and pagination", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/story/sessions",
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.deepEqual(
      body.sessions.map((session) => session.id),
      ["story_route_new", "story_route_old"],
    );
  });

  test("GET /admin/dashboard/story/sessions/:id returns only that session's turns in order", async () => {
    await seedTurn(db, {
      id: "story_route_other_turn",
      sessionId: "story_route_new",
      turnNumber: 1,
      question: "This should not leak",
    });
    await seedTurn(db, {
      id: "story_route_turn_two",
      sessionId: "story_route_old",
      turnNumber: 2,
      question: "What happened next?",
    });
    await seedTurn(db, {
      id: "story_route_turn_one",
      sessionId: "story_route_old",
      turnNumber: 1,
      question: "Where did it begin?",
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/story/sessions/story_route_old",
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.deepEqual(
      {
        id: body.session.id,
        user_id: body.session.user_id,
        user_email: body.session.user_email,
        status: body.session.status,
        engine_version: body.session.engine_version,
        recipient_name: body.session.recipient_name,
        initial_prompt: body.session.initial_prompt,
      },
      {
        id: "story_route_old",
        user_id: "story_route_user_a",
        user_email: "route-a@example.com",
        status: "active",
        engine_version: "v2",
        recipient_name: "Ava",
        initial_prompt: "Tell me about Ava",
      },
    );
    assert.deepEqual(
      body.turns.map((turn) => ({
        id: turn.id,
        session_id: turn.session_id,
        turn_number: turn.turn_number,
        question: turn.question,
      })),
      [
        {
          id: "story_route_turn_one",
          session_id: "story_route_old",
          turn_number: 1,
          question: "Where did it begin?",
        },
        {
          id: "story_route_turn_two",
          session_id: "story_route_old",
          turn_number: 2,
          question: "What happened next?",
        },
      ],
    );
  });

  test("GET /admin/dashboard/story/sessions/:id requires an admin session", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/story/sessions/story_route_old",
    });

    assert.equal(response.statusCode, 401, response.body);
    assert.equal(response.json().error, "UNAUTHORIZED");
  });

  test("GET /admin/dashboard/story/sessions/:id returns 404 for missing sessions", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/story/sessions/missing_story_session",
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 404, response.body);
    assert.match(response.body, /Story session not found/);
  });
});
