"use strict";

const { safeBounds } = require("./pagination");

function createAdminJobOpsService({
  adminJobOpsRepository,
  audit,
  now = () => new Date(),
}) {
  if (!adminJobOpsRepository) {
    throw new Error("adminJobOpsRepository is required");
  }
  if (typeof audit !== "function") {
    throw new Error("audit function is required");
  }
  if (typeof now !== "function") {
    throw new Error("now function is required");
  }

  function nowIso() {
    const value = now();
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  async function getJobMetrics() {
    const currentTime = new Date(nowIso()).getTime();
    return await adminJobOpsRepository.getJobMetrics({
      staleBefore: new Date(currentTime - 30 * 60 * 1000).toISOString(),
      failuresAfter: new Date(currentTime - 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  async function listJobs({ status, workflowType, limit = 50, offset = 0 }) {
    const bounds = safeBounds(limit, offset);
    return await adminJobOpsRepository.listJobs({
      status,
      workflowType,
      limit: bounds.limit,
      offset: bounds.offset,
    });
  }

  async function retryJob(jobId, adminId) {
    const job = await adminJobOpsRepository.findJobById(jobId);
    if (!job) return { success: false, error: "Job not found" };
    if (job.status !== "failed") {
      return { success: false, error: "Job is not failed" };
    }

    const retryResult = await adminJobOpsRepository.retryFailedJob({
      jobId,
      now: nowIso(),
    });
    if (Number(retryResult?.changes ?? retryResult?.rowCount ?? 0) === 0) {
      return { success: false, error: "Job is not failed" };
    }

    await audit(adminId, "admin_retry_job", "job", jobId);
    return { success: true };
  }

  async function listDLQ({ limit = 50, offset = 0 }) {
    const bounds = safeBounds(limit, offset);
    return await adminJobOpsRepository.listDLQ({
      limit: bounds.limit,
      offset: bounds.offset,
    });
  }

  async function reprocessDLQ(dlqId, adminId, reason) {
    const entry = await adminJobOpsRepository.findDLQById(dlqId);
    if (!entry) return { success: false, error: "DLQ entry not found" };
    if (entry.reprocessed_at) {
      return { success: false, error: "DLQ entry already reprocessed" };
    }

    const job = await adminJobOpsRepository.findJobById(entry.job_id);
    if (!job) return { success: false, error: "Job not found" };

    try {
      await adminJobOpsRepository.reprocessDLQEntry({
        dlqId,
        jobId: entry.job_id,
        now: nowIso(),
      });
    } catch (error) {
      if (error.message === "Job not found") {
        return { success: false, error: "Job not found" };
      }
      if (error.message === "DLQ entry not found or already reprocessed") {
        return { success: false, error: "DLQ entry already reprocessed" };
      }
      throw error;
    }

    await audit(adminId, "admin_reprocess_dlq", "job", entry.job_id, {
      dlqId,
      reason,
    });
    return { success: true, jobId: entry.job_id, dlqId };
  }

  async function getJobStepHistory(jobId) {
    return await adminJobOpsRepository.listJobStepHistory(jobId);
  }

  return {
    getJobMetrics,
    listJobs,
    retryJob,
    listDLQ,
    reprocessDLQ,
    getJobStepHistory,
  };
}

module.exports = {
  createAdminJobOpsService,
};
