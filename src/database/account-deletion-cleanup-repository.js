"use strict";

function changeCount(result) {
  return Number(result?.changes ?? result?.rowCount ?? 0);
}

function createAccountDeletionCleanupRepository(db) {
  async function insertCleanupJob({
    id,
    userId,
    storagePrefixesJson,
    maxAttempts = 5,
    now,
  }) {
    return db
      .prepare(
        `INSERT INTO account_deletion_storage_cleanup_jobs (
           id, user_id, storage_prefixes_json, status, attempts, max_attempts,
           created_at, updated_at
         ) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)`,
      )
      .run(id, userId, storagePrefixesJson, maxAttempts, now, now);
  }

  async function findById(jobId) {
    return db
      .prepare("SELECT * FROM account_deletion_storage_cleanup_jobs WHERE id = ?")
      .get(jobId);
  }

  async function listDueJobs({ now, limit = 10 }) {
    return db
      .prepare(
        `SELECT *
         FROM account_deletion_storage_cleanup_jobs
         WHERE status IN ('queued', 'failed')
           AND attempts < max_attempts
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         ORDER BY created_at ASC
         LIMIT ?`,
      )
      .all(now, limit);
  }

  async function recoverStaleRunning({ staleBefore, now }) {
    return db
      .prepare(
        `UPDATE account_deletion_storage_cleanup_jobs
         SET status = 'failed',
             locked_at = NULL,
             last_error = 'Worker crashed or timed out during storage cleanup',
             next_attempt_at = ?,
             updated_at = ?
         WHERE status = 'running'
           AND locked_at < ?
           AND attempts < max_attempts`,
      )
      .run(now, now, staleBefore);
  }

  async function claimJob({ jobId, now }) {
    const result = await db
      .prepare(
        `UPDATE account_deletion_storage_cleanup_jobs
         SET status = 'running',
             attempts = attempts + 1,
             locked_at = ?,
             updated_at = ?
         WHERE id = ?
           AND status IN ('queued', 'failed')
           AND attempts < max_attempts
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?)`,
      )
      .run(now, now, jobId, now);
    return changeCount(result) === 1;
  }

  async function markCompleted({ jobId, now }) {
    return db
      .prepare(
        `UPDATE account_deletion_storage_cleanup_jobs
         SET status = 'completed',
             completed_at = ?,
             locked_at = NULL,
             last_error = NULL,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(now, now, jobId);
  }

  async function markFailed({ jobId, errorMessage, nextAttemptAt, now }) {
    return db
      .prepare(
        `UPDATE account_deletion_storage_cleanup_jobs
         SET status = 'failed',
             locked_at = NULL,
             last_error = ?,
             next_attempt_at = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(String(errorMessage || "cleanup failed").slice(0, 1000), nextAttemptAt, now, jobId);
  }

  return {
    insertCleanupJob,
    findById,
    listDueJobs,
    recoverStaleRunning,
    claimJob,
    markCompleted,
    markFailed,
  };
}

module.exports = { createAccountDeletionCleanupRepository };
