const test = require("node:test");
const assert = require("node:assert/strict");

const { createInitialState } = require("../../../src/writer/v3/state");
const {
  computeLabovGapAnalysis,
  computeStoryGapAnalysis,
  computeStoryElements,
} = require("../../../src/writer/v3/quality");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildEmptyState() {
  return createInitialState({
    recipientName: "Sarah",
    occasion: "birthday",
    initialPrompt: "seed",
  });
}

function buildRichBirthdayState() {
  const state = buildEmptyState();
  state.narrative = [
    "We met in college during freshman orientation.",
    "Sarah was the first person who said hi to me.",
    "When I got sick junior year, she drove three hours to bring me soup.",
    "That moment changed everything - I realized she wasn't just a friend, she was family.",
    "I felt so grateful and loved.",
  ].join(" ");
  state.narrative_current = state.narrative;
  state.atoms = {
    ...state.atoms,
    who: "my best friend Sarah",
    where: "in college",
    when: "freshman orientation",
    action: "she drove three hours to bring me soup when I got sick",
    after: "grateful and loved",
    turn: "I realized she wasn't just a friend, she was family",
  };
  state.primitives = {
    ...state.primitives,
    characters: [{ name: "Sarah", role: "best friend", desire: "to be there for me" }],
    setting: { place: "college campus", time: "junior year", atmosphere: "", sensory_tags: [] },
    resolution: "grateful and loved",
    turning_point: "she drove three hours to bring me soup",
  };
  state.facts = [
    { id: "f1", text: "We met in college during freshman orientation.", status: "active" },
    { id: "f2", text: "Sarah drove three hours to bring me soup when I was sick.", status: "active" },
    { id: "f3", text: "I realized she wasn't just a friend, she was family.", status: "active" },
    { id: "f4", text: "I felt so grateful and loved.", status: "active" },
  ];
  state.turn_count = 3;
  return state;
}

function buildMemorialState() {
  const state = createInitialState({
    recipientName: "Grandma",
    occasion: "memorial",
    initialPrompt: "seed",
  });
  state.narrative = [
    "Grandma always smelled like cinnamon and fresh bread.",
    "Every Sunday she taught me to cook her secret recipes.",
    "When she passed, I realized how much she shaped who I am.",
    "I'm grateful for every moment we had together.",
    "Happy birthday in heaven, Grandma.",
  ].join(" ");
  state.narrative_current = state.narrative;
  state.atoms = {
    ...state.atoms,
    who: "my grandmother",
    where: "her kitchen",
    when: "every Sunday",
    action: "she taught me to cook her secret recipes",
    after: "grateful for every moment",
  };
  state.primitives = {
    ...state.primitives,
    characters: [{ name: "Grandma", role: "grandmother" }],
    setting: { place: "her kitchen", time: "Sundays", atmosphere: "warm", sensory_tags: ["cinnamon", "fresh bread"] },
    resolution: "grateful for every moment",
  };
  state.facts = [
    { id: "f1", text: "Grandma always smelled like cinnamon and fresh bread.", status: "active" },
    { id: "f2", text: "She taught me to cook her secret recipes every Sunday.", status: "active" },
    { id: "f3", text: "When she passed, I realized how much she shaped who I am.", status: "active" },
  ];
  state.turn_count = 2;
  return state;
}

function buildMinimalState() {
  const state = buildEmptyState();
  state.atoms.who = "my friend";
  state.facts = [
    { id: "f1", text: "She is my friend.", status: "active" },
  ];
  state.turn_count = 1;
  return state;
}

// ---------------------------------------------------------------------------
// 1. Export existence
// ---------------------------------------------------------------------------

test("computeLabovGapAnalysis is exported from quality.js", () => {
  assert.equal(typeof computeLabovGapAnalysis, "function");
});

// ---------------------------------------------------------------------------
// 2. Return shape
// ---------------------------------------------------------------------------

