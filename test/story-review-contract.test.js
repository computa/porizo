require("dotenv/config");
const assert = require("node:assert/strict");
const { before, after, describe, test } = require("node:test");
const fastify = require("fastify");

const { registerStoryRoutes } = require("../src/routes/story");
const writer = require("../src/writer");

let app;
let originalPrepareStoryReview;
let originalGetStoryState;

const TEST_USER_ID = "user_story_review_test";

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
  originalPrepareStoryReview = writer.prepareStoryReview;
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
  writer.prepareStoryReview = originalPrepareStoryReview;
  writer.getStoryState = originalGetStoryState;
  await app.close();
});

describe("POST /story/:story_id/review contract", () => {
  test("returns a canonical review-ready draft envelope", async () => {
    writer.getStoryState = async () => ({ id: "story_review_1", userId: TEST_USER_ID });
    writer.prepareStoryReview = async () => ({
      complete: true,
      story_summary: "Canonical review story",
      narrative: "Canonical review story",
      soul_of_story: "Canonical review story",
      progress: 100,
      questions_asked: 4,
      ready_for_confirmation: true,
      action: "CONFIRM",
      narrative_version: 2,
      integration_delta: {
        added_facts: [],
        updated_facts: ["f_context"],
        superseded_facts: [],
        conflicts_detected: [],
        conflicts_resolved: [],
        narrative_rewritten: true,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/story/story_review_1/review",
      payload: {},
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.complete, true);
    assert.equal(body.ready_for_confirmation, true);
    assert.equal(body.action, "CONFIRM");
    assert.equal(body.story_summary, "Canonical review story");
    assert.equal(body.narrative_version, 2);
    assert.equal(body.integration_delta.narrative_rewritten, true);
  });
});
