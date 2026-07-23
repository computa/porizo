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
  { db, requireAdminSession, sendError },
) {
  const etsyRedemptionService = createEtsyRedemptionService({
    db,
    giftWalletRepository: createGiftWalletRepository(db),
  });

  app.post("/admin/dashboard/etsy/codes/mint", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    const batchLabel =
      typeof request.body?.batch_label === "string"
        ? request.body.batch_label.trim()
        : "";
    if (!batchLabel) {
      sendError(reply, 400, "BATCH_LABEL_REQUIRED", "batch_label is required.");
      return;
    }

    const count = Number(request.body?.count);
    if (!Number.isInteger(count) || count < 1 || count > 1000) {
      sendError(reply, 400, "INVALID_BATCH_COUNT", "count must be 1-1000.");
      return;
    }

    const codes = await etsyRedemptionService.mintBatch({ batchLabel, count });
    reply.send({ codes, batch_label: batchLabel });
  });

  app.get("/admin/dashboard/etsy/codes", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
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
    reply.send({ codes, counts, limit, offset });
  });

  app.post("/admin/dashboard/etsy/codes/void", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
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
      reply.send(result);
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
}

module.exports = { registerAdminEtsyCodeRoutes };