test("return shape has all required fields", () => {
  const state = buildRichBirthdayState();
  const result = computeLabovGapAnalysis(state, { occasion: "birthday" });

  // Top-level backward-compatible fields
  assert.ok(Array.isArray(result.slots), "slots is an array");
  assert.ok(Array.isArray(result.missingSlots), "missingSlots is an array");
  assert.ok(Array.isArray(result.weakSlots), "weakSlots is an array");
  assert.equal(typeof result.readinessScore, "number", "readinessScore is a number");
  assert.equal(typeof result.isStoryReady, "boolean", "isStoryReady is a boolean");
  assert.equal(result.readinessProfile, "labov", "readinessProfile is 'labov'");
  assert.equal(typeof result.storyMode, "string", "storyMode is a string");
  assert.ok(result.elementSignals, "elementSignals exists");
  assert.ok(result.gates, "gates exists");

  // Labov-specific data
  assert.ok(result.labov, "labov object exists");
  assert.ok(Array.isArray(result.labov.elements), "labov.elements is an array");
  assert.equal(result.labov.elements.length, 6, "labov has 6 elements");
  assert.equal(typeof result.labov.weightedScore, "number", "labov.weightedScore is a number");
});

test("labov elements have correct shape", () => {
  const state = buildRichBirthdayState();
  const result = computeLabovGapAnalysis(state, { occasion: "birthday" });

  for (const el of result.labov.elements) {
    assert.equal(typeof el.element, "string", `element name is a string: ${el.element}`);
    assert.equal(typeof el.weight, "number", `weight is a number: ${el.element}`);
    assert.equal(typeof el.strength, "number", `strength is a number: ${el.element}`);
    assert.ok(["covered", "weak", "missing"].includes(el.status), `status is valid: ${el.element}`);
    assert.ok(Array.isArray(el.evidence), `evidence is an array: ${el.element}`);
    assert.ok(el.strength >= 0 && el.strength <= 1, `strength in [0,1]: ${el.element}`);
  }
});

test("labov element names are correct", () => {
  const state = buildRichBirthdayState();
  const result = computeLabovGapAnalysis(state, { occasion: "birthday" });
  const names = result.labov.elements.map((e) => e.element);
  assert.deepEqual(names, [
    "orientation",
    "complicating_action",
    "evaluation",
    "resolution",
    "coda",
    "specificity_bonus",
  ]);
});

// ---------------------------------------------------------------------------
// 3. Backward-compatible slots (8 slot IDs)
// ---------------------------------------------------------------------------

test("slots use the 8 backward-compatible slot IDs", () => {
  const state = buildRichBirthdayState();
  const result = computeLabovGapAnalysis(state, { occasion: "birthday" });

  const slotIds = result.slots.map((s) => s.slot);
  const expected = [
    "moment_destination", "who", "want", "blocker",
    "stakes", "turn", "ending_feel", "tone",
  ];
  assert.deepEqual(slotIds.sort(), expected.sort());
});

test("each slot has status and confidence", () => {
  const state = buildRichBirthdayState();
  const result = computeLabovGapAnalysis(state, { occasion: "birthday" });

  for (const slot of result.slots) {
    assert.ok(["covered", "weak", "missing"].includes(slot.status), `slot ${slot.slot} has valid status`);
    assert.equal(typeof slot.confidence, "number", `slot ${slot.slot} has numeric confidence`);
  }
});

// ---------------------------------------------------------------------------
// 4. Rich birthday story should be ready
// ---------------------------------------------------------------------------

test("rich birthday story scores >= 0.60 readiness", () => {
  const state = buildRichBirthdayState();
  const result = computeLabovGapAnalysis(state, { occasion: "birthday" });

  assert.ok(result.readinessScore >= 0.60, `readinessScore ${result.readinessScore} should be >= 0.60`);
  assert.ok(result.isStoryReady, "rich birthday story should be ready");
});

// ---------------------------------------------------------------------------
// 5. Empty/minimal state should NOT be ready
// ---------------------------------------------------------------------------

test("empty state has low readiness", () => {
  const state = buildEmptyState();
  const result = computeLabovGapAnalysis(state, { occasion: "birthday" });

  assert.ok(result.readinessScore < 0.30, `empty state readiness ${result.readinessScore} should be < 0.30`);
  assert.equal(result.isStoryReady, false, "empty state should not be ready");
});

test("minimal state has low readiness", () => {
  const state = buildMinimalState();
  const result = computeLabovGapAnalysis(state, { occasion: "birthday" });

  assert.ok(result.readinessScore < 0.60, `minimal state readiness ${result.readinessScore} should be < 0.60`);
  assert.equal(result.isStoryReady, false, "minimal state should not be ready");
});

// ---------------------------------------------------------------------------
// 6. Occasion-aware weight adjustment for memorial/tribute
// ---------------------------------------------------------------------------

