const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  assessElementQuality,
  hasElement,
  assessAllElements,
  findWeakElements,
  GENERIC_PHRASES,
  SPECIFICITY_MARKERS,
} = require("../../src/writer/element-quality");

describe("Element Quality Assessment", () => {
  describe("assessElementQuality", () => {
    it("should reject empty or null content", () => {
      const result = assessElementQuality(null);
      assert.strictEqual(result.filled, false);
      assert.strictEqual(result.score, 0);
      assert.ok(result.issues.includes("No content provided"));
    });

    it("should reject content that is too short", () => {
      const result = assessElementQuality("short");
      assert.strictEqual(result.filled, false);
      assert.ok(result.score < 0.4);
      assert.ok(result.issues.some((i) => i.includes("Too short")));
    });

    it("should reject 'I don't know' even though length > 10", () => {
      // This is the key test - "I don't know" has 12 chars but should NOT be filled
      const result = assessElementQuality("I don't know");
      assert.strictEqual(result.filled, false);
      assert.ok(result.score < 0.4, "Score should be low for vague answers");
    });

    it("should reject content with too few meaningful words", () => {
      const result = assessElementQuality("a b c d e f g h i j k l");
      assert.strictEqual(result.filled, false);
      assert.ok(result.issues.some((i) => i.includes("Too few words")));
    });

    it("should reject content with multiple generic phrases", () => {
      const result = assessElementQuality(
        "I'm not sure, maybe it was nothing special really"
      );
      assert.strictEqual(result.filled, false);
      assert.ok(
        result.issues.some((i) => i.includes("generic")),
        "Should identify generic content"
      );
    });

    it("should accept content with specific details", () => {
      const result = assessElementQuality(
        "I remember it was a Saturday morning in March when she smiled at me across the coffee shop"
      );
      assert.strictEqual(result.filled, true);
      assert.ok(result.score >= 0.4);
    });

    it("should score higher for more specificity markers", () => {
      const lowSpecificity = assessElementQuality(
        "They were really nice and kind to me every time"
      );
      const highSpecificity = assessElementQuality(
        "I still remember that warm Friday evening in July when I heard her laugh"
      );
      assert.ok(
        highSpecificity.score > lowSpecificity.score,
        "Higher specificity should mean higher score"
      );
    });

    it("should give bonus for sensory anchors with specificity", () => {
      const result = assessElementQuality(
        "I can still hear her laugh echoing in the warm summer evening",
        "sensory_anchor"
      );
      assert.strictEqual(result.filled, true);
      assert.ok(result.score >= 0.5, "Should get sensory anchor bonus");
    });

    it("should give bonus for setting with place reference", () => {
      const result = assessElementQuality(
        "We were sitting at the corner booth in the old diner downtown",
        "setting"
      );
      assert.strictEqual(result.filled, true);
      assert.ok(result.score >= 0.5, "Should get setting bonus");
    });
  });

  describe("hasElement", () => {
    it("should return false for missing element", () => {
      const storyContext = { elements: {} };
      assert.strictEqual(hasElement(storyContext, "first_impression"), false);
    });

    it("should return false for vague element content", () => {
      const storyContext = {
        elements: {
          first_impression: "I don't know really",
        },
      };
      assert.strictEqual(hasElement(storyContext, "first_impression"), false);
    });

    it("should return true for quality element content", () => {
      const storyContext = {
        elements: {
          first_impression:
            "The first thing I noticed was her bright smile when she walked through the door that Tuesday afternoon",
        },
      };
      assert.strictEqual(hasElement(storyContext, "first_impression"), true);
    });

    it("should handle undefined elements object", () => {
      const storyContext = {};
      assert.strictEqual(hasElement(storyContext, "first_impression"), false);
    });
  });

  describe("assessAllElements", () => {
    it("should assess multiple elements", () => {
      const storyContext = {
        elements: {
          setting: "At the coffee shop on Main Street last December",
          first_impression: "I don't know",
          emotional_moment:
            "When she laughed at my terrible joke and I realized she was special",
        },
      };
      const elementIds = ["setting", "first_impression", "emotional_moment"];
      const assessments = assessAllElements(storyContext, elementIds);

      assert.strictEqual(assessments.setting.filled, true);
      assert.strictEqual(assessments.first_impression.filled, false);
      assert.strictEqual(assessments.emotional_moment.filled, true);
    });
  });

  describe("findWeakElements", () => {
    it("should identify elements that could use more detail", () => {
      const storyContext = {
        elements: {
          setting: "At the park", // Short but valid
          first_impression:
            "I noticed her smile when she looked at me that day",
          emotional_moment:
            "It was on a cold December night when I realized I loved her smile and the way she laughed",
        },
      };
      const elementIds = [
        "setting",
        "first_impression",
        "emotional_moment",
        "sensory_anchor",
      ];
      const weak = findWeakElements(storyContext, elementIds);

      // Setting should be weak (short)
      // first_impression might be borderline
      // emotional_moment should be strong
      assert.ok(
        weak.length > 0,
        "Should find at least one weak element"
      );
      assert.ok(
        weak.every((w) => w.score < 0.6),
        "All weak elements should have score < 0.6"
      );
    });

    it("should return empty array when all elements are strong", () => {
      const storyContext = {
        elements: {
          first_impression:
            "I remember seeing her bright smile that warm Saturday morning in June at the farmer's market",
          emotional_moment:
            "That's when I knew she was different - the way she laughed at my terrible pun made my heart skip",
        },
      };
      const weak = findWeakElements(storyContext, [
        "first_impression",
        "emotional_moment",
      ]);
      assert.ok(
        weak.length === 0,
        "Should return empty array for all strong elements"
      );
    });

    it("should sort by score ascending (weakest first)", () => {
      const storyContext = {
        elements: {
          a: "This is okay but not great content here",
          b: "A bit short but valid content",
          c: "Mediocre content that could be improved with more details",
        },
      };
      const weak = findWeakElements(storyContext, ["a", "b", "c"]);
      if (weak.length >= 2) {
        assert.ok(
          weak[0].score <= weak[1].score,
          "Should be sorted by score ascending"
        );
      }
    });
  });

  describe("GENERIC_PHRASES detection", () => {
    it("should include common vague phrases", () => {
      const expectedPhrases = [
        "i don't know",
        "not sure",
        "nothing special",
        "like everyone else",
        "i guess",
        "maybe",
      ];
      for (const phrase of expectedPhrases) {
        assert.ok(
          GENERIC_PHRASES.includes(phrase),
          `Should include '${phrase}'`
        );
      }
    });
  });

  describe("SPECIFICITY_MARKERS patterns", () => {
    it("should detect time-related specificity", () => {
      const timePatterns = SPECIFICITY_MARKERS.filter((p) =>
        ["morning", "january", "monday", "2020"].some((t) => p.test(t))
      );
      assert.ok(
        timePatterns.length > 0,
        "Should have patterns for time markers"
      );
    });

    it("should detect sensory detail markers", () => {
      const sensoryTest = "I saw her smile and heard her laugh";
      const matches = SPECIFICITY_MARKERS.filter((p) => p.test(sensoryTest));
      assert.ok(matches.length > 0, "Should detect sensory markers");
    });

    it("should detect emotional markers", () => {
      const emotionalTest = "I realized that moment she was the one";
      const matches = SPECIFICITY_MARKERS.filter((p) => p.test(emotionalTest));
      assert.ok(matches.length > 0, "Should detect emotional markers");
    });
  });
});
