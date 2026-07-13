"use strict";

const crypto = require("crypto");
const twilio = require("twilio");
const { Resend } = require("resend");
const { newUuid, newShareId } = require("../utils/ids");
const { parseJson, nowIso } = require("../utils/common");
const { startGiftDispatchJob } = require("../jobs/gift-dispatch");
const { registerGiftRoutes } = require("../routes/gifts");
const {
  createGiftDispatchRepository,
} = require("../database/gift-dispatch-repository");
const {
  createShareTokenRepository,
} = require("../database/share-token-repository");
const { createIdentityRepository } = require("../database/identity-repository");
const { getFeatureFlag } = require("../services/feature-flags");
const emailService = require("../services/email-service");
const {
  upsertGiftIncident,
  resolveGiftIncident,
  resolveGiftIncidentsForGift,
  normalizeTwilioReceipt,
  normalizeResendReceipt,
  chooseReceiptState,
  redactGiftContacts,
} = require("../services/gift-delivery-ops");
const { createGiftOpsMonitor } = require("../services/gift-ops-monitoring");
const {
  createContactDeliveryService,
  EVENT_STATUS: CONTACT_DELIVERY_EVENT_STATUS,
} = require("../services/contact-delivery-service");

function giftDeliveryPlugin(app, options) {
  const {
    db,
    appConfig = {},
    config = {},
    requireUserId,
    sendError,
    addAuditEntry,
    eventsService,
    giftWalletRepository,
    trackVersionRepository,
    buildGiftShareUrl,
    twilioStatusCallbackBaseUrl,
    giftDispatchRepository = createGiftDispatchRepository(db),
    shareTokenRepository = createShareTokenRepository(db),
    identityRepository = createIdentityRepository(db),
  } = options;

  const giftDispatchMaxAttempts = Number(
    appConfig.GIFT_DISPATCH_MAX_ATTEMPTS ??
      config.GIFT_DISPATCH_MAX_ATTEMPTS ??
      5,
  );

  const giftOpsMonitor = createGiftOpsMonitor({
    db,
    logger: app.log,
    redactGiftContacts,
    upsertGiftIncident,
    resolveGiftIncident,
  });
  const contactDeliveryService = createContactDeliveryService(db);
  emailService.configureContactDeliveryPolicy(contactDeliveryService);
  const logGiftLifecycle = giftOpsMonitor.logGiftLifecycle;
  const createGiftIncident = giftOpsMonitor.recordGiftIncident;
  const clearGiftIncident = giftOpsMonitor.clearGiftIncident;

  function normalizeGiftChannels(rawChannels) {
    if (!Array.isArray(rawChannels)) {
      return [];
    }
    const allowed = new Set(["sms", "email"]);
    const deduped = [];
    for (const value of rawChannels) {
      if (typeof value !== "string") continue;
      const normalized = value.trim().toLowerCase();
      if (!allowed.has(normalized)) continue;
      if (!deduped.includes(normalized)) {
        deduped.push(normalized);
      }
    }
    return deduped;
  }

  function normalizeGiftPhone(value) {
    if (typeof value !== "string") return null;
    const cleaned = value.trim().replace(/[^\d+]/g, "");
    if (!cleaned) return null;
    const normalized = cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
      return null;
    }
    return normalized;
  }

  function normalizeGiftEmail(value) {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      return null;
    }
    return normalized;
  }

  function parseGiftChannelsJson(value) {
    const parsed = parseJson(value, [], "gift_channels");
    return normalizeGiftChannels(parsed);
  }

  async function ensureGiftWalletRow(userId) {
    return giftWalletRepository.ensureRow(userId);
  }

  async function getGiftWalletBalance(userId, options) {
    return giftWalletRepository.getBalance(userId, options);
  }

  async function hasGiftWalletReceiptCredit(args) {
    return giftWalletRepository.hasReceiptCredit(args);
  }

  async function applyGiftWalletTransaction(args) {
    return giftWalletRepository.applyTransaction(args);
  }

  async function getGiftWalletSummary(userId, limit = 20) {
    return giftWalletRepository.getSummary(userId, limit);
  }

  async function ensureTrackGiftShareToken({
    trackId,
    senderUserId,
    giftOrderId,
    versionNum = null,
    sendAtIso,
    expiresInDays = 30,
    requireAppClaim = true,
    externalQuery = null,
  }) {
    const query = externalQuery || null;
    const track = await trackVersionRepository.findTrackById(trackId, query);
    if (!track || track.user_id !== senderUserId || track.deleted_at) {
      const err = new Error("TRACK_NOT_FOUND");
      err.code = "TRACK_NOT_FOUND";
      throw err;
    }

    const resolvedVersionNum = Number(versionNum || track.latest_version || 1);
    const trackVersion = await trackVersionRepository.findByTrackIdAndVersion({
      trackId: track.id,
      versionNum: resolvedVersionNum,
      query,
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

    const claimPolicy = requireAppClaim ? "app_only" : "default";

    const expiresAt = new Date(
      new Date(sendAtIso).getTime() + expiresInDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const claimPin = String(crypto.randomInt(100000, 1000000));
    const streamKeyId = newUuid();
    const streamKey = crypto.randomBytes(16).toString("base64");

    const shareId = newShareId();

    await query(
      `INSERT INTO share_tokens (
        id, track_id, track_version_id, creator_id, status,
        bound_device_id, bound_device_platform, bound_app_version, bound_at,
        web_stream_allowed, app_save_allowed, expires_at, created_at, last_accessed_at, access_count,
        stream_key_id, stream_key, claim_pin, claim_attempts,
        utm_source, utm_medium, utm_campaign, referrer, created_ip, created_user_agent,
        delivery_source, gift_order_id, claim_policy, dispatch_at, dispatched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        shareId,
        track.id,
        trackVersion.id,
        senderUserId,
        "unbound",
        null,
        null,
        null,
        null,
        1,
        1,
        expiresAt,
        nowIso(),
        null,
        0,
        streamKeyId,
        streamKey,
        claimPin,
        0,
        null,
        null,
        null,
        null,
        null,
        null,
        "gift",
        giftOrderId,
        claimPolicy,
        sendAtIso,
        null,
      ],
    );
    return {
      shareId,
      shareUrl: buildGiftShareUrl(shareId),
      claimPin,
      expiresAt,
    };
  }

  async function ensurePoemGiftShareToken({
    poemId,
    senderUserId,
    giftOrderId,
    sendAtIso,
    expiresInDays = 30,
    requireAppClaim = true,
    externalQuery = null,
  }) {
    const query = externalQuery || db.query.bind(db);
    const poemResult = await query(
      "SELECT * FROM poems WHERE id = ? AND deleted_at IS NULL",
      [poemId],
    );
    const poem = poemResult?.rows?.[0] || null;
    if (!poem || poem.user_id !== senderUserId) {
      const err = new Error("POEM_NOT_FOUND");
      err.code = "POEM_NOT_FOUND";
      throw err;
    }

    const verses = parseJson(poem.verses, [], `poem_${poem.id}_verses`);
    if (!Array.isArray(verses) || verses.length === 0) {
      const err = new Error("POEM_NOT_READY");
      err.code = "POEM_NOT_READY";
      throw err;
    }

    const claimPolicy = requireAppClaim ? "app_only" : "default";

    const expiresAt = new Date(
      new Date(sendAtIso).getTime() + expiresInDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const claimPin = String(crypto.randomInt(100000, 1000000));

    const shareId = newShareId();

    await query(
      `INSERT INTO poem_share_tokens (
        id, poem_id, creator_id, status, bound_device_id, bound_user_id, bound_at,
        claim_pin, claim_attempts, allow_save, expires_at, created_at, last_accessed_at, access_count,
        utm_source, utm_medium, utm_campaign, referrer, created_ip, created_user_agent,
        delivery_source, gift_order_id, claim_policy, dispatch_at, dispatched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        shareId,
        poem.id,
        senderUserId,
        "active",
        null,
        null,
        null,
        claimPin,
        0,
        1,
        expiresAt,
        nowIso(),
        null,
        0,
        null,
        null,
        null,
        null,
        null,
        null,
        "gift",
        giftOrderId,
        claimPolicy,
        sendAtIso,
        null,
      ],
    );
    return {
      shareId,
      shareUrl: buildGiftShareUrl(shareId),
      claimPin,
      expiresAt,
    };
  }

  function renderGiftSummary(giftRow) {
    const contentSnapshot = giftRow.content_snapshot_json
      ? parseJson(
          giftRow.content_snapshot_json,
          null,
          `gift_${giftRow.id}_content_snapshot`,
        )
      : null;
    const contentTitle =
      giftRow.content_title ||
      (contentSnapshot && typeof contentSnapshot.title === "string"
        ? contentSnapshot.title
        : null);
    const recipientName =
      giftRow.recipient_name ||
      (contentSnapshot && typeof contentSnapshot.recipient_name === "string"
        ? contentSnapshot.recipient_name
        : null);

    const status = String(giftRow.status || "").toLowerCase();
    const dispatchStatus = String(giftRow.dispatch_status || "").toLowerCase();
    const deliveryLocked =
      dispatchStatus.startsWith("partial") ||
      status === "dispatching" ||
      status === "dispatched";

    return {
      id: giftRow.id,
      sender_user_id: giftRow.sender_user_id,
      content_type: giftRow.content_type,
      content_id: giftRow.content_id,
      content_title: contentTitle,
      recipient_name: recipientName,
      sender_display_name: giftRow.sender_display_name || null,
      status: giftRow.status,
      dispatch_status: giftRow.dispatch_status,
      delivery_mode: giftRow.delivery_mode,
      send_at: giftRow.send_at,
      sender_timezone: giftRow.sender_timezone,
      channels: parseGiftChannelsJson(giftRow.channels_json),
      recipient_phone: giftRow.recipient_phone,
      recipient_email: giftRow.recipient_email,
      message: giftRow.message,
      share_token_id: giftRow.share_token_id,
      share_url: giftRow.share_url,
      claim_pin: giftRow.claim_pin,
      claim_policy: giftRow.claim_policy || "app_only",
      expires_in_days: Number(giftRow.expires_in_days || 30),
      dispatch_attempts: Number(giftRow.dispatch_attempts || 0),
      last_dispatch_error: giftRow.last_dispatch_error,
      dispatched_at: giftRow.dispatched_at,
      cancelled_at: giftRow.cancelled_at,
      created_at: giftRow.created_at,
      updated_at: giftRow.updated_at,
      can_edit:
        !deliveryLocked &&
        (status === "scheduled" || status === "dispatch_retry"),
      can_cancel:
        !deliveryLocked &&
        (status === "scheduled" || status === "dispatch_retry"),
    };
  }

  async function createGiftDeliveryOutboxRows({
    giftOrderId,
    channels,
    recipientPhone,
    recipientEmail,
    sendAtIso,
    baselineAttemptCount = 0,
    nextRetryAt = null,
    externalQuery = null,
  }) {
    await giftDispatchRepository.createOutboxRows({
      giftOrderId,
      channels,
      recipientPhone,
      recipientEmail,
      sendAtIso,
      baselineAttemptCount,
      nextRetryAt,
      timestamp: nowIso(),
      query: externalQuery,
    });
  }

  async function ensureGiftDeliveryOutboxRows(gift, externalQuery = null) {
    const query = externalQuery || db.query.bind(db);
    const hasRows = await giftDispatchRepository.hasOutboxRows({
      giftOrderId: gift.id,
      query,
    });
    if (hasRows) {
      return;
    }

    const channels = parseGiftChannelsJson(gift.channels_json);
    if (!channels.length) {
      const err = new Error("GIFT_DELIVERY_CONFIG_INVALID");
      err.code = "GIFT_DELIVERY_CONFIG_INVALID";
      throw err;
    }

    await createGiftDeliveryOutboxRows({
      giftOrderId: gift.id,
      channels,
      recipientPhone: gift.recipient_phone,
      recipientEmail: gift.recipient_email,
      sendAtIso: gift.send_at,
      baselineAttemptCount: Number(gift.dispatch_attempts || 0),
      nextRetryAt: gift.next_retry_at || gift.send_at,
      externalQuery: query,
    });
  }

  function buildGiftSenderLabel(senderUser, giftRow) {
    const frozen =
      typeof giftRow?.sender_display_name === "string"
        ? giftRow.sender_display_name.trim()
        : "";
    if (frozen) return frozen;

    const displayName =
      typeof senderUser?.display_name === "string"
        ? senderUser.display_name.trim()
        : "";
    if (displayName) return displayName;

    const emailLocal =
      typeof senderUser?.email === "string"
        ? senderUser.email.split("@")[0]?.trim()
        : "";
    if (emailLocal) return emailLocal;

    return "A friend";
  }

  async function recordGiftDispatchAttempt({
    giftId,
    channel,
    status,
    providerMessageId = null,
    errorMessage = null,
    payload = {},
    createdAt,
  }) {
    await giftDispatchRepository.recordDispatchAttempt({
      giftId,
      channel,
      status,
      providerMessageId,
      errorMessage,
      payload,
      createdAt,
    });
  }

  async function markGiftDeliverySent({
    deliveryId,
    providerMessageId,
    payloadMeta,
    sentAt,
  }) {
    await giftDispatchRepository.markDeliverySent({
      deliveryId,
      providerMessageId,
      payloadMeta,
      sentAt,
    });
  }

  async function markGiftDeliveryFailed({
    deliveryId,
    attemptCount,
    errorMessage,
    nextRetryAt,
    failedAt,
  }) {
    await giftDispatchRepository.markDeliveryFailed({
      deliveryId,
      attemptCount,
      errorMessage,
      nextRetryAt,
      failedAt,
    });
  }

  async function applyGiftDeliveryReceipt({
    providerName,
    providerMessageId,
    receiptStatus,
    receiptEventAt,
    receiptPayload = {},
  }) {
    if (!providerMessageId) {
      // No provider_message_id means this webhook event can't correspond to any
      // gift outbox row (we always store a message id on real gift sends). It's
      // a non-gift / unmatchable event — acknowledge benignly rather than raising
      // a false gift incident. See the matched-lookup case below for context.
      return { updated: false, reason: "missing_provider_message_id" };
    }

    const delivery =
      await giftDispatchRepository.findDeliveryByProviderMessageId(
        providerMessageId,
      );

    if (!delivery) {
      // The provider webhook (Resend/Twilio) fires for ALL outbound messages —
      // cold-email campaigns, nurture sequences, transactional mail — not just
      // gift deliveries. A receipt whose provider_message_id is absent from the
      // gift outbox simply isn't a gift receipt; acknowledge it and move on.
      // Raising an incident here produced thousands of false "unknown receipt"
      // warnings (one per non-gift email) that buried real signal. We only
      // record provider_message_id on real gift sends, so a miss here is benign.
      return { updated: false, reason: "not_a_gift_receipt" };
    }

    const nextState = chooseReceiptState({
      currentStatus: delivery.receipt_status,
      currentEventAt: delivery.receipt_event_at,
      nextStatus: receiptStatus,
      nextEventAt: receiptEventAt,
    });

    if (nextState.shouldUpdate) {
      const updatedAt = nowIso();
      await giftDispatchRepository.updateDeliveryReceipt({
        deliveryId: delivery.id,
        receiptStatus: nextState.nextStatus,
        receiptEventAt: receiptEventAt || updatedAt,
        receiptPayload,
        updatedAt,
      });
    }

    if (
      ["undelivered", "bounced", "complained", "failed"].includes(
        String(receiptStatus || "").toLowerCase(),
      )
    ) {
      await createGiftIncident({
        incidentKey: `gift_receipt_failure:${delivery.id}`,
        incidentType: "gift_receipt_failure",
        severity: "warning",
        giftOrderId: delivery.gift_id,
        outboxId: delivery.id,
        summary: `Gift ${delivery.channel} receipt reported ${receiptStatus}`,
        detail: `Provider ${providerName} reported ${receiptStatus} for delivery ${delivery.id}`,
        metadata: {
          provider_name: providerName,
          provider_message_id: providerMessageId,
          receipt_status: receiptStatus,
        },
      });
    } else if (String(receiptStatus || "").toLowerCase() === "delivered") {
      await clearGiftIncident(`gift_receipt_failure:${delivery.id}`);
    }

    if (delivery.gift_status === "cancelled") {
      await createGiftIncident({
        incidentKey: `gift_receipt_after_cancel:${delivery.id}`,
        incidentType: "gift_receipt_after_cancel",
        severity: "info",
        giftOrderId: delivery.gift_id,
        outboxId: delivery.id,
        summary: "Receipt arrived after gift cancellation",
        detail: `Provider ${providerName} sent ${receiptStatus} after cancellation`,
        metadata: {
          provider_message_id: providerMessageId,
          receipt_status: receiptStatus,
        },
      });
    }

    await updateGiftAggregateObservability(delivery.gift_id);
    return {
      updated: nextState.shouldUpdate,
      giftId: delivery.gift_id,
      outboxId: delivery.id,
    };
  }

  async function recoverStaleGiftDeliveryRows(giftId, now) {
    await giftDispatchRepository.recoverSendingRowsForGift({
      giftOrderId: giftId,
      now,
    });
  }

  function summarizeGiftDeliveryRows({
    outboxRows,
    fallbackChannels,
    dispatchAttempts,
    maxAttempts,
  }) {
    const totalChannels = outboxRows.length || fallbackChannels.length;
    const sentRows = outboxRows.filter((row) => row.status === "sent");
    const retryableRows = outboxRows.filter(
      (row) =>
        row.status === "pending" ||
        (row.status === "failed" &&
          Boolean(row.next_retry_at) &&
          Number(row.attempt_count || 0) < maxAttempts),
    );
    const exhaustedRows = outboxRows.filter(
      (row) =>
        row.status === "failed" &&
        (Number(row.attempt_count || 0) >= maxAttempts || !row.next_retry_at),
    );
    const nextRetryAt =
      retryableRows
        .map((row) => row.next_retry_at || row.send_after)
        .filter(Boolean)
        .sort()[0] || null;
    const nextAttempts = Math.max(
      Number(dispatchAttempts || 0),
      ...outboxRows.map((row) => Number(row.attempt_count || 0)),
    );

    return {
      totalChannels,
      sentRows,
      retryableRows,
      exhaustedRows,
      nextRetryAt,
      nextAttempts,
      allDelivered: sentRows.length === totalChannels && totalChannels > 0,
      partiallyDelivered: sentRows.length > 0,
    };
  }

  function computeGiftDeliveryLagMs(gift, outboxRows) {
    const sendAtMs = new Date(gift.send_at).getTime();
    if (!Number.isFinite(sendAtMs)) return null;
    const firstAcceptedMs = outboxRows
      .map((row) =>
        new Date(
          row.provider_accepted_at ||
            row.last_attempt_at ||
            row.updated_at ||
            row.created_at,
        ).getTime(),
      )
      .filter(
        (value, index) =>
          outboxRows[index]?.status === "sent" && Number.isFinite(value),
      )
      .sort((a, b) => a - b)[0];
    if (!Number.isFinite(firstAcceptedMs)) return null;
    return Math.max(0, firstAcceptedMs - sendAtMs);
  }

  async function updateGiftAggregateObservability(
    giftId,
    { outboxRows = null, finalStatus = null } = {},
  ) {
    const gift = await giftDispatchRepository.findGiftOrder({
      giftOrderId: giftId,
    });
    if (!gift) return null;

    const rows =
      outboxRows ||
      (await giftDispatchRepository.listOutboxRowsForGift({
        giftOrderId: giftId,
      }));

    const firstAttemptStartedAt =
      rows
        .map((row) => row.first_attempt_started_at)
        .filter(Boolean)
        .sort()[0] || null;
    const lastDispatchCompletedAt =
      rows
        .map((row) => row.last_attempt_at || row.updated_at)
        .filter(Boolean)
        .sort()
        .slice(-1)[0] || null;
    const lastSuccessfulDeliveryAt =
      rows
        .filter((row) => row.status === "sent")
        .map(
          (row) =>
            row.provider_accepted_at || row.last_attempt_at || row.updated_at,
        )
        .filter(Boolean)
        .sort()
        .slice(-1)[0] || null;
    const deliveryLagMs = computeGiftDeliveryLagMs(gift, rows);
    const overdueDetectedAt = [
      "scheduled",
      "dispatch_retry",
      "dispatching",
    ].includes(finalStatus || gift.status)
      ? gift.overdue_detected_at
      : null;

    await giftDispatchRepository.updateGiftAggregateObservability({
      giftOrderId: giftId,
      firstAttemptStartedAt,
      lastDispatchCompletedAt,
      lastSuccessfulDeliveryAt,
      deliveryLagMs,
      overdueDetectedAt,
      updatedAt: nowIso(),
    });

    return giftDispatchRepository.findGiftOrder({ giftOrderId: giftId });
  }

  async function syncGiftDeliveryShareDispatch(gift, dispatchedAt) {
    await shareTokenRepository.markGiftShareDispatched({
      contentType: gift.content_type,
      shareTokenId: gift.share_token_id,
      giftOrderId: gift.id,
      dispatchedAt,
      scheduledAt: gift.send_at,
    });
  }

  async function revokeGiftDeliveryShare(gift) {
    await shareTokenRepository.revokeGiftDeliveryShare({
      contentType: gift.content_type,
      shareTokenId: gift.share_token_id,
      giftOrderId: gift.id,
    });
  }

  async function sendGiftSmsViaTwilio({ to, body, giftId, outboxId }) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    if (!accountSid || !authToken || !fromNumber) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("SMS_NOT_CONFIGURED");
      }
      return { simulated: true, providerMessageId: "simulated_sms" };
    }

    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const payload = new URLSearchParams({
      To: to,
      From: fromNumber,
      Body: body,
    });
    if (twilioStatusCallbackBaseUrl) {
      payload.append(
        "StatusCallback",
        `${twilioStatusCallbackBaseUrl.replace(/\/$/, "")}/gifts/webhooks/twilio-status?gift_id=${encodeURIComponent(giftId)}&outbox_id=${encodeURIComponent(outboxId)}`,
      );
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload.toString(),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result?.message || `TWILIO_${response.status}`);
    }
    return {
      simulated: false,
      providerMessageId: result?.sid || null,
    };
  }

  function sanitizeGiftTextField(text) {
    if (typeof text !== "string") return "";
    return text
      .replace(/[\r\n\t]/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function buildGiftDeliveryMessage({ giftRow, senderLabel }) {
    const noun = giftRow.content_type === "poem" ? "poem" : "song";
    const verb =
      giftRow.content_type === "poem" ? "Tap to read" : "Tap to listen";
    const sender = senderLabel || "A friend";
    const recipient = sanitizeGiftTextField(giftRow.recipient_name);
    const greeting = recipient ? `Hey ${recipient}, ` : "";
    const rawMessage =
      typeof giftRow.message === "string" ? giftRow.message.trim() : "";
    const safeMsgText = sanitizeGiftTextField(rawMessage);
    const note = safeMsgText
      ? `"${safeMsgText.length > 100 ? safeMsgText.slice(0, 97) + "..." : safeMsgText}"\n`
      : "";
    return `${greeting}${sender} sent you a ${noun} on Porizo.\n${note}${verb}: ${giftRow.share_url}\nPIN: ${giftRow.claim_pin}`;
  }

  function getGiftShareUrlDeliveryError(shareUrl) {
    if (!shareUrl || typeof shareUrl !== "string") {
      return "INVALID_GIFT_SHARE_URL";
    }
    try {
      const parsed = new URL(shareUrl);
      const hostname = String(parsed.hostname || "")
        .trim()
        .toLowerCase();
      if (
        !hostname ||
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1"
      ) {
        return "GIFT_SHARE_URL_NOT_PUBLIC";
      }
      return null;
    } catch {
      return "INVALID_GIFT_SHARE_URL";
    }
  }

  function isNonRetryableGiftDeliveryError(errorMessage) {
    return (
      errorMessage === "GIFT_SHARE_URL_NOT_PUBLIC" ||
      errorMessage === "INVALID_GIFT_SHARE_URL"
    );
  }

  function computeGiftRetryAt(attemptNumber) {
    const backoffMinutes = Math.min(
      60,
      Math.max(1, 2 ** Math.max(0, Number(attemptNumber || 1) - 1)),
    );
    return new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();
  }

  async function dispatchGiftById(giftId) {
    const giftSchedulingEnabled = await getFeatureFlag(
      db,
      "gift_scheduling_enabled",
    );
    if (!giftSchedulingEnabled) {
      return { skipped: true, reason: "feature_disabled" };
    }

    const dispatchStart = nowIso();
    const lock = await giftDispatchRepository.lockGiftForDispatch({
      giftOrderId: giftId,
      dispatchStart,
    });
    if (!lock.changes) {
      return { skipped: true, reason: "not_dispatchable" };
    }

    const gift = await giftDispatchRepository.findGiftOrder({
      giftOrderId: giftId,
    });
    if (!gift) {
      return { skipped: true, reason: "not_found" };
    }

    try {
      logGiftLifecycle("info", "dispatch_started", {
        gift_id: gift.id,
        send_at: gift.send_at,
        dispatch_status: gift.dispatch_status,
      });
      await ensureGiftDeliveryOutboxRows(gift);

      const channels = parseGiftChannelsJson(gift.channels_json);
      const senderUser = await identityRepository.findUserDisplayProfile(
        gift.sender_user_id,
      );
      const senderLabel = buildGiftSenderLabel(senderUser, gift);
      const payloadText = buildGiftDeliveryMessage({
        giftRow: gift,
        senderLabel,
      });
      const now = nowIso();
      const errors = [];

      await recoverStaleGiftDeliveryRows(gift.id, now);

      const dueRows = await giftDispatchRepository.listDueDeliveryRowsForGift({
        giftOrderId: gift.id,
        now,
      });

      if (!dueRows.length) {
        logGiftLifecycle("info", "dispatch_noop", {
          gift_id: gift.id,
          reason: "no_due_rows",
        });
      }

      for (const delivery of dueRows) {
        const lockResult = await giftDispatchRepository.lockDeliveryForSending({
          deliveryId: delivery.id,
          lockedAt: now,
        });
        if (!lockResult.changes) {
          continue;
        }

        logGiftLifecycle("info", "channel_send_started", {
          gift_id: gift.id,
          outbox_id: delivery.id,
          channel: delivery.channel,
          recipient: delivery.recipient,
          attempt_count: Number(delivery.attempt_count || 0) + 1,
        });

        try {
          let providerMessageId = null;
          let payloadMeta = {};
          const shareUrlError = getGiftShareUrlDeliveryError(gift.share_url);
          if (shareUrlError) {
            throw new Error(shareUrlError);
          }

          if (delivery.channel === "sms") {
            const smsEnabled = await getFeatureFlag(db, "gift_sms_enabled");
            if (!smsEnabled) {
              throw new Error("SMS_CHANNEL_DISABLED");
            }
            if (!delivery.recipient) {
              throw new Error("MISSING_RECIPIENT_PHONE");
            }
            const smsResult = await sendGiftSmsViaTwilio({
              to: delivery.recipient,
              body: payloadText,
              giftId: gift.id,
              outboxId: delivery.id,
            });
            providerMessageId = smsResult.providerMessageId;
            payloadMeta = { simulated: smsResult.simulated };
          } else if (delivery.channel === "email") {
            const emailEnabled = await getFeatureFlag(db, "gift_email_enabled");
            if (!emailEnabled) {
              throw new Error("EMAIL_CHANNEL_DISABLED");
            }
            if (!delivery.recipient) {
              throw new Error("MISSING_RECIPIENT_EMAIL");
            }

            let simulated = false;
            providerMessageId = "simulated_email";
            if (emailService.isConfigured()) {
              const sent = await emailService.sendGiftDeliveryEmail({
                to: delivery.recipient,
                senderName: senderLabel,
                recipientName: gift.recipient_name || "",
                shareUrl: gift.share_url,
                claimPin: gift.claim_pin,
                contentType: gift.content_type,
                contentTitle: gift.content_title || "",
                occasion: "",
                message: gift.message || "",
                tags: [
                  { name: "gift_order_id", value: gift.id },
                  { name: "gift_outbox_id", value: delivery.id },
                ],
              });
              providerMessageId = sent.messageId || providerMessageId;
            } else if (process.env.NODE_ENV === "production") {
              throw new Error("EMAIL_NOT_CONFIGURED");
            } else {
              simulated = true;
            }
            payloadMeta = { simulated };
          } else {
            throw new Error("UNKNOWN_DELIVERY_CHANNEL");
          }

          const sentAt = nowIso();
          await recordGiftDispatchAttempt({
            giftId: gift.id,
            channel: delivery.channel,
            status: "success",
            providerMessageId,
            payload: payloadMeta,
            createdAt: sentAt,
          });

          await markGiftDeliverySent({
            deliveryId: delivery.id,
            providerMessageId,
            payloadMeta,
            sentAt,
          });

          await clearGiftIncident(`gift_channel_failure:${delivery.id}`);
          logGiftLifecycle("info", "channel_send_accepted", {
            gift_id: gift.id,
            outbox_id: delivery.id,
            channel: delivery.channel,
            provider_message_id: providerMessageId,
          });
        } catch (err) {
          const failedAt = nowIso();
          const nextAttemptCount = Number(delivery.attempt_count || 0) + 1;
          const errorMessage = String(err.message || err);
          const nextRetryAt = isNonRetryableGiftDeliveryError(errorMessage)
            ? null
            : nextAttemptCount >= giftDispatchMaxAttempts
              ? null
              : computeGiftRetryAt(nextAttemptCount);

          errors.push(`${delivery.channel}:${errorMessage}`);

          await recordGiftDispatchAttempt({
            giftId: gift.id,
            channel: delivery.channel,
            status: "failed",
            errorMessage,
            createdAt: failedAt,
          });

          await markGiftDeliveryFailed({
            deliveryId: delivery.id,
            attemptCount: nextAttemptCount,
            errorMessage,
            nextRetryAt,
            failedAt,
          });

          await createGiftIncident({
            incidentKey: `gift_channel_failure:${delivery.id}`,
            incidentType: "channel_delivery_failed",
            severity: nextRetryAt ? "warning" : "critical",
            giftOrderId: gift.id,
            outboxId: delivery.id,
            summary: `Gift ${delivery.channel} delivery failed`,
            detail: errorMessage,
            metadata: {
              channel: delivery.channel,
              attempt_count: nextAttemptCount,
              next_retry_at: nextRetryAt,
              provider_name:
                delivery.provider_name ||
                (delivery.channel === "sms" ? "twilio" : "resend"),
            },
          });
          logGiftLifecycle("warn", "channel_send_failed", {
            gift_id: gift.id,
            outbox_id: delivery.id,
            channel: delivery.channel,
            attempt_count: nextAttemptCount,
            next_retry_at: nextRetryAt,
            error: errorMessage,
          });
        }
      }

      const outboxRows = await giftDispatchRepository.listOutboxRowsForGift({
        giftOrderId: gift.id,
      });

      const {
        sentRows,
        retryableRows,
        exhaustedRows,
        nextRetryAt,
        nextAttempts,
        allDelivered,
        partiallyDelivered,
      } = summarizeGiftDeliveryRows({
        outboxRows,
        fallbackChannels: channels,
        dispatchAttempts: gift.dispatch_attempts,
        maxAttempts: giftDispatchMaxAttempts,
      });

      if (allDelivered) {
        const dispatchedAt = nowIso();
        await giftDispatchRepository.markGiftFullyDispatched({
          giftOrderId: gift.id,
          dispatchAttempts: nextAttempts,
          dispatchedAt,
          deliveryLagMs: computeGiftDeliveryLagMs(gift, outboxRows),
        });

        await syncGiftDeliveryShareDispatch(gift, dispatchedAt);
        await resolveGiftIncidentsForGift(db, gift.id, [
          "channel_delivery_failed",
          "gift_overdue",
          "gift_dispatch_stalled",
          "gift_unknown_receipt",
        ]);

        await addAuditEntry({
          userId: gift.sender_user_id,
          action: "gift_dispatched",
          resourceType: "gift_order",
          resourceId: gift.id,
          metadata: { channels },
        });

        eventsService.emit("gift_dispatched", {
          userId: gift.sender_user_id,
          resourceType: "gift_order",
          resourceId: gift.id,
          metadata: { channels, content_type: gift.content_type },
        });
        logGiftLifecycle("info", "dispatch_completed", {
          gift_id: gift.id,
          channels,
          dispatch_lag_ms: computeGiftDeliveryLagMs(gift, outboxRows),
        });
        return { dispatched: true };
      }

      const exhausted =
        !partiallyDelivered &&
        retryableRows.length === 0 &&
        exhaustedRows.length > 0;
      const partialComplete = partiallyDelivered && retryableRows.length === 0;

      let refundTxId = null;
      if (exhausted) {
        try {
          const refund = await applyGiftWalletTransaction({
            userId: gift.sender_user_id,
            type: "gift_refund",
            amount: 1,
            source: "dispatch_failure",
            referenceType: "gift_order",
            referenceId: gift.id,
            description: "Auto-refund: gift delivery failed after max attempts",
            idempotencyKey: `gift_refund_dispatch_${gift.id}`,
          });
          refundTxId = refund.transactionId;
        } catch (refundErr) {
          app.log.error(
            { giftId: gift.id, err: refundErr },
            "Failed to auto-refund gift token",
          );
        }

        await revokeGiftDeliveryShare(gift);
        await createGiftIncident({
          incidentKey: `gift_delivery_exhausted:${gift.id}`,
          incidentType: "gift_delivery_exhausted",
          severity: "critical",
          giftOrderId: gift.id,
          summary: "Gift delivery exhausted all retries",
          detail: errors.join("; ") || "Gift delivery exhausted all retries.",
          metadata: {
            attempts: nextAttempts,
            sent_channels: sentRows.map((row) => row.channel),
          },
        });
      }

      await giftDispatchRepository.markGiftDispatchIncomplete({
        giftOrderId: gift.id,
        status: exhausted
          ? "failed"
          : partialComplete
            ? "dispatched"
            : "dispatch_retry",
        dispatchStatus: exhausted
          ? "failed"
          : partialComplete
            ? "partial"
            : partiallyDelivered
              ? "partial_retry"
              : "retrying",
        dispatchAttempts: nextAttempts,
        lastDispatchError: errors.join("; ") || null,
        nextRetryAt: exhausted || partialComplete ? null : nextRetryAt,
        lastDispatchCompletedAt: nowIso(),
        hasPartialDelivery: partiallyDelivered,
        lastSuccessfulDeliveryAt: partiallyDelivered ? nowIso() : null,
        deliveryLagMs: computeGiftDeliveryLagMs(gift, outboxRows),
        clearOverdue: partiallyDelivered || exhausted,
        markDispatched: partialComplete,
        dispatchedAt: partialComplete ? nowIso() : null,
        refundTransactionId: refundTxId,
        updatedAt: nowIso(),
      });

      await updateGiftAggregateObservability(gift.id, {
        outboxRows,
        finalStatus: exhausted
          ? "failed"
          : partialComplete
            ? "dispatched"
            : "dispatch_retry",
      });

      await addAuditEntry({
        userId: gift.sender_user_id,
        action: exhausted
          ? "gift_dispatch_failed"
          : partialComplete
            ? "gift_partially_dispatched"
            : "gift_dispatch_retry",
        resourceType: "gift_order",
        resourceId: gift.id,
        metadata: {
          errors,
          attempts: nextAttempts,
          refund_tx_id: refundTxId,
          sent_channels: sentRows.map((row) => row.channel),
          pending_channels: retryableRows.map((row) => row.channel),
        },
      });
      eventsService.emit(
        exhausted
          ? "gift_failed"
          : partialComplete
            ? "gift_partially_dispatched"
            : "gift_retry",
        {
          userId: gift.sender_user_id,
          resourceType: "gift_order",
          resourceId: gift.id,
          metadata: {
            errors,
            attempts: nextAttempts,
            sent_channels: sentRows.map((row) => row.channel),
            pending_channels: retryableRows.map((row) => row.channel),
          },
        },
      );

      if (!exhausted && retryableRows.length > 0) {
        await createGiftIncident({
          incidentKey: `gift_retry_pending:${gift.id}`,
          incidentType: "gift_dispatch_retry",
          severity: partiallyDelivered ? "warning" : "info",
          giftOrderId: gift.id,
          summary: partiallyDelivered
            ? "Gift partially delivered and is waiting to retry remaining channels"
            : "Gift delivery scheduled for retry",
          detail: errors.join("; ") || null,
          metadata: {
            sent_channels: sentRows.map((row) => row.channel),
            pending_channels: retryableRows.map((row) => row.channel),
            next_retry_at: nextRetryAt,
          },
        });
      } else {
        await clearGiftIncident(`gift_retry_pending:${gift.id}`);
      }

      logGiftLifecycle(
        exhausted ? "error" : "warn",
        exhausted
          ? "dispatch_exhausted"
          : partialComplete
            ? "dispatch_partial_complete"
            : "dispatch_retry_scheduled",
        {
          gift_id: gift.id,
          attempts: nextAttempts,
          errors,
          next_retry_at: nextRetryAt,
          sent_channels: sentRows.map((row) => row.channel),
          pending_channels: retryableRows.map((row) => row.channel),
        },
      );

      return { dispatched: false, partial: partialComplete, errors };
    } catch (dispatchErr) {
      // Recover from stuck 'dispatching' state — increment attempts to respect max limit
      const retryAt = computeGiftRetryAt(
        Number(gift?.dispatch_attempts || 0) + 1,
      );
      await giftDispatchRepository.recoverGiftDispatchCrash({
        giftOrderId: giftId,
        retryAt,
        errorMessage: dispatchErr.message || dispatchErr,
        completedAt: nowIso(),
      });
      await createGiftIncident({
        incidentKey: `gift_dispatch_stalled:${giftId}`,
        incidentType: "gift_dispatch_stalled",
        severity: "critical",
        giftOrderId: giftId,
        summary: "Gift dispatch crashed and was moved back to retry",
        detail: String(dispatchErr.message || dispatchErr),
        metadata: { next_retry_at: retryAt },
      });
      logGiftLifecycle("error", "dispatch_crashed", {
        gift_id: giftId,
        next_retry_at: retryAt,
        error: String(dispatchErr.message || dispatchErr),
      });
      throw dispatchErr;
    }
  }

  app.decorate("dispatchGiftById", dispatchGiftById);

  app.post("/gifts/webhooks/twilio-status", async (request, reply) => {
    const authToken =
      process.env.TWILIO_AUTH_TOKEN ||
      appConfig.TWILIO_AUTH_TOKEN ||
      config.TWILIO_AUTH_TOKEN;
    const signature = request.headers["x-twilio-signature"];
    if (!authToken || !signature) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }

    const webhookUrl = `${twilioStatusCallbackBaseUrl.replace(/\/$/, "")}${request.raw.url}`;
    const isValid = twilio.validateRequest(
      authToken,
      String(signature),
      webhookUrl,
      request.body || {},
    );
    if (!isValid) {
      reply.code(401).send({ error: "INVALID_SIGNATURE" });
      return;
    }

    const normalized = normalizeTwilioReceipt(request.body || {});
    const result = await applyGiftDeliveryReceipt({
      providerName: normalized.providerName,
      providerMessageId: normalized.providerMessageId,
      receiptStatus: normalized.receiptStatus,
      receiptEventAt: normalized.receiptEventAt,
      receiptPayload: normalized.metadata,
      incidentSummary:
        "Twilio delivery receipt could not be matched to a gift outbox row",
    });

    logGiftLifecycle("info", "twilio_receipt_processed", {
      provider_message_id: normalized.providerMessageId,
      receipt_status: normalized.receiptStatus,
      updated: result.updated,
      gift_id: result.giftId || null,
      outbox_id: result.outboxId || null,
    });
    reply.send({ received: true, updated: result.updated });
  });

  app.post(
    "/gifts/webhooks/resend-events",
    {
      preParsing: async (request, _reply, payload) => {
        // Capture raw body for Svix signature verification before Fastify parses it
        const chunks = [];
        for await (const chunk of payload) {
          chunks.push(chunk);
        }
        request.rawBody = Buffer.concat(chunks).toString("utf-8");
        const { Readable } = require("stream");
        return Readable.from([request.rawBody]);
      },
    },
    async (request, reply) => {
      const webhookSecret =
        process.env.RESEND_WEBHOOK_SECRET ||
        appConfig.RESEND_WEBHOOK_SECRET ||
        config.RESEND_WEBHOOK_SECRET;
      if (!webhookSecret) {
        reply.code(404).send({ error: "NOT_CONFIGURED" });
        return;
      }

      const headers = {
        id: request.headers["svix-id"],
        timestamp: request.headers["svix-timestamp"],
        signature: request.headers["svix-signature"],
      };
      if (!headers.id || !headers.timestamp || !headers.signature) {
        reply.code(401).send({ error: "INVALID_SIGNATURE" });
        return;
      }

      let verifiedPayload;
      try {
        const resend = new Resend(
          process.env.RESEND_API_KEY ||
            appConfig.RESEND_API_KEY ||
            config.RESEND_API_KEY ||
            "re_test",
        );
        verifiedPayload = resend.webhooks.verify({
          payload:
            request.rawBody ||
            (typeof request.body === "string"
              ? request.body
              : JSON.stringify(request.body || {})),
          headers,
          webhookSecret,
        });
      } catch (err) {
        reply
          .code(401)
          .send({ error: "INVALID_SIGNATURE", message: err.message });
        return;
      }

      const normalized = normalizeResendReceipt(verifiedPayload || {});
      const eventType = String(
        verifiedPayload?.type || verifiedPayload?.event || "",
      ).toLowerCase();
      const rawRecipients = verifiedPayload?.data?.to;
      const recipient = Array.isArray(rawRecipients)
        ? rawRecipients[0]
        : rawRecipients;
      if (CONTACT_DELIVERY_EVENT_STATUS[eventType] && recipient) {
        await contactDeliveryService.recordDeliveryEvent({
          provider: "resend",
          eventId: headers.id,
          eventType,
          recipient,
          eventAt: normalized.receiptEventAt,
          reason:
            verifiedPayload?.data?.bounce?.message ||
            verifiedPayload?.data?.reason ||
            null,
        });
      }
      const result = await applyGiftDeliveryReceipt({
        providerName: normalized.providerName,
        providerMessageId: normalized.providerMessageId,
        receiptStatus: normalized.receiptStatus,
        receiptEventAt: normalized.receiptEventAt,
        receiptPayload: normalized.metadata,
        incidentSummary:
          "Resend delivery receipt could not be matched to a gift outbox row",
      });

      logGiftLifecycle("info", "resend_receipt_processed", {
        provider_message_id: normalized.providerMessageId,
        receipt_status: normalized.receiptStatus,
        updated: result.updated,
        gift_id: result.giftId || null,
        outbox_id: result.outboxId || null,
      });
      reply.send({ received: true, updated: result.updated });
    },
  );

  const giftDeliveryContext = {
    normalizeGiftChannels,
    normalizeGiftPhone,
    normalizeGiftEmail,
    parseGiftChannelsJson,
    renderGiftSummary,
    ensureGiftWalletRow,
    getGiftWalletBalance,
    hasGiftWalletReceiptCredit,
    applyGiftWalletTransaction,
    getGiftWalletSummary,
    ensureTrackGiftShareToken,
    ensurePoemGiftShareToken,
    createGiftDeliveryOutboxRows,
    dispatchGiftById,
    getGiftShareUrlDeliveryError,
  };

  app.decorate("giftDeliveryContext", giftDeliveryContext);

  registerGiftRoutes(app, {
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
    giftReservationTtlMinutes: config.GIFT_RESERVATION_TTL_MINUTES,
  });

  return giftDeliveryContext;
}

function startGiftDeliveryRuntime({ app, db, config = {} }) {
  const giftDispatchJob = startGiftDispatchJob({
    db,
    dispatchGiftById: async (giftId) => app.dispatchGiftById(giftId),
    intervalMs: config.GIFT_DISPATCH_INTERVAL_MS || 30 * 1000,
    batchSize: 25,
  });

  const giftReservationExpiryTimer = setInterval(
    () => {
      app.expireGiftReservations({ limit: 50 }).catch((err) => {
        app.log.error(err, "Gift reservation expiry sweep failed");
      });
    },
    config.GIFT_RESERVATION_SWEEP_INTERVAL_MS || 60 * 1000,
  );

  app.expireGiftReservations({ limit: 50 }).catch((err) => {
    app.log.error(err, "Initial gift reservation expiry sweep failed");
  });

  return {
    stop() {
      giftDispatchJob.stop();
      clearInterval(giftReservationExpiryTimer);
    },
  };
}

module.exports = {
  giftDeliveryPlugin,
  startGiftDeliveryRuntime,
};
