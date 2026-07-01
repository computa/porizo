"use strict";

function createTrackLibraryRepository(db) {
  async function upsertTrackLibraryEntry({
    userId,
    trackId,
    origin,
    shareTokenId = null,
    addedAt = new Date().toISOString(),
  }) {
    const now = new Date().toISOString();
    const updateResult = await db
      .prepare(
        `UPDATE track_library_entries
       SET origin = CASE WHEN origin = 'created' THEN origin ELSE ? END,
           share_token_id = COALESCE(?, share_token_id),
           added_at = CASE WHEN removed_at IS NOT NULL THEN ? ELSE added_at END,
           removed_at = NULL, updated_at = ?
       WHERE user_id = ? AND track_id = ?`,
      )
      .run(origin, shareTokenId, addedAt, now, userId, trackId);

    if (updateResult.changes > 0) {
      return;
    }

    await db
      .prepare(
        `INSERT INTO track_library_entries
       (user_id, track_id, origin, share_token_id, added_at, removed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(userId, trackId, origin, shareTokenId, addedAt, now);
  }

  async function listTracksForUser({ userId, limit, offset }) {
    return db
      .prepare(
        `SELECT t.*,
                tle.origin AS library_origin,
                tle.added_at AS library_added_at,
                tle.share_token_id AS library_share_token_id,
                CASE WHEN t.user_id = ? THEN 1 ELSE 0 END AS can_edit,
                CASE WHEN t.user_id = ? THEN 1 ELSE 0 END AS can_share,
                1 AS can_delete
         FROM tracks t
         JOIN track_library_entries tle
           ON tle.track_id = t.id
          AND tle.user_id = ?
          AND tle.removed_at IS NULL
         WHERE t.deleted_at IS NULL
           AND NOT (COALESCE(t.funding_source, 'standard') IN ('gift_wallet', 'gift_token') AND tle.origin = 'created')
         ORDER BY tle.added_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(userId, userId, userId, limit, offset);
  }

  async function getTrackForLibrary({ userId, trackId }) {
    return db
      .prepare(
        `SELECT t.*,
              tle.origin AS library_origin,
              tle.added_at AS library_added_at,
              tle.share_token_id AS library_share_token_id,
              st.claim_pin AS share_claim_pin,
              st.expires_at AS share_expires_at,
              st.status AS share_status,
              CASE WHEN t.user_id = ? THEN 1 ELSE 0 END AS can_edit,
              CASE WHEN t.user_id = ? THEN 1 ELSE 0 END AS can_share,
              1 AS can_delete
       FROM tracks t
       JOIN track_library_entries tle
         ON tle.track_id = t.id
        AND tle.user_id = ?
        AND tle.removed_at IS NULL
       LEFT JOIN share_tokens st
         ON st.id = t.share_token_id
        AND st.status NOT IN ('revoked', 'expired')
       WHERE t.id = ?
         AND t.deleted_at IS NULL
         AND NOT (COALESCE(t.funding_source, 'standard') IN ('gift_wallet', 'gift_token') AND tle.origin = 'created')`,
      )
      .get(userId, userId, userId, trackId);
  }

  async function getOwnedGiftTrackForLibrary({ userId, trackId }) {
    return db
      .prepare(
        `SELECT t.*,
              NULL AS library_origin,
              NULL AS library_added_at,
              NULL AS library_share_token_id,
              st.claim_pin AS share_claim_pin,
              st.expires_at AS share_expires_at,
              st.status AS share_status,
              1 AS can_edit,
              1 AS can_share,
              1 AS can_delete
       FROM tracks t
       LEFT JOIN share_tokens st
         ON st.id = t.share_token_id
        AND st.status NOT IN ('revoked', 'expired')
       WHERE t.id = ?
         AND t.user_id = ?
         AND t.deleted_at IS NULL
         AND COALESCE(t.funding_source, 'standard') IN ('gift_wallet', 'gift_token')`,
      )
      .get(trackId, userId);
  }

  async function removeTrackFromLibrary({
    userId,
    trackId,
    removedAt,
  }) {
    await db
      .prepare(
        "UPDATE track_library_entries SET removed_at = ?, updated_at = ? WHERE user_id = ? AND track_id = ? AND removed_at IS NULL",
      )
      .run(removedAt, removedAt, userId, trackId);
  }

  return {
    upsertTrackLibraryEntry,
    listTracksForUser,
    getTrackForLibrary,
    getOwnedGiftTrackForLibrary,
    removeTrackFromLibrary,
  };
}

module.exports = { createTrackLibraryRepository };
