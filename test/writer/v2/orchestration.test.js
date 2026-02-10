/**
 * V2 Engine Orchestration Tests
 * Tests for the main API: startStoryV2, continueStoryV2, etc.
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
    // Test helper to access sessions
    _sessions: sessions,
  };
}

describe("V2 Engine Orchestration", () => {
  const v2Engine = require("../../../src/writer/v2");

  // Task 13: startStoryV2
  describe("startStoryV2", () => {
    it("should throw when not initialized", async () => {
      // Reset the engine by requiring fresh module
      delete require.cache[require.resolve("../../../src/writer/v2")];
      const freshEngine = require("../../../src/writer/v2");

      await assert.rejects(
        () => freshEngine.startStoryV2({
          userId: "test-user",
          recipientName: "Sarah",
          occasion: "birthday",
          initialPrompt: "Song for my daughter",
        }),
        /not initialized/
      );
    });

    it("should create session and return first question when initialized", async () => {
      const mockRepo = createMockRepository();
      v2Engine.initialize(mockRepo);

      const result = await v2Engine.startStoryV2({
        userId: "test-user",
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Song for my daughter",
      });

      assert.ok(result.sessionId, "Should return sessionId");
      assert.strictEqual(result.engineVersion, "v2");
      assert.ok(result.question, "Should return a question");
      assert.ok(["ASK", "CLARIFY", "CONFIRM"].includes(result.action), "Should return valid action");
      assert.strictEqual(typeof result.completionScore, "number");
      assert.ok(Array.isArray(result.missingSlots), "Should expose missing slots");
      assert.ok(Array.isArray(result.weakSlots), "Should expose weak slots");
      assert.strictEqual(typeof result.readinessScore, "number");
      assert.strictEqual(typeof result.isStoryReady, "boolean");
      if (result.action === "ASK" || result.action === "CLARIFY") {
        assert.ok(result.targetSlot, "ASK/CLARIFY should target a deterministic slot");
      }
    });

    it("should generate beats for the story (LLM or fallback)", async () => {
      const mockRepo = createMockRepository();
      v2Engine.initialize(mockRepo);

      const result = await v2Engine.startStoryV2({
        userId: "test-user",
        recipientName: "Mom",
        occasion: "birthday",
        initialPrompt: "Happy birthday mom",
      });

      // Check the session was created with beats
      const session = mockRepo.getSession(result.sessionId);
      assert.ok(session.v2State.beats.length > 0, "Should have beats");
      assert.ok(session.v2State.beats.every(b => b.id && b.purpose), "Beats should include id and purpose");
      assert.ok(session.v2State.beats.every(b => typeof b.strength === "number"), "Beats should include strength");
    });

    it("should not rely on occasion templates for beats", async () => {
      const mockRepo = createMockRepository();
      v2Engine.initialize(mockRepo);

      const result = await v2Engine.startStoryV2({
        userId: "test-user",
        recipientName: "Baby",
        occasion: "birth",
        initialPrompt: "Welcome to the world",
      });

      const session = mockRepo.getSession(result.sessionId);
      assert.ok(session.v2State.beats.length > 0, "Should have beats");
      assert.ok(session.v2State.beats.every(b => b.id && b.purpose), "Beats should include id and purpose");
    });
  });

  // Task 14: continueStoryV2
  describe("continueStoryV2", () => {
    it("should throw when session not found", async () => {
      const mockRepo = createMockRepository();
      v2Engine.initialize(mockRepo);

      await assert.rejects(
        () => v2Engine.continueStoryV2({
          sessionId: "non-existent-session",
          answer: "Test answer",
        }),
        /Session not found/
      );
    });

    it("should throw when session has unsupported engine version", async () => {
      const mockRepo = createMockRepository();
      mockRepo._sessions.set("v1-session", {
        id: "v1-session",
        engineVersion: "v1",
        v2State: null,
      });
      v2Engine.initialize(mockRepo);

      await assert.rejects(
        () => v2Engine.continueStoryV2({
          sessionId: "v1-session",
          answer: "Test answer",
        }),
        /unsupported engine version/
      );
    });

    it("should process answer and return next question", async () => {
      const mockRepo = createMockRepository();
      v2Engine.initialize(mockRepo);

      // Start a session first
      const startResult = await v2Engine.startStoryV2({
        userId: "test-user",
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Song for my daughter",
      });

      // Continue with an answer
      const continueResult = await v2Engine.continueStoryV2({
        sessionId: startResult.sessionId,
        answer: "She loves playing with blocks and laughing",
      });

      assert.ok(continueResult.sessionId);
      assert.ok(["ASK", "CLARIFY", "CONFIRM"].includes(continueResult.action));
      // turnCount is 2: initial prompt (turn 1) + this answer (turn 2)
      assert.strictEqual(continueResult.turnCount, 2);
      assert.ok(Array.isArray(continueResult.missingSlots), "Should expose missing slots");
      assert.ok(Array.isArray(continueResult.weakSlots), "Should expose weak slots");
      assert.strictEqual(typeof continueResult.readinessScore, "number");
      assert.strictEqual(typeof continueResult.isStoryReady, "boolean");
    });

    it("should track conversation history", async () => {
      const mockRepo = createMockRepository();
      v2Engine.initialize(mockRepo);

      const startResult = await v2Engine.startStoryV2({
        userId: "test-user",
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Test",
      });

      await v2Engine.continueStoryV2({
        sessionId: startResult.sessionId,
        answer: "First answer",
      });

      const session = mockRepo.getSession(startResult.sessionId);
      assert.ok(session.v2State.conversation.length > 0, "Should have conversation history");
      assert.ok(
        session.v2State.conversation.some(t => t.role === "user" && t.content === "First answer"),
        "Should include user answer"
      );
    });

    it("should advance target slot in fallback mode when deterministic extractor patches state", async () => {
      const mockRepo = createMockRepository();
      v2Engine.initialize(mockRepo);

      const startResult = await v2Engine.startStoryV2({
        userId: "test-user",
        recipientName: "Dad",
        occasion: "birthday",
        initialPrompt: "I want a song for my dad.",
      });

      assert.strictEqual(startResult.targetSlot, "moment_destination");

      const continueResult = await v2Engine.continueStoryV2({
        sessionId: startResult.sessionId,
        answer: "The key moment was in our kitchen last night after I failed an exam.",
      });

      assert.notStrictEqual(
        continueResult.targetSlot,
        "moment_destination",
        "Target slot should progress after deterministic extraction fills moment destination"
      );
      assert.ok(
        continueResult.missingSlots.length < startResult.missingSlots.length ||
        continueResult.targetSlot !== startResult.targetSlot,
        "Progression should reduce or move beyond the initial gap focus"
      );
    });

    it("should apply repeat-slot escape when same slot is asked repeatedly", async () => {
      const mockRepo = createMockRepository();
      v2Engine.initialize(mockRepo);

      const startResult = await v2Engine.startStoryV2({
        userId: "test-user",
        recipientName: "Dad",
        occasion: "birthday",
        initialPrompt: "Song for my dad",
      });

      const first = await v2Engine.continueStoryV2({
        sessionId: startResult.sessionId,
        answer: "Not sure yet.",
      });

      const second = await v2Engine.continueStoryV2({
        sessionId: startResult.sessionId,
        answer: "Still not sure.",
      });

      if (first.targetSlot === startResult.targetSlot) {
        assert.notStrictEqual(
          second.targetSlot,
          first.targetSlot,
          "Repeat-slot escape should switch to a different target slot after repeated prompts"
        );
      } else {
        assert.ok(second.targetSlot, "Should continue with a valid target slot");
      }
    });
  });

  // Task 15: getStoryContextV2
  describe("getStoryContextV2", () => {
    it("should throw when session not found", async () => {
      const mockRepo = createMockRepository();
      v2Engine.initialize(mockRepo);

      await assert.rejects(
        () => v2Engine.getStoryContextV2("non-existent"),
        /Session not found/
      );
    });

    it("should return story context for lyrics generation", async () => {
      const mockRepo = createMockRepository();
      v2Engine.initialize(mockRepo);

      // Start a session
      const startResult = await v2Engine.startStoryV2({
        userId: "test-user",
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Song for my daughter",
      });

      // Get context
      const context = await v2Engine.getStoryContextV2(startResult.sessionId);

      assert.strictEqual(context.sessionId, startResult.sessionId);
      assert.strictEqual(context.recipientName, "Sarah");
      assert.strictEqual(context.occasion, "birthday");
      assert.ok(Array.isArray(context.facts));
      assert.ok(Array.isArray(context.beats));
      assert.ok(context.summary);
    });
  });

  // Task 16: confirmStoryV2
  describe("confirmStoryV2", () => {
    it("should throw when session not found", async () => {
      const mockRepo = createMockRepository();
      v2Engine.initialize(mockRepo);

      await assert.rejects(
        () => v2Engine.confirmStoryV2("non-existent"),
        /Session not found/
      );
    });

    it("should mark session as confirmed", async () => {
      const mockRepo = createMockRepository();
      v2Engine.initialize(mockRepo);

      // Start a session
      const startResult = await v2Engine.startStoryV2({
        userId: "test-user",
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Song for my daughter",
      });

      // Confirm
      const confirmResult = await v2Engine.confirmStoryV2(startResult.sessionId);

      assert.strictEqual(confirmResult.status, "confirmed");
      assert.ok(confirmResult.confirmedAt);

      // Verify in database
      const session = mockRepo.getSession(startResult.sessionId);
      assert.strictEqual(session.v2State.status, "confirmed");
    });
  });
});

// Task 17: Integration tests
describe("V2 Engine Integration Flow", () => {
  const v2Engine = require("../../../src/writer/v2");

  it("should complete a full conversation flow", async () => {
    const mockRepo = createMockRepository();
    v2Engine.initialize(mockRepo);

    // Step 1: Start session
    const start = await v2Engine.startStoryV2({
      userId: "integration-user",
      recipientName: "Dad",
      occasion: "birthday",
      initialPrompt: "Happy birthday to my father",
    });
    assert.ok(start.sessionId);
    assert.ok(start.question);

    // Step 2: Continue with answers (simulate conversation)
    let lastResult = start;
    const answers = [
      "He taught me to ride a bike when I was 7",
      "He never gave up on me even when I struggled",
      "He means the world to me",
    ];

    for (const answer of answers) {
      const result = await v2Engine.continueStoryV2({
        sessionId: start.sessionId,
        answer,
      });
      lastResult = result;

      // If we get CONFIRM, break early
      if (result.action === "CONFIRM") {
        break;
      }
    }

    // Step 3: Get context (regardless of action)
    const context = await v2Engine.getStoryContextV2(start.sessionId);
    // In fallback mode, we won't have narrative/facts since LLM isn't extracting them
    // But we should have conversation history and valid structure
    assert.ok(context.sessionId, "Should have session ID");
    assert.ok(context.beats.length > 0, "Should have beats structure");

    // Step 4: Confirm
    const confirmed = await v2Engine.confirmStoryV2(start.sessionId);
    assert.strictEqual(confirmed.status, "confirmed");
  });

  it("should handle fallback gracefully when LLM unavailable", async () => {
    const mockRepo = createMockRepository();
    v2Engine.initialize(mockRepo);

    // Start with fallback (LLM not configured in test environment)
    const result = await v2Engine.startStoryV2({
      userId: "fallback-user",
      recipientName: "Test",
      occasion: "birthday",
      initialPrompt: "Test",
    });

    // Should still work with fallback
    assert.ok(result.sessionId);
    assert.ok(result.question);
    // fallback flag may or may not be set depending on LLM availability
  });
});
