process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAdminGiftOpsRepository,
} = require("../src/database/admin-gift-ops-repository");

const NOW = "2026-06-27T10:00:00.000Z";
const USER_ID = "gift_ops_repo_user";

let db;
let repository;

async function insertUser() {
  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, created_at, risk_level)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(USER_ID, "sender@example.com", "Sender Example", NOW, "low");
}

async function insertGiftOrder({
  id,
  status = "scheduled",
  dispatchStatus = "pending",
  deliveryMode = "scheduled",
  sendAt = "2026-06-27T10:10:00.000Z",
  channelsJson = JSON.stringify(["email"]),
  recipientPhone = "+61406371221",
  recipientEmail = "recipient@example.com",
  shareUrl = "https://share.local/s/gift-share-token",
  nextRetryAt = null,
  overdueDetectedAt = null,
  firstDispatchStartedAt = null,
  lastDispatchCompletedAt = null,
  lastSuccessfulDeliveryAt = null,
  deliveryLagMs = null,
  createdAt = "2026-06-27T09:00:00.000Z",
  updatedAt = createdAt,
} = {}) {
  await db
    .prepare(
      `INSERT INTO gift_orders (
        id,
        sender_user_id,
        content_type,
        content_id,
        status,
        dispatch_status,
        delivery_mode,
        send_at,
        sender_timezone,
        channels_json,
        recipient_phone,
        recipient_email,
        message,
        share_token_id,
        share_url,
        claim_policy,
        expires_in_days,
        dispatch_attempts,
        content_snapshot_json,
        next_retry_at,
        first_dispatch_started_at,
        last_dispatch_completed_at,
        last_successful_delivery_at,
        delivery_lag_ms,
        overdue_detected_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      USER_ID,
      "song",
      `${id}_track`,
      status,
      dispatchStatus,
      deliveryMode,
      sendAt,
      "Australia/Perth",
      channelsJson,
      recipientPhone,
      recipientEmail,
      "Repository test gift",
      `${id}_share`,
      shareUrl,
      "app_only",
      30,
      0,
      JSON.stringify({ title: `${id} title` }),
      nextRetryAt,
      firstDispatchStartedAt,
      lastDispatchCompletedAt,
      lastSuccessfulDeliveryAt,
      deliveryLagMs,
      overdueDetectedAt,
      createdAt,
      updatedAt,
    );
}

async function insertOutbox({
  id,
  giftOrderId,
  channel = "email",
  recipient = "recipient@example.com",
  status = "pending",
  attemptCount = 0,
  providerName = "resend",
  receiptStatus = null,
  sendAfter = "2026-06-27T10:00:00.000Z",
  nextRetryAt = null,
  createdAt = "2026-06-27T09:00:00.000Z",
  updatedAt = createdAt,
} = {}) {
  await db
    .prepare(
      `INSERT INTO gift_delivery_outbox (
        id,
        gift_order_id,
        channel,
        recipient,
        status,
        attempt_count,
        provider_name,
        receipt_status,
        send_after,
        next_retry_at,
        payload_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      giftOrderId,
      channel,
      recipient,
      status,
      attemptCount,
      providerName,
      receiptStatus,
      sendAfter,
      nextRetryAt,
      JSON.stringify({ channel }),
      createdAt,
      updatedAt,
    );
}

async function insertIncident({
  id,
  key,
  giftOrderId,
  outboxId = null,
  type = "gift_overdue",
  severity = "warning",
  status = "open",
  updatedAt = "2026-06-27T10:00:00.000Z",
} = {}) {
  await db
    .prepare(
      `INSERT INTO gift_delivery_incidents (
        id,
        incident_key,
        incident_type,
        severity,
        status,
        gift_order_id,
        outbox_id,
        resource_type,
        resource_id,
        summary,
        detail,
        metadata_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      key,
      type,
      severity,
      status,
      giftOrderId,
      outboxId,
      "gift_order",
      giftOrderId,
      "Gift delivery issue",
      "Repository test incident",
      JSON.stringify({ source: "test" }),
      "2026-06-27T09:00:00.000Z",
      updatedAt,
    );
}

describe("AdminGiftOpsRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAdminGiftOpsRepository(db);
    await insertUser();
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("getOverviewCounts returns gift status and open incident totals", async () => {
    await insertGiftOrder({ id: "gift_due_soon" });
    await insertGiftOrder({
      id: "gift_overdue",
      status: "dispatch_retry",
      dispatchStatus: "partial_retry",
      nextRetryAt: "2026-06-27T09:55:00.000Z",
      overdueDetectedAt: "2026-06-27T10:00:00.000Z",
      lastDispatchCompletedAt: "2026-06-27T09:30:00.000Z",
    });
    await insertGiftOrder({
      id: "gift_dispatched",
      status: "dispatched",
      dispatchStatus: "sent",
      lastDispatchCompletedAt: "2026-06-27T08:30:00.000Z",
    });
    await insertIncident({
      id: "incident_open",
      key: "gift_overdue:open",
      giftOrderId: "gift_overdue",
    });
    await insertIncident({
      id: "incident_ack",
      key: "gift_overdue:ack",
      giftOrderId: "gift_overdue",
      status: "acknowledged",
    });
    await insertIncident({
      id: "incident_resolved",
      key: "gift_overdue:resolved",
      giftOrderId: "gift_overdue",
      status: "resolved",
    });

    const result = await repository.getOverviewCounts({
      now: NOW,
      dueSoon: "2026-06-27T10:15:00.000Z",
      dayAgo: "2026-06-26T10:00:00.000Z",
    });

    assert.equal(Number(result.counts.scheduled_count), 1);
    assert.equal(Number(result.counts.retrying_count), 1);
    assert.equal(Number(result.counts.dispatched_count), 1);
    assert.equal(Number(result.counts.due_soon_count), 1);
    assert.equal(Number(result.counts.overdue_count), 1);
    assert.equal(Number(result.counts.partial_count), 1);
    assert.equal(Number(result.counts.sent_last_24h), 2);
    assert.equal(Number(result.incidents.open_count), 1);
    assert.equal(Number(result.incidents.acknowledged_count), 1);
  });

  test("listOrders applies dynamic filters and returns joined counts", async () => {
    await insertGiftOrder({
      id: "gift_matching",
      channelsJson: JSON.stringify(["sms", "email"]),
      overdueDetectedAt: "2026-06-27T10:00:00.000Z",
      createdAt: "2026-06-27T09:30:00.000Z",
    });
    await insertGiftOrder({
      id: "gift_other",
      recipientEmail: "other@example.com",
      channelsJson: JSON.stringify(["sms"]),
      createdAt: "2026-06-27T09:40:00.000Z",
    });
    await insertOutbox({
      id: "outbox_matching_sent",
      giftOrderId: "gift_matching",
      channel: "email",
      status: "sent",
    });
    await insertOutbox({
      id: "outbox_matching_failed",
      giftOrderId: "gift_matching",
      channel: "sms",
      recipient: "+61406371221",
      status: "failed",
      providerName: "twilio",
    });
    await insertIncident({
      id: "incident_matching",
      key: "gift_matching:open",
      giftOrderId: "gift_matching",
    });

    const rows = await repository.listOrders(
      {
        channel: "email",
        overdue: "true",
        search: "recipient@example.com",
      },
      { limit: 10, offset: 0 },
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "gift_matching");
    assert.equal(rows[0].sender_email, "sender@example.com");
    assert.equal(Number(rows[0].outbox_count), 2);
    assert.equal(Number(rows[0].sent_count), 1);
    assert.equal(Number(rows[0].failed_count), 1);
    assert.equal(Number(rows[0].open_incident_count), 1);
  });

  test("order detail helpers return order, outbox, incidents, and audit logs", async () => {
    await insertGiftOrder({ id: "gift_detail" });
    await insertOutbox({
      id: "outbox_detail",
      giftOrderId: "gift_detail",
      status: "sent",
    });
    await insertIncident({
      id: "incident_detail",
      key: "gift_detail:open",
      giftOrderId: "gift_detail",
      outboxId: "outbox_detail",
    });
    await db
      .prepare(
        `INSERT INTO audit_logs (
          id, user_id, action, resource_type, resource_id, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "audit_detail",
        "admin_user",
        "gift_manual_note",
        "gift_order",
        "gift_detail",
        JSON.stringify({ note: "looks good" }),
        NOW,
      );

    const order = await repository.getOrderById("gift_detail");
    const outbox = await repository.listOrderOutbox("gift_detail");
    const incidents = await repository.listOrderIncidents("gift_detail");
    const auditLogs = await repository.listOrderAuditLogs("gift_detail");

    assert.equal(order.id, "gift_detail");
    assert.equal(outbox[0].id, "outbox_detail");
    assert.equal(incidents[0].id, "incident_detail");
    assert.deepEqual(auditLogs[0], {
      id: "audit_detail",
      user_id: "admin_user",
      action: "gift_manual_note",
      metadata_json: JSON.stringify({ note: "looks good" }),
      created_at: NOW,
    });
  });

  test("listOutbox and listIncidents keep ops filters in the repository", async () => {
    await insertGiftOrder({
      id: "gift_ops_filters",
      overdueDetectedAt: "2026-06-27T10:00:00.000Z",
    });
    await insertGiftOrder({ id: "gift_ops_other" });
    await insertOutbox({
      id: "outbox_email_retry",
      giftOrderId: "gift_ops_filters",
      channel: "email",
      attemptCount: 2,
      providerName: "resend",
      status: "failed",
      receiptStatus: "bounced",
    });
    await insertOutbox({
      id: "outbox_sms_pending",
      giftOrderId: "gift_ops_filters",
      channel: "sms",
      recipient: "+61406371221",
      providerName: "twilio",
    });
    await insertIncident({
      id: "incident_open",
      key: "gift_ops_filters:open",
      giftOrderId: "gift_ops_filters",
      status: "open",
      updatedAt: "2026-06-27T10:05:00.000Z",
    });
    await insertIncident({
      id: "incident_ack",
      key: "gift_ops_filters:ack",
      giftOrderId: "gift_ops_filters",
      status: "acknowledged",
      updatedAt: "2026-06-27T10:04:00.000Z",
    });
    await insertIncident({
      id: "incident_resolved",
      key: "gift_ops_filters:resolved",
      giftOrderId: "gift_ops_filters",
      status: "resolved",
      updatedAt: "2026-06-27T10:03:00.000Z",
    });

    const outboxRows = await repository.listOutbox(
      {
        provider: "resend",
        channel: "email",
        status: "failed",
        receiptStatus: "bounced",
        attemptMin: "2",
        attemptMax: "2",
        overdue: "true",
      },
      { limit: 10, offset: 0 },
    );
    assert.deepEqual(outboxRows.map((row) => row.id), ["outbox_email_retry"]);

    const activeIncidents = await repository.listIncidents({}, { limit: 10, offset: 0 });
    assert.deepEqual(activeIncidents.map((row) => row.id), [
      "incident_open",
      "incident_ack",
    ]);

    const resolvedIncidents = await repository.listIncidents(
      { status: "resolved" },
      { limit: 10, offset: 0 },
    );
    assert.deepEqual(resolvedIncidents.map((row) => row.id), ["incident_resolved"]);
  });
});
