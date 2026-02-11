const test = require("node:test");
const assert = require("node:assert/strict");

const { condenseForReasoning } = require("../../../src/writer/v3/condense");
const { computeStoryGapAnalysis } = require("../../../src/writer/v3/quality");

test("condenseForReasoning keeps multi-slot details while reducing size", () => {
  const raw = [
    "My sister Ada and I were in Lagos last December after months of silence.",
    "I wanted to fix things, but fear and pride blocked us from talking honestly.",
    "If this failed, I felt we would lose the bond our mother trusted us to keep.",
    "Then she called unexpectedly from the hospital parking lot and we both cried.",
    "By the end, we felt hopeful and grateful that the relationship could heal.",
  ].join(" ").repeat(6);

  const condensed = condenseForReasoning(raw, { maxChars: 900 });

  assert.ok(condensed.text.length <= 900, `expected condensed <= 900 chars, got ${condensed.text.length}`);
  assert.ok(condensed.text.length < raw.length, "condensed output should be shorter than original");
  assert.ok(condensed.text.toLowerCase().includes("ada"), "should preserve who detail");
  assert.ok(condensed.text.toLowerCase().includes("lagos"), "should preserve where detail");
  assert.ok(condensed.text.toLowerCase().includes("lose"), "should preserve stakes detail");
  assert.ok(condensed.text.toLowerCase().includes("called"), "should preserve turning-point detail");
  assert.equal(condensed.metadata.strategy, "slot_weighted_extract");
});

test("computeStoryGapAnalysis marks reflective stories ready without strict blocker/stakes coverage", () => {
  const state = {
    recipient_name: "Ada",
    narrative_current: "My sister Ada and I were in Lagos last December. I wanted us to reconnect after months apart. We were both afraid we had drifted too far. Then she called from the hospital parking lot and everything changed. We ended feeling hopeful and grateful.",
    narrative: "",
    atoms: {
      who: "my sister Ada",
      where: "Lagos",
      when: "last December",
      turn: "she called from the hospital parking lot",
      action: "we talked honestly for the first time in months",
      after: "hopeful and grateful",
      stakes: "",
      secret: "",
      object: "",
      sound: "",
      smell: "",
      physical: "",
      dialogue: "",
    },
    primitives: {
      characters: [{ name: "Ada", role: "sister", desire: "to reconnect" }],
      setting: { place: "Lagos", time: "last December", atmosphere: "", sensory_tags: [] },
      conflict: { internal: "", external: "" },
      turning_point: "she called from the hospital parking lot",
      resolution: "we ended feeling hopeful and grateful",
      inciting_incident: "",
      theme: "",
      motifs: [],
    },
    dials: { tone: "gentle", pov: "", length: "", realism: "", focus: "" },
    beats: [
      { id: "scene", strength: 0.8 },
      { id: "moment", strength: 0.8 },
      { id: "turning_point", strength: 0.8 },
      { id: "meaning", strength: 0.7 },
    ],
    facts: [
      { id: "f1", text: "My sister Ada and I were in Lagos last December.", status: "active" },
      { id: "f2", text: "Then she called from the hospital parking lot.", status: "active" },
      { id: "f3", text: "We ended feeling hopeful and grateful.", status: "active" },
    ],
    last_reasoning: {},
  };

  const gapAnalysis = computeStoryGapAnalysis(state);

  assert.equal(gapAnalysis.isStoryReady, true, "reflective story should be ready");
  assert.equal(gapAnalysis.readinessProfile, "reflective");
  assert.equal(gapAnalysis.gates.reflectiveReady, true);
  assert.equal(gapAnalysis.gates.dramaticReady, false);
});
