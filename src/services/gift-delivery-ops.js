"use strict";

const { nowIso, toJson } = require("../utils/common");
const { newUuid } = require("../utils/ids");

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
    return { shouldUpdate: true, nextStatus: normalizedNextStatus };
  }

  if (isTerminalReceiptStatus(normalizedCurrentStatus) && isTerminalReceiptStatus(normalizedNextStatus)) {
    return { shouldUpdate: false, nextStatus: normalizedCurrentStatus };
  }

  return { shouldUpdate: false, nextStatus: normalizedCurrentStatus };
}

async function dbQuery(db, sql, params = []) {
  if (typeof db === "function") {
    return db(sql, params);
  }
  if (db && typeof db.query === "function") {
    return db.query(sql, params);
  }
  const stmt = db.prepare(sql);
  const upper = sql.trim().toUpperCase();
  if (upper.startsWith("SELECT")) {
    const rows = await stmt.all(...params);
    return { rows };
  }
  const result = await stmt.run(...params);
  return { rows: [], rowCount: result?.changes || 0, changes: result?.changes || 0 };
}

async function dbGet(db, sql, params = []) {
  const result = await dbQuery(db, sql, params);
  return result?.rows?.[0] || null;
}

async function dbAll(db, sql, params = []) {
  const result = await dbQuery(db, sql, params);
  return result?.rows || [];
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
  const existing = await dbGet(
    db,
    "SELECT * FROM gift_delivery_incidents WHERE incident_key = ?",
    [incidentKey]
  );

  if (existing) {
    const nextStatus = reopen ? "open" : existing.status;
    await dbQuery(
      db,
      `UPDATE gift_delivery_incidents
       SET severity = ?, summary = ?, detail = ?, metadata_json = ?, updated_at = ?, status = ?,
           gift_order_id = COALESCE(?, gift_order_id),
           outbox_id = COALESCE(?, outbox_id),
           resource_type = COALESCE(?, resource_type),
           resource_id = COALESCE(?, resource_id),
           acknowledged_at = CASE WHEN ? = 'open' THEN NULL ELSE acknowledged_at END,
           acknowledged_by = CASE WHEN ? = 'open' THEN NULL ELSE acknowledged_by END,
           resolved_at = CASE WHEN ? = 'open' THEN NULL ELSE resolved_at END,
           resolved_by = CASE WHEN ? = 'open' THEN NULL ELSE resolved_by END
       WHERE incident_key = ?`,
      [
        severity,
        summary,
        detail,
        toJson(metadata),
        timestamp,
        nextStatus,
        giftOrderId,
        outboxId,
        resourceType,
        resourceId,
        nextStatus,
        nextStatus,
        nextStatus,
        nextStatus,
        incidentKey,
      ]
    );
    return dbGet(db, "SELECT * FROM gift_delivery_incidents WHERE incident_key = ?", [incidentKey]);
  }

  const id = newUuid();
  await dbQuery(
    db,
    `INSERT INTO gift_delivery_incidents (
      id, incident_key, incident_type, severity, status, gift_order_id, outbox_id,
      resource_type, resource_id, summary, detail, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      incidentKey,
      incidentType,
      severity,
      "open",
      giftOrderId,
      outboxId,
      resourceType,
      resourceId,
      summary,
      detail,
      toJson(metadata),
      timestamp,
      timestamp,
    ]
  );
  return dbGet(db, "SELECT * FROM gift_delivery_incidents WHERE id = ?", [id]);
}

async function acknowledgeGiftIncident(db, incidentKey, adminId) {
  const timestamp = nowIso();
  await dbQuery(
    db,
    `UPDATE gift_delivery_incidents
     SET status = 'acknowledged', acknowledged_at = ?, acknowledged_by = ?, updated_at = ?
     WHERE incident_key = ? AND status = 'open'`,
    [timestamp, adminId, timestamp, incidentKey]
  );
  return dbGet(db, "SELECT * FROM gift_delivery_incidents WHERE incident_key = ?", [incidentKey]);
}

async function resolveGiftIncident(db, incidentKey, resolverId = null) {
  const timestamp = nowIso();
  await dbQuery(
    db,
    `UPDATE gift_delivery_incidents
     SET status = 'resolved', resolved_at = ?, resolved_by = ?, updated_at = ?
     WHERE incident_key = ? AND status != 'resolved'`,
    [timestamp, resolverId, timestamp, incidentKey]
  );
  return dbGet(db, "SELECT * FROM gift_delivery_incidents WHERE incident_key = ?", [incidentKey]);
}

async function resolveGiftIncidentsForGift(db, giftOrderId, incidentTypes = []) {
  const params = [nowIso(), giftOrderId];
  let sql = `UPDATE gift_delivery_incidents
             SET status = 'resolved', resolved_at = ?, updated_at = ?
             WHERE gift_order_id = ? AND status != 'resolved'`;
  params.splice(1, 0, params[0]);
  if (incidentTypes.length) {
    sql += ` AND incident_type IN (${incidentTypes.map(() => "?").join(", ")})`;
    params.push(...incidentTypes);
  }
  await dbQuery(db, sql, params);
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
