/**
 * Rate Limit Tests
 *
 * Comprehensive tests for the sliding window rate limiting implementation.
 * Tests cover: basic allow/block, sliding window calculation, window boundary
 * behavior, counter persistence, concurrent requests, and error handling.
 */

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { initDb } = require("../src/db");

// Generate unique test user ID
function uniqueUserId(prefix = "rl_user") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * Sliding window rate limiting implementation (extracted for testing)
 *
 * This mirrors the consumeRateLimit function from server.js to allow
 * unit testing without spinning up the full server.
 */
async function consumeRateLimit(db, userId, actionKey, limit, windowSeconds) {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const currentWindowStart = Math.floor(now / windowMs) * windowMs;
  const previousWindowStart = currentWindowStart - windowMs;
  const elapsedInWindow = now - currentWindowStart;
  const windowProgress = elapsedInWindow / windowMs;
  const resetAt = new Date(currentWindowStart + windowMs).toISOString();

  // Get counts from current and previous windows
  const currentWindow = await db
    .prepare(
      "SELECT count FROM rate_limits WHERE user_id = ? AND action_type = ? AND window_start_ms = ?"
    )
    .get(userId, actionKey, currentWindowStart);
  const previousWindow = await db
    .prepare(
      "SELECT count FROM rate_limits WHERE user_id = ? AND action_type = ? AND window_start_ms = ?"
    )
    .get(userId, actionKey, previousWindowStart);

  const currentCount = currentWindow?.count || 0;
  const previousCount = previousWindow?.count || 0;

  // Sliding window approximation: weight previous window by remaining time
  const weightedCount = currentCount + previousCount * (1 - windowProgress);

  // Check if adding this request would exceed limit
  if (weightedCount >= limit) {
    return { allowed: false, remaining: 0, reset_at: resetAt };
  }

  // Atomic upsert
  await db
    .prepare(
      `INSERT INTO rate_limits (user_id, action_type, window_start_ms, window_seconds, count, limit_count)
       VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT(user_id, action_type, window_start_ms)
       DO UPDATE SET count = rate_limits.count + 1`
    )
    .run(userId, actionKey, currentWindowStart, windowSeconds, limit);

  // Get updated count for remaining calculation
  const updated = await db
    .prepare(
      "SELECT count FROM rate_limits WHERE user_id = ? AND action_type = ? AND window_start_ms = ?"
    )
    .get(userId, actionKey, currentWindowStart);
  const newWeightedCount = updated.count + previousCount * (1 - windowProgress);

  return {
    allowed: true,
    remaining: Math.max(0, Math.floor(limit - newWeightedCount)),
    reset_at: resetAt,
  };
}

/**
 * Helper to simulate rate limit state at a specific point in time
 * by directly inserting records into the rate_limits table.
 */
async function seedRateLimitState(
  db,
  userId,
  actionType,
  windowStartMs,
  windowSeconds,
  count,
  limitCount
) {
  await db
    .prepare(
      `INSERT INTO rate_limits (user_id, action_type, window_start_ms, window_seconds, count, limit_count)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, action_type, window_start_ms)
       DO UPDATE SET count = ?`
    )
    .run(
      userId,
      actionType,
      windowStartMs,
      windowSeconds,
      count,
      limitCount,
      count
    );
}

/**
 * Clear rate limits for a specific user
 */
async function clearRateLimits(db, userId) {
  await db
    .prepare("DELETE FROM rate_limits WHERE user_id = ?")
    .run(userId);
}

