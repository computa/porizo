"use strict";

const crypto = require("crypto");
const { nowIso } = require("../utils/common");

function createGiftReservationService({ db, giftWalletRepository, giftReservationRepository }) {
  async function reserveGiftCredit({
    userId,
    idempotencyKey,
    expiresAt,
    purpose = "interactive_draft",
    originWebOrderId = null,
    preferredEtsyUnitId = null,
    externalQuery = null,
  }) {
    const execute = async (query) => {
      if (originWebOrderId) {
        const existing = await giftReservationRepository.findByOriginWebOrderId(originWebOrderId, query);
        if (existing) return { reservation: existing, idempotent: true };
      }
      const existing = idempotencyKey
        ? await giftReservationRepository.findByIdempotencyKey({ userId, idempotencyKey, query })
        : null;
      if (existing) return { reservation: existing, idempotent: true };

      const reservationId = `gres_${crypto.randomBytes(12).toString("hex")}`;
      const wallet = await giftWalletRepository.applyTransaction({
        userId,
        type: "gift_reserve",
        amount: -1,
        source: "gift_reservation",
        referenceType: "gift_reservation",
        referenceId: reservationId,
        idempotencyKey: `gift_reserve:${idempotencyKey || reservationId}`,
        externalQuery: query,
      });
      const timestamp = nowIso();
      await giftReservationRepository.createReservation({
        id: reservationId,
        userId,
        tokenTransactionId: wallet.transactionId,
        idempotencyKey,
        expiresAt,
        createdAt: timestamp,
        purpose,
        originWebOrderId,
        query,
      });
      // Gift credits are fungible across web and native clients. Attribute an
      // Etsy-funded ledger credit at the shared reservation boundary instead
      // of only in the web checkout route. This association is operational
      // provenance; it does not change which wallet credit the buyer can use.
      const candidateResult = await query(
        `SELECT id
           FROM etsy_order_units
          WHERE owner_user_id = ? AND state = 'claimed'
            AND gift_reservation_id IS NULL
            AND (? IS NULL OR id = ?)
          ORDER BY claimed_at ASC, created_at ASC
          LIMIT 1${db.isPostgres ? " FOR UPDATE" : ""}`,
        [userId, preferredEtsyUnitId, preferredEtsyUnitId],
      );
      const candidate = candidateResult?.rows?.[0];
      if (candidate) {
        await query(
          `UPDATE etsy_order_units
              SET state = 'reserved', gift_reservation_id = ?,
                  web_order_id = COALESCE(web_order_id, ?), updated_at = ?
            WHERE id = ? AND state = 'claimed'
              AND gift_reservation_id IS NULL`,
          [reservationId, originWebOrderId, timestamp, candidate.id],
        );
      } else if (preferredEtsyUnitId) {
        const err = new Error("ETSY_JOURNEY_NOT_AVAILABLE");
        err.code = "ETSY_JOURNEY_NOT_AVAILABLE";
        throw err;
      }
      return {
        reservation: await giftReservationRepository.getById(reservationId, query),
        balanceAfter: wallet.balanceAfter,
        idempotent: false,
      };
    };
    return externalQuery ? execute(externalQuery) : db.transaction(execute);
  }

  async function adoptTrack({ reservationId, userId, trackId, trackVersionId, externalQuery = null }) {
    const execute = async (query) => {
      const reservation = await giftReservationRepository.getById(reservationId, query);
      if (!reservation || reservation.user_id !== userId || !["reserved", "content_ready"].includes(reservation.status)) {
        const err = new Error("GIFT_RESERVATION_NOT_AVAILABLE");
        err.code = "GIFT_RESERVATION_NOT_AVAILABLE";
        throw err;
      }
      const result = await query(
        `UPDATE tracks SET gift_reservation_id = ?, funding_source = 'gift_wallet', updated_at = ?
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL
           AND (gift_reservation_id IS NULL OR gift_reservation_id = ?)
           AND COALESCE(funding_source, 'standard') = 'standard'
           AND EXISTS (SELECT 1 FROM track_versions WHERE id = ? AND track_id = ? AND song_entitlement_consumed_at IS NULL)`,
        [reservationId, nowIso(), trackId, userId, reservationId, trackVersionId, trackId],
      );
      const changed = result?.rowCount ?? result?.changes ?? 0;
      if (!changed) {
        const err = new Error("GIFT_CONTENT_NOT_ADOPTABLE");
        err.code = "GIFT_CONTENT_NOT_ADOPTABLE";
        throw err;
      }
      await query(
        `UPDATE etsy_order_units
            SET track_id = ?, track_version_id = ?, state = 'rendering',
                updated_at = ?
          WHERE gift_reservation_id = ? AND owner_user_id = ?
            AND state IN ('reserved', 'rendering')`,
        [trackId, trackVersionId, nowIso(), reservationId, userId],
      );
      return giftReservationRepository.getById(reservationId, query);
    };
    return externalQuery ? execute(externalQuery) : db.transaction(execute);
  }

  return { reserveGiftCredit, adoptTrack };
}

module.exports = { createGiftReservationService };
