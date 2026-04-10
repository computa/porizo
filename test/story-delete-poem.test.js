/**
 * Story Delete & To-Poem Integration Tests
 *
 * Covers:
 * 1. DELETE /story/:id — removes session (cancel returns success, subsequent lookup returns 404)
 * 2. POST /story/:id/to-poem — creates poem and library entry from confirmed story
 *
 * The to-poem handler destructures generatePoemFromStory and evaluatePoemReadiness
 * at module load time, so we patch the module exports BEFORE requiring story.js
 * to ensure our stubs are captured by the closure.
 */

require("dotenv/config");
const assert = require("node:assert/strict");
const { before, after, describe, test } = require("node:test");
const fastify = require("fastify");
const path = require("node:path");

// --- Patch poem generation and readiness BEFORE story.js loads ---
// story.js destructures these at require time, so the patch must happen first.
const poemModule = require("../src/writer/poem");
const qualityModule = require("../src/writer/v3/quality");

// Store originals for later restoration
const originalGeneratePoemFromStory = poemModule.generatePoemFromStory;
const originalEvaluatePoemReadiness = qualityModule.evaluatePoemReadiness;

// Install controllable stubs
let poemStub = null;
let readinessStub = null;

poemModule.generatePoemFromStory = async (...args) => {
  if (poemStub) return poemStub(...args);
  return originalGeneratePoemFromStory(...args);
};

qualityModule.evaluatePoemReadiness = (...args) => {
  if (readinessStub) return readinessStub(...args);
  return originalEvaluatePoemReadiness(...args);
};

// Clear story module from cache so it re-requires with our patched poem/quality modules
const storyModulePath = require.resolve("../src/routes/story");
delete require.cache[storyModulePath];

const { registerStoryRoutes } = require("../src/routes/story");
const writer = require("../src/writer");

let app;
let originalGetStoryState;
let originalCancelStory;
let originalGetStoryContext;

const TEST_USER_ID = "user_story_delete_poem_test";

function sendError(reply, statusCode, errorCode, message, details) {
  const payload = { error: errorCode, message };
  if (details && typeof details === "object") {
    Object.assign(payload, details);
  }
  reply.code(statusCode).send(payload);
}

// Track executed queries so we can verify DB writes
const executed = [];
const dbStub = {
  prepare(sql) {
    return {
      run: async (...args) => {
        executed.push({ sql, args, type: "run" });
        // For poem_library_entries upsert: UPDATE returns 0 changes so INSERT branch runs
        if (sql.includes("UPDATE poem_library_entries")) {
          return { changes: 0 };
        }
        return { changes: 1 };
      },
      get: async (...args) => {
        executed.push({ sql, args, type: "get" });
        return null;
      },
      all: async () => [],
    };
  },
};

before(async () => {
  app = fastify({ logger: false });

  // Save originals
  originalGetStoryState = writer.getStoryState;
  originalCancelStory = writer.cancelStory;
  originalGetStoryContext = writer.getStoryContext;

  registerStoryRoutes(app, {
    db: dbStub,
    requireUserId: async () => TEST_USER_ID,
    sendError,
    consumeRateLimit: async () => ({ allowed: true, reset_at: null }),
    addAuditEntry: () => {},
    eventsService: null,
    getUserRiskLevel: async () => "low",
  });

  await app.ready();
});

after(async () => {
  // Restore originals
  writer.getStoryState = originalGetStoryState;
  writer.cancelStory = originalCancelStory;
  writer.getStoryContext = originalGetStoryContext;
  poemModule.generatePoemFromStory = originalGeneratePoemFromStory;
  qualityModule.evaluatePoemReadiness = originalEvaluatePoemReadiness;
  poemStub = null;
  readinessStub = null;
  await app.close();
});

