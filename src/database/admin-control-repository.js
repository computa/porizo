"use strict";

function createAdminControlRepository(db) {
  async function listProviderStatus() {
    return db
      .prepare("SELECT * FROM provider_status ORDER BY provider_name")
      .all();
  }

  async function setProviderStatus({
    providerName,
    status,
    adminId,
    reason,
    now,
  }) {
    const isPaused = status === "paused";
    return db
      .prepare(
        `INSERT INTO provider_status (
          id,
          provider_name,
          status,
          paused_at,
          paused_by,
          pause_reason,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider_name) DO UPDATE SET
          status = excluded.status,
          paused_at = CASE WHEN excluded.status = 'paused' THEN excluded.paused_at ELSE NULL END,
          paused_by = CASE WHEN excluded.status = 'paused' THEN excluded.paused_by ELSE NULL END,
          pause_reason = CASE WHEN excluded.status = 'paused' THEN excluded.pause_reason ELSE NULL END,
          updated_at = excluded.updated_at`,
      )
      .run(
        `prov_${providerName}`,
        providerName,
        status,
        isPaused ? now : null,
        isPaused ? adminId : null,
        reason,
        now,
      );
  }

  async function listQueueStatus() {
    return db.prepare("SELECT * FROM queue_status ORDER BY queue_name").all();
  }

  async function setQueueStatus({ queueName, status, adminId, reason, now }) {
    const isPaused = status === "paused";
    const pausedFlag = isPaused ? 1 : 0;
    return db
      .prepare(
        `UPDATE queue_status SET
          status = ?,
          paused_at = CASE WHEN ? = 1 THEN ? ELSE NULL END,
          paused_by = CASE WHEN ? = 1 THEN ? ELSE NULL END,
          pause_reason = CASE WHEN ? = 1 THEN ? ELSE NULL END,
          updated_at = ?
        WHERE queue_name = ?`,
      )
      .run(
        status,
        pausedFlag,
        now,
        pausedFlag,
        adminId,
        pausedFlag,
        reason,
        now,
        queueName,
      );
  }

  return {
    listProviderStatus,
    setProviderStatus,
    listQueueStatus,
    setQueueStatus,
  };
}

module.exports = {
  createAdminControlRepository,
};
