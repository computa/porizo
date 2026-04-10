const test = require("node:test");
const assert = require("node:assert/strict");

const v3Engine = require("../../../src/writer/v3");
const { createInitialState } = require("../../../src/writer/v3/state");

test("confirmStoryV3 throws typed guidance error and records semantic ask before blocking confirmation", async () => {
  const session = {
    id: "story_confirm_guidance",
    engineVersion: "v3",
    version: 1,
    createdAt: "2026-03-30T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z",
    v2State: {
      ...createInitialState({
        recipientName: "Chioma",
        occasion: "mothers_day",
        initialPrompt: "Tell her how seeing her become a mother changed what this love means to you.",
      }),
      turn_count: 1,
      narrative: "Chioma carried our family through a hard season.",
      narrative_current: "Chioma carried our family through a hard season.",
      facts: [
        { id: "f1", text: "Chioma carried our family through a hard season.", beat: "context", status: "active" },
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

  await assert.rejects(
    () => v3Engine.confirmStoryV3(session.id),
    (error) => {
      assert.equal(error.code, "STORY_NEEDS_INPUT");
      assert.match(error.question, /before i lock this in/i);
      assert.ok(Array.isArray(error.missingBlocks));
      assert.equal(error.sessionVersion, 2);
      return true;
    }
  );

  assert.ok(updatedPatch, "confirm guidance path should persist updated session state");
  assert.equal(updatedPatch.status, "active");
  assert.equal(updatedPatch.expectedVersion, 1);
  assert.equal(updatedPatch.v2State.status, "active");
  assert.equal(updatedPatch.v2State.draft_lifecycle, "drafting");
  assert.equal(updatedPatch.v2State.semantic_history.length, 1);
  assert.ok(updatedPatch.v2State.semantic_history[0].signature);
});

test("confirmStoryV3 honors explicit forceConfirm on a reviewable draft", async () => {
  const session = {
    id: "story_confirm_force_reviewable",
    engineVersion: "v3",
    version: 1,
    createdAt: "2026-03-30T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z",
    v2State: {
      ...createInitialState({
        recipientName: "Chioma",
        occasion: "mothers_day",
        initialPrompt: "Tell her how seeing her become a mother changed what this love means to you.",
      }),
      turn_count: 2,
      narrative: "Chioma carried our family through a hard season, and seeing her become a mother changed what love looked like to me.",
      narrative_current: "Chioma carried our family through a hard season, and seeing her become a mother changed what love looked like to me.",
      facts: [
        { id: "f1", text: "Chioma carried our family through a hard season.", beat: "context", status: "active" },
      ],
      semantic_story: {
        can_confirm: false,
        missing_narrative_blocks: ["transformation"],
      },
    },
  };

  const repo = {
    async getSession(sessionId) {
      return sessionId === session.id ? session : null;
    },
    async updateSession(sessionId, patch) {
      assert.equal(sessionId, session.id);
      session.v2State = patch.v2State;
      session.status = patch.status;
    },
  };

  v3Engine.initialize(repo);

  const result = await v3Engine.confirmStoryV3(session.id, { forceConfirm: true });
  assert.equal(result.status, "confirmed");
  assert.equal(result.readiness?.is_user_overridable, false);
});

test("confirmStoryV3 honors a standard confirmation tap on a reviewable draft with semantic gaps", async () => {
  const session = {
    id: "story_confirm_reviewable_no_force",
    engineVersion: "v3",
    version: 1,
    createdAt: "2026-03-30T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z",
    v2State: {
      ...createInitialState({
        recipientName: "Chioma",
        occasion: "mothers_day",
        initialPrompt: "Tell her how seeing her become a mother changed what this love means to you.",
      }),
      turn_count: 2,
      narrative:
        "Chioma carried our family through a hard season, and seeing her become a mother changed what love looked like to me.",
      narrative_current:
        "Chioma carried our family through a hard season, and seeing her become a mother changed what love looked like to me.",
      facts: [
        { id: "f1", text: "Chioma carried our family through a hard season.", beat: "context", status: "active" },
      ],
      semantic_story: {
        can_confirm: false,
        missing_narrative_blocks: ["transformation"],
      },
    },
  };

  const repo = {
    async getSession(sessionId) {
      return sessionId === session.id ? session : null;
    },
    async updateSession(sessionId, patch) {
      assert.equal(sessionId, session.id);
      session.v2State = patch.v2State;
      session.status = patch.status;
    },
  };

  v3Engine.initialize(repo);

  const result = await v3Engine.confirmStoryV3(session.id);
  assert.equal(result.status, "confirmed");
  assert.equal(result.readiness?.is_ready, true);
});
