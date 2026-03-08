require("dotenv/config");
const assert = require("node:assert/strict");
const { before, after, describe, test } = require("node:test");
const fastify = require("fastify");

const { registerStoryRoutes } = require("../src/routes/story");
const writer = require("../src/writer");

let app;
let originalAddMoreDetails;
let originalGetStoryState;

const TEST_USER_ID = "user_story_add_details_test";

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
  originalAddMoreDetails = writer.addMoreDetails;
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
  writer.addMoreDetails = originalAddMoreDetails;
  writer.getStoryState = originalGetStoryState;
  await app.close();
});

describe("POST /story/:story_id/add-details contract", () => {
  test("returns revision metadata for review edits", async () => {
    writer.getStoryState = async () => ({ id: "story_edit_1", userId: TEST_USER_ID });
    writer.addMoreDetails = async () => ({
      complete: true,
      story_summary: "Updated story summary",
      narrative: "Updated story summary",
      soul_of_story: "Updated story summary",
      progress: 98,
      readiness_score: 99,
      is_story_ready: true,
      narrative_version: 3,
      integration_delta: {
        added_facts: ["f_new_detail"],
        updated_facts: [],
        superseded_facts: ["f_old_detail"],
        conflicts_detected: [],
        conflicts_resolved: [],
        narrative_rewritten: true,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/story/story_edit_1/add-details",
      payload: { detail: "Actually it happened in Lagos, not Abuja." },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.complete, true);
    assert.equal(body.story_summary, "Updated story summary");
    assert.equal(body.narrative_version, 3);
    assert.deepEqual(body.integration_delta.superseded_facts, ["f_old_detail"]);
    assert.equal(body.integration_delta.narrative_rewritten, true);
  });
});
