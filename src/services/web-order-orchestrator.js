"use strict";

const {
  createWebOrdersRepository,
} = require("../database/web-orders-repository");
const { createIdentityRepository } = require("../database/identity-repository");
const { createPreparedDbFromQuery } = require("../utils/db-adapter");
const { convergeOrderIdentity } = require("./web-order-identity");

// Orchestrator-level render retries, on top of the pipeline's own internal
// retries. After this many render failures the order is refunded.
const MAX_RENDER_ATTEMPTS = 3;
// A resumable order older than this is picked up by the sweep (covers a crash
// between transitions or a lost webhook tick).
const STALE_ORDER_MS = 2 * 60 * 1000;

function progressCopy(status, recipientName) {
  const who = recipientName ? `${recipientName}'s` : "their";
  switch (status) {
    case "paid":
    case "rendering":
      return `Finishing ${who} song…`;
    case "delivered":
      return `${recipientName || "Their"} song is ready.`;
    case "failed":
    case "refunded":
      return "We couldn't finish this one — you've been refunded in full.";
    default:
      return "Confirming your payment…";
  }
}

/**
 * Build the post-payment orchestrator.
 *
 * All external effects are injected so tests drive transitions deterministically
 * with fakes:
 *   - renderFullVersion({ userId, trackId, trackVersionId }) -> kicks render_full
 *   - getVersionRenderState({ trackId, trackVersionId }) -> { ready, failed, fullUrl }
 *   - createGiftShare({ order }) -> { shareId, shareUrl }
 *   - sendDeliveryEmail({ order, shareUrl }) -> Promise
 *   - sendApologyEmail({ order }) -> Promise
 *   - refundOrder({ order }) -> Promise (Stripe refund)
 *   - alertAdmin({ subject, meta }) -> Promise (never throws to caller)
 *   - getTrackMeta({ trackId }) -> { recipientName }
 */
