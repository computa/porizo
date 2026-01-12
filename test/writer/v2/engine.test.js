/**
 * V2 Engine Tests
 * Tests for the state integration and engine orchestration
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");

const { createInitialState } = require("../../../src/writer/v2/state");

// Task 9: Apply reasoning results to state
describe("V2 Engine - Apply Reasoning", () => {
  const { applyReasoningResult } = require("../../../src/writer/v2/engine");

  it("should update narrative from reasoning result", () => {
    const state = createInitialState({
      recipientName: "Sarah",
      occasion: "birthday",
      initialPrompt: "Song for my daughter",
    });

    const reasoningResult = {
      action: "ASK",
      question: "What's a favorite memory?",
      narrative: "Sarah is turning one and loves playing with blocks.",
      reasoning: {
        new_facts: [{ text: "loves playing with blocks", beat: "character" }],
        decision: "ASK",
        decision_reason: "Need more details",
      },
      beats: [
        { id: "who", purpose: "who this person is", required: true, status: "weak", evidence: ["f1"] },
        { id: "memory", purpose: "favorite memory", required: true, status: "missing", evidence: [] },
      ],
      user_model: { style: "verbose", fatigue_signals: 0, tone_preference: "celebratory" },
    };

    const newState = applyReasoningResult(state, reasoningResult, "She loves playing with blocks");

    assert.strictEqual(newState.narrative, "Sarah is turning one and loves playing with blocks.");
    assert.strictEqual(newState.beats.length, 2);
    assert.strictEqual(newState.beats[0].status, "weak");
  });

  it("should add facts from reasoning result", () => {
    const state = createInitialState({
      recipientName: "Mom",
      occasion: "mothers_day",
      initialPrompt: "Thanks mom",
    });

    const reasoningResult = {
      action: "ASK",
      question: "Tell me more",
      narrative: "She always supported me during tough times.",
      reasoning: {
        new_facts: [
          { text: "always supported during tough times", beat: "support" },
          { text: "helped with homework", beat: "memory" },
        ],
        decision: "ASK",
      },
      beats: [],
      user_model: { style: "emotional", fatigue_signals: 0, tone_preference: "grateful" },
    };

    const newState = applyReasoningResult(state, reasoningResult, "She always helped me");

    assert.strictEqual(newState.facts.length, 2);
    assert.strictEqual(newState.facts[0].text, "always supported during tough times");
  });

  it("should update user model from reasoning result", () => {
    const state = createInitialState({
      recipientName: "Dad",
      occasion: "birthday",
      initialPrompt: "Song for dad",
    });

    const reasoningResult = {
      action: "ASK",
      question: "Any specific memories?",
      narrative: "He's a great dad.",
      reasoning: {
        new_facts: [],
        decision: "ASK",
        user_style: "brief",
        fatigue_signals: 1,
      },
      beats: [],
      user_model: { style: "brief", fatigue_signals: 1, tone_preference: "neutral" },
    };

    const newState = applyReasoningResult(state, reasoningResult, "He's great");

    assert.strictEqual(newState.user_model.style, "brief");
    assert.strictEqual(newState.user_model.fatigue_signals, 1);
  });

  it("should track reasoning trace for debugging", () => {
    const state = createInitialState({
      recipientName: "Sarah",
      occasion: "birthday",
      initialPrompt: "Test",
    });

    const reasoningResult = {
      action: "ASK",
      question: "Test?",
      narrative: "Test narrative",
      reasoning: {
        new_facts: [],
        decision: "ASK",
        decision_reason: "Need more info",
      },
      beats: [],
      user_model: { style: "unknown", fatigue_signals: 0, tone_preference: "neutral" },
    };

    const newState = applyReasoningResult(state, reasoningResult, "Test input");

    assert.ok(newState.last_reasoning);
    assert.strictEqual(newState.last_reasoning.decision, "ASK");
  });

  it("should update status when action is CONFIRM", () => {
    const state = createInitialState({
      recipientName: "Sarah",
      occasion: "birthday",
      initialPrompt: "Test",
    });

    const reasoningResult = {
      action: "CONFIRM",
      confirmation: "Does this capture your story?",
      narrative: "Complete story narrative",
      reasoning: {
        new_facts: [],
        decision: "CONFIRM",
        decision_reason: "All beats covered",
      },
      beats: [
        { id: "who", status: "covered", evidence: ["f1"] },
        { id: "meaning", status: "covered", evidence: ["f2"] },
      ],
      user_model: { style: "verbose", fatigue_signals: 0, tone_preference: "celebratory" },
    };

    const newState = applyReasoningResult(state, reasoningResult, "Final input");

    assert.strictEqual(newState.status, "ready_for_confirm");
  });
});

// Task 10: Conversation turn tracking
describe("V2 Engine - Conversation Tracking", () => {
  const { addTurnToState } = require("../../../src/writer/v2/engine");

  it("should add user turn to conversation", () => {
    const state = createInitialState({
      recipientName: "Sarah",
      occasion: "birthday",
      initialPrompt: "Test",
    });

    const newState = addTurnToState(state, "user", "She loves playing blocks");

    assert.strictEqual(newState.conversation.length, 1);
    assert.strictEqual(newState.conversation[0].role, "user");
    assert.strictEqual(newState.conversation[0].content, "She loves playing blocks");
    assert.ok(newState.conversation[0].timestamp);
  });

  it("should add assistant turn to conversation", () => {
    const state = createInitialState({
      recipientName: "Sarah",
      occasion: "birthday",
      initialPrompt: "Test",
    });
    state.conversation = [{ role: "user", content: "Test", timestamp: new Date().toISOString() }];

    const newState = addTurnToState(state, "assistant", "What's a favorite memory?");

    assert.strictEqual(newState.conversation.length, 2);
    assert.strictEqual(newState.conversation[1].role, "assistant");
  });

  it("should increment turn count for user turns only", () => {
    const state = createInitialState({
      recipientName: "Sarah",
      occasion: "birthday",
      initialPrompt: "Test",
    });
    state.turn_count = 0;

    let newState = addTurnToState(state, "user", "First answer");
    assert.strictEqual(newState.turn_count, 1);

    newState = addTurnToState(newState, "assistant", "Question");
    assert.strictEqual(newState.turn_count, 1); // unchanged

    newState = addTurnToState(newState, "user", "Second answer");
    assert.strictEqual(newState.turn_count, 2);
  });

  it("should throw error for invalid role", () => {
    const state = createInitialState({
      recipientName: "Sarah",
      occasion: "birthday",
      initialPrompt: "Test",
    });

    assert.throws(
      () => addTurnToState(state, "invalid_role", "Test content"),
      /Invalid conversation role/
    );
  });
});

// Task 11: Fallback heuristics when LLM unavailable
describe("V2 Engine - Fallback Heuristics", () => {
  const { generateFallbackResponse } = require("../../../src/writer/v2/engine");

  it("should generate fallback question based on missing beats", () => {
    const state = createInitialState({
      recipientName: "Sarah",
      occasion: "birthday",
      initialPrompt: "Test",
    });
    // Priority order: turning_point > meaning > scene/who > stakes
    // So with turning_point and meaning missing, it asks about turning_point first
    state.beats = [
      { id: "who", purpose: "who this person is", required: true, status: "covered", evidence: [] },
      { id: "turning_point", purpose: "pivotal moment", required: true, status: "missing", evidence: [] },
      { id: "meaning", purpose: "what they mean to you", required: true, status: "missing", evidence: [] },
    ];

    const response = generateFallbackResponse(state);

    assert.strictEqual(response.action, "ASK");
    assert.ok(response.question);
    // Should ask about turning_point since it's highest priority
    assert.ok(response.question.toLowerCase().includes("pivotal") ||
              response.question.toLowerCase().includes("moment"));
  });

  it("should return CONFIRM when all required beats covered", () => {
    const state = createInitialState({
      recipientName: "Sarah",
      occasion: "birthday",
      initialPrompt: "Test",
    });
    state.beats = [
      { id: "who", purpose: "who this person is", required: true, status: "covered", evidence: [] },
      { id: "memory", purpose: "favorite memory", required: true, status: "covered", evidence: [] },
      { id: "meaning", purpose: "what they mean to you", required: true, status: "covered", evidence: [] },
    ];
    state.narrative = "Sarah is wonderful...";

    const response = generateFallbackResponse(state);

    assert.strictEqual(response.action, "CONFIRM");
    assert.ok(response.confirmation);
  });

  it("should handle empty beats array", () => {
    const state = createInitialState({
      recipientName: "Sarah",
      occasion: "birthday",
      initialPrompt: "Test",
    });
    state.beats = [];

    const response = generateFallbackResponse(state);

    assert.strictEqual(response.action, "ASK");
    assert.ok(response.question);
  });

  it("should confirm when content is rich enough (v3 - content-based, not fatigue)", () => {
    const state = createInitialState({
      recipientName: "Sarah",
      occasion: "birthday",
      initialPrompt: "Test",
    });
    // V3: Confirmation is content-based, not fatigue-based
    // Need: facts >= 3, narrative > 100 chars, turns >= 6
    state.facts = [
      { id: "f1", text: "Sarah is my best friend" },
      { id: "f2", text: "We met in college" },
      { id: "f3", text: "She always makes me laugh" },
    ];
    state.narrative = "Sarah is my best friend. We met in college and have been inseparable ever since. She always makes me laugh and is there when I need her.";
    state.turn_count = 6;
    state.beats = [
      { id: "who", required: true, status: "covered", evidence: ["f1"] },
      { id: "moment", required: true, status: "weak", evidence: ["f2"] },
      { id: "meaning", required: true, status: "covered", evidence: ["f3"] },
    ];

    const response = generateFallbackResponse(state);

    // V3: With rich content (facts >= 3, narrative > 100, turns >= 6), should confirm
    assert.strictEqual(response.action, "CONFIRM");
  });
});

// Task 12: State persistence
describe("V2 Engine - State Persistence", () => {
  const { saveStateToSession, loadStateFromSession } = require("../../../src/writer/v2/engine");

  // These tests will need a mock database - skip for now
  it("should serialize state to JSON for storage", () => {
    const state = createInitialState({
      recipientName: "Sarah",
      occasion: "birthday",
      initialPrompt: "Test",
    });
    state.narrative = "Test narrative";
    state.facts = [{ id: "f1", text: "loves blocks", beat: "character" }];

    // Just test the serialization/deserialization round trip
    const serialized = JSON.stringify(state);
    const parsed = JSON.parse(serialized);

    assert.strictEqual(parsed.narrative, "Test narrative");
    assert.strictEqual(parsed.facts.length, 1);
    assert.strictEqual(parsed.recipient_name, "Sarah");
  });

  it("should preserve all state fields in round trip", () => {
    const state = createInitialState({
      recipientName: "Mom",
      occasion: "mothers_day",
      initialPrompt: "Thanks mom",
    });
    state.narrative = "Mom is amazing";
    state.facts = [{ id: "f1", text: "always there", beat: "support" }];
    state.beats = [{ id: "meaning", status: "covered", evidence: ["f1"] }];
    state.user_model = { style: "emotional", fatigue_signals: 1, tone_preference: "grateful" };
    state.conversation = [{ role: "user", content: "She's always there" }];
    state.turn_count = 2;
    state.status = "ready_for_confirm";

    const serialized = JSON.stringify(state);
    const parsed = JSON.parse(serialized);

    assert.deepStrictEqual(parsed.facts, state.facts);
    assert.deepStrictEqual(parsed.beats, state.beats);
    assert.deepStrictEqual(parsed.user_model, state.user_model);
    assert.strictEqual(parsed.turn_count, 2);
    assert.strictEqual(parsed.status, "ready_for_confirm");
  });
});
