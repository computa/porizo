/**
 * Unit tests for the artwork ↔ audio coordination barrier.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  waitForArtworkReady,
  notifyArtworkReady,
  SQL_CHECK_ARTWORK_READY,
  _resetListenerForTests,
} = require("../../src/workflows/artwork-barrier");
const { EventEmitter } = require("events");

function makeDb({ artworkReadySequence = [false], throwOnCheck = false } = {}) {
  let checkCallIndex = 0;
  const calls = { check: [] };
  return {
    db: {
      prepare(sql) {
        return {
          async get() {
            if (sql !== SQL_CHECK_ARTWORK_READY)
              throw new Error(`unexpected sql: ${sql}`);
            if (throwOnCheck) throw new Error("db error");
            const v =
              artworkReadySequence[
                Math.min(checkCallIndex, artworkReadySequence.length - 1)
              ];
            checkCallIndex += 1;
            calls.check.push(v);
            return { artwork_ready: v ? 1 : 0 };
          },
        };
      },
    },
    calls,
  };
}

const SILENT = { info() {}, warn() {}, error() {} };

test("waitForArtworkReady returns true immediately when artwork is already ready", async () => {
  const { db, calls } = makeDb({ artworkReadySequence: [true] });
  const start = Date.now();
  const got = await waitForArtworkReady({
    db,
    trackVersionId: "tv-1",
    logger: SILENT,
    sleepFn: async () => {},
  });
  const elapsed = Date.now() - start;
  assert.equal(got, true);
  assert.equal(calls.check.length, 1);
  assert.ok(elapsed < 50, `should return immediately (took ${elapsed}ms)`);
});

test("waitForArtworkReady returns true after polling — sequence: false, false, true", async () => {
  const { db, calls } = makeDb({ artworkReadySequence: [false, false, true] });
  let sleepCalls = 0;
  const got = await waitForArtworkReady({
    db,
    trackVersionId: "tv-1",
    timeoutMs: 10_000,
    pollMs: 5,
    logger: SILENT,
    sleepFn: async () => {
      sleepCalls += 1;
    },
  });
  assert.equal(got, true);
  assert.equal(calls.check.length, 3);
  assert.equal(sleepCalls, 2);
});

test("waitForArtworkReady returns false when timeout elapses", async () => {
  const { db } = makeDb({ artworkReadySequence: [false] });
  const got = await waitForArtworkReady({
    db,
    trackVersionId: "tv-1",
    timeoutMs: 30,
    pollMs: 10,
    logger: SILENT,
    sleepFn: async (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  assert.equal(got, false);
});

test("waitForArtworkReady returns false when query throws", async () => {
  const { db } = makeDb({ throwOnCheck: true });
  const got = await waitForArtworkReady({
    db,
    trackVersionId: "tv-1",
    logger: SILENT,
    sleepFn: async () => {},
  });
  assert.equal(got, false);
});

test("waitForArtworkReady requires db and trackVersionId", async () => {
  await assert.rejects(
    () => waitForArtworkReady({ trackVersionId: "tv-1" }),
    /requires db/,
  );
  await assert.rejects(() => waitForArtworkReady({ db: {} }), /requires db/);
});

// ---------- PG LISTEN/NOTIFY path ----------

function makePgDb({ initialReady = false } = {}) {
  // Fake pg pool: connect() returns a client that records LISTEN and supports
  // emitting notifications via the returned `emit` helper.
  const client = new EventEmitter();
  client.queries = [];
  client.released = false;
  client.query = async (sql, params) => {
    client.queries.push({ sql, params });
    return { rows: [] };
  };
  client.release = () => {
    client.released = true;
  };
  const pool = {
    connect: async () => client,
  };
  let ready = initialReady;
  const db = {
    isPostgres: true,
    _pool: pool,
    prepare(sql) {
      return {
        async get() {
          if (sql === SQL_CHECK_ARTWORK_READY) {
            return { artwork_ready: ready ? 1 : 0 };
          }
          // notifyArtworkReady() runs `SELECT pg_notify('artwork_ready', ?)`
          if (sql.includes("pg_notify")) {
            return { notified: 1 };
          }
          throw new Error(`unexpected sql: ${sql}`);
        },
      };
    },
  };
  return {
    db,
    client,
    setReady(v) {
      ready = v;
    },
  };
}

test("waitForArtworkReady (PG path) returns true immediately when row is already ready", async () => {
  _resetListenerForTests();
  const { db } = makePgDb({ initialReady: true });
  const got = await waitForArtworkReady({
    db,
    trackVersionId: "tv-pg-1",
    timeoutMs: 5_000,
    logger: SILENT,
  });
  assert.equal(got, true);
  _resetListenerForTests();
});

test("waitForArtworkReady (PG path) wakes on NOTIFY before timeout", async () => {
  _resetListenerForTests();
  const { db, client } = makePgDb({ initialReady: false });
  const promise = waitForArtworkReady({
    db,
    trackVersionId: "tv-pg-2",
    timeoutMs: 5_000,
    logger: SILENT,
  });
  // Give ensureListener a microtask to wire up before firing the NOTIFY.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  client.emit("notification", {
    channel: "artwork_ready",
    payload: "tv-pg-2",
  });
  const got = await promise;
  assert.equal(got, true);
  _resetListenerForTests();
});

test("waitForArtworkReady (PG path) ignores NOTIFY for a different track_version_id", async () => {
  _resetListenerForTests();
  const { db, client } = makePgDb({ initialReady: false });
  const promise = waitForArtworkReady({
    db,
    trackVersionId: "tv-pg-mine",
    timeoutMs: 100,
    logger: SILENT,
  });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  client.emit("notification", {
    channel: "artwork_ready",
    payload: "tv-pg-other",
  });
  const got = await promise;
  assert.equal(got, false, "should timeout — NOTIFY was for a different vid");
  _resetListenerForTests();
});

test("waitForArtworkReady (PG path) resolves false even if the deadline DB recheck throws", async () => {
  _resetListenerForTests();
  // PG db whose check query throws — exercises the try/catch around the
  // deadline recheck so the outer promise still resolves (regression: a
  // throw here previously left waitForArtworkReady hung forever).
  const client = new EventEmitter();
  client.queries = [];
  client.query = async () => ({ rows: [] });
  client.release = () => {};
  const db = {
    isPostgres: true,
    _pool: { connect: async () => client },
    prepare(sql) {
      return {
        async get() {
          if (sql === SQL_CHECK_ARTWORK_READY) throw new Error("db down");
          throw new Error(`unexpected sql ${sql}`);
        },
      };
    },
  };
  const got = await waitForArtworkReady({
    db,
    trackVersionId: "tv-pg-throw",
    timeoutMs: 30,
    logger: SILENT,
  });
  assert.equal(got, false, "must still resolve after deadline-recheck throw");
  _resetListenerForTests();
});

test("waitForArtworkReady (PG path) does a final DB check at deadline (covers dropped NOTIFY)", async () => {
  _resetListenerForTests();
  const ctx = makePgDb({ initialReady: false });
  const promise = waitForArtworkReady({
    db: ctx.db,
    trackVersionId: "tv-pg-3",
    timeoutMs: 50,
    logger: SILENT,
  });
  // Flip ready AFTER timeout starts but never emit NOTIFY — the deadline
  // recheck should catch it.
  setTimeout(() => ctx.setReady(true), 20);
  const got = await promise;
  assert.equal(got, true, "deadline recheck should find ready=true");
  _resetListenerForTests();
});

test("notifyArtworkReady is a no-op on non-Postgres db", async () => {
  let called = false;
  const db = {
    isPostgres: false,
    prepare() {
      return {
        async get() {
          called = true;
          return {};
        },
      };
    },
  };
  await notifyArtworkReady({ db, trackVersionId: "tv-sqlite", logger: SILENT });
  assert.equal(called, false, "no SQL executed when not PG");
});

test("notifyArtworkReady issues pg_notify on PG and swallows errors", async () => {
  let queryArg = null;
  const dbOk = {
    isPostgres: true,
    prepare(sql) {
      return {
        async get(arg) {
          queryArg = { sql, arg };
          return { notified: 1 };
        },
      };
    },
  };
  await notifyArtworkReady({
    db: dbOk,
    trackVersionId: "tv-pg-notify",
    logger: SILENT,
  });
  assert.ok(queryArg, "pg_notify should be invoked");
  assert.ok(queryArg.sql.includes("pg_notify"));
  assert.equal(queryArg.arg, "tv-pg-notify");

  // Errors must not throw — the row update is the source of truth.
  const dbFail = {
    isPostgres: true,
    prepare() {
      return {
        async get() {
          throw new Error("pg down");
        },
      };
    },
  };
  await assert.doesNotReject(() =>
    notifyArtworkReady({
      db: dbFail,
      trackVersionId: "tv-pg-fail",
      logger: SILENT,
    }),
  );
});

test("waitForArtworkReady treats boolean true, integer 1, string '1', 't', 'true' as ready", async () => {
  // Subtle but real: PG returns true; SQLite returns 1; some shims return strings.
  const values = [true, 1, "1", "t", "true"];
  for (const v of values) {
    const db = {
      prepare() {
        return {
          async get() {
            return { artwork_ready: v };
          },
          async run() {
            return { changes: 1 };
          },
        };
      },
    };
    const got = await waitForArtworkReady({
      db,
      trackVersionId: "tv-1",
      logger: SILENT,
      sleepFn: async () => {},
    });
    assert.equal(
      got,
      true,
      `value ${JSON.stringify(v)} should be treated as ready`,
    );
  }
});
