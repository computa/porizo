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
  test("returns 422 guidance envelope when confirmation needs one more detail", async () => {
    writer.getStoryState = async () => ({ id: "story_confirm_guidance", userId: TEST_USER_ID });
    writer.confirmStory = async () => {
      const err = new Error("Before I lock this in, tell me one line about how this changed them.");
      err.code = "STORY_NEEDS_INPUT";
      err.question = "Before I lock this in, tell me one line about how this changed them.";
      err.missingBlocks = ["transformation"];
      err.sessionVersion = 5;
      throw err;
    };

    const response = await app.inject({
      method: "POST",
      url: "/story/story_confirm_guidance/confirm",
      payload: {},
    });

    assert.equal(response.statusCode, 422);
    const body = response.json();
    assert.equal(body.error, "STORY_NEEDS_INPUT");
    assert.equal(body.message, "Before I lock this in, tell me one line about how this changed them.");
    assert.deepEqual(body.recovery, {
      question: "Before I lock this in, tell me one line about how this changed them.",
      suggestions: [],
      missing_blocks: ["transformation"],
      session_version: 5,
    });
  });

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

  test("passes force_confirm through to writer when the user explicitly proceeds anyway", async () => {
    writer.getStoryState = async () => ({ id: "story_confirm_force", userId: TEST_USER_ID });
    let receivedArgs = null;
    writer.confirmStory = async (_storyId, options) => {
      receivedArgs = options;
      return {
        confirmed: true,
        narrative: "Locked anyway",
        completionScore: 82,
        narrativeVersion: 3,
      };
    };

    const response = await app.inject({
      method: "POST",
      url: "/story/story_confirm_force/confirm",
      payload: {
        force_confirm: true,
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(receivedArgs, {
      additionalNotes: undefined,
      forceConfirm: true,
      targetContentType: undefined,
    });
  });

  test("returns 500 with retryable true for unexpected confirm failures without notes", async () => {
    writer.getStoryState = async () => ({ id: "story_confirm_2", userId: TEST_USER_ID });
    writer.confirmStory = async () => {
      throw new Error("boom");
    };

    const response = await app.inject({
      method: "POST",
      url: "/story/story_confirm_2/confirm",
      payload: {},
    });

    assert.equal(response.statusCode, 500);
    const body = response.json();
    assert.equal(body.error, "STORY_CONFIRM_FAILED");
    assert.equal(body.retryable, true);
    assert.match(body.message, /your story is saved/i);
    assert.match(body.message, /please try again/i);
  });

  test("returns 500 with retryable false for unexpected confirm failures after additional notes", async () => {
    writer.getStoryState = async () => ({ id: "story_confirm_3", userId: TEST_USER_ID });
    writer.confirmStory = async () => {
      throw new Error("boom");
    };

    const response = await app.inject({
      method: "POST",
      url: "/story/story_confirm_3/confirm",
      payload: {
        additional_notes: "Also mention the Awka years.",
      },
    });

    assert.equal(response.statusCode, 500);
    const body = response.json();
    assert.equal(body.error, "STORY_CONFIRM_FAILED");
    assert.equal(body.retryable, false);
    assert.match(body.message, /after applying your latest notes/i);
  });
});
