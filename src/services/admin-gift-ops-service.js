"use strict";

const { createAdminGiftOpsRepository } = require("../database/admin-gift-ops-repository");
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
  constructor(db, options = {}) {
    this.repository = options.repository || createAdminGiftOpsRepository(db);
  }

  async getOverview() {
    const now = new Date().toISOString();
    const dueSoon = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { counts, incidents } = await this.repository.getOverviewCounts({
      now,
      dueSoon,
      dayAgo,
    });

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
    const rows = await this.repository.listOrders(filters, { limit, offset });
    return rows.map((row) => normalizeGiftOrderRow(row, { includeSensitive: false }));
  }

  async getOrderDetail(id, { includeSensitive = false } = {}) {
    const row = await this.repository.getOrderById(id);
    if (!row) return null;

    const outboxRows = await this.repository.listOrderOutbox(id);
    const incidents = await this.repository.listOrderIncidents(id);
    const auditLogs = await this.repository.listOrderAuditLogs(id);

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
    const rows = await this.repository.listOutbox(filters, { limit, offset });
    return rows.map((row) => normalizeOutboxRow(row, { includeSensitive: false }));
  }

  async getIncidentById(id) {
    const row = await this.repository.getIncidentById(id);
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
    const rows = await this.repository.listIncidents(filters, { limit, offset });
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