test("memorial occasion de-weights resolution, adds to evaluation", () => {
  const state = buildMemorialState();
  const result = computeLabovGapAnalysis(state, { occasion: "memorial" });
  const elements = Object.fromEntries(result.labov.elements.map((e) => [e.element, e]));

  assert.equal(elements.resolution.weight, 0.05, "resolution weight should be 0.05 for memorial");
  assert.equal(elements.evaluation.weight, 0.40, "evaluation weight should be 0.40 for memorial");
  assert.ok(result.labov.occasionAdjustment !== null, "occasionAdjustment should be set");
});

test("birthday occasion gets celebration weights", () => {
  const state = buildRichBirthdayState();
  const result = computeLabovGapAnalysis(state, { occasion: "birthday" });
  const elements = Object.fromEntries(result.labov.elements.map((e) => [e.element, e]));

  assert.equal(elements.orientation.weight, 0.30, "orientation weight should be 0.30 for birthday");
  assert.equal(elements.complicating_action.weight, 0.10, "complicating_action weight should be 0.10 for birthday");
  assert.equal(elements.evaluation.weight, 0.45, "evaluation weight should be 0.45 for birthday");
  assert.equal(elements.resolution.weight, 0.05, "resolution weight should be 0.05 for birthday");
  assert.ok(result.labov.occasionAdjustment, "celebration adjustment should be set for birthday");
});

test("celebration occasions all get celebration weights", () => {
  for (const occasion of ["celebration", "birthday", "graduation", "get_well", "friendship"]) {
    const state = buildRichBirthdayState();
    const result = computeLabovGapAnalysis(state, { occasion });
    const elements = Object.fromEntries(result.labov.elements.map((e) => [e.element, e]));
    assert.equal(elements.complicating_action.weight, 0.10, `complicating_action should be 0.10 for ${occasion}`);
    assert.equal(elements.evaluation.weight, 0.45, `evaluation should be 0.45 for ${occasion}`);
  }
});

test("non-celebration non-tribute occasion keeps default weights", () => {
  const state = buildRichBirthdayState();
  const result = computeLabovGapAnalysis(state, { occasion: "custom" });
  const elements = Object.fromEntries(result.labov.elements.map((e) => [e.element, e]));

  assert.equal(elements.resolution.weight, 0.10, "resolution weight should be 0.10 for custom");
  assert.equal(elements.evaluation.weight, 0.35, "evaluation weight should be 0.35 for custom");
  assert.equal(result.labov.occasionAdjustment, null, "no adjustment for custom");
});

test("tribute occasions trigger weight adjustment", () => {
  for (const occasion of ["memorial", "bereavement", "tribute", "thank-you", "thank_you"]) {
    const state = buildMemorialState();
    state.event.occasion = occasion;
    const result = computeLabovGapAnalysis(state, { occasion });
    const elements = Object.fromEntries(result.labov.elements.map((e) => [e.element, e]));
    assert.equal(elements.evaluation.weight, 0.40, `evaluation weight should be 0.40 for ${occasion}`);
  }
});

// ---------------------------------------------------------------------------
// 7. "Good enough" escape after turn 2
// ---------------------------------------------------------------------------

test("canProceedAnyway is true when turnCount >= 2", () => {
  const state = buildMinimalState();
  state.turn_count = 2;
  const result = computeLabovGapAnalysis(state, { occasion: "birthday", turnCount: 2 });
  assert.equal(result.canProceedAnyway, true, "canProceedAnyway should be true at turn 2");
});

test("canProceedAnyway is true when turnCount >= 3", () => {
  const state = buildMinimalState();
  state.turn_count = 3;
  const result = computeLabovGapAnalysis(state, { occasion: "birthday", turnCount: 3 });
  assert.equal(result.canProceedAnyway, true, "canProceedAnyway should be true at turn 3");
});

test("canProceedAnyway is falsy when turnCount < 2", () => {
  const state = buildMinimalState();
  const result = computeLabovGapAnalysis(state, { occasion: "birthday", turnCount: 1 });
  assert.ok(!result.canProceedAnyway, "canProceedAnyway should be falsy at turn 1");
});

test("canProceedAnyway defaults to false when turnCount not provided", () => {
  const state = buildMinimalState();
  const result = computeLabovGapAnalysis(state, { occasion: "birthday" });
  assert.ok(!result.canProceedAnyway, "canProceedAnyway should be falsy when turnCount not provided");
});

// ---------------------------------------------------------------------------
// 8. Story mode detection
// ---------------------------------------------------------------------------

test("reflective tribute occasion sets storyMode", () => {
  const state = buildMemorialState();
  state.event.occasion = "mothers-day";
  const result = computeLabovGapAnalysis(state, { occasion: "mothers-day" });
  assert.equal(result.storyMode, "reflective_tribute");
});

