/**
 * Unit tests for the artwork job handler.
 *
 * Covers DB I/O (mock prepare/get/run), retry semantics, tier branching,
 * moderation refusal fallback, idempotency skip, the artwork_ready flag,
 * and the effectiveTier rollup (admin_upgrade + expiry).
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runArtworkJob,
  enqueueArtworkJob,
  effectiveTierFromRow,
  MAX_ATTEMPTS,
  BACKOFF_MS,
  SQL_GET_TRACK,
  SQL_GET_LATEST_VERSION,
  SQL_GET_ENTITLEMENT,
  SQL_UPDATE_ARTWORK,
  SQL_MARK_ARTWORK_READY,
} = require("../../src/jobs/artwork-job");

// ---------- Mock DB ----------

function makeDb({
  track = null,
  version = { id: "tv-1" },
  entitlement = null,
  throwOn = {},
} = {}) {
  const calls = {
    getTrack: [],
    getLatestVersion: [],
    getEntitlement: [],
    updateArtwork: [],
    markReady: [],
  };

  const db = {
    prepare(sql) {
      return {
        async get(...args) {
          // Record the call BEFORE applying throwOn so retry tests can assert
          // how many attempts hit the DB even when each one rejects.
          if (sql === SQL_GET_TRACK) calls.getTrack.push(args);
          else if (sql === SQL_GET_LATEST_VERSION)
            calls.getLatestVersion.push(args);
          else if (sql === SQL_GET_ENTITLEMENT) calls.getEntitlement.push(args);
          if (throwOn.sql === sql) throw new Error(throwOn.error || "db error");
          if (sql === SQL_GET_TRACK) return track;
          if (sql === SQL_GET_LATEST_VERSION) return version;
          if (sql === SQL_GET_ENTITLEMENT) return entitlement;
          throw new Error(`Unexpected get() for sql: ${sql.slice(0, 60)}`);
        },
        async run(...args) {
          if (throwOn.sql === sql) throw new Error(throwOn.error || "db error");
          if (sql === SQL_UPDATE_ARTWORK) {
            calls.updateArtwork.push(args);
            return { changes: 1 };
          }
          if (sql === SQL_MARK_ARTWORK_READY) {
            calls.markReady.push(args);
            return { changes: 1 };
          }
          throw new Error(`Unexpected run() for sql: ${sql.slice(0, 60)}`);
        },
      };
    },
  };

  return { db, calls };
}

const SILENT_LOGGER = { info() {}, warn() {}, error() {} };

const SAMPLE_TRACK = {
  id: "t-1",
  user_id: "u-1",
  occasion: "birthday",
  recipient_name: "Sarah",
  style: "pop",
  artwork_content_hash: null,
};

const SAMPLE_RESULT = {
  skipped: false,
  artworkPath: "/tmp/artwork.jpg",
  artworkUrl: "/tracks/t-1/artwork.jpg?v=1700000000000",
  styleVariant: "paper-art",
  source: "library",
  provider: null,
  prompt: null,
  contentHash: "deadbeef",
  moderationPassed: true,
  generatedAt: new Date("2026-05-16T12:00:00Z"),
};

// Disable real backoff sleeps for retry-related tests
async function withFastBackoff(fn) {
  const SAVED = BACKOFF_MS.slice();
  BACKOFF_MS[0] = 1;
  BACKOFF_MS[1] = 1;
  BACKOFF_MS[2] = 1;
  try {
    return await fn();
  } finally {
    BACKOFF_MS[0] = SAVED[0];
    BACKOFF_MS[1] = SAVED[1];
    BACKOFF_MS[2] = SAVED[2];
  }
}

// ---------- Tests ----------

test("runArtworkJob persists result and marks artwork_ready on success", async () => {
  const { db, calls } = makeDb({
    track: SAMPLE_TRACK,
    entitlement: { tier: "free" },
  });
  let generateArgs = null;

  const result = await runArtworkJob({
    db,
    trackId: "t-1",
    logger: SILENT_LOGGER,
    generateFn: async (args) => {
      generateArgs = args;
      return SAMPLE_RESULT;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, undefined);
  assert.equal(generateArgs.userId, "u-1");
  assert.equal(generateArgs.trackId, "t-1");
  assert.equal(generateArgs.occasion, "birthday");
  assert.equal(generateArgs.recipientName, "Sarah");
  assert.equal(generateArgs.tier, "free");
  assert.equal(generateArgs.previousContentHash, null);

  assert.equal(calls.updateArtwork.length, 1);
  const updateArgs = calls.updateArtwork[0];
  assert.equal(updateArgs[0], SAMPLE_RESULT.artworkUrl);
  assert.equal(updateArgs[1], "paper-art");
  assert.equal(updateArgs[2], "library");
  assert.equal(updateArgs[5], "deadbeef");
  assert.equal(updateArgs[6], 1);
  assert.equal(updateArgs[8], "t-1");

  // markReady is now scoped by track_version_id, not track_id
  assert.equal(calls.markReady.length, 1);
  assert.equal(calls.markReady[0][0], 1);
  assert.equal(calls.markReady[0][1], "tv-1");
});

test("runArtworkJob respects an explicitly-passed trackVersionId", async () => {
  const { db, calls } = makeDb({
    track: SAMPLE_TRACK,
    entitlement: { tier: "free" },
    version: { id: "tv-WRONG" },
  });
  await runArtworkJob({
    db,
    trackId: "t-1",
    trackVersionId: "tv-explicit",
    logger: SILENT_LOGGER,
    generateFn: async () => SAMPLE_RESULT,
  });
  assert.equal(calls.markReady[0][1], "tv-explicit");
  // Latest-version lookup is skipped when caller passes the explicit ID
  assert.equal(calls.getLatestVersion.length, 0);
});

test("runArtworkJob honors content-hash skip — no update, but artwork_ready still set", async () => {
  const { db, calls } = makeDb({
    track: SAMPLE_TRACK,
    entitlement: { tier: "free" },
  });

  const result = await runArtworkJob({
    db,
    trackId: "t-1",
    logger: SILENT_LOGGER,
    generateFn: async () => ({ skipped: true, reason: "unchanged" }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(calls.updateArtwork.length, 0);
  assert.equal(calls.markReady.length, 1);
  assert.equal(calls.markReady[0][0], 1);
  assert.equal(calls.markReady[0][1], "tv-1");
});

test("runArtworkJob passes the effective tier from entitlements", async () => {
  const { db } = makeDb({
    track: SAMPLE_TRACK,
    entitlement: { tier: "pro" },
  });
  let observedTier = null;
  await runArtworkJob({
    db,
    trackId: "t-1",
    logger: SILENT_LOGGER,
    generateFn: async ({ tier }) => {
      observedTier = tier;
      return SAMPLE_RESULT;
    },
  });
  assert.equal(observedTier, "pro");
});

test("runArtworkJob honors admin_upgrade_tier when not expired", async () => {
  const { db } = makeDb({
    track: SAMPLE_TRACK,
    entitlement: {
      tier: "free",
      admin_upgrade_tier: "pro",
      admin_upgrade_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    },
  });
  let observedTier = null;
  await runArtworkJob({
    db,
    trackId: "t-1",
    logger: SILENT_LOGGER,
    generateFn: async ({ tier }) => {
      observedTier = tier;
      return SAMPLE_RESULT;
    },
  });
  assert.equal(observedTier, "pro");
});

test("runArtworkJob ignores expired admin_upgrade_tier", async () => {
  const { db } = makeDb({
    track: SAMPLE_TRACK,
    entitlement: {
      tier: "free",
      admin_upgrade_tier: "pro",
      admin_upgrade_expires_at: new Date(Date.now() - 1000).toISOString(),
    },
  });
  let observedTier = null;
  await runArtworkJob({
    db,
    trackId: "t-1",
    logger: SILENT_LOGGER,
    generateFn: async ({ tier }) => {
      observedTier = tier;
      return SAMPLE_RESULT;
    },
  });
  assert.equal(observedTier, "free");
});

test("runArtworkJob uses injected tierResolver when provided", async () => {
  const { db } = makeDb({ track: SAMPLE_TRACK, entitlement: null });
  let observedTier = null;
  await runArtworkJob({
    db,
    trackId: "t-1",
    logger: SILENT_LOGGER,
    tierResolver: async () => "pro",
    generateFn: async ({ tier }) => {
      observedTier = tier;
      return SAMPLE_RESULT;
    },
  });
  assert.equal(observedTier, "pro");
});

test("runArtworkJob falls back to free tier when entitlements row is missing", async () => {
  const { db } = makeDb({ track: SAMPLE_TRACK, entitlement: null });
  let observedTier = null;
  await runArtworkJob({
    db,
    trackId: "t-1",
    logger: SILENT_LOGGER,
    generateFn: async ({ tier }) => {
      observedTier = tier;
      return SAMPLE_RESULT;
    },
  });
  assert.equal(observedTier, "free");
});

test("runArtworkJob retries (not silently demotes) when entitlements query throws", async () => {
  // The previous behavior of silently dropping to free tier on a transient DB
  // hiccup was a paid-user cost regression. We now retry instead.
  await withFastBackoff(async () => {
    const { db, calls } = makeDb({
      track: SAMPLE_TRACK,
      throwOn: { sql: SQL_GET_ENTITLEMENT, error: "transient db error" },
    });
    let attempts = 0;
    const result = await runArtworkJob({
      db,
      trackId: "t-1",
      logger: SILENT_LOGGER,
      generateFn: async () => {
        attempts += 1;
        return SAMPLE_RESULT;
      },
    });
    assert.equal(result.ok, false);
    assert.equal(attempts, 0);
    assert.equal(calls.getEntitlement.length, MAX_ATTEMPTS);
  });
});

test("runArtworkJob returns {ok:false} when track is not found", async () => {
  const { db, calls } = makeDb({ track: null });
  const result = await runArtworkJob({
    db,
    trackId: "missing-track",
    logger: SILENT_LOGGER,
    generateFn: async () => SAMPLE_RESULT,
  });
  assert.equal(result.ok, false);
  assert.match(result.error.message, /not found/i);
  assert.equal(calls.updateArtwork.length, 0);
});

test("runArtworkJob retries on generation failure up to MAX_ATTEMPTS", async () => {
  await withFastBackoff(async () => {
    const { db, calls } = makeDb({
      track: SAMPLE_TRACK,
      entitlement: { tier: "free" },
    });
    let attempts = 0;
    const result = await runArtworkJob({
      db,
      trackId: "t-1",
      logger: SILENT_LOGGER,
      generateFn: async () => {
        attempts += 1;
        throw new Error("simulated provider failure");
      },
    });
    assert.equal(result.ok, false);
    assert.equal(attempts, MAX_ATTEMPTS);
    assert.match(result.error.message, /simulated provider failure/);
    assert.equal(calls.updateArtwork.length, 0);
    assert.equal(calls.markReady.length, 0);
  });
});

test("runArtworkJob skips retry chain on permanent errors", async () => {
  await withFastBackoff(async () => {
    const { db } = makeDb({
      track: SAMPLE_TRACK,
      entitlement: { tier: "free" },
    });
    let attempts = 0;
    const result = await runArtworkJob({
      db,
      trackId: "t-1",
      logger: SILENT_LOGGER,
      generateFn: async () => {
        attempts += 1;
        const err = new Error("Library missing");
        err.permanent = true;
        err.code = "LIBRARY_NOT_BOOTSTRAPPED";
        throw err;
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.permanent, true);
    assert.equal(attempts, 1);
  });
});

test("runArtworkJob succeeds after retry: 1st throws, 2nd returns", async () => {
  await withFastBackoff(async () => {
    const { db, calls } = makeDb({
      track: SAMPLE_TRACK,
      entitlement: { tier: "free" },
    });
    let attempts = 0;
    const result = await runArtworkJob({
      db,
      trackId: "t-1",
      logger: SILENT_LOGGER,
      generateFn: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("transient");
        return SAMPLE_RESULT;
      },
    });
    assert.equal(result.ok, true);
    assert.equal(attempts, 2);
    assert.equal(calls.updateArtwork.length, 1);
    assert.equal(calls.markReady.length, 1);
  });
});

test("runArtworkJob persists moderation_passed=false from result (fallback path)", async () => {
  const { db, calls } = makeDb({
    track: SAMPLE_TRACK,
    entitlement: { tier: "pro" },
  });
  await runArtworkJob({
    db,
    trackId: "t-1",
    logger: SILENT_LOGGER,
    generateFn: async () => ({
      ...SAMPLE_RESULT,
      source: "fallback",
      moderationPassed: false,
      provider: "openai",
      prompt: "a peony",
    }),
  });
  const args = calls.updateArtwork[0];
  assert.equal(args[2], "fallback");
  assert.equal(args[3], "openai");
  assert.equal(args[4], "a peony");
  assert.equal(args[6], 0);
});

test("runArtworkJob persists moderation_passed=null on non-moderation provider error", async () => {
  // A timeout or 5xx is NOT a moderation refusal — audit column should show
  // "unknown" rather than lying with true or implying false.
  const { db, calls } = makeDb({
    track: SAMPLE_TRACK,
    entitlement: { tier: "pro" },
  });
  await runArtworkJob({
    db,
    trackId: "t-1",
    logger: SILENT_LOGGER,
    generateFn: async () => ({
      ...SAMPLE_RESULT,
      source: "fallback",
      moderationPassed: null,
      provider: "openai",
      prompt: "a peony",
    }),
  });
  assert.equal(calls.updateArtwork[0][6], null);
});

test("runArtworkJob requires db and trackId", async () => {
  await assert.rejects(
    () => runArtworkJob({ trackId: "t-1" }),
    /requires db and trackId/,
  );
  await assert.rejects(
    () => runArtworkJob({ db: { prepare: () => ({}) } }),
    /requires db and trackId/,
  );
});

test("runArtworkJob returns {ok:false} when track lookup throws", async () => {
  const { db } = makeDb({
    throwOn: { sql: SQL_GET_TRACK, error: "connection refused" },
  });
  const result = await runArtworkJob({
    db,
    trackId: "t-1",
    logger: SILENT_LOGGER,
    generateFn: async () => SAMPLE_RESULT,
  });
  assert.equal(result.ok, false);
  assert.match(result.error.message, /connection refused/);
});

test("enqueueArtworkJob returns synchronously and isolates errors", async () => {
  const fakeDb = {
    prepare: () => ({
      get: async () => null,
      run: async () => ({}),
    }),
  };
  const before = Date.now();
  enqueueArtworkJob({
    db: fakeDb,
    trackId: "t-1",
    logger: SILENT_LOGGER,
  });
  const elapsed = Date.now() - before;
  assert.ok(
    elapsed < 50,
    `enqueueArtworkJob should return synchronously (took ${elapsed}ms)`,
  );
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 10));
});

// ---------- effectiveTierFromRow ----------

test("effectiveTierFromRow: null/missing row → free", () => {
  assert.equal(effectiveTierFromRow(null), "free");
  assert.equal(effectiveTierFromRow(undefined), "free");
});

test("effectiveTierFromRow: bare entitlement returns its tier", () => {
  assert.equal(effectiveTierFromRow({ tier: "pro" }), "pro");
  assert.equal(effectiveTierFromRow({ tier: "plus" }), "plus");
});

test("effectiveTierFromRow: admin_upgrade_tier overrides when not expired", () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal(
    effectiveTierFromRow({
      tier: "free",
      admin_upgrade_tier: "pro",
      admin_upgrade_expires_at: future,
    }),
    "pro",
  );
});

test("effectiveTierFromRow: expired admin_upgrade is ignored", () => {
  const past = new Date(Date.now() - 1000).toISOString();
  assert.equal(
    effectiveTierFromRow({
      tier: "free",
      admin_upgrade_tier: "pro",
      admin_upgrade_expires_at: past,
    }),
    "free",
  );
});

test("effectiveTierFromRow: admin_upgrade with null expiry is treated as permanent", () => {
  assert.equal(
    effectiveTierFromRow({
      tier: "free",
      admin_upgrade_tier: "pro",
      admin_upgrade_expires_at: null,
    }),
    "pro",
  );
});
