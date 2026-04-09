require("dotenv/config");
const assert = require("node:assert/strict");
const { before, after, describe, test } = require("node:test");
const fastify = require("fastify");
const multipart = require("@fastify/multipart");

const { registerStoryRoutes } = require("../src/routes/story");
const writer = require("../src/writer");

let app;
let originalGetStoryState;
let originalGetStoryContext;

const TEST_USER_ID = "user_billing_test";

function sendError(reply, statusCode, errorCode, message, details) {
  const payload = { error: errorCode, message };
  if (details && typeof details === "object") {
    Object.assign(payload, details);
  }
  reply.code(statusCode).send(payload);
}

// Track consumed rate limit calls and allow controlling behavior
let rateLimitBehavior = { allowed: true, reset_at: null };

function consumeRateLimit(_userId, _action, _limit, _window) {
  return Promise.resolve(rateLimitBehavior);
}

// Track subscription manager calls
let poemsRemaining = 5;
let spendPoemCalls = [];
let activeGiftReservation = null;
const subscriptionManager = {
  getEntitlements: async (_userId) => ({
    poemsRemaining,
    songsRemaining: 10,
  }),
  spendPoem: async (userId, poemId) => {
    spendPoemCalls.push({ userId, poemId });
    if (poemsRemaining <= 0) {
      const err = new Error("Insufficient poems remaining");
      err.code = "INSUFFICIENT_POEMS";
      throw err;
    }
    poemsRemaining -= 1;
    return { newBalance: poemsRemaining };
  },
};

const dbStub = {
  prepare(sql) {
    return {
      run: async (...args) => {
        if (sql.includes("UPDATE track_library_entries")) {
          return { changes: 0 };
        }
        if (sql.includes("UPDATE poem_library_entries")) {
          return { changes: 0 };
        }
        return { changes: 1 };
      },
      get: async (...args) => {
        if (sql.includes("SELECT * FROM gift_reservations WHERE id = ?")) {
          return activeGiftReservation;
        }
        if (sql.includes("SELECT id FROM tracks WHERE gift_reservation_id = ?")) {
          return null;
        }
        if (sql.includes("SELECT id FROM poems WHERE gift_reservation_id = ?")) {
          return null;
        }
        if (sql.includes("SELECT id FROM voice_profiles")) {
          return { id: "voice_profile_1" };
        }
        if (sql.includes("feature_flags")) {
          return { value: "true" };
        }
        return null;
      },
      all: async () => [],
    };
  },
};

function makeConfirmedStoryState(storyId) {
  return { id: storyId, userId: TEST_USER_ID };
}

function makeConfirmedStoryContext(storyId) {
  return {
    sessionId: storyId,
    engineVersion: "v3",
    recipientName: "TestRecipient",
    occasion: "birthday",
    style: "pop",
    eventType: "celebration",
    initialPrompt: "A test story prompt.",
    facts: [{ id: "f1", text: "Fact one." }],
    motifs: ["test motif"],
    narrative: "A narrative about the recipient.",
    atoms: { who: "TestRecipient", turn: "The big surprise", where: "Lagos", when: "last summer" },
    primitives: { characters: ["TestRecipient"], turning_point: "The big surprise", setting: { place: "Lagos", time: "last summer" } },
    song_map: { hook: "Test hook", verse1: ["Line 1"], chorus: ["Chorus"], verse2: ["Line 2"], bridge: ["Bridge"], key_lines: ["Test hook"] },
    summary: { text: "Test summary.", factCount: 1, beatsUncovered: 0 },
    status: "confirmed",
    narrativeVersion: 1,
    dials: { tone: "heartfelt", style: "free verse" },
  };
}

// Stub the poem generator to avoid real LLM calls
let originalGeneratePoemFromStory;

before(async () => {
  app = fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  originalGetStoryState = writer.getStoryState;
  originalGetStoryContext = writer.getStoryContext;

  // Stub the poem generator module
  const poemModule = require("../src/writer/poem");
  originalGeneratePoemFromStory = poemModule.generatePoemFromStory;
  poemModule.generatePoemFromStory = async () => ({
    title: "Test Poem",
    lines: ["Line one", "Line two", "Line three"],
    provider: "test",
    model: "test-model",
  });

  registerStoryRoutes(app, {
    db: dbStub,
    requireUserId: async () => TEST_USER_ID,
    sendError,
    consumeRateLimit,
    addAuditEntry: () => {},
    eventsService: null,
    getUserRiskLevel: async () => "low",
    subscriptionManager,
  });

  await app.ready();
});

after(async () => {
  writer.getStoryState = originalGetStoryState;
  writer.getStoryContext = originalGetStoryContext;
  const poemModule = require("../src/writer/poem");
  poemModule.generatePoemFromStory = originalGeneratePoemFromStory;
  await app.close();
});

