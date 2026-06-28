"use strict";

function createGiftFundingRepository(db) {
  async function getReservationById(reservationId) {
    return db.prepare("SELECT * FROM gift_reservations WHERE id = ?").get(reservationId);
  }

  async function getActiveTrackForReservation(reservationId) {
    return db
      .prepare(
        "SELECT id FROM tracks WHERE gift_reservation_id = ? AND deleted_at IS NULL LIMIT 1",
      )
      .get(reservationId);
  }

  async function getActivePoemForReservation(reservationId) {
    return db
      .prepare(
        "SELECT id FROM poems WHERE gift_reservation_id = ? AND deleted_at IS NULL LIMIT 1",
      )
      .get(reservationId);
  }

  async function findLatestTrackForReservation(reservationId) {
    return db
      .prepare(
        `SELECT id, latest_version, status, updated_at
         FROM tracks
         WHERE gift_reservation_id = ? AND deleted_at IS NULL
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
      )
      .get(reservationId);
  }

  async function findLatestPoemForReservation(reservationId) {
    return db
      .prepare(
        `SELECT id, status, updated_at
         FROM poems
         WHERE gift_reservation_id = ? AND deleted_at IS NULL
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
      )
      .get(reservationId);
  }

  async function listActiveTracksForReservation(reservationId) {
    return db
      .prepare(
        "SELECT id, share_token_id FROM tracks WHERE gift_reservation_id = ? AND deleted_at IS NULL",
      )
      .all(reservationId);
  }

  async function listActivePoemsForReservation(reservationId) {
    return db
      .prepare(
        "SELECT id, share_token_id FROM poems WHERE gift_reservation_id = ? AND deleted_at IS NULL",
      )
      .all(reservationId);
  }

  async function revokeTrackShareToken({ shareTokenId, timestamp }) {
    return db
      .prepare(
        `UPDATE share_tokens
         SET status = 'revoked',
             web_stream_allowed = 0,
             expires_at = COALESCE(expires_at, ?),
             dispatched_at = NULL
         WHERE id = ? AND status != 'revoked'`,
      )
      .run(timestamp, shareTokenId);
  }

  async function softDeleteTrack({ trackId, timestamp }) {
    return db
      .prepare(
        "UPDATE tracks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
      )
      .run(timestamp, timestamp, trackId);
  }

  async function removeTrackLibraryEntry({ trackId, timestamp }) {
    return db
      .prepare(
        "UPDATE track_library_entries SET removed_at = COALESCE(removed_at, ?), updated_at = ? WHERE track_id = ? AND removed_at IS NULL",
      )
      .run(timestamp, timestamp, trackId);
  }

  async function revokePoemShareToken({ shareTokenId, timestamp }) {
    return db
      .prepare(
        `UPDATE poem_share_tokens
         SET status = 'revoked',
             expires_at = COALESCE(expires_at, ?),
             dispatched_at = NULL
         WHERE id = ? AND status != 'revoked'`,
      )
      .run(timestamp, shareTokenId);
  }

  async function softDeletePoem({ poemId, timestamp }) {
    return db
      .prepare(
        "UPDATE poems SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
      )
      .run(timestamp, timestamp, poemId);
  }

  async function removePoemLibraryEntry({ poemId, timestamp }) {
    return db
      .prepare(
        "UPDATE poem_library_entries SET removed_at = COALESCE(removed_at, ?), updated_at = ? WHERE poem_id = ? AND removed_at IS NULL",
      )
      .run(timestamp, timestamp, poemId);
  }

  return {
    getReservationById,
    getActiveTrackForReservation,
    getActivePoemForReservation,
    findLatestTrackForReservation,
    findLatestPoemForReservation,
    listActiveTracksForReservation,
    listActivePoemsForReservation,
    revokeTrackShareToken,
    softDeleteTrack,
    removeTrackLibraryEntry,
    revokePoemShareToken,
    softDeletePoem,
    removePoemLibraryEntry,
  };
}

module.exports = {
  createGiftFundingRepository,
};
