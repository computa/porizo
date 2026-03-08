const test = require("node:test");
const assert = require("node:assert/strict");

const v3 = require("../../../src/writer/v3");
const { createInitialState } = require("../../../src/writer/v3/state");
const { buildGapTargeting } = require("../../../src/writer/v3/prompts/builder");

function buildReadyReflectiveState() {
  const state = createInitialState({
    recipientName: "Ada",
    occasion: "custom",
    initialPrompt: "Story seed",
  });
  state.narrative = "My sister Ada and I met in Lagos last December. I wanted us to reconnect. Then she called from the hospital parking lot and everything changed. We ended feeling hopeful and grateful.";
  state.narrative_current = state.narrative;
  state.atoms = {
    ...state.atoms,
    who: "my sister Ada",
    where: "Lagos",
    when: "last December",
    turn: "she called from the hospital parking lot",
    action: "we talked honestly for the first time in months",
    after: "hopeful and grateful",
    stakes: "we might never speak again",
  };
  state.primitives = {
    ...state.primitives,
    characters: [{ name: "Ada", role: "sister", desire: "to reconnect" }],
    setting: { place: "Lagos", time: "last December", atmosphere: "", sensory_tags: [] },
    turning_point: "she called from the hospital parking lot",
    resolution: "we ended hopeful and grateful",
    conflict: { internal: "years of silence between us" },
  };
  state.dials = { ...state.dials, tone: "gentle" };
  state.beats = [
    { id: "scene", strength: 0.8, status: "covered" },
    { id: "moment", strength: 0.8, status: "covered" },
    { id: "turning_point", strength: 0.8, status: "covered" },
    { id: "meaning", strength: 0.8, status: "covered" },
  ];
  state.facts = [
    { id: "f1", text: "My sister Ada and I met in Lagos last December.", status: "active" },
    { id: "f2", text: "Then she called from the hospital parking lot.", status: "active" },
  ];
  state.last_reasoning = {
    story_readiness: {
      has_emotional_depth: true,
      strong_elements: ["turn", "who", "resolution"],
      weak_elements: [],
    },
    user_state: {
      seems_done: true,
    },
  };
  return state;
}

test("resolveTurnDecision keeps CONFIRM when LLM is ready", () => {
  const state = buildReadyReflectiveState();
  state.last_reasoning = {
    story_readiness: { has_emotional_depth: true, strong_elements: ["moment", "theme"], weak_elements: [] },
    user_state: { seems_done: true },
  };

  const resolution = v3.__internal.resolveTurnDecision(
    {
      action: "CONFIRM",
      confirmation: "Looks good to me.",
      narrative: "Story",
    },
    state
  );

  assert.equal(resolution.response.action, "CONFIRM");
  assert.equal(Boolean(resolution.llmReadySignal), true);
});

test("resolveTurnDecision blocks CONFIRM when critical moment slot is weak", () => {
  const state = createInitialState({
    recipientName: "Ada",
    occasion: "birthday",
    initialPrompt: "seed",
  });
  state.narrative = "We met in Lagos and something changed.";
  state.narrative_current = state.narrative;
  state.atoms = {
    ...state.atoms,
    where: "Lagos",
    action: "we met and talked",
    // intentionally no time to keep moment_destination weak
  };
  state.last_reasoning = {
    story_readiness: {
      has_emotional_depth: true,
      strong_elements: ["moment", "theme"],
      weak_elements: [],
    },
    user_state: { seems_done: true },
  };

  const resolution = v3.__internal.resolveTurnDecision(
    {
      action: "CONFIRM",
      confirmation: "Ready to finalize.",
      narrative: state.narrative,
    },
    state
  );

  assert.equal(resolution.response.action, "CLARIFY");
  assert.equal(resolution.criticalSlotBlock, true);
  assert.ok(Array.isArray(resolution.criticalBlockingSlots));
  assert.ok(resolution.criticalBlockingSlots.includes("moment_destination"));
});

