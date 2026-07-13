process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createContactDeliveryService,
} = require("../src/services/contact-delivery-service");
const { sendLifecycleEmail } = require("../src/services/email-service");

describe("contact delivery state", () => {
  let db;
  let service;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    service = createContactDeliveryService(db);

    await db.prepare(
      `INSERT INTO users (id, email, email_verified, display_name, risk_level, created_at)
       VALUES ('delivery_user', 'relay@private.icloud.com', 0, 'Delivery User', 'low', ?)`
    ).run("2026-07-11T01:00:00.000Z");
    await db.prepare(
      `INSERT INTO user_contacts (
         id, user_id, type, value_normalized, value_display, verified_at,
         source, is_primary, is_relay, created_at
       ) VALUES ('delivery_contact', 'delivery_user', 'email', ?, ?, NULL,
         'user_entered', 1, 1, ?)`
    ).run(
      "relay@private.icloud.com",
      "Relay@private.icloud.com",
      "2026-07-11T01:00:00.000Z",
    );
    await db.prepare(
      `INSERT INTO user_auth_providers (
         id, user_id, provider, provider_user_id, linked_at, last_used_at, status
       ) VALUES ('delivery_identity', 'delivery_user', 'apple', 'apple_delivery_user', ?, ?, 'active')`
    ).run("2026-07-11T01:00:00.000Z", "2026-07-11T01:00:00.000Z");
    await db.prepare(
      "INSERT INTO entitlements (user_id, tier, songs_remaining, updated_at) VALUES ('delivery_user', 'free', 4, ?)"
    ).run("2026-07-11T01:00:00.000Z");
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("bounce suppresses relay contact and duplicate events are idempotent", async () => {
    const event = {
      provider: "resend",
      eventId: "evt_bounce_1",
      eventType: "email.bounced",
      recipient: "RELAY@private.icloud.com",
      eventAt: "2026-07-11T02:00:00.000Z",
      reason: "Apple relay forwarding disabled",
    };

    const first = await service.recordDeliveryEvent(event);
    const duplicate = await service.recordDeliveryEvent(event);
    const state = await service.getEmailDeliveryState({
      userId: "delivery_user",
      email: event.recipient,
    });

    assert.equal(first.updatedContacts, 1);
    assert.equal(duplicate.updatedContacts, 0);
    assert.equal(duplicate.duplicate, true);
    assert.equal(state.deliveryStatus, "bounced");
    assert.equal(state.isSuppressed, true);
    assert.equal(state.isRelay, true);
    assert.equal(state.bouncedAt, event.eventAt);
    assert.equal(state.suppressionReason, event.reason);

    const eventCount = await db.prepare(
      "SELECT COUNT(*) AS count FROM user_contact_delivery_events WHERE provider = ? AND provider_event_id = ?"
    ).get(event.provider, event.eventId);
    assert.equal(Number(eventCount.count), 1);
  });

  test("delivered event records reachability without verifying contact", async () => {
    await service.recordDeliveryEvent({
      provider: "resend",
      eventId: "evt_delivered_1",
      eventType: "email.delivered",
      recipient: "relay@private.icloud.com",
      eventAt: "2026-07-11T02:00:00.000Z",
    });

    const contact = await db.prepare(
      "SELECT verified_at, delivery_status, delivered_at FROM user_contacts WHERE id = 'delivery_contact'"
    ).get();
    assert.equal(contact.delivery_status, "deliverable");
    assert.equal(contact.delivered_at, "2026-07-11T02:00:00.000Z");
    assert.equal(contact.verified_at, null);
  });

  test("terminal delivery state skips lifecycle sends but preserves identity ownership", async () => {
    await service.recordDeliveryEvent({
      provider: "resend",
      eventId: "evt_complaint_1",
      eventType: "email.complained",
      recipient: "relay@private.icloud.com",
      eventAt: "2026-07-11T03:00:00.000Z",
    });

    let sends = 0;
    const result = await sendLifecycleEmail({
      contactDeliveryService: service,
      userId: "delivery_user",
      email: "relay@private.icloud.com",
      send: async () => {
        sends += 1;
        return { messageId: "should_not_send" };
      },
    });

    assert.deepEqual(result, {
      messageId: null,
      skipped: true,
      reason: "contact_suppressed",
      deliveryStatus: "complained",
    });
    assert.equal(sends, 0);

    const identity = await db.prepare(
      "SELECT user_id, status FROM user_auth_providers WHERE id = 'delivery_identity'"
    ).get();
    const user = await db.prepare(
      "SELECT deleted_at FROM users WHERE id = 'delivery_user'"
    ).get();
    const entitlement = await db.prepare(
      "SELECT songs_remaining FROM entitlements WHERE user_id = 'delivery_user'"
    ).get();
    assert.deepEqual(identity, { user_id: "delivery_user", status: "active" });
    assert.equal(user.deleted_at, null);
    assert.equal(Number(entitlement.songs_remaining), 4);
  });

  test("older delivered callbacks cannot clear a newer suppression", async () => {
    await service.recordDeliveryEvent({
      provider: "resend",
      eventId: "evt_suppressed_new",
      eventType: "email.suppressed",
      recipient: "relay@private.icloud.com",
      eventAt: "2026-07-11T04:00:00.000Z",
      reason: "provider suppression list",
    });
    await service.recordDeliveryEvent({
      provider: "resend",
      eventId: "evt_delivered_old",
      eventType: "email.delivered",
      recipient: "relay@private.icloud.com",
      eventAt: "2026-07-11T03:00:00.000Z",
    });

    const state = await service.getEmailDeliveryState({
      contactId: "delivery_contact",
    });
    assert.equal(state.deliveryStatus, "suppressed");
    assert.equal(state.lastDeliveryEventAt, "2026-07-11T04:00:00.000Z");
  });
});

test("contact delivery migrations keep SQLite and PostgreSQL state in parity", () => {
  const sqlite = fs.readFileSync(
    path.join(process.cwd(), "migrations/126_user_contact_delivery.sql"),
    "utf8",
  );
  const postgres = fs.readFileSync(
    path.join(process.cwd(), "migrations/pg/126_user_contact_delivery.sql"),
    "utf8",
  );
  const requiredNames = [
    "delivery_status",
    "last_delivery_event_at",
    "delivered_at",
    "bounced_at",
    "complained_at",
    "suppressed_at",
    "suppression_reason",
    "user_contact_delivery_events",
  ];

  for (const name of requiredNames) {
    assert.match(sqlite, new RegExp(`\\b${name}\\b`, "i"));
    assert.match(postgres, new RegExp(`\\b${name}\\b`, "i"));
  }
});
