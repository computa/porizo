"use strict";

const EXPORT_SECTIONS = {
  profile: "SELECT * FROM users WHERE id = ?",
  contacts: "SELECT * FROM user_contacts WHERE user_id = ?",
  auth_providers:
    "SELECT id, provider, provider_user_id, created_at FROM user_auth_providers WHERE user_id = ?",
  entitlements: "SELECT * FROM entitlements WHERE user_id = ?",
  subscriptions: "SELECT * FROM subscriptions WHERE user_id = ?",
  purchases: "SELECT * FROM purchase_receipts WHERE user_id = ?",
  credit_transactions: "SELECT * FROM credit_transactions WHERE user_id = ?",
  tracks: "SELECT * FROM tracks WHERE user_id = ?",
  poems: "SELECT * FROM poems WHERE user_id = ?",
  voice_profiles: "SELECT * FROM voice_profiles WHERE user_id = ?",
  enrollment_sessions: "SELECT * FROM enrollment_sessions WHERE user_id = ?",
  story_sessions: "SELECT * FROM story_sessions WHERE user_id = ?",
  etsy_orders:
    `SELECT id, shop_id, receipt_id, currency, amount_minor, provider_status,
            state, paid_at, claimed_at, fulfilled_at, canceled_at, created_at,
            updated_at
       FROM etsy_orders WHERE owner_user_id = ?`,
  etsy_order_units:
    `SELECT id, etsy_order_id, transaction_id, listing_id, ordinal, state,
            gift_reservation_id, web_order_id, gift_order_id, track_id,
            track_version_id, claimed_at, delivered_at, refunded_at, created_at,
            updated_at
       FROM etsy_order_units WHERE owner_user_id = ?`,
};

function createGdprDataExportRepository(db) {
  async function findActiveUser(userId) {
    return db
      .prepare("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL")
      .get(userId);
  }

  async function listUserExportSections(userId) {
    const data = {};

    for (const [name, sql] of Object.entries(EXPORT_SECTIONS)) {
      try {
        const stmt = await db.prepare(sql);
        data[name] = await stmt.all(userId);
      } catch (err) {
        data[name] = { error: `unavailable: ${err.message}` };
      }
    }

    return data;
  }

  return {
    findActiveUser,
    listUserExportSections,
  };
}

module.exports = {
  EXPORT_SECTIONS,
  createGdprDataExportRepository,
};
