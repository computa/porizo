"use strict";

function createAdminDemoShareRepository(db) {
  return {
    getShareableTrack(trackId) {
      return db
        .prepare("SELECT * FROM tracks WHERE id = ? AND deleted_at IS NULL")
        .get(trackId);
    },

    getLatestTrackVersion(trackId) {
      return db
        .prepare(
          "SELECT id FROM track_versions WHERE track_id = ? ORDER BY version_num DESC LIMIT 1",
        )
        .get(trackId);
    },

    getSongDemoShareByTrack(trackId) {
      return db
        .prepare(
          `
            SELECT *
            FROM share_tokens
            WHERE track_id = ? AND share_type = 'demo'
            ORDER BY created_at DESC, id DESC
            LIMIT 1
          `,
        )
        .get(trackId);
    },

    convertSongShareToDemo({ shareId, expiresAt }) {
      return db
        .prepare(
          `
            UPDATE share_tokens
            SET share_type = 'demo',
                claim_pin = NULL,
                expires_at = ?,
                status = 'unbound',
                web_stream_allowed = 1,
                bound_device_id = NULL,
                bound_device_platform = NULL,
                bound_app_version = NULL,
                bound_at = NULL,
                bound_user_id = NULL
            WHERE id = ?
          `,
        )
        .run(expiresAt, shareId);
    },

    createSongDemoShare({
      shareId,
      trackId,
      trackVersionId,
      creatorId,
      expiresAt,
      now,
    }) {
      return db
        .prepare(
          `
            INSERT INTO share_tokens (
              id,
              track_id,
              track_version_id,
              creator_id,
              status,
              share_type,
              claim_pin,
              expires_at,
              web_stream_allowed,
              created_at
            )
            VALUES (?, ?, ?, ?, 'unbound', 'demo', NULL, ?, 1, ?)
          `,
        )
        .run(shareId, trackId, trackVersionId, creatorId, expiresAt, now);
    },

    linkTrackShareToken({ trackId, shareId }) {
      return db
        .prepare("UPDATE tracks SET share_token_id = ? WHERE id = ?")
        .run(shareId, trackId);
    },

    getShareablePoem(poemId) {
      return db
        .prepare("SELECT * FROM poems WHERE id = ? AND deleted_at IS NULL")
        .get(poemId);
    },

    getPoemDemoShareByPoem(poemId) {
      return db
        .prepare(
          `
            SELECT *
            FROM poem_share_tokens
            WHERE poem_id = ? AND share_type = 'demo'
            ORDER BY created_at DESC, id DESC
            LIMIT 1
          `,
        )
        .get(poemId);
    },

    convertPoemShareToDemo({ shareId, expiresAt }) {
      return db
        .prepare(
          `
            UPDATE poem_share_tokens
            SET share_type = 'demo',
                claim_pin = NULL,
                expires_at = ?,
                status = 'active',
                bound_user_id = NULL,
                claim_attempts = 0
            WHERE id = ?
          `,
        )
        .run(expiresAt, shareId);
    },

    createPoemDemoShare({ shareId, poemId, creatorId, expiresAt, now }) {
      return db
        .prepare(
          `
            INSERT INTO poem_share_tokens (
              id,
              poem_id,
              creator_id,
              status,
              share_type,
              claim_pin,
              expires_at,
              allow_save,
              created_at
            )
            VALUES (?, ?, ?, 'active', 'demo', NULL, ?, 1, ?)
          `,
        )
        .run(shareId, poemId, creatorId, expiresAt, now);
    },

    listSongDemoShares() {
      return db
        .prepare(
          `
            SELECT st.id,
                   st.track_id as resource_id,
                   'song' as resource_type,
                   t.title,
                   st.access_count,
                   st.created_at,
                   st.status
            FROM share_tokens st
            LEFT JOIN tracks t ON t.id = st.track_id
            WHERE st.share_type = 'demo'
            ORDER BY st.created_at DESC
          `,
        )
        .all();
    },

    listPoemDemoShares() {
      return db
        .prepare(
          `
            SELECT pst.id,
                   pst.poem_id as resource_id,
                   'poem' as resource_type,
                   p.title,
                   pst.access_count,
                   pst.created_at,
                   pst.status
            FROM poem_share_tokens pst
            LEFT JOIN poems p ON p.id = pst.poem_id
            WHERE pst.share_type = 'demo'
            ORDER BY pst.created_at DESC
          `,
        )
        .all();
    },

    getSongDemoShareById(shareId) {
      return db
        .prepare("SELECT * FROM share_tokens WHERE id = ? AND share_type = 'demo'")
        .get(shareId);
    },

    revokeSongDemoShare(shareId) {
      return db
        .prepare("UPDATE share_tokens SET status = 'revoked' WHERE id = ?")
        .run(shareId);
    },

    getPoemDemoShareById(shareId) {
      return db
        .prepare(
          "SELECT * FROM poem_share_tokens WHERE id = ? AND share_type = 'demo'",
        )
        .get(shareId);
    },

    revokePoemDemoShare(shareId) {
      return db
        .prepare("UPDATE poem_share_tokens SET status = 'revoked' WHERE id = ?")
        .run(shareId);
    },
  };
}

module.exports = { createAdminDemoShareRepository };
