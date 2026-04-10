"use strict";

const crypto = require("crypto");
const { nowIso, toJson } = require("../utils/common");
const { getFeatureFlag } = require("../services/feature-flags");
const {
  deleteGiftFundedReservationContent,
  findGiftFundingContent,
} = require("../services/gift-funding");
const {
  dbGet,
  upsertGiftIncident,
  redactGiftContacts,
} = require("../services/gift-delivery-ops");

const ACTIVE_RESERVATION_STATUSES = new Set(["reserved", "content_ready"]);

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
  createGiftDeliveryOutboxRows,
  dispatchGiftById,
  giftReservationTtlMinutes = 45,
}) {

  const reservationTtlMs = Math.max(5, Number(giftReservationTtlMinutes) || 45) * 60 * 1000;

  function isReservationActiveStatus(status) {
    return ACTIVE_RESERVATION_STATUSES.has(String(status || "").toLowerCase());
  }

  function isReservationExpired(reservation) {
    if (!reservation?.expires_at) return true;
    const expiresAt = new Date(reservation.expires_at).getTime();
    if (!Number.isFinite(expiresAt)) return true;
    return expiresAt <= Date.now();
  }

  function renderGiftReservation(reservationRow) {
    if (!reservationRow) return null;
    return {
      id: reservationRow.id,
      user_id: reservationRow.user_id,
      status: reservationRow.status,
      content_type: reservationRow.content_type,
      content_id: reservationRow.content_id,
      version_num: reservationRow.version_num == null ? null : Number(reservationRow.version_num),
      token_transaction_id: reservationRow.token_transaction_id,
      refund_transaction_id: reservationRow.refund_transaction_id,
      gift_order_id: reservationRow.gift_order_id,
      expires_at: reservationRow.expires_at,
      cancel_reason: reservationRow.cancel_reason,
      created_at: reservationRow.created_at,
      updated_at: reservationRow.updated_at,
    };
  }

  function parsePoemVerses(versesJson) {
    if (typeof versesJson !== "string") return [];
    try {
      const parsed = JSON.parse(versesJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function parseVersionNum(rawVersionNum) {
    if (rawVersionNum === undefined || rawVersionNum === null || rawVersionNum === "") {
      return null;
    }
    const parsed = Number(rawVersionNum);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      const err = new Error("INVALID_VERSION_NUM");
      err.code = "INVALID_VERSION_NUM";
      throw err;
    }
    return parsed;
  }

  function expiresAtFromNow() {
    return new Date(Date.now() + reservationTtlMs).toISOString();
  }

  function computeGiftShareExpiresAt(sendAtIso, expiresInDays = 30) {
    return new Date(
      new Date(sendAtIso).getTime() + Number(expiresInDays || 30) * 24 * 60 * 60 * 1000
    ).toISOString();
  }

  async function emitGiftActivity({
    userId,
    action,
    eventName,
    resourceType,
    resourceId,
    metadata,
  }) {
    await addAuditEntry({
      userId,
      action,
      resourceType,
      resourceId,
      metadata,
    });

    eventsService.emit(eventName || action, {
      userId,
      resourceType,
      resourceId,
      metadata,
    });
  }

  function buildGiftScheduleMetadata({ contentType, deliveryMode, channels, sendAtIso }) {
    return {
      content_type: contentType,
      delivery_mode: deliveryMode,
      channels,
      send_at: sendAtIso,
    };
  }

  function logGiftLifecycle(level, event, metadata = {}) {
    const safeLevel = typeof app.log?.[level] === "function" ? level : "info";
    app.log[safeLevel]({
      event: `gift_${event}`,
      ...redactGiftContacts(metadata),
    }, `gift_${event}`);
  }

  async function recordGiftIncident({
    incidentKey,
    incidentType,
    severity = "warning",
    giftOrderId = null,
    summary,
    detail = null,
    metadata = {},
  }) {
    const incident = await upsertGiftIncident(db, {
      incidentKey,
      incidentType,
      severity,
      giftOrderId,
      resourceType: giftOrderId ? "gift_order" : null,
      resourceId: giftOrderId,
      summary,
      detail,
      metadata,
    });
    logGiftLifecycle(severity === "critical" ? "error" : "warn", "incident_opened", {
      incident_key: incidentKey,
      incident_type: incidentType,
      gift_id: giftOrderId,
      summary,
    });
    return incident;
  }

  async function verifyGiftFinalizeIntegrity(giftOrderId, query = null) {
    const runner = query || db.query.bind(db);
    const gift = await dbGet(runner, "SELECT * FROM gift_orders WHERE id = ?", [giftOrderId]);
    if (!gift) {
      return { ok: false, errors: ["missing_gift_order"], gift: null, outboxRows: [], shareRow: null };
    }

    const outboxRows = (await runner(
      "SELECT id, channel, recipient, status, send_after, next_retry_at FROM gift_delivery_outbox WHERE gift_order_id = ? ORDER BY created_at ASC",
      [giftOrderId]
    ))?.rows || [];
    const channels = parseGiftChannelsJson(gift.channels_json);
    const shareTable = gift.content_type === "poem" ? "poem_share_tokens" : "share_tokens";
    const shareRow = await dbGet(
      runner,
      `SELECT id, gift_order_id, delivery_source, dispatch_at FROM ${shareTable} WHERE id = ?`,
      [gift.share_token_id]
    );

    const errors = [];
    if (!gift.share_token_id || !shareRow) {
      errors.push("missing_gift_share_token");
    }
    if (shareRow && (shareRow.gift_order_id !== giftOrderId || shareRow.delivery_source !== "gift")) {
      errors.push("gift_share_token_binding_invalid");
    }
    if (shareRow && shareRow.dispatch_at !== gift.send_at) {
      errors.push("gift_share_dispatch_at_mismatch");
    }
    if (outboxRows.length !== channels.length) {
      errors.push("gift_outbox_channel_count_mismatch");
    }
    for (const channel of channels) {
      const row = outboxRows.find((entry) => entry.channel === channel);
      if (!row) {
        errors.push(`missing_outbox_${channel}`);
        continue;
      }
      if (row.send_after !== gift.send_at) {
        errors.push(`outbox_send_after_mismatch_${channel}`);
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      gift,
      outboxRows,
      shareRow,
    };
  }

  async function assertGiftFinalizeIntegrity(giftOrderId) {
    const integrity = await verifyGiftFinalizeIntegrity(giftOrderId);
    if (integrity.ok) {
      logGiftLifecycle("info", "finalize_integrity_verified", {
        gift_id: giftOrderId,
        outbox_count: integrity.outboxRows.length,
      });
      return integrity.gift;
    }

    await recordGiftIncident({
      incidentKey: `gift_finalize_integrity:${giftOrderId}`,
      incidentType: "finalize_integrity_failed",
      severity: "critical",
      giftOrderId,
      summary: "Gift finalize integrity check failed",
      detail: integrity.errors.join(", "),
      metadata: { errors: integrity.errors },
    });
    throw Object.assign(new Error("GIFT_FINALIZE_INTEGRITY_FAILED"), {
      code: "GIFT_FINALIZE_INTEGRITY_FAILED",
      details: integrity.errors,
    });
  }

  async function queryGet(query, sql, params = []) {
    const result = await query(sql, params);
    return result?.rows?.[0] || null;
  }

  async function readGiftWalletBalance(userId, query = null) {
    if (query) {
      return Number((await queryGet(query, "SELECT balance FROM gift_wallet WHERE user_id = ?", [userId]))?.balance || 0);
    }
    return (await ensureGiftWalletRow(userId)).balance;
  }

  function parseGiftDeliveryRequest(body, reply) {
    const recipientName = typeof body.recipient_name === "string"
      ? body.recipient_name.trim().slice(0, 100)
      : "";
    const deliveryMode = body.delivery_mode === "scheduled" ? "scheduled" : "immediate";
    const senderTimezone = typeof body.sender_timezone === "string" && body.sender_timezone.trim()
      ? body.sender_timezone.trim()
      : "UTC";
    const channels = normalizeGiftChannels(body.channels);
    const recipientPhone = normalizeGiftPhone(body.recipient_phone);
    const recipientEmail = normalizeGiftEmail(body.recipient_email);
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 500) : "";
    const expiresInDays = Math.max(1, Math.min(Number(body.expires_in_days || 30), 90));

    if (!channels.length) {
      sendError(reply, 400, "INVALID_CHANNELS", "At least one channel is required.");
      return null;
    }
    if (channels.includes("sms") && !recipientPhone) {
      sendError(reply, 400, "INVALID_RECIPIENT_PHONE", "Valid recipient_phone is required for SMS.");
      return null;
    }
    if (channels.includes("email") && !recipientEmail) {
      sendError(reply, 400, "INVALID_RECIPIENT_EMAIL", "Valid recipient_email is required for email.");
      return null;
    }

    let sendAt = new Date();
    if (deliveryMode === "scheduled") {
      const parsed = new Date(body.send_at || "");
      if (Number.isNaN(parsed.getTime())) {
        sendError(reply, 400, "INVALID_SEND_AT", "send_at must be a valid ISO timestamp.");
        return null;
      }
      if (parsed.getTime() <= Date.now()) {
        sendError(reply, 400, "INVALID_SEND_AT", "send_at must be in the future.");
        return null;
      }
      sendAt = parsed;
    }

    return {
      recipientName,
      deliveryMode,
      senderTimezone,
      channels,
      recipientPhone,
      recipientEmail,
      message,
      expiresInDays,
      sendAtIso: sendAt.toISOString(),
    };
  }

  async function validateGiftContent({ userId, contentType, contentId, versionNum = null }) {
    if (contentType === "song") {
      const track = await db.prepare("SELECT id, user_id, title, recipient_name, occasion, latest_version, deleted_at FROM tracks WHERE id = ?").get(contentId);
      if (!track || track.user_id !== userId || track.deleted_at) {
        const err = new Error("TRACK_NOT_FOUND");
        err.code = "TRACK_NOT_FOUND";
        throw err;
      }

      const resolvedVersionNum = Number(versionNum || track.latest_version || 1);
      const trackVersion = await db
        .prepare("SELECT id, preview_url, full_url FROM track_versions WHERE track_id = ? AND version_num = ?")
        .get(track.id, resolvedVersionNum);

      if (!trackVersion) {
        const err = new Error("VERSION_NOT_FOUND");
        err.code = "VERSION_NOT_FOUND";
        throw err;
      }

      if (!trackVersion.preview_url && !trackVersion.full_url) {
        const err = new Error("TRACK_NOT_READY");
        err.code = "TRACK_NOT_READY";
        throw err;
      }

      return {
        contentType: "song",
        contentId: track.id,
        versionNum: resolvedVersionNum,
        contentSnapshot: {
          title: track.title,
          recipient_name: track.recipient_name,
          occasion: track.occasion,
        },
      };
    }

    if (contentType === "poem") {
      const poem = await db
        .prepare("SELECT id, user_id, title, recipient_name, occasion, tone, verses, message, deleted_at FROM poems WHERE id = ?")
        .get(contentId);
      if (!poem || poem.user_id !== userId || poem.deleted_at) {
        const err = new Error("POEM_NOT_FOUND");
        err.code = "POEM_NOT_FOUND";
        throw err;
      }
      const verses = parsePoemVerses(poem.verses);
      if (!Array.isArray(verses) || verses.length === 0) {
        const err = new Error("POEM_NOT_READY");
        err.code = "POEM_NOT_READY";
        throw err;
      }

      return {
        contentType: "poem",
        contentId: poem.id,
        versionNum: null,
        contentSnapshot: {
          title: poem.title,
          recipient_name: poem.recipient_name,
          occasion: poem.occasion,
          tone: poem.tone,
          message: poem.message,
          verses,
        },
      };
    }

    const err = new Error("INVALID_CONTENT_TYPE");
    err.code = "INVALID_CONTENT_TYPE";
    throw err;
  }

  async function refundReservationTokenIfNeeded(reservation, {
    status,
    cancelReason,
    source,
    description,
    auditAction,
    eventName,
  }) {
    let refundTxId = reservation.refund_transaction_id || null;
    await deleteGiftFundedReservationContent(db, reservation.id, nowIso());
    if (!refundTxId) {
      const refundTx = await applyGiftWalletTransaction({
        userId: reservation.user_id,
        type: "gift_reserve_refund",
        amount: 1,
        source,
        referenceType: "gift_reservation",
        referenceId: reservation.id,
        description,
        metadata: { reservation_id: reservation.id, reason: cancelReason },
        idempotencyKey: `gift_reserve_refund_${reservation.id}`,
      });
      refundTxId = refundTx.transactionId;
    }

    await db.prepare(
      `UPDATE gift_reservations
       SET status = ?, refund_transaction_id = COALESCE(?, refund_transaction_id), cancel_reason = ?, updated_at = ?
       WHERE id = ?`
    ).run(status, refundTxId, cancelReason, nowIso(), reservation.id);

    await emitGiftActivity({
      userId: reservation.user_id,
      action: auditAction,
      eventName,
      resourceType: "gift_reservation",
      resourceId: reservation.id,
      metadata: { refund_transaction_id: refundTxId, reason: cancelReason },
    });

    return await db.prepare("SELECT * FROM gift_reservations WHERE id = ?").get(reservation.id);
  }

  async function expireReservationIfNeeded(reservation) {
    if (!reservation || !isReservationActiveStatus(reservation.status)) {
      return reservation;
    }
    if (!isReservationExpired(reservation)) {
      return reservation;
    }

    return await refundReservationTokenIfNeeded(reservation, {
      status: "expired",
      cancelReason: "reservation_expired",
      source: "gift_reservation_expire",
      description: "Gift reservation expired and token was refunded",
      auditAction: "gift_reservation_expired",
      eventName: "gift_reservation_expired",
    });
  }

  async function reconcileReservationContentIfNeeded(reservation) {
    if (!reservation || !isReservationActiveStatus(reservation.status)) {
      return reservation;
    }

    if (reservation.content_type && reservation.content_id) {
      return reservation;
    }

    const recovered = await findGiftFundingContent(db, {
      reservationId: reservation.id,
    });
    if (!recovered) {
      return reservation;
    }

    await db.prepare(
      `UPDATE gift_reservations
       SET status = 'content_ready',
           content_type = ?,
           content_id = ?,
           version_num = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(
      recovered.contentType,
      recovered.contentId,
      recovered.versionNum,
      nowIso(),
      reservation.id
    );

    return await db.prepare("SELECT * FROM gift_reservations WHERE id = ?").get(reservation.id);
  }

  async function createGiftOrderFromPayload({
    userId,
    contentType,
    contentId,
    recipientName,
    deliveryMode,
    senderTimezone,
    channels,
    recipientPhone,
    recipientEmail,
    message,
    sendAtIso,
    expiresInDays,
    versionNum,
    idempotencyKey,
    tokenTransactionId = null,
    externalQuery = null,
    skipDispatch = false,
    skipSideEffects = false,
  }) {
    const validated = await validateGiftContent({ userId, contentType, contentId, versionNum });
    const requireAppClaim = await getFeatureFlag(db, "gift_require_app_claim");
    const giftOrderId = `gift_${crypto.randomBytes(12).toString("hex")}`;
    const resolvedRecipientName = (typeof recipientName === "string" && recipientName.trim())
      ? recipientName.trim().slice(0, 100)
      : (validated.contentSnapshot?.recipient_name || null);

    const executeCreate = async (query) => {
      if (idempotencyKey) {
        const existing = await queryGet(
          query,
          "SELECT * FROM gift_orders WHERE sender_user_id = ? AND idempotency_key = ? LIMIT 1",
          [userId, idempotencyKey]
        );
        if (existing) {
          return { gift: existing, idempotent: true };
        }
      }

      let resolvedTokenTxId = tokenTransactionId;
      let autoDebited = false;
      if (!resolvedTokenTxId) {
        const wallet = await ensureGiftWalletRow(userId);
        if (wallet.balance < 1) {
          const err = new Error("INSUFFICIENT_GIFT_TOKENS");
          err.code = "INSUFFICIENT_GIFT_TOKENS";
          throw err;
        }
        const walletDebit = await applyGiftWalletTransaction({
          userId,
          type: "gift_spend",
          amount: -1,
          source: "gift_order",
          referenceType: "gift_order",
          referenceId: giftOrderId,
          description: "Gift token consumed",
          metadata: { content_type: validated.contentType, content_id: validated.contentId },
          idempotencyKey: idempotencyKey ? `gift_spend_${idempotencyKey}` : null,
          externalQuery: query,
        });
        resolvedTokenTxId = walletDebit.transactionId;
        autoDebited = true;
      }

      try {
        const share = validated.contentType === "song"
          ? await ensureTrackGiftShareToken({
            trackId: validated.contentId,
            senderUserId: userId,
            giftOrderId,
            versionNum: validated.versionNum,
            sendAtIso,
            expiresInDays,
            requireAppClaim: Boolean(requireAppClaim),
            externalQuery: query,
          })
          : await ensurePoemGiftShareToken({
            poemId: validated.contentId,
            senderUserId: userId,
            giftOrderId,
            sendAtIso,
            expiresInDays,
            requireAppClaim: Boolean(requireAppClaim),
            externalQuery: query,
          });

        const timestamp = nowIso();
        await query(
          `INSERT INTO gift_orders (
            id, sender_user_id, content_type, content_id, status, dispatch_status, delivery_mode,
            send_at, sender_timezone, recipient_name, channels_json, recipient_phone, recipient_email, message,
            share_token_id, share_url, claim_pin, claim_policy, expires_in_days, dispatch_attempts,
            last_dispatch_error, dispatched_at, cancelled_at, token_transaction_id, refund_transaction_id,
            version_num, content_snapshot_json, next_retry_at, dispatch_started_at, idempotency_key, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            giftOrderId,
            userId,
            validated.contentType,
            validated.contentId,
            "scheduled",
            "pending",
            deliveryMode,
            sendAtIso,
            senderTimezone,
            resolvedRecipientName,
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
            resolvedTokenTxId,
            null,
            validated.versionNum,
            validated.contentSnapshot ? toJson(validated.contentSnapshot) : null,
            sendAtIso,
            null,
            idempotencyKey,
            timestamp,
            timestamp,
          ]
        );

        await createGiftDeliveryOutboxRows({
          giftOrderId,
          channels,
          recipientPhone,
          recipientEmail,
          sendAtIso,
          externalQuery: query,
        });

        const created = await queryGet(query, "SELECT * FROM gift_orders WHERE id = ?", [giftOrderId]);
        return { gift: created, idempotent: false };
      } catch (err) {
        if (autoDebited) {
          await applyGiftWalletTransaction({
            userId,
            type: "gift_refund",
            amount: 1,
            source: "gift_create_rollback",
            referenceType: "gift_order",
            referenceId: giftOrderId,
            description: "Gift token refunded after gift create rollback",
            metadata: { rollback: true },
            idempotencyKey: `gift_refund_create_${giftOrderId}`,
            externalQuery: query,
          });
        }
        throw err;
      }
    };

    const created = externalQuery
      ? await executeCreate(externalQuery)
      : await db.transaction(async (query) => executeCreate(query));

    const verifiedGift = await assertGiftFinalizeIntegrity(created.gift.id);
    created.gift = verifiedGift;

    logGiftLifecycle("info", created.idempotent ? "finalize_idempotent" : "finalized", {
      gift_id: created.gift.id,
      content_type: validated.contentType,
      delivery_mode: deliveryMode,
      channels,
      send_at: sendAtIso,
      recipient_phone: recipientPhone,
      recipient_email: recipientEmail,
    });

    if (!skipSideEffects) {
      await emitGiftActivity({
        userId,
        action: "gift_scheduled",
        resourceType: "gift_order",
        resourceId: created.gift.id,
        metadata: buildGiftScheduleMetadata({
          contentType: validated.contentType,
          deliveryMode,
          channels,
          sendAtIso,
        }),
      });
    }

    if (deliveryMode === "immediate" && !skipDispatch && created.gift?.id) {
      await dispatchGiftById(created.gift.id);
      created.gift = await db.prepare("SELECT * FROM gift_orders WHERE id = ?").get(created.gift.id);
    }

    return {
      gift: created.gift,
      idempotent: created.idempotent,
      walletBalance: await readGiftWalletBalance(userId, externalQuery),
    };
  }

  function mapGiftCreateError(err, reply) {
    if (err.code === "TRACK_NOT_FOUND" || err.code === "POEM_NOT_FOUND") {
      sendError(reply, 404, err.code, "Gift content not found.");
      return true;
    }
    if (err.code === "VERSION_NOT_FOUND") {
      sendError(reply, 404, "VERSION_NOT_FOUND", "Track version not found.");
      return true;
    }
    if (err.code === "TRACK_NOT_READY" || err.code === "POEM_NOT_READY") {
      sendError(reply, 409, err.code, "Gift content is not ready for sharing.");
      return true;
    }
    if (err.code === "ACTIVE_SHARE_CONFLICT" || err.code === "ACTIVE_GIFT_SHARE_CONFLICT") {
      sendError(reply, 409, err.code, "An active share already exists for this content.");
      return true;
    }
    if (err.code === "INSUFFICIENT_GIFT_TOKENS") {
      sendError(reply, 402, "INSUFFICIENT_GIFT_TOKENS", "Unlock a gift credit to keep going.");
      return true;
    }
    if (err.code === "INVALID_CONTENT_TYPE") {
      sendError(reply, 400, "INVALID_CONTENT_TYPE", "content_type must be song or poem.");
      return true;
    }
    if (err.code === "INVALID_VERSION_NUM") {
      sendError(reply, 400, "INVALID_VERSION_NUM", "version_num must be a positive integer.");
      return true;
    }
    if (err.code === "GIFT_FINALIZE_INTEGRITY_FAILED") {
      sendError(reply, 500, "GIFT_FINALIZE_INTEGRITY_FAILED", "Gift finalize integrity check failed.");
      return true;
    }
    return false;
  }

  async function expireGiftReservations({ limit = 50 } = {}) {
    const now = new Date().toISOString();
    const rows = await db.prepare(
      `SELECT *
       FROM gift_reservations
       WHERE status IN ('reserved', 'content_ready')
         AND expires_at <= ?
       ORDER BY expires_at ASC
       LIMIT ?`
    ).all(now, Math.max(1, Number(limit) || 50));

    let processed = 0;
    let refunded = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const beforeRefundTx = row.refund_transaction_id || null;
        await refundReservationTokenIfNeeded(row, {
          status: "expired",
          cancelReason: "reservation_expired",
          source: "gift_reservation_expire",
          description: "Gift reservation expired and token was refunded",
          auditAction: "gift_reservation_expired",
          eventName: "gift_reservation_expired",
        });
        processed += 1;
        if (!beforeRefundTx) {
          refunded += 1;
        }
      } catch (err) {
        failed += 1;
        app.log.error({ err, reservationId: row.id }, "Failed to expire gift reservation");
      }
    }

    return { processed, refunded, failed };
  }

  async function cancelGiftOrderById(giftId, {
    actorUserId,
    actorType = "user",
  }) {
    const gift = await db.prepare("SELECT * FROM gift_orders WHERE id = ?").get(giftId);
    if (!gift) {
      const err = new Error("GIFT_NOT_FOUND");
      err.code = "GIFT_NOT_FOUND";
      throw err;
    }
    if (gift.status === "dispatched") {
      const err = new Error("GIFT_ALREADY_DISPATCHED");
      err.code = "GIFT_ALREADY_DISPATCHED";
      throw err;
    }
    if (gift.status === "cancelled") {
      return {
        gift,
        walletBalance: (await ensureGiftWalletRow(gift.sender_user_id)).balance,
        cancelled: true,
        idempotent: true,
      };
    }
    if (!(gift.status === "scheduled" || gift.status === "dispatch_retry")) {
      const err = new Error("GIFT_NOT_CANCELLABLE");
      err.code = "GIFT_NOT_CANCELLABLE";
      throw err;
    }

    const sentDelivery = await db.prepare(
      "SELECT id FROM gift_delivery_outbox WHERE gift_order_id = ? AND status = 'sent' LIMIT 1"
    ).get(gift.id);
    if (sentDelivery) {
      const err = new Error("GIFT_ALREADY_PARTIALLY_DISPATCHED");
      err.code = "GIFT_ALREADY_PARTIALLY_DISPATCHED";
      throw err;
    }

    let refundTxId = gift.refund_transaction_id || null;
    if (!refundTxId) {
      const refundTx = await applyGiftWalletTransaction({
        userId: gift.sender_user_id,
        type: "gift_refund",
        amount: 1,
        source: actorType === "admin" ? "gift_cancel_admin" : "gift_cancel",
        referenceType: "gift_order",
        referenceId: gift.id,
        description: "Gift token refunded after cancellation",
        metadata: { gift_id: gift.id, actor_type: actorType, actor_user_id: actorUserId || null },
        idempotencyKey: `gift_refund_${gift.id}`,
      });
      refundTxId = refundTx.transactionId;
    }

    const timestamp = nowIso();
    await db.prepare(
      `UPDATE gift_orders
       SET status = 'cancelled',
           dispatch_status = 'cancelled',
           cancelled_at = ?,
           refund_transaction_id = ?,
           next_retry_at = NULL,
           dispatch_started_at = NULL,
           updated_at = ?
       WHERE id = ?`
    ).run(timestamp, refundTxId, timestamp, gift.id);

    await db.prepare(
      `UPDATE gift_delivery_outbox
       SET status = 'cancelled',
           next_retry_at = NULL,
           locked_at = NULL,
           updated_at = ?
       WHERE gift_order_id = ? AND status IN ('pending', 'failed', 'sending')`
    ).run(timestamp, gift.id);

    if (gift.content_type === "song") {
      await db.prepare(
        `UPDATE share_tokens
         SET status = 'revoked', web_stream_allowed = 0, expires_at = ?, dispatched_at = NULL
         WHERE id = ? AND gift_order_id = ? AND delivery_source = 'gift'`
      ).run(timestamp, gift.share_token_id, gift.id);
    } else if (gift.content_type === "poem") {
      await db.prepare(
        `UPDATE poem_share_tokens
         SET status = 'revoked', expires_at = ?, dispatched_at = NULL
         WHERE id = ? AND gift_order_id = ? AND delivery_source = 'gift'`
      ).run(timestamp, gift.share_token_id, gift.id);
    }

    logGiftLifecycle("warn", "cancelled", {
      gift_id: gift.id,
      actor_type: actorType,
      actor_user_id: actorUserId || null,
      refund_transaction_id: refundTxId,
    });

    const updated = await db.prepare("SELECT * FROM gift_orders WHERE id = ?").get(gift.id);
    return {
      gift: updated,
      walletBalance: (await ensureGiftWalletRow(gift.sender_user_id)).balance,
      cancelled: true,
      idempotent: false,
      refundTxId,
    };
  }

  async function retryGiftOrderById(giftId, {
    actorUserId,
    actorType = "admin",
  } = {}) {
    const gift = await db.prepare("SELECT * FROM gift_orders WHERE id = ?").get(giftId);
    if (!gift) {
      const err = new Error("GIFT_NOT_FOUND");
      err.code = "GIFT_NOT_FOUND";
      throw err;
    }
    if (gift.status === "cancelled" || gift.dispatch_status === "cancelled") {
      const err = new Error("GIFT_CANCELLED");
      err.code = "GIFT_CANCELLED";
      throw err;
    }
    if (!(gift.status === "scheduled" || gift.status === "dispatch_retry")) {
      const err = new Error("GIFT_NOT_RETRYABLE");
      err.code = "GIFT_NOT_RETRYABLE";
      throw err;
    }

    const sentDelivery = await db.prepare(
      "SELECT id FROM gift_delivery_outbox WHERE gift_order_id = ? AND status = 'sent' LIMIT 1"
    ).get(gift.id);
    if (sentDelivery) {
      const err = new Error("GIFT_ALREADY_PARTIALLY_DISPATCHED");
      err.code = "GIFT_ALREADY_PARTIALLY_DISPATCHED";
      throw err;
    }

    const timestamp = nowIso();
    await db.prepare(
      `UPDATE gift_delivery_outbox
       SET status = 'pending',
           next_retry_at = ?,
           locked_at = NULL,
           last_error = CASE WHEN status = 'failed' THEN last_error ELSE last_error END,
           updated_at = ?
       WHERE gift_order_id = ?
         AND status IN ('failed', 'pending')`
    ).run(timestamp, timestamp, gift.id);

    await db.prepare(
      `UPDATE gift_orders
       SET status = 'dispatch_retry',
           dispatch_status = 'retrying',
           next_retry_at = ?,
           dispatch_started_at = NULL,
           updated_at = ?
       WHERE id = ?`
    ).run(timestamp, timestamp, gift.id);

    logGiftLifecycle("warn", "requeued", {
      gift_id: gift.id,
      actor_type: actorType,
      actor_user_id: actorUserId || null,
    });

    return await db.prepare("SELECT * FROM gift_orders WHERE id = ?").get(gift.id);
  }

  app.decorate("retryGiftOrderById", retryGiftOrderById);
  app.decorate("cancelGiftOrderById", cancelGiftOrderById);

  app.decorate("expireGiftReservations", expireGiftReservations);

  // ============ Gift Reservations (prepay flow) ============

  app.post("/gifts/reservations", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const giftingEnabled = await getFeatureFlag(db, "gift_scheduling_enabled");
    if (!giftingEnabled) {
      sendError(reply, 503, "GIFTING_DISABLED", "Gift scheduling is currently disabled.");
      return;
    }

    const body = request.body || {};
    const idempotencyKey =
      request.headers["idempotency-key"] ||
      body.idempotency_key ||
      null;

    if (idempotencyKey) {
      const existing = await db
        .prepare("SELECT * FROM gift_reservations WHERE user_id = ? AND idempotency_key = ? LIMIT 1")
        .get(userId, idempotencyKey);
      if (existing) {
        const maybeExpired = await expireReservationIfNeeded(existing);
        const reservation = isReservationActiveStatus(maybeExpired.status)
          ? renderGiftReservation(maybeExpired)
          : null;
        reply.send({
          reservation,
          wallet_balance: (await ensureGiftWalletRow(userId)).balance,
          idempotent: true,
        });
        return;
      }
    }

    const activeReservation = await db.prepare(
      `SELECT *
       FROM gift_reservations
       WHERE user_id = ?
         AND status IN ('reserved', 'content_ready')
       ORDER BY created_at DESC
       LIMIT 1`
    ).get(userId);

    if (activeReservation) {
      const resolved = await expireReservationIfNeeded(activeReservation);
      if (isReservationActiveStatus(resolved.status)) {
        sendError(reply, 409, "RESERVATION_ALREADY_ACTIVE", "You already have an active gift reservation.");
        return;
      }
    }

    try {
      const wallet = await ensureGiftWalletRow(userId);
      if (wallet.balance < 1) {
        sendError(reply, 402, "INSUFFICIENT_GIFT_TOKENS", "Unlock a gift credit to keep going.");
        return;
      }

      const reservationId = `gres_${crypto.randomBytes(12).toString("hex")}`;
      const tokenTx = await applyGiftWalletTransaction({
        userId,
        type: "gift_reserve",
        amount: -1,
        source: "gift_reservation",
        referenceType: "gift_reservation",
        referenceId: reservationId,
        description: "Gift token reserved before content creation",
        metadata: { flow_type: "gift" },
        idempotencyKey: idempotencyKey ? `gift_reserve_${idempotencyKey}` : null,
      });

      await db.prepare(
        `INSERT INTO gift_reservations (
          id, user_id, status, content_type, content_id, version_num,
          token_transaction_id, refund_transaction_id, gift_order_id,
          idempotency_key, expires_at, cancel_reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        reservationId,
        userId,
        "reserved",
        null,
        null,
        null,
        tokenTx.transactionId,
        null,
        null,
        idempotencyKey,
        expiresAtFromNow(),
        null,
        nowIso(),
        nowIso()
      );

      await emitGiftActivity({
        userId,
        action: "gift_reservation_created",
        resourceType: "gift_reservation",
        resourceId: reservationId,
        metadata: { expires_in_minutes: Math.round(reservationTtlMs / 60000) },
      });

      const reservation = await db.prepare("SELECT * FROM gift_reservations WHERE id = ?").get(reservationId);
      reply.send({
        reservation: renderGiftReservation(reservation),
        wallet_balance: (await ensureGiftWalletRow(userId)).balance,
      });
    } catch (err) {
      if (err.code === "INSUFFICIENT_GIFT_TOKENS") {
        sendError(reply, 402, "INSUFFICIENT_GIFT_TOKENS", "Unlock a gift credit to keep going.");
        return;
      }
      request.log.error({ err }, "Failed to create gift reservation");
      sendError(reply, 500, "GIFT_RESERVATION_CREATE_FAILED", "An internal error occurred.");
    }
  });

  app.get("/gifts/reservations/active", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const activeReservation = await db.prepare(
      `SELECT *
       FROM gift_reservations
       WHERE user_id = ?
         AND status IN ('reserved', 'content_ready')
       ORDER BY created_at DESC
       LIMIT 1`
    ).get(userId);

    if (!activeReservation) {
      reply.send({ reservation: null, wallet_balance: (await ensureGiftWalletRow(userId)).balance });
      return;
    }

    const resolved = await expireReservationIfNeeded(activeReservation);
    if (!isReservationActiveStatus(resolved.status)) {
      reply.send({ reservation: null, wallet_balance: (await ensureGiftWalletRow(userId)).balance });
      return;
    }

    const reconciled = await reconcileReservationContentIfNeeded(resolved);

    reply.send({
      reservation: renderGiftReservation(reconciled),
      wallet_balance: (await ensureGiftWalletRow(userId)).balance,
    });
  });

  app.post("/gifts/reservations/:id/content", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const reservation = await db.prepare("SELECT * FROM gift_reservations WHERE id = ?").get(request.params.id);
    if (!reservation || reservation.user_id !== userId) {
      sendError(reply, 404, "RESERVATION_NOT_FOUND", "Gift reservation not found.");
      return;
    }

    if (!isReservationActiveStatus(reservation.status)) {
      sendError(reply, 409, "RESERVATION_NOT_EDITABLE", "Reservation can no longer be modified.");
      return;
    }

    const refreshed = await expireReservationIfNeeded(reservation);
    if (!isReservationActiveStatus(refreshed.status)) {
      sendError(reply, 409, "RESERVATION_EXPIRED", "This gift draft expired. Start a fresh gift to keep going.");
      return;
    }

    const body = request.body || {};
    const contentType = typeof body.content_type === "string" ? body.content_type.trim().toLowerCase() : "";
    const contentId = typeof body.content_id === "string" ? body.content_id.trim() : "";

    if (!["song", "poem"].includes(contentType)) {
      sendError(reply, 400, "INVALID_CONTENT_TYPE", "content_type must be song or poem.");
      return;
    }
    if (!contentId) {
      sendError(reply, 400, "INVALID_CONTENT_ID", "content_id is required.");
      return;
    }

    let versionNum;
    try {
      versionNum = parseVersionNum(body.version_num);
    } catch (err) {
      sendError(reply, 400, "INVALID_VERSION_NUM", "version_num must be a positive integer.");
      return;
    }

    try {
      const validated = await validateGiftContent({
        userId,
        contentType,
        contentId,
        versionNum,
      });

      await db.prepare(
        `UPDATE gift_reservations
         SET status = 'content_ready',
             content_type = ?,
             content_id = ?,
             version_num = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(validated.contentType, validated.contentId, validated.versionNum, nowIso(), refreshed.id);

      await emitGiftActivity({
        userId,
        action: "gift_reservation_content_attached",
        resourceType: "gift_reservation",
        resourceId: refreshed.id,
        metadata: {
          content_type: validated.contentType,
          content_id: validated.contentId,
          version_num: validated.versionNum,
        },
      });

      const updated = await db.prepare("SELECT * FROM gift_reservations WHERE id = ?").get(refreshed.id);
      reply.send({
        reservation: renderGiftReservation(updated),
        wallet_balance: (await ensureGiftWalletRow(userId)).balance,
      });
    } catch (err) {
      if (mapGiftCreateError(err, reply)) {
        return;
      }
      request.log.error({ err, reservationId: refreshed.id }, "Failed to attach gift reservation content");
      sendError(reply, 500, "GIFT_RESERVATION_CONTENT_FAILED", "An internal error occurred.");
    }
  });

  app.post("/gifts/reservations/:id/finalize", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const reservation = await db.prepare("SELECT * FROM gift_reservations WHERE id = ?").get(request.params.id);
    if (!reservation || reservation.user_id !== userId) {
      sendError(reply, 404, "RESERVATION_NOT_FOUND", "Gift reservation not found.");
      return;
    }

    if (reservation.status === "finalized") {
      if (!reservation.gift_order_id) {
        sendError(reply, 409, "RESERVATION_FINALIZE_INCOMPLETE", "Reservation has already been finalized.");
        return;
      }
      const existingGift = await db.prepare("SELECT * FROM gift_orders WHERE id = ?").get(reservation.gift_order_id);
      if (!existingGift || existingGift.sender_user_id !== userId) {
        sendError(reply, 409, "RESERVATION_FINALIZE_INCOMPLETE", "Reservation has already been finalized.");
        return;
      }
      reply.send({
        gift: renderGiftSummary(existingGift),
        wallet_balance: (await ensureGiftWalletRow(userId)).balance,
        idempotent: true,
      });
      return;
    }

    if (!isReservationActiveStatus(reservation.status)) {
      sendError(reply, 409, "RESERVATION_NOT_FINALIZABLE", "Reservation can no longer be finalized.");
      return;
    }

    const refreshed = await expireReservationIfNeeded(reservation);
    if (!isReservationActiveStatus(refreshed.status)) {
      sendError(reply, 409, "RESERVATION_EXPIRED", "This gift draft expired. Start a fresh gift to keep going.");
      return;
    }

    const reconciled = await reconcileReservationContentIfNeeded(refreshed);

    if (!reconciled.content_type || !reconciled.content_id) {
      sendError(reply, 400, "RESERVATION_CONTENT_REQUIRED", "Attach song or poem content before finalizing.");
      return;
    }

    const body = request.body || {};
    const idempotencyKey = request.headers["idempotency-key"] || body.idempotency_key || null;
    const deliveryRequest = parseGiftDeliveryRequest(body, reply);
    if (!deliveryRequest) return;
    const {
      recipientName,
      deliveryMode,
      senderTimezone,
      channels,
      recipientPhone,
      recipientEmail,
      message,
      expiresInDays,
      sendAtIso,
    } = deliveryRequest;

    try {
      const created = await db.transaction(async (query) => {
        const latestReservation = await queryGet(
          query,
          "SELECT * FROM gift_reservations WHERE id = ?",
          [reconciled.id]
        );
        if (!latestReservation || latestReservation.user_id !== userId) {
          const err = new Error("RESERVATION_NOT_FOUND");
          err.code = "RESERVATION_NOT_FOUND";
          throw err;
        }
        if (latestReservation.status === "finalized" && latestReservation.gift_order_id) {
          const existingGift = await queryGet(query, "SELECT * FROM gift_orders WHERE id = ?", [latestReservation.gift_order_id]);
          return { gift: existingGift, idempotent: true };
        }
        if (!isReservationActiveStatus(latestReservation.status)) {
          const err = new Error("RESERVATION_NOT_FINALIZABLE");
          err.code = "RESERVATION_NOT_FINALIZABLE";
          throw err;
        }

        const createdGift = await createGiftOrderFromPayload({
          userId,
          contentType: latestReservation.content_type,
          contentId: latestReservation.content_id,
          recipientName,
          deliveryMode,
          senderTimezone,
          channels,
          recipientPhone,
          recipientEmail,
          message,
          sendAtIso,
          expiresInDays,
          versionNum: latestReservation.version_num,
          idempotencyKey,
          tokenTransactionId: latestReservation.token_transaction_id,
          externalQuery: query,
          skipDispatch: true,
          skipSideEffects: true,
        });

        await query(
          `UPDATE gift_reservations
           SET status = 'finalized',
               gift_order_id = ?,
               updated_at = ?
           WHERE id = ?`,
          [createdGift.gift.id, nowIso(), latestReservation.id]
        );

        return createdGift;
      });

      if (!created.idempotent) {
        await emitGiftActivity({
          userId,
          action: "gift_scheduled",
          resourceType: "gift_order",
          resourceId: created.gift.id,
          metadata: buildGiftScheduleMetadata({
            contentType: refreshed.content_type,
            deliveryMode,
            channels,
            sendAtIso,
          }),
        });
      }

      await emitGiftActivity({
        userId,
        action: "gift_reservation_finalized",
        resourceType: "gift_reservation",
        resourceId: refreshed.id,
        metadata: { gift_order_id: created.gift.id, idempotent: created.idempotent },
      });

      let responseGift = created.gift;
      if (deliveryMode === "immediate" && created.gift?.id && !created.idempotent) {
        await dispatchGiftById(created.gift.id);
        responseGift = await db.prepare("SELECT * FROM gift_orders WHERE id = ?").get(created.gift.id);
      }

      reply.send({
        gift: renderGiftSummary(responseGift),
        wallet_balance: created.walletBalance,
        idempotent: created.idempotent,
      });
    } catch (err) {
      if (mapGiftCreateError(err, reply)) {
        return;
      }
      request.log.error({ err, reservationId: refreshed.id }, "Failed to finalize gift reservation");
      sendError(reply, 500, "GIFT_FINALIZE_FAILED", "An internal error occurred.");
    }
  });

  app.post("/gifts/reservations/:id/cancel", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const reservation = await db.prepare("SELECT * FROM gift_reservations WHERE id = ?").get(request.params.id);
    if (!reservation || reservation.user_id !== userId) {
      sendError(reply, 404, "RESERVATION_NOT_FOUND", "Gift reservation not found.");
      return;
    }

    if (reservation.status === "finalized") {
      sendError(reply, 409, "RESERVATION_ALREADY_FINALIZED", "Finalized reservations cannot be cancelled.");
      return;
    }

    if (reservation.status === "cancelled" || reservation.status === "expired") {
      reply.send({
        cancelled: true,
        reservation: renderGiftReservation(reservation),
        wallet_balance: (await ensureGiftWalletRow(userId)).balance,
      });
      return;
    }

    if (!isReservationActiveStatus(reservation.status)) {
      sendError(reply, 409, "RESERVATION_NOT_CANCELLABLE", "Reservation cannot be cancelled in its current state.");
      return;
    }

    try {
      const cancelled = await refundReservationTokenIfNeeded(reservation, {
        status: "cancelled",
        cancelReason: "user_cancelled",
        source: "gift_reservation_cancel",
        description: "Gift reservation cancelled and token refunded",
        auditAction: "gift_reservation_cancelled",
        eventName: "gift_reservation_cancelled",
      });

      reply.send({
        cancelled: true,
        reservation: renderGiftReservation(cancelled),
        wallet_balance: (await ensureGiftWalletRow(userId)).balance,
      });
    } catch (err) {
      request.log.error({ err, reservationId: reservation.id }, "Failed to cancel gift reservation");
      sendError(reply, 500, "GIFT_RESERVATION_CANCEL_FAILED", "An internal error occurred.");
    }
  });

  // ============ Gift Scheduling + Delivery ============

  app.post("/gifts", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const giftingEnabled = await getFeatureFlag(db, "gift_scheduling_enabled");
    if (!giftingEnabled) {
      sendError(reply, 503, "GIFTING_DISABLED", "Gift scheduling is currently disabled.");
      return;
    }

    const prepayEnforced = await getFeatureFlag(db, "gift_prepay_enforced");
    if (prepayEnforced) {
      sendError(
        reply,
        409,
        "GIFT_PREPAY_REQUIRED",
        "This app version needs to start a fresh gift first."
      );
      return;
    }

    const body = request.body || {};
    const contentType = typeof body.content_type === "string" ? body.content_type.trim().toLowerCase() : "";
    const contentId = typeof body.content_id === "string" ? body.content_id.trim() : "";
    const idempotencyKey =
      request.headers["idempotency-key"] ||
      body.idempotency_key ||
      null;
    const deliveryRequest = parseGiftDeliveryRequest(body, reply);
    if (!deliveryRequest) return;
    const {
      recipientName,
      deliveryMode,
      senderTimezone,
      channels,
      recipientPhone,
      recipientEmail,
      message,
      expiresInDays,
      sendAtIso,
    } = deliveryRequest;

    let versionNum;
    try {
      versionNum = parseVersionNum(body.version_num);
    } catch {
      sendError(reply, 400, "INVALID_VERSION_NUM", "version_num must be a positive integer.");
      return;
    }

    if (!["song", "poem"].includes(contentType)) {
      sendError(reply, 400, "INVALID_CONTENT_TYPE", "content_type must be song or poem.");
      return;
    }
    if (!contentId) {
      sendError(reply, 400, "INVALID_CONTENT_ID", "content_id is required.");
      return;
    }
    try {
      const created = await createGiftOrderFromPayload({
        userId,
        contentType,
        contentId,
        recipientName,
        deliveryMode,
        senderTimezone,
        channels,
        recipientPhone,
        recipientEmail,
        message,
        sendAtIso,
        expiresInDays,
        versionNum,
        idempotencyKey,
      });

      reply.send({
        gift: renderGiftSummary(created.gift),
        wallet_balance: created.walletBalance,
        idempotent: created.idempotent,
      });
    } catch (err) {
      if (mapGiftCreateError(err, reply)) {
        return;
      }
      request.log.error({ err }, "Gift operation failed");
      sendError(reply, 500, "GIFT_CREATE_FAILED", "An internal error occurred.");
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
      request.log.error({ err }, "Gift operation failed");
      sendError(reply, 500, "GIFT_LIST_FAILED", "An internal error occurred.");
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
    const sentDelivery = await db.prepare(
      "SELECT id FROM gift_delivery_outbox WHERE gift_order_id = ? AND status = 'sent' LIMIT 1"
    ).get(gift.id);
    if (sentDelivery) {
      sendError(reply, 409, "GIFT_ALREADY_PARTIALLY_DISPATCHED", "Gift delivery already started and can no longer be edited.");
      return;
    }

    const body = request.body || {};
    const nextTimezone = typeof body.sender_timezone === "string" && body.sender_timezone.trim()
      ? body.sender_timezone.trim()
      : gift.sender_timezone;
    const nextRecipientName = body.recipient_name !== undefined
      ? String(body.recipient_name || "").trim().slice(0, 100)
      : (gift.recipient_name || "");
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

    const nextExpiresAt = computeGiftShareExpiresAt(nextSendAt, gift.expires_in_days);

    await db.prepare(
      `UPDATE gift_orders
       SET send_at = ?, sender_timezone = ?, recipient_name = ?, channels_json = ?, recipient_phone = ?, recipient_email = ?, message = ?, next_retry_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      nextSendAt,
      nextTimezone,
      nextRecipientName || null,
      toJson(nextChannels),
      nextPhone,
      nextEmail,
      nextMessage || null,
      nextSendAt,
      nowIso(),
      gift.id
    );

    await db.prepare("DELETE FROM gift_delivery_outbox WHERE gift_order_id = ? AND status IN ('pending', 'failed', 'cancelled')").run(gift.id);
    await createGiftDeliveryOutboxRows({
      giftOrderId: gift.id,
      channels: nextChannels,
      recipientPhone: nextPhone,
      recipientEmail: nextEmail,
      sendAtIso: nextSendAt,
    });

    if (gift.content_type === "song") {
      await db.prepare(
        `UPDATE share_tokens
         SET dispatch_at = ?, expires_at = ?, dispatched_at = NULL
         WHERE id = ? AND gift_order_id = ? AND delivery_source = 'gift'`
      ).run(nextSendAt, nextExpiresAt, gift.share_token_id, gift.id);
    } else if (gift.content_type === "poem") {
      await db.prepare(
        `UPDATE poem_share_tokens
         SET dispatch_at = ?, expires_at = ?, dispatched_at = NULL
         WHERE id = ? AND gift_order_id = ? AND delivery_source = 'gift'`
      ).run(nextSendAt, nextExpiresAt, gift.share_token_id, gift.id);
    }

    await emitGiftActivity({
      userId,
      action: "gift_rescheduled",
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
    try {
      const result = await cancelGiftOrderById(gift.id, { actorUserId: userId, actorType: "user" });
      await emitGiftActivity({
        userId,
        action: "gift_cancelled",
        resourceType: "gift_order",
        resourceId: gift.id,
        metadata: { refund_transaction_id: result.refundTxId || gift.refund_transaction_id || null },
      });
      reply.send({
        cancelled: true,
        gift: renderGiftSummary(result.gift),
        wallet_balance: result.walletBalance,
      });
    } catch (err) {
      if (err.code === "GIFT_ALREADY_PARTIALLY_DISPATCHED") {
        sendError(reply, 409, "GIFT_ALREADY_PARTIALLY_DISPATCHED", "Gift delivery already started and can no longer be cancelled.");
        return;
      }
      if (err.code === "GIFT_ALREADY_DISPATCHED") {
        sendError(reply, 409, "GIFT_ALREADY_DISPATCHED", "Gift has already been dispatched.");
        return;
      }
      if (err.code === "GIFT_NOT_CANCELLABLE") {
        sendError(reply, 409, "GIFT_NOT_CANCELLABLE", "Gift cannot be cancelled in its current state.");
        return;
      }
      request.log.error({ err }, "Failed to cancel gift");
      sendError(reply, 500, "GIFT_CANCEL_FAILED", "An internal error occurred.");
    }
  });
}

module.exports = { registerGiftRoutes };
