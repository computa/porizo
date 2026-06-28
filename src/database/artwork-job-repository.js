"use strict";

const SQL_GET_TRACK = `
  SELECT
    t.id, t.user_id, t.occasion, t.recipient_name, t.style,
    t.artwork_content_hash, t.latest_version,
    u.display_name AS sender_display_name
  FROM tracks t
  LEFT JOIN users u ON u.id = t.user_id
  WHERE t.id = ?
`;

const SQL_GET_LATEST_VERSION = `
  SELECT id FROM track_versions
  WHERE track_id = ?
  ORDER BY version_num DESC
  LIMIT 1
`;

const SQL_GET_VERSION_LYRICS = `
  SELECT lyrics_json FROM track_versions
  WHERE id = ?
`;

const SQL_GET_ENTITLEMENT = `
  SELECT tier, admin_upgrade_tier, admin_upgrade_expires_at
  FROM entitlements
  WHERE user_id = ?
`;

const SQL_UPDATE_ARTWORK = `
  UPDATE tracks SET
    artwork_url = ?,
    artwork_style_variant = ?,
    artwork_source = ?,
    artwork_provider = ?,
    artwork_prompt = ?,
    artwork_content_hash = ?,
    artwork_moderation_passed = ?,
    artwork_generated_at = ?
  WHERE id = ?
`;

// Persists the picked vars + provenance to the per-version row. Lives on
// track_versions (not tracks) so preview and full each carry their own
// extractor output — see migration 113.
const SQL_UPDATE_ARTWORK_VARS = `
  UPDATE track_versions SET
    artwork_vars_json = ?,
    artwork_provider = ?,
    artwork_prompt_version = ?
  WHERE id = ?
`;

// Scoped to track_version row, not track — preview and full each need their
// own flag so the barrier doesn't return instantly with stale artwork.
const SQL_MARK_ARTWORK_READY = `
  UPDATE track_versions SET artwork_ready = ?
  WHERE id = ?
`;

// Durable-queue SQL — artwork jobs live in the shared `jobs` table.
// The audio runner's claim query MUST exclude workflow_type='artwork_render'
// (see src/workflows/runner.js) so the audio pipeline doesn't try to step
// through artwork rows.
const SQL_INSERT_ARTWORK_JOB = `
  INSERT INTO jobs (
    id, track_version_id, workflow_type, queue_name, status, step,
    attempts, max_attempts, step_index, step_data,
    progress_pct, created_at, updated_at
  ) VALUES (?, ?, 'artwork_render', 'q.default', 'queued', 'generate', 0, ?, 0, ?, 0, ?, ?)
`;

const SQL_MARK_JOB_RUNNING = `
  UPDATE jobs SET status = 'running', last_heartbeat_at = ?, updated_at = ?
  WHERE id = ? AND workflow_type = 'artwork_render' AND status IN ('queued', 'running')
`;

const SQL_MARK_JOB_COMPLETED = `
  UPDATE jobs SET status = 'completed', progress_pct = 100, completed_at = ?, updated_at = ?
  WHERE id = ? AND workflow_type = 'artwork_render' AND status NOT IN ('completed', 'failed')
`;

const SQL_MARK_JOB_FAILED = `
  UPDATE jobs SET status = 'failed', error_code = ?, error_message = ?,
    completed_at = ?, updated_at = ?
  WHERE id = ? AND workflow_type = 'artwork_render' AND status NOT IN ('completed', 'failed')
`;

const SQL_REQUEUE_JOB = `
  UPDATE jobs SET status = 'queued', attempts = ?, next_attempt_at = ?,
    error_message = ?, updated_at = ?
  WHERE id = ? AND workflow_type = 'artwork_render' AND status NOT IN ('completed', 'failed')
`;

const SQL_SELECT_ORPHANED_ARTWORK_JOBS = `
  SELECT j.id, j.track_version_id, j.attempts, tv.track_id
  FROM jobs j
  LEFT JOIN track_versions tv ON tv.id = j.track_version_id
  WHERE j.workflow_type = 'artwork_render'
    AND (
      (j.status = 'queued' AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= ?))
      OR (j.status = 'running' AND (j.last_heartbeat_at IS NULL OR j.last_heartbeat_at < ?))
    )
  ORDER BY j.created_at ASC
`;

