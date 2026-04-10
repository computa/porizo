"use strict";

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

  const reservation = await db.prepare(
    "SELECT * FROM gift_reservations WHERE id = ?"
  ).get(reservationId);

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

  const existingTrack = await db.prepare(
    "SELECT id FROM tracks WHERE gift_reservation_id = ? AND deleted_at IS NULL LIMIT 1"
  ).get(reservationId);
  const existingPoem = await db.prepare(
    "SELECT id FROM poems WHERE gift_reservation_id = ? AND deleted_at IS NULL LIMIT 1"
  ).get(reservationId);

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

  const track = (!contentType || contentType === "song")
    ? await db.prepare(
      `SELECT id, latest_version, status, updated_at
       FROM tracks
       WHERE gift_reservation_id = ? AND deleted_at IS NULL
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`
    ).get(reservationId)
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
    ? await db.prepare(
      `SELECT id, status, updated_at
       FROM poems
       WHERE gift_reservation_id = ? AND deleted_at IS NULL
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`
    ).get(reservationId)
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

async function deleteGiftFundedReservationContent(db, reservationId, deletedAt) {
  if (!reservationId) {
    return { tracksDeleted: 0, poemsDeleted: 0 };
  }

  const timestamp = deletedAt || new Date().toISOString();
  const tracks = await db.prepare(
    "SELECT id, share_token_id FROM tracks WHERE gift_reservation_id = ? AND deleted_at IS NULL"
  ).all(reservationId);
  const poems = await db.prepare(
    "SELECT id, share_token_id FROM poems WHERE gift_reservation_id = ? AND deleted_at IS NULL"
  ).all(reservationId);

  for (const track of tracks) {
    if (track.share_token_id) {
      await db.prepare(
        `UPDATE share_tokens
         SET status = 'revoked',
             web_stream_allowed = 0,
             expires_at = COALESCE(expires_at, ?),
             dispatched_at = NULL
         WHERE id = ? AND status != 'revoked'`
      ).run(timestamp, track.share_token_id);
    }
    await db.prepare(
      "UPDATE tracks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL"
    ).run(timestamp, timestamp, track.id);
    await db.prepare(
      "UPDATE track_library_entries SET removed_at = COALESCE(removed_at, ?), updated_at = ? WHERE track_id = ? AND removed_at IS NULL"
    ).run(timestamp, timestamp, track.id);
  }

  for (const poem of poems) {
    if (poem.share_token_id) {
      await db.prepare(
        `UPDATE poem_share_tokens
         SET status = 'revoked',
             expires_at = COALESCE(expires_at, ?),
             dispatched_at = NULL
         WHERE id = ? AND status != 'revoked'`
      ).run(timestamp, poem.share_token_id);
    }
    await db.prepare(
      "UPDATE poems SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL"
    ).run(timestamp, timestamp, poem.id);
    await db.prepare(
      "UPDATE poem_library_entries SET removed_at = COALESCE(removed_at, ?), updated_at = ? WHERE poem_id = ? AND removed_at IS NULL"
    ).run(timestamp, timestamp, poem.id);
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
