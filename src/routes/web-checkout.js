"use strict";

const { Readable } = require("stream");
const { generateId } = require("../utils/ids");
const { nowIso } = require("../utils/common");
const {
  createWebOrdersRepository,
} = require("../database/web-orders-repository");
const { StripeConfigurationError } = require("../services/stripe-service");

// A pending order + checkout session younger than this is reused across tabs;
// older ones are superseded by a fresh session (Stripe sessions expire ~24h).
const PENDING_ORDER_REUSE_MS = 60 * 60 * 1000;

function registerWebCheckoutRoutes(
  app,
  {
    db,
    appConfig = {},
    sendError,
    requireUserId,
    stripeService,
    giftWalletRepository,
    orchestrator,
    publicBaseUrl,
  },
) {
  const orders = createWebOrdersRepository(db);

  function baseUrl() {
    return (
      publicBaseUrl ||
      appConfig.PUBLIC_BASE_URL ||
      appConfig.STREAM_BASE_URL ||
      "https://porizo.co"
    );
  }

  // Apply the paid transition idempotently: pending -> paid, grant the product
  // token, capture email + payment intent. Safe to call from both the webhook
  // and the orders-poll fallback; the CAS on the status update means the grant
  // fires at most once.
  async function applyPaidTransition({ order, session }) {
    const alreadyPaid = order.status !== "pending";
    if (alreadyPaid) {
      return { order, transitioned: false };
    }
    const email =
      session?.customer_details?.email ||
      session?.customer_email ||
      order.email ||
      null;
    // The buyer's own name (Stripe returns it once billing details are entered);
    // persisted on the order so the later paid->rendering convergence can set
    // the account's display_name even when it runs via the sweep (no session).
    const buyerName = session?.customer_details?.name?.trim() || null;
    const paymentIntentId =
      typeof session?.payment_intent === "string"
        ? session.payment_intent
        : session?.payment_intent?.id || null;

    const product = await orders.findProductByPriceKey(order.price_key);
    const tokenCount = product?.token_count || 1;

    const advanced = await orders.updateStatus({
      orderId: order.id,
      fromStatus: "pending",
      toStatus: "paid",
      paymentIntentId,
      email,
      buyerName,
    });
    if (!advanced) {
      // Lost the race — another worker already flipped it. Do not grant again.
      return { order: await orders.findById(order.id), transitioned: false };
    }

    // Grant the song token idempotently (idempotencyKey keyed on the order).
    await giftWalletRepository.applyTransaction({
      userId: order.user_id,
      type: "purchase",
      amount: tokenCount,
      source: "stripe_checkout",
      referenceType: "web_order",
      referenceId: order.id,
      description: "Web gift song purchase",
      idempotencyKey: `web_order_${order.id}`,
    });

    return { order: await orders.findById(order.id), transitioned: true };
  }

  // GET /web/products — public catalog with server-stored localized price.
  app.get("/web/products", async (_request, reply) => {
    const products = await orders.listActiveProducts();
    reply.header("Cache-Control", "public, max-age=60");
    return reply.send({
      products: products.map((p) => ({
        price_key: p.price_key,
        localized_price: p.display_price,
        currency: p.currency,
        name: p.display_name,
      })),
    });
  });

  // POST /web/checkout — create (or reuse) a Stripe Checkout session.
  app.post("/web/checkout", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    if (appConfig.PREVIEW_ONLY) {
      return sendError(
        reply,
        409,
        "FULL_RENDERS_DISABLED",
        "Purchases are paused right now.",
      );
    }

    const {
      track_id: trackId,
      track_version_id: trackVersionId,
      price_key: priceKey,
    } = request.body || {};
    if (!trackId || !trackVersionId || !priceKey) {
      return sendError(
        reply,
        400,
        "INVALID_CHECKOUT_REQUEST",
        "track_id, track_version_id and price_key are required.",
      );
    }

    const track = await db
      .prepare(
        `SELECT t.id, t.user_id, tv.id AS version_id
         FROM tracks t
         JOIN track_versions tv ON tv.track_id = t.id
         WHERE t.id = ? AND tv.id = ? AND t.deleted_at IS NULL`,
      )
      .get(trackId, trackVersionId);
    if (!track || track.user_id !== userId) {
      return sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
    }

    const product = await orders.findProductByPriceKey(priceKey);
    const isActive =
      product && (product.active === 1 || product.active === true);
    if (!product || !isActive) {
      return sendError(
        reply,
        404,
        "PRODUCT_NOT_FOUND",
        "That product is unavailable.",
      );
    }

    // Reuse a fresh open pending order + session (two-tab guard).
    const existing = await orders.findOpenPendingOrder({
      userId,
      trackVersionId,
    });
    if (existing) {
      const freshEnough =
        Date.now() - Date.parse(existing.created_at) < PENDING_ORDER_REUSE_MS;
      if (freshEnough) {
        try {
          const session = await stripeService.retrieveCheckoutSession(
            existing.checkout_session_id,
          );
          if (session?.url && session.status === "open") {
            return reply.send({ checkout_url: session.url });
          }
        } catch (err) {
          request.log.warn(
            { err },
            "Stale pending checkout session retrieve failed",
          );
        }
      }
      // Supersede: mark the stale pending order abandoned so the partial unique
      // index frees up for a fresh session.
      await orders.updateStatus({
        orderId: existing.id,
        fromStatus: "pending",
        toStatus: "abandoned",
      });
    }

    const orderId = generateId("worder");
    const attribution = request.body?.utm || {};
    let session;
    try {
      session = await stripeService.createCheckoutSession({
        mode: "payment",
        line_items: [{ price: product.stripe_price_id, quantity: 1 }],
        client_reference_id: orderId,
        success_url: `${baseUrl()}/create/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl()}/create/?cancelled=1&order_id=${encodeURIComponent(orderId)}#offer`,
        // Collect the buyer's name (and address) so the account isn't nameless
        // in admin. Card entry returns customer_details.name anyway; this also
        // captures it on wallet/Link payments.
        billing_address_collection: "auto",
        ...(appConfig.STRIPE_AUTOMATIC_TAX === true
          ? { automatic_tax: { enabled: true } }
          : {}),
        metadata: {
          order_id: orderId,
          user_id: userId,
          track_id: trackId,
          track_version_id: trackVersionId,
        },
      });
    } catch (err) {
      if (err instanceof StripeConfigurationError) {
        // Stripe keys not set yet (deploy-before-setup is a supported state):
        // checkout is down, the server is not.
        request.log.warn({ err }, "Checkout requested but Stripe unconfigured");
        return sendError(
          reply,
          503,
          "CHECKOUT_UNAVAILABLE",
          "Checkout isn't available right now. Please try again soon.",
        );
      }
      request.log.error({ err }, "Stripe checkout session creation failed");
      return sendError(
        reply,
        502,
        "CHECKOUT_UNAVAILABLE",
        "We couldn't start checkout. Please try again.",
      );
    }

    await orders.insertOrder({
      id: orderId,
      checkoutSessionId: session.id,
      userId,
      trackId,
      trackVersionId,
      priceKey,
      amountCents: session.amount_total ?? 0,
      currency: session.currency || product.currency,
      email: session.customer_email || null,
      utmSource: attribution.utm_source || null,
      utmMedium: attribution.utm_medium || null,
      utmCampaign: attribution.utm_campaign || null,
    });

    return reply.send({ checkout_url: session.url });
  });

  // Restore a cancelled checkout even if browser storage was cleared. The
  // device/session still has to authenticate as the order owner.
  app.get("/web/order-drafts/:orderId", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;
    const draft = await db
      .prepare(
        `SELECT o.track_id, o.track_version_id, tv.version_num,
                t.recipient_name
         FROM web_orders o
         JOIN tracks t ON t.id = o.track_id
         JOIN track_versions tv ON tv.id = o.track_version_id
         WHERE o.id = ? AND o.user_id = ? AND o.status = 'pending'
           AND t.deleted_at IS NULL`,
      )
      .get(request.params.orderId, userId);
    if (!draft) {
      return sendError(reply, 404, "ORDER_NOT_FOUND", "Order not found.");
    }
    reply.header("Cache-Control", "no-store");
    return reply.send(draft);
  });

  // GET /web/orders/latest — cross-device recovery. A buyer who paid as a guest
  // on one device and signs in fresh on another has no session_id to poll, but
  // login now re-owns their paid order (reclaimGuestOrdersOnLogin), so we can
  // find it by the authenticated user. Static route is matched before the
  // parametric :sessionId route below.
  app.get("/web/orders/latest", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const order = await orders.findLatestPurchasedOrderForUser(userId);
    if (!order) {
      return sendError(reply, 404, "ORDER_NOT_FOUND", "Order not found.");
    }

    const status = await orchestrator.describeOrderForStatus(order);
    reply.header("Cache-Control", "no-store");
    return reply.send({
      ...status,
      checkout_session_id: order.checkout_session_id,
      support_url: `${baseUrl()}/support`,
      order_reference: order.id,
    });
  });

  // GET /web/orders/:sessionId — success-page poll + webhook-lost recovery.
  app.get("/web/orders/:sessionId", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    let order = await orders.findByCheckoutSessionId(request.params.sessionId);
    if (!order || order.user_id !== userId) {
      // The merge may have re-owned the order; a mismatched owner is a 404.
      return sendError(reply, 404, "ORDER_NOT_FOUND", "Order not found.");
    }

    // Webhook-lost fallback: on a still-pending order, retrieve the session
    // directly and apply the same paid transition idempotently.
    if (order.status === "pending") {
      try {
        const session = await stripeService.retrieveCheckoutSession(
          order.checkout_session_id,
        );
        if (session?.payment_status === "paid") {
          const applied = await applyPaidTransition({ order, session });
          order = applied.order;
          if (applied.transitioned) {
            // Kick the orchestrator immediately (do not await — poll returns fast).
            orchestrator
              .tick(order.id)
              .catch((err) =>
                request.log.error(
                  { err, orderId: order.id },
                  "Post-pay tick failed",
                ),
              );
          }
        }
      } catch (err) {
        request.log.warn({ err }, "Order poll Stripe retrieve failed");
      }
    }

    const status = await orchestrator.describeOrderForStatus(order);
    reply.header("Cache-Control", "no-store");
    return reply.send({
      ...status,
      support_url: `${baseUrl()}/support`,
      order_reference: order.id,
    });
  });

  // POST /web/webhooks/stripe — raw body + signature verified.
  app.post(
    "/web/webhooks/stripe",
    {
      preParsing: async (request, _reply, payload) => {
        const chunks = [];
        for await (const chunk of payload) chunks.push(chunk);
        request.rawBody = Buffer.concat(chunks).toString("utf-8");
        return Readable.from([request.rawBody]);
      },
    },
    async (request, reply) => {
      const signature = request.headers["stripe-signature"];
      let event;
      try {
        event = stripeService.constructEvent(request.rawBody, signature);
      } catch (err) {
        if (err instanceof StripeConfigurationError) {
          request.log.warn({ err }, "Webhook received but Stripe unconfigured");
          return reply.code(503).send({ error: "WEBHOOK_UNCONFIGURED" });
        }
        request.log.warn(
          { err },
          "Stripe webhook signature verification failed",
        );
        return reply.code(400).send({ error: "INVALID_SIGNATURE" });
      }

      try {
        await handleStripeEvent(event, request);
      } catch (err) {
        request.log.error(
          { err, type: event.type },
          "Stripe webhook handler failed",
        );
        // 500 tells Stripe to retry; state transitions are idempotent.
        return reply.code(500).send({ error: "WEBHOOK_HANDLER_ERROR" });
      }
      return reply.code(200).send({ received: true });
    },
  );

  async function handleStripeEvent(event, request) {
    const object = event.data?.object || {};
    switch (event.type) {
      case "checkout.session.completed": {
        const order = await orders.findByCheckoutSessionId(object.id);
        if (!order) return;
        if (object.payment_status && object.payment_status !== "paid") return;
        const applied = await applyPaidTransition({ order, session: object });
        if (applied.transitioned) {
          orchestrator
            .tick(applied.order.id)
            .catch((err) =>
              request.log.error(
                { err, orderId: applied.order.id },
                "Post-pay tick failed",
              ),
            );
        }
        return;
      }
      case "checkout.session.expired": {
        const order = await orders.findByCheckoutSessionId(object.id);
        if (!order) return;
        await orders.updateStatus({
          orderId: order.id,
          fromStatus: "pending",
          toStatus: "abandoned",
        });
        return;
      }
      case "charge.refunded": {
        await handleRefundOrDispute(object, "refunded");
        return;
      }
      case "charge.dispute.created": {
        const disputed = object.charge
          ? { payment_intent: object.payment_intent }
          : object;
        await handleRefundOrDispute(disputed, "refunded", { dispute: true });
        return;
      }
      default:
        // Unknown event types are acknowledged (200) with no state change.
        return;
    }
  }

  async function handleRefundOrDispute(
    object,
    toStatus,
    { dispute = false } = {},
  ) {
    const paymentIntentId =
      typeof object.payment_intent === "string"
        ? object.payment_intent
        : object.payment_intent?.id || null;
    if (!paymentIntentId) return;
    const order = await db
      .prepare("SELECT * FROM web_orders WHERE payment_intent_id = ?")
      .get(paymentIntentId);
    if (!order) return;

    await orders.updateStatus({
      orderId: order.id,
      fromStatus: ["pending", "paid", "rendering", "delivered", "failed"],
      toStatus,
    });
    // Revoke the gift share so the recipient page shows the warm unavailable state.
    if (order.share_token_id) {
      await db
        .prepare(
          "UPDATE share_tokens SET status = 'revoked' WHERE id = ? AND status != 'revoked'",
        )
        .run(order.share_token_id);
    }
    if (dispute) {
      await db
        .prepare(
          "INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, 'web_order_dispute', 'web_order', ?, ?, ?)",
        )
        .run(
          generateId("audit"),
          order.user_id,
          order.id,
          JSON.stringify({ payment_intent_id: paymentIntentId }),
          nowIso(),
        );
    }
  }

  return { applyPaidTransition };
}

module.exports = { registerWebCheckoutRoutes };
