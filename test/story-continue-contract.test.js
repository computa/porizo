require("dotenv/config");
const assert = require("node:assert/strict");
const { before, after, describe, test } = require("node:test");
const fastify = require("fastify");

const { registerStoryRoutes } = require("../src/routes/story");
const writer = require("../src/writer");

let app;
let originalContinueStory;
let originalGetStoryState;

const TEST_USER_ID = "user_story_continue_test";

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
  originalContinueStory = writer.continueStory;
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
  writer.continueStory = originalContinueStory;
  writer.getStoryState = originalGetStoryState;
  await app.close();
});

describe("POST /story/:story_id/continue contract", () => {
  test("returns full envelope when writer returns soft error", async () => {
    writer.getStoryState = async () => ({ id: "story_1", userId: TEST_USER_ID });
    writer.continueStory = async () => ({
      error: "Reasoner fallback in progress",
      current_question: "Can you share one specific scene?",
      progress: 95,
    });

    const response = await app.inject({
      method: "POST",
      url: "/story/story_1/continue",
      payload: { answer: "Here is more context." },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.complete, false);
    assert.equal(body.ready_for_confirmation, false);
    assert.equal(body.action, "ASK");
    assert.equal(body.next_question, "Can you share one specific scene?");
    assert.equal(body.error, "Reasoner fallback in progress");
  });

  test("returns confirm action when story is complete", async () => {
    writer.getStoryState = async () => ({ id: "story_2", userId: TEST_USER_ID });
    writer.continueStory = async () => ({
      complete: true,
      story_summary: "Story summary",
      narrative: "Story summary",
      soul_of_story: "Story summary",
      progress: 95,
      readiness: {
        score: 0.96,
        percent: 96,
        is_ready: true,
        is_user_overridable: false,
        story_mode: "default",
        profile: "dramatic",
        recommended_next_action: "confirm",
        decision_source: "llm",
        primary_gap: null,
        missing_slots: [],
        weak_slots: [],
        blocked_slots: [],
        blocked_elements: [],
        element_scores: [],
        why: "The draft covers the core story beats well enough to move into review.",
      },
      readiness_score: 96,
      is_story_ready: true,
    });

    const response = await app.inject({
      method: "POST",
      url: "/story/story_2/continue",
      payload: { answer: "One more thing." },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.complete, true);
    assert.equal(body.ready_for_confirmation, true);
    assert.equal(body.action, "CONFIRM");
    assert.equal(body.story_summary, "Story summary");
    assert.equal(body.readiness?.percent, 96);
    assert.equal(body.readiness?.recommended_next_action, "confirm");
  });

  test("passes suggestions through when story continues", async () => {
    writer.getStoryState = async () => ({ id: "story_3", userId: TEST_USER_ID });
    writer.continueStory = async () => ({
      complete: false,
      next_question: "What changed in that moment?",
      narrative: "Story draft",
      progress: 52,
      questions_asked: 3,
      action: "ASK",
      suggestions: ["Then everything shifted", "That was the turning point", "I realized it right there"],
    });

    const response = await app.inject({
      method: "POST",
      url: "/story/story_3/continue",
      payload: { answer: "More details." },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().suggestions, [
      "Then everything shifted",
      "That was the turning point",
      "I realized it right there",
    ]);
  });

  test("passes primary gap element metadata through readiness", async () => {
    writer.getStoryState = async () => ({ id: "story_4", userId: TEST_USER_ID });
    writer.continueStory = async () => ({
      complete: false,
      next_question: "How did that moment leave you feeling?",
      narrative: "Story draft",
      progress: 61,
      questions_asked: 4,
      action: "ASK",
      readiness: {
        score: 0.61,
        percent: 61,
        is_ready: false,
        is_user_overridable: false,
        story_mode: "default",
        profile: "incomplete",
        recommended_next_action: "clarify",
        decision_source: "deterministic_gap",
        primary_gap: {
          slot: "ending_feel",
          state: "weak",
          reason: "The emotional ending still needs specificity.",
          element_id: "feeling",
          element_display_name: "The Feeling",
        },
        missing_slots: [],
        weak_slots: ["ending_feel"],
        blocked_slots: [],
        blocked_elements: ["feeling"],
        element_scores: [],
        why: "The strongest next improvement is around ending feel.",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/story/story_4/continue",
      payload: { answer: "More detail." },
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.readiness?.primary_gap?.slot, "ending_feel");
    assert.equal(body.readiness?.primary_gap?.element_id, "feeling");
    assert.equal(body.readiness?.primary_gap?.element_display_name, "The Feeling");
  });
});
