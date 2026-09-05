"use strict";

const { createEtsyMtoRepository } = require("../database/etsy-mto-repository");
const { createEtsyMtoService } = require("./etsy-mto-service");
const { createEtsyOrderFileService } = require("./etsy-mto-order-file");
const { createEtsyMtoPipeline } = require("./etsy-mto-pipeline");
const { buildLyricsContext } = require("../writer/lyrics-context");
const { getFeatureFlag } = require("./feature-flags");

function registerEtsyMtoPipeline({ app, db, appConfig, etsyClient, etsyArtifactService, trackVersionRepository, newUuid, nowIso, toJson, computeParamsHash, publicBaseUrl, generateLyrics, extractLyricsText, moderationCheck, validateGeneratedLyrics }) {
  const etsyMtoRepository = createEtsyMtoRepository(db);
  const etsyMtoOwnerId =
    appConfig.ETSY_MTO_OWNER_ID || process.env.ETSY_MTO_OWNER_ID || null;
  const etsyOrderFiles = createEtsyOrderFileService({
    client: etsyClient,
    shopId: process.env.ETSY_SHOP_ID,
    listingIds: String(process.env.ETSY_LISTING_IDS || "").split(",").map((id) => id.trim()).filter(Boolean),
  });
  app.decorate("etsyOrderFiles", etsyOrderFiles);

  const etsyMtoService = createEtsyMtoService({
    repository: etsyMtoRepository,
    verifyPaidUnit: async ({ identity, evidenceReference }) => {
      if (!etsyMtoOwnerId) {
        throw Object.assign(new Error("ETSY_MTO_OWNER_ID is required."), {
          code: "ETSY_MTO_UNCONFIGURED",
        });
      }
      const configuredShopId = process.env.ETSY_SHOP_ID;
      const allowedListingIds = String(process.env.ETSY_LISTING_IDS || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (
        !configuredShopId ||
        identity.shopId !== configuredShopId ||
        !allowedListingIds.includes(identity.listingId) ||
        !evidenceReference
      ) {
        return false;
      }
      const owner = await db
        .prepare(
          "SELECT id FROM users WHERE id = ? AND account_status = 'active'",
        )
        .get(etsyMtoOwnerId);
      if (!owner) return false;
      const current = await etsyOrderFiles.exportOrder(identity.receiptId);
      return current.items.some((item) => item.transaction_id === identity.transactionId && item.listing_id === identity.listingId);
    },
    createTrack: async ({ item, brief }) => {
      const trackId = newUuid();
      const now = nowIso();
      await trackVersionRepository.createTrack({
        id: trackId,
        userId: etsyMtoOwnerId,
        status: "draft",
        title: `A ${brief.occasion} song for ${brief.recipient_name}`,
        occasion: brief.occasion,
        recipientName: brief.recipient_name,
        style: brief.style,
        durationTarget: 60,
        voiceMode: "ai_voice",
        message: brief.specific_memory,
        storyContextJson: toJson({
          relationship_type: brief.relationship,
          specific_memory: brief.specific_memory,
        }),
        latestVersion: 0,
        createdAt: now,
        updatedAt: now,
      });
      await db
        .prepare(
          "UPDATE tracks SET etsy_mto_item_id = ? WHERE id = ?",
        )
        .run(item.id, trackId);
      return { id: trackId };
    },
    createTrackVersion: async ({ track }) => {
      const trackVersionId = newUuid();
      const now = nowIso();
      const version = await trackVersionRepository.createVersionWithNextNumber({
        id: trackVersionId,
        trackId: track.id,
        renderType: "full",
        paramsJson: toJson({ source: "etsy_mto" }),
        paramsHash: computeParamsHash({ source: "etsy_mto" }),
        costEstimateJson: toJson({ credits: 0, usd: null }),
        storageRefPrefix: `tracks/${etsyMtoOwnerId}/${track.id}/v`,
        createdAt: now,
        lyricsUpdatedAt: now,
        streamBaseUrl: publicBaseUrl || "",
      });
      return { id: trackVersionId, versionNum: version.versionNum };
    },
    createLyrics: async ({ track, version }) => {
      const storedTrack = await trackVersionRepository.findTrackById(track.id);
      const result = await generateLyrics(buildLyricsContext(storedTrack));
      const lyrics = result?.lyrics;
      const lyricsText = extractLyricsText(lyrics);
      const moderation = moderationCheck({ lyrics: lyricsText });
      const validation = validateGeneratedLyrics(
        lyricsText,
        storedTrack.recipient_name,
      );
      if (!moderation.allowed || !validation.allowed || !validation.hasAnchor) {
        await trackVersionRepository.blockModeration({
          trackVersionId: version.id,
          reason: moderation.reason || validation.reason || "MISSING_RECIPIENT_ANCHOR",
        });
        throw Object.assign(new Error("Generated lyrics failed moderation."), {
          code: "GENERATION_BLOCKED",
        });
      }
      await trackVersionRepository.updateGeneratedLyrics({
        trackVersionId: version.id,
        lyricsJson: toJson(lyrics),
        lyricsStatus: validation.hasAnchor
          ? result.lyrics_status || "generated"
          : "needs_anchor",
        lyricsUpdatedAt: nowIso(),
        provenanceJson: null,
      });
      return lyrics;
    },
    fundRender: async ({ item }) => {
      await trackVersionRepository.approveLyrics({
        trackVersionId: item.track_version_id,
        lyricsApprovedAt: nowIso(),
        moderationStatus: "passed",
      });
    },
    createRenderJob: async ({ item }) => {
      const jobId = newUuid();
      await db.transaction(async (query) => {
        const marked = await trackVersionRepository.markVersionProcessingForRender({
          trackVersionId: item.track_version_id,
          workflowType: "full_render",
          query,
        });
        if (!(marked?.changes ?? marked?.rowCount ?? 0)) {
          throw Object.assign(new Error("Etsy MTO render already active."), {
            code: "ETSY_MTO_RENDER_CONFLICT",
          });
        }
        await trackVersionRepository.insertRenderJobForVersion({
          trackId: item.track_id,
          trackVersionId: item.track_version_id,
          jobId,
          workflowType: "full_render",
          stepData: toJson({ source: "etsy_mto" }),
          createdAt: nowIso(),
          query,
        });
      });
      return { id: jobId };
    },
    findArtifact: async ({ item }) =>
      db
        .prepare(
          "SELECT * FROM track_artifacts WHERE track_version_id = ? AND kind = 'full_mp3'",
        )
        .get(item.track_version_id),
  });
  app.decorate("etsyMtoService", etsyMtoService);
  const etsyMtoPipeline = createEtsyMtoPipeline({
    repository: etsyMtoRepository,
    orderFiles: etsyOrderFiles,
    production: etsyMtoService,
    recoverRender: async (item) => Boolean(await db.prepare("SELECT id FROM jobs WHERE track_version_id = ? AND workflow_type = 'full_render' LIMIT 1").get(item.track_version_id)),
    assertConfigured: async () => {
      if (await getFeatureFlag(db, "etsy_fulfilment_mode", { throwOnError: true }) !== "off") {
        throw Object.assign(new Error("Disable the retired Etsy code/API redemption flow before importing made-to-order songs."), { code: "ETSY_MTO_UNCONFIGURED" });
      }
      const owner = etsyMtoOwnerId && await db.prepare("SELECT id FROM users WHERE id = ? AND account_status = 'active'").get(etsyMtoOwnerId);
      if (!owner) throw Object.assign(new Error("An active Etsy production owner must be configured."), { code: "ETSY_MTO_UNCONFIGURED" });
    },
    checkRender: async (item) => {
      const version = await trackVersionRepository.findById(item.track_version_id);
      const job = await db.prepare("SELECT status FROM jobs WHERE track_version_id = ? AND workflow_type = 'full_render' ORDER BY created_at DESC LIMIT 1").get(item.track_version_id);
      if (!version || !job || ["failed", "blocked", "canceled"].includes(version.status)
        || ["failed", "blocked", "canceled"].includes(job.status)) {
        throw Object.assign(new Error("The song render failed."), { code: "ETSY_RENDER_FAILED" });
      }
      if (version?.status === "full_ready") {
        const result = await etsyArtifactService.repairForOrder({ mtoItemId: item.id });
        if (result.exhausted) throw Object.assign(new Error("MP3 repair attempts exhausted."), { code: "ETSY_MP3_REPAIR_EXHAUSTED" });
      }
    },
  });
  app.decorate("etsyMtoPipeline", etsyMtoPipeline);
  let etsyMtoTick = null;
  const etsyMtoTimer = setInterval(() => {
    if (etsyMtoTick || !etsyMtoOwnerId) return;
    etsyMtoTick = etsyMtoPipeline.processDue()
      .catch((error) => app.log.error({ code: error.code || "ETSY_MTO_SWEEP_FAILED" }, "Etsy production sweep failed"))
      .finally(() => { etsyMtoTick = null; });
  }, 5000);
  etsyMtoTimer.unref();
  app.addHook("onClose", async () => {
    clearInterval(etsyMtoTimer);
    if (etsyMtoTick) await etsyMtoTick;
  });
  return { etsyMtoRepository, etsyMtoService };
}

module.exports = { registerEtsyMtoPipeline };
