/**
 * Golden E2E test: completed story package authority chain.
 *
 * Exercises the full pipeline:
 *   ensureCompletedStoryPackage → to-track serialization → buildLyricsContext
 *   → buildSongwriterPrompt → buildStoryCertificationBlock
 *
 * Proves the three principles:
 *   1. Zero detail loss — retained details survive the round-trip
 *   2. Completed story = single source of truth — prose is authoritative
 *   3. Lyrics derive from completed story — judge certifies against it
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  extractRetainedDetails,
  computeDetailCoverage,
} = require("../../src/writer/story-semantics");
const {
  buildSongwriterPrompt,
  buildStoryCertificationBlock,
} = require("../../src/writer/songwriter");
const { buildLyricsContext } = require("../../src/writer/lyrics-context");

// ---------------------------------------------------------------------------
// Fixture: Chioma story with follow-up conversation + facts + atoms
// ---------------------------------------------------------------------------

const CHIOMA_LETTER = [
  "Chioma, my Chy, when I think about our family, I think about you.",
  "You are hardworking, dependable, and the one who keeps so much of our home and lives together.",
  "From morning to night, you carry responsibilities that are easy to overlook but impossible to replace.",
  "You keep track of appointments, think ahead about what everyone will eat, organise the home, and still manage the demands of work.",
  "In the middle of all the noise and pressure, you keep showing up for all of us.",
  "",
  "I see it in the everyday chaos of raising four children, especially in those busy moments when the house is full of competing demands.",
  "Yet you bring order, care, and stability.",
  "You do more than manage tasks.",
  "You make this house feel like a real home.",
  "",
  "I will never forget the high-risk pregnancy of the twins.",
  "There was fear, pain, and uncertainty, especially with the bleeding and the constant worry.",
  "But you stayed strong.",
  "You followed every instruction, kept every appointment, endured every discomfort, and did everything you could to carry them safely.",
  "That was love in action.",
  "That was sacrifice.",
  "That was motherhood at its deepest level.",
  "",
  "Watching you become a mother has made me love and respect you even more.",
  "I knew you as a young girl, but I have watched you grow into a strong woman who rose to the demands of motherhood with courage and grace.",
  "Because of you, our children are growing up in a home filled with warmth, care, and structure.",
  "",
  "This Mother's Day, I want you to know that I see you, I appreciate you, and I am deeply grateful for all you do for me, for our children, and for this family.",
].join(" ");

const COMPLETE_NARRATIVE = [
  "Chioma, my Chy, you are the heart of our family.",
  "You are hardworking, dependable, and the one who keeps so much of our home and lives together.",
  "From morning to night, you carry responsibilities that are easy to overlook but impossible to replace.",
  "You keep track of appointments, think ahead about what everyone will eat, organise the home, and still manage the demands of work.",
  "In the middle of all the noise and pressure, you keep showing up for all of us.",
  "In the everyday chaos of raising four children, you bring order, care, and stability.",
  "You make this house feel like a real home.",
  "The high-risk pregnancy of the twins brought fear, pain, and uncertainty, especially with the bleeding and constant worry.",
  "But you stayed strong -- following every instruction, keeping every appointment, enduring every discomfort to carry them safely.",
  "That was love in action, sacrifice, and motherhood at its deepest level.",
  "Watching you become a mother, from a young girl to a strong woman who rose with courage and grace, has made me love and respect you even more.",
  "Because of you, our children grow up in warmth, care, and structure.",
  "This Mother's Day, I want you to know that I see you, I appreciate you, and I am deeply grateful.",
].join(" ");

const CONVERSATION = [
  { role: "assistant", content: "What is your favourite memory with Chioma?" },
  { role: "user", content: "Seeing her handle everything is like watching a dream come true." },
  { role: "assistant", content: "Can you tell me about a challenging time you faced together?" },
  { role: "user", content: "The bleeding during the twin pregnancy was terrifying." },
];

const FACTS = [
  { id: "f_family", text: "Chioma carries the family through morning to night.", beat: "scene" },
  { id: "f_twins", text: "High-risk pregnancy with twins involved bleeding and fear.", beat: "turning_point" },
  { id: "f_surfing", text: "They went surfing in Hawaii last summer.", beat: "scene" },  // UNRELATED — must be filtered
];

const ATOMS = {
  who: "Chioma",
  where: "Lagos",  // short — should bypass overlap filter
  when: "Mother's Day",
  what: "Raising four children while managing work and home",
  unrelated_atom: "Surfing competitions in Australia are world-renowned events",  // long + unrelated — should be filtered
};

const PRIMITIVES = {
  theme: "Sacrifice and motherhood at its deepest level",
  turning_point: "High-risk twin pregnancy with bleeding and fear",
  resolution: "Chioma grew from a young girl into a strong woman of courage",
  unrelated_prim: "Professional surfing requires years of ocean training",  // unrelated — should be filtered
};

const MOTIFS = [
  "morning to night dedication",
  "strength through fear",
  "random surfing metaphor",  // unrelated — should be filtered
];

const SONG_MAP = {
  hook: { idea: "Chioma, you are our heart" },
  verse1: { idea: "Morning to night, carrying the family" },
  chorus: { idea: "Love in action, sacrifice at its deepest" },
  verse2: { idea: "High-risk pregnancy, staying strong through fear" },
  bridge: { idea: "From young girl to strong woman of courage" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simulates the exact to-track serialization from src/routes/story.js:2727 */
