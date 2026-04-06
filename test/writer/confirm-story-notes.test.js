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
