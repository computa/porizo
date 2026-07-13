"use strict";

const { createPreparedDbFromQuery } = require("../utils/db-adapter");

function createContactDeliveryRepository(db) {
  async function transaction(callback) {
    if (typeof db.transaction !== "function") {
      throw new Error("Contact delivery mutations require transaction support");
    }
    return db.transaction(async (query) => {
      const transactionDb = createPreparedDbFromQuery(query, db);
      return callback(createContactDeliveryRepository(transactionDb));
    });
  }

  async function findEmailContactsByAddress(valueNormalized) {
    return db.prepare(
      `SELECT uc.id, uc.user_id, uc.value_normalized, uc.verified_at, uc.is_relay,
              uc.delivery_status, uc.last_delivery_event_at, uc.delivered_at,
              uc.bounced_at, uc.complained_at, uc.suppressed_at, uc.suppression_reason
         FROM user_contacts uc
         JOIN users u ON u.id = uc.user_id AND u.deleted_at IS NULL
        WHERE uc.type = 'email' AND uc.value_normalized = ?`,
    ).all(valueNormalized);
  }

  async function findEmailContact({ contactId = null, userId = null, valueNormalized = null }) {
    return db.prepare(
      `SELECT id, user_id, value_normalized, verified_at, is_relay, delivery_status,
              last_delivery_event_at, delivered_at, bounced_at, complained_at,
              suppressed_at, suppression_reason
         FROM user_contacts
        WHERE type = 'email'
          AND (? IS NULL OR id = ?)
          AND (? IS NULL OR user_id = ?)
          AND (? IS NULL OR value_normalized = ?)
        LIMIT 1`,
    ).get(contactId, contactId, userId, userId, valueNormalized, valueNormalized);
  }

  async function insertEvent({
    id,
    contactId,
    provider,
    providerEventId,
    eventType,
    deliveryStatus,
    eventAt,
    createdAt,
  }) {
    return db.prepare(
      `INSERT INTO user_contact_delivery_events (
         id, contact_id, provider, provider_event_id, event_type,
         delivery_status, event_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (contact_id, provider, provider_event_id) DO NOTHING`,
    ).run(
      id,
      contactId,
      provider,
      providerEventId,
      eventType,
      deliveryStatus,
      eventAt,
      createdAt,
    );
  }

  async function applyEvent({ contactId, deliveryStatus, eventAt, reason = null }) {
    const terminal = ["bounced", "complained", "suppressed"].includes(deliveryStatus);
    const timestampColumn = {
      deliverable: "delivered_at",
      bounced: "bounced_at",
      complained: "complained_at",
      suppressed: "suppressed_at",
    }[deliveryStatus];
    if (!timestampColumn) throw new Error("UNSUPPORTED_DELIVERY_STATUS");

    if (terminal) {
      return db.prepare(
        `UPDATE user_contacts
            SET delivery_status = ?, last_delivery_event_at = ?, ${timestampColumn} = ?,
                suppression_reason = ?
          WHERE id = ? AND (last_delivery_event_at IS NULL OR last_delivery_event_at <= ?)`,
      ).run(deliveryStatus, eventAt, eventAt, reason, contactId, eventAt);
    }

    return db.prepare(
      `UPDATE user_contacts
          SET delivery_status = ?, last_delivery_event_at = ?, ${timestampColumn} = ?
        WHERE id = ?
          AND (last_delivery_event_at IS NULL OR last_delivery_event_at <= ?)
          AND delivery_status NOT IN ('bounced', 'complained', 'suppressed')`,
    ).run(deliveryStatus, eventAt, eventAt, contactId, eventAt);
  }

  return {
    transaction,
    findEmailContactsByAddress,
    findEmailContact,
    insertEvent,
    applyEvent,
  };
}

module.exports = { createContactDeliveryRepository };
