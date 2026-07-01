"use strict";

function createAuthRateLimitRepository(db) {
  const cache = new Map();

  function isCacheLimited(key, maxAttempts, windowMs) {
    const now = Date.now();
    const record = cache.get(key);

    if (!record) {
      cache.set(key, { count: 1, windowStart: now });
      return false;
    }

    if (now - record.windowStart > windowMs) {
      cache.set(key, { count: 1, windowStart: now });
      return false;
    }

    if (record.count >= maxAttempts) {
      return true;
    }

    record.count += 1;
    return false;
  }

  async function clearAuthLimits() {
    cache.clear();
    if (!db) return;

    try {
      await db
        .prepare("DELETE FROM rate_limits WHERE action_type LIKE 'auth:%'")
        .run();
    } catch {
      /* DB may not have the table in some test setups */
    }
  }

  async function cleanupExpiredAuthEntries(cutoffMs) {
    for (const [key, entry] of cache) {
      if (entry.windowStart < cutoffMs) cache.delete(key);
    }

    try {
      await db
        .prepare(
          "DELETE FROM rate_limits WHERE action_type LIKE 'auth:%' AND window_start_ms < ?",
        )
        .run(cutoffMs);
    } catch {
      /* non-critical cleanup */
    }
  }

  async function consume({ key, limit, windowMs, failClosed = false }) {
    if (isCacheLimited(key, limit, windowMs)) {
      return true;
    }

    try {
      const windowSeconds = Math.ceil(windowMs / 1000);
      const now = Date.now();
      const currentWindowStart = Math.floor(now / windowMs) * windowMs;
      const actionKey = `auth:${key}`;

      await db
        .prepare(
          `INSERT INTO rate_limits (user_id, action_type, window_start_ms, window_seconds, count, limit_count)
           VALUES (?, ?, ?, ?, 1, ?)
           ON CONFLICT(user_id, action_type, window_start_ms)
           DO UPDATE SET count = rate_limits.count + 1`,
        )
        .run(key, actionKey, currentWindowStart, windowSeconds, limit);

      const currentWindow = await db
        .prepare(
          "SELECT count FROM rate_limits WHERE user_id = ? AND action_type = ? AND window_start_ms = ?",
        )
        .get(key, actionKey, currentWindowStart);

      const previousWindowStart = currentWindowStart - windowMs;
      const previousWindow = await db
        .prepare(
          "SELECT count FROM rate_limits WHERE user_id = ? AND action_type = ? AND window_start_ms = ?",
        )
        .get(key, actionKey, previousWindowStart);

      const currentCount = currentWindow?.count || 0;
      const previousCount = previousWindow?.count || 0;
      const elapsedInWindow = now - currentWindowStart;
      const windowProgress = elapsedInWindow / windowMs;
      const weightedCount = currentCount + previousCount * (1 - windowProgress);

      if (weightedCount > limit) {
        await db
          .prepare(
            `UPDATE rate_limits SET count = MAX(count - 1, 0)
             WHERE user_id = ? AND action_type = ? AND window_start_ms = ?`,
          )
          .run(key, actionKey, currentWindowStart);
        return true;
      }

      return false;
    } catch (err) {
      console.error(
        "[AuthRateLimit] DB error, falling back to in-memory:",
        err.message,
      );
      return failClosed === true;
    }
  }

  return {
    isAuthRateLimitRepository: true,
    clearAuthLimits,
    cleanupExpiredAuthEntries,
    consume,
  };
}

module.exports = { createAuthRateLimitRepository };
