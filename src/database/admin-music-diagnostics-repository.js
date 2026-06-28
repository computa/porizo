"use strict";

function createAdminMusicDiagnosticsRepository(db) {
  return {
    listRecentTrackVersions(limit) {
      return db
        .prepare(
          `SELECT
             tv.id,
             tv.track_id,
             tv.version_num,
             tv.status,
             tv.created_at,
             tv.completed_at,
             tv.music_plan_json,
             tv.provenance_json,
             t.user_id,
             t.title,
             t.style,
             t.voice_mode
           FROM track_versions tv
           JOIN tracks t ON t.id = tv.track_id
           ORDER BY COALESCE(tv.completed_at, tv.created_at) DESC,
                    tv.created_at DESC,
                    tv.id DESC
           LIMIT ?`,
        )
        .all(limit);
    },

    listLatestJobsForTrackVersions(trackVersionIds) {
      if (!Array.isArray(trackVersionIds) || trackVersionIds.length === 0) {
        return [];
      }
      const placeholders = trackVersionIds.map(() => "?").join(", ");
      return db
        .prepare(
          `SELECT track_version_id, error_code, error_message, updated_at
           FROM jobs
           WHERE track_version_id IN (${placeholders})
           ORDER BY track_version_id ASC,
                    COALESCE(completed_at, updated_at) DESC,
                    updated_at DESC,
                    id DESC`,
        )
        .all(...trackVersionIds);
    },
  };
}

module.exports = {
  createAdminMusicDiagnosticsRepository,
};
