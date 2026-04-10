const test = require("node:test");
const assert = require("node:assert/strict");

const { __internal } = require("../../../src/writer/v3");

test("user-facing readiness treats ASK as reviewable instead of ready", () => {
  const state = {
    initial_prompt: "Sarah planned a sunset picnic and handed me notes from our friends after a brutal year.",
    turn_count: 1,
    narrative:
      "After a brutal year, Sarah planned a sunset picnic for you and handed you handwritten notes from friends. " +
      "You cried and felt seen again.",
  };

  const readiness = __internal.deriveUserFacingReadinessState({
    state,
    gapAnalysis: {
      isStoryReady: true,
      missingSlots: [],
      weakSlots: ["tone"],
    },
    responseAction: "ASK",
  });

  assert.equal(readiness.isReady, false);
  assert.equal(readiness.canProceedAnyway, true);
  assert.equal(readiness.recommendedNextAction, "review");
});

test("user-facing readiness only reports ready when the response action confirms", () => {
  const state = {
    narrative: "A complete story draft.",
    turn_count: 3,
  };

  const readiness = __internal.deriveUserFacingReadinessState({
    state,
    gapAnalysis: {
      isStoryReady: true,
      missingSlots: [],
      weakSlots: [],
    },
    responseAction: "CONFIRM",
  });

  assert.equal(readiness.isReady, true);
  assert.equal(readiness.canProceedAnyway, false);
  assert.equal(readiness.recommendedNextAction, "confirm");
});

test("ready payload downgrades remaining missing slots into advisory weak slots", () => {
  const payload = __internal.buildReadinessPayload({
    state: {
      narrative: "A real story draft with enough detail to review.",
      turn_count: 2,
    },
    gapAnalysis: {
      isStoryReady: true,
      storyMode: "default",
      readinessProfile: "complete_enough",
      readinessScore: 0.81,
      missingSlots: ["turn", "stakes"],
      weakSlots: ["ending_feel"],
    },
    elements: [],
    gapQuestion: {
      targetSlot: "turn",
      reason: "The turning point could still be sharper.",
      slotGuidance: "Name what changed in that moment.",
    },
    responseAction: "CONFIRM",
    decisionSource: "review_ready_override",
    hardBlockConfirm: false,
    criticalBlockingSlots: ["turn", "stakes"],
    blockedElements: ["turning_point"],
  });

  assert.equal(payload.is_ready, true);
  assert.deepEqual(payload.missing_slots, []);
  assert.deepEqual(payload.weak_slots, ["ending_feel", "turn", "stakes"]);
  assert.deepEqual(payload.blocked_slots, []);
  assert.deepEqual(payload.blocked_elements, []);
  assert.equal(payload.primary_gap, null);
});
