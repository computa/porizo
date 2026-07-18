"use strict";

async function cleanupExpiredWebFunnelState(
  db,
  { now = new Date().toISOString(), rateLimitNowMs = Date.parse(now) } = {},
) {
  await db.prepare("DELETE FROM refresh_tokens WHERE expires_at < ?").run(now);
  await db
    .prepare(
      `DELETE FROM user_sessions
       WHERE (idle_expires_at IS NOT NULL AND idle_expires_at < ?)
          OR (absolute_expires_at IS NOT NULL AND absolute_expires_at < ?)`,
    )
    .run(now, now);
  await db
    .prepare(
      // window_start_ms is a bigint ms-epoch; window_seconds is int4. Multiplying
      // window_seconds * 1000 in int4 space overflows for long windows (e.g. the
      // 10-year lifetime cap, 315360000s → 3.15e11 >> int4 max), which throws
      // int4mul "integer out of range" on Postgres and crashes the cleanup timer.
      // Force the multiplication into 64-bit. CAST(... AS BIGINT) is portable to
      // SQLite (which is 64-bit anyway) — unlike Postgres-only ::bigint.
      `DELETE FROM rate_limits
       WHERE window_start_ms + window_seconds * CAST(1000 AS BIGINT) < ?`,
    )
    .run(rateLimitNowMs);
  await db
    .prepare("DELETE FROM web_guest_devices WHERE expires_at < ?")
    .run(now);
  await db
    .prepare(
      `DELETE FROM users
       WHERE account_status = 'guest'
         AND NOT EXISTS (
           SELECT 1 FROM web_guest_devices d WHERE d.user_id = users.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM tracks t WHERE t.user_id = users.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM web_orders o WHERE o.user_id = users.id
         )`,
    )
    .run();
}

module.exports = { cleanupExpiredWebFunnelState };
