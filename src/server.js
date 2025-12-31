const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const fastify = require("fastify");
const { initDb } = require("./db");
const config = require("./config");
const { startJobRunner } = require("./workflows/runner");
const { moderationCheck } = require("./providers/moderation");
const { generateLyrics } = require("./providers/lyrics");
const { extractEmbedding } = require("./providers/replicate");
const { downloadToFile } = require("./providers/http");
const { concatWavFiles } = require("./utils/audio");
const { createHLSPlaylist } = require("./utils/hls");
const { stableStringify } = require("./utils/stable-json");
const { newUuid, newShareId } = require("./utils/ids");
const { validateEnrollmentAudio } = require("./services/enrollment");
// extractEmbedding will be called asynchronously by a background job
const { startCleanupJob } = require("./jobs/cleanup");

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback, context = "unknown") {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch (err) {
    console.error(`[parseJson] Failed to parse JSON for ${context}:`, err.message, "Value prefix:", String(value).slice(0, 100));
    return fallback;
  }
}

function toJson(value) {
  if (value === undefined) {
    return null;
  }
  return JSON.stringify(value);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function buildServer({ db, config: appConfig }) {
  const app = fastify({
    logger: true,
    bodyLimit: 1048576, // 1MB max body size to prevent JSON DoS
  });

  // Register static file serving for debug page
  app.register(require("@fastify/static"), {
    root: path.join(process.cwd(), "public"),
    prefix: "/",
  });

  // Register multipart for file uploads
  app.register(require("@fastify/multipart"), {
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  });

  // ============ Input Validation Schemas ============
  const schemas = {
    createTrack: {
      body: {
        type: "object",
        properties: {
          title: { type: "string", maxLength: 200 },
          occasion: { type: "string", maxLength: 100 },
          recipient_name: { type: "string", maxLength: 100 },
          style: { type: "string", maxLength: 100 },
          duration_target: { type: "integer", minimum: 30, maximum: 180 },
          voice_mode: { type: "string", enum: ["user_voice", "ai_voice"] },
          message: { type: "string", maxLength: 1000 },
          // Story context fields for enhanced lyrics generation
          relationship_type: { type: "string", maxLength: 50 },
          years_known: { type: "integer", minimum: 0, maximum: 100 },
          specific_memory: { type: "string", maxLength: 500 },
          special_phrases: { type: "string", maxLength: 200 },
          what_makes_them_special: { type: "string", maxLength: 500 },
        },
        additionalProperties: false,
      },
    },
    createVersion: {
      body: {
        type: "object",
        properties: {
          render_type: { type: "string", enum: ["preview", "full"] },
          parent_version_id: { type: "string", format: "uuid" },
          params: { type: "object" },
        },
        additionalProperties: false,
      },
    },
    enrollmentStart: {
      body: {
        type: "object",
        required: ["consent_accepted"],
        properties: {
          consent_accepted: { type: "boolean", const: true },
          consent_version: { type: "string", maxLength: 50 },
        },
        additionalProperties: false,
      },
    },
    enrollmentComplete: {
      body: {
        type: "object",
        required: ["session_id"],
        properties: {
          session_id: { type: "string", format: "uuid" },
        },
        additionalProperties: false,
      },
    },
    shareClaim: {
      body: {
        type: "object",
        required: ["device_id", "platform"],
        properties: {
          device_id: { type: "string", minLength: 1, maxLength: 100 },
          platform: { type: "string", enum: ["ios", "android", "web"] },
          app_version: { type: "string", maxLength: 20 },
          pin: { type: "string", pattern: "^[0-9]{6}$" },
        },
        additionalProperties: false,
      },
    },
    generateLyrics: {
      body: {
        type: "object",
        properties: {
          custom_prompt: { type: "string", maxLength: 500 },
        },
        additionalProperties: false,
      },
    },
  };

  function sendError(reply, statusCode, error, message, details) {
    const payload = { error, message };
    if (details && typeof details === "object") {
      Object.assign(payload, details);
    }
    reply.code(statusCode).send(payload);
  }

  function ensureUser(userId) {
    const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
    if (!existing) {
      db.prepare(
        "INSERT INTO users (id, created_at, risk_level) VALUES (?, ?, 'low')"
      ).run(userId, nowIso());
    }
    const entitlements = db
      .prepare("SELECT user_id FROM entitlements WHERE user_id = ?")
      .get(userId);
    if (!entitlements) {
      db.prepare(
        "INSERT INTO entitlements (user_id, tier, credits_balance, credits_used_total, preview_count_today, preview_count_reset_at, updated_at) VALUES (?, 'free', 1, 0, 0, ?, ?)"
      ).run(userId, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), nowIso());
    }
  }

  function getUserRiskLevel(userId) {
    const user = db.prepare("SELECT risk_level FROM users WHERE id = ?").get(userId);
    return user?.risk_level || "low";
  }

  function requireUserId(request, reply) {
    const userId = request.headers["x-user-id"];
    if (!userId || typeof userId !== "string") {
      sendError(reply, 401, "AUTH_REQUIRED", "Missing x-user-id header.");
      return null;
    }
    ensureUser(userId);
    return userId;
  }

  function getBaseUrl(request) {
    const proto = request.headers["x-forwarded-proto"] || "http";
    const host = request.headers["host"];
    if (host) {
      return `${proto}://${host}`;
    }
    return appConfig.STREAM_BASE_URL;
  }

  function getVersionDir(track, trackVersion) {
    return path.join(
      appConfig.STORAGE_DIR,
      "tracks",
      track.user_id,
      track.id,
      `v${trackVersion.version_num}`
    );
  }

  function sendMediaFile(request, reply, filePath, contentType) {
    if (!fs.existsSync(filePath)) {
      sendError(reply, 404, "AUDIO_NOT_FOUND", "Audio file not found.");
      return;
    }
    const stat = fs.statSync(filePath);
    const range = request.headers.range;
    if (!range) {
      const buffer = fs.readFileSync(filePath);
      reply
        .type(contentType)
        .header("Content-Length", buffer.length)
        .header("Accept-Ranges", "bytes")
        .send(buffer);
      return;
    }
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (!match) {
      reply
        .type(contentType)
        .header("Content-Length", stat.size)
        .header("Accept-Ranges", "bytes")
        .send(fs.createReadStream(filePath));
      return;
    }
    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : stat.size - 1;
    if (Number.isNaN(start) || start < 0) {
      start = 0;
    }
    if (Number.isNaN(end) || end >= stat.size) {
      end = stat.size - 1;
    }
    if (start > end) {
      reply
        .code(416)
        .header("Content-Range", `bytes */${stat.size}`)
        .send();
      return;
    }
    reply
      .code(206)
      .type(contentType)
      .header("Content-Range", `bytes ${start}-${end}/${stat.size}`)
      .header("Accept-Ranges", "bytes")
      .header("Content-Length", end - start + 1)
      .send(fs.createReadStream(filePath, { start, end }));
  }

  function sendAudioFile(request, reply, filePath) {
    sendMediaFile(request, reply, filePath, "audio/aac");
  }

  async function ensureShareHls({ share, track, trackVersion }) {
    const versionDir = getVersionDir(track, trackVersion);
    const hlsDir = path.join(versionDir, "hls", `share_${share.id}`);
    const playlistPath = path.join(hlsDir, "playlist.m3u8");
    if (!fs.existsSync(playlistPath)) {
      const fullPath = path.join(versionDir, "full.aac");
      const previewPath = path.join(versionDir, "preview.aac");
      const inputPath = fs.existsSync(fullPath) ? fullPath : previewPath;
      if (!fs.existsSync(inputPath)) {
        return null;
      }
      const keyBuffer = share.stream_key
        ? Buffer.from(share.stream_key, "base64")
        : null;
      try {
        await createHLSPlaylist(inputPath, hlsDir, 4, {
          key: keyBuffer,
          keyUrl: "key",
        });
      } catch (err) {
        console.error(`[ensureShareHls] HLS creation failed for share ${share.id}:`, err.message);
        return null;
      }
    }
    return { playlistPath, hlsDir };
  }

  function computeParamsHash(params) {
    const payload = stableStringify(params || {});
    return crypto.createHash("sha256").update(payload).digest("hex");
  }

  function consumeRateLimit(userId, actionKey, limit, windowSeconds) {
    // Sliding window rate limiting (prevents boundary exploit)
    // Uses weighted average of current and previous window counts
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const currentWindowStart = Math.floor(now / windowMs) * windowMs;
    const previousWindowStart = currentWindowStart - windowMs;
    const elapsedInWindow = now - currentWindowStart;
    const windowProgress = elapsedInWindow / windowMs; // 0.0 to 1.0
    const resetAt = new Date(currentWindowStart + windowMs).toISOString();

    // Get counts from current and previous windows
    const currentWindow = db.prepare(
      "SELECT count FROM rate_limits WHERE user_id = ? AND action_type = ? AND window_start_ms = ?"
    ).get(userId, actionKey, currentWindowStart);
    const previousWindow = db.prepare(
      "SELECT count FROM rate_limits WHERE user_id = ? AND action_type = ? AND window_start_ms = ?"
    ).get(userId, actionKey, previousWindowStart);

    const currentCount = currentWindow?.count || 0;
    const previousCount = previousWindow?.count || 0;

    // Sliding window approximation: weight previous window by remaining time
    const weightedCount = currentCount + previousCount * (1 - windowProgress);

    // Check if adding this request would exceed limit
    if (weightedCount >= limit) {
      return { allowed: false, remaining: 0, reset_at: resetAt };
    }

    // Try atomic insert first (for new windows)
    try {
      db.prepare(
        "INSERT INTO rate_limits (user_id, action_type, window_start_ms, window_seconds, count, limit_count) VALUES (?, ?, ?, ?, 1, ?)"
      ).run(userId, actionKey, currentWindowStart, windowSeconds, limit);
      return { allowed: true, remaining: Math.floor(limit - weightedCount - 1), reset_at: resetAt };
    } catch (err) {
      // Row exists, proceed with atomic update
    }

    // Atomic UPDATE - increment count in current window
    db.prepare(
      "UPDATE rate_limits SET count = count + 1 WHERE user_id = ? AND action_type = ? AND window_start_ms = ?"
    ).run(userId, actionKey, currentWindowStart);

    // Get updated count for remaining calculation
    const updated = db.prepare(
      "SELECT count FROM rate_limits WHERE user_id = ? AND action_type = ? AND window_start_ms = ?"
    ).get(userId, actionKey, currentWindowStart);
    const newWeightedCount = updated.count + previousCount * (1 - windowProgress);
    return {
      allowed: true,
      remaining: Math.max(0, Math.floor(limit - newWeightedCount)),
      reset_at: resetAt,
    };
  }

  function consumePreviewEntitlement(userId) {
    const riskLevel = getUserRiskLevel(userId);
    if (riskLevel === "blocked") {
      return { allowed: false, reset_at: null, reason: "BLOCKED" };
    }
    const dailyLimit = riskLevel === "medium" ? 10 : 20;
    if (riskLevel === "high") {
      return { allowed: false, reset_at: null, reason: "HIGH_RISK" };
    }

    const now = new Date();
    const nowStr = nowIso();
    const newResetAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

    // First, reset expired counters atomically
    db.prepare(
      "UPDATE entitlements SET preview_count_today = 0, preview_count_reset_at = ? WHERE user_id = ? AND (preview_count_reset_at IS NULL OR preview_count_reset_at <= ?)"
    ).run(newResetAt, userId, nowStr);

    // Atomic UPDATE with condition - only increments if under limit
    const result = db.prepare(
      "UPDATE entitlements SET preview_count_today = preview_count_today + 1, updated_at = ? WHERE user_id = ? AND preview_count_today < ?"
    ).run(nowStr, userId, dailyLimit);

    if (result.changes === 0) {
      // Limit reached
      const ent = db.prepare("SELECT preview_count_reset_at FROM entitlements WHERE user_id = ?").get(userId);
      return { allowed: false, reset_at: ent?.preview_count_reset_at || newResetAt, reason: "DAILY_LIMIT" };
    }

    // Get updated count for response
    const updated = db.prepare(
      "SELECT preview_count_today, preview_count_reset_at FROM entitlements WHERE user_id = ?"
    ).get(userId);
    return {
      allowed: true,
      remaining: dailyLimit - updated.preview_count_today,
      reset_at: updated.preview_count_reset_at,
      risk_level: riskLevel,
    };
  }

  function consumeCredit(userId) {
    // Atomic UPDATE with condition - only decrements if balance > 0
    const result = db.prepare(
      "UPDATE entitlements SET credits_balance = credits_balance - 1, credits_used_total = credits_used_total + 1, updated_at = ? WHERE user_id = ? AND credits_balance > 0"
    ).run(nowIso(), userId);

    if (result.changes === 0) {
      return { allowed: false };
    }

    // Get new balance for response
    const updated = db.prepare("SELECT credits_balance FROM entitlements WHERE user_id = ?").get(userId);
    return { allowed: true, remaining: updated?.credits_balance || 0 };
  }

  function setRiskLevel(userId, level) {
    db.prepare("UPDATE users SET risk_level = ? WHERE id = ?").run(level, userId);
  }

  function addAuditEntry({ userId, action, resourceType, resourceId, metadata }) {
    db.prepare(
      "INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(newUuid(), userId || null, action, resourceType || null, resourceId || null, toJson(metadata), nowIso());
  }

  function addShareAccessLog({ shareTokenId, eventType, metadata }) {
    db.prepare(
      "INSERT INTO share_access_log (id, share_token_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(newUuid(), shareTokenId, eventType, toJson(metadata), nowIso());
  }

  function findTrackVersion(trackId, versionNum) {
    return db
      .prepare("SELECT * FROM track_versions WHERE track_id = ? AND version_num = ?")
      .get(trackId, versionNum);
  }

  /**
   * Atomically increments track version number to prevent race conditions.
   * Two concurrent requests will get different version numbers guaranteed.
   * @param {string} trackId - Track ID
   * @returns {number} The new version number
   */
  // Atomic version increment using transaction to prevent race conditions
  // when concurrent requests try to create new versions simultaneously
  function incrementTrackVersion(trackId) {
    const now = nowIso();
    // Note: Callers wrap this in a transaction for atomicity with INSERT
    db.prepare(
      "UPDATE tracks SET latest_version = latest_version + 1, updated_at = ? WHERE id = ?"
    ).run(now, trackId);
    const track = db.prepare("SELECT latest_version FROM tracks WHERE id = ?").get(trackId);
    return track.latest_version;
  }

  function getTrackVersions(trackId) {
    const versions = db
      .prepare("SELECT * FROM track_versions WHERE track_id = ? ORDER BY version_num")
      .all(trackId);
    return versions.map((version) => {
      // Intentionally omit sensitive fields from public response
      // eslint-disable-next-line no-unused-vars
      const { guide_vocal_url, guide_access_token, ...rest } = version;
      return {
        ...rest,
      params_json: parseJson(version.params_json, {}),
      lyrics_json: parseJson(version.lyrics_json, null),
      music_plan_json: parseJson(version.music_plan_json, null),
      moderation_status: version.moderation_status || null,
      moderation_reason: version.moderation_reason || null,
      instrumental_url: version.instrumental_url || null,
      voice_conversion_url: version.voice_conversion_url || null,
      provenance_json: parseJson(version.provenance_json, null),
      cost_estimate: parseJson(version.cost_estimate_json, null),
      actual_cost: parseJson(version.actual_cost_json, null),
      };
    });
  }

  function createJob({ trackVersionId, workflowType }) {
    const jobId = newUuid();
    db.prepare(
      "INSERT INTO jobs (id, track_version_id, workflow_type, status, step, attempts, max_attempts, step_index, step_data, error_code, error_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      jobId,
      trackVersionId,
      workflowType,
      "queued",
      "queued",
      0,
      3,
      0,
      null,
      null,
      null,
      nowIso(),
      nowIso()
    );
    return db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
  }

  app.get("/health", async () => ({
    ok: true,
    time: nowIso(),
    providers: appConfig.providerStatus || {},
  }));

  app.get("/jobs/:id", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(request.params.id);
    if (!job) {
      sendError(reply, 404, "JOB_NOT_FOUND", "Job not found.");
      return;
    }
    const trackVersion = db
      .prepare("SELECT * FROM track_versions WHERE id = ?")
      .get(job.track_version_id);
    if (!trackVersion) {
      sendError(reply, 404, "TRACK_VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
    const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(trackVersion.track_id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 403, "FORBIDDEN", "Job does not belong to this user.");
      return;
    }
    // Job processing is handled by the background job runner (src/workflows/runner.js)
    // which polls for queued/running jobs and advances them through pipeline steps
    reply.send(job);
  });

  app.get("/preview/:trackVersionId.aac", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const trackVersion = db
      .prepare("SELECT * FROM track_versions WHERE id = ?")
      .get(request.params.trackVersionId);
    if (!trackVersion) {
      sendError(reply, 404, "TRACK_VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
    const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(trackVersion.track_id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 403, "FORBIDDEN", "Track does not belong to this user.");
      return;
    }
    const versionDir = getVersionDir(track, trackVersion);
    const filePath = path.join(versionDir, "preview.aac");
    sendAudioFile(request, reply, filePath);
  });

  app.get("/full/:trackVersionId.aac", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const trackVersion = db
      .prepare("SELECT * FROM track_versions WHERE id = ?")
      .get(request.params.trackVersionId);
    if (!trackVersion) {
      sendError(reply, 404, "TRACK_VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
    const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(trackVersion.track_id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 403, "FORBIDDEN", "Track does not belong to this user.");
      return;
    }
    const versionDir = getVersionDir(track, trackVersion);
    const filePath = path.join(versionDir, "full.aac");
    sendAudioFile(request, reply, filePath);
  });

  app.get("/guide/:trackVersionId", async (request, reply) => {
    const token = request.query.token;
    if (!token) {
      sendError(reply, 403, "FORBIDDEN", "Missing guide token.");
      return;
    }
    const trackVersion = db
      .prepare("SELECT * FROM track_versions WHERE id = ?")
      .get(request.params.trackVersionId);
    if (!trackVersion || trackVersion.guide_access_token !== token) {
      sendError(reply, 403, "FORBIDDEN", "Invalid guide token.");
      return;
    }
    // Guide tokens expire 24 hours after track version creation (security)
    const GUIDE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
    const createdAt = new Date(trackVersion.created_at).getTime();
    if (Date.now() - createdAt > GUIDE_TOKEN_TTL_MS) {
      sendError(reply, 410, "TOKEN_EXPIRED", "Guide vocal token has expired.");
      return;
    }
    const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(trackVersion.track_id);
    if (!track || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const versionDir = getVersionDir(track, trackVersion);
    const kind = request.query.kind === "full" ? "full" : "preview";
    const candidates =
      kind === "full"
        ? ["guide_vocal_full.mp3", "guide_vocal_full.wav"]
        : ["guide_vocal.mp3", "guide_vocal.wav"];
    const fileName = candidates.find((name) =>
      fs.existsSync(path.join(versionDir, name))
    );
    if (!fileName) {
      sendError(reply, 404, "AUDIO_NOT_FOUND", "Guide vocal not found.");
      return;
    }
    const filePath = path.join(versionDir, fileName);
    const contentType = fileName.endsWith(".mp3") ? "audio/mpeg" : "audio/wav";
    sendMediaFile(request, reply, filePath, contentType);
  });

  app.get("/enrollment/:sessionId/clean.wav", async (request, reply) => {
    const token = request.query.token;
    if (!token) {
      sendError(reply, 403, "FORBIDDEN", "Missing enrollment token.");
      return;
    }
    const session = db
      .prepare("SELECT * FROM enrollment_sessions WHERE id = ?")
      .get(request.params.sessionId);
    if (!session || session.access_token !== token) {
      sendError(reply, 403, "FORBIDDEN", "Invalid enrollment token.");
      return;
    }
    const filePath = path.join(
      appConfig.STORAGE_DIR,
      "enrollment",
      "clean",
      session.user_id,
      session.id,
      "clean.wav"
    );
    sendMediaFile(request, reply, filePath, "audio/wav");
  });

  app.post("/voice/enrollment/start", { schema: schemas.enrollmentStart }, async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const limit = consumeRateLimit(userId, "enrollment_start", 3, 24 * 60 * 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Enrollment rate limit reached.", {
        retry_at: limit.reset_at,
      });
      return;
    }
    const { consent_accepted, consent_version } = request.body || {};
    if (!consent_accepted) {
      sendError(reply, 400, "CONSENT_REQUIRED", "Consent must be accepted.");
      return;
    }
    const sessionId = newUuid();
    const promptSetId = `ps_${newUuid()}`;
    const prompts = [
      {
        id: "p1",
        type: "spoken",
        text: "The quick brown fox jumps over the lazy dog.",
        duration_hint_sec: 5,
      },
      {
        id: "p2",
        type: "sung",
        text: "La la la",
        pitch_hint: "C4",
        duration_hint_sec: 8,
      },
    ];
    const uploadUrls = prompts.map((prompt) => ({
      chunk_id: `c_${prompt.id}`,
      url: `https://s3.example.com/upload/${sessionId}/${prompt.id}`,
      expires_at: nowIso(),
    }));
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    db.prepare(
      "INSERT INTO enrollment_sessions (id, user_id, status, prompt_set_id, prompts_json, chunk_count, quality_metrics, failure_reason, started_at, completed_at, expires_at, consent_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      sessionId,
      userId,
      "recording",
      promptSetId,
      toJson(prompts),
      0,
      toJson({}),
      null,
      nowIso(),
      null,
      expiresAt,
      consent_version || "1.0" // Default consent version if not provided
    );

    addAuditEntry({
      userId,
      action: "enrollment_started",
      resourceType: "enrollment_session",
      resourceId: sessionId,
      metadata: { consent_version },
    });

    reply.send({
      session_id: sessionId,
      prompt_set_id: promptSetId,
      prompts,
      upload_urls: uploadUrls,
      recording_settings: {
        sample_rate: 44100,
        channels: 1,
        format: "wav",
        max_chunk_duration_sec: 20,
      },
      session_expires_at: expiresAt,
    });
  });

  app.post("/voice/enrollment/chunk_uploaded", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const { session_id, chunk_id, duration_sec, client_checksum } =
      request.body || {};
    const session = db
      .prepare("SELECT * FROM enrollment_sessions WHERE id = ?")
      .get(session_id);
    if (!session || session.user_id !== userId) {
      sendError(reply, 404, "SESSION_NOT_FOUND", "Enrollment session not found.");
      return;
    }
    if (new Date(session.expires_at) < new Date()) {
      db.prepare("UPDATE enrollment_sessions SET status = ? WHERE id = ?").run(
        "expired",
        session_id
      );
      sendError(reply, 410, "SESSION_EXPIRED", "Enrollment session expired.");
      return;
    }
    const metrics = parseJson(session.quality_metrics, {});
    const durationOk = typeof duration_sec === "number" && duration_sec >= 2 && duration_sec <= 25;
    if (!durationOk) {
      metrics[chunk_id] = {
        accepted: false,
        reason: "DURATION_OUT_OF_RANGE",
        duration_sec,
      };
      db.prepare("UPDATE enrollment_sessions SET quality_metrics = ? WHERE id = ?").run(
        toJson(metrics),
        session_id
      );
      sendError(reply, 400, "QC_FAILED", "Audio chunk failed QC.", {
        reason: "DURATION_OUT_OF_RANGE",
        re_record: true,
      });
      return;
    }
    metrics[chunk_id] = {
      accepted: true,
      duration_sec,
      client_checksum,
    };
    db.prepare(
      "UPDATE enrollment_sessions SET chunk_count = chunk_count + 1, status = ?, quality_metrics = ? WHERE id = ?"
    ).run("processing", toJson(metrics), session_id);
    reply.send({
      status: "accepted",
      qc_job_id: newUuid(),
      next_upload_url: null,
    });
  });

  // Debug endpoint for uploading audio chunks via browser
  app.post("/debug/upload-chunk", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }

    let data;
    try {
      data = await request.file();
    } catch (err) {
      sendError(reply, 400, "NO_FILE", "No file uploaded or invalid multipart request.");
      return;
    }

    if (!data) {
      sendError(reply, 400, "NO_FILE", "No file uploaded.");
      return;
    }

    // Extract form fields - @fastify/multipart stores fields with .value property
    const sessionIdField = data.fields.session_id;
    const chunkIdField = data.fields.chunk_id;

    // Debug: log field values (avoid circular refs by extracting .value)
    console.error("DEBUG upload-chunk:", {
      hasSessionIdField: !!sessionIdField,
      hasChunkIdField: !!chunkIdField,
      sessionIdValue: sessionIdField?.value,
      chunkIdValue: chunkIdField?.value,
      fieldKeys: Object.keys(data.fields || {}),
    });

    // Handle both single value and array cases
    const sessionId = Array.isArray(sessionIdField)
      ? sessionIdField[0]?.value
      : sessionIdField?.value;
    const chunkId = Array.isArray(chunkIdField)
      ? chunkIdField[0]?.value
      : chunkIdField?.value;

    if (!sessionId || !chunkId) {
      sendError(reply, 400, "MISSING_FIELDS", "session_id and chunk_id are required.");
      return;
    }

    // Verify session exists and belongs to user
    const session = db
      .prepare("SELECT * FROM enrollment_sessions WHERE id = ?")
      .get(sessionId);

    if (!session || session.user_id !== userId) {
      sendError(reply, 404, "SESSION_NOT_FOUND", "Enrollment session not found.");
      return;
    }

    // Save file to storage
    const chunkDir = path.join(
      appConfig.STORAGE_DIR,
      "enrollment",
      "raw",
      userId,
      sessionId
    );
    ensureDir(chunkDir);
    const chunkPath = path.join(chunkDir, `${chunkId}.wav`);

    // Read file stream into buffer
    const chunks = [];
    for await (const chunk of data.file) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    fs.writeFileSync(chunkPath, buffer);

    // Calculate duration from WAV header
    let durationSec = 0;
    if (buffer.length > 44) {
      const dataSize = buffer.readUInt32LE(40);
      const sampleRate = buffer.readUInt32LE(24);
      if (sampleRate > 0) {
        durationSec = dataSize / 2 / sampleRate; // 16-bit mono
      }
    }

    // Update session metrics
    const metrics = parseJson(session.quality_metrics, {});
    metrics[chunkId] = { accepted: true, duration_sec: durationSec };
    db.prepare(
      "UPDATE enrollment_sessions SET chunk_count = chunk_count + 1, quality_metrics = ? WHERE id = ?"
    ).run(toJson(metrics), sessionId);

    reply.send({
      status: "accepted",
      chunk_id: chunkId,
      duration_sec: durationSec,
    });
  });

  app.post("/voice/enrollment/complete", { schema: schemas.enrollmentComplete }, async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const { session_id } = request.body || {};
    const session = db
      .prepare("SELECT * FROM enrollment_sessions WHERE id = ?")
      .get(session_id);
    if (!session || session.user_id !== userId) {
      sendError(reply, 404, "SESSION_NOT_FOUND", "Enrollment session not found.");
      return;
    }
    if (new Date(session.expires_at) < new Date()) {
      db.prepare("UPDATE enrollment_sessions SET status = ? WHERE id = ?").run(
        "expired",
        session_id
      );
      sendError(reply, 410, "SESSION_EXPIRED", "Enrollment session expired.");
      return;
    }

    // Run QC validation on enrollment audio chunks
    const qcResult = await validateEnrollmentAudio({
      userId,
      sessionId: session_id,
      storageDir: appConfig.STORAGE_DIR,
    });

    if (!qcResult.passed) {
      db.prepare(
        "UPDATE enrollment_sessions SET status = ?, completed_at = ? WHERE id = ?"
      ).run("failed_quality", nowIso(), session_id);

      const errorCode = qcResult.errors[0] ? qcResult.errors[0].split(":")[0] : "E100_QC_FAILED";
      sendError(reply, 422, errorCode, "Audio quality check failed.", {
        errors: qcResult.errors,
        metrics: qcResult.metrics,
      });
      return;
    }

    const profileId = newUuid();
    const qualityScore = Math.min(100, Math.max(0, qcResult.metrics.snr_db));
    const embeddingRef = `voice_profiles/${userId}/${profileId}/embedding.bin`;
    const shouldEmbed =
      appConfig.LIVE_PROVIDERS &&
      Boolean(appConfig.REPLICATE_API_TOKEN) &&
      Boolean(appConfig.REPLICATE_EMBEDDING_MODEL_VERSION);

    if (shouldEmbed) {
      const chunkDir = path.join(appConfig.STORAGE_DIR, "enrollment", "raw", userId, session_id);
      const chunkFiles = fs
        .readdirSync(chunkDir)
        .filter((file) => file.endsWith(".wav"))
        .sort()
        .map((file) => path.join(chunkDir, file));
      const cleanDir = path.join(
        appConfig.STORAGE_DIR,
        "enrollment",
        "clean",
        userId,
        session_id
      );
      const cleanPath = path.join(cleanDir, "clean.wav");
      try {
        concatWavFiles(chunkFiles, cleanPath);
        const accessToken = crypto.randomBytes(16).toString("hex");
        db.prepare("UPDATE enrollment_sessions SET access_token = ? WHERE id = ?").run(
          accessToken,
          session_id
        );
        const audioUrl = `${appConfig.STREAM_BASE_URL}/enrollment/${session_id}/clean.wav?token=${accessToken}`;
        const embedding = await extractEmbedding({
          baseUrl: appConfig.REPLICATE_BASE_URL,
          token: appConfig.REPLICATE_API_TOKEN,
          modelVersion: appConfig.REPLICATE_EMBEDDING_MODEL_VERSION,
          audioUrl,
          timeoutMs: appConfig.PROVIDER_TIMEOUT_MS,
        });
        const embeddingPath = path.join(appConfig.STORAGE_DIR, embeddingRef);
        await downloadToFile(
          embedding.embedding_url,
          embeddingPath,
          appConfig.PROVIDER_TIMEOUT_MS
        );
      } catch (err) {
        db.prepare(
          "UPDATE enrollment_sessions SET status = ?, completed_at = ? WHERE id = ?"
        ).run("failed_verification", nowIso(), session_id);
        sendError(reply, 502, "E106_EMBEDDING_FAILED", "Voice embedding failed.", {
          reason: err.message || String(err),
        });
        return;
      }
    }

    // Transaction ensures atomic profile creation: all or nothing
    db.transaction(() => {
      db.prepare(
        "UPDATE enrollment_sessions SET status = ?, completed_at = ? WHERE id = ?"
      ).run("completed", nowIso(), session_id);

      db.prepare(
        "UPDATE voice_profiles SET status = ?, deleted_at = ? WHERE user_id = ? AND status != 'deleted'"
      ).run("deleted", nowIso(), userId);

      db.prepare(
        "INSERT INTO voice_profiles (id, user_id, status, embedding_ref, quality_score, model_version, consent_version, consent_at, last_verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        profileId,
        userId,
        "active",
        embeddingRef,
        qualityScore,
        shouldEmbed ? appConfig.REPLICATE_EMBEDDING_MODEL_VERSION : "embed_stub",
        session.consent_version,
        session.started_at,
        nowIso(),
        nowIso()
      );

      addAuditEntry({
        userId,
        action: "enrollment_completed",
        resourceType: "voice_profile",
        resourceId: profileId,
        metadata: { quality_score: qualityScore, qc_metrics: qcResult.metrics },
      });
    });

    reply.code(202).send({
      status: "processing",
      job_id: newUuid(),
      voice_profile_id: profileId,
      quality_score: qualityScore,
      estimated_completion_sec: 30,
    });
  });

  app.get("/voice/profile", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const profile = db
      .prepare(
        "SELECT * FROM voice_profiles WHERE user_id = ? AND status != 'deleted' ORDER BY created_at DESC LIMIT 1"
      )
      .get(userId);
    if (!profile) {
      sendError(reply, 404, "NO_VOICE_PROFILE", "Voice profile not found.");
      return;
    }
    reply.send({
      profile_id: profile.id,
      status: profile.status,
      quality_score: profile.quality_score,
      created_at: profile.created_at,
      last_verified_at: profile.last_verified_at,
      model_version: profile.model_version,
      requires_reverification: false,
    });
  });

  app.post("/voice/reverify", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const profile = db
      .prepare("SELECT id FROM voice_profiles WHERE user_id = ? AND status = 'active'")
      .get(userId);
    if (!profile) {
      sendError(reply, 404, "NO_VOICE_PROFILE", "Voice profile not found.");
      return;
    }
    const challengeId = newUuid();
    reply.send({
      challenge_id: challengeId,
      challenge_type: "random_phrase",
      prompt: { text: "Seven blue elephants walk quietly.", duration_hint_sec: 5 },
      upload_url: `https://s3.example.com/upload/reverify/${challengeId}`,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
  });

  app.delete("/voice/profile", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const profile = db
      .prepare("SELECT * FROM voice_profiles WHERE user_id = ? AND status != 'deleted'")
      .get(userId);
    if (!profile) {
      sendError(reply, 404, "NO_VOICE_PROFILE", "Voice profile not found.");
      return;
    }
    db.prepare(
      "UPDATE voice_profiles SET status = ?, embedding_ref = ?, deleted_at = ? WHERE id = ?"
    ).run("deleted", null, nowIso(), profile.id);
    addAuditEntry({
      userId,
      action: "voice_profile_deleted",
      resourceType: "voice_profile",
      resourceId: profile.id,
    });
    reply.send({ deleted: true, deletion_job_id: newUuid() });
  });

  app.post("/tracks", { schema: schemas.createTrack }, async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const limit = consumeRateLimit(userId, "track_create", 20, 60 * 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Track creation rate limit reached.", {
        retry_at: limit.reset_at,
      });
      return;
    }
    const body = request.body || {};
    const riskLevel = getUserRiskLevel(userId);
    if (riskLevel === "blocked") {
      sendError(reply, 403, "ACCOUNT_BLOCKED", "Account is blocked.");
      return;
    }
    const moderation = moderationCheck(body);
    if (!moderation.allowed) {
      setRiskLevel(userId, "high");
      addAuditEntry({
        userId,
        action: "moderation_blocked",
        resourceType: "track",
        resourceId: null,
        metadata: { reason: moderation.reason },
      });
      sendError(reply, 403, "MODERATION_BLOCKED", "Prompt blocked by moderation.", {
        reason: moderation.reason,
      });
      return;
    }
    if (body.voice_mode === "user_voice") {
      if (riskLevel === "high") {
        sendError(reply, 403, "VOICE_MODE_DISABLED", "Voice mode disabled for high-risk accounts.");
        return;
      }
      const profile = db
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
    const storyContextJson = Object.keys(storyContext).length > 0 ? toJson(storyContext) : null;

    db.prepare(
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
      body.voice_mode || config.DEFAULT_VOICE_MODE,
      body.message || null,
      storyContextJson,
      null,
      0,
      now,
      now
    );
    addAuditEntry({
      userId,
      action: "track_created",
      resourceType: "track",
      resourceId: trackId,
    });
    reply.code(201).send({
      track_id: trackId,
      status: "draft",
      voice_mode: body.voice_mode || config.DEFAULT_VOICE_MODE,
      created_at: now,
    });
  });

  app.get("/tracks", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const tracks = db
      .prepare(
        "SELECT * FROM tracks WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC"
      )
      .all(userId);
    reply.send({ tracks });
  });

  app.get("/tracks/:id", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    reply.send({ track, versions: getTrackVersions(track.id) });
  });

  app.delete("/tracks/:id", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const deletedAt = nowIso();
    db.prepare(
      "UPDATE tracks SET status = ?, deleted_at = ?, deleted_reason = ?, updated_at = ? WHERE id = ?"
    ).run("deleted", deletedAt, "user_request", deletedAt, track.id);
    db.prepare("UPDATE track_versions SET status = ? WHERE track_id = ?").run(
      "deleted",
      track.id
    );
    if (track.share_token_id) {
      db.prepare("UPDATE share_tokens SET status = ? WHERE id = ?").run(
        "revoked",
        track.share_token_id
      );
    }
    addAuditEntry({
      userId,
      action: "track_deleted",
      resourceType: "track",
      resourceId: track.id,
    });
    reply.send({ deleted: true });
  });

  app.post("/tracks/:id/versions", { schema: schemas.createVersion }, async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const body = request.body || {};
    const paramsHash = computeParamsHash(body.params || {});
    const renderType = body.render_type || "preview";
    const existing = db
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
    const versionNum = db.transaction(() => {
      const num = incrementTrackVersion(track.id);
      db.prepare(
        "INSERT INTO track_versions (id, track_id, version_num, parent_version_id, status, render_type, params_json, params_hash, cost_estimate_json, actual_cost_json, storage_ref, created_at, completed_at, preview_url, full_url, billing_hold_id, lyrics_status, lyrics_updated_at, lyrics_approved_at, guide_access_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
        null
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
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const versionNum = Number(request.params.version);
    const trackVersion = findTrackVersion(track.id, versionNum);
    if (!trackVersion) {
      sendError(reply, 404, "VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
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
    const limit = consumeRateLimit(userId, "render_preview", 20, 24 * 60 * 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Preview render limit reached.", {
        retry_at: limit.reset_at,
      });
      return;
    }
    const entitlement = consumePreviewEntitlement(userId);
    if (!entitlement.allowed) {
      sendError(reply, 402, "DAILY_LIMIT_REACHED", "Daily preview limit reached.", {
        retry_at: entitlement.reset_at,
      });
      return;
    }
    // Atomic check-and-update to prevent TOCTOU race condition
    // Two concurrent requests can't both pass this check
    const updateResult = db.prepare(
      "UPDATE track_versions SET status = 'processing' WHERE id = ? AND status != 'processing'"
    ).run(trackVersion.id);

    if (updateResult.changes === 0) {
      sendError(reply, 409, "ALREADY_RENDERING", "Preview render already in progress.");
      return;
    }
    db.prepare("UPDATE tracks SET status = ?, updated_at = ? WHERE id = ?").run(
      "rendering",
      nowIso(),
      track.id
    );
    addAuditEntry({
      userId,
      action: "render_requested",
      resourceType: "track_version",
      resourceId: trackVersion.id,
      metadata: { render_type: "preview" },
    });
    const job = createJob({ trackVersionId: trackVersion.id, workflowType: "preview_render" });
    reply.code(202).send({
      job_id: job.id,
      estimated_completion_sec: 90,
      poll_url: `/jobs/${job.id}`,
    });
  });

  app.post("/tracks/:id/versions/:version/render_full", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    if (appConfig.PREVIEW_ONLY) {
      sendError(reply, 403, "PREVIEW_ONLY_MODE", "Full renders are disabled.");
      return;
    }
    const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const body = request.body || {};
    if (!body.confirm_credit_spend) {
      sendError(reply, 400, "CONFIRM_REQUIRED", "confirm_credit_spend must be true.");
      return;
    }
    const versionNum = Number(request.params.version);
    const trackVersion = findTrackVersion(track.id, versionNum);
    if (!trackVersion) {
      sendError(reply, 404, "VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
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
    const credit = consumeCredit(userId);
    if (!credit.allowed) {
      sendError(reply, 402, "INSUFFICIENT_CREDITS", "Insufficient credits for full render.");
      return;
    }
    // Atomic check-and-update to prevent TOCTOU race condition
    const holdId = newUuid();
    const updateResult = db.prepare(
      "UPDATE track_versions SET status = 'processing', billing_hold_id = ? WHERE id = ? AND status NOT IN ('processing', 'full_ready')"
    ).run(holdId, trackVersion.id);

    if (updateResult.changes === 0) {
      // Refund the credit we consumed since we can't proceed
      db.prepare(
        "UPDATE entitlements SET credits_balance = credits_balance + 1, updated_at = ? WHERE user_id = ?"
      ).run(nowIso(), userId);
      sendError(reply, 409, "ALREADY_RENDERING", "Full render already in progress or complete.");
      return;
    }

    db.prepare(
      "INSERT INTO billing_holds (id, user_id, track_version_id, credits_held, status, created_at, expires_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      holdId,
      userId,
      trackVersion.id,
      1,
      "held",
      nowIso(),
      new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      null
    );
    db.prepare("UPDATE tracks SET status = ?, updated_at = ? WHERE id = ?").run(
      "rendering",
      nowIso(),
      track.id
    );
    addAuditEntry({
      userId,
      action: "render_requested",
      resourceType: "track_version",
      resourceId: trackVersion.id,
      metadata: { render_type: "full" },
    });
    const job = createJob({ trackVersionId: trackVersion.id, workflowType: "full_render" });
    reply.code(202).send({
      job_id: job.id,
      billing_hold_id: holdId,
      credits_reserved: 1,
      estimated_completion_sec: 180,
    });
  });

  app.post("/tracks/:id/versions/:version/reroll", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const versionNum = Number(request.params.version);
    const baseVersion = findTrackVersion(track.id, versionNum);
    if (!baseVersion) {
      sendError(reply, 404, "VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
    const body = request.body || {};
    const paramsHash = computeParamsHash({ base_version: baseVersion.id, ...body });
    // Transaction ensures version increment + insert are atomic
    const newVersionId = newUuid();
    const newVersionNum = db.transaction(() => {
      const num = incrementTrackVersion(track.id);
      db.prepare(
        "INSERT INTO track_versions (id, track_id, version_num, parent_version_id, status, render_type, params_json, params_hash, cost_estimate_json, actual_cost_json, storage_ref, created_at, completed_at, preview_url, full_url, billing_hold_id, lyrics_status, lyrics_updated_at, lyrics_approved_at, guide_access_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
        null
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
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const versionNum = Number(request.params.version);
    const trackVersion = findTrackVersion(track.id, versionNum);
    if (!trackVersion) {
      sendError(reply, 404, "VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
    reply.send({ lyrics: parseJson(trackVersion.lyrics_json, null) });
  });

  app.put("/tracks/:id/versions/:version/lyrics", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const versionNum = Number(request.params.version);
    const trackVersion = findTrackVersion(track.id, versionNum);
    if (!trackVersion) {
      sendError(reply, 404, "VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
    const body = request.body || {};
    if (!body.lyrics || typeof body.lyrics !== "object") {
      sendError(reply, 400, "INVALID_LYRICS", "lyrics must be an object.");
      return;
    }
    db.prepare(
      "UPDATE track_versions SET lyrics_json = ?, lyrics_status = ?, lyrics_updated_at = ? WHERE id = ?"
    ).run(toJson(body.lyrics), "draft", nowIso(), trackVersion.id);
    reply.send({ updated: true });
  });

  app.post("/tracks/:id/versions/:version/lyrics/generate", { schema: schemas.generateLyrics }, async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    // Rate limit: 30 lyrics generations per minute to prevent API abuse
    const limit = consumeRateLimit(userId, "lyrics_generate", 30, 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Lyrics generation rate limit reached.", {
        retry_after: limit.reset_at,
      });
      return;
    }
    const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const versionNum = Number(request.params.version);
    const trackVersion = findTrackVersion(track.id, versionNum);
    if (!trackVersion) {
      sendError(reply, 404, "VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
    // Parse story context from track and merge with base params
    const storyContext = parseJson(track.story_context_json, {}, "story_context");
    const result = await generateLyrics({
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
    });
    db.prepare(
      "UPDATE track_versions SET lyrics_json = ?, lyrics_status = ?, lyrics_updated_at = ? WHERE id = ?"
    ).run(toJson(result.lyrics), result.lyrics_status, nowIso(), trackVersion.id);
    reply.send({ lyrics: result.lyrics, lyrics_status: result.lyrics_status });
  });

  app.post("/tracks/:id/versions/:version/lyrics/approve", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const versionNum = Number(request.params.version);
    const trackVersion = findTrackVersion(track.id, versionNum);
    if (!trackVersion) {
      sendError(reply, 404, "VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
    if (!trackVersion.lyrics_json) {
      sendError(reply, 409, "LYRICS_MISSING", "Generate or upload lyrics before approval.");
      return;
    }
    const moderation = moderationCheck({ lyrics: trackVersion.lyrics_json });
    if (!moderation.allowed) {
      db.prepare(
        "UPDATE track_versions SET moderation_status = ?, moderation_reason = ? WHERE id = ?"
      ).run("blocked", moderation.reason, trackVersion.id);
      sendError(reply, 403, "MODERATION_BLOCKED", "Lyrics blocked by moderation.", {
        reason: moderation.reason,
      });
      return;
    }
    db.prepare(
      "UPDATE track_versions SET lyrics_status = ?, lyrics_approved_at = ? WHERE id = ?"
    ).run("approved", nowIso(), trackVersion.id);
    reply.send({ approved: true });
  });

  app.post("/tracks/:id/share", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    if (track.share_token_id) {
      sendError(reply, 409, "SHARE_EXISTS", "Track already has a share token.");
      return;
    }
    const body = request.body || {};
    const versionNum = body.version_num || track.latest_version;
    const trackVersion = findTrackVersion(track.id, versionNum);
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

    const streamKeyId = newUuid();
    const streamKey = crypto.randomBytes(16).toString("base64");
    // Generate 6-digit PIN for claim verification (prevents unauthorized claim)
    const claimPin = String(Math.floor(100000 + Math.random() * 900000));
    db.prepare(
      "INSERT INTO share_tokens (id, track_id, track_version_id, creator_id, status, bound_device_id, bound_device_platform, bound_app_version, bound_at, web_stream_allowed, app_save_allowed, expires_at, created_at, last_accessed_at, access_count, stream_key_id, stream_key, claim_pin, claim_attempts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
      0
    );
    db.prepare("UPDATE tracks SET share_token_id = ?, updated_at = ? WHERE id = ?").run(
      shareId,
      nowIso(),
      track.id
    );

    addAuditEntry({
      userId,
      action: "share_created",
      resourceType: "share_token",
      resourceId: shareId,
    });

    reply.send({
      share_id: shareId,
      share_url: `https://app.porizo.local/s/${shareId}`,
      qr_code_url: `https://cdn.porizo.local/qr/${shareId}.png`,
      expires_at: expiresAt,
      claim_pin: claimPin, // Creator must share this PIN with recipient out-of-band
    });
  });

  app.get("/share/:shareId", async (request, reply) => {
    const share = db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(request.params.shareId);
    if (!share || share.status === "revoked") {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Share token not found.");
      return;
    }
    if (new Date(share.expires_at) < new Date()) {
      db.prepare("UPDATE share_tokens SET status = ? WHERE id = ?").run("expired", share.id);
      sendError(reply, 410, "SHARE_EXPIRED", "Share token expired.");
      return;
    }
    const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(share.track_id);
    const trackVersion = db.prepare("SELECT * FROM track_versions WHERE id = ?").get(share.track_version_id);
    if (!track || !trackVersion) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    db.prepare(
      "UPDATE share_tokens SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?"
    ).run(nowIso(), share.id);
    addShareAccessLog({
      shareTokenId: share.id,
      eventType: "link_opened",
      metadata: { user_agent: request.headers["user-agent"] || null },
    });

    if (share.status === "claimed") {
      reply.send({
        status: "claimed",
        app_required: true,
        app_download_url: "https://app.porizo.local/download",
      });
      return;
    }

    reply.send({
      status: "unbound",
      track_preview: {
        title: track.title,
        duration_sec: track.duration_target || 60,
        cover_image_url: null,
      },
      web_stream_url: share.web_stream_allowed
        ? trackVersion.full_url || trackVersion.preview_url || null
        : null,
      app_download_url: "https://app.porizo.local/download",
    });
  });

  app.post("/share/:shareId/claim", { schema: schemas.shareClaim }, async (request, reply) => {
    const share = db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(request.params.shareId);
    if (!share || share.status === "revoked") {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Share token not found.");
      return;
    }
    if (new Date(share.expires_at) < new Date()) {
      db.prepare("UPDATE share_tokens SET status = ? WHERE id = ?").run("expired", share.id);
      sendError(reply, 410, "SHARE_EXPIRED", "Share token expired.");
      return;
    }
    const body = request.body || {};
    const { device_id, platform, app_version, pin } = body;
    if (!device_id || !platform) {
      addShareAccessLog({
        shareTokenId: share.id,
        eventType: "claim_failed",
        metadata: { reason: "missing_device", platform },
      });
      sendError(reply, 400, "INVALID_REQUEST", "device_id and platform are required.");
      return;
    }

    // PIN verification (prevents unauthorized claims)
    if (share.claim_pin) {
      // Check for too many failed attempts (brute force protection)
      if (share.claim_attempts >= 5) {
        addShareAccessLog({
          shareTokenId: share.id,
          eventType: "claim_failed",
          metadata: { reason: "too_many_attempts", platform },
        });
        sendError(reply, 429, "TOO_MANY_ATTEMPTS", "Too many failed PIN attempts. Contact the sender.");
        return;
      }

      if (!pin || pin !== share.claim_pin) {
        db.prepare("UPDATE share_tokens SET claim_attempts = claim_attempts + 1 WHERE id = ?").run(share.id);
        addShareAccessLog({
          shareTokenId: share.id,
          eventType: "claim_failed",
          metadata: { reason: "invalid_pin", platform },
        });
        sendError(reply, 401, "INVALID_PIN", "Invalid PIN. Please check with the sender.");
        return;
      }
    }

    if (share.bound_device_id && share.bound_device_id !== device_id) {
      addShareAccessLog({
        shareTokenId: share.id,
        eventType: "claim_failed",
        metadata: { reason: "token_already_bound", platform },
      });
      sendError(reply, 409, "TOKEN_ALREADY_BOUND", "Share token already bound to another device.");
      return;
    }
    db.prepare(
      "UPDATE share_tokens SET status = ?, bound_device_id = ?, bound_device_platform = ?, bound_app_version = ?, bound_at = ?, web_stream_allowed = ?, claim_attempts = 0 WHERE id = ?"
    ).run("claimed", device_id, platform, app_version || null, nowIso(), 0, share.id);
    addShareAccessLog({
      shareTokenId: share.id,
      eventType: "claim_success",
      metadata: { platform, app_version },
    });
    reply.send({
      status: "claimed",
      app_save_allowed: true,
      expires_at: share.expires_at,
    });
  });

  app.get("/share/:shareId/stream", async (request, reply) => {
    const share = db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(request.params.shareId);
    if (!share || share.status === "revoked") {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Share token not found.");
      return;
    }
    if (new Date(share.expires_at) < new Date()) {
      db.prepare("UPDATE share_tokens SET status = ? WHERE id = ?").run("expired", share.id);
      sendError(reply, 410, "SHARE_EXPIRED", "Share token expired.");
      return;
    }
    const deviceId = request.headers["x-device-id"];
    const platform = request.headers["x-platform"];
    if (!deviceId || !platform) {
      sendError(reply, 400, "MISSING_DEVICE_HEADERS", "x-device-id and x-platform headers are required.");
      return;
    }
    if (!share.bound_device_id) {
      addShareAccessLog({
        shareTokenId: share.id,
        eventType: "access_denied",
        metadata: { reason: "not_claimed" },
      });
      sendError(reply, 403, "NOT_CLAIMED", "Share token has not been claimed.");
      return;
    }
    if (share.bound_device_id !== deviceId || share.bound_device_platform !== platform) {
      addShareAccessLog({
        shareTokenId: share.id,
        eventType: "access_denied",
        metadata: { reason: "device_mismatch" },
      });
      sendError(reply, 403, "TOKEN_ALREADY_BOUND", "Share token bound to another device.");
      return;
    }
    addShareAccessLog({
      shareTokenId: share.id,
      eventType: "stream_started",
      metadata: { platform },
    });
    const baseUrl = getBaseUrl(request);
    reply.send({
      stream_url: `${baseUrl}/share/${share.id}/playlist`,
      key_url: `${baseUrl}/share/${share.id}/key`,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
  });

  app.get("/share/:shareId/playlist", async (request, reply) => {
    const share = db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(request.params.shareId);
    if (!share || share.status === "revoked") {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Share token not found.");
      return;
    }
    if (new Date(share.expires_at) < new Date()) {
      db.prepare("UPDATE share_tokens SET status = ? WHERE id = ?").run("expired", share.id);
      sendError(reply, 410, "SHARE_EXPIRED", "Share token expired.");
      return;
    }
    const deviceId = request.headers["x-device-id"];
    const platform = request.headers["x-platform"];
    if (!deviceId || !platform) {
      sendError(reply, 400, "MISSING_DEVICE_HEADERS", "x-device-id and x-platform headers are required.");
      return;
    }
    if (!share.bound_device_id) {
      sendError(reply, 403, "NOT_CLAIMED", "Share token has not been claimed.");
      return;
    }
    if (share.bound_device_id !== deviceId || share.bound_device_platform !== platform) {
      sendError(reply, 403, "TOKEN_ALREADY_BOUND", "Share token bound to another device.");
      return;
    }
    const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(share.track_id);
    const trackVersion = db
      .prepare("SELECT * FROM track_versions WHERE id = ?")
      .get(share.track_version_id);
    if (!track || !trackVersion) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const hls = await ensureShareHls({ share, track, trackVersion });
    if (!hls) {
      sendError(reply, 409, "STREAM_NOT_READY", "HLS playlist not ready.");
      return;
    }
    const baseUrl = getBaseUrl(request);
    const keyUrl = `${baseUrl}/share/${share.id}/key`;
    const segmentBase = `${baseUrl}/share/${share.id}/segment`;
    const rawPlaylist = fs.readFileSync(hls.playlistPath, "utf8");
    const lines = rawPlaylist.split(/\r?\n/).map((line) => {
      if (!line) {
        return line;
      }
      if (line.startsWith("#EXT-X-KEY:")) {
        return line.replace(/URI="[^"]+"/, `URI="${keyUrl}"`);
      }
      if (line.startsWith("#")) {
        return line;
      }
      const fileName = path.basename(line);
      return `${segmentBase}/${fileName}`;
    });
    addShareAccessLog({
      shareTokenId: share.id,
      eventType: "playlist_served",
      metadata: { platform },
    });
    reply.type("application/vnd.apple.mpegurl").send(lines.join("\n"));
  });

  app.get("/share/:shareId/segment/:segment", async (request, reply) => {
    const share = db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(request.params.shareId);
    if (!share || share.status === "revoked") {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Share token not found.");
      return;
    }
    if (new Date(share.expires_at) < new Date()) {
      db.prepare("UPDATE share_tokens SET status = ? WHERE id = ?").run("expired", share.id);
      sendError(reply, 410, "SHARE_EXPIRED", "Share token expired.");
      return;
    }
    const deviceId = request.headers["x-device-id"];
    const platform = request.headers["x-platform"];
    if (!deviceId || !platform) {
      sendError(reply, 400, "MISSING_DEVICE_HEADERS", "x-device-id and x-platform headers are required.");
      return;
    }
    if (!share.bound_device_id) {
      sendError(reply, 403, "NOT_CLAIMED", "Share token has not been claimed.");
      return;
    }
    if (share.bound_device_id !== deviceId || share.bound_device_platform !== platform) {
      sendError(reply, 403, "TOKEN_ALREADY_BOUND", "Share token bound to another device.");
      return;
    }
    const segmentName = request.params.segment;
    if (
      !segmentName ||
      path.basename(segmentName) !== segmentName ||
      !/^segment\d+\.ts$/.test(segmentName)
    ) {
      sendError(reply, 400, "INVALID_SEGMENT", "Invalid segment name.");
      return;
    }
    const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(share.track_id);
    const trackVersion = db
      .prepare("SELECT * FROM track_versions WHERE id = ?")
      .get(share.track_version_id);
    if (!track || !trackVersion) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const hls = await ensureShareHls({ share, track, trackVersion });
    if (!hls) {
      sendError(reply, 409, "STREAM_NOT_READY", "HLS segments not ready.");
      return;
    }
    // Path containment verification (defense-in-depth against path traversal)
    const segmentPath = path.normalize(path.join(hls.hlsDir, segmentName));
    if (!segmentPath.startsWith(hls.hlsDir)) {
      console.error(`[Security] Path traversal attempt blocked: ${segmentName}`);
      sendError(reply, 400, "INVALID_SEGMENT", "Invalid segment path.");
      return;
    }
    if (!fs.existsSync(segmentPath)) {
      sendError(reply, 404, "SEGMENT_NOT_FOUND", "Segment not found.");
      return;
    }
    reply.type("video/MP2T").send(fs.readFileSync(segmentPath));
  });

  app.get("/share/:shareId/key", async (request, reply) => {
    const share = db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(request.params.shareId);
    if (!share || share.status === "revoked") {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Share token not found.");
      return;
    }
    if (new Date(share.expires_at) < new Date()) {
      db.prepare("UPDATE share_tokens SET status = ? WHERE id = ?").run("expired", share.id);
      sendError(reply, 410, "SHARE_EXPIRED", "Share token expired.");
      return;
    }
    const deviceId = request.headers["x-device-id"];
    const platform = request.headers["x-platform"];
    if (!deviceId || !platform) {
      sendError(reply, 400, "MISSING_DEVICE_HEADERS", "x-device-id and x-platform headers are required.");
      return;
    }
    if (!share.bound_device_id) {
      sendError(reply, 403, "NOT_CLAIMED", "Share token has not been claimed.");
      return;
    }
    if (share.bound_device_id !== deviceId || share.bound_device_platform !== platform) {
      sendError(reply, 403, "TOKEN_ALREADY_BOUND", "Share token bound to another device.");
      return;
    }
    const keyBuffer = share.stream_key ? Buffer.from(share.stream_key, "base64") : null;
    if (!keyBuffer || keyBuffer.length !== 16) {
      sendError(reply, 409, "STREAM_KEY_INVALID", "Stream key unavailable.");
      return;
    }
    reply
      .type("application/octet-stream")
      .header("Cache-Control", "no-store")
      .send(keyBuffer);
  });

  app.delete("/tracks/:id/share", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    if (!track.share_token_id) {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Share token not found.");
      return;
    }
    db.prepare("UPDATE share_tokens SET status = ? WHERE id = ?").run(
      "revoked",
      track.share_token_id
    );
    addShareAccessLog({
      shareTokenId: track.share_token_id,
      eventType: "revoked",
      metadata: { reason: "creator_revoked" },
    });
    addAuditEntry({
      userId,
      action: "share_revoked",
      resourceType: "share_token",
      resourceId: track.share_token_id,
    });
    reply.send({ revoked: true });
  });

  app.get("/tracks/:id/versions", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    reply.send({ versions: getTrackVersions(track.id) });
  });

  app.get("/entitlements", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const entitlements = db
      .prepare("SELECT * FROM entitlements WHERE user_id = ?")
      .get(userId);
    reply.send({ entitlements, risk_level: getUserRiskLevel(userId) });
  });

  return app;
}

async function start() {
  const db = await initDb({
    dbPath: config.DB_PATH,
    migrationsDir: path.join(process.cwd(), "migrations"),
  });
  ensureDir(config.STORAGE_DIR);
  // DEV_MODE disables all live providers (uses placeholders instead)
  const liveEnabled = config.LIVE_PROVIDERS && !config.DEV_MODE;
  // Determine which music provider to use
  const musicProvider = config.MUSIC_PROVIDER || "elevenlabs";
  const providerConfig = {
    elevenlabs: {
      // Use ElevenLabs when MUSIC_PROVIDER=elevenlabs (or unset)
      live: liveEnabled && musicProvider === "elevenlabs" && Boolean(config.ELEVENLABS_API_KEY),
      provider: "elevenlabs",
      apiKey: config.ELEVENLABS_API_KEY,
      baseUrl: config.ELEVENLABS_BASE_URL,
      endpoint: config.ELEVENLABS_MUSIC_ENDPOINT,
      voiceId: config.ELEVENLABS_VOICE_ID,
      ttsVoiceId: config.ELEVENLABS_TTS_VOICE_ID,
      timeoutMs: config.PROVIDER_TIMEOUT_MS,
    },
    suno: {
      // Use Suno when MUSIC_PROVIDER=suno
      live: liveEnabled && musicProvider === "suno" && Boolean(config.SUNO_API_KEY),
      provider: "suno",
      apiKey: config.SUNO_API_KEY,
      baseUrl: config.SUNO_BASE_URL,
      timeoutMs: config.PROVIDER_TIMEOUT_MS,
    },
    replicate: {
      live:
        liveEnabled &&
        Boolean(config.REPLICATE_API_TOKEN) &&
        Boolean(config.REPLICATE_MODEL_VERSION),
      token: config.REPLICATE_API_TOKEN,
      baseUrl: config.REPLICATE_BASE_URL,
      modelVersion: config.REPLICATE_MODEL_VERSION,
      timeoutMs: config.PROVIDER_TIMEOUT_MS,
    },
    // Hugging Face token for Seed-VC (personalized voice mode)
    hfToken: config.HF_TOKEN || null,
  };
  // Debug: Verify HF_TOKEN is loaded
  console.log(`[Server] HF_TOKEN configured: ${providerConfig.hfToken ? "YES (" + providerConfig.hfToken.substring(0, 10) + "...)" : "NO"}`);
  if (config.DEV_MODE) {
    console.log("[Server] DEV_MODE enabled - all providers disabled, using placeholders");
  }
  const providerStatus = {
    elevenlabs: providerConfig.elevenlabs.live,
    suno: providerConfig.suno.live,
    replicate: providerConfig.replicate.live,
    musicProvider: musicProvider,
  };
  const runner = startJobRunner({
    db,
    storageDir: config.STORAGE_DIR,
    streamBaseUrl: config.STREAM_BASE_URL,
    intervalMs: 1000,
    providerConfig,
    devMode: config.DEV_MODE,
  });
  const saveTimer = setInterval(() => db.save(), 2000);
  // Start file cleanup job for expired enrollment sessions
  const fileCleanupJob = startCleanupJob({
    db,
    storageDir: config.STORAGE_DIR,
    intervalMs: config.CLEANUP_INTERVAL_MS,
    retentionDays: 7,
  });
  const cleanupTimer = setInterval(() => {
    const now = nowIso();
    db.prepare(
      "UPDATE enrollment_sessions SET status = 'expired' WHERE status NOT IN ('completed','failed_quality','failed_verification') AND expires_at < ?"
    ).run(now);
    db.prepare(
      "UPDATE share_tokens SET status = 'expired' WHERE status NOT IN ('revoked','expired') AND expires_at < ?"
    ).run(now);
    const expiredHolds = db
      .prepare("SELECT * FROM billing_holds WHERE status = 'held' AND expires_at < ?")
      .all(now);
    for (const hold of expiredHolds) {
      db.prepare("UPDATE billing_holds SET status = ?, resolved_at = ? WHERE id = ?").run(
        "expired",
        now,
        hold.id
      );
      db.prepare(
        "UPDATE entitlements SET credits_balance = credits_balance + ?, updated_at = ? WHERE user_id = ?"
      ).run(hold.credits_held, now, hold.user_id);
      db.prepare("UPDATE track_versions SET status = ? WHERE id = ?").run(
        "failed",
        hold.track_version_id
      );
      db.prepare(
        "INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(
        newUuid(),
        hold.user_id,
        "billing_hold_expired",
        "billing_hold",
        hold.id,
        toJson({ track_version_id: hold.track_version_id }),
        now
      );
    }
  }, config.CLEANUP_INTERVAL_MS);
  const app = buildServer({ db, config: { ...config, providerStatus } });
  app.log.info({ providers: providerStatus }, "provider status");
  app.addHook("onClose", async () => {
    runner.stop();
    clearInterval(saveTimer);
    clearInterval(cleanupTimer);
    fileCleanupJob.stop();
    db.close();
  });
  try {
    await app.listen({ port: config.PORT, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

module.exports = {
  buildServer,
};
