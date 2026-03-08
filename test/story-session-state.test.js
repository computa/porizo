require("dotenv/config");
const assert = require("node:assert/strict");
const { before, after, describe, test } = require("node:test");
const fastify = require("fastify");

const { registerStoryRoutes } = require("../src/routes/story");
const writer = require("../src/writer");

let app;
let originalGetStoryState;

const TEST_USER_ID = "user_story_session_state_test";

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
  await app.close();
});

describe("GET /story/:story_id session state", () => {
  test("returns canonical narrative revision metadata for resume", async () => {
    writer.getStoryState = async () => ({
      sessionId: "story_123",
      userId: TEST_USER_ID,
      engineVersion: "v3",
      recipientName: "Vincent",
      occasion: "birthday",
      narrative: "We met at a tiny cafe in Lagos after I missed my bus.",
      status: "ready_for_confirm",
      turnCount: 3,
      completionScore: 96,
      narrativeVersion: 2,
      draftLifecycle: "review_ready",
      integrationDelta: {
        added_facts: ["f_new_scene"],
        updated_facts: [],
        superseded_facts: ["f_old_scene"],
        conflicts_detected: [],
        conflicts_resolved: [],
        narrative_rewritten: true,
      },
      revisionHistory: [
        {
          id: "rev_1",
          version: 2,
          source: "review_edit",
          status: "applied",
        },
      ],
      draftDiff: {
        from_version: 1,
        to_version: 2,
        before_text: "Earlier draft",
        after_text: "We met at a tiny cafe in Lagos after I missed my bus.",
      },
      openConflicts: [
        {
          id: "conflict_1",
          summary: "f_old_scene conflicts with f_new_scene",
        },
      ],
      storyProvenance: {
        story_id: "story_123",
        engine_version: "v3",
        draft_lifecycle: "review_ready",
        narrative_version: 2,
      },
      conversation: [
        { role: "user", content: "We met in Lagos." },
        { role: "assistant", content: "What made that day unforgettable?" },
      ],
      currentQuestion: "What made that day unforgettable?",
      updatedAt: "2026-03-07T01:00:00.000Z",
      createdAt: "2026-03-07T00:00:00.000Z",
    });

    const response = await app.inject({
      method: "GET",
      url: "/story/story_123",
      headers: { "x-user-id": TEST_USER_ID },
    });

    assert.equal(response.statusCode, 200, `Expected 200, got ${response.statusCode}: ${response.body}`);

    const body = response.json();
    assert.equal(body.sessionId, "story_123");
    assert.equal(body.narrativeVersion, 2);
    assert.equal(body.draftLifecycle, "review_ready");
    assert.equal(body.integrationDelta.narrative_rewritten, true);
    assert.deepEqual(body.integrationDelta.superseded_facts, ["f_old_scene"]);
    assert.equal(body.revisionHistory[0].version, 2);
    assert.equal(body.draftDiff.to_version, 2);
    assert.equal(body.openConflicts[0].id, "conflict_1");
    assert.equal(body.storyProvenance.narrative_version, 2);
    assert.equal(body.currentQuestion, "What made that day unforgettable?");
  });
});
