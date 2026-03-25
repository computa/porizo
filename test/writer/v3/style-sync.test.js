const test = require("node:test");
const assert = require("node:assert/strict");

const v3Engine = require("../../../src/writer/v3");
const { createInitialState } = require("../../../src/writer/v3/state");

test("updateStoryStyleV3 persists normalized style into the session snapshot", async () => {
  const session = {
    id: "story_style_sync_v3",
    userId: "user_style_sync_v3",
    engineVersion: "v3",
    occasion: "birthday",
    arc: "celebration",
    style: "pop",
    createdAt: "2026-03-25T00:00:00.000Z",
    updatedAt: "2026-03-25T00:00:00.000Z",
    v2State: createInitialState({
      recipientName: "Gozie",
      occasion: "birthday",
      initialPrompt: "Tell me about the family moments that matter most.",
      style: "pop",
    }),
  };

  let capturedPatch = null;
  const repo = {
    async getSession(sessionId) {
      return sessionId === session.id ? session : null;
    },
    async updateSession(sessionId, patch) {
      assert.equal(sessionId, session.id);
      capturedPatch = patch;
      session.style = patch.style;
      session.v2State = patch.v2State;
      session.updatedAt = "2026-03-25T00:01:00.000Z";
      return session;
    },
  };

  v3Engine.initialize(repo);

  const result = await v3Engine.updateStoryStyleV3(session.id, "R&B");
  const snapshot = await v3Engine.getStorySessionV3(session.id);

  assert.equal(result.style, "rnb");
  assert.equal(capturedPatch.style, "rnb");
  assert.equal(capturedPatch.v2State.dials.style, "rnb");
  assert.equal(snapshot.style, "rnb");
});

test("updateStoryStyleV3 clears the persisted style when asked", async () => {
  const session = {
    id: "story_style_sync_invalid_v3",
    engineVersion: "v3",
    occasion: "birthday",
    arc: "celebration",
    style: "pop",
    createdAt: "2026-03-25T00:00:00.000Z",
    updatedAt: "2026-03-25T00:00:00.000Z",
    v2State: createInitialState({
      recipientName: "Gozie",
      occasion: "birthday",
      initialPrompt: "Tell me about the family moments that matter most.",
      style: "pop",
    }),
  };

  const repo = {
    async getSession(sessionId) {
      return sessionId === session.id ? session : null;
    },
    async updateSession(sessionId, patch) {
      assert.equal(sessionId, session.id);
      session.style = patch.style;
      session.v2State = patch.v2State;
      return session;
    },
  };

  v3Engine.initialize(repo);

  const result = await v3Engine.updateStoryStyleV3(session.id, null);
  const snapshot = await v3Engine.getStorySessionV3(session.id);

  assert.equal(result.style, null);
  assert.equal(snapshot.style, null);
  assert.equal(session.v2State.dials.style, null);
});
