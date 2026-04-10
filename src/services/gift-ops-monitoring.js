"use strict";

function createGiftOpsMonitor({
  db,
  logger,
  redactGiftContacts,
  upsertGiftIncident,
  resolveGiftIncident,
}) {
  function logGiftLifecycle(level, event, metadata = {}) {
    const safeLevel = typeof logger?.[level] === "function" ? level : "info";
    logger[safeLevel]({
      event: `gift_${event}`,
      ...redactGiftContacts(metadata),
    }, `gift_${event}`);
  }

  async function recordGiftIncident({
    incidentKey,
    incidentType,
    severity = "warning",
    giftOrderId = null,
    outboxId = null,
    resourceType = giftOrderId ? "gift_order" : null,
    resourceId = giftOrderId,
    summary,
    detail = null,
    metadata = {},
    reopen = true,
  }) {
    const incident = await upsertGiftIncident(db, {
      incidentKey,
      incidentType,
      severity,
      giftOrderId,
      outboxId,
      resourceType,
      resourceId,
      summary,
      detail,
      metadata,
      reopen,
    });
    logGiftLifecycle(severity === "critical" ? "error" : "warn", "incident", {
      incident_key: incidentKey,
      incident_type: incidentType,
      gift_id: giftOrderId,
      outbox_id: outboxId,
      summary,
    });
    return incident;
  }

  async function clearGiftIncident(incidentKey, resolverId = null) {
    await resolveGiftIncident(db, incidentKey, resolverId);
  }

  return {
    logGiftLifecycle,
    recordGiftIncident,
    clearGiftIncident,
  };
}

module.exports = {
  createGiftOpsMonitor,
};
