"use strict";

const crypto = require("crypto");
const { nowIso, toJson } = require("../utils/common");
const { getFeatureFlag } = require("../services/feature-flags");

function registerGiftRoutes(app, {
  db,
  requireUserId,
  sendError,
  addAuditEntry,
  eventsService,
  normalizeGiftChannels,
  normalizeGiftPhone,
  normalizeGiftEmail,
  parseGiftChannelsJson,
  renderGiftSummary,
  ensureGiftWalletRow,
  applyGiftWalletTransaction,
  ensureTrackGiftShareToken,
  ensurePoemGiftShareToken,
  dispatchGiftById,
}) {

  // ============ Gift Scheduling + Delivery ============

  app.post("/gifts", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const giftingEnabled = await getFeatureFlag(db, "gift_scheduling_enabled");
    if (!giftingEnabled) {
      sendError(reply, 503, "GIFTING_DISABLED", "Gift scheduling is currently disabled.");
      return;
    }

    const body = request.body || {};
    const contentType = typeof body.content_type === "string" ? body.content_type.trim().toLowerCase() : "";
    const contentId = typeof body.content_id === "string" ? body.content_id.trim() : "";
    const deliveryMode = body.delivery_mode === "scheduled" ? "scheduled" : "immediate";
    const senderTimezone = typeof body.sender_timezone === "string" && body.sender_timezone.trim()
      ? body.sender_timezone.trim()
      : "UTC";
    const channels = normalizeGiftChannels(body.channels);
    const recipientPhone = normalizeGiftPhone(body.recipient_phone);
    const recipientEmail = normalizeGiftEmail(body.recipient_email);
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 500) : "";
    const expiresInDays = Math.max(1, Math.min(Number(body.expires_in_days || 30), 90));
    const versionNum = Number.isFinite(Number(body.version_num)) ? Number(body.version_num) : null;
    const idempotencyKey = (
      request.headers["idempotency-key"] ||
      body.idempotency_key ||
      null
    );

    if (!["song", "poem"].includes(contentType)) {
      sendError(reply, 400, "INVALID_CONTENT_TYPE", "content_type must be song or poem.");
      return;
    }
    if (!contentId) {
      sendError(reply, 400, "INVALID_CONTENT_ID", "content_id is required.");
      return;
    }
    if (!channels.length) {
      sendError(reply, 400, "INVALID_CHANNELS", "At least one channel is required.");
      return;
    }
    if (channels.includes("sms") && !recipientPhone) {
      sendError(reply, 400, "INVALID_RECIPIENT_PHONE", "Valid recipient_phone is required for SMS.");
      return;
    }
    if (channels.includes("email") && !recipientEmail) {
      sendError(reply, 400, "INVALID_RECIPIENT_EMAIL", "Valid recipient_email is required for email.");
      return;
    }

    let sendAt = new Date();
    if (deliveryMode === "scheduled") {
      const parsed = new Date(body.send_at || "");
      if (Number.isNaN(parsed.getTime())) {
        sendError(reply, 400, "INVALID_SEND_AT", "send_at must be a valid ISO timestamp.");
        return;
      }
      if (parsed.getTime() <= Date.now()) {
        sendError(reply, 400, "INVALID_SEND_AT", "send_at must be in the future.");
        return;
      }
      sendAt = parsed;
    }
    const sendAtIso = sendAt.toISOString();

    if (idempotencyKey) {
      const existing = await db.prepare(
        "SELECT * FROM gift_orders WHERE sender_user_id = ? AND idempotency_key = ? LIMIT 1"
      ).get(userId, idempotencyKey);
      if (existing) {
        reply.send({ gift: renderGiftSummary(existing), idempotent: true });
        return;
      }
    }

    try {
      const wallet = await ensureGiftWalletRow(userId);
      if (wallet.balance < 1) {
        sendError(reply, 402, "INSUFFICIENT_GIFT_TOKENS", "You need a gift token to schedule a gift.");
        return;
      }

      const giftOrderId = `gift_${crypto.randomBytes(12).toString("hex")}`;
      const requireAppClaim = await getFeatureFlag(db, "gift_require_app_claim");

      let share;
      if (contentType === "song") {
        share = await ensureTrackGiftShareToken({
          trackId: contentId,
          senderUserId: userId,
          giftOrderId,
          versionNum,
          sendAtIso,
          expiresInDays,
          requireAppClaim: Boolean(requireAppClaim),
        });
      } else {
        share = await ensurePoemGiftShareToken({
          poemId: contentId,
          senderUserId: userId,
          giftOrderId,
          sendAtIso,
          expiresInDays,
          requireAppClaim: Boolean(requireAppClaim),
        });
      }

      const walletDebit = await applyGiftWalletTransaction({
        userId,
        type: "gift_spend",
        amount: -1,
        source: "gift_order",
        referenceType: "gift_order",
        referenceId: giftOrderId,
        description: "Gift token consumed",
        metadata: { content_type: contentType, content_id: contentId },
        idempotencyKey: idempotencyKey ? `gift_spend_${idempotencyKey}` : null,
      });

      await db.prepare(
        `INSERT INTO gift_orders (
          id, sender_user_id, content_type, content_id, status, dispatch_status, delivery_mode,
          send_at, sender_timezone, channels_json, recipient_phone, recipient_email, message,
          share_token_id, share_url, claim_pin, claim_policy, expires_in_days, dispatch_attempts,
          last_dispatch_error, dispatched_at, cancelled_at, token_transaction_id, refund_transaction_id,
          version_num, idempotency_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        giftOrderId,
        userId,
        contentType,
        contentId,
        "scheduled",
        "pending",
        deliveryMode,
        sendAtIso,
        senderTimezone,
        toJson(channels),
        recipientPhone,
        recipientEmail,
        message || null,
        share.shareId,
        share.shareUrl,
        share.claimPin,
        requireAppClaim ? "app_only" : "default",
        expiresInDays,
        0,
        null,
        null,
        null,
        walletDebit.transactionId,
        null,
        versionNum,
        idempotencyKey,
        nowIso(),
        nowIso()
      );

      await addAuditEntry({
        userId,
        action: "gift_scheduled",
        resourceType: "gift_order",
        resourceId: giftOrderId,
        metadata: {
          content_type: contentType,
          delivery_mode: deliveryMode,
          channels,
          send_at: sendAtIso,
        },
      });
      eventsService.emit("gift_scheduled", {
        userId,
        resourceType: "gift_order",
        resourceId: giftOrderId,
        metadata: {
          content_type: contentType,
          delivery_mode: deliveryMode,
          channels,
          send_at: sendAtIso,
        },
      });

      if (deliveryMode === "immediate") {
        await dispatchGiftById(giftOrderId);
      }

      const created = await db.prepare("SELECT * FROM gift_orders WHERE id = ?").get(giftOrderId);
      reply.send({
        gift: renderGiftSummary(created),
        wallet_balance: (await ensureGiftWalletRow(userId)).balance,
      });
    } catch (err) {
      if (err.code === "TRACK_NOT_FOUND" || err.code === "POEM_NOT_FOUND") {
        sendError(reply, 404, err.code, "Gift content not found.");
        return;
      }
      if (err.code === "VERSION_NOT_FOUND") {
        sendError(reply, 404, "VERSION_NOT_FOUND", "Track version not found.");
        return;
      }
      if (err.code === "TRACK_NOT_READY" || err.code === "POEM_NOT_READY") {
        sendError(reply, 409, err.code, "Gift content is not ready for sharing.");
        return;
      }
      if (err.code === "ACTIVE_SHARE_CONFLICT" || err.code === "ACTIVE_GIFT_SHARE_CONFLICT") {
        sendError(reply, 409, err.code, "An active share already exists for this content.");
        return;
      }
      if (err.code === "INSUFFICIENT_GIFT_TOKENS") {
        sendError(reply, 402, "INSUFFICIENT_GIFT_TOKENS", "You need a gift token to schedule a gift.");
        return;
      }
      console.error("[Gifts] Failed to create gift:", err);
      sendError(reply, 500, "GIFT_CREATE_FAILED", err.message);
    }
  });

  app.get("/gifts", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const limit = Math.max(1, Math.min(Number(request.query?.limit || 50), 100));
    const offset = Math.max(0, Number(request.query?.offset || 0));
    const status = typeof request.query?.status === "string" ? request.query.status.trim() : null;

    try {
      let rows;
      if (status) {
        rows = await db.prepare(
          `SELECT * FROM gift_orders
           WHERE sender_user_id = ? AND status = ?
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`
        ).all(userId, status, limit, offset);
      } else {
        rows = await db.prepare(
          `SELECT * FROM gift_orders
           WHERE sender_user_id = ?
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`
        ).all(userId, limit, offset);
      }

      reply.send({
        gifts: rows.map(renderGiftSummary),
        wallet_balance: (await ensureGiftWalletRow(userId)).balance,
      });
    } catch (err) {
      console.error("[Gifts] Failed to list gifts:", err);
      sendError(reply, 500, "GIFT_LIST_FAILED", err.message);
    }
  });

  app.patch("/gifts/:id", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const gift = await db.prepare("SELECT * FROM gift_orders WHERE id = ?").get(request.params.id);
    if (!gift || gift.sender_user_id !== userId) {
      sendError(reply, 404, "GIFT_NOT_FOUND", "Gift not found.");
      return;
    }
    if (!(gift.status === "scheduled" || gift.status === "dispatch_retry")) {
      sendError(reply, 409, "GIFT_NOT_EDITABLE", "Gift can no longer be edited.");
      return;
    }

    const body = request.body || {};
    const nextTimezone = typeof body.sender_timezone === "string" && body.sender_timezone.trim()
      ? body.sender_timezone.trim()
      : gift.sender_timezone;
    const nextMessage = typeof body.message === "string"
      ? body.message.trim().slice(0, 500)
      : (gift.message || "");
    const nextChannels = body.channels
      ? normalizeGiftChannels(body.channels)
      : parseGiftChannelsJson(gift.channels_json);
    const nextPhone = body.recipient_phone !== undefined
      ? normalizeGiftPhone(body.recipient_phone)
      : gift.recipient_phone;
    const nextEmail = body.recipient_email !== undefined
      ? normalizeGiftEmail(body.recipient_email)
      : gift.recipient_email;
    let nextSendAt = gift.send_at;
    if (body.send_at !== undefined) {
      const parsed = new Date(body.send_at || "");
      if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
        sendError(reply, 400, "INVALID_SEND_AT", "send_at must be a future ISO timestamp.");
        return;
      }
      nextSendAt = parsed.toISOString();
    }

    if (!nextChannels.length) {
      sendError(reply, 400, "INVALID_CHANNELS", "At least one channel is required.");
      return;
    }
    if (nextChannels.includes("sms") && !nextPhone) {
      sendError(reply, 400, "INVALID_RECIPIENT_PHONE", "Valid recipient_phone is required for SMS.");
      return;
    }
    if (nextChannels.includes("email") && !nextEmail) {
      sendError(reply, 400, "INVALID_RECIPIENT_EMAIL", "Valid recipient_email is required for email.");
      return;
    }

    await db.prepare(
      `UPDATE gift_orders
       SET send_at = ?, sender_timezone = ?, channels_json = ?, recipient_phone = ?, recipient_email = ?, message = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      nextSendAt,
      nextTimezone,
      toJson(nextChannels),
      nextPhone,
      nextEmail,
      nextMessage || null,
      nowIso(),
      gift.id
    );

    await addAuditEntry({
      userId,
      action: "gift_rescheduled",
      resourceType: "gift_order",
      resourceId: gift.id,
      metadata: { send_at: nextSendAt, channels: nextChannels },
    });
    eventsService.emit("gift_rescheduled", {
      userId,
      resourceType: "gift_order",
      resourceId: gift.id,
      metadata: { send_at: nextSendAt, channels: nextChannels },
    });

    const updated = await db.prepare("SELECT * FROM gift_orders WHERE id = ?").get(gift.id);
    reply.send({ gift: renderGiftSummary(updated) });
  });

  app.post("/gifts/:id/cancel", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const gift = await db.prepare("SELECT * FROM gift_orders WHERE id = ?").get(request.params.id);
    if (!gift || gift.sender_user_id !== userId) {
      sendError(reply, 404, "GIFT_NOT_FOUND", "Gift not found.");
      return;
    }
    if (gift.status === "dispatched") {
      sendError(reply, 409, "GIFT_ALREADY_DISPATCHED", "Gift has already been dispatched.");
      return;
    }
    if (gift.status === "cancelled") {
      reply.send({
        cancelled: true,
        gift: renderGiftSummary(gift),
        wallet_balance: (await ensureGiftWalletRow(userId)).balance,
      });
      return;
    }
    if (!(gift.status === "scheduled" || gift.status === "dispatch_retry")) {
      sendError(reply, 409, "GIFT_NOT_CANCELLABLE", "Gift cannot be cancelled in its current state.");
      return;
    }

    let refundTxId = gift.refund_transaction_id || null;
    if (!refundTxId) {
      const refundTx = await applyGiftWalletTransaction({
        userId,
        type: "gift_refund",
        amount: 1,
        source: "gift_cancel",
        referenceType: "gift_order",
        referenceId: gift.id,
        description: "Gift token refunded after cancellation",
        metadata: { gift_id: gift.id },
        idempotencyKey: `gift_refund_${gift.id}`,
      });
      refundTxId = refundTx.transactionId;
    }

    await db.prepare(
      `UPDATE gift_orders
       SET status = 'cancelled',
           dispatch_status = 'cancelled',
           cancelled_at = ?,
           refund_transaction_id = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(nowIso(), refundTxId, nowIso(), gift.id);

    await addAuditEntry({
      userId,
      action: "gift_cancelled",
      resourceType: "gift_order",
      resourceId: gift.id,
      metadata: { refund_transaction_id: refundTxId },
    });
    eventsService.emit("gift_cancelled", {
      userId,
      resourceType: "gift_order",
      resourceId: gift.id,
      metadata: { refund_transaction_id: refundTxId },
    });

    const updated = await db.prepare("SELECT * FROM gift_orders WHERE id = ?").get(gift.id);
    reply.send({
      cancelled: true,
      gift: renderGiftSummary(updated),
      wallet_balance: (await ensureGiftWalletRow(userId)).balance,
    });
  });
}

module.exports = { registerGiftRoutes };
