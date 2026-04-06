const test = require("node:test");
const assert = require("node:assert/strict");

const v3 = require("../../../src/writer/v3");
const { createInitialState } = require("../../../src/writer/v3/state");
const { buildGapTargeting } = require("../../../src/writer/v3/prompts/builder");

function buildReadyReflectiveState() {
  let state = createInitialState({
    recipientName: "Ada",
    occasion: "custom",
    initialPrompt: "Story seed",
  });
  state.narrative = "My sister Ada and I met in Lagos last December. I wanted us to reconnect. Then she called from the hospital parking lot and everything changed. We ended feeling hopeful and grateful.";
  state.narrative_current = state.narrative;
  state.turn_count = 3;
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
  state = v3.__internal.hydrateStoryState(state);
  return state;
}

// --- Option C: LLM-Trusting Decision Tests ---

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
});

test("resolveTurnDecision trusts LLM CONFIRM even with weak slots (Option C)", () => {
  const state = buildReadyReflectiveState();
  // Remove some atoms to create gaps — Option C trusts LLM anyway
  delete state.atoms.where;
  delete state.atoms.when;
  state.primitives.setting = { place: "", time: "", atmosphere: "", sensory_tags: [] };

  const resolution = v3.__internal.resolveTurnDecision(
    {
      action: "CONFIRM",
      confirmation: "Ready to finalize.",
      narrative: state.narrative,
    },
    state
  );

  // Option C: LLM says CONFIRM, quality gates pass (turn >= 2, narrative long, facts >= 2)
  assert.equal(resolution.response.action, "CONFIRM");
  // Analytics still computed — critical slot IS weak, but doesn't block
  assert.equal(resolution.criticalSlotBlock, true);
});

test("resolveTurnDecision downgrades CONFIRM to ASK when story too thin", () => {
  const state = createInitialState({
    recipientName: "Ada",
    occasion: "birthday",
    initialPrompt: "seed",
  });
  state.narrative = "Short.";
  state.narrative_current = state.narrative;
  state.turn_count = 0;
  state.last_reasoning = {
    story_readiness: { has_emotional_depth: false, strong_elements: [], weak_elements: [] },
    user_state: { seems_done: true },
  };

  const resolution = v3.__internal.resolveTurnDecision(
    {
      action: "CONFIRM",
      confirmation: "Ready.",
      narrative: state.narrative,
      question: "Tell me more about Ada.",
    },
    state
  );

  // Quality gate: too early (turn 0), too thin (< 100 chars), too few facts
  // Downgrade to ASK — uses LLM's question since it has one
  assert.equal(resolution.response.action, "ASK");
  assert.equal(resolution.response.question, "Tell me more about Ada.");
});

test("resolveTurnDecision replaces off-target LLM ASK question with targeted fallback", () => {
  const state = buildReadyReflectiveState();
  state.turn_count = 1;
  state.narrative = "My sister Ada and I met in Lagos last December. I wanted us to reconnect. Then she called from the hospital parking lot and everything changed.";
  state.narrative_current = state.narrative;
  state.atoms.after = "";
  state.primitives.resolution = "";

  const resolution = v3.__internal.resolveTurnDecision(
    {
      action: "ASK",
      question: "What tone should the story have?",
      narrative: state.narrative,
      targetSlot: "ending_feel",
    },
    state
  );

  assert.equal(resolution.response.action, "ASK");
  assert.notEqual(resolution.response.question, "What tone should the story have?");
  assert.equal(resolution.forcedGapQuestion, true);
  assert.equal(resolution.decisionSource, "llm_off_target_fallback");
});

test("resolveTurnDecision soft-passes grounded LLM question without targetSlot", () => {
  const state = buildReadyReflectiveState();
  state.turn_count = 1;
  state.narrative = "My sister Ada and I met in Lagos last December. I wanted us to reconnect. Then she called from the hospital parking lot and everything changed.";
  state.narrative_current = state.narrative;
  state.atoms.after = "";
  state.primitives.resolution = "";

  const resolution = v3.__internal.resolveTurnDecision(
    {
      action: "ASK",
      question: "When you think about the hospital parking lot call, what part of it still stays with you?",
      narrative: state.narrative,
      // No targetSlot at all
    },
    state
  );

  assert.equal(resolution.response.action, "ASK");
  assert.equal(resolution.response.question, "When you think about the hospital parking lot call, what part of it still stays with you?");
  assert.equal(resolution.decisionSource, "llm_soft_pass");
});

