"use strict";

const { createPreparedDbFromQuery } = require("../utils/db-adapter");

function createGiftFundingRepository(db) {
  function runner(query = null) {
    return query ? createPreparedDbFromQuery(query, db) : db;
  }

  async function getReservationById(reservationId, query = null) {
    return runner(query).prepare("SELECT * FROM gift_reservations WHERE id = ?").get(reservationId);
  }

  async function getActiveTrackForReservation(reservationId, query = null) {
    return runner(query)
      .prepare(
        "SELECT id FROM tracks WHERE gift_reservation_id = ? AND deleted_at IS NULL LIMIT 1",
      )
      .get(reservationId);
  }

  async function getActivePoemForReservation(reservationId, query = null) {
    return runner(query)
      .prepare(
        "SELECT id FROM poems WHERE gift_reservation_id = ? AND deleted_at IS NULL LIMIT 1",
      )
      .get(reservationId);
  }

  async function findLatestTrackForReservation(reservationId, query = null) {
    return runner(query)
      .prepare(
        `SELECT id, latest_version, status, updated_at
         FROM tracks
         WHERE gift_reservation_id = ? AND deleted_at IS NULL
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
      )
      .get(reservationId);
  }

  async function findLatestPoemForReservation(reservationId, query = null) {
    return runner(query)
      .prepare(
        `SELECT id, status, updated_at
         FROM poems
         WHERE gift_reservation_id = ? AND deleted_at IS NULL
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
      )
      .get(reservationId);
  }

  async function listActiveTracksForReservation(reservationId, query = null) {
    return runner(query)
      .prepare(
        "SELECT id, share_token_id FROM tracks WHERE gift_reservation_id = ? AND deleted_at IS NULL",
      )
      .all(reservationId);
  }

  async function listActivePoemsForReservation(reservationId, query = null) {
    return runner(query)
      .prepare(
        "SELECT id, share_token_id FROM poems WHERE gift_reservation_id = ? AND deleted_at IS NULL",
      )
      .all(reservationId);
  }

  async function revokeTrackShareToken({ shareTokenId, timestamp, query = null }) {
    return runner(query)
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

  async function softDeleteTrack({ trackId, timestamp, query = null }) {
    return runner(query)
      .prepare(
        "UPDATE tracks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
      )
      .run(timestamp, timestamp, trackId);
  }

  async function removeTrackLibraryEntry({ trackId, timestamp, query = null }) {
    return runner(query)
      .prepare(
        "UPDATE track_library_entries SET removed_at = COALESCE(removed_at, ?), updated_at = ? WHERE track_id = ? AND removed_at IS NULL",
      )
      .run(timestamp, timestamp, trackId);
  }

  async function revokePoemShareToken({ shareTokenId, timestamp, query = null }) {
    return runner(query)
      .prepare(
        `UPDATE poem_share_tokens
         SET status = 'revoked',
             expires_at = COALESCE(expires_at, ?),
             dispatched_at = NULL
         WHERE id = ? AND status != 'revoked'`,
      )
      .run(timestamp, shareTokenId);
  }

  async function softDeletePoem({ poemId, timestamp, query = null }) {
    return runner(query)
      .prepare(
        "UPDATE poems SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
      )
      .run(timestamp, timestamp, poemId);
  }

  async function removePoemLibraryEntry({ poemId, timestamp, query = null }) {
    return runner(query)
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
