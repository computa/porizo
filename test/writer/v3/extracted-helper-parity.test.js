const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getQuestionDetailSignal,
  shouldSoftPassQuestion,
  tokenizeQuestionKeywords,
} = require("../../../src/writer/v3/runtime-questions");
const { buildReadyConfirmation } = require("../../../src/writer/v3/ready-confirmation");
const {
  normalizeOccasion,
  normalizeText,
  splitSentences,
  stripFormulaicOpener,
} = require("../../../src/writer/v3/utils");

test("runtime question keyword extraction keeps story-bearing words only", () => {
  assert.deepEqual(
    tokenizeQuestionKeywords("Can you tell me more about the hospital parking-lot moment?"),
    ["tell", "hospital", "parking-lot", "moment"],
  );
});

test("runtime question detail signal detects grounded story overlap", () => {
  const signal = getQuestionDetailSignal(
    "What happened in the hospital parking lot with Chioma?",
    {
      recipient_name: "Chioma",
      facts: [
        { text: "Chioma called from the hospital parking lot after the appointment.", status: "active" },
        { text: "An inactive beach detail should not influence targeting.", status: "inactive" },
      ],
    },
    "",
  );

  assert.equal(signal.hasRecipientMatch, true);
  assert.equal(signal.hasStoryDetailMatch, true);
});

test("runtime soft pass allows substantive grounded questions but blocks generic asks", () => {
  const state = {
    recipient_name: "Chioma",
    facts: [
      { text: "Chioma called from the hospital parking lot after the appointment.", status: "active" },
    ],
  };

  assert.equal(
    shouldSoftPassQuestion("What happened in the hospital parking lot with Chioma after the appointment?", state, ""),
    true,
  );
  assert.equal(shouldSoftPassQuestion("Can you tell me more?", state, ""), false);
});

test("ready confirmation prefers canonical narrative when present", () => {
  const confirmation = buildReadyConfirmation(
    {
      recipient_name: "Chioma",
      narrative_current: "The complete story is ready.",
    },
    { slots: [{ status: "covered" }] },
  );

  assert.match(confirmation, /integrated your story/i);
  assert.match(confirmation, /Chioma/);
});

test("ready confirmation falls back to covered slot count without narrative", () => {
  const confirmation = buildReadyConfirmation(
    { recipient_name: "Ada" },
    {
      slots: [
        { status: "covered" },
        { status: "missing" },
        { status: "covered" },
      ],
    },
  );

  assert.match(confirmation, /Ada/);
  assert.match(confirmation, /2 core story elements covered/);
});

test("V3 text utilities preserve sentence boundaries and stable fallbacks", () => {
  assert.equal(normalizeText("  one\n\n two\tthree  "), "one two three");
  assert.equal(normalizeOccasion("happy_birthday"), "happy-birthday");
  assert.deepEqual(splitSentences(" First. Second? Third! ", { limit: 2 }), ["First.", "Second?"]);
  assert.deepEqual(splitSentences(null), []);
  assert.equal(
    stripFormulaicOpener("This birthday story is about Sarah. It happened in Lagos."),
    "It happened in Lagos.",
  );
});
