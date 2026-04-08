/**
 * Gift dispatch job
 *
 * Polls due gift orders and dispatches them through the provided callback.
 * The callback is responsible for all business logic and side effects.
 */

const DEFAULT_INTERVAL_MS = 30 * 1000;
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_STALE_DISPATCH_MS = 10 * 60 * 1000;

function startGiftDispatchJob({
  db,
  dispatchGiftById,
  intervalMs = DEFAULT_INTERVAL_MS,
  batchSize = DEFAULT_BATCH_SIZE,
  staleDispatchMs = DEFAULT_STALE_DISPATCH_MS,
}) {
  if (!db) {
    throw new Error("startGiftDispatchJob requires db");
  }
  if (typeof dispatchGiftById !== "function") {
    throw new Error("startGiftDispatchJob requires dispatchGiftById callback");
  }

  let isRunning = false;

  const tick = async () => {
    if (isRunning) {
      return { skipped: true, reason: "already_running" };
    }
    isRunning = true;

    const now = new Date().toISOString();
    let processed = 0;
    let failed = 0;

    try {
      const staleCutoff = new Date(Date.now() - staleDispatchMs).toISOString();
      await db.prepare(
        `UPDATE gift_orders
         SET status = 'dispatch_retry',
             dispatch_status = 'error',
             dispatch_started_at = NULL,
             next_retry_at = ?,
             last_dispatch_error = COALESCE(last_dispatch_error, 'stale_dispatch_recovered'),
             updated_at = ?
         WHERE status = 'dispatching'
           AND dispatch_started_at IS NOT NULL
           AND dispatch_started_at <= ?`
      ).run(now, now, staleCutoff);

      await db.prepare(
        `UPDATE gift_delivery_outbox
         SET status = 'failed',
             last_error = COALESCE(last_error, 'stale_channel_send_recovered'),
             next_retry_at = ?,
             locked_at = NULL,
             updated_at = ?
         WHERE status = 'sending'
           AND locked_at IS NOT NULL
           AND locked_at <= ?`
      ).run(now, now, staleCutoff);

      const dueGifts = await db
        .prepare(
          `SELECT id
           FROM gift_orders
           WHERE status IN ('scheduled', 'dispatch_retry')
             AND COALESCE(next_retry_at, send_at) <= ?
           ORDER BY send_at ASC
           LIMIT ?`
        )
        .all(now, batchSize);

      for (const row of dueGifts) {
        processed += 1;
        try {
          await dispatchGiftById(row.id);
        } catch (err) {
          failed += 1;
          // Dispatch callback handles persistence for failures.
          console.error(`[GiftDispatchJob] Failed to dispatch gift ${row.id}: ${err.message}`);
        }
      }

      return {
        skipped: false,
        processed,
        failed,
      };
    } finally {
      isRunning = false;
    }
  };

  const timer = setInterval(() => {
    tick().catch((err) => {
      console.error("[GiftDispatchJob] Tick failed:", err.message);
    });
  }, intervalMs);

  // Run immediately on startup.
  tick().catch((err) => {
    console.error("[GiftDispatchJob] Initial tick failed:", err.message);
  });

  return {
    tick,
    stop: () => clearInterval(timer),
  };
}

module.exports = {
  startGiftDispatchJob,
};
