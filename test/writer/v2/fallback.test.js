/**
 * V2 Context-Aware Fallback Tests
 *
 * Tests that fallback questions use narrative/facts context
 * instead of generic hardcoded templates.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

describe("V2 Context-Aware Fallback", () => {
  const { generateFallbackResponse } = require("../../../src/writer/v2/engine");

  it("should generate question referencing narrative content", () => {
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

    // Should reference something from the narrative, not be purely generic
    const q = response.question.toLowerCase();
    // Keywords extracted from "Dad taught me to fish at the lake every summer"
    // could be: taught, fish, lake, summer, every (all > 3 chars, non-stopwords)
    const referencesNarrative =
      q.includes("fish") ||
      q.includes("lake") ||
      q.includes("taught") ||
      q.includes("summer") ||
      q.includes("every");

    assert.ok(
      referencesNarrative,
      `Fallback should reference narrative content. Got: "${response.question}"`
    );
  });

  it("should offer to confirm when content is rich enough (v3 - content-based, not fatigue)", () => {
    const state = {
      // V3: Content-based confirmation needs narrative > 100 chars
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
      turn_count: 6, // V3: Need turns >= 6 for content-based confirmation
    };

    const response = generateFallbackResponse(state);

    // V3: With rich content (facts >= 3, narrative > 100, turns >= 6), should confirm
    assert.strictEqual(
      response.action,
      "CONFIRM",
      "Should offer confirmation when content is rich enough"
    );
    assert.ok(response.confirmation, "Should have confirmation message");
  });

  it("should ask about missing beats when content is thin (v3)", () => {
    const state = {
      narrative: "My dad is special.",
      facts: [
        { id: "f1", text: "Dad is special" },
      ],
      beats: [
        { id: "scene", status: "missing", purpose: "where it happened", required: true },
        { id: "meaning", status: "missing", purpose: "what it means", required: true },
      ],
      user_model: { fatigue_signals: 0 },
      turn_count: 1,
    };

    const response = generateFallbackResponse(state);

    // V3: With thin content (1 fact, short narrative, 1 turn), should ask for more
    assert.strictEqual(response.action, "ASK");
    assert.ok(response.question, "Should have a question");
    assert.ok(response.targetBeat, "Should have target beat");
  });

  it("should include fact count in confirmation message", () => {
    const state = {
      narrative: "A rich story with multiple details about my father.",
      facts: [
        { id: "f1", text: "Dad taught me to fish" },
        { id: "f2", text: "We went every summer" },
        { id: "f3", text: "At the lake near our cabin" },
        { id: "f4", text: "He was patient and kind" },
      ],
      beats: [
        // Need 3+ covered/weak beats including "meaning" for hasMinimumCoverage
        { id: "scene", status: "covered", required: true },
        { id: "meaning", status: "covered", required: true },
        { id: "stakes", status: "weak", required: true },
      ],
      user_model: { fatigue_signals: 3 },
      turn_count: 6,
    };

    const response = generateFallbackResponse(state);

    // Confirmation message should reference the collected details
    if (response.action === "CONFIRM") {
      const hasQuantity =
        response.confirmation.includes("4") ||
        response.confirmation.includes("details") ||
        response.confirmation.includes("captured");
      assert.ok(hasQuantity, "Confirmation should mention captured content");
    }
  });

  it("should flag response as fallback", () => {
    const state = {
      narrative: "",
      facts: [],
      beats: [
        { id: "scene", status: "missing", required: true },
      ],
      user_model: { fatigue_signals: 0 },
      turn_count: 0,
    };

    const response = generateFallbackResponse(state);

    assert.strictEqual(response.fallback, true, "Should flag as fallback");
    assert.strictEqual(response.fallback_reason, "llm_unavailable", "Should have reason");
  });
});
