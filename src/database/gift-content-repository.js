"use strict";

function createGiftContentRepository(db) {
  async function getTrackForGiftContent(trackId) {
    return db
      .prepare(
        "SELECT id, user_id, title, recipient_name, occasion, latest_version, deleted_at FROM tracks WHERE id = ?",
      )
      .get(trackId);
  }

  async function getTrackVersionForGiftContent({ trackId, versionNum }) {
    return db
      .prepare(
        "SELECT id, preview_url, full_url FROM track_versions WHERE track_id = ? AND version_num = ?",
      )
      .get(trackId, versionNum);
  }

  async function getPoemForGiftContent(poemId) {
    return db
      .prepare(
        "SELECT id, user_id, title, recipient_name, occasion, tone, verses, message, deleted_at FROM poems WHERE id = ?",
      )
      .get(poemId);
  }

  return {
    getTrackForGiftContent,
    getTrackVersionForGiftContent,
    getPoemForGiftContent,
  };
}

module.exports = {
  createGiftContentRepository,
};