test("resolveTurnDecision promotes ASK to CONFIRM when deterministic readiness is met", () => {
  const state = buildReadyReflectiveState();

  const resolution = v3.__internal.resolveTurnDecision(
    {
      action: "ASK",
      question: "Tell me more.",
      narrative: state.narrative,
    },
    state
  );

  assert.equal(resolution.response.action, "CONFIRM");
  assert.ok(typeof resolution.response.confirmation === "string" && resolution.response.confirmation.length > 0);
  assert.equal(resolution.gapAnalysis.isStoryReady, true);
});

test("resolveTurnDecision allows CONFIRM for revisions even with critical gap", () => {
  const state = createInitialState({
    recipientName: "Ada",
    occasion: "birthday",
    initialPrompt: "seed",
  });
  state.narrative = "We met in Lagos and something changed.";
  state.narrative_current = state.narrative;
  state.atoms = {
    ...state.atoms,
    where: "Lagos",
    action: "we met and talked",
    // intentionally no time to keep moment_destination weak
  };
  state.last_reasoning = {
    story_readiness: {
      has_emotional_depth: true,
      strong_elements: ["moment", "theme"],
      weak_elements: [],
    },
    user_state: { seems_done: true },
  };

  // Without revision flag: should block
  const blocked = v3.__internal.resolveTurnDecision(
    { action: "CONFIRM", confirmation: "Ready.", narrative: state.narrative },
    state
  );
  assert.equal(blocked.response.action, "CLARIFY");
  assert.equal(blocked.criticalSlotBlock, true);

  // With revision flag: should allow CONFIRM
  const allowed = v3.__internal.resolveTurnDecision(
    { action: "CONFIRM", confirmation: "Ready.", narrative: state.narrative },
    state,
    { inputMode: "revision" }
  );
  assert.equal(allowed.response.action, "CONFIRM");
  // Critical slot is still detected but not blocking
  assert.equal(allowed.criticalSlotBlock, true);
});

test("resolveTurnDecision still blocks revisions for safety violations", () => {
  const state = createInitialState({
    recipientName: "Ada",
    occasion: "birthday",
    initialPrompt: "seed",
  });
  state.narrative = "A story.";
  state.narrative_current = state.narrative;
  state.last_reasoning = {
    safety: { blocked: true },
  };

  const resolution = v3.__internal.resolveTurnDecision(
    { action: "CONFIRM", confirmation: "Ready.", narrative: state.narrative },
    state,
    { inputMode: "revision" }
  );
  assert.equal(resolution.response.action, "CLARIFY");
});

test("resolveTurnDecision forces CONFIRM via exhaustion escape after MAX asks", () => {
  // Build a state where ALL slots are covered EXCEPT moment_destination.
  // This ensures no alternate gap question when the repeat-escape prunes it.
  const state = buildReadyReflectiveState();
  // Remove place/time to make moment_destination "weak"
  delete state.atoms.where;
  delete state.atoms.when;
  state.primitives.setting = { place: "", time: "", atmosphere: "", sensory_tags: [] };
  // Cover blocker, stakes, ending_feel so no alternates exist
  state.primitives.conflict = { internal: "years of silence between us" };
  state.atoms.stakes = "we might never speak again";
  state.narrative += " I felt grateful and relieved we finally reconnected.";
  state.narrative_current = state.narrative;
  // Simulate asking the blocking slot MAX times with no alternate
  state.gap_history = [
    { slot: "moment_destination", turn: 1, timestamp: new Date().toISOString() },
    { slot: "moment_destination", turn: 2, timestamp: new Date().toISOString() },
  ];

  const resolution = v3.__internal.resolveTurnDecision(
    { action: "CONFIRM", confirmation: "Ready.", narrative: state.narrative },
    state
  );

  assert.equal(resolution.response.action, "CONFIRM");
  assert.equal(resolution.decisionSource, "exhaustion_escape");
  assert.equal(resolution.forcedConfirm, true);
});

