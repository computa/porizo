"use strict";

const { Readable } = require("node:stream");
const { verifyEtsyWebhook } = require("../services/etsy-webhook");
const {
  getEtsyFulfilmentMode,
} = require("../services/etsy-fulfilment-mode");

const MAX_ETSY_WEBHOOK_BYTES = 256 * 1024;

async function readRawBody(payload, maxBytes = MAX_ETSY_WEBHOOK_BYTES) {
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of payload) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += bytes.length;
    if (byteLength > maxBytes) {
      const error = new Error("ETSY_WEBHOOK_PAYLOAD_TOO_LARGE");
      error.code = "ETSY_WEBHOOK_PAYLOAD_TOO_LARGE";
      error.statusCode = 413;
      throw error;
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, byteLength);
}

function parseEvent(body) {
  const eventType = String(body?.event_type || body?.type || "");
  const resource = body?.resource || body?.data || {};
  const receiptId = String(
    resource.receipt_id ||
      body?.receipt_id ||
      String(resource.resource_url || body?.resource_url || "").match(
        /\/receipts\/(\d+)/,
      )?.[1] ||
      "",
  );
  const shopId = String(
    resource.shop_id ||
      body?.shop_id ||
      String(resource.resource_url || body?.resource_url || "").match(
        /\/shops\/(\d+)/,
      )?.[1] ||
      "",
  );
  return { eventType, receiptId, shopId };
}

function registerWebEtsyWebhookRoutes(
  app,
  {
    db,
    etsyOrderService,
    etsyClient,
    logger = console,
    getFulfilmentMode = () => getEtsyFulfilmentMode(db),
  },
) {
  let sweepInFlight = false;
  let sweepCount = 0;
  const sweep = async () => {
    if (sweepInFlight || !etsyClient?.configured?.()) return;
    sweepInFlight = true;
    try {
      if ((await getFulfilmentMode()) !== "api") return;
      await etsyOrderService.processPendingWebhooks(etsyClient);
      sweepCount += 1;
      if (
        sweepCount % 20 === 0 &&
        typeof etsyOrderService.reconcileReceipts === "function"
      ) {
        await etsyOrderService.reconcileReceipts(etsyClient);
      }
    } catch (error) {
      logger.error?.({ code: error?.code }, "Etsy webhook sweep failed");
    } finally {
      sweepInFlight = false;
    }
  };
  const sweepTimer = setInterval(sweep, 30_000);
  sweepTimer.unref?.();
  app.addHook("onClose", async () => clearInterval(sweepTimer));

  app.post(
    "/web/webhooks/etsy",
    {
      onRequest: async (_request, reply) => {
        if ((await getFulfilmentMode()) !== "api") {
          return reply.code(404).send({ error: "NOT_FOUND" });
        }
      },
      preParsing: async (request, _reply, payload) => {
        request.rawBody = await readRawBody(payload);
        return Readable.from([request.rawBody]);
      },
    },
    async (request, reply) => {
      const webhookId = request.headers["webhook-id"];
      const timestamp = request.headers["webhook-timestamp"];
      const signature = request.headers["webhook-signature"];
      let verified;
      try {
        verified = verifyEtsyWebhook({
          rawBody: request.rawBody,
          webhookId,
          webhookTimestamp: timestamp,
          webhookSignature: signature,
        });
      } catch (error) {
        request.log.warn({ code: error?.code }, "Etsy webhook verification failed");
        return reply.code(400).send({ error: "INVALID_SIGNATURE" });
      }
      const { eventType, receiptId, shopId } = parseEvent(request.body);
      if (!receiptId || !["order.paid", "order.canceled"].includes(eventType)) {
        return reply.code(202).send({ received: true, ignored: true });
      }
      const configuredShopId = String(process.env.ETSY_SHOP_ID || "");
      if (!configuredShopId || !shopId || shopId !== configuredShopId) {
        request.log.warn(
          { signedShopId: shopId || null },
          "Etsy webhook shop does not match the configured shop",
        );
        return reply.code(400).send({ error: "ETSY_SHOP_MISMATCH" });
      }
      let recorded;
      try {
        recorded = await etsyOrderService.recordWebhook({
          webhookId: String(webhookId),
          eventType,
          shopId,
          receiptId,
          bodySha256: verified.bodySha256,
        });
      } catch (error) {
        if (error?.code === "ETSY_WEBHOOK_ID_CONFLICT") {
          request.log.error(
            { webhookId, receiptId },
            "Etsy webhook ID was reused with a conflicting payload",
          );
          return reply.code(409).send({ error: error.code });
        }
        throw error;
      }
      if (recorded.inserted) {
        setImmediate(() => {
          etsyOrderService
            .processWebhook(String(webhookId), etsyClient)
            .catch((error) =>
              logger.error?.(
                { code: error?.code, receiptId, webhookId },
                "Etsy webhook processing failed; durable retry remains queued",
              ),
            );
        });
      }
      return reply.code(200).send({
        received: true,
        duplicate: !recorded.inserted,
        processing_paused: false,
      });
    },
  );
}

module.exports = {
  registerWebEtsyWebhookRoutes,
  parseEvent,
  readRawBody,
  MAX_ETSY_WEBHOOK_BYTES,
};
