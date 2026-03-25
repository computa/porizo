require("dotenv/config");
const assert = require("node:assert/strict");
const { before, after, describe, test } = require("node:test");
const fastify = require("fastify");

const { registerStoryRoutes } = require("../src/routes/story");
const writer = require("../src/writer");

let app;
let originalGetStoryState;
let originalGetStoryContext;

const TEST_USER_ID = "user_story_track_test";

function sendError(reply, statusCode, errorCode, message, details) {
  const payload = { error: errorCode, message };
  if (details && typeof details === "object") {
    Object.assign(payload, details);
  }
  reply.code(statusCode).send(payload);
}

const executed = [];
const dbStub = {
  prepare(sql) {
    return {
      run: async (...args) => {
        executed.push({ sql, args });
        if (sql.includes("UPDATE track_library_entries")) {
          return { changes: 0 };
        }
        return { changes: 1 };
      },
      get: async (...args) => {
        executed.push({ sql, args, read: true });
        if (sql.includes("SELECT id FROM voice_profiles")) {
          return { id: "voice_profile_1" };
        }
        return null;
      },
      all: async () => [],
    };
  },
};

before(async () => {
  app = fastify({ logger: false });
  originalGetStoryState = writer.getStoryState;
  originalGetStoryContext = writer.getStoryContext;

  registerStoryRoutes(app, {
    db: dbStub,
    requireUserId: async () => TEST_USER_ID,
    sendError,
    consumeRateLimit: async () => ({ allowed: true, reset_at: null }),
    addAuditEntry: () => {},
    eventsService: null,
    getUserRiskLevel: async () => "low",
  });

  await app.ready();
});

after(async () => {
  writer.getStoryState = originalGetStoryState;
  writer.getStoryContext = originalGetStoryContext;
  await app.close();
});

describe("POST /story/:story_id/to-track contract", () => {
  test("preserves requested voice mode and canonical story provenance", async () => {
    executed.length = 0;
    writer.getStoryState = async () => ({ id: "story_track_1", userId: TEST_USER_ID });
    writer.getStoryContext = async () => ({
      sessionId: "story_track_1",
      engineVersion: "v3",
      recipientName: "Vincent",
      occasion: "birthday",
      style: "pop",
      eventType: "celebration",
      initialPrompt: "He should know those Awka days made him resilient.",
      facts: [{ id: "f_context", text: "Awka trained him to keep going." }],
      summary: { text: "Awka trained him to keep going.", factCount: 1, beatsUncovered: 0 },
      status: "confirmed",
      narrativeVersion: 4,
    });

    const response = await app.inject({
      method: "POST",
      url: "/story/story_track_1/to-track",
      payload: { voice_mode: "user_voice" },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.version_num, 1);
    assert.equal(body.voice_mode, "user_voice");

    const trackInsert = executed.find((entry) => entry.sql.includes("INSERT INTO tracks"));
    assert.ok(trackInsert, "expected track insert");
    assert.equal(trackInsert.args[8], "user_voice");

    const storyContext = JSON.parse(trackInsert.args[7]);
    assert.equal(storyContext.story_id, "story_track_1");
    assert.equal(storyContext.narrative_version, 4);
    assert.equal(storyContext.engine_version, "v3");

    const versionInsert = executed.find((entry) => entry.sql.includes("INSERT INTO track_versions"));
    assert.ok(versionInsert, "expected version insert");
    const params = JSON.parse(versionInsert.args[2]);
    assert.equal(params.voice_mode, "user_voice");
    assert.equal(params.narrative_version, 4);
  });

  test("prefers explicit request style over stale story context style", async () => {
    executed.length = 0;
    writer.getStoryState = async () => ({ id: "story_track_2", userId: TEST_USER_ID });
    writer.getStoryContext = async () => ({
      sessionId: "story_track_2",
      engineVersion: "v3",
      recipientName: "Chioma",
      occasion: "birthday",
      style: "pop",
      eventType: "celebration",
      initialPrompt: "She carried the whole family through a hard year.",
      facts: [{ id: "f_context", text: "She kept everyone together." }],
      summary: { text: "She kept everyone together.", factCount: 1, beatsUncovered: 0 },
      status: "confirmed",
      narrativeVersion: 2,
    });

    const response = await app.inject({
      method: "POST",
      url: "/story/story_track_2/to-track",
      payload: {
        voice_mode: "user_voice",
        style: "igbo_highlife",
      },
    });

    assert.equal(response.statusCode, 200, response.body);

    const trackInsert = executed.find((entry) => entry.sql.includes("INSERT INTO tracks"));
    assert.ok(trackInsert, "expected track insert");
    assert.equal(trackInsert.args[6], "igbo_highlife");

    const versionInsert = executed.find((entry) => entry.sql.includes("INSERT INTO track_versions"));
    assert.ok(versionInsert, "expected version insert");
    const params = JSON.parse(versionInsert.args[2]);
    assert.equal(params.style, "igbo_highlife");
  });

  test("passes includeReadiness: false to getStoryContext", async () => {
    executed.length = 0;
    let capturedOptions;
    writer.getStoryState = async () => ({ id: "story_track_3", userId: TEST_USER_ID });
    writer.getStoryContext = async (id, options) => {
      capturedOptions = options;
      return {
        sessionId: "story_track_3",
        engineVersion: "v3",
        recipientName: "Tunde",
        occasion: "birthday",
        style: "afrobeats",
        eventType: "celebration",
        initialPrompt: "He always shows up when it matters.",
        facts: [{ id: "f_context", text: "Always reliable." }],
        summary: { text: "Always reliable.", factCount: 1, beatsUncovered: 0 },
        status: "confirmed",
        narrativeVersion: 1,
        readiness: null,
      };
    };

    const response = await app.inject({
      method: "POST",
      url: "/story/story_track_3/to-track",
      payload: { voice_mode: "ai_voice" },
    });

    assert.equal(response.statusCode, 200);
    assert.deepStrictEqual(capturedOptions, { includeReadiness: false });
  });
});
