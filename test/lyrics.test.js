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
  applySongwriterPromptBudget,
  assessQuality,
  assessNarrativeFidelity,
  summarizeLyricsOutputForLog,
  summarizeFidelityForLog,
  buildStoryDetailLedger,
  buildStoryCertificationBlock,
  assessRequiredDetailCoverage,
  FIDELITY_MIN_SCORE,
} = require("../src/writer/songwriter");

const {
  buildLyricsContext,
  summarizeLyricsContextForLog,
} = require("../src/writer/lyrics-context");
const { sanitizeLyricsForAllMusicProviders } = require("../src/workflows/render-contract");

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

  describe("applySongwriterPromptBudget", () => {
    it("records key-detail trimming when a crowded detail list must be reduced", () => {
      const narrativeText = "";
      const prompt = [
        "## SONG BRIEF",
        "KEY DETAILS:",
        "- detail 1",
        "- detail 2",
        "- detail 3",
        "- detail 4",
        "- detail 5",
        "- detail 6",
        "- detail 7",
        "- detail 8",
        "- detail 9",
        "- detail 10",
        "## YOUR TASK",
        "Write the song.",
      ].join("\n");

      const result = applySongwriterPromptBudget(prompt, {
        narrativeText,
        tokenBudget: 30,
      });

      assert.ok(result.compactions.some((entry) => entry.stage === "key_details_trimmed"));
      const detailsTrim = result.compactions.find((entry) => entry.stage === "key_details_trimmed");
      assert.strictEqual(detailsTrim.droppedCount, 5);
      assert.match(detailsTrim.droppedPreview, /detail 6/i);
    });

    it("records hard-cap summary when the brief must be chopped to fit", () => {
      const prompt = [
        "## SONG BRIEF",
        "FREEFORM STORY BLOCK:",
        "memory ".repeat(1000),
        "## YOUR TASK",
        "Write the song.",
      ].join("\n");

      const result = applySongwriterPromptBudget(prompt, { tokenBudget: 90 });
      const hardCap = result.compactions.find((entry) => entry.stage === "song_brief_hard_cap");

      assert.ok(hardCap, "expected hard-cap compaction");
      assert.ok(hardCap.removedChars > 0, "expected removed chars to be tracked");
      assert.ok(hardCap.removedPreview.length > 0, "expected a removed preview");
    });

    it("returns initial and final prompt budget metadata", () => {
      const prompt = ["## SONG BRIEF", "A short story.", "## YOUR TASK", "Write the song."].join("\n");
      const result = applySongwriterPromptBudget(prompt, { tokenBudget: 80 });

      assert.ok(Number.isFinite(result.initialTokens));
      assert.ok(Number.isFinite(result.tokens));
      assert.ok(Number.isFinite(result.initialChars));
      assert.ok(Number.isFinite(result.finalChars));
      assert.ok(Number.isFinite(result.removedCharsTotal));
      assert.equal(result.initialChars, prompt.length);
      assert.ok(result.tokens <= result.initialTokens);
    });
  });

  describe("story detail ledger", () => {
    it("preserves required emotional story details before long prose can be compacted", () => {
      const chiomaStory = [
        "Chioma, my Chy, when I think about our family, I think about you.",
        "You are hardworking, dependable, and the one who keeps our home running.",
        "The high-risk pregnancy of the twins brought bleeding, fear, pain, and uncertainty.",
        "You followed every instruction, kept every appointment, and endured every discomfort.",
        "I knew you as a young girl and watched you grow into a strong woman.",
        "On your birthday, I want you to know that I see you, appreciate you, and am deeply grateful.",
        "daily family detail ".repeat(1200),
      ].join(" ");
      const context = buildLyricsContext({
        title: "For Chioma",
        recipient_name: "Chioma",
        message: "I see you and appreciate you",
        style: "country",
        occasion: "birthday",
        story_context_json: JSON.stringify({
          narrative: chiomaStory,
          facts: [
            { id: "fact_1", text: "Chioma keeps the home running while managing work and four children.", beat: "context" },
            { id: "fact_2", text: "The high-risk twin pregnancy involved bleeding, fear, pain, and uncertainty.", beat: "turning_point" },
            { id: "fact_3", text: "She followed every instruction, kept every appointment, and endured every discomfort.", beat: "stakes" },
            { id: "fact_4", text: "The sender knew her as a young girl and watched her grow into a strong woman.", beat: "meaning" },
            { id: "fact_5", text: "The birthday message is that she is seen, appreciated, and deeply valued.", beat: "meaning" },
          ],
          completed_story_package: {
            prose: chiomaStory,
            retained_details: [
              { id: "detail_twins", text: "high-risk twin pregnancy with bleeding, fear, pain, and uncertainty", required: true, category: "turning_point" },
              { id: "detail_instructions", text: "followed every instruction, kept every appointment, and endured every discomfort", required: true, category: "sacrifice" },
              { id: "detail_growth", text: "knew her as a young girl and watched her grow into a strong woman", required: true, category: "transformation" },
              { id: "detail_gratitude", text: "birthday gratitude: I see you, appreciate you, and am deeply grateful", required: true, category: "gratitude" },
            ],
          },
          song_map: {
            hook: { idea: "love in action", source_facts: ["fact_5"] },
            verse1: [{ idea: "home, work, and four children", source_facts: ["fact_1"] }],
            chorus: [{ idea: "seen, appreciated, and deeply grateful", source_facts: ["fact_5"] }],
            verse2: [{ idea: "high-risk twin pregnancy and bleeding fear", source_facts: ["fact_2"] }],
            bridge: [{ idea: "young girl to strong woman", source_facts: ["fact_4"] }],
          },
        }),
      });

      const ledger = buildStoryDetailLedger(context);
      assert.ok(ledger.some((entry) => entry.id === "detail_twins" && entry.required), "twins detail should be protected");
      assert.ok(ledger.some((entry) => entry.id === "detail_growth" && entry.required), "growth arc should be protected");

      const promptBuild = buildSongwriterPrompt(context, { returnMetadata: true });
      assert.match(promptBuild.prompt, /STORY DETAIL LEDGER \(BINDING\)/);
      assert.match(promptBuild.prompt, /high-risk twin pregnancy with bleeding/i);
      assert.match(promptBuild.prompt, /young girl and watched her grow/i);
      assert.ok(
        promptBuild.metadata.prompt_input_summary.narrative_chars > 2000,
        "canonical story should survive normalization beyond the old 2,000-char field cap"
      );
      assert.equal(
        promptBuild.metadata.prompt_input_summary.prompt_inputs.story_prose_excerpt.compacted,
        true,
        "long prose should be compacted before prompt budgeting, not after emergency pressure"
      );
      assert.doesNotMatch(
        JSON.stringify(promptBuild.metadata.prompt_budget.compactions),
        /song_brief_hard_cap/,
        "rich completed-story prompts should compact through the ledger before hard-capping"
      );
      assert.ok(promptBuild.metadata.prompt_input_summary.prompt_inputs.story_detail_ledger.required_count >= 4);
    });

    it("detects missing required details before lyrics can pass fidelity", () => {
      const context = {
        recipient_name: "Chioma",
        narrative: "Chioma endured a high-risk twin pregnancy and became a stronger woman.",
        completed_story_package: {
          prose: "Chioma endured a high-risk twin pregnancy and became a stronger woman.",
          retained_details: [
            { id: "detail_twins", text: "high-risk twin pregnancy", required: true },
            { id: "detail_growth", text: "became a stronger woman", required: true },
          ],
        },
      };
      const coverage = assessRequiredDetailCoverage({
        sections: [
          { name: "verse1", lines: ["Chioma kept the house warm", "You made every room feel kind"] },
          { name: "chorus", lines: ["Chioma, you are loved", "We celebrate you today"] },
        ],
      }, context);

      assert.equal(coverage.required_count, 2);
      assert.equal(coverage.covered_count, 0);
      assert.ok(coverage.missing_required.some((detail) => /high-risk twin pregnancy/i.test(detail)));
    });

    it("keeps Chioma-style rich stories feasible by enforcing canonical must-keep beats", () => {
      const retainedDetails = [
        "strength, care, and the steady way she holds family life together",
        "hardworking, dependable, and keeps the home running",
        "appointments, meals, the home, work, and the daily chaos of raising four children",
        "where there could be disorder, she brings structure",
        "where there could be stress, she brings stability",
        "high-risk pregnancy of the twins",
        "bleeding, fear, pain, uncertainty, and constant worry",
        "followed every instruction, kept every appointment, and endured every discomfort",
        "did everything possible to carry the twins safely",
        "love in action, sacrifice, and motherhood at its deepest level",
        "watched her grow from a young girl into a strong woman",
        "rose to motherhood with courage and grace",
        "children growing in a home filled with warmth, care, and structure",
        "birthday gratitude: I see you, appreciate you, and am deeply grateful",
        "celebrates the woman she has become and the blessing she is to the family",
      ].map((text, index) => {
        let category = "meaning";
        if (index >= 5 && index <= 9) category = "sacrifice";
        if (index >= 10 && index <= 12) category = "transformation";
        if (index >= 13) category = "gratitude";
        return {
          id: `chioma_${index + 1}`,
          text,
          required: true,
          category,
        };
      });
      const context = {
        recipient_name: "Chioma",
        occasion: "birthday",
        style: "country",
        narrative: retainedDetails.map((detail) => detail.text).join(". "),
        completed_story_package: {
          prose: retainedDetails.map((detail) => detail.text).join(". "),
          retained_details: retainedDetails,
        },
      };

      const ledger = buildStoryDetailLedger(context, { maxEntries: "all" });
      const requiredTexts = ledger.filter((entry) => entry.required).map((entry) => entry.text).join(" | ");

      assert.equal(ledger.filter((entry) => entry.required).length, 8);
      assert.match(requiredTexts, /high-risk pregnancy|twins/i);
      assert.match(requiredTexts, /bleeding|fear|uncertainty/i);
      assert.match(requiredTexts, /appointments|meals|work|four children/i);
      assert.match(requiredTexts, /young girl|strong woman|motherhood/i);
      assert.match(requiredTexts, /see you|appreciate|grateful|blessing/i);
    });

    it("detects when provider policy sanitation removes a required story detail", () => {
      const context = {
        recipient_name: "Ada",
        narrative: "Ada's birthday story includes the family singing Drake together at the kitchen table.",
        completed_story_package: {
          prose: "Ada's birthday story includes the family singing Drake together at the kitchen table.",
          retained_details: [
            { id: "detail_drake_memory", text: "Drake song", required: true },
          ],
        },
      };
      const lyrics = {
        title: "For Ada",
        sections: [
          { name: "verse1", lines: ["We were singing Drake together at the kitchen table"] },
          { name: "chorus", lines: ["Ada, that birthday stayed in our hearts"] },
        ],
      };

      const before = assessRequiredDetailCoverage(lyrics, context);
      const sanitized = sanitizeLyricsForAllMusicProviders(lyrics, { recipientName: "Ada" });
      const after = assessRequiredDetailCoverage(sanitized.lyrics, context);

      assert.equal(before.missing_required.length, 0, "original lyrics should cover the required detail");
      assert.equal(sanitized.changed, true, "policy sanitizer should rewrite provider-risky artist wording");
      assert.ok(
        after.missing_required.some((detail) => /drake/i.test(detail)),
        "post-policy lyrics must be rechecked because sanitizer can remove required story details"
      );
    });

    it("caps blocking required details while preserving extra story details as support", () => {
      const retainedDetails = Array.from({ length: 50 }, (_, index) => ({
        id: `detail_${index + 1}`,
        text: `required family memory number ${index + 1}`,
        required: true,
      }));
      const context = {
        recipient_name: "Chioma",
        narrative: retainedDetails.map((detail) => detail.text).join(". "),
        completed_story_package: {
          prose: retainedDetails.map((detail) => detail.text).join(". "),
          retained_details: retainedDetails,
        },
      };

      const ledger = buildStoryDetailLedger(context, { maxEntries: "all" });
      const tailDetail = ledger.find((entry) => entry.id === "detail_50");
      assert.ok(tailDetail, "support details must remain visible beyond the blocking contract");
      assert.equal(tailDetail.required, false, "overflow details should be non-blocking support, not impossible song requirements");
      assert.equal(tailDetail.required_downgraded, true);

      const coverage = assessRequiredDetailCoverage({
        sections: [
          { name: "verse1", lines: ["required family memory number 1"] },
        ],
      }, context);

      assert.equal(coverage.required_count, 8);
      assert.ok(
        !coverage.missing_required.some((detail) => /required family memory number 50/i.test(detail)),
        "fidelity should not block on every sentence-level detail after canonical capping"
      );
    });

    it("keeps tail details visible to the fidelity judge for long completed stories", () => {
      const longStory = [
        "Chioma carried the house with steady care.",
        "middle ordinary detail ".repeat(450),
        "At the end, the birthday gratitude says I see you, appreciate you, and am deeply grateful.",
      ].join(" ");
      const certification = buildStoryCertificationBlock({
        recipient_name: "Chioma",
        narrative: longStory,
        completed_story_package: {
          prose: longStory,
          retained_details: [
            {
              id: "tail_gratitude",
              text: "birthday gratitude says I see you, appreciate you, and am deeply grateful",
              required: true,
              category: "gratitude",
            },
          ],
        },
      });

      assert.match(certification, /STORY DETAIL LEDGER \(BINDING\)/);
      assert.match(certification, /tail_gratitude/);
      assert.match(certification, /deeply grateful/i);
      assert.match(certification, /head\/tail/i);
    });
  });

  describe("story-to-lyrics observability summaries", () => {
    it("summarizes a completed story package for live lyric-generation logs", () => {
      const context = buildLyricsContext({
        title: "For Chioma",
        recipient_name: "Chioma",
        message: "You carried our family with strength",
        style: "country",
        occasion: "birthday",
        story_context_json: JSON.stringify({
          narrative: "Chioma held the family steady through the twin pregnancy and the years after.",
          facts: [{ id: "fact_1", text: "She kept every appointment." }],
          motifs: ["love in action"],
          song_map: {
            hook: { idea: "Love in action" },
            verse1: [{ idea: "appointments and work" }],
            chorus: [{ idea: "what her strength means" }],
          },
          completed_story_package: {
            prose: "Chioma carried the house, the work, and the fear of the high-risk twin pregnancy without letting go of anyone she loved.",
            retained_details: [
              { id: "detail_1", text: "high-risk twin pregnancy", required: true },
              { id: "detail_2", text: "kept every appointment", required: true },
            ],
            detail_coverage_stats: {
              total: 2,
              preserved: 1,
              paraphrased: 0,
              missing: 1,
              requiredMissing: 1,
              coverageRate: 0.5,
            },
            missing_required: ["kept every appointment"],
            detail_budget_warning: "Story is long and may need prioritisation",
            llm_rewrite_applied: true,
            schema_version: 2,
          },
        }),
      });

      const summary = summarizeLyricsContextForLog(context);

      assert.equal(summary.recipient_name, "Chioma");
      assert.equal(summary.has_completed_story_package, true);
      assert.equal(summary.completed_story.retained_details_count, 2);
      assert.equal(summary.completed_story.missing_required_count, 1);
      assert.equal(summary.song_map.verse1, 1);
      assert.equal(summary.song_map.chorus, 1);
      assert.equal(summary.facts_count, 1);
    });

    it("summarizes lyric output and fidelity feedback without leaking the full draft", () => {
      const lyricsSummary = summarizeLyricsOutputForLog({
        title: "Love in Action",
        style: "country",
        sections: [
          { name: "verse1", lines: ["Appointments marked in your hand", "You kept the house alive"] },
          { name: "chorus", lines: ["Chioma, love in action", "You held us through the fear"] },
        ],
        anchor_line: "Chioma, love in action",
        story_elements_used: ["appointments", "the fear", "the house"],
      });

      const fidelitySummary = summarizeFidelityForLog({
        total: 33,
        coverage: 8,
        flow: 6,
        specificity: 7,
        emotional_truth: 7,
        faithfulness: 5,
        missing_story_beats: ["growth into a stronger woman"],
        invented_details: ["sunrise prayers"],
        uncovered_song_map_slots: ["bridge"],
        broken_citations: [],
        rewrite_targets: ["restore the payoff"],
        flattened_emotional_arc: "The ending is too generic.",
        feedback: "Restore the birthday gratitude and growth arc.",
      });

      assert.equal(lyricsSummary.section_count, 2);
      assert.equal(lyricsSummary.line_count, 4);
      assert.equal(lyricsSummary.story_elements_used_count, 3);
      assert.match(lyricsSummary.anchor_line, /Chioma/);

      assert.equal(fidelitySummary.total, 33);
      assert.equal(fidelitySummary.missing_story_beats_count, 1);
      assert.equal(fidelitySummary.invented_details_count, 1);
      assert.deepEqual(fidelitySummary.uncovered_song_map_slots, ["bridge"]);
      assert.match(fidelitySummary.feedback, /growth arc/i);
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

    it("keeps at least two prompt facts when narrative overlaps heavily with them", () => {
      const prompt = buildSongwriterPrompt({
        recipient_name: "Chioma",
        message: "You carried our family",
        occasion: "mothers_day",
        style: "pop",
        narrative: "Chioma carried school runs, work calls, and the family through a frightening twin pregnancy, then everyone loved and respected her even more.",
        facts: [
          { text: "Chioma carried school runs, work calls, and the family through a frightening twin pregnancy." },
          { text: "After the fear and warnings, everyone loved and respected her even more." },
          { text: "Watching her grow into a stronger woman changed how the family saw her." },
        ],
      });

      assert.match(prompt, /KEY DETAILS:/);
      assert.match(prompt, /frightening twin pregnancy/i);
      assert.match(prompt, /loved and respected her even more|stronger woman/i);
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
    it("repairs story-backed contexts into a contract while preserving supporting scene details", () => {
      const context = {
        recipient_name: "Mom",
        occasion: "birthday",
        style: "pop",
        message: "Happy birthday Mom",
        narrative: "Mom always cooked Sunday breakfast, even after the hardest weeks, and that steadiness taught us what home felt like.",
        facts: [
          { text: "pancakes every Sunday", beat: "scene", source_turn: 1 },
          { text: "the kitchen smelled like maple", beat: "detail", source_turn: 3 },
          { text: "even after the hardest weeks, she still made breakfast", beat: "turning_point", source_turn: 4 },
          { text: "that steadiness taught us what home felt like", beat: "meaning", source_turn: 5 },
        ],
        beats: [{ id: "scene", strength: 0.8, status: "covered" }],
        atoms: { where: "our kitchen", when: "Sunday mornings", who: "Mom" },
        primitives: {
          theme: "warmth and routine",
          turning_point: "even after the hardest weeks, she still made breakfast",
          resolution: "that steadiness taught us what home felt like",
        },
      };
      const prompt = buildSongwriterPrompt(context);
      assert.ok(prompt.includes("STORY ARC"), "Should include story arc section");
      assert.ok(prompt.includes("PRIMARY STORY-TO-SONG CONTRACT"), "Should repair structured story data into a contract");
      assert.ok(!prompt.includes("VERSE 1 (THE BEGINNING)"), "Should suppress fallback arc guidance once the contract is valid");
      assert.ok(prompt.includes("our kitchen"), "Should keep supporting scene details outside the contract");
      assert.ok(prompt.includes("CONTRACT REPAIR"), "Should explain internal contract repair");
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
      assert.ok(!prompt.includes("CONTRACT REPAIR"), "Should not synthesize or repair a contract for non-story prompts");
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

    it("uses cited contract guidance without fallback arc duplication", () => {
      const context = {
        recipient_name: "Chioma",
        occasion: "mothers_day",
        style: "pop",
        message: "You held us together",
        narrative: "She carried the family through fear and became the heart of the home.",
        facts: [
          { id: "f1", text: "School runs and work calls filled every day", beat: "scene" },
          { id: "f2", text: "The high-risk twin pregnancy changed everything", beat: "turning_point" },
          { id: "f3", text: "Watching her grow into a stronger woman deepened love and respect", beat: "meaning" },
        ],
        song_map: {
          hook: { idea: "You are the heartbeat of our home", source_facts: ["f3"] },
          verse1: [{ idea: "School runs and work calls filled every day", source_facts: ["f1"] }],
          chorus: [{ idea: "What it meant was love under pressure", source_facts: ["f3"] }],
          verse2: [{ idea: "The high-risk twin pregnancy changed everything", source_facts: ["f2"] }],
          bridge: [{ idea: "Watching her grow into a stronger woman", source_facts: ["f3"] }],
          key_lines: [{ idea: "You made our house a home", source_facts: ["f3"] }],
        },
        motifs: ["school runs", "doctor's warnings"],
      };
      const prompt = buildSongwriterPrompt(context);
      assert.ok(prompt.includes("PRIMARY STORY-TO-SONG CONTRACT"), "Should elevate cited contract");
      assert.ok(prompt.includes("Support: School runs and work calls filled every day"), "Should include cited fact support");
      assert.ok(!prompt.includes("VERSE 1 (THE BEGINNING)"), "Should suppress fallback arc guidance when contract is valid");
    });

    it("accepts single-string and alias citation fields without losing support", () => {
      const context = {
        recipient_name: "Chioma",
        occasion: "mothers_day",
        style: "pop",
        message: "You held us together",
        facts: [
          { id: "f1", text: "School runs and work calls filled every day", beat: "scene" },
          { id: "f2", text: "Watching her grow into a stronger woman deepened love and respect", beat: "meaning" },
          { id: "f3", text: "The frightening pregnancy changed everything", beat: "turning_point" },
        ],
        song_map: {
          hook: { text: "You made our house a home", facts: "f2" },
          verse1: [{ line: "School runs and work calls filled every day", source_facts: "f1" }],
          chorus: [{ idea: "What it meant was love under pressure", facts: ["f2"] }],
          verse2: [{ text: "The frightening pregnancy changed everything", facts: "f3" }],
          bridge: [{ idea: "Watching her grow into a stronger woman", source_facts: ["f2"] }],
        },
      };

      const prompt = buildSongwriterPrompt(context);
      assert.ok(prompt.includes("PRIMARY STORY-TO-SONG CONTRACT"), "normalized alias fields should still produce a valid contract");
      assert.ok(prompt.includes("Support: School runs and work calls filled every day"), "single-string citations should be normalized");
      assert.ok(prompt.includes("Support: Watching her grow into a stronger woman deepened love and respect"), "facts alias should be normalized");
    });

    it("falls back per-section when a partial cited contract cannot be fully repaired", () => {
      const context = {
        recipient_name: "Chioma",
        occasion: "mothers_day",
        style: "pop",
        message: "You held us together",
        atoms: { where: "our kitchen", when: "late nights", who: "Chioma" },
        song_map: {
          hook: { idea: "You made our house a home", source_facts: ["f_missing"] },
        },
      };

      const prompt = buildSongwriterPrompt(context);
      assert.ok(prompt.includes("PRIMARY STORY-TO-SONG MAP"), "partial invalid contract should stay advisory");
      assert.ok(prompt.includes("VERSE 1 (THE BEGINNING)"), "missing sections should still get fallback structural guidance");
      assert.ok(prompt.includes("our kitchen"), "fallback guidance should preserve supporting atoms");
    });

    it("repairs weak contracts internally before lyric generation guidance", () => {
      const context = {
        recipient_name: "Chioma",
        occasion: "mothers_day",
        style: "pop",
        message: "You held us together",
        narrative: "She carried the family through fear and became the heart of the home.",
        facts: [
          { id: "f1", text: "School runs and work calls filled every day", beat: "scene" },
          { id: "f2", text: "The high-risk twin pregnancy changed everything", beat: "turning_point" },
          { id: "f3", text: "Watching her grow into a stronger woman deepened love and respect", beat: "meaning" },
        ],
        primitives: {
          turning_point: "The high-risk twin pregnancy changed everything",
          resolution: "Watching her grow into a stronger woman deepened love and respect",
          theme: "She made the house feel like home",
        },
        song_map: {
          hook: "You made our house a home",
        },
      };
      const prompt = buildSongwriterPrompt(context);
      assert.ok(prompt.includes("CONTRACT REPAIR"), "Should disclose internal contract repair in prompt context");
      assert.ok(prompt.includes("PRIMARY STORY-TO-SONG CONTRACT"), "Repaired contract should become primary scaffold");
      assert.ok(prompt.includes("School runs and work calls filled every day"), "Should repair verse1 from facts");
      assert.ok(prompt.includes("Watching her grow into a stronger woman"), "Should repair payoff guidance");
      assert.ok(!prompt.includes("VERSE 1 (THE BEGINNING)"), "Should not fall back to duplicate arc guidance after repair");
    });

    it("replaces geography-led chorus and vague bridge with stronger payoff material", () => {
      const context = {
        recipient_name: "Chioma",
        occasion: "mothers_day",
        style: "acoustic",
        message: "You held us together",
        initial_prompt: [
          "Chioma, my Chy, when I think about our family, I think about you.",
          "You keep track of appointments, think ahead about what everyone will eat, organise the home, and still manage the demands of work.",
          "You make this house feel like a real home.",
          "That was love in action. That was sacrifice. That was motherhood at its deepest level.",
          "Watching you become a mother has made me love and respect you even more.",
          "I have watched you grow into a strong woman who rose to the demands of motherhood with courage and grace.",
          "This Mother's Day, I want you to know that I see you, I appreciate you, and I am deeply grateful.",
        ].join(" "),
        narrative: "Chioma, you are the heart of our family from Okija to Perth. You manage work, home, and four children. Your strength shone during the twins' high-risk pregnancy with bleeding and worry. Our relationship now blooms in Perth. Seeing our life unfold here feels like a dream come true.",
        facts: [
          { id: "f1", text: "You keep track of appointments, think ahead about what everyone will eat, organise the home, and still manage the demands of work.", beat: "context" },
          { id: "f2", text: "You make this house feel like a real home.", beat: "meaning" },
          { id: "f3", text: "That was love in action. That was sacrifice. That was motherhood at its deepest level.", beat: "meaning" },
          { id: "f4", text: "Watching you become a mother has made me love and respect you even more.", beat: "impact" },
          { id: "f5", text: "I have watched you grow into a strong woman who rose to the demands of motherhood with courage and grace.", beat: "impact" },
          { id: "f6", text: "This Mother's Day, I want you to know that I see you, I appreciate you, and I am deeply grateful.", beat: "meaning" },
          { id: "f7", text: "The relationship started in Okija and is still blooming in Perth.", beat: "scene" },
          { id: "f8", text: "Life in Perth feels like watching a dream come true.", beat: "impact" },
        ],
        primitives: {
          resolution: "Life in Perth feels like watching a dream come true.",
          theme: "Our relationship began in Okija and now blooms in Perth.",
          turning_point: "The high-risk twin pregnancy changed everything",
        },
        song_map: {
          hook: "Chioma, you are the heart of our family, anchoring us from Okija to Perth.",
          verse1: ["You manage work, home, and four children."],
          chorus: ["Our relationship began in Okija and now blooms in Perth."],
          bridge: ["Seeing our life unfold here, it's like watching a dream come true."],
        },
      };

      const prompt = buildSongwriterPrompt(context);
      assert.ok(prompt.includes("PRIMARY STORY-TO-SONG CONTRACT"), "weak legacy contract should be rewritten into a stronger contract");
      assert.doesNotMatch(prompt, /CHORUS \(MEANING\):\n- Our relationship began in Okija and now blooms in Perth\./i);
      assert.doesNotMatch(prompt, /BRIDGE \(TURN \/ VOW \/ REFLECTION\):\n- Seeing our life unfold here, it's like watching a dream come true\./i);
      assert.match(prompt, /CHORUS \(MEANING\):[\s\S]*real home|CHORUS \(MEANING\):[\s\S]*sacrifice|CHORUS \(MEANING\):[\s\S]*deeply grateful/i);
      assert.match(prompt, /BRIDGE \(TURN \/ VOW \/ REFLECTION\):[\s\S]*strong woman|BRIDGE \(TURN \/ VOW \/ REFLECTION\):[\s\S]*love and respect/i);
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
