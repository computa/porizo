"use strict";

const crypto = require("crypto");

function generateAuditId() {
  return `audit_${crypto.randomBytes(12).toString("hex")}`;
}

function normalizeTimestamp(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function createAdminAuditService({
  eventsRepository,
  generateId = generateAuditId,
  now = () => new Date().toISOString(),
} = {}) {
  if (!eventsRepository || typeof eventsRepository.insertAuditLog !== "function") {
    throw new Error("eventsRepository with insertAuditLog is required");
  }

  async function audit(adminId, action, resourceType, resourceId, metadata = {}) {
    const enriched = {
      actor: "admin",
      admin_id: adminId,
      ...metadata,
    };

    return eventsRepository.insertAuditLog({
      id: generateId(),
      userId: adminId,
      action,
      resourceType,
      resourceId,
      metadataJson: JSON.stringify(enriched),
      createdAt: normalizeTimestamp(now()),
    });
  }

  return { audit };
}

module.exports = {
  createAdminAuditService,
  generateAuditId,
};
