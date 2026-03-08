require("dotenv/config");
const assert = require("node:assert/strict");
const { before, after, describe, test } = require("node:test");
const fastify = require("fastify");

const { registerStoryRoutes } = require("../src/routes/story");
const writer = require("../src/writer");

let app;
let originalGetStoryState;
let originalReviseStory;

const TEST_USER_ID = "user_story_revise_test";

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
  originalReviseStory = writer.reviseStory;

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
  writer.reviseStory = originalReviseStory;
  await app.close();
});

describe("POST /story/:story_id/revise contract", () => {
  test("forwards revision requests through the explicit revise operation", async () => {
    const calls = [];
    writer.getStoryState = async () => ({ id: "story_revise_1", userId: TEST_USER_ID });
    writer.reviseStory = async (storyId, revisionRequest, options) => {
      calls.push({ storyId, revisionRequest, options });
      return {
        complete: true,
        action: "CONFIRM",
        story_summary: "Updated canonical story",
        narrative: "Updated canonical story",
        soul_of_story: "Updated canonical story",
        progress: 100,
        questions_asked: 5,
        ready_for_confirmation: true,
        narrative_version: 3,
        integration_delta: {
          added_facts: [],
          updated_facts: ["f_memory"],
          superseded_facts: [],
          conflicts_detected: [],
          conflicts_resolved: [],
          narrative_rewritten: true,
        },
        revision_request: {
          id: "rev_123",
          source: "review_edit",
          status: "applied",
        },
        draft_lifecycle: "review_ready",
        revision_history: [
          {
            id: "rev_123",
            version: 3,
            source: "review_edit",
            status: "applied",
          },
        ],
      };
    };

    const response = await app.inject({
      method: "POST",
      url: "/story/story_revise_1/revise",
      payload: {
        revision_request: "Change the ending so it says Awka trained him for the future.",
        source: "review_edit",
        operation: {
          type: "replace",
          target_type: "section",
          target_text: "The ending",
          replacement_text: "Awka trained him for the future.",
        },
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(calls, [
      {
        storyId: "story_revise_1",
        revisionRequest: "Change the ending so it says Awka trained him for the future.",
        options: {
          source: "review_edit",
          operation: {
            type: "replace",
            target_type: "section",
            target_text: "The ending",
            replacement_text: "Awka trained him for the future.",
          },
        },
      },
    ]);

    const body = response.json();
    assert.equal(body.complete, true);
    assert.equal(body.narrative_version, 3);
    assert.equal(body.integration_delta.narrative_rewritten, true);
    assert.equal(body.draft_lifecycle, "review_ready");
    assert.equal(body.revision_history[0].id, "rev_123");
  });
});
