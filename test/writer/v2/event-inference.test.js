/**
 * V2 Event Inference Tests
 *
 * Tests that the LLM can infer the true event type from story content,
 * not just rely on the stated occasion.
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");

describe("V2 Event Inference - Parsing", () => {
  const { parseReasoningResponse } = require("../../../src/writer/v2/reasoner");

  it("should parse event inference from LLM response", () => {
    const response = JSON.stringify({
      reasoning: { new_facts: [] },
      action: "ASK",
      question: "Tell me about your dad",
      narrative: "A story about Dad",
      event: {
        type: "loss",
        title: "Memorial for Dad",
        confidence: 0.85,
      },
    });

    const result = parseReasoningResponse(response);

    assert.strictEqual(result.success, true);
    assert.ok(result.data.event, "Should have event inference");
    assert.strictEqual(result.data.event.type, "loss");
    assert.strictEqual(result.data.event.confidence, 0.85);
  });

  it("should accept response without event when not inferrable", () => {
    const response = JSON.stringify({
      reasoning: { new_facts: [] },
      action: "ASK",
      question: "Tell me more",
      narrative: "Starting...",
      // No event - not enough info yet
    });

    const result = parseReasoningResponse(response);
    assert.strictEqual(result.success, true);
    assert.ok(!result.data.event, "Should not have event if not provided");
  });

  it("should ignore event with low confidence", () => {
    const response = JSON.stringify({
      reasoning: { new_facts: [] },
      action: "ASK",
      question: "Tell me more",
      narrative: "A story",
      event: {
        type: "loss",
        title: "Maybe loss?",
        confidence: 0.3, // Below threshold
      },
    });

    const result = parseReasoningResponse(response);
    assert.strictEqual(result.success, true);
    // Event should be parsed but application will check confidence
    assert.ok(result.data.event, "Should parse event even with low confidence");
    assert.strictEqual(result.data.event.confidence, 0.3);
  });
});

describe("V2 Event Inference - State Application", () => {
  const { applyReasoningResult } = require("../../../src/writer/v2/engine");
  const { createInitialState } = require("../../../src/writer/v2/state");

  it("should apply high-confidence event inference to state", () => {
    const state = createInitialState({
      recipientName: "Dad",
      occasion: "birthday",
      initialPrompt: "Song for dad",
    });
    state.event = { type: "birthday", occasion: "birthday" };

    const reasoningResult = {
      reasoning: { new_facts: [] },
      action: "ASK",
      question: "Tell me more",
      narrative: "A memorial for Dad",
      event: {
        type: "loss",
        title: "Memorial for Dad",
        confidence: 0.85,
      },
    };

    const newState = applyReasoningResult(state, reasoningResult, "test input");

    // Should update event type based on high-confidence inference
    assert.strictEqual(newState.event.type, "loss");
    assert.strictEqual(newState.event.title, "Memorial for Dad");
    assert.strictEqual(newState.event.inferred_confidence, 0.85);
    // Original occasion should be preserved
    assert.strictEqual(newState.event.occasion, "birthday");
  });

  it("should NOT apply low-confidence event inference", () => {
    const state = createInitialState({
      recipientName: "Dad",
      occasion: "birthday",
      initialPrompt: "Song for dad",
    });
    state.event = { type: "birthday", occasion: "birthday" };

    const reasoningResult = {
      reasoning: { new_facts: [] },
      action: "ASK",
      question: "Tell me more",
      narrative: "Maybe about loss?",
      event: {
        type: "loss",
        title: "Maybe loss?",
        confidence: 0.5, // Below 0.7 threshold
      },
    };

    const newState = applyReasoningResult(state, reasoningResult, "test input");

    // Should NOT update event type due to low confidence
    assert.strictEqual(newState.event.type, "birthday");
  });
});
