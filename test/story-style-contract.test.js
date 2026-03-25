require("dotenv/config");
const assert = require("node:assert/strict");
const { before, after, describe, test } = require("node:test");
const fastify = require("fastify");

const { registerStoryRoutes } = require("../src/routes/story");
const writer = require("../src/writer");

let app;
let originalGetStoryState;
let originalUpdateStoryStyle;

const TEST_USER_ID = "user_story_style_contract_test";

function sendError(reply, statusCode, errorCode, message, details) {
  const payload = { error: errorCode, message };
  if (details && typeof details === "object") {
    Object.assign(payload, details);
  }
  reply.code(statusCode).send(payload);
}

const dbStub = {
  prepare() {
    return {
      run: async () => ({ changes: 0 }),
      get: async () => null,
      all: async () => [],
    };
  },
};

before(async () => {
  app = fastify({ logger: false });
  originalGetStoryState = writer.getStoryState;
  originalUpdateStoryStyle = writer.updateStoryStyle;

  registerStoryRoutes(app, {
    db: dbStub,
    requireUserId: async () => TEST_USER_ID,
    sendError,
    consumeRateLimit: async () => ({ allowed: true, reset_at: null }),
    addAuditEntry: () => {},
    eventsService: null,
  });

  await app.ready();
});

after(async () => {
  writer.getStoryState = originalGetStoryState;
  writer.updateStoryStyle = originalUpdateStoryStyle;
  await app.close();
});

describe("POST /story/:story_id/style contract", () => {
  test("persists normalized style for an owned story session", async () => {
    let capturedStyle = null;
    writer.getStoryState = async () => ({ id: "story_style_1", userId: TEST_USER_ID });
    writer.updateStoryStyle = async (storyId, style) => {
      capturedStyle = { storyId, style };
      return { sessionId: storyId, style: "igbo_highlife" };
    };

    const response = await app.inject({
      method: "POST",
      url: "/story/story_style_1/style",
      payload: { style: "igbo_highlife" },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(capturedStyle, { storyId: "story_style_1", style: "igbo_highlife" });
    assert.deepEqual(response.json(), {
      story_id: "story_style_1",
      style: "igbo_highlife",
    });
  });

  test("clears the persisted style when the client sends null", async () => {
    let capturedStyle = "sentinel";
    writer.getStoryState = async () => ({ id: "story_style_2", userId: TEST_USER_ID });
    writer.updateStoryStyle = async (storyId, style) => {
      capturedStyle = style;
      return { sessionId: storyId, style: null };
    };

    const response = await app.inject({
      method: "POST",
      url: "/story/story_style_2/style",
      payload: { style: null },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(capturedStyle, null);
    assert.deepEqual(response.json(), {
      story_id: "story_style_2",
      style: null,
    });
  });
});
