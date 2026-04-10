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

test("prepareStoryReviewV3 keeps a substantial draft reviewable even when semantic diagnostics still want one more detail", async () => {
  const session = {
    id: "story_review_reviewable_gap",
    engineVersion: "v3",
    occasion: "birthday",
    arc: "celebration",
    style: "pop",
    version: 1,
    createdAt: "2026-04-10T00:00:00.000Z",
    updatedAt: "2026-04-10T00:00:00.000Z",
    v2State: {
      ...createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "She planned a sunset picnic and brought notes from our friends.",
      }),
      turn_count: 2,
      narrative:
        "Sarah planned a sunset picnic for my birthday and brought handwritten notes from our friends. " +
        "It felt warm and thoughtful, even though I still haven't fully named the turning point.",
      narrative_current:
        "Sarah planned a sunset picnic for my birthday and brought handwritten notes from our friends. " +
        "It felt warm and thoughtful, even though I still haven't fully named the turning point.",
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
      facts: [
        { id: "f1", text: "Sarah planned a sunset picnic.", status: "active" },
        { id: "f2", text: "She brought handwritten notes from our friends.", status: "active" },
      ],
      semantic_story: {
        can_confirm: false,
        missing_narrative_blocks: ["turn"],
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
  const result = await v3Engine.prepareStoryReviewV3(session.id);

  assert.equal(result.action, "CONFIRM");
  assert.equal(updatedPatch.status, "ready_for_confirm");
  assert.equal(result.readiness.is_ready, true);
  assert.equal(result.readiness.recommended_next_action, "confirm");
});
