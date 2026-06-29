process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAdminOnboardingSampleRepository,
} = require("../src/database/admin-onboarding-sample-repository");
const { createEventsRepository } = require("../src/database/events-repository");
const {
  createAdminAuditService,
} = require("../src/services/admin/audit-service");
const {
  createAdminOnboardingSampleService,
} = require("../src/services/admin/onboarding-sample-service");

let db;
let repository;

describe("AdminOnboardingSampleRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAdminOnboardingSampleRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("listAll returns onboarding samples ordered by created_at", async () => {
    await db.prepare("DELETE FROM onboarding_samples").run();
    await db
      .prepare(
        `INSERT INTO onboarding_samples
          (id, label, audio_url, is_active, created_at)
         VALUES
          ('sample_late', 'Late', '/audio/late.mp3', 0, ?),
          ('sample_early', 'Early', '/audio/early.mp3', 1, ?)`,
      )
      .run("2026-06-27T10:05:00.000Z", "2026-06-27T10:00:00.000Z");

    const samples = await repository.listAll();

    assert.deepEqual(
      samples.map((sample) => sample.id),
      ["sample_early", "sample_late"],
    );
  });

  test("createSample inserts an inactive sample with metadata", async () => {
    await db.prepare("DELETE FROM onboarding_samples").run();

    await repository.createSample({
      id: "sample_new",
      label: "Drive Home",
      audioUrl: "/audio/drive-home.mp3",
      now: "2026-06-27T10:00:00.000Z",
      updatedBy: "admin_audio",
    });

    assert.deepEqual(
      await repository.findById("sample_new"),
      {
        id: "sample_new",
        label: "Drive Home",
        audio_url: "/audio/drive-home.mp3",
        is_active: 0,
        created_at: "2026-06-27T10:00:00.000Z",
        updated_at: "2026-06-27T10:00:00.000Z",
        updated_by: "admin_audio",
      },
    );
  });

  test("updateSample updates allowlisted fields and metadata", async () => {
    await db.prepare("DELETE FROM onboarding_samples").run();
    await repository.createSample({
      id: "sample_update",
      label: "Before",
      audioUrl: "/audio/before.mp3",
      now: "2026-06-27T10:00:00.000Z",
      updatedBy: "admin_audio",
    });

    await repository.updateSample({
      id: "sample_update",
      fields: {
        label: "After",
        audio_url: "https://cdn.example.com/after.mp3",
      },
      now: "2026-06-27T10:05:00.000Z",
      updatedBy: "admin_next",
    });

    assert.deepEqual(
      await repository.findById("sample_update"),
      {
        id: "sample_update",
        label: "After",
        audio_url: "https://cdn.example.com/after.mp3",
        is_active: 0,
        created_at: "2026-06-27T10:00:00.000Z",
        updated_at: "2026-06-27T10:05:00.000Z",
        updated_by: "admin_next",
      },
    );
  });

  test("activateSample makes exactly one sample active", async () => {
    await db.prepare("DELETE FROM onboarding_samples").run();
    await db
      .prepare(
        `INSERT INTO onboarding_samples
          (id, label, audio_url, is_active, updated_at, updated_by)
         VALUES
          ('sample_old', 'Old', '/audio/old.mp3', 1, ?, 'admin_old'),
          ('sample_new', 'New', '/audio/new.mp3', 0, ?, 'admin_old')`,
      )
      .run("2026-06-27T09:00:00.000Z", "2026-06-27T09:00:00.000Z");

    await repository.activateSample({
      id: "sample_new",
      now: "2026-06-27T10:00:00.000Z",
      updatedBy: "admin_audio",
    });

    const rows = await db
      .prepare(
        "SELECT id, is_active, updated_at, updated_by FROM onboarding_samples ORDER BY id",
      )
      .all();

    assert.deepEqual(rows, [
      {
        id: "sample_new",
        is_active: 1,
        updated_at: "2026-06-27T10:00:00.000Z",
        updated_by: "admin_audio",
      },
      {
        id: "sample_old",
        is_active: 0,
        updated_at: "2026-06-27T10:00:00.000Z",
        updated_by: "admin_audio",
      },
    ]);
  });

  test("activateSample rejects a missing sample without changing active state", async () => {
    await db.prepare("DELETE FROM onboarding_samples").run();
    await db
      .prepare(
        `INSERT INTO onboarding_samples
          (id, label, audio_url, is_active, updated_at, updated_by)
         VALUES ('sample_existing', 'Existing', '/audio/existing.mp3', 1, ?, 'admin_old')`,
      )
      .run("2026-06-27T09:00:00.000Z");

    await assert.rejects(
      () =>
        repository.activateSample({
          id: "sample_missing",
          now: "2026-06-27T10:00:00.000Z",
          updatedBy: "admin_audio",
        }),
      /Onboarding sample not found/,
    );

    assert.deepEqual(
      await db
        .prepare(
          "SELECT id, is_active, updated_at, updated_by FROM onboarding_samples",
        )
        .get(),
      {
        id: "sample_existing",
        is_active: 1,
        updated_at: "2026-06-27T09:00:00.000Z",
        updated_by: "admin_old",
      },
    );
  });

  test("deleteSample removes the sample row", async () => {
    await db.prepare("DELETE FROM onboarding_samples").run();
    await repository.createSample({
      id: "sample_delete",
      label: "Delete Me",
      audioUrl: "/audio/delete.mp3",
      now: "2026-06-27T10:00:00.000Z",
      updatedBy: "admin_audio",
    });

    await repository.deleteSample("sample_delete");

    assert.equal(await repository.findById("sample_delete"), undefined);
  });
});

