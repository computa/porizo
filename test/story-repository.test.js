process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { createStoryRepository } = require("../src/database/story-repository");
const { createSqliteAdapter } = require("../src/database/sqlite");

let db;
let repository;

function createOrchestrationSchema(database) {
  database.exec(`
    CREATE TABLE admin_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL
    );
    CREATE TABLE orchestration_executions (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      runtime_mode TEXT NOT NULL CHECK(runtime_mode IN ('local', 'external')),
      request_json TEXT NOT NULL,
      result_json TEXT,
      debug_json TEXT,
      error_json TEXT,
      replay_of TEXT REFERENCES orchestration_executions(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE orchestration_execution_events (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL REFERENCES orchestration_executions(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL
    );
  `);
  database
    .prepare("INSERT INTO admin_users (id, email) VALUES (?, ?)")
    .run("adm_story_repo", "story-repo-admin@porizo.test");
}

function createLibraryEntrySchema(database) {
  database.exec(`
    CREATE TABLE track_library_entries (
      user_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      origin TEXT NOT NULL CHECK(origin IN ('created', 'received')),
      share_token_id TEXT,
      added_at TEXT NOT NULL,
      removed_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, track_id)
    );
    CREATE TABLE poem_library_entries (
      user_id TEXT NOT NULL,
      poem_id TEXT NOT NULL,
      origin TEXT NOT NULL CHECK(origin IN ('created', 'received')),
      share_token_id TEXT,
      added_at TEXT NOT NULL,
      removed_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, poem_id)
    );
  `);
}

