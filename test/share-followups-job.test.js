const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  listDueFollowups,
  processFollowupRow,
} = require("../src/jobs/share-followups-daily");

// Mock db mirroring the REAL adapter interface: prepare(sql).{all,get,run}(...params)
// with SPREAD params (not an array). The original bug called db.all(sql, [array]),
// which does not exist on this interface and threw "db.all is not a function" on
// every job run in production. These tests fail against that broken shape.
function makeMockDb() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        all: (...params) => {
          calls.push({ method: "all", sql, params });
          return [];
        },
        get: (...params) => {
          calls.push({ method: "get", sql, params });
          return undefined;
        },
        run: (...params) => {
          calls.push({ method: "run", sql, params });
          return { changes: 1 };
        },
      };
    },
  };
}

describe("share-followups job db integration", () => {
  test("listDueFollowups uses prepare().all with spread params", async () => {
    const db = makeMockDb();
    const rows = await listDueFollowups(
      db,
      new Date("2026-05-27T00:00:00.000Z"),
      50,
    );

    assert.deepEqual(rows, []);
    assert.equal(db.calls.length, 1);
    const call = db.calls[0];
    assert.equal(call.method, "all");
    assert.match(call.sql, /FROM share_followups/);
    // Spread params, in order — NOT a single array argument.
    assert.deepEqual(call.params, ["2026-05-27T00:00:00.000Z", 50]);
  });

  test("processFollowupRow marks rows with no sender email as skipped via prepare().run", async () => {
    const db = makeMockDb();
    const outcome = await processFollowupRow(db, {
      id: "sf_1",
      sender_email: null,
    });

    assert.equal(outcome, "skipped");
    assert.equal(db.calls.length, 1);
    const call = db.calls[0];
    assert.equal(call.method, "run");
    assert.match(call.sql, /skip_reason/);
    assert.deepEqual(call.params, ["no_sender_email", "sf_1"]);
  });

  test("processFollowupRow skips unsubscribed senders", async () => {
    const db = makeMockDb();
    const outcome = await processFollowupRow(db, {
      id: "sf_2",
      sender_email: "user@example.com",
      sender_unsubscribed_at: "2026-05-20T00:00:00.000Z",
    });

    assert.equal(outcome, "skipped");
    assert.deepEqual(db.calls[0].params, ["unsubscribed", "sf_2"]);
  });
});
