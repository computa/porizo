process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createGiftDeliveryIncidentRepository,
} = require("../src/database/gift-delivery-incident-repository");
const {
  acknowledgeGiftIncident,
  resolveGiftIncident,
  resolveGiftIncidentsForGift,
  upsertGiftIncident,
} = require("../src/services/gift-delivery-ops");

let db;
let repository;

describe("gift delivery incident repository boundary", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createGiftDeliveryIncidentRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("upsert creates incidents and reopening clears acknowledgement/resolution state", async () => {
    const created = await upsertGiftIncident(db, {
      incidentKey: "gift_overdue:repo",
      incidentType: "gift_overdue",
      severity: "warning",
      giftOrderId: "gift_repo",
      outboxId: "outbox_repo",
      resourceType: "gift_order",
      resourceId: "gift_repo",
      summary: "Gift is overdue",
      detail: "First detail",
      metadata: { attempt: 1 },
    });
    assert.equal(created.status, "open");
    assert.equal(created.incident_key, "gift_overdue:repo");
    assert.equal(created.metadata_json, JSON.stringify({ attempt: 1 }));

    const acknowledged = await acknowledgeGiftIncident(
      db,
      "gift_overdue:repo",
      "admin_repo",
    );
    assert.equal(acknowledged.status, "acknowledged");
    assert.equal(acknowledged.acknowledged_by, "admin_repo");
    assert.ok(acknowledged.acknowledged_at);

    const resolved = await resolveGiftIncident(
      db,
      "gift_overdue:repo",
      "resolver_repo",
    );
    assert.equal(resolved.status, "resolved");
    assert.equal(resolved.resolved_by, "resolver_repo");
    assert.ok(resolved.resolved_at);

    const reopened = await upsertGiftIncident(db, {
      incidentKey: "gift_overdue:repo",
      incidentType: "gift_overdue",
      severity: "critical",
      summary: "Gift is overdue again",
      metadata: { attempt: 2 },
    });

    assert.equal(reopened.status, "open");
    assert.equal(reopened.severity, "critical");
    assert.equal(reopened.gift_order_id, "gift_repo");
    assert.equal(reopened.outbox_id, "outbox_repo");
    assert.equal(reopened.acknowledged_at, null);
    assert.equal(reopened.acknowledged_by, null);
    assert.equal(reopened.resolved_at, null);
    assert.equal(reopened.resolved_by, null);
    assert.equal(reopened.metadata_json, JSON.stringify({ attempt: 2 }));
  });

  test("upsert with reopen false preserves acknowledged status", async () => {
    await upsertGiftIncident(db, {
      incidentKey: "gift_retry_pending:repo",
      incidentType: "gift_dispatch_retry",
      severity: "warning",
      giftOrderId: "gift_repo",
      summary: "Retry pending",
    });
    await acknowledgeGiftIncident(db, "gift_retry_pending:repo", "admin_repo");

    const updated = await upsertGiftIncident(db, {
      incidentKey: "gift_retry_pending:repo",
      incidentType: "gift_dispatch_retry",
      severity: "warning",
      giftOrderId: "gift_repo",
      summary: "Retry still pending",
      reopen: false,
    });

    assert.equal(updated.status, "acknowledged");
    assert.equal(updated.summary, "Retry still pending");
    assert.equal(updated.acknowledged_by, "admin_repo");
    assert.ok(updated.acknowledged_at);
  });

  test("resolveGiftIncidentsForGift resolves all or specific incident types", async () => {
    await upsertGiftIncident(db, {
      incidentKey: "gift_overdue:repo_bulk",
      incidentType: "gift_overdue",
      giftOrderId: "gift_bulk",
      summary: "Overdue",
    });
    await upsertGiftIncident(db, {
      incidentKey: "gift_retry_pending:repo_bulk",
      incidentType: "gift_dispatch_retry",
      giftOrderId: "gift_bulk",
      summary: "Retry pending",
    });

    await resolveGiftIncidentsForGift(db, "gift_bulk", ["gift_overdue"]);

    const overdue = await repository.getByKey("gift_overdue:repo_bulk");
    const retry = await repository.getByKey("gift_retry_pending:repo_bulk");
    assert.equal(overdue.status, "resolved");
    assert.equal(retry.status, "open");

    await resolveGiftIncidentsForGift(db, "gift_bulk");

    const retryAfterBulkResolve = await repository.getByKey(
      "gift_retry_pending:repo_bulk",
    );
    assert.equal(retryAfterBulkResolve.status, "resolved");
  });
});
