"use strict";

function normalizeRateLimitKey(key) {
  if (key && typeof key === "object") {
    const subject = String(key.subject || "").trim();
    const value = String(key.value || "").trim();
    if (!subject || !value) {
      throw new Error("rate-limit key requires subject and value");
    }
    return { subject, value };
  }

  const value = String(key || "").trim();
  if (!value) {
    throw new Error("rate-limit key value is required");
  }
  return {
    subject: value.startsWith("ip:") ? "ip" : "user",
    value,
  };
}

function createRateLimitRepository(db) {
  function buildConsumeContext({ key, action, max, windowMs }) {
    const normalizedKey = normalizeRateLimitKey(key);
    const actionType = String(action || "").trim();
    const limit = Number(max);
    const windowDurationMs = Number(windowMs);

    if (!actionType) {
      throw new Error("rate-limit action is required");
    }
    if (!Number.isFinite(limit) || limit < 1) {
      throw new Error("rate-limit max must be a positive number");
    }
    if (!Number.isFinite(windowDurationMs) || windowDurationMs < 1) {
      throw new Error("rate-limit windowMs must be a positive number");
    }

    const now = Date.now();
    const windowSeconds = Math.ceil(windowDurationMs / 1000);
    const currentWindowStart =
      Math.floor(now / windowDurationMs) * windowDurationMs;
    const previousWindowStart = currentWindowStart - windowDurationMs;
    const elapsedInWindow = now - currentWindowStart;
    const windowProgress = elapsedInWindow / windowDurationMs;
    const resetAt = new Date(currentWindowStart + windowDurationMs).toISOString();

    return {
      normalizedKey,
      actionType,
      limit,
      windowDurationMs,
      windowSeconds,
      currentWindowStart,
      previousWindowStart,
      windowProgress,
      resetAt,
    };
  }

  function consumeWithPrepare(ctx) {
    db
      .prepare(
        `INSERT INTO rate_limits (user_id, action_type, window_start_ms, window_seconds, count, limit_count)
         VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT(user_id, action_type, window_start_ms)
         DO UPDATE SET count = rate_limits.count + 1`,
      )
      .run(
        ctx.normalizedKey.value,
        ctx.actionType,
        ctx.currentWindowStart,
        ctx.windowSeconds,
        ctx.limit,
      );

    const currentWindow = db
      .prepare(
        "SELECT count FROM rate_limits WHERE user_id = ? AND action_type = ? AND window_start_ms = ?",
      )
      .get(ctx.normalizedKey.value, ctx.actionType, ctx.currentWindowStart);
    const previousWindow = db
      .prepare(
        "SELECT count FROM rate_limits WHERE user_id = ? AND action_type = ? AND window_start_ms = ?",
      )
      .get(ctx.normalizedKey.value, ctx.actionType, ctx.previousWindowStart);

    const currentCount = currentWindow?.count || 0;
    const previousCount = previousWindow?.count || 0;
    const weightedCount =
      currentCount + previousCount * (1 - ctx.windowProgress);

    if (weightedCount > ctx.limit) {
      db
        .prepare(
          `UPDATE rate_limits
           SET count = CASE
             WHEN count > 0 THEN count - 1
             ELSE 0
           END
           WHERE user_id = ? AND action_type = ? AND window_start_ms = ?`,
        )
        .run(ctx.normalizedKey.value, ctx.actionType, ctx.currentWindowStart);
      return {
        allowed: false,
        remaining: 0,
        resetAt: ctx.resetAt,
        key: ctx.normalizedKey,
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, Math.floor(ctx.limit - weightedCount)),
      resetAt: ctx.resetAt,
      key: ctx.normalizedKey,
      action: ctx.actionType,
      windowStartMs: ctx.currentWindowStart,
    };
  }

  async function consumeWithQuery(query, ctx) {
    await query(
      `INSERT INTO rate_limits (user_id, action_type, window_start_ms, window_seconds, count, limit_count)
       VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT(user_id, action_type, window_start_ms)
       DO UPDATE SET count = rate_limits.count + 1`,
      [
        ctx.normalizedKey.value,
        ctx.actionType,
        ctx.currentWindowStart,
        ctx.windowSeconds,
        ctx.limit,
      ],
    );

    const currentWindowResult = await query(
      "SELECT count FROM rate_limits WHERE user_id = ? AND action_type = ? AND window_start_ms = ?",
      [ctx.normalizedKey.value, ctx.actionType, ctx.currentWindowStart],
    );
    const previousWindowResult = await query(
      "SELECT count FROM rate_limits WHERE user_id = ? AND action_type = ? AND window_start_ms = ?",
      [ctx.normalizedKey.value, ctx.actionType, ctx.previousWindowStart],
    );

    const currentCount = currentWindowResult.rows?.[0]?.count || 0;
    const previousCount = previousWindowResult.rows?.[0]?.count || 0;
    const weightedCount =
      Number(currentCount) + Number(previousCount) * (1 - ctx.windowProgress);

    if (weightedCount > ctx.limit) {
      await query(
        `UPDATE rate_limits
         SET count = CASE
           WHEN count > 0 THEN count - 1
           ELSE 0
         END
         WHERE user_id = ? AND action_type = ? AND window_start_ms = ?`,
        [ctx.normalizedKey.value, ctx.actionType, ctx.currentWindowStart],
      );
      return {
        allowed: false,
        remaining: 0,
        resetAt: ctx.resetAt,
        key: ctx.normalizedKey,
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, Math.floor(ctx.limit - weightedCount)),
      resetAt: ctx.resetAt,
      key: ctx.normalizedKey,
      action: ctx.actionType,
      windowStartMs: ctx.currentWindowStart,
    };
  }

  async function consume(args) {
    const ctx = buildConsumeContext(args);
    if (db.isPostgres && typeof db.transaction === "function") {
      return db.transaction((query) => consumeWithQuery(query, ctx));
    }
    return consumeWithPrepare(ctx);
  }

  async function refund({ key, action, windowStartMs }) {
    const normalizedKey = normalizeRateLimitKey(key);
    const params = [normalizedKey.value, action, windowStartMs];
    const sql = `UPDATE rate_limits
      SET count = CASE WHEN count > 0 THEN count - 1 ELSE 0 END
      WHERE user_id = ? AND action_type = ? AND window_start_ms = ?`;
    if (db.isPostgres && typeof db.transaction === "function") {
      return db.transaction((query) => query(sql, params));
    }
    return db.prepare(sql).run(...params);
  }

  return {
    consume,
    refund,
  };
}

module.exports = {
  createRateLimitRepository,
  normalizeRateLimitKey,
};
