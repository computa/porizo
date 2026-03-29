const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  extractRetainedDetails,
  computeDetailCoverage,
} = require("../../src/writer/story-semantics");

const {
  buildSongwriterPrompt,
} = require("../../src/writer/songwriter");

// ---------------------------------------------------------------------------
// Fixture: Chioma's Mother's Day letter (production regression source)
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

const COMPRESSED_NARRATIVE = [
  "Chioma, you are the heart of the family.",
  "You are hardworking, dependable, and keep the home and lives together.",
  "From morning to night, you handle responsibilities.",
  "Even amidst the chaos of raising four children, you bring order, care, and stability.",
  "Your strength during the high-risk pregnancy with the twins was unforgettable.",
  "Seeing you handle everything is like watching a dream come true.",
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Completed Story Package", () => {

  describe("extractRetainedDetails", () => {
    it("captures ALL Chioma details from the source letter", () => {
      const details = extractRetainedDetails({ initial_prompt: CHIOMA_LETTER });

      const categories = new Map();
      for (const d of details) {
        if (!categories.has(d.category)) categories.set(d.category, []);
        categories.get(d.category).push(d.text.toLowerCase());
      }

      const allTexts = details.map((d) => d.text.toLowerCase()).join(" | ");

      // People: Chioma and twins
      assert.ok(
        allTexts.includes("chioma") || categories.get("people")?.some((t) => t.includes("chioma")),
        `Expected "Chioma" in people or text, got: ${JSON.stringify(categories.get("people"))}`,
      );
      assert.ok(
        allTexts.includes("twins"),
        `Expected "twins" to appear in retained details, got none`,
      );

      // Events: high-risk pregnancy
      assert.ok(
        allTexts.includes("high-risk pregnancy") || allTexts.includes("high risk pregnancy"),
        `Expected "high-risk pregnancy" in details`,
      );

      // Conflicts: at least one of bleeding, fear, pain, worry
      const conflictTerms = ["bleeding", "fear", "pain", "worry"];
      const foundConflicts = conflictTerms.filter((term) => allTexts.includes(term));
      assert.ok(
        foundConflicts.length >= 1,
        `Expected at least one conflict term (${conflictTerms.join(", ")}), found: ${foundConflicts.join(", ") || "none"}`,
      );

      // Transformations: growing into a strong woman
      const transformationTexts = (categories.get("transformations") || []).join(" ");
      assert.ok(
        transformationTexts.includes("grow") ||
          transformationTexts.includes("strong woman") ||
          transformationTexts.includes("become") ||
          transformationTexts.includes("rose"),
        `Expected transformation about growing/strong woman, got: ${transformationTexts}`,
      );

      // Meanings: sacrifice, motherhood, or gratitude
      const meaningTexts = (categories.get("meanings") || []).join(" ");
      assert.ok(
        meaningTexts.includes("sacrifice") ||
          meaningTexts.includes("motherhood") ||
          meaningTexts.includes("grateful") ||
          meaningTexts.includes("appreciate"),
        `Expected meaning about sacrifice/motherhood/gratitude, got: ${meaningTexts}`,
      );

      // Concrete details: "four children"
      assert.ok(
        allTexts.includes("four children"),
        `Expected "four children" in concrete details`,
      );
    });
  });

  describe("computeDetailCoverage", () => {
    it("detects missing details in compressed narrative", () => {
      const details = extractRetainedDetails({ initial_prompt: CHIOMA_LETTER });
      const coverage = computeDetailCoverage(details, COMPRESSED_NARRATIVE);

      assert.ok(
        coverage.stats.requiredMissing > 0,
        `Compressed narrative should have requiredMissing > 0 but got ${coverage.stats.requiredMissing}. ` +
          `Missing required: ${JSON.stringify(coverage.missingRequired.map((m) => m.text.slice(0, 60)))}`,
      );
    });

    it("passes for complete narrative that preserves everything", () => {
      const details = extractRetainedDetails({ initial_prompt: CHIOMA_LETTER });
      const coverage = computeDetailCoverage(details, COMPLETE_NARRATIVE);

      assert.equal(
        coverage.stats.requiredMissing,
        0,
        `Complete narrative should have 0 requiredMissing but got ${coverage.stats.requiredMissing}. ` +
          `Missing: ${JSON.stringify(coverage.missingRequired.map((m) => `[${m.category}] ${m.text.slice(0, 80)}`))}`,
      );
    });
  });

  describe("follow-up answer does not displace original payoff", () => {
    it("retains stronger meaning details when follow-up adds a weaker phrase", () => {
      const context = {
        initial_prompt: CHIOMA_LETTER,
        conversation: [
          { role: "assistant", content: "What does this moment mean to you?" },
          { role: "user", content: "It is like watching a dream come true." },
        ],
      };

      const details = extractRetainedDetails(context);
      const categories = new Map();
      for (const d of details) {
        if (!categories.has(d.category)) categories.set(d.category, []);
        categories.get(d.category).push(d);
      }

      // Original strong meanings (sacrifice, motherhood, gratitude) should still be required
      const requiredMeanings = (categories.get("meanings") || []).filter((d) => d.required);
      const requiredMeaningTexts = requiredMeanings.map((d) => d.text.toLowerCase()).join(" ");

      assert.ok(
        requiredMeaningTexts.includes("sacrifice") ||
          requiredMeaningTexts.includes("motherhood") ||
          requiredMeaningTexts.includes("grateful") ||
          requiredMeaningTexts.includes("appreciate"),
        `Original strong meanings should remain required. Required meanings: ${requiredMeanings.map((d) => d.text.slice(0, 60)).join(" | ")}`,
      );

      // "dream come true" from follow-up should NOT be required (it's from conversation, not initial_prompt)
      const dreamDetail = details.find(
        (d) => d.text.toLowerCase().includes("dream come true"),
      );
      if (dreamDetail) {
        assert.equal(
          dreamDetail.required,
          false,
          `"dream come true" from follow-up should not be required`,
        );
      }
      // If dream detail wasn't extracted at all, that's also acceptable
    });
  });

  describe("buildSongwriterPrompt canonical-first", () => {
    function buildChiomaContext(overrides = {}) {
      return {
        recipient_name: "Chioma",
        occasion: "Mother's Day",
        style: "afrobeat",
        message: "For the woman who holds us together",
        narrative: "Chioma is the heart of the family.",
        ...overrides,
      };
    }

    it("uses AUTHORITATIVE COMPLETED STORY when package exists", () => {
      const context = buildChiomaContext({
        completed_story_package: {
          prose: COMPLETE_NARRATIVE,
          retained_details: extractRetainedDetails({ initial_prompt: CHIOMA_LETTER }),
        },
      });

      const prompt = buildSongwriterPrompt(context);

      assert.ok(
        prompt.includes("AUTHORITATIVE COMPLETED STORY"),
        `Prompt should contain "AUTHORITATIVE COMPLETED STORY"`,
      );
      assert.ok(
        prompt.includes("single source of truth"),
        `Prompt should contain "single source of truth"`,
      );
      assert.ok(
        !prompt.includes("STORY NARRATIVE"),
        `Prompt should NOT contain legacy "STORY NARRATIVE" label when completed story exists`,
      );
    });

    it("falls back to STORY NARRATIVE for legacy tracks", () => {
      const context = buildChiomaContext({
        narrative: "Chioma is the heart of the family.",
      });
      // No completed_story_package

      const prompt = buildSongwriterPrompt(context);

      assert.ok(
        prompt.includes("STORY NARRATIVE"),
        `Legacy prompt should contain "STORY NARRATIVE"`,
      );
    });

    it("filters unrelated facts from KEY DETAILS when completed story exists", () => {
      const context = buildChiomaContext({
        completed_story_package: {
          prose: COMPLETE_NARRATIVE,
          retained_details: extractRetainedDetails({ initial_prompt: CHIOMA_LETTER }),
        },
        facts: [
          { id: "f_chioma", text: "Chioma carries the family through morning to night.", beat: "scene" },
          { id: "f_surfing", text: "They went surfing in Hawaii last summer.", beat: "scene" },
        ],
      });

      const prompt = buildSongwriterPrompt(context);

      // Extract the KEY DETAILS section from the prompt
      const keyDetailsStart = prompt.indexOf("KEY DETAILS:");
      const keyDetailsEnd = keyDetailsStart >= 0
        ? prompt.indexOf("\n\n", keyDetailsStart)
        : -1;
      const keyDetailsSection = keyDetailsEnd > keyDetailsStart
        ? prompt.slice(keyDetailsStart, keyDetailsEnd)
        : prompt.slice(keyDetailsStart || 0);

      if (keyDetailsStart >= 0) {
        // The surfing/Hawaii fact should be excluded from KEY DETAILS (zero word overlap with prose)
        assert.ok(
          !keyDetailsSection.includes("surfing"),
          `KEY DETAILS should NOT include "surfing" — it is outside the completed story`,
        );
        assert.ok(
          !keyDetailsSection.includes("Hawaii"),
          `KEY DETAILS should NOT include "Hawaii" — it is outside the completed story`,
        );

        // The Chioma fact should remain (high overlap with prose)
        assert.ok(
          keyDetailsSection.includes("Chioma carries"),
          `KEY DETAILS should still include the Chioma fact (overlaps with completed story)`,
        );
      }
    });
  });
});