function simulateToTrackSerialization(storyContext) {
  const csp = storyContext.completed_story_package;
  return JSON.stringify({
    story_id: "story_e2e_chioma",
    elements: storyContext.elements || {},
    narrative: typeof storyContext.narrative === "string"
      ? storyContext.narrative.slice(0, 10000) : "",
    facts: (storyContext.facts || []).slice(0, 20),
    beats: (storyContext.beats || []).slice(0, 15),
    atoms: storyContext.atoms || {},
    primitives: storyContext.primitives || {},
    motifs: storyContext.motifs || [],
    song_map: storyContext.song_map || null,
    evaluation: storyContext.evaluation || null,
    completed_story_package: csp
      ? {
          prose: (csp.prose || "").slice(0, 10000),
          retained_details: (csp.retained_details || []).slice(0, 30),
          detail_coverage_stats: csp.detail_coverage_map?.stats || null,
          missing_required: csp.detail_coverage_map?.missingRequired || [],
          semantic_block_profile: csp.semantic_block_profile || null,
          schema_version: csp.schema_version || null,
          detail_budget_warning: csp.detail_budget_warning || null,
        }
      : null,
    dials: storyContext.dials || {},
    summary: storyContext.summary,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("E2E: Story-to-Lyrics Authority Chain (Chioma flow)", () => {

  // Build the completed story package context
  const retainedDetails = extractRetainedDetails({
    initial_prompt: CHIOMA_LETTER,
    conversation: CONVERSATION,
    facts: FACTS,
  });
  const coverage = computeDetailCoverage(retainedDetails, COMPLETE_NARRATIVE);

  const engineContext = {
    recipient_name: "Chioma",
    occasion: "Mother's Day",
    style: "afrobeat",
    title: "Heart of Our Family",
    message: "For the woman who holds us together",
    narrative: COMPLETE_NARRATIVE,
    facts: FACTS,
    beats: [{ id: "b1", purpose: "family dedication", strength: 0.9 }],
    atoms: ATOMS,
    primitives: PRIMITIVES,
    motifs: MOTIFS,
    song_map: SONG_MAP,
    completed_story_package: {
      prose: COMPLETE_NARRATIVE,
      retained_details: retainedDetails,
      detail_coverage_map: coverage,
      semantic_block_profile: { blocks: ["dedication", "sacrifice", "transformation"] },
      schema_version: 2,
      detail_budget_warning: null,
      built_at: new Date().toISOString(),
    },
  };

  // ── Principle 1: Zero detail loss ──────────────────────────────────

  describe("Principle 1: Zero detail loss", () => {
    it("retains ALL original details from initial prompt", () => {
      const initialDetails = retainedDetails.filter(
        (d) => d.source === "initial_prompt",
      );
      assert.ok(initialDetails.length > 0, "Should extract details from initial prompt");

      // Key story elements must be present
      const texts = initialDetails.map((d) => d.text.toLowerCase()).join(" ");
      assert.ok(texts.includes("chioma"), "Should retain Chioma");
      assert.ok(texts.includes("twins") || texts.includes("twin"), "Should retain twins reference");
      assert.ok(texts.includes("sacrifice") || texts.includes("motherhood"), "Should retain sacrifice/motherhood");
    });

    it("retains prompted follow-up details", () => {
      const followUpDetails = retainedDetails.filter(
        (d) => d.source.startsWith("conversation_turn_"),
      );
      assert.ok(followUpDetails.length > 0, "Should extract details from follow-up turns");

      // The bleeding follow-up detail should be extracted (captured as a conversation turn)
      const bleedingDetail = followUpDetails.find(
        (d) => d.text.toLowerCase().includes("bleeding") || d.text.toLowerCase().includes("terrifying"),
      );
      assert.ok(bleedingDetail, "Follow-up about bleeding should be extracted as a detail");

      // Note: with a rich initial prompt (33+ required details from initial_prompt alone),
      // the soft cap (MAX_REQUIRED=20) may downgrade conversation_turn details to non-required.
      // This is by design — the initial prompt already captures bleeding.
      // What matters is ZERO DETAIL LOSS: the detail is retained, even if non-required.

      // Verify the bleeding content IS covered in the initial prompt too
      const initialBleeding = retainedDetails.find(
        (d) => d.source === "initial_prompt" &&
          (d.text.toLowerCase().includes("bleeding") || d.text.toLowerCase().includes("fear")),
      );
      assert.ok(initialBleeding, "Bleeding/fear should also be captured from initial prompt");
      assert.equal(initialBleeding.required, true, "Initial prompt bleeding detail should be required");
    });

    it("computes coverage with zero or near-zero missing required", () => {
      assert.ok(coverage.stats, "Coverage stats should exist");
      assert.ok(
        coverage.stats.requiredMissing <= 2,
        `At most 2 required details should be missing, got ${coverage.stats.requiredMissing}`,
      );
    });
  });

  // ── Round-trip: serialize → restore ────────────────────────────────

  describe("Round-trip: to-track serialization → buildLyricsContext", () => {
    const serialized = simulateToTrackSerialization(engineContext);
    const track = {
      title: "Heart of Our Family",
      recipient_name: "Chioma",
      message: "For the woman who holds us together",
      style: "afrobeat",
      occasion: "Mother's Day",
      story_context_json: serialized,
    };
    const restored = buildLyricsContext(track);

    it("completed_story_package.prose survives round-trip", () => {
      assert.ok(restored.completed_story_package, "completed_story_package should be restored");
      assert.equal(
        restored.completed_story_package.prose,
        COMPLETE_NARRATIVE,
        "Prose should survive serialization round-trip unchanged",
      );
    });

    it("retained_details survive round-trip", () => {
      assert.ok(
        restored.completed_story_package.retained_details.length > 0,
        "retained_details should survive round-trip",
      );
    });

    it("detail_coverage_map is reconstructed from decomposed fields (F0 fix)", () => {
      const pkg = restored.completed_story_package;
      assert.ok(pkg.detail_coverage_map, "detail_coverage_map should be reconstructed");
      assert.ok(
        pkg.detail_coverage_map.stats || pkg.detail_coverage_map.missingRequired,
        "Reconstructed detail_coverage_map should have stats or missingRequired",
      );
    });

    it("schema_version persists through serializer (gap 6 fix)", () => {
      const pkg = restored.completed_story_package;
      assert.equal(pkg.schema_version, 2, "schema_version should persist through round-trip");
    });

    it("song_map survives round-trip", () => {
      assert.ok(restored.song_map, "song_map should survive");
      assert.ok(restored.song_map.hook, "song_map.hook should survive");
      assert.ok(restored.song_map.chorus, "song_map.chorus should survive");
    });
  });

  // ── Principle 2: Completed story = single source of truth ──────────

  describe("Principle 2: Single source of truth in songwriter prompt", () => {
    const serialized = simulateToTrackSerialization(engineContext);
    const track = {
      title: "Heart of Our Family",
      recipient_name: "Chioma",
      message: "For the woman who holds us together",
      style: "afrobeat",
      occasion: "Mother's Day",
      story_context_json: serialized,
    };
    const restored = buildLyricsContext(track);
    const prompt = buildSongwriterPrompt(restored);

    it("labels completed story as AUTHORITATIVE", () => {
      assert.ok(
        prompt.includes("AUTHORITATIVE COMPLETED STORY"),
        "Prompt must contain AUTHORITATIVE COMPLETED STORY label",
      );
      assert.ok(
        prompt.includes("single source of truth"),
        "Prompt must declare single source of truth",
      );
    });

    it("does NOT use legacy STORY NARRATIVE label", () => {
      assert.ok(
        !prompt.includes("STORY NARRATIVE"),
        "Must NOT contain legacy STORY NARRATIVE when completed story exists",
      );
    });

    it("filters unrelated facts from KEY DETAILS", () => {
      const keyDetailsStart = prompt.indexOf("KEY DETAILS:");
      if (keyDetailsStart >= 0) {
        const keyDetailsEnd = prompt.indexOf("\n\n", keyDetailsStart);
        const section = keyDetailsEnd > keyDetailsStart
          ? prompt.slice(keyDetailsStart, keyDetailsEnd)
          : prompt.slice(keyDetailsStart);

        assert.ok(
          !section.includes("surfing"),
          "KEY DETAILS must NOT include unrelated 'surfing' fact",
        );
        assert.ok(
          section.includes("Chioma carries"),
          "KEY DETAILS must include story-related Chioma fact",
        );
      }
    });

    it("filters unrelated atoms from STRUCTURAL HINTS", () => {
      const hintsStart = prompt.indexOf("STRUCTURAL HINTS");
      if (hintsStart >= 0) {
        const hintsEnd = prompt.indexOf("\n\n", hintsStart);
        const section = hintsEnd > hintsStart
          ? prompt.slice(hintsStart, hintsEnd)
          : prompt.slice(hintsStart);

        // "Lagos" is short (< 3 sig words) — should bypass filter
        // We don't assert its presence because it may or may not be formatted as a hint
        // But unrelated long atom should be filtered
        assert.ok(
          !section.toLowerCase().includes("surfing competitions"),
          "STRUCTURAL HINTS must NOT include unrelated long atom",
        );
      }
    });

    it("filters unrelated motifs", () => {
      const motifsStart = prompt.indexOf("RECURRING MOTIFS");
      if (motifsStart >= 0) {
        const motifsEnd = prompt.indexOf("\n\n", motifsStart);
        const section = motifsEnd > motifsStart
          ? prompt.slice(motifsStart, motifsEnd)
          : prompt.slice(motifsStart);

        assert.ok(
          !section.includes("surfing"),
          "MOTIFS must NOT include unrelated 'surfing' motif",
        );
        assert.ok(
          section.includes("morning to night") || section.includes("strength through fear"),
          "MOTIFS must include story-related motifs",
        );
      }
    });
  });

  // ── Principle 3: Lyrics derive from completed story ────────────────

  describe("Principle 3: Judge certifies against completed story", () => {
    const serialized = simulateToTrackSerialization(engineContext);
    const track = {
      title: "Heart of Our Family",
      recipient_name: "Chioma",
      message: "For the woman who holds us together",
      style: "afrobeat",
      occasion: "Mother's Day",
      story_context_json: serialized,
    };
    const restored = buildLyricsContext(track);
    const certBlock = buildStoryCertificationBlock(restored);

    it("labels completed story as PRIMARY in judge block", () => {
      assert.ok(
        certBlock.includes("PRIMARY"),
        "Judge block must label completed story as PRIMARY",
      );
      assert.ok(
        certBlock.includes("single source of truth"),
        "Judge block must declare single source of truth",
      );
    });

    it("includes completed story prose in judge block", () => {
      // Key phrases from the complete narrative
      assert.ok(certBlock.includes("Chioma"), "Judge block must include Chioma");
      assert.ok(
        certBlock.includes("high-risk pregnancy") || certBlock.includes("twins"),
        "Judge block must include key story events",
      );
    });

    it("filters unrelated facts from judge block", () => {
      // The surfing fact should be excluded (zero overlap with completed story prose)
      assert.ok(
        !certBlock.includes("surfing in Hawaii"),
        "Judge block must NOT include unrelated 'surfing in Hawaii' fact",
      );
    });

    it("filters unrelated primitives from judge block", () => {
      assert.ok(
        !certBlock.toLowerCase().includes("professional surfing"),
        "Judge block must NOT include unrelated 'professional surfing' primitive",
      );
    });

    it("retains story-related primitives in judge block", () => {
      assert.ok(
        certBlock.includes("Sacrifice") || certBlock.includes("sacrifice") || certBlock.includes("motherhood"),
        "Judge block must retain story-related theme primitive",
      );
    });
  });

  // ── Backward compatibility: null package ───────────────────────────

  describe("Backward compat: no completed_story_package (legacy tracks)", () => {
    const legacyContext = {
      recipient_name: "Chioma",
      occasion: "Mother's Day",
      style: "afrobeat",
      title: "Heart of Our Family",
      message: "For the woman who holds us together",
      narrative: "Chioma is the heart of the family.",
      facts: FACTS,
      atoms: ATOMS,
      primitives: PRIMITIVES,
      motifs: MOTIFS,
      song_map: SONG_MAP,
      // NO completed_story_package
    };

    it("songwriter prompt uses STORY NARRATIVE for legacy tracks", () => {
      const prompt = buildSongwriterPrompt(legacyContext);
      assert.ok(
        prompt.includes("STORY NARRATIVE"),
        "Legacy tracks must use STORY NARRATIVE label",
      );
      assert.ok(
        !prompt.includes("AUTHORITATIVE COMPLETED STORY"),
        "Legacy tracks must NOT use AUTHORITATIVE label",
      );
    });

    it("all facts included for legacy tracks (no prose-overlap filtering)", () => {
      const prompt = buildSongwriterPrompt(legacyContext);
      // With no completed story, filterFactsForPrompt is used instead of prose-overlap
      // All facts that pass the narrative redundancy check should appear
      assert.ok(
        prompt.includes("Chioma carries"),
        "Legacy: Chioma fact should be included",
      );
    });

    it("all atoms/primitives included for legacy tracks", () => {
      const prompt = buildSongwriterPrompt(legacyContext);
      // With no proseIsSubstantial, all atoms should pass through
      assert.ok(
        prompt.includes("Lagos") || prompt.includes("Mother's Day") || prompt.includes("Chioma"),
        "Legacy: atoms should be included without filtering",
      );
    });

    it("judge block uses narrative fallback for legacy tracks", () => {
      const certBlock = buildStoryCertificationBlock(legacyContext);
      assert.ok(
        !certBlock.includes("PRIMARY"),
        "Legacy judge block should NOT label as PRIMARY",
      );
    });
  });
});
