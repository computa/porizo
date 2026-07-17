"use strict";

async function cleanupExpiredWebFunnelState(
  db,
  {
    now = new Date().toISOString(),
    rateLimitNowMs = Date.parse(now),
  } = {},
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
      `DELETE FROM rate_limits
       WHERE window_start_ms + (window_seconds * 1000) < ?`,
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
