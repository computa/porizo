const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const fastify = require("fastify");
const QRCode = require("qrcode");
const { initDb } = require("./db");
const config = require("./config");
const { moderationCheck, validateGeneratedLyrics } = require("./providers/moderation");
const { generateLyrics } = require("./providers/lyrics");
const { extractEmbedding } = require("./providers/replicate");
const { downloadToFile } = require("./providers/http");
const { concatWavFiles, parseWavBuffer } = require("./utils/audio");
const { createHLSPlaylist } = require("./utils/hls");
const { stableStringify } = require("./utils/stable-json");
const { newUuid, newShareId } = require("./utils/ids");
const { validateEnrollmentAudio } = require("./services/enrollment");
const { generateMemoryQuestions } = require("./services/memory-questions");
const { createStorageProvider, enrollmentChunkKey, enrollmentCleanKey } = require("./storage");
// extractEmbedding will be called asynchronously by a background job
const { startCleanupJob } = require("./jobs/cleanup");
const { startSubscriptionSyncJob } = require("./jobs/subscription-sync");
const { startJobRunner } = require("./workflows/runner");
// Billing services
const { createAppleReceiptValidator } = require("./services/apple-receipt-validator");
const { createAppleWebhookHandler } = require("./services/apple-webhook-handler");
const { createPlanConfigService } = require("./services/plan-config");
const { createSubscriptionManager } = require("./services/subscription-manager");
const { registerAuthRoutes } = require("./routes/auth");
const { registerStoryRoutes } = require("./routes/story");
const { createStoryRepository } = require("./database/story-repository");
const writer = require("./writer");

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

/**
 * Extract text content from lyrics object for moderation
 * Handles sections array format: { sections: [{ name, lines: [] }] }
 */
function extractLyricsText(lyrics) {
  if (!lyrics) return "";
  const parts = [];
  if (lyrics.title) parts.push(lyrics.title);
  if (lyrics.anchor_line) parts.push(lyrics.anchor_line);
  if (Array.isArray(lyrics.sections)) {
    for (const section of lyrics.sections) {
      if (Array.isArray(section.lines)) {
        parts.push(...section.lines);
      }
    }
  }
  return parts.join(" ");
}

