const test = require("node:test");
const assert = require("node:assert/strict");

const { enforceGrounding } = require("../../../src/writer/v3/engine");

function makeState(overrides = {}) {
  return {
    turn_count: 1,
    narrative: "",
    narrative_current: "",
    facts: [],
    ...overrides,
  };
}

test("enforceGrounding soft-accepts moderately ungrounded first-turn narrative", () => {
  const state = makeState({
    turn_count: 1,
    narrative:
      "In the hospital corridor, she squeezed my hand while silence, thunder, and miracles collided.",
    narrative_current:
      "In the hospital corridor, she squeezed my hand while silence, thunder, and miracles collided.",
    facts: [
      {
        id: "f1",
        text: "We stood in the hospital corridor before surgery.",
        status: "active",
      },
      {
        id: "f2",
        text: "She squeezed my hand before they wheeled him in.",
        status: "active",
      },
    ],
  });

  const next = enforceGrounding(state);

  assert.equal(next.grounding_enforced, undefined);
  assert.equal(next.narrative, state.narrative);
  assert.equal(next.grounding_assessment?.mode, "soft_accept_turn1");
  assert.ok(next.grounding_assessment?.coverage >= 0.4);
});

test("enforceGrounding still rebuilds severely ungrounded narrative", () => {
  const state = makeState({
    turn_count: 2,
    narrative:
      "He took me camping in snowy mountains where we built a fire under northern lights at dawn.",
    narrative_current:
      "He took me camping in snowy mountains where we built a fire under northern lights at dawn.",
    facts: [
      {
        id: "f1",
        text: "He taught me to fish by our neighborhood lake.",
        status: "active",
      },
    ],
  });

  const next = enforceGrounding(state);

  assert.equal(next.grounding_enforced, true);
  assert.equal(next.grounding_assessment?.mode, "rebuilt_from_facts");
  assert.notEqual(next.narrative_current, state.narrative_current);
});

test("enforceGrounding soft-accepts moderately ungrounded second-turn narrative", () => {
  const state = makeState({
    turn_count: 2,
    narrative:
      "In the hospital corridor in Lagos, I held Emeka's hand while the monitor kept beeping, but inside I was drowning in destiny, galaxies, prophecy, cathedrals, and thunderous shadows.",
    narrative_current:
      "In the hospital corridor in Lagos, I held Emeka's hand while the monitor kept beeping, but inside I was drowning in destiny, galaxies, prophecy, cathedrals, and thunderous shadows.",
    facts: [
      {
        id: "f1",
        text: "We waited in the hospital corridor in Lagos before surgery.",
        status: "active",
      },
      {
        id: "f2",
        text: "I held Emeka's hand while the monitor kept beeping.",
        status: "active",
      },
      {
        id: "f3",
        text: "I promised we would keep fighting through the night.",
        status: "active",
      },
    ],
  });

  const next = enforceGrounding(state);

  assert.equal(next.grounding_enforced, undefined);
  assert.equal(next.narrative, state.narrative);
  assert.equal(next.grounding_assessment?.mode, "soft_accept_turn2");
  assert.ok(next.grounding_assessment?.coverage >= 0.3);
  assert.ok(next.grounding_assessment?.matched >= 4);
});
