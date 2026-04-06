const test = require("node:test");
const assert = require("node:assert/strict");

const v3 = require("../../../src/writer/v3");
const { extractStoryState } = require("../../../src/writer/v3/index");

test("hydrateStoryState refreshes answered status after a new user reply", () => {
  const baseState = {
    atoms: { who: "Sarah" },
    facts: [],
    conversation: [
      { role: "user", content: "Tell Sarah how much she means to me." },
      { role: "assistant", content: "What happened in that moment?" },
    ],
  };

  const staleState = {
    ...baseState,
    story_state: extractStoryState(baseState),
  };
  assert.equal(staleState.story_state.questionsAsked[0].answered, false);

  const withReply = {
    ...staleState,
    conversation: [
      ...staleState.conversation,
      { role: "user", content: "She called from the hospital parking lot." },
    ],
  };

  const refreshed = v3.__internal.hydrateStoryState(withReply);
  assert.equal(refreshed.story_state.questionsAsked[0].answered, true);
  assert.equal(
    refreshed.story_state.questionsAsked[0].answerSummary,
    "She called from the hospital parking lot."
  );
});
