"use strict";

function createAdminMetricsService({
  adminMetricsRepository,
  now = () => new Date(),
}) {
  if (!adminMetricsRepository) {
    throw new Error("adminMetricsRepository is required");
  }
  if (typeof now !== "function") {
    throw new Error("now function is required");
  }

  function currentTimeMs() {
    const value = now();
    const timestamp =
      value instanceof Date ? value.getTime() : new Date(value).getTime();
    if (!Number.isFinite(timestamp)) {
      throw new Error("now function returned an invalid date");
    }
    return timestamp;
  }

  function isoAgo(days) {
    return new Date(currentTimeMs() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  async function getOverviewMetrics() {
    return adminMetricsRepository.getOverviewMetrics({
      dayAgo: isoAgo(1),
      weekAgo: isoAgo(7),
    });
  }

  async function getCostMetrics(days = 30) {
    return adminMetricsRepository.getCostMetrics({
      daysAgo: isoAgo(days),
    });
  }

  async function getEnrollmentMetrics() {
    return adminMetricsRepository.getEnrollmentMetrics({ weekAgo: isoAgo(7) });
  }

  async function getRenderSuccessMetrics() {
    return adminMetricsRepository.getRenderSuccessMetrics({
      weekAgo: isoAgo(7),
    });
  }

  async function getRiskMetrics() {
    const metrics = await adminMetricsRepository.getRiskMetrics({
      now: new Date(currentTimeMs()).toISOString(),
      weekAgo: isoAgo(7),
    });

    const recentEscalations = metrics.recentEscalations.map((escalation) => {
      try {
        const meta = JSON.parse(escalation.metadata_json || "{}");
        return {
          user_id: escalation.user_id,
          to: meta.riskLevel || "unknown",
          reason: meta.reason || "",
          date: escalation.date,
        };
      } catch (parseError) {
        console.warn(
          `[AdminMetricsService] Malformed metadata_json in audit_logs for user ${escalation.user_id}:`,
          parseError.message,
        );
        return {
          user_id: escalation.user_id,
          to: "unknown",
          reason: "[metadata parse error]",
          date: escalation.date,
        };
      }
    });

    return {
      distribution: metrics.distribution,
      lockedAccounts: metrics.lockedAccounts,
      recentEscalations,
    };
  }

  return {
    getOverviewMetrics,
    getCostMetrics,
    getEnrollmentMetrics,
    getRenderSuccessMetrics,
    getRiskMetrics,
  };
}

module.exports = {
  createAdminMetricsService,
};
