"use strict";

const crypto = require("crypto");
const { newUuid, newShareId } = require("../utils/ids");
const { nowIso, toJson, parseJson } = require("../utils/common");
const { moderationCheck, validateGeneratedLyrics } = require("../providers/moderation");
const { generateLyrics } = require("../providers/lyrics");
const { getFeatureFlag } = require("../services/feature-flags");

function registerTrackRoutes(app, {
  db,
  config,
  appConfig,
  requireUserId,
  sendError,
  consumeRateLimit,
  consumePreviewEntitlement,
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
  createJob,
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
      "INSERT INTO tracks (id, user_id, status, title, occasion, recipient_name, style, duration_target, voice_mode, message, story_context_json, share_token_id, latest_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
    // Keep preview/retry abuse-resistant without effectively creating a second daily cap.
    // Plan-based daily limits (including pro unlimited) are enforced by consumePreviewEntitlement.
    const limit = await consumeRateLimit(userId, "render_preview_burst", 10, 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Preview render limit reached.", {
        retry_at: limit.reset_at,
      });
      return;
    }
    const entitlement = await consumePreviewEntitlement(userId);
    if (!entitlement.allowed) {
      sendError(reply, 402, "DAILY_LIMIT_REACHED", "Daily preview limit reached.", {
        retry_at: entitlement.reset_at,
      });
      return;
    }
    // Atomic check-and-update to prevent TOCTOU race condition
    // Two concurrent requests can't both pass this check
    const updateResult = await db.prepare(
      "UPDATE track_versions SET status = 'processing' WHERE id = ? AND status NOT IN ('processing','preview_ready')"
    ).run(trackVersion.id);

    if (updateResult.changes === 0) {
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
    await db.prepare("UPDATE tracks SET status = ?, updated_at = ? WHERE id = ?").run(
      "rendering",
      nowIso(),
      track.id
    );
    await addAuditEntry({
      userId,
      action: "render_requested",
      resourceType: "track_version",
      resourceId: trackVersion.id,
      metadata: { render_type: "preview" },
    });
    const job = await createJob({ trackVersionId: trackVersion.id, workflowType: "preview_render" });
    console.log(`[render_preview] Job created: jobId=${job.id}, trackVersionId=${trackVersion.id}`);
    reply.code(202).send({
      job_id: job.id,
      estimated_completion_sec: 90,
      poll_url: `/jobs/${job.id}`,
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
    if (!trackVersion.preview_url && trackVersion.status !== "preview_ready") {
      sendError(reply, 409, "PREVIEW_REQUIRED", "Preview must be completed before full render.");
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
    const body = request.body || {};
    if (!body.confirm_credit_spend) {
      sendError(reply, 400, "CONFIRM_REQUIRED", "confirm_credit_spend must be true.");
      return;
    }

    // Deduct a song via the canonical spendSong path which checks trial songs first,
    // records an audit transaction, and updates songs_remaining / trial_songs_remaining.
    // This is the ONLY deduction point — the runner no longer calls spendSong on completion.
    try {
      await subscriptionManager.spendSong(userId, track.id);
    } catch (spendErr) {
      if (spendErr.message === "Insufficient songs remaining" || spendErr.message === "No entitlements found for user") {
        sendError(reply, 402, "INSUFFICIENT_CREDITS", "Insufficient songs remaining for full render.");
        return;
      }
      console.error(`[Billing] spendSong failed for user ${userId}:`, spendErr.message);
      sendError(reply, 500, "BILLING_ERROR", "Failed to process billing. Please try again.");
      return;
    }

    // Create hold + job (song already deducted above)
    const holdId = newUuid();
    const jobId = newUuid();
    const now = nowIso();
    const holdExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    let billingResult;
    try {
      billingResult = await db.transaction(async () => {
        const updateResult = await db.prepare(
          "UPDATE track_versions SET status = 'processing', billing_hold_id = ? WHERE id = ? AND status NOT IN ('processing', 'full_ready')"
        ).run(holdId, trackVersion.id);

        if (updateResult.changes === 0) {
          throw new Error("ALREADY_RENDERING");
        }

        await db.prepare(
          "INSERT INTO billing_holds (id, user_id, track_version_id, credits_held, status, created_at, expires_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(holdId, userId, trackVersion.id, 1, "held", now, holdExpiresAt, null);

        await db.prepare("UPDATE tracks SET status = ?, updated_at = ? WHERE id = ?").run("rendering", now, track.id);

        await db.prepare(
          "INSERT INTO jobs (id, track_version_id, workflow_type, status, step, attempts, max_attempts, step_index, step_data, error_code, error_message, progress_pct, started_at, completed_at, last_heartbeat_at, external_task_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(jobId, trackVersion.id, "full_render", "queued", "queued", 0, 3, 0, null, null, null, 0, null, null, null, null, now, now);

        await db.prepare("UPDATE track_versions SET full_job_id = ? WHERE id = ?").run(jobId, trackVersion.id);

        return { success: true, jobId, holdId };
      });
    } catch (txError) {
      if (txError.message === "ALREADY_RENDERING") {
        const fallbackJob = await findActiveJobForVersion(trackVersion.id, "full_render");
        if (fallbackJob) {
          reply.code(202).send({
            job_id: fallbackJob.id,
            billing_hold_id: trackVersion.billing_hold_id || null,
            credits_reserved: 0,
            estimated_completion_sec: 180,
          });
          return;
        }
        sendError(reply, 409, "ALREADY_RENDERING", "Track is already being rendered.");
        return;
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
      billing_hold_id: billingResult.holdId,
      credits_reserved: 1,
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
    console.log(`[retry] Job re-queued: jobId=${result.job.id}, trackVersionId=${trackVersion.id}, workflow=${workflowType}`);
    reply.code(202).send({
      job_id: result.job.id,
      poll_url: `/jobs/${result.job.id}`,
    });
  });

  app.post("/tracks/:id/versions/:version/reroll", async (request, reply) => {
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
    const baseVersion = await findTrackVersion(track.id, versionNum);
    if (!baseVersion) {
      sendError(reply, 404, "VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
    const body = request.body || {};
    const paramsHash = computeParamsHash({ base_version: baseVersion.id, ...body });
    const streamBaseUrl = getBaseUrl(request);
    // Transaction ensures version increment + insert are atomic
    const newVersionId = newUuid();
    const newVersionNum = await db.transaction(async () => {
      const num = await incrementTrackVersion(track.id);
      await db.prepare(
        "INSERT INTO track_versions (id, track_id, version_num, parent_version_id, status, render_type, params_json, params_hash, cost_estimate_json, actual_cost_json, storage_ref, created_at, completed_at, preview_url, full_url, billing_hold_id, lyrics_status, lyrics_updated_at, lyrics_approved_at, guide_access_token, stream_base_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        newVersionId,
        track.id,
        num,
        baseVersion.id,
        "queued",
        baseVersion.render_type,
        toJson(body),
        paramsHash,
        toJson({ credits: 1, usd: 0.15 }),
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
      track_version_id: newVersionId,
      version_num: newVersionNum,
      params_hash: paramsHash,
      cost_estimate: { credits: 1, usd: 0.15 },
      status: "queued",
    });
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
    // Parse story context from track and merge with base params
    const storyContext = parseJson(track.story_context_json, {}, "story_context");
    let result;
    try {
      result = await generateLyrics({
        title: track.title,
        recipient_name: track.recipient_name,
        message: track.message,
        style: track.style,
        occasion: track.occasion,
        // Story context fields for enhanced songwriting
        relationship_type: storyContext.relationship_type,
        years_known: storyContext.years_known,
        specific_memory: storyContext.specific_memory,
        special_phrases: storyContext.special_phrases,
        what_makes_them_special: storyContext.what_makes_them_special,
        // Memory answers from AI follow-up questions
        memory_answers: storyContext.memory_answers,
      });
    } catch (err) {
      if (err && (err.code === "AI_UNAVAILABLE" || err.message === "AI_UNAVAILABLE")) {
        sendError(reply, 503, "AI_UNAVAILABLE", "Lyrics generation is temporarily unavailable.");
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

    if (track.share_token_id) {
      const existingShare = await db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(track.share_token_id);
      if (existingShare) {
        if (existingShare.status !== "revoked" && new Date(existingShare.expires_at) > new Date()) {
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
        if (new Date(existingShare.expires_at) <= new Date() && existingShare.status !== "expired") {
          await db.prepare("UPDATE share_tokens SET status = ? WHERE id = ?").run("expired", existingShare.id);
        }
      }
    }
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
    const shareId = newShareId();
    const expiresAt = new Date(
      Date.now() + (body.expires_in_days || 30) * 24 * 60 * 60 * 1000
    ).toISOString();

    // Extract UTM parameters for attribution tracking
    const utmSource = request.query.utm_source || body.utm_source || null;
    const utmMedium = request.query.utm_medium || body.utm_medium || null;
    const utmCampaign = request.query.utm_campaign || body.utm_campaign || null;
    const referrer = request.headers.referer || request.headers.referrer || null;
    const createdIp = request.ip || null;
    const createdUserAgent = request.headers["user-agent"] || null;

    const streamKeyId = newUuid();
    const streamKey = crypto.randomBytes(16).toString("base64");
    // Generate 6-digit PIN for claim verification (prevents unauthorized claim)
    const claimPin = String(Math.floor(100000 + Math.random() * 900000));
    await db.prepare(
      "INSERT INTO share_tokens (id, track_id, track_version_id, creator_id, status, bound_device_id, bound_device_platform, bound_app_version, bound_at, web_stream_allowed, app_save_allowed, expires_at, created_at, last_accessed_at, access_count, stream_key_id, stream_key, claim_pin, claim_attempts, utm_source, utm_medium, utm_campaign, referrer, created_ip, created_user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      shareId,
      track.id,
      trackVersion.id,
      userId,
      "unbound",
      null,
      null,
      null,
      null,
      1,
      1,
      expiresAt,
      nowIso(),
      null,
      0,
      streamKeyId,
      streamKey,
      claimPin,
      0,
      utmSource,
      utmMedium,
      utmCampaign,
      referrer,
      createdIp,
      createdUserAgent
    );
    await db.prepare("UPDATE tracks SET share_token_id = ?, updated_at = ? WHERE id = ?").run(
      shareId,
      nowIso(),
      track.id
    );

    await addAuditEntry({
      userId,
      action: "share_created",
      resourceType: "share_token",
      resourceId: shareId,
    });

    // Emit share_create event for analytics
    eventsService.emit("share_create", {
      userId,
      resourceType: "share",
      resourceId: shareId,
      metadata: {
        track_id: track.id,
        occasion: track.occasion,
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
      },
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });

    // Pre-generate share.mp4 so social crawlers can fetch video immediately after link creation.
    // This reduces gray/empty cards on Facebook/X when they scrape the URL right away.
    try {
      await ensureShareMp4({ track, trackVersion });
    } catch (err) {
      request.log.warn(
        { shareId, trackId: track.id, err: err?.message || String(err) },
        "Share video pre-generation failed; continuing with share creation"
      );
    }

    reply.send({
      share_id: shareId,
      share_url: buildPlayShareUrl(shareId),
      qr_code_url: `https://cdn.porizo.local/qr/${shareId}.png`,
      expires_at: expiresAt,
      claim_pin: claimPin, // Creator must share this PIN with recipient out-of-band
    });
  });
}

module.exports = { registerTrackRoutes };
