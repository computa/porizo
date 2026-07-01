const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  createAdminJobOpsService,
} = require("../src/services/admin/job-ops-service");

const FIXED_NOW = "2026-06-29T12:00:00.000Z";

function createJobOpsFixture({ repository = {} } = {}) {
  const audits = [];
  const calls = [];
  const defaults = {
    getJobMetrics: async (payload) => {
      calls.push({ name: "getJobMetrics", payload });
      return { jobsByStatus: [] };
    },
    listJobs: async (payload) => {
      calls.push({ name: "listJobs", payload });
      return [{ id: "job_failed" }];
    },
    findJobById: async (jobId) => {
      calls.push({ name: "findJobById", jobId });
      return { id: jobId, status: "failed" };
    },
    retryFailedJob: async (payload) => {
      calls.push({ name: "retryFailedJob", payload });
      return { changes: 1 };
    },
    listDLQ: async (payload) => {
      calls.push({ name: "listDLQ", payload });
      return [{ id: "dlq_failed" }];
    },
    findDLQById: async (dlqId) => {
      calls.push({ name: "findDLQById", dlqId });
      return { id: dlqId, job_id: "job_dlq", reprocessed_at: null };
    },
    reprocessDLQEntry: async (payload) => {
      calls.push({ name: "reprocessDLQEntry", payload });
    },
    listJobStepHistory: async (jobId) => {
      calls.push({ name: "listJobStepHistory", jobId });
      return [{ job_id: jobId, step: "lyrics" }];
    },
  };

  const service = createAdminJobOpsService({
    adminJobOpsRepository: { ...defaults, ...repository },
    audit: async (...args) => audits.push(args),
    now: () => new Date(FIXED_NOW),
  });

  return { audits, calls, service };
}

describe("AdminJobOpsService", () => {
  test("gets job metrics with stale and failure windows from the injected clock", async () => {
    const { calls, service } = createJobOpsFixture();

    assert.deepEqual(await service.getJobMetrics(), { jobsByStatus: [] });
    assert.deepEqual(calls, [
      {
        name: "getJobMetrics",
        payload: {
          staleBefore: "2026-06-29T11:30:00.000Z",
          failuresAfter: "2026-06-22T12:00:00.000Z",
        },
      },
    ]);
  });

  test("lists jobs and DLQ entries with bounded pagination", async () => {
    const { calls, service } = createJobOpsFixture();

    assert.deepEqual(
      await service.listJobs({
        status: "failed",
        workflowType: "render",
        limit: 500,
        offset: -20,
      }),
      [{ id: "job_failed" }],
    );
    assert.deepEqual(
      await service.listDLQ({ limit: "250", offset: "-5" }),
      [{ id: "dlq_failed" }],
    );
    assert.deepEqual(calls, [
      {
        name: "listJobs",
        payload: {
          status: "failed",
          workflowType: "render",
          limit: 100,
          offset: 0,
        },
      },
      {
        name: "listDLQ",
        payload: {
          limit: 100,
          offset: 0,
        },
      },
    ]);
  });

  test("retries failed jobs and audits only a successful update", async () => {
    const { audits, calls, service } = createJobOpsFixture();

    assert.deepEqual(await service.retryJob("job_failed", "admin_ops"), {
      success: true,
    });
    assert.deepEqual(calls, [
      { name: "findJobById", jobId: "job_failed" },
      {
        name: "retryFailedJob",
        payload: {
          jobId: "job_failed",
          now: FIXED_NOW,
        },
      },
    ]);
    assert.deepEqual(audits, [
      ["admin_ops", "admin_retry_job", "job", "job_failed"],
    ]);
  });

  test("does not audit retry failures", async () => {
    const missing = createJobOpsFixture({
      repository: { findJobById: async () => null },
    });
    assert.deepEqual(await missing.service.retryJob("missing", "admin_ops"), {
      success: false,
      error: "Job not found",
    });
    assert.deepEqual(missing.audits, []);

    const notFailed = createJobOpsFixture({
      repository: {
        findJobById: async () => ({ id: "job_running", status: "running" }),
      },
    });
    assert.deepEqual(
      await notFailed.service.retryJob("job_running", "admin_ops"),
      {
        success: false,
        error: "Job is not failed",
      },
    );
    assert.deepEqual(notFailed.audits, []);

    const race = createJobOpsFixture({
      repository: { retryFailedJob: async () => ({ changes: 0 }) },
    });
    assert.deepEqual(await race.service.retryJob("job_race", "admin_ops"), {
      success: false,
      error: "Job is not failed",
    });
    assert.deepEqual(race.audits, []);
  });

  test("reprocesses DLQ entries and audits the original job", async () => {
    const { audits, calls, service } = createJobOpsFixture();

    assert.deepEqual(
      await service.reprocessDLQ("dlq_failed", "admin_ops", "manual retry"),
      {
        success: true,
        jobId: "job_dlq",
        dlqId: "dlq_failed",
      },
    );
    assert.deepEqual(calls, [
      { name: "findDLQById", dlqId: "dlq_failed" },
      { name: "findJobById", jobId: "job_dlq" },
      {
        name: "reprocessDLQEntry",
        payload: {
          dlqId: "dlq_failed",
          jobId: "job_dlq",
          now: FIXED_NOW,
        },
      },
    ]);
    assert.deepEqual(audits, [
      [
        "admin_ops",
        "admin_reprocess_dlq",
        "job",
        "job_dlq",
        { dlqId: "dlq_failed", reason: "manual retry" },
      ],
    ]);
  });

  test("maps DLQ reprocess failures without auditing", async () => {
    const missingDlq = createJobOpsFixture({
      repository: { findDLQById: async () => null },
    });
    assert.deepEqual(
      await missingDlq.service.reprocessDLQ("missing", "admin_ops", "retry"),
      {
        success: false,
        error: "DLQ entry not found",
      },
    );
    assert.deepEqual(missingDlq.audits, []);

    const alreadyReprocessed = createJobOpsFixture({
      repository: {
        findDLQById: async () => ({
          id: "dlq_done",
          job_id: "job_done",
          reprocessed_at: FIXED_NOW,
        }),
      },
    });
    assert.deepEqual(
      await alreadyReprocessed.service.reprocessDLQ(
        "dlq_done",
        "admin_ops",
        "retry",
      ),
      {
        success: false,
        error: "DLQ entry already reprocessed",
      },
    );
    assert.deepEqual(alreadyReprocessed.audits, []);

    const missingJob = createJobOpsFixture({
      repository: { findJobById: async () => null },
    });
    assert.deepEqual(
      await missingJob.service.reprocessDLQ("dlq_failed", "admin_ops", "retry"),
      {
        success: false,
        error: "Job not found",
      },
    );
    assert.deepEqual(missingJob.audits, []);

    const race = createJobOpsFixture({
      repository: {
        reprocessDLQEntry: async () => {
          throw new Error("DLQ entry not found or already reprocessed");
        },
      },
    });
    assert.deepEqual(
      await race.service.reprocessDLQ("dlq_race", "admin_ops", "retry"),
      {
        success: false,
        error: "DLQ entry already reprocessed",
      },
    );
    assert.deepEqual(race.audits, []);
  });

  test("delegates job step history lookup", async () => {
    const { calls, service } = createJobOpsFixture();

    assert.deepEqual(await service.getJobStepHistory("job_history"), [
      { job_id: "job_history", step: "lyrics" },
    ]);
    assert.deepEqual(calls, [
      { name: "listJobStepHistory", jobId: "job_history" },
    ]);
  });
});