test("resolveTurnDecision exhaustion escape does NOT fire for safety blocks", () => {
  const state = buildReadyReflectiveState();
  delete state.atoms.where;
  delete state.atoms.when;
  state.primitives.setting = { place: "", time: "", atmosphere: "", sensory_tags: [] };
  state.primitives.conflict = { internal: "years of silence between us" };
  state.atoms.stakes = "we might never speak again";
  state.narrative += " I felt grateful and relieved we finally reconnected.";
  state.narrative_current = state.narrative;
  state.last_reasoning = {
    safety: { blocked: true },
  };
  state.gap_history = [
    { slot: "moment_destination", turn: 1, timestamp: new Date().toISOString() },
    { slot: "moment_destination", turn: 2, timestamp: new Date().toISOString() },
  ];

  const resolution = v3.__internal.resolveTurnDecision(
    { action: "CONFIRM", confirmation: "Ready.", narrative: state.narrative },
    state
  );

  // Safety block should NOT be escaped
  assert.equal(resolution.response.action, "CLARIFY");
  assert.notEqual(resolution.decisionSource, "exhaustion_escape");
});

test("resolveTurnDecision blocks confirm when grounding has no facts", () => {
  const state = createInitialState({
    recipientName: "Ada",
    occasion: "birthday",
    initialPrompt: "seed",
  });
  state.grounding_enforced = true;
  state.grounding_issue = "no_facts";

  const resolution = v3.__internal.resolveTurnDecision(
    {
      action: "CONFIRM",
      confirmation: "Ready to finalize.",
      narrative: "",
    },
    state
  );

  assert.equal(resolution.response.action, "CLARIFY");
  assert.ok(resolution.response.question?.length > 0);
});

// --- Hybrid Slot Targeting Tests ---

function buildStateWithMomentGap() {
  const state = createInitialState({
    recipientName: "Ada",
    occasion: "birthday",
    initialPrompt: "seed",
  });
  state.narrative = "My older brother Osita always stepped up for the family.";
  state.narrative_current = state.narrative;
  state.atoms = {
    ...state.atoms,
    who: "my older brother Osita",
    action: "stepped up for the family",
  };
  state.primitives = {
    ...state.primitives,
    characters: [{ name: "Osita", role: "older brother", desire: "to provide" }],
  };
  state.facts = [
    { id: "f1", text: "My older brother Osita always stepped up.", status: "active" },
  ];
  return state;
}

test("resolveTurnDecision prefers LLM question when targetSlot matches gap", () => {
  const state = buildStateWithMomentGap();
  const llmQuestion = "You mentioned Osita stepped up — was there one specific moment and place where that really hit you?";

  const resolution = v3.__internal.resolveTurnDecision(
    {
      action: "ASK",
      question: llmQuestion,
      narrative: state.narrative,
      targetSlot: "moment_destination",
    },
    state
  );

  assert.equal(resolution.response.action, "ASK");
  assert.equal(resolution.response.question, llmQuestion);
  assert.equal(resolution.decisionSource, "llm_slot_targeted");
});

test("resolveTurnDecision falls back to template when targetSlot mismatches", () => {
  const state = buildStateWithMomentGap();

  const resolution = v3.__internal.resolveTurnDecision(
    {
      action: "ASK",
      question: "What tone should the story have?",
      narrative: state.narrative,
      targetSlot: "tone",
    },
    state
  );

  assert.equal(resolution.response.action, "ASK");
  // Should use template question, not LLM's question about tone
  assert.notEqual(resolution.response.question, "What tone should the story have?");
  assert.equal(resolution.decisionSource, "deterministic_gap");
});

test("resolveTurnDecision falls back to template when no targetSlot", () => {
  const state = buildStateWithMomentGap();

  const resolution = v3.__internal.resolveTurnDecision(
    {
      action: "ASK",
      question: "Tell me more about Osita.",
      narrative: state.narrative,
    },
    state
  );

  assert.equal(resolution.response.action, "ASK");
  assert.notEqual(resolution.response.question, "Tell me more about Osita.");
  assert.equal(resolution.decisionSource, "deterministic_gap");
});

