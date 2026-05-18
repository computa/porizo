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
  recoverOrphanedArtworkJobs,
  effectiveTierFromRow,
  MAX_ATTEMPTS,
  BACKOFF_MS,
  SQL_GET_TRACK,
  SQL_GET_LATEST_VERSION,
  SQL_GET_VERSION_LYRICS,
  SQL_GET_ENTITLEMENT,
  SQL_UPDATE_ARTWORK,
  SQL_UPDATE_ARTWORK_VARS,
  SQL_MARK_ARTWORK_READY,
  SQL_INSERT_ARTWORK_JOB,
  SQL_MARK_JOB_RUNNING,
  SQL_MARK_JOB_COMPLETED,
  SQL_MARK_JOB_FAILED,
  SQL_REQUEUE_JOB,
  SQL_SELECT_ORPHANED_ARTWORK_JOBS,
} = require("../../src/jobs/artwork-job");

// ---------- Mock DB ----------

function makeDb({
  track = null,
  version = { id: "tv-1" },
  versionLyrics = null,
  entitlement = null,
  orphans = [],
  throwOn = {},
} = {}) {
  const calls = {
    getTrack: [],
    getLatestVersion: [],
    getVersionLyrics: [],
    getEntitlement: [],
    updateArtwork: [],
    updateArtworkVars: [],
    markReady: [],
    insertJob: [],
    markJobRunning: [],
    markJobCompleted: [],
    markJobFailed: [],
    requeueJob: [],
    selectOrphans: [],
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
          else if (sql === SQL_GET_VERSION_LYRICS)
            calls.getVersionLyrics.push(args);
          else if (sql === SQL_GET_ENTITLEMENT) calls.getEntitlement.push(args);
          if (throwOn.sql === sql) throw new Error(throwOn.error || "db error");
          if (sql === SQL_GET_TRACK) return track;
          if (sql === SQL_GET_LATEST_VERSION) return version;
          if (sql === SQL_GET_VERSION_LYRICS) return versionLyrics;
          if (sql === SQL_GET_ENTITLEMENT) return entitlement;
          throw new Error(`Unexpected get() for sql: ${sql.slice(0, 60)}`);
        },
        async all(...args) {
          if (sql === SQL_SELECT_ORPHANED_ARTWORK_JOBS) {
            calls.selectOrphans.push(args);
            if (throwOn.sql === sql) {
              throw new Error(throwOn.error || "db error");
            }
            return orphans;
          }
          throw new Error(`Unexpected all() for sql: ${sql.slice(0, 60)}`);
        },
        async run(...args) {
          if (throwOn.sql === sql) throw new Error(throwOn.error || "db error");
          if (sql === SQL_UPDATE_ARTWORK) {
            calls.updateArtwork.push(args);
            return { changes: 1 };
          }
          if (sql === SQL_UPDATE_ARTWORK_VARS) {
            calls.updateArtworkVars.push(args);
            return { changes: 1 };
          }
          if (sql === SQL_MARK_ARTWORK_READY) {
            calls.markReady.push(args);
            return { changes: 1 };
          }
          if (sql === SQL_INSERT_ARTWORK_JOB) {
            calls.insertJob.push(args);
            return { changes: 1 };
          }
          if (sql === SQL_MARK_JOB_RUNNING) {
            calls.markJobRunning.push(args);
            return { changes: 1 };
          }
          if (sql === SQL_MARK_JOB_COMPLETED) {
            calls.markJobCompleted.push(args);
            return { changes: 1 };
          }
          if (sql === SQL_MARK_JOB_FAILED) {
            calls.markJobFailed.push(args);
            return { changes: 1 };
          }
          if (sql === SQL_REQUEUE_JOB) {
            calls.requeueJob.push(args);
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
  // artwork_style_variant slot is null post-Task-7 (replaced by per-version
  // artwork_vars_json on track_versions).
  assert.equal(updateArgs[1], null);
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

test("runArtworkJob persists moderation_passed=false on non-moderation provider error", async () => {
  // Per migration 111, artwork_moderation_passed is NOT NULL. Non-moderation
  // failures (timeout, 5xx) now record false — `source='fallback'` plus the
  // provider/prompt audit columns capture the "didn't actually run" context.
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
  assert.equal(calls.updateArtwork[0][6], 0);
});

test("runArtworkJob persists artwork_source=fallback for validation fallback", async () => {
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
      prompt: "provider returned invalid artwork bytes",
    }),
  });

  const args = calls.updateArtwork[0];
  assert.equal(args[2], "fallback");
  assert.equal(args[3], "openai");
  assert.equal(args[4], "provider returned invalid artwork bytes");
  assert.equal(args[6], 0);
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
    trackVersionId: "tv-1",
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

test("enqueueArtworkJob is a no-op when trackVersionId is missing", async () => {
  const calls = [];
  const fakeDb = {
    prepare: () => ({
      get: async () => null,
      run: async (...args) => {
        calls.push(args);
        return {};
      },
    }),
  };
  enqueueArtworkJob({
    db: fakeDb,
    trackId: "t-1",
    logger: SILENT_LOGGER,
  });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.length, 0, "no DB writes when trackVersionId missing");
});

