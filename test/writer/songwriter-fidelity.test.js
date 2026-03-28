const test = require("node:test");
const assert = require("node:assert/strict");

const llmProviderPath = require.resolve("../../src/services/llm-provider");
const songwriterPath = require.resolve("../../src/writer/songwriter");

function loadSongwriterWithSequence(sequence, calls) {
  delete require.cache[songwriterPath];
  delete require.cache[llmProviderPath];

  require.cache[llmProviderPath] = {
    id: llmProviderPath,
    filename: llmProviderPath,
    loaded: true,
    exports: {
      generateText: async ({ taskType, prompt }) => {
        calls.push({ taskType, prompt });
        const next = sequence.shift();
        if (!next) {
          throw new Error(`No mock response left for ${taskType}`);
        }
        return {
          text: next,
          provider: "mock",
          model: "mock-model",
          usage: { input_tokens: 10, output_tokens: 10 },
        };
      },
      isAvailable: () => true,
      ERROR_CODES: {
        ALL_PROVIDERS_FAILED: "ALL_PROVIDERS_FAILED",
      },
    },
  };

  return require("../../src/writer/songwriter");
}

test("generateLyrics rejects story-backed lyrics that fail fidelity after structured repair retry", async () => {
  const calls = [];
  const lyricJson = JSON.stringify({
    title: "Heartbeat of Our Home",
    style: "pop",
    sections: [
      {
        name: "verse1",
        lines: [
          "Chioma kept the family steady",
          "School runs and late work calls",
          "Morning light across the hallway",
          "You held the house through all",
        ],
      },
      {
        name: "chorus",
        lines: [
          "Chioma, this is what it means",
          "You made our house a home",
          "Through doctor's warnings and pressure",
          "You never let us go",
        ],
      },
      {
        name: "verse2",
        lines: [
          "Through sunrise prayers and hospital fear",
          "The twins arrived and changed us all",
          "You stood against the hard year",
          "And taught us how to hold",
        ],
      },
    ],
    anchor_line: "Chioma, this is what it means",
    story_elements_used: ["school runs", "work calls", "doctor's warnings", "twins"],
  });

  const judgeFailure = JSON.stringify({
    scores: {
      coverage: 8,
      flow: 7,
      specificity: 7,
      emotional_truth: 7,
      faithfulness: 3,
    },
    missed_facts: ["the story's growth/payoff is underplayed"],
    missing_story_beats: ["the transformation into a stronger woman"],
    invented_details: ["sunrise prayers"],
    flattened_emotional_arc: "the ending meaning is compressed into generic praise",
    rewrite_targets: ["replace unsupported sunrise prayers imagery", "restore the growth/payoff arc"],
    feedback: "remove unsupported imagery and restore the payoff",
  });

  const { generateLyrics } = loadSongwriterWithSequence(
    [lyricJson, judgeFailure, lyricJson, judgeFailure],
    calls
  );

  await assert.rejects(
    () => generateLyrics({
      recipient_name: "Chioma",
      occasion: "mothers_day",
      style: "pop",
      message: "You held the family together",
      narrative: "Chioma held the family together through a frightening twin pregnancy and years of daily work. Watching her grow into a stronger woman deepened everyone's love and respect.",
      facts: [
        { text: "She carried school runs, work calls, and the whole home." },
        { text: "The high-risk twin pregnancy brought fear and doctor's warnings." },
        { text: "Watching her grow into a stronger woman deepened love and respect." },
      ],
      atoms: {
        where: "the hallway at home",
        when: "morning",
        action: "she kept the house moving",
        turn: "the high-risk twin pregnancy changed everything",
        after: "everyone loved and respected her even more",
      },
      primitives: {
        turning_point: "the high-risk twin pregnancy changed everything",
        resolution: "everyone loved and respected her even more",
        theme: "her strength made the house feel like home",
      },
      song_map: {
        hook: "You made our house a home",
        verse1: ["School runs and work calls filled every day"],
        chorus: ["What it meant was love under pressure"],
        verse2: ["The twin pregnancy changed everything"],
        bridge: ["Watching her grow into a stronger woman"],
        key_lines: ["You made our house a home"],
      },
    }),
    (err) => {
      assert.equal(err.code, "LYRICS_FIDELITY_LOW");
      assert.ok(Array.isArray(err.fidelity?.invented_details));
      assert.ok(err.fidelity.invented_details.includes("sunrise prayers"));
      return true;
    }
  );

  const secondLyricsPrompt = calls.findLast((call) => call.taskType === "lyrics");
  assert.ok(secondLyricsPrompt, "expected a second lyrics attempt");
  assert.match(secondLyricsPrompt.prompt, /Invented details to remove: sunrise prayers/i);
  assert.match(secondLyricsPrompt.prompt, /Watching her grow into a stronger woman/i);
});
