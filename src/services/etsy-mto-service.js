"use strict";

const crypto = require("node:crypto");

const { normalizeBrief } = require("./etsy-mto-order-file");
const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;

function domainError(code, message) {
  return Object.assign(new Error(message), { code });
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function defaultId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

function assertIdempotencyKey(idempotencyKey) {
  if (!idempotencyKey?.trim?.() || idempotencyKey.trim() !== idempotencyKey) {
    throw domainError("IDEMPOTENCY_KEY_REQUIRED", "An idempotency key is required.");
  }
}


function changed(result) {
  return result?.rowCount ?? result?.changes ?? 0;
}

function artifactVersionMatches(artifact, versionId) {
  return [artifact?.trackVersionId, artifact?.track_version_id].includes(versionId);
}

function artifactHasValidMp3Fields(artifact) {
  const storageKey = artifact?.storageKey ?? artifact?.storage_key;
  const size = Number(artifact?.byteLength ?? artifact?.byte_length ?? 0);
  return artifact?.status === "ready" && Boolean(storageKey)
    && artifact?.kind === "full_mp3"
    && /^[a-f0-9]{64}$/i.test(artifact?.sha256 || "")
    && size >= 1024 && size <= MAX_ARTIFACT_BYTES;
}

function artifactIsReady(artifact, versionId) {
  return artifactVersionMatches(artifact, versionId) && artifactHasValidMp3Fields(artifact);
}

function createEtsyMtoService({
  repository,
  createTrack,
  createTrackVersion,
  createLyrics,
  verifyPaidUnit,
  fundRender,
  createRenderJob,
  findArtifact,
  now = () => new Date().toISOString(),
  idFactory = defaultId,
}) {
  for (const [name, dependency] of Object.entries({
    repository, createTrack, createTrackVersion, createLyrics, verifyPaidUnit, fundRender,
    createRenderJob, findArtifact,
  })) {
    if (!dependency?.apply && name !== "repository") {
      throw new Error(`Etsy MTO service requires ${name}.`);
    }
  }
  if (!repository) throw new Error("Etsy MTO service requires repository.");

  async function recordEvent(itemId, eventType, idempotencyKey, payload) {
    assertIdempotencyKey(idempotencyKey);
    const requestHash = hash(payload);
    const existing = await repository.findEventByIdempotencyKey({ itemId, idempotencyKey });
    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw domainError("IDEMPOTENCY_CONFLICT", "The idempotency key was reused with different input.");
      }
      return { event: existing, created: false };
    }
    return repository.recordIdempotencyEvent({
      id: idFactory("etsy_mto_event"), itemId, eventType, idempotencyKey, requestHash,
      createdAt: now(),
    });
  }

  async function intake({ identity, brief, evidenceReference, idempotencyKey, leaseToken }) {
    const normalizedBrief = normalizeBrief(brief);
    const { shopId, receiptId, transactionId, ordinal, listingId } = identity || {};
    if (![shopId, receiptId, transactionId, listingId].every((value) => value?.trim?.() && value.trim() === value)) {
      throw domainError("INVALID_ETSY_IDENTITY", "Etsy unit identity is incomplete.");
    }
    if (!Number.isInteger(ordinal) || ordinal < 0) {
      throw domainError("INVALID_ETSY_IDENTITY", "Etsy item ordinal is invalid.");
    }
    if (!evidenceReference?.trim?.() || evidenceReference.trim() !== evidenceReference) {
      throw domainError("ETSY_PAYMENT_EVIDENCE_REQUIRED", "Paid Etsy evidence is required.");
    }
    const paid = await verifyPaidUnit({ identity, evidenceReference });
    if (paid !== true) throw domainError("ETSY_ORDER_NOT_PAID", "Etsy unit is not eligible for fulfilment.");
    const briefJson = JSON.stringify(normalizedBrief);
    const rawPersonalizationHash = hash(normalizedBrief);
    const stored = await repository.createOrderAndItem({
      order: { id: idFactory("etsy_mto_order"), shopId, receiptId, createdAt: now(), updatedAt: now() },
      item: { id: idFactory("etsy_mto_item"), transactionId, ordinal, listingId, briefJson, rawPersonalizationHash, createdAt: now(), updatedAt: now() },
    });
    if ((stored.item.raw_personalization_hash ?? stored.item.rawPersonalizationHash) !== rawPersonalizationHash) {
      throw domainError("ETSY_UNIT_CONFLICT", "The Etsy unit already exists with a different brief.");
    }
    const event = await recordEvent(stored.item.id, "brief_received", idempotencyKey, { identity, brief: normalizedBrief, evidenceReference });
    if (stored.item.track_id) return { item: stored.item, idempotent: true };

    await repository.assertClaim(stored.item.id, leaseToken, now());
    const track = await createTrack({ item: stored.item, brief: normalizedBrief });
    await repository.linkTrack({ itemId: stored.item.id, trackId: track.id, updatedAt: now(), leaseToken });
    await repository.assertClaim(stored.item.id, leaseToken, now());
    const version = await createTrackVersion({ item: stored.item, track, brief: normalizedBrief });
    await repository.linkTrack({ itemId: stored.item.id, trackId: track.id, trackVersionId: version.id, updatedAt: now(), leaseToken });
    await repository.assertClaim(stored.item.id, leaseToken, now());
    const lyrics = await createLyrics({ item: stored.item, track, version, brief: normalizedBrief });
    if (!track?.id || !version?.id || !lyrics) throw new Error("Etsy MTO intake dependencies returned incomplete content.");
    await repository.assertClaim(stored.item.id, leaseToken, now());
    const transition = await repository.transitionItem({ itemId: stored.item.id, fromStates: ["received", "verified_paid"], state: "lyrics_review", updatedAt: now(), leaseToken });
    if (changed(transition) !== 1) throw domainError("ETSY_MTO_STATE_CONFLICT", "Etsy item changed while lyrics were generated.");
    return { item: { ...stored.item, track_id: track.id, track_version_id: version.id, state: "lyrics_review" }, idempotent: !event.created };
  }

  async function approveLyrics({ itemId, idempotencyKey, leaseToken }) {
    assertIdempotencyKey(idempotencyKey);
    const item = await repository.findItemById({ itemId, lock: true });
    if (!item || !item.track_id || !item.track_version_id) {
      throw domainError("LYRICS_NOT_READY", "Lyrics are not ready for approval.");
    }
    const existing = await repository.findEventByIdempotencyKey({ itemId, idempotencyKey });
    if (existing) {
      if (existing.request_hash !== hash({ itemId })) {
        throw domainError("IDEMPOTENCY_CONFLICT", "The idempotency key was reused with different input.");
      }
      if (item.state === "rendering") return { item, idempotent: true };
    }
    if (item.state !== "lyrics_review") {
      throw domainError("LYRICS_NOT_READY", "Lyrics are not ready for approval.");
    }
    await recordEvent(itemId, "lyrics_approved", idempotencyKey, { itemId });
    await repository.assertClaim(itemId, leaseToken, now());
    await fundRender({ item, idempotencyKey });
    await repository.assertClaim(itemId, leaseToken, now());
    const job = await createRenderJob({ item, idempotencyKey });
    if (!job?.id) throw new Error("Etsy MTO render dependency did not create a job.");
    const transition = await repository.transitionItem({ itemId, fromStates: ["lyrics_review"], state: "rendering", updatedAt: now(), leaseToken });
    if (changed(transition) !== 1) throw domainError("ETSY_MTO_STATE_CONFLICT", "Etsy item changed before render enqueue.");
    return { item: { ...item, state: "rendering" }, job, idempotent: false };
  }

  async function reconcileArtifact({ itemId }) {
    const item = await repository.findItemById({ itemId, lock: true });
    if (!item) throw domainError("ETSY_MTO_NOT_FOUND", "Etsy item was not found.");
    if (item.state !== "rendering") return { item, promoted: false };
    const artifact = await findArtifact({ item });
    if (!artifactIsReady(artifact, item.track_version_id)) {
      return { item, promoted: false, artifact: artifact || null };
    }
    const transition = await repository.transitionItem({ itemId, fromStates: ["rendering"], state: "ready_for_etsy_upload", updatedAt: now() });
    if (changed(transition) !== 1) return { item: await repository.findItemById({ itemId }), promoted: false, artifact };
    return { item: { ...item, state: "ready_for_etsy_upload" }, artifact, promoted: true };
  }

  async function attestCompletion({ itemId, receiptId, acknowledged, evidenceReference, idempotencyKey }) {
    assertIdempotencyKey(idempotencyKey);
    const item = await repository.findItemById({ itemId, lock: true });
    if (!item) {
      throw domainError("ETSY_COMPLETION_NOT_READY", "Etsy item is not ready for completion attestation.");
    }
    const payload = { receiptId, acknowledged, evidenceReference };
    const existing = await repository.findEventByIdempotencyKey({ itemId, idempotencyKey });
    if (existing) {
      const storedPayloadHash = existing.request_hash;
      const artifact = await findArtifact({ item });
      const matching = artifact && storedPayloadHash === hash({
        ...payload, artifactId: artifact.id, sha256: artifact.sha256,
        byteLength: artifact.byteLength ?? artifact.byte_length,
      });
      if (!matching) throw domainError("IDEMPOTENCY_CONFLICT", "The idempotency key was reused with different input.");
      if (item.state === "etsy_completion_attested") {
        return { item, artifact, idempotent: true };
      }
    }
    if (item.state !== "ready_for_etsy_upload") {
      throw domainError("ETSY_COMPLETION_NOT_READY", "Etsy item is not ready for completion attestation.");
    }
    if (!acknowledged || !evidenceReference || item.receipt_id !== receiptId) {
      throw domainError("INVALID_ETSY_ATTESTATION", "Receipt confirmation, acknowledgement, and evidence are required.");
    }
    const artifact = await findArtifact({ item });
    if (!artifactIsReady(artifact, item.track_version_id)) {
      throw domainError("INVALID_ETSY_ARTIFACT", "A verified MP3 artifact is required.");
    }
    await recordEvent(itemId, "etsy_completion_attested", idempotencyKey, {
      ...payload, artifactId: artifact.id,
      sha256: artifact.sha256, byteLength: artifact.byteLength ?? artifact.byte_length,
    });
    const transition = await repository.transitionItem({ itemId, fromStates: ["ready_for_etsy_upload"], state: "etsy_completion_attested", updatedAt: now() });
    if (changed(transition) !== 1) throw domainError("ETSY_MTO_STATE_CONFLICT", "Etsy item changed before completion attestation.");
    return { item: { ...item, state: "etsy_completion_attested" }, artifact, idempotent: false };
  }

  return { intake, approveLyrics, reconcileArtifact, attestCompletion, findArtifact };
}

module.exports = { createEtsyMtoService, normalizeBrief, artifactIsReady };
