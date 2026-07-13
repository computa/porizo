"use strict";
const { dbGet, dbRun } = require("../utils/db-adapter");

function createAccountCleanupRepository(db) {
  async function enqueue({
    id,
    userId,
    idempotencyKey,
    maxAttempts = 5,
    now,
  }) {
    await dbRun(
      db,
      `INSERT INTO account_cleanup_jobs (
         id, user_id, idempotency_key, status, attempt_count, max_attempts,
         created_at, updated_at
       ) VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [id, userId, idempotencyKey, maxAttempts, now, now],
    );
    return findByIdempotencyKey(idempotencyKey);
  }

  async function findById(id) {
    return dbGet(db, "SELECT * FROM account_cleanup_jobs WHERE id = ?", [id]);
  }

  async function findByIdempotencyKey(idempotencyKey) {
    return dbGet(
      db,
      "SELECT * FROM account_cleanup_jobs WHERE idempotency_key = ?",
      [idempotencyKey],
    );
  }

  async function claimNext({ workerId, now, leaseExpiresAt }) {
    if (typeof db.transaction !== "function") {
      throw new Error("Account cleanup claiming requires transaction support");
    }

    return db.transaction(async (query) => {
      await query(
        `UPDATE account_cleanup_jobs
         SET status = 'failed',
             last_error = COALESCE(last_error, 'Cleanup lease expired after maximum attempts'),
             lease_owner = NULL,
             lease_expires_at = NULL,
             next_attempt_at = NULL,
             updated_at = ?
         WHERE status = 'running'
           AND lease_expires_at <= ?
           AND attempt_count >= max_attempts`,
        [now, now],
      );

      const selectSql = db.isPostgres
        ? `SELECT * FROM account_cleanup_jobs
           WHERE attempt_count < max_attempts
             AND (
               (status IN ('pending', 'retry') AND (next_attempt_at IS NULL OR next_attempt_at <= $1))
               OR (status = 'running' AND lease_expires_at <= $1)
             )
           ORDER BY created_at ASC, id ASC
           LIMIT 1 FOR UPDATE SKIP LOCKED`
        : `SELECT * FROM account_cleanup_jobs
           WHERE attempt_count < max_attempts
             AND (
               (status IN ('pending', 'retry') AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
               OR (status = 'running' AND lease_expires_at <= ?)
             )
           ORDER BY created_at ASC, id ASC
           LIMIT 1`;
      const selected = await query(
        selectSql,
        db.isPostgres ? [now] : [now, now],
      );
      const job = selected.rows?.[0];
      if (!job) {
        return null;
      }

      const claimed = await query(
        `UPDATE account_cleanup_jobs
         SET status = 'running',
             attempt_count = attempt_count + 1,
             next_attempt_at = NULL,
             lease_owner = ?,
             lease_expires_at = ?,
             updated_at = ?
         WHERE id = ?
           AND attempt_count = ?
           AND (
             status IN ('pending', 'retry')
             OR (status = 'running' AND lease_expires_at <= ?)
           )`,
        [workerId, leaseExpiresAt, now, job.id, job.attempt_count, now],
      );
      if (Number(claimed.rowCount ?? claimed.changes ?? 0) !== 1) {
        return null;
      }

      const result = await query(
        "SELECT * FROM account_cleanup_jobs WHERE id = ?",
        [job.id],
      );
      return result.rows?.[0] || null;
    });
  }

  async function markCompleted({ jobId, workerId, now }) {
    return dbRun(
      db,
      `UPDATE account_cleanup_jobs
       SET status = 'completed', completed_at = ?, updated_at = ?,
           next_attempt_at = NULL, lease_owner = NULL, lease_expires_at = NULL,
           last_error = NULL
       WHERE id = ? AND status = 'running' AND lease_owner = ?`,
      [now, now, jobId, workerId],
    );
  }

  async function markRetry({ jobId, workerId, nextAttemptAt, error, now }) {
    return dbRun(
      db,
      `UPDATE account_cleanup_jobs
       SET status = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'retry' END,
           next_attempt_at = CASE WHEN attempt_count >= max_attempts THEN NULL ELSE ? END,
           last_error = ?, updated_at = ?, lease_owner = NULL, lease_expires_at = NULL
       WHERE id = ? AND status = 'running' AND lease_owner = ?`,
      [nextAttemptAt, error, now, jobId, workerId],
    );
  }

  return {
    enqueue,
    findById,
    findByIdempotencyKey,
    claimNext,
    markCompleted,
    markRetry,
  };
}

module.exports = { createAccountCleanupRepository };
