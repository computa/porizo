"use strict";

const { toJson } = require("../utils/common");
const { createPreparedDbFromQuery } = require("../utils/db-adapter");

function affectedRows(result) {
  return result?.rowCount ?? result?.changes ?? 0;
}

function createGiftDeliveryPreferenceRepository(db) {
  function runner(query = null) {
    return query ? createPreparedDbFromQuery(query, db) : db;
  }

  async function findOwned({ reservationId, userId, query = null }) {
    return runner(query).prepare(
      `SELECT p.*
       FROM gift_delivery_preferences p
       JOIN gift_reservations r ON r.id = p.gift_reservation_id
       WHERE p.gift_reservation_id = ? AND r.user_id = ?`,
    ).get(reservationId, userId);
  }

  async function upsertOwned({ reservationId, userId, expectedRevision = null, preference, timestamp, query = null }) {
    const database = runner(query);
    const reservation = await database.prepare(
      "SELECT id FROM gift_reservations WHERE id = ? AND user_id = ?",
    ).get(reservationId, userId);
    if (!reservation) return null;

    const existing = await findOwned({ reservationId, userId, query });
    if (!existing) {
      if (expectedRevision !== null && expectedRevision !== 0) return null;
      await database.prepare(
        `INSERT INTO gift_delivery_preferences (
          gift_reservation_id, mode, channels_json, recipient_phone, recipient_email,
          sender_display_name, sender_timezone, send_at, message, expires_in_days,
          revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      ).run(
        reservationId, preference.mode, toJson(preference.channels || []),
        preference.recipientPhone || null, preference.recipientEmail || null,
        preference.senderDisplayName || null, preference.senderTimezone || null,
        preference.sendAt || null, preference.message || null,
        preference.expiresInDays || 30, timestamp, timestamp,
      );
      return findOwned({ reservationId, userId, query });
    }

    if (expectedRevision !== null && Number(existing.revision) !== Number(expectedRevision)) return null;
    const result = await database.prepare(
      `UPDATE gift_delivery_preferences SET
        mode = ?, channels_json = ?, recipient_phone = ?, recipient_email = ?,
        sender_display_name = ?, sender_timezone = ?, send_at = ?, message = ?,
        expires_in_days = ?, revision = revision + 1, updated_at = ?
       WHERE gift_reservation_id = ? AND revision = ?`,
    ).run(
      preference.mode, toJson(preference.channels || []),
      preference.recipientPhone || null, preference.recipientEmail || null,
      preference.senderDisplayName || null, preference.senderTimezone || null,
      preference.sendAt || null, preference.message || null,
      preference.expiresInDays || 30, timestamp, reservationId, existing.revision,
    );
    if (!affectedRows(result)) return null;
    return findOwned({ reservationId, userId, query });
  }

  return { findOwned, upsertOwned };
}

module.exports = { createGiftDeliveryPreferenceRepository };
