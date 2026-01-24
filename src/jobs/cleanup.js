/**
 * Cleanup job - deletes expired enrollment sessions and temporary files
 */

const fs = require("fs");
const path = require("path");
const { enrollmentChunkKey, enrollmentCleanKey } = require("../storage");

const DEFAULT_RETENTION_DAYS = 7;

/**
 * Clean up expired enrollment sessions
 * @param {Object} options
 * @param {Object} options.db - Database instance with prepared statements
 * @param {string} options.storageDir - Base storage directory
 * @param {number} options.retentionDays - Days to retain sessions (default: 7)
 * @returns {Promise<{deletedCount: number, errors: string[]}>}
 */
function safeParseJson(value, fallback) {
  if (!value || typeof value !== "string") {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

async function cleanupExpiredSessions({
  db,
  storageDir,
  storageProvider,
  retentionDays = DEFAULT_RETENTION_DAYS,
}) {
  const errors = [];
  let deletedCount = 0;

  // Calculate cutoff date
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoffDate.toISOString();

  try {
    // Get expired sessions from database
    const selectStmt = await db.prepare(
      "SELECT id, user_id, prompts_json, chunk_count FROM enrollment_sessions WHERE started_at < ?"
    );
    const expiredSessions = await selectStmt.all(cutoffIso);

    const deleteStmt = await db.prepare("DELETE FROM enrollment_sessions WHERE id = ?");

    for (const session of expiredSessions) {
      try {
        const prompts = safeParseJson(session.prompts_json, []);
        let chunkIds = Array.isArray(prompts)
          ? prompts.map((prompt) => prompt?.id).filter(Boolean)
          : [];
        if (chunkIds.length === 0 && session.chunk_count) {
          chunkIds = Array.from({ length: session.chunk_count }, (_, index) => `p${index + 1}`);
        }

        if (storageProvider?.deleteObject) {
          for (const chunkId of chunkIds) {
            await storageProvider.deleteObject({
              key: enrollmentChunkKey({
                userId: session.user_id,
                sessionId: session.id,
                chunkId,
              }),
            });
          }
          await storageProvider.deleteObject({
            key: enrollmentCleanKey({ userId: session.user_id, sessionId: session.id }),
          });
        }

        // Local cleanup fallback removes any leftover files not covered by chunk ids.
        if (storageDir && (!storageProvider || storageProvider.type === "local")) {
          const sessionDir = path.join(
            storageDir,
            "enrollment",
            "raw",
            session.user_id,
            session.id
          );
          if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
          }
          const cleanDir = path.join(
            storageDir,
            "enrollment",
            "clean",
            session.user_id,
            session.id
          );
          if (fs.existsSync(cleanDir)) {
            fs.rmSync(cleanDir, { recursive: true, force: true });
          }
        }

        // Delete from database
        await deleteStmt.run(session.id);
        deletedCount++;
      } catch (err) {
        errors.push(`Failed to delete session ${session.id}: ${err.message}`);
      }
    }
  } catch (err) {
    errors.push(`Cleanup query failed: ${err.message}`);
  }

  return { deletedCount, errors };
}

/**
 * Start a recurring cleanup job
 * @param {Object} options
 * @param {Object} options.db - Database instance
 * @param {string} options.storageDir - Base storage directory
 * @param {number} options.intervalMs - Interval between cleanup runs (default: 1 hour)
 * @param {number} options.retentionDays - Days to retain sessions (default: 7)
 * @returns {{stop: Function, runNow: Function}}
 */
function startCleanupJob({
  db,
  storageDir,
  storageProvider,
  intervalMs = 60 * 60 * 1000,
  retentionDays = DEFAULT_RETENTION_DAYS,
}) {
  let isRunning = false;

  const runCleanup = async () => {
    if (isRunning) return null;
    isRunning = true;
    try {
      const result = await cleanupExpiredSessions({
        db,
        storageDir,
        storageProvider,
        retentionDays,
      });
      return result;
    } finally {
      isRunning = false;
    }
  };

  const timer = setInterval(async () => {
    try {
      const result = await runCleanup();
      if (result) {
        if (result.deletedCount > 0) {
          console.log(`[Cleanup] Deleted ${result.deletedCount} expired enrollment sessions`);
        }
        if (result.errors && result.errors.length > 0) {
          console.error(`[Cleanup] ${result.errors.length} errors during cleanup:`, result.errors);
        }
      }
    } catch (err) {
      console.error("[Cleanup] Unhandled error in cleanup job:", err);
    }
  }, intervalMs);

  return {
    stop: () => clearInterval(timer),
    runNow: runCleanup,
  };
}

module.exports = {
  cleanupExpiredSessions,
  startCleanupJob,
};