test("resolveTurnDecision uses gap fallback when LLM ASK has no question", () => {
  const state = buildReadyReflectiveState();
  state.turn_count = 1;

  const resolution = v3.__internal.resolveTurnDecision(
    {
      action: "ASK",
      narrative: state.narrative,
      // No question provided
    },
    state
  );

  assert.equal(resolution.response.action, "ASK");
  assert.ok(resolution.response.question.length > 0);
  assert.equal(resolution.forcedGapQuestion, true);
  assert.equal(resolution.decisionSource, "llm_missing_question_fallback");
});

test("resolveTurnDecision avoids re-asking an already answered element when another target exists", () => {
  const state = buildReadyReflectiveState();
  state.turn_count = 2;
  delete state.atoms.where;
  delete state.atoms.when;
  delete state.atoms.who;
  state.primitives.setting = { place: "", time: "", atmosphere: "", sensory_tags: [] };
  state.primitives.characters = [];
  state.flags = { labov_scoring: true };
  state.story_state = {
    questionsAsked: [
      {
        round: 1,
        question: "How did that make you feel at the time?",
        targetElement: "evaluation",
        answered: true,
        answerSummary: "It made me feel grateful and seen.",
      },
    ],
  };

  const resolution = v3.__internal.resolveTurnDecision(
    {
      action: "ASK",
      question: "How did that make you feel now?",
      narrative: state.narrative,
      targetSlot: "ending_feel",
    },
    state,
    { userMessage: "She called from the hospital parking lot and everything changed." }
  );

  assert.equal(resolution.response.action, "ASK");
  assert.notEqual(resolution.response.question, "How did that make you feel now?");
  assert.equal(resolution.forcedGapQuestion, true);
  assert.equal(resolution.decisionSource, "llm_off_target_fallback");
});

test("resolveTurnDecision confirms instead of circling the same answered element when story is already materially complete", () => {
  const state = buildReadyReflectiveState();
  state.turn_count = 5;
  state.facts = [
    ...state.facts,
    { id: "f3", text: "We had not spoken honestly in years.", status: "active" },
    { id: "f4", text: "That call made me feel hopeful and deeply grateful.", status: "active" },
    { id: "f5", text: "It changed how I saw our relationship.", status: "active" },
  ];
  state.story_state = {
    questionsAsked: [
      {
        round: 1,
        question: "How did that make you feel at the time?",
        targetElement: "evaluation",
        answered: true,
        answerSummary: "It made me feel grateful and seen in a way I had not felt for years.",
      },
      {
        round: 2,
        question: "What does that moment mean to you now?",
        targetElement: "evaluation",
        answered: true,
        answerSummary: "It means we finally found our way back to each other and I still carry that relief.",
      },
    ],
  };

  const resolution = v3.__internal.resolveTurnDecision(
    {
      action: "ASK",
      question: "What does that hospital parking lot call still mean to you now?",
      narrative: state.narrative,
      targetSlot: "ending_feel",
    },
    state,
    { userMessage: "It still feels like the moment our relationship came back to life." }
  );

  assert.equal(resolution.response.action, "CONFIRM");
  assert.equal(resolution.decisionSource, "forward_progress_confirm");
  assert.equal(resolution.repeatEscapeApplied, true);
  assert.match(resolution.response.confirmation, /ready/i);
});

