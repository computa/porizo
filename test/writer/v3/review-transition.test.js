const test = require("node:test");
const assert = require("node:assert/strict");

const v3Engine = require("../../../src/writer/v3");
const { createInitialState } = require("../../../src/writer/v3/state");

test("prepareStoryReviewV3 versions the first canonical draft it synthesizes", async () => {
  const session = {
    id: "story_review_versioning",
    engineVersion: "v3",
    occasion: "birthday",
    arc: "celebration",
    style: "pop",
    version: 1,
    createdAt: "2026-03-07T00:00:00.000Z",
    updatedAt: "2026-03-07T00:00:00.000Z",
    v2State: createInitialState({
      recipientName: "Vincent",
      occasion: "birthday",
      initialPrompt: "Tell him how those Awka days shaped who he became.",
    }),
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

  const result = await v3Engine.prepareStoryReviewV3(session.id);

  assert.ok(["ASK", "CONFIRM"].includes(result.action));
  assert.equal(result.narrativeVersion, 1);
  assert.equal(result.integrationDelta?.narrative_rewritten, true);
  assert.ok(["active", "ready_for_confirm"].includes(updatedPatch.status));
  assert.equal(updatedPatch.v2State.narrative_version, 1);
  assert.equal(updatedPatch.v2State.narrative_revisions.length, 1);
  assert.equal(updatedPatch.v2State.integration_history.length, 1);
  assert.equal(updatedPatch.v2State.last_integration_delta?.narrative_rewritten, true);
});

test("prepareStoryReviewV3 escapes repeated semantic review loops after the targeted ask has already been shown", async () => {
  const baseState = createInitialState({
    recipientName: "Vincent",
    occasion: "birthday",
    initialPrompt: "We met on a night train and I still remember the station lights.",
  });
  const semanticProbe = v3Engine.__internal.ensureSemanticStoryIntegrity({
    ...baseState,
    narrative: "We met on a night train and I still remember the station lights.",
    narrative_current: "We met on a night train and I still remember the station lights.",
  });
  const signature = v3Engine.__internal.buildSemanticBlockSignature(semanticProbe.semantic_story);

  const session = {
    id: "story_review_semantic_escape",
    engineVersion: "v3",
    occasion: "birthday",
    arc: "celebration",
    style: "pop",
    version: 1,
    createdAt: "2026-03-07T00:00:00.000Z",
    updatedAt: "2026-03-07T00:00:00.000Z",
    v2State: {
      ...baseState,
      narrative: "We met on a night train and I still remember the station lights.",
      narrative_current: "We met on a night train and I still remember the station lights.",
      semantic_history: [
        {
          signature,
          turn: 1,
          asked_at: "2026-03-07T00:00:00.000Z",
        },
      ],
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
  const result = await v3Engine.prepareStoryReviewV3(session.id);

  assert.equal(result.action, "CONFIRM");
  assert.equal(updatedPatch.status, "ready_for_confirm");
  assert.equal(updatedPatch.v2State.semantic_story.exhaustion_override, true);
});
