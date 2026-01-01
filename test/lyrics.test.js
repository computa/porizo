const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  generateLyrics,
  validateSingability,
  anchorMessage,
  buildLyrics,
  sanitizeInput,
  validateStyle,
  validateRecipientAnchor,
  repairRecipientAnchor,
  validateAndRepairLyrics,
  countSyllables,
  MUSIC_STYLES,
} = require("../src/providers/lyrics");

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

  describe("buildSongwriterPrompt", () => {
    // Import the new function - will fail until implemented
    const { buildSongwriterPrompt } = require("../src/providers/lyrics");

    it("should include recipient name prominently", () => {
      const prompt = buildSongwriterPrompt({
        recipient_name: "Maria",
        message: "You're amazing",
        occasion: "birthday",
        style: "pop",
      });
      assert.ok(prompt.includes("Maria"), "Prompt should include recipient name");
    });

    it("should incorporate relationship context when provided", () => {
      const prompt = buildSongwriterPrompt({
        recipient_name: "Dad",
        message: "Thank you for everything",
        occasion: "thank_you",
        style: "soul",
        relationship_type: "parent",
        years_known: 30,
      });
      assert.ok(prompt.includes("parent") || prompt.includes("father"), "Prompt should reference relationship");
      assert.ok(prompt.includes("30") || prompt.includes("years"), "Prompt should reference duration");
    });

    it("should weave in specific memory when provided", () => {
      const prompt = buildSongwriterPrompt({
        recipient_name: "Jake",
        message: "Best friend forever",
        occasion: "celebration",
        style: "acoustic",
        specific_memory: "The road trip to California when we got lost",
      });
      assert.ok(
        prompt.includes("road trip") || prompt.includes("California") || prompt.includes("got lost"),
        "Prompt should include specific memory details"
      );
    });

    it("should include special phrases and inside jokes", () => {
      const prompt = buildSongwriterPrompt({
        recipient_name: "Chioma",
        message: "Love you always",
        occasion: "anniversary",
        style: "afrobeats",
        special_phrases: "My sunshine, Nkem",
      });
      assert.ok(
        prompt.includes("sunshine") || prompt.includes("Nkem"),
        "Prompt should include special phrases"
      );
    });

    it("should work with minimal context (backwards compatible)", () => {
      const prompt = buildSongwriterPrompt({
        recipient_name: "Sam",
        message: "Happy birthday",
        occasion: "birthday",
        style: "pop",
      });
      assert.ok(prompt.length > 100, "Should generate substantial prompt even with minimal input");
      assert.ok(prompt.includes("Sam"), "Should still include recipient name");
    });
  });

  describe("MUSIC_STYLES constant", () => {
    const { MUSIC_STYLES } = require("../src/providers/lyrics");

    it("should include African music styles", () => {
      assert.ok(MUSIC_STYLES.afrobeats, "Should have Afrobeats");
      assert.ok(MUSIC_STYLES.highlife, "Should have Highlife");
      assert.ok(MUSIC_STYLES.ogene, "Should have Ogene");
      assert.ok(MUSIC_STYLES.juju, "Should have Jùjú");
      assert.ok(MUSIC_STYLES.fuji, "Should have Fuji");
    });

    it("should include South American music styles", () => {
      assert.ok(MUSIC_STYLES.reggaeton, "Should have Reggaeton");
      assert.ok(MUSIC_STYLES.salsa, "Should have Salsa");
      assert.ok(MUSIC_STYLES.bossa_nova, "Should have Bossa Nova");
      assert.ok(MUSIC_STYLES.cumbia, "Should have Cumbia");
      assert.ok(MUSIC_STYLES.bachata, "Should have Bachata");
      assert.ok(MUSIC_STYLES.samba, "Should have Samba");
    });

    it("should preserve existing styles", () => {
      assert.ok(MUSIC_STYLES.pop, "Should have Pop");
      assert.ok(MUSIC_STYLES.acoustic, "Should have Acoustic");
      assert.ok(MUSIC_STYLES.soul, "Should have Soul");
      assert.ok(MUSIC_STYLES.folk, "Should have Folk");
      assert.ok(MUSIC_STYLES.jazz, "Should have Jazz");
    });
  });

  describe("generateLyrics with rich context", () => {
    it("should produce richer lyrics with story context", async () => {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        console.log("Skipping LLM test - ANTHROPIC_API_KEY not set");
        return;
      }

      const result = await generateLyrics({
        title: "For My Love",
        recipient_name: "Chioma",
        message: "Thanks for being an amazing friend, wife and life partner",
        style: "afrobeats",
        occasion: "anniversary",
        relationship_type: "spouse",
        years_known: 10,
        specific_memory: "The day we met at the coffee shop when you spilled your latte",
        special_phrases: "My Nkem, my sunshine",
        what_makes_them_special: "Your laughter that fills every room",
      });

      assert.ok(result.lyrics, "Should generate lyrics");
      assert.ok(result.lyrics.sections.length >= 2, "Should have multiple sections");

      // Check that the rich context influenced the output
      const allLines = result.lyrics.sections.flatMap(s => s.lines).join(" ").toLowerCase();
      const hasPersonalization =
        allLines.includes("chioma") ||
        allLines.includes("nkem") ||
        allLines.includes("sunshine") ||
        allLines.includes("laugh") ||
        allLines.includes("coffee") ||
        allLines.includes("years");

      assert.ok(hasPersonalization, "Lyrics should reflect personal context");
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

    it("should handle API errors gracefully with fallback", async () => {
      // Test with invalid API key - should fallback, not throw
      const originalKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = "invalid-key";

      try {
        const result = await generateLyrics({
          title: "Test",
          recipient_name: "Test",
          message: "Test message",
          style: "pop",
          occasion: "birthday",
        });

        // Function should return fallback lyrics, not throw
        assert.ok(result.lyrics, "Should return fallback lyrics");
        assert.strictEqual(result.lyrics_status, "fallback", "Status should be fallback");
        assert.ok(
          result.fallback_reason.includes("E201") || result.fallback_reason.includes("401"),
          "Fallback reason should indicate API error"
        );
      } finally {
        process.env.ANTHROPIC_API_KEY = originalKey;
      }
    });
  });

  describe("sanitizeInput", () => {
    it("removes control characters", () => {
      const input = "Hello\x00\x01\x02World";
      const result = sanitizeInput(input);
      assert.strictEqual(result, "HelloWorld");
    });

    it("normalizes unicode whitespace", () => {
      const input = "Hello\u00A0\u2000World";
      const result = sanitizeInput(input);
      assert.strictEqual(result, "Hello World");
    });

    it("collapses multiple spaces", () => {
      const input = "Hello    World";
      const result = sanitizeInput(input);
      assert.strictEqual(result, "Hello World");
    });

    it("removes zero-width characters", () => {
      const input = "Hello\u200B\u200CWorld";
      const result = sanitizeInput(input);
      assert.strictEqual(result, "HelloWorld");
    });

    it("truncates long input to 2000 chars", () => {
      const input = "a".repeat(3000);
      const result = sanitizeInput(input);
      assert.strictEqual(result.length, 2000);
    });

    it("handles null/undefined", () => {
      assert.strictEqual(sanitizeInput(null), "");
      assert.strictEqual(sanitizeInput(undefined), "");
    });
  });

  describe("validateStyle", () => {
    it("validates known styles", () => {
      const result = validateStyle("pop");
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.normalized, "pop");
    });

    it("normalizes style names with dashes", () => {
      const result = validateStyle("bossa-nova");
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.normalized, "bossa_nova");
    });

    it("matches by display name (R&B)", () => {
      const result = validateStyle("R&B");
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.normalized, "rnb");
    });

    it("returns pop for unknown styles", () => {
      const result = validateStyle("unknown_style");
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.normalized, "pop");
    });

    it("handles null style", () => {
      const result = validateStyle(null);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.normalized, "pop");
    });
  });

  describe("validateRecipientAnchor", () => {
    it("finds anchor in chorus", () => {
      const lyrics = {
        sections: [
          { name: "chorus", lines: ["Dancing with you Sarah", "Every moment is true"] },
        ],
      };
      const result = validateRecipientAnchor(lyrics, "Sarah");
      assert.strictEqual(result.hasAnchor, true);
      assert.ok(result.locations.includes("chorus:1"));
    });

    it("is case-insensitive", () => {
      const lyrics = {
        sections: [{ name: "chorus", lines: ["SARAH you are the one"] }],
      };
      const result = validateRecipientAnchor(lyrics, "sarah");
      assert.strictEqual(result.hasAnchor, true);
    });

    it("detects missing anchor", () => {
      const lyrics = {
        sections: [{ name: "chorus", lines: ["Dancing in the rain"] }],
      };
      const result = validateRecipientAnchor(lyrics, "Sarah");
      assert.strictEqual(result.hasAnchor, false);
    });

    it("returns true when no recipient name", () => {
      const lyrics = {
        sections: [{ name: "chorus", lines: ["Test"] }],
      };
      const result = validateRecipientAnchor(lyrics, null);
      assert.strictEqual(result.hasAnchor, true);
    });
  });

  describe("repairRecipientAnchor", () => {
    it("adds recipient name to chorus", () => {
      const lyrics = {
        sections: [
          { name: "chorus", lines: ["Dancing in the rain"] },
        ],
      };
      const result = repairRecipientAnchor(lyrics, "Sarah");
      assert.ok(result.sections[0].lines[0].includes("Sarah"));
      assert.ok(result.anchor_line.includes("Sarah"));
    });

    it("does not modify lyrics that already have anchor", () => {
      const lyrics = {
        sections: [{ name: "chorus", lines: ["Sarah, dancing in the rain"] }],
      };
      const result = repairRecipientAnchor(lyrics, "Sarah");
      assert.strictEqual(result.sections[0].lines[0], "Sarah, dancing in the rain");
    });
  });

  describe("validateAndRepairLyrics", () => {
    it("validates and repairs lyrics without anchor", () => {
      const lyrics = {
        sections: [
          { name: "chorus", lines: ["Dancing in the rain", "Every moment"] },
        ],
      };
      const result = validateAndRepairLyrics(lyrics, "Sarah", "pop");
      assert.ok(result.lyrics.sections[0].lines[0].includes("Sarah"));
      assert.ok(result.issues.some(i => i.includes("Repaired")));
    });

    it("passes valid lyrics unchanged", () => {
      const lyrics = {
        sections: [{ name: "chorus", lines: ["Sarah, dancing in the rain"] }],
      };
      const result = validateAndRepairLyrics(lyrics, "Sarah", "pop");
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.issues.length, 0);
    });

    it("reports unknown style", () => {
      const lyrics = {
        sections: [{ name: "chorus", lines: ["Sarah, you are the one"] }],
      };
      const result = validateAndRepairLyrics(lyrics, "Sarah", "unknown_style");
      assert.ok(result.issues.some(i => i.includes("Unknown style")));
    });
  });

  describe("countSyllables", () => {
    it("counts syllables correctly", () => {
      assert.strictEqual(countSyllables("hello"), 2);
      assert.strictEqual(countSyllables("world"), 1);
      // "beautiful" commonly counted as 3 (beau-ti-ful) by simple algorithms
      assert.strictEqual(countSyllables("beautiful"), 3);
      assert.strictEqual(countSyllables("love"), 1);
      assert.strictEqual(countSyllables("dancing"), 2);
    });

    it("handles empty input", () => {
      assert.strictEqual(countSyllables(""), 0);
      assert.strictEqual(countSyllables(null), 0);
    });
  });
});
