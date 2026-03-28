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
    [lyricJson, judgeFailure, lyricJson, judgeFailure, lyricJson, judgeFailure, lyricJson, judgeFailure],
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
  assert.match(secondLyricsPrompt.prompt, /PREVIOUS DRAFT TO REWRITE/i);
});

test("generateLyrics self-corrects with judge feedback and previous draft context", async () => {
  const calls = [];
  const firstDraft = JSON.stringify({
    title: "Heartbeat of Our Home",
    style: "pop",
    sections: [
      {
        name: "verse1",
        lines: [
          "Chioma held the house together",
          "School runs and work calls all day",
          "Sunrise prayers across the hallway",
          "You kept the fear away",
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
    ],
    anchor_line: "Chioma, this is what it means",
  });
  const repairedDraft = JSON.stringify({
    title: "Heartbeat of Our Home",
    style: "pop",
    sections: [
      {
        name: "verse1",
        lines: [
          "Chioma held the house together",
          "School runs and work calls all day",
          "Every room moved because of you",
          "You carried more than we could say",
        ],
      },
      {
        name: "chorus",
        lines: [
          "Chioma, this is what it means",
          "You made our house a home",
          "Through doctor's warnings and pressure",
          "Love stayed alive because you held on",
        ],
      },
      {
        name: "bridge",
        lines: [
          "Watching you grow into a stronger woman",
          "Made us love you even more",
        ],
      },
    ],
    anchor_line: "Chioma, this is what it means",
  });
  const judgeFailure = JSON.stringify({
    scores: {
      coverage: 8,
      flow: 7,
      specificity: 7,
      emotional_truth: 7,
      faithfulness: 3,
    },
    missed_facts: ["the growth/payoff is underplayed"],
    missing_story_beats: ["the transformation into a stronger woman"],
    uncovered_song_map_slots: ["bridge"],
    invented_details: ["sunrise prayers"],
    flattened_emotional_arc: "the ending meaning is compressed into generic praise",
    rewrite_targets: ["replace unsupported sunrise prayers imagery", "restore the growth/payoff arc"],
    feedback: "remove unsupported imagery and restore the payoff",
  });
  const judgePass = JSON.stringify({
    scores: {
      coverage: 9,
      flow: 9,
      specificity: 8,
      emotional_truth: 9,
      faithfulness: 9,
    },
    missed_facts: [],
    missing_story_beats: [],
    uncovered_song_map_slots: [],
    invented_details: [],
    flattened_emotional_arc: "",
    rewrite_targets: [],
    feedback: "good",
  });

  const { generateLyrics } = loadSongwriterWithSequence(
    [firstDraft, judgeFailure, repairedDraft, judgePass],
    calls
  );

  const result = await generateLyrics({
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
    song_map: {
      hook: "You made our house a home",
      verse1: ["School runs and work calls filled every day"],
      chorus: ["What it meant was love under pressure"],
      verse2: ["The twin pregnancy changed everything"],
      bridge: ["Watching her grow into a stronger woman"],
      key_lines: ["You made our house a home"],
    },
  });

  assert.equal(result.acceptance_reason, "quality_and_fidelity_passed");
  const secondLyricsPrompt = calls.findLast((call) => call.taskType === "lyrics");
  assert.ok(secondLyricsPrompt, "expected a repair lyrics prompt");
  assert.match(secondLyricsPrompt.prompt, /PREVIOUS DRAFT TO REWRITE/i);
  assert.match(secondLyricsPrompt.prompt, /Story sections still missing: bridge/i);
  assert.match(secondLyricsPrompt.prompt, /Invented details to remove: sunrise prayers/i);
  assert.doesNotMatch(secondLyricsPrompt.prompt, /\[object Object\]/i, "retry prompt should never stringify contract objects into narrative text");
  const firstJudgePrompt = calls.find((call) => call.taskType === "fidelity_judge");
  assert.ok(firstJudgePrompt, "expected a fidelity judge call");
  assert.match(firstJudgePrompt.prompt, /Primary song map:/i);
  assert.match(firstJudgePrompt.prompt, /bridge: Watching her grow into a stronger woman/i);
  assert.match(firstJudgePrompt.prompt, /source_facts:/i);
});

test("generateLyrics degrades gracefully when judge returns malformed faithfulness score", async () => {
  const lyricJson = JSON.stringify({
    title: "Held Together",
    style: "pop",
    sections: [
      {
        name: "verse1",
        lines: [
          "Chioma kept the family steady",
          "School runs and late work calls",
          "She held the rooms together",
          "When every day felt tall",
        ],
      },
      {
        name: "chorus",
        lines: [
          "Chioma, you made our house a home",
          "You carried the fear with grace",
          "Through the warnings and the pressure",
          "Love stayed alive in this place",
        ],
      },
    ],
    anchor_line: "Chioma, you made our house a home",
    story_elements_used: ["school runs", "work calls", "warnings"],
  });

  const malformedJudge = JSON.stringify({
    scores: {
      coverage: 8,
      flow: 8,
      specificity: 7,
      emotional_truth: 8,
      faithfulness: "strong",
    },
    feedback: "judge returned malformed faithfulness",
  });

  const judgeCalls = [];
  const { assessNarrativeFidelity } = loadSongwriterWithSequence([malformedJudge], judgeCalls);

  await assert.rejects(
    () => assessNarrativeFidelity(
      {
        sections: [{ name: "verse1", lines: ["Chioma kept the family steady"] }],
      },
      {
        narrative: "Chioma held the family together during a difficult season.",
        facts: [{ text: "She carried the family through a difficult season." }],
      }
    ),
    /Malformed fidelity judge score: faithfulness/
  );

  const calls = [];
  const { generateLyrics } = loadSongwriterWithSequence([lyricJson, malformedJudge], calls);
  const result = await generateLyrics({
    recipient_name: "Chioma",
    occasion: "mothers_day",
    style: "pop",
    message: "You held the family together",
    narrative: "Chioma held the family together through a frightening season.",
    facts: [
      { text: "She carried school runs, work calls, and the whole home." },
      { text: "Warnings and pressure tested the family." },
    ],
  });

  assert.equal(result.acceptance_reason, "judge_unavailable_quality_passed");
  assert.ok(calls.some((call) => call.taskType === "fidelity_judge"));
});

test("generateLyrics uses sectioned generation for valid cited contracts and rewrites only weak sections", async () => {
  const calls = [];
  const section = (lines, story_elements_used = [], anchor_line = "") => JSON.stringify({
    lines,
    anchor_line,
    story_elements_used,
  });
  const judgeFailure = JSON.stringify({
    scores: {
      coverage: 8,
      flow: 7,
      specificity: 8,
      emotional_truth: 7,
      faithfulness: 2,
    },
    missed_facts: [],
    missing_story_beats: ["bridge reflection underplays the growth payoff"],
    uncovered_song_map_slots: ["bridge"],
    broken_citations: [],
    unsupported_lines: [],
    invented_details: [],
    flattened_emotional_arc: "the bridge feels generic instead of showing the transformation",
    rewrite_targets: ["bridge: restore the stronger woman transformation"],
    feedback: "rewrite the bridge to carry the payoff",
  });
  const judgePass = JSON.stringify({
    scores: {
      coverage: 9,
      flow: 9,
      specificity: 9,
      emotional_truth: 9,
      faithfulness: 9,
    },
    missed_facts: [],
    missing_story_beats: [],
    uncovered_song_map_slots: [],
    broken_citations: [],
    unsupported_lines: [],
    invented_details: [],
    flattened_emotional_arc: "",
    rewrite_targets: [],
    feedback: "good",
  });

  const { generateLyrics } = loadSongwriterWithSequence([
    section([
      "School runs and work calls filled the home",
      "You carried the whole home through every day",
      "Hallway light and tired rooms still moved",
      "Because you kept the family steady",
    ], ["school runs", "work calls"]),
    section([
      "Chioma, this is what it means",
      "You made our house a home",
      "Love and respect kept growing under pressure",
      "You held the family together",
    ], ["house a home", "love and respect"], "Chioma, this is what it means"),
    section([
      "The high-risk twin pregnancy changed everything",
      "Doctor warnings and fear stayed close",
      "You faced the hard year without letting go",
      "And taught the family how to hold on",
    ], ["warnings", "pregnancy", "fear"]),
    section([
      "Now I just call you brave",
      "And leave the rest unsaid",
    ], ["brave"]),
    judgeFailure,
    section([
      "Watching you grow into a stronger woman",
      "Made our love arrive with weight",
      "Every hard year bent toward wonder",
    ], ["stronger woman", "love and respect"]),
    judgePass,
  ], calls);

  const result = await generateLyrics({
    recipient_name: "Chioma",
    occasion: "mothers_day",
    style: "pop",
    message: "You held the family together",
    narrative: "Chioma held the family together through a frightening twin pregnancy and years of daily work. Watching her grow into a stronger woman deepened everyone's love and respect.",
    facts: [
      { id: "f_1", text: "She carried school runs, work calls, and the whole home.", beat: "context" },
      { id: "f_2", text: "The high-risk twin pregnancy brought fear and doctor's warnings.", beat: "turning_point" },
      { id: "f_3", text: "Watching her grow into a stronger woman deepened love and respect.", beat: "meaning" },
    ],
    song_map: {
      hook: { idea: "You made our house a home", source_facts: ["f_1", "f_3"] },
      verse1: [{ idea: "School runs and work calls filled every day", source_facts: ["f_1"] }],
      chorus: [{ idea: "What it meant was love under pressure", source_facts: ["f_3"] }],
      verse2: [{ idea: "The twin pregnancy changed everything", source_facts: ["f_2"] }],
      bridge: [{ idea: "Watching her grow into a stronger woman", source_facts: ["f_3"] }],
      key_lines: [{ idea: "You made our house a home", source_facts: ["f_1", "f_3"] }],
    },
  });

  assert.equal(result.acceptance_reason, "quality_and_fidelity_passed");
  const lyricCalls = calls.filter((call) => call.taskType === "lyrics");
  assert.equal(lyricCalls.length, 5, "expected four section writes plus one targeted bridge rewrite");
  assert.match(lyricCalls[0].prompt, /Write ONLY the VERSE 1/i);
  assert.match(lyricCalls[1].prompt, /Write ONLY the CHORUS/i);
  assert.match(lyricCalls[2].prompt, /Write ONLY the VERSE 2/i);
  assert.match(lyricCalls[3].prompt, /Write ONLY the BRIDGE/i);
  assert.match(lyricCalls[4].prompt, /Write ONLY the BRIDGE/i);
  assert.match(lyricCalls[4].prompt, /SECTION REPAIR NOTE:/i);
  assert.match(lyricCalls[4].prompt, /restore the stronger woman transformation/i);
  assert.equal(result.lyrics.sections.find((sectionDef) => sectionDef.name === "bridge")?.lines?.[0], "Watching you grow into a stronger woman");
});

test("generateLyrics keeps monolithic generation for legacy uncited song maps", async () => {
  const calls = [];
  const firstDraft = JSON.stringify({
    title: "Held Together",
    style: "pop",
    sections: [
      {
        name: "verse1",
        lines: [
          "Chioma held the family steady",
          "School runs and work calls all day",
          "She kept the house from breaking",
          "Through every hard delay",
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
        name: "bridge",
        lines: [
          "Watching you grow into a stronger woman",
          "Made us love you even more",
        ],
      },
    ],
    anchor_line: "Chioma, this is what it means",
  });
  const judgePass = JSON.stringify({
    scores: {
      coverage: 9,
      flow: 9,
      specificity: 8,
      emotional_truth: 9,
      faithfulness: 9,
    },
    missed_facts: [],
    missing_story_beats: [],
    uncovered_song_map_slots: [],
    invented_details: [],
    flattened_emotional_arc: "",
    rewrite_targets: [],
    feedback: "good",
  });

  const { generateLyrics } = loadSongwriterWithSequence([firstDraft, judgePass], calls);
  const result = await generateLyrics({
    recipient_name: "Chioma",
    occasion: "mothers_day",
    style: "pop",
    message: "You held the family together",
    narrative: "Chioma held the family together through a frightening twin pregnancy and years of daily work.",
    facts: [
      { text: "She carried school runs, work calls, and the whole home." },
      { text: "The high-risk twin pregnancy brought fear and doctor's warnings." },
    ],
    song_map: {
      hook: "You made our house a home",
      verse1: ["School runs and work calls filled every day"],
      chorus: ["What it meant was love under pressure"],
      verse2: ["The twin pregnancy changed everything"],
      bridge: ["Watching her grow into a stronger woman"],
      key_lines: ["You made our house a home"],
    },
  });

  assert.equal(result.acceptance_reason, "quality_and_fidelity_passed");
  const lyricCalls = calls.filter((call) => call.taskType === "lyrics");
  assert.equal(lyricCalls.length, 1, "legacy uncited contracts should stay on the monolithic path");
  assert.match(lyricCalls[0].prompt, /## SONG BRIEF/i);
  assert.doesNotMatch(lyricCalls[0].prompt, /## SECTION TASK/i);
});
