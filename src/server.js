const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const fastify = require("fastify");
const { getDatabase } = require("./database");
const config = require("./config");
const { createHLSPlaylist } = require("./utils/hls");
const { generateShareMp4 } = require("./utils/ffmpeg");
const { newUuid, newShareId } = require("./utils/ids");
const { ensureDir, parseJson, toJson, nowIso } = require("./utils/common");
const { stableStringify } = require("./utils/stable-json");
const { extractPolicyTermsFromMessage, expandPolicyTermVariants } = require("./utils/policy-terms");
const {
  createStorageProvider,
  enrollmentChunkKey,
  trackPreviewKey,
  trackMasterKey,
  trackVersionKey,
} = require("./storage");
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
const { registerEnrollmentRoutes } = require("./routes/enrollment");
const { registerPoemRoutes } = require("./routes/poems");
const { registerGiftRoutes } = require("./routes/gifts");
const { registerTrackRoutes } = require("./routes/tracks");
const { registerSharingRoutes } = require("./routes/sharing");
const { registerBillingRoutes } = require("./routes/billing");
const { registerAdminRoutes } = require("./routes/admin");
const { createStoryRepository } = require("./database/story-repository");
const writer = require("./writer");
const adminAuthService = require("./services/admin-auth-service");
const { createEventsService } = require("./services/events-service");
const { getFeatureFlag } = require("./services/feature-flags");
const { generatePoemOgImage } = require("./services/poem-og-generator");
const { generateSongOgImage } = require("./services/song-og-generator");
const {
  getSongOgGenerator, getPoemOgGenerator,
  generateSongOgPreview, generatePoemOgPreview,
  SONG_VARIANT_NAMES, POEM_VARIANT_NAMES,
  SONG_VARIANT_LABELS, POEM_VARIANT_LABELS,
} = require("./services/og-variant-dispatcher");
const emailService = require("./services/email-service");
const { createHealthCheckService } = require("./workflows/health-check");
const { buildTrackVersionUrls } = require("./services/track-urls");
const { refreshAppleToken } = require("./services/apple-signin");

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
  let requireAdminRole; // Forward declaration — assigned by registerAdminRoutes below
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
  const configuredShareCoverVersion =
    config.SHARE_COVER_VERSION ||
    appConfig.SHARE_COVER_VERSION ||
    "2";
  const shareCoverVersion = String(configuredShareCoverVersion || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "");

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
    writeAuditLog: (entry) => addAuditEntry(entry),
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

  // DB-07: CORS — allow same-origin + configured origins
  app.register(require("@fastify/cors"), {
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true,
    credentials: true,
  });

  // DB-08: Security headers via Helmet
  app.register(require("@fastify/helmet"), {
    contentSecurityPolicy: false, // CSP managed separately for HTML pages
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
  registerAuthRoutes(app, { db, subscriptionManager });

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
    shareWebVerify: {
      body: {
        type: "object",
        required: ["pin"],
        properties: {
          pin: { type: "string", pattern: "^[0-9]{6}$" },
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

  function isFacebookCrawlerUserAgent(userAgent) {
    if (!userAgent || typeof userAgent !== "string") {
      return false;
    }
    return /(facebookexternalhit|facebot)/i.test(userAgent);
  }

  function isMobileUserAgent(userAgent) {
    if (!userAgent || typeof userAgent !== "string") return false;
    return /iphone|ipad|ipod/i.test(userAgent) ||
      (/macintosh/i.test(userAgent) && /mobile/i.test(userAgent));
  }

  async function withTimeout(promise, timeoutMs) {
    let timeoutId = null;
    const timeoutPromise = new Promise((_resolve, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
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
      await subscriptionManager.createFreeEntitlements(userId);
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

    if (allowAnonUserId && (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development')) {
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
    // NOTE: x-forwarded-proto and host are trusted unconditionally here.
    // Fastify must be configured with trustProxy: true (or a specific proxy IP)
    // to prevent header spoofing in production. See: fastify({ trustProxy: true }).
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
      channel: "appstore",
      deep_link: deepLinkPath,
    });
    return `${publicBaseUrl}/download?${query.toString()}`;
  }

  function buildPlayShareUrl(shareId, { versioned = true } = {}) {
    if (!versioned || !shareCoverVersion) {
      return `${publicBaseUrl}/play/${shareId}`;
    }
    return `${publicBaseUrl}/play/${shareId}?sv=${encodeURIComponent(String(shareCoverVersion))}`;
  }

  function buildPoemShareUrl(shareId, { versioned = true } = {}) {
    if (!versioned || !shareCoverVersion) {
      return `${publicBaseUrl}/poem/${shareId}`;
    }
    return `${publicBaseUrl}/poem/${shareId}?sv=${encodeURIComponent(String(shareCoverVersion))}`;
  }

  function buildRequestedShareUrl(request, expectedPath, fallbackUrl) {
    const fallback = fallbackUrl;
    const rawUrl = request?.raw?.url;
    if (!rawUrl || typeof rawUrl !== "string") {
      return fallback;
    }
    try {
      const parsed = new URL(rawUrl, publicBaseUrl);
      if (parsed.pathname !== expectedPath) {
        return fallback;
      }
      return parsed.toString();
    } catch (_) {
      return fallback;
    }
  }

  function buildRequestedPlayShareUrl(request, shareId) {
    return buildRequestedShareUrl(request, `/play/${shareId}`, buildPlayShareUrl(shareId));
  }

  function buildRequestedPoemShareUrl(request, shareId) {
    return buildRequestedShareUrl(request, `/poem/${shareId}`, buildPoemShareUrl(shareId));
  }

  function extractSocialCacheToken(request) {
    const rawUrl = request?.raw?.url;
    if (!rawUrl || typeof rawUrl !== "string") {
      return null;
    }
    try {
      const parsed = new URL(rawUrl, publicBaseUrl);
      const tokenKeys = ["smv", "fbv", "xv", "igv", "ttv", "pv"];
      for (const key of tokenKeys) {
        const value = parsed.searchParams.get(key);
        if (value && String(value).trim()) {
          return String(value).slice(0, 64);
        }
      }
    } catch (_) {
      return null;
    }
    return null;
  }

  function buildShareCoverUrl(shareId, { socialCacheToken } = {}) {
    const params = new URLSearchParams();
    if (shareCoverVersion) {
      params.set("v", String(shareCoverVersion));
    }
    if (socialCacheToken) {
      params.set("smv", String(socialCacheToken));
    }
    const query = params.toString();
    const suffix = query ? `?${query}` : "";
    return `${publicBaseUrl}/share/${shareId}/cover.jpg${suffix}`;
  }

  function buildPoemOgImageUrl(shareId, { socialCacheToken } = {}) {
    const params = new URLSearchParams();
    if (shareCoverVersion) {
      params.set("v", String(shareCoverVersion));
    }
    if (socialCacheToken) {
      params.set("smv", String(socialCacheToken));
    }
    const query = params.toString();
    const suffix = query ? `?${query}` : "";
    return `${publicBaseUrl}/poem/${shareId}/og-image.png${suffix}`;
  }

  function normalizeVariantName(value, allowedVariants) {
    if (value === null || value === undefined) {
      return null;
    }
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    return allowedVariants.includes(normalized) ? normalized : null;
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
      reply
        .type(contentType)
        .header("Content-Length", stat.size)
        .header("Accept-Ranges", "bytes")
        .headers(cacheHeaders)
        .send(fs.createReadStream(filePath));
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
    // Uses weighted average of current and previous window counts.
    // Atomic approach: increment first, then check. If over limit, decrement (rollback).
    // This eliminates the TOCTOU race between the pre-check SELECT and the upsert.
    try {
      const now = Date.now();
      const windowMs = windowSeconds * 1000;
      const currentWindowStart = Math.floor(now / windowMs) * windowMs;
      const previousWindowStart = currentWindowStart - windowMs;
      const elapsedInWindow = now - currentWindowStart;
      const windowProgress = elapsedInWindow / windowMs; // 0.0 to 1.0
      const resetAt = new Date(currentWindowStart + windowMs).toISOString();

      // Step 1: Atomically increment the current window counter first.
      // Using INSERT ... ON CONFLICT DO UPDATE to ensure atomicity.
      await db.prepare(
        `INSERT INTO rate_limits (user_id, action_type, window_start_ms, window_seconds, count, limit_count)
         VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT(user_id, action_type, window_start_ms)
         DO UPDATE SET count = rate_limits.count + 1`
      ).run(userId, actionKey, currentWindowStart, windowSeconds, limit);

      // Step 2: Read back current and previous window counts post-increment.
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

      // Step 3: If over limit, roll back the increment and deny.
      if (weightedCount > limit) {
        await db.prepare(
          `UPDATE rate_limits SET count = GREATEST(count - 1, 0)
           WHERE user_id = ? AND action_type = ? AND window_start_ms = ?`
        ).run(userId, actionKey, currentWindowStart);
        return { allowed: false, remaining: 0, reset_at: resetAt };
      }

      return {
        allowed: true,
        remaining: Math.max(0, Math.floor(limit - weightedCount)),
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

  function isUniqueConstraintError(err) {
    const code = String(err?.code || "").toUpperCase();
    const message = String(err?.message || "");
    if (code === "23505" || code.includes("SQLITE_CONSTRAINT")) {
      return true;
    }
    return message.includes("UNIQUE") || message.toLowerCase().includes("duplicate");
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
    externalQuery = null,
  }) {
    const numAmount = Number(amount || 0);
    const timestamp = nowIso();

    // C2: When externalQuery is provided, run inside the caller's transaction
    // instead of creating a new one. This enables atomic receipt + wallet credit.
    const execute = async (query) => {
      await query(
        `INSERT INTO gift_wallet (user_id, balance, updated_at)
         VALUES (?, 0, ?)
         ON CONFLICT(user_id) DO NOTHING`,
        [userId, timestamp]
      );

      if (idempotencyKey) {
        const existingResult = await query(
          `SELECT id, balance_after
           FROM gift_wallet_transactions
           WHERE user_id = ? AND idempotency_key = ?
           ORDER BY created_at DESC
           LIMIT 1`,
          [userId, idempotencyKey]
        );
        const existing = existingResult?.rows?.[0];
        if (existing) {
          return {
            transactionId: existing.id,
            balanceAfter: Number(existing.balance_after || 0),
            idempotent: true,
          };
        }
      }

      let balanceBefore;
      let balanceAfter;

      // BILL-18: Cap wallet balance to prevent unbounded accumulation
      const MAX_WALLET_BALANCE = 100000;

      if (db.isPostgres) {
        const updatedResult = await query(
          "UPDATE gift_wallet SET balance = balance + ?, updated_at = ? WHERE user_id = ? AND (balance + ?) >= 0 AND (balance + ?) <= ? RETURNING balance",
          [numAmount, timestamp, userId, numAmount, numAmount, MAX_WALLET_BALANCE]
        );
        const updated = updatedResult?.rows?.[0];
        if (!updated) {
          const err = new Error("INSUFFICIENT_GIFT_TOKENS");
          err.code = "INSUFFICIENT_GIFT_TOKENS";
          throw err;
        }
        balanceAfter = Number(updated.balance);
        balanceBefore = balanceAfter - numAmount;
      } else {
        const updatedResult = await query(
          "UPDATE gift_wallet SET balance = balance + ?, updated_at = ? WHERE user_id = ? AND (balance + ?) >= 0 AND (balance + ?) <= ?",
          [numAmount, timestamp, userId, numAmount, numAmount, MAX_WALLET_BALANCE]
        );
        if (!updatedResult?.rowCount) {
          const err = new Error("INSUFFICIENT_GIFT_TOKENS");
          err.code = "INSUFFICIENT_GIFT_TOKENS";
          throw err;
        }
        const walletResult = await query(
          "SELECT balance FROM gift_wallet WHERE user_id = ?",
          [userId]
        );
        const walletRow = walletResult?.rows?.[0];
        balanceAfter = Number(walletRow?.balance || 0);
        balanceBefore = balanceAfter - numAmount;
      }

      const transactionId = `gwtx_${crypto.randomBytes(12).toString("hex")}`;
      try {
        await query(
          `INSERT INTO gift_wallet_transactions (
            id, user_id, type, amount, balance_before, balance_after,
            source, reference_type, reference_id, description, metadata_json, idempotency_key, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
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
            timestamp,
          ]
        );
      } catch (err) {
        if (idempotencyKey && isUniqueConstraintError(err)) {
          // Another request committed the same idempotency key after our pre-check.
          // Revert this request's balance mutation before returning the existing tx.
          const revertResult = await query(
            "UPDATE gift_wallet SET balance = balance - ?, updated_at = ? WHERE user_id = ? AND balance >= ?",
            [numAmount, timestamp, userId, numAmount]
          );
          if (revertResult.rowCount === 0) {
            console.warn("[GiftWallet] Revert skipped after idempotency race", {
              userId,
              amount: numAmount,
            });
          }
          const existingResult = await query(
            `SELECT id, balance_after
             FROM gift_wallet_transactions
             WHERE user_id = ? AND idempotency_key = ?
             ORDER BY created_at DESC
             LIMIT 1`,
            [userId, idempotencyKey]
          );
          const existing = existingResult?.rows?.[0];
          if (existing) {
            return {
              transactionId: existing.id,
              balanceAfter: Number(existing.balance_after || 0),
              idempotent: true,
            };
          }
        }
        throw err;
      }

      return { transactionId, balanceAfter, idempotent: false };
    };

    if (externalQuery) {
      return execute(externalQuery);
    }
    return db.transaction(execute);
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
          shareUrl: buildPlayShareUrl(existing.id),
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
      shareUrl: buildPlayShareUrl(shareId),
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
          shareUrl: buildPoemShareUrl(existing.id),
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
      shareUrl: buildPoemShareUrl(shareId),
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
  /** Callers MUST wrap in a transaction — relies on caller-provided serialization. */
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
      // Use db.query() instead of db.prepare() to avoid plan-cache pollution from
      // variable-length IN clauses (each unique param count creates a new cached entry).
      const placeholders = versionIds.map(() => "?").join(",");
      const { rows: failedJobs } = await db.query(
        `SELECT track_version_id, error_code, error_message, step_data, updated_at, completed_at
         FROM jobs
         WHERE track_version_id IN (${placeholders})
           AND status IN ('failed', 'dead_letter', 'blocked')
         ORDER BY COALESCE(completed_at, updated_at) DESC`,
        versionIds
      );

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

    // Use db.query() instead of db.prepare() to avoid plan-cache pollution from
    // variable-length IN clauses (each unique param count creates a new cached entry).
    const placeholders = trackIds.map(() => "?").join(",");
    const { rows: versions } = await db.query(
      `SELECT * FROM track_versions WHERE track_id IN (${placeholders})`,
      trackIds
    );

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
    getUserRiskLevel,
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

  // ============ Enrollment + Device + Voice Profile Routes ============
  registerEnrollmentRoutes(app, {
    db,
    appConfig,
    storageProvider,
    requireUserId,
    sendError,
    consumeRateLimit,
    addAuditEntry,
    getBaseUrl,
    getDeviceTokenPayload,
    computeFileSha256,
    resolveEnrollmentChunkFiles,
    resolveStoragePath,
    sendMediaFile,
    schemas,
    issueDeviceToken,
    deviceTokenTtlDays,
    enableDebugRoutes,
  });

  // ============ Poems + Poem Sharing + Poem Audio Routes ============
  registerPoemRoutes(app, {
    db,
    appConfig,
    config,
    requireUserId,
    sendError,
    consumeRateLimit,
    addAuditEntry,
    eventsService,
    sendMediaFile,
    ensureDir,
    upsertPoemLibraryEntry,
    withPoemLibraryFlags,
    getPoemForLibrary,
    buildPoemShareUrl,
    buildShareAppDownloadUrl,
    normalizeVariantName,
    generatePoemOgPreview,
    POEM_VARIANT_NAMES,
    POEM_VARIANT_LABELS,
    allowAnonUserId,
    ensureUser,
    getDeviceTokenPayload,
    poemAudioGenerationLocks,
    subscriptionManager,
  });

  // ============ Gift Scheduling + Delivery ============
  registerGiftRoutes(app, {
    db,
    requireUserId,
    sendError,
    addAuditEntry,
    eventsService,
    normalizeGiftChannels,
    normalizeGiftPhone,
    normalizeGiftEmail,
    parseGiftChannelsJson,
    renderGiftSummary,
    ensureGiftWalletRow,
    applyGiftWalletTransaction,
    ensureTrackGiftShareToken,
    ensurePoemGiftShareToken,
    dispatchGiftById,
    giftReservationTtlMinutes: config.GIFT_RESERVATION_TTL_MINUTES,
  });

  // ============ Tracks ============
  registerTrackRoutes(app, {
    db,
    config,
    appConfig,
    storageProvider,
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
    SONG_VARIANT_LABELS,
    generateSongOgPreview,
    buildPlayShareUrl,
    buildShareAppDownloadUrl,
    getDeviceTokenPayload,
    sendMediaFile,
    ensureShareMp4,
    subscriptionManager,
    allowAnonUserId,
    ensureUser,
    addShareAccessLog,
  });

  // ============ Sharing + Web Player + OG Previews ============
  registerSharingRoutes(app, {
    db,
    appConfig,
    storageProvider,
    requireUserId,
    sendError,
    addAuditEntry,
    eventsService,
    addShareAccessLog,
    schemas,
    getBaseUrl,
    getDeviceTokenPayload,
    sendMediaFile,
    findTrackVersion,
    getTrackVersions,
    hydrateTrackCoverImages,
    upsertTrackLibraryEntry,
    normalizeVariantName,
    generateSongOgPreview,
    generateSongOgImage,
    getSongOgGenerator,
    generatePoemOgImage,
    getPoemOgGenerator,
    SONG_VARIANT_NAMES,
    SONG_VARIANT_LABELS,
    POEM_VARIANT_NAMES,
    getVersionDir,
    escapeHtml,
    formatOccasion,
    extractSocialCacheToken,
    injectOgTags,
    webPlayerTemplate,
    poemViewerTemplate,
    embedPlayerTemplate,
    shareNotFoundHtml,
    isSocialCrawlerUserAgent,
    isFacebookCrawlerUserAgent,
    isMobileUserAgent,
    withTimeout,
    publicBaseUrl,
    facebookAppId,
    shareCoverVersion,
    allowDeviceTokenFallback,
    cdnSignerInstance,
    buildPlayShareUrl,
    buildShareAppDownloadUrl,
    buildShareCoverUrl,
    buildPoemOgImageUrl,
    buildRequestedPlayShareUrl,
    buildRequestedPoemShareUrl,
    buildTrackVersionUrls,
    rewriteStreamUrl,
    ensureShareMp4,
    ensureShareHls,
    isShareMp4Ready,
    ensureLocalFileFromStorage,
    trackMasterKey,
    trackPreviewKey,
    trackVersionKey,
    serveTrackAudio,
    subscriptionManager,
    getUserRiskLevel,
  });

  // ============ ADMIN DASHBOARD API ============
  ({ requireAdminRole } = registerAdminRoutes(app, {
    db,
    appConfig,
    sendError,
    adminAuthService,
    subscriptionManager,
  }));

  // ============ Billing API Routes ============
  registerBillingRoutes(app, {
    db,
    appConfig,
    requireUserId,
    sendError,
    addAuditEntry,
    eventsService,
    requireAdminRole,
    subscriptionManager,
    appleValidator,
    googleValidator,
    giftTokenProductId,
    getGiftWalletSummary,
    applyGiftWalletTransaction,
    appleWebhookHandler,
    planConfigService,
  });

  return app;
}

async function start() {
  if (process.env.ALLOW_ANON_USER_ID === 'true' && process.env.NODE_ENV === 'production') {
    throw new Error('ALLOW_ANON_USER_ID must not be enabled in production — it bypasses all authentication');
  }
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
  // db.save() is SQLite-specific (WAL flush); skip on PostgreSQL where it is a no-op stub
  const saveTimer = db.save ? setInterval(() => db.save(), 2000) : null;
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

  const giftReservationExpiryTimer = setInterval(() => {
    app.expireGiftReservations({ limit: 50 }).catch((err) => {
      app.log.error(err, "Gift reservation expiry sweep failed");
    });
  }, config.GIFT_RESERVATION_SWEEP_INTERVAL_MS || 60 * 1000);

  app.expireGiftReservations({ limit: 50 }).catch((err) => {
    app.log.error(err, "Initial gift reservation expiry sweep failed");
  });

  app.addHook("onClose", async () => {
    clearInterval(saveTimer);
    clearInterval(cleanupTimer);
    fileCleanupJob.stop();
    subscriptionSyncJob.stop();
    giftDispatchJob.stop();
    clearInterval(giftReservationExpiryTimer);
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
