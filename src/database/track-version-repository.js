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

  async function createTrack({
    id,
    userId,
    status = "draft",
    title = null,
    occasion = null,
    recipientName = null,
    recipientPhone = null,
    recipientChannel = null,
    style = null,
    durationTarget = 60,
    voiceMode,
    voiceGender = null,
    message = null,
    storyContextJson = null,
    shareTokenId = null,
    latestVersion = 0,
    createdAt,
    updatedAt,
  }) {
    return db
      .prepare(
        "INSERT INTO tracks (id, user_id, status, title, occasion, recipient_name, recipient_phone, recipient_channel, style, duration_target, voice_mode, voice_gender, message, story_context_json, share_token_id, latest_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        userId,
        status,
        title,
        occasion,
        recipientName,
        recipientPhone,
        recipientChannel,
        style,
        durationTarget,
        voiceMode,
        voiceGender,
        message,
        storyContextJson,
        shareTokenId,
        latestVersion,
        createdAt,
        updatedAt,
      );
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

  async function updateTrackVoiceMode({ trackId, voiceMode, updatedAt }) {
    return db
      .prepare("UPDATE tracks SET voice_mode = ?, updated_at = ? WHERE id = ?")
      .run(voiceMode, updatedAt, trackId);
  }

  async function updateTrackOgVariant({ trackId, ogVariant, updatedAt }) {
    return db
      .prepare("UPDATE tracks SET og_variant = ?, updated_at = ? WHERE id = ?")
      .run(ogVariant, updatedAt, trackId);
  }

  async function updateTrackStatus({
    trackId,
    status,
    updatedAt,
    query = null,
  }) {
    return runner(query)
      .prepare("UPDATE tracks SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, updatedAt, trackId);
  }

  async function updateStreamBaseUrl({ trackVersionId, streamBaseUrl }) {
    return db
      .prepare("UPDATE track_versions SET stream_base_url = ? WHERE id = ?")
      .run(streamBaseUrl, trackVersionId);
  }

  function jobColumnForWorkflowType(workflowType) {
    if (workflowType === "preview_render") {
      return {
        column: "preview_job_id",
        readyStatus: "preview_ready",
      };
    }
    if (workflowType === "full_render") {
      return {
        column: "full_job_id",
        readyStatus: "full_ready",
      };
    }
    throw new Error(`Unsupported render workflow type: ${workflowType}`);
  }

  async function linkRenderJobToVersion({
    trackVersionId,
    workflowType,
    jobId,
    query = null,
  }) {
    const { column } = jobColumnForWorkflowType(workflowType);
    return runner(query)
      .prepare(`UPDATE track_versions SET ${column} = ? WHERE id = ?`)
      .run(jobId, trackVersionId);
  }

  async function markVersionProcessingForRender({
    trackVersionId,
    workflowType,
    query,
  }) {
    const { readyStatus } = jobColumnForWorkflowType(workflowType);
    return runner(query)
      .prepare(
        "UPDATE track_versions SET status = 'processing' WHERE id = ? AND status NOT IN ('processing', ?)",
      )
      .run(trackVersionId, readyStatus);
  }

  async function markVersionProcessingForAutoReprocess({
    trackVersionId,
    query = null,
  }) {
    return runner(query)
      .prepare("UPDATE track_versions SET status = 'processing' WHERE id = ?")
      .run(trackVersionId);
  }

  async function applyRenderStepUpdates({
    trackVersionId,
    status,
    completedAt,
    previewUrl = null,
    fullUrl = null,
    lyricsJson = null,
    lyricsStatus = null,
    lyricsUpdatedAt = null,
    lyricsApprovedAt = null,
    musicPlanJson = null,
    moderationStatus = null,
    moderationReason = null,
    instrumentalUrl = null,
    guideVocalUrl = null,
    guideAccessToken = null,
    voiceConversionUrl = null,
    provenanceJson = null,
    query = null,
  }) {
    return runner(query)
      .prepare(
        "UPDATE track_versions SET status = ?, completed_at = ?, preview_url = COALESCE(?, preview_url), full_url = COALESCE(?, full_url), lyrics_json = COALESCE(?, lyrics_json), lyrics_status = COALESCE(?, lyrics_status), lyrics_updated_at = COALESCE(?, lyrics_updated_at), lyrics_approved_at = COALESCE(?, lyrics_approved_at), music_plan_json = COALESCE(?, music_plan_json), moderation_status = COALESCE(?, moderation_status), moderation_reason = COALESCE(?, moderation_reason), instrumental_url = COALESCE(?, instrumental_url), guide_vocal_url = COALESCE(?, guide_vocal_url), guide_access_token = COALESCE(?, guide_access_token), voice_conversion_url = COALESCE(?, voice_conversion_url), provenance_json = COALESCE(?, provenance_json) WHERE id = ?",
      )
      .run(
        status,
        completedAt,
        previewUrl,
        fullUrl,
        lyricsJson,
        lyricsStatus,
        lyricsUpdatedAt,
        lyricsApprovedAt,
        musicPlanJson,
        moderationStatus,
        moderationReason,
        instrumentalUrl,
        guideVocalUrl,
        guideAccessToken,
        voiceConversionUrl,
        provenanceJson,
        trackVersionId,
      );
  }

  async function updateVersionCoverImages({
    trackVersionId,
    coverImageUrl,
    coverImageSmallUrl,
    coverImageLargeUrl,
  }) {
    return db
      .prepare(
        "UPDATE track_versions SET cover_image_url = ?, cover_image_small_url = ?, cover_image_large_url = ? WHERE id = ?",
      )
      .run(
        coverImageUrl,
        coverImageSmallUrl,
        coverImageLargeUrl,
        trackVersionId,
      );
  }

  async function updateVersionLyricsJson({ trackVersionId, lyricsJson }) {
    return db
      .prepare("UPDATE track_versions SET lyrics_json = ? WHERE id = ?")
      .run(lyricsJson, trackVersionId);
  }

  async function markSongEntitlementConsumed({
    trackVersionId,
    consumedAt,
    query = null,
  }) {
    return runner(query)
      .prepare(
        "UPDATE track_versions SET song_entitlement_consumed_at = ? WHERE id = ?",
      )
      .run(consumedAt, trackVersionId);
  }

  async function insertRenderJobForVersion({
    trackId,
    trackVersionId,
    jobId,
    workflowType,
    stepData = null,
    createdAt,
    query,
  }) {
    await updateTrackStatus({
      trackId,
      status: "rendering",
      updatedAt: createdAt,
      query,
    });
    await runner(query)
      .prepare(
        "INSERT INTO jobs (id, track_version_id, workflow_type, status, step, attempts, max_attempts, step_index, step_data, error_code, error_message, progress_pct, started_at, completed_at, last_heartbeat_at, external_task_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        jobId,
        trackVersionId,
        workflowType,
        "queued",
        "queued",
        0,
        3,
        0,
        stepData,
        null,
        null,
        0,
        null,
        null,
        null,
        null,
        createdAt,
        createdAt,
      );
    await linkRenderJobToVersion({
      trackVersionId,
      workflowType,
      jobId,
      query,
    });
    return { jobId };
  }

  async function cancelActiveRender({
    trackId,
    trackVersionId,
    jobId,
    cancelledAt,
  }) {
    return db.transaction(async (query) => {
      const txDb = createPreparedDbFromQuery(query, db);
      const cancelResult = await txDb
        .prepare(
          "UPDATE jobs SET status = 'cancelled', completed_at = ?, error_code = 'USER_CANCELLED', error_message = 'Cancelled by user', updated_at = ? WHERE id = ? AND status IN ('queued','running')",
        )
        .run(cancelledAt, cancelledAt, jobId);

      if (cancelResult.changes === 0) {
        throw Object.assign(new Error("Job already finalized"), {
          code: "NO_ACTIVE_RENDER",
        });
      }

      await txDb
        .prepare("UPDATE track_versions SET status = 'cancelled' WHERE id = ?")
        .run(trackVersionId);
      await updateTrackStatus({
        trackId,
        status: "draft",
        updatedAt: cancelledAt,
        query,
      });
      return { cancelled: true };
    });
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

  async function updateDraftLyrics({
    trackVersionId,
    lyricsJson,
    lyricsUpdatedAt,
  }) {
    return db
      .prepare(
        "UPDATE track_versions SET lyrics_json = ?, lyrics_status = ?, lyrics_updated_at = ? WHERE id = ?",
      )
      .run(lyricsJson, "draft", lyricsUpdatedAt, trackVersionId);
  }

  async function blockModeration({ trackVersionId, reason }) {
    return db
      .prepare(
        "UPDATE track_versions SET moderation_status = ?, moderation_reason = ? WHERE id = ?",
      )
      .run("blocked", reason, trackVersionId);
  }

  async function updateGeneratedLyrics({
    trackVersionId,
    lyricsJson,
    lyricsStatus,
    lyricsUpdatedAt,
    provenanceJson,
  }) {
    return db
      .prepare(
        "UPDATE track_versions SET lyrics_json = ?, lyrics_status = ?, lyrics_updated_at = ?, provenance_json = ? WHERE id = ?",
      )
      .run(
        lyricsJson,
        lyricsStatus,
        lyricsUpdatedAt,
        provenanceJson,
        trackVersionId,
      );
  }

  async function approveLyrics({
    trackVersionId,
    lyricsApprovedAt,
    moderationStatus = "passed",
  }) {
    return db
      .prepare(
        "UPDATE track_versions SET lyrics_status = ?, lyrics_approved_at = ?, moderation_status = ? WHERE id = ?",
      )
      .run("approved", lyricsApprovedAt, moderationStatus, trackVersionId);
  }

  return {
    findTrackById,
    createTrack,
    findById,
    findDuplicateVersion,
    findByTrackIdAndVersion,
    listByTrackId,
    updateTrackVoiceMode,
    updateTrackOgVariant,
    updateTrackStatus,
    updateStreamBaseUrl,
    linkRenderJobToVersion,
    markVersionProcessingForRender,
    markVersionProcessingForAutoReprocess,
    applyRenderStepUpdates,
    updateVersionCoverImages,
    updateVersionLyricsJson,
    markSongEntitlementConsumed,
    insertRenderJobForVersion,
    cancelActiveRender,
    listLatestCoverVersionsForTracks,
    createVersionWithNextNumber,
    updateDraftLyrics,
    blockModeration,
    updateGeneratedLyrics,
    approveLyrics,
  };
}

module.exports = { createTrackVersionRepository };
