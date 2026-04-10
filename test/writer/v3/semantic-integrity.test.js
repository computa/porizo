const test = require("node:test");
const assert = require("node:assert/strict");

const v3Engine = require("../../../src/writer/v3");
const { createInitialState } = require("../../../src/writer/v3/state");

test("ensureSemanticStoryIntegrity restores missing transformation/meaning blocks and rewrites weak chorus thesis", () => {
  const state = {
    ...createInitialState({
      recipientName: "Chioma",
      occasion: "mothers_day",
      initialPrompt: [
        "Chioma, my Chy, when I think about our family, I think about you.",
        "You keep track of appointments, think ahead about what everyone will eat, organise the home, and still manage the demands of work.",
        "You make this house feel like a real home.",
        "I will never forget the high-risk pregnancy of the twins.",
        "There was fear, pain, and uncertainty, especially with the bleeding and the constant worry.",
        "That was love in action. That was sacrifice. That was motherhood at its deepest level.",
        "Watching you become a mother has made me love and respect you even more.",
        "I have watched you grow into a strong woman who rose to the demands of motherhood with courage and grace.",
        "Because of you, our children are growing up in a home filled with warmth, care, and structure.",
        "This Mother's Day, I want you to know that I see you, I appreciate you, and I am deeply grateful.",
      ].join(" "),
    }),
    turn_count: 3,
    narrative: "Chioma, you are the heart of our family from Okija to Perth. You manage work, home, and four children. Your strength shone during the twins' high-risk pregnancy with bleeding and worry. Our relationship now blooms in Perth. Seeing our life unfold here feels like a dream come true.",
    narrative_current: "Chioma, you are the heart of our family from Okija to Perth. You manage work, home, and four children. Your strength shone during the twins' high-risk pregnancy with bleeding and worry. Our relationship now blooms in Perth. Seeing our life unfold here feels like a dream come true.",
    facts: [
      { id: "f_setup", text: "You keep track of appointments, think ahead about what everyone will eat, organise the home, and still manage the demands of work.", beat: "context", status: "active" },
      { id: "f_home", text: "You make this house feel like a real home.", beat: "meaning", status: "active" },
      { id: "f_turn", text: "I will never forget the high-risk pregnancy of the twins.", beat: "turning_point", status: "active" },
      { id: "f_conflict", text: "There was fear, pain, and uncertainty, especially with the bleeding and the constant worry.", beat: "stakes", status: "active" },
      { id: "f_meaning", text: "That was love in action. That was sacrifice. That was motherhood at its deepest level.", beat: "meaning", status: "active" },
      { id: "f_transform", text: "Watching you become a mother has made me love and respect you even more.", beat: "impact", status: "active" },
      { id: "f_growth", text: "I have watched you grow into a strong woman who rose to the demands of motherhood with courage and grace.", beat: "impact", status: "active" },
      { id: "f_gratitude", text: "This Mother's Day, I want you to know that I see you, I appreciate you, and I am deeply grateful.", beat: "meaning", status: "active" },
      { id: "f_location", text: "The relationship started in Okija and is still blooming in Perth.", beat: "scene", status: "active" },
      { id: "f_dream", text: "Life in Perth feels like watching a dream come true.", beat: "impact", status: "active" },
    ],
    atoms: {
      where: "Okija, Nigeria; Perth, Australia",
      when: "from when they first met to now",
      turn: "I will never forget the high-risk pregnancy of the twins.",
      action: "You keep track of appointments, think ahead about what everyone will eat, organise the home, and still manage the demands of work.",
      after: "This Mother's Day, I want you to know that I see you, I appreciate you, and I am deeply grateful.",
      physical: "bleeding and constant worry",
    },
    primitives: {
      turning_point: "I will never forget the high-risk pregnancy of the twins.",
      resolution: "Life in Perth feels like watching a dream come true.",
      theme: "Our relationship began in Okija and now blooms in Perth.",
    },
    song_map: {
      hook: "Chioma, you are the heart of our family, anchoring us from Okija to Perth.",
      verse1: ["You manage work, home, and four children."],
      chorus: ["Our relationship began in Okija and now blooms in Perth."],
      bridge: ["Seeing our life unfold here, it's like watching a dream come true."],
      verse2: [],
      key_lines: ["You are the heart of our family."],
    },
  };

  const repaired = v3Engine.__internal.ensureSemanticStoryIntegrity(state);

  assert.equal(repaired.semantic_story.can_confirm, true);
  assert.match(repaired.narrative_current, /strong woman|love and respect/i);
  assert.match(repaired.narrative_current, /real home|sacrifice|deeply grateful|motherhood/i);
  assert.doesNotMatch(repaired.song_map.chorus[0].idea, /blooms in perth/i);
  assert.match(repaired.song_map.chorus[0].idea, /real home|sacrifice|motherhood|grateful|appreciate/i);
  assert.doesNotMatch(repaired.song_map.bridge[0].idea, /dream come true/i);
  assert.match(repaired.song_map.bridge[0].idea, /strong woman|love and respect|grow into|become a mother/i);
});

