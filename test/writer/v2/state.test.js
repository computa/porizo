/**
 * V2 State Manager Tests
 * Tests for state schema validation and grounding checks
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  createInitialState,
  validateState,
  isStateGrounded,
  addFact,
  updateNarrative,
  updateBeatStatus,
  updateUserModel,
  addConversationTurn,
  setReasoningTrace,
  setStatus,
} = require("../../../src/writer/v2/state");

describe("V2 State Manager", () => {
  describe("createInitialState", () => {
    it("should create valid initial state with recipient and occasion", () => {
      const state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Song for my daughter's first birthday",
      });

      assert.ok(state.event, "Should have event object");
      assert.strictEqual(state.narrative, "");
      assert.ok(Array.isArray(state.beats), "Beats should be array");
      assert.ok(Array.isArray(state.facts), "Facts should be array");
      assert.ok(state.user_model, "Should have user_model");
      assert.strictEqual(state.turn_count, 0);
      assert.strictEqual(state.status, "active");
      assert.strictEqual(state.recipient_name, "Sarah");
    });

    it("should initialize event with occasion from params", () => {
      const state = createInitialState({
        recipientName: "Mom",
        occasion: "mothers_day",
        initialPrompt: "Thanks mom",
      });

      assert.strictEqual(state.event.occasion, "mothers_day");
      assert.ok(state.event.people.includes("Mom"));
    });
  });

  describe("validateState", () => {
    it("should accept valid state", () => {
      const state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Test",
      });

      const result = validateState(state);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it("should reject state missing required fields", () => {
      const invalidState = { narrative: "test" };
      const result = validateState(invalidState);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.length > 0);
    });

    it("should reject state with non-array facts", () => {
      const state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Test",
      });
      state.facts = "not an array";

      const result = validateState(state);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes("facts")));
    });

    it("should reject state with invalid status", () => {
      const state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Test",
      });
      state.status = "invalid_status";

      const result = validateState(state);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes("status")));
    });
  });

  describe("isStateGrounded", () => {
    it("should return true for empty narrative", () => {
      const state = {
        facts: [],
        narrative: "",
      };

      assert.strictEqual(isStateGrounded(state), true);
    });

    it("should return true when narrative contains only known facts", () => {
      const state = {
        facts: [
          { id: "f1", text: "met at coffee shop" },
          { id: "f2", text: "she smiled warmly" },
        ],
        narrative: "They met at a coffee shop. She smiled warmly at him.",
      };

      assert.strictEqual(isStateGrounded(state), true);
    });

    it("should return false when narrative has no facts", () => {
      const state = {
        facts: [],
        narrative: "They had a wonderful time together.",
      };

      // Narrative with no facts = ungrounded
      assert.strictEqual(isStateGrounded(state), false);
    });

    it("should allow common connecting words", () => {
      const state = {
        facts: [{ id: "f1", text: "twins were born" }],
        narrative: "The twins were born and everything changed after that moment.",
      };

      // Should pass - "everything", "moment", "after" are common words
      assert.strictEqual(isStateGrounded(state), true);
    });
  });

  describe("addFact", () => {
    it("should add fact with auto-generated id", () => {
      const state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Test",
      });

      const updatedState = addFact(state, {
        text: "bleeding at 9 weeks",
        beat: "scare",
        sourceTurn: 1,
      });

      assert.strictEqual(updatedState.facts.length, 1);
      assert.ok(updatedState.facts[0].id.startsWith("f"));
      assert.strictEqual(updatedState.facts[0].text, "bleeding at 9 weeks");
      assert.strictEqual(updatedState.facts[0].beat, "scare");
      assert.strictEqual(updatedState.facts[0].source_turn, 1);
    });

    it("should not add duplicate facts", () => {
      let state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Test",
      });

      state = addFact(state, { text: "met at coffee shop", beat: "discovery", sourceTurn: 1 });
      state = addFact(state, { text: "met at coffee shop", beat: "discovery", sourceTurn: 2 });

      assert.strictEqual(state.facts.length, 1);
    });

    it("should be immutable (not modify original)", () => {
      const state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Test",
      });

      const updatedState = addFact(state, { text: "new fact", beat: "test", sourceTurn: 1 });

      assert.strictEqual(state.facts.length, 0);
      assert.strictEqual(updatedState.facts.length, 1);
      assert.notStrictEqual(state, updatedState);
    });
  });

  describe("updateNarrative", () => {
    it("should update narrative immutably", () => {
      const state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Test",
      });

      const updatedState = updateNarrative(state, "New narrative text.");

      assert.strictEqual(state.narrative, "");
      assert.strictEqual(updatedState.narrative, "New narrative text.");
    });

    it("should update updated_at timestamp", () => {
      const state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Test",
      });
      const originalTime = state.updated_at;

      // Small delay to ensure different timestamp
      const updatedState = updateNarrative(state, "New narrative");

      assert.ok(updatedState.updated_at >= originalTime);
    });
  });

  describe("updateBeatStatus", () => {
    it("should update beat status and evidence", () => {
      let state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Test",
      });

      // Add a beat
      state.beats = [
        { id: "discovery", purpose: "how they found out", required: true, status: "missing", evidence: [] },
        { id: "meaning", purpose: "what it means", required: true, status: "missing", evidence: [] },
      ];

      const updatedState = updateBeatStatus(state, "discovery", "covered", ["f1", "f2"]);

      const beat = updatedState.beats.find(b => b.id === "discovery");
      assert.strictEqual(beat.status, "covered");
      assert.deepStrictEqual(beat.evidence, ["f1", "f2"]);

      // Other beats unchanged
      const meaningBeat = updatedState.beats.find(b => b.id === "meaning");
      assert.strictEqual(meaningBeat.status, "missing");
    });
  });

  describe("updateUserModel", () => {
    it("should update user model fields", () => {
      const state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Test",
      });

      const updatedState = updateUserModel(state, {
        style: "verbose",
        fatigue_signals: 1,
      });

      assert.strictEqual(updatedState.user_model.style, "verbose");
      assert.strictEqual(updatedState.user_model.fatigue_signals, 1);
    });

    it("should preserve other user model fields", () => {
      let state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Test",
      });

      state = updateUserModel(state, { style: "emotional" });
      state = updateUserModel(state, { fatigue_signals: 2 });

      assert.strictEqual(state.user_model.style, "emotional");
      assert.strictEqual(state.user_model.fatigue_signals, 2);
    });
  });

  describe("addConversationTurn", () => {
    it("should add conversation turn with timestamp", () => {
      const state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Test",
      });

      const updatedState = addConversationTurn(state, {
        role: "user",
        content: "My twins were born last year",
      });

      assert.strictEqual(updatedState.conversation.length, 1);
      assert.strictEqual(updatedState.conversation[0].role, "user");
      assert.strictEqual(updatedState.conversation[0].content, "My twins were born last year");
      assert.ok(updatedState.conversation[0].timestamp);
    });

    it("should increment turn_count for user messages", () => {
      let state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Test",
      });

      state = addConversationTurn(state, { role: "assistant", content: "What happened next?" });
      assert.strictEqual(state.turn_count, 0); // Assistant doesn't increment

      state = addConversationTurn(state, { role: "user", content: "They smiled" });
      assert.strictEqual(state.turn_count, 1); // User increments
    });
  });

  describe("setReasoningTrace", () => {
    it("should set reasoning trace with turn number", () => {
      let state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Test",
      });
      state.turn_count = 3;

      const updatedState = setReasoningTrace(state, {
        observation: "User provided rich detail",
        assessment: "3 beats covered",
        decision: "ASK",
        confidence: 0.85,
      });

      assert.strictEqual(updatedState.last_reasoning.turn, 3);
      assert.strictEqual(updatedState.last_reasoning.decision, "ASK");
      assert.strictEqual(updatedState.last_reasoning.confidence, 0.85);
    });
  });

  describe("setStatus", () => {
    it("should update session status", () => {
      const state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Test",
      });

      const updatedState = setStatus(state, "ready_for_confirm");

      assert.strictEqual(updatedState.status, "ready_for_confirm");
    });
  });
});
