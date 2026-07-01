"use strict";

function createAdminSystemHealthService({
  adminJobOpsRepository,
  now = () => new Date(),
}) {
  if (!adminJobOpsRepository) {
    throw new Error("adminJobOpsRepository is required");
  }
  if (typeof now !== "function") {
    throw new Error("now function is required");
  }

  function nowDate() {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) {
      throw new Error("now function returned an invalid date");
    }
    return date;
  }

  async function getSystemHealth() {
    const checkedAtDate = nowDate();
    const dayAgo = new Date(
      checkedAtDate.getTime() - 24 * 60 * 60 * 1000,
    ).toISOString();
    const { jobs, dlqCount, recentErrors } =
      await adminJobOpsRepository.getSystemHealth({ since: dayAgo });

    return {
      jobs: {
        running: jobs?.running || 0,
        queued: jobs?.queued || 0,
        failed: jobs?.failed || 0,
      },
      dlqCount,
      recentErrors,
      checkedAt: checkedAtDate.toISOString(),
    };
  }

  return {
    getSystemHealth,
  };
}

module.exports = {
  createAdminSystemHealthService,
};
