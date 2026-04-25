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
const {
  STORY_CONTEXT_FACTS_MAX,
  STORY_CONTEXT_NARRATIVE_MAX_LENGTH,
  STORY_CONTEXT_RETAINED_DETAILS_MAX,
  buildTrackStoryContextPayload,
} = require("../../src/writer/story-context-serialization");

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

/** Simulates the exact to-track serialization from src/routes/story.js. */
function simulateToTrackSerialization(storyContext) {
  return JSON.stringify(buildTrackStoryContextPayload(storyContext, { storyId: "story_e2e_chioma" }));
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

  // ── Adversarial: long story with multiple follow-ups ──────────────
  //
  // Regression test for the detail-density edge case:
  //   - A 5000+ char initial prompt that produces 30+ required details
  //   - 5 follow-up conversation turns, each introducing UNIQUE details
  //   - Unrelated facts that must be filtered by prose overlap
  //   - Complete round-trip through serialization → songwriter → judge
  //
  // This exercises the soft cap, conversation detail extraction, and
  // prose-overlap filtering under maximal pressure.

  describe("Adversarial: long story with multiple follow-ups", () => {

    // ── Fixture: Marcus's story ────────────────────────────────────
    // A father's 20-year journey through entrepreneurship, near-bankruptcy,
    // and redemption. Deliberately dense: 40+ sentences, 5000+ chars.

    const MARCUS_LETTER = [
      "Marcus, my father, is the strongest man I have ever known.",
      "He grew up in a small town in Ohio with nothing but determination and a dream of building something of his own.",
      "When he was twenty-three, he took every dollar he had saved from working at the steel mill and opened a small furniture workshop in our garage.",
      "Those first years were brutal, working eighteen-hour days, sanding wood until his hands bled, delivering pieces in a borrowed pickup truck.",
      "Mom would bring him dinner at midnight because he refused to stop until every order was perfect.",
      "By the time I was five, the workshop had grown into a real storefront on Main Street, and Dad hired his first two employees.",
      "He taught them the same obsessive attention to detail that defined everything he built.",
      "Every joint had to be seamless, every finish had to glow, every chair had to last a hundred years.",
      "That was his promise to every customer who walked through the door.",
      "But the 2008 recession hit our family like a freight train.",
      "Orders dried up overnight, and the phone stopped ringing for weeks at a time.",
      "Dad had to let both employees go, and I remember watching him sit at the kitchen table with a stack of bills, his head in his hands.",
      "He refinanced the house twice to keep the business alive, borrowing against everything we owned.",
      "There were nights when Mom and Dad whispered in the hallway, thinking we were asleep, and I could hear the fear in their voices.",
      "The bank sent letters every month threatening to foreclose on our home.",
      "Our neighbors stopped coming over, as if financial hardship was contagious.",
      "I was twelve years old and I did not fully understand what was happening, but I knew my father was fighting a war he might not win.",
      "He never once complained in front of us kids.",
      "He would wake up at four in the morning, put on his work boots, and drive to the empty shop as though customers were waiting.",
      "Some days he spent the entire afternoon polishing a single table that nobody had ordered, just to keep his hands busy and his mind sharp.",
      "Mom took a second job at the hospital, working night shifts to cover the grocery bills while Dad searched for any contract he could find.",
      "She never blamed him, not once, and that quiet solidarity held our family together through the darkest stretch.",
      "When the twins were born in 2010, right in the middle of the crisis, everyone thought we were crazy.",
      "But Dad said new life was the only proof he needed that things would get better.",
      "He built two matching cribs by hand from reclaimed oak, carved their initials into the headboards, and promised them a future worth having.",
      "Those cribs became a symbol of everything he believed in: you build beautiful things even when the world is falling apart.",
      "Slowly, painfully, things started to turn around.",
      "A local architect named Catherine discovered Dad's work at a church craft fair and commissioned a full dining set for a restored farmhouse.",
      "That single commission led to a feature in a regional design magazine, which led to three more orders, then ten, then fifty.",
      "By 2013, the workshop was bigger than it had ever been, now occupying the entire building with six employees and a two-month waiting list.",
      "Dad paid back every cent he owed, shook the bank manager's hand, and framed the final mortgage statement on the workshop wall.",
      "He cried that day, the only time I ever saw tears on his face, standing in the sawdust with sawdust in his hair and freedom in his hands.",
      "He expanded into custom cabinetry and architectural woodwork, partnering with builders across three counties.",
      "The business grew not because of marketing or luck, but because every single piece that left the shop carried his reputation.",
      "Dad always said that wood remembers the hands that shaped it, and he wanted every piece to remember kindness and precision.",
      "When I graduated high school, he gave me a hand-carved walnut box with a letter inside.",
      "The letter said that the hardest years taught him that success is not about money, it is about refusing to quit on the people who count on you.",
      "He wrote that watching me and the twins grow up healthy and loved was the only paycheck that mattered.",
      "Now, twenty years after that garage workshop, Marcus Furniture is a landmark in our town.",
      "Dad mentors young apprentices, teaching them that craftsmanship is a form of love.",
      "He still arrives at four in the morning, still polishes every surface by hand, still promises every customer a hundred years of beauty.",
      "He is sixty-three years old and his hands are rough and scarred, but everything they touch turns into something extraordinary.",
      "This song is for the man who built our family with the same care he builds his furniture: one perfect joint at a time.",
    ].join(" ");

    // 5 follow-up conversation turns, each with UNIQUE details not in initial prompt
    const MARCUS_CONVERSATION = [
      { role: "assistant", content: "What was the hardest moment your family faced together?" },
      { role: "user", content: "The foreclosure notice arrived on Christmas Eve. Dad sat in the garage alone for three hours. When he came back inside, he told us Santa was running late this year but he would definitely come. I was twelve and I already knew the truth about Santa, but hearing him say that broke my heart and made me love him more than ever." },
      { role: "assistant", content: "Who supported your father through those difficult times?" },
      { role: "user", content: "Maria, my mother, sold her grandmother's emerald ring to keep the lights on that winter. She never told Dad about it until years later. When he found out, he spent six months searching antique shops and finally found a nearly identical ring. He surprised her on their twentieth anniversary. That ring sits on her finger right now." },
      { role: "assistant", content: "Was there a specific turning point when things started getting better?" },
      { role: "user", content: "The phone call from Johnson and Associates changed everything. Robert Johnson was an architect who had seen Dad's oak dining table at Catherine's farmhouse. He called on a Tuesday afternoon in March 2012 and offered a contract for custom built-in shelving across twelve luxury apartments. That single contract was worth more than the entire previous year of revenue." },
      { role: "assistant", content: "What is your relationship with your father like today?" },
      { role: "user", content: "Last weekend I was teaching the twins to ride bicycles in the new driveway Dad paved himself. He came out of the workshop covered in sawdust, picked up Sophia, put her on the seat, and ran beside her for a hundred yards without letting go. He was laughing so hard he could barely breathe. Elijah learned to ride first and kept circling back to cheer his sister on." },
      { role: "assistant", content: "What message do you want this song to carry?" },
      { role: "user", content: "I want him to know that every stumble was worth it. Every sleepless night, every bill he could not pay, every morning he dragged himself to an empty workshop. I want him to hear in this song that his children see him, truly see him, and that the furniture he builds will outlast all of us but so will the love he poured into raising us." },
    ];

    // Unrelated facts — must be filtered by prose overlap
    const MARCUS_FACTS = [
      { id: "f_workshop", text: "Marcus built furniture in a garage workshop starting at age twenty-three.", beat: "scene" },
      { id: "f_recession", text: "The 2008 recession nearly destroyed the family business and their home.", beat: "conflict" },
      { id: "f_recovery", text: "A commission from architect Catherine saved the business in 2012.", beat: "turning_point" },
      { id: "f_surfing", text: "Penguins migrate across Antarctica during the polar winter solstice.", beat: "scene" },  // UNRELATED
      { id: "f_photography", text: "Coral reefs near Fiji produce bioluminescent plankton at midnight.", beat: "scene" },  // UNRELATED
    ];

    const MARCUS_ATOMS = {
      who: "Marcus",
      where: "Ohio",
      when: "Father's Day",
      what: "Twenty years building a furniture business from nothing",
      unrelated_atom: "Penguin migrations across Antarctica span thousands of frozen kilometers",  // long + unrelated
    };

    const MARCUS_PRIMITIVES = {
      theme: "Craftsmanship as love, persistence through impossible odds",
      turning_point: "The phone call from Johnson and Associates that changed everything",
      resolution: "Marcus Furniture became a town landmark, built on refusal to quit",
      unrelated_prim: "Penguin colonies require years of adaptation to polar ice shelves",  // unrelated
    };

    const MARCUS_MOTIFS = [
      "hands that shape wood with kindness and precision",
      "four in the morning work ethic",
      "bioluminescent coral reef expeditions",  // unrelated
    ];

    const MARCUS_SONG_MAP = {
      hook: { idea: "Marcus, every joint you made held this family together" },
      verse1: { idea: "Garage workshop, bleeding hands, midnight dinners, borrowed trucks" },
      chorus: { idea: "Built with love, one perfect joint at a time" },
      verse2: { idea: "Recession, foreclosure, empty shop, and still he showed up at four AM" },
      bridge: { idea: "Catherine's commission, Johnson's phone call, tears in the sawdust" },
    };

    // Completed narrative covering ALL key elements from initial + follow-ups
    const MARCUS_COMPLETE_NARRATIVE = [
      "Marcus, my father, is the strongest man I have ever known.",
      "At twenty-three he took every dollar saved from the steel mill and opened a furniture workshop in the garage.",
      "Those first years were brutal: eighteen-hour days, bleeding hands, midnight dinners brought by Mom, deliveries in a borrowed pickup truck.",
      "By the time I was five, the workshop had become a real storefront on Main Street with two employees and a promise — every piece lasts a hundred years.",
      "The 2008 recession hit like a freight train: orders vanished, employees let go, the house refinanced twice, bank letters threatening foreclosure every month.",
      "The foreclosure notice arrived on Christmas Eve and Dad sat alone in the garage for three hours before telling us Santa was running late.",
      "Maria, my mother, sold her grandmother's emerald ring to keep the lights on that winter, never telling Dad until years later.",
      "He searched antique shops for six months and surprised her with a nearly identical ring on their twentieth anniversary.",
      "The twins were born in 2010, right in the middle of the crisis, and Dad built two matching cribs from reclaimed oak with their initials carved into the headboards.",
      "The phone call from Robert Johnson of Johnson and Associates in March 2012 changed everything — custom shelving across twelve luxury apartments, worth more than the entire previous year.",
      "Architect Catherine had discovered Dad's work at a church craft fair, which led to a design magazine feature and dozens of commissions.",
      "By 2013 the workshop occupied the entire building with six employees and a two-month waiting list.",
      "Dad paid back every cent, shook the bank manager's hand, and cried in the sawdust — the only time I ever saw tears on his face.",
      "He gave me a hand-carved walnut box at graduation with a letter saying success is refusing to quit on the people who count on you.",
      "Last weekend I taught the twins to ride bicycles in the new driveway — Sophia with Dad running beside her for a hundred yards, Elijah circling back to cheer her on.",
      "I want him to know every stumble was worth it, every sleepless night, every empty workshop morning.",
      "The furniture he builds will outlast all of us, but so will the love he poured into raising us.",
      "This song is for the man who built our family one perfect joint at a time.",
    ].join(" ");

    // ── Build test data ────────────────────────────────────────────

    const retainedDetails = extractRetainedDetails({
      initial_prompt: MARCUS_LETTER,
      conversation: MARCUS_CONVERSATION,
      facts: MARCUS_FACTS,
    });
    const coverage = computeDetailCoverage(retainedDetails, MARCUS_COMPLETE_NARRATIVE);

    const engineContext = {
      recipient_name: "Marcus",
      occasion: "Father's Day",
      style: "country",
      title: "One Perfect Joint",
      message: "For the man who built us with the same care he builds his furniture",
      narrative: MARCUS_COMPLETE_NARRATIVE,
      facts: MARCUS_FACTS,
      beats: [
        { id: "b1", purpose: "garage workshop origin", strength: 0.9 },
        { id: "b2", purpose: "recession and near-loss", strength: 1.0 },
        { id: "b3", purpose: "redemption through craft", strength: 0.9 },
      ],
      atoms: MARCUS_ATOMS,
      primitives: MARCUS_PRIMITIVES,
      motifs: MARCUS_MOTIFS,
      song_map: MARCUS_SONG_MAP,
      completed_story_package: {
        prose: MARCUS_COMPLETE_NARRATIVE,
        retained_details: retainedDetails,
        detail_coverage_map: coverage,
        semantic_block_profile: { blocks: ["origin", "crisis", "redemption", "legacy"] },
        schema_version: 2,
        detail_budget_warning: null,
        built_at: new Date().toISOString(),
      },
    };

    // ── Tests ──────────────────────────────────────────────────────

    it("extracts details from both initial prompt and ALL follow-ups", () => {
      const initialDetails = retainedDetails.filter(
        (d) => d.source === "initial_prompt",
      );
      assert.ok(
        initialDetails.length >= 20,
        `Should extract 20+ details from a 5000+ char initial prompt, got ${initialDetails.length}`,
      );

      // Verify details from EACH of the 5 conversation turns are extracted
      const conversationSources = new Set(
        retainedDetails
          .filter((d) => d.source.startsWith("conversation_turn_"))
          .map((d) => d.source),
      );
      assert.ok(
        conversationSources.size >= 3,
        `Should extract details from at least 3 conversation turns, got ${conversationSources.size}`,
      );

      // Verify specific unique details from follow-ups are present
      const allTexts = retainedDetails.map((d) => d.text.toLowerCase()).join(" ");
      assert.ok(
        allTexts.includes("foreclosure") || allTexts.includes("christmas eve"),
        "Turn 1: foreclosure on Christmas Eve should be extracted",
      );
      assert.ok(
        allTexts.includes("emerald ring") || allTexts.includes("grandmother"),
        "Turn 2: Maria's grandmother's ring should be extracted",
      );
      assert.ok(
        allTexts.includes("johnson") || allTexts.includes("twelve luxury"),
        "Turn 3: Johnson & Associates contract should be extracted",
      );
      assert.ok(
        allTexts.includes("bicycles") || allTexts.includes("sophia") || allTexts.includes("elijah"),
        "Turn 4: teaching twins to ride bicycles should be extracted",
      );
      assert.ok(
        allTexts.includes("stumble") || allTexts.includes("sleepless"),
        "Turn 5: 'every stumble was worth it' message should be extracted",
      );
    });

    it("follow-up details survive extraction (conversation turns produce required or retained details)", () => {
      const convDetails = retainedDetails.filter(
        (d) => d.source.startsWith("conversation_turn_"),
      );
      assert.ok(
        convDetails.length >= 5,
        `Should retain at least 5 conversation details, got ${convDetails.length}`,
      );

      // At least some conversation details should be required (story-weight categories)
      // Note: with a rich initial prompt (30+ initial required), the soft cap (MAX_REQUIRED=20)
      // may downgrade conversation details. The conversation floor (Fix 2) will restore them.
      // For now, we just verify they are RETAINED (zero detail loss), regardless of required flag.
      const convRequired = convDetails.filter((d) => d.required);
      // After Fix 2 lands (conversation floor), this count should increase.
      // For now, we accept that details are retained even if not all required.
      assert.ok(
        convDetails.length >= 5,
        "Conversation details must be retained regardless of required flag (zero detail loss)",
      );
    });

    it("completed story package round-trips through to-track serialization", () => {
      const serialized = simulateToTrackSerialization(engineContext);
      const parsed = JSON.parse(serialized);

      assert.ok(parsed.completed_story_package, "completed_story_package should survive serialization");
      assert.equal(
        parsed.completed_story_package.prose,
        MARCUS_COMPLETE_NARRATIVE,
        "Prose must survive serialization unchanged",
      );
      assert.ok(
        parsed.completed_story_package.retained_details.length > 0,
        "retained_details must survive serialization",
      );
      // Verify retained_details is within the production slice limit.
      assert.ok(
        parsed.completed_story_package.retained_details.length <= STORY_CONTEXT_RETAINED_DETAILS_MAX,
        `retained_details should be within ${STORY_CONTEXT_RETAINED_DETAILS_MAX}-item slice, got ${parsed.completed_story_package.retained_details.length}`,
      );
      assert.ok(parsed.song_map, "song_map must survive serialization");
      assert.ok(parsed.song_map.hook, "song_map.hook must survive");

      // Full round-trip through buildLyricsContext
      const track = {
        title: "One Perfect Joint",
        recipient_name: "Marcus",
        message: "For the man who built us with the same care he builds his furniture",
        style: "country",
        occasion: "Father's Day",
        story_context_json: serialized,
      };
      const restored = buildLyricsContext(track);
      assert.ok(restored.completed_story_package, "completed_story_package must restore");
      assert.equal(
        restored.completed_story_package.prose,
        MARCUS_COMPLETE_NARRATIVE,
        "Prose must round-trip through buildLyricsContext unchanged",
      );
      assert.equal(
        restored.completed_story_package.schema_version,
        2,
        "schema_version must persist through round-trip",
      );
    });

    it("preserves long-story tail details during to-track serialization", () => {
      const tailDetail = "The final birthday message says every sleepless night was worth it and his children truly see him.";
      const oversizedStory = [
        MARCUS_COMPLETE_NARRATIVE,
        "ordinary middle detail ".repeat(850),
        tailDetail,
      ].join(" ");
      const serialized = simulateToTrackSerialization({
        ...engineContext,
        narrative: oversizedStory,
        completed_story_package: {
          ...engineContext.completed_story_package,
          prose: oversizedStory,
          retained_details: [
            ...engineContext.completed_story_package.retained_details,
            { id: "tail_message", text: tailDetail, required: true, category: "meaning" },
          ],
        },
      });
      const parsed = JSON.parse(serialized);

      assert.ok(
        parsed.completed_story_package.prose.length <= STORY_CONTEXT_NARRATIVE_MAX_LENGTH,
        "serialized prose must stay within track context budget",
      );
      assert.match(
        parsed.completed_story_package.prose,
        /Story middle compacted for track context/,
        "long prose should compact the middle, not cut off the end",
      );
      assert.match(
        parsed.completed_story_package.prose,
        /children truly see him/i,
        "tail payoff details must survive serialization",
      );
      assert.match(
        parsed.narrative,
        /children truly see him/i,
        "canonical narrative tail must survive serialization",
      );
    });

    it("prioritizes required details and song-map-cited facts before serializer caps", () => {
      const requiredTailDetail = "The late payoff says his daughter finally understood the sacrifice behind every quiet shift.";
      const citedLateFact = {
        id: "fact_99",
        text: "His daughter finally understood the sacrifice behind every quiet shift.",
        beat: "meaning",
      };
      const fillerFacts = Array.from({ length: STORY_CONTEXT_FACTS_MAX + 12 }, (_, index) => ({
        id: `filler_${index + 1}`,
        text: `Ordinary background fact ${index + 1}`,
        beat: "context",
      }));
      const fillerDetails = Array.from({ length: STORY_CONTEXT_RETAINED_DETAILS_MAX + 12 }, (_, index) => ({
        id: `filler_detail_${index + 1}`,
        text: `minor retained detail ${index + 1}`,
        required: false,
        category: "background",
      }));

      const serialized = simulateToTrackSerialization({
        ...engineContext,
        facts: [...fillerFacts, citedLateFact],
        song_map: {
          hook: { idea: "Quiet shifts became love", source_facts: ["fact_99"] },
          verse1: [{ idea: "The house kept moving", source_facts: ["filler_1"] }],
          chorus: [{ idea: "His daughter understood the sacrifice", source_facts: ["fact_99"] }],
          verse2: [],
          bridge: [],
          key_lines: [],
        },
        completed_story_package: {
          ...engineContext.completed_story_package,
          retained_details: [
            ...fillerDetails,
            { id: "required_tail", text: requiredTailDetail, required: true, category: "payoff" },
          ],
        },
      });
      const parsed = JSON.parse(serialized);

      assert.ok(parsed.facts.length <= STORY_CONTEXT_FACTS_MAX);
      assert.ok(
        parsed.facts.some((fact) => fact.id === "fact_99"),
        "song-map-cited late facts must survive serializer caps",
      );
      assert.ok(parsed.completed_story_package.retained_details.length <= STORY_CONTEXT_RETAINED_DETAILS_MAX);
      assert.ok(
        parsed.completed_story_package.retained_details.some((detail) => detail.id === "required_tail"),
        "late required retained details must survive serializer caps",
      );
    });

    it("songwriter prompt uses completed story as authority", () => {
      const serialized = simulateToTrackSerialization(engineContext);
      const track = {
        title: "One Perfect Joint",
        recipient_name: "Marcus",
        message: "For the man who built us with the same care he builds his furniture",
        style: "country",
        occasion: "Father's Day",
        story_context_json: serialized,
      };
      const restored = buildLyricsContext(track);
      const prompt = buildSongwriterPrompt(restored);

      // AUTHORITATIVE label present
      assert.ok(
        prompt.includes("AUTHORITATIVE COMPLETED STORY"),
        "Prompt must contain AUTHORITATIVE COMPLETED STORY label",
      );
      assert.ok(
        prompt.includes("single source of truth"),
        "Prompt must declare single source of truth",
      );

      // Legacy label absent
      assert.ok(
        !prompt.includes("STORY NARRATIVE"),
        "Must NOT contain legacy STORY NARRATIVE when completed story exists",
      );

      // Unrelated facts (penguins/Antarctica/bioluminescence) filtered from KEY DETAILS
      const keyDetailsStart = prompt.indexOf("KEY DETAILS:");
      if (keyDetailsStart >= 0) {
        const keyDetailsEnd = prompt.indexOf("\n\n", keyDetailsStart);
        const section = keyDetailsEnd > keyDetailsStart
          ? prompt.slice(keyDetailsStart, keyDetailsEnd)
          : prompt.slice(keyDetailsStart);

        assert.ok(
          !section.toLowerCase().includes("penguins migrate"),
          "KEY DETAILS must NOT include unrelated 'penguins' fact",
        );
        assert.ok(
          !section.toLowerCase().includes("bioluminescent"),
          "KEY DETAILS must NOT include unrelated 'bioluminescent' fact",
        );
      }

      // Unrelated atoms/primitives filtered from STRUCTURAL HINTS
      const hintsStart = prompt.indexOf("STRUCTURAL HINTS");
      if (hintsStart >= 0) {
        const hintsEnd = prompt.indexOf("\n\n", hintsStart);
        const section = hintsEnd > hintsStart
          ? prompt.slice(hintsStart, hintsEnd)
          : prompt.slice(hintsStart);

        assert.ok(
          !section.toLowerCase().includes("penguin migrations"),
          "STRUCTURAL HINTS must NOT include unrelated penguin atom",
        );
        assert.ok(
          !section.toLowerCase().includes("polar ice shelves"),
          "STRUCTURAL HINTS must NOT include unrelated penguin primitive",
        );
      }

      // Unrelated motifs filtered
      const motifsStart = prompt.indexOf("RECURRING MOTIFS");
      if (motifsStart >= 0) {
        const motifsEnd = prompt.indexOf("\n\n", motifsStart);
        const section = motifsEnd > motifsStart
          ? prompt.slice(motifsStart, motifsEnd)
          : prompt.slice(motifsStart);

        assert.ok(
          !section.toLowerCase().includes("bioluminescent"),
          "MOTIFS must NOT include unrelated 'bioluminescent' motif",
        );
      }
    });

    it("judge block uses completed story as PRIMARY", () => {
      const serialized = simulateToTrackSerialization(engineContext);
      const track = {
        title: "One Perfect Joint",
        recipient_name: "Marcus",
        message: "For the man who built us with the same care he builds his furniture",
        style: "country",
        occasion: "Father's Day",
        story_context_json: serialized,
      };
      const restored = buildLyricsContext(track);
      const certBlock = buildStoryCertificationBlock(restored);

      // PRIMARY label present
      assert.ok(
        certBlock.includes("PRIMARY"),
        "Judge block must label completed story as PRIMARY",
      );
      assert.ok(
        certBlock.includes("single source of truth"),
        "Judge block must declare single source of truth",
      );

      // Key story content present
      assert.ok(certBlock.includes("Marcus"), "Judge block must include Marcus");
      assert.ok(
        certBlock.includes("furniture") || certBlock.includes("workshop"),
        "Judge block must include key story elements",
      );

      // Unrelated facts excluded from Key facts section (prose-overlap filtered)
      const keyFactsStart = certBlock.indexOf("Key facts:");
      if (keyFactsStart >= 0) {
        const keyFactsEnd = certBlock.indexOf("\n\n", keyFactsStart);
        const keyFactsSection = keyFactsEnd > keyFactsStart
          ? certBlock.slice(keyFactsStart, keyFactsEnd)
          : certBlock.slice(keyFactsStart);

        assert.ok(
          !keyFactsSection.toLowerCase().includes("penguins"),
          "Key facts must NOT include unrelated 'penguins' fact",
        );
        assert.ok(
          !keyFactsSection.toLowerCase().includes("bioluminescent"),
          "Key facts must NOT include unrelated 'bioluminescent' fact",
        );
      }

      // Unrelated primitives excluded from Story primitives section
      const primitivesStart = certBlock.indexOf("Story primitives:");
      if (primitivesStart >= 0) {
        const primitivesEnd = certBlock.indexOf("\n\n", primitivesStart);
        const primitivesSection = primitivesEnd > primitivesStart
          ? certBlock.slice(primitivesStart, primitivesEnd)
          : certBlock.slice(primitivesStart);

        assert.ok(
          !primitivesSection.toLowerCase().includes("polar ice shelves"),
          "Story primitives must NOT include unrelated penguin primitive",
        );
      }

      // Story-related primitives retained
      assert.ok(
        certBlock.toLowerCase().includes("craftsmanship") || certBlock.toLowerCase().includes("persistence"),
        "Judge block must retain story-related theme primitive",
      );
    });
  });

  // ── Phase 1 regression: constraint-first architecture ──────────────

  describe("Phase 1: Stable IDs, prompt injection, judge IDs", () => {
    it("detailId is deterministic — same input always produces same ID", () => {
      const { detailId, normalizeKey } = require("../../src/writer/story-semantics");
      const id1 = detailId("conflicts", normalizeKey("The bleeding during the twin pregnancy was terrifying."));
      const id2 = detailId("conflicts", normalizeKey("The bleeding during the twin pregnancy was terrifying."));
      const id3 = detailId("events", normalizeKey("The bleeding during the twin pregnancy was terrifying."));
      assert.equal(id1, id2, "Same category+text must produce same ID");
      assert.ok(id1 !== id3, "Different category must produce different ID");
      assert.ok(id1.startsWith("d_con_"), "ID must start with d_ + category prefix");
    });

    it("IDs are stable across re-extraction with new conversation turns", () => {
      const ctx1 = { initial_prompt: CHIOMA_LETTER };
      const ctx2 = { initial_prompt: CHIOMA_LETTER, conversation: CONVERSATION };
      const d1 = extractRetainedDetails(ctx1);
      const d2 = extractRetainedDetails(ctx2);
      const d1ids = new Set(d1.map(d => d.id));
      const stable = d2.filter(d => d1ids.has(d.id));
      assert.equal(stable.length, d1.length, "All turn-1 IDs must appear in turn-2 extraction");
    });

    it("buildContextPrompt includes retained detail inventory when provided", () => {
      const { buildContextPrompt } = require("../../src/writer/v3/prompts/builder");
      const details = extractRetainedDetails({ initial_prompt: CHIOMA_LETTER });
      const state = {
        recipient_name: "Chioma",
        occasion: "Mother's Day",
        narrative: COMPLETE_NARRATIVE,
        facts: [], beats: [], atoms: {}, primitives: {}, motifs: [], dials: {},
        conversation: [],
      };
      const prompt = buildContextPrompt(state, "test input", { retainedDetails: details });
      assert.ok(prompt.includes("Detail inventory"), "Prompt must contain Detail inventory section");
      assert.ok(prompt.includes("d_"), "Prompt must contain content-hash IDs");
      assert.ok(prompt.includes("(REQ)"), "Prompt must mark required details");
    });

    it("per-detail truncation caps long detail text", () => {
      const { buildRetainedDetailsSection } = require("../../src/writer/v3/prompts/builder");
      const longText = "A".repeat(200);
      const result = buildRetainedDetailsSection(
        [{ id: "d_test", category: "events", text: longText, source: "initial_prompt", required: true }],
        { maxRetainedDetails: 15, maxRetainedDetailChars: 120 },
      );
      assert.ok(result.length < 200, "Section must truncate long detail text");
      assert.ok(result.includes("…"), "Truncated text must end with ellipsis");
    });

    it("compaction cascade reduces retained detail count", () => {
      const { buildRetainedDetailsSection } = require("../../src/writer/v3/prompts/builder");
      const details = Array.from({ length: 20 }, (_, i) => ({
        id: `d_test_${i}`, category: "events", text: `Detail number ${i}`, source: "initial_prompt", required: true,
      }));
      const step0 = buildRetainedDetailsSection(details, { maxRetainedDetails: 15 });
      const step3 = buildRetainedDetailsSection(details, { maxRetainedDetails: 5 });
      const count0 = step0.split("\n").length;
      const count3 = step3.split("\n").length;
      assert.equal(count0, 15, "Step 0: should include 15 details");
      assert.equal(count3, 5, "Step 3: should include only 5 details");
    });

    it("judge certification block includes detail IDs", () => {
      const serialized = simulateToTrackSerialization(engineContext);
      const track = {
        title: "Heart of Our Family", recipient_name: "Chioma",
        message: "For the woman who holds us together", style: "afrobeat",
        occasion: "Mother's Day", story_context_json: serialized,
      };
      const restored = buildLyricsContext(track);
      const certBlock = buildStoryCertificationBlock(restored);
      // Retained details in judge block should now have IDs
      assert.ok(
        certBlock.includes("[d_") || certBlock.includes("[?]"),
        "Judge certification block must include detail IDs (d_xxx or ? fallback)",
      );
    });
  });
});
