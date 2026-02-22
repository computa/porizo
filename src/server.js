const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const fastify = require("fastify");
const QRCode = require("qrcode");
const { getDatabase } = require("./database");
const config = require("./config");
const { moderationCheck, validateGeneratedLyrics } = require("./providers/moderation");
const { generateLyrics } = require("./providers/lyrics");
const { extractEmbedding } = require("./providers/replicate");
const { downloadToFile } = require("./providers/http");
const { concatWavFiles, parseWavBuffer } = require("./utils/audio");
const { createHLSPlaylist } = require("./utils/hls");
const { generateShareMp4 } = require("./utils/ffmpeg");
const { stableStringify } = require("./utils/stable-json");
const { newUuid, newShareId } = require("./utils/ids");
const { ensureDir, parseJson, toJson, nowIso } = require("./utils/common");
const { extractPolicyTermsFromMessage, expandPolicyTermVariants } = require("./utils/policy-terms");
const { validateEnrollmentWithGrading } = require("./services/enrollment");
const { getTierMetadata } = require("./services/audio-quality");
const { generateMemoryQuestions } = require("./services/memory-questions");
const {
  createStorageProvider,
  enrollmentChunkKey,
  enrollmentCleanKey,
  trackPreviewKey,
  trackMasterKey,
  trackVersionKey,
} = require("./storage");
// extractEmbedding will be called asynchronously by a background job
const { startCleanupJob } = require("./jobs/cleanup");
const { startSubscriptionSyncJob } = require("./jobs/subscription-sync");
const { startGiftDispatchJob } = require("./jobs/gift-dispatch");
const { startJobRunner, cleanStaleStepFiles } = require("./workflows/runner");
// Billing services
const { createAppleReceiptValidator } = require("./services/apple-receipt-validator");
const { createGoogleReceiptValidator } = require("./services/google-receipt-validator");
const { createAppleWebhookHandler } = require("./services/apple-webhook-handler");
const { createPlanConfigService } = require("./services/plan-config");
const { createSubscriptionManager } = require("./services/subscription-manager");
const authService = require("./services/auth-service");
const { issueDeviceToken, verifyDeviceToken } = require("./services/device-token");
const { registerAuthRoutes } = require("./routes/auth");
const { registerLegalRoutes } = require("./routes/legal");
const { registerStoryRoutes } = require("./routes/story");
const { createStoryRepository } = require("./database/story-repository");
const writer = require("./writer");
const { AdminService } = require("./services/admin-service");
const adminAuthService = require("./services/admin-auth-service");
const { createEventsService } = require("./services/events-service");
const { getFeatureFlag } = require("./services/feature-flags");
const { generatePoem } = require("./services/poem-generator");
const { generatePoemOgImage } = require("./services/poem-og-generator");
const { generateSongOgImage } = require("./services/song-og-generator");
const emailService = require("./services/email-service");
const { createHealthCheckService } = require("./workflows/health-check");
const { buildTrackVersionUrls } = require("./services/track-urls");
const { refreshAppleToken } = require("./services/apple-signin");
const { analyzeBlend, formatAnalysisReport } = require("./utils/blend-analyzer");

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

  // Cache HTML templates at startup to avoid readFileSync on every request
  const webPlayerTemplate = fs.readFileSync(path.join(process.cwd(), "web-player", "index.html"), "utf-8");
  const poemViewerTemplate = fs.readFileSync(path.join(process.cwd(), "poem-viewer", "index.html"), "utf-8");
  const embedPlayerTemplate = fs.readFileSync(path.join(process.cwd(), "embed-player", "index.html"), "utf-8");

  if (!storage) {
    throw new Error("Storage provider is required.");
  }
  const storageProvider = storage;
  const allowAnonUserId =
    appConfig.ALLOW_ANON_USER_ID ?? config.ALLOW_ANON_USER_ID ?? false;
  const enableDebugRoutes =
    appConfig.ENABLE_DEBUG_ROUTES ?? config.ENABLE_DEBUG_ROUTES ?? false;
  const enableV3OrchestrationRoutes =
    appConfig.ENABLE_V3_ORCHESTRATION_ROUTES ??
    config.ENABLE_V3_ORCHESTRATION_ROUTES ??
    false;
  const orchestrationExecutorMode =
    appConfig.ORCHESTRATION_EXECUTOR_MODE ??
    config.ORCHESTRATION_EXECUTOR_MODE ??
    "local";
  const orchestrationExternalCommandJson =
    appConfig.ORCHESTRATION_EXTERNAL_COMMAND_JSON ??
    config.ORCHESTRATION_EXTERNAL_COMMAND_JSON ??
    "";
  const orchestrationExternalTimeoutMs =
    appConfig.ORCHESTRATION_EXTERNAL_TIMEOUT_MS ??
    config.ORCHESTRATION_EXTERNAL_TIMEOUT_MS ??
    120000;
  const storyEngineDefault =
    appConfig.STORY_ENGINE_DEFAULT ??
    config.STORY_ENGINE_DEFAULT ??
    "v3";
  const requireS3 =
    appConfig.REQUIRE_S3 ?? config.REQUIRE_S3 ?? false;
  const allowDeviceTokenFallback =
    appConfig.ALLOW_DEVICE_TOKEN_FALLBACK ?? config.ALLOW_DEVICE_TOKEN_FALLBACK ?? false;
  const deviceTokenTtlDays = Number(process.env.DEVICE_TOKEN_TTL_DAYS || 30);
  const giftTokenProductId =
    appConfig.GIFT_TOKEN_PRODUCT_ID ||
    config.GIFT_TOKEN_PRODUCT_ID ||
    "com.porizo.gift_token_oneoff";
  const giftDispatchMaxAttempts = Number(
    appConfig.GIFT_DISPATCH_MAX_ATTEMPTS ??
    config.GIFT_DISPATCH_MAX_ATTEMPTS ??
    5
  );
  const shareVideoMaxDurationSec = Number(
    appConfig.SHARE_VIDEO_MAX_DURATION_SEC ??
    config.SHARE_VIDEO_MAX_DURATION_SEC ??
    0
  );
  const facebookAppId =
    appConfig.FACEBOOK_APP_ID ||
    config.FACEBOOK_APP_ID ||
    "";
  const shareCoverVersion =
    appConfig.SHARE_COVER_VERSION ||
    config.SHARE_COVER_VERSION ||
    "2";

  if (requireS3 && storageProvider.type !== "s3") {
    throw new Error("REQUIRE_S3 is enabled but storage provider is not S3.");
  }

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
  const googleValidator = billingServices?.googleValidator || createGoogleReceiptValidator({
    packageName: appConfig.GOOGLE_PLAY_PACKAGE_NAME,
    credentials: appConfig.GOOGLE_PLAY_CREDENTIALS_JSON,
  });
  const subscriptionManager = billingServices?.subscriptionManager || createSubscriptionManager(db, {
    planConfigService,
    appleValidator,
    googleValidator,
  });

  const appleWebhookHandler = billingServices?.appleWebhookHandler || createAppleWebhookHandler(db, {
    subscriptionManager,
    appleValidator,
    planConfigService,
  });

  // Initialize auth service for JWT verification
  authService.initialize(db);
  const jwtFingerprint = authService.getJwtFingerprint?.();
  if (jwtFingerprint) {
    app.log.info({ jwt: jwtFingerprint }, "JWT config fingerprint");
  }

  // Initialize story repository for persistent story sessions
  const storyRepository = createStoryRepository(db);
  writer.initWithRepository(storyRepository);

  // Initialize events service for unified telemetry
  const eventsService = createEventsService(db);
  // In-process lock table to dedupe concurrent poem TTS generation per poem.
  const poemAudioGenerationLocks = new Map();

  // Register static file serving for debug page (guarded)
  if (enableDebugRoutes) {
    app.register(require("@fastify/static"), {
      root: path.join(process.cwd(), "public"),
      prefix: "/",
    });
  }

  // Register web-player static files
  app.register(require("@fastify/static"), {
    root: path.join(process.cwd(), "web-player"),
    prefix: "/web-player/",
    decorateReply: false, // Avoid decorator conflict with first registration
  });

  // Register poem-viewer static files
  app.register(require("@fastify/static"), {
    root: path.join(process.cwd(), "poem-viewer"),
    prefix: "/poem-viewer/",
    decorateReply: false,
  });

  // Register embed-player static files
  app.register(require("@fastify/static"), {
    root: path.join(process.cwd(), "embed-player"),
    prefix: "/embed-player/",
    decorateReply: false,
  });

  // Register admin dashboard static files (always enabled, independent of debug routes)
  // wildcard: false prevents @fastify/static from registering its own /admin/* handler,
  // allowing our SPA catch-all route to handle client-side routing
  app.register(require("@fastify/static"), {
    root: path.join(process.cwd(), "public/admin"),
    prefix: "/admin/",
    decorateReply: false, // Avoid decorator conflict
    wildcard: false, // Disable automatic wildcard - we handle SPA routing manually
  });

  // Register public assets for landing page (CSS, images, favicon)
  app.register(require("@fastify/static"), {
    root: path.join(process.cwd(), "public/styles"),
    prefix: "/styles/",
    decorateReply: false,
  });
  app.register(require("@fastify/static"), {
    root: path.join(process.cwd(), "public/assets"),
    prefix: "/assets/",
    decorateReply: false,
  });

  // Apple App Site Association for universal links (explicit route for correct MIME type)
  const aasaJson = JSON.stringify({
    applinks: {
      apps: [],
      details: [{
        appID: "5VCH6937XM.com.porizo.PorizoApp",
        paths: ["/play/*", "/s/*", "/poem/*"],
      }],
    },
  });
  app.get("/.well-known/apple-app-site-association", async (request, reply) => {
    return reply.type("application/json").send(aasaJson);
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
  registerLegalRoutes(app);
  registerAuthRoutes(app, { db });

  // ============ Input Validation Schemas ============
  const schemas = {
    deviceRegister: {
      body: {
        type: "object",
        properties: {
          device_id: { type: "string", maxLength: 128 },
          platform: { type: "string", maxLength: 32 },
          app_version: { type: "string", maxLength: 32 },
          push_token: { type: "string", maxLength: 256 },
        },
        required: ["device_id", "platform"],
        additionalProperties: false,
      },
    },
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
          message: { type: "string", maxLength: 3000 },
          // Story context fields for enhanced lyrics generation
          relationship_type: { type: "string", maxLength: 50 },
          years_known: { type: "integer", minimum: 0, maximum: 100 },
          specific_memory: { type: "string", maxLength: 2000 },
          special_phrases: { type: "string", maxLength: 500 },
          what_makes_them_special: { type: "string", maxLength: 2000 },
          // AI-generated follow-up question answers
          memory_answers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                question_id: { type: "string", maxLength: 20 },
                question: { type: "string", maxLength: 500 },
                answer: { type: "string", maxLength: 1000 },
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
        properties: {
          device_id: { type: "string", minLength: 1, maxLength: 255 },
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

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatOccasion(occasion) {
    const map = {
      birthday: "birthday",
      anniversary: "anniversary",
      i_love_you: "love",
      wedding: "wedding",
      graduation: "graduation",
      christmas: "Christmas",
      valentines: "Valentine's Day",
      mothers_day: "Mother's Day",
      fathers_day: "Father's Day",
      thank_you: "thank you",
      celebration: "celebration",
      apology: "apology",
      encouragement: "encouragement",
      bereavement: "remembrance",
      custom: "",
    };
    return map[occasion] || "";
  }

  function shareNotFoundHtml(type) {
    const label = type === "poem" ? "Poem" : "Song";
    const desc = type === "poem" ? "poem link" : "share link";
    return `<!DOCTYPE html>
<html><head><title>Not Found | Porizo</title></head>
<body style="font-family:system-ui;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
  <div style="text-align:center;padding:24px;">
    <h1 style="margin-bottom:16px;">${label} Not Found</h1>
    <p style="color:#a3a3a3;">This ${desc} doesn't exist or has been removed.</p>
  </div>
</body></html>`;
  }

  const SOCIAL_CRAWLER_UA_REGEX = /(facebookexternalhit|facebot|twitterbot|slackbot|discordbot|linkedinbot|whatsapp|telegrambot|pinterest|skypeuripreview)/i;

  function isSocialCrawlerUserAgent(userAgent) {
    if (!userAgent || typeof userAgent !== "string") {
      return false;
    }
    return SOCIAL_CRAWLER_UA_REGEX.test(userAgent);
  }

  async function withTimeout(promise, timeoutMs) {
    let timeoutId = null;
    const timeoutPromise = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve(null), timeoutMs);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function injectOgTags(html, {
    ogTitle,
    ogDescription,
    ogImage,
    ogImageWidth,
    ogImageHeight,
    ogUrl,
    ogType,
    ogVideo,
    embedUrl,
    oembedUrl,
    fbAppId,
  }) {
    const hasVideo = Boolean(ogVideo);
    const escapedVideo = escapeHtml(ogVideo || "");
    const escapedEmbedUrl = escapeHtml(embedUrl || "");
    const ogVideoMeta = hasVideo
      ? [
          "<!-- og:video for iMessage/Discord inline playback -->",
          `<meta property="og:video" content="${escapedVideo}">`,
          `<meta property="og:video:url" content="${escapedVideo}">`,
          `<meta property="og:video:secure_url" content="${escapedVideo}">`,
          "<meta property=\"og:video:type\" content=\"video/mp4\">",
          "<meta property=\"og:video:width\" content=\"1280\">",
          "<meta property=\"og:video:height\" content=\"1280\">",
        ].join("\n  ")
      : "";
    const twitterCardType = hasVideo ? "player" : "summary_large_image";
    const twitterPlayerMeta = hasVideo
      ? [
          `<meta name="twitter:player" content="${escapedEmbedUrl}">`,
          "<meta name=\"twitter:player:width\" content=\"480\">",
          "<meta name=\"twitter:player:height\" content=\"180\">",
          `<meta name="twitter:player:stream" content="${escapedVideo}">`,
          "<meta name=\"twitter:player:stream:content_type\" content=\"video/mp4\">",
        ].join("\n  ")
      : "";
    const fbAppIdMeta = fbAppId
      ? `<meta property="fb:app_id" content="${escapeHtml(String(fbAppId))}">`
      : "";
    return html
      .replaceAll("{{OG_TITLE}}", escapeHtml(ogTitle))
      .replaceAll("{{OG_DESCRIPTION}}", escapeHtml(ogDescription))
      .replaceAll("{{OG_IMAGE}}", escapeHtml(ogImage))
      .replaceAll("{{OG_IMAGE_WIDTH}}", escapeHtml(String(ogImageWidth)))
      .replaceAll("{{OG_IMAGE_HEIGHT}}", escapeHtml(String(ogImageHeight)))
      .replaceAll("{{OG_URL}}", escapeHtml(ogUrl))
      .replaceAll("{{OG_TYPE}}", escapeHtml(ogType || "website"))
      .replaceAll("{{OG_VIDEO_META}}", ogVideoMeta)
      .replaceAll("{{TWITTER_CARD_TYPE}}", twitterCardType)
      .replaceAll("{{TWITTER_PLAYER_META}}", twitterPlayerMeta)
      .replaceAll("{{OEMBED_URL}}", escapeHtml(oembedUrl || ""))
      .replaceAll("{{FB_APP_ID_META}}", fbAppIdMeta);
  }

  async function ensureUser(userId) {
    const existing = await db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
    if (!existing) {
      console.log(`[ensureUser] Creating new user: ${userId}`);
      await db.prepare(
        "INSERT INTO users (id, created_at, risk_level) VALUES (?, ?, 'low')"
      ).run(userId, nowIso());
    }
    const entitlements = await db
      .prepare("SELECT user_id FROM entitlements WHERE user_id = ?")
      .get(userId);
    if (!entitlements) {
      console.log(`[ensureUser] Creating entitlements for user: ${userId}`);
      await db.prepare(
        "INSERT INTO entitlements (user_id, tier, credits_balance, credits_used_total, preview_count_today, preview_count_reset_at, updated_at) VALUES (?, 'free', 1, 0, 0, ?, ?)"
      ).run(userId, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), nowIso());
    }
  }

  async function getUserRiskLevel(userId) {
    const user = await db.prepare("SELECT risk_level FROM users WHERE id = ?").get(userId);
    return user?.risk_level || "low";
  }

  async function requireUserId(request, reply) {
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      try {
        const payload = authService.verifyAccessToken(token);
        const userId = payload?.sub;
        if (!userId) {
          sendError(reply, 401, "INVALID_TOKEN", "Invalid access token.");
          return null;
        }
        await ensureUser(userId);
        return userId;
      } catch (err) {
        request.log.warn(
          {
            authError: {
              name: err?.name,
              message: err?.message,
              code: err?.code,
            },
          },
          "Access token verification failed"
        );
        sendError(reply, 401, "INVALID_TOKEN", "Invalid or expired access token.");
        return null;
      }
    }

    if (allowAnonUserId) {
      const userId = request.headers["x-user-id"];
      if (!userId || typeof userId !== "string") {
        sendError(reply, 401, "AUTH_REQUIRED", "Missing x-user-id header.");
        return null;
      }
      await ensureUser(userId);
      return userId;
    }

    sendError(reply, 401, "AUTH_REQUIRED", "Missing authorization token.");
    return null;
  }

  function getDeviceTokenPayload(request, reply, { required = false } = {}) {
    const rawToken = request.headers["x-device-token"];
    if (!rawToken || typeof rawToken !== "string") {
      if (allowDeviceTokenFallback) {
        const fallbackDeviceId = request.headers["x-device-id"];
        const fallbackPlatform = request.headers["x-platform"];
        if (fallbackDeviceId && fallbackPlatform) {
          return {
            device_id: fallbackDeviceId,
            platform: fallbackPlatform,
            app_version: request.headers["x-app-version"] || null,
            sub: request.headers["x-user-id"] || null,
          };
        }
      }
      if (required) {
        sendError(reply, 401, "DEVICE_TOKEN_REQUIRED", "Missing x-device-token header.");
      }
      return null;
    }
    try {
      return verifyDeviceToken(rawToken);
    } catch (err) {
      if (required) {
        sendError(reply, 401, "INVALID_DEVICE_TOKEN", "Invalid or expired device token.");
      }
      return null;
    }
  }

  function getBaseUrl(request) {
    const proto = request.headers["x-forwarded-proto"] || "http";
    const host = request.headers["host"];
    if (host) {
      return `${proto}://${host}`;
    }
    return appConfig.STREAM_BASE_URL;
  }

  function buildShareAppDownloadUrl({ shareId, kind = "song" }) {
    const deepLinkPath = kind === "poem" ? `porizo:///poem/${shareId}` : `porizo:///play/${shareId}`;
    const query = new URLSearchParams({
      channel: "testflight",
      deep_link: deepLinkPath,
    });
    return `${publicBaseUrl}/download?${query.toString()}`;
  }

  function buildShareCoverUrl(shareId) {
    const versionQuery = shareCoverVersion ? `?v=${encodeURIComponent(String(shareCoverVersion))}` : "";
    return `${publicBaseUrl}/share/${shareId}/cover.jpg${versionQuery}`;
  }

  function asBool(value) {
    return value === true || value === 1 || value === "1" || value === "t";
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

  function sendMediaFile(request, reply, filePath, contentType, options = {}) {
    // Use try-catch to handle race condition where file disappears between checks
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (err) {
      if (err.code === "ENOENT") {
        sendError(reply, 404, "AUDIO_NOT_FOUND", "Audio file not found.");
      } else {
        console.error(`[sendMediaFile] Failed to stat file: ${filePath}`, err.message);
        sendError(reply, 500, "FILE_ACCESS_ERROR", "Unable to access audio file.");
      }
      return;
    }

    // Generate ETag from file mtime for cache validation
    const etag = `"${stat.mtime.getTime()}-${stat.size}"`;
    const lastModified = stat.mtime.toUTCString();

    // Helper to normalize ETags (strip W/ weak prefix for comparison)
    const normalizeEtag = (tag) => tag ? tag.replace(/^W\//, "") : null;

    // Check If-None-Match for 304 Not Modified response
    const clientEtag = request.headers["if-none-match"];
    if (clientEtag && normalizeEtag(clientEtag) === normalizeEtag(etag)) {
      reply.code(304).send();
      return;
    }

    // Fallback to If-Modified-Since if no ETag sent
    const ifModifiedSince = request.headers["if-modified-since"];
    if (!clientEtag && ifModifiedSince) {
      const clientDate = new Date(ifModifiedSince);
      if (!isNaN(clientDate.getTime()) && clientDate >= stat.mtime) {
        reply.code(304).send();
        return;
      }
    }

    // Set caching headers - default for versioned media; override allowed for private endpoints.
    const immutableStr = config.AUDIO_CACHE_IMMUTABLE ? ", immutable" : "";
    const cacheControl = options.cacheControl
      || `public, max-age=${config.AUDIO_CACHE_MAX_AGE_SEC}${immutableStr}`;
    const cacheHeaders = {
      "Cache-Control": cacheControl,
      "ETag": etag,
      "Last-Modified": lastModified,
    };

    const range = request.headers.range;
    if (!range) {
      const buffer = fs.readFileSync(filePath);
      reply
        .type(contentType)
        .header("Content-Length", buffer.length)
        .header("Accept-Ranges", "bytes")
        .headers(cacheHeaders)
        .send(buffer);
      return;
    }
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (!match) {
      reply
        .type(contentType)
        .header("Content-Length", stat.size)
        .header("Accept-Ranges", "bytes")
        .headers(cacheHeaders)
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
    // Read range into buffer instead of streaming to fix Content-Length handling
    const rangeSize = end - start + 1;
    const buffer = Buffer.alloc(rangeSize);
    const fd = fs.openSync(filePath, "r");
    try {
      fs.readSync(fd, buffer, 0, rangeSize, start);
    } finally {
      fs.closeSync(fd);
    }

    reply
      .code(206)
      .type(contentType)
      .header("Content-Range", `bytes ${start}-${end}/${stat.size}`)
      .header("Accept-Ranges", "bytes")
      .header("Content-Length", rangeSize)
      .headers(cacheHeaders)
      .send(buffer);
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
    const missingChunks = [];
    let tempDir = null;
    if (storageProvider.type !== "local") {
      tempDir = fs.mkdtempSync(path.join(appConfig.STORAGE_DIR, "tmp-enrollment-"));
    }

    for (const chunkId of chunkIds) {
      const key = enrollmentChunkKey({ userId, sessionId: session.id, chunkId });
      const exists = await storageProvider.objectExists({ key });

      if (!exists) {
        missingChunks.push({ chunkId, key });
        continue;
      }
      if (storageProvider.resolveLocalPath) {
        files.push(storageProvider.resolveLocalPath(key));
        continue;
      }
      const localPath = path.join(tempDir, `${chunkId}.wav`);
      await storageProvider.downloadToFile({ key, filePath: localPath });
      files.push(localPath);
    }

    if (missingChunks.length > 0) {
      console.warn("[Enrollment:resolve] Missing chunks:", {
        sessionId: session.id,
        missing: missingChunks.map(c => c.chunkId),
      });
    }

    return { files, tempDir, missingChunks };
  }

  async function ensureShareHls({ share, track, trackVersion }) {
    const versionDir = getVersionDir(track, trackVersion);
    const hlsDir = path.join(versionDir, "hls", `share_${share.id}`);
    const playlistPath = path.join(hlsDir, "playlist.m3u8");
    if (!fs.existsSync(playlistPath)) {
      const fullPath = path.join(versionDir, "full.m4a");
      const previewPath = path.join(versionDir, "preview.m4a");
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

  function shareVideoKeyForTrackVersion(track, trackVersion) {
    return `${trackVersionKey({
      userId: track.user_id,
      trackId: track.id,
      versionNum: trackVersion.version_num,
    })}/share.mp4`;
  }

  async function ensureLocalFileFromStorage({ key, localPath }) {
    if (fs.existsSync(localPath)) {
      return true;
    }
    if (storageProvider.type === "local") {
      return false;
    }
    try {
      const exists = await storageProvider.objectExists({ key });
      if (!exists) {
        return false;
      }
      ensureDir(path.dirname(localPath));
      await storageProvider.downloadToFile({ key, filePath: localPath });
      return fs.existsSync(localPath);
    } catch (err) {
      console.error(`[ensureLocalFileFromStorage] Failed for key ${key}:`, err.message);
      return false;
    }
  }

  async function isShareMp4Ready({ track, trackVersion }) {
    const versionDir = getVersionDir(track, trackVersion);
    const mp4Path = path.join(versionDir, "share.mp4");
    if (fs.existsSync(mp4Path)) {
      return true;
    }
    if (storageProvider.type === "local") {
      return false;
    }
    try {
      return await storageProvider.objectExists({ key: shareVideoKeyForTrackVersion(track, trackVersion) });
    } catch (err) {
      console.error(
        `[isShareMp4Ready] Failed to check storage existence for track ${track?.id || "unknown"}:`,
        err.message
      );
      return false;
    }
  }

  async function ensureShareMp4({ track, trackVersion }) {
    const versionDir = getVersionDir(track, trackVersion);
    const mp4Path = path.join(versionDir, "share.mp4");
    const shareVideoKey = shareVideoKeyForTrackVersion(track, trackVersion);
    if (fs.existsSync(mp4Path)) {
      return mp4Path;
    }
    // If this server instance was restarted, recover pre-generated share.mp4 from object storage.
    if (storageProvider.type !== "local") {
      const downloaded = await ensureLocalFileFromStorage({ key: shareVideoKey, localPath: mp4Path });
      if (downloaded) {
        return mp4Path;
      }
    }

    const fullPath = path.join(versionDir, "full.m4a");
    const previewPath = path.join(versionDir, "preview.m4a");
    let audioPath = fs.existsSync(fullPath)
      ? fullPath
      : (fs.existsSync(previewPath) ? previewPath : null);

    if (!audioPath && storageProvider.type !== "local") {
      const fullKey = trackMasterKey({
        userId: track.user_id,
        trackId: track.id,
        versionNum: trackVersion.version_num,
        format: "m4a",
      });
      const previewKey = trackPreviewKey({
        userId: track.user_id,
        trackId: track.id,
        versionNum: trackVersion.version_num,
      });
      if (trackVersion.full_url) {
        await ensureLocalFileFromStorage({ key: fullKey, localPath: fullPath });
      }
      if (!fs.existsSync(fullPath)) {
        await ensureLocalFileFromStorage({ key: previewKey, localPath: previewPath });
      }
      audioPath = fs.existsSync(fullPath)
        ? fullPath
        : (fs.existsSync(previewPath) ? previewPath : null);
    }

    if (!audioPath) {
      return null;
    }

    // Prefer local cover art; if missing, recover from object storage, then fall back to default OG image.
    const artworkPath = path.join(versionDir, "cover_1024.jpg");
    const fallbackArtwork = path.join(process.cwd(), "public", "assets", "og-song.png");
    if (!fs.existsSync(artworkPath) && storageProvider.type !== "local") {
      const coverKey = `${trackVersionKey({
        userId: track.user_id,
        trackId: track.id,
        versionNum: trackVersion.version_num,
      })}/cover_1024.jpg`;
      await ensureLocalFileFromStorage({ key: coverKey, localPath: artworkPath });
    }

    const resolvedArtwork = fs.existsSync(artworkPath) ? artworkPath : fallbackArtwork;
    if (!fs.existsSync(resolvedArtwork)) {
      return null;
    }
    try {
      await generateShareMp4({
        artworkPath: resolvedArtwork,
        audioPath,
        outputPath: mp4Path,
        maxDuration: shareVideoMaxDurationSec,
      });
      if (storageProvider.type !== "local") {
        try {
          await storageProvider.putFile({
            key: shareVideoKey,
            filePath: mp4Path,
            contentType: "video/mp4",
          });
        } catch (uploadErr) {
          console.error(
            `[ensureShareMp4] Generated local MP4 but failed upload for track ${track.id}:`,
            uploadErr.message
          );
        }
      }
      return mp4Path;
    } catch (err) {
      console.error(`[ensureShareMp4] MP4 generation failed for track ${track.id}:`, err.message);
      return null;
    }
  }

  function computeParamsHash(params) {
    const payload = stableStringify(params || {});
    return crypto.createHash("sha256").update(payload).digest("hex");
  }

  async function consumeRateLimit(userId, actionKey, limit, windowSeconds) {
    // Sliding window rate limiting (prevents boundary exploit)
    // Uses weighted average of current and previous window counts
    try {
      const now = Date.now();
      const windowMs = windowSeconds * 1000;
      const currentWindowStart = Math.floor(now / windowMs) * windowMs;
      const previousWindowStart = currentWindowStart - windowMs;
      const elapsedInWindow = now - currentWindowStart;
      const windowProgress = elapsedInWindow / windowMs; // 0.0 to 1.0
      const resetAt = new Date(currentWindowStart + windowMs).toISOString();

      // Get counts from current and previous windows
      const currentWindow = await db.prepare(
        "SELECT count FROM rate_limits WHERE user_id = ? AND action_type = ? AND window_start_ms = ?"
      ).get(userId, actionKey, currentWindowStart);
      const previousWindow = await db.prepare(
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

      // Atomic upsert using PostgreSQL ON CONFLICT
      await db.prepare(
        `INSERT INTO rate_limits (user_id, action_type, window_start_ms, window_seconds, count, limit_count)
         VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT(user_id, action_type, window_start_ms)
         DO UPDATE SET count = rate_limits.count + 1`
      ).run(userId, actionKey, currentWindowStart, windowSeconds, limit);

      // Get updated count for remaining calculation
      const updated = await db.prepare(
        "SELECT count FROM rate_limits WHERE user_id = ? AND action_type = ? AND window_start_ms = ?"
      ).get(userId, actionKey, currentWindowStart);
      const newWeightedCount = updated.count + previousCount * (1 - windowProgress);
      return {
        allowed: true,
        remaining: Math.max(0, Math.floor(limit - newWeightedCount)),
        reset_at: resetAt,
      };
    } catch (err) {
      console.error("[RateLimit] DB error:", err.message);
      // Return safe fallback instead of crashing - callers should check for error field
      return {
        allowed: false,
        remaining: 0,
        reset_at: null,
        error: "RATE_LIMIT_UNAVAILABLE",
      };
    }
  }

  async function consumePreviewEntitlement(userId) {
    const riskLevel = await getUserRiskLevel(userId);
    if (riskLevel === "blocked") {
      return { allowed: false, reset_at: null, reason: "BLOCKED" };
    }
    if (riskLevel === "high") {
      return { allowed: false, reset_at: null, reason: "HIGH_RISK" };
    }

    // Get user's tier from entitlements to determine daily limit
    const entRow = await db.prepare("SELECT tier FROM entitlements WHERE user_id = ?").get(userId);
    const tier = entRow?.tier || "free";

    // Daily preview limits by tier (matches subscription_plans table)
    // -1 means unlimited
    const tierLimits = { free: 5, plus: 20, pro: -1 };
    const dailyLimit = tierLimits[tier] ?? 5;

    // Pro tier has unlimited previews
    if (dailyLimit === -1) {
      // Just track usage for analytics, no limit
      const nowStr = nowIso();
      await db.prepare(
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
    await db.prepare(
      "UPDATE entitlements SET preview_count_today = 0, preview_count_reset_at = ? WHERE user_id = ? AND (preview_count_reset_at IS NULL OR preview_count_reset_at <= ?)"
    ).run(newResetAt, userId, nowStr);

    // Log current state before update
    const currentState = await db.prepare("SELECT preview_count_today, preview_count_reset_at, tier FROM entitlements WHERE user_id = ?").get(userId);
    console.log(`[consumePreviewEntitlement] User ${userId}: current=${currentState?.preview_count_today}, limit=${effectiveLimit}, tier=${tier}, resetAt=${currentState?.preview_count_reset_at}`);

    // Atomic UPDATE with condition - only increments if under limit
    const result = await db.prepare(
      "UPDATE entitlements SET preview_count_today = preview_count_today + 1, updated_at = ? WHERE user_id = ? AND preview_count_today < ?"
    ).run(nowStr, userId, effectiveLimit);

    if (result.changes === 0) {
      // Check why UPDATE failed - could be limit reached OR row doesn't exist
      const ent = await db.prepare("SELECT preview_count_today, preview_count_reset_at FROM entitlements WHERE user_id = ?").get(userId);

      if (!ent) {
        // Row doesn't exist - this shouldn't happen if ensureUser was called, but handle defensively
        console.error(`[consumePreviewEntitlement] Missing entitlements row for user ${userId}, creating now`);
        await db.prepare(
          "INSERT INTO entitlements (user_id, tier, credits_balance, credits_used_total, preview_count_today, preview_count_reset_at, updated_at) VALUES (?, 'free', 1, 0, 1, ?, ?)"
        ).run(userId, newResetAt, nowIso());
        return { allowed: true, remaining: effectiveLimit - 1, reset_at: newResetAt, risk_level: riskLevel, tier };
      }

      // Row exists, so limit was actually reached
      console.log(`[consumePreviewEntitlement] Daily limit reached for user ${userId}: ${ent.preview_count_today}/${effectiveLimit}`);
      return { allowed: false, reset_at: ent.preview_count_reset_at || newResetAt, reason: "DAILY_LIMIT", tier };
    }

    // Get updated count for response
    const updated = await db.prepare(
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

  async function setRiskLevel(userId, level) {
    await db.prepare("UPDATE users SET risk_level = ? WHERE id = ?").run(level, userId);
  }

  async function addAuditEntry({ userId, action, resourceType, resourceId, metadata }) {
    await db.prepare(
      "INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(newUuid(), userId || null, action, resourceType || null, resourceId || null, toJson(metadata), nowIso());
  }

  async function addShareAccessLog({ shareTokenId, eventType, metadata }) {
    await db.prepare(
      "INSERT INTO share_access_log (id, share_token_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(newUuid(), shareTokenId, eventType, toJson(metadata), nowIso());
  }

  function normalizeGiftChannels(rawChannels) {
    if (!Array.isArray(rawChannels)) {
      return [];
    }
    const allowed = new Set(["sms", "email"]);
    const deduped = [];
    for (const value of rawChannels) {
      if (typeof value !== "string") continue;
      const normalized = value.trim().toLowerCase();
      if (!allowed.has(normalized)) continue;
      if (!deduped.includes(normalized)) {
        deduped.push(normalized);
      }
    }
    return deduped;
  }

  function normalizeGiftPhone(value) {
    if (typeof value !== "string") return null;
    const cleaned = value.trim().replace(/[^\d+]/g, "");
    if (!cleaned) return null;
    const normalized = cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
      return null;
    }
    return normalized;
  }

  function normalizeGiftEmail(value) {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      return null;
    }
    return normalized;
  }

  function parseGiftChannelsJson(value) {
    const parsed = parseJson(value, [], "gift_channels");
    return normalizeGiftChannels(parsed);
  }

  async function ensureGiftWalletRow(userId) {
    const now = nowIso();
    await db.prepare(
      `INSERT INTO gift_wallet (user_id, balance, updated_at)
       VALUES (?, 0, ?)
       ON CONFLICT(user_id) DO NOTHING`
    ).run(userId, now);

    const wallet = await db.prepare(
      "SELECT user_id, balance, updated_at FROM gift_wallet WHERE user_id = ?"
    ).get(userId);
    return {
      userId: wallet?.user_id || userId,
      balance: Number(wallet?.balance || 0),
      updatedAt: wallet?.updated_at || now,
    };
  }

  async function applyGiftWalletTransaction({
    userId,
    type,
    amount,
    source = null,
    referenceType = null,
    referenceId = null,
    description = null,
    metadata = null,
    idempotencyKey = null,
  }) {
    await ensureGiftWalletRow(userId);

    if (idempotencyKey) {
      const existing = await db.prepare(
        `SELECT id, balance_after
         FROM gift_wallet_transactions
         WHERE user_id = ? AND idempotency_key = ?
         ORDER BY created_at DESC
         LIMIT 1`
      ).get(userId, idempotencyKey);
      if (existing) {
        return {
          transactionId: existing.id,
          balanceAfter: Number(existing.balance_after || 0),
          idempotent: true,
        };
      }
    }

    // Atomic balance update — prevents race conditions on concurrent requests
    const numAmount = Number(amount || 0);
    let balanceBefore, balanceAfter;

    if (db.isPostgres) {
      const row = await db.prepare(
        "UPDATE gift_wallet SET balance = balance + ?, updated_at = ? WHERE user_id = ? AND (balance + ?) >= 0 RETURNING balance"
      ).get(numAmount, nowIso(), userId, numAmount);
      if (!row) {
        const err = new Error("INSUFFICIENT_GIFT_TOKENS");
        err.code = "INSUFFICIENT_GIFT_TOKENS";
        throw err;
      }
      balanceAfter = Number(row.balance);
      balanceBefore = balanceAfter - numAmount;
    } else {
      // SQLite: serialized writes make UPDATE + SELECT safe
      const result = await db.prepare(
        "UPDATE gift_wallet SET balance = balance + ?, updated_at = ? WHERE user_id = ? AND (balance + ?) >= 0"
      ).run(numAmount, nowIso(), userId, numAmount);
      if (!result.changes) {
        const err = new Error("INSUFFICIENT_GIFT_TOKENS");
        err.code = "INSUFFICIENT_GIFT_TOKENS";
        throw err;
      }
      const wallet = await db.prepare(
        "SELECT balance FROM gift_wallet WHERE user_id = ?"
      ).get(userId);
      balanceAfter = Number(wallet.balance);
      balanceBefore = balanceAfter - numAmount;
    }

    const transactionId = `gwtx_${crypto.randomBytes(12).toString("hex")}`;
    await db.prepare(
      `INSERT INTO gift_wallet_transactions (
        id, user_id, type, amount, balance_before, balance_after,
        source, reference_type, reference_id, description, metadata_json, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      transactionId,
      userId,
      type,
      numAmount,
      balanceBefore,
      balanceAfter,
      source,
      referenceType,
      referenceId,
      description,
      toJson(metadata || {}),
      idempotencyKey,
      nowIso()
    );

    return { transactionId, balanceAfter, idempotent: false };
  }

  async function getGiftWalletSummary(userId, limit = 20) {
    const wallet = await ensureGiftWalletRow(userId);
    const rows = await db.prepare(
      `SELECT id, type, amount, balance_before, balance_after, source, reference_type, reference_id, description, metadata_json, created_at
       FROM gift_wallet_transactions
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(userId, Math.max(1, Math.min(Number(limit) || 20, 100)));

    return {
      balance: wallet.balance,
      updated_at: wallet.updatedAt,
      transactions: rows.map((row) => ({
        id: row.id,
        type: row.type,
        amount: Number(row.amount || 0),
        balance_before: Number(row.balance_before || 0),
        balance_after: Number(row.balance_after || 0),
        source: row.source,
        reference_type: row.reference_type,
        reference_id: row.reference_id,
        description: row.description,
        metadata: parseJson(row.metadata_json, {}, `gift_wallet_tx_${row.id}`),
        created_at: row.created_at,
      })),
    };
  }

  function isShareActive(shareRow) {
    if (!shareRow) return false;
    if (shareRow.status === "revoked" || shareRow.status === "expired") return false;
    return new Date(shareRow.expires_at) > new Date();
  }

  async function ensureTrackGiftShareToken({
    trackId,
    senderUserId,
    giftOrderId,
    versionNum = null,
    sendAtIso,
    expiresInDays = 30,
    requireAppClaim = true,
  }) {
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(trackId);
    if (!track || track.user_id !== senderUserId || track.deleted_at) {
      const err = new Error("TRACK_NOT_FOUND");
      err.code = "TRACK_NOT_FOUND";
      throw err;
    }

    const resolvedVersionNum = Number(versionNum || track.latest_version || 1);
    const trackVersion = await findTrackVersion(track.id, resolvedVersionNum);
    if (!trackVersion) {
      const err = new Error("VERSION_NOT_FOUND");
      err.code = "VERSION_NOT_FOUND";
      throw err;
    }
    if (!trackVersion.preview_url && !trackVersion.full_url) {
      const err = new Error("TRACK_NOT_READY");
      err.code = "TRACK_NOT_READY";
      throw err;
    }

    const claimPolicy = requireAppClaim ? "app_only" : "default";

    const expiresAt = new Date(
      new Date(sendAtIso).getTime() + expiresInDays * 24 * 60 * 60 * 1000
    ).toISOString();
    const claimPin = String(Math.floor(100000 + Math.random() * 900000));
    const streamKeyId = newUuid();
    const streamKey = crypto.randomBytes(16).toString("base64");

    if (track.share_token_id) {
      const existing = await db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(track.share_token_id);
      if (existing) {
        if (
          isShareActive(existing) &&
          (existing.delivery_source || "manual") !== "gift" &&
          (existing.claim_policy || "default") !== claimPolicy
        ) {
          const err = new Error("ACTIVE_SHARE_CONFLICT");
          err.code = "ACTIVE_SHARE_CONFLICT";
          throw err;
        }
        if (isShareActive(existing) && existing.gift_order_id && existing.gift_order_id !== giftOrderId) {
          const err = new Error("ACTIVE_GIFT_SHARE_CONFLICT");
          err.code = "ACTIVE_GIFT_SHARE_CONFLICT";
          throw err;
        }
        await db.prepare(
          `UPDATE share_tokens
           SET track_version_id = ?, creator_id = ?, status = 'unbound',
               bound_device_id = NULL, bound_device_platform = NULL, bound_app_version = NULL, bound_at = NULL,
               web_stream_allowed = ?, app_save_allowed = 1, expires_at = ?, last_accessed_at = NULL, access_count = 0,
               stream_key_id = ?, stream_key = ?, claim_pin = ?, claim_attempts = 0,
               delivery_source = ?, gift_order_id = ?, claim_policy = ?, dispatch_at = ?, dispatched_at = NULL
           WHERE id = ?`
        ).run(
          trackVersion.id,
          senderUserId,
          requireAppClaim ? 0 : 1,
          expiresAt,
          streamKeyId,
          streamKey,
          claimPin,
          "gift",
          giftOrderId,
          claimPolicy,
          sendAtIso,
          existing.id
        );

        return {
          shareId: existing.id,
          shareUrl: `${publicBaseUrl}/play/${existing.id}`,
          claimPin,
          expiresAt,
        };
      }
    }

    const shareId = newShareId();

    await db.prepare(
      `INSERT INTO share_tokens (
        id, track_id, track_version_id, creator_id, status,
        bound_device_id, bound_device_platform, bound_app_version, bound_at,
        web_stream_allowed, app_save_allowed, expires_at, created_at, last_accessed_at, access_count,
        stream_key_id, stream_key, claim_pin, claim_attempts,
        utm_source, utm_medium, utm_campaign, referrer, created_ip, created_user_agent,
        delivery_source, gift_order_id, claim_policy, dispatch_at, dispatched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      shareId,
      track.id,
      trackVersion.id,
      senderUserId,
      "unbound",
      null,
      null,
      null,
      null,
      requireAppClaim ? 0 : 1,
      1,
      expiresAt,
      nowIso(),
      null,
      0,
      streamKeyId,
      streamKey,
      claimPin,
      0,
      null,
      null,
      null,
      null,
      null,
      null,
      "gift",
      giftOrderId,
      claimPolicy,
      sendAtIso,
      null
    );
    await db.prepare("UPDATE tracks SET share_token_id = ?, updated_at = ? WHERE id = ?").run(
      shareId,
      nowIso(),
      track.id
    );

    return {
      shareId,
      shareUrl: `${publicBaseUrl}/play/${shareId}`,
      claimPin,
      expiresAt,
    };
  }

  async function ensurePoemGiftShareToken({
    poemId,
    senderUserId,
    giftOrderId,
    sendAtIso,
    expiresInDays = 30,
    requireAppClaim = true,
  }) {
    const poem = await db.prepare("SELECT * FROM poems WHERE id = ? AND deleted_at IS NULL").get(poemId);
    if (!poem || poem.user_id !== senderUserId) {
      const err = new Error("POEM_NOT_FOUND");
      err.code = "POEM_NOT_FOUND";
      throw err;
    }

    const verses = parseJson(poem.verses, [], `poem_${poem.id}_verses`);
    if (!Array.isArray(verses) || verses.length === 0) {
      const err = new Error("POEM_NOT_READY");
      err.code = "POEM_NOT_READY";
      throw err;
    }

    const claimPolicy = requireAppClaim ? "app_only" : "default";

    const expiresAt = new Date(
      new Date(sendAtIso).getTime() + expiresInDays * 24 * 60 * 60 * 1000
    ).toISOString();
    const claimPin = String(Math.floor(100000 + Math.random() * 900000));

    if (poem.share_token_id) {
      const existing = await db.prepare("SELECT * FROM poem_share_tokens WHERE id = ?").get(poem.share_token_id);
      if (existing) {
        if (
          isShareActive(existing) &&
          (existing.delivery_source || "manual") !== "gift" &&
          (existing.claim_policy || "default") !== claimPolicy
        ) {
          const err = new Error("ACTIVE_SHARE_CONFLICT");
          err.code = "ACTIVE_SHARE_CONFLICT";
          throw err;
        }
        if (isShareActive(existing) && existing.gift_order_id && existing.gift_order_id !== giftOrderId) {
          const err = new Error("ACTIVE_GIFT_SHARE_CONFLICT");
          err.code = "ACTIVE_GIFT_SHARE_CONFLICT";
          throw err;
        }
        await db.prepare(
          `UPDATE poem_share_tokens
           SET creator_id = ?, status = 'active',
               bound_device_id = NULL, bound_user_id = NULL, bound_at = NULL,
               claim_pin = ?, claim_attempts = 0, allow_save = 1, expires_at = ?,
               last_accessed_at = NULL, access_count = 0,
               delivery_source = ?, gift_order_id = ?, claim_policy = ?, dispatch_at = ?, dispatched_at = NULL
           WHERE id = ?`
        ).run(
          senderUserId,
          claimPin,
          expiresAt,
          "gift",
          giftOrderId,
          claimPolicy,
          sendAtIso,
          existing.id
        );

        return {
          shareId: existing.id,
          shareUrl: `${publicBaseUrl}/poem/${existing.id}`,
          claimPin,
          expiresAt,
        };
      }
    }

    const shareId = newShareId();

    await db.prepare(
      `INSERT INTO poem_share_tokens (
        id, poem_id, creator_id, status, bound_device_id, bound_user_id, bound_at,
        claim_pin, claim_attempts, allow_save, expires_at, created_at, last_accessed_at, access_count,
        utm_source, utm_medium, utm_campaign, referrer, created_ip, created_user_agent,
        delivery_source, gift_order_id, claim_policy, dispatch_at, dispatched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      shareId,
      poem.id,
      senderUserId,
      "active",
      null,
      null,
      null,
      claimPin,
      0,
      1,
      expiresAt,
      nowIso(),
      null,
      0,
      null,
      null,
      null,
      null,
      null,
      null,
      "gift",
      giftOrderId,
      claimPolicy,
      sendAtIso,
      null
    );
    await db.prepare("UPDATE poems SET share_token_id = ?, updated_at = ? WHERE id = ?").run(
      shareId,
      nowIso(),
      poem.id
    );

    return {
      shareId,
      shareUrl: `${publicBaseUrl}/poem/${shareId}`,
      claimPin,
      expiresAt,
    };
  }

  function renderGiftSummary(giftRow) {
    return {
      id: giftRow.id,
      sender_user_id: giftRow.sender_user_id,
      content_type: giftRow.content_type,
      content_id: giftRow.content_id,
      status: giftRow.status,
      dispatch_status: giftRow.dispatch_status,
      delivery_mode: giftRow.delivery_mode,
      send_at: giftRow.send_at,
      sender_timezone: giftRow.sender_timezone,
      channels: parseGiftChannelsJson(giftRow.channels_json),
      recipient_phone: giftRow.recipient_phone,
      recipient_email: giftRow.recipient_email,
      message: giftRow.message,
      share_token_id: giftRow.share_token_id,
      share_url: giftRow.share_url,
      claim_pin: giftRow.claim_pin,
      claim_policy: giftRow.claim_policy || "app_only",
      expires_in_days: Number(giftRow.expires_in_days || 30),
      dispatch_attempts: Number(giftRow.dispatch_attempts || 0),
      last_dispatch_error: giftRow.last_dispatch_error,
      dispatched_at: giftRow.dispatched_at,
      cancelled_at: giftRow.cancelled_at,
      created_at: giftRow.created_at,
      updated_at: giftRow.updated_at,
      can_edit: giftRow.status === "scheduled" || giftRow.status === "dispatch_retry",
      can_cancel: giftRow.status === "scheduled" || giftRow.status === "dispatch_retry",
    };
  }

  async function sendGiftSmsViaTwilio({ to, body }) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    if (!accountSid || !authToken || !fromNumber) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("SMS_NOT_CONFIGURED");
      }
      return { simulated: true, providerMessageId: "simulated_sms" };
    }

    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const payload = new URLSearchParams({
      To: to,
      From: fromNumber,
      Body: body,
    });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload.toString(),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result?.message || `TWILIO_${response.status}`);
    }
    return {
      simulated: false,
      providerMessageId: result?.sid || null,
    };
  }

  function buildGiftDeliveryMessage({ giftRow, senderLabel }) {
    const noun = giftRow.content_type === "poem" ? "poem" : "song";
    const sender = senderLabel || "Someone special";
    const note = typeof giftRow.message === "string" && giftRow.message.trim()
      ? `Message: ${giftRow.message.trim()}\n`
      : "";
    return `${sender} sent you a personalized ${noun} on Porizo.\n${note}Link: ${giftRow.share_url}\nPIN: ${giftRow.claim_pin}\nOpen in the Porizo app to claim.`;
  }

  async function dispatchGiftById(giftId) {
    const giftSchedulingEnabled = await getFeatureFlag(db, "gift_scheduling_enabled");
    if (!giftSchedulingEnabled) {
      return { skipped: true, reason: "feature_disabled" };
    }

    const lock = await db.prepare(
      `UPDATE gift_orders
       SET status = 'dispatching', dispatch_status = 'pending', updated_at = ?
       WHERE id = ? AND status IN ('scheduled', 'dispatch_retry')`
    ).run(nowIso(), giftId);
    if (!lock.changes) {
      return { skipped: true, reason: "not_dispatchable" };
    }

    const gift = await db.prepare("SELECT * FROM gift_orders WHERE id = ?").get(giftId);
    if (!gift) {
      return { skipped: true, reason: "not_found" };
    }

    try {
    const channels = parseGiftChannelsJson(gift.channels_json);
    const senderUser = await db.prepare(
      "SELECT display_name, email FROM users WHERE id = ?"
    ).get(gift.sender_user_id);
    const senderLabel = senderUser?.display_name
      || (senderUser?.email?.split("@")[0])
      || "Someone special";
    const payloadText = buildGiftDeliveryMessage({ giftRow: gift, senderLabel });
    const errors = [];
    let successfulChannels = 0;

    for (const channel of channels) {
      const existingSuccess = await db.prepare(
        `SELECT id FROM gift_dispatch_attempts
         WHERE gift_order_id = ? AND channel = ? AND status = 'success'
         LIMIT 1`
      ).get(gift.id, channel);
      if (existingSuccess) {
        successfulChannels += 1;
        continue;
      }

      try {
        if (channel === "sms") {
          const smsEnabled = await getFeatureFlag(db, "gift_sms_enabled");
          if (!smsEnabled) {
            throw new Error("SMS_CHANNEL_DISABLED");
          }
          if (!gift.recipient_phone) {
            throw new Error("MISSING_RECIPIENT_PHONE");
          }
          const smsResult = await sendGiftSmsViaTwilio({
            to: gift.recipient_phone,
            body: payloadText,
          });
          await db.prepare(
            `INSERT INTO gift_dispatch_attempts (
              id, gift_order_id, channel, status, provider_message_id, error_message, payload_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            newUuid(),
            gift.id,
            channel,
            "success",
            smsResult.providerMessageId,
            null,
            toJson({ simulated: smsResult.simulated }),
            nowIso()
          );
          successfulChannels += 1;
        } else if (channel === "email") {
          const emailEnabled = await getFeatureFlag(db, "gift_email_enabled");
          if (!emailEnabled) {
            throw new Error("EMAIL_CHANNEL_DISABLED");
          }
          if (!gift.recipient_email) {
            throw new Error("MISSING_RECIPIENT_EMAIL");
          }

          let providerMessageId = "simulated_email";
          let simulated = false;
          if (emailService.isConfigured()) {
            const sent = await emailService.sendGiftDeliveryEmail({
              to: gift.recipient_email,
              senderName: senderLabel,
              shareUrl: gift.share_url,
              claimPin: gift.claim_pin,
              contentType: gift.content_type,
              message: gift.message || "",
            });
            providerMessageId = sent.messageId || providerMessageId;
          } else if (process.env.NODE_ENV === "production") {
            throw new Error("EMAIL_NOT_CONFIGURED");
          } else {
            simulated = true;
          }

          await db.prepare(
            `INSERT INTO gift_dispatch_attempts (
              id, gift_order_id, channel, status, provider_message_id, error_message, payload_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            newUuid(),
            gift.id,
            channel,
            "success",
            providerMessageId,
            null,
            toJson({ simulated }),
            nowIso()
          );
          successfulChannels += 1;
        }
      } catch (err) {
        errors.push(`${channel}:${err.message}`);
        await db.prepare(
          `INSERT INTO gift_dispatch_attempts (
            id, gift_order_id, channel, status, provider_message_id, error_message, payload_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          newUuid(),
          gift.id,
          channel,
          "failed",
          null,
          err.message,
          toJson({}),
          nowIso()
        );
      }
    }

    const allDelivered = successfulChannels >= channels.length && channels.length > 0;
    const nextAttempts = Number(gift.dispatch_attempts || 0) + (allDelivered ? 0 : 1);

    if (allDelivered) {
      await db.prepare(
        `UPDATE gift_orders
         SET status = 'dispatched',
             dispatch_status = 'sent',
             dispatch_attempts = ?,
             last_dispatch_error = NULL,
             dispatched_at = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(nextAttempts, nowIso(), nowIso(), gift.id);

      if (gift.content_type === "song") {
        await db.prepare(
          "UPDATE share_tokens SET dispatched_at = ?, dispatch_at = COALESCE(dispatch_at, ?), gift_order_id = COALESCE(gift_order_id, ?) WHERE id = ?"
        ).run(nowIso(), gift.send_at, gift.id, gift.share_token_id);
      } else if (gift.content_type === "poem") {
        await db.prepare(
          "UPDATE poem_share_tokens SET dispatched_at = ?, dispatch_at = COALESCE(dispatch_at, ?), gift_order_id = COALESCE(gift_order_id, ?) WHERE id = ?"
        ).run(nowIso(), gift.send_at, gift.id, gift.share_token_id);
      }

      await addAuditEntry({
        userId: gift.sender_user_id,
        action: "gift_dispatched",
        resourceType: "gift_order",
        resourceId: gift.id,
        metadata: { channels },
      });

      eventsService.emit("gift_dispatched", {
        userId: gift.sender_user_id,
        resourceType: "gift_order",
        resourceId: gift.id,
        metadata: { channels, content_type: gift.content_type },
      });
      return { dispatched: true };
    }

    const exhausted = nextAttempts >= giftDispatchMaxAttempts;

    // Refund BEFORE status update — if refund fails, status stays dispatch_retry
    // and the refund will be re-attempted on next cycle
    let refundTxId = null;
    if (exhausted) {
      try {
        const refund = await applyGiftWalletTransaction({
          userId: gift.sender_user_id,
          type: "gift_refund",
          amount: 1,
          source: "dispatch_failure",
          referenceType: "gift_order",
          referenceId: gift.id,
          description: "Auto-refund: gift delivery failed after max attempts",
          idempotencyKey: `gift_refund_dispatch_${gift.id}`,
        });
        refundTxId = refund.transactionId;
      } catch (refundErr) {
        app.log.error({ giftId: gift.id, err: refundErr }, "Failed to auto-refund gift token");
      }
    }

    await db.prepare(
      `UPDATE gift_orders
       SET status = ?,
           dispatch_status = ?,
           dispatch_attempts = ?,
           last_dispatch_error = ?,
           refund_transaction_id = COALESCE(?, refund_transaction_id),
           updated_at = ?
       WHERE id = ?`
    ).run(
      exhausted ? "failed" : "dispatch_retry",
      exhausted ? "failed" : "retrying",
      nextAttempts,
      errors.join("; "),
      refundTxId,
      nowIso(),
      gift.id
    );

    await addAuditEntry({
      userId: gift.sender_user_id,
      action: exhausted ? "gift_dispatch_failed" : "gift_dispatch_retry",
      resourceType: "gift_order",
      resourceId: gift.id,
      metadata: { errors, attempts: nextAttempts, refund_tx_id: refundTxId },
    });
    eventsService.emit(exhausted ? "gift_failed" : "gift_retry", {
      userId: gift.sender_user_id,
      resourceType: "gift_order",
      resourceId: gift.id,
      metadata: { errors, attempts: nextAttempts },
    });

    return { dispatched: false, errors };

    } catch (dispatchErr) {
      // Recover from stuck 'dispatching' state — increment attempts to respect max limit
      await db.prepare(
        `UPDATE gift_orders
         SET status = 'dispatch_retry',
             dispatch_status = 'error',
             dispatch_attempts = dispatch_attempts + 1,
             last_dispatch_error = ?,
             updated_at = ?
         WHERE id = ? AND status = 'dispatching'`
      ).run(
        String(dispatchErr.message || dispatchErr).slice(0, 500),
        nowIso(),
        giftId
      );
      throw dispatchErr;
    }
  }

  app.decorate("dispatchGiftById", dispatchGiftById);

  async function findTrackVersion(trackId, versionNum) {
    return db
      .prepare("SELECT * FROM track_versions WHERE track_id = ? AND version_num = ?")
      .get(trackId, versionNum);
  }

  async function findJob(jobId) {
    if (!jobId) {
      return null;
    }
    return await db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
  }

  function isActiveJob(job) {
    return job && (job.status === "queued" || job.status === "running");
  }

  function isTerminalFailedJobStatus(status) {
    return status === "failed" || status === "dead_letter" || status === "blocked";
  }

  function isTerminalTrackFailureStatus(status) {
    return status === "failed" || status === "blocked";
  }

  function normalizeJobStatus(status) {
    return isTerminalFailedJobStatus(status) ? "failed" : status;
  }

  function extractRenderPolicyTerms(...rawMessages) {
    const terms = new Set();
    for (const rawMessage of rawMessages) {
      for (const term of extractPolicyTermsFromMessage(rawMessage)) {
        for (const variant of expandPolicyTermVariants(term)) {
          terms.add(variant);
        }
      }
    }
    return Array.from(terms).sort((a, b) => a.localeCompare(b));
  }

  function extractRenderPolicyTermsFromJob(jobRow) {
    if (!jobRow) {
      return [];
    }

    const stepData = parseJson(jobRow.step_data, {});
    const sources = [
      jobRow.error_message,
      stepData?.policy_retry_reason,
      stepData?.provider_error_message,
      stepData?.last_error_message,
      stepData?.error_message,
    ];
    return extractRenderPolicyTerms(...sources);
  }

  async function findLatestFailedJobForVersion(trackVersionId, workflowType) {
    return db
      .prepare(
        `SELECT * FROM jobs
         WHERE track_version_id = ? AND workflow_type = ? AND status IN ('failed', 'dead_letter', 'blocked')
         ORDER BY COALESCE(completed_at, updated_at) DESC
         LIMIT 1`
      )
      .get(trackVersionId, workflowType);
  }

  function toTimestamp(value) {
    if (!value) return null;
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : null;
  }

  function normalizeRenderFailureMessage(rawMessage, rawCode) {
    const code = typeof rawCode === "string" ? rawCode : "";
    const message = typeof rawMessage === "string" ? rawMessage : "";
    const normalized = message.toLowerCase();
    const containsArtistPolicyError =
      normalized.includes("producer tag") ||
      normalized.includes("specific artists") ||
      normalized.includes("sensitive_word_error");

    if (containsArtistPolicyError) {
      return "Lyrics were rejected for referencing an artist or producer tag. Edit the lyrics and remove named references, then try again.";
    }

    if (!message && code === "E302_SUNO_POLICY_ERROR") {
      return "Music generation failed due to provider content policy. Please adjust the lyrics and try again.";
    }

    if (!message && (code === "E302_SUNO_ERROR" || code === "E302_SUNO_INCOMPLETE_OUTPUT")) {
      return "Music provider returned an incomplete audio result. Please try again.";
    }

    if (!message) {
      return "Render failed. Please try again.";
    }

    if (message.startsWith("E302_SUNO_ERROR:")) {
      return message.replace("E302_SUNO_ERROR:", "").trim();
    }

    if (message.startsWith("E302_SUNO_POLICY_ERROR:")) {
      return message.replace("E302_SUNO_POLICY_ERROR:", "").trim();
    }

    if (message.startsWith("E302_SUNO_INCOMPLETE_OUTPUT:")) {
      return message.replace("E302_SUNO_INCOMPLETE_OUTPUT:", "").trim();
    }

    return message;
  }

  function classifyRenderFailure(rawMessage, rawCode) {
    const code = typeof rawCode === "string" ? rawCode : "";
    const message = typeof rawMessage === "string" ? rawMessage : "";
    const normalized = `${code} ${message}`.toLowerCase();

    const provider = code.startsWith("E302_SUNO")
      ? "suno"
      : code.startsWith("E301_ELEVENLABS")
        ? "elevenlabs"
        : null;

    if (
      code === "E302_PROVIDER_POLICY_ERROR" ||
      code === "E302_SUNO_POLICY_ERROR" ||
      normalized.includes("content policy") ||
      normalized.includes("lyrics policy") ||
      normalized.includes("producer tag") ||
      normalized.includes("specific artists")
    ) {
      return {
        error_category: "policy_content",
        can_auto_rewrite: true,
        suggested_action: "rewrite_and_retry",
        provider,
      };
    }

    if (code === "E301_ELEVENLABS_VALIDATION" || normalized.includes("bad_composition_plan")) {
      return {
        error_category: "policy_validation",
        can_auto_rewrite: true,
        suggested_action: "rewrite_and_retry",
        provider: provider || "elevenlabs",
      };
    }

    if (code === "E302_QUALITY_GATE_FAILED" || normalized.includes("quality gate")) {
      return {
        error_category: "quality_gate",
        can_auto_rewrite: true,
        suggested_action: "retry_with_adjusted_style",
        provider,
      };
    }

    if (code === "provider_error_429" || normalized.includes("rate limit")) {
      return {
        error_category: "provider_transient",
        can_auto_rewrite: false,
        suggested_action: "wait_and_retry",
        provider,
      };
    }

    if (
      code === "E302_SUNO_INCOMPLETE_OUTPUT" ||
      normalized.includes("no audio url in response") ||
      normalized.includes("no audio data in response") ||
      normalized.includes("incomplete audio result")
    ) {
      return {
        error_category: "infra_retryable",
        can_auto_rewrite: false,
        suggested_action: "retry",
        provider: provider || "suno",
      };
    }

    if (normalized.includes("timeout") || normalized.includes("network")) {
      return {
        error_category: "infra_retryable",
        can_auto_rewrite: false,
        suggested_action: "retry",
        provider,
      };
    }

    return {
      error_category: "infra_terminal",
      can_auto_rewrite: false,
      suggested_action: "retry",
      provider,
    };
  }

  async function findActiveJobForVersion(trackVersionId, workflowType) {
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
  async function incrementTrackVersion(trackId) {
    const now = nowIso();
    // Note: Callers wrap this in a transaction for atomicity with INSERT
    await db.prepare(
      "UPDATE tracks SET latest_version = latest_version + 1, updated_at = ? WHERE id = ?"
    ).run(now, trackId);
    const track = await db.prepare("SELECT latest_version FROM tracks WHERE id = ?").get(trackId);
    return track.latest_version;
  }

  async function getTrackVersions(track, baseUrl) {
    if (!track || !track.id) {
      return [];
    }
    const versions = await db
      .prepare("SELECT * FROM track_versions WHERE track_id = ? ORDER BY version_num")
      .all(track.id);

    const versionIds = versions.map((version) => version.id).filter(Boolean);
    const latestFailedJobByVersion = new Map();
    if (versionIds.length > 0) {
      const placeholders = versionIds.map(() => "?").join(",");
      const failedJobs = await db
        .prepare(
          `SELECT track_version_id, error_code, error_message, step_data, updated_at, completed_at
           FROM jobs
           WHERE track_version_id IN (${placeholders})
             AND status IN ('failed', 'dead_letter', 'blocked')
           ORDER BY COALESCE(completed_at, updated_at) DESC`
        )
        .all(...versionIds);

      for (const job of failedJobs) {
        if (!latestFailedJobByVersion.has(job.track_version_id)) {
          latestFailedJobByVersion.set(job.track_version_id, job);
        }
      }
    }

    return versions.map((version) => {
      // Intentionally omit sensitive fields from public response
      // eslint-disable-next-line no-unused-vars
      const { guide_vocal_url, guide_access_token, ...rest } = version;
      const { previewUrl, fullUrl } = buildTrackVersionUrls({
        storageProvider,
        track,
        version,
        baseUrl,
        rewriteStreamUrl,
      });
      const latestFailure = latestFailedJobByVersion.get(version.id);
      const failureHints = latestFailure
        ? classifyRenderFailure(latestFailure?.error_message, latestFailure?.error_code)
        : null;
      return {
        ...rest,
        preview_url: previewUrl,
        full_url: fullUrl,
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
        cover_image_url: version.cover_image_url || null,
        cover_image_small_url: version.cover_image_small_url || null,
        cover_image_large_url: version.cover_image_large_url || null,
        last_error_code: latestFailure?.error_code || null,
        last_error_message: normalizeRenderFailureMessage(
          latestFailure?.error_message,
          latestFailure?.error_code
        ),
        last_error_terms: extractRenderPolicyTermsFromJob(latestFailure),
        last_error_category: failureHints?.error_category || null,
        last_error_can_auto_rewrite: failureHints?.can_auto_rewrite ?? null,
        last_error_suggested_action: failureHints?.suggested_action || null,
        last_error_provider: failureHints?.provider || null,
      };
    });
  }

  async function upsertTrackLibraryEntry({
    userId,
    trackId,
    origin,
    shareTokenId = null,
    addedAt = nowIso(),
  }) {
    const now = nowIso();
    const updateResult = await db.prepare(
      `UPDATE track_library_entries
       SET origin = CASE WHEN origin = 'created' THEN origin ELSE ? END,
           share_token_id = COALESCE(?, share_token_id),
           added_at = CASE WHEN removed_at IS NOT NULL THEN ? ELSE added_at END,
           removed_at = NULL, updated_at = ?
       WHERE user_id = ? AND track_id = ?`
    ).run(origin, shareTokenId, addedAt, now, userId, trackId);

    if (updateResult.changes > 0) {
      return;
    }

    await db.prepare(
      `INSERT INTO track_library_entries
       (user_id, track_id, origin, share_token_id, added_at, removed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`
    ).run(userId, trackId, origin, shareTokenId, addedAt, now);
  }

  async function upsertPoemLibraryEntry({
    userId,
    poemId,
    origin,
    shareTokenId = null,
    addedAt = nowIso(),
  }) {
    const now = nowIso();
    const updateResult = await db.prepare(
      `UPDATE poem_library_entries
       SET origin = CASE WHEN origin = 'created' THEN origin ELSE ? END,
           share_token_id = COALESCE(?, share_token_id),
           added_at = CASE WHEN removed_at IS NOT NULL THEN ? ELSE added_at END,
           removed_at = NULL, updated_at = ?
       WHERE user_id = ? AND poem_id = ?`
    ).run(origin, shareTokenId, addedAt, now, userId, poemId);

    if (updateResult.changes > 0) {
      return;
    }

    await db.prepare(
      `INSERT INTO poem_library_entries
       (user_id, poem_id, origin, share_token_id, added_at, removed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`
    ).run(userId, poemId, origin, shareTokenId, addedAt, now);
  }

  async function getTrackForLibrary(userId, trackId) {
    return db.prepare(
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
       WHERE t.id = ?
         AND t.deleted_at IS NULL`
    ).get(userId, userId, userId, trackId);
  }

  async function getPoemForLibrary(userId, poemId) {
    return db.prepare(
      `SELECT p.*,
              ple.origin AS library_origin,
              ple.added_at AS library_added_at,
              ple.share_token_id AS library_share_token_id,
              CASE WHEN p.user_id = ? THEN 1 ELSE 0 END AS can_edit,
              CASE WHEN p.user_id = ? THEN 1 ELSE 0 END AS can_share,
              1 AS can_delete
       FROM poems p
       JOIN poem_library_entries ple
         ON ple.poem_id = p.id
        AND ple.user_id = ?
        AND ple.removed_at IS NULL
       WHERE p.id = ?
         AND p.deleted_at IS NULL`
    ).get(userId, userId, userId, poemId);
  }

  async function hydrateTrackCoverImages(trackRows) {
    if (!Array.isArray(trackRows) || trackRows.length === 0) {
      return [];
    }

    const trackIds = [...new Set(trackRows.map((row) => row?.id).filter(Boolean))];
    if (trackIds.length === 0) {
      return trackRows;
    }

    const placeholders = trackIds.map(() => "?").join(",");
    const versions = await db
      .prepare(`SELECT * FROM track_versions WHERE track_id IN (${placeholders})`)
      .all(...trackIds);

    const byTrackVersion = new Map();
    for (const version of versions) {
      const versionNum = Number(version.version_num || 0);
      byTrackVersion.set(`${version.track_id}:${versionNum}`, version);
    }

    return trackRows.map((row) => {
      const latestVersionNum = Number(row.latest_version || 0);
      const latestVersion = byTrackVersion.get(`${row.id}:${latestVersionNum}`);

      return {
        ...row,
        cover_image_url: latestVersion?.cover_image_url ?? row.cover_image_url ?? null,
        cover_image_small_url: latestVersion?.cover_image_small_url ?? row.cover_image_small_url ?? null,
        cover_image_large_url: latestVersion?.cover_image_large_url ?? row.cover_image_large_url ?? null,
      };
    });
  }

  function withTrackLibraryFlags(trackRow) {
    if (!trackRow) {
      return null;
    }
    return {
      ...trackRow,
      can_edit: asBool(trackRow.can_edit),
      can_share: asBool(trackRow.can_share),
      can_delete: asBool(trackRow.can_delete),
    };
  }

  function withPoemLibraryFlags(poemRow) {
    if (!poemRow) {
      return null;
    }
    return {
      ...poemRow,
      can_edit: asBool(poemRow.can_edit),
      can_share: asBool(poemRow.can_share),
      can_delete: asBool(poemRow.can_delete),
    };
  }

  async function createJob({ trackVersionId, workflowType }) {
    const jobId = newUuid();
    const now = nowIso();
    await db.prepare(
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
      await db.prepare("UPDATE track_versions SET preview_job_id = ? WHERE id = ?").run(
        jobId,
        trackVersionId
      );
    }
    if (workflowType === "full_render") {
      await db.prepare("UPDATE track_versions SET full_job_id = ? WHERE id = ?").run(
        jobId,
        trackVersionId
      );
    }
    return await db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
  }

  async function retryFailedJob({ trackVersionId, workflowType, userId, track, trackVersion }) {
    // 1. Idempotent: if there's already an active job, return it
    const activeJob = await findActiveJobForVersion(trackVersionId, workflowType);
    if (activeJob) {
      return { job: activeJob, created: false };
    }

    // 2. Find the failed/DLQ'd job for this track version
    const failedJob = await findLatestFailedJobForVersion(trackVersionId, workflowType);
    if (!failedJob) {
      return null;
    }

    // 3. Clean stale files for the failed step
    const versionDir = getVersionDir(track, trackVersion);
    if (failedJob.step) {
      cleanStaleStepFiles(versionDir, failedJob.step);
    }

    // 4. Reset job: re-queue with fresh attempts
    const now = nowIso();
    await db.prepare(
      "UPDATE jobs SET status = 'queued', step = 'queued', step_index = 0, attempts = 0, error_code = NULL, error_message = NULL, progress_pct = 0, completed_at = NULL, next_attempt_at = NULL, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ?"
    ).run(now, failedJob.id);

    // 5. Mark DLQ entry as reprocessed (if exists)
    await db.prepare(
      "UPDATE dead_letter_queue SET reprocessed_at = ?, reprocess_job_id = ? WHERE job_id = ? AND reprocessed_at IS NULL"
    ).run(now, failedJob.id, failedJob.id);

    // 6. Reset track_version and track status
    await db.prepare(
      "UPDATE track_versions SET status = 'processing' WHERE id = ?"
    ).run(trackVersionId);
    await db.prepare(
      "UPDATE tracks SET status = 'rendering', updated_at = ? WHERE id = ?"
    ).run(now, track.id);

    // 7. Audit trail
    await addAuditEntry({
      userId,
      action: "user_retry_render",
      resourceType: "job",
      resourceId: failedJob.id,
      metadata: { workflow_type: workflowType, failed_step: failedJob.step },
    });

    // 8. Return the re-queued job
    const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").get(failedJob.id);
    return { job, created: false };
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
      return job.progress_pct;
    }
    const stepCount = getWorkflowStepCount(job.workflow_type);
    if (!stepCount) {
      return null;
    }
    const index = Number(job.step_index || 0);
    const pct = Math.floor((Math.min(index, stepCount) / stepCount) * 100);
    return Math.min(pct, 99);
  }

  // ============ Story Routes (Dynamic Q&A) ============
  registerStoryRoutes(app, {
    db,
    requireUserId,
    requireAdminRole,
    sendError,
    consumeRateLimit,
    addAuditEntry,
    eventsService,
    enableV3OrchestrationRoutes,
    orchestrationExecutorMode,
    orchestrationExternalCommandJson,
    orchestrationExternalTimeoutMs,
    storyEngineDefault,
  });

  app.get("/health", async () => ({
    ok: true,
    time: nowIso(),
    providers: appConfig.providerStatus || {},
  }));

  /**
   * GET /health/providers - Check external provider health
   *
   * Returns real-time health status of ElevenLabs, Replicate, and other providers.
   * Includes circuit breaker state if job runner is active.
   */
  app.get("/health/providers", async (request, reply) => {
    const healthChecker = createHealthCheckService({
      elevenlabsApiKey: process.env.ELEVENLABS_API_KEY,
      elevenlabsBaseUrl: process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io",
      replicateToken: process.env.REPLICATE_API_TOKEN,
      replicateBaseUrl: process.env.REPLICATE_BASE_URL || "https://api.replicate.com",
      timeoutMs: 5000,
    });

    try {
      const health = await healthChecker.getOverallHealth();

      // Include circuit breaker state if available from job runner
      // Note: jobRunner reference would need to be stored at server level
      // For now, just return provider health
      reply.send({
        ...health,
        circuitBreakers: appConfig.providerStatus || {},
      });
    } catch (err) {
      console.error("[health/providers] Check failed:", err.message);
      reply.status(503).send({
        healthy: false,
        error: err.message,
        checkedAt: nowIso(),
      });
    }
  });

  app.get("/jobs/:id", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").get(request.params.id);
    if (!job) {
      sendError(reply, 404, "JOB_NOT_FOUND", "Job not found.");
      return;
    }
    const trackVersion = await db
      .prepare("SELECT * FROM track_versions WHERE id = ?")
      .get(job.track_version_id);
    if (!trackVersion) {
      sendError(reply, 404, "TRACK_VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(trackVersion.track_id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 403, "FORBIDDEN", "Job does not belong to this user.");
      return;
    }
    const progress = computeJobProgress(job);

    let responseJob = {
      ...job,
      progress,
    };

    if (responseJob.status !== normalizeJobStatus(responseJob.status)) {
      responseJob = {
        ...responseJob,
        status: normalizeJobStatus(responseJob.status),
      };
    }

    if (responseJob.status === "failed") {
      const rawErrorMessage = responseJob.error_message;
      const failureHints = classifyRenderFailure(rawErrorMessage, responseJob.error_code);
      responseJob = {
        ...responseJob,
        error_message: normalizeRenderFailureMessage(responseJob.error_message, responseJob.error_code),
        error_terms: extractRenderPolicyTermsFromJob({
          ...responseJob,
          error_message: rawErrorMessage,
        }),
        ...failureHints,
      };
    }

    if ((responseJob.status === "queued" || responseJob.status === "running") &&
        (isTerminalTrackFailureStatus(track.status) || isTerminalTrackFailureStatus(trackVersion.status))) {
      const latestFailedJob = await findLatestFailedJobForVersion(job.track_version_id, job.workflow_type);
      const fallbackErrorCode = latestFailedJob?.error_code || responseJob.error_code || "RENDER_FAILED";
      const fallbackErrorMessage = latestFailedJob?.error_message || responseJob.error_message;

      responseJob = {
        ...responseJob,
        status: "failed",
        progress: 100,
        error_code: fallbackErrorCode,
        error_message: normalizeRenderFailureMessage(fallbackErrorMessage, fallbackErrorCode),
        error_terms: extractRenderPolicyTermsFromJob({
          ...(latestFailedJob || {}),
          error_message: fallbackErrorMessage,
        }),
        completed_at: latestFailedJob?.completed_at || responseJob.completed_at || nowIso(),
        ...classifyRenderFailure(fallbackErrorMessage, fallbackErrorCode),
      };
    }

    // Job processing is handled by the background job runner (src/workflows/runner.js)
    // which polls for queued/running jobs and advances them through pipeline steps
    reply.send(responseJob);
  });

  // Preview audio endpoint - unauthenticated for AVPlayer compatibility
  // Security: UUID path is unguessable (MVP - consider signed URLs for production)
  // Supports both .mp3 and .m4a formats
  // Helper: serve track audio from R2 (primary) or local disk (fallback for dev)
  // Proxies from R2 to avoid CORS issues with browser <audio> elements.
  async function serveTrackAudio(request, reply, { track, trackVersion, s3Key, localFileName, contentType }) {
    // R2 is the source of truth — proxy the response to avoid CORS issues
    if (storageProvider.type !== "local") {
      const download = storageProvider.createPresignedDownload({ key: s3Key, expiresInSec: 300 });
      try {
        const fetchHeaders = {};
        if (request.headers.range) {
          fetchHeaders.Range = request.headers.range;
        }
        const r2Response = await fetch(download.url, { headers: fetchHeaders });
        if (!r2Response.ok && r2Response.status !== 206) {
          sendError(reply, 404, "AUDIO_NOT_FOUND", "Audio file not found in storage.");
          return;
        }
        // Convert Web ReadableStream to Buffer for Fastify compatibility
        const buffer = Buffer.from(await r2Response.arrayBuffer());
        reply.status(r2Response.status);
        reply.header("Content-Type", r2Response.headers.get("content-type") || contentType || "audio/mp4");
        reply.header("Content-Length", buffer.length);
        if (r2Response.headers.get("content-range")) {
          reply.header("Content-Range", r2Response.headers.get("content-range"));
        }
        reply.header("Accept-Ranges", "bytes");
        reply.header("Cache-Control", "public, max-age=3600");
        reply.send(buffer);
      } catch (err) {
        console.error(`[serveTrackAudio] R2 proxy failed for ${s3Key}:`, err.message);
        sendError(reply, 502, "STORAGE_ERROR", "Failed to fetch audio from storage.");
      }
      return;
    }
    // Local-only fallback for dev
    const versionDir = getVersionDir(track, trackVersion);
    const filePath = path.join(versionDir, localFileName);
    if (contentType) {
      sendMediaFile(request, reply, filePath, contentType);
    } else {
      sendAudioFile(request, reply, filePath);
    }
  }

  app.get("/preview/:trackVersionId.mp3", async (request, reply) => {
    const trackVersion = await db
      .prepare("SELECT * FROM track_versions WHERE id = ?")
      .get(request.params.trackVersionId);
    if (!trackVersion) {
      sendError(reply, 404, "TRACK_VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(trackVersion.track_id);
    if (!track || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const key = trackPreviewKey({ userId: track.user_id, trackId: track.id, versionNum: trackVersion.version_num }).replace(/\.m4a$/, ".mp3");
    await serveTrackAudio(request, reply, { track, trackVersion, s3Key: key, localFileName: "preview.mp3", contentType: "audio/mpeg" });
  });

  app.get("/preview/:trackVersionId.m4a", async (request, reply) => {
    const trackVersion = await db
      .prepare("SELECT * FROM track_versions WHERE id = ?")
      .get(request.params.trackVersionId);
    if (!trackVersion) {
      sendError(reply, 404, "TRACK_VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(trackVersion.track_id);
    if (!track || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const key = trackPreviewKey({ userId: track.user_id, trackId: track.id, versionNum: trackVersion.version_num });
    await serveTrackAudio(request, reply, { track, trackVersion, s3Key: key, localFileName: "preview.m4a" });
  });

  app.get("/full/:trackVersionId.m4a", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const trackVersion = await db
      .prepare("SELECT * FROM track_versions WHERE id = ?")
      .get(request.params.trackVersionId);
    if (!trackVersion) {
      sendError(reply, 404, "TRACK_VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(trackVersion.track_id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 403, "FORBIDDEN", "Track does not belong to this user.");
      return;
    }
    const key = trackMasterKey({ userId: track.user_id, trackId: track.id, versionNum: trackVersion.version_num, format: "m4a" });
    await serveTrackAudio(request, reply, { track, trackVersion, s3Key: key, localFileName: "full.m4a" });
  });

  // Cover image serving - supports 256 and 1024 sizes
  app.get("/cover/:trackVersionId/:size", async (request, reply) => {
    const { trackVersionId, size } = request.params;
    const validSizes = ["256", "1024"];
    if (!validSizes.includes(size)) {
      sendError(reply, 400, "INVALID_SIZE", "Size must be 256 or 1024.");
      return;
    }
    const trackVersion = await db
      .prepare("SELECT * FROM track_versions WHERE id = ?")
      .get(trackVersionId);
    if (!trackVersion) {
      sendError(reply, 404, "TRACK_VERSION_NOT_FOUND", "Track version not found.");
      return;
    }
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(trackVersion.track_id);
    if (!track || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    if (storageProvider.type !== "local") {
      const key = `${trackVersionKey({ userId: track.user_id, trackId: track.id, versionNum: trackVersion.version_num })}/cover_${size}.jpg`;
      const download = storageProvider.createPresignedDownload({ key, expiresInSec: 300 });
      reply.redirect(download.url);
      return;
    }
    const versionDir = getVersionDir(track, trackVersion);
    const filePath = path.join(versionDir, `cover_${size}.jpg`);
    sendMediaFile(request, reply, filePath, "image/jpeg");
  });

  app.get("/guide/:trackVersionId", async (request, reply) => {
    const token = request.query.token;
    if (!token) {
      sendError(reply, 403, "FORBIDDEN", "Missing guide token.");
      return;
    }
    const trackVersion = await db
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
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(trackVersion.track_id);
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
    const session = await db
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

  // Device registration for share binding (requires auth)
  app.post("/device/register", { schema: schemas.deviceRegister }, async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }

    const { device_id, platform, app_version, push_token } = request.body || {};
    const now = nowIso();

    const existing = await db
      .prepare("SELECT id FROM devices WHERE user_id = ? AND device_id = ?")
      .get(userId, device_id);

    if (existing) {
      // Update existing device, including push_token if provided
      if (push_token) {
        await db.prepare(
          "UPDATE devices SET platform = ?, app_version = ?, last_seen_at = ?, push_token = ?, push_token_updated_at = ?, updated_at = ? WHERE id = ?"
        ).run(platform, app_version || null, now, push_token, now, now, existing.id);
      } else {
        await db.prepare(
          "UPDATE devices SET platform = ?, app_version = ?, last_seen_at = ?, updated_at = ? WHERE id = ?"
        ).run(platform, app_version || null, now, now, existing.id);
      }
    } else {
      const deviceRecordId = newUuid();
      await db.prepare(
        "INSERT INTO devices (id, user_id, device_id, platform, app_version, last_seen_at, push_token, push_token_updated_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(deviceRecordId, userId, device_id, platform, app_version || null, now, push_token || null, push_token ? now : null, now, now);
    }

    const deviceToken = issueDeviceToken({
      userId,
      deviceId: device_id,
      platform,
      appVersion: app_version,
    });

    reply.send({
      device_token: deviceToken,
      expires_at: new Date(Date.now() + deviceTokenTtlDays * 24 * 60 * 60 * 1000).toISOString(),
    });
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
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    // DEBUG: Log enrollment attempt
    console.error("DEBUG enrollment/start:", { userId, timestamp: new Date().toISOString() });
    const limit = await consumeRateLimit(userId, "enrollment_start", 10, 24 * 60 * 60);
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

    await db.prepare(
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

    await addAuditEntry({
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
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const { session_id, chunk_id, duration_sec, client_checksum } =
      request.body || {};

    if (!chunk_id) {
      sendError(reply, 400, "MISSING_CHUNK_ID", "chunk_id is required.");
      return;
    }
    const session = await db
      .prepare("SELECT * FROM enrollment_sessions WHERE id = ?")
      .get(session_id);
    if (!session || session.user_id !== userId) {
      sendError(reply, 404, "SESSION_NOT_FOUND", "Enrollment session not found.");
      return;
    }
    if (new Date(session.expires_at) < new Date()) {
      await db.prepare("UPDATE enrollment_sessions SET status = ? WHERE id = ?").run(
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
      await db.prepare("UPDATE enrollment_sessions SET quality_metrics = ? WHERE id = ?").run(
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
      await db.prepare("UPDATE enrollment_sessions SET quality_metrics = ? WHERE id = ?").run(
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
    await db.prepare(
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
    const userId = await requireUserId(request, reply);
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
    const session = await db
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
    await db.prepare(
      "UPDATE enrollment_sessions SET chunk_count = chunk_count + 1, quality_metrics = ? WHERE id = ?"
    ).run(toJson(metrics), sessionId);

    reply.send({
      status: "accepted",
      chunk_id: chunkId,
      duration_sec: durationSec,
    });
  });

  app.post("/voice/enrollment/complete", { schema: schemas.enrollmentComplete }, async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const { session_id } = request.body || {};

    const session = await db
      .prepare("SELECT * FROM enrollment_sessions WHERE id = ?")
      .get(session_id);
    if (!session || session.user_id !== userId) {
      sendError(reply, 404, "SESSION_NOT_FOUND", "Enrollment session not found.");
      return;
    }

    console.log("[Enrollment:complete] START", {
      sessionId: session_id,
      status: session.status,
      chunks: session.chunk_count,
    });

    if (new Date(session.expires_at) < new Date()) {
      await db.prepare("UPDATE enrollment_sessions SET status = ? WHERE id = ?").run(
        "expired",
        session_id
      );
      sendError(reply, 410, "SESSION_EXPIRED", "Enrollment session expired.");
      return;
    }

    const metrics = parseJson(session.quality_metrics, {});
    const { files: chunkFiles, tempDir, missingChunks } = await resolveEnrollmentChunkFiles({
      session,
      metrics,
      userId,
    });

    if (chunkFiles.length === 0) {
      console.error("[Enrollment:complete] No files found", { sessionId: session_id, missingChunks });
      sendError(reply, 500, "STORAGE_ERROR", "Failed to retrieve uploaded audio files. Please try again.");
      return;
    }
    let qcResult;
    try {
      // Run QC validation with quality tier grading
      qcResult = await validateEnrollmentWithGrading({
        userId,
        sessionId: session_id,
        storageDir: appConfig.STORAGE_DIR,
        chunkFiles,
        applyPreprocessing: true,
      });

      // Only reject truly unusable audio (E103 silence, E104 no files)
      const criticalErrors = qcResult.errors.filter(
        (e) => e.includes("E103_NO_AUDIO_DETECTED") || e.includes("E104")
      );

      if (criticalErrors.length > 0) {
        console.error("[Enrollment:complete] QC failed", { errors: criticalErrors, grade: qcResult.grade });
        await db.prepare(
          "UPDATE enrollment_sessions SET status = ?, completed_at = ? WHERE id = ?"
        ).run("failed_quality", nowIso(), session_id);

        const errorCode = criticalErrors[0].split(":")[0];
        sendError(reply, 422, errorCode, "Audio quality check failed.", {
          errors: criticalErrors,
          metrics: qcResult.metrics,
        });
        return;
      }

      // Store chunk quality data for improvement UI
      if (qcResult.metrics.chunk_results) {
        await db.prepare(
          "UPDATE enrollment_sessions SET chunk_quality_json = ? WHERE id = ?"
        ).run(JSON.stringify(qcResult.metrics.chunk_results), session_id);
      }

      const profileId = newUuid();
      const qualityScore = Math.round(qcResult.metrics.average_score || 50);
      const qualityTier = qcResult.grade === "F" ? "minimal" :
                          qcResult.grade === "C" ? "fair" :
                          qcResult.grade === "B" ? "good" : "excellent";
      const embeddingRef = `voice_profiles/${userId}/${profileId}/embedding.bin`;
      const shouldEmbed =
        appConfig.LIVE_PROVIDERS &&
        Boolean(appConfig.REPLICATE_API_TOKEN) &&
        Boolean(appConfig.REPLICATE_EMBEDDING_MODEL_VERSION);

      // Always create clean.wav (needed for both embedding and ElevenLabs clone)
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
      } catch (err) {
        console.warn("[Enrollment:complete] Clean audio concat failed:", err.message);
      }

      if (shouldEmbed) {
        try {
          const accessToken = crypto.randomBytes(16).toString("hex");
          await db.prepare("UPDATE enrollment_sessions SET access_token = ? WHERE id = ?").run(
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
          console.error("[Enrollment:complete] Embedding failed:", err.message);
          await db.prepare(
            "UPDATE enrollment_sessions SET status = ?, completed_at = ? WHERE id = ?"
          ).run("failed_verification", nowIso(), session_id);
          sendError(reply, 502, "E106_EMBEDDING_FAILED", "Voice embedding failed. Please try again.");
          return;
        }
      }

      // Create ElevenLabs Instant Voice Clone (for elevenlabs voice conversion provider)
      let elevenlabsVoiceId = null;
      const shouldCreateElevenLabsClone = appConfig.LIVE_PROVIDERS && Boolean(appConfig.ELEVENLABS_API_KEY);
      if (shouldCreateElevenLabsClone) {
        const cleanDir = path.join(
          appConfig.STORAGE_DIR,
          "enrollment",
          "clean",
          userId,
          session_id
        );
        const cleanPath = path.join(cleanDir, "clean.wav");
        
        if (fs.existsSync(cleanPath)) {
          try {
            const { createVoiceClone, deleteVoiceClone } = require("./providers/elevenlabs-voice");
            
            // Delete existing ElevenLabs clone if user is re-enrolling
            const existingWithClone = await db.prepare(
              "SELECT elevenlabs_voice_id FROM voice_profiles WHERE user_id = ? AND status = 'active' AND elevenlabs_voice_id IS NOT NULL"
            ).get(userId);
            if (existingWithClone?.elevenlabs_voice_id) {
              console.log(`[Enrollment:complete] Deleting existing ElevenLabs clone: ${existingWithClone.elevenlabs_voice_id}`);
              await deleteVoiceClone({
                apiKey: appConfig.ELEVENLABS_API_KEY,
                voiceId: existingWithClone.elevenlabs_voice_id,
              }).catch(err => console.warn("[Enrollment:complete] Failed to delete old clone:", err.message));
            }
            
            const voiceClone = await createVoiceClone({
              apiKey: appConfig.ELEVENLABS_API_KEY,
              audioPath: cleanPath,
              name: `porizo_user_${userId.slice(0, 8)}_${profileId.slice(0, 8)}`,
              description: `Porizo voice profile ${profileId}`,
            });
            elevenlabsVoiceId = voiceClone.voice_id;
            console.log(`[Enrollment:complete] ElevenLabs voice clone created: ${elevenlabsVoiceId}`);
          } catch (err) {
            // Non-fatal: ElevenLabs clone is optional, Seed-VC can still work
            console.error("[Enrollment:complete] ElevenLabs clone creation failed (non-fatal):", err.message);
          }
        } else {
          console.warn("[Enrollment:complete] Clean audio not found for ElevenLabs clone");
        }
      }

      // Check for existing profile to compare scores
      const existingProfile = await db
        .prepare(
          "SELECT id, quality_score FROM voice_profiles WHERE user_id = ? AND status = 'active' LIMIT 1"
        )
        .get(userId);

      // Determine outcome based on score comparison
      let outcome = "new"; // First profile
      const existingScore = existingProfile?.quality_score || 0;

      if (existingProfile) {
        outcome = qualityScore > existingScore ? "upgraded" : "replaced";
      }

      // Transaction ensures atomic profile creation: all or nothing
      await db.transaction(async () => {
        // Always mark the session as completed
        await db.prepare(
          "UPDATE enrollment_sessions SET status = ?, completed_at = ? WHERE id = ?"
        ).run("completed", nowIso(), session_id);

        if (existingProfile) {
          await db.prepare(
            "UPDATE voice_profiles SET status = ?, deleted_at = ? WHERE id = ?"
          ).run("deleted", nowIso(), existingProfile.id);
        }

        await db.prepare(
          "INSERT INTO voice_profiles (id, user_id, status, embedding_ref, quality_score, quality_tier, quality_metrics_json, model_version, consent_version, consent_at, last_verified_at, created_at, elevenlabs_voice_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(
          profileId,
          userId,
          "active",
          embeddingRef,
          qualityScore,
          qualityTier,
          JSON.stringify(qcResult.metrics),
          shouldEmbed ? appConfig.REPLICATE_EMBEDDING_MODEL_VERSION : "embed_stub",
          session.consent_version,
          session.started_at,
          nowIso(),
          nowIso(),
          elevenlabsVoiceId
        );

        await addAuditEntry({
          userId,
          action: "enrollment_completed",
          resourceType: "voice_profile",
          resourceId: profileId,
          metadata: {
            quality_score: qualityScore,
            existing_score: existingProfile ? existingScore : null,
            outcome: outcome,
            qc_metrics: qcResult.metrics,
          },
        });
      });

      // Get tier metadata for response
      const tierMeta = getTierMetadata(qualityTier);
      const chunkResults = qcResult.metrics.chunk_results || [];
      const improvementTips = chunkResults
        .filter((c) => c.issues && c.issues.length > 0)
        .map((c, i) => `Prompt ${i + 1}: ${c.issues[0]}`)
        .slice(0, 3);

      reply.code(202).send({
        status: "processing",
        job_id: newUuid(),
        voice_profile_id: profileId,
        outcome: outcome, // "new" | "upgraded" | "replaced"
        quality: {
          tier: qualityTier,
          score: qualityScore,
          new_score: qualityScore,
          existing_score: existingProfile ? existingScore : null,
          stars: tierMeta.stars,
          label: tierMeta.label,
          disclosure: tierMeta.disclosure,
          can_improve: qualityTier !== "excellent",
          improvement_tips: improvementTips,
        },
        chunks: chunkResults.map((c, i) => ({
          index: i,
          type: c.metrics?.is_singing ? "sung" : "spoken",
          quality: c.grade === "A" ? "excellent" : c.grade === "B" ? "good" : c.grade === "C" ? "fair" : "poor",
          suggestion: c.issues?.[0] || null,
        })),
        estimated_completion_sec: 30,
      });
    } catch (err) {
      console.error("[Enrollment:complete] Unexpected error:", err.message, err.stack);
      await db.prepare(
        "UPDATE enrollment_sessions SET status = ?, completed_at = ? WHERE id = ?"
      ).run("failed_internal", nowIso(), session_id);
      sendError(reply, 500, "S501_INTERNAL_ERROR", "Enrollment processing failed unexpectedly. Please try again.");
    } finally {
      if (tempDir) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  app.get("/voice/profile", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const profile = await db
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
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const profile = await db
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
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const profile = await db
      .prepare("SELECT * FROM voice_profiles WHERE user_id = ? AND status != 'deleted'")
      .get(userId);
    if (!profile) {
      sendError(reply, 404, "NO_VOICE_PROFILE", "Voice profile not found.");
      return;
    }

    // Delete ElevenLabs voice clone if exists
    if (profile.elevenlabs_voice_id && appConfig.ELEVENLABS_API_KEY) {
      try {
        const { deleteVoiceClone } = require("./providers/elevenlabs-voice");
        await deleteVoiceClone({
          apiKey: appConfig.ELEVENLABS_API_KEY,
          voiceId: profile.elevenlabs_voice_id,
        });
        console.log(`[Voice:delete] Deleted ElevenLabs clone: ${profile.elevenlabs_voice_id}`);
      } catch (err) {
        console.warn("[Voice:delete] Failed to delete ElevenLabs clone:", err.message);
      }
    }

    await db.prepare(
      "UPDATE voice_profiles SET status = ?, embedding_ref = ?, elevenlabs_voice_id = ?, deleted_at = ? WHERE id = ?"
    ).run("deleted", null, null, nowIso(), profile.id);
    await addAuditEntry({
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
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }

    // Rate limit: 30 requests per minute (generous for wizard flow)
    const limit = await consumeRateLimit(userId, "memory_questions", 30, 60);
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
    const userId = await requireUserId(request, reply);
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

    await db.prepare(
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
    await upsertPoemLibraryEntry({
      userId,
      poemId,
      origin: "created",
      shareTokenId: null,
      addedAt: now,
    });

    await addAuditEntry({
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
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }

    const poems = await db
      .prepare(
        `SELECT p.*,
                ple.origin AS library_origin,
                ple.added_at AS library_added_at,
                ple.share_token_id AS library_share_token_id,
                CASE WHEN p.user_id = ? THEN 1 ELSE 0 END AS can_edit,
                CASE WHEN p.user_id = ? THEN 1 ELSE 0 END AS can_share,
                1 AS can_delete
         FROM poems p
         JOIN poem_library_entries ple
           ON ple.poem_id = p.id
          AND ple.user_id = ?
          AND ple.removed_at IS NULL
         WHERE p.deleted_at IS NULL
         ORDER BY ple.added_at DESC`
      )
      .all(userId, userId, userId);

    // Parse verses JSON for each poem
    const parsedPoems = poems.map(row => ({
      ...withPoemLibraryFlags(row),
      verses: parseJson(row.verses, [], `poem ${row.id} verses`),
    }));

    reply.send({ poems: parsedPoems });
  });

  /**
   * GET /poems/:id - Get specific poem
   */
  app.get("/poems/:id", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }

    const poem = withPoemLibraryFlags(await getPoemForLibrary(userId, request.params.id));
    if (!poem) {
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
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }

    const poem = await db.prepare("SELECT * FROM poems WHERE id = ?").get(request.params.id);
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

    await db.prepare(
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

    await addAuditEntry({
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
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }

    const poem = await getPoemForLibrary(userId, request.params.id);
    if (!poem) {
      sendError(reply, 404, "POEM_NOT_FOUND", "Poem not found.");
      return;
    }

    const now = nowIso();
    await db.prepare(
      "UPDATE poem_library_entries SET removed_at = ?, updated_at = ? WHERE user_id = ? AND poem_id = ? AND removed_at IS NULL"
    ).run(now, now, userId, poem.id);

    await addAuditEntry({
      userId,
      action: "poem_library_removed",
      resourceType: "poem",
      resourceId: poem.id,
    });

    reply.send({ deleted: true });
  });

  /**
   * POST /poems/:id/generate - Generate verses for a poem
   *
   * Uses LLM to generate personalized verses based on poem metadata.
   * Requires LLM availability - returns 503 if AI service is unavailable.
   */
  app.post("/poems/:id/generate", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }

    // Rate limit: 20 poem generations per hour (uses LLM resources)
    const limit = await consumeRateLimit(userId, "poem_generate", 20, 60 * 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Poem generation rate limit reached.", {
        retry_at: limit.reset_at,
      });
      return;
    }

    const poem = await db.prepare("SELECT * FROM poems WHERE id = ? AND deleted_at IS NULL").get(request.params.id);
    if (!poem || poem.user_id !== userId) {
      sendError(reply, 404, "POEM_NOT_FOUND", "Poem not found.");
      return;
    }

    try {
      const result = await generatePoem({
        recipient_name: poem.recipient_name,
        occasion: poem.occasion,
        tone: poem.tone || "heartfelt",
        message: poem.message || "",
      });

      const now = nowIso();
      const versesJson = toJson(result.verses);

      await db.prepare(
        `UPDATE poems SET verses = ?, status = ?, updated_at = ? WHERE id = ?`
      ).run(versesJson, "generated", now, poem.id);

      await addAuditEntry({
        userId,
        action: "poem_generated",
        resourceType: "poem",
        resourceId: poem.id,
        metadata: { provider: "llm" },
      });

      reply.send({
        poem: {
          ...poem,
          verses: result.verses,
          status: "generated",
          updated_at: now,
        },
      });
    } catch (error) {
      console.error("[poems/generate] Generation failed:", error.message);
      // Handle specific error codes from poem generator
      if (error.code === "AI_UNAVAILABLE") {
        sendError(reply, 503, "AI_UNAVAILABLE", "AI service is temporarily unavailable. Please try again later.");
      } else if (error.code === "POEM_GENERATION_FAILED") {
        sendError(reply, 500, "GENERATION_FAILED", "Failed to generate poem. Please try again.");
      } else {
        sendError(reply, 500, "GENERATION_FAILED", "Failed to generate poem verses.");
      }
    }
  });

  // ============ Poem Sharing ============

  /**
   * POST /poems/:id/share - Create share token for a poem
   */
  app.post("/poems/:id/share", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }

    const poem = await db.prepare("SELECT * FROM poems WHERE id = ? AND deleted_at IS NULL").get(request.params.id);
    if (!poem || poem.user_id !== userId) {
      sendError(reply, 404, "POEM_NOT_FOUND", "Poem not found.");
      return;
    }

    // Check if poem has content
    const verses = parseJson(poem.verses, [], `poem ${poem.id} verses`);
    if (!verses || verses.length === 0) {
      sendError(reply, 409, "POEM_NOT_READY", "Poem has no verses to share.");
      return;
    }

    // Check if already has share token
    if (poem.share_token_id) {
      const existingShare = await db.prepare("SELECT * FROM poem_share_tokens WHERE id = ?").get(poem.share_token_id);
      if (existingShare && existingShare.status !== "revoked" && new Date(existingShare.expires_at) > new Date()) {
        reply.send({
          share_id: existingShare.id,
          share_url: `${publicBaseUrl}/poem/${existingShare.id}`,
          expires_at: existingShare.expires_at,
          claim_pin: existingShare.claim_pin,
        });
        return;
      }
    }

    const body = request.body || {};
    const allowSave = body.allow_save !== undefined ? Boolean(body.allow_save) : true;
    const shareId = newShareId();
    const expiresAt = new Date(
      Date.now() + (body.expires_in_days || 30) * 24 * 60 * 60 * 1000
    ).toISOString();

    // Extract UTM parameters
    const utmSource = request.query.utm_source || body.utm_source || null;
    const utmMedium = request.query.utm_medium || body.utm_medium || null;
    const utmCampaign = request.query.utm_campaign || body.utm_campaign || null;
    const referrer = request.headers.referer || request.headers.referrer || null;
    const createdIp = request.ip || null;
    const createdUserAgent = request.headers["user-agent"] || null;

    // Generate 6-digit PIN for claim verification
    const claimPin = String(Math.floor(100000 + Math.random() * 900000));

    await db.prepare(
      `INSERT INTO poem_share_tokens (id, poem_id, creator_id, status, claim_pin, claim_attempts, allow_save, expires_at, created_at, access_count, utm_source, utm_medium, utm_campaign, referrer, created_ip, created_user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      shareId,
      poem.id,
      userId,
      "active",
      claimPin,
      0,
      allowSave ? 1 : 0,
      expiresAt,
      nowIso(),
      0,
      utmSource,
      utmMedium,
      utmCampaign,
      referrer,
      createdIp,
      createdUserAgent
    );

    await db.prepare("UPDATE poems SET share_token_id = ?, updated_at = ? WHERE id = ?").run(
      shareId,
      nowIso(),
      poem.id
    );

    await addAuditEntry({
      userId,
      action: "poem_share_created",
      resourceType: "poem_share_token",
      resourceId: shareId,
    });

    eventsService.emit("poem_share_create", {
      userId,
      resourceType: "poem_share",
      resourceId: shareId,
      metadata: {
        poem_id: poem.id,
        occasion: poem.occasion,
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
      },
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });

    reply.send({
      share_id: shareId,
      share_url: `${publicBaseUrl}/poem/${shareId}`,
      expires_at: expiresAt,
      claim_pin: claimPin,
    });
  });

  /**
   * GET /poem-share/:shareId - Get shared poem details (public)
   */
  app.get("/poem-share/:shareId", async (request, reply) => {
    const share = await db.prepare("SELECT * FROM poem_share_tokens WHERE id = ?").get(request.params.shareId);
    if (!share || share.status === "revoked") {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Poem share not found.");
      return;
    }

    if (new Date(share.expires_at) < new Date()) {
      await db.prepare("UPDATE poem_share_tokens SET status = ? WHERE id = ?").run("expired", share.id);
      sendError(reply, 410, "SHARE_EXPIRED", "Poem share expired.");
      return;
    }

    const poem = await db.prepare("SELECT * FROM poems WHERE id = ? AND deleted_at IS NULL").get(share.poem_id);
    if (!poem) {
      sendError(reply, 404, "POEM_NOT_FOUND", "Poem not found.");
      return;
    }

    const creator = await db.prepare("SELECT id FROM users WHERE id = ?").get(share.creator_id);
    const verses = parseJson(poem.verses, [], `poem ${poem.id} verses`);

    // Update access tracking
    await db.prepare(
      "UPDATE poem_share_tokens SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?"
    ).run(nowIso(), share.id);

    // Log access
    await db.prepare(
      "INSERT INTO poem_share_access_log (id, poem_share_token_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(newUuid(), share.id, "view", toJson({ ip: request.ip }), nowIso());

    const appRequired = share.claim_policy === "app_only";

    // Response shape matches iOS PoemShareInfoResponse model
    reply.send({
      status: share.status,
      can_access: appRequired ? false : true,
      poem: {
        title: poem.title,
        recipient_name: poem.recipient_name,
        occasion: poem.occasion,
        preview_lines: verses.slice(0, 2),
        creator_name: creator ? "A friend" : "Someone special",
      },
      expires_at: share.expires_at,
      requires_pin: !!share.claim_pin && !share.bound_user_id,
      app_required: appRequired,
      app_download_url: buildShareAppDownloadUrl({ shareId: share.id, kind: "poem" }),
      claim_attempts: share.claim_attempts,
      max_attempts: 5,
    });
  });

  /**
   * POST /poem-share/:shareId/claim - Claim a shared poem
   */
  app.post("/poem-share/:shareId/claim", async (request, reply) => {
    // Auth is optional — web viewers use PIN as authentication
    let userId = null;
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      userId = await requireUserId(request, reply);
      if (!userId) return;
    } else if (allowAnonUserId && request.headers["x-user-id"]) {
      userId = request.headers["x-user-id"];
      await ensureUser(userId);
    }

    const share = await db.prepare("SELECT * FROM poem_share_tokens WHERE id = ?").get(request.params.shareId);
    if (!share || share.status === "revoked") {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Poem share not found.");
      return;
    }

    if (new Date(share.expires_at) < new Date()) {
      await db.prepare("UPDATE poem_share_tokens SET status = ? WHERE id = ?").run("expired", share.id);
      sendError(reply, 410, "SHARE_EXPIRED", "Poem share expired.");
      return;
    }

    const claimPolicy = share.claim_policy || "default";
    const appOnlyClaim = claimPolicy === "app_only";

    let claimDeviceToken = null;
    if (appOnlyClaim) {
      claimDeviceToken = getDeviceTokenPayload(request, reply, { required: true });
      if (!claimDeviceToken) {
        return;
      }
      if (claimDeviceToken.platform === "web") {
        sendError(reply, 400, "WEB_CLAIM_NOT_ALLOWED", "Web claims are not supported for this gift.");
        return;
      }
    }

    // If share has no PIN, require authenticated user
    if (!share.claim_pin && !userId) {
      sendError(reply, 401, "AUTH_REQUIRED", "Authentication required to claim this poem.");
      return;
    }

    // Check if already claimed by another user (only relevant when authenticated)
    if (userId && share.bound_user_id && share.bound_user_id !== userId) {
      sendError(reply, 409, "ALREADY_CLAIMED", "This poem has already been claimed.");
      return;
    }

    // Check if already claimed by this user — return same shape as fresh claim
    if (userId && share.bound_user_id === userId) {
      const poem = await db.prepare("SELECT * FROM poems WHERE id = ?").get(share.poem_id);
      if (share.allow_save) {
        await upsertPoemLibraryEntry({
          userId,
          poemId: share.poem_id,
          origin: "received",
          shareTokenId: share.id,
          addedAt: share.bound_at || nowIso(),
        });
      }
      reply.send({
        status: "claimed",
        poem: poem ? {
          id: poem.id, user_id: poem.user_id, title: poem.title,
          recipient_name: poem.recipient_name, occasion: poem.occasion,
          tone: poem.tone, status: poem.status,
          verses: parseJson(poem.verses, [], `poem ${poem.id} verses`),
          created_at: poem.created_at, updated_at: poem.updated_at,
        } : null,
        allow_save: !!share.allow_save,
        expires_at: share.expires_at,
      });
      return;
    }

    const body = request.body || {};
    const { pin } = body;

    // PIN verification
    if (share.claim_pin) {
      if (share.claim_attempts >= 5) {
        await db.prepare(
          "INSERT INTO poem_share_access_log (id, poem_share_token_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?, ?)"
        ).run(newUuid(), share.id, "claim_failed", toJson({ reason: "too_many_attempts" }), nowIso());
        sendError(reply, 429, "TOO_MANY_ATTEMPTS", "Too many failed PIN attempts.");
        return;
      }

      if (!pin || pin !== share.claim_pin) {
        await db.prepare("UPDATE poem_share_tokens SET claim_attempts = claim_attempts + 1 WHERE id = ?").run(share.id);
        await db.prepare(
          "INSERT INTO poem_share_access_log (id, poem_share_token_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?, ?)"
        ).run(newUuid(), share.id, "claim_failed", toJson({ reason: "invalid_pin" }), nowIso());
        sendError(reply, 401, "INVALID_PIN", "Invalid PIN.");
        return;
      }
    }

    // Claim the share — bind to user only if authenticated
    const now = nowIso();
    if (userId) {
      await db.prepare(
        "UPDATE poem_share_tokens SET status = ?, bound_user_id = ?, bound_device_id = COALESCE(?, bound_device_id), bound_at = ?, claim_attempts = 0 WHERE id = ?"
      ).run("claimed", userId, claimDeviceToken?.device_id || null, now, share.id);

      if (share.allow_save) {
        await upsertPoemLibraryEntry({
          userId,
          poemId: share.poem_id,
          origin: "received",
          shareTokenId: share.id,
          addedAt: now,
        });
      }

      await addAuditEntry({
        userId,
        action: "poem_share_claimed",
        resourceType: "poem_share_token",
        resourceId: share.id,
      });

      eventsService.emit("poem_share_claim", {
        userId,
        resourceType: "poem_share",
        resourceId: share.id,
        metadata: { poem_id: share.poem_id },
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
    }
    // Anonymous unlocks: do NOT reset claim_attempts — prevents brute-force bypass

    await db.prepare(
      "INSERT INTO poem_share_access_log (id, poem_share_token_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(newUuid(), share.id, userId ? "claim_success" : "pin_unlock", toJson({ user_id: userId }), nowIso());

    const poem = await db.prepare("SELECT * FROM poems WHERE id = ?").get(share.poem_id);

    // Response shape matches iOS PoemShareClaimResponse model
    // "unlocked" = anonymous web access via PIN; "claimed" = bound to authenticated user
    reply.send({
      status: userId ? "claimed" : "unlocked",
      poem: poem ? {
        id: poem.id, user_id: poem.user_id, title: poem.title,
        recipient_name: poem.recipient_name, occasion: poem.occasion,
        tone: poem.tone, status: poem.status,
        verses: parseJson(poem.verses, [], `poem ${poem.id} verses`),
        created_at: poem.created_at, updated_at: poem.updated_at,
      } : null,
      allow_save: !!share.allow_save,
      expires_at: share.expires_at,
    });
  });

  // ============ Gift Scheduling + Delivery ============

  app.post("/gifts", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const giftingEnabled = await getFeatureFlag(db, "gift_scheduling_enabled");
    if (!giftingEnabled) {
      sendError(reply, 503, "GIFTING_DISABLED", "Gift scheduling is currently disabled.");
      return;
    }

    const body = request.body || {};
    const contentType = typeof body.content_type === "string" ? body.content_type.trim().toLowerCase() : "";
    const contentId = typeof body.content_id === "string" ? body.content_id.trim() : "";
    const deliveryMode = body.delivery_mode === "scheduled" ? "scheduled" : "immediate";
    const senderTimezone = typeof body.sender_timezone === "string" && body.sender_timezone.trim()
      ? body.sender_timezone.trim()
      : "UTC";
    const channels = normalizeGiftChannels(body.channels);
    const recipientPhone = normalizeGiftPhone(body.recipient_phone);
    const recipientEmail = normalizeGiftEmail(body.recipient_email);
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 500) : "";
    const expiresInDays = Math.max(1, Math.min(Number(body.expires_in_days || 30), 90));
    const versionNum = Number.isFinite(Number(body.version_num)) ? Number(body.version_num) : null;
    const idempotencyKey = (
      request.headers["idempotency-key"] ||
      body.idempotency_key ||
      null
    );

    if (!["song", "poem"].includes(contentType)) {
      sendError(reply, 400, "INVALID_CONTENT_TYPE", "content_type must be song or poem.");
      return;
    }
    if (!contentId) {
      sendError(reply, 400, "INVALID_CONTENT_ID", "content_id is required.");
      return;
    }
    if (!channels.length) {
      sendError(reply, 400, "INVALID_CHANNELS", "At least one channel is required.");
      return;
    }
    if (channels.includes("sms") && !recipientPhone) {
      sendError(reply, 400, "INVALID_RECIPIENT_PHONE", "Valid recipient_phone is required for SMS.");
      return;
    }
    if (channels.includes("email") && !recipientEmail) {
      sendError(reply, 400, "INVALID_RECIPIENT_EMAIL", "Valid recipient_email is required for email.");
      return;
    }

    let sendAt = new Date();
    if (deliveryMode === "scheduled") {
      const parsed = new Date(body.send_at || "");
      if (Number.isNaN(parsed.getTime())) {
        sendError(reply, 400, "INVALID_SEND_AT", "send_at must be a valid ISO timestamp.");
        return;
      }
      if (parsed.getTime() <= Date.now()) {
        sendError(reply, 400, "INVALID_SEND_AT", "send_at must be in the future.");
        return;
      }
      sendAt = parsed;
    }
    const sendAtIso = sendAt.toISOString();

    if (idempotencyKey) {
      const existing = await db.prepare(
        "SELECT * FROM gift_orders WHERE sender_user_id = ? AND idempotency_key = ? LIMIT 1"
      ).get(userId, idempotencyKey);
      if (existing) {
        reply.send({ gift: renderGiftSummary(existing), idempotent: true });
        return;
      }
    }

    try {
      const wallet = await ensureGiftWalletRow(userId);
      if (wallet.balance < 1) {
        sendError(reply, 402, "INSUFFICIENT_GIFT_TOKENS", "You need a gift token to schedule a gift.");
        return;
      }

      const giftOrderId = `gift_${crypto.randomBytes(12).toString("hex")}`;
      const requireAppClaim = await getFeatureFlag(db, "gift_require_app_claim");

      let share;
      if (contentType === "song") {
        share = await ensureTrackGiftShareToken({
          trackId: contentId,
          senderUserId: userId,
          giftOrderId,
          versionNum,
          sendAtIso,
          expiresInDays,
          requireAppClaim: Boolean(requireAppClaim),
        });
      } else {
        share = await ensurePoemGiftShareToken({
          poemId: contentId,
          senderUserId: userId,
          giftOrderId,
          sendAtIso,
          expiresInDays,
          requireAppClaim: Boolean(requireAppClaim),
        });
      }

      const walletDebit = await applyGiftWalletTransaction({
        userId,
        type: "gift_spend",
        amount: -1,
        source: "gift_order",
        referenceType: "gift_order",
        referenceId: giftOrderId,
        description: "Gift token consumed",
        metadata: { content_type: contentType, content_id: contentId },
        idempotencyKey: idempotencyKey ? `gift_spend_${idempotencyKey}` : null,
      });

      await db.prepare(
        `INSERT INTO gift_orders (
          id, sender_user_id, content_type, content_id, status, dispatch_status, delivery_mode,
          send_at, sender_timezone, channels_json, recipient_phone, recipient_email, message,
          share_token_id, share_url, claim_pin, claim_policy, expires_in_days, dispatch_attempts,
          last_dispatch_error, dispatched_at, cancelled_at, token_transaction_id, refund_transaction_id,
          version_num, idempotency_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        giftOrderId,
        userId,
        contentType,
        contentId,
        "scheduled",
        "pending",
        deliveryMode,
        sendAtIso,
        senderTimezone,
        toJson(channels),
        recipientPhone,
        recipientEmail,
        message || null,
        share.shareId,
        share.shareUrl,
        share.claimPin,
        requireAppClaim ? "app_only" : "default",
        expiresInDays,
        0,
        null,
        null,
        null,
        walletDebit.transactionId,
        null,
        versionNum,
        idempotencyKey,
        nowIso(),
        nowIso()
      );

      await addAuditEntry({
        userId,
        action: "gift_scheduled",
        resourceType: "gift_order",
        resourceId: giftOrderId,
        metadata: {
          content_type: contentType,
          delivery_mode: deliveryMode,
          channels,
          send_at: sendAtIso,
        },
      });
      eventsService.emit("gift_scheduled", {
        userId,
        resourceType: "gift_order",
        resourceId: giftOrderId,
        metadata: {
          content_type: contentType,
          delivery_mode: deliveryMode,
          channels,
          send_at: sendAtIso,
        },
      });

      if (deliveryMode === "immediate") {
        await dispatchGiftById(giftOrderId);
      }

      const created = await db.prepare("SELECT * FROM gift_orders WHERE id = ?").get(giftOrderId);
      reply.send({
        gift: renderGiftSummary(created),
        wallet_balance: (await ensureGiftWalletRow(userId)).balance,
      });
    } catch (err) {
      if (err.code === "TRACK_NOT_FOUND" || err.code === "POEM_NOT_FOUND") {
        sendError(reply, 404, err.code, "Gift content not found.");
        return;
      }
      if (err.code === "VERSION_NOT_FOUND") {
        sendError(reply, 404, "VERSION_NOT_FOUND", "Track version not found.");
        return;
      }
      if (err.code === "TRACK_NOT_READY" || err.code === "POEM_NOT_READY") {
        sendError(reply, 409, err.code, "Gift content is not ready for sharing.");
        return;
      }
      if (err.code === "ACTIVE_SHARE_CONFLICT" || err.code === "ACTIVE_GIFT_SHARE_CONFLICT") {
        sendError(reply, 409, err.code, "An active share already exists for this content.");
        return;
      }
      if (err.code === "INSUFFICIENT_GIFT_TOKENS") {
        sendError(reply, 402, "INSUFFICIENT_GIFT_TOKENS", "You need a gift token to schedule a gift.");
        return;
      }
      console.error("[Gifts] Failed to create gift:", err);
      sendError(reply, 500, "GIFT_CREATE_FAILED", err.message);
    }
  });

  app.get("/gifts", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const limit = Math.max(1, Math.min(Number(request.query?.limit || 50), 100));
    const offset = Math.max(0, Number(request.query?.offset || 0));
    const status = typeof request.query?.status === "string" ? request.query.status.trim() : null;

    try {
      let rows;
      if (status) {
        rows = await db.prepare(
          `SELECT * FROM gift_orders
           WHERE sender_user_id = ? AND status = ?
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`
        ).all(userId, status, limit, offset);
      } else {
        rows = await db.prepare(
          `SELECT * FROM gift_orders
           WHERE sender_user_id = ?
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`
        ).all(userId, limit, offset);
      }

      reply.send({
        gifts: rows.map(renderGiftSummary),
        wallet_balance: (await ensureGiftWalletRow(userId)).balance,
      });
    } catch (err) {
      console.error("[Gifts] Failed to list gifts:", err);
      sendError(reply, 500, "GIFT_LIST_FAILED", err.message);
    }
  });

  app.patch("/gifts/:id", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const gift = await db.prepare("SELECT * FROM gift_orders WHERE id = ?").get(request.params.id);
    if (!gift || gift.sender_user_id !== userId) {
      sendError(reply, 404, "GIFT_NOT_FOUND", "Gift not found.");
      return;
    }
    if (!(gift.status === "scheduled" || gift.status === "dispatch_retry")) {
      sendError(reply, 409, "GIFT_NOT_EDITABLE", "Gift can no longer be edited.");
      return;
    }

    const body = request.body || {};
    const nextTimezone = typeof body.sender_timezone === "string" && body.sender_timezone.trim()
      ? body.sender_timezone.trim()
      : gift.sender_timezone;
    const nextMessage = typeof body.message === "string"
      ? body.message.trim().slice(0, 500)
      : (gift.message || "");
    const nextChannels = body.channels
      ? normalizeGiftChannels(body.channels)
      : parseGiftChannelsJson(gift.channels_json);
    const nextPhone = body.recipient_phone !== undefined
      ? normalizeGiftPhone(body.recipient_phone)
      : gift.recipient_phone;
    const nextEmail = body.recipient_email !== undefined
      ? normalizeGiftEmail(body.recipient_email)
      : gift.recipient_email;
    let nextSendAt = gift.send_at;
    if (body.send_at !== undefined) {
      const parsed = new Date(body.send_at || "");
      if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
        sendError(reply, 400, "INVALID_SEND_AT", "send_at must be a future ISO timestamp.");
        return;
      }
      nextSendAt = parsed.toISOString();
    }

    if (!nextChannels.length) {
      sendError(reply, 400, "INVALID_CHANNELS", "At least one channel is required.");
      return;
    }
    if (nextChannels.includes("sms") && !nextPhone) {
      sendError(reply, 400, "INVALID_RECIPIENT_PHONE", "Valid recipient_phone is required for SMS.");
      return;
    }
    if (nextChannels.includes("email") && !nextEmail) {
      sendError(reply, 400, "INVALID_RECIPIENT_EMAIL", "Valid recipient_email is required for email.");
      return;
    }

    await db.prepare(
      `UPDATE gift_orders
       SET send_at = ?, sender_timezone = ?, channels_json = ?, recipient_phone = ?, recipient_email = ?, message = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      nextSendAt,
      nextTimezone,
      toJson(nextChannels),
      nextPhone,
      nextEmail,
      nextMessage || null,
      nowIso(),
      gift.id
    );

    await addAuditEntry({
      userId,
      action: "gift_rescheduled",
      resourceType: "gift_order",
      resourceId: gift.id,
      metadata: { send_at: nextSendAt, channels: nextChannels },
    });
    eventsService.emit("gift_rescheduled", {
      userId,
      resourceType: "gift_order",
      resourceId: gift.id,
      metadata: { send_at: nextSendAt, channels: nextChannels },
    });

    const updated = await db.prepare("SELECT * FROM gift_orders WHERE id = ?").get(gift.id);
    reply.send({ gift: renderGiftSummary(updated) });
  });

  app.post("/gifts/:id/cancel", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const gift = await db.prepare("SELECT * FROM gift_orders WHERE id = ?").get(request.params.id);
    if (!gift || gift.sender_user_id !== userId) {
      sendError(reply, 404, "GIFT_NOT_FOUND", "Gift not found.");
      return;
    }
    if (gift.status === "dispatched") {
      sendError(reply, 409, "GIFT_ALREADY_DISPATCHED", "Gift has already been dispatched.");
      return;
    }
    if (gift.status === "cancelled") {
      reply.send({
        cancelled: true,
        gift: renderGiftSummary(gift),
        wallet_balance: (await ensureGiftWalletRow(userId)).balance,
      });
      return;
    }
    if (!(gift.status === "scheduled" || gift.status === "dispatch_retry")) {
      sendError(reply, 409, "GIFT_NOT_CANCELLABLE", "Gift cannot be cancelled in its current state.");
      return;
    }

    let refundTxId = gift.refund_transaction_id || null;
    if (!refundTxId) {
      const refundTx = await applyGiftWalletTransaction({
        userId,
        type: "gift_refund",
        amount: 1,
        source: "gift_cancel",
        referenceType: "gift_order",
        referenceId: gift.id,
        description: "Gift token refunded after cancellation",
        metadata: { gift_id: gift.id },
        idempotencyKey: `gift_refund_${gift.id}`,
      });
      refundTxId = refundTx.transactionId;
    }

    await db.prepare(
      `UPDATE gift_orders
       SET status = 'cancelled',
           dispatch_status = 'cancelled',
           cancelled_at = ?,
           refund_transaction_id = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(nowIso(), refundTxId, nowIso(), gift.id);

    await addAuditEntry({
      userId,
      action: "gift_cancelled",
      resourceType: "gift_order",
      resourceId: gift.id,
      metadata: { refund_transaction_id: refundTxId },
    });
    eventsService.emit("gift_cancelled", {
      userId,
      resourceType: "gift_order",
      resourceId: gift.id,
      metadata: { refund_transaction_id: refundTxId },
    });

    const updated = await db.prepare("SELECT * FROM gift_orders WHERE id = ?").get(gift.id);
    reply.send({
      cancelled: true,
      gift: renderGiftSummary(updated),
      wallet_balance: (await ensureGiftWalletRow(userId)).balance,
    });
  });

  // ============ Poem Audio (TTS) ============

  /**
   * POST /poems/:id/audio - Generate TTS audio for a poem
   */
  app.post("/poems/:id/audio", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const poem = await getPoemForLibrary(userId, request.params.id);
    if (!poem) {
      sendError(reply, 404, "POEM_NOT_FOUND", "Poem not found.");
      return;
    }

    const verses = parseJson(poem.verses, [], `poem ${poem.id} verses`);
    if (!verses || verses.length === 0) {
      sendError(reply, 409, "POEM_NOT_READY", "Poem has no verses.");
      return;
    }

    // Idempotent: check if audio already exists
    const audioDir = path.join(appConfig.STORAGE_DIR, "poems", poem.user_id, poem.id);
    const audioPath = path.join(audioDir, "audio.mp3");
    const audioUrl = `/poems/${poem.id}/audio`;
    const sendReadyResponse = (generatedAt) => {
      reply.send({
        audio_url: audioUrl,
        generated_at: generatedAt || nowIso(),
      });
    };

    if (fs.existsSync(audioPath)) {
      sendReadyResponse(poem.audio_generated_at);
      return;
    }

    // If generation is already in progress for this poem, wait for it and reuse result.
    const lockKey = `${poem.user_id}:${poem.id}`;
    const inFlightGeneration = poemAudioGenerationLocks.get(lockKey);
    if (inFlightGeneration) {
      request.log.info({ poem_id: poem.id, user_id: userId }, "[PoemAudio] Waiting for in-flight generation");
      try {
        await inFlightGeneration;
      } catch (_err) {
        // If the in-flight generation failed, fall through and allow one fresh attempt.
      }
      if (fs.existsSync(audioPath)) {
        sendReadyResponse(poem.audio_generated_at);
        return;
      }
    }

    // Rate-limit only when a fresh provider generation is needed.
    const limit = await consumeRateLimit(userId, "poem_audio", 10, 60 * 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Poem audio generation rate limit reached.", { retry_at: limit.reset_at });
      return;
    }

    // Re-check to avoid races between limit check and generation start.
    if (fs.existsSync(audioPath)) {
      sendReadyResponse(poem.audio_generated_at);
      return;
    }

    // Compose text for TTS
    const textParts = [];
    if (poem.recipient_name) textParts.push(`For ${poem.recipient_name}.`);
    textParts.push(""); // pause
    for (const verse of verses) {
      textParts.push(verse);
    }
    const ttsText = textParts.join("\n");

    // Generate TTS via ElevenLabs
    const { generateSpeech } = require("./providers/elevenlabs");
    const generationPromise = (async () => {
      ensureDir(audioDir);
      await generateSpeech({
        baseUrl: config.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io",
        apiKey: config.ELEVENLABS_API_KEY,
        voiceId: config.ELEVENLABS_TTS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM",
        text: ttsText,
        outputPath: audioPath,
        timeoutMs: 30000,
      });

      const generatedAt = nowIso();
      try {
        await db.prepare("UPDATE poems SET audio_generated_at = ?, updated_at = ? WHERE id = ?").run(
          generatedAt,
          generatedAt,
          poem.id
        );
      } catch (err) {
        if (String(err?.message || "").includes("no such column: audio_generated_at")) {
          // SQLite migrations in some environments do not yet include this optional column.
          await db.prepare("UPDATE poems SET updated_at = ? WHERE id = ?").run(generatedAt, poem.id);
        } else {
          throw err;
        }
      }

      await addAuditEntry({
        userId,
        action: "poem_audio_generated",
        resourceType: "poem",
        resourceId: poem.id,
      });

      return generatedAt;
    })();

    poemAudioGenerationLocks.set(lockKey, generationPromise);
    try {
      const generatedAt = await generationPromise;
      sendReadyResponse(generatedAt);
    } catch (err) {
      console.error(`[PoemAudio] TTS generation failed for poem ${poem.id}:`, err.message);
      sendError(reply, 502, "TTS_FAILED", "Failed to generate poem audio.");
      return;
    } finally {
      if (poemAudioGenerationLocks.get(lockKey) === generationPromise) {
        poemAudioGenerationLocks.delete(lockKey);
      }
    }
  });

  /**
   * GET /poems/:id/audio - Stream poem TTS audio
   */
  app.get("/poems/:id/audio", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const poem = await getPoemForLibrary(userId, request.params.id);
    if (!poem) {
      sendError(reply, 404, "POEM_NOT_FOUND", "Poem not found.");
      return;
    }

    const audioPath = path.join(appConfig.STORAGE_DIR, "poems", poem.user_id, poem.id, "audio.mp3");
    if (!fs.existsSync(audioPath)) {
      sendError(reply, 404, "AUDIO_NOT_FOUND", "Poem audio not yet generated.");
      return;
    }

    // Use the same byte-range responder as tracks to keep AVPlayer behavior consistent.
    sendMediaFile(request, reply, audioPath, "audio/mpeg", {
      cacheControl: "private, max-age=3600",
    });
  });

  // ============ Tracks ============

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
    if (track.share_token_id) {
      sendError(reply, 409, "SHARE_EXISTS", "Track already has a share token.");
      return;
    }
    const body = request.body || {};
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
      share_url: `${publicBaseUrl}/play/${shareId}`,
      qr_code_url: `https://cdn.porizo.local/qr/${shareId}.png`,
      expires_at: expiresAt,
      claim_pin: claimPin, // Creator must share this PIN with recipient out-of-band
    });
  });

  // ============ Poem OG Image ============
  // Generates a dynamic 1200×630 social share card with the poem text
  app.get("/poem/:shareId/og-image.png", async (request, reply) => {
    const share = await db.prepare(
      "SELECT p.title, p.recipient_name, p.occasion, p.verses FROM poem_share_tokens pst JOIN poems p ON p.id = pst.poem_id WHERE pst.id = ?"
    ).get(request.params.shareId);
    if (!share) return reply.status(404).send("Not found");

    const imageBuffer = await generatePoemOgImage({
      title: share.title,
      recipientName: share.recipient_name,
      occasion: share.occasion,
      verses: parseJson(share.verses, []),
    });

    if (!imageBuffer) return reply.status(500).send("Image generation unavailable");

    reply
      .type("image/png")
      .header("Cache-Control", "public, max-age=86400")
      .send(imageBuffer);
  });

  // ============ Poem Viewer ============
  // Serves the web-based viewer for shared poems
  app.get("/poem/:shareId", async (request, reply) => {
    const shareId = request.params.shareId;

    // Validate share exists and fetch poem metadata for OG tags
    const share = await db.prepare(
      "SELECT pst.id, pst.status, pst.expires_at, pst.poem_id, p.title, p.recipient_name, p.occasion, p.verses FROM poem_share_tokens pst LEFT JOIN poems p ON p.id = pst.poem_id WHERE pst.id = ?"
    ).get(shareId);
    if (!share) {
      return reply.status(404).type("text/html").send(shareNotFoundHtml("poem"));
    }

    // Log access
    await db.prepare(
      "INSERT INTO poem_share_access_log (id, poem_share_token_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(newUuid(), share.id, "web_viewer_opened", toJson({ user_agent: request.headers["user-agent"] || null }), nowIso());

    eventsService.emit("poem_teaser_viewed", {
      resourceType: "poem_share",
      resourceId: share.id,
      metadata: {
        utm_source: request.query.utm_source || null,
        utm_medium: request.query.utm_medium || null,
      },
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });

    // Build OG metadata for rich social share cards
    const ogTitle = share.recipient_name
      ? `A poem for ${share.recipient_name}`
      : "Someone wrote you a poem!";
    let ogDescription = "A personalized poem written just for you — tap to read";
    try {
      const verses = JSON.parse(share.verses || "[]");
      const previewText = verses.flat().filter((l) => typeof l === "string" && l.trim()).slice(0, 4).join(" / ");
      if (previewText) {
        ogDescription = `"${previewText.slice(0, 140)}${previewText.length > 140 ? "…" : ""}" — tap to read`;
      }
    } catch (_) { /* use fallback description */ }
    const ogImage = `${publicBaseUrl}/poem/${shareId}/og-image.png`;
    const ogUrl = `${publicBaseUrl}/poem/${shareId}`;

    // Serve the poem viewer HTML with OG tags injected
    const viewerHtml = injectOgTags(poemViewerTemplate, {
      ogTitle,
      ogDescription,
      ogImage,
      ogImageWidth: 1200,
      ogImageHeight: 630,
      ogUrl,
      ogType: "article",
    });
    return reply.type("text/html").send(viewerHtml);
  });

  // ============ Web Player ============
  // Serves the web-based player for shared songs
  app.get("/play/:shareId", async (request, reply) => {
    const shareId = request.params.shareId;

    // Validate share exists and fetch track metadata for OG tags
    const share = await db.prepare(
      "SELECT st.id, st.status, st.expires_at, st.track_id, st.track_version_id, t.title, t.recipient_name, t.occasion FROM share_tokens st LEFT JOIN tracks t ON t.id = st.track_id WHERE st.id = ?"
    ).get(shareId);
    if (!share) {
      return reply.status(404).type("text/html").send(shareNotFoundHtml("song"));
    }

    // Log access
    await addShareAccessLog({
      shareTokenId: share.id,
      eventType: "web_player_opened",
      metadata: { user_agent: request.headers["user-agent"] || null },
    });

    // Emit teaser_viewed event for growth analytics
    eventsService.emit("teaser_viewed", {
      resourceType: "share",
      resourceId: share.id,
      metadata: {
        utm_source: request.query.utm_source || null,
        utm_medium: request.query.utm_medium || null,
        utm_campaign: request.query.utm_campaign || null,
      },
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });

    let track = null;
    let trackVersion = null;
    if (share.track_id && share.track_version_id) {
      track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(share.track_id);
      trackVersion = await db.prepare("SELECT * FROM track_versions WHERE id = ?").get(share.track_version_id);
    }

    const isCrawler = isSocialCrawlerUserAgent(request.headers["user-agent"]);
    let includeVideoMeta = true;
    if (track && trackVersion) {
      if (isCrawler) {
        includeVideoMeta = await isShareMp4Ready({ track, trackVersion });
        if (!includeVideoMeta) {
          // Give crawlers a short chance to fetch a pre-generated video without delaying too long.
          const generated = await withTimeout(ensureShareMp4({ track, trackVersion }), 2500);
          includeVideoMeta = Boolean(generated) || await isShareMp4Ready({ track, trackVersion });
        }
      } else {
        // Best-effort prewarm for older shares in human traffic paths.
        void ensureShareMp4({ track, trackVersion }).catch((err) => {
          request.log.warn(
            { shareId: share.id, err: err?.message || String(err) },
            "Background share.mp4 prewarm failed"
          );
        });
      }
    } else if (isCrawler) {
      includeVideoMeta = false;
    }

    // Build OG metadata for rich social share cards
    const ogTitle = share.recipient_name
      ? `A song for ${share.recipient_name}`
      : "Someone made you a song!";
    const occasion = formatOccasion(share.occasion);
    const ogDescription = occasion
      ? `A personalized ${occasion} song — tap to listen`
      : "A personalized song made just for you — tap to listen";
    const ogImage = buildShareCoverUrl(shareId);
    const ogImageWidth = 1200;
    const ogImageHeight = 630;
    const ogUrl = `${publicBaseUrl}/play/${shareId}`;
    const ogVideo = includeVideoMeta ? `${publicBaseUrl}/share/${shareId}/share.mp4` : null;
    const embedUrl = `${publicBaseUrl}/embed/${shareId}`;
    const oembedUrl = `${publicBaseUrl}/oembed?url=${encodeURIComponent(ogUrl)}&format=json`;

    // Serve the web player HTML with OG tags injected
    const playerHtml = injectOgTags(webPlayerTemplate, {
      ogTitle, ogDescription, ogImage, ogImageWidth, ogImageHeight, ogUrl,
      ogType: includeVideoMeta ? "video.other" : "website",
      ogVideo, embedUrl, oembedUrl,
      fbAppId: facebookAppId,
    });
    return reply.type("text/html").send(playerHtml);
  });

  // Backwards-compatible short link that forwards to /play/:id
  app.get("/s/:shareId", async (request, reply) => {
    return reply.redirect(`/play/${request.params.shareId}`);
  });

  // Embed player for Twitter Player Card iframes and oEmbed
  app.get("/embed/:shareId", async (request, reply) => {
    const shareId = request.params.shareId;
    const share = await db.prepare(
      "SELECT st.id, st.status, st.expires_at, st.track_id, st.track_version_id, t.title, t.recipient_name, t.occasion FROM share_tokens st LEFT JOIN tracks t ON t.id = st.track_id WHERE st.id = ?"
    ).get(shareId);
    if (!share) {
      return reply.status(404).type("text/html").send(shareNotFoundHtml("song"));
    }

    const title = share.recipient_name
      ? `A song for ${share.recipient_name}`
      : "Someone made you a song!";
    const occasion = formatOccasion(share.occasion);
    const subtitle = occasion
      ? `A personalized ${occasion} song`
      : "A personalized song made just for you";
    const image = buildShareCoverUrl(shareId);
    const link = `${publicBaseUrl}/play/${shareId}`;
    const mediaUrl = `${publicBaseUrl}/share/${shareId}/share.mp4`;

    const html = embedPlayerTemplate
      .replaceAll("{{EMBED_TITLE}}", escapeHtml(title))
      .replaceAll("{{EMBED_SUBTITLE}}", escapeHtml(subtitle))
      .replaceAll("{{EMBED_IMAGE}}", escapeHtml(image))
      .replaceAll("{{EMBED_LINK}}", escapeHtml(link))
      .replaceAll("{{EMBED_MEDIA_URL}}", escapeHtml(mediaUrl))
      .replaceAll("{{SHARE_ID}}", escapeHtml(shareId));

    await addShareAccessLog({
      shareTokenId: share.id,
      eventType: "embed_player_opened",
      metadata: { user_agent: request.headers["user-agent"] || null },
    });

    reply
      .type("text/html")
      .header("Content-Security-Policy", "frame-ancestors *")
      .header("X-Frame-Options", "ALLOWALL")
      .send(html);
  });

  // oEmbed endpoint for Slack, WordPress, Notion auto-embeds
  app.get("/oembed", async (request, reply) => {
    const { url, format } = request.query;
    if (format && format !== "json") {
      sendError(reply, 501, "FORMAT_NOT_SUPPORTED", "Only JSON format is supported.");
      return;
    }
    if (!url) {
      sendError(reply, 400, "MISSING_URL", "The url parameter is required.");
      return;
    }

    // Extract shareId from the URL pattern /play/:shareId
    const match = String(url).match(/\/play\/([a-zA-Z0-9_-]+)/);
    if (!match) {
      sendError(reply, 404, "INVALID_URL", "URL does not match a Porizo share link.");
      return;
    }
    const shareId = match[1];

    const share = await db.prepare(
      "SELECT st.id, st.status, st.track_id, st.track_version_id, t.title, t.recipient_name, t.occasion, t.user_id FROM share_tokens st LEFT JOIN tracks t ON t.id = st.track_id WHERE st.id = ?"
    ).get(shareId);
    if (!share) {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Share not found.");
      return;
    }

    const title = share.recipient_name
      ? `A song for ${share.recipient_name}`
      : "Someone made you a song!";
    const thumbnail = buildShareCoverUrl(shareId);
    const embedSrc = `${publicBaseUrl}/embed/${shareId}`;

    reply.send({
      type: "rich",
      version: "1.0",
      provider_name: "Porizo",
      provider_url: publicBaseUrl,
      title,
      thumbnail_url: thumbnail,
      thumbnail_width: 1200,
      thumbnail_height: 630,
      width: 480,
      height: 180,
      html: `<iframe width="480" height="180" src="${escapeHtml(embedSrc)}" frameborder="0" allow="autoplay; encrypted-media"></iframe>`,
      cache_age: 86400,
    });
  });

  app.get("/share/:shareId", async (request, reply) => {
    const share = await db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(request.params.shareId);
    if (!share || share.status === "revoked") {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Share token not found.");
      return;
    }
    if (new Date(share.expires_at) < new Date()) {
      await db.prepare("UPDATE share_tokens SET status = ? WHERE id = ?").run("expired", share.id);
      sendError(reply, 410, "SHARE_EXPIRED", "Share token expired.");
      return;
    }
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(share.track_id);
    const trackVersion = await db.prepare("SELECT * FROM track_versions WHERE id = ?").get(share.track_version_id);
    if (!track || !trackVersion) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    await db.prepare(
      "UPDATE share_tokens SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?"
    ).run(nowIso(), share.id);
    await addShareAccessLog({
      shareTokenId: share.id,
      eventType: "link_opened",
      metadata: { user_agent: request.headers["user-agent"] || null },
    });

    const deviceToken = getDeviceTokenPayload(request, reply);
    const requestDeviceId = deviceToken?.device_id || null;
    const requestPlatform = deviceToken?.platform || null;

    if (share.status === "claimed") {
      const canAccess =
        Boolean(deviceToken) &&
        share.bound_device_id === requestDeviceId &&
        share.bound_device_platform === requestPlatform;

      reply.send({
        status: "claimed",
        can_access: canAccess,
        app_required: !canAccess, // Only require app if different device
        app_download_url: buildShareAppDownloadUrl({ shareId: share.id }),
      });
      return;
    }

    const appRequired = share.claim_policy === "app_only";

    // Check if requesting device matches bound device (for can_access).
    // For app-only gifts we require a valid device token for access checks.
    const canAccess = appRequired
      ? Boolean(deviceToken)
      : (
        share.status === "unbound" ||
        (Boolean(deviceToken) &&
          share.bound_device_id === requestDeviceId &&
          share.bound_device_platform === requestPlatform)
      );

    const [hydratedSharedTrack] = await hydrateTrackCoverImages(track ? [track] : []);
    const trackInfo = {
      title: hydratedSharedTrack?.title ?? track.title,
      recipient_name: hydratedSharedTrack?.recipient_name ?? track.recipient_name,
      duration_sec: (hydratedSharedTrack?.duration_target || track.duration_target || 60),
      cover_image_url:
        hydratedSharedTrack?.cover_image_small_url ||
        hydratedSharedTrack?.cover_image_url ||
        hydratedSharedTrack?.cover_image_large_url ||
        null,
    };

    const shareStreamUrl = share.web_stream_allowed && !appRequired
      ? `${getBaseUrl(request)}/share/${share.id}/audio`
      : null;

    reply.send({
      status: "unbound",
      track_preview: trackInfo,
      track: trackInfo, // Alias for web player compatibility
      can_access: canAccess,
      app_required: appRequired,
      web_stream_url: shareStreamUrl,
      app_download_url: buildShareAppDownloadUrl({ shareId: share.id }),
    });
  });

  app.post("/share/:shareId/claim", { schema: schemas.shareClaim }, async (request, reply) => {
    const share = await db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(request.params.shareId);
    if (!share || share.status === "revoked") {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Share token not found.");
      return;
    }
    if (new Date(share.expires_at) < new Date()) {
      await db.prepare("UPDATE share_tokens SET status = ? WHERE id = ?").run("expired", share.id);
      sendError(reply, 410, "SHARE_EXPIRED", "Share token expired.");
      return;
    }
    const body = request.body || {};
    const { pin } = body;
    let deviceToken = getDeviceTokenPayload(request, reply, { required: false });
    if (!deviceToken && allowDeviceTokenFallback) {
      const fallbackDeviceId = body.device_id || request.headers["x-device-id"];
      const fallbackPlatform = body.platform || request.headers["x-platform"];
      if (fallbackDeviceId && fallbackPlatform) {
        deviceToken = {
          device_id: fallbackDeviceId,
          platform: fallbackPlatform,
          app_version: body.app_version || request.headers["x-app-version"] || null,
          sub: request.headers["x-user-id"] || null,
        };
      }
    }

    if (!deviceToken) {
      if (allowDeviceTokenFallback && (body.device_id || body.platform || body.app_version)) {
        sendError(reply, 400, "INVALID_REQUEST", "device_id and platform are required.");
      } else {
        sendError(reply, 401, "DEVICE_TOKEN_REQUIRED", "Missing x-device-token header.");
      }
      return;
    }

    const deviceId = deviceToken.device_id;
    const platform = deviceToken.platform;
    const appVersion = deviceToken.app_version || body.app_version || null;
    const claimUserId = deviceToken.sub || request.headers["x-user-id"] || null;

    if (platform === "web") {
      await addShareAccessLog({
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
        await addShareAccessLog({
          shareTokenId: share.id,
          eventType: "claim_failed",
          metadata: { reason: "too_many_attempts", platform },
        });
        sendError(reply, 429, "TOO_MANY_ATTEMPTS", "Too many failed PIN attempts. Contact the sender.");
        return;
      }

      if (!pin || pin !== share.claim_pin) {
        await db.prepare("UPDATE share_tokens SET claim_attempts = claim_attempts + 1 WHERE id = ?").run(share.id);
        await addShareAccessLog({
          shareTokenId: share.id,
          eventType: "claim_failed",
          metadata: { reason: "invalid_pin", platform },
        });
        sendError(reply, 401, "INVALID_PIN", "Invalid PIN. Please check with the sender.");
        return;
      }
    }

    if (share.bound_device_id && share.bound_device_id !== deviceId) {
      await addShareAccessLog({
        shareTokenId: share.id,
        eventType: "claim_failed",
        metadata: { reason: "token_already_bound", platform },
      });
      sendError(reply, 409, "TOKEN_ALREADY_BOUND", "Share token already bound to another device.");
      return;
    }
    if (share.bound_user_id && claimUserId && share.bound_user_id !== claimUserId) {
      await addShareAccessLog({
        shareTokenId: share.id,
        eventType: "claim_failed",
        metadata: { reason: "token_already_claimed_by_another_user", platform },
      });
      sendError(reply, 409, "TOKEN_ALREADY_BOUND", "Share token already bound to another user.");
      return;
    }
    const claimAt = nowIso();
    await db.prepare(
      "UPDATE share_tokens SET status = ?, bound_device_id = ?, bound_device_platform = ?, bound_app_version = ?, bound_user_id = COALESCE(?, bound_user_id), bound_at = ?, web_stream_allowed = ?, claim_attempts = 0 WHERE id = ?"
    ).run("claimed", deviceId, platform, appVersion, claimUserId, claimAt, 0, share.id);

    if (claimUserId) {
      await upsertTrackLibraryEntry({
        userId: claimUserId,
        trackId: share.track_id,
        origin: "received",
        shareTokenId: share.id,
        addedAt: claimAt,
      });
    }
    await addShareAccessLog({
      shareTokenId: share.id,
      eventType: "claim_success",
      metadata: { platform, app_version: appVersion, user_id: claimUserId },
    });

    // Emit share_claim event for analytics
    eventsService.emit("share_claim", {
      resourceType: "share",
      resourceId: share.id,
      metadata: { platform, track_id: share.track_id },
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });

    reply.send({
      status: "claimed",
      app_save_allowed: true,
      expires_at: share.expires_at,
    });
  });

  app.get("/share/:shareId/stream", async (request, reply) => {
    const share = await db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(request.params.shareId);
    if (!share || share.status === "revoked") {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Share token not found.");
      return;
    }
    if (new Date(share.expires_at) < new Date()) {
      await db.prepare("UPDATE share_tokens SET status = ? WHERE id = ?").run("expired", share.id);
      sendError(reply, 410, "SHARE_EXPIRED", "Share token expired.");
      return;
    }

    const deviceToken = getDeviceTokenPayload(request, reply, { required: false });
    if (share.status === "claimed" && !deviceToken) {
      sendError(reply, 400, "DEVICE_TOKEN_REQUIRED", "Missing x-device-token header.");
      return;
    }
    const deviceId = deviceToken?.device_id || null;
    const platform = deviceToken?.platform || request.headers["x-platform"];
    const baseUrl = getBaseUrl(request);

    // Get track info (needed for all paths)
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(share.track_id);
    const trackVersion = await db.prepare("SELECT * FROM track_versions WHERE id = ?").get(share.track_version_id);

    // For CLAIMED shares, require device match
    if (share.status === "claimed") {
      if (share.bound_device_id !== deviceId || share.bound_device_platform !== platform) {
        await addShareAccessLog({
          shareTokenId: share.id,
          eventType: "access_denied",
          metadata: { reason: "device_mismatch" },
        });
        sendError(reply, 403, "TOKEN_ALREADY_BOUND", "Share token bound to another device.");
        return;
      }

      await addShareAccessLog({
        shareTokenId: share.id,
        eventType: "stream_started",
        metadata: { platform, claimed: true },
      });

      // Emit share_stream event for analytics
      eventsService.emit("share_stream", {
        resourceType: "share",
        resourceId: share.id,
        metadata: { platform, claimed: true, track_id: share.track_id },
        ip: request.ip,
        userAgent: request.headers["user-agent"],
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

      await addShareAccessLog({
        shareTokenId: share.id,
        eventType: "stream_started",
        metadata: { platform: platform || "web", claimed: false },
      });

      // Emit share_stream event for analytics
      eventsService.emit("share_stream", {
        resourceType: "share",
        resourceId: share.id,
        metadata: { platform: platform || "web", claimed: false, track_id: share.track_id },
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });

      if (!share.web_stream_allowed) {
        sendError(reply, 403, "APP_CLAIM_REQUIRED", "This gift must be claimed in the app.");
        return;
      }

      // Return audio URL for unclaimed web shares
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
    const share = await db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(request.params.shareId);
    if (!share || share.status === "revoked") {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Share token not found.");
      return;
    }
    if (new Date(share.expires_at) < new Date()) {
      await db.prepare("UPDATE share_tokens SET status = ? WHERE id = ?").run("expired", share.id);
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
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(share.track_id);
    const trackVersion = await db
      .prepare("SELECT * FROM track_versions WHERE id = ?")
      .get(share.track_version_id);
    if (!track || !trackVersion) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    await addShareAccessLog({
      shareTokenId: share.id,
      eventType: "audio_served",
      metadata: { user_agent: request.headers["user-agent"] || null },
    });
    // Prefer full render, fall back to preview
    const fullKey = trackMasterKey({ userId: track.user_id, trackId: track.id, versionNum: trackVersion.version_num, format: "m4a" });
    const previewKey = trackPreviewKey({ userId: track.user_id, trackId: track.id, versionNum: trackVersion.version_num });
    await serveTrackAudio(request, reply, { track, trackVersion, s3Key: trackVersion.full_url ? fullKey : previewKey, localFileName: trackVersion.full_url ? "full.m4a" : "preview.m4a" });
  });

  // Stable cover image endpoint for social crawlers.
  // Always resolves to a direct image file and never a short-lived DB URL value.
  app.get("/share/:shareId/cover.jpg", async (request, reply) => {
    const share = await db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(request.params.shareId);
    if (!share || share.status === "revoked") {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Share token not found.");
      return;
    }
    if (new Date(share.expires_at) < new Date()) {
      await db.prepare("UPDATE share_tokens SET status = ? WHERE id = ?").run("expired", share.id);
      sendError(reply, 410, "SHARE_EXPIRED", "Share token expired.");
      return;
    }
    const fallbackPath = path.join(process.cwd(), "public", "assets", "og-song.png");
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(share.track_id);
    const trackVersion = await db
      .prepare("SELECT * FROM track_versions WHERE id = ?")
      .get(share.track_version_id);
    if (!track || !trackVersion) {
      const generatedFallback = await generateSongOgImage({
        title: track?.title,
        recipientName: track?.recipient_name,
        occasion: track?.occasion,
        coverPath: null,
        brandName: "Porizo",
      });
      if (generatedFallback) {
        await addShareAccessLog({
          shareTokenId: share.id,
          eventType: "share_cover_served",
          metadata: {
            reason: "track_or_version_missing_generated_og",
            user_agent: request.headers["user-agent"] || null,
          },
        });
        return reply
          .type("image/jpeg")
          .header("Cache-Control", "public, max-age=14400")
          .send(generatedFallback);
      }

      if (!fs.existsSync(fallbackPath)) {
        sendError(reply, 404, "COVER_NOT_FOUND", "Cover image not available.");
        return;
      }
      await addShareAccessLog({
        shareTokenId: share.id,
        eventType: "share_cover_fallback_served",
        metadata: {
          reason: "track_or_version_missing_static_fallback",
          user_agent: request.headers["user-agent"] || null,
        },
      });
      return sendMediaFile(request, reply, fallbackPath, "image/png", {
        cacheControl: "public, max-age=14400",
      });
    }

    const versionDir = getVersionDir(track, trackVersion);
    const localCoverPath = path.join(versionDir, "cover_1024.jpg");
    const localOgCardPath = path.join(versionDir, "share_og_1200x630.jpg");
    const versionStoragePrefix = trackVersionKey({
      userId: track.user_id,
      trackId: track.id,
      versionNum: trackVersion.version_num,
    });
    const coverKey = `${versionStoragePrefix}/cover_1024.jpg`;
    const ogCardKey = `${versionStoragePrefix}/share_og_1200x630.jpg`;

    if (storageProvider.type !== "local") {
      if (!fs.existsSync(localCoverPath)) {
        await ensureLocalFileFromStorage({ key: coverKey, localPath: localCoverPath });
      }
      if (!fs.existsSync(localOgCardPath)) {
        await ensureLocalFileFromStorage({ key: ogCardKey, localPath: localOgCardPath });
      }
    }

    if (!fs.existsSync(localOgCardPath)) {
      const generatedOgImage = await generateSongOgImage({
        title: track.title,
        recipientName: track.recipient_name,
        occasion: track.occasion,
        coverPath: fs.existsSync(localCoverPath) ? localCoverPath : null,
        brandName: "Porizo",
      });

      if (generatedOgImage) {
        ensureDir(versionDir);
        fs.writeFileSync(localOgCardPath, generatedOgImage);

        if (storageProvider.type !== "local") {
          try {
            await storageProvider.putFile({
              key: ogCardKey,
              filePath: localOgCardPath,
              contentType: "image/jpeg",
            });
          } catch (uploadErr) {
            console.error(
              `[share-cover] Failed to upload generated OG card for share ${share.id}:`,
              uploadErr.message
            );
          }
        }
      }
    }

    const hasOgCard = fs.existsSync(localOgCardPath);
    const hasNativeCover = fs.existsSync(localCoverPath);
    const imagePath = hasOgCard
      ? localOgCardPath
      : (hasNativeCover ? localCoverPath : fallbackPath);
    if (!fs.existsSync(imagePath)) {
      sendError(reply, 404, "COVER_NOT_FOUND", "Cover image not available.");
      return;
    }

    const reason = hasOgCard
      ? "generated_og_available"
      : (hasNativeCover ? "cover_available" : "cover_missing");

    await addShareAccessLog({
      shareTokenId: share.id,
      eventType: hasOgCard || hasNativeCover ? "share_cover_served" : "share_cover_fallback_served",
      metadata: {
        reason,
        user_agent: request.headers["user-agent"] || null,
      },
    });

    const contentType = imagePath.endsWith(".png") ? "image/png" : "image/jpeg";
    sendMediaFile(request, reply, imagePath, contentType, {
      cacheControl: "public, max-age=14400",
    });
  });

  // Share MP4 for og:video embeds (iMessage, Discord)
  app.get("/share/:shareId/share.mp4", async (request, reply) => {
    const share = await db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(request.params.shareId);
    if (!share || share.status === "revoked") {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Share token not found.");
      return;
    }
    if (new Date(share.expires_at) < new Date()) {
      await db.prepare("UPDATE share_tokens SET status = ? WHERE id = ?").run("expired", share.id);
      sendError(reply, 410, "SHARE_EXPIRED", "Share token expired.");
      return;
    }
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(share.track_id);
    const trackVersion = await db
      .prepare("SELECT * FROM track_versions WHERE id = ?")
      .get(share.track_version_id);
    if (!track || !trackVersion) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const mp4Path = await ensureShareMp4({ track, trackVersion });
    if (!mp4Path) {
      sendError(reply, 404, "VIDEO_NOT_FOUND", "Share video not available.");
      return;
    }
    await addShareAccessLog({
      shareTokenId: share.id,
      eventType: "share_mp4_served",
      metadata: { user_agent: request.headers["user-agent"] || null },
    });
    sendMediaFile(request, reply, mp4Path, "video/mp4");
  });

  app.get("/share/:shareId/playlist", async (request, reply) => {
    const share = await db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(request.params.shareId);
    if (!share || share.status === "revoked") {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Share token not found.");
      return;
    }
    if (new Date(share.expires_at) < new Date()) {
      await db.prepare("UPDATE share_tokens SET status = ? WHERE id = ?").run("expired", share.id);
      sendError(reply, 410, "SHARE_EXPIRED", "Share token expired.");
      return;
    }
    const deviceToken = getDeviceTokenPayload(request, reply, { required: true });
    if (!deviceToken) {
      return;
    }
    const deviceId = deviceToken.device_id;
    const platform = deviceToken.platform;
    if (!share.bound_device_id) {
      sendError(reply, 403, "NOT_CLAIMED", "Share token has not been claimed.");
      return;
    }
    if (share.bound_device_id !== deviceId || share.bound_device_platform !== platform) {
      sendError(reply, 403, "TOKEN_ALREADY_BOUND", "Share token bound to another device.");
      return;
    }
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(share.track_id);
    const trackVersion = await db
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
    await addShareAccessLog({
      shareTokenId: share.id,
      eventType: "playlist_served",
      metadata: { platform },
    });
    reply.type("application/vnd.apple.mpegurl").send(lines.join("\n"));
  });

  app.get("/share/:shareId/segment/:segment", async (request, reply) => {
    const share = await db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(request.params.shareId);
    if (!share || share.status === "revoked") {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Share token not found.");
      return;
    }
    if (new Date(share.expires_at) < new Date()) {
      await db.prepare("UPDATE share_tokens SET status = ? WHERE id = ?").run("expired", share.id);
      sendError(reply, 410, "SHARE_EXPIRED", "Share token expired.");
      return;
    }
    const deviceToken = getDeviceTokenPayload(request, reply, { required: true });
    if (!deviceToken) {
      return;
    }
    const deviceId = deviceToken.device_id;
    const platform = deviceToken.platform;
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
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(share.track_id);
    const trackVersion = await db
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
    const share = await db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(request.params.shareId);
    if (!share || share.status === "revoked") {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Share token not found.");
      return;
    }
    if (new Date(share.expires_at) < new Date()) {
      await db.prepare("UPDATE share_tokens SET status = ? WHERE id = ?").run("expired", share.id);
      sendError(reply, 410, "SHARE_EXPIRED", "Share token expired.");
      return;
    }
    const deviceToken = getDeviceTokenPayload(request, reply, { required: true });
    if (!deviceToken) {
      return;
    }
    const deviceId = deviceToken.device_id;
    const platform = deviceToken.platform;
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
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    if (!track.share_token_id) {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Share token not found.");
      return;
    }
    await db.prepare("UPDATE share_tokens SET status = ? WHERE id = ?").run(
      "revoked",
      track.share_token_id
    );
    await addShareAccessLog({
      shareTokenId: track.share_token_id,
      eventType: "revoked",
      metadata: { reason: "creator_revoked" },
    });
    await addAuditEntry({
      userId,
      action: "share_revoked",
      resourceType: "share_token",
      resourceId: track.share_token_id,
    });
    reply.send({ revoked: true });
  });

  // Share statistics endpoint - returns analytics for track owner
  app.get("/tracks/:id/share/stats", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    if (!track.share_token_id) {
      sendError(reply, 404, "SHARE_NOT_FOUND", "No share exists for this track.");
      return;
    }

    const share = await db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(track.share_token_id);
    if (!share) {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Share token not found.");
      return;
    }

    // Get access log summary
    const accessLogs = await db
      .prepare(
        "SELECT event_type, COUNT(*) as count, MAX(created_at) as last_at FROM share_access_log WHERE share_token_id = ? GROUP BY event_type"
      )
      .all(share.id);

    const eventCounts = {};
    let totalEvents = 0;
    for (const log of accessLogs) {
      const count = Number(log.count) || 0;
      eventCounts[log.event_type] = {
        count,
        last_at: log.last_at,
      };
      totalEvents += count;
    }

    // Get recent access log entries (last 10)
    const recentActivity = (await db
      .prepare(
        "SELECT event_type, metadata, created_at FROM share_access_log WHERE share_token_id = ? ORDER BY created_at DESC LIMIT 10"
      )
      .all(share.id)
    )
      .map((row) => ({
        event_type: row.event_type,
        metadata: parseJson(row.metadata),
        created_at: row.created_at,
      }));

    reply.send({
      share_id: share.id,
      share_url: `${publicBaseUrl}/play/${share.id}`,
      claim_pin: share.claim_pin,
      status: share.status,
      created_at: share.created_at,
      expires_at: share.expires_at,
      is_expired: new Date(share.expires_at) < new Date(),
      total_events: totalEvents,
      event_counts: eventCounts,
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
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    if (!track.share_token_id) {
      sendError(reply, 404, "SHARE_NOT_FOUND", "No share exists for this track.");
      return;
    }

    const share = await db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(track.share_token_id);
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
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    if (!track.share_token_id) {
      sendError(reply, 404, "SHARE_NOT_FOUND", "No share exists for this track.");
      return;
    }

    const share = await db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(track.share_token_id);
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
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    reply.send({ versions: await getTrackVersions(track, getBaseUrl(request)) });
  });

  // Stream availability check for a specific version (useful for TestFlight smoke checks)
  app.get("/tracks/:id/versions/:version/stream-check", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const versionNum = Number.parseInt(request.params.version, 10);
    if (!Number.isFinite(versionNum)) {
      sendError(reply, 400, "INVALID_VERSION", "Invalid version number.");
      return;
    }
    const trackVersion = findTrackVersion(track.id, versionNum);
    if (!trackVersion) {
      sendError(reply, 404, "VERSION_NOT_FOUND", "Track version not found.");
      return;
    }

    const baseUrl = getBaseUrl(request);
    const canCheck = typeof storageProvider.objectExists === "function";
    const result = {
      track_id: track.id,
      version_num: trackVersion.version_num,
      storage: storageProvider.type,
      preview: null,
      full: null,
      generated_at: nowIso(),
    };

    const { previewUrl, fullUrl } = buildTrackVersionUrls({
      storageProvider,
      track,
      version: trackVersion,
      baseUrl,
      rewriteStreamUrl,
    });

    if (trackVersion.preview_url) {
      let exists = null;
      if (storageProvider.type === "s3" && track.user_id && canCheck) {
        const key = trackPreviewKey({
          userId: track.user_id,
          trackId: track.id,
          versionNum: trackVersion.version_num,
        });
        exists = await storageProvider.objectExists({ key });
      }
      result.preview = { url: previewUrl, exists };
    }

    if (trackVersion.full_url) {
      let exists = null;
      if (storageProvider.type === "s3" && track.user_id && canCheck) {
        const key = trackMasterKey({
          userId: track.user_id,
          trackId: track.id,
          versionNum: trackVersion.version_num,
          format: "m4a",
        });
        exists = await storageProvider.objectExists({ key });
      }
      result.full = { url: fullUrl, exists };
    }

    reply.send(result);
  });

  app.get("/entitlements", async (request, reply) => {
    const userId = await requireUserId(request, reply);
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
        risk_level: await getUserRiskLevel(userId),
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
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    try {
      const entitlements = await subscriptionManager.getEntitlements(userId);
      const subscription = await subscriptionManager.getActiveSubscription(userId);
      const toSafeInt = (value, fallback = 0) => {
        const n = Number(value);
        return Number.isFinite(n) ? Math.trunc(n) : fallback;
      };
      const toIsoOrNull = (value) => {
        if (!value) return null;
        const date = value instanceof Date ? value : new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
      };

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
        songs_remaining: toSafeInt(entitlements.songsRemaining),
        songs_allowance: toSafeInt(entitlements.songsAllowance),
        songs_used_total: toSafeInt(entitlements.songsUsedTotal),
        trial_songs_remaining: toSafeInt(entitlements.trialSongsRemaining),
        trial_expires_at: toIsoOrNull(entitlements.trialExpiresAt),
        preview_count_today: toSafeInt(entitlements.previewCountToday),
        plan_id: entitlements.planId,
        billing_period: entitlements.billingPeriod,
        subscription_starts_at: toIsoOrNull(entitlements.subscriptionStartsAt),
        subscription_renews_at: toIsoOrNull(entitlements.subscriptionRenewsAt),
        auto_renew_enabled: subscription?.auto_renew_enabled || false,
        is_in_grace_period: subscription?.status === "grace_period" || false,
      });
    } catch (err) {
      console.error("[Billing] Error fetching billing entitlements:", err);
      sendError(reply, 500, "BILLING_ERROR", err.message);
    }
  });

  /**
   * Get one-off gift wallet state
   * GET /billing/gift-wallet
   */
  app.get("/billing/gift-wallet", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    try {
      const summary = await getGiftWalletSummary(userId, Number(request.query?.limit || 20));
      reply.send({
        balance: summary.balance,
        updated_at: summary.updated_at,
        transactions: summary.transactions,
      });
    } catch (err) {
      console.error("[Billing] Gift wallet fetch error:", err);
      sendError(reply, 500, "GIFT_WALLET_ERROR", err.message);
    }
  });

  /**
   * Validate an Apple consumable purchase and credit one gift token.
   * POST /billing/receipt/apple/consumable
   */
  app.post("/billing/receipt/apple/consumable", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const {
      transactionId,
      transaction_id: legacyTransactionId,
    } = request.body || {};
    const effectiveTransactionId = transactionId || legacyTransactionId;

    if (!effectiveTransactionId) {
      sendError(reply, 400, "MISSING_TRANSACTION_ID", "transactionId is required.");
      return;
    }

    if (!appleValidator.isConfigured()) {
      sendError(reply, 503, "APPLE_NOT_CONFIGURED", "Apple App Store validation not configured.");
      return;
    }

    try {
      const existingReceipt = await db.prepare(
        "SELECT user_id FROM purchase_receipts WHERE transaction_id = ?"
      ).get(effectiveTransactionId);
      if (existingReceipt) {
        if (existingReceipt.user_id !== userId) {
          sendError(
            reply,
            409,
            "PURCHASE_CONFLICT",
            "This purchase is already linked to a different account."
          );
          return;
        }
        const summary = await getGiftWalletSummary(userId, 20);
        reply.send({
          success: true,
          already_processed: true,
          balance: summary.balance,
          transactions: summary.transactions,
        });
        return;
      }

      const validation = await appleValidator.verifyTransaction(effectiveTransactionId);
      if (!validation.valid) {
        sendError(reply, 400, "INVALID_RECEIPT", validation.error || "Receipt validation failed.");
        return;
      }
      if (validation.type !== "one_time_purchase") {
        sendError(
          reply,
          400,
          "INVALID_RECEIPT_TYPE",
          "Transaction is not a consumable purchase."
        );
        return;
      }
      if (validation.productId !== giftTokenProductId) {
        sendError(
          reply,
          400,
          "INVALID_PRODUCT",
          `Unsupported consumable product: ${validation.productId}`
        );
        return;
      }

      const receiptId = `rcpt_${crypto.randomBytes(12).toString("hex")}`;
      await db.prepare(
        `INSERT INTO purchase_receipts (
          id, user_id, subscription_id, transaction_id, original_transaction_id,
          product_id, platform, receipt_data, verification_status, verification_response,
          purchase_date, expires_date, is_trial, is_upgrade, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        receiptId,
        userId,
        null,
        validation.transactionId || effectiveTransactionId,
        validation.originalTransactionId || validation.transactionId || effectiveTransactionId,
        validation.productId,
        "apple",
        null,
        "verified",
        toJson({ type: validation.type, environment: validation.environment || "production" }),
        (validation.purchaseDate instanceof Date ? validation.purchaseDate : new Date()).toISOString(),
        null,
        0,
        0,
        nowIso()
      );

      await applyGiftWalletTransaction({
        userId,
        type: "gift_purchase",
        amount: 1,
        source: "apple_consumable",
        referenceType: "receipt",
        referenceId: receiptId,
        description: "Apple consumable gift token purchase",
        metadata: {
          transaction_id: validation.transactionId || effectiveTransactionId,
          product_id: validation.productId,
        },
        idempotencyKey: `gift_receipt_${validation.transactionId || effectiveTransactionId}`,
      });

      await addAuditEntry({
        userId,
        action: "gift_token_purchased",
        resourceType: "purchase_receipt",
        resourceId: receiptId,
        metadata: { product_id: validation.productId },
      });
      eventsService.emit("gift_token_purchased", {
        userId,
        resourceType: "purchase_receipt",
        resourceId: receiptId,
        metadata: { product_id: validation.productId },
      });

      const summary = await getGiftWalletSummary(userId, 20);
      reply.send({
        success: true,
        already_processed: false,
        balance: summary.balance,
        transactions: summary.transactions,
      });
    } catch (err) {
      console.error("[Billing] Apple consumable sync error:", err);
      sendError(reply, 500, "GIFT_PURCHASE_SYNC_ERROR", err.message);
    }
  });

  /**
   * Validate Apple receipt and sync subscription
   * POST /billing/receipt/apple
   */
  app.post("/billing/receipt/apple", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const {
      transactionId,
      transaction_id: legacyTransactionId,
    } = request.body || {};
    const effectiveTransactionId = transactionId || legacyTransactionId;

    if (!effectiveTransactionId) {
      sendError(
        reply,
        400,
        "MISSING_TRANSACTION_ID",
        "transactionId (or transaction_id) is required."
      );
      return;
    }

    if (!appleValidator.isConfigured()) {
      sendError(reply, 503, "APPLE_NOT_CONFIGURED", "Apple App Store validation not configured.");
      return;
    }

    try {
      // Validate with Apple
      const validation = await appleValidator.verifyTransaction(
        effectiveTransactionId
      );

      if (!validation.valid) {
        sendError(reply, 400, "INVALID_RECEIPT", validation.error || "Receipt validation failed.");
        return;
      }
      if (validation.type && validation.type !== "subscription") {
        sendError(
          reply,
          400,
          "INVALID_RECEIPT_TYPE",
          "Transaction is not an auto-renewable subscription."
        );
        return;
      }

      // Sync subscription to database
      const result = await subscriptionManager.syncSubscription(userId, validation);

      // Add audit entry
      await addAuditEntry({
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
          plan_id: entitlements?.planId || null,
          billing_period: entitlements?.billingPeriod || null,
          subscription_starts_at: entitlements?.subscriptionStartsAt?.toISOString() || null,
          subscription_renews_at: entitlements?.subscriptionRenewsAt?.toISOString() || null,
          auto_renew_enabled: subscription?.auto_renew_enabled ?? false,
          is_in_grace_period: subscription?.status === "grace_period",
        },
      });
    } catch (err) {
      if (err.message === "SUBSCRIPTION_BELONGS_TO_ANOTHER_USER") {
        sendError(
          reply,
          409,
          "SUBSCRIPTION_CONFLICT",
          "This App Store subscription is already linked to a different account."
        );
        return;
      }
      console.error("[Billing] Apple receipt validation error:", err);
      sendError(reply, 500, "VALIDATION_ERROR", err.message);
    }
  });

  /**
   * Validate Google Play receipt and sync subscription
   * POST /billing/receipt/google
   *
   * Request body:
   * - purchase_token: string (required) - Google Play purchase token
   * - subscription_id: string (required) - Google Play subscription product ID
   */
  app.post("/billing/receipt/google", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    try {
      if (!googleValidator.isConfigured()) {
        sendError(reply, 501, "NOT_IMPLEMENTED", "Google Play validation is not configured.");
        return;
      }

      const { purchase_token, subscription_id } = request.body || {};
      if (!purchase_token || !subscription_id) {
        sendError(reply, 400, "MISSING_PARAMS", "purchase_token and subscription_id are required.");
        return;
      }

      const validation = await googleValidator.verifySubscription(purchase_token, subscription_id);
      if (!validation.valid) {
        sendError(reply, 400, "INVALID_RECEIPT", validation.reason || "Receipt validation failed.");
        return;
      }

      // Acknowledge the purchase if not already acknowledged (required within 3 days)
      if (!validation.acknowledged) {
        try {
          await googleValidator.acknowledgePurchase(purchase_token, subscription_id, "subscription");
        } catch (ackErr) {
          console.error("[Billing] Failed to acknowledge Google purchase:", ackErr.message);
          // Non-fatal - continue with subscription sync
        }
      }

      // Sync subscription to our database
      const subscription = await subscriptionManager.syncFromGoogle({
        userId,
        purchaseToken: purchase_token,
        subscriptionId: subscription_id,
        orderId: validation.orderId,
        tier: validation.tier,
        status: validation.status,
        expiresAt: validation.expiryTime,
        autoRenewing: validation.autoRenewing,
      });

      // Add audit entry for compliance (matching Apple endpoint pattern)
      await addAuditEntry({
        userId,
        action: "subscription_synced",
        resourceType: "subscription",
        resourceId: subscription.id,
        metadata: {
          tier: subscription.tier,
          isNew: subscription.is_new,
          platform: "google",
        },
      });

      // Fetch full entitlements after sync (matching Apple endpoint pattern)
      const entitlements = await subscriptionManager.getEntitlements(userId);

      reply.send({
        success: true,
        subscription: {
          id: subscription.id,
          tier: subscription.tier,
          status: subscription.status,
          expires_at: subscription.expires_at,
          auto_renewing: subscription.auto_renewing,
        },
        entitlements: entitlements
          ? {
              tier: entitlements.tier,
              songs_remaining: entitlements.songsRemaining,
              songs_allowance: entitlements.songsAllowance,
              songs_used_total: entitlements.songsUsedTotal,
              trial_songs_remaining: entitlements.trialSongsRemaining,
              trial_expires_at: entitlements.trialExpiresAt?.toISOString() || null,
              preview_count_today: entitlements.previewCountToday,
              plan_id: entitlements.planId,
              billing_period: entitlements.billingPeriod,
              subscription_starts_at:
                entitlements.subscriptionStartsAt?.toISOString() || null,
              subscription_renews_at:
                entitlements.subscriptionRenewsAt?.toISOString() || null,
            }
          : null,
      });
    } catch (err) {
      console.error("[Billing] Google receipt validation error:", err);
      sendError(reply, 500, "VALIDATION_ERROR", err.message);
    }
  });

  /**
   * Get available subscription plans (public endpoint for clients)
   * GET /billing/plans
   */
  app.get("/billing/plans", async (request, reply) => {
    try {
      const plans = await planConfigService.getPlans();
      const trialConfig = await planConfigService.getTrialConfig();
      const productMappings = await planConfigService.getProductMappings();

      const productIdsByPlan = new Map();
      for (const mapping of productMappings.values()) {
        const planEntry = productIdsByPlan.get(mapping.plan_id) || {
          apple: { monthly: null, annual: null },
          google: { monthly: null, annual: null },
        };
        if (mapping.platform === "apple" || mapping.platform === "google") {
          if (mapping.billing_period === "monthly" || mapping.billing_period === "annual") {
            planEntry[mapping.platform][mapping.billing_period] = mapping.product_id;
          }
        }
        productIdsByPlan.set(mapping.plan_id, planEntry);
      }

      // Filter to active plans and format for client consumption (snake_case for iOS)
      const activePlans = plans
        .filter((p) => p.is_active)
        .map((p) => {
          const productIds = productIdsByPlan.get(p.id) || {
            apple: { monthly: null, annual: null },
            google: { monthly: null, annual: null },
          };
          return {
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
            apple_product_ids: {
              monthly: productIds.apple.monthly,
              annual: productIds.apple.annual,
            },
            google_product_ids: {
              monthly: productIds.google.monthly,
              annual: productIds.google.annual,
            },
          };
        });

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
  const handleSubscriptionStatusGet = async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    try {
      const subscription = await subscriptionManager.getActiveSubscription(userId);
      const entitlements = await subscriptionManager.getEntitlements(userId);
      const hasActiveSubscription = Boolean(subscription);

      reply.send({
        hasActiveSubscription,
        has_subscription: hasActiveSubscription,
        subscription: subscription
          ? {
              id: subscription.id,
              tier: subscription.tier,
              status: subscription.status,
              productId: subscription.product_id,
              product_id: subscription.product_id,
              platform: subscription.platform,
              expiresAt: subscription.expires_at,
              expires_at: subscription.expires_at,
              autoRenewEnabled: Boolean(subscription.auto_renew_enabled),
              auto_renew_enabled: Boolean(subscription.auto_renew_enabled),
              isInGracePeriod: subscription.status === "grace_period",
              is_in_grace_period: subscription.status === "grace_period",
              gracePeriodExpiresAt: subscription.grace_period_expires_at,
              grace_period_expires_at: subscription.grace_period_expires_at,
              createdAt: subscription.created_at,
              created_at: subscription.created_at,
            }
          : null,
        entitlements: entitlements
          ? {
              tier: entitlements.tier,
              songsRemaining: entitlements.songsRemaining,
              songs_remaining: entitlements.songsRemaining,
              songsAllowance: entitlements.songsAllowance,
              songs_allowance: entitlements.songsAllowance,
              songsUsedTotal: entitlements.songsUsedTotal,
              songs_used_total: entitlements.songsUsedTotal,
              trialSongsRemaining: entitlements.trialSongsRemaining,
              trial_songs_remaining: entitlements.trialSongsRemaining,
              trialExpiresAt: entitlements.trialExpiresAt,
              trial_expires_at: entitlements.trialExpiresAt,
              previewCountToday: entitlements.previewCountToday,
              preview_count_today: entitlements.previewCountToday,
              planId: entitlements.planId,
              plan_id: entitlements.planId,
              billingPeriod: entitlements.billingPeriod,
              billing_period: entitlements.billingPeriod,
              subscriptionStartsAt: entitlements.subscriptionStartsAt,
              subscription_starts_at: entitlements.subscriptionStartsAt,
              subscriptionRenewsAt: entitlements.subscriptionRenewsAt,
              subscription_renews_at: entitlements.subscriptionRenewsAt,
            }
          : null,
      });
    } catch (err) {
      console.error("[Billing] Get subscription status error:", err);
      sendError(reply, 500, "STATUS_ERROR", err.message);
    }
  };

  app.get("/billing/subscription-status", handleSubscriptionStatusGet);
  // Backward-compatible alias used by older iOS clients.
  app.get("/billing/subscription", handleSubscriptionStatusGet);

  /**
   * Restore purchases from Apple/Google
   * POST /billing/restore
   */
  app.post("/billing/restore", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const {
      platform,
      transactionId,
      transaction_id: legacyTransactionId,
    } = request.body || {};
    const effectiveTransactionId = transactionId || legacyTransactionId;

    if (!platform || !effectiveTransactionId) {
      sendError(
        reply,
        400,
        "MISSING_PARAMS",
        "platform and transactionId (or transaction_id) are required."
      );
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
        validation = await appleValidator.verifyTransaction(effectiveTransactionId);
      } else {
        // Google Play - not yet implemented
        sendError(reply, 501, "NOT_IMPLEMENTED", "Google Play restore not yet implemented.");
        return;
      }

      if (!validation.valid) {
        sendError(reply, 400, "INVALID_RECEIPT", validation.error || "Receipt validation failed.");
        return;
      }
      if (validation.type && validation.type !== "subscription") {
        sendError(
          reply,
          400,
          "INVALID_RECEIPT_TYPE",
          "Transaction is not an auto-renewable subscription."
        );
        return;
      }

      // Sync subscription
      const result = await subscriptionManager.syncSubscription(userId, validation);

      await addAuditEntry({
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
      if (err.message === "SUBSCRIPTION_BELONGS_TO_ANOTHER_USER") {
        sendError(
          reply,
          409,
          "SUBSCRIPTION_CONFLICT",
          "This App Store subscription is already linked to a different account."
        );
        return;
      }
      console.error("[Billing] Restore error:", err);
      sendError(reply, 500, "RESTORE_ERROR", err.message);
    }
  });

  /**
   * Activate free trial
   * POST /billing/trial/activate
   */
  app.post("/billing/trial/activate", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    try {
      const result = await subscriptionManager.activateTrial(userId);

      await addAuditEntry({
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
        trial: {
          songsGranted: result.songsGranted,
          songsRemaining: result.songsRemaining,
          expiresAt: result.trialExpiresAt,
          trialExpiresAt: result.trialExpiresAt,
          durationDays: result.durationDays,
        },
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
        const isInvalidPayload = result.error === "INVALID_PAYLOAD";
        if (!isInvalidPayload) {
          console.error("[Apple Webhook] Processing failed:", result);
        } else {
          console.warn("[Apple Webhook] Invalid payload received; acknowledging to prevent retry storms");
        }

        return reply.status(isInvalidPayload ? 200 : 400).send({
          received: true,
          processed: false,
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
   * Admin: Inspect a user's subscription + entitlements + recent receipt history.
   * GET /admin/billing/users/:targetUserId
   */
  app.get("/admin/billing/users/:targetUserId", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["admin", "superadmin"]);
    if (!admin) return;

    const { targetUserId } = request.params || {};
    if (!targetUserId) {
      sendError(reply, 400, "INVALID_PARAMS", "targetUserId is required.");
      return;
    }

    try {
      const entitlements = await subscriptionManager.getEntitlements(targetUserId);
      const activeSubscription = await subscriptionManager.getActiveSubscription(
        targetUserId
      );
      const latestSubscription = await db.prepare(
        `SELECT * FROM subscriptions
         WHERE user_id = ?
         ORDER BY updated_at DESC, created_at DESC
         LIMIT 1`
      ).get(targetUserId);
      const recentReceipts = await db.prepare(
        `SELECT transaction_id, original_transaction_id, product_id, platform,
                verification_status, purchase_date, expires_date, created_at
         FROM purchase_receipts
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 20`
      ).all(targetUserId);

      reply.send({
        userId: targetUserId,
        entitlements,
        activeSubscription,
        latestSubscription,
        recentReceipts,
      });
    } catch (err) {
      console.error("[Admin] Get user billing snapshot error:", err);
      sendError(reply, 500, "BILLING_LOOKUP_ERROR", err.message);
    }
  });

  /**
   * Admin: Pull subscription state from App Store and sync to a target user.
   * POST /admin/billing/sync/apple
   *
   * body:
   * - targetUserId: string
   * - transactionId OR transaction_id: string
   * - sync_all_subscriptions: boolean (optional, default false)
   */
  app.post("/admin/billing/sync/apple", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["admin", "superadmin"]);
    if (!admin) return;

    const {
      targetUserId,
      transactionId,
      transaction_id: legacyTransactionId,
      sync_all_subscriptions: syncAllSubscriptions = false,
    } = request.body || {};
    const effectiveTransactionId = transactionId || legacyTransactionId;

    if (!targetUserId || !effectiveTransactionId) {
      sendError(
        reply,
        400,
        "INVALID_PARAMS",
        "targetUserId and transactionId (or transaction_id) are required."
      );
      return;
    }

    if (!appleValidator.isConfigured()) {
      sendError(
        reply,
        503,
        "APPLE_NOT_CONFIGURED",
        "Apple App Store validation not configured."
      );
      return;
    }

    try {
      const syncResults = [];
      const syncErrors = [];

      if (syncAllSubscriptions) {
        const subscriptions = await appleValidator.getAllSubscriptions(
          effectiveTransactionId
        );
        if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
          sendError(
            reply,
            404,
            "SUBSCRIPTIONS_NOT_FOUND",
            "No subscriptions were found for the provided transaction."
          );
          return;
        }

        for (const validation of subscriptions) {
        if (!validation?.valid || (validation.type && validation.type !== "subscription")) {
          continue;
        }
          try {
            const result = await subscriptionManager.syncSubscription(
              targetUserId,
              validation
            );
            syncResults.push(result);
          } catch (err) {
            syncErrors.push({
              productId: validation.productId || null,
              error: err.message,
            });
          }
        }
      } else {
        const validation = await appleValidator.verifyTransaction(
          effectiveTransactionId
        );
        if (!validation.valid) {
          sendError(
            reply,
            400,
            "INVALID_RECEIPT",
            validation.error || "Receipt validation failed."
          );
          return;
        }
        if (validation.type && validation.type !== "subscription") {
          sendError(
            reply,
            400,
            "INVALID_RECEIPT_TYPE",
            "Transaction is not an auto-renewable subscription."
          );
          return;
        }

        const result = await subscriptionManager.syncSubscription(
          targetUserId,
          validation
        );
        syncResults.push(result);
      }

      if (syncResults.length === 0) {
        const firstError = syncErrors[0]?.error || "No subscriptions were synced.";
        if (firstError === "SUBSCRIPTION_BELONGS_TO_ANOTHER_USER") {
          sendError(
            reply,
            409,
            "SUBSCRIPTION_CONFLICT",
            "The provided App Store subscription belongs to another user."
          );
          return;
        }
        sendError(reply, 400, "SYNC_FAILED", firstError);
        return;
      }

      const entitlements = await subscriptionManager.getEntitlements(targetUserId);
      const activeSubscription = await subscriptionManager.getActiveSubscription(
        targetUserId
      );

      await addAuditEntry({
        userId: admin.adminId,
        action: "admin_subscription_sync",
        resourceType: "subscription",
        resourceId: activeSubscription?.id || syncResults[0].subscriptionId || null,
        metadata: {
          target_user_id: targetUserId,
          transaction_id: effectiveTransactionId,
          sync_all_subscriptions: Boolean(syncAllSubscriptions),
          synced_count: syncResults.length,
          failed_count: syncErrors.length,
          failed: syncErrors,
          admin_email: admin.email,
          actor: "admin",
        },
      });

      reply.send({
        success: true,
        targetUserId,
        syncedCount: syncResults.length,
        failedCount: syncErrors.length,
        results: syncResults,
        errors: syncErrors,
        entitlements,
        activeSubscription,
      });
    } catch (err) {
      if (err.message === "SUBSCRIPTION_BELONGS_TO_ANOTHER_USER") {
        sendError(
          reply,
          409,
          "SUBSCRIPTION_CONFLICT",
          "The provided App Store subscription belongs to another user."
        );
        return;
      }
      console.error("[Admin] Apple subscription sync error:", err);
      sendError(reply, 500, "SYNC_ERROR", err.message);
    }
  });

  /**
   * Admin: Grant songs to user
   * POST /admin/billing/grant-songs
   */
  app.post("/admin/billing/grant-songs", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;

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

      await addAuditEntry({
        userId: admin.adminId,
        action: "admin_grant_songs",
        resourceType: "entitlements",
        resourceId: targetUserId,
        metadata: { amount, reason, grantedBy: admin.adminId, admin_email: admin.email, actor: "admin" },
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
   * Admin: Reset user preview count
   * POST /admin/billing/reset-previews
   */
  app.post("/admin/billing/reset-previews", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;

    const { targetUserId } = request.body || {};

    if (!targetUserId) {
      sendError(reply, 400, "INVALID_PARAMS", "targetUserId is required.");
      return;
    }

    try {
      const result = await db.prepare(
        "UPDATE entitlements SET preview_count_today = 0, updated_at = ? WHERE user_id = ?"
      ).run(nowIso(), targetUserId);

      if (result.changes === 0) {
        sendError(reply, 404, "USER_NOT_FOUND", "No entitlements found for user.");
        return;
      }

      await addAuditEntry({
        userId: admin.adminId,
        action: "admin_reset_previews",
        resourceType: "entitlements",
        resourceId: targetUserId,
        metadata: { resetBy: admin.adminId, admin_email: admin.email, actor: "admin" },
      });

      console.log(`[Admin] Reset preview count for user ${targetUserId} by ${admin.email}`);
      reply.send({ success: true, userId: targetUserId, preview_count_today: 0 });
    } catch (err) {
      console.error("[Admin] Reset previews error:", err);
      sendError(reply, 500, "RESET_ERROR", err.message);
    }
  });

  /**
   * Dev: Reset preview count with secret (for testing)
   * POST /dev/reset-previews
   */
  app.post("/dev/reset-previews", async (request, reply) => {
    const secret = request.headers["x-dev-secret"];
    const expectedSecret = process.env.DEV_SECRET;

    if (!expectedSecret || secret !== expectedSecret) {
      sendError(reply, 403, "FORBIDDEN", "Invalid or missing dev secret");
      return;
    }

    const { userId } = request.body || {};
    if (!userId) {
      sendError(reply, 400, "INVALID_PARAMS", "userId is required");
      return;
    }

    try {
      // Reset preview count and optionally set tier to pro for unlimited
      const result = await db.prepare(
        "UPDATE entitlements SET preview_count_today = 0, tier = 'pro', updated_at = ? WHERE user_id = ?"
      ).run(nowIso(), userId);

      if (result.changes === 0) {
        sendError(reply, 404, "NOT_FOUND", "User entitlements not found");
        return;
      }

      console.log(`[Dev] Reset previews and set tier=pro for user ${userId}`);
      reply.send({ success: true, userId, preview_count_today: 0, tier: "pro" });
    } catch (err) {
      console.error("[Dev] Reset error:", err);
      sendError(reply, 500, "ERROR", err.message);
    }
  });

  /**
   * Admin: Get subscription plans
   * GET /admin/plans
   */
  app.get("/admin/plans", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["admin", "superadmin"]);
    if (!admin) return;

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
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;

    const { songs_allowed, duration_days, is_active } = request.body || {};

    try {
      const result = await planConfigService.updateTrialConfig({
        songs_allowed,
        duration_days,
        is_active,
      });

      await addAuditEntry({
        userId: admin.adminId,
        action: "admin_update_trial_config",
        resourceType: "trial_config",
        resourceId: "1",
        metadata: { songs_allowed, duration_days, is_active, admin_email: admin.email, actor: "admin" },
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
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;

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

      await addAuditEntry({
        userId: admin.adminId,
        action: "admin_update_plan",
        resourceType: "subscription_plan",
        resourceId: planId,
        metadata: { ...filteredUpdates, admin_email: admin.email, actor: "admin" },
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
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;

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

      await addAuditEntry({
        userId: admin.adminId,
        action: "admin_add_product_mapping",
        resourceType: "plan_product",
        resourceId: result.id,
        metadata: { plan_id: planId, platform, product_id, billing_period, admin_email: admin.email, actor: "admin" },
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
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;

    const { platform, productId } = request.params;

    try {
      await planConfigService.removeProductMapping(platform, productId);

      await addAuditEntry({
        userId: admin.adminId,
        action: "admin_remove_product_mapping",
        resourceType: "plan_product",
        resourceId: productId,
        metadata: { platform, product_id: productId, admin_email: admin.email, actor: "admin" },
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
    const admin = await requireAdminRole(request, reply, ["admin", "superadmin"]);
    if (!admin) return;

    const { planId } = request.params;

    try {
      const products = await planConfigService.getProductsForPlan(planId);
      reply.send({ products });
    } catch (err) {
      console.error("[Admin] Get plan products error:", err);
      sendError(reply, 500, "GET_ERROR", err.message);
    }
  });

  /**
   * Admin: Billing preflight checks for TestFlight rollout readiness
   * GET /admin/billing/preflight
   * Optional query:
   * - expected_bundle_id: exact bundle ID expected in runtime config
   */
  app.get("/admin/billing/preflight", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["admin", "superadmin"]);
    if (!admin) return;

    const expectedBundleId =
      typeof request.query?.expected_bundle_id === "string"
        ? request.query.expected_bundle_id.trim()
        : "";

    try {
      const plans = await planConfigService.getPlans({ includeInactive: true });
      const productMappings = await planConfigService.getProductMappings();

      const issues = [];
      const warnings = [];
      const appleMappings = [];
      const seenProductIds = new Map();
      const requiredByPlan = [];

      for (const mapping of productMappings.values()) {
        if (mapping.platform !== "apple") continue;
        appleMappings.push(mapping);

        const previousPlanId = seenProductIds.get(mapping.product_id);
        if (previousPlanId && previousPlanId !== mapping.plan_id) {
          issues.push({
            code: "DUPLICATE_APPLE_PRODUCT_ID",
            message: `Apple product ID '${mapping.product_id}' is mapped to multiple plans.`,
            details: {
              product_id: mapping.product_id,
              first_plan_id: previousPlanId,
              duplicate_plan_id: mapping.plan_id,
            },
          });
        } else {
          seenProductIds.set(mapping.product_id, mapping.plan_id);
        }
      }

      const activePaidPlans = plans.filter((plan) => plan.is_active && plan.tier !== "free");
      for (const plan of activePaidPlans) {
        const planMappings = appleMappings.filter((mapping) => mapping.plan_id === plan.id);
        const monthly = planMappings.find((mapping) => mapping.billing_period === "monthly");
        const annual = planMappings.find((mapping) => mapping.billing_period === "annual");
        const needsMonthly = plan.price_monthly_cents !== null;
        const needsAnnual = plan.price_annual_cents !== null;

        requiredByPlan.push({
          plan_id: plan.id,
          tier: plan.tier,
          requires: {
            monthly: needsMonthly,
            annual: needsAnnual,
          },
          found: {
            monthly: monthly?.product_id || null,
            annual: annual?.product_id || null,
          },
        });

        if (needsMonthly && !monthly) {
          issues.push({
            code: "MISSING_APPLE_MONTHLY_MAPPING",
            message: `Plan '${plan.id}' is active with monthly price but has no Apple monthly product mapping.`,
            details: { plan_id: plan.id, tier: plan.tier },
          });
        }
        if (needsAnnual && !annual) {
          issues.push({
            code: "MISSING_APPLE_ANNUAL_MAPPING",
            message: `Plan '${plan.id}' is active with annual price but has no Apple annual product mapping.`,
            details: { plan_id: plan.id, tier: plan.tier },
          });
        }
      }

      const configuredBundleId =
        appConfig.APPLE_BUNDLE_ID || process.env.APPLE_BUNDLE_ID || null;
      const appleValidatorConfigured = appleValidator.isConfigured();

      if (!configuredBundleId) {
        issues.push({
          code: "MISSING_APPLE_BUNDLE_ID",
          message: "APPLE_BUNDLE_ID is not configured at runtime.",
          details: null,
        });
      }

      if (!appleValidatorConfigured) {
        issues.push({
          code: "APPLE_VALIDATOR_NOT_CONFIGURED",
          message: "Apple receipt validator is not fully configured (missing key/issuer/private-key/bundle-id).",
          details: null,
        });
      }

      if (expectedBundleId && configuredBundleId && configuredBundleId !== expectedBundleId) {
        issues.push({
          code: "APPLE_BUNDLE_ID_MISMATCH",
          message: "Runtime APPLE_BUNDLE_ID does not match expected bundle ID.",
          details: {
            expected_bundle_id: expectedBundleId,
            configured_bundle_id: configuredBundleId,
          },
        });
      }

      if (!expectedBundleId) {
        warnings.push({
          code: "EXPECTED_BUNDLE_ID_NOT_PROVIDED",
          message: "No expected_bundle_id query parameter supplied; bundle match check was skipped.",
        });
      }

      reply.send({
        ok: issues.length === 0,
        checked_at: new Date().toISOString(),
        checks: {
          apple_bundle_id: {
            configured: configuredBundleId,
            expected: expectedBundleId || null,
            matches_expected: expectedBundleId
              ? configuredBundleId === expectedBundleId
              : null,
            validator_configured: appleValidatorConfigured,
          },
          apple_products: {
            active_paid_plan_count: activePaidPlans.length,
            apple_mapping_count: appleMappings.length,
            unique_apple_product_id_count: seenProductIds.size,
            required_by_plan: requiredByPlan,
          },
        },
        issues,
        warnings,
      });
    } catch (err) {
      console.error("[Admin] Billing preflight error:", err);
      sendError(reply, 500, "BILLING_PREFLIGHT_ERROR", err.message);
    }
  });

  // ============ ADMIN DASHBOARD API ============

  const adminService = new AdminService(db);
  adminAuthService.initialize(db);

  /**
   * Admin session auth helper - validates Bearer token from Authorization header
   * Returns admin info if valid, null if invalid (and sends error response)
   */
  async function requireAdminSession(request, reply) {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      sendError(reply, 401, "UNAUTHORIZED", "Missing authorization token");
      return null;
    }

    const token = authHeader.slice(7);
    const admin = await adminAuthService.validateSession(token);

    if (!admin) {
      sendError(reply, 401, "UNAUTHORIZED", "Invalid or expired session");
      return null;
    }

    return admin;
  }

  /**
   * Require specific admin role(s) for an endpoint.
   * @param {object} request - Fastify request
   * @param {object} reply - Fastify reply
   * @param {string[]} allowedRoles - Array of allowed roles (e.g., ['superadmin'])
   * @returns {object|null} Admin object if authorized, null if denied
   */
  async function requireAdminRole(request, reply, allowedRoles) {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return null;

    if (!allowedRoles.includes(admin.role)) {
      sendError(reply, 403, "FORBIDDEN", `This action requires one of: ${allowedRoles.join(', ')}`);
      return null;
    }

    return admin;
  }

  /**
   * Parse pagination params from query with defaults
   */
  function parsePagination(query, defaultLimit = 50) {
    return {
      limit: parseInt(query.limit) || defaultLimit,
      offset: parseInt(query.offset) || 0,
    };
  }

  // --- Admin Authentication ---

  // One-time setup endpoint - protected by ADMIN_SETUP_SECRET env var
  // Remove this after initial admin is created
  app.post("/admin/auth/setup", async (request, reply) => {
    const setupSecret = process.env.ADMIN_SETUP_SECRET;
    if (!setupSecret) {
      return sendError(reply, 404, "NOT_FOUND", "Setup disabled");
    }

    const { secret, email, password, displayName } = request.body || {};
    if (secret !== setupSecret) {
      return sendError(reply, 401, "UNAUTHORIZED", "Invalid setup secret");
    }

    if (!email || !password) {
      return sendError(reply, 400, "BAD_REQUEST", "Email and password required");
    }

    const result = await adminAuthService.createAdmin(email, password, displayName || "Admin", "superadmin");
    if (!result.success) {
      return sendError(reply, 400, "BAD_REQUEST", result.error);
    }

    reply.send({ success: true, id: result.id, message: "Admin created. Remove ADMIN_SETUP_SECRET to disable this endpoint." });
  });

  app.post("/admin/auth/login", async (request, reply) => {
    const { email, password } = request.body || {};
    if (!email || !password) {
      return sendError(reply, 400, "BAD_REQUEST", "Email and password required");
    }

    const ip = request.ip;
    const userAgent = request.headers["user-agent"];
    const result = await adminAuthService.login(email, password, ip, userAgent);

    if (!result.success) {
      return sendError(reply, 401, "UNAUTHORIZED", result.error);
    }

    reply.send(result);
  });

  app.post("/admin/auth/logout", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      adminAuthService.logout(authHeader.slice(7));
    }
    reply.send({ success: true });
  });

  app.get("/admin/auth/me", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    reply.send(admin);
  });

  app.post("/admin/auth/change-password", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    const { currentPassword, newPassword } = request.body || {};
    if (!currentPassword || !newPassword) {
      return reply.code(400).send({ error: "MISSING_FIELDS", message: "Current and new password required" });
    }
    if (newPassword.length < 8) {
      return reply.code(400).send({ error: "WEAK_PASSWORD", message: "Password must be at least 8 characters" });
    }

    // Verify current password first
    const loginResult = await adminAuthService.login(admin.email, currentPassword);
    if (!loginResult.success) {
      return reply.code(401).send({ error: "INVALID_PASSWORD", message: "Current password is incorrect" });
    }

    // Change password (this also invalidates all sessions)
    await adminAuthService.changePassword(admin.adminId, newPassword);
    reply.send({ success: true, message: "Password changed. Please log in again." });
  });

  // --- User Management ---

  app.get("/admin/dashboard/users", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { email, userId, riskLevel, tier, trackId, shareId, recipientName } = request.query;
    const users = await adminService.searchUsers({
      email, userId, riskLevel, tier, trackId, shareId, recipientName,
      ...parsePagination(request.query),
    });
    reply.send({ users });
  });

  app.get("/admin/dashboard/users/stats", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const stats = await adminService.getUserStats();
    reply.send(stats);
  });

  app.get("/admin/dashboard/users/:id", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const detail = await adminService.getUserDetail(request.params.id);
    if (!detail) {
      sendError(reply, 404, "NOT_FOUND", "User not found");
      return;
    }
    reply.send(detail);
  });

  app.put("/admin/dashboard/users/:id/risk", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { riskLevel, reason } = request.body || {};
    if (!riskLevel || !["low", "medium", "high"].includes(riskLevel)) {
      sendError(reply, 400, "INVALID_PARAMS", "riskLevel must be low, medium, or high");
      return;
    }
    const result = await adminService.updateUserRisk(request.params.id, riskLevel, admin.adminId, reason || "");
    reply.send(result);
  });

  app.post("/admin/dashboard/users/:id/lock", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ['superadmin']);
    if (!admin) return;
    const { locked, reason } = request.body || {};
    const result = await adminService.lockUser(request.params.id, Boolean(locked), admin.adminId, reason || "");
    reply.send(result);
  });

  app.delete("/admin/dashboard/users/:id", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ['superadmin']);
    if (!admin) return;
    const { reason } = request.body || {};
    const result = await adminService.deleteUser(request.params.id, admin.adminId, reason || 'Admin deletion');
    if (!result.success) {
      sendError(reply, 404, "USER_NOT_FOUND", result.error);
      return;
    }
    reply.send(result);
  });

  app.post("/admin/dashboard/users/bulk-action", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ['superadmin']);
    if (!admin) return;
    const { action, userIds, reason } = request.body || {};
    if (!action || !Array.isArray(userIds) || userIds.length === 0) {
      sendError(reply, 400, "INVALID_PARAMS", "action and userIds[] are required");
      return;
    }
    const result = await adminService.bulkUserAction(userIds, action, admin.adminId, reason || '');
    reply.send(result);
  });

  app.put("/admin/dashboard/users/:id/profile", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ['superadmin']);
    if (!admin) return;
    const fields = request.body || {};
    const result = await adminService.updateUserProfile(request.params.id, fields, admin.adminId);
    if (!result.success) {
      sendError(reply, 400, "INVALID_PARAMS", result.error);
      return;
    }
    reply.send(result);
  });

  app.put("/admin/dashboard/users/:id/entitlements", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ['superadmin']);
    if (!admin) return;
    const fields = request.body || {};
    const result = await adminService.updateUserEntitlements(request.params.id, fields, admin.adminId);
    if (!result.success) {
      sendError(reply, 400, "INVALID_PARAMS", result.error);
      return;
    }
    reply.send(result);
  });

  // --- User Session Management ---

  app.get("/admin/dashboard/users/:userId/sessions", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { userId } = request.params;
    const sessions = await adminService.getUserSessions(userId);
    reply.send({ sessions });
  });

  app.post("/admin/dashboard/users/:userId/sessions/:sessionId/revoke", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ['superadmin']);
    if (!admin) return;
    const { userId, sessionId } = request.params;
    const { reason } = request.body || {};
    const result = await adminService.revokeUserSession(userId, sessionId, admin.adminId, reason || 'Admin revocation');
    if (!result.success) {
      sendError(reply, 404, "SESSION_NOT_FOUND", result.error);
      return;
    }
    reply.send(result);
  });

  app.post("/admin/dashboard/users/:userId/sessions/revoke-all", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ['superadmin']);
    if (!admin) return;
    const { userId } = request.params;
    const { reason } = request.body || {};
    const result = await adminService.revokeAllUserSessions(userId, admin.adminId, reason || 'Admin revocation');
    reply.send(result);
  });

  // --- Voice Profile Management ---

  app.post("/admin/dashboard/users/:userId/voice/force-reverify", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ['superadmin']);
    if (!admin) return;
    const { userId } = request.params;
    const { reason } = request.body || {};
    const result = await adminService.forceVoiceReverify(userId, admin.adminId, reason || 'Admin-initiated re-verification');
    if (!result.success) {
      sendError(reply, 404, "VOICE_PROFILE_NOT_FOUND", result.error);
      return;
    }
    reply.send(result);
  });

  // --- Metrics ---

  app.get("/admin/dashboard/metrics/overview", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    reply.send(await adminService.getOverviewMetrics());
  });

  app.get("/admin/dashboard/metrics/jobs", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    reply.send(await adminService.getJobMetrics());
  });

  app.get("/admin/dashboard/metrics/costs", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { days } = request.query;
    reply.send(await adminService.getCostMetrics(days ? parseInt(days) : 30));
  });

  app.get("/admin/dashboard/metrics/enrollment", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    reply.send(await adminService.getEnrollmentMetrics());
  });

  app.get("/admin/dashboard/metrics/render-pipeline", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    reply.send(await adminService.getRenderSuccessMetrics());
  });

  app.get("/admin/dashboard/security/risk-metrics", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    reply.send(await adminService.getRiskMetrics());
  });

  // --- Jobs ---

  app.get("/admin/dashboard/jobs", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { status, workflowType } = request.query;
    reply.send({
      jobs: await adminService.listJobs({ status, workflowType, ...parsePagination(request.query) }),
    });
  });

  app.post("/admin/dashboard/jobs/:id/retry", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const result = await adminService.retryJob(request.params.id, admin.adminId);
    if (!result.success) {
      sendError(reply, 400, "RETRY_ERROR", result.error);
      return;
    }
    reply.send(result);
  });

  // --- Dead Letter Queue ---

  app.get("/admin/dashboard/dlq", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    reply.send({ entries: await adminService.listDLQ(parsePagination(request.query)) });
  });

  app.post("/admin/dashboard/dlq/:id/reprocess", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    const { reason } = request.body || {};
    const result = await adminService.reprocessDLQ(request.params.id, admin.adminId, reason || "Admin reprocess");
    if (!result.success) {
      sendError(reply, 400, "DLQ_REPROCESS_ERROR", result.error);
      return;
    }
    reply.send(result);
  });

  // --- Moderation ---

  app.get("/admin/dashboard/moderation/queue", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    reply.send({ items: await adminService.getModerationQueue(parsePagination(request.query)) });
  });

  app.post("/admin/dashboard/moderation/:versionId/override", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { reason } = request.body || {};
    if (!reason) {
      sendError(reply, 400, "INVALID_PARAMS", "reason is required");
      return;
    }
    const result = await adminService.overrideModeration(request.params.versionId, admin.adminId, reason);
    reply.send(result);
  });

  // --- Story Sessions ---

  app.get("/admin/dashboard/story/sessions", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { status, engineVersion } = request.query;
    const sessions = await adminService.listStorySessions({
      status,
      engineVersion,
      ...parsePagination(request.query),
    });
    reply.send({ sessions });
  });

  app.get("/admin/dashboard/story/sessions/:id", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const detail = await adminService.getStorySessionDetail(request.params.id);
    if (!detail) {
      sendError(reply, 404, "NOT_FOUND", "Story session not found");
      return;
    }
    reply.send(detail);
  });

  // --- Share Management ---

  app.get("/admin/dashboard/shares", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { status, trackId, userId } = request.query;
    const shares = await adminService.listShares({
      status,
      trackId,
      userId,
      ...parsePagination(request.query),
    });
    reply.send({ shares });
  });

  app.post("/admin/dashboard/share/:id/rebind", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { newDeviceId, reason } = request.body || {};
    if (!newDeviceId) {
      sendError(reply, 400, "INVALID_PARAMS", "newDeviceId is required");
      return;
    }
    const result = await adminService.rebindShare(request.params.id, newDeviceId, admin.adminId, reason || "");
    if (!result.success) {
      sendError(reply, 400, "REBIND_ERROR", result.error);
      return;
    }
    reply.send(result);
  });

  // --- Security Section ---

  app.get("/admin/dashboard/security/health", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const health = await adminService.getSystemHealth();
    reply.send(health);
  });

  app.get("/admin/dashboard/security/auth-events", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { eventType, userId, startDate, endDate } = request.query;
    const events = await adminService.searchAuthEvents({
      eventType, userId, startDate, endDate,
      ...parsePagination(request.query),
    });
    reply.send({ events });
  });

  app.get("/admin/dashboard/security/auth-events/stats", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const stats = await adminService.getAuthEventStats();
    reply.send(stats);
  });

  app.get("/admin/dashboard/security/apple-refresh", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { days } = request.query;
    const stats = await adminService.getAppleRefreshTokenStats(Number(days) || 7);
    reply.send(stats);
  });

  app.get("/admin/dashboard/security/audit-logs", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { action, resourceType, startDate, endDate } = request.query;
    const logs = await adminService.searchAuditLogs({
      action, resourceType, startDate, endDate,
      ...parsePagination(request.query),
    });
    reply.send({ logs });
  });

  app.get("/admin/dashboard/security/rate-limits", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { userId, actionType, nearLimit } = request.query;
    const limits = await adminService.getRateLimits({
      userId, actionType,
      nearLimit: nearLimit === 'true',
      ...parsePagination(request.query),
    });
    reply.send({ limits });
  });

  app.post("/admin/dashboard/security/rate-limits/:userId/:actionType/reset", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ['superadmin']);
    if (!admin) return;
    const { userId, actionType } = request.params;
    const { reason } = request.body || {};
    const result = await adminService.resetUserRateLimit(userId, actionType, admin.adminId, reason || 'Admin reset');
    reply.send(result);
  });

  app.get("/admin/dashboard/security/consent-logs", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { consentVersion, startDate, endDate } = request.query;
    const consents = await adminService.getConsentLogs({
      consentVersion, startDate, endDate,
      ...parsePagination(request.query),
    });
    reply.send({ consents });
  });

  app.get("/admin/dashboard/security/config", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const config = await adminService.getSecurityConfig();
    reply.send(config);
  });

  app.put("/admin/dashboard/security/config", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ['superadmin']);
    if (!admin) return;
    const config = request.body;

    // Validate required fields and bounds
    const sessionHours = parseInt(config.sessionDurationHours);
    const maxAttempts = parseInt(config.maxFailedLoginAttempts);
    const lockoutMins = parseInt(config.lockoutDurationMinutes);

    if (!Number.isInteger(sessionHours) || sessionHours < 1 || sessionHours > 720) {
      sendError(reply, 400, "INVALID_CONFIG", "sessionDurationHours must be between 1 and 720");
      return;
    }
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
      sendError(reply, 400, "INVALID_CONFIG", "maxFailedLoginAttempts must be between 1 and 20");
      return;
    }
    if (!Number.isInteger(lockoutMins) || lockoutMins < 1 || lockoutMins > 1440) {
      sendError(reply, 400, "INVALID_CONFIG", "lockoutDurationMinutes must be between 1 and 1440");
      return;
    }
    if (config.rateLimitDefaults && typeof config.rateLimitDefaults !== 'object') {
      sendError(reply, 400, "INVALID_CONFIG", "rateLimitDefaults must be an object");
      return;
    }

    // Sanitize to only allowed fields
    const sanitizedConfig = {
      sessionDurationHours: sessionHours,
      maxFailedLoginAttempts: maxAttempts,
      lockoutDurationMinutes: lockoutMins,
      rateLimitDefaults: config.rateLimitDefaults || {}
    };

    const result = await adminService.updateSecurityConfig(sanitizedConfig, admin.adminId);
    reply.send(result);
  });

  // --- Provider Control Plane ---

  app.get("/admin/dashboard/providers", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const providers = await adminService.getProviderStatus();
    reply.send({ providers });
  });

  app.post("/admin/dashboard/providers/:providerName/status", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ['superadmin']);
    if (!admin) return;
    const { providerName } = request.params;
    const { status, reason } = request.body || {};

    if (!['active', 'paused', 'disabled'].includes(status)) {
      sendError(reply, 400, "INVALID_STATUS", "Status must be active, paused, or disabled");
      return;
    }

    const result = await adminService.setProviderStatus(providerName, status, admin.adminId, reason);
    reply.send(result);
  });

  // --- Queue Control Plane ---

  app.get("/admin/dashboard/queues", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const queues = await adminService.getQueueStatus();
    reply.send({ queues });
  });

  app.post("/admin/dashboard/queues/:queueName/status", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ['superadmin']);
    if (!admin) return;
    const { queueName } = request.params;
    const { status, reason } = request.body || {};

    if (!['active', 'paused', 'draining'].includes(status)) {
      sendError(reply, 400, "INVALID_STATUS", "Status must be active, paused, or draining");
      return;
    }

    const result = await adminService.setQueueStatus(queueName, status, admin.adminId, reason);
    reply.send(result);
  });

  // --- Billing & Revenue ---

  app.get("/admin/dashboard/billing/revenue", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const days = parseInt(request.query.days) || 30;
    const metrics = await adminService.getRevenueMetrics(days);
    reply.send(metrics);
  });

  app.get("/admin/dashboard/billing/subscriptions", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const health = await adminService.getSubscriptionHealth();
    reply.send(health);
  });

  app.get("/admin/dashboard/billing/transactions", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { limit, offset } = request.query;
    const transactions = await adminService.getBillingTransactions({ limit, offset });
    reply.send({ transactions });
  });

  app.get("/admin/dashboard/webhooks/health", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const health = await adminService.getWebhookHealth();
    reply.send(health);
  });

  // --- Growth & Attribution ---

  app.get("/admin/dashboard/growth/attribution", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const days = parseInt(request.query.days) || 30;
    const attribution = await adminService.getAttribution(days);
    reply.send(attribution);
  });

  app.get("/admin/dashboard/growth/teasers", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const days = parseInt(request.query.days) || 7;
    const metrics = await adminService.getTeaserMetrics(days);
    reply.send(metrics);
  });

  app.get("/admin/dashboard/growth/shares", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const days = parseInt(request.query.days) || 30;
    const metrics = await adminService.getShareMetrics(days);
    reply.send(metrics);
  });

  // --- KPI Dashboard ---

  app.get("/admin/dashboard/kpis", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const days = parseInt(request.query.days) || 30;
    const { getKPIAggregates } = require("./jobs/compute-daily-aggregates");
    const aggregates = await getKPIAggregates(db, days);
    reply.send({ aggregates });
  });

  app.get("/admin/dashboard/kpis/trends", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { getKPITrends, ensureRecentAggregates } = require("./jobs/compute-daily-aggregates");
    // Ensure we have recent data first
    await ensureRecentAggregates(db, 14);
    const trends = await getKPITrends(db);
    reply.send(trends);
  });

  // --- STT Provider Config ---

  app.get("/admin/dashboard/stt/config", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const config = await adminService.getSTTConfig();
    reply.send(config);
  });

  app.put("/admin/dashboard/stt/config", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ['superadmin']);
    if (!admin) return;
    const { primary_provider, fallback_provider, whisperkit_model } = request.body || {};

    try {
      const result = await adminService.setSTTConfig(
        { primary_provider, fallback_provider, whisperkit_model },
        admin.adminId
      );
      reply.send(result);
    } catch (err) {
      sendError(reply, 400, "INVALID_CONFIG", err.message);
    }
  });

  // --- Music Provider Routing Config ---

  app.get("/admin/dashboard/music/config", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    try {
      const config = await adminService.getMusicProviderConfig();
      reply.send({
        ...config,
        available_providers: {
          elevenlabs: Boolean(appConfig.ELEVENLABS_API_KEY),
          suno: Boolean(appConfig.SUNO_API_KEY),
        },
        available_generation_modes: ["composition_plan", "compose_detailed"],
      });
    } catch (err) {
      sendError(reply, 500, "MUSIC_CONFIG_ERROR", "Failed to load music provider config.");
    }
  });

  app.put("/admin/dashboard/music/config", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ['superadmin']);
    if (!admin) return;

    const {
      default_provider,
      auto_style_routing,
      elevenlabs_generation_mode,
      auto_reroll_enabled,
      quality_threshold,
      max_rerolls,
      style_overrides,
    } = request.body || {};

    if (!request.body || typeof request.body !== "object" || Object.keys(request.body).length === 0) {
      return sendError(reply, 400, "INVALID_CONFIG", "Request body must contain at least one config key.");
    }

    if (default_provider !== undefined) {
      if (!["elevenlabs", "suno"].includes(default_provider)) {
        return sendError(reply, 400, "INVALID_CONFIG", "default_provider must be one of: elevenlabs, suno");
      }
      const providerHasKey =
        default_provider === "elevenlabs"
          ? Boolean(appConfig.ELEVENLABS_API_KEY)
          : Boolean(appConfig.SUNO_API_KEY);
      if (!providerHasKey) {
        return sendError(
          reply,
          400,
          "INVALID_CONFIG",
          `Cannot set default_provider=${default_provider}: missing API key in environment.`
        );
      }
    }

    try {
      const result = await adminService.setMusicProviderConfig(
        {
          ...(default_provider !== undefined ? { default_provider } : {}),
          ...(auto_style_routing !== undefined ? { auto_style_routing } : {}),
          ...(elevenlabs_generation_mode !== undefined ? { elevenlabs_generation_mode } : {}),
          ...(auto_reroll_enabled !== undefined ? { auto_reroll_enabled } : {}),
          ...(quality_threshold !== undefined ? { quality_threshold } : {}),
          ...(max_rerolls !== undefined ? { max_rerolls } : {}),
          ...(style_overrides !== undefined ? { style_overrides } : {}),
        },
        admin.adminId
      );
      reply.send(result);
    } catch (err) {
      sendError(reply, 400, "INVALID_CONFIG", err.message);
    }
  });

  app.get("/admin/dashboard/music/diagnostics", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    const limit = parseInt(request.query.limit, 10) || 30;
    const provider = typeof request.query.provider === "string" ? request.query.provider : null;
    const status = typeof request.query.status === "string" ? request.query.status : null;

    try {
      const diagnostics = await adminService.getRecentMusicDiagnostics({
        limit,
        provider,
        status,
      });
      reply.send(diagnostics);
    } catch (err) {
      sendError(reply, 500, "MUSIC_DIAGNOSTICS_ERROR", "Failed to load music diagnostics.");
    }
  });

  // --- Feature Flags Config ---

  app.get("/admin/dashboard/feature-flags", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    try {
      const flags = await adminService.getAllFeatureFlags();
      reply.send(flags);
    } catch (err) {
      console.error('[Admin] FF_GET_ERROR: Failed to get feature flags:', err.message);
      sendError(reply, 500, "FEATURE_FLAGS_ERROR", "Failed to load feature flags. Please try again.");
    }
  });

  app.put("/admin/dashboard/feature-flags", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ['superadmin']);
    if (!admin) return;
    const updates = request.body || {};

    if (typeof updates !== 'object' || Object.keys(updates).length === 0) {
      return sendError(reply, 400, "INVALID_REQUEST", "Request body must be an object with flag updates");
    }

    try {
      const result = await adminService.updateFeatureFlags(updates, admin.adminId);
      reply.send(result);
    } catch (err) {
      console.error('[Admin] FF_UPDATE_ERROR: Failed to update feature flags:', err.message);
      sendError(reply, 500, "FEATURE_FLAGS_ERROR", "Failed to save feature flags. Please try again.");
    }
  });

  // --- Public App Config (for mobile clients) ---

  app.get("/app/config", async (request, reply) => {
    // Public endpoint - no auth required
    // Returns safe-for-client configuration
    const config = await adminService.getAppConfig();
    reply.send(config);
  });

  // --- Blend Analysis (Voice Conversion Diagnostics) ---
  /**
   * Analyze a track's blend quality to diagnose voice conversion issues
   * POST /admin/dashboard/analyze-blend
   * 
   * Body:
   * - trackVersionId: string (required) - The track version to analyze
   * - includeReport: boolean (optional) - Include formatted text report
   */
  app.post("/admin/dashboard/analyze-blend", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    const { trackVersionId, includeReport } = request.body || {};
    if (!trackVersionId) {
      return sendError(reply, 400, "INVALID_REQUEST", "trackVersionId is required");
    }

    try {
      // Get track version details to find file paths
      const trackVersion = db.prepare(`
        SELECT tv.*, t.user_id, t.id as track_id
        FROM track_versions tv
        JOIN tracks t ON tv.track_id = t.id
        WHERE tv.id = ?
      `).get(trackVersionId);

      if (!trackVersion) {
        return sendError(reply, 404, "NOT_FOUND", "Track version not found");
      }

      const userId = trackVersion.user_id;
      const trackId = trackVersion.track_id;
      const version = trackVersion.version_num;

      // Build file paths based on storage layout
      const basePath = path.join(
        process.cwd(),
        "storage/tracks",
        userId,
        trackId,
        `v${version}`
      );

      const filePaths = {
        userEnrollmentPath: null, // Will try to find from voice profile
        originalVocalPath: path.join(basePath, "stems/vocals.wav"),
        convertedVocalPath: path.join(basePath, "user_vocal.wav"),
        blendedOutputPath: path.join(basePath, "blended_vocal.wav"),
      };

      // Try to find user's enrollment audio
      const voiceProfile = db.prepare(`
        SELECT * FROM voice_profiles 
        WHERE user_id = ? AND status = 'active'
        ORDER BY created_at DESC LIMIT 1
      `).get(userId);

      if (voiceProfile) {
        // Try to find enrollment audio in S3 or local storage
        const enrollmentBasePath = path.join(
          process.cwd(),
          "storage/enrollment/raw",
          userId
        );
        if (fs.existsSync(enrollmentBasePath)) {
          const sessions = fs.readdirSync(enrollmentBasePath);
          if (sessions.length > 0) {
            const sessionPath = path.join(enrollmentBasePath, sessions[0]);
            const chunks = fs.readdirSync(sessionPath).filter(f => f.endsWith('.wav'));
            if (chunks.length > 0) {
              // Prefer sung chunks for voice comparison
              const sungChunk = chunks.find(c => c.includes('sung')) || chunks[0];
              filePaths.userEnrollmentPath = path.join(sessionPath, sungChunk);
            }
          }
        }
      }

      // Check which files exist
      const existingFiles = {};
      for (const [key, filePath] of Object.entries(filePaths)) {
        if (filePath && fs.existsSync(filePath)) {
          existingFiles[key] = filePath;
        }
      }

      if (Object.keys(existingFiles).length === 0) {
        return sendError(reply, 404, "NO_FILES_FOUND", "No audio files found for analysis. Files may have been cleaned up or render incomplete.");
      }

      // Run analysis
      const analysis = await analyzeBlend(existingFiles);

      // Add track context
      analysis.trackContext = {
        trackVersionId,
        trackId,
        userId,
        version,
        filesAnalyzed: Object.keys(existingFiles),
        filesMissing: Object.keys(filePaths).filter(k => !existingFiles[k]),
      };

      // Optionally include formatted report
      if (includeReport) {
        analysis.report = formatAnalysisReport(analysis);
      }

      reply.send(analysis);
    } catch (err) {
      console.error("[Admin] BLEND_ANALYSIS_ERROR:", err);
      sendError(reply, 500, "ANALYSIS_ERROR", `Failed to analyze blend: ${err.message}`);
    }
  });

  /**
   * Quick blend analysis from file paths (for CLI/testing)
   * POST /admin/dashboard/analyze-blend/paths
   */
  app.post("/admin/dashboard/analyze-blend/paths", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    const { 
      userEnrollmentPath, 
      originalVocalPath, 
      convertedVocalPath, 
      blendedOutputPath,
      includeReport 
    } = request.body || {};

    // At least one file required
    const paths = { userEnrollmentPath, originalVocalPath, convertedVocalPath, blendedOutputPath };
    const existingPaths = {};
    for (const [key, filePath] of Object.entries(paths)) {
      if (filePath && fs.existsSync(filePath)) {
        existingPaths[key] = filePath;
      }
    }

    if (Object.keys(existingPaths).length === 0) {
      return sendError(reply, 400, "NO_FILES", "No valid file paths provided or files don't exist");
    }

    try {
      const analysis = await analyzeBlend(existingPaths);
      
      if (includeReport) {
        analysis.report = formatAnalysisReport(analysis);
      }

      reply.send(analysis);
    } catch (err) {
      console.error("[Admin] BLEND_ANALYSIS_ERROR:", err);
      sendError(reply, 500, "ANALYSIS_ERROR", `Failed to analyze blend: ${err.message}`);
    }
  });

  // Admin SPA catch-all - serves index.html for client-side routing
  // Must come AFTER all /admin/* API routes so they take precedence
  // Using fs.readFile instead of reply.sendFile because decorateReply: false on static registrations
  const adminIndexPath = path.join(process.cwd(), "public/admin/index.html");

  app.get("/admin", async (request, reply) => {
    const fs = require("fs").promises;
    const content = await fs.readFile(adminIndexPath, "utf8");
    return reply.type("text/html").send(content);
  });

  app.get("/admin/*", async (request, reply) => {
    // Handles client-side routes: /admin/login, /admin/users, /admin/jobs, etc.
    const fs = require("fs").promises;
    const content = await fs.readFile(adminIndexPath, "utf8");
    return reply.type("text/html").send(content);
  });

  return app;
}

async function start() {
  const db = await getDatabase({
    dbPath: config.DB_PATH,
    migrationsDir: path.join(process.cwd(), "migrations"),
  });
  ensureDir(config.STORAGE_DIR);
  // DEV_MODE disables all live providers (uses placeholders instead)
  const liveEnabled = config.LIVE_PROVIDERS && !config.DEV_MODE;
  // Env fallback default. Runtime default can be changed via admin app_config.
  const musicProvider = config.MUSIC_PROVIDER || "suno";
  const providerConfig = {
    elevenlabs: {
      // Runtime routing can select ElevenLabs when configured and live.
      live: liveEnabled && Boolean(config.ELEVENLABS_API_KEY),
      provider: "elevenlabs",
      apiKey: config.ELEVENLABS_API_KEY,
      baseUrl: config.ELEVENLABS_BASE_URL,
      endpoint: config.ELEVENLABS_MUSIC_ENDPOINT,
      compositionPlanEndpoint: config.ELEVENLABS_COMPOSITION_PLAN_ENDPOINT,
      voiceId: config.ELEVENLABS_VOICE_ID,
      ttsVoiceId: config.ELEVENLABS_TTS_VOICE_ID,
      timeoutMs: config.PROVIDER_TIMEOUT_MS,
    },
    suno: {
      // Runtime routing can select Suno when configured and live.
      live: liveEnabled && Boolean(config.SUNO_API_KEY),
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
      demucsModel: config.DEMUCS_SEPARATION_MODEL,
      demucsShifts: config.DEMUCS_SHIFTS,
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
    musicProviderSource: "runtime_config_with_env_fallback",
  };
  const storage = createStorageProvider({
    ...config,
    STREAM_BASE_URL: config.STREAM_BASE_URL,
  });
  console.log(`[Storage] Provider: ${storage.type}${storage.type === 's3' ? ' (R2/S3)' : ' (local filesystem)'}`);
  const saveTimer = setInterval(() => db.save(), 2000);
  // Start file cleanup job for expired enrollment sessions
  const fileCleanupJob = startCleanupJob({
    db,
    storageDir: config.STORAGE_DIR,
    storageProvider: storage,
    intervalMs: config.CLEANUP_INTERVAL_MS,
    retentionDays: 7,
  });
  const cleanupTimer = setInterval(async () => {
    const now = nowIso();
    await db.prepare(
      "UPDATE enrollment_sessions SET status = 'expired' WHERE status NOT IN ('completed','failed_quality','failed_verification') AND expires_at < ?"
    ).run(now);
    await db.prepare(
      "UPDATE share_tokens SET status = 'expired' WHERE status NOT IN ('revoked','expired') AND expires_at < ?"
    ).run(now);
    const expiredHolds = await db
      .prepare("SELECT * FROM billing_holds WHERE status = 'held' AND expires_at < ?")
      .all(now);
    for (const hold of expiredHolds) {
      await db.prepare("UPDATE billing_holds SET status = ?, resolved_at = ? WHERE id = ?").run(
        "expired",
        now,
        hold.id
      );
      await db.prepare(
        "UPDATE entitlements SET credits_balance = credits_balance + ?, updated_at = ? WHERE user_id = ?"
      ).run(hold.credits_held, now, hold.user_id);
      await db.prepare("UPDATE track_versions SET status = ? WHERE id = ?").run(
        "failed",
        hold.track_version_id
      );
      await db.prepare(
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

  const startupEventsService = createEventsService(db);
  async function addStartupAuditEntry({ userId, action, resourceType, resourceId, metadata }) {
    await db.prepare(
      "INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(newUuid(), userId || null, action, resourceType, resourceId || null, toJson(metadata || {}), nowIso());
  }

  // Validate Apple refresh tokens once per day (best practice for persistent sessions)
  const appleValidationIntervalMs = 24 * 60 * 60 * 1000;
  setInterval(async () => {
    try {
      const rows = await db
        .prepare("SELECT id, user_id, provider_data FROM user_auth_providers WHERE provider = 'apple' AND provider_data IS NOT NULL")
        .all();
      const now = nowIso();
      for (const row of rows) {
        let providerData;
        try {
          providerData = row.provider_data ? JSON.parse(row.provider_data) : {};
        } catch {
          providerData = {};
        }
        const refreshToken = providerData.apple_refresh_token;
        if (!refreshToken) continue;

        const lastValidated = providerData.apple_last_validated_at;
        if (lastValidated) {
          const last = Date.parse(lastValidated);
          if (!Number.isNaN(last) && Date.now() - last < appleValidationIntervalMs) {
            continue;
          }
        }

        try {
          const validation = await refreshAppleToken(refreshToken);
          // Apple may return a new refresh token; update if provided
          if (validation.refresh_token) {
            providerData.apple_refresh_token = validation.refresh_token;
            providerData.apple_refresh_rotated_at = now;
          }
          providerData.apple_last_validated_at = now;
          await db
            .prepare("UPDATE user_auth_providers SET provider_data = ? WHERE id = ?")
            .run(JSON.stringify(providerData), row.id);

          await addStartupAuditEntry({
            userId: row.user_id,
            action: "apple_refresh_token_validated",
            resourceType: "auth_provider",
            resourceId: row.id,
            metadata: {
              rotated: Boolean(validation.refresh_token),
              validated_at: now,
            },
          });
          if (startupEventsService) {
            startupEventsService.emit("apple_refresh_token_validated", {
              userId: row.user_id,
              resourceType: "auth_provider",
              resourceId: row.id,
              metadata: {
                rotated: Boolean(validation.refresh_token),
              },
            });
          }
        } catch (err) {
          console.warn("[AppleSignIn] Refresh token validation failed:", err.message);
          providerData.apple_refresh_invalid_at = now;
          providerData.apple_refresh_error = err.code || "APPLE_REFRESH_TOKEN_FAILED";
          await db
            .prepare("UPDATE user_auth_providers SET provider_data = ? WHERE id = ?")
            .run(JSON.stringify(providerData), row.id);

          await addStartupAuditEntry({
            userId: row.user_id,
            action: "apple_refresh_token_invalid",
            resourceType: "auth_provider",
            resourceId: row.id,
            metadata: {
              error: err.code || "APPLE_REFRESH_TOKEN_FAILED",
              message: err.message,
              invalid_at: now,
            },
          });
          if (startupEventsService) {
            startupEventsService.emit("apple_refresh_token_invalid", {
              userId: row.user_id,
              resourceType: "auth_provider",
              resourceId: row.id,
              metadata: {
                error: err.code || "APPLE_REFRESH_TOKEN_FAILED",
              },
            });
          }
        }
      }
    } catch (err) {
      console.error("[AppleSignIn] Daily refresh token validation failed:", err.message);
    }
  }, appleValidationIntervalMs);

  // Create billing services once, share with both server and job runner
  const planConfigService = createPlanConfigService(db);
  const appleValidator = createAppleReceiptValidator({
    keyId: config.APPLE_APP_STORE_KEY_ID,
    issuerId: config.APPLE_APP_STORE_ISSUER_ID,
    privateKey: config.APPLE_APP_STORE_PRIVATE_KEY,
    bundleId: config.APPLE_BUNDLE_ID,
    environment: config.APPLE_ENVIRONMENT || "production",
  });
  const googleValidator = createGoogleReceiptValidator({
    packageName: config.GOOGLE_PLAY_PACKAGE_NAME,
    credentials: config.GOOGLE_PLAY_CREDENTIALS_JSON,
  });
  const subscriptionManager = createSubscriptionManager(db, {
    planConfigService,
    appleValidator,
    googleValidator,
  });
  const appleWebhookHandler = createAppleWebhookHandler(db, {
    subscriptionManager,
    appleValidator,
    planConfigService,
  });
  const billingServices = { planConfigService, appleValidator, googleValidator, subscriptionManager, appleWebhookHandler };

  const app = buildServer({ db, config: { ...config, providerStatus }, storage, billingServices });
  app.log.info({ providers: providerStatus }, "provider status");
  let jobRunner;
  if (config.INLINE_JOB_RUNNER) {
    const jobEventsService = createEventsService(db);
    jobRunner = await startJobRunner({
      db,
      storageDir: config.STORAGE_DIR,
      streamBaseUrl: config.STREAM_BASE_URL,
      intervalMs: 1000,
      providerConfig,
      devMode: config.DEV_MODE,
      storageProvider: storage,
      subscriptionManager, // Pass for song spending on full render
      eventsService: jobEventsService,
    });
  }

  // Start subscription sync job (catches missed webhooks, handles renewals)
  const subscriptionSyncJob = startSubscriptionSyncJob({
    db,
    subscriptionManager,
    appleValidator,
    intervalMs: config.SUBSCRIPTION_SYNC_INTERVAL_MS || 60 * 60 * 1000, // Default: 1 hour
  });

  const giftDispatchJob = startGiftDispatchJob({
    db,
    dispatchGiftById: async (giftId) => app.dispatchGiftById(giftId),
    intervalMs: config.GIFT_DISPATCH_INTERVAL_MS || 30 * 1000,
    batchSize: 25,
  });

  app.addHook("onClose", async () => {
    clearInterval(saveTimer);
    clearInterval(cleanupTimer);
    fileCleanupJob.stop();
    subscriptionSyncJob.stop();
    giftDispatchJob.stop();
    if (jobRunner) {
      jobRunner.stop();
    }
    db.close();
  });
  try {
    await app.listen({ port: config.PORT, host: config.HOST });
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
