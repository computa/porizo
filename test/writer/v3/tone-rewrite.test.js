/**
 * Tests for Step 1D: Tone rewrite + FROM YOUR STORY quote fix
 *
 * Covers:
 * 1. reason-v3.md tone rules (banned words, validate-ask-encourage pattern)
 * 2. reason-v3-selection.md tone-aware selection
 * 3. guidance.js findBestVerbatimQuote() post-processing
 * 4. guidance.js buildGuidancePrompt() warm tone instructions
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  generateElementGuidance,
  buildGuidancePrompt,
  parseGuidanceResponse,
  findBestVerbatimQuote,
} = require("../../../src/writer/v3/guidance");

const { STORY_ELEMENT_DEFINITIONS } = require("../../../src/writer/v3/quality");

// ---------- Fixtures ----------

function buildTestState(overrides = {}) {
  return {
    narrative:
      "Sarah has been my best friend since college. She showed up with ice cream during my worst breakup and made me laugh when I thought I could not smile again.",
    recipient_name: "Sarah",
    occasion: "birthday",
    story_mode: "default",
    facts: [
      { text: "best friends since college", beat: "who", status: "active" },
      { text: "showed up with ice cream during my worst breakup", beat: "moment_destination", status: "active" },
      { text: "made me laugh when I thought I could not smile again", beat: "turn", status: "active" },
      { text: "every summer we dance in the park", beat: "moment_destination", status: "active" },
      { text: "she slipped in a puddle and we laughed so hard we cried", beat: "moment_destination", status: "active" },
    ],
    atoms: {
      who: "Sarah, best friend since college",
      moment_destination: "ice cream during breakup, dancing in the park",
      turn: "made me laugh when I thought I could not smile again",
    },
    story_elements: [
      { id: "setting", strength: 0.6 },
      { id: "feeling", strength: 0.3 },
      { id: "bond", strength: 0.5 },
      { id: "moment", strength: 0.8 },
      { id: "details", strength: 0.2 },
    ],
    ...overrides,
  };
}

// ============================================================
// 1. reason-v3.md prompt tone rules
// ============================================================

test("reason-v3.md contains TONE AND RESPONSE RULES section", () => {
  const templatePath = path.join(
    __dirname,
    "../../../src/writer/v3/prompts/reason-v3.md"
  );
  const content = fs.readFileSync(templatePath, "utf-8");
  assert.ok(
    content.includes("TONE AND RESPONSE RULES"),
    "Template must contain TONE AND RESPONSE RULES section"
  );
});

test("reason-v3.md bans clinical language", () => {
  const templatePath = path.join(
    __dirname,
    "../../../src/writer/v3/prompts/reason-v3.md"
  );
  const content = fs.readFileSync(templatePath, "utf-8");
  // The template should mention these as BANNED
  assert.ok(content.includes("BANNED"), "Template must have a BANNED section");
  for (const word of ["lacks", "missing", "insufficient", "needs more"]) {
    assert.ok(
      content.includes(word),
      `Template must list "${word}" as banned language`
    );
  }
});

test("reason-v3.md includes Validate-Ask-Encourage pattern", () => {
  const templatePath = path.join(
    __dirname,
    "../../../src/writer/v3/prompts/reason-v3.md"
  );
  const content = fs.readFileSync(templatePath, "utf-8");
  assert.ok(content.includes("Validate"), "Must describe Validate step");
  assert.ok(content.includes("Encourage"), "Must describe Encourage step");
});

test("reason-v3.md includes funnel stage awareness", () => {
  const templatePath = path.join(
    __dirname,
    "../../../src/writer/v3/prompts/reason-v3.md"
  );
  const content = fs.readFileSync(templatePath, "utf-8");
  assert.ok(content.includes("OPEN"), "Must mention OPEN funnel stage");
  assert.ok(content.includes("PROBING"), "Must mention PROBING funnel stage");
  assert.ok(content.includes("CLOSED"), "Must mention CLOSED funnel stage");
});

test("reason-v3.md includes gift-giver framing", () => {
  const templatePath = path.join(
    __dirname,
    "../../../src/writer/v3/prompts/reason-v3.md"
  );
  const content = fs.readFileSync(templatePath, "utf-8");
  assert.ok(
    content.includes("gift") || content.includes("Gift"),
    "Must include gift-giver context"
  );
  assert.ok(
    content.includes("recipient"),
    "Must reference framing around the recipient"
  );
});

test("reason-v3.md includes good vs bad examples", () => {
  const templatePath = path.join(
    __dirname,
    "../../../src/writer/v3/prompts/reason-v3.md"
  );
  const content = fs.readFileSync(templatePath, "utf-8");
  assert.ok(content.includes("BAD:"), "Must include BAD examples");
  assert.ok(content.includes("GOOD:"), "Must include GOOD examples");
});

test("reason-v3.md preserves all template variables", () => {
  const templatePath = path.join(
    __dirname,
    "../../../src/writer/v3/prompts/reason-v3.md"
  );
  const content = fs.readFileSync(templatePath, "utf-8");
  const requiredVars = [
    "{{recipient_name}}",
    "{{occasion}}",
    "{{narrative}}",
    "{{facts_list}}",
    "{{atoms_summary}}",
    "{{primitives_summary}}",
    "{{motifs_list}}",
    "{{dials_summary}}",
    "{{beats_table}}",
    "{{gap_targeting}}",
    "{{conversation_history}}",
    "{{user_input}}",
    "{{retained_details}}",
  ];
  for (const v of requiredVars) {
    assert.ok(content.includes(v), `Template must preserve variable ${v}`);
  }
});

test("reason-v3.md preserves output JSON schema", () => {
  const templatePath = path.join(
    __dirname,
    "../../../src/writer/v3/prompts/reason-v3.md"
  );
  const content = fs.readFileSync(templatePath, "utf-8");
  assert.ok(content.includes('"reasoning"'), "Must preserve reasoning key in output schema");
  assert.ok(content.includes('"decision"'), "Must preserve decision key in output schema");
  assert.ok(content.includes('"updates"'), "Must preserve updates key in output schema");
  assert.ok(content.includes('"output"'), "Must preserve output key in output schema");
});

// ============================================================
// 2. reason-v3-selection.md tone rules
// ============================================================

test("reason-v3-selection.md contains selection tone section", () => {
  const templatePath = path.join(
    __dirname,
    "../../../src/writer/v3/prompts/reason-v3-selection.md"
  );
  const content = fs.readFileSync(templatePath, "utf-8");
  assert.ok(
    content.includes("Selection tone") || content.includes("selection tone"),
    "Selection template must contain a selection tone section"
  );
});

test("reason-v3-selection.md frames missing atoms as opportunities", () => {
  const templatePath = path.join(
    __dirname,
    "../../../src/writer/v3/prompts/reason-v3-selection.md"
  );
  const content = fs.readFileSync(templatePath, "utf-8");
  assert.ok(
    content.includes("opportunity") || content.includes("opportunities"),
    "Must frame gaps as opportunities, not deficits"
  );
});

test("reason-v3-selection.md preserves all template variables", () => {
  const templatePath = path.join(
    __dirname,
    "../../../src/writer/v3/prompts/reason-v3-selection.md"
  );
  const content = fs.readFileSync(templatePath, "utf-8");
  const requiredVars = [
    "{{recipient_name}}",
    "{{occasion}}",
    "{{narrative}}",
    "{{facts_list}}",
    "{{atoms_summary}}",
    "{{primitives_summary}}",
    "{{motifs_list}}",
    "{{dials_summary}}",
    "{{conversation_history}}",
    "{{user_input}}",
  ];
  for (const v of requiredVars) {
    assert.ok(content.includes(v), `Selection template must preserve variable ${v}`);
  }
});

// ============================================================
// 3. findBestVerbatimQuote — story_anchor post-processing
// ============================================================

test("findBestVerbatimQuote is exported from guidance.js", () => {
  assert.equal(typeof findBestVerbatimQuote, "function");
});

test("findBestVerbatimQuote returns verbatim fact when overlap is high", () => {
  const facts = [
    { content: "best friends since college" },
    { content: "showed up with ice cream during my worst breakup" },
    { content: "every summer we dance in the park" },
  ];
  // LLM generated broken grammar version
  const llmAnchor = "Sarah dance in the park";
  const result = findBestVerbatimQuote(llmAnchor, facts);
  assert.equal(result, "every summer we dance in the park");
});

test("findBestVerbatimQuote uses text field when content is absent", () => {
  const facts = [
    { text: "she slipped in a puddle and we laughed so hard we cried" },
  ];
  const llmAnchor = "slipped in a puddle we laughed";
  const result = findBestVerbatimQuote(llmAnchor, facts);
  assert.equal(result, "she slipped in a puddle and we laughed so hard we cried");
});

test("findBestVerbatimQuote truncates long facts to 15 words", () => {
  const longFact =
    "she showed up at my door with mint chocolate chip ice cream during the worst breakup of my entire life and sat with me on the couch all night";
  const facts = [{ content: longFact }];
  const llmAnchor = "showed up with mint chocolate chip ice cream during breakup";
  const result = findBestVerbatimQuote(llmAnchor, facts);
  const wordCount = result.replace("...", "").trim().split(/\s+/).length;
  assert.ok(wordCount <= 15, `Should truncate to <=15 words but got ${wordCount}`);
  assert.ok(result.endsWith("..."), "Truncated result should end with ...");
});

test("findBestVerbatimQuote returns LLM anchor when no good match", () => {
  const facts = [
    { content: "completely unrelated content about something else" },
  ];
  const llmAnchor = "Sarah dance in the park";
  const result = findBestVerbatimQuote(llmAnchor, facts);
  assert.equal(result, "Sarah dance in the park", "Should fall back to LLM version");
});

test("findBestVerbatimQuote returns LLM anchor for null/empty facts", () => {
  assert.equal(findBestVerbatimQuote("some anchor", null), "some anchor");
  assert.equal(findBestVerbatimQuote("some anchor", []), "some anchor");
});

test("findBestVerbatimQuote returns null/undefined anchor unchanged", () => {
  const facts = [{ content: "some fact" }];
  assert.equal(findBestVerbatimQuote(null, facts), null);
  assert.equal(findBestVerbatimQuote(undefined, facts), undefined);
});

test("findBestVerbatimQuote selects best match among multiple facts", () => {
  const facts = [
    { content: "best friends since college" },
    { content: "showed up with ice cream during my worst breakup" },
    { content: "made me laugh when I thought I could not smile again" },
  ];
  const llmAnchor = "ice cream worst breakup showed up";
  const result = findBestVerbatimQuote(llmAnchor, facts);
  assert.equal(result, "showed up with ice cream during my worst breakup");
});

// ============================================================
// 4. buildGuidancePrompt warm tone instructions
// ============================================================

test("buildGuidancePrompt includes warm tone instructions", () => {
  const state = buildTestState();
  const elementDef = STORY_ELEMENT_DEFINITIONS.find((d) => d.id === "feeling");
  const prompt = buildGuidancePrompt(state, elementDef, "weak");

  assert.ok(
    prompt.includes("warm") || prompt.includes("encouraging"),
    "Guidance prompt must include warm/encouraging tone instructions"
  );
});

test("buildGuidancePrompt bans critical language", () => {
  const state = buildTestState();
  const elementDef = STORY_ELEMENT_DEFINITIONS.find((d) => d.id === "feeling");
  const prompt = buildGuidancePrompt(state, elementDef, "weak");

  assert.ok(
    prompt.includes("lacks") || prompt.includes("Never say"),
    "Guidance prompt must ban clinical language like 'lacks'"
  );
});

test("buildGuidancePrompt frames as enrichment not deficit", () => {
  const state = buildTestState();
  const elementDef = STORY_ELEMENT_DEFINITIONS.find((d) => d.id === "details");
  const prompt = buildGuidancePrompt(state, elementDef, "missing");

  // Should have enrichment framing
  assert.ok(
    prompt.includes("enrichment") || prompt.includes("vivid") || prompt.includes("gift"),
    "Guidance prompt must frame as enrichment/gift, not deficit"
  );
});

// ============================================================
// 5. Integration: story_anchor post-processed in generateElementGuidance
// ============================================================

test("generateElementGuidance post-processes story_anchor to verbatim quote", async () => {
  const state = buildTestState();
  const mockResponse = {
    diagnosis: "The emotional tone could be even richer.",
    story_anchor: "Sarah dance in the park",  // broken grammar from LLM
    suggestion: "What happened right after she fell in that puddle?",
    examples: ["We couldn't stop laughing", "She just kept dancing"],
  };

  const result = await generateElementGuidance(state, "feeling", {
    _generateTextFn: async () => ({ text: JSON.stringify(mockResponse) }),
  });

  // story_anchor should be corrected to a verbatim quote from facts
  assert.notEqual(
    result.story_anchor,
    "Sarah dance in the park",
    "Broken grammar anchor should be replaced with verbatim"
  );
  // It should match one of the facts
  const factTexts = state.facts.map((f) => f.text || f.content || "");
  const matchesFact = factTexts.some(
    (ft) => result.story_anchor && result.story_anchor.includes(ft.split(" ").slice(0, 5).join(" "))
  );
  assert.ok(matchesFact, `story_anchor "${result.story_anchor}" should be based on a verbatim fact`);
});

test("generateElementGuidance preserves anchor when no facts available", async () => {
  const state = buildTestState({ facts: [] });
  const mockResponse = {
    diagnosis: "Needs emotional grounding.",
    story_anchor: "some llm generated anchor",
    suggestion: "What does Sarah mean to you?",
    examples: ["She is my rock", "She always knows what to say"],
  };

  const result = await generateElementGuidance(state, "feeling", {
    _generateTextFn: async () => ({ text: JSON.stringify(mockResponse) }),
  });

  assert.equal(
    result.story_anchor,
    "some llm generated anchor",
    "Should preserve LLM anchor when no facts for matching"
  );
});
