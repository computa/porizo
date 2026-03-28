const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildContextPrompt,
  serializeStructuredContext,
} = require("../../../src/writer/v3/prompts/builder");

test("buildContextPrompt preserves rich user input beyond the old 900-char cap", () => {
  const storyTail = "WATCH_THE_PAYOFF_SURVIVE";
  const richInput = `${"A".repeat(1500)} ${storyTail}`;
  const prompt = buildContextPrompt({
    recipient_name: "Chioma",
    event: { occasion: "mothers_day" },
    narrative: "Chioma carried the family through a difficult season.",
    facts: [],
    atoms: {},
    primitives: {},
    motifs: [],
    dials: {},
    beats: [],
    conversation: [],
  }, richInput);

  assert.match(prompt, /WATCH_THE_PAYOFF_SURVIVE/, "rich user input tail should survive prompt assembly");
});

test("serializeStructuredContext keeps cited song_map parseable and prioritized under tight limits", () => {
  const serialized = serializeStructuredContext({
    filler: "X".repeat(4000),
    song_map: {
      hook: { idea: "You made our house a home", source_facts: ["f_meaning"] },
      verse1: [{ idea: "School runs and work calls filled every day", source_facts: ["f_scene"] }],
      chorus: [{ idea: "What it meant was love under pressure", source_facts: ["f_meaning"] }],
      verse2: [{ idea: "The high-risk twin pregnancy changed everything", source_facts: ["f_turn"] }],
      bridge: [{ idea: "Watching her grow into a stronger woman", source_facts: ["f_meaning"] }],
      key_lines: [{ idea: "You made our house a home", source_facts: ["f_meaning"] }],
    },
  }, { maxStructuredJsonChars: 320 });

  const parsed = JSON.parse(serialized);
  assert.ok(parsed.song_map, "song_map should survive structured serialization");
  assert.equal(parsed.song_map.hook.idea, "You made our house a home");
  assert.deepStrictEqual(parsed.song_map.chorus[0].source_facts, ["f_meaning"]);
});
