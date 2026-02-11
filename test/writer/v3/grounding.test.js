const test = require("node:test");
const assert = require("node:assert/strict");

const { isStateGrounded } = require("../../../src/writer/v3/state");

function buildState({ narrative, facts }) {
  return {
    narrative,
    facts,
  };
}

test("isStateGrounded accepts paraphrased but evidence-grounded narrative", () => {
  const state = buildState({
    narrative:
      "In that hospital hallway before surgery, she squeezed my hand and told me we would survive this night together.",
    facts: [
      {
        id: "f1",
        text: "We waited in the hospital corridor before surgery.",
        status: "active",
      },
      {
        id: "f2",
        text: "She squeezed my hand and said we would get through it.",
        status: "active",
      },
    ],
  });

  assert.equal(isStateGrounded(state), true);
});

test("isStateGrounded rejects narrative with mostly ungrounded content", () => {
  const state = buildState({
    narrative:
      "He took me camping in snowy mountains and we built a fire under northern lights before sunrise.",
    facts: [
      {
        id: "f1",
        text: "He taught me to fish at the lake behind our house.",
        status: "active",
      },
    ],
  });

  assert.equal(isStateGrounded(state), false);
});

test("isStateGrounded keeps empty narrative grounded", () => {
  const state = buildState({
    narrative: "",
    facts: [],
  });

  assert.equal(isStateGrounded(state), true);
});
