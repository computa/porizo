const test = require("node:test");
const assert = require("node:assert/strict");

const writer = require("../../src/writer");
const v3Engine = require("../../src/writer/v3");

test("writer.confirmStory integrates additional notes before locking the draft", async () => {
  const originalReviseStoryV3 = v3Engine.reviseStoryV3;
  const originalConfirmStoryV3 = v3Engine.confirmStoryV3;

  const calls = [];
  writer.initWithRepository({
    async getSession(sessionId) {
      return { id: sessionId, engineVersion: "v3" };
    },
  });

  v3Engine.reviseStoryV3 = async (storyId, revisionRequest, options) => {
    calls.push({ kind: "revise", storyId, revisionRequest, options });
    return { action: "CONFIRM" };
  };
  v3Engine.confirmStoryV3 = async (storyId, options) => {
    calls.push({ kind: "confirm", storyId, options });
    return {
      narrative: "Updated narrative",
      completionScore: 100,
      engineVersion: "v3",
    };
  };

  try {
    const result = await writer.confirmStory("story_notes_1", "Add the Awka training years to the ending.");

    assert.equal(result.confirmed, true);
    assert.deepEqual(calls, [
      {
        kind: "revise",
        storyId: "story_notes_1",
        revisionRequest: "Add the Awka training years to the ending.",
        options: {
          source: "confirm_notes",
          operation: {
            type: "final_notes",
            target_type: "narrative",
          },
        },
      },
      {
        kind: "confirm",
        storyId: "story_notes_1",
        options: {
          additionalNotes: "Add the Awka training years to the ending.",
          forceConfirm: false,
        },
      },
    ]);
  } finally {
    v3Engine.reviseStoryV3 = originalReviseStoryV3;
    v3Engine.confirmStoryV3 = originalConfirmStoryV3;
  }
});

test("writer.confirmStory forwards explicit forceConfirm intent", async () => {
  const originalConfirmStoryV3 = v3Engine.confirmStoryV3;

  const calls = [];
  writer.initWithRepository({
    async getSession(sessionId) {
      return { id: sessionId, engineVersion: "v3" };
    },
  });

  v3Engine.confirmStoryV3 = async (storyId, options) => {
    calls.push({ storyId, options });
    return {
      narrative: "Updated narrative",
      completionScore: 82,
      engineVersion: "v3",
    };
  };

  try {
    const result = await writer.confirmStory("story_force_confirm_1", {
      forceConfirm: true,
    });

    assert.equal(result.confirmed, true);
    assert.deepEqual(calls, [
      {
        storyId: "story_force_confirm_1",
        options: {
          additionalNotes: undefined,
          forceConfirm: true,
        },
      },
    ]);
  } finally {
    v3Engine.confirmStoryV3 = originalConfirmStoryV3;
  }
});

test("writer.confirmStory runs song readiness preflight before locking song stories", async () => {
  const originalConfirmStoryV3 = v3Engine.confirmStoryV3;
  const originalGetStoryContextV3 = v3Engine.getStoryContextV3;
  let confirmCalled = false;

  writer.initWithRepository({
    async getSession(sessionId) {
      return { id: sessionId, engineVersion: "v3" };
    },
  });

  v3Engine.getStoryContextV3 = async () => ({
    recipientName: "Chioma",
    occasion: "birthday",
    style: "acoustic",
    initialPrompt: "Birthday song",
    narrative: "Chioma carried the family through a difficult season.",
    facts: [],
    beats: [],
    atoms: {},
    primitives: {},
    motifs: [],
    dials: {},
    song_map: null,
    completed_story_package: {
      prose: "Chioma carried the family through a difficult season.",
      retained_details: [
        {
          id: "twins_sacrifice",
          text: "She endured every discomfort and did everything possible to carry the twins safely.",
          required: true,
          category: "event",
        },
      ],
      detail_coverage_map: {
        stats: { requiredMissing: 1 },
        missingRequired: [
          {
            id: "twins_sacrifice",
            text: "She endured every discomfort and did everything possible to carry the twins safely.",
          },
        ],
      },
    },
  });
  v3Engine.confirmStoryV3 = async () => {
    confirmCalled = true;
    throw new Error("confirm should not run when song readiness fails");
  };

  try {
    await assert.rejects(
      () => writer.confirmStory("story_song_blocked", {
        forceConfirm: true,
        targetContentType: "song",
      }),
      (error) => {
        assert.equal(error.code, "STORY_NEEDS_INPUT");
        assert.match(error.question, /twins safely/i);
        assert.equal(error.songReadiness.ready, false);
        return true;
      }
    );
    assert.equal(confirmCalled, false);
  } finally {
    v3Engine.confirmStoryV3 = originalConfirmStoryV3;
    v3Engine.getStoryContextV3 = originalGetStoryContextV3;
  }
});

test("writer.confirmStory skips song readiness preflight for poem confirmations", async () => {
  const originalConfirmStoryV3 = v3Engine.confirmStoryV3;
  const originalGetStoryContextV3 = v3Engine.getStoryContextV3;
  let getContextCalled = false;

  writer.initWithRepository({
    async getSession(sessionId) {
      return { id: sessionId, engineVersion: "v3" };
    },
  });

  v3Engine.getStoryContextV3 = async () => {
    getContextCalled = true;
    throw new Error("song readiness should not run for poems");
  };
  v3Engine.confirmStoryV3 = async () => ({
    narrative: "Poem narrative",
    completionScore: 82,
    engineVersion: "v3",
  });

  try {
    const result = await writer.confirmStory("story_poem_confirm", {
      forceConfirm: true,
      targetContentType: "poem",
    });

    assert.equal(result.confirmed, true);
    assert.equal(getContextCalled, false);
  } finally {
    v3Engine.confirmStoryV3 = originalConfirmStoryV3;
    v3Engine.getStoryContextV3 = originalGetStoryContextV3;
  }
});

test("writer.confirmStory refuses to lock when the revision needs clarification", async () => {
  const originalReviseStoryV3 = v3Engine.reviseStoryV3;
  const originalConfirmStoryV3 = v3Engine.confirmStoryV3;

  writer.initWithRepository({
    async getSession(sessionId) {
      return { id: sessionId, engineVersion: "v3" };
    },
  });

  v3Engine.reviseStoryV3 = async () => ({
    action: "ASK",
    question: "Which part of the ending should change?",
  });
  v3Engine.confirmStoryV3 = async () => {
    throw new Error("confirm should not be called");
  };

  try {
    await assert.rejects(
      () => writer.confirmStory("story_notes_2", "Fix the ending."),
      (error) => error?.code === "STORY_REVISION_CLARIFY_REQUIRED"
        && error.message === "Which part of the ending should change?"
    );
  } finally {
    v3Engine.reviseStoryV3 = originalReviseStoryV3;
    v3Engine.confirmStoryV3 = originalConfirmStoryV3;
  }
});
