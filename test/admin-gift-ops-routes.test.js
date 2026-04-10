require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { beforeEach, afterEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");
const adminAuthService = require("../src/services/admin-auth-service");
const { upsertGiftIncident } = require("../src/services/gift-delivery-ops");

function nowIso() {
  return new Date().toISOString();
}

const appleValidatorStub = {
  isConfigured() {
    return true;
  },
  async verifyTransaction(transactionId) {
    return {
      valid: true,
      type: "one_time_purchase",
      transactionId,
      originalTransactionId: transactionId,
      productId: "com.porizo.gift_token_oneoff",
      purchaseDate: new Date(),
      environment: "sandbox",
    };
  },
  decodeJWS() {
    return null;
  },
};

describe("admin gift ops routes", () => {
  let db;
  let app;
  let superadminToken;
  let adminToken;
  let viewerToken;
  const userId = "gift_admin_user";

  async function loginAdmin(email, password) {
    const response = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: { email, password },
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json().token;
  }

  async function creditGiftToken(transactionId) {
    const response = await app.inject({
      method: "POST",
      url: "/billing/receipt/apple/consumable",
      headers: { "x-user-id": userId },
      payload: { transactionId },
    });
    assert.equal(response.statusCode, 200, response.body);
  }

  async function createRenderedTrack() {
    const trackResponse = await app.inject({
      method: "POST",
      url: "/tracks",
      headers: { "x-user-id": userId },
      payload: {
        title: "Admin Gift Track",
        recipient_name: "Jamie",
        occasion: "birthday",
        style: "pop",
        message: "A gift for testing",
      },
    });
    assert.ok([200, 201].includes(trackResponse.statusCode), trackResponse.body);
    const track = trackResponse.json();

    const versionResponse = await app.inject({
      method: "POST",
      url: `/tracks/${track.track_id}/versions`,
      headers: { "x-user-id": userId },
      payload: {},
    });
    assert.ok([200, 201].includes(versionResponse.statusCode), versionResponse.body);
    const version = versionResponse.json();

    await db.prepare(
      "UPDATE track_versions SET preview_url = ? WHERE track_id = ? AND version_num = ?"
    ).run(
      "http://stream.local/test-preview.m3u8",
      track.track_id,
      version.version_num
    );

    return {
      trackId: track.track_id,
      versionNum: version.version_num,
    };
  }

  async function createScheduledGift() {
    await creditGiftToken(`gift_admin_tx_${Date.now()}`);
    const { trackId, versionNum } = await createRenderedTrack();
    const sendAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const response = await app.inject({
      method: "POST",
      url: "/gifts",
      headers: { "x-user-id": userId },
      payload: {
        content_type: "song",
        content_id: trackId,
        version_num: versionNum,
        delivery_mode: "scheduled",
        send_at: sendAt,
        sender_timezone: "Australia/Perth",
        channels: ["sms", "email"],
        recipient_phone: "+61406371221",
        recipient_email: "recipient@example.com",
        message: "Admin route gift",
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json().gift;
  }

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildServer({
      db,
      config: {
        STORAGE_DIR: "/tmp/test-storage",
        PUBLIC_BASE_URL: "http://public.local",
        STREAM_BASE_URL: "http://stream.local",
        ALLOW_ANON_USER_ID: true,
      },
      storage: {
        put: async () => {},
        get: async () => null,
        exists: async () => false,
        delete: async () => {},
        getSignedUrl: async (key) => `http://localhost/${key}`,
      },
      billingServices: { appleValidator: appleValidatorStub },
    });

    await db.prepare(
      "INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, ?)"
    ).run(userId, nowIso(), "low");

    superadminToken = await loginAdmin("admin@porizo.app", "admin123");
    const created = await adminAuthService.createAdmin(
      "ops-admin@example.com",
      "admin123",
      "Ops Admin",
      "admin"
    );
    assert.equal(created.success, true);
    adminToken = await loginAdmin("ops-admin@example.com", "admin123");
    const viewerCreated = await adminAuthService.createAdmin(
      "viewer@example.com",
      "admin123",
      "Gift Viewer",
      "viewer"
    );
    assert.equal(viewerCreated.success, true);
    viewerToken = await loginAdmin("viewer@example.com", "admin123");
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("lists overview, orders, detail, outbox, and incidents with redacted data for admins", async () => {
    const gift = await createScheduledGift();
    await upsertGiftIncident(db, {
      incidentKey: `gift_overdue:${gift.id}`,
      incidentType: "gift_overdue",
      severity: "warning",
      giftOrderId: gift.id,
      summary: "Gift is overdue",
      metadata: { recipient_email: "recipient@example.com", recipient_phone: "+61406371221" },
    });

    const overviewResponse = await app.inject({
      method: "GET",
      url: "/admin/dashboard/gifts/overview",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(overviewResponse.statusCode, 200, overviewResponse.body);
    const overview = overviewResponse.json();
    assert.ok(overview.scheduled_count >= 1);
    assert.ok(overview.open_incidents >= 1);

    const ordersResponse = await app.inject({
      method: "GET",
      url: "/admin/dashboard/gifts/orders?search=recipient@example.com",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(ordersResponse.statusCode, 200, ordersResponse.body);
    const orders = ordersResponse.json().orders;
    assert.equal(orders.length, 1);
    assert.equal(orders[0].id, gift.id);
    assert.equal(orders[0].recipient_email, "r***t@example.com");
    assert.equal(orders[0].recipient_phone, "+61***21");

    const detailResponse = await app.inject({
      method: "GET",
      url: `/admin/dashboard/gifts/orders/${gift.id}?include_sensitive=true`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(detailResponse.statusCode, 200, detailResponse.body);
    const detail = detailResponse.json();
    assert.equal(detail.gift.recipient_email, "r***t@example.com");
    assert.equal(detail.gift.share_url, null);
    assert.ok(detail.gift.share_url_masked);
    assert.equal(detail.outbox.length, 2);
    assert.equal(detail.incidents.length, 1);

    const outboxResponse = await app.inject({
      method: "GET",
      url: "/admin/dashboard/gifts/outbox?channel=sms",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(outboxResponse.statusCode, 200, outboxResponse.body);
    assert.equal(outboxResponse.json().outbox.length, 1);
    assert.equal(outboxResponse.json().outbox[0].recipient, "+61***21");

    const incidentsResponse = await app.inject({
      method: "GET",
      url: "/admin/dashboard/gifts/incidents",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(incidentsResponse.statusCode, 200, incidentsResponse.body);
    assert.equal(incidentsResponse.json().incidents.length, 1);
    assert.equal(incidentsResponse.json().incidents[0].incident_key, `gift_overdue:${gift.id}`);
  });

  test("allows superadmin-sensitive detail and blocks destructive actions for plain admins", async () => {
    const gift = await createScheduledGift();

    const superadminDetail = await app.inject({
      method: "GET",
      url: `/admin/dashboard/gifts/orders/${gift.id}?include_sensitive=true`,
      headers: { Authorization: `Bearer ${superadminToken}` },
    });
    assert.equal(superadminDetail.statusCode, 200, superadminDetail.body);
    const detail = superadminDetail.json();
    assert.equal(detail.gift.recipient_email, "recipient@example.com");
    assert.equal(detail.gift.recipient_phone, "+61406371221");
    assert.match(detail.gift.share_url || "", /\/play\//);

    const adminRetry = await app.inject({
      method: "POST",
      url: `/admin/dashboard/gifts/orders/${gift.id}/retry`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { reason: "should fail" },
    });
    assert.equal(adminRetry.statusCode, 403, adminRetry.body);

    const adminCancel = await app.inject({
      method: "POST",
      url: `/admin/dashboard/gifts/orders/${gift.id}/cancel`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { reason: "should fail" },
    });
    assert.equal(adminCancel.statusCode, 403, adminCancel.body);

    const viewerOverview = await app.inject({
      method: "GET",
      url: "/admin/dashboard/gifts/overview",
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    assert.equal(viewerOverview.statusCode, 200, viewerOverview.body);

    const viewerRetry = await app.inject({
      method: "POST",
      url: `/admin/dashboard/gifts/orders/${gift.id}/retry`,
      headers: { Authorization: `Bearer ${viewerToken}` },
      payload: { reason: "should fail" },
    });
    assert.equal(viewerRetry.statusCode, 403, viewerRetry.body);
  });

  test("supports superadmin retry, overdue acknowledgement, manual notes, and cancel", async () => {
    const gift = await createScheduledGift();
    await upsertGiftIncident(db, {
      incidentKey: `gift_overdue:${gift.id}`,
      incidentType: "gift_overdue",
      severity: "warning",
      giftOrderId: gift.id,
      summary: "Gift is overdue",
    });

    const retryResponse = await app.inject({
      method: "POST",
      url: `/admin/dashboard/gifts/orders/${gift.id}/retry`,
      headers: { Authorization: `Bearer ${superadminToken}` },
      payload: { reason: "manual requeue" },
    });
    assert.equal(retryResponse.statusCode, 200, retryResponse.body);
    const retried = await db.prepare(
      "SELECT status, dispatch_status, next_retry_at FROM gift_orders WHERE id = ?"
    ).get(gift.id);
    assert.equal(retried.status, "dispatch_retry");
    assert.equal(retried.dispatch_status, "retrying");
    assert.ok(retried.next_retry_at);

    const noteResponse = await app.inject({
      method: "POST",
      url: `/admin/dashboard/gifts/orders/${gift.id}/manual-recovery-note`,
      headers: { Authorization: `Bearer ${superadminToken}` },
      payload: { note: "Reviewed provider outage and queued manual follow-up." },
    });
    assert.equal(noteResponse.statusCode, 200, noteResponse.body);

    const incidentRow = await db.prepare(
      "SELECT id FROM gift_delivery_incidents WHERE incident_key = ?"
    ).get(`gift_overdue:${gift.id}`);
    const ackResponse = await app.inject({
      method: "POST",
      url: `/admin/dashboard/gifts/incidents/${incidentRow.id}/acknowledge`,
      headers: { Authorization: `Bearer ${superadminToken}` },
      payload: { note: "Acknowledged" },
    });
    assert.equal(ackResponse.statusCode, 200, ackResponse.body);
    assert.equal(ackResponse.json().incident.status, "acknowledged");

    const cancelResponse = await app.inject({
      method: "POST",
      url: `/admin/dashboard/gifts/orders/${gift.id}/cancel`,
      headers: { Authorization: `Bearer ${superadminToken}` },
      payload: { reason: "sender requested cancellation" },
    });
    assert.equal(cancelResponse.statusCode, 200, cancelResponse.body);
    assert.equal(cancelResponse.json().cancelled, true);
    assert.equal(cancelResponse.json().gift.status, "cancelled");
  });

  test("fails gift ops reads with a clear migration-required error when observability schema is missing", async () => {
    await db.prepare("DROP TABLE gift_delivery_incidents").run();

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/gifts/incidents",
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    assert.equal(response.statusCode, 503, response.body);
    const body = response.json();
    assert.equal(body.error, "GIFT_OPS_MIGRATION_REQUIRED");
  });
});
