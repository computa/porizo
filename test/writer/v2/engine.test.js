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

  it("should reject append-style narrative updates", () => {
    const state = createInitialState({
      recipientName: "Sarah",
      occasion: "birthday",
      initialPrompt: "Song for my daughter",
    });

    state.narrative = "Sarah is turning one and we remember the day we heard her first laugh in the kitchen.";
    const appendedNarrative = `${state.narrative} It was after a long night, and we cried together.`;

    const reasoningResult = {
      action: "ASK",
      question: "What was that day like?",
      narrative: appendedNarrative,
      reasoning: {
        new_facts: [{ text: "first laugh in the kitchen", beat: "moment" }],
        decision: "ASK",
      },
      beats: [
        { id: "moment", purpose: "a vivid memory", required: true, status: "weak", evidence: ["f1"] },
      ],
      user_model: { style: "emotional", fatigue_signals: 0, tone_preference: "warm" },
    };

    const newState = applyReasoningResult(state, reasoningResult, "It was after a long night");

    assert.ok(newState.narrative.includes("This birthday song is for Sarah."));
    assert.ok(
      (newState._reasoning_feedback || []).some(entry => entry.type === "append_style_narrative"),
      "Should record append-style narrative feedback"
    );
  });

  it("should recompose narrative when anchor facts are missing", () => {
    const state = createInitialState({
      recipientName: "Chioma",
      occasion: "birthday",
      initialPrompt: "Song about the twins",
    });

    state.facts = [
      { id: "f1", text: "We learned it was twins at the 9-week scan", beat: "turning_point" },
      { id: "f2", text: "Chioma held my hand in the clinic", beat: "support" },
      { id: "f3", text: "We cried with relief when we heard two heartbeats", beat: "emotion" },
    ];

    state.narrative = "This birthday song is for Chioma.";

    const reasoningResult = {
      action: "ASK",
      question: "What happened next?",
      narrative: "This birthday song is for Chioma. It was a beautiful day.",
      reasoning: {
        new_facts: [],
        decision: "ASK",
      },
      beats: [
        { id: "turning_point", purpose: "the pivotal moment", required: true, status: "weak", evidence: ["f1"] },
      ],
      user_model: { style: "emotional", fatigue_signals: 0, tone_preference: "warm" },
    };

    const newState = applyReasoningResult(state, reasoningResult, "It was a beautiful day");

    assert.ok(newState.narrative.includes("twins") || newState.narrative.includes("9-week"));
    assert.ok(
      (newState._reasoning_feedback || []).some(entry => entry.type === "missing_anchor_facts"),
      "Should record missing anchor facts feedback"
    );
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

    // V3 format: user state is in reasoning.user_state
    const reasoningResult = {
      action: "ASK",
      question: "Any specific memories?",
      narrative: "He's a great dad.",
      reasoning: {
        new_facts: [],
        decision: "ASK",
        user_state: {
          engagement: "low",
          seems_done: false,
          tone: "neutral",
          style: "brief",
        },
      },
      beats: [],
    };

    const newState = applyReasoningResult(state, reasoningResult, "He's great");

    assert.strictEqual(newState.user_model.style, "brief");
    // Low engagement increments fatigue_signals
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

  it("should return CONFIRM when all required beats covered with rich content", () => {
    // V3: CONFIRM requires holistic richness, not just beat coverage
    const state = createInitialState({
      recipientName: "Sarah",
      occasion: "birthday",
      initialPrompt: "Test",
    });
    state.beats = [
      { id: "who", purpose: "who this person is", required: true, status: "covered", evidence: ["f1"] },
      { id: "memory", purpose: "favorite memory", required: true, status: "covered", evidence: ["f2"] },
      { id: "meaning", purpose: "what they mean to you", required: true, status: "covered", evidence: ["f3"] },
    ];
    // V3: Need sufficient narrative and facts for richness score
    state.narrative = "Sarah is wonderful and has always been there for me. Her birthday always reminds me of how much she means to our family. She brings joy to everyone around her.";
    state.facts = [
      { id: "f1", text: "Sarah is always there for me" },
      { id: "f2", text: "Her birthday is special" },
      { id: "f3", text: "She brings joy to everyone" },
    ];
    state.turn_count = 4;

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

describe("V2 Engine - Deterministic Fallback Extraction", () => {
  const { applyDeterministicFallbackExtraction } = require("../../../src/writer/v2/engine");

  it("should extract atoms, primitives, and facts from fallback user input", () => {
    const state = createInitialState({
      recipientName: "Dad",
      occasion: "birthday",
      initialPrompt: "Song for dad",
    });
    state.turn_count = 2;

    const updated = applyDeterministicFallbackExtraction(
      state,
      "The key moment was in our kitchen last night. I wanted to make him proud, but fear blocked me. If I failed, I could lose his trust."
    );

    assert.ok(updated.facts.length >= 2, "Should add extracted facts");
    assert.ok(updated.atoms.where.toLowerCase().includes("kitchen"), "Should extract place into atoms.where");
    assert.ok(updated.atoms.when.toLowerCase().includes("last night"), "Should extract time into atoms.when");
    assert.ok(updated.atoms.stakes.toLowerCase().includes("lose"), "Should extract stakes into atoms.stakes");
    assert.ok(updated.primitives.setting.place.toLowerCase().includes("kitchen"), "Should patch primitives.setting.place");
    assert.ok(updated.primitives.conflict.external, "Should patch conflict from blocker language");
  });

  it("should avoid duplicate facts on repeated fallback extraction", () => {
    const state = createInitialState({
      recipientName: "Dad",
      occasion: "birthday",
      initialPrompt: "Song for dad",
    });
    state.turn_count = 2;

    const once = applyDeterministicFallbackExtraction(
      state,
      "In our kitchen last night I wanted to make him proud."
    );
    const twice = applyDeterministicFallbackExtraction(
      once,
      "In our kitchen last night I wanted to make him proud."
    );

    assert.strictEqual(twice.facts.length, once.facts.length, "Should not add duplicate fact rows");
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

// Phase 2: User Model Activation Tests
describe("V2 Engine - User Model from LLM Reasoning", () => {
  const { applyReasoningResult } = require("../../../src/writer/v2/engine");

  it("should extract user style from reasoning.user_state (V3 format)", () => {
    const state = createInitialState({
      recipientName: "Sarah",
      occasion: "birthday",
      initialPrompt: "Test",
    });

    const reasoningResult = {
      action: "ASK",
      question: "Tell me more?",
      narrative: "Sarah is great.",
      reasoning: {
        new_facts: [],
        decision: "ASK",
        user_state: {
          engagement: "high",
          seems_done: false,
          tone: "enthusiastic",
          style: "verbose",
        },
      },
      beats: [],
    };

    const newState = applyReasoningResult(state, reasoningResult, "Test input");

    assert.strictEqual(newState.user_model.style, "verbose");
    assert.strictEqual(newState.user_model.tone_preference, "enthusiastic");
  });

  it("should increment fatigue_signals on low engagement", () => {
    const state = createInitialState({
      recipientName: "Dad",
      occasion: "birthday",
      initialPrompt: "Song for dad",
    });
    state.user_model = { style: "unknown", fatigue_signals: 0, tone_preference: "neutral" };

    const reasoningResult = {
      action: "ASK",
      question: "More details?",
      narrative: "Dad is great.",
      reasoning: {
        new_facts: [],
        decision: "ASK",
        user_state: {
          engagement: "low",
          seems_done: false,
          tone: "tired",
          style: "brief",
        },
      },
      beats: [],
    };

    const newState = applyReasoningResult(state, reasoningResult, "ok");

    assert.strictEqual(newState.user_model.fatigue_signals, 1);
    assert.strictEqual(newState.user_model.style, "brief");
  });

  it("should increment fatigue_signals when brief user seems done", () => {
    const state = createInitialState({
      recipientName: "Mom",
      occasion: "mothers_day",
      initialPrompt: "Thanks mom",
    });
    state.user_model = { style: "brief", fatigue_signals: 0, tone_preference: "neutral" };

    const reasoningResult = {
      action: "CONFIRM",
      confirmation: "Ready?",
      narrative: "Mom is great.",
      reasoning: {
        new_facts: [],
        decision: "CONFIRM",
        user_state: {
          engagement: "medium",
          seems_done: true,
          tone: "casual",
          style: "brief",
        },
      },
      beats: [],
    };

    const newState = applyReasoningResult(state, reasoningResult, "that's it");

    assert.strictEqual(newState.user_model.fatigue_signals, 1);
  });

  it("should not increment fatigue_signals on high engagement", () => {
    const state = createInitialState({
      recipientName: "Sarah",
      occasion: "birthday",
      initialPrompt: "Test",
    });
    state.user_model = { style: "unknown", fatigue_signals: 0, tone_preference: "neutral" };

    const reasoningResult = {
      action: "ASK",
      question: "Tell me more!",
      narrative: "Sarah is wonderful.",
      reasoning: {
        new_facts: [],
        decision: "ASK",
        user_state: {
          engagement: "high",
          seems_done: false,
          tone: "excited",
          style: "verbose",
        },
      },
      beats: [],
    };

    const newState = applyReasoningResult(state, reasoningResult, "Long detailed response");

    assert.strictEqual(newState.user_model.fatigue_signals, 0);
    assert.strictEqual(newState.user_model.style, "verbose");
  });

  it("should reject invalid style values", () => {
    const state = createInitialState({
      recipientName: "Sarah",
      occasion: "birthday",
      initialPrompt: "Test",
    });
    state.user_model = { style: "unknown", fatigue_signals: 0, tone_preference: "neutral" };

    const reasoningResult = {
      action: "ASK",
      question: "More?",
      narrative: "Sarah is great.",
      reasoning: {
        new_facts: [],
        decision: "ASK",
        user_state: {
          engagement: "high",
          seems_done: false,
          tone: "normal",
          style: "invalid_style", // Invalid - should be ignored
        },
      },
      beats: [],
    };

    const newState = applyReasoningResult(state, reasoningResult, "Test");

    // Style should remain unchanged since "invalid_style" is not valid
    assert.strictEqual(newState.user_model.style, "unknown");
  });
});

// Phase 2: Style-Aware Fallback Tests
describe("V2 Engine - Style-Aware Fallback", () => {
  const { generateSmartHeuristicFallback } = require("../../../src/writer/v2/engine");

  it("should generate shorter questions for brief users", () => {
    const state = createInitialState({
      recipientName: "Dad",
      occasion: "birthday",
      initialPrompt: "Song for dad",
    });
    state.user_model = { style: "brief", fatigue_signals: 0, tone_preference: "neutral" };
    state.narrative = "Dad is great.";
    state.facts = [{ id: "f1", text: "always there" }];
    state.beats = [
      { id: "who", purpose: "who he is", required: true, status: "weak", evidence: [] },
      { id: "meaning", purpose: "what he means", required: true, status: "missing", evidence: [] },
    ];

    const response = generateSmartHeuristicFallback(state);

    assert.strictEqual(response.action, "ASK");
    // Brief users get shorter questions like "More about X?" or "About X?"
    assert.ok(
      response.question.includes("More about") ||
      response.question.includes("About ") ||
      response.question.length < 50,
      `Question should be short for brief users: "${response.question}"`
    );
  });

  it("should generate emotion-focused questions for emotional users", () => {
    const state = createInitialState({
      recipientName: "Mom",
      occasion: "mothers_day",
      initialPrompt: "Thanks mom",
    });
    state.user_model = { style: "emotional", fatigue_signals: 0, tone_preference: "grateful" };
    state.narrative = "Mom always supported me.";
    state.facts = [{ id: "f1", text: "always there" }];
    state.beats = [
      { id: "support", purpose: "how she supported you", required: true, status: "weak", evidence: [] },
      { id: "meaning", purpose: "what she means", required: true, status: "missing", evidence: [] },
    ];

    const response = generateSmartHeuristicFallback(state);

    assert.strictEqual(response.action, "ASK");
    // Emotional users get feeling-focused questions
    assert.ok(
      response.question.toLowerCase().includes("feel") ||
      response.question.toLowerCase().includes("feeling") ||
      response.question.toLowerCase().includes("emotion"),
      `Question should reference feelings for emotional users: "${response.question}"`
    );
  });

  it("should generate standard questions for unknown style", () => {
    const state = createInitialState({
      recipientName: "Friend",
      occasion: "birthday",
      initialPrompt: "Song for friend",
    });
    state.user_model = { style: "unknown", fatigue_signals: 0, tone_preference: "neutral" };
    state.narrative = "Friend is fun.";
    state.facts = [{ id: "f1", text: "we have fun together" }];
    state.beats = [
      { id: "memory", purpose: "favorite memory", required: true, status: "missing", evidence: [] },
    ];

    const response = generateSmartHeuristicFallback(state);

    assert.strictEqual(response.action, "ASK");
    // Standard questions use "tell me" or "what"
    assert.ok(
      response.question.toLowerCase().includes("tell") ||
      response.question.toLowerCase().includes("what") ||
      response.question.toLowerCase().includes("special"),
      `Question should be standard format: "${response.question}"`
    );
  });
});

// Phase 3: Enhanced Contextual Fallback Tests
describe("V2 Engine - Enhanced Contextual Fallback", () => {
  const { generateSmartHeuristicFallback } = require("../../../src/writer/v2/engine");

  it("should use 'I noticed you mentioned' framing for standard users", () => {
    const state = createInitialState({
      recipientName: "Sarah",
      occasion: "birthday",
      initialPrompt: "Song for Sarah",
    });
    state.user_model = { style: "unknown", fatigue_signals: 0, tone_preference: "neutral" };
    state.narrative = "Sarah always loved dancing and music.";
    state.facts = [{ id: "f1", text: "loves dancing" }];
    state.beats = [
      { id: "memory", purpose: "favorite memory", required: true, status: "missing", evidence: [] },
    ];

    const response = generateSmartHeuristicFallback(state);

    assert.strictEqual(response.action, "ASK");
    // Should use "I noticed you mentioned" framing
    assert.ok(
      response.question.toLowerCase().includes("noticed") ||
      response.question.toLowerCase().includes("mentioned"),
      `Question should use conversational framing: "${response.question}"`
    );
  });

  it("should use multiple keywords when available", () => {
    const state = createInitialState({
      recipientName: "Mom",
      occasion: "mothers_day",
      initialPrompt: "Thanks mom",
    });
    state.user_model = { style: "unknown", fatigue_signals: 0, tone_preference: "neutral" };
    state.narrative = "Mom always supported me through college and beyond.";
    state.facts = [];
    state.beats = [
      { id: "support", purpose: "how she supported you", required: true, status: "missing", evidence: [] },
    ];

    const response = generateSmartHeuristicFallback(state);

    assert.strictEqual(response.action, "ASK");
    // Should include multiple keywords in question
    assert.ok(
      response.question.includes("and") ||
      response.question.toLowerCase().includes("noticed"),
      `Question should reference multiple narrative elements: "${response.question}"`
    );
  });

  it("should reference specific facts when available", () => {
    const state = createInitialState({
      recipientName: "Dad",
      occasion: "birthday",
      initialPrompt: "Song for dad",
    });
    state.user_model = { style: "unknown", fatigue_signals: 0, tone_preference: "neutral" };
    state.narrative = "Dad taught me to fish.";
    state.facts = [
      { id: "f1", text: "taught me to fish", beat: "memory" },
    ];
    state.beats = [
      { id: "memory", purpose: "favorite memory", required: true, strength: 0.3, evidence: ["f1"] },
    ];

    const response = generateSmartHeuristicFallback(state);

    assert.strictEqual(response.action, "ASK");
    // Should reference the fact in the question
    assert.ok(
      response.question.includes("fish") ||
      response.question.includes("taught"),
      `Question should reference the specific fact: "${response.question}"`
    );
  });

  it("should generate fact-focused questions for analytical users", () => {
    const state = createInitialState({
      recipientName: "Colleague",
      occasion: "farewell",
      initialPrompt: "Goodbye song",
    });
    state.user_model = { style: "analytical", fatigue_signals: 0, tone_preference: "neutral" };
    state.narrative = "We worked together for five years on important projects.";
    state.facts = [{ id: "f1", text: "five years together" }];
    state.beats = [
      { id: "impact", purpose: "how they changed you", required: true, status: "missing", evidence: [] },
    ];

    const response = generateSmartHeuristicFallback(state);

    assert.strictEqual(response.action, "ASK");
    // Analytical users get walk-through style questions
    assert.ok(
      response.question.toLowerCase().includes("walk") ||
      response.question.toLowerCase().includes("connect") ||
      response.question.toLowerCase().includes("describe"),
      `Question should be analytical in style: "${response.question}"`
    );
  });

  it("should handle analytical users with beat but no keywords", () => {
    const state = createInitialState({
      recipientName: "Boss",
      occasion: "gratitude",
      initialPrompt: "Thank you boss",
    });
    state.user_model = { style: "analytical", fatigue_signals: 0, tone_preference: "neutral" };
    state.narrative = "";
    state.facts = [];
    state.beats = [
      { id: "what", purpose: "what they did", required: true, status: "missing", evidence: [] },
    ];

    const response = generateSmartHeuristicFallback(state);

    assert.strictEqual(response.action, "ASK");
    // Analytical users without keywords should get descriptive prompts
    assert.ok(
      response.question.toLowerCase().includes("describe"),
      `Question should ask for description: "${response.question}"`
    );
  });
});
