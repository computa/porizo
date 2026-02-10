require("dotenv/config");
const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const fastify = require("fastify");

const { registerStoryRoutes } = require("../src/routes/story");
const { createSqliteAdapter } = require("../src/database/sqlite");

const TEST_USER_ID = "user_story_v3_orchestration";
const ADMIN_TOKEN = "admin-token";

function sendError(reply, statusCode, errorCode, message, details) {
  const payload = { error: errorCode, message };
  if (details && typeof details === "object") {
    Object.assign(payload, details);
  }
  reply.code(statusCode).send(payload);
}

async function createApp({ enableV3OrchestrationRoutes }) {
  const db = createSqliteAdapter({ dbPath: ":memory:" });
  db.exec(`
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
  `);
  db.prepare("INSERT INTO admin_users (id, email) VALUES (?, ?)").run("adm_test", "admin@porizo.test");

  const app = fastify({ logger: false });
  registerStoryRoutes(app, {
    db,
    requireUserId: async (request) => request.headers["x-user-id"] || null,
    requireAdminRole: async (request, reply, allowedRoles) => {
      const auth = request.headers.authorization;
      if (auth !== `Bearer ${ADMIN_TOKEN}`) {
        sendError(reply, 401, "UNAUTHORIZED", "Missing authorization token");
        return null;
      }
      const role = request.headers["x-admin-role"] || "admin";
      if (!allowedRoles.includes(role)) {
        sendError(reply, 403, "FORBIDDEN", `This action requires one of: ${allowedRoles.join(", ")}`);
        return null;
      }
      return { adminId: "adm_test", role, email: "admin@porizo.test" };
    },
    sendError,
    consumeRateLimit: async () => ({ allowed: true, reset_at: null }),
    addAuditEntry: () => {},
    eventsService: null,
    enableV3OrchestrationRoutes,
  });
  await app.ready();
  return app;
}

