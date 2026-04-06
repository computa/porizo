"use strict";

const { newUuid } = require("../utils/ids");
const { createOrGetShareToken } = require("../services/share-service");
const { nowIso, toJson, parseJson } = require("../utils/common");
const { moderationCheck, validateGeneratedLyrics } = require("../providers/moderation");
const { generateLyrics } = require("../providers/lyrics");
const { buildLyricsContext } = require("../writer/lyrics-context");
const { getFeatureFlag } = require("../services/feature-flags");

function registerTrackRoutes(app, {
  db,
  config,
  appConfig,
  requireUserId,
  sendError,
  consumeRateLimit,
  addAuditEntry,
  eventsService,
  schemas,
  getBaseUrl,
  getUserRiskLevel,
  setRiskLevel,
  computeParamsHash,
  findTrackVersion,
  getTrackVersions,
  getTrackForLibrary,
  withTrackLibraryFlags,
  upsertTrackLibraryEntry,
  hydrateTrackCoverImages,
  findJob,
  findActiveJobForVersion,
  findLatestFailedJobForVersion,
  retryFailedJob,
  isActiveJob,
  isTerminalFailedJobStatus,
  isTerminalTrackFailureStatus,
  incrementTrackVersion,
  extractLyricsText,
  normalizeVariantName,
  SONG_VARIANT_NAMES,
  buildPlayShareUrl,
  ensureShareMp4,
  subscriptionManager,
}) {

  function toTimestamp(value) {
    if (!value) return null;
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : null;
  }

  async function consumeSongEntitlementInTransaction(query, { userId, trackId, trackVersionId, consumedAt }) {
    if (consumedAt) {
      return { consumed: false, consumedAt };
    }

    const spendInTransaction = typeof subscriptionManager.spendSongInTransaction === "function"
      ? subscriptionManager.spendSongInTransaction.bind(subscriptionManager)
      : null;
    if (!spendInTransaction) {
      throw new Error("SPEND_IN_TX_UNAVAILABLE");
    }

    await spendInTransaction(query, userId, trackId);
    const now = nowIso();
    await query(
      "UPDATE track_versions SET song_entitlement_consumed_at = ? WHERE id = ?",
      [now, trackVersionId]
    );
    return { consumed: true, consumedAt: now };
  }

  async function findActiveTrackShare(track, creatorId) {
    let existingShare = null;
    if (track?.share_token_id) {
      existingShare = await db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(track.share_token_id);
    }
    if (!existingShare) {
      existingShare = await db
        .prepare(
          `SELECT *
             FROM share_tokens
            WHERE track_id = ?
              AND creator_id = ?
              AND status != 'revoked'
            ORDER BY created_at DESC
            LIMIT 1`
        )
        .get(track.id, creatorId);
    }
    if (!existingShare) {
      return null;
    }

    const isDemo = existingShare.share_type === "demo";
    const isValid = isDemo || new Date(existingShare.expires_at) > new Date();
    if (!isValid) {
      if (!isDemo && existingShare.status !== "expired") {
        await db.prepare("UPDATE share_tokens SET status = ? WHERE id = ?").run("expired", existingShare.id);
      }
      return null;
    }

    if (!track.share_token_id || track.share_token_id !== existingShare.id) {
      await db.prepare("UPDATE tracks SET share_token_id = ?, updated_at = ? WHERE id = ?")
        .run(existingShare.id, nowIso(), track.id);
      track.share_token_id = existingShare.id;
    }

    return existingShare;
  }

  app.post("/tracks", { schema: schemas.createTrack }, async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const limit = await consumeRateLimit(userId, "track_create", 20, 60 * 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Track creation rate limit reached.", {
        retry_at: limit.reset_at,
      });
      return;
    }
    const body = request.body || {};
    const myVoiceEnabled = await getFeatureFlag(db, "my_voice_enabled");
    let requestedVoiceMode = body.voice_mode || config.DEFAULT_VOICE_MODE;
    if (!myVoiceEnabled && requestedVoiceMode === "user_voice") {
      requestedVoiceMode = "ai_voice";
    }
    const riskLevel = await getUserRiskLevel(userId);
    if (riskLevel === "blocked") {
      sendError(reply, 403, "ACCOUNT_BLOCKED", "Account is blocked.");
      return;
    }
    const moderation = moderationCheck(body);
    if (!moderation.allowed) {
      if (moderation.reason === "PROFANITY") {
        // Allow creation for profanity-only flags to avoid false positives; track as warning.
        await setRiskLevel(userId, "medium");
        await addAuditEntry({
          userId,
          action: "moderation_warned",
          resourceType: "track",
          resourceId: null,
          metadata: { reason: moderation.reason, matches: moderation.details?.matches },
        });
      } else {
        await setRiskLevel(userId, "high");
        await addAuditEntry({
          userId,
          action: "moderation_blocked",
          resourceType: "track",
          resourceId: null,
          metadata: { reason: moderation.reason, matches: moderation.details?.matches },
        });
        sendError(reply, 403, "MODERATION_BLOCKED", "Prompt blocked by moderation.", {
          reason: moderation.reason,
          matches: moderation.details?.matches,
        });
        return;
      }
    }
    if (requestedVoiceMode === "user_voice") {
      if (riskLevel === "high") {
        sendError(reply, 403, "VOICE_MODE_DISABLED", "Voice mode disabled for high-risk accounts.");
        return;
      }
      const profile = await db
        .prepare("SELECT id FROM voice_profiles WHERE user_id = ? AND status = 'active'")
        .get(userId);
      if (!profile) {
        sendError(reply, 403, "VOICE_PROFILE_REQUIRED", "Voice profile required for user_voice.");
        return;
      }
    }
    const trackId = newUuid();
    const now = nowIso();

    // Build story context JSON if any story fields provided
    const storyContext = {};
    if (body.relationship_type) storyContext.relationship_type = body.relationship_type;
    if (body.years_known) storyContext.years_known = body.years_known;
    if (body.specific_memory) storyContext.specific_memory = body.specific_memory;
    if (body.special_phrases) storyContext.special_phrases = body.special_phrases;
    if (body.what_makes_them_special) storyContext.what_makes_them_special = body.what_makes_them_special;
    // AI-generated follow-up question answers from wizard
    if (Array.isArray(body.memory_answers) && body.memory_answers.length > 0) {
      storyContext.memory_answers = body.memory_answers;
    }
    const storyContextJson = Object.keys(storyContext).length > 0 ? toJson(storyContext) : null;

    await db.prepare(
      "INSERT INTO tracks (id, user_id, status, title, occasion, recipient_name, style, duration_target, voice_mode, voice_gender, message, story_context_json, share_token_id, latest_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      trackId,
      userId,
      "draft",
      body.title || null,
      body.occasion || null,
      body.recipient_name || null,
      body.style || null,
      body.duration_target || 60,
      requestedVoiceMode,
      body.voice_gender || null,
      body.message || null,
      storyContextJson,
      null,
      0,
      now,
      now
    );
    await upsertTrackLibraryEntry({
      userId,
      trackId,
      origin: "created",
      shareTokenId: null,
      addedAt: now,
    });
    await addAuditEntry({
      userId,
      action: "track_created",
      resourceType: "track",
      resourceId: trackId,
    });
    reply.code(201).send({
      track_id: trackId,
      status: "draft",
      voice_mode: requestedVoiceMode,
      created_at: now,
    });
  });

  app.get("/tracks", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const tracks = await db
      .prepare(
        `SELECT t.*,
                tle.origin AS library_origin,
                tle.added_at AS library_added_at,
                tle.share_token_id AS library_share_token_id,
                CASE WHEN t.user_id = ? THEN 1 ELSE 0 END AS can_edit,
                CASE WHEN t.user_id = ? THEN 1 ELSE 0 END AS can_share,
                1 AS can_delete
         FROM tracks t
         JOIN track_library_entries tle
           ON tle.track_id = t.id
          AND tle.user_id = ?
          AND tle.removed_at IS NULL
         WHERE t.deleted_at IS NULL
         ORDER BY tle.added_at DESC`
      )
      .all(userId, userId, userId);
    const hydrated = await hydrateTrackCoverImages(tracks);
    reply.send({ tracks: hydrated.map(withTrackLibraryFlags) });
  });

  app.get("/tracks/:id", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const trackRow = await getTrackForLibrary(userId, request.params.id);
    const [hydratedTrack] = await hydrateTrackCoverImages(trackRow ? [trackRow] : []);
    const track = withTrackLibraryFlags(hydratedTrack);
    if (!track) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    reply.send({ track, versions: await getTrackVersions(track, getBaseUrl(request)) });
  });

  app.delete("/tracks/:id", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const track = await getTrackForLibrary(userId, request.params.id);
    if (!track) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const deletedAt = nowIso();
    await db.prepare(
      "UPDATE track_library_entries SET removed_at = ?, updated_at = ? WHERE user_id = ? AND track_id = ? AND removed_at IS NULL"
    ).run(deletedAt, deletedAt, userId, track.id);

    await addAuditEntry({
      userId,
      action: "track_library_removed",
      resourceType: "track",
      resourceId: track.id,
    });
    reply.send({ deleted: true });
  });

  // Update track voice_mode (called after lyrics approval, before render)
  app.patch("/tracks/:id/voice_mode", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }

    const { voice_mode } = request.body || {};
    if (!["user_voice", "ai_voice"].includes(voice_mode)) {
      sendError(reply, 400, "INVALID_VOICE_MODE", "voice_mode must be 'user_voice' or 'ai_voice'");
      return;
    }

    const myVoiceEnabled = await getFeatureFlag(db, "my_voice_enabled");
    let effectiveVoiceMode = voice_mode;
    if (!myVoiceEnabled && effectiveVoiceMode === "user_voice") {
      effectiveVoiceMode = "ai_voice";
    }

    // Check voice profile exists for user_voice
    if (effectiveVoiceMode === "user_voice") {
      const profile = await db.prepare(
        "SELECT id FROM voice_profiles WHERE user_id = ? AND status IN ('active', 'completed')"
      ).get(userId);
      if (!profile) {
        sendError(reply, 400, "NO_VOICE_PROFILE", "No completed voice profile found. Please enroll your voice first.");
        return;
      }
    }

    await db.prepare("UPDATE tracks SET voice_mode = ?, updated_at = ? WHERE id = ?")
      .run(effectiveVoiceMode, nowIso(), track.id);

    console.log(`[Track] Updated voice_mode to '${effectiveVoiceMode}' for track ${track.id}`);
    reply.send({ voice_mode: effectiveVoiceMode });
  });

  app.post("/tracks/:id/versions", { schema: schemas.createVersion }, async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const body = request.body || {};
    const paramsHash = computeParamsHash(body.params || {});
    const renderType = body.render_type || "preview";
    const streamBaseUrl = getBaseUrl(request);
    const existing = await db
      .prepare(
        "SELECT id, version_num FROM track_versions WHERE track_id = ? AND params_hash = ? AND render_type = ?"
      )
      .get(track.id, paramsHash, renderType);
    if (existing) {
      sendError(reply, 409, "DUPLICATE_PARAMS", "Version with identical params already exists.", {
        existing_version_id: existing.id,
        version_num: existing.version_num,
      });
      return;
    }
    // Transaction ensures version increment + insert are atomic
    const trackVersionId = newUuid();
    const versionNum = await db.transaction(async () => {
      const num = await incrementTrackVersion(track.id);
      await db.prepare(
        "INSERT INTO track_versions (id, track_id, version_num, parent_version_id, status, render_type, params_json, params_hash, cost_estimate_json, actual_cost_json, storage_ref, created_at, completed_at, preview_url, full_url, billing_hold_id, lyrics_status, lyrics_updated_at, lyrics_approved_at, guide_access_token, stream_base_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        trackVersionId,
        track.id,
        num,
        body.parent_version_id || null,
        "queued",
        renderType,
        toJson(body.params || {}),
        paramsHash,
        toJson({ credits: 1, usd: renderType === "full" ? 0.25 : 0.15 }),
        null,
        `tracks/${userId}/${track.id}/v${num}`,
        nowIso(),
        null,
        null,
        null,
        null,
        "draft",
        nowIso(),
        null,
        null,
        streamBaseUrl
      );
      return num;
    });
    reply.code(201).send({
      track_version_id: trackVersionId,
      version_num: versionNum,
      params_hash: paramsHash,
      cost_estimate: { credits: 1, usd: renderType === "full" ? 0.25 : 0.15 },
      status: "queued",
    });
  });

  app.post("/tracks/:id/versions/:version/render_preview", async (request, reply) => {
    console.log(`[render_preview] START: trackId=${request.params.id}, version=${request.params.version}`);
    const userId = await requireUserId(request, reply);
    if (!userId) {
      console.log(`[render_preview] No userId, returning early`);
      return;
    }
    console.log(`[render_preview] userId=${userId}`);
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    console.log(`[render_preview] track exists: ${!!track}, user_id match: ${track?.user_id === userId}`);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const versionNum = Number(request.params.version);
    const trackVersion = await findTrackVersion(track.id, versionNum);
    if (!trackVersion) {
      sendError(reply, 404, "VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
    const streamBaseUrl = getBaseUrl(request);
    await db.prepare("UPDATE track_versions SET stream_base_url = ? WHERE id = ?").run(
      streamBaseUrl,
      trackVersion.id
    );
    if (trackVersion.moderation_status === "blocked") {
      sendError(reply, 403, "MODERATION_BLOCKED", "Track version blocked by moderation.", {
        reason: trackVersion.moderation_reason,
      });
      return;
    }
    if (trackVersion.lyrics_status !== "approved") {
      sendError(reply, 409, "LYRICS_NOT_APPROVED", "Lyrics must be approved before rendering.");
      return;
    }
    if (trackVersion.status === "preview_ready" && trackVersion.preview_url) {
      reply.code(200).send({
        job_id: trackVersion.preview_job_id || null,
        estimated_completion_sec: 0,
        poll_url: trackVersion.preview_job_id ? `/jobs/${trackVersion.preview_job_id}` : null,
      });
      return;
    }
    let existingJob = await findJob(trackVersion.preview_job_id);
    if (!existingJob) {
      const latestFailedPreviewJob = await findLatestFailedJobForVersion(trackVersion.id, "preview_render");
      if (isTerminalTrackFailureStatus(trackVersion.status) && latestFailedPreviewJob) {
        const lyricsUpdatedAt = toTimestamp(trackVersion.lyrics_updated_at);
        const failureAt =
          toTimestamp(latestFailedPreviewJob.completed_at) ||
          toTimestamp(latestFailedPreviewJob.updated_at);
        const lyricsChangedSinceFailure =
          Number.isFinite(lyricsUpdatedAt) &&
          Number.isFinite(failureAt) &&
          lyricsUpdatedAt > failureAt;

        if (!lyricsChangedSinceFailure) {
          existingJob = latestFailedPreviewJob;
          await db.prepare("UPDATE track_versions SET preview_job_id = ? WHERE id = ?").run(
            existingJob.id,
            trackVersion.id
          );
        }
      }
    }
    if (!existingJob) {
      existingJob = await findActiveJobForVersion(trackVersion.id, "preview_render");
      if (existingJob) {
        await db.prepare("UPDATE track_versions SET preview_job_id = ? WHERE id = ?").run(
          existingJob.id,
          trackVersion.id
        );
      }
    }
    if (isActiveJob(existingJob)) {
      reply.code(202).send({
        job_id: existingJob.id,
        estimated_completion_sec: 90,
        poll_url: `/jobs/${existingJob.id}`,
      });
      return;
    }
    if (existingJob && isTerminalFailedJobStatus(existingJob.status)) {
      const lyricsUpdatedAt = toTimestamp(trackVersion.lyrics_updated_at);
      const failureAt = toTimestamp(existingJob.completed_at) || toTimestamp(existingJob.updated_at);
      const lyricsChangedSinceFailure =
        Number.isFinite(lyricsUpdatedAt) &&
        Number.isFinite(failureAt) &&
        lyricsUpdatedAt > failureAt;

      if (!lyricsChangedSinceFailure) {
        reply.code(200).send({
          job_id: existingJob.id,
          estimated_completion_sec: 0,
          poll_url: `/jobs/${existingJob.id}`,
        });
        return;
      }
    }
    // Keep preview/retry abuse-resistant without exposing preview as a user-facing entitlement unit.
    const limit = await consumeRateLimit(userId, "render_preview_burst", 10, 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Preview render limit reached.", {
        retry_at: limit.reset_at,
      });
      return;
    }

    const jobId = newUuid();
    let previewResult;
    try {
      previewResult = await db.transaction(async (query) => {
        const updateResult = await query(
          "UPDATE track_versions SET status = 'processing' WHERE id = ? AND status NOT IN ('processing','preview_ready')",
          [trackVersion.id]
        );

        if (!(updateResult?.changes ?? updateResult?.rowCount ?? 0)) {
          throw new Error("ALREADY_RENDERING");
        }

        await consumeSongEntitlementInTransaction(query, {
          userId,
          trackId: track.id,
          trackVersionId: trackVersion.id,
          consumedAt: trackVersion.song_entitlement_consumed_at,
        });

        const now = nowIso();
        await query(
          "UPDATE tracks SET status = ?, updated_at = ? WHERE id = ?",
          ["rendering", now, track.id]
        );
        await query(
          "INSERT INTO jobs (id, track_version_id, workflow_type, status, step, attempts, max_attempts, step_index, step_data, error_code, error_message, progress_pct, started_at, completed_at, last_heartbeat_at, external_task_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [jobId, trackVersion.id, "preview_render", "queued", "queued", 0, 3, 0, null, null, null, 0, null, null, null, null, now, now]
        );
        await query(
          "UPDATE track_versions SET preview_job_id = ? WHERE id = ?",
          [jobId, trackVersion.id]
        );
        return { jobId };
      });
    } catch (txError) {
      if (txError.code === "INSUFFICIENT_SONGS" || txError.code === "NO_ENTITLEMENTS") {
        sendError(reply, 402, "INSUFFICIENT_CREDITS", "Insufficient songs remaining to start this song.");
        return;
      }
      if (txError.message === "ALREADY_RENDERING") {
        const fallbackJob = await findActiveJobForVersion(trackVersion.id, "preview_render");
        if (fallbackJob) {
          reply.code(202).send({
            job_id: fallbackJob.id,
            estimated_completion_sec: 90,
            poll_url: `/jobs/${fallbackJob.id}`,
          });
          return;
        }
        sendError(reply, 409, "ALREADY_RENDERING", "Preview render already in progress.");
        return;
      }
      if (txError.message === "SPEND_IN_TX_UNAVAILABLE") {
        console.error("[Billing] subscriptionManager.spendSongInTransaction is unavailable.");
      }
      console.error("[Billing] Preview render entitlement transaction failed:", txError.message);
      sendError(reply, 500, "BILLING_ERROR", "Failed to process song entitlement. Please try again.");
      return;
    }

    await addAuditEntry({
      userId,
      action: "render_requested",
      resourceType: "track_version",
      resourceId: trackVersion.id,
      metadata: { render_type: "preview" },
    });
    console.log(`[render_preview] Job created: jobId=${previewResult.jobId}, trackVersionId=${trackVersion.id}`);
    reply.code(202).send({
      job_id: previewResult.jobId,
      estimated_completion_sec: 90,
      poll_url: `/jobs/${previewResult.jobId}`,
    });
  });

  app.post("/tracks/:id/versions/:version/render_full", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    if (appConfig.PREVIEW_ONLY) {
      sendError(reply, 403, "PREVIEW_ONLY_MODE", "Full renders are disabled.");
      return;
    }
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const versionNum = Number(request.params.version);
    const trackVersion = await findTrackVersion(track.id, versionNum);
    if (!trackVersion) {
      sendError(reply, 404, "VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
    const streamBaseUrl = getBaseUrl(request);
    await db.prepare("UPDATE track_versions SET stream_base_url = ? WHERE id = ?").run(
      streamBaseUrl,
      trackVersion.id
    );
    if (trackVersion.moderation_status === "blocked") {
      sendError(reply, 403, "MODERATION_BLOCKED", "Track version blocked by moderation.", {
        reason: trackVersion.moderation_reason,
      });
      return;
    }
    if (trackVersion.lyrics_status !== "approved") {
      sendError(reply, 409, "LYRICS_NOT_APPROVED", "Lyrics must be approved before rendering.");
      return;
    }
    if (trackVersion.status === "full_ready" && trackVersion.full_url) {
      reply.code(200).send({
        job_id: trackVersion.full_job_id || null,
        billing_hold_id: trackVersion.billing_hold_id || null,
        credits_reserved: 0,
        estimated_completion_sec: 0,
      });
      return;
    }
    let existingJob = await findJob(trackVersion.full_job_id);
    if (!existingJob) {
      existingJob = await findActiveJobForVersion(trackVersion.id, "full_render");
      if (existingJob) {
        await db.prepare("UPDATE track_versions SET full_job_id = ? WHERE id = ?").run(
          existingJob.id,
          trackVersion.id
        );
      }
    }
    if (isActiveJob(existingJob)) {
      reply.code(202).send({
        job_id: existingJob.id,
        billing_hold_id: trackVersion.billing_hold_id || null,
        credits_reserved: 0,
        estimated_completion_sec: 180,
      });
      return;
    }
    // Song entitlement is now consumed when a version first starts generation.
    // Full render on the same version reuses that entitlement. Legacy preview-ready
    // versions without the marker still spend once here for backward compatibility.
    const jobId = newUuid();

    let billingResult;
    try {
      billingResult = await db.transaction(async (query) => {
        const updateResult = await query(
          "UPDATE track_versions SET status = 'processing' WHERE id = ? AND status NOT IN ('processing', 'full_ready')",
          [trackVersion.id]
        );

        if (!(updateResult?.changes ?? updateResult?.rowCount ?? 0)) {
          throw new Error("ALREADY_RENDERING");
        }

        await consumeSongEntitlementInTransaction(query, {
          userId,
          trackId: track.id,
          trackVersionId: trackVersion.id,
          consumedAt: trackVersion.song_entitlement_consumed_at,
        });

        const now = nowIso();

        await query(
          "UPDATE tracks SET status = ?, updated_at = ? WHERE id = ?",
          ["rendering", now, track.id]
        );

        await query(
          "INSERT INTO jobs (id, track_version_id, workflow_type, status, step, attempts, max_attempts, step_index, step_data, error_code, error_message, progress_pct, started_at, completed_at, last_heartbeat_at, external_task_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [jobId, trackVersion.id, "full_render", "queued", "queued", 0, 3, 0, null, null, null, 0, null, null, null, null, now, now]
        );

        await query(
          "UPDATE track_versions SET full_job_id = ? WHERE id = ?",
          [jobId, trackVersion.id]
        );

        return { success: true, jobId };
      });
    } catch (txError) {
      if (txError.code === "INSUFFICIENT_SONGS" || txError.code === "NO_ENTITLEMENTS") {
        sendError(reply, 402, "INSUFFICIENT_CREDITS", "Insufficient songs remaining to continue this song.");
        return;
      }
      if (txError.message === "ALREADY_RENDERING") {
        const fallbackJob = await findActiveJobForVersion(trackVersion.id, "full_render");
        if (fallbackJob) {
          reply.code(202).send({
            job_id: fallbackJob.id,
            billing_hold_id: null,
            credits_reserved: 0,
            estimated_completion_sec: 180,
          });
          return;
        }
        sendError(reply, 409, "ALREADY_RENDERING", "Track is already being rendered.");
        return;
      }
      if (txError.message === "SPEND_IN_TX_UNAVAILABLE") {
        console.error("[Billing] subscriptionManager.spendSongInTransaction is unavailable.");
      }
      console.error(`[Billing] Transaction failed for user ${userId}:`, txError.message);
      sendError(reply, 500, "BILLING_ERROR", "Failed to process billing. Please try again.");
      return;
    }

    await addAuditEntry({
      userId,
      action: "render_requested",
      resourceType: "track_version",
      resourceId: trackVersion.id,
      metadata: { render_type: "full" },
    });

    const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").get(billingResult.jobId);
    reply.code(202).send({
      job_id: job.id,
      billing_hold_id: null,
      credits_reserved: 0,
      estimated_completion_sec: 180,
    });
  });

  app.post("/tracks/:id/versions/:version/retry", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const versionNum = Number(request.params.version);
    const trackVersion = await findTrackVersion(track.id, versionNum);
    if (!trackVersion) {
      sendError(reply, 404, "VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
    // Retries share the same short burst budget as preview starts to prevent spam.
    const limit = await consumeRateLimit(userId, "render_preview_burst", 10, 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Retry limit reached.", { retry_at: limit.reset_at });
      return;
    }
    const body = request.body || {};
    const workflowType = body.render_type === "full" ? "full_render" : "preview_render";
    const result = await retryFailedJob({
      trackVersionId: trackVersion.id,
      workflowType,
      userId,
      track,
      trackVersion,
    });
    if (!result) {
      sendError(reply, 404, "NO_FAILED_JOB", "No failed job found to retry.");
      return;
    }
    if (result.blocked) {
      console.warn(
        `[retry] Blocked retry short-circuited for trackVersionId=${trackVersion.id} reason=${result.reason || "unknown"}`
      );
      // Backward-compatible fallback: existing clients treat NO_FAILED_JOB by
      // re-entering the render flow, which surfaces the manual lyrics-edit CTA.
      sendError(reply, 404, "NO_FAILED_JOB", "No failed job found to retry.");
      return;
    }
    if (result.conflict) {
      sendError(reply, 409, "JOB_STATUS_CHANGED", "Job status changed before retry could be applied. Please try again.");
      return;
    }
    console.log(`[retry] Job re-queued: jobId=${result.job.id}, trackVersionId=${trackVersion.id}, workflow=${workflowType}`);
    reply.code(202).send({
      job_id: result.job.id,
      poll_url: `/jobs/${result.job.id}`,
    });
  });

  app.post("/tracks/:id/versions/:version/cancel", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const versionNum = Number(request.params.version);
    const trackVersion = await findTrackVersion(track.id, versionNum);
    if (!trackVersion) {
      sendError(reply, 404, "VERSION_NOT_FOUND", "Track version not found.");
      return;
    }

    // Find any active (queued/running) job for this version
    const activePreview = await findActiveJobForVersion(trackVersion.id, "preview_render");
    const activeFull = await findActiveJobForVersion(trackVersion.id, "full_render");
    const activeJob = activePreview || activeFull;

    if (!activeJob) {
      sendError(reply, 409, "NO_ACTIVE_RENDER", "No active render to cancel.");
      return;
    }

    const now = nowIso();
    try {
      let holdRefunded = false;
      await db.transaction(async () => {
        const cancelResult = await db.prepare(
          "UPDATE jobs SET status = 'cancelled', completed_at = ?, error_code = 'USER_CANCELLED', error_message = 'Cancelled by user', updated_at = ? WHERE id = ? AND status IN ('queued','running')"
        ).run(now, now, activeJob.id);

        // TOCTOU guard: if job completed between check and update, abort
        if (cancelResult.changes === 0) {
          throw Object.assign(new Error("Job already finalized"), { code: "NO_ACTIVE_RENDER" });
        }

        // Release billing hold if one exists for this track version
        const hold = await db.prepare(
          "SELECT * FROM billing_holds WHERE track_version_id = ? AND status = 'held'"
        ).get(trackVersion.id);
        if (hold) {
          await db.prepare(
            "UPDATE billing_holds SET status = 'refunded', resolved_at = ? WHERE id = ?"
          ).run(now, hold.id);
          await db.prepare(
            "UPDATE entitlements SET credits_balance = credits_balance + ?, updated_at = ? WHERE user_id = ?"
          ).run(hold.credits_held, now, userId);
          holdRefunded = true;
        }

        // Reset track version status so the user can re-render
        await db.prepare(
          "UPDATE track_versions SET status = 'cancelled', updated_at = ? WHERE id = ?"
        ).run(now, trackVersion.id);

        await db.prepare(
          "UPDATE tracks SET status = 'draft', updated_at = ? WHERE id = ?"
        ).run(now, track.id);
      });

      await addAuditEntry({
        userId,
        action: "render_cancelled",
        resourceType: "track_version",
        resourceId: trackVersion.id,
        metadata: {
          job_id: activeJob.id,
          workflow_type: activeJob.workflow_type,
          billing_hold_refunded: holdRefunded,
        },
      });

      console.log(`[cancel] Render cancelled: jobId=${activeJob.id}, trackVersionId=${trackVersion.id}`);
      reply.send({
        cancelled: true,
        job_id: activeJob.id,
        workflow_type: activeJob.workflow_type,
        billing_hold_refunded: holdRefunded,
      });
    } catch (err) {
      if (err.code === "NO_ACTIVE_RENDER") {
        sendError(reply, 409, "NO_ACTIVE_RENDER", "Render already completed or cancelled.");
        return;
      }
      console.error("[cancel] Cancel render failed:", { trackVersionId: trackVersion.id, error: err.message });
      sendError(reply, 500, "CANCEL_FAILED", "Failed to cancel render.");
    }
  });

  app.post("/tracks/:id/versions/:version/reroll", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    sendError(reply, 410, "FEATURE_RETIRED", "Reroll has been retired. Edit your story and create a new song instead.");
  });

  app.get("/tracks/:id/versions/:version/lyrics", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const versionNum = Number(request.params.version);
    const trackVersion = await findTrackVersion(track.id, versionNum);
    if (!trackVersion) {
      sendError(reply, 404, "VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
    reply.send({ lyrics: parseJson(trackVersion.lyrics_json, null) });
  });

  app.put("/tracks/:id/versions/:version/lyrics", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    // Rate limit: 10 lyrics edits per minute
    const limit = await consumeRateLimit(userId, "lyrics_edit", 10, 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Lyrics edit rate limit reached.", {
        retry_after: limit.reset_at,
      });
      return;
    }
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const versionNum = Number(request.params.version);
    const trackVersion = await findTrackVersion(track.id, versionNum);
    if (!trackVersion) {
      sendError(reply, 404, "VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
    const body = request.body || {};
    if (!body.lyrics || typeof body.lyrics !== "object") {
      sendError(reply, 400, "INVALID_LYRICS", "lyrics must be an object.");
      return;
    }
    // Extract text content from lyrics for moderation
    const lyricsText = extractLyricsText(body.lyrics);
    const moderation = moderationCheck({ lyrics: lyricsText });
    if (!moderation.allowed) {
      request.log.warn({
        route: "update_lyrics",
        trackId: track.id,
        versionId: trackVersion.id,
        userId,
        moderationReason: moderation.reason,
        moderationDetails: moderation.details || null,
      }, "Lyrics edit blocked by moderation");
      await setRiskLevel(userId, "medium");
      await addAuditEntry({
        userId,
        action: "moderation_blocked",
        resourceType: "lyrics_edit",
        resourceId: trackVersion.id,
        metadata: { reason: moderation.reason },
      });
      sendError(reply, 403, "MODERATION_BLOCKED", "Lyrics edit blocked by moderation.", {
        reason: moderation.reason,
      });
      return;
    }
    await db.prepare(
      "UPDATE track_versions SET lyrics_json = ?, lyrics_status = ?, lyrics_updated_at = ? WHERE id = ?"
    ).run(toJson(body.lyrics), "draft", nowIso(), trackVersion.id);
    reply.send({ updated: true });
  });

  app.post("/tracks/:id/versions/:version/lyrics/generate", { schema: schemas.generateLyrics }, async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    // Rate limit: 30 lyrics generations per minute to prevent API abuse
    const limit = await consumeRateLimit(userId, "lyrics_generate", 30, 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Lyrics generation rate limit reached.", {
        retry_after: limit.reset_at,
      });
      return;
    }
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const versionNum = Number(request.params.version);
    const trackVersion = await findTrackVersion(track.id, versionNum);
    if (!trackVersion) {
      sendError(reply, 404, "VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
    let result;
    try {
      result = await generateLyrics(buildLyricsContext(track));
    } catch (err) {
      if (err && (err.code === "AI_UNAVAILABLE" || err.message === "AI_UNAVAILABLE")) {
        sendError(reply, 503, "AI_UNAVAILABLE", "Lyrics generation is temporarily unavailable.");
        return;
      }
      if (err && err.code === "LYRICS_QUALITY_LOW") {
        sendError(reply, 422, "LYRICS_QUALITY_LOW", "Generated lyrics were not strong enough to use yet.", {
          quality_score: Number.isFinite(err.quality_score) ? err.quality_score : null,
        });
        return;
      }
      if (err && err.code === "LYRICS_FIDELITY_LOW") {
        sendError(reply, 422, "LYRICS_FIDELITY_LOW", "Generated lyrics did not stay faithful enough to the story.", {
          fidelity: err.fidelity || null,
        });
        return;
      }
      throw err;
    }
    // Post-LLM moderation: re-validate generated lyrics
    const lyricsText = extractLyricsText(result.lyrics);
    const validation = validateGeneratedLyrics(lyricsText, track.recipient_name);
    if (!validation.allowed) {
      // Mark version as blocked in database
      await db.prepare(
        "UPDATE track_versions SET moderation_status = ?, moderation_reason = ? WHERE id = ?"
      ).run("blocked", validation.reason, trackVersion.id);
      await addAuditEntry({
        userId,
        action: "llm_moderation_blocked",
        resourceType: "lyrics_generate",
        resourceId: trackVersion.id,
        metadata: { reason: validation.reason },
      });
      // Return 422 (not 500) - content is unprocessable due to policy, not a server error
      sendError(reply, 422, "GENERATION_BLOCKED", "Generated lyrics failed moderation.", {
        reason: validation.reason,
      });
      return;
    }
    // Track anchor presence for quality metrics (but don't block)
    const lyricsStatus = validation.hasAnchor ? result.lyrics_status : "needs_anchor";
    await db.prepare(
      "UPDATE track_versions SET lyrics_json = ?, lyrics_status = ?, lyrics_updated_at = ? WHERE id = ?"
    ).run(toJson(result.lyrics), lyricsStatus, nowIso(), trackVersion.id);
    reply.send({
      lyrics: result.lyrics,
      lyrics_status: lyricsStatus,
      has_anchor: validation.hasAnchor,
    });
  });

  app.post("/tracks/:id/versions/:version/lyrics/approve", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    // Rate limit: 20 approvals per hour
    const limit = await consumeRateLimit(userId, "lyrics_approve", 20, 60 * 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Lyrics approval rate limit reached.", {
        retry_after: limit.reset_at,
      });
      return;
    }
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const versionNum = Number(request.params.version);
    const trackVersion = await findTrackVersion(track.id, versionNum);
    if (!trackVersion) {
      sendError(reply, 404, "VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
    if (!trackVersion.lyrics_json) {
      sendError(reply, 409, "LYRICS_MISSING", "Generate or upload lyrics before approval.");
      return;
    }
    // Parse lyrics and extract text for moderation (fix: was passing JSON string)
    const lyricsObj = parseJson(trackVersion.lyrics_json, null, "lyrics_approve");
    const lyricsText = extractLyricsText(lyricsObj);
    const moderation = moderationCheck({ lyrics: lyricsText });
    if (!moderation.allowed) {
      await setRiskLevel(userId, "medium");
      await db.prepare(
        "UPDATE track_versions SET moderation_status = ?, moderation_reason = ? WHERE id = ?"
      ).run("blocked", moderation.reason, trackVersion.id);
      await addAuditEntry({
        userId,
        action: "moderation_blocked",
        resourceType: "lyrics_approve",
        resourceId: trackVersion.id,
        metadata: { reason: moderation.reason },
      });
      sendError(reply, 403, "MODERATION_BLOCKED", "Lyrics blocked by moderation.", {
        reason: moderation.reason,
      });
      return;
    }
    // Validate anchor presence (warning, not blocking)
    const validation = validateGeneratedLyrics(lyricsText, track.recipient_name);
    await addAuditEntry({
      userId,
      action: "lyrics_approved",
      resourceType: "track_version",
      resourceId: trackVersion.id,
      metadata: { has_anchor: validation.hasAnchor },
    });
    await db.prepare(
      "UPDATE track_versions SET lyrics_status = ?, lyrics_approved_at = ?, moderation_status = ? WHERE id = ?"
    ).run("approved", nowIso(), "passed", trackVersion.id);
    console.log(`[lyrics_approve] Lyrics approved: trackId=${track.id}, versionId=${trackVersion.id}`);
    reply.send({ approved: true, has_anchor: validation.hasAnchor });
  });

  app.post("/tracks/:id/share", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    // Apply og_variant selection before idempotency check so re-shares can update variant
    const body = request.body || {};
    if (body.og_variant !== undefined) {
      const rawVariant = body.og_variant;
      const providedVariant = rawVariant === null ? "" : String(rawVariant).trim();
      const normalizedVariant = normalizeVariantName(rawVariant, SONG_VARIANT_NAMES);
      if (providedVariant && !normalizedVariant) {
        sendError(reply, 400, "INVALID_VARIANT", `Invalid variant. Must be one of: ${SONG_VARIANT_NAMES.join(", ")}`);
        return;
      }
      await db.prepare("UPDATE tracks SET og_variant = ?, updated_at = ? WHERE id = ?")
        .run(normalizedVariant, nowIso(), track.id);
    }

    const existingShare = await findActiveTrackShare(track, userId);
    if (existingShare) {
      reply.send({
        share_id: existingShare.id,
        share_url: buildPlayShareUrl(existingShare.id),
        qr_code_url: `https://cdn.porizo.local/qr/${existingShare.id}.png`,
        expires_at: existingShare.expires_at,
        claim_pin: existingShare.claim_pin,
        existing: true,
      });
      return;
    }

    // Idempotency check is handled inside createOrGetShareToken
    const versionNum = body.version_num || track.latest_version;
    const trackVersion = await findTrackVersion(track.id, versionNum);
    if (!trackVersion) {
      sendError(reply, 404, "VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
    if (!trackVersion.preview_url && !trackVersion.full_url) {
      sendError(reply, 409, "TRACK_NOT_READY", "Track version is not ready to share.");
      return;
    }

    const result = await createOrGetShareToken({
      db,
      trackId: track.id,
      trackVersionId: trackVersion.id,
      userId,
      expiresInDays: body.expires_in_days || 30,
      buildShareUrl: buildPlayShareUrl,
      ensureShareMp4: () => ensureShareMp4({ track, trackVersion }),
      attribution: {
        utmSource: request.query.utm_source || body.utm_source || null,
        utmMedium: request.query.utm_medium || body.utm_medium || null,
        utmCampaign: request.query.utm_campaign || body.utm_campaign || null,
        referrer: request.headers.referer || request.headers.referrer || null,
        ip: request.ip || null,
        userAgent: request.headers["user-agent"] || null,
      },
    });

    if (!result.existing) {
      await addAuditEntry({
        userId,
        action: "share_created",
        resourceType: "share_token",
        resourceId: result.shareId,
      });
      eventsService.emit("share_create", {
        userId,
        resourceType: "share",
        resourceId: result.shareId,
        metadata: {
          track_id: track.id,
          occasion: track.occasion,
          utm_source: result.attribution?.utmSource,
        },
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
    }

    reply.send({
      share_id: result.shareId,
      share_url: result.shareUrl,
      qr_code_url: `https://cdn.porizo.local/qr/${result.shareId}.png`,
      expires_at: result.expiresAt,
      claim_pin: result.claimPin,
      existing: result.existing || false,
    });
  });
}

module.exports = { registerTrackRoutes };
