const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  FOLLOWUP_STAGES,
  computeFollowupSchedule,
  pickDueFollowups,
  getStageCopy,
} = require("../src/services/share-followup-service");

describe("share follow-up service", () => {
  test("schedule covers three stages with monotonically increasing send times", () => {
    const created = new Date("2026-05-22T12:00:00.000Z");
    const scheduled = computeFollowupSchedule(created);

    assert.equal(scheduled.length, 3);
    assert.deepEqual(
      scheduled.map((s) => s.stage),
      ["sender_24h", "sender_72h", "sender_7d"],
    );

    for (let i = 1; i < scheduled.length; i++) {
      assert.ok(
        scheduled[i].sendAt.getTime() > scheduled[i - 1].sendAt.getTime(),
        `stage ${scheduled[i].stage} must be after ${scheduled[i - 1].stage}`,
      );
    }
  });

  test("sendAt offsets match the documented schedule", () => {
    const created = new Date("2026-05-22T12:00:00.000Z");
    const [s24, s72, s7d] = computeFollowupSchedule(created);

    assert.equal(s24.sendAt.toISOString(), "2026-05-23T12:00:00.000Z");
    assert.equal(s72.sendAt.toISOString(), "2026-05-25T12:00:00.000Z");
    assert.equal(s7d.sendAt.toISOString(), "2026-05-29T12:00:00.000Z");
  });

  test("accepts string and numeric timestamps", () => {
    const expected = new Date("2026-05-23T12:00:00.000Z").toISOString();
    const fromString = computeFollowupSchedule(
      "2026-05-22T12:00:00.000Z",
    )[0].sendAt.toISOString();
    const fromNumber = computeFollowupSchedule(
      Date.parse("2026-05-22T12:00:00.000Z"),
    )[0].sendAt.toISOString();

    assert.equal(fromString, expected);
    assert.equal(fromNumber, expected);
  });

  test("invalid input raises TypeError instead of silently degrading", () => {
    assert.throws(() => computeFollowupSchedule(null), {
      name: "TypeError",
    });
    assert.throws(() => computeFollowupSchedule("not-a-date"), {
      name: "TypeError",
    });
  });

  test("skipStages option drops named stages without renumbering the rest", () => {
    const scheduled = computeFollowupSchedule("2026-05-22T12:00:00.000Z", {
      skipStages: ["sender_72h"],
    });
    assert.deepEqual(
      scheduled.map((s) => s.stage),
      ["sender_24h", "sender_7d"],
    );
  });

  test("pickDueFollowups returns only entries whose sendAt has passed", () => {
    const created = new Date("2026-05-22T12:00:00.000Z");
    const scheduled = computeFollowupSchedule(created);

    // 30 hours after creation: the 24h stage is due, 72h and 7d are not
    const now = new Date("2026-05-23T18:00:00.000Z");
    const due = pickDueFollowups(scheduled, now);

    assert.equal(due.length, 1);
    assert.equal(due[0].stage, "sender_24h");
  });

  test("getStageCopy returns the canonical copy bundle for a known stage", () => {
    const copy = getStageCopy("sender_24h");
    assert.ok(copy);
    assert.ok(copy.subject.length > 0);
    assert.ok(copy.cta.length > 0);
    assert.ok(copy.ctaPath.length > 0);
  });

  test("getStageCopy returns null for an unknown stage", () => {
    assert.equal(getStageCopy("sender_99d"), null);
    assert.equal(getStageCopy(""), null);
  });

  test("FOLLOWUP_STAGES export is the source of truth (frozen)", () => {
    assert.ok(Object.isFrozen(FOLLOWUP_STAGES));
    assert.ok(Object.isFrozen(FOLLOWUP_STAGES[0]));
    assert.throws(() => {
      FOLLOWUP_STAGES.push({ stage: "intruder" });
    });
  });
});
