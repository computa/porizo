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
      generateText: async ({ taskType, prompt, logLabel }) => {
        calls.push({ taskType, prompt, logLabel });
        const next = sequence.shift();
        if (!next) {
          throw new Error(`No mock response left for ${taskType}`);
        }
        // Sentinel: an entry of the form { __throw: Error } makes the mock reject.
        // Lets tests exercise transient LLM-call failures without redesigning the loader.
        if (next && typeof next === "object" && next.__throw instanceof Error) {
          throw next.__throw;
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

function captureStderr(fn) {
  const original = console.warn;
  const lines = [];
  console.warn = (...args) => {
    lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      console.warn = original;
    })
    .then((value) => ({ value, lines }));
}

function flattenTestLyrics(lyrics) {
  return (lyrics?.sections || [])
    .flatMap((section) => section.lines || [])
    .join("\n");
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

  const secondLyricsPrompt = calls.find((call) =>
    call.taskType === "lyrics" && /PREVIOUS DRAFT TO REWRITE/i.test(call.prompt)
  );
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

test("generateLyrics runs compact targeted repair when one required detail remains missing", async () => {
  const calls = [];
  const missingDetail = "You followed every instruction, kept every appointment, endured every discomfort, and did everything possible to carry them safely.";
  const badDraft = JSON.stringify({
    title: "Love in Action",
    style: "acoustic",
    sections: [
      {
        name: "verse1",
        lines: [
          "Chioma kept the home running",
          "While raising four children",
          "Our children grew in warmth",
          "And structure because of you",
        ],
      },
      {
        name: "chorus",
        lines: [
          "Chioma, that was love in action",
          "A sacrifice beyond compare",
          "I will never forget the twin pregnancy",
          "High-risk fear around us",
        ],
      },
    ],
    anchor_line: "Chioma, that was love in action",
    story_elements_used: ["home", "appointments", "four children", "twins"],
  });
  const repairedDraft = JSON.stringify({
    title: "Love in Action",
    style: "acoustic",
    sections: [
      {
        name: "verse1",
        lines: [
          "Chioma kept the home together",
          "Work and meals stayed on your mind",
          "Four little hearts around her",
          "Our children grew in warmth and structure",
        ],
      },
      {
        name: "chorus",
        lines: [
          "Chioma, that was love in action",
          "A sacrifice beyond compare",
          "You kept each appointment, every instruction",
          "Endured every discomfort, did all possible",
          "To carry them safely through",
        ],
      },
      {
        name: "bridge",
        lines: [
          "I will never forget the high-risk twins",
          "Through fear and bleeding, you held on",
          "And brought our children home",
        ],
      },
    ],
    anchor_line: "Chioma, that was love in action",
    story_elements_used: [
      "work and meals",
      "four children",
      "kept each appointment and every instruction",
      "endured every discomfort and did everything possible to carry them safely",
    ],
  });
  const judgeLooksGoodButServerCoverageFails = JSON.stringify({
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
    feedback: "good except server-side required coverage will decide",
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
    invented_details: [],
    flattened_emotional_arc: "",
    rewrite_targets: [],
    feedback: "repaired",
  });

  const { generateLyrics } = loadSongwriterWithSequence(
    [
      badDraft, judgeLooksGoodButServerCoverageFails,
      badDraft, judgeLooksGoodButServerCoverageFails,
      repairedDraft, judgePass,
    ],
    calls
  );

  const result = await generateLyrics({
    recipient_name: "Chioma",
    occasion: "birthday",
    style: "acoustic",
    message: "I see you and I am grateful",
    completed_story_package: {
      prose: `Chioma kept the home running while raising four children. I will never forget the high-risk pregnancy of the twins. ${missingDetail} Because of you, our children grew up in warmth and structure.`,
      retained_details: [
        { id: "daily_load", text: "Chioma kept the home running while raising four children.", required: true, category: "context" },
        { id: "twins_risk", text: "I will never forget the high-risk pregnancy of the twins.", required: true, category: "context" },
        { id: "followed_everything", text: missingDetail, required: true, category: "event" },
        { id: "warmth_structure", text: "Because of you, our children grew up in warmth and structure.", required: true, category: "meaning" },
      ],
    },
    narrative: `Chioma kept the home running while raising four children. I will never forget the high-risk pregnancy of the twins. ${missingDetail} Because of you, our children grew up in warmth and structure.`,
    song_map: {
      hook: "That was love in action",
      verse1: ["Chioma kept the home running while raising four children"],
      chorus: ["That was love in action"],
      verse2: ["I will never forget the high-risk pregnancy of the twins"],
      bridge: [missingDetail],
      key_lines: ["I see you and I am grateful"],
    },
  });

  assert.equal(result.acceptance_reason, "targeted_required_detail_repair_passed");
  assert.match(flattenTestLyrics(result.lyrics), /instruction/i);
  assert.match(flattenTestLyrics(result.lyrics), /carry them safely/i);
  const repairPrompt = calls.find((call) => /SURGICAL REQUIRED-DETAIL REPAIR/.test(call.prompt));
  assert.ok(repairPrompt, "expected compact targeted repair prompt");
  assert.match(repairPrompt.prompt, /MISSING REQUIRED DETAILS/i);
  assert.match(repairPrompt.prompt, /followed every instruction/i);
});

test("generateLyrics fails closed when story-backed fidelity judge is malformed", async () => {
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
  const { generateLyrics } = loadSongwriterWithSequence([
    lyricJson,
    malformedJudge,
    lyricJson,
    malformedJudge,
    lyricJson,
    malformedJudge,
    lyricJson,
    malformedJudge,
  ], calls);
  await assert.rejects(
    () => generateLyrics({
      recipient_name: "Chioma",
      occasion: "mothers_day",
      style: "pop",
      message: "You held the family together",
      narrative: "Chioma held the family together through a frightening season.",
      facts: [
        { text: "She carried school runs, work calls, and the whole home." },
        { text: "Warnings and pressure tested the family." },
      ],
    }),
    (err) => {
      assert.equal(err.code, "LYRICS_FIDELITY_LOW");
      assert.match(err.fidelity?.feedback || "", /Fidelity judge unavailable/i);
      return true;
    }
  );
  assert.ok(calls.some((call) => call.taskType === "fidelity_judge"));
});

test("generateLyrics treats completed_story_package.prose as story-backed even without narrative or facts", async () => {
  const calls = [];
  const lyricJson = JSON.stringify({
    title: "Quiet Shifts",
    style: "country",
    sections: [
      {
        name: "verse1",
        lines: [
          "Marcus kept the hallway light on",
          "Through every quiet shift at home",
          "His daughter saw the sacrifice",
          "In all the years he carried alone",
        ],
      },
      {
        name: "chorus",
        lines: [
          "Marcus, now she sees the love",
          "Behind the work you never named",
          "On your birthday, every late night shines",
          "As love in action in her heart",
        ],
      },
    ],
    anchor_line: "Marcus, now she sees the love",
    story_elements_used: ["quiet shifts", "daughter saw the sacrifice"],
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

  const { generateLyrics } = loadSongwriterWithSequence([lyricJson, judgePass], calls);
  const result = await generateLyrics({
    recipient_name: "Marcus",
    occasion: "birthday",
    style: "country",
    message: "His daughter finally sees his sacrifice",
    completed_story_package: {
      prose: "Marcus worked quiet shifts for years while his daughter was too young to understand the sacrifice. On his birthday, she finally saw that every late night was love in action.",
      retained_details: [
        {
          id: "quiet_shifts",
          text: "worked quiet shifts for years while his daughter was too young to understand the sacrifice",
          required: true,
          category: "sacrifice",
        },
        {
          id: "birthday_payoff",
          text: "on his birthday, she finally saw that every late night was love in action",
          required: true,
          category: "payoff",
        },
      ],
    },
  });

  assert.equal(result.acceptance_reason, "quality_and_fidelity_passed");
  assert.ok(calls.some((call) => call.taskType === "fidelity_judge"), "completed story prose must trigger fidelity judging");
  const lyricsPrompt = calls.find((call) => call.taskType === "lyrics");
  assert.match(lyricsPrompt.prompt, /AUTHORITATIVE COMPLETED STORY/i);
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

// ---------------------------------------------------------------------------
// Tests added as Phase 1 of deferred /ce:review fixes — lock down the repair
// path's transient-failure behavior, the post-repair gate, and observability.
// Reuses the exact context shape from the passing repair test so quality and
// local-coverage signals match the production-tested code path.
// ---------------------------------------------------------------------------

function buildRepairContext() {
  const missingDetail = "You followed every instruction, kept every appointment, endured every discomfort, and did everything possible to carry them safely.";
  return {
    missingDetail,
    badDraft: JSON.stringify({
      title: "Love in Action",
      style: "acoustic",
      sections: [
        { name: "verse1", lines: [
          "Chioma kept the home running",
          "While raising four children",
          "Our children grew in warmth",
          "And structure because of you",
        ] },
        { name: "chorus", lines: [
          "Chioma, that was love in action",
          "A sacrifice beyond compare",
          "I will never forget the twin pregnancy",
          "High-risk fear around us",
        ] },
      ],
      anchor_line: "Chioma, that was love in action",
      story_elements_used: ["home", "appointments", "four children", "twins"],
    }),
    // Scores total 30 (< FIDELITY_MIN_SCORE - BORDERLINE_FIDELITY_MARGIN = 33)
    // so the SELF_CORRECTION_MAX exhaustion path cannot slip through borderline-pass.
    // invented_details: [] still satisfies canTryTargetedRepair's preconditions.
    judgeMissing: JSON.stringify({
      scores: { coverage: 6, flow: 6, specificity: 6, emotional_truth: 6, faithfulness: 6 },
      missed_facts: [],
      missing_story_beats: [],
      uncovered_song_map_slots: [],
      invented_details: [],
      flattened_emotional_arc: "",
      rewrite_targets: [],
      feedback: "judge says fine but server coverage will block",
    }),
    context: {
      recipient_name: "Chioma",
      occasion: "birthday",
      style: "acoustic",
      message: "I see you and I am grateful",
      completed_story_package: {
        prose: `Chioma kept the home running while raising four children. I will never forget the high-risk pregnancy of the twins. ${missingDetail} Because of you, our children grew up in warmth and structure.`,
        retained_details: [
          { id: "daily_load", text: "Chioma kept the home running while raising four children.", required: true, category: "context" },
          { id: "twins_risk", text: "I will never forget the high-risk pregnancy of the twins.", required: true, category: "context" },
          { id: "followed_everything", text: missingDetail, required: true, category: "event" },
          { id: "warmth_structure", text: "Because of you, our children grew up in warmth and structure.", required: true, category: "meaning" },
        ],
      },
      narrative: `Chioma kept the home running while raising four children. I will never forget the high-risk pregnancy of the twins. ${missingDetail} Because of you, our children grew up in warmth and structure.`,
      song_map: {
        hook: "That was love in action",
        verse1: ["Chioma kept the home running while raising four children"],
        chorus: ["That was love in action"],
        verse2: ["I will never forget the high-risk pregnancy of the twins"],
        bridge: [missingDetail],
        key_lines: ["I see you and I am grateful"],
      },
    },
  };
}

test("repair LLM transient exception does not burn the single-shot repair budget", async () => {
  const fixture = buildRepairContext();
  const transientError = new Error("LLM transient failure");
  // SELF_CORRECTION_MAX=3 → up to 4 attempts. Repair eligible from attempt 1.
  // Each transient failure must leave targetedRepairTried false so the next
  // iteration can try again. Provide enough draft/judge pairs + 3 repair throws
  // (attempts 1, 2, 3 all eligible) to confirm the budget is not consumed early.
  const { generateLyrics } = loadSongwriterWithSequence(
    [
      fixture.badDraft, fixture.judgeMissing,
      fixture.badDraft, fixture.judgeMissing,
      { __throw: transientError },
      fixture.badDraft, fixture.judgeMissing,
      { __throw: transientError },
      fixture.badDraft, fixture.judgeMissing,
      { __throw: transientError },
    ],
    [],
  );

  await assert.rejects(
    () => generateLyrics(fixture.context),
    (err) => err.code === "LYRICS_FIDELITY_LOW",
  );
});

test("repair returning quality-passing lyrics that still fail fidelity holds the gate", async () => {
  const fixture = buildRepairContext();
  // Repair returns a 3-section draft (matches the passing-test shape so quality
  // assessment behaves the same way). Re-judge fails: low total + invented_details
  // present, defeating the borderline-pass branch (BORDERLINE_FIDELITY_MARGIN=2,
  // requires invented_details.length === 0).
  const repairedButStillBad = JSON.stringify({
    title: "Love in Action",
    style: "acoustic",
    sections: [
      { name: "verse1", lines: [
        "Chioma kept the home together",
        "Work and meals stayed on your mind",
        "Four little hearts around her",
        "Our children grew in warmth and structure",
      ] },
      { name: "chorus", lines: [
        "Chioma, that was love in action",
        "A sacrifice beyond compare",
        "Through the high-risk twin pregnancy",
        "You stayed though hardship loomed",
      ] },
      { name: "bridge", lines: [
        "I will never forget what you carried",
        "And the love that pulled us through",
        "Even when the days felt heavy",
      ] },
    ],
    anchor_line: "Chioma, that was love in action",
    story_elements_used: ["work and meals", "four children", "high-risk pregnancy", "love"],
  });
  const judgeStillFails = JSON.stringify({
    scores: { coverage: 5, flow: 6, specificity: 4, emotional_truth: 5, faithfulness: 4 },
    missed_facts: ["the followed-every-instruction sacrifice"],
    missing_story_beats: [],
    uncovered_song_map_slots: [],
    invented_details: ["hardship loomed (unsupported phrasing)"],
    flattened_emotional_arc: "",
    rewrite_targets: ["restore the followed-every-instruction sacrifice"],
    feedback: "still missing the central sacrifice and added unsupported imagery",
  });
  const { generateLyrics } = loadSongwriterWithSequence(
    [
      fixture.badDraft, fixture.judgeMissing,
      fixture.badDraft, fixture.judgeMissing,
      repairedButStillBad, judgeStillFails,
      fixture.badDraft, fixture.judgeMissing,
      fixture.badDraft, fixture.judgeMissing,
    ],
    [],
  );

  await assert.rejects(
    () => generateLyrics(fixture.context),
    (err) => err.code === "LYRICS_FIDELITY_LOW",
  );
});

test("repair emits repair_attempted observability metric on console.warn", async () => {
  const fixture = buildRepairContext();
  const repairedDraft = JSON.stringify({
    title: "Love in Action",
    style: "acoustic",
    sections: [
      { name: "verse1", lines: [
        "Chioma kept the home together",
        "Work and meals stayed on your mind",
        "Four little hearts around her",
        "Our children grew in warmth and structure",
      ] },
      { name: "chorus", lines: [
        "Chioma, that was love in action",
        "A sacrifice beyond compare",
        "You kept each appointment, every instruction",
        "Endured every discomfort, did all possible",
        "To carry them safely through",
      ] },
      { name: "bridge", lines: [
        "I will never forget the high-risk twins",
        "Through fear and bleeding, you held on",
        "And brought our children home",
      ] },
    ],
    anchor_line: "Chioma, that was love in action",
    story_elements_used: [
      "work and meals",
      "four children",
      "kept each appointment and every instruction",
      "endured every discomfort and did everything possible to carry them safely",
    ],
  });
  const judgePass = JSON.stringify({
    scores: { coverage: 9, flow: 9, specificity: 9, emotional_truth: 9, faithfulness: 9 },
    missed_facts: [],
    missing_story_beats: [],
    uncovered_song_map_slots: [],
    invented_details: [],
    flattened_emotional_arc: "",
    rewrite_targets: [],
    feedback: "repaired",
  });
  const { generateLyrics } = loadSongwriterWithSequence(
    [
      fixture.badDraft, fixture.judgeMissing,
      fixture.badDraft, fixture.judgeMissing,
      repairedDraft, judgePass,
    ],
    [],
  );

  const { value: result, lines } = await captureStderr(() => generateLyrics(fixture.context));
  assert.equal(result.acceptance_reason, "targeted_required_detail_repair_passed");
  assert.ok(
    lines.some((l) => l.includes("repair_attempted=") && l.includes("targeted_required_detail")),
    "repair_attempted metric must be emitted to console.warn",
  );
});
