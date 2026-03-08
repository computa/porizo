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

  assert.equal(result.action, "CONFIRM");
  assert.equal(result.narrativeVersion, 1);
  assert.equal(result.integrationDelta?.narrative_rewritten, true);
  assert.equal(updatedPatch.status, "ready_for_confirm");
  assert.equal(updatedPatch.v2State.narrative_version, 1);
  assert.equal(updatedPatch.v2State.narrative_revisions.length, 1);
  assert.equal(updatedPatch.v2State.integration_history.length, 1);
  assert.equal(updatedPatch.v2State.last_integration_delta?.narrative_rewritten, true);
});
