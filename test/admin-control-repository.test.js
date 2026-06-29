process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAdminControlRepository,
} = require("../src/database/admin-control-repository");
const { createEventsRepository } = require("../src/database/events-repository");
const {
  createAdminAuditService,
} = require("../src/services/admin/audit-service");
const {
  createAdminControlPlaneService,
} = require("../src/services/admin/control-plane-service");

let db;
let repository;

describe("AdminControlRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAdminControlRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("listProviderStatus returns providers ordered by provider_name", async () => {
    await db.prepare("DELETE FROM provider_status").run();
    await db
      .prepare(
        `INSERT INTO provider_status
          (id, provider_name, status, updated_at)
         VALUES
          ('prov_z', 'zeta', 'active', ?),
          ('prov_a', 'alpha', 'paused', ?)`,
      )
      .run("2026-06-27T10:00:00.000Z", "2026-06-27T10:01:00.000Z");

    const providers = await repository.listProviderStatus();

    assert.deepEqual(
      providers.map((provider) => provider.provider_name),
      ["alpha", "zeta"],
    );
  });

  test("setProviderStatus upserts pause metadata and clears it when active", async () => {
    await db.prepare("DELETE FROM provider_status").run();

    await repository.setProviderStatus({
      providerName: "replicate",
      status: "paused",
      adminId: "admin_ops",
      reason: "incident",
      now: "2026-06-27T10:00:00.000Z",
    });

    assert.deepEqual(
      await db
        .prepare(
          "SELECT id, provider_name, status, paused_at, paused_by, pause_reason, updated_at FROM provider_status WHERE provider_name = ?",
        )
        .get("replicate"),
      {
        id: "prov_replicate",
        provider_name: "replicate",
        status: "paused",
        paused_at: "2026-06-27T10:00:00.000Z",
        paused_by: "admin_ops",
        pause_reason: "incident",
        updated_at: "2026-06-27T10:00:00.000Z",
      },
    );

    await repository.setProviderStatus({
      providerName: "replicate",
      status: "active",
      adminId: "admin_ops",
      reason: "resolved",
      now: "2026-06-27T10:05:00.000Z",
    });

    const row = await db
      .prepare(
        "SELECT status, paused_at, paused_by, pause_reason, updated_at FROM provider_status WHERE provider_name = ?",
      )
      .get("replicate");

    assert.deepEqual(row, {
      status: "active",
      paused_at: null,
      paused_by: null,
      pause_reason: null,
      updated_at: "2026-06-27T10:05:00.000Z",
    });
  });

  test("listQueueStatus returns queues ordered by queue_name", async () => {
    await db.prepare("DELETE FROM queue_status").run();
    await db
      .prepare(
        `INSERT INTO queue_status
          (id, queue_name, status, updated_at)
         VALUES
          ('q_z', 'q.zeta', 'active', ?),
          ('q_a', 'q.alpha', 'draining', ?)`,
      )
      .run("2026-06-27T10:00:00.000Z", "2026-06-27T10:01:00.000Z");

    const queues = await repository.listQueueStatus();

    assert.deepEqual(
      queues.map((queue) => queue.queue_name),
      ["q.alpha", "q.zeta"],
    );
  });

  test("setQueueStatus updates pause metadata and clears it when active", async () => {
    await db.prepare("DELETE FROM queue_status").run();
    await db
      .prepare(
        `INSERT INTO queue_status
          (id, queue_name, status, updated_at)
         VALUES ('q_render', 'q.render.music.api', 'active', ?)`,
      )
      .run("2026-06-27T09:00:00.000Z");

    await repository.setQueueStatus({
      queueName: "q.render.music.api",
      status: "paused",
      adminId: "admin_ops",
      reason: "provider outage",
      now: "2026-06-27T10:00:00.000Z",
    });

    assert.deepEqual(
      await db
        .prepare(
          "SELECT status, paused_at, paused_by, pause_reason, updated_at FROM queue_status WHERE queue_name = ?",
        )
        .get("q.render.music.api"),
      {
        status: "paused",
        paused_at: "2026-06-27T10:00:00.000Z",
        paused_by: "admin_ops",
        pause_reason: "provider outage",
        updated_at: "2026-06-27T10:00:00.000Z",
      },
    );

    await repository.setQueueStatus({
      queueName: "q.render.music.api",
      status: "active",
      adminId: "admin_ops",
      reason: "resolved",
      now: "2026-06-27T10:05:00.000Z",
    });

    assert.deepEqual(
      await db
        .prepare(
          "SELECT status, paused_at, paused_by, pause_reason, updated_at FROM queue_status WHERE queue_name = ?",
        )
        .get("q.render.music.api"),
      {
        status: "active",
        paused_at: null,
        paused_by: null,
        pause_reason: null,
        updated_at: "2026-06-27T10:05:00.000Z",
      },
    );
  });
});

describe("AdminControlPlaneService repository integration", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAdminControlRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("setProviderStatus delegates persistence and keeps the audit contract", async () => {
    const service = createAdminControlPlaneService({
      adminControlRepository: repository,
      audit: createAdminAuditService({
        eventsRepository: createEventsRepository(db),
      }).audit,
    });

    const result = await service.setProviderStatus(
      "replicate",
      "paused",
      "admin_ops",
      "incident",
    );

    assert.deepEqual(result, { success: true });
    assert.equal(
      (
        await db
          .prepare(
            "SELECT status FROM provider_status WHERE provider_name = ?",
          )
          .get("replicate")
      ).status,
      "paused",
    );

    const auditRow = await db
      .prepare(
        "SELECT action, resource_type, resource_id, metadata_json FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get("admin_ops");

    assert.equal(auditRow.action, "admin_set_provider_paused");
    assert.equal(auditRow.resource_type, "provider");
    assert.equal(auditRow.resource_id, "replicate");
    assert.deepEqual(JSON.parse(auditRow.metadata_json), {
      actor: "admin",
      admin_id: "admin_ops",
      status: "paused",
      reason: "incident",
    });
  });

  test("setQueueStatus delegates persistence and keeps the audit contract", async () => {
    const service = createAdminControlPlaneService({
      adminControlRepository: repository,
      audit: createAdminAuditService({
        eventsRepository: createEventsRepository(db),
      }).audit,
    });

    const result = await service.setQueueStatus(
      "q.moderation.cpu",
      "paused",
      "admin_ops",
      "backpressure",
    );

    assert.deepEqual(result, { success: true });
    assert.equal(
      (
        await db
          .prepare("SELECT status FROM queue_status WHERE queue_name = ?")
          .get("q.moderation.cpu")
      ).status,
      "paused",
    );

    const auditRow = await db
      .prepare(
        "SELECT action, resource_type, resource_id, metadata_json FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get("admin_ops");

    assert.equal(auditRow.action, "admin_set_queue_paused");
    assert.equal(auditRow.resource_type, "queue");
    assert.equal(auditRow.resource_id, "q.moderation.cpu");
    assert.deepEqual(JSON.parse(auditRow.metadata_json), {
      actor: "admin",
      admin_id: "admin_ops",
      status: "paused",
      reason: "backpressure",
    });
  });
});
