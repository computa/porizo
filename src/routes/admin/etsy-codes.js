"use strict";

const {
  createGiftWalletRepository,
} = require("../../database/gift-wallet-repository");
const {
  createEtsyRedemptionService,
} = require("../../services/etsy-redemption-service");

// Gate A instrumentation for the Etsy wedge (plan 2026-07-21-001 §0.7.5): the
// operator mints a batch, exports the codes into Etsy order inserts, then
// watches issued/redeemed/unredeemed to see whether the listing converts.
function registerAdminEtsyCodeRoutes(
  app,
  {
    db,
    requireAdminRole,
    auditService,
    sendError,
    etsyOrderService = null,
    etsyArtifactService = null,
    etsyClient = null,
  },
) {
  const etsyRedemptionService = createEtsyRedemptionService({
    db,
    giftWalletRepository: createGiftWalletRepository(db),
  });
  const auditOnce = async (
    idempotencyKey,
    adminId,
    action,
    resourceType,
    resourceId,
    metadata,
  ) => {
    if (typeof auditService.auditOnce === "function") {
      return auditService.auditOnce(
        idempotencyKey,
        adminId,
        action,
        resourceType,
        resourceId,
        metadata,
      );
    }
    return auditService.audit(
      adminId,
      action,
      resourceType,
      resourceId,
      metadata,
    );
  };
  const requireOperationKey = (request, reply) => {
    const value = String(request.headers["idempotency-key"] || "").trim();
    if (value.length < 8 || value.length > 128) {
      sendError(
        reply,
        400,
        "IDEMPOTENCY_KEY_REQUIRED",
        "A unique Idempotency-Key is required for this operation.",
      );
      return null;
    }
    return value;
  };

  app.post("/admin/dashboard/etsy/codes/mint", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    sendError(
      reply,
      410,
      "ETSY_UNASSIGNED_MINT_RETIRED",
      "Unassigned Etsy bearer-code minting has been retired.",
    );
  });

  app.get("/admin/dashboard/etsy/codes", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, [
      "admin",
      "superadmin",
    ]);
    if (!admin) return;

    const batchLabel = request.query?.batch_label || null;
    const status = request.query?.status || null;
    const { codes, limit, offset } = await etsyRedemptionService.listCodes({
      batchLabel,
      status,
      limit: request.query?.limit,
      offset: request.query?.offset,
    });
    // counts are always the whole-batch breakdown (the Gate A number), so they
    // ignore the row-level status filter above.
    const counts = await etsyRedemptionService.countByStatus({ batchLabel });
    reply.header("Cache-Control", "no-store");
    const sales = etsyOrderService ? await etsyOrderService.metrics() : null;
    reply.send({ codes, legacy_inventory_counts: counts, sales, limit, offset });
  });

  app.post("/admin/dashboard/etsy/codes/void", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;

    const code =
      typeof request.body?.code === "string" ? request.body.code : "";
    if (!code.trim()) {
      sendError(reply, 400, "CODE_REQUIRED", "code is required.");
      return;
    }
    const reason =
      typeof request.body?.reason === "string" ? request.body.reason : null;

    try {
      const result = await etsyRedemptionService.voidCode({ code, reason });
      await auditService.audit(
        admin.adminId,
        "etsy_legacy_code_voided",
        "etsy_redemption_code",
        `last4:${String(code).slice(-4)}`,
        { reason: reason || null },
      );
      reply.header("Cache-Control", "no-store");
      reply.send({ voided: result.voided, code_last4: String(code).slice(-4) });
    } catch (err) {
      if (err?.code === "CODE_NOT_VOIDABLE") {
        sendError(
          reply,
          409,
          "CODE_NOT_VOIDABLE",
          "Only an unredeemed code can be voided.",
        );
        return;
      }
      throw err;
    }
  });

  app.post(
    "/admin/dashboard/etsy/orders/:id/retry-mp3",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      reply.header("Cache-Control", "no-store");
      const operationKey = requireOperationKey(request, reply);
      if (!operationKey) return;
      if (!etsyArtifactService) {
        return sendError(
          reply,
          503,
          "ETSY_ARTIFACT_REPAIR_UNAVAILABLE",
          "Etsy artifact repair is unavailable.",
        );
      }
      const order = await db
        .prepare("SELECT * FROM web_orders WHERE id = ?")
        .get(request.params.id);
      const unit = order
        ? null
        : await db
            .prepare("SELECT id FROM etsy_order_units WHERE id = ?")
            .get(request.params.id);
      if (!order && !unit) {
        return sendError(reply, 404, "ORDER_NOT_FOUND", "Order not found.");
      }
      await auditOnce(
        `etsy-mp3-retry:${request.params.id}:${operationKey}`,
        admin.adminId,
        "etsy_mp3_repair_replayed",
        order ? "web_order" : "etsy_order_unit",
        order?.id || unit.id,
        { requested: true },
      );
      const result = order
        ? await etsyArtifactService.retryForOrder(order)
        : await etsyArtifactService.retryForUnit(unit.id);
      if (!result.required) {
        return sendError(
          reply,
          409,
          "NOT_ETSY_ORDER",
          "That order is not Etsy-backed.",
        );
      }
      return reply.send({
        order_id: order?.id,
        etsy_unit_id: unit?.id,
        ready: Boolean(result.ready),
        exhausted: Boolean(result.exhausted),
      });
    },
  );

  app.post(
    "/admin/dashboard/etsy/orders/:receiptId/refund",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      reply.header("Cache-Control", "no-store");
      return sendError(
        reply,
        410,
        "ETSY_REFUND_ROUTE_RETIRED",
        "Issue the monetary refund in Etsy Shop Manager, then use the local reversal endpoint with its evidence reference.",
      );
    },
  );

  app.post(
    "/admin/dashboard/etsy/orders/:receiptId/local-reversal",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      reply.header("Cache-Control", "no-store");
      const reason = String(request.body?.reason || "").trim();
      const evidenceReference = String(
        request.body?.etsy_refund_evidence || "",
      ).trim();
      if (reason.length < 3) {
        return sendError(reply, 400, "REASON_REQUIRED", "A refund reason is required.");
      }
      if (evidenceReference.length < 3) {
        return sendError(
          reply,
          400,
          "ETSY_REFUND_EVIDENCE_REQUIRED",
          "An Etsy refund or cancellation evidence reference is required.",
        );
      }
      await auditOnce(
        `etsy-local-reversal:${request.params.receiptId}:${evidenceReference}`,
        admin.adminId,
        "etsy_order_entitlement_reversal_requested",
        "etsy_receipt",
        String(request.params.receiptId),
        {
          reason,
          etsy_refund_evidence: evidenceReference,
          money_refunded: false,
        },
      );
      const result = await etsyOrderService.cancelReceipt({
        receiptId: request.params.receiptId,
        providerEventId: `admin_local_reversal:${request.params.receiptId}:${evidenceReference}`,
      });
      if (!result.found) {
        return sendError(reply, 404, "ETSY_ORDER_NOT_FOUND", "Order not found.");
      }
      return reply.send({
        entitlement_reversed: true,
        money_refunded: false,
        reversed: result.reversed,
      });
    },
  );

  app.post("/admin/dashboard/etsy/reconcile", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    const operationKey = requireOperationKey(request, reply);
    if (!operationKey) return;
    if (!etsyClient?.configured?.()) {
      return sendError(
        reply,
        503,
        "ETSY_API_UNCONFIGURED",
        "Etsy reconciliation is not configured.",
      );
    }
    await auditOnce(
      `etsy-reconcile:${operationKey}`,
      admin.adminId,
      "etsy_reconciliation_requested",
      "etsy_shop",
      process.env.ETSY_SHOP_ID || "configured",
      { requested: true },
    );
    const result = await etsyOrderService.reconcileReceipts(etsyClient);
    return reply.send(result);
  });
}

module.exports = { registerAdminEtsyCodeRoutes };