// ---------- Durable queue (jobs-table) ----------

test("runArtworkJob with jobId persists running → completed on success", async () => {
  const { db, calls } = makeDb({
    track: SAMPLE_TRACK,
    entitlement: { tier: "free" },
  });
  const generateFn = async () => SAMPLE_RESULT;
  const result = await runArtworkJob({
    db,
    trackId: SAMPLE_TRACK.id,
    trackVersionId: "tv-1",
    jobId: "job-1",
    generateFn,
    logger: SILENT_LOGGER,
  });
  assert.equal(result.ok, true);
  assert.equal(calls.markJobRunning.length, 1, "job marked running");
  assert.equal(calls.markJobRunning[0][2], "job-1");
  assert.equal(calls.markJobCompleted.length, 1, "job marked completed");
  assert.equal(calls.markJobCompleted[0][2], "job-1");
  assert.equal(calls.markJobFailed.length, 0);
});

test("runArtworkJob with jobId persists failed on permanent error", async () => {
  const { db, calls } = makeDb({
    track: SAMPLE_TRACK,
    entitlement: { tier: "pro" },
  });
  const permErr = new Error("library not bootstrapped");
  permErr.permanent = true;
  permErr.code = "LIBRARY_NOT_BOOTSTRAPPED";
  const generateFn = async () => {
    throw permErr;
  };
  const result = await runArtworkJob({
    db,
    trackId: SAMPLE_TRACK.id,
    trackVersionId: "tv-1",
    jobId: "job-2",
    generateFn,
    logger: SILENT_LOGGER,
  });
  assert.equal(result.ok, false);
  assert.equal(result.permanent, true);
  assert.equal(calls.markJobFailed.length, 1);
  assert.equal(calls.markJobFailed[0][0], "LIBRARY_NOT_BOOTSTRAPPED");
  assert.equal(calls.markJobCompleted.length, 0);
});

test("runArtworkJob without jobId does NOT touch the jobs table", async () => {
  const { db, calls } = makeDb({
    track: SAMPLE_TRACK,
    entitlement: { tier: "free" },
  });
  const generateFn = async () => SAMPLE_RESULT;
  await runArtworkJob({
    db,
    trackId: SAMPLE_TRACK.id,
    trackVersionId: "tv-1",
    generateFn,
    logger: SILENT_LOGGER,
  });
  assert.equal(calls.markJobRunning.length, 0);
  assert.equal(calls.markJobCompleted.length, 0);
  assert.equal(calls.markJobFailed.length, 0);
});

test("recoverOrphanedArtworkJobs scans and re-fires queued + stale rows", async () => {
  const orphans = [
    { id: "job-A", track_version_id: "tv-1", track_id: "t-1", attempts: 1 },
    { id: "job-B", track_version_id: "tv-2", track_id: "t-2", attempts: 0 },
  ];
  const { db, calls } = makeDb({ orphans });
  const result = await recoverOrphanedArtworkJobs({
    db,
    logger: SILENT_LOGGER,
  });
  assert.equal(result.recovered, 2);
  assert.equal(calls.selectOrphans.length, 1);
  // Two args: nowIso, staleCutoff
  assert.equal(calls.selectOrphans[0].length, 2);
});

test("recoverOrphanedArtworkJobs fails orphan rows whose track is missing", async () => {
  const orphans = [
    { id: "job-X", track_version_id: "tv-gone", track_id: null, attempts: 0 },
  ];
  const { db, calls } = makeDb({ orphans });
  const result = await recoverOrphanedArtworkJobs({
    db,
    logger: SILENT_LOGGER,
  });
  assert.equal(result.recovered, 1);
  assert.equal(calls.markJobFailed.length, 1);
  assert.equal(calls.markJobFailed[0][0], "ORPHAN_NO_TRACK");
});

test("recoverOrphanedArtworkJobs no-ops when no orphans", async () => {
  const { db, calls } = makeDb({ orphans: [] });
  const result = await recoverOrphanedArtworkJobs({
    db,
    logger: SILENT_LOGGER,
  });
  assert.equal(result.recovered, 0);
  assert.equal(calls.selectOrphans.length, 1);
});

test("recoverOrphanedArtworkJobs handles scan-query failure gracefully", async () => {
  const { db } = makeDb({
    throwOn: { sql: SQL_SELECT_ORPHANED_ARTWORK_JOBS, error: "db down" },
  });
  const result = await recoverOrphanedArtworkJobs({
    db,
    logger: SILENT_LOGGER,
  });
  assert.equal(result.recovered, 0);
});

