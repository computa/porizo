"use strict";

const { dbAll, dbGet, dbRun } = require("../utils/db-adapter");

function createShareFollowupRepository(db) {
  async function scheduleFollowups(rows) {
    for (const row of rows) {
      await dbRun(
        db,
        `INSERT INTO share_followups (id, share_token_id, sender_user_id, stage, send_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (share_token_id, stage) DO NOTHING`,
        [
          row.id,
          row.shareTokenId,
          row.senderUserId,
          row.stage,
          row.sendAt,
        ],
      );
    }
  }

  async function listDueFollowups(nowIso, limit) {
    return dbAll(
      db,
      `SELECT sf.id, sf.share_token_id, sf.sender_user_id, sf.stage, sf.send_at,
              u.email AS sender_email, u.display_name AS sender_name,
              u.unsubscribed_at AS sender_unsubscribed_at,
              st.status AS share_status, st.track_id, t.recipient_name
         FROM share_followups sf
         JOIN users u ON u.id = sf.sender_user_id
         LEFT JOIN share_tokens st ON st.id = sf.share_token_id
         LEFT JOIN tracks t ON t.id = st.track_id
        WHERE sf.sent_at IS NULL
          AND sf.skip_reason IS NULL
          AND sf.send_at <= ?
        ORDER BY sf.send_at ASC
        LIMIT ?`,
      [nowIso, limit],
    );
  }

  async function getTrackTitle(trackId) {
    return dbGet(db, "SELECT title FROM tracks WHERE id = ?", [trackId]);
  }

  async function markSent(id, resendEmailId, sentAtIso) {
    return dbRun(
      db,
      "UPDATE share_followups SET sent_at = ?, resend_email_id = ? WHERE id = ?",
      [sentAtIso, resendEmailId || null, id],
    );
  }

  async function markSkipped(id, reason) {
    return dbRun(
      db,
      "UPDATE share_followups SET skip_reason = ? WHERE id = ?",
      [reason, id],
    );
  }

  return {
    scheduleFollowups,
    listDueFollowups,
    getTrackTitle,
    markSent,
    markSkipped,
  };
}

module.exports = { createShareFollowupRepository };
