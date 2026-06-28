"use strict";

const {
  createPreparedDbFromQuery,
  dbQuery,
} = require("../utils/db-adapter");

function createTrackVersionRepository(db) {
  function runner(query = null) {
    return query ? createPreparedDbFromQuery(query, db) : db;
  }

  async function findTrackById(trackId, query = null) {
    return runner(query).prepare("SELECT * FROM tracks WHERE id = ?").get(trackId);
  }

  async function findById(trackVersionId, query = null) {
    return runner(query)
      .prepare("SELECT * FROM track_versions WHERE id = ?")
      .get(trackVersionId);
  }

  async function findDuplicateVersion({ trackId, paramsHash, renderType }) {
    return db.prepare(
      "SELECT id, version_num FROM track_versions WHERE track_id = ? AND params_hash = ? AND render_type = ?",
    ).get(trackId, paramsHash, renderType);
  }

  async function findByTrackIdAndVersion({ trackId, versionNum, query = null }) {
    return runner(query)
      .prepare(
        "SELECT * FROM track_versions WHERE track_id = ? AND version_num = ?",
      )
      .get(trackId, versionNum);
  }

  async function listByTrackId(trackId) {
    return db
      .prepare("SELECT * FROM track_versions WHERE track_id = ? ORDER BY version_num")
      .all(trackId);
  }

  async function listLatestCoverVersionsForTracks(trackIds) {
    const ids = [...new Set((trackIds || []).filter(Boolean))];
    if (ids.length === 0) {
      return [];
    }

    const placeholders = ids.map(() => "?").join(",");
    const result = await dbQuery(
      db,
      `SELECT track_id, version_num, cover_image_url, cover_image_small_url, cover_image_large_url
         FROM track_versions
        WHERE track_id IN (${placeholders})
          AND version_num = (
            SELECT MAX(tv2.version_num)
              FROM track_versions tv2
             WHERE tv2.track_id = track_versions.track_id
          )`,
      ids,
    );
    return result.rows;
  }

  async function createVersionWithNextNumber({
    id,
    trackId,
    parentVersionId = null,
    renderType,
    paramsJson,
    paramsHash,
    costEstimateJson,
    actualCostJson = null,
    storageRef,
    storageRefPrefix,
    createdAt,
    completedAt = null,
    previewUrl = null,
    fullUrl = null,
    lyricsStatus = "draft",
    lyricsUpdatedAt,
    lyricsApprovedAt = null,
    guideAccessToken = null,
    streamBaseUrl,
  }) {
    if (typeof db.transaction !== "function") {
      throw new Error("Track version creation requires database transaction support");
    }

    return db.transaction(async (query) => {
      const txDb = createPreparedDbFromQuery(query, db);
      await txDb
        .prepare(
          "UPDATE tracks SET latest_version = latest_version + 1, updated_at = ? WHERE id = ?",
        )
        .run(createdAt, trackId);
      const track = await txDb
        .prepare("SELECT latest_version FROM tracks WHERE id = ?")
        .get(trackId);
      if (!track) {
        throw Object.assign(new Error("Track not found."), {
          code: "TRACK_NOT_FOUND",
        });
      }

      const versionNum = Number(track.latest_version);
      await txDb
        .prepare(
          "INSERT INTO track_versions (id, track_id, version_num, parent_version_id, status, render_type, params_json, params_hash, cost_estimate_json, actual_cost_json, storage_ref, created_at, completed_at, preview_url, full_url, lyrics_status, lyrics_updated_at, lyrics_approved_at, guide_access_token, stream_base_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          trackId,
          versionNum,
          parentVersionId,
          "queued",
          renderType,
          paramsJson,
          paramsHash,
          costEstimateJson,
          actualCostJson,
          storageRef || `${storageRefPrefix || ""}${versionNum}`,
          createdAt,
          completedAt,
          previewUrl,
          fullUrl,
          lyricsStatus,
          lyricsUpdatedAt || createdAt,
          lyricsApprovedAt,
          guideAccessToken,
          streamBaseUrl,
        );

      return {
        trackVersionId: id,
        versionNum,
      };
    });
  }

  return {
    findTrackById,
    findById,
    findDuplicateVersion,
    findByTrackIdAndVersion,
    listByTrackId,
    listLatestCoverVersionsForTracks,
    createVersionWithNextNumber,
  };
}

module.exports = { createTrackVersionRepository };
