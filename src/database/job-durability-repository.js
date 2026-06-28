"use strict";

const { dbQuery, dbRun } = require("../utils/db-adapter");

function countValue(row) {
  return Number(row?.count || 0);
}

function changeCount(result) {
  return Number(result?.changes ?? result?.rowCount ?? 0);
}

function createJobDurabilityRepository(db) {
  async function findById(jobId) {
    if (!jobId) {
      return null;
    }
    const result = await dbQuery(db, "SELECT * FROM jobs WHERE id = ?", [jobId]);
    return result.rows[0] || null;
  }

  async function getDlqDecisionJob(jobId) {
    const result = await dbQuery(
      db,
      "SELECT status, attempts, max_attempts FROM jobs WHERE id = ?",
      [jobId],
    );
    return result.rows[0] || null;
  }

  async function getCheckpointJob(jobId) {
    const result = await dbQuery(
      db,
      "SELECT step_data FROM jobs WHERE id = ?",
      [jobId],
    );
    return result.rows[0] || null;
  }

  async function updateCheckpoint({ jobId, stepDataJson, now }) {
    return dbQuery(
      db,
      "UPDATE jobs SET step_data = ?, last_heartbeat_at = ?, updated_at = ? WHERE id = ?",
      [stepDataJson, now, now, jobId],
    );
  }

  async function updateHeartbeat({ jobId, now }) {
    return dbQuery(
      db,
      "UPDATE jobs SET last_heartbeat_at = ?, updated_at = ? WHERE id = ?",
      [now, now, jobId],
    );
  }

  async function recoverStaleJobs({ now, thresholdTime }) {
    const result = await dbQuery(
      db,
      `UPDATE jobs
       SET status = 'queued',
           attempts = attempts + 1,
           locked_by = NULL,
           locked_at = NULL,
           updated_at = ?
       WHERE status = 'running'
         AND COALESCE(last_heartbeat_at, locked_at, updated_at) < ?`,
      [now, thresholdTime],
    );
    return changeCount(result);
  }

  async function createStepHistory({
    id,
    jobId,
    stepName,
    attempt,
    status,
    startedAt,
    completedAt = null,
    durationMs = null,
  }) {
    return dbQuery(
      db,
      `INSERT INTO job_step_history (
         id, job_id, step_name, attempt, status, started_at, completed_at, duration_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, jobId, stepName, attempt, status, startedAt, completedAt, durationMs],
    );
  }

  async function finishStepHistory({
    id,
    status,
    errorMessage = null,
    completedAt,
    durationMs,
  }) {
    return dbQuery(
      db,
      "UPDATE job_step_history SET status = ?, error_message = ?, completed_at = ?, duration_ms = ? WHERE id = ?",
      [status, errorMessage, completedAt, durationMs, id],
    );
  }

  async function markOrphanedStepHistoryFailed({ completedAt }) {
    const result = await dbQuery(
      db,
      `UPDATE job_step_history
       SET status = 'failed',
           error_message = 'Worker crashed',
           completed_at = ?,
           duration_ms = 0
       WHERE status = 'running'
         AND job_id IN (SELECT id FROM jobs WHERE status != 'running')`,
      [completedAt],
    );
    return changeCount(result);
  }

  async function resetJobForAutoReprocess({ jobId, now }) {
    return dbRun(
      db,
      `UPDATE jobs
       SET status = 'queued',
           step = 'queued',
           step_index = 0,
           attempts = 0,
           error_code = NULL,
           error_message = NULL,
           progress_pct = 0,
           completed_at = NULL,
           next_attempt_at = NULL,
           locked_by = NULL,
           locked_at = NULL,
           updated_at = ?
       WHERE id = ?
         AND status IN ('failed', 'dead_letter')`,
      [now, jobId],
    );
  }

  async function appendDlqInsertFailure({ jobId, errorMessage, now }) {
    return dbRun(
      db,
      "UPDATE jobs SET error_message = error_message || ' [DLQ_INSERT_FAILED: ' || ? || ']', updated_at = ? WHERE id = ?",
      [errorMessage, now, jobId],
    );
  }

  async function listRunningUserIdsAtCapacity({
    heartbeatCutoff,
    maxConcurrent,
  }) {
    const result = await dbQuery(
      db,
      `SELECT t.user_id
       FROM jobs j
       JOIN track_versions tv ON j.track_version_id = tv.id
       JOIN tracks t ON tv.track_id = t.id
       WHERE j.status = 'running'
         AND j.last_heartbeat_at > ?
       GROUP BY t.user_id
       HAVING COUNT(*) >= ?`,
      [heartbeatCutoff, maxConcurrent],
    );
    return Array.from(result.rows || []);
  }

  async function listUserIdsForTrackVersionIds(trackVersionIds) {
    const ids = [...new Set((trackVersionIds || []).filter(Boolean))];
    if (ids.length === 0) {
      return [];
    }

    const placeholders = ids.map(() => "?").join(",");
    const result = await dbQuery(
      db,
      `SELECT tv.id AS track_version_id, t.user_id
       FROM track_versions tv
       JOIN tracks t ON t.id = tv.track_id
       WHERE tv.id IN (${placeholders})`,
      ids,
    );
    return Array.from(result.rows || []);
  }

  async function listQueuedRunnableJobs({ now, limit }) {
    const sql = db.isPostgres
      ? "SELECT * FROM jobs WHERE status = 'queued' AND workflow_type <> 'artwork_render' AND (next_attempt_at IS NULL OR next_attempt_at <= $1) ORDER BY created_at ASC LIMIT $2 FOR UPDATE SKIP LOCKED"
      : "SELECT * FROM jobs WHERE status = 'queued' AND workflow_type <> 'artwork_render' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at ASC LIMIT ?";
    const result = await dbQuery(db, sql, [now, limit]);
    return Array.from(result.rows || []);
  }

  async function claimQueuedJob({ jobId, runnerId, now, progressPct }) {
    return dbRun(
      db,
      "UPDATE jobs SET status = 'running', locked_by = ?, locked_at = ?, started_at = COALESCE(started_at, ?), last_heartbeat_at = ?, progress_pct = ?, updated_at = ? WHERE id = ? AND status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)",
      [runnerId, now, now, now, progressPct, now, jobId, now],
    );
  }

  async function markJobStepRunning({
    jobId,
    runnerId,
    step,
    stepIndex,
    progressPct,
    now,
  }) {
    return dbRun(
      db,
      "UPDATE jobs SET step = ?, step_index = ?, progress_pct = ?, last_heartbeat_at = ?, updated_at = ? WHERE id = ? AND locked_by = ?",
      [step, stepIndex, progressPct, now, now, jobId, runnerId],
    );
  }

  async function advanceJobToStep({
    jobId,
    runnerId,
    status,
    step,
    stepIndex,
    stepDataJson,
    progressPct,
    now,
  }) {
    return dbRun(
      db,
      "UPDATE jobs SET status = ?, step = ?, step_index = ?, step_data = ?, progress_pct = ?, last_heartbeat_at = ?, next_attempt_at = NULL, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ? AND locked_by = ?",
      [status, step, stepIndex, stepDataJson, progressPct, now, now, jobId, runnerId],
    );
  }

  async function advanceJobForReroll({
    jobId,
    runnerId,
    status,
    step,
    stepIndex,
    stepDataJson,
    progressPct,
    now,
  }) {
    return dbRun(
      db,
      "UPDATE jobs SET status = ?, step = ?, step_index = ?, step_data = ?, external_task_id = NULL, progress_pct = ?, last_heartbeat_at = ?, next_attempt_at = NULL, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ? AND locked_by = ?",
      [status, step, stepIndex, stepDataJson, progressPct, now, now, jobId, runnerId],
    );
  }

  async function parkJobUntil({
    jobId,
    runnerId,
    status,
    step,
    stepIndex,
    stepDataJson,
    progressPct,
    heartbeatAt,
    nextAttemptAt,
    updatedAt,
  }) {
    return dbRun(
      db,
      "UPDATE jobs SET status = ?, step = ?, step_index = ?, step_data = ?, progress_pct = ?, last_heartbeat_at = ?, next_attempt_at = ?, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ? AND locked_by = ?",
      [
        status,
        step,
        stepIndex,
        stepDataJson,
        progressPct,
        heartbeatAt,
        nextAttemptAt,
        updatedAt,
        jobId,
        runnerId,
      ],
    );
  }

  async function markJobTerminal({
    jobId,
    runnerId,
    status,
    progressPct,
    completedAt,
    updatedAt,
  }) {
    return dbRun(
      db,
      "UPDATE jobs SET status = ?, progress_pct = ?, completed_at = ?, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ? AND locked_by = ?",
      [status, progressPct, completedAt, updatedAt, jobId, runnerId],
    );
  }

  async function heartbeatOwnedJob({ jobId, runnerId, heartbeatAt, updatedAt }) {
    return dbRun(
      db,
      "UPDATE jobs SET last_heartbeat_at = ?, updated_at = ? WHERE id = ? AND locked_by = ?",
      [heartbeatAt, updatedAt, jobId, runnerId],
    );
  }

  async function markJobFailed({
    jobId,
    runnerId,
    status,
    step,
    stepIndex,
    errorCode,
    errorMessage,
    progressPct,
    completedAt,
    updatedAt,
  }) {
    return dbRun(
      db,
      "UPDATE jobs SET status = ?, step = ?, step_index = ?, error_code = ?, error_message = ?, progress_pct = ?, completed_at = ?, next_attempt_at = NULL, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ? AND locked_by = ?",
      [
        status,
        step,
        stepIndex,
        errorCode,
        errorMessage,
        progressPct,
        completedAt,
        updatedAt,
        jobId,
        runnerId,
      ],
    );
  }

  async function forceMarkJobFailed({
    jobId,
    status,
    step,
    stepIndex,
    errorCode,
    errorMessage,
    progressPct,
    completedAt,
    updatedAt,
  }) {
    return dbRun(
      db,
      "UPDATE jobs SET status = ?, step = ?, step_index = ?, error_code = ?, error_message = ?, progress_pct = ?, completed_at = ?, next_attempt_at = NULL, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ?",
      [
        status,
        step,
        stepIndex,
        errorCode,
        errorMessage,
        progressPct,
        completedAt,
        updatedAt,
        jobId,
      ],
    );
  }

  async function requeueJobAttempt({
    jobId,
    runnerId,
    status,
    progressPct,
    heartbeatAt,
    nextAttemptAt,
    updatedAt,
  }) {
    return dbRun(
      db,
      "UPDATE jobs SET attempts = attempts + 1, status = ?, progress_pct = ?, last_heartbeat_at = ?, next_attempt_at = ?, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ? AND locked_by = ?",
      [status, progressPct, heartbeatAt, nextAttemptAt, updatedAt, jobId, runnerId],
    );
  }

  async function attachExternalTask({
    jobId,
    runnerId,
    externalTaskId,
    stepDataJson,
    heartbeatAt,
    updatedAt,
  }) {
    return dbRun(
      db,
      "UPDATE jobs SET external_task_id = ?, step_data = ?, last_heartbeat_at = ?, updated_at = ? WHERE id = ? AND locked_by = ?",
      [externalTaskId, stepDataJson, heartbeatAt, updatedAt, jobId, runnerId],
    );
  }

  async function getJobHealth(jobId) {
    const result = await dbQuery(
      db,
      `SELECT status, step, step_index, attempts, max_attempts,
              last_heartbeat_at, error_code, error_message
       FROM jobs WHERE id = ?`,
      [jobId],
    );
    return result.rows[0] || null;
  }

  async function findLatestFailedForVersion({ trackVersionId, workflowType }) {
    const result = await dbQuery(
      db,
      `SELECT * FROM jobs
       WHERE track_version_id = ? AND workflow_type = ? AND status IN ('failed', 'dead_letter', 'blocked')
       ORDER BY COALESCE(completed_at, updated_at) DESC
       LIMIT 1`,
      [trackVersionId, workflowType],
    );
    return result.rows[0] || null;
  }

  async function findActiveForVersion({ trackVersionId, workflowType }) {
    const result = await dbQuery(
      db,
      "SELECT * FROM jobs WHERE track_version_id = ? AND workflow_type = ? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1",
      [trackVersionId, workflowType],
    );
    return result.rows[0] || null;
  }

  async function listLatestFailuresForTrackVersions(trackVersionIds) {
    const ids = [...new Set((trackVersionIds || []).filter(Boolean))];
    if (ids.length === 0) {
      return [];
    }

    const placeholders = ids.map(() => "?").join(",");
    const result = await dbQuery(
      db,
      `SELECT id, track_version_id, error_code, error_message, step, step_data, updated_at, completed_at
       FROM jobs
       WHERE track_version_id IN (${placeholders})
         AND status IN ('failed', 'dead_letter', 'blocked')
       ORDER BY COALESCE(completed_at, updated_at) DESC`,
      ids,
    );

    const latestByVersion = new Map();
    for (const job of result.rows) {
      if (!latestByVersion.has(job.track_version_id)) {
        latestByVersion.set(job.track_version_id, job);
      }
    }
    return Array.from(latestByVersion.values());
  }

  async function getJobStatusCounts() {
    const result = await dbQuery(
      db,
      `SELECT status, COUNT(*) as count
       FROM jobs
       GROUP BY status`,
    );
    return result.rows.map((row) => ({
      status: row.status,
      count: countValue(row),
    }));
  }

  return {
    findById,
    getDlqDecisionJob,
    getCheckpointJob,
    updateCheckpoint,
    updateHeartbeat,
    recoverStaleJobs,
    createStepHistory,
    finishStepHistory,
    markOrphanedStepHistoryFailed,
    resetJobForAutoReprocess,
    appendDlqInsertFailure,
    listRunningUserIdsAtCapacity,
    listUserIdsForTrackVersionIds,
    listQueuedRunnableJobs,
    claimQueuedJob,
    markJobStepRunning,
    advanceJobToStep,
    advanceJobForReroll,
    parkJobUntil,
    markJobTerminal,
    heartbeatOwnedJob,
    markJobFailed,
    forceMarkJobFailed,
    requeueJobAttempt,
    attachExternalTask,
    getJobHealth,
    findLatestFailedForVersion,
    findActiveForVersion,
    listLatestFailuresForTrackVersions,
    getJobStatusCounts,
  };
}

module.exports = { createJobDurabilityRepository };
