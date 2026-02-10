/**
 * V2 Engine API Integration Tests
 *
 * Tests the version dispatch and API compatibility layer.
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");

// Mock repository for testing
function createMockRepository() {
  const sessions = new Map();

  return {
    createSession(userId, params) {
      const id = `test-session-${Date.now()}`;
      const session = {
        id,
        userId,
        status: params.status || "active",
        arc: params.arc,
        occasion: params.occasion,
        recipientName: params.recipientName,
        style: params.style,
        initialPrompt: params.initialPrompt,
        engineVersion: params.engineVersion,
        v2State: params.v2State,
      };
      sessions.set(id, session);
      return session;
    },
    getSession(sessionId) {
      return sessions.get(sessionId) || null;
    },
    updateSession(sessionId, updates) {
      const session = sessions.get(sessionId);
      if (session) {
        Object.assign(session, updates);
      }
    },
    _sessions: sessions,
  };
}

describe("Writer Module V2 Integration", () => {
  const writer = require("../../../src/writer");

  beforeEach(() => {
    // Reset module state
    delete require.cache[require.resolve("../../../src/writer")];
    delete require.cache[require.resolve("../../../src/writer/v2")];
  });

  describe("Version Dispatch", () => {
    // NOTE: V1 engine was removed. V2 is now the only engine.
    // This integration test verifies V2 engine behavior.

    it("should use V2 engine by default", async () => {
      const freshWriter = require("../../../src/writer");
      const mockRepo = createMockRepository();
      freshWriter.initWithRepository(mockRepo);

      const result = await freshWriter.startStory({
        initial_prompt: "Birthday song for dad",
        occasion: "birthday",
        recipient_name: "Dad",
        user_id: "test-user",
        engine_version: "v2",
      });

      assert.ok(result.story_id, "Should return story_id");
      assert.ok(result.first_question, "Should return first_question");
      assert.strictEqual(result.engine_version, "v2", "Should use V2");
    });

    it("should support v3 runtime label with the v2 implementation", async () => {
      const freshWriter = require("../../../src/writer");
      const mockRepo = createMockRepository();
      freshWriter.initWithRepository(mockRepo);

      const result = await freshWriter.startStory({
        initial_prompt: "Birthday song for dad",
        occasion: "birthday",
        recipient_name: "Dad",
        user_id: "test-user",
        engine_version: "v3",
      });

      assert.ok(result.story_id, "Should return story_id");
      assert.strictEqual(result.engine_version, "v3", "Should preserve requested engine version");

      const continueResult = await freshWriter.continueStory({
        story_id: result.story_id,
        answer: "He taught me to stand tall",
      });
      assert.strictEqual(continueResult.engine_version, "v3", "Continue should preserve session engine version");
    });

    it("should route continue calls to correct engine", async () => {
      const freshWriter = require("../../../src/writer");
      const mockRepo = createMockRepository();
      freshWriter.initWithRepository(mockRepo);

      // Start a V2 session
      const startResult = await freshWriter.startStory({
        initial_prompt: "Test story",
        occasion: "birthday",
        recipient_name: "Test",
        user_id: "test-user",
        engine_version: "v2",
      });

      // Continue should use V2
      const continueResult = await freshWriter.continueStory({
        story_id: startResult.story_id,
        answer: "He loves fishing and taught me to fish",
      });

      assert.ok(continueResult, "Should return result");
      assert.strictEqual(continueResult.engine_version, "v2", "Should use V2");
      assert.ok(typeof continueResult.progress === "number", "Should have progress");
    });

    it("should route getStorySummary to correct engine", async () => {
      const freshWriter = require("../../../src/writer");
      const mockRepo = createMockRepository();
      freshWriter.initWithRepository(mockRepo);

      // Start a V2 session
      const startResult = await freshWriter.startStory({
        initial_prompt: "Test story",
        occasion: "birthday",
        recipient_name: "Sarah",
        user_id: "test-user",
        engine_version: "v2",
      });

      // Get summary should use V2
      const summary = await freshWriter.getStorySummary(startResult.story_id);

      assert.ok(summary, "Should return summary");
      assert.strictEqual(summary.engine_version, "v2", "Should use V2");
      assert.strictEqual(summary.story_id, startResult.story_id);
    });

    it("should persist selected style in story context", async () => {
      const freshWriter = require("../../../src/writer");
      const mockRepo = createMockRepository();
      freshWriter.initWithRepository(mockRepo);

      const startResult = await freshWriter.startStory({
        initial_prompt: "Song for my brother",
        occasion: "celebration",
        recipient_name: "Brother",
        style: "ogene",
        user_id: "test-user",
        engine_version: "v2",
      });

      const context = await freshWriter.getStoryContext(startResult.story_id);
      assert.strictEqual(context.style, "ogene");
    });

    it("should route confirmStory to correct engine", async () => {
      const freshWriter = require("../../../src/writer");
      const mockRepo = createMockRepository();
      freshWriter.initWithRepository(mockRepo);

      // Start a V2 session
      const startResult = await freshWriter.startStory({
        initial_prompt: "Test story",
        occasion: "birthday",
        recipient_name: "Mom",
        user_id: "test-user",
        engine_version: "v2",
      });

      // Confirm should use V2
      const confirmed = await freshWriter.confirmStory(startResult.story_id);

      assert.ok(confirmed, "Should return result");
      assert.strictEqual(confirmed.engine_version, "v2", "Should use V2");
      assert.strictEqual(confirmed.confirmed, true, "Should be confirmed");
    });

    it("should return story state for resume", async () => {
      const freshWriter = require("../../../src/writer");
      const mockRepo = createMockRepository();
      freshWriter.initWithRepository(mockRepo);

      const startResult = await freshWriter.startStory({
        initial_prompt: "Test story",
        occasion: "birthday",
        recipient_name: "Alex",
        user_id: "test-user",
        engine_version: "v2",
      });

      const state = await freshWriter.getStoryState(startResult.story_id);

      assert.strictEqual(state.engineVersion, "v2");
      assert.ok(Array.isArray(state.conversation), "Should include conversation history");
    });
  });

  describe("API Response Format Compatibility", () => {
    it("should return V1-compatible response from V2 startStory", async () => {
      const freshWriter = require("../../../src/writer");
      const mockRepo = createMockRepository();
      freshWriter.initWithRepository(mockRepo);

      const result = await freshWriter.startStory({
        initial_prompt: "Song for my daughter",
        occasion: "birthday",
        recipient_name: "Sarah",
        user_id: "test-user",
        engine_version: "v2",
      });

      // Check V1-compatible fields exist
      assert.ok(result.story_id, "Should have story_id");
      assert.ok(result.first_question, "Should have first_question");
      assert.ok(result.arc, "Should have arc");
      assert.ok(result.recipient_name, "Should have recipient_name");
      assert.ok(Array.isArray(result.missing_slots), "Should include missing_slots metadata");
      assert.ok(Array.isArray(result.weak_slots), "Should include weak_slots metadata");
      assert.strictEqual(typeof result.readiness_score, "number");
      assert.strictEqual(typeof result.is_story_ready, "boolean");

      // V2-specific fields
      assert.strictEqual(result.engine_version, "v2");
    });

    it("should return V1-compatible response from V2 continueStory", async () => {
      const freshWriter = require("../../../src/writer");
      const mockRepo = createMockRepository();
      freshWriter.initWithRepository(mockRepo);

      const startResult = await freshWriter.startStory({
        initial_prompt: "Test",
        occasion: "birthday",
        recipient_name: "Test",
        user_id: "test-user",
        engine_version: "v2",
      });

      const result = await freshWriter.continueStory({
        story_id: startResult.story_id,
        answer: "She loves playing with blocks",
      });

      // Check V1-compatible fields
      assert.ok(typeof result.complete === "boolean", "Should have complete flag");
      assert.ok(typeof result.progress === "number", "Should have progress");
      assert.ok(Array.isArray(result.missing_slots), "Should include missing_slots metadata");
      assert.ok(Array.isArray(result.weak_slots), "Should include weak_slots metadata");
      assert.strictEqual(typeof result.readiness_score, "number");
      assert.strictEqual(typeof result.is_story_ready, "boolean");

      // Either next_question or story_summary depending on completion
      if (result.complete) {
        assert.ok(result.story_summary, "Complete should have story_summary");
      } else {
        assert.ok(result.next_question, "Incomplete should have next_question");
      }
    });
  });

  describe("Module Status", () => {
    it("should report V2 engine availability in status", () => {
      const freshWriter = require("../../../src/writer");
      const status = freshWriter.getStatus();

      assert.ok(status.available, "Should be available");
      assert.strictEqual(status.version, "2.0.0", "Should be version 2.0.0");
      assert.ok(status.features.includes("unified_reasoning_engine"), "Should list unified reasoning engine");
    });
  });
});

describe("V2 Full Conversation Flow via Writer API", () => {
  const writer = require("../../../src/writer");

  it("should complete full story flow with V2 engine", async () => {
    const mockRepo = createMockRepository();
    writer.initWithRepository(mockRepo);

    // Step 1: Start story
    const start = await writer.startStory({
      initial_prompt: "Song for my dad's birthday",
      occasion: "birthday",
      recipient_name: "Dad",
      user_id: "integration-user",
      engine_version: "v2",
    });

    assert.ok(start.story_id);
    assert.strictEqual(start.engine_version, "v2");

    // Step 2: Answer questions
    let lastResult = start;
    const answers = [
      "He taught me to ride a bike in the backyard",
      "He never gave up on me even when I struggled",
      "He means the world to me",
    ];

    for (const answer of answers) {
      const result = await writer.continueStory({
        story_id: start.story_id,
        answer,
      });
      lastResult = result;

      // V2 should track progress
      assert.ok(typeof result.progress === "number");

      if (result.complete) {
        break;
      }
    }

    // Step 3: Get summary
    const summary = await writer.getStorySummary(start.story_id);
    assert.ok(summary.story_id);
    assert.strictEqual(summary.engine_version, "v2");

    // Step 4: Confirm
    const confirmed = await writer.confirmStory(start.story_id);
    assert.strictEqual(confirmed.confirmed, true);
    assert.strictEqual(confirmed.engine_version, "v2");

    // Step 5: Get context for lyrics
    const context = await writer.getStoryContext(start.story_id);
    assert.ok(context.sessionId || context.story_id);
    assert.ok(context.recipientName || context.recipient_name);
  });
});
