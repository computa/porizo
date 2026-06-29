"use strict";

function createAdminWebhookHealthService({
  adminBillingRepository,
  now = () => new Date(),
}) {
  if (!adminBillingRepository) {
    throw new Error("adminBillingRepository is required");
  }
  if (typeof now !== "function") {
    throw new Error("now function is required");
  }

  function nowMs() {
    const value = now();
    const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
    if (!Number.isFinite(timestamp)) {
      throw new Error("now function returned an invalid date");
    }
    return timestamp;
  }

  async function getWebhookHealth() {
    const dayAgo = new Date(nowMs() - 24 * 60 * 60 * 1000).toISOString();
    const health = await adminBillingRepository.getWebhookHealth({
      since: dayAgo,
    });

    return {
      ...health,
      pendingRetries: 0,
    };
  }

  return {
    getWebhookHealth,
  };
}

module.exports = {
  createAdminWebhookHealthService,
};
