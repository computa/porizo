"use strict";

function registerAdminBillingRoutes(
  app,
  {
    adminBillingRepo,
    auditService,
    billingService,
    entitlementsService,
    planConfigService,
    requireAdminRole,
    requireAdminSession,
    sendError,
    subscriptionManager,
    validateReason,
  },
) {
  app.put("/admin/dashboard/users/:id/entitlements", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    const fields = request.body || {};
    const result = await entitlementsService.updateUserEntitlements(
      request.params.id,
      fields,
      admin.adminId,
    );
    if (!result.success) {
      sendError(reply, 400, "INVALID_PARAMS", result.error);
      return;
    }
    reply.send(result);
  });

  // --- Admin Complimentary Upgrades ---

  app.post(
    "/admin/dashboard/users/:id/complimentary-upgrade",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;

      const { tier, duration_days, reason } = request.body || {};

      if (!tier || !["plus", "pro"].includes(tier)) {
        return sendError(
          reply,
          400,
          "INVALID_TIER",
          "Tier must be 'plus' or 'pro'",
        );
      }
      if (
        !Number.isInteger(duration_days) ||
        duration_days < 1 ||
        duration_days > 365
      ) {
        return sendError(
          reply,
          400,
          "INVALID_DURATION",
          "Duration must be 1-365 days (integer)",
        );
      }
      const trimmedReason = validateReason(reason, reply);
      if (!trimmedReason) return;

      try {
        const result = await subscriptionManager.adminComplimentaryUpgrade(
          request.params.id,
          tier,
          duration_days,
          trimmedReason,
          admin.adminId,
        );
        reply.send(result);
      } catch (err) {
        console.error("[Admin] Complimentary upgrade error:", err);
        sendError(
          reply,
          500,
          "UPGRADE_ERROR",
          "Internal error processing upgrade",
        );
      }
    },
  );

  app.delete(
    "/admin/dashboard/users/:id/complimentary-upgrade",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;

      const { reason } = request.body || {};
      const trimmedReason = validateReason(reason, reply);
      if (!trimmedReason) return;

      try {
        const result = await subscriptionManager.revokeComplimentaryUpgrade(
          request.params.id,
          trimmedReason,
          admin.adminId,
        );
        reply.send(result);
      } catch (err) {
        console.error("[Admin] Revoke upgrade error:", err);
        sendError(
          reply,
          500,
          "REVOKE_ERROR",
          "Internal error processing revocation",
        );
      }
    },
  );


  // --- Billing & Revenue ---

  app.get("/admin/dashboard/billing/revenue", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const days = parseInt(request.query.days) || 30;
    const metrics = await billingService.getRevenueMetrics(days);
    reply.send(metrics);
  });

  app.get("/admin/dashboard/billing/subscriptions", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const health = await billingService.getSubscriptionHealth();
    reply.send(health);
  });

  app.get("/admin/dashboard/billing/sales", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const sales = await billingService.getBillingSales({
      days: request.query.days || 30,
      limit: request.query.limit,
      offset: request.query.offset,
    });
    reply.send(sales);
  });

  app.get("/admin/dashboard/billing/transactions", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { limit, offset } = request.query;
    const transactions = await billingService.getBillingTransactions({
      limit,
      offset,
    });
    reply.send({ transactions });
  });


  // --- Subscription Plan Management ---

  app.get("/admin/billing/plans", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    try {
      const plans = await planConfigService.getPlans({ includeInactive: true });
      reply.send({ plans });
    } catch (err) {
      console.error("[Admin] Get plans error:", err);
      sendError(
        reply,
        500,
        "PLANS_ERROR",
        "Failed to load subscription plans.",
      );
    }
  });

  app.put("/admin/billing/plans/:id", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;

    const { id } = request.params;
    const body = request.body || {};

    // Allowlist and type-validate fields
    const updates = {};
    const intFields = [
      "songs_per_month",
      "poems_per_month",
      "previews_per_day",
      "price_monthly_cents",
      "price_annual_cents",
      "sort_order",
    ];
    for (const field of intFields) {
      if (body[field] !== undefined) {
        const val = parseInt(body[field], 10);
        if (!Number.isInteger(val) || val < 0) {
          sendError(
            reply,
            400,
            "INVALID_FIELD",
            `${field} must be a non-negative integer.`,
          );
          return;
        }
        updates[field] = val;
      }
    }
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length === 0 || name.length > 200) {
        sendError(
          reply,
          400,
          "INVALID_FIELD",
          "name must be 1-200 characters.",
        );
        return;
      }
      updates.name = name;
    }
    if (body.description !== undefined) {
      const desc = String(body.description).trim();
      if (desc.length > 500) {
        sendError(
          reply,
          400,
          "INVALID_FIELD",
          "description must be at most 500 characters.",
        );
        return;
      }
      updates.description = desc;
    }
    if (body.is_active !== undefined)
      updates.is_active = Boolean(body.is_active);
    if (body.features_json !== undefined) {
      if (!Array.isArray(body.features_json)) {
        sendError(
          reply,
          400,
          "INVALID_FIELD",
          "features_json must be an array.",
        );
        return;
      }
      if (!body.features_json.every((f) => typeof f === "string")) {
        sendError(
          reply,
          400,
          "INVALID_FIELD",
          "features_json elements must be strings.",
        );
        return;
      }
      if (body.features_json.length > 20) {
        sendError(
          reply,
          400,
          "INVALID_FIELD",
          "features_json must have at most 20 items.",
        );
        return;
      }
      updates.features_json = body.features_json;
    }

    if (Object.keys(updates).length === 0) {
      sendError(reply, 400, "NO_UPDATES", "No valid fields to update.");
      return;
    }

    try {
      const updated = await planConfigService.updatePlan(id, updates);
      if (!updated) {
        sendError(reply, 404, "PLAN_NOT_FOUND", "Plan not found.");
        return;
      }

      await auditService.audit(
        admin.adminId,
        "admin_update_plan",
        "subscription_plan",
        id,
        {
          updates,
        },
      );

      reply.send({ plan: updated });
    } catch (err) {
      console.error("[Admin] Update plan error:", err);
      sendError(reply, 500, "PLAN_UPDATE_ERROR", "Failed to update plan.");
    }
  });

  // --- Gift Bundle Management ---

  app.get("/admin/billing/gift-bundles", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    try {
      const bundles = await adminBillingRepo.listGiftBundlesForAdmin();
      reply.send({ bundles });
    } catch (err) {
      console.error("[Admin] Get gift bundles error:", err);
      sendError(reply, 500, "GIFT_BUNDLES_ERROR", err.message);
    }
  });

  app.put("/admin/billing/gift-bundles/:id", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;

    const { id } = request.params;
    const updates = request.body || {};

    const allowedFields = [
      "token_count",
      "display_name",
      "description",
      "is_active",
      "sort_order",
    ];
    const filteredUpdates = {};
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        filteredUpdates[field] = updates[field];
      }
    }

    if (Object.keys(filteredUpdates).length === 0) {
      sendError(reply, 400, "NO_UPDATES", "No valid fields to update.");
      return;
    }

    // Validate token_count
    if (filteredUpdates.token_count !== undefined) {
      const tc = parseInt(filteredUpdates.token_count, 10);
      if (!Number.isInteger(tc) || tc < 1 || tc > 10) {
        sendError(
          reply,
          400,
          "INVALID_TOKEN_COUNT",
          "token_count must be an integer between 1 and 10.",
        );
        return;
      }
      filteredUpdates.token_count = tc;
    }

    // Validate sort_order
    if (filteredUpdates.sort_order !== undefined) {
      const so = parseInt(filteredUpdates.sort_order, 10);
      if (!Number.isInteger(so) || so < 0) {
        sendError(
          reply,
          400,
          "INVALID_SORT_ORDER",
          "sort_order must be a non-negative integer.",
        );
        return;
      }
      filteredUpdates.sort_order = so;
    }

    try {
      // Fetch previous values for audit
      const previous = await adminBillingRepo.getGiftBundleById(id);
      if (!previous) {
        sendError(reply, 404, "BUNDLE_NOT_FOUND", "Gift bundle not found.");
        return;
      }

      await adminBillingRepo.updateGiftBundleFields({
        id,
        updates: filteredUpdates,
        updatedAt: new Date().toISOString(),
        updatedBy: admin.adminId,
      });

      // Audit with previous + new values
      await auditService.audit(
        admin.adminId,
        "admin_update_gift_bundle",
        "gift_bundle",
        id,
        {
          previous: {
            token_count: previous.token_count,
            display_name: previous.display_name,
            is_active: previous.is_active,
            sort_order: previous.sort_order,
          },
          updated: filteredUpdates,
        },
      );

      const updated = await adminBillingRepo.getGiftBundleById(id);
      reply.send({ success: true, bundle: updated });
    } catch (err) {
      request.log.error({ err }, "[Admin] Update gift bundle error");
      sendError(reply, 500, "UPDATE_ERROR", "An internal error occurred.");
    }
  });


}

module.exports = { registerAdminBillingRoutes };
