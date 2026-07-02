/**
 * PostgreSQL Boot Connection Retry Tests
 *
 * Unit tests for waitForConnection() — the boot-time retry probe that keeps a
 * transient DB-connect timeout (e.g. Railway private-network readiness race)
 * from crash-looping the whole backend at startup.
 *
 * These are pure unit tests: no Docker, no real Postgres. The DB probe and the
 * sleep function are injected so retry/backoff behavior can be asserted
 * deterministically.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");

const { waitForConnection } = require("../../src/database/postgres.js");

function makeDb(behaviors) {
  // behaviors: array of 'ok' | Error; consumed one per query() call
  let call = 0;
  return {
    queryCalls: () => call,
    async query() {
      const behavior = behaviors[Math.min(call, behaviors.length - 1)];
      call += 1;
      if (behavior instanceof Error) throw behavior;
      return { rows: [{ ok: 1 }] };
    },
  };
}

describe("waitForConnection", () => {
  test("resolves immediately when first probe succeeds", async () => {
    const db = makeDb(["ok"]);
    const sleeps = [];
    await waitForConnection(db, {
      maxAttempts: 5,
      sleep: async (ms) => sleeps.push(ms),
    });
    assert.strictEqual(db.queryCalls(), 1, "should probe exactly once");
    assert.strictEqual(
      sleeps.length,
      0,
      "should not sleep when first probe succeeds",
    );
  });

  test("retries then succeeds after transient failures", async () => {
    const timeout = new Error(
      "Connection terminated due to connection timeout",
    );
    const db = makeDb([timeout, timeout, "ok"]);
    const sleeps = [];
    await waitForConnection(db, {
      maxAttempts: 5,
      baseDelayMs: 100,
      sleep: async (ms) => sleeps.push(ms),
    });
    assert.strictEqual(db.queryCalls(), 3, "should probe until it succeeds");
    assert.strictEqual(
      sleeps.length,
      2,
      "should sleep between the failed attempts",
    );
  });

  test("applies exponential backoff capped at maxDelayMs", async () => {
    const err = new Error("timeout");
    const db = makeDb([err, err, err, "ok"]);
    const sleeps = [];
    await waitForConnection(db, {
      maxAttempts: 10,
      baseDelayMs: 100,
      maxDelayMs: 250,
      sleep: async (ms) => sleeps.push(ms),
    });
    // 100, 200, then capped at 250
    assert.deepStrictEqual(sleeps, [100, 200, 250]);
  });

  test("throws the last error after exhausting maxAttempts", async () => {
    const err = new Error("Connection terminated due to connection timeout");
    const db = makeDb([err]); // always fails
    const sleeps = [];
    await assert.rejects(
      waitForConnection(db, {
        maxAttempts: 3,
        baseDelayMs: 10,
        sleep: async (ms) => sleeps.push(ms),
      }),
      /connection timeout/,
    );
    assert.strictEqual(
      db.queryCalls(),
      3,
      "should probe exactly maxAttempts times",
    );
    assert.strictEqual(
      sleeps.length,
      2,
      "should sleep between attempts but not after the last",
    );
  });

  test("defaults are sane (does not require any options)", async () => {
    const db = makeDb(["ok"]);
    await assert.doesNotReject(
      waitForConnection(db, { sleep: async () => {} }),
    );
  });
});
