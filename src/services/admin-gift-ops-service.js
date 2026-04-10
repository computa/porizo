"use strict";

const { parseJson } = require("../utils/common");
const {
  redactEmail,
  redactPhone,
  redactRecipient,
} = require("./gift-delivery-ops");

function safeBounds(limit = 50, offset = 0) {
  const parsedLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const parsedOffset = Math.max(0, Number(offset) || 0);
  return { limit: parsedLimit, offset: parsedOffset };
}

function parseGiftChannelsJson(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseGiftSnapshotTitle(value) {
  const parsed = parseJson(value, null, "gift_content_snapshot");
  return typeof parsed?.title === "string" ? parsed.title : null;
}

function maskShareUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.slice(0, Math.max(parsed.pathname.length - 4, 0))}***`;
  } catch {
    return "[redacted]";
  }
}

function extractAuditNote(metadata = {}) {
  if (!metadata || typeof metadata !== "object") return null;
  if (typeof metadata.note === "string" && metadata.note.trim()) return metadata.note.trim();
  if (typeof metadata.reason === "string" && metadata.reason.trim()) return metadata.reason.trim();
  return null;
}

function normalizeGiftOrderRow(row, { includeSensitive = false } = {}) {
  const channels = parseGiftChannelsJson(row.channels_json);
  const contentTitle = row.content_title || parseGiftSnapshotTitle(row.content_snapshot_json);
  return {
    id: row.id,
    sender_user_id: row.sender_user_id,
    sender_display_name: row.sender_display_name || null,
    sender_email: includeSensitive ? row.sender_email || null : redactEmail(row.sender_email || null),
    content_type: row.content_type,
    content_id: row.content_id,
    content_title: contentTitle,
    status: row.status,
    dispatch_status: row.dispatch_status,
    delivery_mode: row.delivery_mode,
    send_at: row.send_at,
    sender_timezone: row.sender_timezone,
    channels,
    recipient_phone: includeSensitive ? row.recipient_phone || null : redactPhone(row.recipient_phone || null),
    recipient_email: includeSensitive ? row.recipient_email || null : redactEmail(row.recipient_email || null),
    share_token_id: row.share_token_id,
    share_url: includeSensitive ? row.share_url || null : null,
    share_url_masked: maskShareUrl(row.share_url || null),
    claim_policy: row.claim_policy || "app_only",
    expires_in_days: Number(row.expires_in_days || 30),
    dispatch_attempts: Number(row.dispatch_attempts || 0),
    last_dispatch_error: row.last_dispatch_error || null,
    dispatched_at: row.dispatched_at || null,
    cancelled_at: row.cancelled_at || null,
    first_dispatch_started_at: row.first_dispatch_started_at || null,
    last_dispatch_completed_at: row.last_dispatch_completed_at || null,
    last_successful_delivery_at: row.last_successful_delivery_at || null,
    delivery_lag_ms: row.delivery_lag_ms == null ? null : Number(row.delivery_lag_ms),
    overdue_detected_at: row.overdue_detected_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    outbox_count: Number(row.outbox_count || 0),
    sent_count: Number(row.sent_count || 0),
    failed_count: Number(row.failed_count || 0),
    open_incident_count: Number(row.open_incident_count || 0),
    can_retry: (row.status === "scheduled" || row.status === "dispatch_retry") && Number(row.sent_count || 0) === 0,
    can_cancel: (row.status === "scheduled" || row.status === "dispatch_retry") && Number(row.sent_count || 0) === 0,
  };
}

function normalizeOutboxRow(row, { includeSensitive = false } = {}) {
  return {
    id: row.id,
    gift_order_id: row.gift_order_id,
    channel: row.channel,
    provider_name: row.provider_name || null,
    recipient: includeSensitive ? row.recipient : redactRecipient(row.channel, row.recipient),
    status: row.status,
    attempt_count: Number(row.attempt_count || 0),
    provider_message_id: row.provider_message_id || null,
    last_error: row.last_error || null,
    send_after: row.send_after,
    next_retry_at: row.next_retry_at || null,
    last_attempt_at: row.last_attempt_at || null,
    locked_at: row.locked_at || null,
    first_queued_at: row.first_queued_at || null,
    first_attempt_started_at: row.first_attempt_started_at || null,
    provider_accepted_at: row.provider_accepted_at || null,
    receipt_status: row.receipt_status || null,
    receipt_event_at: row.receipt_event_at || null,
    receipt_updated_at: row.receipt_updated_at || null,
    updated_at: row.updated_at,
  };
}

class AdminGiftOpsService {
  constructor(db) {
    this.db = db;
  }

  async getOverview() {
    const now = new Date().toISOString();
    const dueSoon = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const counts = await this.db.prepare(
      `SELECT
         SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) as scheduled_count,
         SUM(CASE WHEN status = 'dispatching' THEN 1 ELSE 0 END) as dispatching_count,
         SUM(CASE WHEN status = 'dispatch_retry' THEN 1 ELSE 0 END) as retrying_count,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
         SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count,
         SUM(CASE WHEN status = 'dispatched' THEN 1 ELSE 0 END) as dispatched_count,
         SUM(CASE WHEN status IN ('scheduled', 'dispatch_retry') AND COALESCE(next_retry_at, send_at) > ? AND COALESCE(next_retry_at, send_at) <= ? THEN 1 ELSE 0 END) as due_soon_count,
         SUM(CASE WHEN overdue_detected_at IS NOT NULL AND status IN ('scheduled', 'dispatch_retry', 'dispatching') THEN 1 ELSE 0 END) as overdue_count,
         SUM(CASE WHEN dispatch_status IN ('partial', 'partial_retry') THEN 1 ELSE 0 END) as partial_count,
         SUM(CASE WHEN last_dispatch_completed_at >= ? THEN 1 ELSE 0 END) as sent_last_24h
       FROM gift_orders`
    ).get(now, dueSoon, dayAgo);

    const incidents = await this.db.prepare(
      `SELECT
         SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
         SUM(CASE WHEN status = 'acknowledged' THEN 1 ELSE 0 END) as acknowledged_count
       FROM gift_delivery_incidents
       WHERE status IN ('open', 'acknowledged')`
    ).get();

    return {
      scheduled_count: Number(counts?.scheduled_count || 0),
      due_soon_count: Number(counts?.due_soon_count || 0),
      overdue_count: Number(counts?.overdue_count || 0),
      dispatching_count: Number(counts?.dispatching_count || 0),
      retrying_count: Number(counts?.retrying_count || 0),
      partial_count: Number(counts?.partial_count || 0),
      failed_count: Number(counts?.failed_count || 0),
      cancelled_count: Number(counts?.cancelled_count || 0),
      dispatched_count: Number(counts?.dispatched_count || 0),
      sent_last_24h: Number(counts?.sent_last_24h || 0),
      open_incidents: Number(incidents?.open_count || 0),
      acknowledged_incidents: Number(incidents?.acknowledged_count || 0),
    };
  }

  async listOrders(filters = {}, options = {}) {
    const { limit, offset } = safeBounds(options.limit, options.offset);
    const params = [];
    let sql = `
      SELECT
        go.*,
        u.display_name AS sender_display_name,
        u.email AS sender_email,
        (SELECT COUNT(*) FROM gift_delivery_outbox gdo WHERE gdo.gift_order_id = go.id) AS outbox_count,
        (SELECT COUNT(*) FROM gift_delivery_outbox gdo WHERE gdo.gift_order_id = go.id AND gdo.status = 'sent') AS sent_count,
        (SELECT COUNT(*) FROM gift_delivery_outbox gdo WHERE gdo.gift_order_id = go.id AND gdo.status = 'failed') AS failed_count,
        (SELECT COUNT(*) FROM gift_delivery_incidents gdi WHERE gdi.gift_order_id = go.id AND gdi.status IN ('open', 'acknowledged')) AS open_incident_count
      FROM gift_orders go
      LEFT JOIN users u ON u.id = go.sender_user_id
      WHERE 1=1
    `;

    if (filters.status) {
      sql += " AND go.status = ?";
      params.push(filters.status);
    }
    if (filters.dispatchStatus) {
      sql += " AND go.dispatch_status = ?";
      params.push(filters.dispatchStatus);
    }
    if (filters.deliveryMode) {
      sql += " AND go.delivery_mode = ?";
      params.push(filters.deliveryMode);
    }
    if (filters.channel) {
      sql += " AND go.channels_json LIKE ?";
      params.push(`%${filters.channel}%`);
    }
    if (filters.senderUserId) {
      sql += " AND go.sender_user_id = ?";
      params.push(filters.senderUserId);
    }
    if (filters.creator) {
      sql += " AND (u.display_name LIKE ? OR u.email LIKE ?)";
      const q = `%${filters.creator}%`;
      params.push(q, q);
    }
    if (filters.recipient) {
      sql += " AND (go.recipient_phone LIKE ? OR go.recipient_email LIKE ?)";
      const q = `%${filters.recipient}%`;
      params.push(q, q);
    }
    if (filters.overdue === "true") {
      sql += " AND go.overdue_detected_at IS NOT NULL";
    }
    if (filters.dateFrom) {
      sql += " AND COALESCE(go.send_at, go.created_at) >= ?";
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      sql += " AND COALESCE(go.send_at, go.created_at) <= ?";
      params.push(filters.dateTo);
    }
    if (filters.search) {
      sql += ` AND (
        go.id LIKE ? OR
        go.content_id LIKE ? OR
        go.recipient_phone LIKE ? OR
        go.recipient_email LIKE ? OR
        u.email LIKE ? OR
        u.display_name LIKE ?
      )`;
      const q = `%${filters.search}%`;
      params.push(q, q, q, q, q, q);
    }

    sql += " ORDER BY COALESCE(go.send_at, go.created_at) DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const rows = await this.db.prepare(sql).all(...params);
    return rows.map((row) => normalizeGiftOrderRow(row, { includeSensitive: false }));
  }

  async getOrderDetail(id, { includeSensitive = false } = {}) {
    const row = await this.db.prepare(
      `SELECT
        go.*,
        u.display_name AS sender_display_name,
        u.email AS sender_email,
        (SELECT COUNT(*) FROM gift_delivery_outbox gdo WHERE gdo.gift_order_id = go.id) AS outbox_count,
        (SELECT COUNT(*) FROM gift_delivery_outbox gdo WHERE gdo.gift_order_id = go.id AND gdo.status = 'sent') AS sent_count,
        (SELECT COUNT(*) FROM gift_delivery_outbox gdo WHERE gdo.gift_order_id = go.id AND gdo.status = 'failed') AS failed_count,
        (SELECT COUNT(*) FROM gift_delivery_incidents gdi WHERE gdi.gift_order_id = go.id AND gdi.status IN ('open', 'acknowledged')) AS open_incident_count
      FROM gift_orders go
      LEFT JOIN users u ON u.id = go.sender_user_id
      WHERE go.id = ?`
    ).get(id);
    if (!row) return null;

    const outboxRows = await this.db.prepare(
      "SELECT * FROM gift_delivery_outbox WHERE gift_order_id = ? ORDER BY created_at ASC"
    ).all(id);
    const incidents = await this.db.prepare(
      "SELECT * FROM gift_delivery_incidents WHERE gift_order_id = ? ORDER BY created_at DESC"
    ).all(id);
    const auditLogs = await this.db.prepare(
      `SELECT id, user_id, action, metadata_json, created_at
       FROM audit_logs
       WHERE resource_type = 'gift_order' AND resource_id = ?
       ORDER BY created_at DESC
       LIMIT 25`
    ).all(id);

    return {
      gift: normalizeGiftOrderRow(row, { includeSensitive }),
      outbox: outboxRows.map((entry) => normalizeOutboxRow(entry, { includeSensitive })),
      incidents: incidents.map((entry) => ({
        id: entry.id,
        incident_key: entry.incident_key,
        incident_type: entry.incident_type,
        severity: entry.severity,
        status: entry.status,
        summary: entry.summary,
        detail: entry.detail,
        acknowledged_at: entry.acknowledged_at,
        acknowledged_by: entry.acknowledged_by,
        resolved_at: entry.resolved_at,
        resolved_by: entry.resolved_by,
        created_at: entry.created_at,
        updated_at: entry.updated_at,
        metadata: parseJson(entry.metadata_json, {}, `gift_incident_${entry.id}`),
      })),
      audit_logs: auditLogs.map((entry) => ({
        id: entry.id,
        user_id: entry.user_id,
        action: entry.action,
        created_at: entry.created_at,
        metadata: parseJson(entry.metadata_json, {}, `gift_audit_${entry.id}`),
        note: extractAuditNote(parseJson(entry.metadata_json, {}, `gift_audit_${entry.id}`)),
      })),
    };
  }

  async listOutbox(filters = {}, options = {}) {
    const { limit, offset } = safeBounds(options.limit, options.offset);
    let sql = `
      SELECT gdo.*, go.send_at, go.status as gift_status
      FROM gift_delivery_outbox gdo
      JOIN gift_orders go ON go.id = gdo.gift_order_id
      WHERE 1=1
    `;
    const params = [];

    if (filters.status) {
      sql += " AND gdo.status = ?";
      params.push(filters.status);
    }
    if (filters.receiptStatus) {
      sql += " AND gdo.receipt_status = ?";
      params.push(filters.receiptStatus);
    }
    if (filters.provider) {
      sql += " AND gdo.provider_name = ?";
      params.push(filters.provider);
    }
    if (filters.channel) {
      sql += " AND gdo.channel = ?";
      params.push(filters.channel);
    }
    if (filters.overdue === "true") {
      sql += " AND go.overdue_detected_at IS NOT NULL";
    }
    if (filters.attemptMin !== undefined && filters.attemptMin !== null && filters.attemptMin !== "") {
      sql += " AND gdo.attempt_count >= ?";
      params.push(Number(filters.attemptMin) || 0);
    }
    if (filters.attemptMax !== undefined && filters.attemptMax !== null && filters.attemptMax !== "") {
      sql += " AND gdo.attempt_count <= ?";
      params.push(Number(filters.attemptMax) || 0);
    }

    sql += " ORDER BY COALESCE(gdo.next_retry_at, gdo.send_after) ASC, gdo.created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);
    const rows = await this.db.prepare(sql).all(...params);
    return rows.map((row) => normalizeOutboxRow(row, { includeSensitive: false }));
  }

  async getIncidentById(id) {
    const row = await this.db.prepare(
      "SELECT * FROM gift_delivery_incidents WHERE id = ?"
    ).get(id);
    if (!row) return null;
    return {
      id: row.id,
      incident_key: row.incident_key,
      incident_type: row.incident_type,
      severity: row.severity,
      status: row.status,
      gift_order_id: row.gift_order_id,
      outbox_id: row.outbox_id,
      resource_type: row.resource_type,
      resource_id: row.resource_id,
      summary: row.summary,
      detail: row.detail,
      created_at: row.created_at,
      updated_at: row.updated_at,
      acknowledged_at: row.acknowledged_at,
      acknowledged_by: row.acknowledged_by,
      resolved_at: row.resolved_at,
      resolved_by: row.resolved_by,
      metadata: parseJson(row.metadata_json, {}, `gift_incident_${row.id}`),
    };
  }

  async listIncidents(filters = {}, options = {}) {
    const { limit, offset } = safeBounds(options.limit, options.offset);
    let sql = "SELECT * FROM gift_delivery_incidents WHERE 1=1";
    const params = [];
    if (filters.status) {
      sql += " AND status = ?";
      params.push(filters.status);
    } else {
      sql += " AND status IN ('open', 'acknowledged')";
    }
    if (filters.severity) {
      sql += " AND severity = ?";
      params.push(filters.severity);
    }
    if (filters.type) {
      sql += " AND incident_type = ?";
      params.push(filters.type);
    }
    sql += " ORDER BY updated_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);
    const rows = await this.db.prepare(sql).all(...params);
    return rows.map((entry) => ({
      id: entry.id,
      incident_key: entry.incident_key,
      incident_type: entry.incident_type,
      severity: entry.severity,
      status: entry.status,
      gift_order_id: entry.gift_order_id,
      outbox_id: entry.outbox_id,
      resource_type: entry.resource_type,
      resource_id: entry.resource_id,
      summary: entry.summary,
      detail: entry.detail,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
      acknowledged_at: entry.acknowledged_at,
      resolved_at: entry.resolved_at,
      metadata: parseJson(entry.metadata_json, {}, `gift_incident_${entry.id}`),
    }));
  }
}

module.exports = { AdminGiftOpsService };
