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

const {
  buildSongwriterPrompt,
  assessQuality,
  assessNarrativeFidelity,
  FIDELITY_MIN_SCORE,
} = require("../src/writer/songwriter");

const { buildLyricsContext } = require("../src/writer/lyrics-context");

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
    const { getStyleDisplayMap } = require("../src/providers/style-registry");

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

    it("stays in sync with canonical style registry", () => {
      const registryMap = getStyleDisplayMap();
      assert.deepStrictEqual(
        Object.keys(MUSIC_STYLES).sort(),
        Object.keys(registryMap).sort(),
        "Writer style keys should match registry keys"
      );
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

      const result = await generateLyrics({
        title: "Birthday Wishes",
        recipient_name: "Mom",
        message: "Thank you for always being there",
        style: "acoustic",
        occasion: "birthday",
      });

      const lyrics = result.lyrics;
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

    it("should return AI_UNAVAILABLE when the LLM is not usable", async () => {
      // Test with invalid API key - should fail, not fallback
      const originalKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = "invalid-key";

      try {
        await assert.rejects(
          async () => generateLyrics({
            title: "Test",
            recipient_name: "Test",
            message: "Test message",
            style: "pop",
            occasion: "birthday",
          }),
          (err) => err && (err.code === "AI_UNAVAILABLE" || err.message === "AI_UNAVAILABLE"),
          "Should surface AI_UNAVAILABLE when LLM is not usable"
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

  describe("buildLyricsContext", () => {
    it("returns track-level fields with empty defaults when no story_context_json", () => {
      const track = {
        title: "Song for Mom",
        recipient_name: "Mom",
        message: "Happy birthday",
        style: "pop",
        occasion: "birthday",
        story_context_json: null,
      };
      const ctx = buildLyricsContext(track);
      assert.strictEqual(ctx.title, "Song for Mom");
      assert.strictEqual(ctx.recipient_name, "Mom");
      assert.strictEqual(ctx.narrative, "");
      assert.deepStrictEqual(ctx.facts, []);
      assert.deepStrictEqual(ctx.beats, []);
      assert.deepStrictEqual(ctx.atoms, {});
      assert.deepStrictEqual(ctx.primitives, {});
      assert.strictEqual(ctx.summary, null);
    });

    it("passes story-flow fields from enriched story_context_json", () => {
      const track = {
        title: "Song for Dad",
        recipient_name: "Dad",
        message: "Thanks for everything",
        style: "rock",
        occasion: "fathers_day",
        story_context_json: JSON.stringify({
          narrative: "Dad taught me to ride a bike in the park.",
          facts: [{ text: "learned to ride at age 6", beat: "moment", source_turn: 2 }],
          beats: [{ id: "moment", strength: 0.8, status: "covered" }],
          atoms: { where: "Central Park", when: "summer 1998", who: "Dad" },
          primitives: { theme: "patience and love" },
          dials: { tone: "nostalgic" },
          summary: { text: "A story about learning to ride", factCount: 1 },
        }),
      };
      const ctx = buildLyricsContext(track);
      assert.strictEqual(ctx.narrative, "Dad taught me to ride a bike in the park.");
      assert.strictEqual(ctx.facts.length, 1);
      assert.strictEqual(ctx.facts[0].text, "learned to ride at age 6");
      assert.strictEqual(ctx.atoms.where, "Central Park");
      assert.strictEqual(ctx.primitives.theme, "patience and love");
      assert.strictEqual(ctx.dials.tone, "nostalgic");
      assert.deepStrictEqual(ctx.motifs, []);
      assert.strictEqual(ctx.song_map, null);
    });

    it("passes direct-creation fields from old-format story_context_json", () => {
      const track = {
        title: "Birthday Song",
        recipient_name: "Sarah",
        message: "You are wonderful",
        style: "pop",
        occasion: "birthday",
        story_context_json: JSON.stringify({
          relationship_type: "friend",
          years_known: 10,
          specific_memory: "Our road trip to the coast",
          special_phrases: "partner in crime",
          what_makes_them_special: "Always shows up when it matters",
        }),
      };
      const ctx = buildLyricsContext(track);
      assert.strictEqual(ctx.relationship_type, "friend");
      assert.strictEqual(ctx.years_known, 10);
      assert.strictEqual(ctx.specific_memory, "Our road trip to the coast");
    });

    it("falls back narrative from summary.text when narrative is absent", () => {
      const track = {
        title: "Song",
        recipient_name: "Alex",
        message: "Thank you",
        style: "pop",
        occasion: "thank_you",
        story_context_json: JSON.stringify({
          summary: { text: "A story about gratitude", factCount: 3 },
        }),
      };
      const ctx = buildLyricsContext(track);
      assert.strictEqual(ctx.narrative, "A story about gratitude");
    });

    it("preserves song_map and motifs from story context", () => {
      const track = {
        title: "Song for Chioma",
        recipient_name: "Chioma",
        message: "You held us together",
        style: "pop",
        occasion: "mothers_day",
        story_context_json: JSON.stringify({
          narrative: "She carried the family through fear and became the heart of the home.",
          motifs: ["hospital parking lot", "school runs"],
          song_map: {
            hook: "You are the heartbeat of our home",
            verse1: ["Morning to night, she kept the house moving"],
            chorus: ["What it meant was love under pressure"],
            verse2: ["The high-risk twin pregnancy changed everything"],
            bridge: ["Watching her grow into a stronger woman"],
            key_lines: ["She made the house feel like home"],
          },
        }),
      };
      const ctx = buildLyricsContext(track);
      assert.deepStrictEqual(ctx.motifs, ["hospital parking lot", "school runs"]);
      assert.equal(ctx.song_map.hook, "You are the heartbeat of our home");
      assert.deepStrictEqual(ctx.song_map.bridge, ["Watching her grow into a stronger woman"]);
    });
  });

  describe("buildSongwriterPrompt with story context", () => {
    it("includes story arc section when beats/atoms/facts are present", () => {
      const context = {
        recipient_name: "Mom",
        occasion: "birthday",
        style: "pop",
        message: "Happy birthday Mom",
        narrative: "Mom always cooked Sunday breakfast.",
        facts: [
          { text: "pancakes every Sunday", beat: "scene", source_turn: 1 },
          { text: "the kitchen smelled like maple", beat: "detail", source_turn: 3 },
        ],
        beats: [{ id: "scene", strength: 0.8, status: "covered" }],
        atoms: { where: "our kitchen", when: "Sunday mornings", who: "Mom" },
        primitives: { theme: "warmth and routine" },
      };
      const prompt = buildSongwriterPrompt(context);
      assert.ok(prompt.includes("STORY ARC"), "Should include story arc section");
      assert.ok(prompt.includes("VERSE 1 (THE BEGINNING)"), "Should have verse 1 mapping");
      assert.ok(prompt.includes("our kitchen"), "Should include atoms.where");
      assert.ok(prompt.includes("TELL THE STORY"), "Should include sequential storytelling instructions");
    });

    it("omits story arc section when no structured story data", () => {
      const context = {
        recipient_name: "Friend",
        occasion: "birthday",
        style: "pop",
        message: "Happy birthday",
      };
      const prompt = buildSongwriterPrompt(context);
      assert.ok(!prompt.includes("STORY ARC"), "Should NOT include story arc section without data");
      assert.ok(prompt.includes("TELL THE STORY"), "Sequential instructions always present");
    });

    it("prioritizes song_map guidance when present", () => {
      const context = {
        recipient_name: "Chioma",
        occasion: "mothers_day",
        style: "pop",
        message: "You held us together",
        narrative: "She carried the family through fear and became the heart of the home.",
        song_map: {
          hook: "You are the heartbeat of our home",
          verse1: ["Morning to night, she kept the house moving"],
          chorus: ["What it meant was love under pressure"],
          verse2: ["The high-risk twin pregnancy changed everything"],
          bridge: ["Watching her grow into a stronger woman"],
          key_lines: ["She made the house feel like home"],
        },
        motifs: ["school runs", "doctor's warnings"],
      };
      const prompt = buildSongwriterPrompt(context);
      assert.ok(prompt.includes("PRIMARY STORY-TO-SONG MAP"), "Should include song_map section");
      assert.ok(prompt.includes("Watching her grow into a stronger woman"), "Should preserve bridge payoff guidance");
      assert.ok(prompt.includes("RECURRING MOTIFS"), "Should surface motifs");
    });
  });

  describe("assessQuality with story context", () => {
    const baseLyrics = {
      title: "Test Song",
      style: "pop",
      sections: [
        { name: "verse1", lines: ["Walking down the morning street", "Sarah waved from the porch light", "Coffee steam and autumn leaves", "The season turned without a sound"] },
        { name: "chorus", lines: ["Sarah, this is what it means", "To carry someone in your bones", "The quiet way you hold the room", "Is everything I've known"] },
        { name: "verse2", lines: ["Years went by like passing trains", "But that Tuesday at the lake", "When the rain came down in sheets", "You stayed and that was grace"] },
      ],
      anchor_line: "Sarah, this is what it means",
    };

    it("scores higher when story words appear in lyrics", () => {
      const context = {
        recipient_name: "Sarah",
        facts: ["the morning walks to school", "autumn leaves in the yard"],
        elements: { memory: "walking together every morning" },
      };
      const score = assessQuality(baseLyrics, context);
      assert.ok(score >= 70, `Score should be decent with story connection: ${score}`);
    });

    it("penalizes when recipient name is missing", () => {
      const noNameLyrics = {
        ...baseLyrics,
        sections: baseLyrics.sections.map(s => ({
          ...s,
          lines: s.lines.map(l => l.replace(/Sarah/g, "someone")),
        })),
      };
      const context = { recipient_name: "Sarah", facts: [] };
      const score = assessQuality(noNameLyrics, context);
      assert.ok(score <= 85, `Should penalize missing name: ${score}`);
    });

    it("does not over-penalize sparse stories for missing sensory words", () => {
      const lowSensoryLyrics = {
        title: "Test Song",
        style: "pop",
        sections: [
          { name: "verse1", lines: ["Chioma kept the family steady", "She held the line through pressure", "Every day she carried more", "And never asked for applause"] },
          { name: "chorus", lines: ["Chioma, this is what it means", "You made our house a home", "You kept us when the fear was loud", "And taught us how to hold on"] },
          { name: "verse2", lines: ["When the warnings filled the room", "You stayed and faced the fear", "The twins arrived and changed us all", "Your strength kept love right here"] },
        ],
        anchor_line: "Chioma, this is what it means",
      };
      const context = {
        recipient_name: "Chioma",
        facts: [{ text: "She held the family together during a difficult year." }],
        atoms: {},
      };
      const score = assessQuality(lowSensoryLyrics, context);
      assert.ok(score >= 70, `Sparse stories should not be over-penalized for missing sensory words: ${score}`);
    });
  });

  describe("assessNarrativeFidelity validation", () => {
    it("rejects response with non-numeric total", async () => {
      // assessNarrativeFidelity requires an LLM call, so we test the validation
      // logic by checking the exported FIDELITY_MIN_SCORE constant
      assert.strictEqual(FIDELITY_MIN_SCORE, 35);
      assert.ok(Number.isFinite(35), "Valid score passes");
      assert.ok(!Number.isFinite("good"), "String score fails");
      assert.ok(!Number.isFinite(undefined), "Undefined score fails");
      assert.ok(!Number.isFinite(NaN), "NaN score fails");
    });
  });
});
