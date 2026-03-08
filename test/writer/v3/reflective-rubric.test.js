const test = require("node:test");
const assert = require("node:assert/strict");

const { createInitialState } = require("../../../src/writer/v3/state");
const {
  computeStoryGapAnalysis,
  computeStoryElements,
  getElementConfirmBlock,
  pickDeterministicGapQuestion,
} = require("../../../src/writer/v3/quality");

function buildReflectiveTributeState() {
  const state = createInitialState({
    recipientName: "Amaka",
    occasion: "mothers-day",
    initialPrompt: "seed",
  });

  state.narrative = [
    "Amaka, today I celebrate you for the mother you are and for the love you pour so selflessly into your family.",
    "Motherhood is not an easy calling, but you carry it with strength, patience, and grace.",
    "In the countless things you do every day, both seen and unseen, you are shaping lives, building a home, and giving your children something priceless.",
    "Your sacrifices are often hidden inside ordinary days, a quiet weight that deserves to be honoured.",
    "Know that all you do matters, and the love you give leaves a mark that will live far beyond today.",
  ].join(" ");
  state.narrative_current = state.narrative;
  state.atoms = {
    ...state.atoms,
    who: "my wife Amaka",
    where: "at home",
    when: "every day",
    action: "you keep the home steady and carry the children with patience",
    after: "deeply grateful and honoured",
    stakes: "",
    turn: "",
    secret: "",
  };
  state.primitives = {
    ...state.primitives,
    characters: [{ name: "Amaka", role: "wife", desire: "to keep the family steady" }],
    setting: {
      place: "at home",
      time: "every day",
      atmosphere: "",
      sensory_tags: [],
    },
    resolution: "deeply grateful and honoured",
    turning_point: "",
  };
  state.beats = [
    { id: "scene", strength: 0.72 },
    { id: "meaning", strength: 0.82 },
    { id: "moment", strength: 0.42 },
  ];
  state.facts = [
    { id: "f1", text: "Amaka carries the family with strength, patience, and grace.", status: "active" },
    { id: "f2", text: "She keeps the home steady every day in ways people do not always see.", status: "active" },
    { id: "f3", text: "Her love gives the children warmth, structure, and security.", status: "active" },
  ];

  return state;
}

test("reflective tribute stories do not default to blocker questions", () => {
  const gapAnalysis = computeStoryGapAnalysis(buildReflectiveTributeState());
  const question = pickDeterministicGapQuestion(gapAnalysis);

  assert.equal(gapAnalysis.storyMode, "reflective_tribute");
  assert.ok(question, "expected a deterministic follow-up question");
  assert.notEqual(question.targetSlot, "blocker");
  assert.notEqual(question.targetSlot, "stakes");
  assert.ok(
    !question.prompt.includes("made this harder"),
    `expected a non-blocker prompt, got: ${question.prompt}`
  );
});

test("reflective tribute stories score bond, moment, and details from appreciation-specific evidence", () => {
  const gapAnalysis = computeStoryGapAnalysis(buildReflectiveTributeState());
  const elements = computeStoryElements(gapAnalysis);
  const byId = new Map(elements.map((element) => [element.id, element]));
  const elementBlock = getElementConfirmBlock(elements);

  assert.equal(gapAnalysis.storyMode, "reflective_tribute");
  assert.ok((byId.get("bond")?.strength || 0) >= 0.75, "bond should read as strong in tribute stories");
  assert.ok((byId.get("moment")?.strength || 0) >= 0.3, "moment should not collapse just because blocker is absent");
  assert.ok((byId.get("details")?.strength || 0) >= 0.6, "details should reflect concrete acts and facts, not only stakes");
  assert.equal(elementBlock.hasElementBlock, false, "tribute story with strong setting/feeling/bond should not be blocked by element bars");
});