test("birthday without appreciation language sets default storyMode", () => {
  // Build a birthday state that does NOT contain appreciation/gratitude language,
  // which would otherwise trigger reflective_tribute via APPRECIATION_REGEX
  const state = buildEmptyState();
  state.atoms.who = "my friend Sarah";
  state.atoms.where = "at the park";
  state.atoms.when = "last summer";
  state.atoms.action = "she threw me a surprise party";
  state.narrative = "Sarah threw me a surprise birthday party at the park last summer. It was wild.";
  state.narrative_current = state.narrative;
  state.facts = [
    { id: "f1", text: "Sarah threw a surprise party at the park.", status: "active" },
  ];
  const result = computeLabovGapAnalysis(state, { occasion: "birthday" });
  assert.equal(result.storyMode, "default");
});

// ---------------------------------------------------------------------------
// 9. Element signals present in return
// ---------------------------------------------------------------------------

test("elementSignals contains expected properties", () => {
  const state = buildRichBirthdayState();
  const result = computeLabovGapAnalysis(state, { occasion: "birthday" });
  assert.equal(typeof result.elementSignals.detailSpecificity, "number");
  assert.equal(typeof result.elementSignals.relationshipDepth, "number");
  assert.equal(typeof result.elementSignals.reflectiveMomentStrength, "number");
});

// ---------------------------------------------------------------------------
// 10. Labov element detection: orientation
// ---------------------------------------------------------------------------

test("orientation: strong when who + where + relationship hint", () => {
  const state = buildRichBirthdayState();
  const result = computeLabovGapAnalysis(state, { occasion: "birthday" });
  const orientation = result.labov.elements.find((e) => e.element === "orientation");

  assert.ok(orientation.strength >= 0.6, `orientation strength ${orientation.strength} should be >= 0.6`);
  assert.equal(orientation.status, "covered");
});

test("orientation: missing when no who/where", () => {
  const state = buildEmptyState();
  const result = computeLabovGapAnalysis(state, { occasion: "birthday" });
  const orientation = result.labov.elements.find((e) => e.element === "orientation");

  assert.ok(orientation.strength < 0.3, `orientation strength ${orientation.strength} should be < 0.3`);
  assert.equal(orientation.status, "missing");
});

// ---------------------------------------------------------------------------
// 11. Labov element detection: complicating action
// ---------------------------------------------------------------------------

test("complicating_action: present when past-tense verbs + action atom", () => {
  const state = buildRichBirthdayState();
  const result = computeLabovGapAnalysis(state, { occasion: "birthday" });
  const ca = result.labov.elements.find((e) => e.element === "complicating_action");

  // Birthday story has "drove" (past action) + action atom but no explicit conflict,
  // so strength is ~0.40 (weak). A state with conflict would score higher.
  assert.ok(ca.strength >= 0.3, `complicating_action strength ${ca.strength} should be >= 0.3 (weak)`);
  assert.ok(["covered", "weak"].includes(ca.status));
});

test("complicating_action: strong when explicit conflict present", () => {
  const state = buildRichBirthdayState();
  state.primitives.conflict = { internal: "afraid of losing the friendship", external: "" };
  const result = computeLabovGapAnalysis(state, { occasion: "birthday" });
  const ca = result.labov.elements.find((e) => e.element === "complicating_action");

  assert.ok(ca.strength >= 0.6, `complicating_action strength ${ca.strength} should be >= 0.6 with conflict`);
  assert.equal(ca.status, "covered");
});

// ---------------------------------------------------------------------------
// 12. Labov element detection: evaluation
// ---------------------------------------------------------------------------

test("evaluation: strong when emotional language present", () => {
  const state = buildRichBirthdayState();
  const result = computeLabovGapAnalysis(state, { occasion: "birthday" });
  const evaluation = result.labov.elements.find((e) => e.element === "evaluation");

  assert.ok(evaluation.strength >= 0.5, `evaluation strength ${evaluation.strength} should be >= 0.5`);
});

// ---------------------------------------------------------------------------
// 13. Labov element detection: specificity bonus
// ---------------------------------------------------------------------------

test("specificity_bonus: detects proper nouns and sensory words", () => {
  const state = buildMemorialState();
  const result = computeLabovGapAnalysis(state, { occasion: "memorial" });
  const specificity = result.labov.elements.find((e) => e.element === "specificity_bonus");

  // Memorial state has "cinnamon", "fresh bread" (sensory), "Grandma" (proper noun)
  assert.ok(specificity.strength > 0, `specificity strength ${specificity.strength} should be > 0`);
});

