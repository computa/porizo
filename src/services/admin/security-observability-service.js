"use strict";

const { safeBounds } = require("./pagination");

function escapeLikePattern(str) {
  return str.replace(/[%_\\]/g, "\\$&");
}

function createAdminSecurityObservabilityService({
  adminSecurityObservabilityRepository,
  audit,
  now = () => new Date(),
}) {
  if (!adminSecurityObservabilityRepository) {
    throw new Error("adminSecurityObservabilityRepository is required");
  }
  if (typeof audit !== "function") {
    throw new Error("audit function is required");
  }
  if (typeof now !== "function") {
    throw new Error("now function is required");
  }

  function currentTimeMs() {
    const value = now();
    return value instanceof Date ? value.getTime() : new Date(value).getTime();
  }

  async function searchAuthEvents({
    eventType,
    userId,
    startDate,
    endDate,
    limit = 50,
    offset = 0,
  }) {
    const bounds = safeBounds(limit, offset);
    return await adminSecurityObservabilityRepository.searchAuthEvents({
      filters: { eventType, userId, startDate, endDate },
      limit: bounds.limit,
      offset: bounds.offset,
    });
  }

  async function getAuthEventStats() {
    const dayAgo = new Date(currentTimeMs() - 24 * 60 * 60 * 1000).toISOString();
    const stats =
      await adminSecurityObservabilityRepository.getAuthEventStats({
        since: dayAgo,
      });

    const loginSuccess =
      stats.find((row) => row.event_type === "login_success")?.count || 0;
    const loginFailed =
      stats.find((row) => row.event_type === "login_failed")?.count || 0;

    return { byType: stats, loginSuccess, loginFailed };
  }

  async function getAppleRefreshTokenStats(days = 7) {
    const startDate = new Date(
      currentTimeMs() - days * 24 * 60 * 60 * 1000,
    ).toISOString();
    const rows =
      await adminSecurityObservabilityRepository.getAppleRefreshTokenStats({
        startDate,
      });

    const validated =
      rows.find((row) => row.action === "apple_refresh_token_validated")
        ?.count || 0;
    const invalid =
      rows.find((row) => row.action === "apple_refresh_token_invalid")?.count ||
      0;
    const lastValidated =
      rows.find((row) => row.action === "apple_refresh_token_validated")
        ?.last_seen || null;
    const lastInvalid =
      rows.find((row) => row.action === "apple_refresh_token_invalid")
        ?.last_seen || null;

    return {
      validated,
      invalid,
      lastValidated,
      lastInvalid,
      byAction: rows,
    };
  }

  async function searchAuditLogs({
    action,
    resourceType,
    startDate,
    endDate,
    limit = 50,
    offset = 0,
  }) {
    const bounds = safeBounds(limit, offset);
    return await adminSecurityObservabilityRepository.searchAuditLogs({
      filters: {
        actionPattern: action ? `%${escapeLikePattern(action)}%` : null,
        resourceType,
        startDate,
        endDate,
      },
      limit: bounds.limit,
      offset: bounds.offset,
    });
  }

  async function getRateLimits({
    userId,
    actionType,
    nearLimit = false,
    limit = 50,
    offset = 0,
  }) {
    const bounds = safeBounds(limit, offset);
    return await adminSecurityObservabilityRepository.getRateLimits({
      filters: {
        userId,
        actionType,
        nearLimit,
        windowStartAfterMs: currentTimeMs() - 86400000,
      },
      limit: bounds.limit,
      offset: bounds.offset,
    });
  }

  async function resetUserRateLimit(userId, actionType, adminId, reason) {
    await adminSecurityObservabilityRepository.deleteRateLimitRows(
      userId,
      actionType,
    );
    await audit(adminId, "admin_reset_rate_limit", "user", userId, {
      actionType,
      reason,
    });
    return { success: true };
  }

  async function getConsentLogs({
    consentVersion,
    startDate,
    endDate,
    limit = 50,
    offset = 0,
  }) {
    const bounds = safeBounds(limit, offset);
    return await adminSecurityObservabilityRepository.getConsentLogs({
      filters: { consentVersion, startDate, endDate },
      limit: bounds.limit,
      offset: bounds.offset,
    });
  }

  return {
    searchAuthEvents,
    getAuthEventStats,
    getAppleRefreshTokenStats,
    searchAuditLogs,
    getRateLimits,
    resetUserRateLimit,
    getConsentLogs,
  };
}

module.exports = {
  createAdminSecurityObservabilityService,
  escapeLikePattern,
};
