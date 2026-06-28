"use strict";

function createGdprAuditRepository(db) {
  async function insertAuditLog({
    id,
    userId,
    action,
    resourceType,
    resourceId,
    metadataJson,
    createdAt,
  }) {
    return db
      .prepare(
        `INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, userId, action, resourceType, resourceId, metadataJson, createdAt);
  }

  return {
    insertAuditLog,
  };
}

module.exports = {
  createGdprAuditRepository,
};