test("resolveTurnDecision uses the semantic clarification prompt instead of a generic slot question", () => {
  const baseState = {
    ...createInitialState({
      recipientName: "Chioma",
      occasion: "mothers_day",
      initialPrompt: "Tell her how watching her become a mother changed what this love means to you.",
    }),
    turn_count: 3,
    narrative: "She carried the family through fear and became the heart of the home. Watching her become a mother changed everything and deepened love and respect.",
    narrative_current: "She carried the family through fear and became the heart of the home. Watching her become a mother changed everything and deepened love and respect.",
    facts: [
      { id: "f1", text: "She carried the family through fear and became the heart of the home.", beat: "context", status: "active" },
      { id: "f2", text: "Watching her become a mother changed everything and deepened love and respect.", beat: "meaning", status: "active" },
    ],
    primitives: {
      resolution: "Watching her become a mother changed everything and deepened love and respect.",
      theme: "She became the heart of the home.",
    },
    song_map: {
      chorus: [{ idea: "Watching her become a mother changed everything and deepened love and respect.", source_facts: ["f2"] }],
      verse1: [{ idea: "She carried the family through fear and became the heart of the home.", source_facts: ["f1"] }],
      bridge: [{ idea: "Watching her become a mother changed everything and deepened love and respect.", source_facts: ["f2"] }],
    },
  };

  const repaired = v3Engine.__internal.ensureSemanticStoryIntegrity(baseState);
  repaired.semantic_story = {
    ...repaired.semantic_story,
    can_confirm: false,
    missing_narrative_blocks: ["meaning"],
  };

  // Option C: semantic blocks no longer override the LLM's decision.
  // The LLM says CONFIRM — quality gates check turn count, narrative length, facts.
  // This state has turn_count=3, narrative > 100 chars, 2 facts → quality gates pass.
  const result = v3Engine.__internal.resolveTurnDecision({ action: "CONFIRM" }, repaired);
  assert.equal(result.response.action, "CONFIRM");
  // Semantic block is still tracked for analytics
  assert.equal(result.semanticBlock, true);
});

test("semantic clarification prompt uses concrete story context instead of a vague generic turn question", () => {
  const prompt = v3Engine.__internal.buildSemanticClarificationPrompt({
    recipient_name: "Sarah",
    atoms: {
      where: "the sunset picnic",
      when: "my birthday",
      turn: "",
    },
    primitives: {
      setting: {
        place: "the sunset picnic",
        time: "my birthday",
      },
    },
    facts: [
      { id: "f1", text: "Sarah planned a sunset picnic.", status: "active" },
      { id: "f2", text: "She brought handwritten notes from our friends.", status: "active" },
    ],
    semantic_story: {
      missing_narrative_blocks: ["turn"],
    },
  });

  assert.match(prompt.question, /sunset picnic/i);
  assert.match(prompt.question, /Sarah/i);
  assert.doesNotMatch(prompt.question, /what was the exact moment things changed\?/i);
  assert.ok(Array.isArray(prompt.suggestions));
  assert.ok(prompt.suggestions.some((suggestion) => /Sarah|turning point|what made it land/i.test(suggestion)));
});

test("getStoryContextV3 persists semantic repairs so lyrics see the stored repaired contract", async () => {
  const session = {
    id: "semantic_persist_story",
    engineVersion: "v3",
    occasion: "anniversary",
    arc: "celebration",
    style: "acoustic",
    version: 2,
    createdAt: "2026-03-07T00:00:00.000Z",
    updatedAt: "2026-03-07T00:00:00.000Z",
    v2State: {
      ...createInitialState({
        recipientName: "Maya",
        occasion: "anniversary",
        initialPrompt: [
          "We met on a late train after work and missed our stop because we were talking.",
          "When you lost your job, we lived out of suitcases for months.",
          "That winter changed everything and we decided to move anyway.",
          "You grew steadier and I learned what partnership really means.",
          "Now home feels like a promise we chose together.",
        ].join(" "),
      }),
      turn_count: 3,
      narrative: "We met on a late train after work. That winter changed everything.",
      narrative_current: "We met on a late train after work. That winter changed everything.",
      facts: [
        { id: "f_setup", text: "We met on a late train after work and missed our stop because we were talking.", beat: "scene", status: "active" },
        { id: "f_turn", text: "That winter changed everything and we decided to move anyway.", beat: "turning_point", status: "active" },
        { id: "f_transform", text: "You grew steadier and I learned what partnership really means.", beat: "impact", status: "active" },
        { id: "f_meaning", text: "Now home feels like a promise we chose together.", beat: "meaning", status: "active" },
      ],
      primitives: {
        turning_point: "That winter changed everything and we decided to move anyway.",
        resolution: "You grew steadier and I learned what partnership really means.",
        theme: "Now home feels like a promise we chose together.",
      },
      song_map: {
        chorus: ["Our trip now blooms across the map."],
      },
    },
  };

  let updatedPatch = null;
  const repo = {
    async getSession(sessionId) {
      return sessionId === session.id ? session : null;
    },
    async updateSession(sessionId, patch) {
      assert.equal(sessionId, session.id);
      updatedPatch = patch;
      session.v2State = patch.v2State;
      session.status = patch.status;
    },
  };

  v3Engine.initialize(repo);
  const context = await v3Engine.getStoryContextV3(session.id);

  assert.ok(updatedPatch, "semantic repairs should be persisted when getter repairs the state");
  assert.ok(Array.isArray(updatedPatch.v2State.song_map.chorus));
  assert.doesNotMatch(updatedPatch.v2State.song_map.chorus[0].idea, /blooms across the map/i);
  assert.equal(context.song_map.chorus[0].idea, updatedPatch.v2State.song_map.chorus[0].idea);
});
