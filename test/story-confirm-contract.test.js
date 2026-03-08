require("dotenv/config");
const assert = require("node:assert/strict");
const { before, after, describe, test } = require("node:test");
const fastify = require("fastify");

const { registerStoryRoutes } = require("../src/routes/story");
const writer = require("../src/writer");

let app;
let originalConfirmStory;
let originalGetStoryState;

const TEST_USER_ID = "user_story_confirm_test";

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
  originalConfirmStory = writer.confirmStory;
  originalGetStoryState = writer.getStoryState;

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
  writer.confirmStory = originalConfirmStory;
  writer.getStoryState = originalGetStoryState;
  await app.close();
});

describe("POST /story/:story_id/confirm contract", () => {
  test("surfaces clarification when final revision notes need more detail", async () => {
    writer.getStoryState = async () => ({ id: "story_confirm_1", userId: TEST_USER_ID });
    writer.confirmStory = async () => {
      const err = new Error("Which part of the ending should change?");
      err.code = "STORY_REVISION_CLARIFY_REQUIRED";
      throw err;
    };

    const response = await app.inject({
      method: "POST",
      url: "/story/story_confirm_1/confirm",
      payload: {
        additional_notes: "Fix the ending.",
      },
    });

    assert.equal(response.statusCode, 409);
    const body = response.json();
    assert.equal(body.error, "STORY_REVISION_CLARIFY_REQUIRED");
    assert.equal(body.follow_up_question, "Which part of the ending should change?");
  });
});
