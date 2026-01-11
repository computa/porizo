const { describe, it, mock, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

const {
  extractStorySignals,
  mergeSignals,
  isVagueAnswer,
  extractWithHeuristics,
  parseExtractionResult,
} = require("../../src/writer/signal-extractor");

// Mock story model for testing
const mockLoveModel = {
  STORY_ELEMENTS: {
    setting: {
      id: "setting",
      description: "Where and when the magic happened",
      anchorWords: ["at", "in", "coffee", "park", "party"],
    },
    first_impression: {
      id: "first_impression",
      description: "What about THEM caught your attention",
      anchorWords: ["noticed", "saw", "smile", "laugh", "eyes"],
    },
    emotional_moment: {
      id: "emotional_moment",
      description: "When you KNEW this was different",
      anchorWords: ["knew", "realized", "felt", "moment"],
    },
    what_makes_them_special: {
      id: "what_makes_them_special",
      description: "Why them and no one else",
      anchorWords: ["because", "only", "always", "different"],
    },
  },
};

const mockStoryContext = {
  recipient_name: "Sarah",
  occasion: "anniversary",
  elements: {},
  arcContext: {
    arcDisplayName: "Love Story",
  },
};

describe("Signal Extractor", () => {
  describe("isVagueAnswer", () => {
    it("should return true for null or empty answer", () => {
      assert.strictEqual(isVagueAnswer(null), true);
      assert.strictEqual(isVagueAnswer(""), true);
      assert.strictEqual(isVagueAnswer("   "), true);
    });

    it("should return true for very short answers", () => {
      assert.strictEqual(isVagueAnswer("ok"), true);
      assert.strictEqual(isVagueAnswer("fine"), true);
      assert.strictEqual(isVagueAnswer("good i guess"), true);
    });

    it("should return true for common non-answers", () => {
      assert.strictEqual(isVagueAnswer("I don't know"), true);
      assert.strictEqual(isVagueAnswer("not sure"), true);
      assert.strictEqual(isVagueAnswer("idk"), true);
      assert.strictEqual(isVagueAnswer("nothing really"), true);
      assert.strictEqual(isVagueAnswer("just normal stuff"), true);
      assert.strictEqual(isVagueAnswer("I guess maybe"), true);
      assert.strictEqual(isVagueAnswer("can't remember"), true);
    });

    it("should return false for meaningful answers", () => {
      assert.strictEqual(
        isVagueAnswer("We met at the coffee shop downtown on a rainy Tuesday"),
        false
      );
      assert.strictEqual(
        isVagueAnswer("Her smile lit up the room when she walked in"),
        false
      );
      assert.strictEqual(
        isVagueAnswer("I knew she was special when she laughed at my terrible joke"),
        false
      );
    });

    it("should handle answers with few words", () => {
      assert.strictEqual(isVagueAnswer("at park"), true); // 2 words
      assert.strictEqual(isVagueAnswer("she was there"), true); // 3 words
    });
  });

  describe("extractWithHeuristics", () => {
    it("should extract single element based on anchor words", () => {
      const answer = "I first saw her at the coffee shop";
      const result = extractWithHeuristics(answer, mockStoryContext, mockLoveModel);

      assert.ok(result.signals.setting, "Should detect setting");
      assert.ok(result.signals.first_impression, "Should detect first_impression");
      assert.strictEqual(result.source, "heuristic");
    });

    it("should extract multiple elements from rich answer", () => {
      const answer =
        "I noticed her smile at the park and I knew she was different from everyone else";
      const result = extractWithHeuristics(answer, mockStoryContext, mockLoveModel);

      assert.ok(result.signals.first_impression, "Should detect first_impression");
      assert.ok(result.signals.setting, "Should detect setting");
      assert.ok(result.signals.emotional_moment, "Should detect emotional_moment");
      assert.ok(result.signals.what_makes_them_special, "Should detect what_makes_them_special");
    });

    it("should return empty signals for no matches", () => {
      const answer = "Something happened yesterday";
      const result = extractWithHeuristics(answer, mockStoryContext, mockLoveModel);

      assert.strictEqual(Object.keys(result.signals).length, 0);
      assert.strictEqual(result.confidence, "low");
    });

    it("should build anchor objects for detected anchors", () => {
      const answer = "Her smile at the coffee shop changed everything";
      const result = extractWithHeuristics(answer, mockStoryContext, mockLoveModel);

      assert.ok(result.anchors.length > 0, "Should have anchors");
      assert.ok(
        result.anchors.some((a) => a.word === "smile" || a.word === "coffee"),
        "Should include detected anchor words"
      );
    });

    it("should set confidence based on element count", () => {
      const singleMatch = extractWithHeuristics(
        "at the park",
        mockStoryContext,
        mockLoveModel
      );
      const multiMatch = extractWithHeuristics(
        "noticed her smile at the party and knew she was different",
        mockStoryContext,
        mockLoveModel
      );

      assert.strictEqual(singleMatch.confidence, "low");
      assert.strictEqual(multiMatch.confidence, "medium");
    });
  });

  describe("parseExtractionResult", () => {
    it("should parse valid JSON response", () => {
      const llmResponse = JSON.stringify({
        elements: {
          setting: "at the coffee shop",
          first_impression: "her beautiful smile",
        },
        anchors: ["coffee shop", "smile"],
      });

      const result = parseExtractionResult(llmResponse, mockLoveModel);

      assert.strictEqual(result.elements.setting, "at the coffee shop");
      assert.strictEqual(result.elements.first_impression, "her beautiful smile");
      assert.deepStrictEqual(result.anchors, ["coffee shop", "smile"]);
    });

    it("should handle JSON wrapped in markdown code blocks", () => {
      const llmResponse = `Here's the extraction:
\`\`\`json
{
  "elements": { "setting": "the park" },
  "anchors": ["park"]
}
\`\`\``;

      const result = parseExtractionResult(llmResponse, mockLoveModel);
      assert.strictEqual(result.elements.setting, "the park");
    });

    it("should filter out invalid element IDs", () => {
      const llmResponse = JSON.stringify({
        elements: {
          setting: "valid element",
          invalid_element: "should be filtered",
          first_impression: "also valid",
        },
        anchors: [],
      });

      const result = parseExtractionResult(llmResponse, mockLoveModel);

      assert.ok(result.elements.setting);
      assert.ok(result.elements.first_impression);
      assert.ok(!result.elements.invalid_element, "Invalid element should be filtered");
    });

    it("should return empty result for malformed JSON", () => {
      const llmResponse = "This is not valid JSON at all";
      const result = parseExtractionResult(llmResponse, mockLoveModel);

      assert.deepStrictEqual(result.elements, {});
      assert.deepStrictEqual(result.anchors, []);
    });

    it("should handle missing anchors array", () => {
      const llmResponse = JSON.stringify({
        elements: { setting: "the cafe" },
      });

      const result = parseExtractionResult(llmResponse, mockLoveModel);

      assert.strictEqual(result.elements.setting, "the cafe");
      assert.deepStrictEqual(result.anchors, []);
    });

    it("should filter out empty string anchors", () => {
      const llmResponse = JSON.stringify({
        elements: {},
        anchors: ["valid", "", "  ", "also valid"],
      });

      const result = parseExtractionResult(llmResponse, mockLoveModel);
      assert.strictEqual(result.anchors.length, 2);
      assert.ok(result.anchors.includes("valid"));
      assert.ok(result.anchors.includes("also valid"));
    });
  });

  describe("mergeSignals", () => {
    it("should add new signals to empty elements", () => {
      const existing = {};
      const newSignals = {
        setting: "at the coffee shop",
        first_impression: "her smile",
      };

      const merged = mergeSignals(existing, newSignals);

      assert.strictEqual(merged.setting, "at the coffee shop");
      assert.strictEqual(merged.first_impression, "her smile");
    });

    it("should preserve existing elements", () => {
      const existing = {
        setting: "at the park",
      };
      const newSignals = {
        first_impression: "her laugh",
      };

      const merged = mergeSignals(existing, newSignals);

      assert.strictEqual(merged.setting, "at the park");
      assert.strictEqual(merged.first_impression, "her laugh");
    });

    it("should append new content to existing elements", () => {
      const existing = {
        setting: "at the coffee shop",
      };
      const newSignals = {
        setting: "on a rainy Tuesday morning",
      };

      const merged = mergeSignals(existing, newSignals);

      assert.ok(merged.setting.includes("coffee shop"));
      assert.ok(merged.setting.includes("rainy Tuesday"));
    });

    it("should not create duplicates", () => {
      const existing = {
        setting: "at the coffee shop downtown",
      };
      const newSignals = {
        setting: "at the coffee shop downtown",
      };

      const merged = mergeSignals(existing, newSignals);

      // Should not double the content
      const occurrences = (merged.setting.match(/coffee shop/g) || []).length;
      assert.strictEqual(occurrences, 1, "Should not duplicate content");
    });

    it("should skip empty new signals", () => {
      const existing = {
        setting: "at the park",
      };
      const newSignals = {
        setting: "",
        first_impression: "   ",
      };

      const merged = mergeSignals(existing, newSignals);

      assert.strictEqual(merged.setting, "at the park");
      assert.ok(!merged.first_impression, "Empty signal should not be added");
    });
  });

  describe("extractStorySignals", () => {
    it("should return empty result for empty answer", async () => {
      const result = await extractStorySignals("", mockStoryContext, mockLoveModel);

      assert.deepStrictEqual(result.signals, {});
      assert.deepStrictEqual(result.anchors, []);
      assert.strictEqual(result.confidence, "low");
    });

    it("should use heuristics when LLM unavailable", async () => {
      // LLM provider check will return false in test env
      const answer = "I noticed her smile at the coffee shop";
      const result = await extractStorySignals(answer, mockStoryContext, mockLoveModel);

      // Should fall back to heuristics
      assert.ok(result.signals.first_impression || result.signals.setting);
      assert.strictEqual(result.source, "heuristic");
    });

    it("should extract multiple elements from complex answer", async () => {
      const answer =
        "I saw her smile at the party and in that moment I knew she was different because she laughed at my terrible joke";
      const result = await extractStorySignals(answer, mockStoryContext, mockLoveModel);

      // Should detect multiple elements via heuristics
      const elementCount = Object.keys(result.signals).length;
      assert.ok(elementCount >= 2, "Should extract multiple elements");
    });
  });
});
