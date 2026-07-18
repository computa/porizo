"use strict";

const crypto = require("crypto");
const { nowIso } = require("../utils/common");
const { loadPublicFile } = require("../utils/public-files");
const { getFeatureFlag } = require("../services/feature-flags");
const {
  deleteGiftFundedReservationContent,
  findGiftFundingContent,
} = require("../services/gift-funding");
const {
  upsertGiftIncident,
  redactGiftContacts,
} = require("../services/gift-delivery-ops");
const { createGiftOpsMonitor } = require("../services/gift-ops-monitoring");
const { createGiftContentRepository } = require("../database/gift-content-repository");
const {
  createGiftReservationRepository,
} = require("../database/gift-reservation-repository");
const {
  createGiftDispatchRepository,
} = require("../database/gift-dispatch-repository");
const {
  createGiftOrderRepository,
} = require("../database/gift-order-repository");
const {
  createShareTokenRepository,
} = require("../database/share-token-repository");
const {
  createIdentityRepository,
} = require("../database/identity-repository");
const {
  createGiftDeliveryPreferenceRepository,
} = require("../database/gift-delivery-preference-repository");
const {
  createGiftWalletRepository,
} = require("../database/gift-wallet-repository");
const {
  createGiftReservationService,
} = require("../services/gift-reservation-service");

const ACTIVE_RESERVATION_STATUSES = new Set(["reserved", "content_ready"]);
const publicGiftIndexPage = loadPublicFile("gifts/index.html", {
  warnOnMissing: true,
});
const publicGiftFallbackPage =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Porizo Gifts</title></head><body><main><h1>Porizo Gifts</h1><p>Page unavailable.</p></main></body></html>';