test("resolveTurnDecision penalizes sufficiently answered elements and exposes target selection reasons", () => {
  const state = buildReadyReflectiveState();
  state.turn_count = 4;
  state.flags = { labov_scoring: true };
  delete state.atoms.where;
  delete state.atoms.when;
  delete state.atoms.who;
  state.primitives.setting = { place: "", time: "", atmosphere: "", sensory_tags: [] };
  state.primitives.characters = [];
  state.story_state = {
    questionsAsked: [
      {
        round: 1,
        question: "How did that make you feel at the time?",
        targetElement: "evaluation",
        answered: true,
        answerSummary: "It made me feel grateful and seen in a way I had not felt for years, and I still carry that relief with me.",
      },
      {
        round: 2,
        question: "What does that moment mean to you now?",
        targetElement: "evaluation",
        answered: true,
        answerSummary: "It means we found our way back to each other, and that healing changed how I think about our relationship.",
      },
    ],
  };

  const resolution = v3.__internal.resolveTurnDecision(
    {
      action: "ASK",
      question: "What does that hospital parking lot call still mean to you now?",
      narrative: state.narrative,
      targetSlot: "ending_feel",
    },
    state,
    { userMessage: "It still feels like the moment our relationship came back to life." }
  );

  assert.match(resolution.decisionSource, /^forward_progress_/);
  assert.equal(resolution.targetElement, "orientation");
  assert.equal(resolution.targetDecision?.winner?.element, "orientation");
  assert.match(resolution.targetDecision?.winner?.reason || "", /missingSlots=\d+/);
  assert.ok(
    resolution.targetDecision?.alternatives?.some((candidate) =>
      candidate.element === "evaluation" && /sufficientAnswers=2/.test(candidate.reason)
    )
  );
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
  assert.equal(resolution.decisionSource, "safety_block");
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
  assert.equal(resolution.decisionSource, "grounding_block");
});

test("resolveTurnDecision passes through STOP action", () => {
  const state = buildReadyReflectiveState();

  const resolution = v3.__internal.resolveTurnDecision(
    { action: "STOP", narrative: state.narrative },
    state
  );

  assert.equal(resolution.response.action, "STOP");
  assert.equal(resolution.decisionSource, "user_stop");
});

test("resolveTurnDecision preserves LLM suggestions when question not overridden", () => {
  const state = buildReadyReflectiveState();
  state.turn_count = 1;
  const suggestions = ["She was always there", "The way she smiles", "When she called"];

  const resolution = v3.__internal.resolveTurnDecision(
    {
      action: "ASK",
      question: "How did Ada's hospital parking lot call make you feel?",
      narrative: state.narrative,
      targetSlot: "ending_feel",
      suggestions,
    },
    state
  );

  assert.equal(resolution.response.action, "ASK");
  assert.deepEqual(resolution.llmSuggestions, suggestions);
});

test("safety block overrides even in revision mode", () => {
  const state = buildReadyReflectiveState();
  state.last_reasoning = { safety: { requires_refusal: true } };

  const resolution = v3.__internal.resolveTurnDecision(
    { action: "ASK", question: "Bad question", narrative: state.narrative },
    state,
    { inputMode: "revision" }
  );

  assert.equal(resolution.response.action, "CLARIFY");
  assert.equal(resolution.decisionSource, "safety_block");
  assert.deepEqual(resolution.llmSuggestions, []);
});

// --- Builder Gap Targeting Tests (unchanged — analytics still work) ---

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
  assert.ok(result.includes("You MUST target exactly this slot"));
  assert.ok(result.includes("Visible Story Strength focus: The Setting"));
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

// --- Story Element Analytics Tests (unchanged — computation still works) ---

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
  assert.equal(elements[0].strength, 0.85);
  assert.equal(elements[0].is_required, true);
  assert.equal(elements[0].display_name, "The Setting");
  assert.equal(elements[2].strength, 0.90);
  assert.equal(elements[4].strength, 0.35);
  assert.equal(elements[4].is_required, false);
});

