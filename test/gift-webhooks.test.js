require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { beforeEach, afterEach, describe, test } = require("node:test");
const twilio = require("twilio");
const { Webhook } = require("svix");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");

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

function nowIso() {
  return new Date().toISOString();
}

describe("gift delivery webhook routes", () => {
  let db;
  let app;
  const userId = "gift_webhook_user";
  const publicBaseUrl = "http://public.local";
  const twilioAuthToken = "twilio_auth_token_test";
  const resendWebhookSecret = `whsec_${Buffer.from("test_resend_secret").toString("base64")}`;
  let previousResendSecret;

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
        title: "Webhook Gift Track",
        recipient_name: "Jamie",
        occasion: "birthday",
        style: "pop",
        message: "Webhook gift testing",
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

  async function createScheduledGift(channel, recipientField) {
    await creditGiftToken(`gift_webhook_tx_${Date.now()}_${channel}`);
    const { trackId, versionNum } = await createRenderedTrack();
    const response = await app.inject({
      method: "POST",
      url: "/gifts",
      headers: { "x-user-id": userId },
      payload: {
        content_type: "song",
        content_id: trackId,
        version_num: versionNum,
        delivery_mode: "scheduled",
        send_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        sender_timezone: "UTC",
        channels: [channel],
        ...recipientField,
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json().gift;
  }

  beforeEach(async () => {
    previousResendSecret = process.env.RESEND_WEBHOOK_SECRET;
    process.env.RESEND_WEBHOOK_SECRET = resendWebhookSecret;

    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildServer({
      db,
      config: {
        STORAGE_DIR: "/tmp/test-storage",
        PUBLIC_BASE_URL: publicBaseUrl,
        STREAM_BASE_URL: "http://stream.local",
        ALLOW_ANON_USER_ID: true,
        TWILIO_AUTH_TOKEN: twilioAuthToken,
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
  });

  afterEach(async () => {
    if (previousResendSecret === undefined) {
      delete process.env.RESEND_WEBHOOK_SECRET;
    } else {
      process.env.RESEND_WEBHOOK_SECRET = previousResendSecret;
    }
    await app.close();
    await db.close?.();
  });

  test("rejects invalid Twilio signatures and updates matching outbox rows on valid receipts", async () => {
    const gift = await createScheduledGift("sms", { recipient_phone: "+61406371221" });
    const outbox = await db.prepare(
      "SELECT id FROM gift_delivery_outbox WHERE gift_order_id = ? AND channel = 'sms'"
    ).get(gift.id);
    await db.prepare(
      "UPDATE gift_delivery_outbox SET provider_name = 'twilio', provider_message_id = ?, status = 'sent' WHERE id = ?"
    ).run("SM123", outbox.id);

    const payloadObject = {
      MessageSid: "SM123",
      MessageStatus: "delivered",
      Timestamp: nowIso(),
      To: "+61406371221",
      From: "+12025550123",
    };
    const invalidResponse = await app.inject({
      method: "POST",
      url: "/gifts/webhooks/twilio-status",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "invalid",
      },
      payload: new URLSearchParams(payloadObject).toString(),
    });
    assert.equal(invalidResponse.statusCode, 401, invalidResponse.body);

    const expectedSignature = twilio.getExpectedTwilioSignature(
      twilioAuthToken,
      `${publicBaseUrl}/gifts/webhooks/twilio-status`,
      payloadObject
    );
    const validResponse = await app.inject({
      method: "POST",
      url: "/gifts/webhooks/twilio-status",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": expectedSignature,
      },
      payload: new URLSearchParams(payloadObject).toString(),
    });
    assert.equal(validResponse.statusCode, 200, validResponse.body);
    assert.equal(validResponse.json().updated, true);

    const updated = await db.prepare(
      "SELECT receipt_status, receipt_event_at, receipt_updated_at FROM gift_delivery_outbox WHERE id = ?"
    ).get(outbox.id);
    assert.equal(updated.receipt_status, "delivered");
    assert.ok(updated.receipt_event_at);
    assert.ok(updated.receipt_updated_at);
  });

  test("keeps strongest Twilio receipt state across duplicate and out-of-order callbacks", async () => {
    const gift = await createScheduledGift("sms", { recipient_phone: "+61406371221" });
    const outbox = await db.prepare(
      "SELECT id FROM gift_delivery_outbox WHERE gift_order_id = ? AND channel = 'sms'"
    ).get(gift.id);
    await db.prepare(
      "UPDATE gift_delivery_outbox SET provider_name = 'twilio', provider_message_id = ?, status = 'sent' WHERE id = ?"
    ).run("SM_STRONGEST", outbox.id);

    const deliveredAt = new Date(Date.now() + 1000).toISOString();
    const sentAt = new Date(Date.now()).toISOString();
    const deliveredPayload = {
      MessageSid: "SM_STRONGEST",
      MessageStatus: "delivered",
      Timestamp: deliveredAt,
      To: "+61406371221",
      From: "+12025550123",
    };
    const deliveredSignature = twilio.getExpectedTwilioSignature(
      twilioAuthToken,
      `${publicBaseUrl}/gifts/webhooks/twilio-status`,
      deliveredPayload
    );
    const deliveredResponse = await app.inject({
      method: "POST",
      url: "/gifts/webhooks/twilio-status",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": deliveredSignature,
      },
      payload: new URLSearchParams(deliveredPayload).toString(),
    });
    assert.equal(deliveredResponse.statusCode, 200, deliveredResponse.body);

    const stalePayload = {
      MessageSid: "SM_STRONGEST",
      MessageStatus: "sent",
      Timestamp: sentAt,
      To: "+61406371221",
      From: "+12025550123",
    };
    const staleSignature = twilio.getExpectedTwilioSignature(
      twilioAuthToken,
      `${publicBaseUrl}/gifts/webhooks/twilio-status`,
      stalePayload
    );
    const staleResponse = await app.inject({
      method: "POST",
      url: "/gifts/webhooks/twilio-status",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": staleSignature,
      },
      payload: new URLSearchParams(stalePayload).toString(),
    });
    assert.equal(staleResponse.statusCode, 200, staleResponse.body);
    assert.equal(staleResponse.json().updated, false);

    const updated = await db.prepare(
      "SELECT receipt_status, receipt_event_at FROM gift_delivery_outbox WHERE id = ?"
    ).get(outbox.id);
    assert.equal(updated.receipt_status, "delivered");
    assert.equal(updated.receipt_event_at, deliveredAt);
  });

  test("records incidents for unknown provider message ids and post-cancel receipts", async () => {
    const unknownPayload = {
      MessageSid: "SM_UNKNOWN",
      MessageStatus: "failed",
      Timestamp: nowIso(),
      To: "+61406371221",
      From: "+12025550123",
    };
    const unknownSignature = twilio.getExpectedTwilioSignature(
      twilioAuthToken,
      `${publicBaseUrl}/gifts/webhooks/twilio-status`,
      unknownPayload
    );
    const unknownResponse = await app.inject({
      method: "POST",
      url: "/gifts/webhooks/twilio-status",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": unknownSignature,
      },
      payload: new URLSearchParams(unknownPayload).toString(),
    });
    assert.equal(unknownResponse.statusCode, 200, unknownResponse.body);
    assert.equal(unknownResponse.json().updated, false);

    const unknownIncident = await db.prepare(
      "SELECT incident_type FROM gift_delivery_incidents WHERE incident_key = ?"
    ).get("gift_unknown_receipt:twilio:SM_UNKNOWN");
    assert.equal(unknownIncident.incident_type, "gift_unknown_receipt");

    const gift = await createScheduledGift("sms", { recipient_phone: "+61406371221" });
    const outbox = await db.prepare(
      "SELECT id FROM gift_delivery_outbox WHERE gift_order_id = ? AND channel = 'sms'"
    ).get(gift.id);
    await db.prepare(
      "UPDATE gift_delivery_outbox SET provider_name = 'twilio', provider_message_id = ?, status = 'sent' WHERE id = ?"
    ).run("SM_CANCELLED", outbox.id);
    await db.prepare(
      "UPDATE gift_orders SET status = 'cancelled', dispatch_status = 'cancelled', cancelled_at = ? WHERE id = ?"
    ).run(nowIso(), gift.id);

    const cancelledPayload = {
      MessageSid: "SM_CANCELLED",
      MessageStatus: "delivered",
      Timestamp: nowIso(),
      To: "+61406371221",
      From: "+12025550123",
    };
    const cancelledSignature = twilio.getExpectedTwilioSignature(
      twilioAuthToken,
      `${publicBaseUrl}/gifts/webhooks/twilio-status`,
      cancelledPayload
    );
    const cancelledResponse = await app.inject({
      method: "POST",
      url: "/gifts/webhooks/twilio-status",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": cancelledSignature,
      },
      payload: new URLSearchParams(cancelledPayload).toString(),
    });
    assert.equal(cancelledResponse.statusCode, 200, cancelledResponse.body);

    const cancelledIncident = await db.prepare(
      "SELECT incident_type, status FROM gift_delivery_incidents WHERE incident_key = ?"
    ).get(`gift_receipt_after_cancel:${outbox.id}`);
    assert.equal(cancelledIncident.incident_type, "gift_receipt_after_cancel");
    assert.equal(cancelledIncident.status, "open");
  });

  test("rejects invalid Resend signatures and updates matching outbox rows on valid receipts", async () => {
    const gift = await createScheduledGift("email", { recipient_email: "recipient@example.com" });
    const outbox = await db.prepare(
      "SELECT id FROM gift_delivery_outbox WHERE gift_order_id = ? AND channel = 'email'"
    ).get(gift.id);
    await db.prepare(
      "UPDATE gift_delivery_outbox SET provider_name = 'resend', provider_message_id = ?, status = 'sent' WHERE id = ?"
    ).run("re_123", outbox.id);

    const invalidResponse = await app.inject({
      method: "POST",
      url: "/gifts/webhooks/resend-events",
      payload: { type: "email.delivered", data: { email_id: "re_123", created_at: nowIso() } },
    });
    assert.equal(invalidResponse.statusCode, 401, invalidResponse.body);

    const payload = {
      type: "email.delivered",
      data: {
        email_id: "re_123",
        created_at: nowIso(),
        to: ["recipient@example.com"],
        from: "gifts@porizo.co",
        subject: "Your gift is ready",
      },
    };
    const payloadString = JSON.stringify(payload);
    const webhook = new Webhook(resendWebhookSecret);
    const msgId = "msg_123";
    const timestampDate = new Date();
    const timestamp = String(Math.floor(timestampDate.getTime() / 1000));
    const signature = webhook.sign(msgId, timestampDate, payloadString);

    const validResponse = await app.inject({
      method: "POST",
      url: "/gifts/webhooks/resend-events",
      headers: {
        "content-type": "application/json",
        "svix-id": msgId,
        "svix-timestamp": timestamp,
        "svix-signature": signature,
      },
      payload,
    });
    assert.equal(validResponse.statusCode, 200, validResponse.body);
    assert.equal(validResponse.json().updated, true);

    const updated = await db.prepare(
      "SELECT receipt_status, receipt_event_at, receipt_updated_at FROM gift_delivery_outbox WHERE id = ?"
    ).get(outbox.id);
    assert.equal(updated.receipt_status, "delivered");
    assert.ok(updated.receipt_event_at);
    assert.ok(updated.receipt_updated_at);
  });
});
