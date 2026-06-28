"use strict";

const { dbGet, dbQuery } = require("../utils/db-adapter");

function createGiftDeliveryIncidentRepository(db) {
  async function getByKey(incidentKey) {
    return dbGet(db, "SELECT * FROM gift_delivery_incidents WHERE incident_key = ?", [
      incidentKey,
    ]);
  }

  async function getById(id) {
    return dbGet(db, "SELECT * FROM gift_delivery_incidents WHERE id = ?", [id]);
  }

  async function updateExistingByKey({
    incidentKey,
    severity,
    summary,
    detail,
    metadataJson,
    timestamp,
    nextStatus,
    giftOrderId,
    outboxId,
    resourceType,
    resourceId,
  }) {
    return dbQuery(
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
        metadataJson,
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
      ],
    );
  }

  async function insert({
    id,
    incidentKey,
    incidentType,
    severity,
    status,
    giftOrderId,
    outboxId,
    resourceType,
    resourceId,
    summary,
    detail,
    metadataJson,
    timestamp,
  }) {
    return dbQuery(
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
        status,
        giftOrderId,
        outboxId,
        resourceType,
        resourceId,
        summary,
        detail,
        metadataJson,
        timestamp,
        timestamp,
      ],
    );
  }

  async function acknowledgeByKey({ incidentKey, adminId, timestamp }) {
    return dbQuery(
      db,
      `UPDATE gift_delivery_incidents
       SET status = 'acknowledged', acknowledged_at = ?, acknowledged_by = ?, updated_at = ?
       WHERE incident_key = ? AND status = 'open'`,
      [timestamp, adminId, timestamp, incidentKey],
    );
  }

  async function resolveByKey({ incidentKey, resolverId = null, timestamp }) {
    return dbQuery(
      db,
      `UPDATE gift_delivery_incidents
       SET status = 'resolved', resolved_at = ?, resolved_by = ?, updated_at = ?
       WHERE incident_key = ? AND status != 'resolved'`,
      [timestamp, resolverId, timestamp, incidentKey],
    );
  }

  async function resolveForGift({ giftOrderId, incidentTypes = [], timestamp }) {
    const params = [timestamp, timestamp, giftOrderId];
    let sql = `UPDATE gift_delivery_incidents
               SET status = 'resolved', resolved_at = ?, updated_at = ?
               WHERE gift_order_id = ? AND status != 'resolved'`;
    if (incidentTypes.length) {
      sql += ` AND incident_type IN (${incidentTypes.map(() => "?").join(", ")})`;
      params.push(...incidentTypes);
    }
    return dbQuery(db, sql, params);
  }

  return {
    getByKey,
    getById,
    updateExistingByKey,
    insert,
    acknowledgeByKey,
    resolveByKey,
    resolveForGift,
  };
}

module.exports = {
  createGiftDeliveryIncidentRepository,
};