test("resolveTurnDecision uses LLM question in critical block when slot matches", () => {
  const state = buildStateWithMomentGap();
  // Force LLM to want CONFIRM but critical slot blocks it
  const llmQuestion = "Before we finalize, where exactly did this moment happen?";

  const resolution = v3.__internal.resolveTurnDecision(
    {
      action: "CONFIRM",
      confirmation: "Your story is ready.",
      question: llmQuestion,
      narrative: state.narrative,
      targetSlot: "moment_destination",
    },
    state
  );

  assert.equal(resolution.response.action, "CLARIFY");
  assert.equal(resolution.response.question, llmQuestion);
  assert.equal(resolution.decisionSource, "llm_slot_targeted_critical");
});

// --- Builder Gap Targeting Tests ---

test("buildGapTargeting formats coverage table from state.story_slots", () => {
  const state = {
    story_slots: {
      moment_destination: { status: "missing", confidence: 0, reason: "No place or time", evidence: [] },
      who: { status: "covered", confidence: 0.8, reason: "Named Osita", evidence: ["Osita", "older brother"] },
      want: { status: "weak", confidence: 0.4, reason: "Vague desire", evidence: ["to provide"] },
    },
    readiness: {
      missing_slots: ["moment_destination"],
      weak_slots: ["want"],
    },
  };

  const result = buildGapTargeting(state);
  assert.ok(result.includes("| moment_destination | missing |"));
  assert.ok(result.includes("| who | covered |"));
  assert.ok(result.includes("Missing: moment_destination"));
  assert.ok(result.includes("Weak: want"));
  assert.ok(result.includes("SLOT TARGETING"));
  assert.ok(result.includes('"moment_destination"'));
});

test("buildGapTargeting returns table without targeting when all slots covered", () => {
  const state = {
    story_slots: {
      moment_destination: { status: "covered", confidence: 0.9, reason: "Clear", evidence: ["Lagos", "December"] },
      who: { status: "covered", confidence: 0.8, reason: "Named", evidence: ["Osita"] },
    },
    readiness: {
      missing_slots: [],
      weak_slots: [],
    },
  };

  const result = buildGapTargeting(state);
  assert.ok(result.includes("| moment_destination | covered |"));
  assert.ok(result.includes("| who | covered |"));
  assert.ok(!result.includes("SLOT TARGETING"));
});

test("every STORY_SLOT_PRIORITY slot has a SLOT_GUIDANCE_TEMPLATES entry", () => {
  const { STORY_SLOT_PRIORITY, SLOT_GUIDANCE_TEMPLATES } = v3.__internal.quality;
  for (const slotId of STORY_SLOT_PRIORITY) {
    assert.ok(SLOT_GUIDANCE_TEMPLATES[slotId], `Missing SLOT_GUIDANCE_TEMPLATES entry for "${slotId}"`);
    assert.ok(SLOT_GUIDANCE_TEMPLATES[slotId].weak, `Missing weak variant for "${slotId}"`);
    assert.ok(SLOT_GUIDANCE_TEMPLATES[slotId].missing, `Missing missing variant for "${slotId}"`);
  }
});

test("buildGapTargeting returns no-analysis message when story_slots empty", () => {
  assert.equal(buildGapTargeting({}), "(No gap analysis yet — first turn)");
  assert.equal(buildGapTargeting({ story_slots: {} }), "(No gap analysis yet — first turn)");
  assert.equal(buildGapTargeting(null), "(No gap analysis yet — first turn)");
});

// --- Story Element Threshold Tests ---

const {
  STORY_ELEMENT_DEFINITIONS,
  ELEMENT_CONFIRM_THRESHOLD,
  computeStoryElements,
  getElementConfirmBlock,
} = v3.__internal.quality;