// ─── C1: /to-poem credit checks ─────────────────────────────────────────────

describe("POST /story/:id/to-poem — poem credit checks (C1)", () => {
  test("returns 402 when poem credits are 0", async () => {
    poemsRemaining = 0;
    activeGiftReservation = null;
    rateLimitBehavior = { allowed: true, reset_at: null };

    writer.getStoryState = async () => makeConfirmedStoryState("story_poem_1");
    writer.getStoryContext = async () => makeConfirmedStoryContext("story_poem_1");

    const response = await app.inject({
      method: "POST",
      url: "/story/story_poem_1/to-poem",
      payload: {},
    });

    assert.equal(response.statusCode, 402);
    const body = response.json();
    assert.equal(body.error, "INSUFFICIENT_POEM_CREDITS");
  });

  test("succeeds and spends credit when poems are available", async () => {
    poemsRemaining = 3;
    spendPoemCalls = [];
    activeGiftReservation = null;
    rateLimitBehavior = { allowed: true, reset_at: null };

    writer.getStoryState = async () => makeConfirmedStoryState("story_poem_2");
    writer.getStoryContext = async () => makeConfirmedStoryContext("story_poem_2");

    const response = await app.inject({
      method: "POST",
      url: "/story/story_poem_2/to-poem",
      payload: {},
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.ok(body.poem);
    assert.equal(body.poem.status, "generated");

    // Verify spendPoem was called
    assert.equal(spendPoemCalls.length, 1);
    assert.equal(spendPoemCalls[0].userId, TEST_USER_ID);
  });

  test("gift-funded poem creation bypasses subscription poem spend", async () => {
    poemsRemaining = 0;
    spendPoemCalls = [];
    activeGiftReservation = {
      id: "gres_poem_funded",
      user_id: TEST_USER_ID,
      status: "reserved",
      content_type: null,
      gift_order_id: null,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
    rateLimitBehavior = { allowed: true, reset_at: null };

    writer.getStoryState = async () => makeConfirmedStoryState("story_poem_gift");
    writer.getStoryContext = async () => makeConfirmedStoryContext("story_poem_gift");

    const response = await app.inject({
      method: "POST",
      url: "/story/story_poem_gift/to-poem",
      payload: { gift_reservation_id: activeGiftReservation.id },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.ok(body.poem);
    assert.equal(spendPoemCalls.length, 0);
    activeGiftReservation = null;
  });
});

// ─── H3: /to-track rate limiting ────────────────────────────────────────────

describe("POST /story/:id/to-track — rate limiting (H3)", () => {
  test("returns 429 when rate limit is exhausted", async () => {
    rateLimitBehavior = { allowed: false, reset_at: "2026-01-01T01:00:00Z" };

    writer.getStoryState = async () => makeConfirmedStoryState("story_track_rl");
    writer.getStoryContext = async () => makeConfirmedStoryContext("story_track_rl");

    const response = await app.inject({
      method: "POST",
      url: "/story/story_track_rl/to-track",
      payload: {},
    });

    assert.equal(response.statusCode, 429);
    const body = response.json();
    assert.equal(body.error, "RATE_LIMITED");
    assert.equal(body.retry_after, "2026-01-01T01:00:00Z");
  });

  test("succeeds when rate limit allows", async () => {
    rateLimitBehavior = { allowed: true, reset_at: null };

    writer.getStoryState = async () => makeConfirmedStoryState("story_track_ok");
    writer.getStoryContext = async () => makeConfirmedStoryContext("story_track_ok");

    const response = await app.inject({
      method: "POST",
      url: "/story/story_track_ok/to-track",
      payload: {},
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.ok(body.track_id);
    assert.ok(body.version_id);
  });
});

// ─── H7: /v2/audio/transcribe rate limiting ─────────────────────────────────

describe("POST /v2/audio/transcribe — rate limiting (H7)", () => {
  test("returns 429 when audio transcription rate limit is exhausted", async () => {
    rateLimitBehavior = { allowed: false, reset_at: "2026-01-01T01:00:00Z" };

    const response = await app.inject({
      method: "POST",
      url: "/v2/audio/transcribe",
      headers: { "content-type": "multipart/form-data; boundary=----test" },
      payload: "------test\r\nContent-Disposition: form-data; name=\"file\"; filename=\"test.m4a\"\r\nContent-Type: audio/m4a\r\n\r\nfakedata\r\n------test--\r\n",
    });

    assert.equal(response.statusCode, 429);
    const body = response.json();
    assert.equal(body.error, "RATE_LIMITED");
  });
});
