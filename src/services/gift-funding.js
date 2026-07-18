"use strict";

const { createGiftFundingRepository } = require("../database/gift-funding-repository");

const ACTIVE_GIFT_RESERVATION_STATUSES = new Set(["reserved", "content_ready"]);

function createGiftFundingError(code, message, statusCode = 409) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

function isReservationExpired(reservation) {
  if (!reservation?.expires_at) return true;
  const expiresAt = new Date(reservation.expires_at).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
}

async function validateGiftFundingReservation(db, {
  userId,
  reservationId,
  contentType,
}) {
  if (!reservationId) {
    return null;
  }
  const repository = createGiftFundingRepository(db);

  const reservation = await repository.getReservationById(reservationId);

  if (!reservation || reservation.user_id !== userId) {
    throw createGiftFundingError(
      "GIFT_RESERVATION_NOT_FOUND",
      "Gift reservation not found.",
      404
    );
  }

  if (reservation.gift_order_id) {
    throw createGiftFundingError(
      "GIFT_RESERVATION_FINALIZED",
      "Gift reservation has already been finalized."
    );
  }

  if (!ACTIVE_GIFT_RESERVATION_STATUSES.has(String(reservation.status || "").toLowerCase())) {
    throw createGiftFundingError(
      "GIFT_RESERVATION_NOT_ACTIVE",
      "Gift reservation is no longer active."
    );
  }

  if (isReservationExpired(reservation)) {
    throw createGiftFundingError(
      "GIFT_RESERVATION_EXPIRED",
      "Gift reservation expired."
    );
  }

  if (reservation.content_type && reservation.content_type !== contentType) {
    throw createGiftFundingError(
      "GIFT_RESERVATION_CONTENT_MISMATCH",
      "Gift reservation is already locked to a different content type."
    );
  }

  const existingTrack = await repository.getActiveTrackForReservation(reservationId);
  const existingPoem = await repository.getActivePoemForReservation(reservationId);

  if (existingTrack || existingPoem) {
    throw createGiftFundingError(
      "GIFT_RESERVATION_CONTENT_ALREADY_CREATED",
      "Gift content has already been created for this reservation."
    );
  }

  return reservation;
}

async function findGiftFundingContent(db, {
  reservationId,
  contentType = null,
}) {
  if (!reservationId) {
    return null;
  }
  const repository = createGiftFundingRepository(db);

  const track = (!contentType || contentType === "song")
    ? await repository.findLatestTrackForReservation(reservationId)
    : null;
  if (track) {
    return {
      contentType: "song",
      contentId: track.id,
      versionNum: Number(track.latest_version || 1),
      status: track.status || null,
      updatedAt: track.updated_at || null,
    };
  }

  const poem = (!contentType || contentType === "poem")
    ? await repository.findLatestPoemForReservation(reservationId)
    : null;
  if (poem) {
    return {
      contentType: "poem",
      contentId: poem.id,
      versionNum: null,
      status: poem.status || null,
      updatedAt: poem.updated_at || null,
    };
  }

  return null;
}

async function deleteGiftFundedReservationContent(
  db,
  reservationId,
  deletedAt,
  externalQuery = null,
) {
  if (!reservationId) {
    return { tracksDeleted: 0, poemsDeleted: 0 };
  }

  const timestamp = deletedAt || new Date().toISOString();
  const repository = createGiftFundingRepository(db);
  const tracks = await repository.listActiveTracksForReservation(reservationId, externalQuery);
  const poems = await repository.listActivePoemsForReservation(reservationId, externalQuery);

  for (const track of tracks) {
    if (track.share_token_id) {
      await repository.revokeTrackShareToken({
        shareTokenId: track.share_token_id,
        timestamp,
        query: externalQuery,
      });
    }
    await repository.softDeleteTrack({ trackId: track.id, timestamp, query: externalQuery });
    await repository.removeTrackLibraryEntry({ trackId: track.id, timestamp, query: externalQuery });
  }

  for (const poem of poems) {
    if (poem.share_token_id) {
      await repository.revokePoemShareToken({
        shareTokenId: poem.share_token_id,
        timestamp,
        query: externalQuery,
      });
    }
    await repository.softDeletePoem({ poemId: poem.id, timestamp, query: externalQuery });
    await repository.removePoemLibraryEntry({ poemId: poem.id, timestamp, query: externalQuery });
  }

  return {
    tracksDeleted: tracks.length,
    poemsDeleted: poems.length,
  };
}

module.exports = {
  findGiftFundingContent,
  validateGiftFundingReservation,
  deleteGiftFundedReservationContent,
};