// ---------------------------------------------------------------------------
// 14. Gates backward compatibility
// ---------------------------------------------------------------------------

test("gates contains backward-compatible flags", () => {
  const state = buildRichBirthdayState();
  const result = computeLabovGapAnalysis(state, { occasion: "birthday" });

  assert.equal(typeof result.gates.noSafetyBlock, "boolean");
  assert.equal(typeof result.gates.enoughCoveredSlots, "boolean");
});

// ---------------------------------------------------------------------------
// 15. Deterministic: same input = same output
// ---------------------------------------------------------------------------

test("function is deterministic - same state produces same result", () => {
  const state = buildRichBirthdayState();
  const result1 = computeLabovGapAnalysis(state, { occasion: "birthday" });
  const result2 = computeLabovGapAnalysis(state, { occasion: "birthday" });

  assert.equal(result1.readinessScore, result2.readinessScore);
  assert.deepEqual(result1.labov, result2.labov);
  assert.deepEqual(result1.missingSlots, result2.missingSlots);
  assert.deepEqual(result1.weakSlots, result2.weakSlots);
});

// ---------------------------------------------------------------------------
// 16. computeStoryElements maps Labov to display elements
// ---------------------------------------------------------------------------

test("computeStoryElements maps Labov readinessProfile to 5 display elements", () => {
  const state = buildRichBirthdayState();
  const gapAnalysis = computeLabovGapAnalysis(state, { occasion: "birthday" });
  const elements = computeStoryElements(gapAnalysis);

  assert.equal(elements.length, 5, "should produce 5 display elements");
  const ids = elements.map((e) => e.id);
  assert.deepEqual(ids, ["setting", "feeling", "bond", "moment", "details"]);

  for (const el of elements) {
    assert.equal(typeof el.strength, "number");
    assert.equal(typeof el.display_name, "string");
    assert.equal(typeof el.purpose, "string");
    assert.equal(typeof el.is_required, "boolean");
  }
});

// ---------------------------------------------------------------------------
// 17. Labov and legacy produce compatible shapes
// ---------------------------------------------------------------------------

test("Labov and legacy gap analysis produce compatible top-level shapes", () => {
  const state = buildRichBirthdayState();
  const labov = computeLabovGapAnalysis(state, { occasion: "birthday" });
  const legacy = computeStoryGapAnalysis(state);

  // Both should have the same top-level keys (Labov adds extras)
  const requiredKeys = ["slots", "missingSlots", "weakSlots", "readinessScore", "isStoryReady", "readinessProfile", "storyMode", "elementSignals", "gates"];
  for (const key of requiredKeys) {
    assert.ok(key in labov, `Labov result should have '${key}'`);
    assert.ok(key in legacy, `legacy result should have '${key}'`);
  }
});

// ---------------------------------------------------------------------------
// 18. readinessScore is in [0, 1]
// ---------------------------------------------------------------------------

test("readinessScore is always in [0, 1]", () => {
  for (const builder of [buildEmptyState, buildMinimalState, buildRichBirthdayState, buildMemorialState]) {
    const state = builder();
    const result = computeLabovGapAnalysis(state, { occasion: state.event?.occasion || "birthday" });
    assert.ok(result.readinessScore >= 0, `readinessScore >= 0: ${result.readinessScore}`);
    assert.ok(result.readinessScore <= 1, `readinessScore <= 1: ${result.readinessScore}`);
  }
});

// ---------------------------------------------------------------------------
// 19. Weighted score matches labov.weightedScore
// ---------------------------------------------------------------------------

test("readinessScore equals labov.weightedScore", () => {
  const state = buildRichBirthdayState();
  const result = computeLabovGapAnalysis(state, { occasion: "birthday" });
  assert.equal(result.readinessScore, result.labov.weightedScore);
});

// ---------------------------------------------------------------------------
// 20. Coda detection
// ---------------------------------------------------------------------------

test("coda: detects dedication language", () => {
  const state = buildMemorialState();
  // The memorial state has "Happy birthday in heaven" which matches DEDICATION_REGEX
  const result = computeLabovGapAnalysis(state, { occasion: "memorial" });
  const coda = result.labov.elements.find((e) => e.element === "coda");
  assert.ok(coda.strength > 0, `coda strength ${coda.strength} should be > 0`);
});
