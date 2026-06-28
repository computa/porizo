"use strict";

const { acknowledgeGiftIncident } = require("../../services/gift-delivery-ops");

const GIFT_OPS_READ_ROLES = ["admin", "superadmin"];

function isGiftOpsSchemaError(err) {
  const message = String(err?.message || "").toLowerCase();
  return (
    message.includes("no such table: gift_delivery_incidents") ||
    message.includes("no such table: gift_delivery_outbox") ||
    message.includes("no such column: overdue_detected_at") ||
    message.includes("no such column: provider_accepted_at") ||
    message.includes("no such column: receipt_status") ||
    message.includes('relation "gift_delivery_incidents" does not exist') ||
    message.includes('relation "gift_delivery_outbox" does not exist') ||
    message.includes('column "overdue_detected_at" does not exist') ||
    message.includes('column "provider_accepted_at" does not exist') ||
    message.includes('column "receipt_status" does not exist')
  );
}

function handleGiftOpsRouteError(sendError, reply, err) {
  if (!isGiftOpsSchemaError(err)) {
    return false;
  }
  sendError(
    reply,
    503,
    "GIFT_OPS_MIGRATION_REQUIRED",
    "Gift operations observability schema is not applied in this environment yet.",
  );
  return true;
}

function registerAdminGiftOpsRoutes(
  app,
  {
    db,
    adminGiftOpsService,
    adminService,
    parsePagination,
    requireAdminRole,
    sendError,
  },
) {
  app.get("/admin/dashboard/gifts/overview", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, GIFT_OPS_READ_ROLES);
    if (!admin) return;
    try {
      reply.send(await adminGiftOpsService.getOverview());
    } catch (err) {
      if (!handleGiftOpsRouteError(sendError, reply, err)) throw err;
    }
  });

  app.get("/admin/dashboard/gifts/orders", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, GIFT_OPS_READ_ROLES);
    if (!admin) return;
    const { limit, offset } = parsePagination(request.query, 50);
    try {
      const orders = await adminGiftOpsService.listOrders(
        {
          status: request.query?.status,
          dispatchStatus: request.query?.dispatchStatus,
          deliveryMode: request.query?.deliveryMode,
          channel: request.query?.channel,
          overdue: request.query?.overdue,
          search: request.query?.search,
          senderUserId: request.query?.senderUserId,
          creator: request.query?.creator,
          recipient: request.query?.recipient,
          dateFrom: request.query?.dateFrom,
          dateTo: request.query?.dateTo,
        },
        { limit, offset },
      );
      reply.send({ orders, limit, offset });
    } catch (err) {
      if (!handleGiftOpsRouteError(sendError, reply, err)) throw err;
    }
  });

  app.get("/admin/dashboard/gifts/orders/:id", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, GIFT_OPS_READ_ROLES);
    if (!admin) return;
    const includeSensitive =
      admin.role === "superadmin" &&
      String(request.query?.include_sensitive || "") === "true";
    try {
      const detail = await adminGiftOpsService.getOrderDetail(
        request.params.id,
        { includeSensitive },
      );
      if (!detail) {
        sendError(reply, 404, "NOT_FOUND", "Gift order not found");
        return;
      }
      reply.send(detail);
    } catch (err) {
      if (!handleGiftOpsRouteError(sendError, reply, err)) throw err;
    }
  });

  app.get("/admin/dashboard/gifts/outbox", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, GIFT_OPS_READ_ROLES);
    if (!admin) return;
    const { limit, offset } = parsePagination(request.query, 100);
    try {
      const outbox = await adminGiftOpsService.listOutbox(
        {
          status: request.query?.status,
          receiptStatus: request.query?.receiptStatus,
          provider: request.query?.provider,
          channel: request.query?.channel,
          overdue: request.query?.overdue,
          attemptMin: request.query?.attemptMin,
          attemptMax: request.query?.attemptMax,
        },
        { limit, offset },
      );
      reply.send({ outbox, limit, offset });
    } catch (err) {
      if (!handleGiftOpsRouteError(sendError, reply, err)) throw err;
    }
  });

  app.get("/admin/dashboard/gifts/incidents", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, GIFT_OPS_READ_ROLES);
    if (!admin) return;
    const { limit, offset } = parsePagination(request.query, 100);
    try {
      const incidents = await adminGiftOpsService.listIncidents(
        {
          status: request.query?.status,
          severity: request.query?.severity,
          type: request.query?.type,
        },
        { limit, offset },
      );
      reply.send({ incidents, limit, offset });
    } catch (err) {
      if (!handleGiftOpsRouteError(sendError, reply, err)) throw err;
    }
  });

  app.post(
    "/admin/dashboard/gifts/incidents/:id/acknowledge",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      try {
        const incidentRecord = await adminGiftOpsService.getIncidentById(
          request.params.id,
        );
        if (!incidentRecord) {
          sendError(reply, 404, "NOT_FOUND", "Gift incident not found");
          return;
        }
        const incident = await acknowledgeGiftIncident(
          db,
          incidentRecord.incident_key,
          admin.adminId,
        );
        await adminService._audit(
          admin.adminId,
          "gift_incident_acknowledged",
          "gift_incident",
          incidentRecord.id,
          {
            gift_order_id: incidentRecord.gift_order_id,
            incident_type: incidentRecord.incident_type,
            note: request.body?.note || null,
          },
        );
        reply.send({ incident });
      } catch (err) {
        if (!handleGiftOpsRouteError(sendError, reply, err)) throw err;
      }
    },
  );

  app.post(
    "/admin/dashboard/gifts/orders/:id/retry",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      try {
        const gift = await app.retryGiftOrderById(request.params.id, {
          actorUserId: admin.adminId,
          actorType: "admin",
        });
        await adminService._audit(
          admin.adminId,
          "gift_dispatch_requeued",
          "gift_order",
          request.params.id,
          {
            reason: request.body?.reason || null,
          },
        );
        reply.send({ gift });
      } catch (err) {
        const code = err?.code || "GIFT_RETRY_FAILED";
        if (code === "GIFT_NOT_FOUND")
          return sendError(reply, 404, code, "Gift order not found");
        if (code === "GIFT_CANCELLED")
          return sendError(
            reply,
            409,
            code,
            "Cancelled gifts cannot be retried",
          );
        if (code === "GIFT_NOT_RETRYABLE")
          return sendError(reply, 409, code, "Gift is not retryable");
        if (code === "GIFT_ALREADY_PARTIALLY_DISPATCHED")
          return sendError(
            reply,
            409,
            code,
            "Gift has already delivered at least one channel and cannot be requeued blindly",
          );
        request.log.error({ err }, "Admin gift retry failed");
        sendError(
          reply,
          500,
          "GIFT_RETRY_FAILED",
          "Failed to retry gift order",
        );
      }
    },
  );

  app.post(
    "/admin/dashboard/gifts/orders/:id/cancel",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      try {
        const result = await app.cancelGiftOrderById(request.params.id, {
          actorUserId: admin.adminId,
          actorType: "admin",
        });
        await adminService._audit(
          admin.adminId,
          "gift_cancelled_by_admin",
          "gift_order",
          request.params.id,
          {
            reason: request.body?.reason || null,
            refund_transaction_id: result.refundTxId || null,
          },
        );
        reply.send({
          cancelled: true,
          gift: result.gift,
          wallet_balance: result.walletBalance,
        });
      } catch (err) {
        const code = err?.code || "GIFT_CANCEL_FAILED";
        if (code === "GIFT_NOT_FOUND")
          return sendError(reply, 404, code, "Gift order not found");
        if (code === "GIFT_ALREADY_DISPATCHED")
          return sendError(
            reply,
            409,
            code,
            "Gift has already been dispatched",
          );
        if (code === "GIFT_NOT_CANCELLABLE")
          return sendError(
            reply,
            409,
            code,
            "Gift cannot be cancelled in its current state",
          );
        if (code === "GIFT_ALREADY_PARTIALLY_DISPATCHED")
          return sendError(
            reply,
            409,
            code,
            "Gift already partially delivered and cannot be cancelled",
          );
        request.log.error({ err }, "Admin gift cancel failed");
        sendError(
          reply,
          500,
          "GIFT_CANCEL_FAILED",
          "Failed to cancel gift order",
        );
      }
    },
  );

  app.post(
    "/admin/dashboard/gifts/orders/:id/mark-overdue-reviewed",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      const incident = await acknowledgeGiftIncident(
        db,
        `gift_overdue:${request.params.id}`,
        admin.adminId,
      );
      await adminService._audit(
        admin.adminId,
        "gift_overdue_acknowledged",
        "gift_order",
        request.params.id,
        {
          note: request.body?.note || null,
        },
      );
      reply.send({ incident });
    },
  );

  app.post(
    "/admin/dashboard/gifts/orders/:id/manual-recovery-note",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      const note =
        typeof request.body?.note === "string" ? request.body.note.trim() : "";
      if (note.length < 5) {
        sendError(
          reply,
          400,
          "INVALID_NOTE",
          "Recovery note must be at least 5 characters",
        );
        return;
      }
      await adminService._audit(
        admin.adminId,
        "gift_manual_recovery_note",
        "gift_order",
        request.params.id,
        {
          note: note.slice(0, 1000),
        },
      );
      reply.send({ ok: true });
    },
  );
}

module.exports = { registerAdminGiftOpsRoutes };
