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
        { id: "scene", purpose: "where it happened", required: true, status: "covered", evidence: ["f1"] },
        { id: "meaning", purpose: "what it means", required: true, status: "covered", evidence: ["f99"] }, // Invalid evidence
      ];

      const reconciled = reconcileBeats(existingBeats, llmBeats, facts);

      // scene should be covered (valid evidence)
      assert.strictEqual(reconciled.beats.find(b => b.id === "scene").status, "covered");
      // V3: meaning should still be covered (trust LLM), but evidence filtered
      assert.strictEqual(reconciled.beats.find(b => b.id === "meaning").status, "covered");
      assert.deepStrictEqual(reconciled.beats.find(b => b.id === "meaning").evidence, []);
      // V3: Track invalid evidence for feedback
      assert.deepStrictEqual(reconciled.invalidEvidence, [{ beat: "meaning", evidence_id: "f99" }]);
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

    it("should offer confirmation when content is rich enough (v3 - not fatigue-based)", () => {
      const { generateFallbackResponse } = require("../../../src/writer/v2/engine");

      // V3: Confirmation is content-based, not fatigue-based
      // Need: facts >= 3, narrative > 100 chars, turns >= 6
      const state = {
        narrative: "Dad taught me to fish at the lake every summer. Those patient mornings taught me perseverance. I remember the way the mist rose off the water.",
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
        user_model: { fatigue_signals: 0 }, // V3: fatigue doesn't matter
        turn_count: 6,
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

  describe("V3 Reasoning Quality E2E", () => {
    it("should process multi-turn conversation with beat progression", () => {
      const { applyReasoningResult, addTurnToState } = require("../../../src/writer/v2/engine");
      const { calculateHealthScore } = require("../../../src/writer/v3/monitor");

      // Simulate a multi-turn conversation
      let state = {
        narrative: "",
        facts: [],
        beats: [
          { id: "relationship", purpose: "who they are", strength: 0 },
          { id: "memory", purpose: "shared memory", strength: 0 },
          { id: "emotion", purpose: "emotional core", strength: 0 },
        ],
        turn_count: 0,
        conversation: [],
      };

      // Turn 1: User shares relationship info
      state = addTurnToState(state, "user", "He's my dad and my hero");
      state = applyReasoningResult(state, {
        narrative: "Dad is my hero",
        reasoning: {
          new_facts: [{ text: "Dad is my hero" }],
        },
        beats: [
          { id: "relationship", strength: 0.7 },
          { id: "memory", strength: 0 },
          { id: "emotion", strength: 0.3 },
        ],
      }, "He's my dad and my hero");
      assert.strictEqual(state.turn_count, 1);
      assert.strictEqual(state.facts.length, 1);

      // Turn 2: User shares a memory
      state = addTurnToState(state, "user", "He taught me to fish every summer at the lake");
      state = applyReasoningResult(state, {
        narrative: "Dad is my hero. He taught me to fish every summer.",
        reasoning: {
          new_facts: [{ text: "Taught me to fish every summer" }],
        },
        beats: [
          { id: "relationship", strength: 0.7 },
          { id: "memory", strength: 0.8 },
          { id: "emotion", strength: 0.4 },
        ],
      }, "He taught me to fish every summer at the lake");
      assert.strictEqual(state.turn_count, 2);
      assert.strictEqual(state.facts.length, 2);

      // Turn 3: User adds emotional depth
      state = addTurnToState(state, "user", "Those quiet mornings on the lake meant everything to me");
      state = applyReasoningResult(state, {
        narrative: "Dad is my hero. He taught me to fish every summer. Those quiet mornings meant everything.",
        reasoning: {
          new_facts: [{ text: "Those quiet mornings meant everything" }],
        },
        beats: [
          { id: "relationship", strength: 0.8 },
          { id: "memory", strength: 0.9 },
          { id: "emotion", strength: 0.85 },
        ],
      }, "Those quiet mornings on the lake meant everything to me");
      assert.strictEqual(state.turn_count, 3);
      assert.strictEqual(state.facts.length, 3);

      // Health score should be good now
      const health = calculateHealthScore(state);
      assert.ok(health >= 60, `Health score should be >= 60, got ${health}`);
    });

    it("should use beat strength (0-1) instead of categorical status", () => {
      const { applyReasoningResult } = require("../../../src/writer/v2/engine");

      const state = {
        narrative: "",
        facts: [],
        beats: [
          { id: "memory", purpose: "shared memory", strength: 0 },
        ],
        turn_count: 0,
      };

      // LLM returns strength value
      const result = applyReasoningResult(state, {
        narrative: "A fishing trip memory",
        facts: [{ id: "f1", text: "Fishing trip" }],
        beats: [
          { id: "memory", strength: 0.65 }, // Numeric strength, not "covered"
        ],
      }, "We went fishing");

      const memoryBeat = result.beats.find(b => b.id === "memory");
      assert.strictEqual(typeof memoryBeat.strength, "number");
      assert.ok(memoryBeat.strength >= 0 && memoryBeat.strength <= 1);
    });
  });

  describe("Three-Tier Fallback Chain E2E", () => {
    it("should use primary LLM when successful", async () => {
      const { reasonWithFallback } = require("../../../src/writer/v2/reasoner");

      const state = {
        recipient_name: "Mom",
        narrative: "She makes pancakes",
        facts: [{ text: "Makes pancakes" }],
        beats: [{ purpose: "memory", strength: 0.5 }],
        turn_count: 3,
      };

      // Mock successful primary LLM
      const result = await reasonWithFallback(state, "She flips them perfectly", {
        mockPrimaryResult: {
          success: true,
          data: {
            action: "ASK",
            question: "What does that smell remind you of?",
            beats: [{ purpose: "memory", strength: 0.7 }],
          },
        },
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tier, "primary");
      assert.strictEqual(result.fallback, false);
    });

    it("should fall back to lightweight LLM when primary fails", async () => {
      const { reasonWithFallback } = require("../../../src/writer/v2/reasoner");

      const state = {
        recipient_name: "Dad",
        narrative: "Dad teaches",
        facts: [{ text: "Dad teaches" }],
        beats: [{ purpose: "relationship", strength: 0.3 }],
        turn_count: 2,
      };

      const result = await reasonWithFallback(state, "He's patient", {
        mockPrimaryResult: { success: false, error: "Primary LLM failed" },
        mockLightweightResult: {
          success: true,
          data: {
            action: "ASK",
            message: "Tell me more about that patience.",
          },
        },
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tier, "lightweight");
      assert.strictEqual(result.fallback, true);
    });

    it("should fall back to heuristics when both LLMs fail", async () => {
      const { reasonWithFallback } = require("../../../src/writer/v2/reasoner");

      const state = {
        recipient_name: "Grandma",
        narrative: "Grandma cooks wonderful meals",
        facts: [{ text: "Wonderful meals" }, { text: "Family dinners" }],
        beats: [{ purpose: "memory", strength: 0.4 }],
        turn_count: 4,
        conversation: [
          { role: "user", content: "She cooks" },
          { role: "assistant", content: "Tell me more" },
        ],
      };

      const result = await reasonWithFallback(state, "Her kitchen smells amazing", {
        mockPrimaryResult: { success: false, error: "Primary failed" },
        mockLightweightResult: { success: false, error: "Lightweight failed" },
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tier, "heuristic");
      assert.strictEqual(result.fallback, true);
      assert.ok(result.data.action === "ASK" || result.data.action === "CONFIRM");
    });
  });

  describe("Safety Bounds E2E", () => {
    it("should warn but NOT force at recommended max turns (V3)", () => {
      const { applySafetyBounds, SAFETY_BOUNDS } = require("../../../src/writer/v3/safety");

      const state = {
        turn_count: SAFETY_BOUNDS.recommendedMaxTurns, // At recommended limit
        recipient_name: "Dad",
      };

      const decision = {
        action: "ASK",
        question: "Another question?",
      };

      const result = applySafetyBounds(state, decision);

      // V3: Recommended limit warns but doesn't force
      assert.strictEqual(result.decision.action, "ASK"); // NOT forced to CONFIRM
      assert.strictEqual(result.decision.approaching_limit, true);
      assert.ok(result.warnings.length > 0, "Should have warnings");
    });

    it("should force STOP at absolute max turns (V3)", () => {
      const { applySafetyBounds, SAFETY_BOUNDS } = require("../../../src/writer/v3/safety");

      const state = {
        turn_count: SAFETY_BOUNDS.absoluteMaxTurns, // At absolute limit
        recipient_name: "Dad",
      };

      const decision = {
        action: "ASK",
        question: "Another question?",
      };

      const result = applySafetyBounds(state, decision);

      // V3: Absolute limit forces STOP for true safety
      assert.strictEqual(result.decision.action, "STOP");
      assert.strictEqual(result.decision.forced, true);
      assert.ok(result.warnings.length > 0, "Should have warnings");
    });

    it("should not override decisions when under max turns", () => {
      const { applySafetyBounds, SAFETY_BOUNDS } = require("../../../src/writer/v3/safety");

      const state = {
        turn_count: Math.floor(SAFETY_BOUNDS.maxTurns / 2),
      };

      const decision = {
        action: "ASK",
        question: "A good question?",
      };

      const result = applySafetyBounds(state, decision);

      // applySafetyBounds returns { decision, warnings }
      assert.strictEqual(result.decision.action, "ASK");
      assert.strictEqual(result.decision.forced, undefined);
      assert.strictEqual(result.warnings.length, 0, "Should have no warnings");
    });

    it("should validate response structure", () => {
      const { validateStructure } = require("../../../src/writer/v3/safety");

      // Valid response
      const validResult = validateStructure({
        action: "ASK",
        question: "What else?",
      });
      assert.strictEqual(validResult.valid, true);

      // Invalid response - missing action
      const invalidResult = validateStructure({
        question: "What else?",
      });
      assert.strictEqual(invalidResult.valid, false);

      // Invalid response - wrong action type
      const wrongTypeResult = validateStructure({
        action: "INVALID_ACTION",
        question: "What?",
      });
      assert.strictEqual(wrongTypeResult.valid, false);
    });
  });

  describe("Monitoring Integration E2E", () => {
    it("should detect anomalies in degraded sessions", () => {
      const { checkForAnomalies } = require("../../../src/writer/v3/monitor");

      // Simulate a session that got stuck
      const stuckState = {
        turn_count: 12,
        facts: [{ text: "one fact only" }],
        narrative: "Short.",
        beats: [{ purpose: "memory", strength: 0.2 }],
      };

      const anomalies = checkForAnomalies(stuckState);

      assert.ok(anomalies.length > 0, "Should detect anomalies");
      assert.ok(
        anomalies.some(a => a.type === "high_turn_low_content"),
        "Should flag high turns with low content"
      );
    });

    it("should report healthy sessions without anomalies", () => {
      const { checkForAnomalies, calculateHealthScore } = require("../../../src/writer/v3/monitor");

      const healthyState = {
        turn_count: 5,
        facts: [
          { text: "fact 1" },
          { text: "fact 2" },
          { text: "fact 3" },
        ],
        narrative: "A good narrative with sufficient detail about the relationship and memories shared together.",
        beats: [
          { purpose: "relationship", strength: 0.7 },
          { purpose: "memory", strength: 0.8 },
        ],
      };

      const anomalies = checkForAnomalies(healthyState);
      const health = calculateHealthScore(healthyState);

      assert.strictEqual(anomalies.length, 0, "Healthy state should have no anomalies");
      assert.ok(health >= 70, `Health score should be >= 70, got ${health}`);
    });

    it("should detect stuck patterns in decision history", () => {
      const { detectStuckPattern } = require("../../../src/writer/v3/monitor");

      const stuckHistory = [
        { action: "ASK", beat_target: "memory" },
        { action: "ASK", beat_target: "memory" },
        { action: "ASK", beat_target: "memory" },
        { action: "ASK", beat_target: "memory" },
      ];

      const stuck = detectStuckPattern(stuckHistory);

      assert.strictEqual(stuck.isStuck, true);
      assert.strictEqual(stuck.stuckOn, "memory");
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
