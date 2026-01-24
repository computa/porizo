/**
 * Dead-Letter Queue (DLQ) Service
 *
 * Manages jobs that have failed beyond max retries. Provides:
 * - Capture of failed jobs with error context
 * - Listing and filtering of DLQ entries
 * - Reprocessing capabilities (create new job from failed one)
 * - Purging of old, reprocessed entries
 *
 * Usage:
 *   const dlq = createDLQService(db);
 *
 *   // When a job exceeds max retries
 *   await dlq.moveToDeadLetter({ jobId, reason: 'Max retries exceeded' });
 *
 *   // Admin: View failed jobs
 *   const entries = await dlq.listDeadLetters({ unprocessedOnly: true });
 *
 *   // Admin: Reprocess a failed job
 *   const { newJobId } = await dlq.reprocess({ jobId, fromStep: 'music_gen' });
 */

const crypto = require("crypto");

/**
 * Create a DLQ service instance
 * @param {Object} db - Database connection
 * @returns {Object} DLQ service interface
 */
function createDLQService(db) {
  /**
   * Move a failed job to the dead-letter queue
   * @param {Object} params
   * @param {string} params.jobId - ID of the failed job
   * @param {string} params.reason - Reason for the failure
   * @returns {Object} The created DLQ entry
   */
  async function moveToDeadLetter({ jobId, reason }) {
    // Get job details
    const jobResult = await db.query(
      "SELECT * FROM jobs WHERE id = ?",
      [jobId]
    );

    if (jobResult.rows.length === 0) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const job = jobResult.rows[0];
    const dlqId = `dlq_${crypto.randomBytes(12).toString("hex")}`;

    // Insert into DLQ
    await db.query(
      `INSERT INTO dead_letter_queue (
        id, job_id, original_status, failure_reason, failure_count, last_error, moved_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        dlqId,
        jobId,
        job.status,
        reason,
        job.retry_count || 0,
        job.last_error || null,
      ]
    );

    // Update job status to dead_letter
    await db.query(
      "UPDATE jobs SET status = 'dead_letter', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [jobId]
    );

    return {
      id: dlqId,
      job_id: jobId,
      original_status: job.status,
      failure_reason: reason,
      failure_count: job.retry_count || 0,
      last_error: job.last_error,
    };
  }

  /**
   * List all entries in the dead-letter queue
   * @param {Object} options
   * @param {boolean} options.unprocessedOnly - Only return entries not yet reprocessed
   * @param {number} options.limit - Max entries to return (default: 100)
   * @returns {Array} List of DLQ entries
   */
  async function listDeadLetters({ unprocessedOnly = false, limit = 100 } = {}) {
    let query = "SELECT * FROM dead_letter_queue";
    const params = [];

    if (unprocessedOnly) {
      query += " WHERE reprocessed_at IS NULL";
    }

    query += " ORDER BY moved_at DESC LIMIT ?";
    params.push(limit);

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Get a single DLQ entry with full job details
   * @param {string} dlqId - DLQ entry ID
   * @returns {Object} DLQ entry with job details
   */
  async function getDeadLetter(dlqId) {
    const dlqResult = await db.query(
      "SELECT * FROM dead_letter_queue WHERE id = ?",
      [dlqId]
    );

    if (dlqResult.rows.length === 0) {
      return null;
    }

    const dlqEntry = dlqResult.rows[0];

    // Get associated job
    const jobResult = await db.query(
      "SELECT * FROM jobs WHERE id = ?",
      [dlqEntry.job_id]
    );

    return {
      ...dlqEntry,
      job: jobResult.rows[0] || null,
    };
  }

  /**
   * Reprocess a failed job by creating a new job
   * @param {Object} params
   * @param {string} params.jobId - Original job ID to reprocess
   * @param {string} params.fromStep - Step to start from (optional, defaults to job's current_step)
   * @returns {Object} { newJobId, dlqEntryId }
   */
  async function reprocess({ jobId, fromStep = null }) {
    // Get DLQ entry
    const dlqResult = await db.query(
      "SELECT * FROM dead_letter_queue WHERE job_id = ?",
      [jobId]
    );

    if (dlqResult.rows.length === 0) {
      throw new Error(`No DLQ entry found for job: ${jobId}`);
    }

    const dlqEntry = dlqResult.rows[0];

    if (dlqEntry.reprocessed_at) {
      throw new Error(`Job ${jobId} has already been reprocessed`);
    }

    // Get original job
    const jobResult = await db.query(
      "SELECT * FROM jobs WHERE id = ?",
      [jobId]
    );

    if (jobResult.rows.length === 0) {
      throw new Error(`Original job not found: ${jobId}`);
    }

    const originalJob = jobResult.rows[0];

    // Create new job
    const newJobId = `job_${crypto.randomBytes(12).toString("hex")}`;
    const startStep = fromStep || originalJob.current_step || "pending";

    await db.query(
      `INSERT INTO jobs (
        id, track_version_id, status, current_step, retry_count, max_retries, created_at, updated_at
      ) VALUES (?, ?, 'pending', ?, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        newJobId,
        originalJob.track_version_id,
        startStep,
        originalJob.max_retries || 5,
      ]
    );

    // Update DLQ entry
    await db.query(
      `UPDATE dead_letter_queue
       SET reprocessed_at = CURRENT_TIMESTAMP, reprocess_job_id = ?
       WHERE id = ?`,
      [newJobId, dlqEntry.id]
    );

    return {
      newJobId,
      dlqEntryId: dlqEntry.id,
    };
  }

  /**
   * Get DLQ statistics
   * @returns {Object} Statistics { total, unprocessed, reprocessed }
   */
  async function getStats() {
    const totalResult = await db.query(
      "SELECT COUNT(*) as count FROM dead_letter_queue"
    );

    const unprocessedResult = await db.query(
      "SELECT COUNT(*) as count FROM dead_letter_queue WHERE reprocessed_at IS NULL"
    );

    const total = totalResult.rows[0].count;
    const unprocessed = unprocessedResult.rows[0].count;

    return {
      total,
      unprocessed,
      reprocessed: total - unprocessed,
    };
  }

  /**
   * Purge old, reprocessed DLQ entries
   * @param {Object} params
   * @param {number} params.olderThanDays - Delete entries reprocessed more than this many days ago
   * @returns {Object} { count: number of entries deleted }
   */
  async function purge({ olderThanDays = 7 } = {}) {
    const result = await db.query(
      `DELETE FROM dead_letter_queue
       WHERE reprocessed_at IS NOT NULL
       AND reprocessed_at < datetime('now', '-' || ? || ' days')`,
      [olderThanDays]
    );

    // SQLite doesn't return affected rows directly, so we count
    // For compatibility, return the changes count if available
    return {
      count: result.changes || result.rowCount || 0,
    };
  }

  return {
    moveToDeadLetter,
    listDeadLetters,
    getDeadLetter,
    reprocess,
    getStats,
    purge,
  };
}

module.exports = {
  createDLQService,
};