function createArtworkJobRepository(db) {
  async function getTrack(trackId) {
    return db.prepare(SQL_GET_TRACK).get(trackId);
  }

  async function getLatestVersionForTrack(trackId) {
    return db.prepare(SQL_GET_LATEST_VERSION).get(trackId);
  }

  async function getVersionLyrics(trackVersionId) {
    return db.prepare(SQL_GET_VERSION_LYRICS).get(trackVersionId);
  }

  async function getEntitlement(userId) {
    return db.prepare(SQL_GET_ENTITLEMENT).get(userId);
  }

  async function updateArtwork({
    trackId,
    artworkUrl,
    artworkStyleVariant,
    artworkSource,
    artworkProvider,
    artworkPrompt,
    artworkContentHash,
    artworkModerationPassed,
    artworkGeneratedAt,
  }) {
    return db
      .prepare(SQL_UPDATE_ARTWORK)
      .run(
        artworkUrl,
        artworkStyleVariant,
        artworkSource,
        artworkProvider,
        artworkPrompt,
        artworkContentHash,
        artworkModerationPassed,
        artworkGeneratedAt,
        trackId,
      );
  }

  async function updateArtworkVars({
    trackVersionId,
    artworkVarsJson,
    artworkProvider,
    artworkPromptVersion,
  }) {
    return db
      .prepare(SQL_UPDATE_ARTWORK_VARS)
      .run(artworkVarsJson, artworkProvider, artworkPromptVersion, trackVersionId);
  }

  async function markArtworkReady({ trackVersionId, ready }) {
    return db.prepare(SQL_MARK_ARTWORK_READY).run(ready, trackVersionId);
  }

  async function insertArtworkJob({
    jobId,
    trackVersionId,
    maxAttempts,
    stepData,
    createdAt,
    updatedAt,
  }) {
    return db
      .prepare(SQL_INSERT_ARTWORK_JOB)
      .run(jobId, trackVersionId, maxAttempts, stepData, createdAt, updatedAt);
  }

  async function markJobRunning({ jobId, now }) {
    return db.prepare(SQL_MARK_JOB_RUNNING).run(now, now, jobId);
  }

  async function markJobCompleted({ jobId, now }) {
    return db.prepare(SQL_MARK_JOB_COMPLETED).run(now, now, jobId);
  }

  async function markJobFailed({ jobId, code, message, now }) {
    return db
      .prepare(SQL_MARK_JOB_FAILED)
      .run(code || null, message || null, now, now, jobId);
  }

  async function requeueJob({ jobId, attempts, nextAttemptAt, message, now }) {
    return db
      .prepare(SQL_REQUEUE_JOB)
      .run(attempts, nextAttemptAt, message, now, jobId);
  }

  async function listRecoverableJobs({ now, staleCutoff }) {
    return db.prepare(SQL_SELECT_ORPHANED_ARTWORK_JOBS).all(now, staleCutoff);
  }

  return {
    getTrack,
    getLatestVersionForTrack,
    getVersionLyrics,
    getEntitlement,
    updateArtwork,
    updateArtworkVars,
    markArtworkReady,
    insertArtworkJob,
    markJobRunning,
    markJobCompleted,
    markJobFailed,
    requeueJob,
    listRecoverableJobs,
  };
}

module.exports = {
  createArtworkJobRepository,
  SQL_GET_TRACK,
  SQL_GET_LATEST_VERSION,
  SQL_GET_VERSION_LYRICS,
  SQL_GET_ENTITLEMENT,
  SQL_UPDATE_ARTWORK,
  SQL_UPDATE_ARTWORK_VARS,
  SQL_MARK_ARTWORK_READY,
  SQL_INSERT_ARTWORK_JOB,
  SQL_MARK_JOB_RUNNING,
  SQL_MARK_JOB_COMPLETED,
  SQL_MARK_JOB_FAILED,
  SQL_REQUEUE_JOB,
  SQL_SELECT_ORPHANED_ARTWORK_JOBS,
};
