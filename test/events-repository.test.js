process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { createEventsRepository } = require("../src/database/events-repository");

let db;
let repository;

async function insertEvent(id, eventName, userId, createdAt) {
  await db
    .prepare(
      `INSERT INTO events (id, event_name, user_id, resource_type, resource_id, metadata_json, ip_address, user_agent, created_at)
       VALUES (?, ?, ?, 'track', ?, ?, '127.0.0.1', 'test-agent', ?)`,
    )
    .run(
      id,
      eventName,
      userId,
      `track_${id}`,
      JSON.stringify({ id }),
      createdAt,
    );
}

describe("EventsRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createEventsRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("insertEvent is idempotent by caller supplied id", async () => {
    const first = await repository.insertEvent({
      id: "evt_repo_11111111",
      eventName: "auth_completed",
      userId: "user_repo",
      metadataJson: JSON.stringify({ method: "apple" }),
    });
    const duplicate = await repository.insertEvent({
      id: "evt_repo_11111111",
      eventName: "auth_completed",
      userId: "user_repo",
    });

    assert.equal(first.changes, 1);
    assert.equal(duplicate.changes, 0);
    const rows = await db
      .prepare("SELECT * FROM events WHERE id = ?")
      .all("evt_repo_11111111");
    assert.equal(rows.length, 1);
    assert.equal(JSON.parse(rows[0].metadata_json).method, "apple");
  });

  test("queryEvents applies filters, ordering, limit, and offset", async () => {
    await insertEvent("evt_repo_a", "auth_completed", "user_a", "2026-06-25T10:00:00.000Z");
    await insertEvent("evt_repo_b", "auth_completed", "user_a", "2026-06-25T11:00:00.000Z");
    await insertEvent("evt_repo_c", "story_start", "user_a", "2026-06-25T12:00:00.000Z");

    const rows = await repository.queryEvents({
      eventName: "auth_completed",
      userId: "user_a",
      startDate: "2026-06-25T09:30:00.000Z",
      limit: 1,
      offset: 0,
    });

    assert.deepEqual(
      rows.map((row) => row.id),
      ["evt_repo_b"],
    );
  });

  test("dashboard count helpers preserve event service shapes", async () => {
    await insertEvent("evt_repo_a", "auth_completed", "user_a", "2026-06-25T10:00:00.000Z");
    await insertEvent("evt_repo_b", "auth_completed", "user_b", "2026-06-25T11:00:00.000Z");
    await insertEvent("evt_repo_c", "story_start", "user_a", "2026-06-26T12:00:00.000Z");

    const count = await repository.countByNameSince(
      "auth_completed",
      "2026-06-25T00:00:00.000Z",
    );
    assert.equal(count.count, 2);

    const totals = await repository.getEventCountsSince("2026-06-25T00:00:00.000Z");
    assert.deepEqual(
      totals.map((row) => [row.event_name, row.count]),
      [
        ["auth_completed", 2],
        ["story_start", 1],
      ],
    );

    const daily = await repository.getDailyEventCountsSince(
      "auth_completed",
      "2026-06-25T00:00:00.000Z",
    );
    assert.deepEqual(daily, [{ date: "2026-06-25", count: 2 }]);

    const funnel = await repository.getFunnelCountsSince(
      "story_start",
      "auth_completed",
      "2026-06-25T00:00:00.000Z",
    );
    assert.deepEqual(funnel, { startCount: 1, endCount: 2 });
  });

  test("getUserEvents caps persistence to the supplied limit", async () => {
    await insertEvent("evt_repo_a", "auth_completed", "user_a", "2026-06-25T10:00:00.000Z");
    await insertEvent("evt_repo_b", "story_start", "user_a", "2026-06-25T11:00:00.000Z");
    await insertEvent("evt_repo_c", "story_confirm", "user_b", "2026-06-25T12:00:00.000Z");

    const rows = await repository.getUserEvents("user_a", 1);

    assert.deepEqual(
      rows.map((row) => row.id),
      ["evt_repo_b"],
    );
  });

  test("admin analytics helpers preserve strict after-window and cohort semantics", async () => {
    await insertEvent("evt_admin_boundary", "auth_completed", "user_boundary", "2026-06-25T00:00:00.000Z");
    await insertEvent("evt_admin_a_start", "auth_completed", "user_a", "2026-06-25T10:00:00.000Z");
    await insertEvent("evt_admin_a_end", "create_started", "user_a", "2026-06-25T10:05:00.000Z");
    await insertEvent("evt_admin_b_start", "auth_completed", "user_b", "2026-06-25T11:00:00.000Z");
    await insertEvent("evt_admin_b_end_before", "create_started", "user_b", "2026-06-25T10:59:00.000Z");
    await insertEvent("evt_admin_null_user", "auth_completed", null, "2026-06-25T12:00:00.000Z");

    const cutoff = "2026-06-25T00:00:00.000Z";
    const counts = await repository.getAdminEventCountsAfter(cutoff);
    const countMap = Object.fromEntries(counts.map((row) => [row.event_name, row.count]));
    assert.equal(countMap.auth_completed, 3);
    assert.equal(countMap.create_started, 2);

    const daily = await repository.getAdminDailyEventCountsAfter("auth_completed", cutoff);
    assert.deepEqual(daily, [{ date: "2026-06-25", count: 3 }]);

    const startUsers = await repository.countDistinctUsersForEventAfter(
      "auth_completed",
      cutoff,
    );
    assert.equal(startUsers.c, 2);

    const convertedUsers = await repository.countDistinctUsersConvertedAfter(
      "auth_completed",
      "create_started",
      cutoff,
    );
    assert.equal(convertedUsers.c, 1);
  });

  test("admin user analytics helpers preserve selected event columns and audit row shape", async () => {
    await insertEvent("evt_admin_user_old", "auth_completed", "user_a", "2026-06-25T10:00:00.000Z");
    await insertEvent("evt_admin_user_new", "create_started", "user_a", "2026-06-25T11:00:00.000Z");
    await insertEvent("evt_admin_user_other", "auth_completed", "user_b", "2026-06-25T12:00:00.000Z");

    const rows = await repository.getAdminUserEvents("user_a", 1);
    assert.deepEqual(Object.keys(rows[0]).sort(), [
      "created_at",
      "event_name",
      "id",
      "metadata_json",
      "resource_id",
      "resource_type",
      "user_id",
    ]);
    assert.equal(rows[0].id, "evt_admin_user_new");

    const metadataJson = JSON.stringify({
      admin_id: "admin_1",
      admin_email: "admin@porizo.app",
      target_user_id: "user_a",
      event_count: rows.length,
    });
    await repository.insertUserAnalyticsReadAudit({
      id: "audit_admin_user_read",
      adminId: "admin_1",
      targetUserId: "user_a",
      metadataJson,
      createdAt: "2026-06-25T12:00:00.000Z",
    });

    const auditRow = await db
      .prepare("SELECT * FROM audit_logs WHERE id = ?")
      .get("audit_admin_user_read");
    assert.equal(auditRow.user_id, "admin_1");
    assert.equal(auditRow.action, "analytics.user.read");
    assert.equal(auditRow.resource_type, "user_analytics");
    assert.equal(auditRow.resource_id, "user_a");
    assert.deepEqual(JSON.parse(auditRow.metadata_json), JSON.parse(metadataJson));
  });

  test("insertAuditLog preserves generic audit row shape", async () => {
    const result = await repository.insertAuditLog({
      id: "audit_repo_generic",
      userId: "admin_generic",
      action: "admin_lock_user",
      resourceType: "user",
      resourceId: "user_locked",
      metadataJson: JSON.stringify({
        actor: "admin",
        admin_id: "admin_generic",
        reason: "risk review",
      }),
      createdAt: "2026-06-25T13:00:00.000Z",
    });

    assert.equal(result.changes, 1);

    const auditRow = await db
      .prepare("SELECT * FROM audit_logs WHERE id = ?")
      .get("audit_repo_generic");
    assert.equal(auditRow.user_id, "admin_generic");
    assert.equal(auditRow.action, "admin_lock_user");
    assert.equal(auditRow.resource_type, "user");
    assert.equal(auditRow.resource_id, "user_locked");
    assert.equal(auditRow.created_at, "2026-06-25T13:00:00.000Z");
    assert.deepEqual(JSON.parse(auditRow.metadata_json), {
      actor: "admin",
      admin_id: "admin_generic",
      reason: "risk review",
    });
  });
});
