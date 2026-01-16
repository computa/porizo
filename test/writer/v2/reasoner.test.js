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

    it("should normalize v3 updates to legacy fields", () => {
      const response = JSON.stringify({
        decision: { action: "ASK", confidence: 0.8 },
        event: { type: "birth", title: "Twin arrival", confidence: 0.9 },
        updates: {
          new_facts: [{ text: "we heard two heartbeats", beat: "turning_point" }],
          narrative: "They learned they were having twins after hearing two heartbeats.",
          beats: [
            { id: "turning_point", purpose: "the pivotal moment", required: true, strength: 0.7, evidence: ["f1"] },
          ],
        },
        output: { question: "What happened when you heard the two heartbeats?" },
      });

      const result = parseReasoningResponse(response);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.action, "ASK");
      assert.strictEqual(result.data.event.type, "birth");
      assert.ok(result.data.reasoning.new_facts.length > 0);
      assert.ok(result.data.beats.length > 0);
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

// Phase 4: Retry with Exponential Backoff Tests
describe("V2 Reasoner - Retry Logic", () => {
  const {
    RETRY_CONFIG,
    isRetryableError,
    getBackoffDelay,
  } = require("../../../src/writer/v2/reasoner");

  describe("RETRY_CONFIG", () => {
    it("should have sensible default values", () => {
      assert.strictEqual(RETRY_CONFIG.maxRetries, 3);
      assert.strictEqual(RETRY_CONFIG.baseDelayMs, 1000);
      assert.strictEqual(RETRY_CONFIG.maxDelayMs, 16000);
      assert.ok(Array.isArray(RETRY_CONFIG.retryableErrors));
      assert.ok(RETRY_CONFIG.retryableErrors.length > 0);
    });

    it("should include common transient error patterns", () => {
      const patterns = RETRY_CONFIG.retryableErrors;
      assert.ok(patterns.includes("timeout"), "Should include timeout");
      assert.ok(patterns.includes("rate limit"), "Should include rate limit");
      assert.ok(patterns.includes("429"), "Should include 429");
      // 500 now uses specific patterns to avoid false positives
      assert.ok(patterns.includes("status 500"), "Should include status 500");
      assert.ok(patterns.includes(" 500 "), "Should include 500 with spaces");
      assert.ok(patterns.includes("500 internal"), "Should include 500 internal");
      assert.ok(patterns.includes("502"), "Should include 502");
      assert.ok(patterns.includes("503"), "Should include 503");
      assert.ok(patterns.includes("504"), "Should include 504");
      assert.ok(patterns.includes("ECONNRESET"), "Should include ECONNRESET");
      assert.ok(patterns.includes("ENOTFOUND"), "Should include ENOTFOUND");
      assert.ok(patterns.includes("ECONNREFUSED"), "Should include ECONNREFUSED");
      assert.ok(patterns.includes("empty response"), "Should include empty response");
    });
  });

  describe("isRetryableError", () => {
    it("should return true for timeout errors", () => {
      assert.strictEqual(isRetryableError("Request timeout"), true);
      assert.strictEqual(isRetryableError("ETIMEDOUT"), true);
      assert.strictEqual(isRetryableError("Connection timeout exceeded"), true);
    });

    it("should return true for rate limit errors", () => {
      assert.strictEqual(isRetryableError("Rate limit exceeded"), true);
      assert.strictEqual(isRetryableError("rate_limit_error"), true);
      assert.strictEqual(isRetryableError("429 Too Many Requests"), true);
    });

    it("should return true for network errors", () => {
      assert.strictEqual(isRetryableError("ECONNRESET"), true);
      assert.strictEqual(isRetryableError("Network error"), true);
      assert.strictEqual(isRetryableError("503 Service Unavailable"), true);
    });

    it("should return true for overloaded errors", () => {
      assert.strictEqual(isRetryableError("API is overloaded"), true);
      assert.strictEqual(isRetryableError("Server overloaded, try again"), true);
    });

    it("should return true for specific 500 patterns but not false positives", () => {
      // Real 500 errors should be retryable
      assert.strictEqual(isRetryableError("HTTP status 500 Internal Server Error"), true);
      assert.strictEqual(isRetryableError("500 Internal Server Error"), true);
      assert.strictEqual(isRetryableError("Error 500 from server"), true);
      // False positives should NOT be retryable
      assert.strictEqual(isRetryableError("Invalid user ID: 1500"), false);
      assert.strictEqual(isRetryableError("Error processing record 500"), false);
    });

    it("should return true for empty response errors", () => {
      assert.strictEqual(isRetryableError("LLM returned empty response"), true);
    });

    it("should return false for parse errors", () => {
      assert.strictEqual(isRetryableError("JSON parse error"), false);
      assert.strictEqual(isRetryableError("Invalid JSON"), false);
    });

    it("should return false for validation errors", () => {
      assert.strictEqual(isRetryableError("Invalid action"), false);
      assert.strictEqual(isRetryableError("Missing required field"), false);
    });

    it("should return false for empty/null input", () => {
      assert.strictEqual(isRetryableError(null), false);
      assert.strictEqual(isRetryableError(undefined), false);
      assert.strictEqual(isRetryableError(""), false);
    });

    it("should be case insensitive", () => {
      assert.strictEqual(isRetryableError("TIMEOUT"), true);
      assert.strictEqual(isRetryableError("Rate Limit"), true);
      assert.strictEqual(isRetryableError("NETWORK ERROR"), true);
    });
  });

  describe("getBackoffDelay", () => {
    it("should return baseDelay for first attempt", () => {
      assert.strictEqual(getBackoffDelay(0), 1000);
    });

    it("should double delay for each attempt", () => {
      assert.strictEqual(getBackoffDelay(0), 1000);
      assert.strictEqual(getBackoffDelay(1), 2000);
      assert.strictEqual(getBackoffDelay(2), 4000);
      assert.strictEqual(getBackoffDelay(3), 8000);
    });

    it("should cap delay at maxDelayMs", () => {
      // At attempt 4: 1000 * 2^4 = 16000 (at cap)
      assert.strictEqual(getBackoffDelay(4), 16000);
      // At attempt 5: 1000 * 2^5 = 32000, but capped at 16000
      assert.strictEqual(getBackoffDelay(5), 16000);
      assert.strictEqual(getBackoffDelay(10), 16000);
    });
  });

  describe("reason retry behavior", () => {
    it("should retry on timeout errors and return retryCount", async () => {
      const state = createInitialState({
        recipientName: "Test",
        occasion: "birthday",
        initialPrompt: "Test",
      });

      let callCount = 0;
      const mockGenerateText = async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error("Request timeout");
        }
        // Third call succeeds
        return {
          text: JSON.stringify({
            action: "ASK",
            question: "Test question?",
            narrative: "Test narrative",
            reasoning: { decision: "ASK" },
          }),
        };
      };

      const result = await reason(state, "Test input", {
        maxRetries: 3,
        _sleepFn: async () => {}, // No-op sleep for fast tests
        _generateTextFn: mockGenerateText,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.retryCount, 2); // Two retries before success
      assert.strictEqual(callCount, 3); // 1 initial + 2 retries
    });

    it("should NOT retry on parse errors", async () => {
      const state = createInitialState({
        recipientName: "Test",
        occasion: "birthday",
        initialPrompt: "Test",
      });

      let callCount = 0;
      const mockGenerateText = async () => {
        callCount++;
        // Return unparseable response on every call
        return {
          text: "This is not JSON and cannot be parsed",
        };
      };

      const result = await reason(state, "Test input", {
        maxRetries: 3,
        _sleepFn: async () => {},
        _generateTextFn: mockGenerateText,
      });

      // Parse error should NOT trigger retry
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.retryCount, 0);
      assert.strictEqual(callCount, 1); // Only 1 call, no retries
    });

    it("should respect maxRetries option", async () => {
      const state = createInitialState({
        recipientName: "Test",
        occasion: "birthday",
        initialPrompt: "Test",
      });

      let callCount = 0;
      const mockGenerateText = async () => {
        callCount++;
        throw new Error("Rate limit exceeded");
      };

      const result = await reason(state, "Test input", {
        maxRetries: 1, // Override to only 1 retry
        _sleepFn: async () => {},
        _generateTextFn: mockGenerateText,
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.retryCount, 1);
      assert.strictEqual(callCount, 2); // 1 initial + 1 retry
      assert.ok(result.error.includes("Rate limit"));
    });

    it("should NOT retry non-retryable errors", async () => {
      const state = createInitialState({
        recipientName: "Test",
        occasion: "birthday",
        initialPrompt: "Test",
      });

      let callCount = 0;
      const mockGenerateText = async () => {
        callCount++;
        throw new Error("Invalid API key");
      };

      const result = await reason(state, "Test input", {
        maxRetries: 3,
        _sleepFn: async () => {},
        _generateTextFn: mockGenerateText,
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.retryCount, 0);
      assert.strictEqual(callCount, 1); // Only 1 call, no retries
    });

    it("should use exponential backoff delays", async () => {
      const state = createInitialState({
        recipientName: "Test",
        occasion: "birthday",
        initialPrompt: "Test",
      });

      const delays = [];
      const mockSleep = async (ms) => delays.push(ms);

      let callCount = 0;
      const mockGenerateText = async () => {
        callCount++;
        if (callCount <= 3) {
          throw new Error("Rate limit exceeded");
        }
        // Fourth call succeeds
        return {
          text: JSON.stringify({
            action: "ASK",
            question: "Test question?",
            narrative: "Test narrative",
            reasoning: { decision: "ASK" },
          }),
        };
      };

      const result = await reason(state, "Test input", {
        maxRetries: 3,
        _sleepFn: mockSleep,
        _generateTextFn: mockGenerateText,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(callCount, 4); // 1 initial + 3 retries
      // Exponential backoff: 1000 * 2^0, 1000 * 2^1, 1000 * 2^2
      assert.deepStrictEqual(delays, [1000, 2000, 4000]);
    });

    it("should track error history across retries", async () => {
      const state = createInitialState({
        recipientName: "Test",
        occasion: "birthday",
        initialPrompt: "Test",
      });

      let callCount = 0;
      const mockGenerateText = async () => {
        callCount++;
        if (callCount === 1) throw new Error("Request timeout");
        if (callCount === 2) throw new Error("Rate limit exceeded");
        throw new Error("Network error");
      };

      const result = await reason(state, "Test input", {
        maxRetries: 2,
        _sleepFn: async () => {},
        _generateTextFn: mockGenerateText,
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.errorHistory.length, 3);
      assert.strictEqual(result.errorHistory[0].error, "Request timeout");
      assert.strictEqual(result.errorHistory[1].error, "Rate limit exceeded");
      assert.strictEqual(result.errorHistory[2].error, "Network error");
    });

    it("should retry on empty response", async () => {
      const state = createInitialState({
        recipientName: "Test",
        occasion: "birthday",
        initialPrompt: "Test",
      });

      let callCount = 0;
      const mockGenerateText = async () => {
        callCount++;
        if (callCount === 1) {
          return { text: "" }; // Empty response
        }
        // Second call succeeds
        return {
          text: JSON.stringify({
            action: "ASK",
            question: "Test question?",
            narrative: "Test narrative",
          }),
        };
      };

      const result = await reason(state, "Test input", {
        maxRetries: 3,
        _sleepFn: async () => {},
        _generateTextFn: mockGenerateText,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(callCount, 2); // 1 empty + 1 success
      assert.strictEqual(result.retryCount, 1);
    });
  });
});
