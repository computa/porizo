/**
 * Gift dispatch job
 *
 * Polls due gift orders and dispatches them through the provided callback.
 * The callback is responsible for all business logic and side effects.
 */

const { createGiftDispatchRepository } = require("../database/gift-dispatch-repository");
const { upsertGiftIncident, resolveGiftIncident } = require("../services/gift-delivery-ops");

const DEFAULT_INTERVAL_MS = 30 * 1000;
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_STALE_DISPATCH_MS = 10 * 60 * 1000;
const DEFAULT_OVERDUE_GRACE_MS = 5 * 60 * 1000;

function startGiftDispatchJob({
  db,
  dispatchGiftById,
  intervalMs = DEFAULT_INTERVAL_MS,
  batchSize = DEFAULT_BATCH_SIZE,
  staleDispatchMs = DEFAULT_STALE_DISPATCH_MS,
  overdueGraceMs = DEFAULT_OVERDUE_GRACE_MS,
  repository = createGiftDispatchRepository(db),
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
      const overdueCutoff = new Date(Date.now() - overdueGraceMs).toISOString();

      const staleDispatching = await repository.listStaleDispatching({ staleCutoff });
      await repository.recoverStaleDispatching({ staleCutoff, now });

      for (const row of staleDispatching) {
        await upsertGiftIncident(db, {
          incidentKey: `gift_dispatch_stalled:${row.id}`,
          incidentType: "gift_dispatch_stalled",
          severity: "critical",
          giftOrderId: row.id,
          resourceType: "gift_order",
          resourceId: row.id,
          summary: "Gift dispatch was recovered from a stale dispatching state",
          detail: "The scheduler found a gift stuck in dispatching and moved it back to retry.",
          metadata: { recovered_at: now },
        });
      }

      const staleSending = await repository.listStaleSending({ staleCutoff });
      await repository.recoverStaleSending({ staleCutoff, now });

      for (const row of staleSending) {
        await upsertGiftIncident(db, {
          incidentKey: `gift_channel_failure:${row.id}`,
          incidentType: "channel_delivery_failed",
          severity: "warning",
          giftOrderId: row.gift_order_id,
          outboxId: row.id,
          resourceType: "gift_order",
          resourceId: row.gift_order_id,
          summary: "Gift channel send was recovered from a stale sending state",
          detail: "The scheduler unlocked a stuck channel send and marked it failed for retry.",
          metadata: { recovered_at: now, outbox_id: row.id },
        });
      }

      const overdueRows = await repository.listOverdueUndelivered({ overdueCutoff });

      for (const row of overdueRows) {
        await repository.markGiftOverdue({ giftOrderId: row.id, now });

        await upsertGiftIncident(db, {
          incidentKey: `gift_overdue:${row.id}`,
          incidentType: "gift_overdue",
          severity: "warning",
          giftOrderId: row.id,
          resourceType: "gift_order",
          resourceId: row.id,
          summary: "Gift delivery is overdue",
          detail: "The gift has passed its scheduled send time without a successful delivery row.",
          metadata: { overdue_detected_at: now },
        });
      }

      const dueGifts = await repository.listDueGifts({ now, batchSize });

      for (const row of dueGifts) {
        processed += 1;
        try {
          await dispatchGiftById(row.id);
          await resolveGiftIncident(db, `gift_overdue:${row.id}`);
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
