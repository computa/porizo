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
  };
  state.primitives = {
    ...state.primitives,
    characters: [{ name: "Ada", role: "sister", desire: "to reconnect" }],
    setting: { place: "Lagos", time: "last December", atmosphere: "", sensory_tags: [] },
    turning_point: "she called from the hospital parking lot",
    resolution: "we ended hopeful and grateful",
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
