/**
 * V2 Contextual Beat Priority Tests
 *
 * V3: Beat priority follows LLM's contextual assessment via weak_elements,
 * not a hardcoded priority array. The LLM understands story context and
 * can prioritize beats that make sense for this specific story.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

describe("Contextual Beat Priority", () => {
  const { getNextBeatFromLLM } = require("../../../src/writer/v2/quality");

  describe("getNextBeatFromLLM", () => {
    it("should use LLM weak_elements order, not hardcoded priority", () => {
      const llmReasoning = {
        story_readiness: {
          weak_elements: ["stakes", "scene"], // LLM says stakes is more important
        },
      };
      const state = {
        beats: [
          { id: "scene", strength: 0.2, required: true },
          { id: "stakes", strength: 0.1, required: true },
          { id: "meaning", strength: 0.3, required: true },
        ],
      };

      const nextBeat = getNextBeatFromLLM(state, llmReasoning);

      // Should follow LLM order: stakes first (even though hardcoded would prefer meaning or scene)
      assert.strictEqual(nextBeat.id, "stakes");
    });

    it("should skip weak_elements that are already strong enough", () => {
      const llmReasoning = {
        story_readiness: {
          weak_elements: ["stakes", "scene"], // LLM says stakes and scene are weak
        },
      };
      const state = {
        beats: [
          { id: "stakes", strength: 0.8, required: true }, // Actually strong now
          { id: "scene", strength: 0.2, required: true },
          { id: "meaning", strength: 0.3, required: true },
        ],
      };

      const nextBeat = getNextBeatFromLLM(state, llmReasoning);

      // Should skip stakes (now strong) and use scene
      assert.strictEqual(nextBeat.id, "scene");
    });

    it("should fallback to lowest strength if LLM doesn't specify weak_elements", () => {
      const llmReasoning = {}; // No weak_elements
      const state = {
        beats: [
          { id: "scene", strength: 0.5, required: true },
          { id: "stakes", strength: 0.1, required: true }, // Lowest
          { id: "meaning", strength: 0.3, required: true },
        ],
      };

      const nextBeat = getNextBeatFromLLM(state, llmReasoning);

      // Should pick lowest strength
      assert.strictEqual(nextBeat.id, "stakes");
    });

    it("should handle null/undefined llmReasoning", () => {
      const state = {
        beats: [
          { id: "scene", strength: 0.5, required: true },
          { id: "stakes", strength: 0.2, required: true },
        ],
      };

      const resultNull = getNextBeatFromLLM(state, null);
      const resultUndef = getNextBeatFromLLM(state, undefined);

      // Should fallback to lowest strength
      assert.strictEqual(resultNull.id, "stakes");
      assert.strictEqual(resultUndef.id, "stakes");
    });

    it("should prefer required beats over optional", () => {
      const llmReasoning = {};
      const state = {
        beats: [
          { id: "scene", strength: 0.5, required: true },
          { id: "optional", strength: 0.1, required: false }, // Lowest but optional
          { id: "meaning", strength: 0.2, required: true }, // Required and low
        ],
      };

      const nextBeat = getNextBeatFromLLM(state, llmReasoning);

      // Should prefer required beats
      assert.strictEqual(nextBeat.id, "meaning");
    });

    it("should return null if all beats are covered", () => {
      const llmReasoning = {};
      const state = {
        beats: [
          { id: "scene", strength: 0.8, required: true },
          { id: "meaning", strength: 0.7, required: true },
        ],
      };

      const nextBeat = getNextBeatFromLLM(state, llmReasoning);

      // All beats >= 0.6 (covered threshold)
      assert.strictEqual(nextBeat, null);
    });

    it("should handle empty beats array", () => {
      const llmReasoning = {};
      const state = { beats: [] };

      const nextBeat = getNextBeatFromLLM(state, llmReasoning);

      assert.strictEqual(nextBeat, null);
    });

    it("should support status-based beats for backward compatibility", () => {
      const llmReasoning = {};
      const state = {
        beats: [
          { id: "scene", status: "covered", required: true },
          { id: "meaning", status: "missing", required: true }, // Missing
          { id: "stakes", status: "weak", required: true },
        ],
      };

      const nextBeat = getNextBeatFromLLM(state, llmReasoning);

      // Should return a beat that's not covered (missing or weak)
      assert.ok(["meaning", "stakes"].includes(nextBeat.id));
    });
  });
});

describe("getNextBeatToAsk Fallback", () => {
  const { getNextBeatToAsk } = require("../../../src/writer/v2/quality");

  it("should return null when no missing beats", () => {
    const state = {
      beats: [
        { id: "scene", status: "covered", required: true },
        { id: "meaning", status: "covered", required: true },
      ],
    };

    const result = getNextBeatToAsk(state);

    assert.strictEqual(result, null);
  });

  it("should return missing beat when available", () => {
    const state = {
      beats: [
        { id: "scene", status: "covered", required: true },
        { id: "meaning", status: "missing", required: true },
      ],
    };

    const result = getNextBeatToAsk(state);

    assert.ok(result);
    assert.strictEqual(result.id, "meaning");
  });
});
