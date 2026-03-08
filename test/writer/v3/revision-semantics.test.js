const test = require("node:test");
const assert = require("node:assert/strict");

const v3Engine = require("../../../src/writer/v3");
const { createInitialState, ensureStateDefaults } = require("../../../src/writer/v3/state");

test("ensureStateDefaults backfills explicit revision fields for legacy state", () => {
  const state = ensureStateDefaults(createInitialState({
    recipientName: "Vincent",
    occasion: "birthday",
    initialPrompt: "Tell his story.",
  }));

  assert.deepEqual(state.revision_requests, []);
  assert.equal(state.last_revision_request, null);
  assert.equal(state.pending_revision, null);
  assert.equal(state.draft_lifecycle, "drafting");
  assert.equal(state.reopen_count, 0);
});

test("addTurnToState preserves explicit revision metadata on conversation turns", () => {
  const base = createInitialState({
    recipientName: "Vincent",
    occasion: "birthday",
    initialPrompt: "Tell his story.",
  });

  const next = v3Engine.__internal.engine.addTurnToState(
    base,
    "user",
    "Change the ending so it focuses on resilience.",
    { kind: "revision_request", source: "review_edit" }
  );

  assert.equal(next.turn_count, 1);
  assert.equal(next.conversation.length, 1);
  assert.equal(next.conversation[0].kind, "revision_request");
  assert.equal(next.conversation[0].source, "review_edit");
});
