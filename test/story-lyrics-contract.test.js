require("dotenv/config");
const assert = require("node:assert/strict");
const { before, after, describe, test } = require("node:test");
const fastify = require("fastify");

const { registerStoryRoutes } = require("../src/routes/story");
const writer = require("../src/writer");

let app;
let originalGetStoryState;
let originalWriteSong;

const TEST_USER_ID = "user_story_lyrics_test";

function sendError(reply, statusCode, errorCode, message, details) {
  const payload = { error: errorCode, message };
  if (details && typeof details === "object") {
    Object.assign(payload, details);
  }
  reply.code(statusCode).send(payload);
}

const auditEntries = [];
const dbStub = {
  prepare() {
    return {
      run: async () => ({ changes: 1 }),
      get: async () => null,
      all: async () => [],
    };
  },
};

before(async () => {
  app = fastify({ logger: false });
  originalGetStoryState = writer.getStoryState;
  originalWriteSong = writer.writeSong;

  registerStoryRoutes(app, {
    db: dbStub,
    requireUserId: async () => TEST_USER_ID,
    sendError,
    consumeRateLimit: async () => ({ allowed: true, reset_at: null }),
    addAuditEntry: (entry) => auditEntries.push(entry),
    eventsService: null,
    getUserRiskLevel: async () => "low",
  });

  await app.ready();
});

after(async () => {
  writer.getStoryState = originalGetStoryState;
  writer.writeSong = originalWriteSong;
  await app.close();
});

describe("POST /story/:story_id/lyrics contract", () => {
  test("applies moderation before returning story-generated lyrics", async () => {
    auditEntries.length = 0;
    writer.getStoryState = async () => ({
      id: "story_lyrics_1",
      userId: TEST_USER_ID,
      recipientName: "Amaka",
      recipient_name: "Amaka",
      status: "confirmed",
      confirmedAt: "2026-03-08T00:00:00.000Z",
    });
    writer.writeSong = async () => ({
      lyrics: {
        title: "For Amaka",
        anchor_line: "This damn hard road made us stronger",
        sections: [
          { name: "Verse 1", lines: ["This damn hard road made us stronger"] },
        ],
      },
      quality_score: 0.81,
      arc_used: "gratitude",
      validation_issues: [],
    });

    const response = await app.inject({
      method: "POST",
      url: "/story/story_lyrics_1/lyrics",
    });

    assert.equal(response.statusCode, 422);
    const body = response.json();
    assert.equal(body.error, "GENERATION_BLOCKED");
    assert.equal(body.reason, "PROFANITY");
    assert.ok(auditEntries.some((entry) => entry.action === "story_lyrics_moderation_blocked"));
  });
});
