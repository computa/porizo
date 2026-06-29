"use strict";

function createAdminControlPlaneService({
  adminControlRepository,
  audit,
  now = () => new Date().toISOString(),
}) {
  if (!adminControlRepository) {
    throw new Error("adminControlRepository is required");
  }
  if (typeof audit !== "function") {
    throw new Error("audit function is required");
  }

  async function getProviderStatus() {
    return await adminControlRepository.listProviderStatus();
  }

  async function setProviderStatus(providerName, status, adminId, reason) {
    await adminControlRepository.setProviderStatus({
      providerName,
      status,
      adminId,
      reason,
      now: now(),
    });

    await audit(
      adminId,
      `admin_set_provider_${status}`,
      "provider",
      providerName,
      { status, reason },
    );
    return { success: true };
  }

  async function getQueueStatus() {
    return await adminControlRepository.listQueueStatus();
  }

  async function setQueueStatus(queueName, status, adminId, reason) {
    await adminControlRepository.setQueueStatus({
      queueName,
      status,
      adminId,
      reason,
      now: now(),
    });

    await audit(adminId, `admin_set_queue_${status}`, "queue", queueName, {
      status,
      reason,
    });
    return { success: true };
  }

  return {
    getProviderStatus,
    setProviderStatus,
    getQueueStatus,
    setQueueStatus,
  };
}

module.exports = {
  createAdminControlPlaneService,
};