describe("Story V3 orchestration routes", () => {
  test("are disabled by default", async () => {
    const app = await createApp({ enableV3OrchestrationRoutes: false });
    const response = await app.inject({
      method: "POST",
      url: "/story/v3/orchestration/planning/envelope",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {},
    });

    assert.equal(response.statusCode, 404);
    await app.close();
  });

  test("exposes planning/backend/pattern/trajectory endpoints when enabled", async () => {
    const app = await createApp({ enableV3OrchestrationRoutes: true });

    const envelopeRes = await app.inject({
      method: "POST",
      url: "/story/v3/orchestration/planning/envelope",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: {
        task_id: "story-v3-phase-2",
        repo: "porizo",
        objective: "Enable orchestration runtime endpoints",
        constraints: { preserve_v2_resilience: true },
      },
    });
    assert.equal(envelopeRes.statusCode, 200);
    assert.equal(envelopeRes.json().planning_envelope.task_id, "story-v3-phase-2");

    const planningRes = await app.inject({
      method: "POST",
      url: "/story/v3/orchestration/planning/normalize",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: {
        planning_output: {
          architecture: {
            new_modules: ["src/writer/v3/orchestration/index.js"],
            modified_modules: ["src/routes/story.js"],
            api_changes: ["new orchestration routes"],
          },
          milestones: [{ id: "M2", name: "Route integration" }],
        },
      },
    });
    assert.equal(planningRes.statusCode, 200);
    assert.equal(planningRes.json().planning_output.milestones.length, 1);

    const backendRes = await app.inject({
      method: "POST",
      url: "/story/v3/orchestration/backend-task",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: {
        milestone: "M2",
        design_refs: ["docs/newStory/specv3.md#9.2"],
        target_files: ["src/routes/story.js", "test/story-v3-orchestration-routes.test.js"],
      },
    });
    assert.equal(backendRes.statusCode, 200);
    assert.equal(backendRes.json().backend_task.milestone, "M2");

    const patternRes = await app.inject({
      method: "POST",
      url: "/story/v3/orchestration/patterns/extract",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: {
        repository: "porizo",
        files: [
          { path: "src/routes/story.js", content: "app.post('/story/start', async () => {});" },
          { path: "test/story.test.js", content: "const { describe } = require('node:test');" },
        ],
      },
    });
    assert.equal(patternRes.statusCode, 200);
    assert.ok(patternRes.json().pattern_extraction.patterns.length >= 1);

    const trajectoryRes = await app.inject({
      method: "POST",
      url: "/story/v3/orchestration/trajectory/build",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: {
        objective: "Rebuild flow from pattern pack",
        plan: { milestones: [{ id: "M2", name: "Route integration" }] },
        pattern_extraction: patternRes.json().pattern_extraction,
        reconstruction_steps: [{ id: "1", instruction: "Create orchestration route surface" }],
      },
    });
    assert.equal(trajectoryRes.statusCode, 200);
    assert.equal(trajectoryRes.json().trajectory_example.steps.length, 1);

    await app.close();
  });

  test("runs debug feedback loop against internal routes when enabled", async () => {
    const app = await createApp({ enableV3OrchestrationRoutes: true });

    const response = await app.inject({
      method: "POST",
      url: "/story/v3/orchestration/debug-loop",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: {
        max_attempts: 2,
        debug_user_id: TEST_USER_ID,
        checks: [
          {
            name: "story_info_status",
            method: "GET",
            path: "/story/info",
            expectedStatus: 200,
            expectJson: { "status.available": true },
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().passed, true);
    assert.equal(response.json().attempts, 1);

    await app.close();
  });

  test("rejects non-internal debug check paths", async () => {
    const app = await createApp({ enableV3OrchestrationRoutes: true });
    const response = await app.inject({
      method: "POST",
      url: "/story/v3/orchestration/debug-loop",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: {
        checks: [
          {
            name: "invalid_external",
            method: "GET",
            path: "https://example.com/health",
            expectedStatus: 200,
          },
        ],
      },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "V3_ORCHESTRATION_DEBUG_LOOP_FAILED");

    await app.close();
  });

  test("requires admin authorization for orchestration routes", async () => {
    const app = await createApp({ enableV3OrchestrationRoutes: true });
    const response = await app.inject({
      method: "POST",
      url: "/story/v3/orchestration/planning/envelope",
      payload: {},
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, "UNAUTHORIZED");
    await app.close();
  });

  test("executes backend task route and returns execution payload", async () => {
    const app = await createApp({ enableV3OrchestrationRoutes: true });
    const response = await app.inject({
      method: "POST",
      url: "/story/v3/orchestration/backend-task/execute",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: {
        milestone: "M2",
        design_refs: ["docs/newStory/specv3.md#9.2"],
        target_files: ["src/routes/story.js"],
        objective: "Implement orchestration execution endpoint",
        repository: "porizo",
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.backend_task.milestone, "M2");
    assert.ok(body.execution.execution_id);
    assert.ok(Array.isArray(body.execution.files_changed));
    assert.equal(body.persisted_execution_id, body.execution.execution_id);

    const getRes = await app.inject({
      method: "GET",
      url: `/story/v3/orchestration/executions/${body.persisted_execution_id}`,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.json().execution.id, body.persisted_execution_id);
    assert.equal(getRes.json().execution.status, body.execution.status);

    const listRes = await app.inject({
      method: "GET",
      url: "/story/v3/orchestration/executions?limit=10&offset=0",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    assert.equal(listRes.statusCode, 200);
    assert.ok(listRes.json().pagination.total >= 1);
    assert.ok(listRes.json().items.some((item) => item.id === body.persisted_execution_id));

    const replayRes = await app.inject({
      method: "POST",
      url: `/story/v3/orchestration/executions/${body.persisted_execution_id}/replay`,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: {
        runtime_mode: "local",
      },
    });
    assert.equal(replayRes.statusCode, 200);
    assert.equal(replayRes.json().replay_of, body.persisted_execution_id);
    assert.ok(replayRes.json().persisted_execution_id);

    await app.close();
  });
});
