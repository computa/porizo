"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { artifactIsReady } = require("../../services/etsy-mto-service");

function operationKey(request, reply, sendError) {
  const value = String(request.headers["idempotency-key"] || "").trim();
  if (value.length < 8 || value.length > 128) {
    sendError(reply, 400, "IDEMPOTENCY_KEY_REQUIRED", "A unique Idempotency-Key is required.");
    return null;
  }
  return value;
}

function statusFor(error) {
  if (error?.code === "ETSY_MTO_NOT_FOUND") return 404;
  if (String(error?.code || "").includes("CONFLICT")) return 409;
  if (String(error?.code || "").includes("UNCONFIGURED")) return 503;
  if (String(error?.code || "").includes("NOT_PAID")) return 422;
  return 400;
}

function registerAdminEtsyMtoRoutes(
  app,
  { repository, service, pipeline, orderFiles, storageProvider, requireAdminRole, auditService, etsyOAuthAuthorization, sendError },
) {
  async function audit(adminId, key, action, itemId, metadata) {
    return auditService.auditOnce(
      `etsy-mto:${action}:${itemId}:${key}`,
      adminId,
      action,
      "etsy_mto_item",
      itemId,
      metadata,
    );
  }

  app.get("/admin/dashboard/etsy/mto", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    const state = String(request.query?.state || "").trim();
    const rows = await repository.listItems({ state: state || null });
    return reply.send({ items: rows.map((item) => ({ ...item, brief: JSON.parse(item.brief_json) })) });
  });

  app.post("/admin/dashboard/etsy/mto/connection/start", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    try {
      return reply.send(await etsyOAuthAuthorization.start({ adminId: admin.adminId }));
    } catch (error) {
      return sendError(reply, 503, error.code || "ETSY_OAUTH_UNAVAILABLE", "Etsy connection is not configured.");
    }
  });

  app.get("/admin/dashboard/etsy/mto/:itemId", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    const item = await repository.findItemById({ itemId: request.params.itemId });
    if (!item) return sendError(reply, 404, "ETSY_MTO_NOT_FOUND", "Etsy item was not found.");
    return reply.send({ item: { ...item, brief: JSON.parse(item.brief_json), lyrics: await repository.readLyrics(item.id) } });
  });

  app.get("/admin/dashboard/etsy/mto/export/:receiptId", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    try {
      const order = await orderFiles.exportOrder(request.params.receiptId);
      reply.header("Content-Disposition", `attachment; filename="etsy-order-${order.receipt_id}.json"`);
      return reply.type("application/json").send(order);
    } catch (error) {
      return sendError(reply, statusFor(error), error.code || "ETSY_EXPORT_FAILED", "The Etsy order could not be exported. Check the order and API connection.");
    }
  });

  app.post("/admin/dashboard/etsy/mto/import/preview", { bodyLimit: 256 * 1024 }, async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    try {
      return reply.send(await pipeline.preview(request.body?.file));
    } catch (error) {
      return sendError(reply, statusFor(error), error.code || "ETSY_IMPORT_INVALID", error.message);
    }
  });

  app.post("/admin/dashboard/etsy/mto/import", { bodyLimit: 256 * 1024 }, async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    const key = operationKey(request, reply, sendError);
    if (!key) return;
    try {
      const result = await pipeline.importOrder(request.body?.file, request.body?.acknowledged, key);
      for (const item of result.items) await audit(admin.adminId, key, "etsy_mto_imported", item.id, {});
      return reply.code(202).send(result);
    } catch (error) {
      return sendError(reply, statusFor(error), error.code || "ETSY_IMPORT_FAILED", error.message);
    }
  });

  app.post("/admin/dashboard/etsy/mto/:itemId/retry-render", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    const key = operationKey(request, reply, sendError);
    if (!key) return;
    try {
      const result = await pipeline.retryFailedRender(request.params.itemId, key);
      await audit(admin.adminId, key, "etsy_mto_render_retried", result.item.id, { job_id: result.job.id });
      return reply.send({ item: result.item, job: result.job });
    } catch (error) {
      return sendError(reply, statusFor(error), error.code || "ETSY_RENDER_RETRY_FAILED", error.message);
    }
  });

  app.get("/admin/dashboard/etsy/mto/:itemId/mp3", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    const item = await repository.findItemById({ itemId: request.params.itemId });
    if (!item || item.state !== "ready_for_etsy_upload") {
      return sendError(reply, 409, "ETSY_MTO_ARTIFACT_NOT_READY", "A ready Etsy MP3 is required.");
    }
    try { await pipeline.verifyItem(item); } catch (error) {
      return sendError(reply, statusFor(error), error.code || "ETSY_VERIFICATION_FAILED", "Recheck the Etsy order before downloading its MP3.");
    }
    const artifact = await service.findArtifact({ item });
    if (!artifactIsReady(artifact, item.track_version_id)) {
      return sendError(reply, 409, "ETSY_MTO_ARTIFACT_NOT_READY", "A ready Etsy MP3 is required.");
    }
    const filePath = path.join(os.tmpdir(), `porizo-mto-${crypto.randomUUID()}.mp3`);
    try {
      await storageProvider.downloadToFile({ key: artifact.storage_key, filePath });
      const bytes = await fs.readFile(filePath);
      if (bytes.length !== Number(artifact.byte_length) || crypto.createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) {
        return sendError(reply, 409, "ETSY_MTO_ARTIFACT_MISMATCH", "The stored MP3 does not match the verified artifact.");
      }
      reply.header("Content-Type", "audio/mpeg");
      const filename = `porizo-${item.receipt_id}-${item.transaction_id}-${item.ordinal}.mp3`.replace(/[^a-zA-Z0-9._-]/g, "_");
      reply.header("Content-Disposition", `attachment; filename="${filename}"`);
      await audit(admin.adminId, `download-${crypto.randomUUID()}`, "etsy_mto_mp3_downloaded", item.id, { artifact_id: artifact.id });
      return reply.send(bytes);
    } finally {
      await fs.rm(filePath, { force: true });
    }
  });

  app.post("/admin/dashboard/etsy/mto/:itemId/attest-completion", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    const key = operationKey(request, reply, sendError);
    if (!key) return;
    try {
      const item = await repository.findItemById({ itemId: request.params.itemId });
      if (!item) return sendError(reply, 404, "ETSY_MTO_NOT_FOUND", "Etsy item was not found.");
      await pipeline.verifyItem(item);
      const result = await service.attestCompletion({
        itemId: request.params.itemId,
        receiptId: String(request.body?.receipt_id || "").trim(),
        acknowledged: request.body?.acknowledged === true,
        evidenceReference: String(request.body?.evidence_reference || "").trim(),
        idempotencyKey: key,
      });
      await audit(admin.adminId, key, "etsy_mto_completion_attested", result.item.id, { artifact_id: result.artifact.id });
      return reply.send(result);
    } catch (error) {
      return sendError(reply, statusFor(error), error.code || "ETSY_MTO_ATTESTATION_FAILED", error.message);
    }
  });
}

module.exports = { registerAdminEtsyMtoRoutes };