describe("AdminOnboardingSampleService repository integration", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAdminOnboardingSampleRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("createOnboardingSample delegates persistence and keeps audit contract", async () => {
    await db.prepare("DELETE FROM onboarding_samples").run();
    const auditService = createAdminAuditService({
      eventsRepository: createEventsRepository(db),
    });
    const service = createAdminOnboardingSampleService({
      onboardingSampleRepository: repository,
      appConfigRepository: { findActiveOnboardingSample: async () => null },
      audit: auditService.audit,
    });

    const sample = await service.createOnboardingSample(
      { label: "  Drive Home  ", audio_url: "/audio/drive-home.mp3" },
      "admin_audio",
    );

    assert.match(sample.id, /^os_[a-f0-9]{12}$/);
    assert.equal(sample.label, "Drive Home");
    assert.equal(sample.audio_url, "/audio/drive-home.mp3");
    assert.equal(sample.is_active, 0);

    const auditRow = await db
      .prepare(
        "SELECT action, resource_type, resource_id, metadata_json FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get("admin_audio");

    assert.equal(auditRow.action, "admin_create_onboarding_sample");
    assert.equal(auditRow.resource_type, "onboarding_sample");
    assert.equal(auditRow.resource_id, sample.id);
    assert.deepEqual(JSON.parse(auditRow.metadata_json), {
      actor: "admin",
      admin_id: "admin_audio",
      label: "  Drive Home  ",
      audio_url: "/audio/drive-home.mp3",
    });
  });

  test("activateOnboardingSample delegates persistence and keeps audit contract", async () => {
    await db.prepare("DELETE FROM onboarding_samples").run();
    await repository.createSample({
      id: "sample_activate",
      label: "Activate",
      audioUrl: "/audio/activate.mp3",
      now: "2026-06-27T10:00:00.000Z",
      updatedBy: "admin_seed",
    });

    const auditService = createAdminAuditService({
      eventsRepository: createEventsRepository(db),
    });
    const service = createAdminOnboardingSampleService({
      onboardingSampleRepository: repository,
      appConfigRepository: { findActiveOnboardingSample: async () => null },
      audit: auditService.audit,
    });

    const sample = await service.activateOnboardingSample(
      "sample_activate",
      "admin_audio",
    );

    assert.equal(sample.id, "sample_activate");
    assert.equal(sample.is_active, 1);

    const auditRow = await db
      .prepare(
        "SELECT action, resource_type, resource_id, metadata_json FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get("admin_audio");

    assert.equal(auditRow.action, "admin_activate_onboarding_sample");
    assert.equal(auditRow.resource_type, "onboarding_sample");
    assert.equal(auditRow.resource_id, "sample_activate");
    assert.deepEqual(JSON.parse(auditRow.metadata_json), {
      actor: "admin",
      admin_id: "admin_audio",
      label: "Activate",
    });
  });
});
