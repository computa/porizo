"use strict";

const { dbAll, dbGet, dbQuery, dbRun } = require("../utils/db-adapter");

function changeCount(result) {
  return Number(result?.changes ?? result?.rowCount ?? 0);
}

function hasCurrentJobSchema(job) {
  return Object.prototype.hasOwnProperty.call(job || {}, "workflow_type");
}

function currentStepForJob(job) {
  return job?.current_step || job?.step || "pending";
}

function retryCountForJob(job) {
  return Number(job?.retry_count ?? job?.attempts ?? 0);
}

function maxRetriesForJob(job) {
  return Number(job?.max_retries ?? job?.max_attempts ?? 5);
}

function lastErrorForJob(job) {
  return job?.last_error || job?.error_message || job?.error_code || null;
}

function createDeadLetterQueueRepository(db) {
  async function getJobById(jobId) {
    return dbGet(db, "SELECT * FROM jobs WHERE id = ?", [jobId]);
  }

  async function upsertEntry({
    id,
    job,
    jobId,
    reason,
    failureCount,
    lastError,
  }) {
    await dbRun(
      db,
      `INSERT INTO dead_letter_queue (
         id, job_id, original_status, failure_reason, failure_count, last_error, moved_at
       ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (job_id) DO UPDATE SET
         failure_reason = EXCLUDED.failure_reason,
         failure_count = EXCLUDED.failure_count,
         last_error = EXCLUDED.last_error,
         moved_at = CURRENT_TIMESTAMP`,
      [
        id,
        jobId,
        job.status,
        reason,
        failureCount,
        lastError,
      ],
    );

    return findEntryByJobId(jobId);
  }

  async function markJobDeadLetter(jobId) {
    return dbRun(
      db,
      "UPDATE jobs SET status = 'dead_letter', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [jobId],
    );
  }

  async function listEntries({ unprocessedOnly = false, limit = 100 } = {}) {
    const whereClause = unprocessedOnly ? " WHERE reprocessed_at IS NULL" : "";
    return dbAll(
      db,
      `SELECT * FROM dead_letter_queue${whereClause} ORDER BY moved_at DESC LIMIT ?`,
      [limit],
    );
  }

  async function listAutoReprocessCandidates({
    cooldownCutoff,
    limit = 5,
  }) {
    return dbAll(
      db,
      `SELECT dlq.*, j.step, j.error_code, j.error_message, j.track_version_id, j.workflow_type
       FROM dead_letter_queue dlq
       JOIN jobs j ON j.id = dlq.job_id
       WHERE dlq.reprocessed_at IS NULL
         AND dlq.auto_reprocess_count < 2
         AND dlq.moved_at < ?
       ORDER BY dlq.moved_at ASC
       LIMIT ?`,
      [cooldownCutoff, limit],
    );
  }

  async function findEntryById(dlqId) {
    return dbGet(db, "SELECT * FROM dead_letter_queue WHERE id = ?", [dlqId]);
  }

  async function findEntryByJobId(jobId) {
    return dbGet(db, "SELECT * FROM dead_letter_queue WHERE job_id = ?", [jobId]);
  }

  async function createReprocessJob({ id, originalJob, startStep }) {
    if (hasCurrentJobSchema(originalJob)) {
      return dbRun(
        db,
        `INSERT INTO jobs (
           id, track_version_id, workflow_type, status, step, attempts, max_attempts,
           step_index, created_at, updated_at
         ) VALUES (?, ?, ?, 'queued', ?, 0, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          id,
          originalJob.track_version_id,
          originalJob.workflow_type,
          startStep,
          maxRetriesForJob(originalJob),
        ],
      );
    }

    return dbRun(
      db,
      `INSERT INTO jobs (
         id, track_version_id, status, current_step, retry_count, max_retries, created_at, updated_at
       ) VALUES (?, ?, 'pending', ?, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        id,
        originalJob.track_version_id,
        startStep,
        maxRetriesForJob(originalJob),
      ],
    );
  }

  async function markEntryReprocessed({ dlqId, newJobId }) {
    return dbRun(
      db,
      `UPDATE dead_letter_queue
       SET reprocessed_at = CURRENT_TIMESTAMP, reprocess_job_id = ?
       WHERE id = ?`,
      [newJobId, dlqId],
    );
  }

  async function markAutoReprocessed({ dlqId, jobId, now }) {
    return dbRun(
      db,
      `UPDATE dead_letter_queue
       SET reprocessed_at = ?,
           reprocess_job_id = ?,
           auto_reprocess_count = auto_reprocess_count + 1
       WHERE id = ?`,
      [now, jobId, dlqId],
    );
  }

  async function countEntries({ unprocessedOnly = false } = {}) {
    const whereClause = unprocessedOnly ? " WHERE reprocessed_at IS NULL" : "";
    const row = await dbGet(
      db,
      `SELECT COUNT(*) as count FROM dead_letter_queue${whereClause}`,
    );
    return Number(row?.count || 0);
  }

  async function purgeReprocessedBefore(cutoffTime) {
    const result = await dbQuery(
      db,
      `DELETE FROM dead_letter_queue
       WHERE reprocessed_at IS NOT NULL
         AND reprocessed_at < ?`,
      [cutoffTime],
    );
    return changeCount(result);
  }

  return {
    getJobById,
    upsertEntry,
    markJobDeadLetter,
    listEntries,
    listAutoReprocessCandidates,
    findEntryById,
    findEntryByJobId,
    createReprocessJob,
    markEntryReprocessed,
    markAutoReprocessed,
    countEntries,
    purgeReprocessedBefore,
    currentStepForJob,
    retryCountForJob,
    lastErrorForJob,
  };
}

module.exports = {
  createDeadLetterQueueRepository,
  currentStepForJob,
  lastErrorForJob,
  maxRetriesForJob,
  retryCountForJob,
};
