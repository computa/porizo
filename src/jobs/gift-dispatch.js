/**
 * Gift dispatch job
 *
 * Polls due gift orders and dispatches them through the provided callback.
 * The callback is responsible for all business logic and side effects.
 */

const DEFAULT_INTERVAL_MS = 30 * 1000;
const DEFAULT_BATCH_SIZE = 25;

function startGiftDispatchJob({
  db,
  dispatchGiftById,
  intervalMs = DEFAULT_INTERVAL_MS,
  batchSize = DEFAULT_BATCH_SIZE,
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
      const dueGifts = await db
        .prepare(
          `SELECT id
           FROM gift_orders
           WHERE status IN ('scheduled', 'dispatch_retry')
             AND send_at <= ?
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
