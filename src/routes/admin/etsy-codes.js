"use strict";

const {
  createGiftWalletRepository,
} = require("../../database/gift-wallet-repository");
const {
  createEtsyRedemptionService,
} = require("../../services/etsy-redemption-service");
const {
  getEtsyFulfilmentMode,
} = require("../../services/etsy-fulfilment-mode");

// Etsy fulfilment operations. Code mode assigns one audited bearer code to one
// paid receipt; API mode owns provider reconciliation and automation.
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

  const requireCodeMode = async (reply) => {
    const mode = await getEtsyFulfilmentMode(db);
    if (mode !== "code") {
      sendError(
        reply,
        409,
        "ETSY_CODE_MODE_REQUIRED",
        "Manual code issuance is available only in Etsy code mode.",
      );
      return false;
    }
    return true;
  };
  const requireApiMode = async (reply) => {
    const mode = await getEtsyFulfilmentMode(db);
    if (mode !== "api") {
      sendError(
        reply,
        409,
        "ETSY_API_MODE_REQUIRED",
        "Etsy provider reconciliation is available only in API mode.",
      );
      return false;
    }
    return true;
  };

  app.post("/admin/dashboard/etsy/codes/issue", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    if (!(await requireCodeMode(reply))) return;
    const operationKey = requireOperationKey(request, reply);
    if (!operationKey) return;

    const receiptId = String(request.body?.receipt_id || "").trim();
    const batchLabel = String(request.body?.batch_label || "").trim();
    const listingId = String(request.body?.listing_id || "").trim() || null;
    if (!receiptId) {
      return sendError(
        reply,
        400,
        "RECEIPT_ID_REQUIRED",
        "receipt_id is required.",
      );
    }
    if (!batchLabel) {
      return sendError(
        reply,
        400,
        "BATCH_LABEL_REQUIRED",
        "batch_label is required.",
      );
    }

    try {
      const result = await etsyRedemptionService.issueForReceipt({
        receiptId,
        listingId,
        batchLabel,
        adminId: admin.adminId,
      });
      await auditOnce(
        `etsy-code-issue:${operationKey}`,
        admin.adminId,
        "etsy_code_assigned",
        "etsy_receipt",
        receiptId,
        {
          batch_label: batchLabel,
          listing_id: listingId,
          code_last4: result.code.slice(-4),
        },
      );
      return reply.code(201).send({
        receipt_id: receiptId,
        code: result.code,
        state: result.state,
      });
    } catch (error) {
      if (error?.code === "RECEIPT_ALREADY_ASSIGNED") {
        return sendError(
          reply,
          409,
          error.code,
          "That Etsy receipt already has an assigned code.",
        );
      }
      throw error;
    }
  });

  app.post(
    "/admin/dashboard/etsy/codes/:receiptId/reveal",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      reply.header("Cache-Control", "no-store");
      if (!(await requireCodeMode(reply))) return;
      const operationKey = requireOperationKey(request, reply);
      if (!operationKey) return;
      try {
        const result = await etsyRedemptionService.revealAssignedCode({
          receiptId: request.params.receiptId,
        });
        await auditOnce(
          `etsy-code-reveal:${operationKey}`,
          admin.adminId,
          "etsy_code_revealed",
          "etsy_receipt",
          result.receiptId,
          { code_last4: result.code.slice(-4) },
        );
        return reply.send({
          receipt_id: result.receiptId,
          code: result.code,
          state: result.state,
        });
      } catch (error) {
        if (error?.code === "ASSIGNMENT_NOT_REVEALABLE") {
          return sendError(reply, 409, error.code, error.message);
        }
        throw error;
      }
    },
  );

  app.post(
    "/admin/dashboard/etsy/codes/:receiptId/delivered",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      reply.header("Cache-Control", "no-store");
      if (!(await requireCodeMode(reply))) return;
      const operationKey = requireOperationKey(request, reply);
      if (!operationKey) return;
      const deliveryReference = String(
        request.body?.delivery_reference || "",
      ).trim();
      if (!deliveryReference) {
        return sendError(
          reply,
          400,
          "DELIVERY_REFERENCE_REQUIRED",
          "delivery_reference is required.",
        );
      }
      try {
        const result = await etsyRedemptionService.markDelivered({
          receiptId: request.params.receiptId,
          deliveryReference,
        });
        await auditOnce(
          `etsy-code-delivered:${operationKey}`,
          admin.adminId,
          "etsy_code_delivered",
          "etsy_receipt",
          result.receiptId,
          { delivery_reference: deliveryReference },
        );
        return reply.send({
          receipt_id: result.receiptId,
          state: result.state,
        });
      } catch (error) {
        if (error?.code === "ASSIGNMENT_NOT_DELIVERABLE") {
          return sendError(reply, 409, error.code, error.message);
        }
        throw error;
      }
    },
  );

  app.post(
    "/admin/dashboard/etsy/codes/:receiptId/local-reversal",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      reply.header("Cache-Control", "no-store");
      const operationKey = requireOperationKey(request, reply);
      if (!operationKey) return;
      const reason = String(request.body?.reason || "").trim();
      const refundEvidence = String(
        request.body?.etsy_refund_evidence || "",
      ).trim();
      if (reason.length < 3) {
        return sendError(
          reply,
          400,
          "REASON_REQUIRED",
          "A refund reason is required.",
        );
      }
      if (refundEvidence.length < 3) {
        return sendError(
          reply,
          400,
          "ETSY_REFUND_EVIDENCE_REQUIRED",
          "An Etsy refund or cancellation evidence reference is required.",
        );
      }
      try {
        const result = await etsyRedemptionService.reverseAssignment({
          receiptId: request.params.receiptId,
          refundEvidence,
          reason,
        });
        await auditOnce(
          `etsy-code-reversal:${operationKey}`,
          admin.adminId,
          "etsy_code_entitlement_reversal",
          "etsy_receipt",
          result.receiptId,
          {
            reason,
            etsy_refund_evidence: refundEvidence,
            entitlement_reversed: result.entitlementReversed,
            assignment_state: result.state,
            money_refunded: false,
          },
        );
        return reply.send({
          receipt_id: result.receiptId,
          state: result.state,
          entitlement_reversed: result.entitlementReversed,
          manual_review: result.state === "manual_review",
          money_refunded: false,
        });
      } catch (error) {
        if (error?.code === "ASSIGNMENT_NOT_FOUND") {
          return sendError(reply, 404, error.code, error.message);
        }
        throw error;
      }
    },
  );

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
    if (!(await requireApiMode(reply))) return;
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
