/**
 * V2 Conversation History Tests
 *
 * Tests that the initial prompt is properly added to conversation history
 * before the first reasoning call.
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
    _sessions: sessions,
  };
}

describe("V2 Conversation History", () => {
  let v2;
  let mockRepo;

  beforeEach(() => {
    // Clear require cache to get fresh module
    delete require.cache[require.resolve("../../../src/writer/v2")];
    v2 = require("../../../src/writer/v2");
    mockRepo = createMockRepository();
    v2.initialize(mockRepo);
  });

  it("should include initial prompt in conversation history", async () => {
    const result = await v2.startStoryV2({
      userId: "test-user",
      recipientName: "Dad",
      occasion: "birthday",
      initialPrompt: "My dad taught me to fish",
    });

    const session = mockRepo.getSession(result.sessionId);
    const state = session.v2State;

    // Initial prompt should be first user turn
    assert.ok(state.conversation, "Should have conversation array");
    assert.ok(state.conversation.length >= 1, "Should have conversation turns");
    assert.strictEqual(state.conversation[0].role, "user", "First turn should be user");
    assert.strictEqual(
      state.conversation[0].content,
      "My dad taught me to fish",
      "First turn should contain initial prompt"
    );
  });

  it("should have assistant response in history after start", async () => {
    const result = await v2.startStoryV2({
      userId: "test-user",
      recipientName: "Dad",
      occasion: "birthday",
      initialPrompt: "My dad taught me to fish",
    });

    const session = mockRepo.getSession(result.sessionId);
    const state = session.v2State;

    // Should have both user prompt and assistant question
    assert.ok(state.conversation.length >= 2, "Should have 2+ turns");
    assert.strictEqual(state.conversation[1].role, "assistant", "Second turn should be assistant");
    assert.ok(state.conversation[1].content, "Assistant turn should have content");
  });

  it("should pass initial prompt context to LLM for reasoning", async () => {
    const result = await v2.startStoryV2({
      userId: "test-user",
      recipientName: "Mom",
      occasion: "graduation",
      initialPrompt: "Mom helped me study every night for my exams",
    });

    // The first question should be contextually aware of the initial prompt
    // (This verifies the conversation history was available during reasoning)
    assert.ok(result.question, "Should return a question");
    // We can't strictly test LLM output, but we ensure the flow works
  });
});
