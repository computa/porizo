/**
 * Story Start API Regression Tests
 *
 * Verifies long initial prompts are accepted at API boundary and
 * condensed to safe backend limits with explicit response metadata.
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
const TRUNCATED_MAX_LENGTH = 500;

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
  test("accepts >500 chars and returns truncation metadata", async () => {
    capturedAuditEntry = null;
    const longPrompt = "I remember your kindness in every small moment we shared. ".repeat(20);
    const expectedOriginalLength = longPrompt.trim().length;
    const expectedTruncatedPrompt = longPrompt.trim().slice(0, TRUNCATED_MAX_LENGTH);
    let capturedStartStoryPayload = null;

    writer.startStory = async (payload) => {
      capturedStartStoryPayload = payload;
      return {
        story_id: "story_test_truncation",
        first_question: "What moment stands out the most?",
        arc: "unified",
        arc_display_name: "Story Collection",
        recipient_name: payload.recipient_name,
        engine_version: "v2",
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

    assert.equal(body.initial_prompt_truncated, true);
    assert.equal(body.initial_prompt_original_length, expectedOriginalLength);
    assert.equal(body.initial_prompt_used_length, TRUNCATED_MAX_LENGTH);

    assert.ok(capturedStartStoryPayload, "writer.startStory payload should be captured");
    assert.equal(capturedStartStoryPayload.initial_prompt.length, TRUNCATED_MAX_LENGTH);
    assert.equal(capturedStartStoryPayload.initial_prompt, expectedTruncatedPrompt);

    assert.ok(capturedAuditEntry, "audit entry should be written");
    assert.equal(capturedAuditEntry.action, "story_started");
    assert.equal(capturedAuditEntry.metadata.initial_prompt_truncated, true);
    assert.equal(capturedAuditEntry.metadata.initial_prompt_original_length, expectedOriginalLength);
    assert.equal(capturedAuditEntry.metadata.initial_prompt_used_length, TRUNCATED_MAX_LENGTH);
  });
});
