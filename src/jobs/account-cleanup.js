"use strict";

const crypto = require("node:crypto");
const {
  createAccountCleanupRepository,
} = require("../database/account-cleanup-repository");
const {
  createAccountCleanupService,
} = require("../services/account-cleanup-service");

function startAccountCleanupJob({
  db,
  storageProvider,
  logger = console,
  intervalMs = 30_000,
} = {}) {
  const service = createAccountCleanupService({
    repository: createAccountCleanupRepository(db),
    storageProvider,
    logger,
  });
  const workerId = `account-cleanup:${process.pid}:${crypto.randomUUID()}`;
  let running = false;
  let stopped = false;

  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      while (!stopped && (await service.processNext({ workerId }))) {
        // Drain the ready queue; retries remain scheduled by next_attempt_at.
      }
    } catch (error) {
      logger?.error?.({ err: error }, "[AccountCleanup] Worker tick failed");
    } finally {
      running = false;
    }
  }

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  void tick();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

module.exports = { startAccountCleanupJob };