describe("StoryRepository orchestration persistence", () => {
  beforeEach(() => {
    db = createSqliteAdapter({ dbPath: ":memory:" });
    createOrchestrationSchema(db);
    createLibraryEntrySchema(db);
    repository = createStoryRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("creates, updates, and reads orchestration execution records", async () => {
    await repository.createOrchestrationExecution({
      executionId: "exec_story_repo_1",
      adminId: "adm_story_repo",
      status: "running",
      endpoint: "backend_task_execute",
      runtimeMode: "local",
      requestPayload: { milestone: "M2", target_files: ["src/routes/story.js"] },
      createdAt: "2026-06-28T01:00:00.000Z",
    });

    await repository.updateOrchestrationExecution({
      executionId: "exec_story_repo_1",
      status: "succeeded",
      result: { files_changed: ["src/routes/story.js"] },
      debug: { attempts: 1 },
      error: null,
      updatedAt: "2026-06-28T01:01:00.000Z",
    });

    const row = await repository.getOrchestrationExecution(
      "exec_story_repo_1",
    );

    assert.equal(row.id, "exec_story_repo_1");
    assert.equal(row.admin_id, "adm_story_repo");
    assert.equal(row.status, "succeeded");
    assert.equal(row.endpoint, "backend_task_execute");
    assert.equal(row.runtime_mode, "local");
    assert.deepEqual(JSON.parse(row.request_json), {
      milestone: "M2",
      target_files: ["src/routes/story.js"],
    });
    assert.deepEqual(JSON.parse(row.result_json), {
      files_changed: ["src/routes/story.js"],
    });
    assert.deepEqual(JSON.parse(row.debug_json), { attempts: 1 });
    assert.equal(row.error_json, null);
    assert.equal(row.created_at, "2026-06-28T01:00:00.000Z");
    assert.equal(row.updated_at, "2026-06-28T01:01:00.000Z");
  });

  test("lists executions with status filtering and pagination", async () => {
    await repository.createOrchestrationExecution({
      executionId: "exec_running",
      adminId: "adm_story_repo",
      status: "running",
      endpoint: "backend_task_execute",
      runtimeMode: "local",
      requestPayload: {},
      createdAt: "2026-06-28T01:00:00.000Z",
    });
    await repository.createOrchestrationExecution({
      executionId: "exec_succeeded",
      adminId: "adm_story_repo",
      status: "succeeded",
      endpoint: "backend_task_execute",
      runtimeMode: "local",
      requestPayload: {},
      createdAt: "2026-06-28T01:05:00.000Z",
    });

    const allRows = await repository.listOrchestrationExecutions({
      limit: 10,
      offset: 0,
    });
    const succeededRows = await repository.listOrchestrationExecutions({
      status: "succeeded",
      limit: 10,
      offset: 0,
    });

    assert.equal(allRows.total, 2);
    assert.deepEqual(
      allRows.rows.map((row) => row.id),
      ["exec_succeeded", "exec_running"],
    );
    assert.equal(succeededRows.total, 1);
    assert.deepEqual(
      succeededRows.rows.map((row) => row.id),
      ["exec_succeeded"],
    );
  });

  test("appends and lists execution events in timeline order", async () => {
    await repository.createOrchestrationExecution({
      executionId: "exec_events",
      adminId: "adm_story_repo",
      status: "running",
      endpoint: "backend_task_execute",
      runtimeMode: "local",
      requestPayload: {},
      createdAt: "2026-06-28T01:00:00.000Z",
    });
    await repository.appendOrchestrationExecutionEvent({
      eventId: "event_two",
      executionId: "exec_events",
      sequence: 2,
      eventType: "runtime_execution_started",
      message: "Started",
      payload: { runtime_mode: "local" },
      createdAt: "2026-06-28T01:00:02.000Z",
    });
    await repository.appendOrchestrationExecutionEvent({
      eventId: "event_one",
      executionId: "exec_events",
      sequence: 1,
      eventType: "execution_created",
      level: "info",
      message: "",
      payload: null,
      createdAt: "2026-06-28T01:00:01.000Z",
    });

    const timeline = await repository.listOrchestrationExecutionEvents({
      executionId: "exec_events",
      limit: 10,
      offset: 0,
    });

    assert.equal(timeline.total, 2);
    assert.deepEqual(
      timeline.rows.map((row) => ({
        id: row.id,
        sequence: row.sequence,
        event_type: row.event_type,
        message: row.message,
        payload_json: row.payload_json,
      })),
      [
        {
          id: "event_one",
          sequence: 1,
          event_type: "execution_created",
          message: null,
          payload_json: null,
        },
        {
          id: "event_two",
          sequence: 2,
          event_type: "runtime_execution_started",
          message: "Started",
          payload_json: JSON.stringify({ runtime_mode: "local" }),
        },
      ],
    );
  });

  test("upserts track library entries without downgrading created ownership", async () => {
    await repository.upsertTrackLibraryEntry({
      userId: "user_story_repo",
      trackId: "track_story_repo",
      origin: "created",
      shareTokenId: null,
      addedAt: "2026-06-28T02:00:00.000Z",
    });
    await repository.removeTrackLibraryEntry({
      userId: "user_story_repo",
      trackId: "track_story_repo",
      removedAt: "2026-06-28T02:01:00.000Z",
    });
    await repository.upsertTrackLibraryEntry({
      userId: "user_story_repo",
      trackId: "track_story_repo",
      origin: "received",
      shareTokenId: "share_story_repo",
      addedAt: "2026-06-28T02:02:00.000Z",
    });

    const row = await db
      .prepare(
        "SELECT user_id, track_id, origin, share_token_id, added_at, removed_at FROM track_library_entries WHERE user_id = ? AND track_id = ?",
      )
      .get("user_story_repo", "track_story_repo");

    assert.deepEqual(row, {
      user_id: "user_story_repo",
      track_id: "track_story_repo",
      origin: "created",
      share_token_id: "share_story_repo",
      added_at: "2026-06-28T02:02:00.000Z",
      removed_at: null,
    });
  });

  test("upserts and removes poem library entries", async () => {
    await repository.upsertPoemLibraryEntry({
      userId: "user_story_repo",
      poemId: "poem_story_repo",
      origin: "created",
      shareTokenId: null,
      addedAt: "2026-06-28T03:00:00.000Z",
    });
    await repository.removePoemLibraryEntry({
      userId: "user_story_repo",
      poemId: "poem_story_repo",
      removedAt: "2026-06-28T03:01:00.000Z",
    });

    const row = await db
      .prepare(
        "SELECT user_id, poem_id, origin, share_token_id, added_at, removed_at, updated_at FROM poem_library_entries WHERE user_id = ? AND poem_id = ?",
      )
      .get("user_story_repo", "poem_story_repo");

    assert.deepEqual(row, {
      user_id: "user_story_repo",
      poem_id: "poem_story_repo",
      origin: "created",
      share_token_id: null,
      added_at: "2026-06-28T03:00:00.000Z",
      removed_at: "2026-06-28T03:01:00.000Z",
      updated_at: "2026-06-28T03:01:00.000Z",
    });
  });
});
