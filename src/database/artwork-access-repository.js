"use strict";

function createArtworkAccessRepository(db) {
  async function getShareTokenForArtwork(shareTokenId) {
    return db
      .prepare("SELECT track_id, status, expires_at FROM share_tokens WHERE id = ?")
      .get(shareTokenId);
  }

  async function getTrackOwnerForArtwork(trackId) {
    return db.prepare("SELECT user_id FROM tracks WHERE id = ?").get(trackId);
  }

  return {
    getShareTokenForArtwork,
    getTrackOwnerForArtwork,
  };
}

module.exports = { createArtworkAccessRepository };
