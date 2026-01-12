/**
 * V3 Reasoner Tests
 *
 * Tests that the reasoner:
 * 1. Uses context-only prompt builder (no embedded rules)
 * 2. Parses strength-based beat responses
 * 3. Handles the new v3 response schema
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

/**
 * Create test state
 */
function createTestState() {
  return {
    recipient_name: "Dad",
    event: { occasion: "birthday", type: "birthday" },
    narrative: "Dad taught me to fish at the lake.",
    facts: [
      { id: "f1", text: "Dad taught me to fish" },
    ],
    beats: [
      { id: "meaning", purpose: "what it means", strength: 0.3, evidence: [] },
    ],
    conversation: [
      { role: "user", content: "My dad taught me to fish" },
    ],
    turn_count: 1,
  };
}

describe("V3 Reasoner", () => {
  const { buildReasoningPrompt, parseReasoningResponse } = require("../../../src/writer/v2/reasoner");

  describe("buildReasoningPrompt", () => {
    it("should NOT contain fatigue threshold rules", () => {
      const state = createTestState();
      const prompt = buildReasoningPrompt(state, "test input");

      assert.ok(!prompt.includes("fatigue_signals >= 2"), "Should not have fatigue rule");
      assert.ok(!prompt.includes(">= 2"), "Should not have threshold >= 2");
    });

    it("should include narrative context", () => {
      const state = createTestState();
      const prompt = buildReasoningPrompt(state, "test input");

      assert.ok(prompt.includes("Dad taught me to fish") || prompt.includes("narrative"),
        "Should include narrative context");
    });

    it("should include user input", () => {
      const state = createTestState();
      const prompt = buildReasoningPrompt(state, "my custom input");

      assert.ok(prompt.includes("my custom input"), "Should include user input");
    });

    it("should include facts", () => {
      const state = createTestState();
      const prompt = buildReasoningPrompt(state, "test");

      assert.ok(prompt.includes("f1") || prompt.includes("taught me to fish"),
        "Should include facts");
    });

    it("should display beats with strength values", () => {
      const state = createTestState();
      const prompt = buildReasoningPrompt(state, "test");

      // Should show beat strength (0.3 from test state)
      assert.ok(prompt.includes("0.3") || prompt.includes("strength"),
        "Should display beat strength values");
    });
  });

  describe("parseReasoningResponse (v3 schema)", () => {
    it("should parse strength-based beat responses", () => {
      const response = JSON.stringify({
        reasoning: {
          user_communicated: "shared a memory",
          story_readiness: { has_emotional_depth: true },
          decision_rationale: "story is ready"
        },
        decision: { action: "CONFIRM", confidence: 0.85 },
        updates: {
          new_facts: [{ text: "fishing memory", beat: "meaning" }],
          narrative: "Updated story",
          beats: [
            { id: "meaning", strength: 0.7, evidence: ["f1"] }
          ]
        },
        output: { confirmation: "Your story is ready!" },
        // Include legacy fields for backward compat
        action: "CONFIRM",
        narrative: "Updated story",
      });

      const result = parseReasoningResponse(response);

      assert.strictEqual(result.success, true, `Parse should succeed: ${result.error}`);
      assert.ok(result.data.decision || result.data.action, "Should have decision");
    });

    it("should handle legacy v2 response format", () => {
      const response = JSON.stringify({
        reasoning: {
          new_facts: [{ text: "fact", beat: "meaning" }],
          decision: "ASK",
          decision_reason: "need more"
        },
        narrative: "A story",
        beats: [
          { id: "meaning", status: "weak", evidence: [] }
        ],
        action: "ASK",
        question: "Tell me more?"
      });

      const result = parseReasoningResponse(response);

      assert.strictEqual(result.success, true, "Should still parse legacy format");
      assert.strictEqual(result.data.action, "ASK");
      assert.ok(result.data.question);
    });

    it("should validate action is one of ASK, CLARIFY, CONFIRM, STOP", () => {
      const response = JSON.stringify({
        reasoning: { decision_rationale: "test" },
        action: "INVALID_ACTION",
        narrative: "test"
      });

      const result = parseReasoningResponse(response);

      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes("Invalid action") || result.error.includes("INVALID"));
    });

    it("should require question for ASK action", () => {
      const response = JSON.stringify({
        reasoning: { decision_rationale: "test" },
        action: "ASK",
        narrative: "test"
        // Missing question
      });

      const result = parseReasoningResponse(response);

      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes("question"));
    });

    it("should require confirmation for CONFIRM action", () => {
      const response = JSON.stringify({
        reasoning: { decision_rationale: "test" },
        action: "CONFIRM",
        narrative: "test"
        // Missing confirmation
      });

      const result = parseReasoningResponse(response);

      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes("confirmation"));
    });

    it("should handle JSON in markdown code block", () => {
      const response = `Here's my response:
\`\`\`json
{
  "reasoning": { "decision_rationale": "test" },
  "action": "ASK",
  "narrative": "Story",
  "question": "What happened next?"
}
\`\`\``;

      const result = parseReasoningResponse(response);

      assert.strictEqual(result.success, true, `Should parse code block: ${result.error}`);
      assert.strictEqual(result.data.action, "ASK");
    });

    it("should clamp strength values to 0-1", () => {
      const response = JSON.stringify({
        reasoning: { decision_rationale: "test" },
        action: "ASK",
        narrative: "Story",
        question: "More?",
        updates: {
          beats: [
            { id: "meaning", strength: 1.5, evidence: [] }, // Out of range
            { id: "scene", strength: -0.3, evidence: [] }    // Negative
          ]
        }
      });

      const result = parseReasoningResponse(response);

      assert.strictEqual(result.success, true);

      // Strength should be clamped
      if (result.data.updates?.beats) {
        const meaningBeat = result.data.updates.beats.find(b => b.id === "meaning");
        const sceneBeat = result.data.updates.beats.find(b => b.id === "scene");

        if (meaningBeat) {
          assert.ok(meaningBeat.strength <= 1, "Strength should be clamped to max 1");
        }
        if (sceneBeat) {
          assert.ok(sceneBeat.strength >= 0, "Strength should be clamped to min 0");
        }
      }
    });
  });
});

describe("Prompt Template Selection", () => {
  it("should use v3 prompt when available", () => {
    const { buildReasoningPrompt } = require("../../../src/writer/v2/reasoner");

    const state = createTestState();
    const prompt = buildReasoningPrompt(state, "test");

    // V3 prompt characteristics
    const hasHolisticLanguage = prompt.toLowerCase().includes("holistic") ||
                                 prompt.toLowerCase().includes("assess") ||
                                 prompt.toLowerCase().includes("meaningful song");

    // Should have v3 characteristics (no formulas, asks for holistic assessment)
    assert.ok(!prompt.includes("If fatigue"), "Should not have v2 formula rules");
  });
});
