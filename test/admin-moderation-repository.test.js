process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAdminModerationRepository,
} = require("../src/database/admin-moderation-repository");
const { createEventsRepository } = require("../src/database/events-repository");
const {
  createAdminAuditService,
} = require("../src/services/admin/audit-service");
const {
  createAdminModerationService,
} = require("../src/services/admin/moderation-service");

let db;
let repository;

async function seedVersion({
  userId = "user_mod_repo",
  trackId,
  versionId,
  status = "blocked",
  createdAt,
  title = "Moderated Song",
  occasion = "birthday",
  recipientName = "Maya",
  reason = "policy",
  details = { category: "lyrics" },
}) {
  await db
    .prepare("INSERT OR IGNORE INTO users (id, created_at) VALUES (?, ?)")
    .run(userId, "2026-06-27T08:00:00.000Z");
  await db
    .prepare(
      `INSERT OR IGNORE INTO tracks
        (id, user_id, status, title, occasion, recipient_name, latest_version, created_at, updated_at)
       VALUES (?, ?, 'ready', ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      trackId,
      userId,
      title,
      occasion,
      recipientName,
      "2026-06-27T08:30:00.000Z",
      "2026-06-27T08:30:00.000Z",
    );
  await db
    .prepare(
      `INSERT INTO track_versions
        (id, track_id, version_num, status, render_type, params_hash, moderation_status, moderation_reason, moderation_details_json, created_at)
       VALUES (?, ?, 1, 'failed', 'preview', ?, ?, ?, ?, ?)`,
    )
    .run(
      versionId,
      trackId,
      `${versionId}_hash`,
      status,
      reason,
      JSON.stringify(details),
      createdAt,
    );
}

describe("AdminModerationRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAdminModerationRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("listBlockedVersions returns blocked track versions ordered by created_at descending", async () => {
    await seedVersion({
      trackId: "track_mod_old",
      versionId: "version_mod_old",
      status: "blocked",
      createdAt: "2026-06-27T09:00:00.000Z",
      title: "Old Blocked Song",
    });
    await seedVersion({
      trackId: "track_mod_new",
      versionId: "version_mod_new",
      status: "blocked",
      createdAt: "2026-06-27T10:00:00.000Z",
      title: "New Blocked Song",
    });
    await seedVersion({
      trackId: "track_mod_approved",
      versionId: "version_mod_approved",
      status: "approved",
      createdAt: "2026-06-27T11:00:00.000Z",
      title: "Approved Song",
    });

    const rows = await repository.listBlockedVersions({ limit: 10, offset: 0 });

    assert.deepEqual(
      rows.map((row) => ({
        id: row.id,
        track_id: row.track_id,
        title: row.title,
        moderation_status: row.moderation_status,
      })),
      [
        {
          id: "version_mod_new",
          track_id: "track_mod_new",
          title: "New Blocked Song",
          moderation_status: "blocked",
        },
        {
          id: "version_mod_old",
          track_id: "track_mod_old",
          title: "Old Blocked Song",
          moderation_status: "blocked",
        },
      ],
    );
  });

  test("approveBlockedVersion approves only blocked versions and records the override reason", async () => {
    await seedVersion({
      trackId: "track_mod_override",
      versionId: "version_mod_override",
      status: "blocked",
      createdAt: "2026-06-27T09:00:00.000Z",
    });

    assert.deepEqual(
      await repository.approveBlockedVersion({
        versionId: "version_mod_override",
        reason: "reviewed and safe",
      }),
      { status: "approved" },
    );

    assert.deepEqual(
      await db
        .prepare(
          "SELECT moderation_status, moderation_reason FROM track_versions WHERE id = ?",
        )
        .get("version_mod_override"),
      {
        moderation_status: "approved",
        moderation_reason: "Admin override: reviewed and safe",
      },
    );
  });

  test("approveBlockedVersion distinguishes missing and non-blocked versions", async () => {
    await seedVersion({
      trackId: "track_mod_already_approved",
      versionId: "version_mod_already_approved",
      status: "approved",
      createdAt: "2026-06-27T09:00:00.000Z",
    });

    assert.deepEqual(
      await repository.approveBlockedVersion({
        versionId: "missing_version",
        reason: "safe",
      }),
      { status: "not_found" },
    );
    assert.deepEqual(
      await repository.approveBlockedVersion({
        versionId: "version_mod_already_approved",
        reason: "safe",
      }),
      { status: "not_blocked", moderationStatus: "approved" },
    );
  });
});

describe("AdminModerationService repository integration", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("getModerationQueue delegates bounded pagination to the repository", async () => {
    const calls = [];
    const service = createAdminModerationService({
      adminModerationRepository: {
        listBlockedVersions: async (args) => {
          calls.push(args);
          return [{ id: "version_from_repo" }];
        },
      },
      audit: async () => {},
    });

    assert.deepEqual(await service.getModerationQueue({ limit: 500, offset: -10 }), [
      { id: "version_from_repo" },
    ]);
    assert.deepEqual(calls, [{ limit: 100, offset: 0 }]);
  });

  test("overrideModeration audits only successful blocked-version approvals", async () => {
    await seedVersion({
      trackId: "track_mod_service",
      versionId: "version_mod_service",
      status: "blocked",
      createdAt: "2026-06-27T09:00:00.000Z",
    });
    const service = createAdminModerationService({
      adminModerationRepository: createAdminModerationRepository(db),
      audit: createAdminAuditService({
        eventsRepository: createEventsRepository(db),
      }).audit,
    });

    assert.deepEqual(
      await service.overrideModeration(
        "version_mod_service",
        "admin_moderator",
        "manual review passed",
      ),
      { success: true },
    );

    const auditRow = await db
      .prepare(
        "SELECT action, resource_type, resource_id, metadata_json FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get("admin_moderator");
    assert.equal(auditRow.action, "admin_moderation_override");
    assert.equal(auditRow.resource_type, "track_version");
    assert.equal(auditRow.resource_id, "version_mod_service");
    assert.deepEqual(JSON.parse(auditRow.metadata_json), {
      reason: "manual review passed",
      admin_id: "admin_moderator",
      actor: "admin",
    });

    assert.deepEqual(
      await service.overrideModeration(
        "missing_version",
        "admin_moderator",
        "manual review passed",
      ),
      { success: false, error: "Track version not found" },
    );
    assert.deepEqual(
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_logs WHERE user_id = ? AND action = ?",
        )
        .get("admin_moderator", "admin_moderation_override"),
      { count: 1 },
    );
  });
});
