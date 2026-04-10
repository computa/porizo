const test = require("node:test");
const assert = require("node:assert/strict");

const v3Engine = require("../../../src/writer/v3");
const { createInitialState } = require("../../../src/writer/v3/state");

test("updateStoryStyleV3 persists normalized style into the session snapshot", { concurrency: false }, async () => {
  const session = {
    id: "story_style_sync_v3",
    userId: "user_style_sync_v3",
    engineVersion: "v3",
    occasion: "birthday",
    arc: "celebration",
    style: "pop",
    version: 1,
    createdAt: "2026-03-25T00:00:00.000Z",
    updatedAt: "2026-03-25T00:00:00.000Z",
    v2State: createInitialState({
      recipientName: "Gozie",
      occasion: "birthday",
      initialPrompt: "Tell me about the family moments that matter most.",
      style: "pop",
    }),
  };

  const capturedPatches = [];
  const repo = {
    async getSession(sessionId) {
      return sessionId === session.id ? session : null;
    },
    async updateSession(sessionId, patch) {
      assert.equal(sessionId, session.id);
      capturedPatches.push(patch);
      session.style = patch.style;
      session.v2State = patch.v2State;
      session.updatedAt = "2026-03-25T00:01:00.000Z";
      return session;
    },
  };

  v3Engine.initialize(repo);

  const result = await v3Engine.updateStoryStyleV3(session.id, "R&B");
  const snapshot = await v3Engine.getStorySessionV3(session.id);
  const stylePatch = capturedPatches.find((patch) => patch.style === "rnb");

  assert.equal(result.style, "rnb");
  assert.ok(stylePatch, "Expected an update patch that persisted the normalized style");
  assert.equal(stylePatch.v2State.dials.style, "rnb");
  assert.equal(snapshot.style, "rnb");
});

test("updateStoryStyleV3 clears the persisted style when asked", { concurrency: false }, async () => {
  const session = {
    id: "story_style_sync_invalid_v3",
    engineVersion: "v3",
    occasion: "birthday",
    arc: "celebration",
    style: "pop",
    version: 1,
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

test("confirmed session snapshots stay reviewable even when diagnostics still show remaining gaps", { concurrency: false }, async () => {
  const session = {
    id: "story_snapshot_gap_v3",
    userId: "user_snapshot_gap_v3",
    engineVersion: "v3",
    occasion: "birthday",
    arc: "celebration",
    style: null,
    version: 1,
    createdAt: "2026-04-10T00:00:00.000Z",
    updatedAt: "2026-04-10T00:00:00.000Z",
    v2State: createInitialState({
      recipientName: "Sarah",
      occasion: "birthday",
      initialPrompt: "She planned a sunset picnic and brought notes from our friends.",
    }),
  };

  session.v2State = {
    ...session.v2State,
    status: "confirmed",
    turn_count: 1,
    narrative:
      "Sarah planned a sunset picnic for my birthday and brought handwritten notes from our friends. " +
      "It felt warm and thoughtful, but I never shared the moment that changed everything.",
    facts: [
      { id: "f1", text: "Sarah planned a sunset picnic.", beat: "b1", status: "active" },
      { id: "f2", text: "She brought handwritten notes from our friends.", beat: "b2", status: "active" },
    ],
    atoms: {
      who: "Sarah",
      where: "sunset picnic",
      when: "my birthday",
      turn: "",
    },
    primitives: {
      characters: ["Sarah"],
      setting: { place: "sunset picnic", time: "my birthday" },
      turning_point: "",
    },
    event: { occasion: "birthday", type: "birthday" },
    semantic_story: {
      can_confirm: false,
      missing_narrative_blocks: ["turn", "stakes"],
    },
  };

  const repo = {
    async getSession(sessionId) {
      return sessionId === session.id ? session : null;
    },
    async updateSession(sessionId, patch) {
      assert.equal(sessionId, session.id);
      session.v2State = patch.v2State;
      session.status = patch.status || session.status;
      session.version = (session.version || 1) + 1;
      return session;
    },
  };

  v3Engine.initialize(repo);

  const snapshot = await v3Engine.getStorySessionV3(session.id);
  const context = await v3Engine.getStoryContextV3(session.id);

  assert.equal(snapshot.status, "confirmed");
  assert.equal(snapshot.readiness.is_ready, true);
  assert.deepEqual(snapshot.readiness.missing_slots, []);
  for (const slot of ["moment_destination", "want", "blocker", "stakes", "turn", "ending_feel"]) {
    assert.ok(snapshot.readiness.weak_slots.includes(slot), `snapshot should preserve ${slot} as an advisory gap`);
  }
  assert.equal(snapshot.readiness.recommended_next_action, "confirm");
  assert.equal(snapshot.readiness.primary_gap, null);

  assert.equal(context.status, "confirmed");
  assert.equal(context.readiness.is_ready, true);
  assert.deepEqual(context.readiness.missing_slots, []);
  for (const slot of ["moment_destination", "want", "blocker", "stakes", "turn", "ending_feel"]) {
    assert.ok(context.readiness.weak_slots.includes(slot), `context should preserve ${slot} as an advisory gap`);
  }
  assert.equal(context.readiness.recommended_next_action, "confirm");
  assert.equal(context.readiness.primary_gap, null);
});
