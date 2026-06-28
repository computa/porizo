"use strict";

function createEnrollmentCleanupRepository(db) {
  async function listSessionsStartedBefore(cutoffIso) {
    return db
      .prepare(
        "SELECT id, user_id, prompts_json, chunk_count FROM enrollment_sessions WHERE started_at < ?",
      )
      .all(cutoffIso);
  }

  async function deleteSessionById(sessionId) {
    return db.prepare("DELETE FROM enrollment_sessions WHERE id = ?").run(sessionId);
  }

  return {
    listSessionsStartedBefore,
    deleteSessionById,
  };
}

module.exports = {
  createEnrollmentCleanupRepository,
};