test("bonus slot only helps, never hurts element score", () => {
  const gapAnalysis = {
    slots: [
      { slot: "who", status: "covered", confidence: 0.80 },
      { slot: "want", status: "missing", confidence: 0.0 },
      { slot: "moment_destination", status: "covered", confidence: 0.75 },
      { slot: "ending_feel", status: "covered", confidence: 0.75 },
      { slot: "turn", status: "covered", confidence: 0.75 },
      { slot: "stakes", status: "covered", confidence: 0.75 },
    ],
  };

  const elements = computeStoryElements(gapAnalysis);
  const bond = elements.find(el => el.id === "bond");
  assert.equal(bond.strength, 0.80);
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

test("element analytics still computed even though they don't block (Option C)", () => {
  const state = createInitialState({
    recipientName: "Ada",
    occasion: "birthday",
    initialPrompt: "seed",
  });
  state.narrative = "We met in Lagos last December and it changed everything. My sister Ada was always the one who held the family together through thick and thin.";
  state.narrative_current = state.narrative;
  state.turn_count = 3;
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
  state.facts = [
    { id: "f1", text: "We met in Lagos last December.", status: "active" },
    { id: "f2", text: "It changed everything.", status: "active" },
  ];
  state.last_reasoning = {
    story_readiness: { has_emotional_depth: true, strong_elements: ["moment"], weak_elements: [] },
    user_state: { seems_done: true },
  };

  const resolution = v3.__internal.resolveTurnDecision(
    { action: "CONFIRM", confirmation: "Ready.", narrative: state.narrative },
    state
  );

  // Option C: CONFIRM is allowed (quality gates pass)
  assert.equal(resolution.response.action, "CONFIRM");
  // But analytics still show element block would have fired
  assert.equal(resolution.elementBlock, true);
  assert.ok(resolution.blockedElements.length > 0);
  // Elements and gap analysis are still present for progress UI
  assert.ok(Array.isArray(resolution.elements));
  assert.ok(resolution.elements.length === 5);
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
  assert.equal(score, 61);

  const confirmScore = v3.__internal.getTurnProgressScore({}, gapAnalysis, "CONFIRM", elements);
  assert.ok(confirmScore >= 90);
});

test("CONFIRM downgrade without LLM question uses gap fallback", () => {
  const state = createInitialState({
    recipientName: "Ada",
    occasion: "birthday",
    initialPrompt: "seed",
  });
  state.narrative = "Short.";
  state.narrative_current = state.narrative;
  state.turn_count = 0;

  const resolution = v3.__internal.resolveTurnDecision(
    { action: "CONFIRM", confirmation: "Ready.", narrative: state.narrative },
    state
  );

  // Quality gate fails (too early, too thin, too few facts) — no LLM question available
  assert.equal(resolution.response.action, "ASK");
  assert.ok(resolution.response.question.length > 0);
  assert.equal(resolution.forcedGapQuestion, true);
  assert.ok(resolution.decisionSource.includes("fallback"));
});

test("quality gate boundary: turn_count=2 passes, turn_count=1 fails", () => {
  const state = buildReadyReflectiveState();
  state.turn_count = 2;

  const passes = v3.__internal.resolveTurnDecision(
    { action: "CONFIRM", confirmation: "Ready.", narrative: state.narrative },
    state
  );
  assert.equal(passes.response.action, "CONFIRM");

  state.turn_count = 1;
  const fails = v3.__internal.resolveTurnDecision(
    { action: "CONFIRM", confirmation: "Ready.", narrative: state.narrative, question: "More?" },
    state
  );
  assert.equal(fails.response.action, "ASK");
});

test("quality gate boundary: narrative 100 chars passes, 99 fails", () => {
  const state = buildReadyReflectiveState();
  state.turn_count = 3;
  state.facts = [
    { id: "f1", text: "Fact one.", status: "active" },
    { id: "f2", text: "Fact two.", status: "active" },
  ];

  // 100 chars passes
  state.narrative = "x".repeat(100);
  state.narrative_current = state.narrative;
  const passes = v3.__internal.resolveTurnDecision(
    { action: "CONFIRM", confirmation: "Ready.", narrative: state.narrative },
    state
  );
  assert.equal(passes.response.action, "CONFIRM");

  // 99 chars fails
  state.narrative = "x".repeat(99);
  state.narrative_current = state.narrative;
  const fails = v3.__internal.resolveTurnDecision(
    { action: "CONFIRM", confirmation: "Ready.", narrative: state.narrative, question: "More?" },
    state
  );
  assert.equal(fails.response.action, "ASK");
});

test("whitespace-only question treated as no question", () => {
  const state = buildReadyReflectiveState();
  state.turn_count = 1;

  const resolution = v3.__internal.resolveTurnDecision(
    { action: "ASK", question: "   ", narrative: state.narrative },
    state
  );

  // Whitespace trimmed → treated as missing question → fallback
  assert.equal(resolution.response.action, "ASK");
  assert.notEqual(resolution.response.question.trim(), "");
  assert.equal(resolution.forcedGapQuestion, true);
});

test("toConfidence range: covered starts at 0.75, weak at 0.35, missing at 0.05", () => {
  const { computeStoryGapAnalysis } = v3.__internal.quality;

  const state = createInitialState({
    recipientName: "Ada",
    occasion: "birthday",
    initialPrompt: "seed",
  });
  state.narrative = "Nothing here.";
  state.narrative_current = state.narrative;

  const gapAnalysis = computeStoryGapAnalysis(state);

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
