"use strict";

const { createPreparedDbFromQuery } = require("../utils/db-adapter");

function createWebFunnelRepository(db) {
  async function transaction(callback) {
    if (typeof db.transaction !== "function") {
      throw new Error("Web funnel mutations require database transaction support");
    }
    return db.transaction(async (query) => {
      const transactionDb = createPreparedDbFromQuery(query, db);
      return callback(createWebFunnelRepository(transactionDb), transactionDb);
    });
  }

  async function findGuestDeviceForUpdate(deviceTokenHash) {
    const lockingClause = db.isPostgres ? " FOR UPDATE" : "";
    return db
      .prepare(
        `SELECT wgd.user_id, wgd.session_id, wgd.funnel_enabled_at_entry,
                wgd.expires_at, u.account_status, u.deleted_at
         FROM web_guest_devices wgd
         JOIN users u ON u.id = wgd.user_id
         WHERE wgd.device_token_hash = ?
         ${lockingClause}`,
      )
      .get(deviceTokenHash);
  }

  async function insertGuestUser({ userId, createdAt }) {
    return db
      .prepare(
        `INSERT INTO users (id, created_at, risk_level, account_status)
         VALUES (?, ?, 'low', 'guest')`,
      )
      .run(userId, createdAt);
  }

  async function ensureZeroEntitlements({ userId, resetAt, updatedAt }) {
    return db
      .prepare(
        `INSERT INTO entitlements (
           user_id, tier, songs_remaining, poems_remaining,
           preview_count_today, preview_count_reset_at, updated_at
         ) VALUES (?, 'free', 0, 0, 0, ?, ?)
         ON CONFLICT (user_id) DO NOTHING`,
      )
      .run(userId, resetAt, updatedAt);
  }

  async function upsertGuestDevice({
    deviceTokenHash,
    userId,
    sessionId,
    funnelEnabledAtEntry,
    entryUrl,
    createdAt,
    lastActiveAt,
    expiresAt,
  }) {
    const storedFunnelEnabled = db.isPostgres
      ? Boolean(funnelEnabledAtEntry)
      : funnelEnabledAtEntry
        ? 1
        : 0;
    return db
      .prepare(
        `INSERT INTO web_guest_devices (
           device_token_hash, user_id, session_id, funnel_enabled_at_entry,
           entry_url, created_at, last_active_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (device_token_hash) DO UPDATE SET
           user_id = excluded.user_id,
           session_id = excluded.session_id,
           funnel_enabled_at_entry = excluded.funnel_enabled_at_entry,
           entry_url = excluded.entry_url,
           last_active_at = excluded.last_active_at,
           expires_at = excluded.expires_at`,
      )
      .run(
        deviceTokenHash,
        userId,
        sessionId,
        storedFunnelEnabled,
        entryUrl,
        createdAt,
        lastActiveAt,
        expiresAt,
      );
  }

  async function findGuestAccess(userId) {
    return db
      .prepare(
        `SELECT u.account_status, wgd.funnel_enabled_at_entry
         FROM users u
         LEFT JOIN web_guest_devices wgd ON wgd.user_id = u.id
         WHERE u.id = ? AND u.deleted_at IS NULL`,
      )
      .get(userId);
  }

  return {
    transaction,
    findGuestDeviceForUpdate,
    insertGuestUser,
    ensureZeroEntitlements,
    upsertGuestDevice,
    findGuestAccess,
  };
}

module.exports = { createWebFunnelRepository };
