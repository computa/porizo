"use strict";

const { nowIso } = require("../utils/common");

/**
 * Atomically merge a guest user's content into an existing (verified) account.
 *
 * This is the whole-user variant of the 9-table song-transfer checklist: a
 * web-funnel guest owns only the tracks it created during the funnel, so we
 * move ALL of the guest's rows to the target user in one transaction rather
 * than one track at a time. Partial merges are what broke the "Song for
 * Latifat" transfer three times — this must be atomic or not happen at all.
 *
 * Tables moved:
 *   1. tracks.user_id
 *   2. track_library_entries — move `created` rows, dedupe against any the
 *      target already has for the same track (PK is (user_id, track_id))
 *   3. share_tokens.creator_id
 *   4. share_tokens.bound_user_id — NULL any that pointed at the guest
 *   5. audit_logs.user_id
 *   6. gift_wallet balance — add guest balance to target, zero the guest
 *   7. gift_reservations.user_id + gift_orders.sender_user_id
 *   8. web_orders.user_id
 *   9. jobs — no user_id column, references track_version_id (no change)
 *  10. billing_holds — retired in both engines (pg 095, sqlite 123); no-op
 * Then the guest user row is soft-deleted (deleted_at set) so it disappears
 * from every `deleted_at IS NULL` query without breaking FK references.
 *
 * The caller passes a transaction `query` function so this composes inside the
 * larger paid-transition transaction (identity convergence). It never opens its
 * own transaction.
 *
 * @param {Function} query - transactional (sql, params) => result
 * @param {Object} args
 * @param {string} args.guestUserId
 * @param {string} args.targetUserId
 */
async function mergeGuestIntoUser(query, { guestUserId, targetUserId }) {
  if (!guestUserId || !targetUserId) {
    throw new Error("mergeGuestIntoUser requires guestUserId and targetUserId");
  }
  if (guestUserId === targetUserId) {
    return { merged: false, reason: "same_user" };
  }
  const now = nowIso();

  // 1. tracks.user_id
  await query("UPDATE tracks SET user_id = ? WHERE user_id = ?", [
    targetUserId,
    guestUserId,
  ]);

  // 2. track_library_entries: move `created` rows, skipping any track the
  //    target already has an entry for (PK collision). Delete the guest's
  //    leftover rows afterward so no orphan remains.
  await query(
    `UPDATE track_library_entries
       SET user_id = ?, updated_at = ?
     WHERE user_id = ? AND origin = 'created'
       AND track_id NOT IN (
         SELECT track_id FROM track_library_entries WHERE user_id = ?
       )`,
    [targetUserId, now, guestUserId, targetUserId],
  );
  await query("DELETE FROM track_library_entries WHERE user_id = ?", [
    guestUserId,
  ]);

  // 3 + 4. share_tokens creator + bound_user_id
  await query("UPDATE share_tokens SET creator_id = ? WHERE creator_id = ?", [
    targetUserId,
    guestUserId,
  ]);
  await query(
    "UPDATE share_tokens SET bound_user_id = NULL WHERE bound_user_id = ?",
    [guestUserId],
  );

  // 5. audit_logs.user_id
  await query("UPDATE audit_logs SET user_id = ? WHERE user_id = ?", [
    targetUserId,
    guestUserId,
  ]);

  // 6. gift_wallet balance move. Ensure both rows exist, add the guest balance
  //    to the target, then zero the guest.
  await query(
    `INSERT INTO gift_wallet (user_id, balance, updated_at)
       VALUES (?, 0, ?) ON CONFLICT(user_id) DO NOTHING`,
    [targetUserId, now],
  );
  await query(
    `UPDATE gift_wallet
       SET balance = balance + (
             SELECT balance FROM gift_wallet WHERE user_id = ?
           ),
           updated_at = ?
     WHERE user_id = ?`,
    [guestUserId, now, targetUserId],
  );
  // Re-point the guest's wallet ledger to the target for a complete audit trail.
  await query(
    "UPDATE gift_wallet_transactions SET user_id = ? WHERE user_id = ?",
    [targetUserId, guestUserId],
  );
  await query(
    "UPDATE gift_wallet SET balance = 0, updated_at = ? WHERE user_id = ?",
    [now, guestUserId],
  );

  // 7. Move the complete gift graph. Delivery preferences and outbox rows are
  // keyed through reservation/order, so their ownership follows these roots.
  await query(
    "UPDATE gift_reservations SET user_id = ?, updated_at = ? WHERE user_id = ?",
    [targetUserId, now, guestUserId],
  );
  await query(
    "UPDATE gift_orders SET sender_user_id = ?, updated_at = ? WHERE sender_user_id = ?",
    [targetUserId, now, guestUserId],
  );

  // 8. web_orders.user_id
  await query(
    "UPDATE web_orders SET user_id = ?, updated_at = ? WHERE user_id = ?",
    [targetUserId, now, guestUserId],
  );

  // billing_holds was retired in both engines (pg migration 095, sqlite 123);
  // no runtime code reads it, so there is nothing to move there.

  // Soft-delete the guest user. Keeping the row satisfies FK references while
  // removing it from all active-user queries.
  await query(
    "UPDATE users SET deleted_at = ?, account_status = 'active' WHERE id = ?",
    [now, guestUserId],
  );

  return { merged: true, guestUserId, targetUserId };
}

module.exports = { mergeGuestIntoUser };
