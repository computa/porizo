/**
 * Unit tests for the artwork ↔ audio coordination barrier.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  markAudioReady,
  waitForArtworkReady,
  SQL_MARK_AUDIO_READY,
  SQL_CHECK_ARTWORK_READY,
} = require("../../src/workflows/artwork-barrier");

function makeDb({ artworkReadySequence = [false], throwOnCheck = false } = {}) {
  let checkCallIndex = 0;
  const calls = { markAudio: [], check: [] };
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
          async run(...args) {
            if (sql !== SQL_MARK_AUDIO_READY)
              throw new Error(`unexpected sql: ${sql}`);
            calls.markAudio.push(args);
            return { changes: 1 };
          },
        };
      },
    },
    calls,
  };
}

const SILENT = { info() {}, warn() {}, error() {} };

test("markAudioReady writes audio_ready=1 to the specified track_version", async () => {
  const { db, calls } = makeDb();
  await markAudioReady({ db, trackVersionId: "tv-1" });
  assert.equal(calls.markAudio.length, 1);
  assert.equal(calls.markAudio[0][0], 1);
  assert.equal(calls.markAudio[0][1], "tv-1");
});

test("markAudioReady validates inputs", async () => {
  await assert.rejects(
    () => markAudioReady({ trackVersionId: "tv-1" }),
    /requires db/,
  );
  await assert.rejects(() => markAudioReady({ db: {} }), /requires db/);
});

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
