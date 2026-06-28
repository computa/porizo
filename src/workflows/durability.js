/**
 * Job Durability Service
 *
 * Integrates circuit breaker and DLQ with the job runner for improved resilience.
 * Provides:
 * - Durable execution wrapper with circuit breaker protection
 * - Checkpoint saving for step-by-step resumability
 * - Heartbeat updates for liveness detection
 * - Stale job recovery
 * - DLQ integration for failed jobs
 *
 * Usage:
 *   const durability = createJobDurabilityService({ db, circuitBreaker, dlq });
 *
 *   // Execute provider call with circuit breaker protection
 *   const result = await durability.executeWithDurability({
 *     provider: 'elevenlabs',
 *     fn: async () => callElevenLabsAPI(),
 *   });
 *
 *   // Save checkpoint after each step
 *   await durability.saveCheckpoint({ jobId, step: 'lyrics', data: { lyrics_json: '...' } });
 *
 *   // Update heartbeat during long operations
 *   await durability.updateHeartbeat(jobId);
 */

const {
  createJobDurabilityRepository,
} = require("../database/job-durability-repository");

/**
 * Create a job durability service instance
 * @param {Object} params
 * @param {Object} params.db - Database connection
 * @param {Object} params.circuitBreaker - CircuitBreaker instance
 * @param {Object} params.dlq - DLQ service instance
 * @returns {Object} Durability service interface
 */
function createJobDurabilityService({ db, circuitBreaker, dlq, repository }) {
  const jobRepository = repository || createJobDurabilityRepository(db);
  /**
   * Execute a function with circuit breaker protection
   * Records success/failure with the circuit breaker automatically
   * @param {Object} params
   * @param {string} params.provider - Provider name (e.g., 'elevenlabs', 'replicate')
   * @param {Function} params.fn - Async function to execute
   * @returns {Promise<any>} Result of the function
   * @throws {Error} If circuit is open or function fails
   */
  async function executeWithDurability({ provider, fn }) {
    // Check if circuit is open
    if (circuitBreaker.isOpen(provider)) {
      throw new Error(`Circuit breaker open for provider: ${provider}`);
    }

    try {
      const result = await fn();
      await circuitBreaker.recordSuccess(provider);
      return result;
    } catch (error) {
      await circuitBreaker.recordFailure(provider);
      throw error;
    }
  }

  /**
   * Check if a job should be moved to DLQ
   * @param {string} jobId - Job ID to check
   * @returns {Promise<boolean>} True if job should be moved to DLQ
   */
  async function shouldMoveToDLQ(jobId) {
    const job = await jobRepository.getDlqDecisionJob(jobId);

    if (!job) {
      return false;
    }
    return job.status === "failed" && job.attempts >= job.max_attempts;
  }

  /**
   * Move a failed job to the dead-letter queue
   * @param {Object} params
   * @param {string} params.jobId - Job ID to move
   * @param {string} params.reason - Reason for the failure
   * @returns {Promise<Object>} DLQ entry
   */
  async function moveFailedJobToDLQ({ jobId, reason }) {
    return dlq.moveToDeadLetter({ jobId, reason });
  }

  /**
   * Save a checkpoint for a job step
   * Accumulates step data for resumability
   * @param {Object} params
   * @param {string} params.jobId - Job ID
   * @param {string} params.step - Step name
   * @param {Object} params.data - Step output data
   */
  async function saveCheckpoint({ jobId, step, data }) {
    // Get current step_data
    const job = await jobRepository.getCheckpointJob(jobId);

    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    // Parse existing step_data or create new object
    let stepData = {};
    if (job.step_data) {
      try {
        stepData = JSON.parse(job.step_data);
      } catch (e) {
        stepData = {};
      }
    }

    // Add new step data
    stepData[step] = data;

    // Update job with new step_data
    const now = new Date().toISOString();
    await jobRepository.updateCheckpoint({
      jobId,
      stepDataJson: JSON.stringify(stepData),
      now,
    });
  }

  /**
   * Update heartbeat for a running job
   * Should be called periodically during long-running operations
   * @param {string} jobId - Job ID
   */
  async function updateHeartbeat(jobId) {
    const now = new Date().toISOString();
    await jobRepository.updateHeartbeat({ jobId, now });
  }

  /**
   * Recover stale jobs that have been stuck in 'running' status
   * Requeues jobs whose last heartbeat is older than the threshold
   * @param {Object} params
   * @param {number} params.staleThresholdMinutes - Minutes before a job is considered stale
   * @returns {Promise<number>} Number of jobs recovered
   */
  async function recoverStaleJobs({ staleThresholdMinutes = 5 } = {}) {
    const now = new Date().toISOString();
    const thresholdTime = new Date(
      Date.now() - staleThresholdMinutes * 60 * 1000
    ).toISOString();

    return jobRepository.recoverStaleJobs({ now, thresholdTime });
  }

  /**
   * Get health status for a job
   * @param {string} jobId - Job ID
   * @returns {Promise<Object>} Job health status
   */
  async function getJobHealth(jobId) {
    const job = await jobRepository.getJobHealth(jobId);

    if (!job) {
      return null;
    }
    return {
      status: job.status,
      currentStep: job.step,
      stepIndex: job.step_index,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      attemptsRemaining: job.max_attempts - job.attempts,
      lastHeartbeat: job.last_heartbeat_at,
      errorCode: job.error_code,
      errorMessage: job.error_message,
    };
  }

  /**
   * Get overall durability stats
   * @returns {Promise<Object>} Durability statistics
   */
  async function getStats() {
    // Get job stats
    const jobStats = await jobRepository.getJobStatusCounts();

    // Get circuit breaker stats
    const cbStats = circuitBreaker.getAllStats();

    // Get DLQ stats
    const dlqStats = await dlq.getStats();

    return {
      jobs: jobStats.reduce((acc, row) => {
        acc[row.status] = row.count;
        return acc;
      }, {}),
      circuitBreakers: cbStats,
      deadLetterQueue: dlqStats,
    };
  }

  return {
    executeWithDurability,
    shouldMoveToDLQ,
    moveFailedJobToDLQ,
    saveCheckpoint,
    updateHeartbeat,
    recoverStaleJobs,
    getJobHealth,
    getStats,
  };
}

module.exports = {
  createJobDurabilityService,
};
