const test = require("node:test");
const assert = require("node:assert/strict");

const v3 = require("../../../src/writer/v3");
const { createInitialState } = require("../../../src/writer/v3/state");

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
