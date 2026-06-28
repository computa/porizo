"use strict";

const {
  createGiftDeliveryIncidentRepository,
} = require("../database/gift-delivery-incident-repository");
const { nowIso, toJson } = require("../utils/common");
const { newUuid } = require("../utils/ids");
const { dbQuery, dbGet, dbAll } = require("../utils/db-adapter");

const RECEIPT_PRECEDENCE = {
  accepted: 1,
  sent: 2,
  delivered: 3,
  undelivered: 3,
  bounced: 3,
  complained: 3,
  failed: 3,
};

function normalizeIsoTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function receiptPrecedence(status) {
  return RECEIPT_PRECEDENCE[String(status || "").toLowerCase()] || 0;
}

function isTerminalReceiptStatus(status) {
  return ["delivered", "undelivered", "bounced", "complained", "failed"].includes(String(status || "").toLowerCase());
}

function chooseReceiptState({ currentStatus, currentEventAt, nextStatus, nextEventAt }) {
  const normalizedNextStatus = String(nextStatus || "").toLowerCase();
  if (!normalizedNextStatus) {
    return { shouldUpdate: false, nextStatus: currentStatus || null };
  }

  const normalizedCurrentStatus = String(currentStatus || "").toLowerCase();
  if (!normalizedCurrentStatus) {
    return { shouldUpdate: true, nextStatus: normalizedNextStatus };
  }

  const normalizedCurrentEventAt = normalizeIsoTimestamp(currentEventAt);
  const normalizedNextEventAt = normalizeIsoTimestamp(nextEventAt);

  if (normalizedCurrentEventAt && normalizedNextEventAt) {
    if (normalizedNextEventAt > normalizedCurrentEventAt) {
      return { shouldUpdate: true, nextStatus: normalizedNextStatus };
    }
    if (normalizedNextEventAt < normalizedCurrentEventAt) {
      return { shouldUpdate: false, nextStatus: normalizedCurrentStatus };
    }
  }

  const currentPrecedence = receiptPrecedence(normalizedCurrentStatus);
  const nextPrecedence = receiptPrecedence(normalizedNextStatus);

  if (nextPrecedence > currentPrecedence) {
    return { shouldUpdate: true, nextStatus: normalizedNextStatus };
  }

  if (isTerminalReceiptStatus(normalizedCurrentStatus) && !isTerminalReceiptStatus(normalizedNextStatus)) {
    return { shouldUpdate: false, nextStatus: normalizedCurrentStatus };
  }

  if (normalizedCurrentStatus === normalizedNextStatus) {
    // Skip writes for duplicate terminal status updates (e.g., repeated 'delivered' callbacks)
    const skipChurn = isTerminalReceiptStatus(normalizedCurrentStatus);
    return { shouldUpdate: !skipChurn, nextStatus: normalizedNextStatus };
  }

  if (isTerminalReceiptStatus(normalizedCurrentStatus) && isTerminalReceiptStatus(normalizedNextStatus)) {
    return { shouldUpdate: false, nextStatus: normalizedCurrentStatus };
  }

  return { shouldUpdate: false, nextStatus: normalizedCurrentStatus };
}

