"use strict";

const path = require("node:path");
const { ensureDir, getVersionDir, nowIso } = require("../utils/common");
const { trackMasterKey } = require("../storage");
const { _testing: runnerTesting } = require("../workflows/runner");

const MAX_ARTIFACT_ATTEMPTS = 5;

function readyArtifact(artifact) {
  return Boolean(
    artifact?.status === "ready" &&
      artifact.storage_key &&
      artifact.sha256 &&
      Number(artifact.byte_length || 0) >= 1024,
  );
}

function createEtsyArtifactService({
  db,
  storageProvider,
  storageDir,
  etsyOrderService,
  uploadMp3 = runnerTesting.uploadTrackMasterMp3,
  logger = console,
}) {
  async function artifactFor(trackVersionId) {
    return db
      .prepare(
        `SELECT * FROM track_artifacts
          WHERE track_version_id = ? AND kind = 'full_mp3'`,
      )
      .get(trackVersionId);
  }

  async function unitForOrder(order) {
    return order?.mtoItemId
      ? await db.prepare("SELECT * FROM etsy_mto_items WHERE id = ?").get(order.mtoItemId)
      : order?.etsyUnitId
      ? await db
          .prepare("SELECT * FROM etsy_order_units WHERE id = ?")
          .get(order.etsyUnitId)
      : await etsyOrderService.findUnitForWebOrder(order?.id);
  }

  function repairDeferral(artifact, force) {
    if (readyArtifact(artifact)) {
      return { required: true, ready: true, artifact };
    }
    if (
      !force &&
      (artifact?.exhausted_at ||
        Number(artifact?.attempt_count || 0) >= MAX_ARTIFACT_ATTEMPTS)
    ) {
      return { required: true, ready: false, exhausted: true, artifact };
    }
    if (
      !force &&
      artifact?.next_attempt_at &&
      Date.parse(artifact.next_attempt_at) > Date.now()
    ) {
      return { required: true, ready: false, retryAt: artifact.next_attempt_at };
    }
    return null;
  }

  async function claimArtifact(unit, now) {
    await db
      .prepare(
        `INSERT INTO track_artifacts
          (id, track_version_id, kind, status, attempt_count, created_at,
           updated_at)
         VALUES (?, ?, 'full_mp3', 'pending', 0, ?, ?)
         ON CONFLICT(track_version_id, kind) DO NOTHING`,
      )
      .run(
        `artifact_${unit.track_version_id}_full_mp3`,
        unit.track_version_id,
        now,
        now,
      );
    const claimed = await db
      .prepare(
        `UPDATE track_artifacts
            SET status = 'processing', processing_started_at = ?, updated_at = ?
          WHERE track_version_id = ? AND kind = 'full_mp3'
            AND (
              status IN ('pending', 'failed')
              OR (status = 'processing' AND processing_started_at < ?)
            )
            AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
            AND exhausted_at IS NULL`,
      )
      .run(
        now,
        now,
        unit.track_version_id,
        new Date(Date.now() - 5 * 60_000).toISOString(),
        now,
      );
    return (claimed?.rowCount ?? claimed?.changes ?? 0) === 1;
  }

  async function recordMissingTrack(unit, now) {
    const retryAt = new Date(Date.now() + 60_000).toISOString();
    await db
      .prepare(
        `UPDATE track_artifacts
              SET status = 'failed', processing_started_at = NULL,
                  attempt_count = attempt_count + 1,
                  next_attempt_at = ?, last_error = 'TRACK_NOT_FOUND',
                  updated_at = ?
            WHERE track_version_id = ? AND kind = 'full_mp3'
              AND status = 'processing' AND processing_started_at = ?`,
      )
      .run(retryAt, nowIso(), unit.track_version_id, now);
    return {
      required: true,
      ready: false,
      error: "TRACK_NOT_FOUND",
      retryAt,
    };
  }

  async function convertArtifact(row, order, unit, now) {
    const track = { id: row.id, user_id: row.user_id };
    const trackVersion = { id: row.version_id, version_num: row.version_num };
    const versionDir = getVersionDir(storageDir, track, trackVersion);
    ensureDir(versionDir);
    const sourcePath = path.join(versionDir, "full.m4a");
    const sourceKey = trackMasterKey({
      userId: track.user_id,
      trackId: track.id,
      versionNum: trackVersion.version_num,
      format: "m4a",
    });

    try {
      await storageProvider.downloadToFile({
        key: sourceKey,
        filePath: sourcePath,
      });
      await uploadMp3({
        db,
        storageProvider,
        versionDir,
        track,
        trackVersion,
        kind: "full",
        expectedProcessingStartedAt: now,
      });
    } catch (error) {
      return recordRepairFailure(error, order, unit, now);
    }
    return finishRepair(unit, now);
  }

  async function recordRepairFailure(error, order, unit, now) {
    logger.error?.(
      { code: error?.code, webOrderId: order?.id, etsyUnitId: unit.id },
      "Etsy MP3 artifact repair failed",
    );
    const failedAt = nowIso();
    const failed = await db
      .prepare(
        `UPDATE track_artifacts
              SET status = 'failed', processing_started_at = NULL,
                  attempt_count = attempt_count + 1,
                  next_attempt_at = ?, last_error = ?, updated_at = ?
            WHERE track_version_id = ? AND kind = 'full_mp3'
              AND status = 'processing' AND processing_started_at = ?`,
      )
      .run(
        new Date(Date.now() + 60_000).toISOString(),
        String(error?.code || error?.message || "MP3_REPAIR_FAILED").slice(
          0,
          500,
        ),
        failedAt,
        unit.track_version_id,
        now,
      );
    if ((failed?.rowCount ?? failed?.changes ?? 0) !== 1) {
      return { required: true, ready: false, staleLease: true };
    }
    let artifact = await artifactFor(unit.track_version_id);
    const failedAttempts = Number(artifact?.attempt_count || 0);
    if (failedAttempts >= MAX_ARTIFACT_ATTEMPTS) {
      await db
        .prepare(
          `UPDATE track_artifacts
                SET next_attempt_at = NULL, exhausted_at = ?, updated_at = ?
              WHERE track_version_id = ? AND kind = 'full_mp3'
                AND status = 'failed' AND updated_at = ?`,
        )
        .run(failedAt, failedAt, unit.track_version_id, failedAt);
      artifact = await artifactFor(unit.track_version_id);
    }
    return {
      required: true,
      ready: false,
      exhausted: failedAttempts >= MAX_ARTIFACT_ATTEMPTS,
      retryAt: artifact?.next_attempt_at || undefined,
      artifact,
    };
  }

  async function finishRepair(unit, now) {
    const artifact = await artifactFor(unit.track_version_id);
    if (readyArtifact(artifact)) {
      await db
        .prepare(
          `UPDATE track_artifacts
              SET next_attempt_at = NULL, exhausted_at = NULL
            WHERE track_version_id = ? AND kind = 'full_mp3'`,
        )
        .run(unit.track_version_id);
      return { required: true, ready: true, artifact };
    }

    const attempts = Number(artifact?.attempt_count || 0);
    const exhausted = attempts >= MAX_ARTIFACT_ATTEMPTS;
    const delayMs = Math.min(15 * 60_000, 30_000 * 2 ** Math.max(attempts - 1, 0));
    const scheduled = await db
      .prepare(
        `UPDATE track_artifacts
            SET next_attempt_at = ?, processing_started_at = NULL,
                exhausted_at = ?, updated_at = ?
          WHERE track_version_id = ? AND kind = 'full_mp3'
            AND status = 'processing' AND processing_started_at = ?`,
      )
      .run(
        exhausted ? null : new Date(Date.now() + delayMs).toISOString(),
        exhausted ? nowIso() : null,
        nowIso(),
        unit.track_version_id,
        now,
      );
    if ((scheduled?.rowCount ?? scheduled?.changes ?? 0) !== 1) {
      return { required: true, ready: false, staleLease: true };
    }
    return {
      required: true,
      ready: false,
      exhausted,
      artifact: await artifactFor(unit.track_version_id),
    };
  }

  async function repairForOrder(order, { force = false } = {}) {
    const unit = await unitForOrder(order);
    if (!unit) return { required: false, ready: true };
    const deferred = repairDeferral(await artifactFor(unit.track_version_id), force);
    if (deferred) return deferred;
    const now = nowIso();
    if (!await claimArtifact(unit, now)) {
      return { required: true, ready: false, busy: true };
    }
    const row = await db
      .prepare(
        `SELECT t.id, t.user_id, tv.id AS version_id, tv.version_num
           FROM tracks t
           JOIN track_versions tv ON tv.track_id = t.id
          WHERE t.id = ? AND tv.id = ?`,
      )
      .get(unit.track_id, unit.track_version_id);
    if (!row) return recordMissingTrack(unit, now);
    return convertArtifact(row, order, unit, now);
  }

  async function retryForOrder(order) {
    const unit = await etsyOrderService.findUnitForWebOrder(order?.id);
    if (!unit) return { required: false, ready: true };
    await db
      .prepare(
        `UPDATE track_artifacts
            SET next_attempt_at = NULL, exhausted_at = NULL, updated_at = ?
          WHERE track_version_id = ? AND kind = 'full_mp3'`,
      )
      .run(nowIso(), unit.track_version_id);
    return repairForOrder(order, { force: true });
  }

  async function retryForUnit(unitId) {
    const unit = await db
      .prepare("SELECT id, track_version_id FROM etsy_order_units WHERE id = ?")
      .get(unitId);
    if (!unit) return { required: false, ready: true };
    await db
      .prepare(
        `UPDATE track_artifacts
            SET next_attempt_at = NULL, exhausted_at = NULL, updated_at = ?
          WHERE track_version_id = ? AND kind = 'full_mp3'`,
      )
      .run(nowIso(), unit.track_version_id);
    return repairForOrder({ etsyUnitId: unit.id }, { force: true });
  }

  async function processDueArtifacts({ limit = 10 } = {}) {
    const due = await db
      .prepare(
        `SELECT u.id AS etsy_unit_id
           FROM etsy_order_units u
           LEFT JOIN track_artifacts a
             ON a.track_version_id = u.track_version_id
            AND a.kind = 'full_mp3'
          WHERE u.state IN ('reserved', 'rendering')
            AND (a.id IS NULL OR (
              a.status != 'ready'
              AND a.exhausted_at IS NULL
              AND (a.next_attempt_at IS NULL OR a.next_attempt_at <= ?)
            ))
          ORDER BY u.updated_at ASC
          LIMIT ?`,
      )
      .all(nowIso(), Math.min(Math.max(Number(limit) || 10, 1), 50));
    const results = [];
    for (const order of due) {
      results.push({
        etsyUnitId: order.etsy_unit_id,
        ...(await repairForOrder({ etsyUnitId: order.etsy_unit_id })),
      });
    }
    return results;
  }

  return {
    repairForOrder,
    retryForOrder,
    retryForUnit,
    processDueArtifacts,
    artifactFor,
  };
}

module.exports = {
  createEtsyArtifactService,
  readyArtifact,
  MAX_ARTIFACT_ATTEMPTS,
};
