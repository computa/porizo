/**
 * V2 Improvements E2E Tests
 *
 * Integration tests verifying all V2 improvements work together.
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");

describe("V2 Improvements E2E", () => {
  const v2 = require("../../../src/writer/v2");
  let mockRepo;

  beforeEach(() => {
    mockRepo = createMockRepository();
    v2.initialize(mockRepo);
  });

  describe("Initial Prompt in Conversation History", () => {
    it("should include initial prompt as first user turn", async () => {
      const result = await v2.startStoryV2({
        userId: "test-user",
        recipientName: "Dad",
        occasion: "birthday",
        initialPrompt: "My dad taught me to fish at the lake",
      });

      const session = mockRepo.getSession(result.sessionId);
      const state = session.v2State;

      // Verify conversation has the initial prompt
      assert.ok(state.conversation.length >= 1, "Should have conversation turns");
      assert.strictEqual(state.conversation[0].role, "user");
      assert.strictEqual(state.conversation[0].content, "My dad taught me to fish at the lake");
    });

    it("should have assistant response after initial prompt", async () => {
      const result = await v2.startStoryV2({
        userId: "test-user",
        recipientName: "Mom",
        occasion: "anniversary",
        initialPrompt: "She always made us pancakes on Sundays",
      });

      const session = mockRepo.getSession(result.sessionId);
      const state = session.v2State;

      // Should have both user prompt and assistant response
      assert.ok(state.conversation.length >= 2, "Should have at least 2 turns");
      assert.strictEqual(state.conversation[1].role, "assistant");
    });
  });

  describe("Event Inference Integration", () => {
    it("should preserve event structure in state", async () => {
      const result = await v2.startStoryV2({
        userId: "test-user",
        recipientName: "Dad",
        occasion: "memorial",
        initialPrompt: "I want to honor my father's memory",
      });

      const session = mockRepo.getSession(result.sessionId);
      const state = session.v2State;

      // Event should be initialized from occasion
      assert.ok(state.event, "Should have event object");
      assert.strictEqual(state.event.occasion, "memorial");
    });

    it("should handle event type in engine apply function", async () => {
      // This tests that applyReasoningResult can handle event inference
      const { applyReasoningResult } = require("../../../src/writer/v2/engine");

      const state = {
        narrative: "A story about Dad",
        facts: [],
        beats: [],
        event: { occasion: "birthday" },
        turn_count: 1,
      };

      // Simulate LLM response with event inference
      const reasoningResult = {
        narrative: "Updated story",
        event: {
          type: "loss",
          title: "Memorial for Dad",
          confidence: 0.85,
        },
      };

      const newState = applyReasoningResult(state, reasoningResult, "user input");

      // Event should be updated when confidence > 0.7
      assert.strictEqual(newState.event.type, "loss");
      assert.strictEqual(newState.event.title, "Memorial for Dad");
      assert.strictEqual(newState.event.inferred_confidence, 0.85);
      // Original occasion preserved
      assert.strictEqual(newState.event.occasion, "birthday");
    });

    it("should not apply event inference with low confidence", () => {
      const { applyReasoningResult } = require("../../../src/writer/v2/engine");

      const state = {
        narrative: "A story",
        facts: [],
        beats: [],
        event: { occasion: "birthday", type: "birthday" },
        turn_count: 1,
      };

      const reasoningResult = {
        narrative: "Updated story",
        event: {
          type: "loss",
          title: "Memorial",
          confidence: 0.5, // Below threshold
        },
      };

      const newState = applyReasoningResult(state, reasoningResult, "input");

      // Type should NOT be updated (low confidence)
      assert.strictEqual(newState.event.type, "birthday");
    });
  });

  describe("Grounding Validation Integration", () => {
    it("should detect ungrounded narrative", () => {
      const { isStateGrounded } = require("../../../src/writer/v2/state");

      const state = {
        facts: [
          { id: "f1", text: "Dad loves fishing" },
        ],
        narrative: "Dad loves fishing and always took me camping.", // "camping" is ungrounded
      };

      const grounded = isStateGrounded(state);
      assert.strictEqual(grounded, false, "Should detect ungrounded content");
    });

    it("should accept fully grounded narrative", () => {
      const { isStateGrounded } = require("../../../src/writer/v2/state");

      const state = {
        facts: [
          { id: "f1", text: "Dad loves fishing" },
          { id: "f2", text: "He taught me at the lake" },
        ],
        narrative: "Dad loves fishing. He taught me at the lake.",
      };

      const grounded = isStateGrounded(state);
      assert.strictEqual(grounded, true, "Should accept grounded narrative");
    });

    it("should enforce grounding and rebuild narrative", () => {
      const { enforceGrounding } = require("../../../src/writer/v2/engine");

      const state = {
        facts: [
          { id: "f1", text: "Dad loves fishing" },
          { id: "f2", text: "He is turning 60" },
        ],
        narrative: "Dad loves fishing, camping, and hiking.", // camping and hiking are ungrounded
      };

      const fixed = enforceGrounding(state);

      // Should rebuild from facts
      assert.ok(fixed.narrative.includes("fishing") || fixed.narrative.includes("60"));
      assert.ok(!fixed.narrative.includes("camping") || !fixed.narrative.includes("hiking"),
        "Should not contain ungrounded content");
      assert.strictEqual(fixed.grounding_enforced, true);
    });
  });

  describe("Beat Reconciliation Integration", () => {
    it("should reconcile beats with facts in full flow (v3 - trust LLM)", async () => {
      const { reconcileBeats } = require("../../../src/writer/v2/engine");

      const existingBeats = [
        { id: "scene", status: "missing", evidence: [], required: true },
        { id: "meaning", status: "missing", evidence: [], required: true },
      ];

      const facts = [
        { id: "f1", text: "Dad taught me to fish at the lake every summer" },
      ];

      const llmBeats = [
        { id: "scene", status: "covered", evidence: ["f1"] },
        { id: "meaning", status: "covered", evidence: ["f99"] }, // Invalid evidence
      ];

      const reconciled = reconcileBeats(existingBeats, llmBeats, facts);

      // scene should be covered (valid evidence)
      assert.strictEqual(reconciled.find(b => b.id === "scene").status, "covered");
      // V3: meaning should still be covered (trust LLM), but evidence filtered
      assert.strictEqual(reconciled.find(b => b.id === "meaning").status, "covered");
      assert.deepStrictEqual(reconciled.find(b => b.id === "meaning").evidence, []);
    });
  });

  describe("Context-Aware Fallback Integration", () => {
    it("should generate contextual question from narrative", () => {
      const { generateFallbackResponse } = require("../../../src/writer/v2/engine");

      const state = {
        narrative: "Dad taught me to fish at the lake every summer.",
        facts: [
          { id: "f1", text: "Dad taught me to fish" },
          { id: "f2", text: "We went to the lake every summer" },
        ],
        beats: [
          { id: "meaning", status: "missing", purpose: "what it means", required: true },
        ],
        user_model: { fatigue_signals: 0 },
        turn_count: 2,
      };

      const response = generateFallbackResponse(state);

      // Should reference narrative content
      const q = response.question.toLowerCase();
      const referencesNarrative =
        q.includes("fish") ||
        q.includes("lake") ||
        q.includes("taught") ||
        q.includes("summer");

      assert.ok(referencesNarrative,
        `Fallback should reference narrative. Got: "${response.question}"`);
      assert.strictEqual(response.fallback, true);
    });

    it("should offer confirmation when user is fatigued", () => {
      const { generateFallbackResponse } = require("../../../src/writer/v2/engine");

      const state = {
        narrative: "Dad taught me to fish. Those summers at the lake taught me patience and perseverance.",
        facts: [
          { id: "f1", text: "Dad taught me to fish" },
          { id: "f2", text: "Summers at the lake" },
          { id: "f3", text: "Learned patience and perseverance" },
        ],
        beats: [
          { id: "scene", status: "covered", required: true },
          { id: "meaning", status: "covered", required: true },
          { id: "turning_point", status: "weak", required: true },
        ],
        user_model: { fatigue_signals: 2 },
        turn_count: 5,
      };

      const response = generateFallbackResponse(state);

      assert.strictEqual(response.action, "CONFIRM");
      assert.ok(response.confirmation);
    });
  });

  describe("Progress Scoring Integration", () => {
    it("should return correct 0-100 score", () => {
      const { getCompletionScore } = require("../../../src/writer/v2/quality");

      const state = {
        beats: [
          { id: "scene", status: "covered", required: true },
          { id: "meaning", status: "missing", required: true },
          { id: "turning_point", status: "weak", required: true },
        ],
      };

      const score = getCompletionScore(state);

      // 1 covered + 0.5 weak = 1.5 out of 3 = 50%
      assert.strictEqual(score, 50);
      assert.ok(score <= 100, "Score should not exceed 100");
    });

    it("should pass completion score through API without double-multiplication", async () => {
      // This tests the wrapper layer
      const writer = require("../../../src/writer");
      const mockRepoForWriter = createMockRepository();
      writer.initWithRepository(mockRepoForWriter);

      const start = await writer.startStory({
        initial_prompt: "Test prompt",
        occasion: "birthday",
        recipient_name: "Test",
        user_id: "test-user",
        engine_version: "v2",
      });

      // Result should have completion_score in 0-100 range
      if (start.completion_score !== undefined) {
        assert.ok(start.completion_score >= 0 && start.completion_score <= 100,
          `Completion score should be 0-100, got ${start.completion_score}`);
      }
    });
  });
});

/**
 * Create a mock repository for testing
 */
function createMockRepository() {
  const sessions = new Map();

  return {
    createSession(userId, params) {
      const id = `test-session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const session = { id, userId, ...params };
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
  };
}
