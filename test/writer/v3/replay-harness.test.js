const test = require("node:test");
const assert = require("node:assert/strict");

const v3 = require("../../../src/writer/v3");
const engine = require("../../../src/writer/v3/engine");
const { createInitialState } = require("../../../src/writer/v3/state");
const { ingestTurn } = require("../../../src/writer/v3/kernel/ingestor");
const { buildIngestProjection } = require("../../../src/writer/v3/kernel/projections");

function buildReplayFixtureState() {
  let state = createInitialState({
    recipientName: "Ada",
    occasion: "celebration",
    initialPrompt: "Tell a story about Easter dinner with family in Texas.",
  });
  state.narrative = "Ada's family gathered for Easter dinner in Texas, and everyone felt the joy of being together.";
  state.narrative_current = state.narrative;
  state.turn_count = 2;
  state.atoms = {
    ...state.atoms,
    who: "Ada and her family",
    where: "their Texas home",
    when: "Easter evening",
    action: "everyone gathered around the dinner table",
  };
  state.primitives = {
    ...state.primitives,
    setting: {
      place: "their Texas home",
      time: "Easter evening",
      atmosphere: "joyful and loud",
      sensory_tags: [],
    },
  };
  state.facts = [
    { id: "f1", text: "Ada's family gathered around the dinner table in Texas on Easter evening.", beat: "context", status: "active" },
  ];
  state.conversation = [
    { role: "assistant", content: "What Easter moment really stands out to you?" },
    { role: "user", content: "The moment that stands out is when the prayer ended and everyone laughed because the youngest cousin stole a hot cross bun before dessert." },
  ];
  return v3.__internal.hydrateStoryState(state);
}

function normalizeReplaySlice(state) {
  return {
    atomWhere: state.atoms.where,
    atomWhen: state.atoms.when,
    atomAction: state.atoms.action,
    primitivePlace: state.primitives.setting.place,
    primitiveTime: state.primitives.setting.time,
    activeFacts: (state.facts || [])
      .filter((fact) => (fact?.status || "active") === "active")
      .map((fact) => fact.text),
  };
}

test("buildIngestProjection is allowlisted and does not replay full conversation", () => {
  const state = buildReplayFixtureState();
  const projection = buildIngestProjection(state, "What Easter moment really stands out to you?");

  assert.equal(typeof projection.recipientName, "string");
  assert.equal(Array.isArray(projection.activeFacts), true);
  assert.equal(Array.isArray(projection.recentQuestions), true);
  assert.equal("conversation" in projection, false);
  assert.equal("facts" in projection, false);
  assert.ok((projection.recentQuestions || []).length <= 4);
});

test("replay harness preserves core extraction fields for repeated-question session", async () => {
  const baseState = buildReplayFixtureState();
  const answer = "After the prayer, the youngest cousin grabbed a hot cross bun too early and everyone burst out laughing, which made the whole room feel even warmer.";

  const legacyReasoningResult = {
    updates: {
      new_facts: [
        { text: "After the prayer, the youngest cousin grabbed a hot cross bun too early and everyone burst out laughing.", beat: "moment" },
      ],
      atoms: {
        action: "the youngest cousin grabbed a hot cross bun too early and everyone burst out laughing",
        after: "the whole room felt even warmer",
      },
      primitives: {
        setting: {
          place: "their Texas home",
          time: "Easter evening",
        },
        resolution: "the laughter made the room feel even warmer",
      },
    },
  };

  const ingestorJson = JSON.stringify({
    updates: {
      new_facts: [
        { text: "After the prayer, the youngest cousin grabbed a hot cross bun too early and everyone burst out laughing.", beat: "moment" },
      ],
      atoms: {
        action: "the youngest cousin grabbed a hot cross bun too early and everyone burst out laughing",
        after: "the whole room felt even warmer",
      },
      primitives: {
        setting: {
          place: "their Texas home",
          time: "Easter evening",
        },
        resolution: "the laughter made the room feel even warmer",
      },
    },
  });

  const legacyState = engine.applyReasoningResult(baseState, legacyReasoningResult, answer);
  const ingestResult = await ingestTurn({
    state: baseState,
    answer,
    previousQuestion: "What Easter moment really stands out to you?",
    generateTextFn: async () => ({
      text: ingestorJson,
      usage: { outputTokens: 1 },
    }),
  });

  assert.equal(ingestResult.success, true);
  const newState = engine.applyReasoningResult(baseState, ingestResult.data, answer);

  assert.deepEqual(normalizeReplaySlice(newState), normalizeReplaySlice(legacyState));
});
