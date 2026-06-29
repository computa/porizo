const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  createAdminControlPlaneService,
} = require("../src/services/admin/control-plane-service");

function createControlPlaneFixture({
  providers = [],
  queues = [],
} = {}) {
  const audits = [];
  const calls = [];
  const service = createAdminControlPlaneService({
    adminControlRepository: {
      listProviderStatus: async () => {
        calls.push({ name: "listProviderStatus" });
        return providers;
      },
      setProviderStatus: async (payload) => {
        calls.push({ name: "setProviderStatus", payload });
      },
      listQueueStatus: async () => {
        calls.push({ name: "listQueueStatus" });
        return queues;
      },
      setQueueStatus: async (payload) => {
        calls.push({ name: "setQueueStatus", payload });
      },
    },
    audit: async (...args) => audits.push(args),
    now: () => "2026-06-29T10:00:00.000Z",
  });

  return { audits, calls, service };
}

describe("AdminControlPlaneService", () => {
  test("lists provider and queue status through the repository", async () => {
    const { calls, service } = createControlPlaneFixture({
      providers: [{ provider_name: "replicate", status: "active" }],
      queues: [{ queue_name: "q.render.music.api", status: "active" }],
    });

    assert.deepEqual(await service.getProviderStatus(), [
      { provider_name: "replicate", status: "active" },
    ]);
    assert.deepEqual(await service.getQueueStatus(), [
      { queue_name: "q.render.music.api", status: "active" },
    ]);
    assert.deepEqual(calls, [
      { name: "listProviderStatus" },
      { name: "listQueueStatus" },
    ]);
  });

  test("sets provider status with timestamp and provider audit contract", async () => {
    const { audits, calls, service } = createControlPlaneFixture();

    assert.deepEqual(
      await service.setProviderStatus(
        "replicate",
        "paused",
        "admin_ops",
        "incident",
      ),
      { success: true },
    );

    assert.deepEqual(calls, [
      {
        name: "setProviderStatus",
        payload: {
          providerName: "replicate",
          status: "paused",
          adminId: "admin_ops",
          reason: "incident",
          now: "2026-06-29T10:00:00.000Z",
        },
      },
    ]);
    assert.deepEqual(audits, [
      [
        "admin_ops",
        "admin_set_provider_paused",
        "provider",
        "replicate",
        { status: "paused", reason: "incident" },
      ],
    ]);
  });

  test("sets queue status with timestamp and queue audit contract", async () => {
    const { audits, calls, service } = createControlPlaneFixture();

    assert.deepEqual(
      await service.setQueueStatus(
        "q.render.music.api",
        "draining",
        "admin_ops",
        "backpressure",
      ),
      { success: true },
    );

    assert.deepEqual(calls, [
      {
        name: "setQueueStatus",
        payload: {
          queueName: "q.render.music.api",
          status: "draining",
          adminId: "admin_ops",
          reason: "backpressure",
          now: "2026-06-29T10:00:00.000Z",
        },
      },
    ]);
    assert.deepEqual(audits, [
      [
        "admin_ops",
        "admin_set_queue_draining",
        "queue",
        "q.render.music.api",
        { status: "draining", reason: "backpressure" },
      ],
    ]);
  });
});
