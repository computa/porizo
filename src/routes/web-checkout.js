"use strict";

const crypto = require("crypto");
const { Readable } = require("stream");
const { generateId } = require("../utils/ids");
const { nowIso } = require("../utils/common");
const {
  createWebOrdersRepository,
} = require("../database/web-orders-repository");
const { StripeConfigurationError } = require("../services/stripe-service");
const {
  createGiftReservationRepository,
} = require("../database/gift-reservation-repository");
const {
  createGiftReservationService,
} = require("../services/gift-reservation-service");
const { createPreparedDbFromQuery } = require("../utils/db-adapter");
const { createIdentityRepository } = require("../database/identity-repository");
const { convergeOrderIdentity } = require("../services/web-order-identity");
const {
  createGiftPurchaseReversalService,
} = require("../services/gift-purchase-reversal");
const { getFeatureFlag } = require("../services/feature-flags");

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
  const giftReservationRepository = createGiftReservationRepository(db);
  const giftReservationService = createGiftReservationService({
    db,
    giftWalletRepository,
    giftReservationRepository,
  });
  const giftPurchaseReversalService = createGiftPurchaseReversalService({
    giftWalletRepository,
  });
  const identityRepository = createIdentityRepository(db);

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

    let transitioned = false;
    await db.transaction(async (query) => {
      const advanced = await orders.updateStatus({
        orderId: order.id,
        fromStatus: "pending",
        toStatus: "paid",
        paymentIntentId,
        email,
        buyerName,
        query,
      });
      if (!advanced) return;

      const identityRepository = createIdentityRepository(
        createPreparedDbFromQuery(query, db),
      );
      const convergence = await convergeOrderIdentity(query, {
        buyerUserId: order.user_id,
        email,
        name: buyerName,
        identityRepository,
      });
      const ownerUserId = convergence.userId;
      const grant = await giftWalletRepository.applyTransaction({
        userId: ownerUserId,
        type: "purchase",
        amount: tokenCount,
        source: "stripe_checkout",
        referenceType: "web_order",
        referenceId: order.id,
        description: "Gift credit purchase",
        idempotencyKey: `web_order_${order.id}`,
        externalQuery: query,
      });
      const reserved = await giftReservationService.reserveGiftCredit({
        userId: ownerUserId,
        idempotencyKey: `web_order:${order.id}`,
        expiresAt: new Date(
          Date.now() + 24 * 60 * 60 * 1000,
        ).toISOString(),
        purpose: "paid_web_order",
        originWebOrderId: order.id,
        externalQuery: query,
      });
      await giftReservationService.adoptTrack({
        reservationId: reserved.reservation.id,
        userId: ownerUserId,
        trackId: order.track_id,
        trackVersionId: order.track_version_id,
        externalQuery: query,
      });
      const versionResult = await query(
        "SELECT version_num FROM track_versions WHERE id = ? AND track_id = ?",
        [order.track_version_id, order.track_id],
      );
      const versionNum = Number(versionResult?.rows?.[0]?.version_num || 1);
      const attached = await giftReservationRepository.attachContent({
        reservationId: reserved.reservation.id,
        contentType: "song",
        contentId: order.track_id,
        versionNum,
        updatedAt: nowIso(),
        query,
      });
      if (!(attached?.rowCount ?? attached?.changes ?? 0)) {
        throw Object.assign(new Error("GIFT_CONTENT_NOT_ADOPTABLE"), {
          code: "GIFT_CONTENT_NOT_ADOPTABLE",
        });
      }
      const linked = await orders.linkGiftReservation({
        orderId: order.id,
        userId: ownerUserId,
        giftReservationId: reserved.reservation.id,
        purchaseTransactionId: grant.transactionId,
        paymentSource: "stripe",
        query,
      });
      if (!linked) {
        throw Object.assign(new Error("WEB_ORDER_LINK_FAILED"), {
          code: "WEB_ORDER_LINK_FAILED",
        });
      }
      transitioned = true;
    });

    return {
      order: await orders.findById(order.id),
      transitioned,
    };
  }

  // GET /web/products — public catalog with server-stored localized price.
  app.get("/web/products", async (request, reply) => {
    const products = await orders.listActiveProducts();
    const automatedDeliveryEnabled = await getFeatureFlag(
      db,
      "web_automated_gift_delivery",
    );
    let walletBalance;
    if (
      request.headers.authorization ||
      request.headers["x-user-id"]
    ) {
      const userId = await requireUserId(request, reply);
      if (!userId) return;
      walletBalance = await giftWalletRepository.getBalance(userId);
    }
    reply.header(
      "Cache-Control",
      walletBalance === undefined ? "public, max-age=60" : "private, no-store",
    );
    return reply.send({
      products: products.map((p) => ({
        price_key: p.price_key,
        token_count: Number(p.token_count || 1),
        localized_price: p.display_price,
        currency: p.currency,
        name: p.display_name,
      })),
      ...(walletBalance === undefined
        ? {}
        : { wallet_balance: walletBalance }),
      automated_delivery_enabled: Boolean(automatedDeliveryEnabled),
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
        `SELECT t.id, t.user_id, tv.id AS version_id, tv.version_num
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
      fundingModel: "gift_reservation_v1",
    });

    return reply.send({ checkout_url: session.url });
  });

  // POST /web/orders — spend one existing fungible gift credit. This is the
  // non-Stripe sibling of checkout: the order, reserve debit, reservation,
  // track adoption and linkage commit as one graph or not at all.
  app.post("/web/orders", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;
    if (appConfig.PREVIEW_ONLY) {
      return sendError(
        reply,
        409,
        "FULL_RENDERS_DISABLED",
        "Full songs are paused right now.",
      );
    }
    const {
      track_id: trackId,
      track_version_id: trackVersionId,
      payment_method: paymentMethod,
    } = request.body || {};
    if (
      !trackId ||
      !trackVersionId ||
      paymentMethod !== "gift_credit"
    ) {
      return sendError(
        reply,
        400,
        "INVALID_ORDER_REQUEST",
        "track_id, track_version_id and payment_method=gift_credit are required.",
      );
    }
    const idempotencyKey = String(
      request.headers["idempotency-key"] || "",
    ).trim();
    if (!idempotencyKey) {
      return sendError(
        reply,
        400,
        "IDEMPOTENCY_KEY_REQUIRED",
        "Idempotency-Key is required.",
      );
    }
    const track = await db
      .prepare(
        `SELECT t.id, t.user_id, tv.id AS version_id, tv.version_num
         FROM tracks t
         JOIN track_versions tv ON tv.track_id = t.id
         WHERE t.id = ? AND tv.id = ? AND t.deleted_at IS NULL`,
      )
      .get(trackId, trackVersionId);
    if (!track || track.user_id !== userId) {
      return sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
    }

    const digest = crypto
      .createHash("sha256")
      .update(`${userId}:${idempotencyKey}`)
      .digest("hex")
      .slice(0, 24);
    const orderId = `worder_${digest}`;
    const existing = await orders.findById(orderId);
    if (existing) {
      if (existing.user_id !== userId) {
        return sendError(reply, 404, "ORDER_NOT_FOUND", "Order not found.");
      }
      if (
        existing.track_id !== trackId ||
        existing.track_version_id !== trackVersionId ||
        existing.payment_source !== "gift_wallet"
      ) {
        return sendError(
          reply,
          409,
          "IDEMPOTENCY_CONFLICT",
          "That idempotency key was already used for a different order.",
        );
      }
      return reply.send({
        order_id: existing.id,
        status_url: `/web/orders/by-id/${existing.id}`,
        idempotent: true,
      });
    }

    try {
      const buyerProfile = await identityRepository.findUserDisplayProfile(userId);
      await db.transaction(async (query) => {
        await orders.insertOrder({
          id: orderId,
          checkoutSessionId: `wallet:${orderId}`,
          userId,
          trackId,
          trackVersionId,
          priceKey: "gift_credit",
          amountCents: 0,
          currency: "credits",
          email: buyerProfile?.email || null,
          paymentSource: "gift_wallet",
          fundingModel: "gift_reservation_v1",
          status: "paid",
          query,
        });
        const reserved = await giftReservationService.reserveGiftCredit({
          userId,
          idempotencyKey: `web_order:${orderId}`,
          expiresAt: new Date(
            Date.now() + 24 * 60 * 60 * 1000,
          ).toISOString(),
          purpose: "paid_web_order",
          originWebOrderId: orderId,
          externalQuery: query,
        });
        await giftReservationService.adoptTrack({
          reservationId: reserved.reservation.id,
          userId,
          trackId,
          trackVersionId,
          externalQuery: query,
        });
        const attached = await giftReservationRepository.attachContent({
          reservationId: reserved.reservation.id,
          contentType: "song",
          contentId: trackId,
          versionNum: Number(track.version_num || 1),
          updatedAt: nowIso(),
          query,
        });
        const attachedRows =
          attached?.rowCount ?? attached?.changes ?? 0;
        if (!attachedRows) {
          throw Object.assign(
            new Error("GIFT_CONTENT_NOT_ADOPTABLE"),
            { code: "GIFT_CONTENT_NOT_ADOPTABLE" },
          );
        }
        const linked = await orders.linkGiftReservation({
          orderId,
          userId,
          giftReservationId: reserved.reservation.id,
          paymentSource: "gift_wallet",
          query,
        });
        if (!linked) {
          throw Object.assign(new Error("WEB_ORDER_LINK_FAILED"), {
            code: "WEB_ORDER_LINK_FAILED",
          });
        }
      });
    } catch (err) {
      if (err.code === "INSUFFICIENT_GIFT_TOKENS") {
        return sendError(
          reply,
          402,
          "INSUFFICIENT_GIFT_TOKENS",
          "Choose a gift bundle to keep going.",
        );
      }
      request.log.error({ err, orderId }, "Wallet-funded order failed");
      return sendError(
        reply,
        409,
        err.code || "WEB_ORDER_CREATE_FAILED",
        "We couldn't apply that gift credit. Please try again.",
      );
    }

    orchestrator
      .tick(orderId)
      .catch((err) =>
        request.log.error({ err, orderId }, "Wallet order tick failed"),
      );
    return reply.send({
      order_id: orderId,
      status_url: `/web/orders/by-id/${orderId}`,
      idempotent: false,
    });
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

  // GET /web/orders/by-id/:orderId — canonical cross-device recovery. Order
  // ids are locators, not credentials; the authenticated owner check is
  // mandatory and intentionally returns the same 404 for missing/foreign rows.
  app.get("/web/orders/by-id/:orderId", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const order = await orders.findById(request.params.orderId);
    if (!order || order.user_id !== userId) {
      return sendError(reply, 404, "ORDER_NOT_FOUND", "Order not found.");
    }

    const status = await orchestrator.describeOrderForStatus(order);
    reply.header("Cache-Control", "no-store");
    return reply.send({
      ...status,
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
        const chargedAmount = Number(object.amount || 0);
        const refundedAmount = Number(object.amount_refunded || 0);
        if (
          chargedAmount > 0 &&
          refundedAmount >= 0 &&
          refundedAmount < chargedAmount
        ) {
          request.log.info(
            {
              chargeId: object.id || null,
              refundedAmount,
              chargedAmount,
            },
            "Partial Stripe refund recorded; gift grant remains until the charge is fully refunded",
          );
          return;
        }
        await handleRefundOrDispute(object, "refunded", {
          providerEventId: event.id,
        });
        return;
      }
      case "charge.dispute.created": {
        const disputed = object.charge
          ? { payment_intent: object.payment_intent }
          : object;
        await handleRefundOrDispute(disputed, "refunded", {
          dispute: true,
          providerEventId: event.id,
        });
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
    { dispute = false, providerEventId = null } = {},
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

    if (
      order.funding_model === "gift_reservation_v1" &&
      order.purchase_transaction_id
    ) {
      const reconciliation = await db.transaction(async (query) => {
        const lockedResult = await query(
          `SELECT * FROM web_orders WHERE id = ?${
            db.isPostgres ? " FOR UPDATE" : ""
          }`,
          [order.id],
        );
        const lockedOrder = lockedResult?.rows?.[0] || null;
        if (!lockedOrder || lockedOrder.status === toStatus) {
          return { idempotent: true, reservationRefunded: false };
        }

        const reservationResult = lockedOrder.gift_reservation_id
          ? await query(
              `SELECT * FROM gift_reservations WHERE id = ?${
                db.isPostgres ? " FOR UPDATE" : ""
              }`,
              [lockedOrder.gift_reservation_id],
            )
          : null;
        const reservation = reservationResult?.rows?.[0] || null;
        const purchaseResult = await query(
          `SELECT amount FROM gift_wallet_transactions
           WHERE id = ? AND user_id = ? AND amount > 0${
             db.isPostgres ? " FOR UPDATE" : ""
           }`,
          [
            lockedOrder.purchase_transaction_id,
            lockedOrder.user_id,
          ],
        );
        const purchaseGrant = purchaseResult?.rows?.[0] || null;
        if (!purchaseGrant) {
          const err = new Error("GIFT_PURCHASE_GRANT_NOT_FOUND");
          err.code = "GIFT_PURCHASE_GRANT_NOT_FOUND";
          throw err;
        }
        let reservationRefunded = false;
        if (
          reservation &&
          ["reserved", "content_ready"].includes(reservation.status)
        ) {
          await app.refundGiftReservationById({
            reservationId: reservation.id,
            userId: lockedOrder.user_id,
            reason: "payment_refunded_before_finalization",
            source: "stripe_refund",
            description:
              "Gift reservation released after payment refund before finalization",
            externalQuery: query,
            skipSideEffects: true,
          });
          reservationRefunded = true;
        }
        await giftPurchaseReversalService.reverseGiftPurchaseGrant({
          userId: lockedOrder.user_id,
          purchaseTransactionId: lockedOrder.purchase_transaction_id,
          tokenCount: Number(purchaseGrant.amount),
          provider: "stripe",
          providerEventId:
            providerEventId ||
            `${paymentIntentId}:${dispute ? "dispute" : "refund"}`,
          externalQuery: query,
        });
        await orders.updateStatus({
          orderId: lockedOrder.id,
          fromStatus: [
            "pending",
            "paid",
            "rendering",
            "delivered",
            "failed",
          ],
          toStatus,
          query,
        });
        return { idempotent: false, reservationRefunded };
      });
      if (reconciliation?.reservationRefunded) {
        app.log.info(
          {
            orderId: order.id,
            reservationId: order.gift_reservation_id,
          },
          "Released unfinalized gift reservation after payment refund",
        );
      }
    } else {
      await orders.updateStatus({
        orderId: order.id,
        fromStatus: ["pending", "paid", "rendering", "delivered", "failed"],
        toStatus,
      });
      // Legacy orders retain their historical share-revocation behavior.
      if (order.share_token_id) {
        await db
          .prepare(
            "UPDATE share_tokens SET status = 'revoked' WHERE id = ? AND status != 'revoked'",
          )
          .run(order.share_token_id);
      }
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
