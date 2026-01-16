/**
 * V2 Semantic Done Detection Tests
 *
 * Task 14: Replace keyword matching with LLM semantic detection.
 * The heuristic fallback should NOT trigger CONFIRM just because
 * the input contains phrases like "that's all" - context matters.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { generateSmartHeuristicFallback } = require("../../../src/writer/v2/engine");

describe("Semantic Done Detection (Task 14)", () => {

  describe("without LLM reasoning (pure heuristic)", () => {

    it("should NOT trigger CONFIRM just because input contains 'that's all'", () => {
      // This is the key test: keyword matching is removed
      const state = {
        conversation: [{ role: "user", content: "that's all I know about his hobbies" }],
        facts: [{ id: "f1", text: "one fact" }],
        narrative: "Short narrative.",
        turn_count: 2,
        recipient_name: "Dad",
        beats: [],
      };

      // Without LLM reasoning saying seems_done=true, should ASK (not enough content)
      const result = generateSmartHeuristicFallback(state);

      // With only 1 fact and 2 turns, should continue asking
      assert.strictEqual(result.action, "ASK",
        "Should NOT confirm just because of keyword match - need more content");
      assert.ok(result.fallback);
      assert.strictEqual(result.tier, "heuristic");
    });

    it("should NOT trigger CONFIRM for 'that's it' with minimal content", () => {
      const state = {
        conversation: [{ role: "user", content: "that's it for now I guess" }],
        facts: [{ id: "f1", text: "one fact" }],
        narrative: "Minimal.",
        turn_count: 3,
        recipient_name: "Mom",
        beats: [],
      };

      const result = generateSmartHeuristicFallback(state);

      assert.strictEqual(result.action, "ASK",
        "Should ask for more content despite keyword match");
    });

    it("should NOT trigger CONFIRM for 'nothing else' with insufficient content", () => {
      const state = {
        conversation: [{ role: "user", content: "nothing else comes to mind" }],
        facts: [],
        narrative: "",
        turn_count: 2,
        recipient_name: "Dad",
        beats: [],
      };

      const result = generateSmartHeuristicFallback(state);

      assert.strictEqual(result.action, "ASK",
        "Should ask - no content gathered yet");
    });

    it("should CONFIRM when enough content gathered regardless of keywords", () => {
      // This tests that content richness triggers CONFIRM, not keywords
      const state = {
        conversation: [{ role: "user", content: "He really loved teaching us" }],
        facts: [
          { id: "f1", text: "fact one" },
          { id: "f2", text: "fact two" },
          { id: "f3", text: "fact three" },
          { id: "f4", text: "fact four" },
        ],
        narrative: "A substantial narrative with good detail about the person, their hobbies, their family, and their special moments together that exceeds two hundred characters.",
        turn_count: 7,
        recipient_name: "Dad",
        beats: [
          { id: "meaning", strength: 0.7 },
          { id: "memory", strength: 0.6 },
        ],
      };

      const result = generateSmartHeuristicFallback(state);

      // Rich content should trigger CONFIRM via richness score
      assert.strictEqual(result.action, "CONFIRM",
        "Should confirm based on content richness, not keywords");
      assert.ok(result.heuristic_score >= 0.6,
        `Score should be high enough to confirm: ${result.heuristic_score}`);
    });

  });

  describe("with LLM reasoning (semantic detection)", () => {

    it("should CONFIRM when LLM explicitly says user seems done", () => {
      const state = {
        facts: [{ id: "f1", text: "f1" }, { id: "f2", text: "f2" }],
        narrative: "Some narrative content.",
        turn_count: 4,
        recipient_name: "Dad",
        beats: [],
      };
      const llmReasoning = {
        user_state: {
          seems_done: true,
          engagement: "low",
          tone: "wrapping up"
        }
      };

      const result = generateSmartHeuristicFallback(state, llmReasoning);

      assert.strictEqual(result.action, "CONFIRM",
        "Should trust LLM's done assessment");
      assert.ok(result.reason.includes("LLM") || result.reason.includes("done"),
        `Reason should mention LLM or done: ${result.reason}`);
    });

    it("should ASK when LLM says user is NOT done despite keyword", () => {
      const state = {
        conversation: [{ role: "user", content: "that's all I remember from that day" }],
        facts: [{ id: "f1", text: "one fact" }],
        narrative: "Short narrative.",
        turn_count: 3,
        recipient_name: "Mom",
        beats: [],
      };
      const llmReasoning = {
        user_state: {
          seems_done: false,
          engagement: "medium",
          tone: "reflective"
        }
      };

      const result = generateSmartHeuristicFallback(state, llmReasoning);

      assert.strictEqual(result.action, "ASK",
        "Should trust LLM - user is not done, just sharing a memory");
    });

    it("should require minimum content even when LLM says done", () => {
      // Safety: don't confirm with zero content
      const state = {
        facts: [],
        narrative: "",
        turn_count: 1,
        recipient_name: "Dad",
        beats: [],
      };
      const llmReasoning = {
        user_state: { seems_done: true }
      };

      const result = generateSmartHeuristicFallback(state, llmReasoning);

      assert.strictEqual(result.action, "ASK",
        "Should not confirm with zero content, even if LLM says done");
    });

  });

  describe("graduated richness scoring", () => {

    it("should include heuristic_score in response", () => {
      const state = {
        facts: [{ id: "f1", text: "fact" }],
        narrative: "Some text here.",
        turn_count: 3,
        recipient_name: "Dad",
        beats: [],
      };

      const result = generateSmartHeuristicFallback(state);

      assert.ok(typeof result.heuristic_score === "number",
        "Should include numeric heuristic_score");
      assert.ok(result.heuristic_score >= 0 && result.heuristic_score <= 1,
        `Score should be 0-1 range: ${result.heuristic_score}`);
    });

    it("should have higher score with more content", () => {
      const lowContent = {
        facts: [{ id: "f1", text: "one" }],
        narrative: "Short.",
        turn_count: 2,
        recipient_name: "Dad",
        beats: [],
      };

      const highContent = {
        facts: [
          { id: "f1", text: "one" },
          { id: "f2", text: "two" },
          { id: "f3", text: "three" },
          { id: "f4", text: "four" },
        ],
        narrative: "A much longer narrative with more details about the person and their story that provides substantial context.",
        turn_count: 5,
        recipient_name: "Dad",
        beats: [{ id: "meaning", strength: 0.6 }],
      };

      const lowResult = generateSmartHeuristicFallback(lowContent);
      const highResult = generateSmartHeuristicFallback(highContent);

      assert.ok(highResult.heuristic_score > lowResult.heuristic_score,
        `High content score (${highResult.heuristic_score}) should exceed low content score (${lowResult.heuristic_score})`);
    });

  });

});
