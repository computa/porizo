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
const {
  createDeadLetterQueueRepository,
  currentStepForJob,
  lastErrorForJob,
  retryCountForJob,
} = require("../database/dead-letter-queue-repository");

/**
 * Create a DLQ service instance
 * @param {Object} db - Database connection
 * @returns {Object} DLQ service interface
 */
function createDLQService(db, { repository } = {}) {
  const dlqRepository = repository || createDeadLetterQueueRepository(db);

  /**
   * Move a failed job to the dead-letter queue
   * @param {Object} params
   * @param {string} params.jobId - ID of the failed job
   * @param {string} params.reason - Reason for the failure
   * @returns {Object} The created DLQ entry
   */
  async function moveToDeadLetter({ jobId, reason }) {
    const job = await dlqRepository.getJobById(jobId);

    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const dlqId = `dlq_${crypto.randomBytes(12).toString("hex")}`;
    const failureCount = retryCountForJob(job);
    const lastError = lastErrorForJob(job);

    const dlqEntry = await dlqRepository.upsertEntry({
      id: dlqId,
      job,
      jobId,
      reason,
      failureCount,
      lastError,
    });

    await dlqRepository.markJobDeadLetter(jobId);

    return {
      id: dlqEntry?.id || dlqId,
      job_id: jobId,
      original_status: job.status,
      failure_reason: reason,
      failure_count: failureCount,
      last_error: lastError,
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
    return dlqRepository.listEntries({ unprocessedOnly, limit });
  }

  /**
   * Get a single DLQ entry with full job details
   * @param {string} dlqId - DLQ entry ID
   * @returns {Object} DLQ entry with job details
   */
  async function getDeadLetter(dlqId) {
    const dlqEntry = await dlqRepository.findEntryById(dlqId);

    if (!dlqEntry) {
      return null;
    }

    const job = await dlqRepository.getJobById(dlqEntry.job_id);

    return {
      ...dlqEntry,
      job,
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
    const dlqEntry = await dlqRepository.findEntryByJobId(jobId);

    if (!dlqEntry) {
      throw new Error(`No DLQ entry found for job: ${jobId}`);
    }

    if (dlqEntry.reprocessed_at) {
      throw new Error(`Job ${jobId} has already been reprocessed`);
    }

    const originalJob = await dlqRepository.getJobById(jobId);

    if (!originalJob) {
      throw new Error(`Original job not found: ${jobId}`);
    }

    const newJobId = `job_${crypto.randomBytes(12).toString("hex")}`;
    const startStep = fromStep || currentStepForJob(originalJob);

    await dlqRepository.createReprocessJob({
      id: newJobId,
      originalJob,
      startStep,
    });
    await dlqRepository.markEntryReprocessed({
      dlqId: dlqEntry.id,
      newJobId,
    });

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
    const total = await dlqRepository.countEntries();
    const unprocessed = await dlqRepository.countEntries({
      unprocessedOnly: true,
    });

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
    const cutoff = new Date(
      Date.now() - olderThanDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const count = await dlqRepository.purgeReprocessedBefore(cutoff);

    return {
      count,
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