describe("DELETE /story/:story_id", () => {
  test("removes session and subsequent GET returns 404", async () => {
    const storyId = "story_delete_test_1";
    let cancelCalled = false;

    // First, getStoryState returns a valid session for the DELETE handler
    writer.getStoryState = async (id) => {
      if (id === storyId && !cancelCalled) {
        return { id: storyId, userId: TEST_USER_ID };
      }
      // After cancel, simulate not found
      const err = new Error(`Session ${id} not found`);
      throw err;
    };

    writer.cancelStory = async (id) => {
      assert.equal(id, storyId, "cancelStory should be called with the correct story ID");
      cancelCalled = true;
    };

    // DELETE the story
    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/story/${storyId}`,
      headers: { "x-user-id": TEST_USER_ID },
    });

    assert.equal(deleteResponse.statusCode, 200, `Expected 200, got ${deleteResponse.statusCode}: ${deleteResponse.body}`);
    const deleteBody = deleteResponse.json();
    assert.equal(deleteBody.cancelled, true, "Should return cancelled: true");
    assert.ok(cancelCalled, "writer.cancelStory should have been called");

    // After deletion, attempting to GET the story context should fail.
    // The story routes expose GET /story/:id which calls getStoryState internally.
    // Since story is gone, verifyStoryOwnership returns 404.
    writer.getStoryContext = async () => {
      const err = new Error(`Session ${storyId} not found`);
      throw err;
    };

    // Use the continue endpoint as a proxy for "session still exists"
    // (any endpoint that calls verifyStoryOwnership will do)
    const getResponse = await app.inject({
      method: "POST",
      url: `/story/${storyId}/continue`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { answer: "test" },
    });

    assert.equal(getResponse.statusCode, 404, `Expected 404 after deletion, got ${getResponse.statusCode}: ${getResponse.body}`);
    assert.equal(getResponse.json().error, "STORY_NOT_FOUND");
  });

  test("returns success even for already-deleted session (idempotent)", async () => {
    const storyId = "story_delete_nonexistent";

    // Simulate session that doesn't exist
    writer.getStoryState = async () => {
      const err = new Error("Session not found");
      throw err;
    };

    writer.cancelStory = async () => {
      // No-op, session already gone
    };

    const response = await app.inject({
      method: "DELETE",
      url: `/story/${storyId}`,
      headers: { "x-user-id": TEST_USER_ID },
    });

    assert.equal(response.statusCode, 200, `Idempotent delete should return 200, got ${response.statusCode}: ${response.body}`);
    assert.equal(response.json().cancelled, true);
  });
});

describe("POST /story/:story_id/to-poem", () => {
  test("creates poem and library entry from confirmed story", async () => {
    const storyId = "story_poem_test_1";
    executed.length = 0;

    // Stub getStoryState for ownership verification
    writer.getStoryState = async () => ({
      id: storyId,
      userId: TEST_USER_ID,
    });

    // Stub getStoryContext with a complete, confirmed story
    writer.getStoryContext = async () => ({
      sessionId: storyId,
      engineVersion: "v3",
      recipientName: "Ada",
      occasion: "birthday",
      status: "confirmed",
      narrative: "Ada has always been a source of strength and wisdom for everyone around her.",
      primitives: {
        characters: ["Ada"],
        turning_point: "The day she decided to start over",
        setting: { place: "Lagos", time: "Last summer" },
      },
      atoms: {
        who: "Ada",
        turn: "She chose courage",
        where: "Lagos",
        when: "Summer 2025",
      },
      motifs: ["resilience", "warmth"],
      dials: { tone: "heartfelt", style: "free verse" },
    });

    // Stub evaluatePoemReadiness to report story is complete
    readinessStub = () => ({
      is_complete: true,
      gaps: [],
      suggested_question: null,
    });

    // Stub generatePoemFromStory to return a deterministic poem
    poemStub = async () => ({
      title: "For Ada",
      lines: [
        "In Lagos heat you found your way,",
        "A strength that grows with every day.",
        "Through turning points you chose to stay,",
        "And warm the hearts along the way.",
      ],
      provider: "test",
      model: "test-model",
    });

    const response = await app.inject({
      method: "POST",
      url: `/story/${storyId}/to-poem`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { tone: "heartfelt", style: "free verse" },
    });

    assert.equal(response.statusCode, 200, `Expected 200, got ${response.statusCode}: ${response.body}`);
    const body = response.json();

    // Verify response shape
    assert.ok(body.poem, "Response should contain poem object");
    assert.ok(body.poem.id, "Poem should have an ID");
    assert.equal(body.poem.recipient_name, "Ada");
    assert.equal(body.poem.occasion, "birthday");
    assert.equal(body.poem.tone, "heartfelt");
    assert.ok(Array.isArray(body.poem.verses), "Verses should be an array");
    assert.equal(body.poem.verses.length, 4, "Should have 4 verse lines");
    assert.equal(body.poem.status, "generated");
    assert.ok(body.poem.created_at, "Should have created_at");
    assert.equal(body.provider, "test");
    assert.equal(body.model, "test-model");

    // Verify poem INSERT was executed
    const poemInsert = executed.find(
      (entry) => entry.sql.includes("INSERT INTO poems") && entry.type === "run"
    );
    assert.ok(poemInsert, "Should have inserted a poem into the database");
    // Column order: id(0), user_id(1), title(2), recipient_name(3), occasion(4),
    //               tone(5), verses(6), message/provenance(7), status(8), created_at(9), updated_at(10)
    assert.equal(poemInsert.args[1], TEST_USER_ID, "Poem should belong to test user");
    assert.equal(poemInsert.args[2], "For Ada", "Poem title should match");
    assert.equal(poemInsert.args[3], "Ada", "Recipient name should match");
    assert.equal(poemInsert.args[4], "birthday", "Occasion should match");
    assert.equal(poemInsert.args[5], "heartfelt", "Tone should match");
    assert.equal(poemInsert.args[8], "generated", "Status should be generated");

    // Verify verses JSON was stored correctly
    const versesJson = poemInsert.args[6];
    const verses = JSON.parse(versesJson);
    assert.equal(verses.length, 4, "Should store 4 verse lines");

    // Verify the provenance JSON was stored in the message column
    const provenanceJson = poemInsert.args[7];
    const provenance = JSON.parse(provenanceJson);
    assert.equal(provenance.source, "story_v2");
    assert.equal(provenance.story_id, storyId);
    assert.equal(provenance.tone, "heartfelt");
    assert.equal(provenance.style, "free verse");

    // Verify poem library entry upsert was attempted
    // The upsert first tries UPDATE, then INSERT if no rows changed
    const libraryInsert = executed.find(
      (entry) => entry.sql.includes("INSERT INTO poem_library_entries") && entry.type === "run"
    );
    // Note: the UPDATE returns changes: 1 from our stub, so the INSERT branch
    // may not execute. Check that at least the UPDATE was attempted.
    const libraryUpdate = executed.find(
      (entry) => entry.sql.includes("UPDATE poem_library_entries") && entry.type === "run"
    );
    const libraryWrite = libraryInsert || libraryUpdate;
    assert.ok(libraryWrite, "Should have written a poem library entry");
  });

  test("rejects poem generation for unconfirmed story", async () => {
    const storyId = "story_poem_unconfirmed";

    writer.getStoryState = async () => ({
      id: storyId,
      userId: TEST_USER_ID,
    });

    writer.getStoryContext = async () => ({
      sessionId: storyId,
      engineVersion: "v3",
      recipientName: "Ben",
      occasion: "anniversary",
      status: "in_progress", // NOT confirmed
      narrative: "Some narrative",
      primitives: {},
      atoms: {},
    });

    const response = await app.inject({
      method: "POST",
      url: `/story/${storyId}/to-poem`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {},
    });

    assert.equal(response.statusCode, 400, `Expected 400, got ${response.statusCode}: ${response.body}`);
    assert.equal(response.json().error, "STORY_NOT_CONFIRMED");
  });

  test("poem readiness guidance uses story details instead of generic filler", () => {
    readinessStub = null;
    const readiness = qualityModule.evaluatePoemReadiness({
      recipientName: "Sarah",
      narrative:
        "Sarah planned a sunset picnic and brought handwritten notes from our friends. " +
        "It felt warm and thoughtful, but I haven't explained the moment that made it land.",
      atoms: {
        who: "Sarah",
        where: "the sunset picnic",
        when: "my birthday last year",
        turn: "",
      },
      primitives: {
        characters: ["Sarah"],
        setting: {
          place: "the sunset picnic",
          time: "my birthday last year",
        },
        turning_point: "",
      },
      facts: [
        { id: "f1", text: "Sarah planned a sunset picnic.", status: "active" },
        { id: "f2", text: "She brought handwritten notes from our friends.", status: "active" },
      ],
    });

    assert.equal(readiness.is_complete, false);
    assert.ok(
      readiness.suggested_question.includes("sunset picnic")
        || readiness.suggested_question.includes("handwritten notes"),
      `Expected contextual guidance, got: ${readiness.suggested_question}`
    );
    assert.notEqual(
      readiness.suggested_question,
      "Think of one specific scene: what did they do, say, or reveal that made this matter so much to you?"
    );
  });

  test("poem readiness guidance does not mistake occupations for locations", () => {
    const readiness = qualityModule.evaluatePoemReadiness({
      recipientName: "Sarah",
      narrative:
        "Sarah was a school teacher who inspired everyone, but I still have not explained the exact turning point.",
      facts: [
        { id: "f1", text: "Sarah was a school teacher who inspired everyone.", status: "active" },
        { id: "f2", text: "She gave me a note after graduation.", status: "active" },
      ],
    });

    assert.equal(readiness.is_complete, false);
    assert.ok(
      !readiness.suggested_question.includes("At Sarah was a school teacher who inspired everyone."),
      `Expected place extraction to avoid occupation text, got: ${readiness.suggested_question}`
    );
  });

  test("poem readiness guidance ignores occupation text even when atoms.where is polluted", () => {
    const readiness = qualityModule.evaluatePoemReadiness({
      recipientName: "Sarah",
      atoms: {
        where: "Sarah was a school teacher who inspired everyone.",
      },
      narrative:
        "Sarah was a school teacher who inspired everyone, but I still have not explained the exact turning point.",
      facts: [
        { id: "f1", text: "She gave me a note after graduation.", status: "active" },
      ],
    });

    assert.equal(readiness.is_complete, false);
    assert.ok(
      !readiness.suggested_question.includes("school teacher"),
      `Expected polluted where text to be ignored, got: ${readiness.suggested_question}`
    );
  });
});
