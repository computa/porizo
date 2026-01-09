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

/**
 * Create a job durability service instance
 * @param {Object} params
 * @param {Object} params.db - Database connection
 * @param {Object} params.circuitBreaker - CircuitBreaker instance
 * @param {Object} params.dlq - DLQ service instance
 * @returns {Object} Durability service interface
 */
function createJobDurabilityService({ db, circuitBreaker, dlq }) {
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
    const result = await db.query(
      "SELECT status, attempts, max_attempts FROM jobs WHERE id = ?",
      [jobId]
    );

    if (result.rows.length === 0) {
      return false;
    }

    const job = result.rows[0];
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
    const jobResult = await db.query(
      "SELECT step_data FROM jobs WHERE id = ?",
      [jobId]
    );

    if (jobResult.rows.length === 0) {
      throw new Error(`Job not found: ${jobId}`);
    }

    // Parse existing step_data or create new object
    let stepData = {};
    if (jobResult.rows[0].step_data) {
      try {
        stepData = JSON.parse(jobResult.rows[0].step_data);
      } catch (e) {
        stepData = {};
      }
    }

    // Add new step data
    stepData[step] = data;

    // Update job with new step_data
    const now = new Date().toISOString();
    await db.query(
      "UPDATE jobs SET step_data = ?, last_heartbeat_at = ?, updated_at = ? WHERE id = ?",
      [JSON.stringify(stepData), now, now, jobId]
    );
  }

  /**
   * Update heartbeat for a running job
   * Should be called periodically during long-running operations
   * @param {string} jobId - Job ID
   */
  async function updateHeartbeat(jobId) {
    const now = new Date().toISOString();
    await db.query(
      "UPDATE jobs SET last_heartbeat_at = ?, updated_at = ? WHERE id = ?",
      [now, now, jobId]
    );
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

    const result = await db.query(
      `UPDATE jobs
       SET status = 'queued',
           attempts = attempts + 1,
           locked_by = NULL,
           locked_at = NULL,
           updated_at = ?
       WHERE status = 'running'
         AND (last_heartbeat_at IS NULL OR last_heartbeat_at < ?)`,
      [now, thresholdTime]
    );

    // Return number of affected rows
    return result.changes || result.rowCount || 0;
  }

  /**
   * Get health status for a job
   * @param {string} jobId - Job ID
   * @returns {Promise<Object>} Job health status
   */
  async function getJobHealth(jobId) {
    const result = await db.query(
      `SELECT status, step, step_index, attempts, max_attempts,
              last_heartbeat_at, error_code, error_message
       FROM jobs WHERE id = ?`,
      [jobId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const job = result.rows[0];
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
    const jobStats = await db.query(`
      SELECT
        status,
        COUNT(*) as count
      FROM jobs
      GROUP BY status
    `);

    // Get circuit breaker stats
    const cbStats = circuitBreaker.getAllStats();

    // Get DLQ stats
    const dlqStats = await dlq.getStats();

    return {
      jobs: jobStats.rows.reduce((acc, row) => {
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
