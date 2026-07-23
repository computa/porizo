"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { describe, it } = require("node:test");
const { verifyEtsyWebhook } = require("../../src/services/etsy-webhook");
const {
  MAX_ETSY_WEBHOOK_BYTES,
  readRawBody,
  registerWebEtsyWebhookRoutes,
  parseEvent,
} = require("../../src/routes/web-etsy-webhook");

describe("Etsy webhook verification", () => {
  const secretBytes = crypto.createHash("sha256").update("etsy-test-secret").digest();
  const secret = `whsec_${secretBytes.toString("base64")}`;
  const webhookId = "evt_123";
  const timestamp = "1800000000";
  const rawBody =
    '{"event_type":"order.paid","receipt_id":123,"shop_id":"shop_123"}';

  function signature(body = rawBody, ts = timestamp) {
    return crypto
      .createHmac("sha256", secretBytes)
      .update(`${webhookId}.${ts}.${body}`)
      .digest("base64");
  }

  it("accepts a fresh signature over the exact raw body", () => {
    const result = verifyEtsyWebhook({
      rawBody,
      webhookId,
      webhookTimestamp: timestamp,
      webhookSignature: `v1,${signature()}`,
      secret,
      nowMs: Number(timestamp) * 1000,
    });
    assert.equal(result.bodySha256.length, 64);
  });

  it("rejects tampering and stale timestamps", () => {
    assert.throws(
      () =>
        verifyEtsyWebhook({
          rawBody: `${rawBody} `,
          webhookId,
          webhookTimestamp: timestamp,
          webhookSignature: `v1,${signature()}`,
          secret,
          nowMs: Number(timestamp) * 1000,
        }),
      (error) => error.code === "ETSY_WEBHOOK_SIGNATURE_INVALID",
    );
    assert.throws(
      () =>
        verifyEtsyWebhook({
          rawBody,
          webhookId,
          webhookTimestamp: timestamp,
          webhookSignature: `v1,${signature()}`,
          secret,
          nowMs: (Number(timestamp) + 301) * 1000,
        }),
      (error) => error.code === "ETSY_WEBHOOK_TIMESTAMP_INVALID",
    );
  });

  it("rejects short, malformed, and non-canonical signing secrets", () => {
    for (const invalidSecret of [
      `whsec_${Buffer.alloc(31).toString("base64")}`,
      "whsec_not-base64!",
      `whsec_${Buffer.alloc(32).toString("base64").replace(/=$/, "")}`,
    ]) {
      assert.throws(
        () =>
          verifyEtsyWebhook({
            rawBody,
            webhookId,
            webhookTimestamp: timestamp,
            webhookSignature: `v1,${signature()}`,
            secret: invalidSecret,
            nowMs: Number(timestamp) * 1000,
          }),
        (error) => error.code === "ETSY_WEBHOOK_SECRET_INVALID",
      );
    }
  });

  it("preserves raw bytes and rejects bodies above 256 KiB", async () => {
    const raw = Buffer.from('{"event_type":"order.paid","note":"é"}', "utf8");
    const read = await readRawBody(Readable.from([raw.subarray(0, 7), raw.subarray(7)]));
    assert.deepEqual(read, raw);

    await assert.rejects(
      readRawBody(Readable.from([Buffer.alloc(MAX_ETSY_WEBHOOK_BYTES + 1)])),
      (error) =>
        error.code === "ETSY_WEBHOOK_PAYLOAD_TOO_LARGE" &&
        error.statusCode === 413,
    );
  });

  it("extracts the shop identity from the signed event payload", () => {
    assert.deepEqual(parseEvent(JSON.parse(rawBody)), {
      eventType: "order.paid",
      receiptId: "123",
      shopId: "shop_123",
    });
  });

  it("records a verified event while automation processing is paused", async () => {
    let route;
    let closeHook;
    let recorded;
    let processed = 0;
    const app = {
      addHook(name, hook) {
        if (name === "onClose") closeHook = hook;
      },
      post(_path, options, handler) {
        route = { options, handler };
      },
    };
    registerWebEtsyWebhookRoutes(app, {
      db: {},
      etsyClient: { configured: () => true },
      etsyOrderService: {
        recordWebhook: async (event) => {
          recorded = event;
          return { inserted: true };
        },
        processWebhook: async () => {
          processed += 1;
        },
        processPendingWebhooks: async () => {
          processed += 1;
        },
      },
      isAutomationEnabled: async () => false,
      logger: { error: () => {} },
    });

    const previousSecret = process.env.ETSY_WEBHOOK_SECRET;
    const previousShopId = process.env.ETSY_SHOP_ID;
    process.env.ETSY_WEBHOOK_SECRET = secret;
    process.env.ETSY_SHOP_ID = "shop_123";
    const liveTimestamp = String(Math.floor(Date.now() / 1000));
    const reply = {
      statusCode: 200,
      code(value) {
        this.statusCode = value;
        return this;
      },
      send(value) {
        this.payload = value;
        return value;
      },
    };
    try {
      await route.handler(
        {
          rawBody: Buffer.from(rawBody),
          body: JSON.parse(rawBody),
          headers: {
            "webhook-id": webhookId,
            "webhook-timestamp": liveTimestamp,
            "webhook-signature": `v1,${signature(rawBody, liveTimestamp)}`,
          },
          log: { warn: () => {} },
        },
        reply,
      );
      assert.equal(reply.statusCode, 200);
      assert.equal(reply.payload.processing_paused, true);
      assert.equal(recorded.webhookId, webhookId);
      assert.equal(recorded.eventType, "order.paid");
      assert.equal(recorded.shopId, "shop_123");
      assert.equal(processed, 0);

      const wrongShopBody =
        '{"event_type":"order.paid","receipt_id":123,"shop_id":"attacker_shop"}';
      await route.handler(
        {
          rawBody: Buffer.from(wrongShopBody),
          body: JSON.parse(wrongShopBody),
          headers: {
            "webhook-id": webhookId,
            "webhook-timestamp": liveTimestamp,
            "webhook-signature": `v1,${signature(wrongShopBody, liveTimestamp)}`,
          },
          log: { warn: () => {}, error: () => {} },
        },
        reply,
      );
      assert.equal(reply.statusCode, 400);
      assert.equal(reply.payload.error, "ETSY_SHOP_MISMATCH");
    } finally {
      if (previousSecret === undefined) delete process.env.ETSY_WEBHOOK_SECRET;
      else process.env.ETSY_WEBHOOK_SECRET = previousSecret;
      if (previousShopId === undefined) delete process.env.ETSY_SHOP_ID;
      else process.env.ETSY_SHOP_ID = previousShopId;
      await closeHook();
    }
  });
});