test("computeStoryElements maps 8 slots to 5 elements with correct ids", () => {
  const gapAnalysis = {
    slots: [
      { slot: "moment_destination", status: "covered", confidence: 0.85 },
      { slot: "ending_feel", status: "covered", confidence: 0.80 },
      { slot: "tone", status: "weak", confidence: 0.40 },
      { slot: "who", status: "covered", confidence: 0.90 },
      { slot: "want", status: "weak", confidence: 0.45 },
      { slot: "turn", status: "missing", confidence: 0.05 },
      { slot: "blocker", status: "missing", confidence: 0.05 },
      { slot: "stakes", status: "weak", confidence: 0.35 },
    ],
  };

  const elements = computeStoryElements(gapAnalysis);

  assert.equal(elements.length, 5);
  assert.deepEqual(elements.map(el => el.id), ["setting", "feeling", "bond", "moment", "details"]);

  // Setting: primarySlot=moment_destination (0.85), no bonus
  assert.equal(elements[0].strength, 0.85);
  assert.equal(elements[0].is_required, true);
  assert.equal(elements[0].display_name, "The Setting");

  // Bond: primarySlot=who (0.90), bonusSlot=want (0.45)
  // max(0.90, 0.75*0.90 + 0.25*0.45) = max(0.90, 0.7875) = 0.90
  assert.equal(elements[2].strength, 0.90);

  // Details: primarySlot=stakes (0.35), no bonus
  assert.equal(elements[4].strength, 0.35);
  assert.equal(elements[4].is_required, false);
});

test("bonus slot only helps, never hurts element score", () => {
  // Covered primary + missing bonus should = primary confidence
  const gapAnalysis = {
    slots: [
      { slot: "who", status: "covered", confidence: 0.80 },
      { slot: "want", status: "missing", confidence: 0.0 },
      // Provide other slots to avoid undefined
      { slot: "moment_destination", status: "covered", confidence: 0.75 },
      { slot: "ending_feel", status: "covered", confidence: 0.75 },
      { slot: "turn", status: "covered", confidence: 0.75 },
      { slot: "stakes", status: "covered", confidence: 0.75 },
    ],
  };

  const elements = computeStoryElements(gapAnalysis);
  const bond = elements.find(el => el.id === "bond");

  // max(0.80, 0.75*0.80 + 0.25*0.0) = max(0.80, 0.60) = 0.80
  assert.equal(bond.strength, 0.80);
  // Primary alone (0.80) passes threshold (0.70) — bonus missing doesn't hurt
  assert.ok(bond.strength >= ELEMENT_CONFIRM_THRESHOLD);
});

test("getElementConfirmBlock blocks when required element < 70%", () => {
  const elements = [
    { id: "setting", strength: 0.85, is_required: true, display_name: "The Setting" },
    { id: "feeling", strength: 0.35, is_required: true, display_name: "The Feeling" },
    { id: "bond", strength: 0.90, is_required: true, display_name: "Your Bond" },
    { id: "moment", strength: 0.05, is_required: false, display_name: "The Moment" },
    { id: "details", strength: 0.35, is_required: false, display_name: "The Details" },
  ];

  const result = getElementConfirmBlock(elements);
  assert.equal(result.hasElementBlock, true);
  assert.deepEqual(result.blockedElements, ["feeling"]);
  assert.equal(result.weakestElement.id, "feeling");
});

test("getElementConfirmBlock passes when all required >= 70%", () => {
  const elements = [
    { id: "setting", strength: 0.75, is_required: true, display_name: "The Setting" },
    { id: "feeling", strength: 0.80, is_required: true, display_name: "The Feeling" },
    { id: "bond", strength: 0.70, is_required: true, display_name: "Your Bond" },
    { id: "moment", strength: 0.05, is_required: false, display_name: "The Moment" },
    { id: "details", strength: 0.10, is_required: false, display_name: "The Details" },
  ];

  const result = getElementConfirmBlock(elements);
  assert.equal(result.hasElementBlock, false);
  assert.deepEqual(result.blockedElements, []);
  assert.equal(result.weakestElement, null);
});

