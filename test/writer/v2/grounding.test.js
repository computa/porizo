/**
 * V2 Grounding Validation Tests
 *
 * Tests that narrative is grounded in facts and that
 * ungrounded content is detected and corrected.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

describe("V2 Grounding Validation - Detection", () => {
  const { isStateGrounded, createInitialState } = require("../../../src/writer/v2/state");

  it("should detect ungrounded narrative", () => {
    const state = createInitialState({
      recipientName: "Dad",
      occasion: "birthday",
      initialPrompt: "Song for dad",
    });

    // Add a fact
    state.facts = [{ id: "f1", text: "Dad loves fishing", source_turn: 1 }];

    // Narrative mentions things not in facts
    state.narrative = "Dad loves fishing and always took me camping in the mountains.";

    const grounded = isStateGrounded(state);
    assert.strictEqual(grounded, false, "Should detect 'camping' and 'mountains' as ungrounded");
  });

  it("should accept fully grounded narrative", () => {
    const state = createInitialState({
      recipientName: "Dad",
      occasion: "birthday",
      initialPrompt: "Song for dad",
    });

    state.facts = [
      { id: "f1", text: "Dad loves fishing", source_turn: 1 },
      { id: "f2", text: "He taught me to fish at the lake", source_turn: 2 },
    ];

    state.narrative = "Dad loves fishing. He taught me to fish at the lake.";

    const grounded = isStateGrounded(state);
    assert.strictEqual(grounded, true, "Narrative only contains info from facts");
  });

  it("should allow common connecting words not in facts", () => {
    const state = createInitialState({
      recipientName: "Mom",
      occasion: "graduation",
      initialPrompt: "Song for mom",
    });

    state.facts = [
      { id: "f1", text: "Mom helped me study hard", source_turn: 1 },
    ];

    // "always" and "through" are allowed connecting words
    // Only "Mom", "helped", "study", "hard" need to be grounded
    state.narrative = "Mom always helped me study hard through everything.";

    const grounded = isStateGrounded(state);
    assert.strictEqual(grounded, true, "Should allow common connecting words");
  });
});

describe("V2 Grounding Validation - Enforcement", () => {
  const { enforceGrounding } = require("../../../src/writer/v2/engine");

  it("should return state unchanged if already grounded", () => {
    const state = {
      facts: [
        { id: "f1", text: "Dad loves fishing" },
        { id: "f2", text: "He is turning 60" },
      ],
      narrative: "Dad loves fishing. He is turning 60.",
    };

    const result = enforceGrounding(state);

    // Should be unchanged
    assert.strictEqual(result.narrative, state.narrative);
    assert.ok(!result.grounding_enforced, "Should not flag as enforced");
  });

  it("should rebuild ungrounded narrative from facts", () => {
    const state = {
      facts: [
        { id: "f1", text: "Dad loves fishing" },
        { id: "f2", text: "He is turning 60" },
      ],
      narrative: "Dad loves fishing, camping, and hiking in the mountains.",
    };

    const result = enforceGrounding(state);

    // Fixed narrative should not contain ungrounded content
    assert.ok(!result.narrative.includes("camping"), "Should remove 'camping'");
    assert.ok(!result.narrative.includes("mountains"), "Should remove 'mountains'");
    assert.ok(!result.narrative.includes("hiking"), "Should remove 'hiking'");
    // Should be rebuilt from facts
    assert.ok(
      result.narrative.includes("fishing") || result.narrative.includes("60"),
      "Should contain content from facts"
    );
    assert.strictEqual(result.grounding_enforced, true, "Should flag as enforced");
  });

  it("should preserve timestamp on enforcement", () => {
    const state = {
      facts: [{ id: "f1", text: "Some fact" }],
      narrative: "Completely hallucinated unrelated content about dragons.",
      updated_at: "2024-01-01T00:00:00.000Z",
    };

    const result = enforceGrounding(state);

    assert.ok(result.updated_at, "Should have updated_at");
    assert.notStrictEqual(
      result.updated_at,
      state.updated_at,
      "Timestamp should be updated"
    );
  });
});
