process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAdminStorySessionRepository,
} = require("../src/database/admin-story-session-repository");
const { AdminService } = require("../src/services/admin-service");
const {
  createAdminStorySessionService,
} = require("../src/services/admin/story-session-service");

let db;
let repository;

async function seedUser(id, email) {
  await db
    .prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)")
    .run(id, email, "2026-06-27T08:00:00.000Z");
}

async function seedSession({
  id,
  userId,
  status = "active",
  engineVersion = "v3",
  recipientName = "Maya",
  occasion = "birthday",
  questionCount = 2,
  updatedAt,
}) {
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
      occasion,
      recipientName,
      "Tell me about Maya",
      "{}",
      questionCount,
      engineVersion,
      "2026-06-27T08:30:00.000Z",
      updatedAt,
      "2026-06-28T08:30:00.000Z",
    );
}

async function seedTurn({
  id,
  sessionId,
  turnNumber,
  question,
  answer = null,
}) {
  await db
    .prepare(
      `INSERT INTO story_turns (
        id,
        session_id,
        turn_number,
        question,
        answer,
        asked_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      sessionId,
      turnNumber,
      question,
      answer,
      `2026-06-27T09:0${turnNumber}:00.000Z`,
    );
}

describe("AdminStorySessionRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAdminStorySessionRepository(db);

    await seedUser("user_story_a", "story-a@example.com");
    await seedUser("user_story_b", "story-b@example.com");
    await seedSession({
      id: "session_old",
      userId: "user_story_a",
      status: "active",
      engineVersion: "v2",
      recipientName: "Ava",
      updatedAt: "2026-06-27T09:00:00.000Z",
    });
    await seedSession({
      id: "session_new",
      userId: "user_story_b",
      status: "confirmed",
      engineVersion: "v3",
      recipientName: "Nia",
      updatedAt: "2026-06-27T10:00:00.000Z",
    });
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("listSessions returns admin rows ordered by updated_at descending", async () => {
    const rows = await repository.listSessions({ limit: 10, offset: 0 });

    assert.deepEqual(
      rows.map((row) => ({
        id: row.id,
        user_email: row.user_email,
        recipient_name: row.recipient_name,
      })),
      [
        {
          id: "session_new",
          user_email: "story-b@example.com",
          recipient_name: "Nia",
        },
        {
          id: "session_old",
          user_email: "story-a@example.com",
          recipient_name: "Ava",
        },
      ],
    );
  });

  test("listSessions applies status and engine filters with bounds supplied by service", async () => {
    const rows = await repository.listSessions({
      status: "active",
      engineVersion: "v2",
      limit: 1,
      offset: 0,
    });

    assert.deepEqual(
      rows.map((row) => row.id),
      ["session_old"],
    );
  });

  test("getSessionDetail returns the raw admin session row and ordered turns", async () => {
    await seedTurn({
      id: "turn_two",
      sessionId: "session_old",
      turnNumber: 2,
      question: "What changed after that?",
      answer: "We became close.",
    });
    await seedTurn({
      id: "turn_one",
      sessionId: "session_old",
      turnNumber: 1,
      question: "Where did it start?",
      answer: "At home.",
    });

    const detail = await repository.getSessionDetail("session_old");

    assert.equal(detail.session.id, "session_old");
    assert.equal(detail.session.user_email, "story-a@example.com");
    assert.deepEqual(
      detail.turns.map((turn) => ({
        id: turn.id,
        turn_number: turn.turn_number,
        question: turn.question,
      })),
      [
        {
          id: "turn_one",
          turn_number: 1,
          question: "Where did it start?",
        },
        {
          id: "turn_two",
          turn_number: 2,
          question: "What changed after that?",
        },
      ],
    );
  });

  test("getSessionDetail returns null for missing sessions without reading turns", async () => {
    assert.equal(await repository.getSessionDetail("missing_session"), null);
  });

  test("AdminService delegates story session reads through the repository with safe bounds", async () => {
    const calls = [];
    const service = new AdminService(db, {
      adminStorySessionRepository: {
        async listSessions(args) {
          calls.push(args);
          return [{ id: "delegated" }];
        },
        async getSessionDetail(sessionId) {
          calls.push({ sessionId });
          return { session: { id: sessionId }, turns: [] };
        },
      },
    });

    assert.deepEqual(
      await service.listStorySessions({
        status: "active",
        engineVersion: "v3",
        limit: 500,
        offset: -25,
      }),
      [{ id: "delegated" }],
    );
    assert.deepEqual(await service.getStorySessionDetail("session_service"), {
      session: { id: "session_service" },
      turns: [],
    });

    assert.deepEqual(calls, [
      {
        status: "active",
        engineVersion: "v3",
        limit: 100,
        offset: 0,
      },
      { sessionId: "session_service" },
    ]);
  });

  test("AdminStorySessionService owns story session bounds and repository delegation", async () => {
    const calls = [];
    const service = createAdminStorySessionService({
      adminStorySessionRepository: {
        async listSessions(args) {
          calls.push(args);
          return [{ id: "service_delegated" }];
        },
        async getSessionDetail(sessionId) {
          calls.push({ sessionId });
          return { session: { id: sessionId }, turns: [] };
        },
      },
    });

    assert.deepEqual(
      await service.listStorySessions({
        status: "confirmed",
        engineVersion: "v3",
        limit: 250,
        offset: -5,
      }),
      [{ id: "service_delegated" }],
    );
    assert.deepEqual(await service.getStorySessionDetail("session_direct"), {
      session: { id: "session_direct" },
      turns: [],
    });

    assert.deepEqual(calls, [
      {
        status: "confirmed",
        engineVersion: "v3",
        limit: 100,
        offset: 0,
      },
      { sessionId: "session_direct" },
    ]);
  });
});
