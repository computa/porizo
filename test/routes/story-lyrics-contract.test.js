require("dotenv/config");
const assert = require("node:assert/strict");
const { before, after, describe, test } = require("node:test");
const fastify = require("fastify");

const { registerStoryRoutes } = require("../../src/routes/story");
const writer = require("../../src/writer");

let app;
let originalGetStoryState;
let originalWriteSong;
let originalAssertSongReadiness;

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
  originalAssertSongReadiness = writer.assertSongReadiness;
  // Default no-op so individual tests don't need to stub the new gate unless
  // they specifically want to exercise it.
  writer.assertSongReadiness = async () => {};

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
  writer.assertSongReadiness = originalAssertSongReadiness;
  await app.close();
});

describe("POST /story/:story_id/lyrics contract", () => {
  test("rejects with 422 STORY_NEEDS_INPUT when downstream readiness gate fails", async () => {
    auditEntries.length = 0;
    writer.getStoryState = async () => ({
      id: "story_lyrics_bypass",
      userId: TEST_USER_ID,
      recipientName: "Chioma",
      recipient_name: "Chioma",
      status: "confirmed",
    });
    let writeSongCalled = false;
    writer.writeSong = async () => {
      writeSongCalled = true;
      return { lyrics: { title: "should not reach here", sections: [] }, quality_score: 0.9, arc_used: "x" };
    };
    writer.assertSongReadiness = async () => {
      const err = new Error("Before I make this a song, give me one more concrete detail.");
      err.code = "STORY_NEEDS_INPUT";
      err.question = "Before I make this a song, give me one more concrete detail.";
      err.suggestions = ["Add the concrete moment in one sentence."];
      err.missingBlocks = ["missing_required_story_detail"];
      err.songReadiness = {
        ready: false,
        status: "needs_input",
        blockers: [{ code: "missing_required_story_detail", id: "leak_id", detail: "leak_text", message: "missing detail" }],
        warnings: [],
        required_detail_count: 4,
        canonical_required_detail_count: 4,
      };
      throw err;
    };

    const response = await app.inject({
      method: "POST",
      url: "/story/story_lyrics_bypass/lyrics",
    });

    assert.equal(response.statusCode, 422);
    const body = response.json();
    assert.equal(body.error, "STORY_NEEDS_INPUT");
    assert.equal(writeSongCalled, false, "downstream gate must short-circuit before writeSong");
    assert.equal(body.recovery.question, "Before I make this a song, give me one more concrete detail.");
    assert.deepEqual(body.recovery.missing_blocks, ["missing_required_story_detail"]);
    // Sanitized payload — no leak of detail IDs or text.
    assert.equal(body.song_readiness.ready, false);
    for (const blocker of body.song_readiness.blockers) {
      assert.equal(blocker.id, undefined);
      assert.equal(blocker.detail, undefined);
    }
    // Reset for next tests
    writer.assertSongReadiness = async () => {};
  });

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