function redactPhone(phone) {
  if (!phone) return null;
  const value = String(phone);
  if (value.length <= 4) return "***";
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

function redactEmail(email) {
  if (!email) return null;
  const value = String(email);
  const at = value.indexOf("@");
  if (at <= 1) return `***${value.slice(at)}`;
  return `${value.slice(0, 1)}***${value.slice(at - 1)}`;
}

function redactRecipient(channel, recipient) {
  if (!recipient) return null;
  return channel === "sms" ? redactPhone(recipient) : redactEmail(recipient);
}

function redactGiftContacts(metadata = {}) {
  const next = { ...metadata };
  if (next.recipient_phone) next.recipient_phone = redactPhone(next.recipient_phone);
  if (next.recipient_email) next.recipient_email = redactEmail(next.recipient_email);
  if (next.recipient) next.recipient = "***";
  if (next.share_url) next.share_url = "[redacted]";
  if (next.claim_pin) next.claim_pin = "[redacted]";
  return next;
}

async function upsertGiftIncident(db, {
  incidentKey,
  incidentType,
  severity = "warning",
  giftOrderId = null,
  outboxId = null,
  resourceType = null,
  resourceId = null,
  summary,
  detail = null,
  metadata = {},
  reopen = true,
}) {
  const timestamp = nowIso();
  const repository = createGiftDeliveryIncidentRepository(db);
  const existing = await repository.getByKey(incidentKey);

  if (existing) {
    const nextStatus = reopen ? "open" : existing.status;
    await repository.updateExistingByKey({
      incidentKey,
      severity,
      summary,
      detail,
      metadataJson: toJson(metadata),
      timestamp,
      nextStatus,
      giftOrderId,
      outboxId,
      resourceType,
      resourceId,
    });
    return repository.getByKey(incidentKey);
  }

  const id = newUuid();
  await repository.insert({
    id,
    incidentKey,
    incidentType,
    severity,
    status: "open",
    giftOrderId,
    outboxId,
    resourceType,
    resourceId,
    summary,
    detail,
    metadataJson: toJson(metadata),
    timestamp,
  });
  return repository.getById(id);
}

async function acknowledgeGiftIncident(db, incidentKey, adminId) {
  const timestamp = nowIso();
  const repository = createGiftDeliveryIncidentRepository(db);
  await repository.acknowledgeByKey({ incidentKey, adminId, timestamp });
  return repository.getByKey(incidentKey);
}

async function resolveGiftIncident(db, incidentKey, resolverId = null) {
  const timestamp = nowIso();
  const repository = createGiftDeliveryIncidentRepository(db);
  await repository.resolveByKey({ incidentKey, resolverId, timestamp });
  return repository.getByKey(incidentKey);
}

async function resolveGiftIncidentsForGift(db, giftOrderId, incidentTypes = []) {
  const repository = createGiftDeliveryIncidentRepository(db);
  await repository.resolveForGift({
    giftOrderId,
    incidentTypes,
    timestamp: nowIso(),
  });
}

function normalizeTwilioReceipt(body = {}) {
  const rawStatus = String(body.MessageStatus || body.SmsStatus || "").toLowerCase();
  const mapping = {
    queued: "accepted",
    accepted: "accepted",
    sending: "sent",
    sent: "sent",
    delivered: "delivered",
    undelivered: "undelivered",
    failed: "failed",
    read: "delivered",
  };
  return {
    providerName: "twilio",
    providerMessageId: body.MessageSid || null,
    receiptStatus: mapping[rawStatus] || "failed",
    receiptEventAt: normalizeIsoTimestamp(body.Timestamp) || nowIso(),
    summary: rawStatus || "unknown",
    metadata: {
      raw_status: rawStatus || null,
      error_code: body.ErrorCode || null,
      error_message: body.ErrorMessage || null,
      to: redactPhone(body.To || null),
      from: redactPhone(body.From || null),
    },
  };
}

function normalizeResendReceipt(payload = {}) {
  const eventType = String(payload.type || payload.event || "").toLowerCase();
  const mapping = {
    "email.sent": "sent",
    "email.delivered": "delivered",
    "email.delivery_delayed": "sent",
    "email.bounced": "bounced",
    "email.complained": "complained",
    "email.failed": "failed",
  };
  const data = payload.data || {};
  return {
    providerName: "resend",
    providerMessageId: data.email_id || data.id || payload.created?.id || null,
    receiptStatus: mapping[eventType] || "failed",
    receiptEventAt: normalizeIsoTimestamp(data.created_at || payload.created_at) || nowIso(),
    summary: eventType || "unknown",
    metadata: {
      raw_type: eventType || null,
      to: redactEmail(Array.isArray(data.to) ? data.to[0] : data.to || null),
      from: redactEmail(data.from || null),
      subject: data.subject || null,
    },
  };
}

module.exports = {
  dbAll,
  dbGet,
  dbQuery,
  chooseReceiptState,
  normalizeResendReceipt,
  normalizeTwilioReceipt,
  redactEmail,
  redactGiftContacts,
  redactPhone,
  redactRecipient,
  resolveGiftIncident,
  resolveGiftIncidentsForGift,
  upsertGiftIncident,
  acknowledgeGiftIncident,
  isTerminalReceiptStatus,
};
