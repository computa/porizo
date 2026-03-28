const test = require("node:test");
const assert = require("node:assert/strict");

const { applyReasoningResult } = require("../../../src/writer/v3/engine");

test("applyReasoningResult keeps song_map motifs as strings instead of contract objects", () => {
  const next = applyReasoningResult(
    {
      turn_count: 0,
      facts: [],
      open_conflicts: [],
      atoms: {},
      primitives: {},
      motifs: [],
      dials: {},
      song_map: null,
    },
    {
      updates: {
        song_map: {
          verse1: ["School runs and work calls filled every day"],
          motifs: ["school runs", "doctor's warnings"],
        },
      },
    },
    "School runs and doctor's warnings filled every day."
  );

  assert.deepStrictEqual(next.song_map.motifs, ["school runs", "doctor's warnings"]);
});