function createWebOrderOrchestrator({
  db,
  renderFullVersion,
  getVersionRenderState,
  createGiftShare,
  sendDeliveryEmail,
  sendApologyEmail,
  refundOrder,
  alertAdmin = async () => {},
  getTrackMeta = async () => ({}),
  logger = console,
}) {
  const orders = createWebOrdersRepository(db);

  async function safeAlert(subject, meta) {
    try {
      await alertAdmin({ subject, meta });
    } catch (err) {
      logger.error?.({ err, subject }, "Admin alert failed");
    }
  }

  // paid -> rendering: run identity convergence, then kick render_full as the
  // (possibly re-owned) order user. Idempotent: the CAS on updateStatus means
  // only one worker advances the order; render_full is itself idempotent.
  async function handlePaid(order) {
    let ownerUserId = order.user_id;
    try {
      await db.transaction(async (query) => {
        const identityRepository = createIdentityRepository(
          createPreparedDbFromQuery(query, db),
        );
        const result = await convergeOrderIdentity(query, {
          buyerUserId: order.user_id,
          email: order.email,
          name: order.buyer_name,
          identityRepository,
        });
        ownerUserId = result.userId;
      });
    } catch (err) {
      logger.error?.({ err, orderId: order.id }, "Identity convergence failed");
      await safeAlert("Web order identity convergence failed", {
        orderId: order.id,
        error: err.message,
      });
      // Leave the order in `paid` for the sweep to retry — do not proceed to
      // render against an unconverged identity.
      return { status: "paid", retryable: true };
    }

    const advanced = await orders.updateStatus({
      orderId: order.id,
      fromStatus: "paid",
      toStatus: "rendering",
    });
    if (!advanced) {
      return { status: "rendering", alreadyAdvanced: true };
    }

    await renderFullVersion({
      userId: ownerUserId,
      trackId: order.track_id,
      trackVersionId: order.track_version_id,
    });
    return { status: "rendering", userId: ownerUserId };
  }

  // rendering -> delivered (ready) | retry/refund (failed).
  async function handleRendering(order) {
    const state = await getVersionRenderState({
      trackId: order.track_id,
      trackVersionId: order.track_version_id,
    });

    if (state.ready) {
      const share = await createGiftShare({ order });
      // Persist the share id first so a crash after email still resumes cleanly
      // (delivered is set only after the email is sent).
      await orders.updateStatus({
        orderId: order.id,
        fromStatus: "rendering",
        toStatus: "rendering",
        shareTokenId: share.shareId,
      });
      await sendDeliveryEmail({ order, shareUrl: share.shareUrl });
      await orders.updateStatus({
        orderId: order.id,
        fromStatus: "rendering",
        toStatus: "delivered",
        shareTokenId: share.shareId,
      });
      return { status: "delivered", shareUrl: share.shareUrl };
    }

    if (state.failed) {
      await orders.incrementRenderAttempts({ orderId: order.id });
      const attempts = (order.render_attempts || 0) + 1;
      if (attempts < MAX_RENDER_ATTEMPTS) {
        await renderFullVersion({
          userId: order.user_id,
          trackId: order.track_id,
          trackVersionId: order.track_version_id,
          retry: true,
        });
        return { status: "rendering", retried: true, attempts };
      }
      return refundForFailure(order);
    }

    return { status: "rendering", pending: true };
  }

  async function refundForFailure(order) {
    try {
      await refundOrder({ order });
    } catch (err) {
      // Refund API failure must be LOUD — never silent. Mark failed and alert.
      logger.error?.({ err, orderId: order.id }, "Stripe refund failed");
      await orders.updateStatus({
        orderId: order.id,
        fromStatus: ["rendering", "failed"],
        toStatus: "failed",
      });
      await safeAlert("URGENT: Stripe refund FAILED for web order", {
        orderId: order.id,
        paymentIntentId: order.payment_intent_id,
        error: err.message,
      });
      return { status: "failed", refundFailed: true };
    }

    await orders.updateStatus({
      orderId: order.id,
      fromStatus: ["rendering", "failed"],
      toStatus: "refunded",
    });
    try {
      await sendApologyEmail({ order });
    } catch (err) {
      logger.error?.({ err, orderId: order.id }, "Apology email failed");
    }
    await safeAlert("Web order refunded after render failure", {
      orderId: order.id,
    });
    return { status: "refunded" };
  }

  // Single-order tick: advance the order one step based on its current status.
  // Idempotent — safe to call repeatedly and from both the webhook and sweep.
  async function tick(orderId) {
    const order = await orders.findById(orderId);
    if (!order) return { status: "not_found" };
    switch (order.status) {
      case "paid":
        return handlePaid(order);
      case "rendering":
        return handleRendering(order);
      default:
        return { status: order.status, terminal: true };
    }
  }

  // Sweep resumable orders — crash recovery + lost-webhook safety net.
  async function sweepWebOrders({ limit = 25 } = {}) {
    const staleBefore = new Date(Date.now() - STALE_ORDER_MS).toISOString();
    const rows = await orders.findResumableOrders({
      staleBeforeIso: staleBefore,
      limit,
    });
    const results = [];
    for (const order of rows) {
      try {
        results.push({ orderId: order.id, ...(await tick(order.id)) });
      } catch (err) {
        logger.error?.({ err, orderId: order.id }, "Sweep tick failed");
        results.push({ orderId: order.id, error: err.message });
      }
    }
    return results;
  }

  async function describeOrderForStatus(order) {
    const meta = await getTrackMeta({ trackId: order.track_id });
    const recipientName = meta.recipientName || null;
    let shareUrl;
    if (order.status === "delivered" && order.share_token_id) {
      shareUrl = meta.buildShareUrl
        ? meta.buildShareUrl(order.share_token_id)
        : undefined;
    }
    return {
      status: order.status,
      recipient_name: recipientName || undefined,
      progress_copy: progressCopy(order.status, recipientName),
      share_url: shareUrl,
    };
  }

  return {
    tick,
    sweepWebOrders,
    progressCopy,
    describeOrderForStatus,
    MAX_RENDER_ATTEMPTS,
    STALE_ORDER_MS,
  };
}

module.exports = {
  createWebOrderOrchestrator,
  MAX_RENDER_ATTEMPTS,
  STALE_ORDER_MS,
};
