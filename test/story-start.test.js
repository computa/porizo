/**
 * Story Start API Regression Tests
 *
 * Verifies long initial prompts are accepted at API boundary with
 * no truncation metadata and full payload pass-through.
 */

require("dotenv/config");
const assert = require("node:assert/strict");
const { before, after, describe, test } = require("node:test");
const fastify = require("fastify");

const { registerStoryRoutes } = require("../src/routes/story");
const writer = require("../src/writer");

let app;
let originalStartStory;
let capturedAuditEntry = null;

const TEST_USER_ID = "user_story_start_test";
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
  originalStartStory = writer.startStory;

  registerStoryRoutes(app, {
    db: dbStub,
    requireUserId: async () => TEST_USER_ID,
    sendError,
    consumeRateLimit: async () => ({ allowed: true, reset_at: null }),
    addAuditEntry: (entry) => {
      capturedAuditEntry = entry;
    },
    eventsService: null,
  });

  await app.ready();
});

after(async () => {
  writer.startStory = originalStartStory;
  await app.close();
});

describe("POST /story/start", () => {
  test("uses custom occasion and nil style when those fields are omitted", async () => {
    let capturedStartStoryPayload = null;

    writer.startStory = async (payload) => {
      capturedStartStoryPayload = payload;
      return {
        story_id: "story_test_defaults",
        first_question: "What stands out first?",
        complete: false,
        ready_for_confirmation: false,
        arc: "unified",
        arc_display_name: "Story Collection",
        recipient_name: payload.recipient_name,
        engine_version: "v3",
        suggestions: [],
      };
    };

    const response = await app.inject({
      method: "POST",
      url: "/story/start",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        initial_prompt: "A memory",
        recipient_name: "Chioma",
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.ok(capturedStartStoryPayload, "writer.startStory payload should be captured");
    assert.equal(capturedStartStoryPayload.occasion, "custom");
    assert.equal(capturedStartStoryPayload.style, null);
  });

  test("accepts long prompts without truncation", async () => {
    capturedAuditEntry = null;
    const longPrompt = "I remember your kindness in every small moment we shared. ".repeat(20);
    const expectedOriginalLength = longPrompt.trim().length;
    let capturedStartStoryPayload = null;

    writer.startStory = async (payload) => {
      capturedStartStoryPayload = payload;
      return {
        story_id: "story_test_truncation",
        first_question: "What moment stands out the most?",
        complete: false,
        ready_for_confirmation: false,
        arc: "unified",
        arc_display_name: "Story Collection",
        recipient_name: payload.recipient_name,
        engine_version: "v3",
        suggestions: [],
      };
    };

    const response = await app.inject({
      method: "POST",
      url: "/story/start",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        initial_prompt: longPrompt,
        recipient_name: "Mom",
        occasion: "birthday",
        style: "pop",
      },
    });

    assert.equal(
      response.statusCode,
      200,
      `Expected 200 for long prompt, got ${response.statusCode}: ${response.body}`
    );

    const body = response.json();

    assert.equal(body.initial_prompt_truncated, false);
    assert.equal(body.initial_prompt_original_length, expectedOriginalLength);
    assert.equal(body.initial_prompt_used_length, expectedOriginalLength);

    assert.ok(capturedStartStoryPayload, "writer.startStory payload should be captured");
    assert.equal(capturedStartStoryPayload.initial_prompt.length, expectedOriginalLength);
    assert.equal(capturedStartStoryPayload.initial_prompt, longPrompt.trim());
    assert.equal(capturedStartStoryPayload.engine_version, "v3");

    assert.ok(capturedAuditEntry, "audit entry should be written");
    assert.equal(capturedAuditEntry.action, "story_started");
    assert.equal(capturedAuditEntry.metadata.initial_prompt_truncated, false);
    assert.equal(capturedAuditEntry.metadata.initial_prompt_original_length, expectedOriginalLength);
    assert.equal(capturedAuditEntry.metadata.initial_prompt_used_length, expectedOriginalLength);
    assert.equal(capturedAuditEntry.metadata.engine_version, "v3");
  });

  test("passes story suggestions through the API response", async () => {
    writer.startStory = async (payload) => ({
      story_id: "story_test_suggestions",
      first_question: "What moment stands out the most?",
      complete: false,
      ready_for_confirmation: false,
      arc: "unified",
      arc_display_name: "Story Collection",
      recipient_name: payload.recipient_name,
      engine_version: "v3",
      suggestions: ["When they arrived", "That one conversation", "The moment it changed"],
    });

    const response = await app.inject({
      method: "POST",
      url: "/story/start",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        initial_prompt: "A memory",
        recipient_name: "Mum",
        occasion: "birthday",
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().suggestions, [
      "When they arrived",
      "That one conversation",
      "The moment it changed",
    ]);
  });

  test("passes primary gap element metadata through start response readiness", async () => {
    writer.startStory = async (payload) => ({
      story_id: "story_test_readiness",
      first_question: "What feeling stayed with you most?",
      complete: false,
      ready_for_confirmation: false,
      arc: "unified",
      arc_display_name: "Story Collection",
      recipient_name: payload.recipient_name,
      engine_version: "v3",
      suggestions: ["Grateful beyond words", "Like time stopped", "I wanted them to feel seen"],
      readiness: {
        score: 0.54,
        percent: 54,
        is_ready: false,
        is_user_overridable: false,
        story_mode: "default",
        profile: "incomplete",
        recommended_next_action: "clarify",
        decision_source: "deterministic_gap",
        primary_gap: {
          slot: "ending_feel",
          state: "weak",
          reason: "The emotional landing is still thin.",
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
      url: "/story/start",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        initial_prompt: "A memory",
        recipient_name: "Mum",
        occasion: "birthday",
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.readiness?.primary_gap?.slot, "ending_feel");
    assert.equal(body.readiness?.primary_gap?.element_id, "feeling");
    assert.equal(body.readiness?.primary_gap?.element_display_name, "The Feeling");
  });

  test("rejects explicit v2 engine override", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/story/start",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        initial_prompt: "A memory",
        recipient_name: "Dad",
        occasion: "birthday",
        style: "pop",
        engine_version: "v2",
      },
    });

    assert.equal(response.statusCode, 400, `Expected 400, got ${response.statusCode}: ${response.body}`);
    const body = response.json();
    assert.equal(body.error, "STORY_ENGINE_UNSUPPORTED");
    assert.equal(body.requested_engine_version, "v2");
    assert.deepEqual(body.supported_engine_versions, ["v3"]);
  });
});
