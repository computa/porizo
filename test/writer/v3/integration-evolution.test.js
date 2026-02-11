const test = require("node:test");
const assert = require("node:assert/strict");

const { createInitialState } = require("../../../src/writer/v3/state");
const { applyReasoningResult } = require("../../../src/writer/v3/engine");

function buildState(overrides = {}) {
  return {
    ...createInitialState({
      recipientName: "Emeka",
      occasion: "birthday",
      initialPrompt: "I want to tell his story properly.",
    }),
    turn_count: 1,
    ...overrides,
  };
}

test("applyReasoningResult supersedes weaker fact and versions rewritten narrative", () => {
  const state = buildState({
    narrative: "In 2019 we met at a cafe.",
    narrative_current: "In 2019 we met at a cafe.",
    narrative_version: 1,
    narrative_revisions: [
      {
        version: 1,
        turn: 1,
        narrative: "In 2019 we met at a cafe.",
      },
    ],
    facts: [
      {
        id: "f_old_scene",
        text: "We met at a cafe in 2019.",
        beat: "scene",
        source_turn: 1,
        status: "active",
      },
    ],
  });

  const reasoningResult = {
    action: "ASK",
    updates: {
      narrative_mode: "rewritten",
      narrative:
        "In 2019 we met at a tiny cafe in Lagos after I missed my bus, and from that day I knew his kindness would stay with me.",
      new_facts: [
        {
          text: "We met at a tiny cafe in Lagos in 2019 after I missed my bus.",
          beat: "scene",
        },
      ],
    },
  };

  const next = applyReasoningResult(state, reasoningResult, "It was a tiny cafe in Lagos after I missed my bus.");

  const activeFacts = next.facts.filter((fact) => (fact.status || "active") === "active");
  const superseded = next.facts.find((fact) => fact.id === "f_old_scene");

  assert.equal(next.narrative_current.includes("tiny cafe in Lagos"), true);
  assert.equal(next.narrative_version, 2);
  assert.ok(superseded, "previous fact should still exist for audit");
  assert.equal(superseded.status, "superseded");
  assert.ok(activeFacts.some((fact) => fact.text.includes("tiny cafe in Lagos")));
  assert.ok(next.last_integration_delta.added_facts.length >= 1);
  assert.ok(next.last_integration_delta.superseded_facts.includes("f_old_scene"));
});

test("applyReasoningResult recomposes when model narrative ignores new turn detail", () => {
  const state = buildState({
    narrative: "I kept thinking about that day.",
    narrative_current: "I kept thinking about that day.",
    narrative_version: 1,
    facts: [
      {
        id: "f_prior",
        text: "We were both exhausted before the exam day.",
        beat: "context",
        source_turn: 1,
        status: "active",
      },
    ],
  });

  const reasoningResult = {
    action: "ASK",
    updates: {
      narrative_mode: "rewritten",
      narrative: "I kept thinking about that day.",
      new_facts: [
        {
          text: "She squeezed my hand and gave me her silver bracelet right before we walked in.",
          beat: "moment",
        },
      ],
    },
  };

  const next = applyReasoningResult(
    state,
    reasoningResult,
    "She squeezed my hand and gave me her silver bracelet right before we walked in."
  );

  assert.equal(next.narrative_current.includes("silver bracelet"), true);
  assert.equal(next.last_integration_delta.narrative_rewritten, true);
  assert.ok(next.integration_history.length >= 1);
});

test("applyReasoningResult records conflict when contradictory facts arrive", () => {
  const state = buildState({
    narrative: "I waited for his call that night.",
    narrative_current: "I waited for his call that night.",
    facts: [
      {
        id: "f_conflict_old",
        text: "He could not call back because he was afraid.",
        beat: "stakes",
        source_turn: 1,
        status: "active",
      },
    ],
  });

  const reasoningResult = {
    action: "ASK",
    updates: {
      narrative_mode: "rewritten",
      narrative: "I waited for his call that night and eventually he called back once he felt ready.",
      new_facts: [
        {
          text: "He did call back because he felt ready.",
          beat: "stakes",
        },
      ],
    },
  };

  const next = applyReasoningResult(state, reasoningResult, "He did call back because he felt ready.");

  assert.ok(next.last_integration_delta.conflicts_detected.length >= 1);
  assert.ok(Array.isArray(next.open_conflicts));
  assert.ok(next.open_conflicts.length >= 1);
});
