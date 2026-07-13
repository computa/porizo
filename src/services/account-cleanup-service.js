"use strict";
const crypto = require("node:crypto");
const {
  deleteAccountStorageArtifacts,
} = require("./account-deletion-storage-service");

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_BASE_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 60_000;

function errorMessage(error) {
  return String(error?.message || error || "Account cleanup failed").slice(0, 2000);
}

function createAccountCleanupService({
  repository,
  storageProvider,
  logger = console,
  now = () => new Date(),
  createId = () => crypto.randomUUID(),
  processCleanup,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  leaseMs = DEFAULT_LEASE_MS,
  baseBackoffMs = DEFAULT_BASE_BACKOFF_MS,
  maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
} = {}) {
  if (!repository) {
    throw new Error("account cleanup repository is required");
  }
  const processor =
    processCleanup ||
    ((job) =>
      deleteAccountStorageArtifacts({
        storageProvider,
        userId: job.user_id,
        logger,
      }));

  async function enqueue({ userId, idempotencyKey = `account:${userId}` }) {
    if (!userId) {
      throw new Error("userId is required");
    }
    const timestamp = now().toISOString();
    return repository.enqueue({
      id: createId(),
      userId,
      idempotencyKey,
      maxAttempts,
      now: timestamp,
    });
  }

  function retryDelayMs(attemptCount) {
    return Math.min(
      maxBackoffMs,
      baseBackoffMs * 2 ** Math.max(0, attemptCount - 1),
    );
  }

  async function processNext({ workerId }) {
    if (!workerId) {
      throw new Error("workerId is required");
    }
    const claimedAt = now();
    const job = await repository.claimNext({
      workerId,
      now: claimedAt.toISOString(),
      leaseExpiresAt: new Date(claimedAt.getTime() + leaseMs).toISOString(),
    });
    if (!job) {
      return null;
    }

    try {
      const result = await processor(job);
      const completedAt = now().toISOString();
      const transition = await repository.markCompleted({
        jobId: job.id,
        workerId,
        now: completedAt,
      });
      if (transition.changes !== 1) {
        throw new Error("ACCOUNT_CLEANUP_LEASE_LOST");
      }
      return { job, status: "completed", result };
    } catch (error) {
      if (error?.message === "ACCOUNT_CLEANUP_LEASE_LOST") {
        throw error;
      }
      const failedAt = now();
      const terminal = Number(job.attempt_count) >= Number(job.max_attempts);
      const nextAttemptAt = terminal
        ? null
        : new Date(
            failedAt.getTime() + retryDelayMs(Number(job.attempt_count)),
          ).toISOString();
      const transition = await repository.markRetry({
        jobId: job.id,
        workerId,
        nextAttemptAt,
        error: errorMessage(error),
        now: failedAt.toISOString(),
      });
      if (transition.changes !== 1) {
        throw new Error("ACCOUNT_CLEANUP_LEASE_LOST");
      }
      logger?.warn?.(
        { jobId: job.id, attempt: job.attempt_count, terminal },
        "[AccountCleanup] Cleanup attempt failed",
      );
      return { job, status: terminal ? "failed" : "retry", nextAttemptAt };
    }
  }

  return { enqueue, processNext, retryDelayMs };
}

module.exports = {
  createAccountCleanupService,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_LEASE_MS,
};
