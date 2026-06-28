"use strict";

function appendOrderFilters(sql, params, filters = {}) {
  let nextSql = sql;

  if (filters.status) {
    nextSql += " AND go.status = ?";
    params.push(filters.status);
  }
  if (filters.dispatchStatus) {
    nextSql += " AND go.dispatch_status = ?";
    params.push(filters.dispatchStatus);
  }
  if (filters.deliveryMode) {
    nextSql += " AND go.delivery_mode = ?";
    params.push(filters.deliveryMode);
  }
  if (filters.channel) {
    nextSql += " AND go.channels_json LIKE ?";
    params.push(`%${filters.channel}%`);
  }
  if (filters.senderUserId) {
    nextSql += " AND go.sender_user_id = ?";
    params.push(filters.senderUserId);
  }
  if (filters.creator) {
    nextSql += " AND (u.display_name LIKE ? OR u.email LIKE ?)";
    const q = `%${filters.creator}%`;
    params.push(q, q);
  }
  if (filters.recipient) {
    nextSql += " AND (go.recipient_phone LIKE ? OR go.recipient_email LIKE ?)";
    const q = `%${filters.recipient}%`;
    params.push(q, q);
  }
  if (filters.overdue === "true") {
    nextSql += " AND go.overdue_detected_at IS NOT NULL";
  }
  if (filters.dateFrom) {
    nextSql += " AND COALESCE(go.send_at, go.created_at) >= ?";
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    nextSql += " AND COALESCE(go.send_at, go.created_at) <= ?";
    params.push(filters.dateTo);
  }
  if (filters.search) {
    nextSql += ` AND (
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

  return nextSql;
}

function appendOutboxFilters(sql, params, filters = {}) {
  let nextSql = sql;

  if (filters.status) {
    nextSql += " AND gdo.status = ?";
    params.push(filters.status);
  }
  if (filters.receiptStatus) {
    nextSql += " AND gdo.receipt_status = ?";
    params.push(filters.receiptStatus);
  }
  if (filters.provider) {
    nextSql += " AND gdo.provider_name = ?";
    params.push(filters.provider);
  }
  if (filters.channel) {
    nextSql += " AND gdo.channel = ?";
    params.push(filters.channel);
  }
  if (filters.overdue === "true") {
    nextSql += " AND go.overdue_detected_at IS NOT NULL";
  }
  if (filters.attemptMin !== undefined && filters.attemptMin !== null && filters.attemptMin !== "") {
    nextSql += " AND gdo.attempt_count >= ?";
    params.push(Number(filters.attemptMin) || 0);
  }
  if (filters.attemptMax !== undefined && filters.attemptMax !== null && filters.attemptMax !== "") {
    nextSql += " AND gdo.attempt_count <= ?";
    params.push(Number(filters.attemptMax) || 0);
  }

  return nextSql;
}

function appendIncidentFilters(sql, params, filters = {}) {
  let nextSql = sql;
  if (filters.status) {
    nextSql += " AND status = ?";
    params.push(filters.status);
  } else {
    nextSql += " AND status IN ('open', 'acknowledged')";
  }
  if (filters.severity) {
    nextSql += " AND severity = ?";
    params.push(filters.severity);
  }
  if (filters.type) {
    nextSql += " AND incident_type = ?";
    params.push(filters.type);
  }
  return nextSql;
}

function createAdminGiftOpsRepository(db) {
  async function getOverviewCounts({ now, dueSoon, dayAgo }) {
    const counts = await db.prepare(
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
       FROM gift_orders`,
    ).get(now, dueSoon, dayAgo);

    const incidents = await db.prepare(
      `SELECT
         SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
         SUM(CASE WHEN status = 'acknowledged' THEN 1 ELSE 0 END) as acknowledged_count
       FROM gift_delivery_incidents
       WHERE status IN ('open', 'acknowledged')`,
    ).get();

    return { counts, incidents };
  }

  async function listOrders(filters = {}, { limit, offset }) {
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

    sql = appendOrderFilters(sql, params, filters);
    sql += " ORDER BY COALESCE(go.send_at, go.created_at) DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    return db.prepare(sql).all(...params);
  }

  async function getOrderById(id) {
    return db.prepare(
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
      WHERE go.id = ?`,
    ).get(id);
  }

  async function listOrderOutbox(giftOrderId) {
    return db.prepare(
      "SELECT * FROM gift_delivery_outbox WHERE gift_order_id = ? ORDER BY created_at ASC",
    ).all(giftOrderId);
  }

  async function listOrderIncidents(giftOrderId) {
    return db.prepare(
      "SELECT * FROM gift_delivery_incidents WHERE gift_order_id = ? ORDER BY created_at DESC",
    ).all(giftOrderId);
  }

  async function listOrderAuditLogs(giftOrderId) {
    return db.prepare(
      `SELECT id, user_id, action, metadata_json, created_at
       FROM audit_logs
       WHERE resource_type = 'gift_order' AND resource_id = ?
       ORDER BY created_at DESC
       LIMIT 25`,
    ).all(giftOrderId);
  }

  async function listOutbox(filters = {}, { limit, offset }) {
    let sql = `
      SELECT gdo.*, go.send_at, go.status as gift_status
      FROM gift_delivery_outbox gdo
      JOIN gift_orders go ON go.id = gdo.gift_order_id
      WHERE 1=1
    `;
    const params = [];

    sql = appendOutboxFilters(sql, params, filters);
    sql += " ORDER BY COALESCE(gdo.next_retry_at, gdo.send_after) ASC, gdo.created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    return db.prepare(sql).all(...params);
  }

  async function getIncidentById(id) {
    return db.prepare(
      "SELECT * FROM gift_delivery_incidents WHERE id = ?",
    ).get(id);
  }

  async function listIncidents(filters = {}, { limit, offset }) {
    const params = [];
    let sql = "SELECT * FROM gift_delivery_incidents WHERE 1=1";
    sql = appendIncidentFilters(sql, params, filters);
    sql += " ORDER BY updated_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);
    return db.prepare(sql).all(...params);
  }

  return {
    getOverviewCounts,
    listOrders,
    getOrderById,
    listOrderOutbox,
    listOrderIncidents,
    listOrderAuditLogs,
    listOutbox,
    getIncidentById,
    listIncidents,
  };
}

module.exports = { createAdminGiftOpsRepository };