test("recoverOrphanedArtworkJobs requires db", async () => {
  await assert.rejects(
    () => recoverOrphanedArtworkJobs({ logger: SILENT_LOGGER }),
    /requires db/,
  );
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

// ---------- Lyrics → artwork vars extraction (Task 8) ----------

test("runArtworkJob calls vars extractor and persists artwork_vars_json", async () => {
  const mothersDayTrack = {
    ...SAMPLE_TRACK,
    occasion: "mothers_day",
  };
  const { db, calls } = makeDb({
    track: mothersDayTrack,
    entitlement: { tier: "plus" },
    versionLyrics: {
      lyrics_json: JSON.stringify({ text: "I knew you as a young girl..." }),
    },
  });

  let extractorCalled = null;
  const fakeExtract = async ({ lyrics, occasion }) => {
    extractorCalled = { lyrics, occasion };
    return {
      species: "ranunculus",
      lighting: "morning_window",
      palette: "dusty_rose",
      density: "intimate_cluster",
      imperfection: "one outer petal slightly bruised at the tip",
      backdrop: "cream_cloud",
      picked_by: "haiku",
      picked_at: "2026-05-18T12:00:00Z",
    };
  };

  let generateArgs = null;
  const result = await runArtworkJob({
    db,
    trackId: "t-1",
    trackVersionId: "tv-vars-1",
    jobId: "job-vars-1",
    logger: SILENT_LOGGER,
    generateFn: async (args) => {
      generateArgs = args;
      return {
        skipped: false,
        artworkPath: "/tmp/x.jpg",
        artworkUrl: "/u/x.jpg",
        source: "generated",
        provider: "flux",
        prompt: "p",
        promptVersion: "v2.1.0-photoreal-flora",
        artworkVars: args.artworkVars,
        contentHash: "h",
        moderationPassed: true,
        generatedAt: new Date("2026-05-18T12:00:00Z"),
      };
    },
    extractVarsFn: fakeExtract,
    tierResolver: async () => "plus",
  });

  assert.equal(result.ok, true);
  // Extractor invoked with lyrics + occasion from the version row.
  assert.ok(extractorCalled, "extractor should have been called");
  assert.equal(extractorCalled.occasion, "mothers_day");
  assert.ok(
    extractorCalled.lyrics.includes("young girl"),
    `lyrics passed to extractor (got: ${extractorCalled.lyrics})`,
  );

  // generateFn receives artworkVars (not style).
  assert.equal(generateArgs.artworkVars.species, "ranunculus");
  assert.equal(generateArgs.artworkVars.lighting, "morning_window");
  assert.equal(generateArgs.artworkVars.picked_by, "haiku");
  assert.equal(
    generateArgs.style,
    undefined,
    "post-Task-7 generate shape no longer takes style",
  );

  // artwork_vars_json + artwork_provider + artwork_prompt_version persisted.
  assert.equal(calls.updateArtworkVars.length, 1);
  const [varsJsonArg, providerArg, promptVersionArg, versionIdArg] =
    calls.updateArtworkVars[0];
  const persisted = JSON.parse(varsJsonArg);
  assert.equal(persisted.species, "ranunculus");
  assert.equal(persisted.lighting, "morning_window");
  assert.equal(providerArg, "flux");
  assert.equal(promptVersionArg, "v2.1.0-photoreal-flora");
  assert.equal(versionIdArg, "tv-vars-1");
});

test("runArtworkJob falls back to occasion defaults when extractor throws", async () => {
  const { db, calls } = makeDb({
    track: { ...SAMPLE_TRACK, occasion: "birthday" },
    entitlement: { tier: "plus" },
    versionLyrics: {
      lyrics_json: JSON.stringify({ text: "happy day to you" }),
    },
  });

  let generateArgs = null;
  await runArtworkJob({
    db,
    trackId: "t-1",
    trackVersionId: "tv-fallback-1",
    logger: SILENT_LOGGER,
    extractVarsFn: async () => {
      throw new Error("haiku exploded");
    },
    generateFn: async (args) => {
      generateArgs = args;
      return {
        ...SAMPLE_RESULT,
        artworkVars: args.artworkVars,
        promptVersion: "v2.1.0-photoreal-flora",
      };
    },
    tierResolver: async () => "plus",
  });

  // Fallback marker on the picked_by slot tells us the catch-block ran.
  assert.equal(generateArgs.artworkVars.picked_by, "fallback_extractor_error");
  // Defaults are still a valid bounded-vocab pick (non-empty species).
  assert.ok(generateArgs.artworkVars.species);
  // The render still proceeded — vars row written.
  assert.equal(calls.updateArtworkVars.length, 1);
});