test("resolveTurnDecision blocks CONFIRM on element threshold", () => {
  const state = createInitialState({
    recipientName: "Ada",
    occasion: "birthday",
    initialPrompt: "seed",
  });
  state.narrative = "We met in Lagos last December and it changed everything.";
  state.narrative_current = state.narrative;
  state.atoms = {
    ...state.atoms,
    who: "my sister Ada",
    where: "Lagos",
    when: "last December",
    // No ending_feel/tone → feeling element will be weak
  };
  state.primitives = {
    ...state.primitives,
    characters: [{ name: "Ada", role: "sister", desire: "to reconnect" }],
    setting: { place: "Lagos", time: "last December", atmosphere: "", sensory_tags: [] },
  };
  state.last_reasoning = {
    story_readiness: { has_emotional_depth: true, strong_elements: ["moment"], weak_elements: [] },
    user_state: { seems_done: true },
  };

  const resolution = v3.__internal.resolveTurnDecision(
    { action: "CONFIRM", confirmation: "Ready.", narrative: state.narrative },
    state
  );

  // Should block because feeling element is below 70%
  assert.equal(resolution.response.action, "CLARIFY");
  assert.equal(resolution.elementBlock, true);
  assert.ok(resolution.blockedElements.length > 0);
});

test("resolveTurnDecision allows CONFIRM when all required elements pass", () => {
  const state = buildReadyReflectiveState();

  const resolution = v3.__internal.resolveTurnDecision(
    { action: "CONFIRM", confirmation: "Ready.", narrative: state.narrative },
    state
  );

  assert.equal(resolution.response.action, "CONFIRM");
  assert.equal(resolution.elementBlock, false);
  assert.deepEqual(resolution.blockedElements, []);
});

test("optional element below threshold does not block CONFIRM", () => {
  const state = buildReadyReflectiveState();
  // Clear stakes so details element is weak, but it's optional
  delete state.atoms.stakes;

  const resolution = v3.__internal.resolveTurnDecision(
    { action: "CONFIRM", confirmation: "Ready.", narrative: state.narrative },
    state
  );

  // Should still CONFIRM — details is optional
  assert.equal(resolution.response.action, "CONFIRM");
  const detailsEl = resolution.elements.find(el => el.id === "details");
  assert.ok(detailsEl.strength < ELEMENT_CONFIRM_THRESHOLD);
  assert.equal(resolution.elementBlock, false);
});

test("getTurnProgressScore uses weighted average from elements", () => {
  const gapAnalysis = {
    slots: [
      { slot: "moment_destination", status: "covered", confidence: 0.80 },
      { slot: "ending_feel", status: "covered", confidence: 0.80 },
      { slot: "tone", status: "covered", confidence: 0.80 },
      { slot: "who", status: "covered", confidence: 0.80 },
      { slot: "want", status: "covered", confidence: 0.80 },
      { slot: "turn", status: "missing", confidence: 0.05 },
      { slot: "blocker", status: "missing", confidence: 0.05 },
      { slot: "stakes", status: "missing", confidence: 0.05 },
    ],
  };

  const elements = computeStoryElements(gapAnalysis);
  const score = v3.__internal.getTurnProgressScore({}, gapAnalysis, "ASK", elements);

  // Required: setting=0.80, feeling=max(0.80, 0.75*0.80+0.25*0.80)=0.80, bond=max(0.80, 0.75*0.80+0.25*0.80)=0.80
  // Optional: moment=max(0.05, 0.75*0.05+0.25*0.05)=0.05, details=0.05
  // Weighted: (0.80*2 + 0.80*2 + 0.80*2 + 0.05*1 + 0.05*1) / (2+2+2+1+1) = 4.90/8 = 0.6125
  assert.equal(score, 61);

  // CONFIRM/STOP actions floor at 90
  const confirmScore = v3.__internal.getTurnProgressScore({}, gapAnalysis, "CONFIRM", elements);
  assert.ok(confirmScore >= 90);
});