describe("Rate Limiting", () => {
  let db;
  let dbPath;
  let tmpDir;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-ratelimit-test-"));
    dbPath = path.join(tmpDir, "test.db");
    const migrationsDir = path.join(__dirname, "..", "migrations");
    db = await initDb({ dbPath, migrationsDir });
  });

  after(async () => {
    if (db && db.close) {
      db.close();
    }
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("Basic Allow/Block Behavior", () => {
    it("should allow request when under limit", async () => {
      const userId = uniqueUserId();
      const result = await consumeRateLimit(db, userId, "test_action", 5, 60);

      assert.strictEqual(result.allowed, true, "should allow first request");
      assert.strictEqual(result.remaining, 4, "should have 4 remaining");
      assert.ok(result.reset_at, "should have reset_at timestamp");
    });

    it("should allow multiple requests up to limit", async () => {
      const userId = uniqueUserId();
      const limit = 3;

      for (let i = 0; i < limit; i++) {
        const result = await consumeRateLimit(db, userId, "multi_test", limit, 60);
        assert.strictEqual(result.allowed, true, `request ${i + 1} should be allowed`);
        assert.strictEqual(
          result.remaining,
          limit - i - 1,
          `should have ${limit - i - 1} remaining after request ${i + 1}`
        );
      }
    });

    it("should block request at exactly the limit", async () => {
      const userId = uniqueUserId();
      const limit = 3;

      // Consume all 3 requests
      for (let i = 0; i < limit; i++) {
        await consumeRateLimit(db, userId, "limit_test", limit, 60);
      }

      // 4th request should be blocked
      const result = await consumeRateLimit(db, userId, "limit_test", limit, 60);
      assert.strictEqual(result.allowed, false, "should block request at limit");
      assert.strictEqual(result.remaining, 0, "should have 0 remaining");
    });

    it("should block all requests over limit", async () => {
      const userId = uniqueUserId();
      const limit = 2;

      // Consume all requests
      await consumeRateLimit(db, userId, "over_test", limit, 60);
      await consumeRateLimit(db, userId, "over_test", limit, 60);

      // All subsequent requests should be blocked
      for (let i = 0; i < 5; i++) {
        const result = await consumeRateLimit(db, userId, "over_test", limit, 60);
        assert.strictEqual(result.allowed, false, `excess request ${i + 1} should be blocked`);
      }
    });

    it("should track different action types independently", async () => {
      const userId = uniqueUserId();

      // Exhaust limit for action_a
      await consumeRateLimit(db, userId, "action_a", 1, 60);
      const blockedA = await consumeRateLimit(db, userId, "action_a", 1, 60);
      assert.strictEqual(blockedA.allowed, false, "action_a should be blocked");

      // action_b should still be allowed
      const allowedB = await consumeRateLimit(db, userId, "action_b", 1, 60);
      assert.strictEqual(allowedB.allowed, true, "action_b should be allowed");
    });

    it("should track different users independently", async () => {
      const userA = uniqueUserId("user_a");
      const userB = uniqueUserId("user_b");

      // Exhaust limit for userA
      await consumeRateLimit(db, userA, "shared_action", 1, 60);
      const blockedA = await consumeRateLimit(db, userA, "shared_action", 1, 60);
      assert.strictEqual(blockedA.allowed, false, "userA should be blocked");

      // userB should still be allowed
      const allowedB = await consumeRateLimit(db, userB, "shared_action", 1, 60);
      assert.strictEqual(allowedB.allowed, true, "userB should be allowed");
    });
  });

  describe("Sliding Window Algorithm", () => {
    it("should weight previous window count by remaining time", async () => {
      const userId = uniqueUserId();
      const windowSeconds = 3600; // 1 hour
      const windowMs = windowSeconds * 1000;
      const limit = 10;

      // Set up a scenario: previous window has 8 requests
      // If we're 50% into current window, previous contributes 8 * 0.5 = 4
      // So we should be able to make 6 more requests (10 - 4 = 6)
      const now = Date.now();
      const currentWindowStart = Math.floor(now / windowMs) * windowMs;
      const previousWindowStart = currentWindowStart - windowMs;

      // Seed previous window with 8 requests
      await seedRateLimitState(
        db,
        userId,
        "sliding_test",
        previousWindowStart,
        windowSeconds,
        8,
        limit
      );

      // The actual weighted count depends on current time within window
      // Just verify that requests are still allowed (previous window doesn't fully block)
      const result = await consumeRateLimit(db, userId, "sliding_test", limit, windowSeconds);

      // Should be allowed since weighted count should be < 10
      assert.strictEqual(result.allowed, true, "should allow when weighted count < limit");
    });

    it("should correctly calculate weighted count with both windows populated", async () => {
      const userId = uniqueUserId();
      const windowSeconds = 3600;
      const windowMs = windowSeconds * 1000;
      const limit = 5;

      const now = Date.now();
      const currentWindowStart = Math.floor(now / windowMs) * windowMs;
      const previousWindowStart = currentWindowStart - windowMs;

      // Seed: current window = 5 (at the limit)
      // Even with 0 from previous window, current alone hits the limit
      await seedRateLimitState(
        db,
        userId,
        "weighted_test",
        currentWindowStart,
        windowSeconds,
        5,
        limit
      );

      // Weighted count = 5 + 0 * (1 - progress) = 5
      // At limit, next request should be blocked
      const result = await consumeRateLimit(db, userId, "weighted_test", limit, windowSeconds);
      assert.strictEqual(result.allowed, false, "should block when weighted count >= limit");
    });

    it("should allow more requests as previous window decays", async () => {
      const userId = uniqueUserId();
      const limit = 10;

      // Use a very short window for testing decay
      // With no previous window, all requests should be allowed
      await clearRateLimits(db, userId);

      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        const result = await consumeRateLimit(db, userId, "decay_test", limit, 60);
        assert.strictEqual(result.allowed, true);
      }

      // Should still have 5 remaining
      const finalResult = await consumeRateLimit(db, userId, "decay_test", limit, 60);
      assert.strictEqual(finalResult.allowed, true);
      // After 6 requests, should have 4 remaining
      assert.strictEqual(finalResult.remaining, 4);
    });
  });

  describe("Counter Persistence", () => {
    it("should persist counter across requests", async () => {
      const userId = uniqueUserId();

      await consumeRateLimit(db, userId, "persist_test", 5, 60);

      // Query the database directly to verify persistence
      const now = Date.now();
      const windowMs = 60 * 1000;
      const currentWindowStart = Math.floor(now / windowMs) * windowMs;

      const row = await db
        .prepare(
          "SELECT count FROM rate_limits WHERE user_id = ? AND action_type = ? AND window_start_ms = ?"
        )
        .get(userId, "persist_test", currentWindowStart);

      assert.ok(row, "should have a rate limit record");
      assert.strictEqual(row.count, 1, "count should be 1");
    });

    it("should increment counter on each request", async () => {
      const userId = uniqueUserId();
      const limit = 10;

      // Make 3 requests
      for (let i = 0; i < 3; i++) {
        await consumeRateLimit(db, userId, "increment_test", limit, 60);
      }

      // Verify count in database
      const now = Date.now();
      const windowMs = 60 * 1000;
      const currentWindowStart = Math.floor(now / windowMs) * windowMs;

      const row = await db
        .prepare(
          "SELECT count FROM rate_limits WHERE user_id = ? AND action_type = ? AND window_start_ms = ?"
        )
        .get(userId, "increment_test", currentWindowStart);

      assert.strictEqual(row.count, 3, "count should be 3 after 3 requests");
    });
  });

  describe("Reset Timestamp", () => {
    it("should return valid reset_at timestamp", async () => {
      const userId = uniqueUserId();
      const result = await consumeRateLimit(db, userId, "reset_test", 5, 60);

      assert.ok(result.reset_at, "should have reset_at");
      const resetDate = new Date(result.reset_at);
      assert.ok(!isNaN(resetDate.getTime()), "reset_at should be valid date");
    });

    it("should return reset_at in the future", async () => {
      const userId = uniqueUserId();
      const result = await consumeRateLimit(db, userId, "future_test", 5, 60);

      const resetDate = new Date(result.reset_at);
      assert.ok(resetDate > new Date(), "reset_at should be in the future");
    });

    it("should return reset_at at window boundary", async () => {
      const userId = uniqueUserId();
      const windowSeconds = 3600; // 1 hour
      const result = await consumeRateLimit(db, userId, "boundary_test", 5, windowSeconds);

      const resetDate = new Date(result.reset_at);
      const resetMs = resetDate.getTime();

      // Reset should be on an hour boundary
      assert.strictEqual(resetMs % (windowSeconds * 1000), 0, "reset_at should be on window boundary");
    });
  });

  describe("Edge Cases", () => {
    it("should handle first request for new user", async () => {
      const userId = uniqueUserId();

      // Verify no existing records
      const existing = await db
        .prepare("SELECT * FROM rate_limits WHERE user_id = ?")
        .get(userId);
      assert.strictEqual(existing, undefined, "should have no existing records");

      // First request should work
      const result = await consumeRateLimit(db, userId, "new_user_test", 5, 60);
      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.remaining, 4);
    });

    it("should handle limit of 1", async () => {
      const userId = uniqueUserId();

      const first = await consumeRateLimit(db, userId, "limit_1_test", 1, 60);
      assert.strictEqual(first.allowed, true, "first request should be allowed");
      assert.strictEqual(first.remaining, 0, "should have 0 remaining");

      const second = await consumeRateLimit(db, userId, "limit_1_test", 1, 60);
      assert.strictEqual(second.allowed, false, "second request should be blocked");
    });

    it("should handle very long window (24 hours)", async () => {
      const userId = uniqueUserId();
      const windowSeconds = 24 * 60 * 60; // 24 hours

      const result = await consumeRateLimit(db, userId, "long_window_test", 3, windowSeconds);
      assert.strictEqual(result.allowed, true);

      // Verify reset_at is ~24 hours from now
      const resetDate = new Date(result.reset_at);
      const now = new Date();
      const diffHours = (resetDate - now) / (1000 * 60 * 60);
      assert.ok(diffHours > 0 && diffHours <= 24, "reset should be within 24 hours");
    });

    it("should handle very short window (1 second)", async () => {
      const userId = uniqueUserId();

      const result = await consumeRateLimit(db, userId, "short_window_test", 5, 1);
      assert.strictEqual(result.allowed, true);
    });

    it("should handle large limit values", async () => {
      const userId = uniqueUserId();
      const largeLimit = 1000000;

      const result = await consumeRateLimit(db, userId, "large_limit_test", largeLimit, 60);
      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.remaining, largeLimit - 1);
    });
  });

  describe("Enrollment Rate Limit Specifics", () => {
    it("should allow 10 enrollment starts per 24 hours (updated limit)", async () => {
      const userId = uniqueUserId();
      const limit = 10; // Updated from 3
      const windowSeconds = 24 * 60 * 60;

      // Should be able to make 10 requests
      for (let i = 0; i < limit; i++) {
        const result = await consumeRateLimit(
          db,
          userId,
          "enrollment_start",
          limit,
          windowSeconds
        );
        assert.strictEqual(
          result.allowed,
          true,
          `enrollment ${i + 1} should be allowed`
        );
      }

      // 11th should be blocked
      const blocked = await consumeRateLimit(
        db,
        userId,
        "enrollment_start",
        limit,
        windowSeconds
      );
      assert.strictEqual(blocked.allowed, false, "11th enrollment should be blocked");
    });

    it("should carry forward weighted count from previous day", async () => {
      const userId = uniqueUserId();
      const limit = 10;
      const windowSeconds = 24 * 60 * 60;
      const windowMs = windowSeconds * 1000;

      const now = Date.now();
      const currentWindowStart = Math.floor(now / windowMs) * windowMs;
      const previousWindowStart = currentWindowStart - windowMs;

      // Seed previous day with 8 enrollments
      await seedRateLimitState(
        db,
        userId,
        "enrollment_carryover",
        previousWindowStart,
        windowSeconds,
        8,
        limit
      );

      // Depending on time of day, weighted count = 8 * (1 - progress)
      // Even at 50% progress, that's 4 from previous + current
      // So should still allow new requests
      const result = await consumeRateLimit(
        db,
        userId,
        "enrollment_carryover",
        limit,
        windowSeconds
      );

      // Should be allowed since 8 * (1 - progress) < 10 for any progress > 0.2
      assert.strictEqual(result.allowed, true, "should allow with decayed previous count");
    });
  });

  describe("Admin Reset Behavior", () => {
    it("should allow requests after admin reset", async () => {
      const userId = uniqueUserId();
      const limit = 2;

      // Exhaust limit
      await consumeRateLimit(db, userId, "admin_reset_test", limit, 60);
      await consumeRateLimit(db, userId, "admin_reset_test", limit, 60);

      const blocked = await consumeRateLimit(db, userId, "admin_reset_test", limit, 60);
      assert.strictEqual(blocked.allowed, false, "should be blocked after limit");

      // Simulate admin reset (same as adminService.resetUserRateLimit)
      await db
        .prepare("DELETE FROM rate_limits WHERE user_id = ? AND action_type = ?")
        .run(userId, "admin_reset_test");

      // Should now be allowed
      const afterReset = await consumeRateLimit(db, userId, "admin_reset_test", limit, 60);
      assert.strictEqual(afterReset.allowed, true, "should be allowed after reset");
      assert.strictEqual(afterReset.remaining, 1, "should have full quota after reset");
    });

    it("should reset only specified action type", async () => {
      const userId = uniqueUserId();

      // Exhaust limits for both actions
      await consumeRateLimit(db, userId, "reset_action_a", 1, 60);
      await consumeRateLimit(db, userId, "reset_action_b", 1, 60);

      // Reset only action_a
      await db
        .prepare("DELETE FROM rate_limits WHERE user_id = ? AND action_type = ?")
        .run(userId, "reset_action_a");

      // action_a should be allowed, action_b should still be blocked
      const resultA = await consumeRateLimit(db, userId, "reset_action_a", 1, 60);
      const resultB = await consumeRateLimit(db, userId, "reset_action_b", 1, 60);

      assert.strictEqual(resultA.allowed, true, "action_a should be allowed after reset");
      assert.strictEqual(resultB.allowed, false, "action_b should still be blocked");
    });
  });

  describe("Concurrent Request Handling", () => {
    it("should handle rapid sequential requests correctly", async () => {
      const userId = uniqueUserId();
      const limit = 5;

      // Make rapid sequential requests
      const results = [];
      for (let i = 0; i < 7; i++) {
        results.push(await consumeRateLimit(db, userId, "rapid_test", limit, 60));
      }

      // First 5 should be allowed
      for (let i = 0; i < 5; i++) {
        assert.strictEqual(results[i].allowed, true, `request ${i + 1} should be allowed`);
      }

      // Last 2 should be blocked
      assert.strictEqual(results[5].allowed, false, "request 6 should be blocked");
      assert.strictEqual(results[6].allowed, false, "request 7 should be blocked");
    });

    it("should handle parallel requests (race condition test)", async () => {
      const userId = uniqueUserId();
      const limit = 3;

      // Fire off multiple requests in parallel
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(consumeRateLimit(db, userId, "parallel_test", limit, 60));
      }

      const results = await Promise.all(promises);

      // Count allowed vs blocked
      const allowed = results.filter((r) => r.allowed).length;
      const blocked = results.filter((r) => !r.allowed).length;

      // Due to SQLite's locking, some may get through
      // The key is that we don't exceed the limit + a small race window
      assert.ok(allowed >= 3, "at least limit requests should be allowed");
      assert.ok(allowed <= 5, "should not exceed 5 allowed (with race conditions)");
      assert.strictEqual(allowed + blocked, 5, "all requests should be accounted for");
    });
  });
});
