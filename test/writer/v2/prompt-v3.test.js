/**
 * V3 Prompt Structure Tests
 *
 * Tests that the new v3 prompt:
 * 1. Does NOT contain hardcoded decision rules
 * 2. Asks for holistic assessment
 * 3. Requests strength scores instead of categorical status
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");

/**
 * Create test state for prompt building
 */
function createTestState() {
  return {
    recipient_name: "Dad",
    event: { occasion: "birthday", type: "birthday" },
    narrative: "Dad taught me to fish at the lake every summer.",
    facts: [
      { id: "f1", text: "Dad taught me to fish" },
      { id: "f2", text: "We went to the lake every summer" },
    ],
    beats: [
      { id: "scene", purpose: "where and when", strength: 0.7, evidence: ["f2"] },
      { id: "meaning", purpose: "what it means", strength: 0.3, evidence: [] },
      { id: "stakes", purpose: "what was at risk", strength: 0, evidence: [] },
    ],
    conversation: [
      { role: "user", content: "My dad taught me to fish" },
      { role: "assistant", content: "That sounds like a special memory. Where did you go fishing?" },
      { role: "user", content: "At the lake every summer" },
    ],
    user_model: {
      style: "brief",
      engagement: "high",
      tone: "reflective",
    },
    turn_count: 2,
  };
}

describe("V3 Prompt Structure", () => {
  const { buildContextPrompt } = require("../../../src/writer/v2/prompts/builder");

  describe("No Hardcoded Decision Rules", () => {
    it("should NOT contain fatigue threshold rules", () => {
      const state = createTestState();
      const prompt = buildContextPrompt(state, "test input");

      // Should NOT have numeric thresholds
      assert.ok(!prompt.includes(">= 2"), "Should not have fatigue threshold >= 2");
      assert.ok(!prompt.includes("fatigue_signals >= 2"), "Should not have fatigue rule");
      assert.ok(!prompt.includes("fatigue >= 2"), "Should not have fatigue rule variant");
    });

    it("should NOT contain beat count threshold rules", () => {
      const state = createTestState();
      const prompt = buildContextPrompt(state, "test input");

      // Should NOT have beat count thresholds
      assert.ok(!prompt.includes("< 3 beats"), "Should not have beat count threshold");
      assert.ok(!prompt.includes("at least 3 beats"), "Should not have beat minimum");
      assert.ok(!prompt.includes("AND at least"), "Should not embed compound rules");
    });

    it("should NOT contain if-then decision formulas", () => {
      const state = createTestState();
      const prompt = buildContextPrompt(state, "test input");

      // Should NOT have embedded if-then rules
      assert.ok(!prompt.includes("If fatigue"), "Should not embed if-fatigue rules");
      assert.ok(!prompt.includes("If all required beats"), "Should not embed beat formula");
    });
  });

  describe("Holistic Assessment Request", () => {
    it("should ask for holistic story assessment", () => {
      const state = createTestState();
      const prompt = buildContextPrompt(state, "test input");

      // Should ask for holistic judgment
      const hasHolisticLanguage =
        prompt.toLowerCase().includes("holistic") ||
        prompt.toLowerCase().includes("assess") ||
        prompt.toLowerCase().includes("evaluate");

      assert.ok(hasHolisticLanguage, "Should ask for holistic judgment");
    });

    it("should frame quality in terms of song output", () => {
      const state = createTestState();
      const prompt = buildContextPrompt(state, "test input");

      // Should reference the end goal (meaningful song)
      const hasSongContext =
        prompt.toLowerCase().includes("meaningful song") ||
        prompt.toLowerCase().includes("personalized song") ||
        prompt.toLowerCase().includes("emotional depth");

      assert.ok(hasSongContext, "Should frame quality in terms of song output");
    });

    it("should ask about story readiness", () => {
      const state = createTestState();
      const prompt = buildContextPrompt(state, "test input");

      // Should ask about story readiness
      const hasReadinessLanguage =
        prompt.toLowerCase().includes("readiness") ||
        prompt.toLowerCase().includes("ready") ||
        prompt.toLowerCase().includes("enough");

      assert.ok(hasReadinessLanguage, "Should ask about story readiness");
    });
  });

  describe("Strength-Based Beat Schema", () => {
    it("should request numeric strength assessment", () => {
      const state = createTestState();
      const prompt = buildContextPrompt(state, "test input");

      // Should mention strength or 0-1 scale
      const hasStrengthLanguage =
        prompt.includes("strength") ||
        prompt.includes("0.0-1.0") ||
        prompt.includes("0-1");

      assert.ok(hasStrengthLanguage, "Should request numeric strength assessment");
    });

    it("should display beats with strength values", () => {
      const state = createTestState();
      const prompt = buildContextPrompt(state, "test input");

      // Should show beat strength values from state
      assert.ok(prompt.includes("0.7") || prompt.includes("0.3") || prompt.includes("0"),
        "Should display beat strength values");
    });
  });

  describe("Context Inclusion", () => {
    it("should include recipient name", () => {
      const state = createTestState();
      const prompt = buildContextPrompt(state, "test input");

      assert.ok(prompt.includes("Dad"), "Should include recipient name");
    });

    it("should include occasion", () => {
      const state = createTestState();
      const prompt = buildContextPrompt(state, "test input");

      assert.ok(prompt.includes("birthday"), "Should include occasion");
    });

    it("should include narrative", () => {
      const state = createTestState();
      const prompt = buildContextPrompt(state, "test input");

      assert.ok(prompt.includes("Dad taught me to fish"), "Should include narrative");
    });

    it("should include facts", () => {
      const state = createTestState();
      const prompt = buildContextPrompt(state, "test input");

      assert.ok(prompt.includes("f1") || prompt.includes("taught me to fish"),
        "Should include facts");
    });

    it("should include conversation history", () => {
      const state = createTestState();
      const prompt = buildContextPrompt(state, "test input");

      assert.ok(prompt.includes("lake every summer") || prompt.includes("Where did you go"),
        "Should include conversation history");
    });

    it("should include user input", () => {
      const state = createTestState();
      const prompt = buildContextPrompt(state, "test input");

      assert.ok(prompt.includes("test input"), "Should include user input");
    });
  });

  describe("Output Format", () => {
    it("should specify JSON output format", () => {
      const state = createTestState();
      const prompt = buildContextPrompt(state, "test input");

      assert.ok(prompt.toLowerCase().includes("json"), "Should specify JSON output");
    });

    it("should request decision with action field", () => {
      const state = createTestState();
      const prompt = buildContextPrompt(state, "test input");

      assert.ok(prompt.includes("action") &&
        (prompt.includes("ASK") || prompt.includes("CONFIRM")),
        "Should request action field");
    });

    it("should request confidence score", () => {
      const state = createTestState();
      const prompt = buildContextPrompt(state, "test input");

      assert.ok(prompt.toLowerCase().includes("confidence"),
        "Should request confidence score");
    });
  });
});
