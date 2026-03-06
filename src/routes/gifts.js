"use strict";

const crypto = require("crypto");
const { nowIso, toJson } = require("../utils/common");
const { getFeatureFlag } = require("../services/feature-flags");

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

  async function validateGiftContent({ userId, contentType, contentId, versionNum = null }) {
    if (contentType === "song") {
      const track = await db.prepare("SELECT id, user_id, latest_version, deleted_at FROM tracks WHERE id = ?").get(contentId);
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
      };
    }

    if (contentType === "poem") {
      const poem = await db
        .prepare("SELECT id, user_id, verses, deleted_at FROM poems WHERE id = ?")
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

    await addAuditEntry({
      userId: reservation.user_id,
      action: auditAction,
      resourceType: "gift_reservation",
      resourceId: reservation.id,
      metadata: { refund_transaction_id: refundTxId, reason: cancelReason },
    });

    eventsService.emit(eventName, {
      userId: reservation.user_id,
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

  async function createGiftOrderFromPayload({
    userId,
    contentType,
    contentId,
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
  }) {
    if (idempotencyKey) {
      const existing = await db.prepare(
        "SELECT * FROM gift_orders WHERE sender_user_id = ? AND idempotency_key = ? LIMIT 1"
      ).get(userId, idempotencyKey);
      if (existing) {
        return {
          gift: existing,
          idempotent: true,
          walletBalance: (await ensureGiftWalletRow(userId)).balance,
        };
      }
    }

    const validated = await validateGiftContent({
      userId,
      contentType,
      contentId,
      versionNum,
    });

    const giftOrderId = `gift_${crypto.randomBytes(12).toString("hex")}`;
    const requireAppClaim = await getFeatureFlag(db, "gift_require_app_claim");

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
      });
      resolvedTokenTxId = walletDebit.transactionId;
      autoDebited = true;
    }

    let share;
    try {
      if (validated.contentType === "song") {
        share = await ensureTrackGiftShareToken({
          trackId: validated.contentId,
          senderUserId: userId,
          giftOrderId,
          versionNum: validated.versionNum,
          sendAtIso,
          expiresInDays,
          requireAppClaim: Boolean(requireAppClaim),
        });
      } else {
        share = await ensurePoemGiftShareToken({
          poemId: validated.contentId,
          senderUserId: userId,
          giftOrderId,
          sendAtIso,
          expiresInDays,
          requireAppClaim: Boolean(requireAppClaim),
        });
      }

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
        validated.contentType,
        validated.contentId,
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
        resolvedTokenTxId,
        null,
        validated.versionNum,
        idempotencyKey,
        nowIso(),
        nowIso()
      );
    } catch (err) {
      if (autoDebited) {
        try {
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
          });
        } catch (refundErr) {
          app.log.error({ err: refundErr, giftOrderId }, "Failed to rollback gift token after create failure");
        }
      }
      throw err;
    }

    await addAuditEntry({
      userId,
      action: "gift_scheduled",
      resourceType: "gift_order",
      resourceId: giftOrderId,
      metadata: {
        content_type: validated.contentType,
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
        content_type: validated.contentType,
        delivery_mode: deliveryMode,
        channels,
        send_at: sendAtIso,
      },
    });

    if (deliveryMode === "immediate") {
      await dispatchGiftById(giftOrderId);
    }

    const created = await db.prepare("SELECT * FROM gift_orders WHERE id = ?").get(giftOrderId);

    return {
      gift: created,
      idempotent: false,
      walletBalance: (await ensureGiftWalletRow(userId)).balance,
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
      sendError(reply, 402, "INSUFFICIENT_GIFT_TOKENS", "You need a gift token to schedule a gift.");
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
        sendError(reply, 402, "INSUFFICIENT_GIFT_TOKENS", "You need a gift token to start gift creation.");
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

      await addAuditEntry({
        userId,
        action: "gift_reservation_created",
        resourceType: "gift_reservation",
        resourceId: reservationId,
        metadata: { expires_in_minutes: Math.round(reservationTtlMs / 60000) },
      });

      eventsService.emit("gift_reservation_created", {
        userId,
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
        sendError(reply, 402, "INSUFFICIENT_GIFT_TOKENS", "You need a gift token to start gift creation.");
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

    reply.send({
      reservation: renderGiftReservation(resolved),
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
      sendError(reply, 409, "RESERVATION_EXPIRED", "Gift reservation expired. Start a new reservation.");
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

      await addAuditEntry({
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

      eventsService.emit("gift_reservation_content_attached", {
        userId,
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
      sendError(reply, 409, "RESERVATION_EXPIRED", "Gift reservation expired. Start a new reservation.");
      return;
    }

    if (!refreshed.content_type || !refreshed.content_id) {
      sendError(reply, 400, "RESERVATION_CONTENT_REQUIRED", "Attach song or poem content before finalizing.");
      return;
    }

    const body = request.body || {};
    const deliveryMode = body.delivery_mode === "scheduled" ? "scheduled" : "immediate";
    const senderTimezone = typeof body.sender_timezone === "string" && body.sender_timezone.trim()
      ? body.sender_timezone.trim()
      : "UTC";
    const channels = normalizeGiftChannels(body.channels);
    const recipientPhone = normalizeGiftPhone(body.recipient_phone);
    const recipientEmail = normalizeGiftEmail(body.recipient_email);
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 500) : "";
    const expiresInDays = Math.max(1, Math.min(Number(body.expires_in_days || 30), 90));
    const idempotencyKey = request.headers["idempotency-key"] || body.idempotency_key || null;

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

    try {
      const created = await createGiftOrderFromPayload({
        userId,
        contentType: refreshed.content_type,
        contentId: refreshed.content_id,
        deliveryMode,
        senderTimezone,
        channels,
        recipientPhone,
        recipientEmail,
        message,
        sendAtIso,
        expiresInDays,
        versionNum: refreshed.version_num,
        idempotencyKey,
        tokenTransactionId: refreshed.token_transaction_id,
      });

      await db.prepare(
        `UPDATE gift_reservations
         SET status = 'finalized',
             gift_order_id = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(created.gift.id, nowIso(), refreshed.id);

      await addAuditEntry({
        userId,
        action: "gift_reservation_finalized",
        resourceType: "gift_reservation",
        resourceId: refreshed.id,
        metadata: { gift_order_id: created.gift.id, idempotent: created.idempotent },
      });

      eventsService.emit("gift_reservation_finalized", {
        userId,
        resourceType: "gift_reservation",
        resourceId: refreshed.id,
        metadata: { gift_order_id: created.gift.id, idempotent: created.idempotent },
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
        "This app version must reserve a gift token first. Use /gifts/reservations flow."
      );
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
    const idempotencyKey =
      request.headers["idempotency-key"] ||
      body.idempotency_key ||
      null;

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

    try {
      const created = await createGiftOrderFromPayload({
        userId,
        contentType,
        contentId,
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
