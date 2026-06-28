"use strict";

function rowCountFrom(result) {
  return Number(result?.changes ?? result?.rowCount ?? 0);
}

function createAdminModerationRepository(db) {
  async function listBlockedVersions({ limit, offset }) {
    return db
      .prepare(
        `
      SELECT
        tv.id,
        tv.track_id,
        tv.moderation_status,
        tv.moderation_reason,
        tv.moderation_details_json,
        t.title,
        t.occasion,
        t.recipient_name,
        t.user_id,
        tv.created_at
      FROM track_versions tv
      JOIN tracks t ON tv.track_id = t.id
      WHERE tv.moderation_status = 'blocked'
      ORDER BY tv.created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(limit, offset);
  }

  async function approveBlockedVersion({ versionId, reason }) {
    const result = db
      .prepare(
        `UPDATE track_versions
         SET moderation_status = 'approved',
             moderation_reason = ?
         WHERE id = ?
           AND moderation_status = 'blocked'`,
      )
      .run(`Admin override: ${reason}`, versionId);

    if (rowCountFrom(result) > 0) {
      return { status: "approved" };
    }

    const current = db
      .prepare("SELECT moderation_status FROM track_versions WHERE id = ?")
      .get(versionId);

    if (!current) {
      return { status: "not_found" };
    }

    return {
      status: "not_blocked",
      moderationStatus: current.moderation_status || null,
    };
  }

  return {
    listBlockedVersions,
    approveBlockedVersion,
  };
}

module.exports = { createAdminModerationRepository };
