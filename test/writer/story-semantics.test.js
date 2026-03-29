const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deriveStoryBlockProfile,
  evaluateNarrativeBlockCoverage,
  repairNarrativeFromBlockProfile,
  repairSongMapWithProfile,
  scoreSectionPurposeFitness,
} = require("../../src/writer/story-semantics");

function buildGenericStoryContext() {
  return {
    initial_prompt: [
      "We met on a late train after work and missed our stop because we were talking.",
      "When you lost your job, we lived out of suitcases for months.",
      "That winter changed everything and we decided to move anyway.",
      "You grew steadier and I learned what partnership really means.",
      "Now home feels like a promise we chose together.",
    ].join(" "),
    narrative: "We met on a late train after work. That winter changed everything.",
    facts: [
      { id: "f_setup", text: "We met on a late train after work and missed our stop because we were talking.", beat: "scene" },
      { id: "f_conflict", text: "When you lost your job, we lived out of suitcases for months.", beat: "struggle" },
      { id: "f_turn", text: "That winter changed everything and we decided to move anyway.", beat: "turning_point" },
      { id: "f_transform", text: "You grew steadier and I learned what partnership really means.", beat: "impact" },
      { id: "f_meaning", text: "Now home feels like a promise we chose together.", beat: "meaning" },
    ],
    primitives: {
      turning_point: "That winter changed everything and we decided to move anyway.",
      resolution: "You grew steadier and I learned what partnership really means.",
      theme: "Now home feels like a promise we chose together.",
    },
    atoms: {
      action: "We met on a late train after work and missed our stop because we were talking.",
      turn: "That winter changed everything and we decided to move anyway.",
      after: "Now home feels like a promise we chose together.",
    },
  };
}

test("deriveStoryBlockProfile generalizes beyond a single story and keeps narrative enforcement active", () => {
  const profile = deriveStoryBlockProfile(buildGenericStoryContext());

  assert.deepEqual(profile.requiredBlocks, ["setup", "conflict", "turn", "transformation", "meaning"]);
  assert.deepEqual(profile.enforcedNarrativeBlocks, ["setup", "conflict", "turn", "transformation", "meaning"]);
  assert.equal(profile.richStory, true);
});

test("evaluateNarrativeBlockCoverage counts a single sentence toward multiple blocks", () => {
  const context = buildGenericStoryContext();
  const profile = deriveStoryBlockProfile(context);
  const coverage = evaluateNarrativeBlockCoverage(
    "You grew steadier and I learned what partnership really means.",
    profile,
  );

  assert.equal(coverage.coverage.transformation.covered, true);
  assert.equal(coverage.coverage.meaning.covered, true);
});

test("repairNarrativeFromBlockProfile preserves unmatched sentences while appending missing blocks", () => {
  const context = buildGenericStoryContext();
  const profile = deriveStoryBlockProfile(context);
  const repaired = repairNarrativeFromBlockProfile(
    "The old station clock still ticks in my head. We met on a late train after work.",
    profile,
  );

  assert.equal(repaired.repaired, true);
  assert.match(repaired.narrative, /The old station clock still ticks in my head/i);
  assert.match(repaired.narrative, /partnership really means|home feels like a promise/i);
});

test("scoreSectionPurposeFitness does not treat strong transformation as low-information geography", () => {
  const context = buildGenericStoryContext();
  const profile = deriveStoryBlockProfile(context);
  const strong = scoreSectionPurposeFitness(
    "bridge",
    "From fear to courage, you found your voice.",
    context,
    profile,
  );
  const weak = scoreSectionPurposeFitness(
    "bridge",
    "Life feels like a dream come true.",
    context,
    profile,
  );

  assert.equal(strong.primaryBlock, "transformation");
  assert.ok(strong.score > weak.score);
});

test("repairSongMapWithProfile can recover a distinct bridge without reusing the chorus thesis", () => {
  const context = buildGenericStoryContext();
  const repaired = repairSongMapWithProfile({
    chorus: [{ idea: "Now home feels like a promise we chose together.", source_facts: ["f_meaning"] }],
  }, context);

  assert.equal(repaired.report.valid, true);
  assert.notEqual(repaired.song_map.bridge[0].idea, repaired.song_map.chorus[0].idea);
  assert.match(repaired.song_map.bridge[0].idea, /grew steadier|changed everything|partnership/i);
});