test("exhaustion escape overrides element block", () => {
  const state = createInitialState({
    recipientName: "Ada",
    occasion: "birthday",
    initialPrompt: "seed",
  });
  state.narrative = "We met in Lagos last December and it changed everything. My sister Ada always stepped up.";
  state.narrative_current = state.narrative;
  state.atoms = {
    ...state.atoms,
    who: "my sister Ada",
    where: "Lagos",
    when: "last December",
    turn: "she called from the hospital parking lot",
    stakes: "we might never speak again",
    // No ending_feel/after → feeling element weak, but moment_destination covered
  };
  state.primitives = {
    ...state.primitives,
    characters: [{ name: "Ada", role: "sister", desire: "to reconnect" }],
    setting: { place: "Lagos", time: "last December", atmosphere: "", sensory_tags: [] },
    turning_point: "she called from the hospital parking lot",
    conflict: { internal: "years of silence between us" },
  };
  state.dials = { ...state.dials, tone: "gentle" };
  state.last_reasoning = {
    story_readiness: { has_emotional_depth: true, strong_elements: ["moment"], weak_elements: [] },
    user_state: { seems_done: true },
  };
  // Simulate MAX asks on the gap question's target slot (ending_feel is top priority
  // since moment_destination is covered, so gap question targets ending_feel).
  // tone is covered via dials so no alternate exists after repeat-escape prunes ending_feel.
  state.gap_history = [
    { slot: "ending_feel", turn: 1, timestamp: new Date().toISOString() },
    { slot: "ending_feel", turn: 2, timestamp: new Date().toISOString() },
  ];

  const resolution = v3.__internal.resolveTurnDecision(
    { action: "CONFIRM", confirmation: "Ready.", narrative: state.narrative },
    state
  );

  assert.equal(resolution.response.action, "CONFIRM");
  assert.equal(resolution.decisionSource, "exhaustion_escape");
  assert.equal(resolution.forcedConfirm, true);
});

test("element block fallback prompt names weakest element", () => {
  const state = createInitialState({
    recipientName: "Ada",
    occasion: "birthday",
    initialPrompt: "seed",
  });
  state.narrative = "We met in Lagos last December. She is my sister.";
  state.narrative_current = state.narrative;
  state.atoms = {
    ...state.atoms,
    who: "my sister Ada",
    where: "Lagos",
    when: "last December",
  };
  state.primitives = {
    ...state.primitives,
    characters: [{ name: "Ada", role: "sister", desire: "to reconnect" }],
    setting: { place: "Lagos", time: "last December", atmosphere: "", sensory_tags: [] },
  };
  state.last_reasoning = {
    story_readiness: { has_emotional_depth: true, strong_elements: [], weak_elements: [] },
    user_state: { seems_done: true },
  };

  const resolution = v3.__internal.resolveTurnDecision(
    { action: "CONFIRM", confirmation: "Ready.", narrative: state.narrative },
    state
  );

  // When gap question template is available, it's used instead of element fallback.
  // But the element block is still active.
  assert.equal(resolution.response.action, "CLARIFY");
  assert.equal(resolution.elementBlock, true);
  assert.ok(resolution.blockedElements.length > 0);
});

test("toConfidence range: covered starts at 0.75, weak at 0.35, missing at 0.05", () => {
  // Test indirectly through computeStoryGapAnalysis
  const { computeStoryGapAnalysis } = v3.__internal.quality;

  // Build a minimal state with clear slot statuses
  const state = createInitialState({
    recipientName: "Ada",
    occasion: "birthday",
    initialPrompt: "seed",
  });
  state.narrative = "Nothing here.";
  state.narrative_current = state.narrative;

  const gapAnalysis = computeStoryGapAnalysis(state);

  // All slots should have confidence values in expected ranges
  for (const slot of gapAnalysis.slots || []) {
    if (slot.status === "covered") {
      assert.ok(slot.confidence >= 0.75, `Covered slot ${slot.slot} has confidence ${slot.confidence} < 0.75`);
      assert.ok(slot.confidence <= 0.95, `Covered slot ${slot.slot} has confidence ${slot.confidence} > 0.95`);
    } else if (slot.status === "weak") {
      assert.ok(slot.confidence >= 0.35, `Weak slot ${slot.slot} has confidence ${slot.confidence} < 0.35`);
      assert.ok(slot.confidence <= 0.55, `Weak slot ${slot.slot} has confidence ${slot.confidence} > 0.55`);
    } else if (slot.status === "missing") {
      assert.ok(slot.confidence >= 0.05, `Missing slot ${slot.slot} has confidence ${slot.confidence} < 0.05`);
      assert.ok(slot.confidence <= 0.05, `Missing slot ${slot.slot} has confidence ${slot.confidence} > 0.05`);
    }
  }
});
