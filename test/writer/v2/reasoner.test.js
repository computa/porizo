/**
 * V2 Reasoner Tests
 * Tests for the unified reasoning module
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  buildReasoningPrompt,
  parseReasoningResponse,
  reason,
} = require("../../../src/writer/v2/reasoner");

const { createInitialState } = require("../../../src/writer/v2/state");

describe("V2 Reasoner", () => {
  describe("buildReasoningPrompt", () => {
    it("should build prompt with all state context", () => {
      const state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Song for my daughter",
      });
      state.narrative = "Sarah is turning one.";
      state.beats = [
        { id: "discovery", purpose: "how it started", required: true, status: "missing", evidence: [] },
      ];

      const prompt = buildReasoningPrompt(state, "She loves playing with blocks");

      assert.ok(prompt.includes("Sarah"), "Should include recipient name");
      assert.ok(prompt.includes("birthday"), "Should include occasion");
      assert.ok(prompt.includes("Sarah is turning one"), "Should include narrative");
      assert.ok(prompt.includes("She loves playing with blocks"), "Should include user input");
      assert.ok(prompt.includes("discovery"), "Should include beats");
    });

    it("should handle empty narrative", () => {
      const state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Test",
      });

      const prompt = buildReasoningPrompt(state, "First input");
      assert.ok(prompt.includes("First input"));
    });

    it("should include conversation history", () => {
      const state = createInitialState({
        recipientName: "Mom",
        occasion: "mothers_day",
        initialPrompt: "Thanks mom",
      });
      state.conversation = [
        { role: "assistant", content: "Tell me about your mom" },
        { role: "user", content: "She always supported me" },
      ];

      const prompt = buildReasoningPrompt(state, "Even when I failed");

      assert.ok(prompt.includes("Tell me about your mom"), "Should include assistant turn");
      assert.ok(prompt.includes("She always supported me"), "Should include user turn");
      assert.ok(prompt.includes("Even when I failed"), "Should include new input");
    });
  });

  describe("parseReasoningResponse", () => {
    it("should parse valid JSON response", () => {
      const response = JSON.stringify({
        reasoning: {
          new_facts: [{ text: "plays with blocks", beat: "character" }],
          user_style: "verbose",
          fatigue_signals: 0,
          beat_assessment: { discovery: { status: "missing", reason: "not mentioned" } },
          decision: "ASK",
          decision_reason: "Need more story details",
        },
        narrative: "Sarah is turning one. She loves playing with blocks.",
        beats: [{ id: "discovery", purpose: "how it started", required: true, status: "missing", evidence: [] }],
        user_model: { style: "verbose", fatigue_signals: 0, tone_preference: "celebratory" },
        action: "ASK",
        question: "What moment stands out from her first year?",
      });

      const result = parseReasoningResponse(response);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.action, "ASK");
      assert.strictEqual(result.data.question, "What moment stands out from her first year?");
      assert.ok(result.data.reasoning.new_facts.length > 0);
    });

    it("should handle malformed JSON gracefully", () => {
      const response = "This is not JSON";
      const result = parseReasoningResponse(response);

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
    });

    it("should extract JSON from markdown code blocks", () => {
      const response = `Here's my analysis:

\`\`\`json
{
  "action": "ASK",
  "question": "Test question",
  "narrative": "Test narrative",
  "beats": [],
  "reasoning": { "decision": "ASK", "decision_reason": "test" },
  "user_model": { "style": "brief", "fatigue_signals": 0, "tone_preference": "neutral" }
}
\`\`\`

That's my response.`;

      const result = parseReasoningResponse(response);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.action, "ASK");
    });

    it("should validate required fields", () => {
      const response = JSON.stringify({
        action: "ASK",
        // Missing: question, narrative, beats, reasoning
      });

      const result = parseReasoningResponse(response);

      // Should fail validation
      assert.strictEqual(result.success, false);
    });

    it("should require question when action is ASK", () => {
      const response = JSON.stringify({
        action: "ASK",
        narrative: "Test",
        reasoning: { decision: "ASK", decision_reason: "test" },
        // Missing question
      });

      const result = parseReasoningResponse(response);

      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes("question"));
    });

    it("should accept CONFIRM action with confirmation message", () => {
      const response = JSON.stringify({
        action: "CONFIRM",
        narrative: "The story so far...",
        reasoning: { decision: "CONFIRM", decision_reason: "All beats covered" },
        user_model: { style: "verbose", fatigue_signals: 0, tone_preference: "celebratory" },
        confirmation: "Does this capture your story?",
      });

      const result = parseReasoningResponse(response);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.action, "CONFIRM");
    });

    it("should reject invalid action values", () => {
      const response = JSON.stringify({
        action: "INVALID_ACTION",
        narrative: "Test",
        reasoning: { decision: "INVALID", decision_reason: "test" },
      });

      const result = parseReasoningResponse(response);

      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes("Invalid action"));
    });

    it("should require confirmation when action is CONFIRM", () => {
      const response = JSON.stringify({
        action: "CONFIRM",
        narrative: "The story",
        reasoning: { decision: "CONFIRM", decision_reason: "test" },
        // Missing confirmation message
      });

      const result = parseReasoningResponse(response);

      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes("confirmation"));
    });

    it("should require question when action is CLARIFY", () => {
      const response = JSON.stringify({
        action: "CLARIFY",
        narrative: "Test",
        reasoning: { decision: "CLARIFY", decision_reason: "test" },
        // Missing question
      });

      const result = parseReasoningResponse(response);

      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes("question"));
    });

    it("should reject action that is not a valid action value", () => {
      // V3: Action validation catches non-string values via includes() check
      const response = JSON.stringify({
        action: { type: "ASK" }, // Object won't be in allowed array
        narrative: "Test",
        reasoning: { decision: "ASK" },
      });

      const result = parseReasoningResponse(response);

      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes("Invalid action"), "Should fail with invalid action");
    });

    // V3: We trust LLM on narrative type - only structure matters
    it("should accept narrative that is not a string (v3 trusts LLM)", () => {
      const response = JSON.stringify({
        action: "ASK",
        narrative: 123, // V3 trusts LLM internals
        reasoning: { decision: "ASK" },
        question: "Test?",
      });

      const result = parseReasoningResponse(response);

      // V3: Should pass - we only validate required action/output fields
      assert.strictEqual(result.success, true, "V3 trusts LLM on narrative type");
    });

    // V3: We trust LLM on reasoning structure
    it("should accept reasoning that is not an object (v3 trusts LLM)", () => {
      const response = JSON.stringify({
        action: "ASK",
        narrative: "Test",
        reasoning: "string reasoning", // V3 trusts LLM internals
        question: "Test?",
      });

      const result = parseReasoningResponse(response);

      // V3: Should pass - we only validate required action/output fields
      assert.strictEqual(result.success, true, "V3 trusts LLM on reasoning structure");
    });
  });

  describe("reason (integration)", () => {
    // Skip integration tests if LLM not available
    const llmAvailable = process.env.ANTHROPIC_API_KEY;

    it("should return valid reasoning result with LLM", async function() {
      if (!llmAvailable) {
        console.log("  [skipped] LLM not available");
        return;
      }

      const state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Song for my daughter's first birthday",
      });

      const result = await reason(state, "She took her first steps last month!");

      assert.ok(result.success, "Should succeed");
      assert.ok(["ASK", "CLARIFY", "CONFIRM", "STOP"].includes(result.data.action));
      assert.ok(result.data.narrative);
      assert.ok(result.data.reasoning);
    });

    it("should handle LLM unavailability gracefully", async function() {
      // This test runs without mocking - just checks the fallback path exists
      const state = createInitialState({
        recipientName: "Test",
        occasion: "test",
        initialPrompt: "Test",
      });

      // The function should not throw even if LLM fails
      try {
        const result = await reason(state, "Test input");
        // Either success or graceful failure
        assert.ok(result.success === true || result.success === false);
      } catch (err) {
        assert.fail("reason() should not throw: " + err.message);
      }
    });
  });
});