function buildServer({ db, config: appConfig, storage, cdnSigner = null, billingServices = null }) {
  const app = fastify({
    logger: true,
    bodyLimit: 1048576, // 1MB max body size to prevent JSON DoS
  });
  const publicBaseUrl =
    appConfig.PUBLIC_BASE_URL ||
    appConfig.STREAM_BASE_URL ||
    config.PUBLIC_BASE_URL ||
    config.STREAM_BASE_URL;

  if (!storage) {
    throw new Error("Storage provider is required.");
  }
  const storageProvider = storage;

  // CDN signer for CloudFront signed URLs (optional)
  const cdnSignerInstance = cdnSigner;

  // Initialize billing services (use passed-in services or create new ones)
  const planConfigService = billingServices?.planConfigService || createPlanConfigService(db);
  const appleValidator = billingServices?.appleValidator || createAppleReceiptValidator({
    keyId: appConfig.APPLE_APP_STORE_KEY_ID,
    issuerId: appConfig.APPLE_APP_STORE_ISSUER_ID,
    privateKey: appConfig.APPLE_APP_STORE_PRIVATE_KEY,
    bundleId: appConfig.APPLE_BUNDLE_ID,
    environment: appConfig.APPLE_ENVIRONMENT || "production",
  });
  const subscriptionManager = billingServices?.subscriptionManager || createSubscriptionManager(db, {
    planConfigService,
    appleValidator,
  });

  const appleWebhookHandler = billingServices?.appleWebhookHandler || createAppleWebhookHandler(db, {
    subscriptionManager,
    appleValidator,
    planConfigService,
  });

  // Initialize story repository for persistent story sessions
  const storyRepository = createStoryRepository(db);
  writer.initWithRepository(storyRepository);

  // Register static file serving for debug page
  app.register(require("@fastify/static"), {
    root: path.join(process.cwd(), "public"),
    prefix: "/",
  });

  // Register web-player static files
  app.register(require("@fastify/static"), {
    root: path.join(process.cwd(), "web-player"),
    prefix: "/web-player/",
    decorateReply: false, // Avoid decorator conflict with first registration
  });

  // Register multipart for file uploads
  app.register(require("@fastify/multipart"), {
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  });

  app.addContentTypeParser(
    ["audio/wav", "application/octet-stream"],
    { parseAs: "buffer" },
    (request, body, done) => {
      done(null, body);
    }
  );

  // ============ Authentication Routes ============
  registerAuthRoutes(app, { db });

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
          // AI-generated follow-up question answers
          memory_answers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                question_id: { type: "string", maxLength: 20 },
                question: { type: "string", maxLength: 200 },
                answer: { type: "string", maxLength: 500 },
              },
              required: ["question_id", "question", "answer"],
            },
            maxItems: 5,
          },
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
          platform: { type: "string", enum: ["ios", "android"] },
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
    memoryQuestions: {
      body: {
        type: "object",
        required: ["memory"],
        properties: {
          memory: { type: "string", minLength: 5, maxLength: 500 },
          occasion: { type: "string", maxLength: 100 },
          recipient_name: { type: "string", maxLength: 100 },
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

  function normalizeBaseUrl(value) {
    if (!value) {
      return "";
    }
    return value.endsWith("/") ? value.slice(0, -1) : value;
  }

  function rewriteStreamUrl(url, baseUrl) {
    if (!url || !baseUrl) {
      return url;
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      if (url.startsWith("/")) {
        return `${normalizeBaseUrl(baseUrl)}${url}`;
      }
      return url;
    }
    const host = parsed.hostname;
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      return url;
    }
    const path = parsed.pathname || "";
    if (!path) {
      return url;
    }
    return `${normalizeBaseUrl(baseUrl)}${path}${parsed.search || ""}`;
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
    // Use audio/mp4 for M4A container (AAC in MP4/ipod format)
    sendMediaFile(request, reply, filePath, "audio/mp4");
  }

  function resolveStoragePath(key) {
    const resolved = path.resolve(appConfig.STORAGE_DIR, key);
    const root = path.resolve(appConfig.STORAGE_DIR) + path.sep;
    if (!resolved.startsWith(root)) {
      return null;
    }
    return resolved;
  }

  async function computeFileSha256(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(filePath);
      stream.on("error", reject);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
    });
  }

  async function resolveEnrollmentChunkFiles({ session, metrics, userId }) {
    const prompts = parseJson(session.prompts_json, [], "prompts_json");
    const orderedPromptIds = Array.isArray(prompts) ? prompts.map((prompt) => prompt.id) : [];
    const acceptedIds = orderedPromptIds.filter((id) => metrics[id]?.accepted);
    let chunkIds = acceptedIds.length ? acceptedIds : Object.keys(metrics || {});

    if (chunkIds.length === 0 && storageProvider.type === "local") {
      const localDir = path.join(
        appConfig.STORAGE_DIR,
        "enrollment",
        "raw",
        userId,
        session.id
      );
      if (fs.existsSync(localDir)) {
        chunkIds = fs
          .readdirSync(localDir)
          .filter((file) => file.endsWith(".wav"))
          .map((file) => path.basename(file, ".wav"));
      }
    }

    const files = [];
    let tempDir = null;
    if (storageProvider.type !== "local") {
      tempDir = fs.mkdtempSync(path.join(appConfig.STORAGE_DIR, "tmp-enrollment-"));
    }

    for (const chunkId of chunkIds) {
      const key = enrollmentChunkKey({ userId, sessionId: session.id, chunkId });
      if (!(await storageProvider.objectExists({ key }))) {
        continue;
      }
      if (storageProvider.resolveLocalPath) {
        const localPath = storageProvider.resolveLocalPath(key);
        files.push(localPath);
        continue;
      }
      const localPath = path.join(tempDir, `${chunkId}.wav`);
      await storageProvider.downloadToFile({ key, filePath: localPath });
      files.push(localPath);
    }

    return { files, tempDir };
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
    if (riskLevel === "high") {
      return { allowed: false, reset_at: null, reason: "HIGH_RISK" };
    }

    // Get user's tier from entitlements to determine daily limit
    const entRow = db.prepare("SELECT tier FROM entitlements WHERE user_id = ?").get(userId);
    const tier = entRow?.tier || "free";

    // Daily preview limits by tier (matches subscription_plans table)
    // -1 means unlimited
    const tierLimits = { free: 5, plus: 20, pro: -1 };
    const dailyLimit = tierLimits[tier] ?? 5;

    // Pro tier has unlimited previews
    if (dailyLimit === -1) {
      // Just track usage for analytics, no limit
      const nowStr = nowIso();
      db.prepare(
        "UPDATE entitlements SET preview_count_today = preview_count_today + 1, updated_at = ? WHERE user_id = ?"
      ).run(nowStr, userId);
      return { allowed: true, remaining: -1, reset_at: null, risk_level: riskLevel, tier };
    }

    // Reduce limit for medium risk users
    const effectiveLimit = riskLevel === "medium" ? Math.floor(dailyLimit / 2) : dailyLimit;

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
    ).run(nowStr, userId, effectiveLimit);

    if (result.changes === 0) {
      // Limit reached
      const ent = db.prepare("SELECT preview_count_reset_at FROM entitlements WHERE user_id = ?").get(userId);
      return { allowed: false, reset_at: ent?.preview_count_reset_at || newResetAt, reason: "DAILY_LIMIT", tier };
    }

    // Get updated count for response
    const updated = db.prepare(
      "SELECT preview_count_today, preview_count_reset_at FROM entitlements WHERE user_id = ?"
    ).get(userId);
    return {
      allowed: true,
      remaining: effectiveLimit - updated.preview_count_today,
      reset_at: updated.preview_count_reset_at,
      risk_level: riskLevel,
      tier,
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

  function findJob(jobId) {
    if (!jobId) {
      return null;
    }
    return db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
  }

  function isActiveJob(job) {
    return job && (job.status === "queued" || job.status === "running");
  }

  function findActiveJobForVersion(trackVersionId, workflowType) {
    return db
      .prepare(
        "SELECT * FROM jobs WHERE track_version_id = ? AND workflow_type = ? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1"
      )
      .get(trackVersionId, workflowType);
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

  function getTrackVersions(trackId, baseUrl) {
    const versions = db
      .prepare("SELECT * FROM track_versions WHERE track_id = ? ORDER BY version_num")
      .all(trackId);
    return versions.map((version) => {
      // Intentionally omit sensitive fields from public response
      // eslint-disable-next-line no-unused-vars
      const { guide_vocal_url, guide_access_token, ...rest } = version;
      return {
        ...rest,
        preview_url: rewriteStreamUrl(version.preview_url, baseUrl),
        full_url: rewriteStreamUrl(version.full_url, baseUrl),
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
    const now = nowIso();
    db.prepare(
      "INSERT INTO jobs (id, track_version_id, workflow_type, status, step, attempts, max_attempts, step_index, step_data, error_code, error_message, progress_pct, started_at, completed_at, last_heartbeat_at, external_task_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
      0,
      null,
      null,
      null,
      null,
      now,
      now
    );
    if (workflowType === "preview_render") {
      db.prepare("UPDATE track_versions SET preview_job_id = ? WHERE id = ?").run(
        jobId,
        trackVersionId
      );
    }
    if (workflowType === "full_render") {
      db.prepare("UPDATE track_versions SET full_job_id = ? WHERE id = ?").run(
        jobId,
        trackVersionId
      );
    }
    return db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
  }

  function getWorkflowStepCount(workflowType) {
    switch (workflowType) {
      case "preview_render":
      case "full_render":
        return 9;
      default:
        return 0;
    }
  }

  function computeJobProgress(job) {
    if (!job) {
      return null;
    }
    if (job.progress_pct !== null && job.progress_pct !== undefined) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/66676c14-265b-4adf-9643-906cc2f53ad1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.js:697',message:'returning stored progress_pct',data:{jobId:job.id,progressPct:job.progress_pct,status:job.status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      return job.progress_pct;
    }
    const stepCount = getWorkflowStepCount(job.workflow_type);
    if (!stepCount) {
      return null;
    }
    const index = Number(job.step_index || 0);
    const pct = Math.floor((Math.min(index, stepCount) / stepCount) * 100);
    const result = Math.min(pct, 99);
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/66676c14-265b-4adf-9643-906cc2f53ad1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.js:706',message:'computed progress from step index',data:{jobId:job.id,stepIndex:index,stepCount:stepCount,computedPct:pct,result:result,status:job.status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    return result;
  }

  // ============ Story Routes (Dynamic Q&A) ============
  registerStoryRoutes(app, { db, requireUserId, sendError, consumeRateLimit, addAuditEntry });

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
    const progress = computeJobProgress(job);
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/66676c14-265b-4adf-9643-906cc2f53ad1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.js:737',message:'GET /jobs/:id response',data:{jobId:job.id,status:job.status,progress:progress,progressPct:job.progress_pct,stepIndex:job.step_index},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    // Job processing is handled by the background job runner (src/workflows/runner.js)
    // which polls for queued/running jobs and advances them through pipeline steps
    reply.send({
      ...job,
      progress,
    });
  });

  // Preview audio endpoint - unauthenticated for AVPlayer compatibility
  // Security: UUID path is unguessable (MVP - consider signed URLs for production)
  // Supports both .mp3 and .m4a formats
  app.get("/preview/:trackVersionId.mp3", async (request, reply) => {
    const trackVersion = db
      .prepare("SELECT * FROM track_versions WHERE id = ?")
      .get(request.params.trackVersionId);
    if (!trackVersion) {
      sendError(reply, 404, "TRACK_VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
    const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(trackVersion.track_id);
    if (!track || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const versionDir = getVersionDir(track, trackVersion);
    const filePath = path.join(versionDir, "preview.mp3");
    sendMediaFile(request, reply, filePath, "audio/mpeg");
  });

  app.get("/preview/:trackVersionId.m4a", async (request, reply) => {
    const trackVersion = db
      .prepare("SELECT * FROM track_versions WHERE id = ?")
      .get(request.params.trackVersionId);
    if (!trackVersion) {
      sendError(reply, 404, "TRACK_VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
    const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(trackVersion.track_id);
    if (!track || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const versionDir = getVersionDir(track, trackVersion);
    const filePath = path.join(versionDir, "preview.m4a");
    // #region agent log
    const fileExists = fs.existsSync(filePath);
    fetch('http://127.0.0.1:7243/ingest/66676c14-265b-4adf-9643-906cc2f53ad1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.js:781',message:'serving preview audio file',data:{trackVersionId:request.params.trackVersionId,filePath:filePath,fileExists:fileExists},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    sendAudioFile(request, reply, filePath);
  });

  app.get("/full/:trackVersionId.m4a", async (request, reply) => {
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
    const filePath = path.join(versionDir, "full.m4a");
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
    const key = enrollmentCleanKey({ userId: session.user_id, sessionId: session.id });
    if (storageProvider.type !== "local") {
      const download = storageProvider.createPresignedDownload({ key, expiresInSec: 300 });
      reply.redirect(download.url);
      return;
    }
    sendMediaFile(request, reply, filePath, "audio/wav");
  });

  app.put("/storage/upload", { bodyLimit: 50 * 1024 * 1024 }, async (request, reply) => {
    if (storageProvider.type !== "local") {
      sendError(reply, 404, "NOT_FOUND", "Upload endpoint unavailable.");
      return;
    }
    const { key, expires, sig, content_type } = request.query || {};
    if (!key || !expires || !sig) {
      sendError(reply, 400, "MISSING_SIGNATURE", "Upload signature is required.");
      return;
    }
    const expiresAt = Number(expires);
    if (!Number.isFinite(expiresAt)) {
      sendError(reply, 400, "INVALID_SIGNATURE", "Invalid expiration.");
      return;
    }
    if (Date.now() > expiresAt) {
      sendError(reply, 410, "UPLOAD_EXPIRED", "Upload URL expired.");
      return;
    }
    if (!key.startsWith("enrollment/raw/")) {
      sendError(reply, 403, "FORBIDDEN", "Upload key not allowed.");
      return;
    }
    const contentType = content_type || "";
    const verified = storageProvider.verifyPresignedRequest({
      key,
      expiresAt,
      signature: sig,
      contentType,
      purpose: "upload",
    });
    if (!verified) {
      sendError(reply, 403, "INVALID_SIGNATURE", "Upload signature invalid.");
      return;
    }
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      sendError(reply, 400, "EMPTY_BODY", "Upload body is required.");
      return;
    }
    if (contentType && request.headers["content-type"] && request.headers["content-type"] !== contentType) {
      sendError(reply, 400, "CONTENT_TYPE_MISMATCH", "Content-Type mismatch.");
      return;
    }
    const filePath = resolveStoragePath(key);
    if (!filePath) {
      sendError(reply, 400, "INVALID_PATH", "Invalid storage path.");
      return;
    }
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, request.body);
    reply.send({ ok: true, key });
  });

  app.post("/voice/enrollment/start", { schema: schemas.enrollmentStart }, async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    // DEBUG: Log enrollment attempt
    console.error("DEBUG enrollment/start:", { userId, timestamp: new Date().toISOString() });
    const limit = consumeRateLimit(userId, "enrollment_start", 3, 24 * 60 * 60);
    console.error("DEBUG rate limit result:", { userId, allowed: limit.allowed, remaining: limit.remaining });
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
    // 6-10 prompts per spec: phonetically diverse spoken + sung melodies
    const prompts = [
      {
        id: "p1",
        type: "spoken",
        text: "The quick brown fox jumps over the lazy dog.",
        duration_hint_sec: 5,
      },
      {
        id: "p2",
        type: "spoken",
        text: "Pack my box with five dozen liquor jugs.",
        duration_hint_sec: 5,
      },
      {
        id: "p3",
        type: "spoken",
        text: "How vexingly quick daft zebras jump!",
        duration_hint_sec: 5,
      },
      {
        id: "p4",
        type: "spoken",
        text: "The five boxing wizards jump quickly.",
        duration_hint_sec: 5,
      },
      {
        id: "p5",
        type: "sung",
        text: "La la la, la la la la la, la la la la la la la",
        pitch_hint: "Start comfortable, go up",
        duration_hint_sec: 8,
      },
      {
        id: "p6",
        type: "sung",
        text: "Ooh ooh ooh, ah ah ah, ooh ooh ooh ah",
        pitch_hint: "Smooth and flowing",
        duration_hint_sec: 8,
      },
    ];
    const baseUrl = getBaseUrl(request);
    const uploadUrls = prompts.map((prompt) => {
      const chunkId = prompt.id;
      const key = enrollmentChunkKey({ userId, sessionId, chunkId });
      const presigned = storageProvider.createPresignedUpload({
        key,
        contentType: "audio/wav",
        expiresInSec: appConfig.UPLOAD_URL_TTL_SEC,
        baseUrl,
      });
      return {
        chunk_id: chunkId,
        url: presigned.url,
        method: presigned.method,
        headers: presigned.headers,
        expires_at: presigned.expiresAt,
      };
    });
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
    if (!chunk_id) {
      sendError(reply, 400, "MISSING_CHUNK_ID", "chunk_id is required.");
      return;
    }
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
    const storageKey = enrollmentChunkKey({
      userId,
      sessionId: session_id,
      chunkId: chunk_id,
    });
    const exists = await storageProvider.objectExists({ key: storageKey });
    if (!exists) {
      sendError(reply, 404, "CHUNK_NOT_FOUND", "Uploaded chunk not found. Please retry.");
      return;
    }

    let resolvedDuration = duration_sec;
    let checksumMatches = true;
    const localPath = storageProvider.resolveLocalPath
      ? storageProvider.resolveLocalPath(storageKey)
      : null;

    if (localPath && fs.existsSync(localPath)) {
      if (!resolvedDuration) {
        try {
          const buffer = fs.readFileSync(localPath);
          const wavInfo = parseWavBuffer(buffer);
          resolvedDuration = wavInfo.durationSec;
        } catch (err) {
          resolvedDuration = null;
        }
      }
      if (client_checksum) {
        const serverHash = await computeFileSha256(localPath);
        checksumMatches = serverHash === client_checksum;
      }
    }
    const metrics = parseJson(session.quality_metrics, {});
    const durationOk =
      typeof resolvedDuration === "number" &&
      resolvedDuration >= 2 &&
      resolvedDuration <= 25;
    if (!durationOk) {
      metrics[chunk_id] = {
        accepted: false,
        reason: "DURATION_OUT_OF_RANGE",
        duration_sec: resolvedDuration,
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
    if (!checksumMatches) {
      metrics[chunk_id] = {
        accepted: false,
        reason: "CHECKSUM_MISMATCH",
        duration_sec: resolvedDuration,
      };
      db.prepare("UPDATE enrollment_sessions SET quality_metrics = ? WHERE id = ?").run(
        toJson(metrics),
        session_id
      );
      sendError(reply, 400, "QC_FAILED", "Audio chunk checksum mismatch.", {
        reason: "CHECKSUM_MISMATCH",
        re_record: true,
      });
      return;
    }
    metrics[chunk_id] = {
      accepted: true,
      duration_sec: resolvedDuration,
      client_checksum,
      storage_key: storageKey,
    };
    db.prepare(
      "UPDATE enrollment_sessions SET chunk_count = chunk_count + 1, status = ?, quality_metrics = ? WHERE id = ?"
    ).run("processing", toJson(metrics), session_id);
    reply.send({
      status: "accepted",
      qc_job_id: newUuid(),
      next_upload_url: null,
      chunk_id,
      duration_sec: resolvedDuration,
    });
  });

  // Debug endpoint for uploading audio chunks via browser
  app.post("/debug/upload-chunk", async (request, reply) => {
    if (!appConfig.DEV_MODE) {
      sendError(reply, 404, "NOT_FOUND", "Endpoint not available.");
      return;
    }
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

    // Calculate duration from WAV header (handles extended WAV with JUNK/LIST chunks)
    let durationSec = 0;
    if (buffer.length > 44 && buffer.toString('ascii', 0, 4) === 'RIFF') {
      // Parse WAV chunks to find fmt and data (iOS adds JUNK chunks)
      let sampleRate = 0;
      let bitsPerSample = 16;
      let numChannels = 1;
      let dataSize = 0;

      let offset = 12; // Skip RIFF header + WAVE
      while (offset < buffer.length - 8) {
        const chunkId = buffer.toString('ascii', offset, offset + 4);
        const chunkSize = buffer.readUInt32LE(offset + 4);

        if (chunkId === 'fmt ') {
          numChannels = buffer.readUInt16LE(offset + 10);
          sampleRate = buffer.readUInt32LE(offset + 12);
          bitsPerSample = buffer.readUInt16LE(offset + 22);
        } else if (chunkId === 'data') {
          dataSize = chunkSize;
          break; // Found data chunk, we're done
        }

        offset += 8 + chunkSize;
        if (chunkSize % 2 === 1) offset++; // WAV chunks are word-aligned
      }

      if (sampleRate > 0 && dataSize > 0) {
        const bytesPerSample = (bitsPerSample / 8) * numChannels;
        durationSec = dataSize / bytesPerSample / sampleRate;
      }
      console.error("DEBUG WAV parsed:", { sampleRate, bitsPerSample, numChannels, dataSize, durationSec });
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

    const metrics = parseJson(session.quality_metrics, {});
    const { files: chunkFiles, tempDir } = await resolveEnrollmentChunkFiles({
      session,
      metrics,
      userId,
    });
    let qcResult;
    try {
      // Run QC validation on enrollment audio chunks
      qcResult = await validateEnrollmentAudio({
        userId,
        sessionId: session_id,
        storageDir: appConfig.STORAGE_DIR,
        chunkFiles,
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
          await storageProvider.putFile({
            key: enrollmentCleanKey({ userId, sessionId: session_id }),
            filePath: cleanPath,
            contentType: "audio/wav",
          });

          const accessToken = crypto.randomBytes(16).toString("hex");
          db.prepare("UPDATE enrollment_sessions SET access_token = ? WHERE id = ?").run(
            accessToken,
            session_id
          );
          const audioUrl = `${getBaseUrl(request)}/enrollment/${session_id}/clean.wav?token=${accessToken}`;
          const embedding = await extractEmbedding({
            baseUrl: appConfig.REPLICATE_BASE_URL,
            token: appConfig.REPLICATE_API_TOKEN,
            modelVersion: appConfig.REPLICATE_EMBEDDING_MODEL_VERSION,
            audioUrl,
            timeoutMs: appConfig.PROVIDER_TIMEOUT_MS,
          });
          const embeddingPath = storageProvider.resolveLocalPath
            ? storageProvider.resolveLocalPath(embeddingRef)
            : path.join(appConfig.STORAGE_DIR, "tmp-embedding", `${profileId}.bin`);
          await downloadToFile(
            embedding.embedding_url,
            embeddingPath,
            appConfig.PROVIDER_TIMEOUT_MS
          );
          await storageProvider.putFile({
            key: embeddingRef,
            filePath: embeddingPath,
            contentType: "application/octet-stream",
          });
          if (!storageProvider.resolveLocalPath) {
            fs.rmSync(embeddingPath, { force: true });
          }
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
    } finally {
      if (tempDir) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
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

  // ============ Memory Questions ============

  /**
   * POST /memory/questions
   *
   * Generate contextual follow-up questions based on a user's memory.
   * Used by the story wizard to extract emotional essence for personalized songs.
   */
  app.post("/memory/questions", { schema: schemas.memoryQuestions }, async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }

    // Rate limit: 30 requests per minute (generous for wizard flow)
    const limit = consumeRateLimit(userId, "memory_questions", 30, 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Question generation rate limit reached.", {
        retry_at: limit.reset_at,
      });
      return;
    }

    const body = request.body || {};
    const { memory, occasion, recipient_name } = body;

    // Moderation check on the memory input
    const moderation = moderationCheck({ message: memory });
    if (!moderation.allowed) {
      sendError(reply, 422, "MODERATION_BLOCKED", "Memory blocked by moderation.", {
        reason: moderation.reason,
      });
      return;
    }

    try {
      const result = await generateMemoryQuestions({
        memory,
        occasion: occasion || "celebration",
        recipientName: recipient_name || "them",
      });

      reply.send({
        questions: result.questions,
      });
    } catch (err) {
      console.error("[POST /memory/questions] Error:", err.message);
      sendError(reply, 500, "QUESTION_GENERATION_FAILED", "Failed to generate questions. Please try again.");
    }
  });

  // ============ Poems ============

  /**
   * POST /poems - Create a new personalized poem
   */
  app.post("/poems", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }

    const body = request.body || {};
    const { title, recipient_name, occasion, tone, message } = body;

    // Validate required fields
    if (!title || !recipient_name || !occasion) {
      sendError(reply, 400, "MISSING_REQUIRED_FIELDS", "title, recipient_name, and occasion are required.");
      return;
    }

    // Moderation check
    const moderation = moderationCheck({ title, message: message || "", recipient_name });
    if (!moderation.allowed) {
      sendError(reply, 403, "MODERATION_BLOCKED", "Content blocked by moderation.", {
        reason: moderation.reason,
      });
      return;
    }

    const poemId = newUuid();
    const now = nowIso();

    db.prepare(
      `INSERT INTO poems (id, user_id, title, recipient_name, occasion, tone, verses, message, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      poemId,
      userId,
      title,
      recipient_name,
      occasion,
      tone || "heartfelt",
      "[]", // Empty verses for draft
      message || null,
      "draft",
      now,
      now
    );

    addAuditEntry({
      userId,
      action: "poem_created",
      resourceType: "poem",
      resourceId: poemId,
    });

    reply.code(201).send({
      id: poemId,
      title,
      recipient_name,
      occasion,
      tone: tone || "heartfelt",
      verses: [],
      message: message || null,
      status: "draft",
      created_at: now,
      updated_at: now,
    });
  });

  /**
   * GET /poems - List user's poems
   */
  app.get("/poems", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }

    const poems = db
      .prepare(
        "SELECT * FROM poems WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC"
      )
      .all(userId);

    // Parse verses JSON for each poem
    const parsedPoems = poems.map(poem => ({
      ...poem,
      verses: parseJson(poem.verses, [], `poem ${poem.id} verses`),
    }));

    reply.send({ poems: parsedPoems });
  });

  /**
   * GET /poems/:id - Get specific poem
   */
  app.get("/poems/:id", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }

    const poem = db.prepare("SELECT * FROM poems WHERE id = ?").get(request.params.id);
    if (!poem || poem.user_id !== userId || poem.deleted_at) {
      sendError(reply, 404, "POEM_NOT_FOUND", "Poem not found.");
      return;
    }

    reply.send({
      poem: {
        ...poem,
        verses: parseJson(poem.verses, [], `poem ${poem.id} verses`),
      },
    });
  });

  /**
   * PUT /poems/:id - Update poem
   */
  app.put("/poems/:id", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }

    const poem = db.prepare("SELECT * FROM poems WHERE id = ?").get(request.params.id);
    if (!poem || poem.user_id !== userId || poem.deleted_at) {
      sendError(reply, 404, "POEM_NOT_FOUND", "Poem not found.");
      return;
    }

    const body = request.body || {};
    const { title, recipient_name, occasion, tone, message, verses, status } = body;

    // Moderation check if content is being updated
    if (title || message || recipient_name) {
      const moderation = moderationCheck({
        title: title || poem.title,
        message: message || poem.message || "",
        recipient_name: recipient_name || poem.recipient_name,
      });
      if (!moderation.allowed) {
        sendError(reply, 403, "MODERATION_BLOCKED", "Content blocked by moderation.", {
          reason: moderation.reason,
        });
        return;
      }
    }

    const now = nowIso();
    const updatedTitle = title !== undefined ? title : poem.title;
    const updatedRecipientName = recipient_name !== undefined ? recipient_name : poem.recipient_name;
    const updatedOccasion = occasion !== undefined ? occasion : poem.occasion;
    const updatedTone = tone !== undefined ? tone : poem.tone;
    const updatedMessage = message !== undefined ? message : poem.message;
    const updatedVerses = verses !== undefined ? toJson(verses) : poem.verses;
    const updatedStatus = status !== undefined ? status : poem.status;

    db.prepare(
      `UPDATE poems SET title = ?, recipient_name = ?, occasion = ?, tone = ?, message = ?, verses = ?, status = ?, updated_at = ? WHERE id = ?`
    ).run(
      updatedTitle,
      updatedRecipientName,
      updatedOccasion,
      updatedTone,
      updatedMessage,
      updatedVerses,
      updatedStatus,
      now,
      poem.id
    );

    addAuditEntry({
      userId,
      action: "poem_updated",
      resourceType: "poem",
      resourceId: poem.id,
    });

    reply.send({
      poem: {
        id: poem.id,
        user_id: userId,
        title: updatedTitle,
        recipient_name: updatedRecipientName,
        occasion: updatedOccasion,
        tone: updatedTone,
        message: updatedMessage,
        verses: parseJson(updatedVerses, [], `poem ${poem.id} verses`),
        status: updatedStatus,
        created_at: poem.created_at,
        updated_at: now,
      },
    });
  });

  /**
   * DELETE /poems/:id - Soft delete poem
   */
  app.delete("/poems/:id", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }

    const poem = db.prepare("SELECT * FROM poems WHERE id = ?").get(request.params.id);
    if (!poem || poem.user_id !== userId || poem.deleted_at) {
      sendError(reply, 404, "POEM_NOT_FOUND", "Poem not found.");
      return;
    }

    const now = nowIso();
    db.prepare("UPDATE poems SET deleted_at = ?, updated_at = ? WHERE id = ?").run(now, now, poem.id);

    addAuditEntry({
      userId,
      action: "poem_deleted",
      resourceType: "poem",
      resourceId: poem.id,
    });

    reply.send({ deleted: true });
  });

  // ============ Tracks ============

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
    // AI-generated follow-up question answers from wizard
    if (Array.isArray(body.memory_answers) && body.memory_answers.length > 0) {
      storyContext.memory_answers = body.memory_answers;
    }
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
    reply.send({ track, versions: getTrackVersions(track.id, getBaseUrl(request)) });
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
    const streamBaseUrl = getBaseUrl(request);
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
    const streamBaseUrl = getBaseUrl(request);
    db.prepare("UPDATE track_versions SET stream_base_url = ? WHERE id = ?").run(
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
    let existingJob = findJob(trackVersion.preview_job_id);
    if (!existingJob) {
      existingJob = findActiveJobForVersion(trackVersion.id, "preview_render");
      if (existingJob) {
        db.prepare("UPDATE track_versions SET preview_job_id = ? WHERE id = ?").run(
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
      "UPDATE track_versions SET status = 'processing' WHERE id = ? AND status NOT IN ('processing','preview_ready')"
    ).run(trackVersion.id);

    if (updateResult.changes === 0) {
      const fallbackJob = findActiveJobForVersion(trackVersion.id, "preview_render");
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
    const versionNum = Number(request.params.version);
    const trackVersion = findTrackVersion(track.id, versionNum);
    if (!trackVersion) {
      sendError(reply, 404, "VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
    const streamBaseUrl = getBaseUrl(request);
    db.prepare("UPDATE track_versions SET stream_base_url = ? WHERE id = ?").run(
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
    let existingJob = findJob(trackVersion.full_job_id);
    if (!existingJob) {
      existingJob = findActiveJobForVersion(trackVersion.id, "full_render");
      if (existingJob) {
        db.prepare("UPDATE track_versions SET full_job_id = ? WHERE id = ?").run(
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
      const fallbackJob = findActiveJobForVersion(trackVersion.id, "full_render");
      if (fallbackJob) {
        reply.code(202).send({
          job_id: fallbackJob.id,
          billing_hold_id: trackVersion.billing_hold_id || null,
          credits_reserved: 0,
          estimated_completion_sec: 180,
        });
        return;
      }
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
    const streamBaseUrl = getBaseUrl(request);
    // Transaction ensures version increment + insert are atomic
    const newVersionId = newUuid();
    const newVersionNum = db.transaction(() => {
      const num = incrementTrackVersion(track.id);
      db.prepare(
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
    // Rate limit: 10 lyrics edits per minute
    const limit = consumeRateLimit(userId, "lyrics_edit", 10, 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Lyrics edit rate limit reached.", {
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
    const body = request.body || {};
    if (!body.lyrics || typeof body.lyrics !== "object") {
      sendError(reply, 400, "INVALID_LYRICS", "lyrics must be an object.");
      return;
    }
    // Extract text content from lyrics for moderation
    const lyricsText = extractLyricsText(body.lyrics);
    const moderation = moderationCheck({ lyrics: lyricsText });
    if (!moderation.allowed) {
      setRiskLevel(userId, "medium");
      addAuditEntry({
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
      // Memory answers from AI follow-up questions
      memory_answers: storyContext.memory_answers,
    });
    // Post-LLM moderation: re-validate generated lyrics
    const lyricsText = extractLyricsText(result.lyrics);
    const validation = validateGeneratedLyrics(lyricsText, track.recipient_name);
    if (!validation.allowed) {
      // Mark version as blocked in database
      db.prepare(
        "UPDATE track_versions SET moderation_status = ?, moderation_reason = ? WHERE id = ?"
      ).run("blocked", validation.reason, trackVersion.id);
      addAuditEntry({
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
    db.prepare(
      "UPDATE track_versions SET lyrics_json = ?, lyrics_status = ?, lyrics_updated_at = ? WHERE id = ?"
    ).run(toJson(result.lyrics), lyricsStatus, nowIso(), trackVersion.id);
    reply.send({
      lyrics: result.lyrics,
      lyrics_status: lyricsStatus,
      has_anchor: validation.hasAnchor,
    });
  });

  app.post("/tracks/:id/versions/:version/lyrics/approve", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    // Rate limit: 20 approvals per hour
    const limit = consumeRateLimit(userId, "lyrics_approve", 20, 60 * 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Lyrics approval rate limit reached.", {
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
    if (!trackVersion.lyrics_json) {
      sendError(reply, 409, "LYRICS_MISSING", "Generate or upload lyrics before approval.");
      return;
    }
    // Parse lyrics and extract text for moderation (fix: was passing JSON string)
    const lyricsObj = parseJson(trackVersion.lyrics_json, null, "lyrics_approve");
    const lyricsText = extractLyricsText(lyricsObj);
    const moderation = moderationCheck({ lyrics: lyricsText });
    if (!moderation.allowed) {
      setRiskLevel(userId, "medium");
      db.prepare(
        "UPDATE track_versions SET moderation_status = ?, moderation_reason = ? WHERE id = ?"
      ).run("blocked", moderation.reason, trackVersion.id);
      addAuditEntry({
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
    addAuditEntry({
      userId,
      action: "lyrics_approved",
      resourceType: "track_version",
      resourceId: trackVersion.id,
      metadata: { has_anchor: validation.hasAnchor },
    });
    db.prepare(
      "UPDATE track_versions SET lyrics_status = ?, lyrics_approved_at = ?, moderation_status = ? WHERE id = ?"
    ).run("approved", nowIso(), "passed", trackVersion.id);
    reply.send({ approved: true, has_anchor: validation.hasAnchor });
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
      share_url: `${publicBaseUrl}/play/${shareId}`,
      qr_code_url: `https://cdn.porizo.local/qr/${shareId}.png`,
      expires_at: expiresAt,
      claim_pin: claimPin, // Creator must share this PIN with recipient out-of-band
    });
  });

  // ============ Web Player ============
  // Serves the web-based player for shared songs
  app.get("/play/:shareId", async (request, reply) => {
    const fs = require("fs");
    const shareId = request.params.shareId;

    // Validate share exists (basic check - full validation happens client-side)
    const share = db.prepare("SELECT id, status, expires_at FROM share_tokens WHERE id = ?").get(shareId);
    if (!share) {
      return reply.status(404).type("text/html").send(`
        <!DOCTYPE html>
        <html><head><title>Not Found | Porizo</title></head>
        <body style="font-family:system-ui;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
          <div style="text-align:center;padding:24px;">
            <h1 style="margin-bottom:16px;">Song Not Found</h1>
            <p style="color:#a3a3a3;">This share link doesn't exist or has been removed.</p>
          </div>
        </body></html>
      `);
    }

    // Log access
    addShareAccessLog({
      shareTokenId: share.id,
      eventType: "web_player_opened",
      metadata: { user_agent: request.headers["user-agent"] || null },
    });

    // Serve the web player HTML
    const playerHtml = fs.readFileSync(path.join(process.cwd(), "web-player", "index.html"), "utf-8");
    return reply.type("text/html").send(playerHtml);
  });

  // Backwards-compatible short link that forwards to /play/:id
  app.get("/s/:shareId", async (request, reply) => {
    return reply.redirect(`/play/${request.params.shareId}`);
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

    // Get device ID once for all code paths
    const requestDeviceId = request.headers["x-device-id"];

    if (share.status === "claimed") {
      // Check if this is the same device that claimed the share
      const canAccess = share.bound_device_id && share.bound_device_id === requestDeviceId;

      reply.send({
        status: "claimed",
        can_access: canAccess,
        app_required: !canAccess, // Only require app if different device
        app_download_url: `${publicBaseUrl}/download`,
      });
      return;
    }

    // Check if requesting device matches bound device (for can_access)
    const canAccess = share.status === "unbound" ||
      (share.bound_device_id && share.bound_device_id === requestDeviceId);

    const trackInfo = {
      title: track.title,
      recipient_name: track.recipient_name,
      duration_sec: track.duration_target || 60,
      cover_image_url: null,
    };

    const shareStreamUrl = share.web_stream_allowed
      ? `${getBaseUrl(request)}/share/${share.id}/audio`
      : null;

    reply.send({
      status: "unbound",
      track_preview: trackInfo,
      track: trackInfo, // Alias for web player compatibility
      can_access: canAccess,
      web_stream_url: shareStreamUrl,
      app_download_url: `${publicBaseUrl}/download`,
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
    if (platform === "web") {
      addShareAccessLog({
        shareTokenId: share.id,
        eventType: "claim_failed",
        metadata: { reason: "web_not_allowed" },
      });
      sendError(reply, 400, "WEB_CLAIM_NOT_ALLOWED", "Web claims are not supported.");
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
    const baseUrl = getBaseUrl(request);

    // Get track info (needed for all paths)
    const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(share.track_id);
    const trackVersion = db.prepare("SELECT * FROM track_versions WHERE id = ?").get(share.track_version_id);

    // For CLAIMED shares, require device match
    if (share.status === "claimed") {
      if (!deviceId || !platform) {
        sendError(reply, 400, "MISSING_DEVICE_HEADERS", "x-device-id and x-platform headers are required for claimed shares.");
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
        metadata: { platform, claimed: true },
      });

      // Check if CDN (CloudFront) is configured for claimed shares
      if (cdnSignerInstance && track && trackVersion) {
        const hlsPath = `/tracks/${track.user_id}/${track.id}/v${trackVersion.version_num}/hls/playlist.m3u8`;
        const signedPlaylist = cdnSignerInstance.createSignedStreamUrl({
          path: hlsPath,
          expiresInSeconds: 300,
        });
        reply.send({
          stream_url: signedPlaylist.url,
          cdn_enabled: true,
          format: "hls",
          expires_at: signedPlaylist.expiresAt,
        });
        return;
      }

      // Fallback to HLS playlist for claimed shares
      reply.send({
        stream_url: `${baseUrl}/share/${share.id}/playlist`,
        key_url: `${baseUrl}/share/${share.id}/key`,
        cdn_enabled: false,
        format: "hls",
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });
      return;
    }

    // For UNCLAIMED shares - check if web streaming is allowed
    if (share.status === "unbound") {
      if (!share.web_stream_allowed) {
        sendError(reply, 403, "WEB_STREAM_NOT_ALLOWED", "Web streaming not allowed for this share.");
        return;
      }

      addShareAccessLog({
        shareTokenId: share.id,
        eventType: "stream_started",
        metadata: { platform: platform || "web", claimed: false },
      });

      // Return direct audio endpoint for unclaimed web shares (avoids HLS auth header issues)
      if (trackVersion && (trackVersion.preview_url || trackVersion.full_url)) {
        reply.send({
          stream_url: `${baseUrl}/share/${share.id}/audio`,
          cdn_enabled: false,
          format: "audio",
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        });
        return;
      }

      // Fallback if no audio URL
      sendError(reply, 404, "TRACK_NOT_READY", "Track audio not available.");
      return;
    }

    // Unknown status
    sendError(reply, 500, "INVALID_SHARE_STATUS", "Share has invalid status.");
  });

  // Direct audio endpoint for unclaimed web playback (no auth headers required)
  app.get("/share/:shareId/audio", async (request, reply) => {
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
    if (share.status !== "unbound") {
      sendError(reply, 403, "SHARE_ALREADY_CLAIMED", "Share has been claimed in the app.");
      return;
    }
    if (!share.web_stream_allowed) {
      sendError(reply, 403, "WEB_STREAM_NOT_ALLOWED", "Web streaming not allowed for this share.");
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
    const versionDir = getVersionDir(track, trackVersion);
    const fullPath = path.join(versionDir, "full.m4a");
    const previewPath = path.join(versionDir, "preview.m4a");
    const filePath = fs.existsSync(fullPath) ? fullPath : previewPath;
    if (!fs.existsSync(filePath)) {
      sendError(reply, 404, "AUDIO_NOT_FOUND", "Audio file not found.");
      return;
    }
    addShareAccessLog({
      shareTokenId: share.id,
      eventType: "audio_served",
      metadata: { user_agent: request.headers["user-agent"] || null },
    });
    sendAudioFile(request, reply, filePath);
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

  // Share statistics endpoint - returns analytics for track owner
  app.get("/tracks/:id/share/stats", async (request, reply) => {
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
      sendError(reply, 404, "SHARE_NOT_FOUND", "No share exists for this track.");
      return;
    }

    const share = db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(track.share_token_id);
    if (!share) {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Share token not found.");
      return;
    }

    // Get access log summary
    const accessLogs = db
      .prepare(
        "SELECT event_type, COUNT(*) as count, MAX(created_at) as last_at FROM share_access_log WHERE share_token_id = ? GROUP BY event_type"
      )
      .all(share.id);

    const eventCounts = {};
    let totalEvents = 0;
    for (const log of accessLogs) {
      eventCounts[log.event_type] = {
        count: log.count,
        last_at: log.last_at,
      };
      totalEvents += log.count;
    }

    // Get recent access log entries (last 10)
    const recentActivity = db
      .prepare(
        "SELECT event_type, metadata, created_at FROM share_access_log WHERE share_token_id = ? ORDER BY created_at DESC LIMIT 10"
      )
      .all(share.id)
      .map((row) => ({
        event_type: row.event_type,
        metadata: parseJson(row.metadata),
        created_at: row.created_at,
      }));

    reply.send({
      share_id: share.id,
      status: share.status,
      created_at: share.created_at,
      expires_at: share.expires_at,
      is_expired: new Date(share.expires_at) < new Date(),
      // Flattened for iOS compatibility (was nested in access_stats)
      total_events: totalEvents,
      event_counts: eventCounts,
      // Flattened for iOS compatibility (was nested in claim_info)
      is_claimed: !!share.bound_device_id,
      bound_device: share.bound_device_id
        ? {
            platform: share.bound_device_platform,
          app_version: share.bound_app_version,
            bound_at: share.bound_at,
          }
        : null,
      recent_activity: recentActivity,
    });
  });

  // QR code generation endpoint - returns PNG image of QR code for share link
  app.get("/tracks/:id/share/qr", async (request, reply) => {
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
      sendError(reply, 404, "SHARE_NOT_FOUND", "No share exists for this track.");
      return;
    }

    const share = db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(track.share_token_id);
    if (!share) {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Share token not found.");
      return;
    }
    if (share.status === "revoked") {
      sendError(reply, 410, "SHARE_REVOKED", "Share has been revoked.");
      return;
    }
    if (new Date(share.expires_at) < new Date()) {
      sendError(reply, 410, "SHARE_EXPIRED", "Share has expired.");
      return;
    }

    // Generate QR code for the web player URL
    const shareUrl = `${publicBaseUrl}/play/${share.id}`;

    // Parse query params for customization
    const size = Math.min(Math.max(parseInt(request.query.size) || 300, 100), 1000);
    const format = request.query.format === "svg" ? "svg" : "png";

    try {
      if (format === "svg") {
        const svg = await QRCode.toString(shareUrl, {
          type: "svg",
          width: size,
          margin: 2,
          color: {
            dark: "#000000",
            light: "#ffffff",
          },
        });
        reply.type("image/svg+xml").send(svg);
      } else {
        const pngBuffer = await QRCode.toBuffer(shareUrl, {
          width: size,
          margin: 2,
          color: {
            dark: "#000000",
            light: "#ffffff",
          },
        });
        reply.type("image/png").send(pngBuffer);
      }
    } catch (err) {
      console.error("[QR] Generation error:", err);
      sendError(reply, 500, "QR_GENERATION_FAILED", "Failed to generate QR code.");
    }
  });

  // QR code data URL endpoint - returns base64 data URL for embedding
  app.get("/tracks/:id/share/qr-data", async (request, reply) => {
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
      sendError(reply, 404, "SHARE_NOT_FOUND", "No share exists for this track.");
      return;
    }

    const share = db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(track.share_token_id);
    if (!share) {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Share token not found.");
      return;
    }
    if (share.status === "revoked") {
      sendError(reply, 410, "SHARE_REVOKED", "Share has been revoked.");
      return;
    }
    if (new Date(share.expires_at) < new Date()) {
      sendError(reply, 410, "SHARE_EXPIRED", "Share has expired.");
      return;
    }

    // Generate QR code for the web player URL
    const shareUrl = `${publicBaseUrl}/play/${share.id}`;
    const size = Math.min(Math.max(parseInt(request.query.size) || 300, 100), 1000);

    try {
      const dataUrl = await QRCode.toDataURL(shareUrl, {
        width: size,
        margin: 2,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      });
      reply.send({
        share_url: shareUrl,
        qr_data_url: dataUrl,
        size: size,
      });
    } catch (err) {
      console.error("[QR] Generation error:", err);
      sendError(reply, 500, "QR_GENERATION_FAILED", "Failed to generate QR code.");
    }
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
    reply.send({ versions: getTrackVersions(track.id, getBaseUrl(request)) });
  });

  app.get("/entitlements", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) {
      return;
    }
    try {
      const entitlements = await subscriptionManager.getEntitlements(userId);
      if (!entitlements) {
        sendError(reply, 404, "NO_ENTITLEMENTS", "No entitlements found for user.");
        return;
      }
      reply.send({
        entitlements: {
          tier: entitlements.tier,
          songsRemaining: entitlements.songsRemaining,
          songsAllowance: entitlements.songsAllowance,
          songsUsedTotal: entitlements.songsUsedTotal,
          trialSongsRemaining: entitlements.trialSongsRemaining,
          trialExpiresAt: entitlements.trialExpiresAt,
          previewCountToday: entitlements.previewCountToday,
          planId: entitlements.planId,
          billingPeriod: entitlements.billingPeriod,
          subscriptionStartsAt: entitlements.subscriptionStartsAt,
          subscriptionRenewsAt: entitlements.subscriptionRenewsAt,
        },
        risk_level: getUserRiskLevel(userId),
      });
    } catch (err) {
      console.error("[Entitlements] Error fetching entitlements:", err);
      sendError(reply, 500, "ENTITLEMENTS_ERROR", err.message);
    }
  });

  // ============ Billing API Routes ============

  /**
   * Get user's billing entitlements (flat format for iOS BillingEntitlements model)
   * GET /billing/entitlements
   */
  app.get("/billing/entitlements", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    try {
      const entitlements = await subscriptionManager.getEntitlements(userId);
      const subscription = await subscriptionManager.getActiveSubscription(userId);

      if (!entitlements) {
        // Return default free tier entitlements if none exist
        reply.send({
          tier: "free",
          songs_remaining: 0,
          songs_allowance: 0,
          songs_used_total: 0,
          trial_songs_remaining: 0,
          trial_expires_at: null,
          preview_count_today: 0,
          plan_id: null,
          billing_period: null,
          subscription_starts_at: null,
          subscription_renews_at: null,
          auto_renew_enabled: false,
          is_in_grace_period: false,
        });
        return;
      }

      // Return flat snake_case format for iOS BillingEntitlements model
      reply.send({
        tier: entitlements.tier,
        songs_remaining: entitlements.songsRemaining,
        songs_allowance: entitlements.songsAllowance,
        songs_used_total: entitlements.songsUsedTotal,
        trial_songs_remaining: entitlements.trialSongsRemaining,
        trial_expires_at: entitlements.trialExpiresAt?.toISOString() || null,
        preview_count_today: entitlements.previewCountToday,
        plan_id: entitlements.planId,
        billing_period: entitlements.billingPeriod,
        subscription_starts_at: entitlements.subscriptionStartsAt?.toISOString() || null,
        subscription_renews_at: entitlements.subscriptionRenewsAt?.toISOString() || null,
        auto_renew_enabled: subscription?.auto_renew_enabled || false,
        is_in_grace_period: subscription?.status === "grace_period" || false,
      });
    } catch (err) {
      console.error("[Billing] Error fetching billing entitlements:", err);
      sendError(reply, 500, "BILLING_ERROR", err.message);
    }
  });

  /**
   * Validate Apple receipt and sync subscription
   * POST /billing/receipt/apple
   */
  app.post("/billing/receipt/apple", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    const { transactionId } = request.body || {};

    if (!transactionId) {
      sendError(reply, 400, "MISSING_TRANSACTION_ID", "transactionId is required.");
      return;
    }

    if (!appleValidator.isConfigured()) {
      sendError(reply, 503, "APPLE_NOT_CONFIGURED", "Apple App Store validation not configured.");
      return;
    }

    try {
      // Validate with Apple
      const validation = await appleValidator.verifyTransaction(transactionId);

      if (!validation.valid) {
        sendError(reply, 400, "INVALID_RECEIPT", validation.error || "Receipt validation failed.");
        return;
      }

      // Sync subscription to database
      const result = await subscriptionManager.syncSubscription(userId, validation);

      // Add audit entry
      addAuditEntry({
        userId,
        action: "subscription_synced",
        resourceType: "subscription",
        resourceId: result.subscriptionId,
        metadata: {
          tier: result.tier,
          isNew: result.isNewSubscription,
          isRenewal: result.isRenewal,
          platform: "apple",
        },
      });

      // Fetch full entitlements after sync
      const entitlements = await subscriptionManager.getEntitlements(userId);
      const subscription = await subscriptionManager.getActiveSubscription(userId);

      reply.send({
        success: true,
        subscription: {
          id: result.subscriptionId,
          tier: result.tier,
          status: result.status,
          songs_granted: result.songsGranted,     // snake_case for iOS
          expires_at: result.expiresAt,           // snake_case for iOS
        },
        entitlements: {
          tier: entitlements?.tier || "free",
          songs_remaining: entitlements?.songsRemaining || 0,
          songs_allowance: entitlements?.songsAllowance || 0,
          songs_used_total: entitlements?.songsUsedTotal || 0,
          trial_songs_remaining: entitlements?.trialSongsRemaining || 0,
          trial_expires_at: entitlements?.trialExpiresAt?.toISOString() || null,
          preview_count_today: entitlements?.previewCountToday || 0,
          plan_id: subscription?.plan_id || null,
          billing_period: subscription?.billing_period || null,
          subscription_starts_at: subscription?.starts_at || null,
          subscription_renews_at: subscription?.renews_at || null,
          auto_renew_enabled: subscription?.auto_renew_enabled ?? false,
          is_in_grace_period: subscription?.status === "grace_period",
        },
      });
    } catch (err) {
      console.error("[Billing] Apple receipt validation error:", err);
      sendError(reply, 500, "VALIDATION_ERROR", err.message);
    }
  });

  /**
   * Validate Google Play receipt and sync subscription
   * POST /billing/receipt/google
   */
  app.post("/billing/receipt/google", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    // TODO: Implement Google Play validation when googleValidator is added
    sendError(reply, 501, "NOT_IMPLEMENTED", "Google Play validation not yet implemented.");
  });

  /**
   * Get available subscription plans (public endpoint for clients)
   * GET /billing/plans
   */
  app.get("/billing/plans", async (request, reply) => {
    try {
      const plans = await planConfigService.getPlans();
      const trialConfig = await planConfigService.getTrialConfig();

      // Filter to active plans and format for client consumption (snake_case for iOS)
      const activePlans = plans
        .filter((p) => p.is_active)
        .map((p) => ({
          id: p.id,
          name: p.name,
          tier: p.tier,
          songs_per_month: p.songs_per_month,
          previews_per_day: p.previews_per_day,
          price_monthly_cents: p.price_monthly_cents || null,  // Keep in cents!
          price_annual_cents: p.price_annual_cents || null,    // Keep in cents!
          description: p.description,
          features: parseJson(p.features_json, [], "plan_features"),
          is_active: p.is_active,
          sort_order: p.sort_order,
        }));

      reply.send({
        plans: activePlans,
        trial: trialConfig
          ? {
              songsAllowed: trialConfig.songs_allowed,
              durationDays: trialConfig.duration_days,
              isActive: Boolean(trialConfig.is_active),
            }
          : null,
      });
    } catch (err) {
      console.error("[Billing] Get plans error:", err);
      sendError(reply, 500, "PLANS_ERROR", err.message);
    }
  });

  /**
   * Get current subscription status
   * GET /billing/subscription-status
   */
  app.get("/billing/subscription-status", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    try {
      const subscription = await subscriptionManager.getActiveSubscription(userId);
      const entitlements = await subscriptionManager.getEntitlements(userId);

      reply.send({
        hasActiveSubscription: !!subscription,
        subscription: subscription
          ? {
              id: subscription.id,
              tier: subscription.tier,
              status: subscription.status,
              productId: subscription.product_id,
              platform: subscription.platform,
              expiresAt: subscription.expires_at,
              autoRenewEnabled: Boolean(subscription.auto_renew_enabled),
              isInGracePeriod: subscription.status === "grace_period",
              gracePeriodExpiresAt: subscription.grace_period_expires_at,
            }
          : null,
        entitlements: entitlements
          ? {
              tier: entitlements.tier,
              songsRemaining: entitlements.songsRemaining,
              songsAllowance: entitlements.songsAllowance,
              trialSongsRemaining: entitlements.trialSongsRemaining,
              trialExpiresAt: entitlements.trialExpiresAt,
              previewCountToday: entitlements.previewCountToday,
            }
          : null,
      });
    } catch (err) {
      console.error("[Billing] Get subscription status error:", err);
      sendError(reply, 500, "STATUS_ERROR", err.message);
    }
  });

  /**
   * Restore purchases from Apple/Google
   * POST /billing/restore
   */
  app.post("/billing/restore", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    const { platform, transactionId } = request.body || {};

    if (!platform || !transactionId) {
      sendError(reply, 400, "MISSING_PARAMS", "platform and transactionId are required.");
      return;
    }

    if (platform !== "apple" && platform !== "google") {
      sendError(reply, 400, "INVALID_PLATFORM", "platform must be 'apple' or 'google'.");
      return;
    }

    try {
      let validation;

      if (platform === "apple") {
        if (!appleValidator.isConfigured()) {
          sendError(reply, 503, "APPLE_NOT_CONFIGURED", "Apple App Store validation not configured.");
          return;
        }
        validation = await appleValidator.verifyTransaction(transactionId);
      } else {
        // Google Play - not yet implemented
        sendError(reply, 501, "NOT_IMPLEMENTED", "Google Play restore not yet implemented.");
        return;
      }

      if (!validation.valid) {
        sendError(reply, 400, "INVALID_RECEIPT", validation.error || "Receipt validation failed.");
        return;
      }

      // Sync subscription
      const result = await subscriptionManager.syncSubscription(userId, validation);

      addAuditEntry({
        userId,
        action: "subscription_restored",
        resourceType: "subscription",
        resourceId: result.subscriptionId,
        metadata: { platform, tier: result.tier },
      });

      reply.send({
        success: true,
        restored: true,
        subscription: {
          id: result.subscriptionId,
          tier: result.tier,
          status: result.status,
          expiresAt: result.expiresAt,
          songsRemaining: result.songsRemaining,
        },
      });
    } catch (err) {
      console.error("[Billing] Restore error:", err);
      sendError(reply, 500, "RESTORE_ERROR", err.message);
    }
  });

  /**
   * Activate free trial
   * POST /billing/trial/activate
   */
  app.post("/billing/trial/activate", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    try {
      const result = await subscriptionManager.activateTrial(userId);

      addAuditEntry({
        userId,
        action: "trial_activated",
        resourceType: "entitlements",
        resourceId: userId,
        metadata: {
          songsGranted: result.songsGranted,
          durationDays: result.durationDays,
        },
      });

      // Flat structure with snake_case for iOS ActivateTrialResponse
      reply.send({
        success: true,
        songs_granted: result.songsGranted,
        songs_remaining: result.songsRemaining,
        trial_expires_at: result.trialExpiresAt,  // iOS expects trial_expires_at
        duration_days: result.durationDays,
      });
    } catch (err) {
      console.error("[Billing] Trial activation error:", err);
      // Check for user-friendly errors
      if (err.message.includes("already used")) {
        sendError(reply, 409, "TRIAL_ALREADY_USED", err.message);
      } else if (err.message.includes("disabled")) {
        sendError(reply, 503, "TRIAL_DISABLED", err.message);
      } else {
        sendError(reply, 500, "TRIAL_ERROR", err.message);
      }
    }
  });

  /**
   * Apple App Store Server Notifications v2 webhook
   * POST /billing/webhooks/apple
   */
  app.post("/billing/webhooks/apple", async (request, reply) => {
    const { signedPayload } = request.body || {};

    if (!signedPayload) {
      console.error("[Apple Webhook] Missing signedPayload");
      return reply.status(400).send({ error: "Missing signedPayload" });
    }

    try {
      const result = await appleWebhookHandler.processNotification(signedPayload);

      if (!result.success) {
        console.error("[Apple Webhook] Processing failed:", result);
        return reply.status(400).send({
          error: result.error,
          message: result.message,
        });
      }

      console.log("[Apple Webhook] Processed notification:", {
        notificationType: result.notificationType,
        subtype: result.subtype,
        notificationUUID: result.notificationUUID,
        skipped: result.skipped,
        action: result.result?.action,
      });

      reply.send({
        received: true,
        notificationUUID: result.notificationUUID,
        processed: !result.skipped,
      });
    } catch (err) {
      console.error("[Apple Webhook] Error:", err);
      reply.status(500).send({ error: "Webhook processing error" });
    }
  });

  /**
   * Google Play Real-time Developer Notifications webhook
   * POST /billing/webhooks/google
   */
  app.post("/billing/webhooks/google", async (request, reply) => {
    // Note: Full webhook implementation in task 6.8
    // This is a placeholder that accepts and logs the notification

    console.log("[Google Webhook] Received notification (not yet implemented)");

    // TODO: Implement full webhook handling in task 6.8
    // For now, acknowledge receipt
    reply.send({ received: true });
  });

  /**
   * Admin: Grant songs to user
   * POST /admin/billing/grant-songs
   */
  app.post("/admin/billing/grant-songs", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    // TODO: Add proper admin authentication check
    // For now, we'll just check if the request has admin header
    const isAdmin = request.headers["x-admin-key"] === appConfig.ADMIN_SECRET_KEY;
    if (!isAdmin) {
      sendError(reply, 403, "FORBIDDEN", "Admin access required.");
      return;
    }

    const { targetUserId, amount, reason } = request.body || {};

    if (!targetUserId || !amount || amount <= 0) {
      sendError(reply, 400, "INVALID_PARAMS", "targetUserId and amount (positive) are required.");
      return;
    }

    try {
      const result = await subscriptionManager.adminGrantSongs(
        targetUserId,
        amount,
        reason || "Admin grant"
      );

      addAuditEntry({
        userId,
        action: "admin_grant_songs",
        resourceType: "entitlements",
        resourceId: targetUserId,
        metadata: { amount, reason, grantedBy: userId },
      });

      reply.send({
        success: true,
        songsGranted: result.songsGranted,
        songsRemaining: result.songsRemaining,
      });
    } catch (err) {
      console.error("[Admin] Grant songs error:", err);
      sendError(reply, 500, "GRANT_ERROR", err.message);
    }
  });

  /**
   * Admin: Get subscription plans
   * GET /admin/plans
   */
  app.get("/admin/plans", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    const isAdmin = request.headers["x-admin-key"] === appConfig.ADMIN_SECRET_KEY;
    if (!isAdmin) {
      sendError(reply, 403, "FORBIDDEN", "Admin access required.");
      return;
    }

    try {
      const plans = await planConfigService.getPlans({ includeInactive: true });
      const trialConfig = await planConfigService.getTrialConfig();

      reply.send({ plans, trialConfig });
    } catch (err) {
      console.error("[Admin] Get plans error:", err);
      sendError(reply, 500, "PLANS_ERROR", err.message);
    }
  });

  /**
   * Admin: Update trial configuration
   * PUT /admin/trial/config
   */
  app.put("/admin/trial/config", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    const isAdmin = request.headers["x-admin-key"] === appConfig.ADMIN_SECRET_KEY;
    if (!isAdmin) {
      sendError(reply, 403, "FORBIDDEN", "Admin access required.");
      return;
    }

    const { songs_allowed, duration_days, is_active } = request.body || {};

    try {
      const result = await planConfigService.updateTrialConfig({
        songs_allowed,
        duration_days,
        is_active,
      });

      addAuditEntry({
        userId,
        action: "admin_update_trial_config",
        resourceType: "trial_config",
        resourceId: "1",
        metadata: { songs_allowed, duration_days, is_active },
      });

      reply.send({ success: true, trialConfig: result });
    } catch (err) {
      console.error("[Admin] Update trial config error:", err);
      sendError(reply, 500, "UPDATE_ERROR", err.message);
    }
  });

  /**
   * Admin: Update a subscription plan
   * PUT /admin/plans/:planId
   */
  app.put("/admin/plans/:planId", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    const isAdmin = request.headers["x-admin-key"] === appConfig.ADMIN_SECRET_KEY;
    if (!isAdmin) {
      sendError(reply, 403, "FORBIDDEN", "Admin access required.");
      return;
    }

    const { planId } = request.params;
    const updates = request.body || {};

    // Allowed updates: name, songs_per_month, previews_per_day, price_monthly_cents, price_annual_cents, description, features_json, is_active, sort_order
    const allowedFields = [
      "name", "songs_per_month", "previews_per_day",
      "price_monthly_cents", "price_annual_cents",
      "description", "features_json", "is_active", "sort_order"
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

    try {
      const result = await planConfigService.updatePlan(planId, filteredUpdates);

      addAuditEntry({
        userId,
        action: "admin_update_plan",
        resourceType: "subscription_plan",
        resourceId: planId,
        metadata: filteredUpdates,
      });

      reply.send({ success: true, plan: result });
    } catch (err) {
      console.error("[Admin] Update plan error:", err);
      if (err.message.includes("not found")) {
        sendError(reply, 404, "PLAN_NOT_FOUND", err.message);
      } else {
        sendError(reply, 500, "UPDATE_ERROR", err.message);
      }
    }
  });

  /**
   * Admin: Add product mapping to a plan
   * POST /admin/plans/:planId/products
   */
  app.post("/admin/plans/:planId/products", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    const isAdmin = request.headers["x-admin-key"] === appConfig.ADMIN_SECRET_KEY;
    if (!isAdmin) {
      sendError(reply, 403, "FORBIDDEN", "Admin access required.");
      return;
    }

    const { planId } = request.params;
    const { platform, product_id, billing_period } = request.body || {};

    if (!platform || !product_id || !billing_period) {
      sendError(reply, 400, "MISSING_FIELDS", "platform, product_id, and billing_period are required.");
      return;
    }

    if (!["apple", "google"].includes(platform)) {
      sendError(reply, 400, "INVALID_PLATFORM", "platform must be 'apple' or 'google'.");
      return;
    }

    if (!["monthly", "annual"].includes(billing_period)) {
      sendError(reply, 400, "INVALID_BILLING_PERIOD", "billing_period must be 'monthly' or 'annual'.");
      return;
    }

    try {
      const result = await planConfigService.addProductMapping({
        plan_id: planId,
        platform,
        product_id,
        billing_period,
      });

      addAuditEntry({
        userId,
        action: "admin_add_product_mapping",
        resourceType: "plan_product",
        resourceId: result.id,
        metadata: { plan_id: planId, platform, product_id, billing_period },
      });

      reply.send({ success: true, productMapping: result });
    } catch (err) {
      console.error("[Admin] Add product mapping error:", err);
      if (err.message.includes("already exists")) {
        sendError(reply, 409, "DUPLICATE_MAPPING", err.message);
      } else {
        sendError(reply, 500, "ADD_ERROR", err.message);
      }
    }
  });

  /**
   * Admin: Remove product mapping
   * DELETE /admin/products/:platform/:productId
   */
  app.delete("/admin/products/:platform/:productId", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    const isAdmin = request.headers["x-admin-key"] === appConfig.ADMIN_SECRET_KEY;
    if (!isAdmin) {
      sendError(reply, 403, "FORBIDDEN", "Admin access required.");
      return;
    }

    const { platform, productId } = request.params;

    try {
      await planConfigService.removeProductMapping(platform, productId);

      addAuditEntry({
        userId,
        action: "admin_remove_product_mapping",
        resourceType: "plan_product",
        resourceId: productId,
        metadata: { platform, product_id: productId },
      });

      reply.send({ success: true });
    } catch (err) {
      console.error("[Admin] Remove product mapping error:", err);
      sendError(reply, 500, "REMOVE_ERROR", err.message);
    }
  });

  /**
   * Admin: Get products for a specific plan
   * GET /admin/plans/:planId/products
   */
  app.get("/admin/plans/:planId/products", async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    const isAdmin = request.headers["x-admin-key"] === appConfig.ADMIN_SECRET_KEY;
    if (!isAdmin) {
      sendError(reply, 403, "FORBIDDEN", "Admin access required.");
      return;
    }

    const { planId } = request.params;

    try {
      const products = await planConfigService.getProductsForPlan(planId);
      reply.send({ products });
    } catch (err) {
      console.error("[Admin] Get plan products error:", err);
      sendError(reply, 500, "GET_ERROR", err.message);
    }
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
  const storage = createStorageProvider({
    ...config,
    STREAM_BASE_URL: config.STREAM_BASE_URL,
  });
  const saveTimer = setInterval(() => db.save(), 2000);
  // Start file cleanup job for expired enrollment sessions
  const fileCleanupJob = startCleanupJob({
    db,
    storageDir: config.STORAGE_DIR,
    storageProvider: storage,
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

  // Create billing services once, share with both server and job runner
  const planConfigService = createPlanConfigService(db);
  const appleValidator = createAppleReceiptValidator({
    keyId: config.APPLE_APP_STORE_KEY_ID,
    issuerId: config.APPLE_APP_STORE_ISSUER_ID,
    privateKey: config.APPLE_APP_STORE_PRIVATE_KEY,
    bundleId: config.APPLE_BUNDLE_ID,
    environment: config.APPLE_ENVIRONMENT || "production",
  });
  const subscriptionManager = createSubscriptionManager(db, {
    planConfigService,
    appleValidator,
  });
  const appleWebhookHandler = createAppleWebhookHandler(db, {
    subscriptionManager,
    appleValidator,
    planConfigService,
  });
  const billingServices = { planConfigService, appleValidator, subscriptionManager, appleWebhookHandler };

  const app = buildServer({ db, config: { ...config, providerStatus }, storage, billingServices });
  app.log.info({ providers: providerStatus }, "provider status");
  let jobRunner;
  if (config.INLINE_JOB_RUNNER) {
    jobRunner = startJobRunner({
      db,
      storageDir: config.STORAGE_DIR,
      streamBaseUrl: config.STREAM_BASE_URL,
      intervalMs: 1000,
      providerConfig,
      devMode: config.DEV_MODE,
      storageProvider: storage,
      subscriptionManager, // Pass for song spending on full render
    });
  }

  // Start subscription sync job (catches missed webhooks, handles renewals)
  const subscriptionSyncJob = startSubscriptionSyncJob({
    db,
    subscriptionManager,
    appleValidator,
    intervalMs: config.SUBSCRIPTION_SYNC_INTERVAL_MS || 60 * 60 * 1000, // Default: 1 hour
  });

  app.addHook("onClose", async () => {
    clearInterval(saveTimer);
    clearInterval(cleanupTimer);
    fileCleanupJob.stop();
    subscriptionSyncJob.stop();
    if (jobRunner) {
      jobRunner.stop();
    }
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
