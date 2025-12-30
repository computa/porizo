const { describe, it } = require("node:test");
const assert = require("node:assert");

// Test will fail until we implement the module
const { generateLyrics, validateSingability, anchorMessage, buildLyrics } = require("../src/providers/lyrics");

describe("Lyrics Generation", () => {
  describe("buildLyrics (existing template-based)", () => {
    it("should include recipient name in anchor line", () => {
      const lyrics = buildLyrics({
        title: "Birthday Song",
        recipient_name: "Sarah",
        message: "You make every day brighter",
        style: "pop",
      });
      assert.ok(lyrics.anchor_line.includes("Sarah"), "Anchor should include recipient name");
    });

    it("should use default anchor when no recipient", () => {
      const lyrics = buildLyrics({
        title: "Happy Song",
        message: "Sunshine and rainbows",
        style: "pop",
      });
      assert.strictEqual(lyrics.anchor_line, "This one's for you");
    });
  });

  describe("validateSingability", () => {
    it("should pass for well-structured lyrics", () => {
      const lyrics = {
        title: "Test Song",
        style: "pop",
        sections: [
          {
            name: "chorus",
            lines: [
              "You light up my world today", // 7 syllables
              "In every single way", // 6 syllables
              "You light up my world today", // 7 syllables
            ],
          },
        ],
        anchor_line: "You light up my world today",
      };
      const result = validateSingability(lyrics);
      assert.strictEqual(result.valid, true, "Well-structured lyrics should be valid");
      assert.strictEqual(result.issues.length, 0, "Should have no issues");
    });

    it("should fail for lines that are too long", () => {
      const lyrics = {
        title: "Test Song",
        style: "pop",
        sections: [
          {
            name: "chorus",
            lines: [
              "This is an extremely long line that has way too many syllables for anyone to sing comfortably in a single breath",
            ],
          },
        ],
        anchor_line: "Too long",
      };
      const result = validateSingability(lyrics);
      assert.strictEqual(result.valid, false, "Long lines should fail validation");
      assert.ok(result.issues.some(i => i.includes("syllable")), "Should mention syllable count");
    });

    it("should fail for empty sections", () => {
      const lyrics = {
        title: "Test Song",
        style: "pop",
        sections: [],
        anchor_line: "Empty",
      };
      const result = validateSingability(lyrics);
      assert.strictEqual(result.valid, false, "Empty sections should fail");
    });
  });

  describe("anchorMessage", () => {
    it("should ensure message appears in lyrics", () => {
      const lyrics = {
        title: "Test",
        style: "pop",
        sections: [
          { name: "chorus", lines: ["Generic line one", "Generic line two"] },
        ],
        anchor_line: "Generic line one",
      };
      const message = "You are my sunshine";
      const anchored = anchorMessage(lyrics, message);

      // Check that message or its essence appears somewhere in lyrics
      const allLines = anchored.sections.flatMap(s => s.lines).join(" ");
      assert.ok(
        allLines.toLowerCase().includes("sunshine") || anchored.anchor_line.includes("sunshine"),
        "Message theme should appear in lyrics"
      );
    });

    it("should preserve existing anchor if message already present", () => {
      const lyrics = {
        title: "Test",
        style: "pop",
        sections: [
          { name: "chorus", lines: ["You are my sunshine", "My only sunshine"] },
        ],
        anchor_line: "You are my sunshine",
      };
      const message = "sunshine";
      const anchored = anchorMessage(lyrics, message);
      assert.strictEqual(anchored.anchor_line, "You are my sunshine");
    });
  });

  describe("generateLyrics (LLM-based)", () => {
    it("should generate lyrics with required structure", async () => {
      // This test requires ANTHROPIC_API_KEY to be set
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        console.log("Skipping LLM test - ANTHROPIC_API_KEY not set");
        return;
      }

      const lyrics = await generateLyrics({
        title: "Birthday Wishes",
        recipient_name: "Mom",
        message: "Thank you for always being there",
        style: "acoustic",
        occasion: "birthday",
      });

      assert.ok(lyrics.title, "Should have title");
      assert.ok(lyrics.sections.length > 0, "Should have sections");
      assert.ok(lyrics.anchor_line, "Should have anchor line");

      // Validate structure
      for (const section of lyrics.sections) {
        assert.ok(section.name, "Section should have name");
        assert.ok(Array.isArray(section.lines), "Section should have lines array");
        assert.ok(section.lines.length > 0, "Section should have at least one line");
      }
    });

    it("should handle API errors gracefully", async () => {
      // Test with invalid API key
      const originalKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = "invalid-key";

      try {
        await generateLyrics({
          title: "Test",
          recipient_name: "Test",
          message: "Test message",
          style: "pop",
          occasion: "birthday",
        });
        assert.fail("Should have thrown an error");
      } catch (err) {
        assert.ok(err.message.includes("E201") || err.message.includes("API"), "Should return lyrics error");
      } finally {
        process.env.ANTHROPIC_API_KEY = originalKey;
      }
    });
  });
});
