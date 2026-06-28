"use strict";

function rowCountFrom(result) {
  return Number(result?.changes ?? result?.rowCount ?? 0);
}

function rowsFrom(result) {
  return Array.isArray(result?.rows) ? result.rows : result || [];
}

function createAdminTrackTransferRepository(db) {
  async function findTransferTrack(trackId) {
    return db
      .prepare(
        "SELECT id, user_id, title FROM tracks WHERE id = ? AND deleted_at IS NULL",
      )
      .get(trackId);
  }

  async function findTransferTargetUser(userId) {
    return db
      .prepare("SELECT id, email, display_name, deleted_at FROM users WHERE id = ?")
      .get(userId);
  }

  async function findActiveTrackJob(trackId) {
    return db
      .prepare(
        "SELECT id FROM jobs WHERE track_version_id IN (SELECT id FROM track_versions WHERE track_id = ?) AND status IN ('queued', 'processing', 'running')",
      )
      .get(trackId);
  }

  async function transferTrackOwnership({
    trackId,
    sourceUserId,
    targetUserId,
    adminId,
    adminEmail,
    transferId,
    now,
  }) {
    return db.transaction(async (query) => {
      const activeJobResult = await query(
        "SELECT id FROM jobs WHERE track_version_id IN (SELECT id FROM track_versions WHERE track_id = ?) AND status IN ('queued', 'processing', 'running') LIMIT 1",
        [trackId],
      );
      if (rowsFrom(activeJobResult)[0]) {
        throw new Error("ACTIVE_JOB");
      }

      const trackResult = await query(
        "UPDATE tracks SET user_id = ?, updated_at = ? WHERE id = ? AND user_id = ?",
        [targetUserId, now, trackId, sourceUserId],
      );
      if (rowCountFrom(trackResult) === 0) {
        throw new Error("CONCURRENT_TRANSFER");
      }

      await query("DELETE FROM track_library_entries WHERE track_id = ? AND user_id = ?", [
        trackId,
        sourceUserId,
      ]);
      await query(
        "UPDATE track_library_entries SET removed_at = COALESCE(removed_at, ?), updated_at = ? WHERE track_id = ? AND origin = 'received' AND removed_at IS NULL",
        [now, now, trackId],
      );
      await query(
        "INSERT INTO track_library_entries (user_id, track_id, origin, added_at, updated_at) VALUES (?, ?, 'created', ?, ?) ON CONFLICT (user_id, track_id) DO UPDATE SET origin = 'created', removed_at = NULL, updated_at = ?",
        [targetUserId, trackId, now, now, now],
      );

      await query(
        "UPDATE share_tokens SET creator_id = ?, status = 'unbound', bound_device_id = NULL, bound_device_platform = NULL, bound_app_version = NULL, bound_user_id = NULL, bound_at = NULL, claim_attempts = 0 WHERE track_id = ?",
        [targetUserId, trackId],
      );

      await query(
        "INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          transferId,
          adminId,
          "track_transferred",
          "track",
          trackId,
          JSON.stringify({
            actor: "admin",
            admin_id: adminId,
            admin_email: adminEmail,
            from_user: sourceUserId,
            to_user: targetUserId,
          }),
          now,
        ],
      );
    });
  }

  async function getTransferVerification({ trackId, sourceUserId, targetUserId }) {
    const trackResult = await db
      .prepare("SELECT user_id FROM tracks WHERE id = ?")
      .get(trackId);
    const libraryEntry = await db
      .prepare(
        "SELECT user_id, origin FROM track_library_entries WHERE track_id = ? AND user_id = ?",
      )
      .get(trackId, targetUserId);
    const sourceLibraryCount = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM track_library_entries WHERE track_id = ? AND user_id = ?",
      )
      .get(trackId, sourceUserId);
    const activeReceivedCount = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM track_library_entries WHERE track_id = ? AND origin = 'received' AND removed_at IS NULL",
      )
      .get(trackId);
    const shareTokenRows = await db
      .prepare(
        `SELECT creator_id, status, bound_device_id, bound_device_platform,
                bound_app_version, bound_user_id, bound_at
         FROM share_tokens
         WHERE track_id = ?
         ORDER BY created_at DESC, id DESC`,
      )
      .all(trackId);
    const shareToken = rowsFrom(shareTokenRows)[0];

    return {
      track_owner: trackResult?.user_id,
      library_owner: libraryEntry?.user_id,
      library_origin: libraryEntry?.origin,
      source_library_entries: Number(sourceLibraryCount?.count || 0),
      active_received_entries: Number(activeReceivedCount?.count || 0),
      share_creator: shareToken?.creator_id ?? null,
      share_status: shareToken?.status ?? null,
      share_bound_device_id: shareToken?.bound_device_id ?? null,
      share_bound_device_platform: shareToken?.bound_device_platform ?? null,
      share_bound_app_version: shareToken?.bound_app_version ?? null,
      share_bound_user_id: shareToken?.bound_user_id ?? null,
      share_bound_at: shareToken?.bound_at ?? null,
    };
  }

  return {
    findTransferTrack,
    findTransferTargetUser,
    findActiveTrackJob,
    transferTrackOwnership,
    getTransferVerification,
  };
}

module.exports = {
  createAdminTrackTransferRepository,
};