function acceptsHtml(request) {
  const accept = String(request.headers?.accept || "").toLowerCase();
  return accept.includes("text/html") && !accept.includes("application/json");
}

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
  getGiftWalletBalance,
  applyGiftWalletTransaction,
  ensureTrackGiftShareToken,
  ensurePoemGiftShareToken,
  createGiftDeliveryOutboxRows,
  dispatchGiftById,
  getGiftShareUrlDeliveryError,
  giftReservationTtlMinutes = 45,
}) {

  const reservationTtlMs = Math.max(5, Number(giftReservationTtlMinutes) || 45) * 60 * 1000;
  const giftContentRepository = createGiftContentRepository(db);
  const giftReservationRepository = createGiftReservationRepository(db);
  const giftDispatchRepository = createGiftDispatchRepository(db);
  const giftOrderRepository = createGiftOrderRepository(db);
  const giftDeliveryPreferenceRepository =
    createGiftDeliveryPreferenceRepository(db);
  const giftReservationService = createGiftReservationService({
    db,
    giftWalletRepository: createGiftWalletRepository(db),
    giftReservationRepository,
  });
  const shareTokenRepository = createShareTokenRepository(db);
  const identityRepository = createIdentityRepository(db);

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

  async function renderGiftSummaryWithDelivery(giftRow) {
    const summary = renderGiftSummary(giftRow);
    const rows = await giftDispatchRepository.listOutboxRowsForGift({
      giftOrderId: giftRow.id,
    });
    const deliveryChannels = rows.map((row) => {
      const receiptStatus = String(row.receipt_status || "").toLowerCase();
      const receiptFailed = [
        "bounced",
        "complained",
        "failed",
        "undelivered",
        "canceled",
        "cancelled",
      ].includes(receiptStatus);
      return {
        channel: row.channel,
        status: receiptFailed
          ? "failed"
          : row.status === "sent"
            ? receiptStatus === "delivered"
              ? "delivered"
              : "accepted"
            : row.status,
        can_stop: ["pending", "failed"].includes(row.status),
      };
    });
    return {
      ...summary,
      can_stop_any: deliveryChannels.some((channel) => channel.can_stop),
      delivery_channels: deliveryChannels,
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

  const giftOpsMonitor = createGiftOpsMonitor({
    db,
    logger: app.log,
    redactGiftContacts,
    upsertGiftIncident,
    resolveGiftIncident: async () => {},
  });
  const logGiftLifecycle = giftOpsMonitor.logGiftLifecycle;

  async function verifyGiftFinalizeIntegrity(giftOrderId, query = null) {
    const gift = await giftOrderRepository.findById(giftOrderId, query);
    if (!gift) {
      return { ok: false, errors: ["missing_gift_order"], gift: null, outboxRows: [], shareRow: null };
    }

    const outboxRows = await giftDispatchRepository.listFinalizeIntegrityRows({
      giftOrderId,
      query,
    });
    const channels = parseGiftChannelsJson(gift.channels_json);
    const shareRow = await shareTokenRepository.getGiftShareBinding({
      contentType: gift.content_type,
      shareTokenId: gift.share_token_id,
      query,
    });

    const errors = [];
    if (!gift.share_token_id || !shareRow) {
      errors.push("missing_gift_share_token");
    }
    if (shareRow && (shareRow.gift_order_id !== giftOrderId || shareRow.delivery_source !== "gift")) {
      errors.push("gift_share_token_binding_invalid");
    }
    if (shareRow && shareRow.dispatch_at && gift.send_at) {
      const shareMs = new Date(shareRow.dispatch_at).getTime();
      const giftMs = new Date(gift.send_at).getTime();
      if (Math.abs(shareMs - giftMs) > 1000) {
        errors.push("gift_share_dispatch_at_mismatch");
      }
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

  async function assertGiftFinalizeIntegrity(giftOrderId, query = null) {
    const integrity = await verifyGiftFinalizeIntegrity(giftOrderId, query);
    if (integrity.ok) {
      logGiftLifecycle("info", "finalize_integrity_verified", {
        gift_id: giftOrderId,
        outbox_count: integrity.outboxRows.length,
      });
      return integrity.gift;
    }
    app.log.error({
      event: "gift_finalize_integrity_failed",
      gift_id: giftOrderId,
      errors: integrity.errors,
    }, "gift_finalize_integrity_failed");
    throw Object.assign(new Error("GIFT_FINALIZE_INTEGRITY_FAILED"), {
      code: "GIFT_FINALIZE_INTEGRITY_FAILED",
      details: integrity.errors,
    });
  }

  async function readGiftWalletBalance(userId, query = null) {
    if (query) {
      return getGiftWalletBalance(userId, { query });
    }
    return (await ensureGiftWalletRow(userId)).balance;
  }

  function parseGiftDeliveryRequest(body, reply) {
    const recipientName = typeof body.recipient_name === "string"
      ? body.recipient_name.trim().slice(0, 100)
      : "";
    const senderDisplayName = typeof body.sender_display_name === "string"
      ? body.sender_display_name.trim().slice(0, 100)
      : "";
    const deliveryMode = ["manual", "scheduled"].includes(body.delivery_mode)
      ? body.delivery_mode
      : "immediate";
    const senderTimezone = typeof body.sender_timezone === "string" && body.sender_timezone.trim()
      ? body.sender_timezone.trim()
      : "UTC";
    const channels = normalizeGiftChannels(body.channels);
    const recipientPhone = normalizeGiftPhone(body.recipient_phone);
    const recipientEmail = normalizeGiftEmail(body.recipient_email);
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 500) : "";
    const expiresInDays = Math.max(1, Math.min(Number(body.expires_in_days || 30), 90));

    if (deliveryMode !== "manual" && !channels.length) {
      sendError(reply, 400, "INVALID_CHANNELS", "At least one channel is required.");
      return null;
    }
    if (deliveryMode === "manual" && channels.length) {
      sendError(reply, 400, "INVALID_CHANNELS", "Manual delivery cannot request provider channels.");
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
      senderDisplayName,
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
      const track = await giftContentRepository.getTrackForGiftContent(contentId);
      if (!track || track.user_id !== userId || track.deleted_at) {
        const err = new Error("TRACK_NOT_FOUND");
        err.code = "TRACK_NOT_FOUND";
        throw err;
      }

      const resolvedVersionNum = Number(versionNum || track.latest_version || 1);
      const trackVersion = await giftContentRepository.getTrackVersionForGiftContent({
        trackId: track.id,
        versionNum: resolvedVersionNum,
      });

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
      const poem = await giftContentRepository.getPoemForGiftContent(contentId);
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
    externalQuery = null,
    skipSideEffects = false,
  }) {
    const execute = async (query) => {
      const timestamp = nowIso();
      const claim = await giftReservationRepository.claimForRefund({
        reservationId: reservation.id,
        updatedAt: timestamp,
        query,
      });
      const claimed = Number(claim?.changes ?? claim?.rowCount ?? 0) > 0;
      if (!claimed) {
        const current = await giftReservationRepository.getById(reservation.id, query);
        if (["cancelled", "expired", "refunded"].includes(current?.status)) {
          return {
            reservation: current,
            refundTxId: current.refund_transaction_id || null,
            idempotent: true,
          };
        }
        const err = new Error("GIFT_RESERVATION_STATUS_CHANGED");
        err.code = "GIFT_RESERVATION_STATUS_CHANGED";
        throw err;
      }

      await deleteGiftFundedReservationContent(db, reservation.id, timestamp, query);
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
          externalQuery: query,
        });
        refundTxId = refundTx.transactionId;
      }

      const marked = await giftReservationRepository.markRefunded({
        reservationId: reservation.id,
        status,
        refundTransactionId: refundTxId,
        cancelReason,
        updatedAt: timestamp,
        query,
      });
      if (!Number(marked?.changes ?? marked?.rowCount ?? 0)) {
        const err = new Error("GIFT_RESERVATION_STATUS_CHANGED");
        err.code = "GIFT_RESERVATION_STATUS_CHANGED";
        throw err;
      }
      return {
        reservation: await giftReservationRepository.getById(reservation.id, query),
        refundTxId,
        idempotent: false,
      };
    };
    const result = externalQuery
      ? await execute(externalQuery)
      : await db.transaction(execute);

    if (!result.idempotent && !skipSideEffects) {
      await emitGiftActivity({
        userId: reservation.user_id,
        action: auditAction,
        eventName,
        resourceType: "gift_reservation",
        resourceId: reservation.id,
        metadata: { refund_transaction_id: result.refundTxId, reason: cancelReason },
      });
    }

    return result.reservation;
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

    await giftReservationRepository.attachContent({
      reservationId: reservation.id,
      contentType: recovered.contentType,
      contentId: recovered.contentId,
      versionNum: recovered.versionNum,
      updatedAt: nowIso(),
    });

    return giftReservationRepository.getById(reservation.id);
  }

  async function createGiftOrderFromPayload({
    userId,
    contentType,
    contentId,
    recipientName,
    senderDisplayName,
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
    originWebOrderId = null,
  }) {
    const validated = await validateGiftContent({ userId, contentType, contentId, versionNum });
    const requireAppClaim = await getFeatureFlag(db, "gift_require_app_claim");
    const giftOrderId = `gift_${crypto.randomBytes(12).toString("hex")}`;
    const resolvedRecipientName = (typeof recipientName === "string" && recipientName.trim())
      ? recipientName.trim().slice(0, 100)
      : (validated.contentSnapshot?.recipient_name || null);

    // Resolve sender display name: explicit override → user profile → email prefix → "A friend"
    let resolvedSenderDisplayName = typeof senderDisplayName === "string" ? senderDisplayName.trim() : "";
    if (!resolvedSenderDisplayName) {
      const senderUser = await identityRepository.findUserDisplayProfile(userId);
      const profileName = typeof senderUser?.display_name === "string" ? senderUser.display_name.trim() : "";
      const emailLocal = typeof senderUser?.email === "string" ? senderUser.email.split("@")[0]?.trim() : "";
      resolvedSenderDisplayName = profileName || emailLocal || "A friend";
    }

    const executeCreate = async (query) => {
      if (idempotencyKey) {
        const existing = await giftOrderRepository.findBySenderAndIdempotencyKey({
          userId,
          idempotencyKey,
          query,
        });
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

        const shareUrlError = typeof getGiftShareUrlDeliveryError === "function"
          ? getGiftShareUrlDeliveryError(share.shareUrl)
          : null;
        if (shareUrlError) {
          const err = new Error(shareUrlError);
          err.code = shareUrlError;
          throw err;
        }

        const timestamp = nowIso();
        await giftOrderRepository.insertScheduled({
          id: giftOrderId,
          senderUserId: userId,
          contentType: validated.contentType,
          contentId: validated.contentId,
          deliveryMode,
          sendAt: sendAtIso,
          senderTimezone,
          recipientName: resolvedRecipientName,
          senderDisplayName: resolvedSenderDisplayName,
          channels,
          recipientPhone,
          recipientEmail,
          message,
          shareTokenId: share.shareId,
          shareUrl: share.shareUrl,
          claimPin: share.claimPin,
          claimPolicy: requireAppClaim ? "app_only" : "default",
          expiresInDays,
          tokenTransactionId: resolvedTokenTxId,
          versionNum: validated.versionNum,
          contentSnapshot: validated.contentSnapshot,
          idempotencyKey,
          originWebOrderId,
          timestamp,
          query,
        });

        await createGiftDeliveryOutboxRows({
          giftOrderId,
          channels,
          recipientPhone,
          recipientEmail,
          sendAtIso,
          externalQuery: query,
        });

        const created = await assertGiftFinalizeIntegrity(giftOrderId, query);
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

    logGiftLifecycle("info", created.idempotent ? "finalize_idempotent" : "finalized", {
      gift_id: created.gift.id,
      content_type: validated.contentType,
      delivery_mode: deliveryMode,
      channels,
      send_at: sendAtIso,
      has_recipient_phone: Boolean(recipientPhone),
      has_recipient_email: Boolean(recipientEmail),
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
      created.gift = await giftOrderRepository.findById(created.gift.id);
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
    if (err.code === "GIFT_SHARE_URL_NOT_PUBLIC" || err.code === "INVALID_GIFT_SHARE_URL") {
      sendError(reply, 503, err.code, "Gift delivery isn’t configured correctly right now.");
      return true;
    }
    return false;
  }

  async function expireGiftReservations({ limit = 50 } = {}) {
    const now = new Date().toISOString();
    const rows = await giftReservationRepository.listExpiredActive({
      now,
      limit,
    });

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
    const gift = await giftOrderRepository.findById(giftId);
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
    if (!["scheduled", "dispatch_retry", "ready_to_share"].includes(gift.status)) {
      const err = new Error("GIFT_NOT_CANCELLABLE");
      err.code = "GIFT_NOT_CANCELLABLE";
      throw err;
    }

    const cancelled = await db.transaction(async (query) => {
      const lockSql = `SELECT * FROM gift_orders WHERE id = ?${
        db.isPostgres ? " FOR UPDATE" : ""
      }`;
      const lockedResult = await query(lockSql, [gift.id]);
      const lockedGift = lockedResult?.rows?.[0] || null;
      if (!lockedGift) {
        const err = new Error("GIFT_NOT_FOUND");
        err.code = "GIFT_NOT_FOUND";
        throw err;
      }
      if (lockedGift.status === "cancelled") {
        return { gift: lockedGift, refundTxId: lockedGift.refund_transaction_id, idempotent: true };
      }
      if (!["scheduled", "dispatch_retry", "ready_to_share"].includes(lockedGift.status)) {
        const err = new Error("GIFT_STATUS_CHANGED");
        err.code = "GIFT_STATUS_CHANGED";
        throw err;
      }
      if (await giftDispatchRepository.hasSentDelivery({
        giftOrderId: lockedGift.id,
        query,
      })) {
        const err = new Error("GIFT_ALREADY_PARTIALLY_DISPATCHED");
        err.code = "GIFT_ALREADY_PARTIALLY_DISPATCHED";
        throw err;
      }

      const timestamp = nowIso();
      const shareTable =
        lockedGift.content_type === "poem" ? "poem_share_tokens" : "share_tokens";
      const revoked = await query(
        `UPDATE ${shareTable}
         SET status = 'revoked',
             expires_at = COALESCE(expires_at, ?)
         WHERE id = ? AND gift_order_id = ?
           AND COALESCE(access_count, 0) = 0
           AND bound_user_id IS NULL
           AND bound_at IS NULL
           AND status NOT IN ('claimed', 'revoked')`,
        [timestamp, lockedGift.share_token_id, lockedGift.id],
      );
      if (!Number(revoked?.rowCount ?? revoked?.changes ?? 0)) {
        const err = new Error("GIFT_ALREADY_ACCESSED");
        err.code = "GIFT_ALREADY_ACCESSED";
        throw err;
      }

      const cancelResult = await giftOrderRepository.markCancelled({
        giftId: lockedGift.id,
        refundTransactionId: lockedGift.refund_transaction_id,
        timestamp,
        query,
      });
      if (!Number(cancelResult?.changes ?? cancelResult?.rowCount ?? 0)) {
        const err = new Error("GIFT_STATUS_CHANGED");
        err.code = "GIFT_STATUS_CHANGED";
        throw err;
      }
      await giftDispatchRepository.cancelUnsentRows({
        giftOrderId: lockedGift.id,
        updatedAt: timestamp,
        query,
      });

      let refundTxId = lockedGift.refund_transaction_id || null;
      if (!refundTxId) {
        const refundTx = await applyGiftWalletTransaction({
          userId: lockedGift.sender_user_id,
          type: "gift_refund",
          amount: 1,
          source: actorType === "admin" ? "gift_cancel_admin" : "gift_cancel",
          referenceType: "gift_order",
          referenceId: lockedGift.id,
          description: "Gift token refunded after cancellation",
          metadata: {
            gift_id: lockedGift.id,
            actor_type: actorType,
            actor_user_id: actorUserId || null,
          },
          idempotencyKey: `gift_refund_${lockedGift.id}`,
          externalQuery: query,
        });
        refundTxId = refundTx.transactionId;
        await query(
          "UPDATE gift_orders SET refund_transaction_id = ?, updated_at = ? WHERE id = ? AND status = 'cancelled'",
          [refundTxId, timestamp, lockedGift.id],
        );
      }
      return {
        gift: await giftOrderRepository.findById(lockedGift.id, query),
        refundTxId,
        idempotent: false,
      };
    });

    if (!cancelled.idempotent) {
      logGiftLifecycle("warn", "cancelled", {
        gift_id: gift.id,
        actor_type: actorType,
        actor_user_id: actorUserId || null,
        refund_transaction_id: cancelled.refundTxId,
      });
    }

    return {
      gift: cancelled.gift,
      walletBalance: (await ensureGiftWalletRow(gift.sender_user_id)).balance,
      cancelled: true,
      idempotent: cancelled.idempotent,
      refundTxId: cancelled.refundTxId,
    };
  }

  async function retryGiftOrderById(giftId, {
    actorUserId,
    actorType = "admin",
  } = {}) {
    const gift = await giftOrderRepository.findById(giftId);
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
    if (!["scheduled", "dispatch_retry", "ready_to_share"].includes(gift.status)) {
      const err = new Error("GIFT_NOT_RETRYABLE");
      err.code = "GIFT_NOT_RETRYABLE";
      throw err;
    }

    const sentDelivery = await giftDispatchRepository.hasSentDelivery({
      giftOrderId: gift.id,
    });
    if (sentDelivery) {
      const err = new Error("GIFT_ALREADY_PARTIALLY_DISPATCHED");
      err.code = "GIFT_ALREADY_PARTIALLY_DISPATCHED";
      throw err;
    }

    const timestamp = nowIso();
    await giftDispatchRepository.resetRetryableRows({
      giftOrderId: gift.id,
      nextRetryAt: timestamp,
      updatedAt: timestamp,
    });

    const retryResult = await giftOrderRepository.markRetrying({
      giftId: gift.id,
      retryAt: timestamp,
      updatedAt: timestamp,
    });

    if (!retryResult.changes) {
      const err = new Error("GIFT_STATUS_CHANGED");
      err.code = "GIFT_STATUS_CHANGED";
      throw err;
    }

    logGiftLifecycle("warn", "requeued", {
      gift_id: gift.id,
      actor_type: actorType,
      actor_user_id: actorUserId || null,
    });

    return await giftOrderRepository.findById(gift.id);
  }

  app.decorate("retryGiftOrderById", retryGiftOrderById);
  app.decorate("cancelGiftOrderById", cancelGiftOrderById);
  app.decorate("createGiftOrderFromPayload", createGiftOrderFromPayload);
  app.decorate(
    "refundGiftReservationById",
    async ({
      reservationId,
      userId,
      reason = "content_generation_failed",
      source = "web_render_failure",
      description = "Gift credit restored after song generation failed",
      externalQuery = null,
      skipSideEffects = false,
    }) => {
      const reservation = await giftReservationRepository.getById(
        reservationId,
        externalQuery,
      );
      if (!reservation || reservation.user_id !== userId) {
        const err = new Error("RESERVATION_NOT_FOUND");
        err.code = "RESERVATION_NOT_FOUND";
        throw err;
      }
      if (["cancelled", "expired", "refunded"].includes(reservation.status)) {
        return reservation;
      }
      if (reservation.status === "finalized") {
        const err = new Error("RESERVATION_ALREADY_FINALIZED");
        err.code = "RESERVATION_ALREADY_FINALIZED";
        throw err;
      }
      return refundReservationTokenIfNeeded(reservation, {
        status: "refunded",
        cancelReason: reason,
        source,
        description,
        auditAction: "gift_reservation_refunded",
        eventName: "gift_reservation_refunded",
        externalQuery,
        skipSideEffects,
      });
    },
  );

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
      const existing = await giftReservationRepository.findByIdempotencyKey({
        userId,
        idempotencyKey,
      });
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

    const activeReservation = await giftReservationRepository.findActiveForUser(userId);

    if (activeReservation) {
      const resolved = await expireReservationIfNeeded(activeReservation);
      if (isReservationActiveStatus(resolved.status)) {
        sendError(reply, 409, "RESERVATION_ALREADY_ACTIVE", "You already have an active gift reservation.");
        return;
      }
    }

    try {
      const reserved = await giftReservationService.reserveGiftCredit({
        userId,
        idempotencyKey,
        expiresAt: expiresAtFromNow(),
        purpose: "interactive_draft",
      });
      const reservationId = reserved.reservation.id;

      await emitGiftActivity({
        userId,
        action: "gift_reservation_created",
        resourceType: "gift_reservation",
        resourceId: reservationId,
        metadata: { expires_in_minutes: Math.round(reservationTtlMs / 60000) },
      });

      reply.send({
        reservation: renderGiftReservation(reserved.reservation),
        wallet_balance:
          reserved.balanceAfter ?? (await ensureGiftWalletRow(userId)).balance,
        idempotent: Boolean(reserved.idempotent),
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

    const activeReservation = await giftReservationRepository.findActiveForUser(userId);

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

    const reservation = await giftReservationRepository.getById(request.params.id);
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

      await giftReservationRepository.attachContent({
        reservationId: refreshed.id,
        contentType: validated.contentType,
        contentId: validated.contentId,
        versionNum: validated.versionNum,
        updatedAt: nowIso(),
      });

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

      const updated = await giftReservationRepository.getById(refreshed.id);
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

  app.put("/gifts/reservations/:id/delivery", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const reservation = await giftReservationRepository.getById(
      request.params.id,
    );
    if (!reservation || reservation.user_id !== userId) {
      sendError(reply, 404, "RESERVATION_NOT_FOUND", "Gift reservation not found.");
      return;
    }
    const finalizedGift = reservation.gift_order_id
      ? await giftOrderRepository.findById(reservation.gift_order_id)
      : null;
    const canMaterializeLateDelivery =
      reservation.status === "finalized" &&
      finalizedGift?.delivery_mode === "manual" &&
      finalizedGift?.status === "ready_to_share";
    if (
      !["reserved", "content_ready"].includes(reservation.status) &&
      !canMaterializeLateDelivery
    ) {
      sendError(
        reply,
        409,
        "DELIVERY_PREFERENCE_LOCKED",
        "Delivery can no longer be changed.",
      );
      return;
    }

    const body = request.body || {};
    const parsed = parseGiftDeliveryRequest(
      {
        ...body,
        message: body.personal_note ?? body.message,
        sender_timezone: body.timezone ?? body.sender_timezone,
      },
      reply,
    );
    if (!parsed) return;
    if (
      parsed.deliveryMode !== "manual" &&
      !(await getFeatureFlag(db, "web_automated_gift_delivery"))
    ) {
      sendError(
        reply,
        503,
        "WEB_AUTOMATED_DELIVERY_DISABLED",
        "Automatic delivery is unavailable. You can still send the gift link yourself.",
      );
      return;
    }

    const expectedRevision =
      body.revision === undefined || body.revision === null
        ? 0
        : Number(body.revision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      sendError(reply, 400, "INVALID_REVISION", "revision must be a non-negative integer.");
      return;
    }

    const preference = {
      mode: parsed.deliveryMode,
      channels: parsed.channels,
      recipientPhone: parsed.recipientPhone,
      recipientEmail: parsed.recipientEmail,
      senderDisplayName: parsed.senderDisplayName,
      senderTimezone: parsed.senderTimezone,
      sendAt: parsed.sendAtIso,
      message: parsed.message,
      expiresInDays: parsed.expiresInDays,
    };
    let updated;
    try {
      if (canMaterializeLateDelivery && parsed.deliveryMode !== "manual") {
        const timestamp = nowIso();
        updated = await db.transaction(async (query) => {
          const saved = await giftDeliveryPreferenceRepository.upsertOwned({
            reservationId: reservation.id,
            userId,
            expectedRevision,
            timestamp,
            preference,
            query,
          });
          if (!saved) {
            const err = new Error("DELIVERY_PREFERENCE_CONFLICT");
            err.code = "DELIVERY_PREFERENCE_CONFLICT";
            throw err;
          }
        const existingRows = await giftDispatchRepository.listOutboxRowsForGift({
          giftOrderId: finalizedGift.id,
          query,
        });
        if (existingRows.length) {
          const err = new Error("DELIVERY_ALREADY_MATERIALIZED");
          err.code = "DELIVERY_ALREADY_MATERIALIZED";
          throw err;
        }
        const materialized = await query(
          `UPDATE gift_orders
           SET delivery_mode = ?, status = 'scheduled', dispatch_status = 'pending',
               channels_json = ?, recipient_phone = ?, recipient_email = ?,
               sender_display_name = COALESCE(?, sender_display_name),
               sender_timezone = ?, send_at = ?, next_retry_at = ?, message = ?,
               updated_at = ?
           WHERE id = ? AND delivery_mode = 'manual' AND status = 'ready_to_share'`,
          [
            parsed.deliveryMode,
            JSON.stringify(parsed.channels),
            parsed.recipientPhone,
            parsed.recipientEmail,
            parsed.senderDisplayName || null,
            parsed.senderTimezone,
            parsed.sendAtIso,
            parsed.sendAtIso,
            parsed.message || null,
            timestamp,
            finalizedGift.id,
          ],
        );
        const changed = materialized?.rowCount ?? materialized?.changes ?? 0;
        if (!changed) {
          const err = new Error("DELIVERY_ALREADY_MATERIALIZED");
          err.code = "DELIVERY_ALREADY_MATERIALIZED";
          throw err;
        }
        await createGiftDeliveryOutboxRows({
          giftOrderId: finalizedGift.id,
          channels: parsed.channels,
          recipientPhone: parsed.recipientPhone,
          recipientEmail: parsed.recipientEmail,
          sendAtIso: parsed.sendAtIso,
          externalQuery: query,
        });
        await shareTokenRepository.updateGiftShareSchedule({
          contentType: finalizedGift.content_type,
          shareTokenId: finalizedGift.share_token_id,
          giftOrderId: finalizedGift.id,
          dispatchAt: parsed.sendAtIso,
          expiresAt: computeGiftShareExpiresAt(
            parsed.sendAtIso,
            parsed.expiresInDays,
          ),
          query,
        });
          return saved;
        });
        if (parsed.deliveryMode === "immediate") {
          await dispatchGiftById(finalizedGift.id);
        }
      } else {
        updated = await giftDeliveryPreferenceRepository.upsertOwned({
          reservationId: reservation.id,
          userId,
          expectedRevision,
          timestamp: nowIso(),
          preference,
        });
      }
    } catch (err) {
      if (
        ["DELIVERY_PREFERENCE_CONFLICT", "DELIVERY_ALREADY_MATERIALIZED"].includes(
          err.code,
        )
      ) {
        sendError(
          reply,
          409,
          err.code,
          "Delivery changed somewhere else. Refresh and try again.",
        );
        return;
      }
      throw err;
    }
    if (!updated) {
      sendError(
        reply,
        409,
        "DELIVERY_PREFERENCE_CONFLICT",
        "Delivery changed somewhere else. Refresh and try again.",
      );
      return;
    }

    reply.send({
      delivery: {
        mode: updated.mode,
        revision: Number(updated.revision),
        can_edit: true,
        sender_display_name: updated.sender_display_name || undefined,
        send_at: updated.send_at || undefined,
        timezone: updated.sender_timezone || undefined,
      },
    });
  });

  app.post("/gifts/reservations/:id/finalize", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const reservation = await giftReservationRepository.getById(request.params.id);
    if (!reservation || reservation.user_id !== userId) {
      sendError(reply, 404, "RESERVATION_NOT_FOUND", "Gift reservation not found.");
      return;
    }

    if (reservation.status === "finalized") {
      if (!reservation.gift_order_id) {
        sendError(reply, 409, "RESERVATION_FINALIZE_INCOMPLETE", "Reservation has already been finalized.");
        return;
      }
      const existingGift = await giftOrderRepository.findById(
        reservation.gift_order_id,
      );
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
      senderDisplayName,
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
        const latestReservation = await giftReservationRepository.getById(
          reconciled.id,
          query,
        );
        if (!latestReservation || latestReservation.user_id !== userId) {
          const err = new Error("RESERVATION_NOT_FOUND");
          err.code = "RESERVATION_NOT_FOUND";
          throw err;
        }
        if (latestReservation.status === "finalized" && latestReservation.gift_order_id) {
          const existingGift = await giftOrderRepository.findById(
            latestReservation.gift_order_id,
            query,
          );
          return { gift: existingGift, idempotent: true };
        }
        if (!isReservationActiveStatus(latestReservation.status)) {
          const err = new Error("RESERVATION_NOT_FINALIZABLE");
          err.code = "RESERVATION_NOT_FINALIZABLE";
          throw err;
        }
        const claim = await giftReservationRepository.claimForFinalization({
          reservationId: latestReservation.id,
          updatedAt: nowIso(),
          query,
        });
        if (!Number(claim?.changes ?? claim?.rowCount ?? 0)) {
          const winner = await giftReservationRepository.getById(
            latestReservation.id,
            query,
          );
          if (winner?.gift_order_id) {
            return {
              gift: await giftOrderRepository.findById(winner.gift_order_id, query),
              idempotent: true,
            };
          }
          const err = new Error("RESERVATION_NOT_FINALIZABLE");
          err.code = "RESERVATION_NOT_FINALIZABLE";
          throw err;
        }

        const createdGift = await createGiftOrderFromPayload({
          userId,
          contentType: latestReservation.content_type,
          contentId: latestReservation.content_id,
          recipientName,
          senderDisplayName,
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

        const finalized = await giftReservationRepository.markFinalized({
          reservationId: latestReservation.id,
          giftOrderId: createdGift.gift.id,
          updatedAt: nowIso(),
          query,
        });
        if (!Number(finalized?.changes ?? finalized?.rowCount ?? 0)) {
          const err = new Error("GIFT_FINALIZE_INTEGRITY_FAILED");
          err.code = "GIFT_FINALIZE_INTEGRITY_FAILED";
          throw err;
        }

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
        responseGift = await giftOrderRepository.findById(created.gift.id);
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

    const reservation = await giftReservationRepository.getById(request.params.id);
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
      senderDisplayName,
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
        senderDisplayName,
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
    if (acceptsHtml(request)) {
      return reply
        .type("text/html; charset=utf-8")
        .header("Cache-Control", "public, max-age=300")
        .send(publicGiftIndexPage || publicGiftFallbackPage);
    }

    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const limit = Math.max(1, Math.min(Number(request.query?.limit || 50), 100));
    const offset = Math.max(0, Number(request.query?.offset || 0));
    const status = typeof request.query?.status === "string" ? request.query.status.trim() : null;

    try {
      const rows = await giftOrderRepository.listForUser({
        userId,
        status,
        limit,
        offset,
      });

      reply.send({
        gifts: await Promise.all(rows.map(renderGiftSummaryWithDelivery)),
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

    const gift = await giftOrderRepository.findById(request.params.id);
    if (!gift || gift.sender_user_id !== userId) {
      sendError(reply, 404, "GIFT_NOT_FOUND", "Gift not found.");
      return;
    }
    if (!["scheduled", "dispatch_retry", "ready_to_share"].includes(gift.status)) {
      sendError(reply, 409, "GIFT_NOT_EDITABLE", "Gift can no longer be edited.");
      return;
    }
    const sentDelivery = await giftDispatchRepository.hasSentDelivery({
      giftOrderId: gift.id,
    });
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

    await giftOrderRepository.updateSchedule({
      giftId: gift.id,
      sendAt: nextSendAt,
      senderTimezone: nextTimezone,
      recipientName: nextRecipientName,
      channels: nextChannels,
      recipientPhone: nextPhone,
      recipientEmail: nextEmail,
      message: nextMessage,
      updatedAt: nowIso(),
    });

    await giftDispatchRepository.deleteUnsentRows({ giftOrderId: gift.id });
    await createGiftDeliveryOutboxRows({
      giftOrderId: gift.id,
      channels: nextChannels,
      recipientPhone: nextPhone,
      recipientEmail: nextEmail,
      sendAtIso: nextSendAt,
    });

    await shareTokenRepository.updateGiftShareSchedule({
      contentType: gift.content_type,
      shareTokenId: gift.share_token_id,
      giftOrderId: gift.id,
      dispatchAt: nextSendAt,
      expiresAt: nextExpiresAt,
    });

    await emitGiftActivity({
      userId,
      action: "gift_rescheduled",
      resourceType: "gift_order",
      resourceId: gift.id,
      metadata: { send_at: nextSendAt, channels: nextChannels },
    });

    const updated = await giftOrderRepository.findById(gift.id);
    reply.send({ gift: renderGiftSummary(updated) });
  });

  app.post("/gifts/:id/delivery/stop", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const gift = await giftOrderRepository.findById(request.params.id);
    if (!gift || gift.sender_user_id !== userId) {
      sendError(reply, 404, "GIFT_NOT_FOUND", "Gift not found.");
      return;
    }
    const channels = normalizeGiftChannels(request.body?.channels);
    if (!channels.length) {
      sendError(
        reply,
        400,
        "INVALID_CHANNELS",
        "Choose at least one delivery channel to stop.",
      );
      return;
    }

    const timestamp = nowIso();
    const stopResult = await db.transaction(async (query) => {
      const cancelled = await giftDispatchRepository.cancelUnsentChannels({
        giftOrderId: gift.id,
        channels,
        updatedAt: timestamp,
        query,
      });
      const allResult = await query(
        "SELECT channel, status FROM gift_delivery_outbox WHERE gift_order_id = ?",
        [gift.id],
      );
      const allRows = allResult?.rows || [];
      const hasActive = allRows.some((row) =>
        ["pending", "failed", "sending"].includes(row.status),
      );
      const hasAccepted = allRows.some((row) => row.status === "sent");
      if (!hasActive) {
        await query(
          `UPDATE gift_orders
           SET status = ?,
               dispatch_status = ?,
               next_retry_at = NULL,
               updated_at = ?
           WHERE id = ? AND status != 'cancelled'`,
          [
            hasAccepted ? "dispatched" : "ready_to_share",
            hasAccepted ? "partial" : "cancelled",
            timestamp,
            gift.id,
          ],
        );
      }
      const afterResult = await query(
        `SELECT channel, status
         FROM gift_delivery_outbox
         WHERE gift_order_id = ? AND channel IN (${channels.map(() => "?").join(", ")})`,
        [gift.id, ...channels],
      );
      return {
        channels: (afterResult?.rows || [])
          .filter((row) => row.status === "cancelled")
          .map((row) => row.channel),
        changed: Number(cancelled?.changes ?? cancelled?.rowCount ?? 0) > 0,
      };
    });

    if (stopResult.changed) {
      await emitGiftActivity({
        userId,
        action: "gift_delivery_stopped",
        resourceType: "gift_order",
        resourceId: gift.id,
        metadata: { channels: stopResult.channels },
      });
    }
    const updated = await giftOrderRepository.findById(gift.id);
    reply.send({
      gift: await renderGiftSummaryWithDelivery(updated),
      stopped_channels: stopResult.channels,
    });
  });

  app.post("/gifts/:id/cancel", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const gift = await giftOrderRepository.findById(request.params.id);
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
    if (!["scheduled", "dispatch_retry", "ready_to_share"].includes(gift.status)) {
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
      if (err.code === "GIFT_ALREADY_ACCESSED") {
        sendError(
          reply,
          409,
          "GIFT_ALREADY_ACCESSED",
          "The recipient already opened this gift, so the credit cannot be restored.",
        );
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
