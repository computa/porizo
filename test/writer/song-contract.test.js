const test = require("node:test");
const assert = require("node:assert/strict");

const {
  sanitizeSongMap,
  significantWordOverlap,
  validateSongContract,
} = require("../../src/writer/song-contract");

function buildContractContext(overrides = {}) {
  const facts = [
    {
      id: "f_setup",
      text: "We met on a late train after work and missed our stop because we were talking.",
      beat: "scene",
    },
    {
      id: "f_payoff",
      text: "Now home feels like a promise we chose together.",
      beat: "meaning",
    },
    {
      id: "f_turn",
      text: "That winter changed everything and we decided to move anyway.",
      beat: "turning_point",
    },
  ];

  const songMap = {
    verse1: [
      {
        idea: "We met on a late train after work and missed our stop because we were talking.",
        source_facts: ["f_setup"],
      },
    ],
    chorus: [
      {
        idea: "Now home feels like a promise we chose together.",
        source_facts: ["f_payoff"],
      },
    ],
    bridge: [
      {
        idea: "That winter changed everything and we decided to move anyway.",
        source_facts: ["f_turn"],
      },
    ],
  };

  return {
    facts,
    song_map: songMap,
    completed_story_package: {
      prose: [
        "We met on a late train after work and missed our stop because we were talking.",
        "That winter changed everything and we decided to move anyway.",
        "Now home feels like a promise we chose together.",
      ].join(" "),
    },
    primitives: {
      resolution: "Now home feels like a promise we chose together.",
      turning_point: "That winter changed everything and we decided to move anyway.",
    },
    ...overrides,
  };
}

function validSemanticReport(overrides = {}) {
  return {
    valid: true,
    weakSections: [],
    sectionScores: {},
    duplicatedThesis: false,
    ...overrides,
  };
}

test("sanitizeSongMap normalizes entries and drops citations outside the fact map", () => {
  const normalized = sanitizeSongMap(
    {
      hook: { idea: "  Promise\u200B with no drift\u0007 ", source_facts: ["f_setup", "missing", "f_setup"] },
      verse1: ["Late train scene"],
      chorus: [{ text: "Home feels chosen", facts: "f_payoff" }],
      bridge: [{ line: "Winter changed everything", source_facts: ["f_turn"] }],
      motifs: ["  promise\t", null, "home"],
    },
    [
      { id: "f_setup", text: "setup" },
      { id: "f_payoff", text: "payoff" },
      { id: "f_turn", text: "turn" },
    ],
  );

  assert.equal(normalized.hook.idea, "Promise with no drift");
  assert.deepEqual(normalized.hook.source_facts, ["f_setup"]);
  assert.deepEqual(normalized.verse1, [{ idea: "Late train scene", source_facts: [] }]);
  assert.deepEqual(normalized.chorus[0].source_facts, ["f_payoff"]);
  assert.deepEqual(normalized.bridge[0].source_facts, ["f_turn"]);
  assert.deepEqual(normalized.motifs, ["promise", "home"]);
});

test("significantWordOverlap scores only meaningful shared terms", () => {
  const reference = new Set(["late", "train", "promise", "home"]);

  assert.equal(significantWordOverlap("late train home", reference), 1);
  assert.equal(significantWordOverlap("ordinary filler", reference), 0);
});

test("validateSongContract accepts a cited map with payoff and turn support", () => {
  const result = validateSongContract(buildContractContext(), {
    semanticReport: validSemanticReport(),
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.missingSections, []);
  assert.deepEqual(result.uncitedSections, []);
  assert.deepEqual(result.brokenCitations, []);
  assert.deepEqual(result.unsupportedIdeas, []);
  assert.equal(result.payoffPresent, true);
  assert.equal(result.turnPresent, true);
});

test("validateSongContract reports uncited, broken, and unsupported section ideas", () => {
  const context = buildContractContext({
    song_map: {
      verse1: [{ idea: "We met on a late train after work.", source_facts: [] }],
      chorus: [{ idea: "A castle on Mars with fireworks.", source_facts: ["missing"] }],
      bridge: [{ idea: "That winter changed everything.", source_facts: ["f_turn"] }],
    },
  });

  const result = validateSongContract(context, {
    semanticReport: validSemanticReport(),
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.uncitedSections, ["verse1"]);
  assert.deepEqual(result.brokenCitations.map((entry) => entry.section), ["chorus"]);
  assert.deepEqual(result.unsupportedIdeas.map((entry) => entry.section), ["chorus"]);
});
