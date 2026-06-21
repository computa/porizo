const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const fastify = require("fastify");
const twilio = require("twilio");
const { Resend } = require("resend");
const { getDatabase } = require("./database");
const config = require("./config");
const { createHLSPlaylist } = require("./utils/hls");
const { generateShareMp4 } = require("./utils/ffmpeg");
const {
  resolveShareVideoAudio,
  SHARE_TEASER_MAX_SECONDS,
} = require("./media/share-video-source");
const { newUuid, newShareId } = require("./utils/ids");
const { ensureDir, parseJson, toJson, nowIso } = require("./utils/common");
const { stableStringify } = require("./utils/stable-json");
const {
  extractPolicyTermsFromMessage,
  expandPolicyTermVariants,
} = require("./utils/policy-terms");
const {
  scanLyricsForProviderPolicy,
  sanitizeLyricsForProviderPolicy,
} = require("./services/lyrics-policy-sanitizer");
const {
  createStorageProvider,
  enrollmentChunkKey,
  trackPreviewKey,
  trackMasterKey,
  trackVersionKey,
  trackArtworkKey,
} = require("./storage");
const { startCleanupJob } = require("./jobs/cleanup");
const { startSubscriptionSyncJob } = require("./jobs/subscription-sync");
const { startGiftDispatchJob } = require("./jobs/gift-dispatch");
const { startColdEmailJob } = require("./jobs/cold-email-daily");
const { startShareFollowupsJob } = require("./jobs/share-followups-daily");
const { startJobRunner, cleanStaleStepFiles } = require("./workflows/runner");
// Billing services
const {
  createAppleReceiptValidator,
} = require("./services/apple-receipt-validator");
const {
  createGoogleReceiptValidator,
} = require("./services/google-receipt-validator");
const {
  createAppleWebhookHandler,
} = require("./services/apple-webhook-handler");
const { createPlanConfigService } = require("./services/plan-config");
const {
  createSubscriptionManager,
} = require("./services/subscription-manager");
const authService = require("./services/auth-service");
const {
  issueDeviceToken,
  verifyDeviceToken,
} = require("./services/device-token");
const { registerAuthRoutes } = require("./routes/auth");
const { registerLegalRoutes } = require("./routes/legal");
const { registerWellKnownRoutes } = require("./routes/well-known");
const {
  registerInternalSunoCallbackRoutes,
} = require("./routes/internal-suno-callback");
const { registerMcpRoutes } = require("./routes/mcp");
const { registerBlogRoutes } = require("./routes/blog");
const { registerAnalyticsRoutes } = require("./routes/analytics");
const { registerStoryRoutes } = require("./routes/story");
const { registerEnrollmentRoutes } = require("./routes/enrollment");
const { registerPoemRoutes } = require("./routes/poems");
const { registerGiftRoutes } = require("./routes/gifts");
const { registerTrackRoutes } = require("./routes/tracks");
const { registerSharingRoutes } = require("./routes/sharing");
const {
  registerArtworkRoutes,
  buildSignedArtworkUrl,
} = require("./routes/artwork");
const { registerBillingRoutes } = require("./routes/billing");
const { registerOnboardingRoutes } = require("./routes/onboarding");
const { registerAdminRoutes } = require("./routes/admin");
const { createStoryRepository } = require("./database/story-repository");
const writer = require("./writer");
const adminAuthService = require("./services/admin-auth-service");
const { createEventsService } = require("./services/events-service");
const {
  createReceiverSessionService,
} = require("./services/receiver-session-service");
const { createAppLinkService } = require("./services/app-link-service");
const { getFeatureFlag } = require("./services/feature-flags");
const { generatePoemOgImage } = require("./services/poem-og-generator");
const {
  generateSongOgImage,
  generateSongOgImageSquare,
  generateSongArtworkPreviewImage,
} = require("./services/song-og-generator");
const {
  getSongOgGenerator,
  getPoemOgGenerator,
  generateSongOgPreview,
  generatePoemOgPreview,
  SONG_VARIANT_NAMES,
  POEM_VARIANT_NAMES,
  SONG_VARIANT_LABELS,
  POEM_VARIANT_LABELS,
} = require("./services/og-variant-dispatcher");
const emailService = require("./services/email-service");
const {
  upsertGiftIncident,
  resolveGiftIncident,
  resolveGiftIncidentsForGift,
  normalizeTwilioReceipt,
  normalizeResendReceipt,
  chooseReceiptState,
  redactGiftContacts,
} = require("./services/gift-delivery-ops");
const { createGiftOpsMonitor } = require("./services/gift-ops-monitoring");
const { createHealthCheckService } = require("./workflows/health-check");
const { buildTrackVersionUrls } = require("./services/track-urls");
const { refreshAppleToken } = require("./services/apple-signin");
const { startTagSyncJob } = require("./services/onesignal");

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

function lyricsHashSha256(lyricsJson) {
  if (!lyricsJson) return null;
  const text =
    typeof lyricsJson === "string" ? lyricsJson : stableStringify(lyricsJson);
  return crypto.createHash("sha256").update(text).digest("hex");
}

function deriveRetrySanitizerProvider({ trackVersion, classification }) {
  const musicPlan = parseJson(
    trackVersion?.music_plan_json,
    null,
    "retry_music_plan",
  );
  if (
    typeof musicPlan?.provider_resolved === "string" &&
    musicPlan.provider_resolved.trim()
  ) {
    return musicPlan.provider_resolved.trim();
  }
  const providerLocked = musicPlan?.render_contract?.provider_locked;
  if (typeof providerLocked === "string" && providerLocked.trim()) {
    return providerLocked.trim();
  }
  if (
    typeof classification?.provider === "string" &&
    classification.provider.trim()
  ) {
    return classification.provider.trim();
  }
  return null;
}

function deriveSharePublicBaseUrl(publicBaseUrl) {
  try {
    const parsed = new URL(publicBaseUrl);
    if (parsed.hostname === "api.porizo.co") {
      parsed.hostname = "porizo.co";
      return parsed.origin;
    }
  } catch (_) {
    // Fall through to the configured base URL for local/dev values.
  }
  return publicBaseUrl;
}

function normalizeHostForSecurity(host) {
  const raw = String(host || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (raw.startsWith("[")) {
    const closeBracket = raw.indexOf("]");
    if (closeBracket > 0) return raw.slice(1, closeBracket);
  }
  const colonCount = (raw.match(/:/g) || []).length;
  if (colonCount === 1) return raw.replace(/:\d+$/, "");
  return raw;
}

function hostFromUrl(value) {
  try {
    return normalizeHostForSecurity(new URL(value).hostname);
  } catch (_) {
    return "";
  }
}

function csvToLowerSet(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((entry) => normalizeHostForSecurity(entry))
      .filter(Boolean),
  );
}

function buildAllowedHostSet({
  appConfig,
  publicBaseUrl,
  sharePublicBaseUrl,
  twilioStatusCallbackBaseUrl,
}) {
  const hosts = csvToLowerSet(appConfig.HOST_ALLOWLIST || "");
  for (const value of [
    publicBaseUrl,
    sharePublicBaseUrl,
    twilioStatusCallbackBaseUrl,
    appConfig.STREAM_BASE_URL,
    appConfig.PUBLIC_BASE_URL,
    appConfig.SHARE_PUBLIC_BASE_URL,
  ]) {
    const host = hostFromUrl(value);
    if (host) hosts.add(host);
  }

  // Local development and Fastify injection defaults.
  for (const host of ["localhost", "127.0.0.1", "::1"]) {
    hosts.add(host);
  }

  return hosts;
}

function getHostAllowlistMode(appConfig) {
  const mode = String(appConfig.HOST_ALLOWLIST_MODE || "off").toLowerCase();
  if (["off", "report", "enforce"].includes(mode)) return mode;
  return "off";
}

function registerHostAllowlist(app, { appConfig, allowedHosts }) {
  const mode = getHostAllowlistMode(appConfig);
  if (mode === "off") return;

  app.addHook("onRequest", async (request, reply) => {
    // Infra health probes (Railway hits /health with Host: healthcheck.railway.app)
    // must bypass host validation — the endpoint exposes no sensitive data and has to
    // answer the platform probe regardless of Host, or zero-downtime deploys fail.
    if (request.url.split("?")[0] === "/health") return;
    const host = normalizeHostForSecurity(request.headers.host);
    if (!host || allowedHosts.has(host)) return;

    request.log.warn(
      {
        host,
        mode,
        url: request.url,
        method: request.method,
      },
      "Blocked or observed request for untrusted host",
    );

    if (mode === "enforce") {
      return reply.code(421).type("application/json").send({
        error: "MISDIRECTED_REQUEST",
        message: "Host is not configured for this service",
      });
    }
  });
}

function buildServer({
  db,
  config: appConfig,
  storage,
  cdnSigner = null,
  billingServices = null,
  oneSignalService = null,
}) {
  let requireAdminRole; // Forward declaration — assigned by registerAdminRoutes below
  const app = fastify({
    logger: true,
    bodyLimit: 1048576, // 1MB max body size to prevent JSON DoS
    trustProxy: true, // Railway reverse proxy — read X-Forwarded-For for real client IP
  });

  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => {
      try {
        const params = new URLSearchParams(body);
        const parsed = {};
        for (const [key, value] of params.entries()) {
          parsed[key] = value;
        }
        done(null, parsed);
      } catch (err) {
        done(err);
      }
    },
  );

  const publicBaseUrl =
    appConfig.PUBLIC_BASE_URL ||
    appConfig.STREAM_BASE_URL ||
    config.PUBLIC_BASE_URL ||
    config.STREAM_BASE_URL;
  const sharePublicBaseUrl =
    appConfig.SHARE_PUBLIC_BASE_URL ||
    config.SHARE_PUBLIC_BASE_URL ||
    deriveSharePublicBaseUrl(publicBaseUrl);
  const twilioStatusCallbackBaseUrl =
    appConfig.TWILIO_STATUS_CALLBACK_BASE_URL ||
    config.TWILIO_STATUS_CALLBACK_BASE_URL ||
    publicBaseUrl;
  const allowedHosts = buildAllowedHostSet({
    appConfig,
    publicBaseUrl,
    sharePublicBaseUrl,
    twilioStatusCallbackBaseUrl,
  });
  registerHostAllowlist(app, { appConfig, allowedHosts });

  // Cache HTML templates at startup to avoid readFileSync on every request
  const webPlayerTemplate = fs.readFileSync(
    path.join(process.cwd(), "web-player", "index.html"),
    "utf-8",
  );
  const poemViewerTemplate = fs.readFileSync(
    path.join(process.cwd(), "poem-viewer", "index.html"),
    "utf-8",
  );
  const embedPlayerTemplate = fs.readFileSync(
    path.join(process.cwd(), "embed-player", "index.html"),
    "utf-8",
  );

  if (!storage) {
    throw new Error("Storage provider is required.");
  }
  const storageProvider = storage;
  const allowAnonUserId =
    appConfig.ALLOW_ANON_USER_ID ??
    (process.env.ALLOW_ANON_USER_ID === "true"
      ? true
      : (config.ALLOW_ANON_USER_ID ?? false));
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
    appConfig.STORY_ENGINE_DEFAULT ?? config.STORY_ENGINE_DEFAULT ?? "v3";
  const requireS3 = appConfig.REQUIRE_S3 ?? config.REQUIRE_S3 ?? false;
  const allowDeviceTokenFallback =
    appConfig.ALLOW_DEVICE_TOKEN_FALLBACK ??
    config.ALLOW_DEVICE_TOKEN_FALLBACK ??
    false;
  const deviceTokenTtlDays = Number(process.env.DEVICE_TOKEN_TTL_DAYS || 30);
  const giftTokenProductId =
    appConfig.GIFT_TOKEN_PRODUCT_ID ||
    config.GIFT_TOKEN_PRODUCT_ID ||
    "com.porizo.gift_token_oneoff";
  const giftDispatchMaxAttempts = Number(
    appConfig.GIFT_DISPATCH_MAX_ATTEMPTS ??
      config.GIFT_DISPATCH_MAX_ATTEMPTS ??
      5,
  );
  const facebookAppId =
    appConfig.FACEBOOK_APP_ID || config.FACEBOOK_APP_ID || "";
  const configuredShareCoverVersion =
    config.SHARE_COVER_VERSION || appConfig.SHARE_COVER_VERSION || "2";
  const shareCoverVersion = String(configuredShareCoverVersion || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "");

  if (requireS3 && storageProvider.type !== "s3") {
    throw new Error("REQUIRE_S3 is enabled but storage provider is not S3.");
  }

  // CDN signer for CloudFront signed URLs (optional)
  const cdnSignerInstance = cdnSigner;

  // Initialize billing services (use passed-in services or create new ones)
  const planConfigService =
    billingServices?.planConfigService || createPlanConfigService(db);
  const appleValidator =
    billingServices?.appleValidator ||
    createAppleReceiptValidator({
      keyId: appConfig.APPLE_APP_STORE_KEY_ID,
      issuerId: appConfig.APPLE_APP_STORE_ISSUER_ID,
      privateKey: appConfig.APPLE_APP_STORE_PRIVATE_KEY,
      bundleId: appConfig.APPLE_BUNDLE_ID,
      environment: appConfig.APPLE_ENVIRONMENT || "production",
    });
  const googleValidator =
    billingServices?.googleValidator ||
    createGoogleReceiptValidator({
      packageName: appConfig.GOOGLE_PLAY_PACKAGE_NAME,
      credentials: appConfig.GOOGLE_PLAY_CREDENTIALS_JSON,
    });
  const defaultSubscriptionManager = createSubscriptionManager(db, {
    planConfigService,
    appleValidator,
    googleValidator,
    writeAuditLog: (entry) => addAuditEntry(entry),
  });
  const subscriptionManager = billingServices?.subscriptionManager
    ? { ...defaultSubscriptionManager, ...billingServices.subscriptionManager }
    : defaultSubscriptionManager;

  const appleWebhookHandler =
    billingServices?.appleWebhookHandler ||
    createAppleWebhookHandler(db, {
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
  app.register(require("@fastify/static"), {
    root: path.join(process.cwd(), "public/audio"),
    prefix: "/audio/",
    decorateReply: false,
    maxAge: "7d",
  });

  // Apple App Site Association for universal links (explicit route for correct MIME type)
  const aasaJson = JSON.stringify({
    applinks: {
      apps: [],
      details: [
        {
          appID: "5VCH6937XM.com.porizo.PorizoApp",
          paths: ["/play/*", "/s/*", "/poem/*"],
        },
      ],
    },
  });
  app.get("/.well-known/apple-app-site-association", async (request, reply) => {
    return reply.type("application/json").send(aasaJson);
  });

  // DB-07: CORS — allow same-origin + configured origins
  if (!process.env.CORS_ORIGIN && process.env.NODE_ENV === "production") {
    throw new Error(
      "[SecurityGuard:CORS] CORS_ORIGIN must be set in production. Server cannot start with unrestricted CORS. Set CORS_ORIGIN to a comma-separated list of allowed origins.",
    );
  }
  app.register(require("@fastify/cors"), {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",")
      : false,
    credentials: true,
  });

  // DB-08: Security headers via Helmet
  app.register(require("@fastify/helmet"), {
    contentSecurityPolicy: false, // CSP managed separately for HTML pages
    // Helmet's default `Cross-Origin-Resource-Policy: same-origin` triggers
    // Chrome's ORB (Opaque Response Blocking) for external stylesheets and
    // fonts loaded cross-origin (e.g., Google Fonts for the landing site),
    // so headings were silently falling back to Georgia / Times. Relax to
    // `cross-origin` — typical for marketing + API, still safe given no
    // embedded credentialed APIs.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  // Register multipart for file uploads
  app.register(require("@fastify/multipart"), {
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  });

  // Rate limiting (used by /mcp; opt-in via route config.rateLimit).
  app.register(require("@fastify/rate-limit"), {
    global: false,
  });

  // Markdown content negotiation for marketing pages (Accept: text/markdown).
  app.register(require("./plugins/markdown-negotiation"));

  app.addContentTypeParser(
    ["audio/wav", "application/octet-stream"],
    { parseAs: "buffer" },
    (request, body, done) => {
      done(null, body);
    },
  );

  // ============ Authentication Routes ============
  registerLegalRoutes(app, { db });
  registerWellKnownRoutes(app);
  registerInternalSunoCallbackRoutes(app, { appConfig, sendError });
  registerMcpRoutes(app);
  registerBlogRoutes(app, { db, config: appConfig });
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
          recipient_phone: { type: "string", maxLength: 32 },
          recipient_channel: { type: "string", maxLength: 32 },
          style: { type: "string", maxLength: 100 },
          duration_target: { type: "integer", minimum: 30, maximum: 180 },
          voice_mode: { type: "string", enum: ["user_voice", "ai_voice"] },
          voice_gender: { type: "string", enum: ["male", "female"] },
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
          // U2/U17: explicit Suno-persona scope grant (separate from general
          // enrollment consent). Either form is accepted:
          //   consent_scopes: ["voice_suno_persona_v1", ...]
          //   voice_suno_persona_consent: true (boolean shortcut)
          consent_scopes: {
            type: "array",
            items: { type: "string", maxLength: 100 },
            maxItems: 16,
          },
          voice_suno_persona_consent: { type: "boolean" },
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
          // Late-grant of persona consent: client may opt in at completion
          // time even if /start did not include the scope. Same shape as
          // enrollmentStart so the gate is consistent.
          consent_scopes: {
            type: "array",
            items: { type: "string", maxLength: 100 },
            maxItems: 16,
          },
          voice_suno_persona_consent: { type: "boolean" },
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
          receiver_session_id: { type: "string", pattern: "^rs_[a-f0-9]{24}$" },
          receiver_session_secret: {
            type: "string",
            pattern: "^[a-f0-9]{48}$",
          },
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

  const SOCIAL_CRAWLER_UA_REGEX =
    /(facebookexternalhit|facebot|meta-externalagent|meta-externalfetcher|twitterbot|slackbot|discordbot|linkedinbot|whatsapp|telegrambot|pinterest|skypeuripreview)/i;

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
    return /(facebookexternalhit|facebot|meta-externalagent|meta-externalfetcher)/i.test(
      userAgent,
    );
  }

  function isWhatsAppCrawlerUserAgent(userAgent) {
    if (!userAgent || typeof userAgent !== "string") return false;
    return /whatsapp/i.test(userAgent);
  }

  function isMobileUserAgent(userAgent) {
    if (!userAgent || typeof userAgent !== "string") return false;
    return (
      /iphone|ipad|ipod/i.test(userAgent) ||
      (/macintosh/i.test(userAgent) && /mobile/i.test(userAgent))
    );
  }

  async function withTimeout(promise, timeoutMs) {
    let timeoutId = null;
    const timeoutPromise = new Promise((_resolve, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Operation timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function injectOgTags(
    html,
    {
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
      shareId,
    },
  ) {
    const hasVideo = Boolean(ogVideo);
    const escapedVideo = escapeHtml(ogVideo || "");
    const escapedEmbedUrl = escapeHtml(embedUrl || "");
    const ogVideoMeta = hasVideo
      ? [
          "<!-- og:video for iMessage/Discord inline playback -->",
          `<meta property="og:video" content="${escapedVideo}">`,
          `<meta property="og:video:url" content="${escapedVideo}">`,
          `<meta property="og:video:secure_url" content="${escapedVideo}">`,
          '<meta property="og:video:type" content="video/mp4">',
          '<meta property="og:video:width" content="1280">',
          '<meta property="og:video:height" content="1280">',
        ].join("\n  ")
      : "";
    const twitterCardType = hasVideo ? "player" : "summary_large_image";
    const twitterPlayerMeta = hasVideo
      ? [
          `<meta name="twitter:player" content="${escapedEmbedUrl}">`,
          '<meta name="twitter:player:width" content="480">',
          '<meta name="twitter:player:height" content="180">',
          `<meta name="twitter:player:stream" content="${escapedVideo}">`,
          '<meta name="twitter:player:stream:content_type" content="video/mp4">',
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
      .replaceAll("{{FB_APP_ID_META}}", fbAppIdMeta)
      .replaceAll("{{SHARE_ID}}", escapeHtml(shareId || ""));
  }

  async function ensureUser(userId) {
    const existing = await db
      .prepare("SELECT id FROM users WHERE id = ?")
      .get(userId);
    if (!existing) {
      console.log(`[ensureUser] Creating new user: ${userId}`);
      await db
        .prepare(
          "INSERT INTO users (id, created_at, risk_level) VALUES (?, ?, 'low') ON CONFLICT (id) DO NOTHING",
        )
        .run(userId, nowIso());
    }
    const entitlements = await db
      .prepare("SELECT user_id FROM entitlements WHERE user_id = ?")
      .get(userId);
    if (!entitlements) {
      // SECURITY (P1-ECON): ensureUser must NOT grant free songs — it has no
      // identity/tombstone context, so it was a second ungated Sybil grant path.
      // Create a 0-song entitlements row only; the legitimate grant happens in
      // the registration flow (createFreeEntitlements with identity context).
      app.log.warn(
        { userId },
        "[ensureUser] Missing entitlements row — creating 0-song placeholder (no free grant)",
      );
      await db
        .prepare(
          `INSERT INTO entitlements (user_id, tier, songs_remaining, poems_remaining,
            preview_count_today, preview_count_reset_at, updated_at)
           VALUES (?, 'free', 0, 0, 0, ?, ?)
           ON CONFLICT (user_id) DO NOTHING`,
        )
        .run(userId, new Date(Date.now() + 86400000).toISOString(), nowIso());
    }
  }

  async function getUserRiskLevel(userId) {
    const user = await db
      .prepare("SELECT risk_level FROM users WHERE id = ?")
      .get(userId);
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
          "Access token verification failed",
        );
        sendError(
          reply,
          401,
          "INVALID_TOKEN",
          "Invalid or expired access token.",
        );
        return null;
      }
    }

    if (allowAnonUserId && process.env.NODE_ENV !== "production") {
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
        sendError(
          reply,
          401,
          "DEVICE_TOKEN_REQUIRED",
          "Missing x-device-token header.",
        );
      }
      return null;
    }
    try {
      return verifyDeviceToken(rawToken);
    } catch (err) {
      if (required) {
        sendError(
          reply,
          401,
          "INVALID_DEVICE_TOKEN",
          "Invalid or expired device token.",
        );
      }
      return null;
    }
  }

  function getBaseUrl(request) {
    // SECURITY (P2 host-header pinning): prefer a server-side configured base URL
    // for generated links so a spoofed Host header cannot poison share/reset
    // links. Fall back to the request Host only when no config value is set.
    if (publicBaseUrl) {
      return publicBaseUrl;
    }
    const proto = request.headers["x-forwarded-proto"] || "http";
    const host = request.headers["host"];
    if (host) {
      return `${proto}://${host}`;
    }
    return appConfig.STREAM_BASE_URL;
  }

  function buildShareAppDownloadUrl({ shareId: _shareId, kind = "song" }) {
    const query = new URLSearchParams({
      channel: "appstore",
      utm_source: "share_player",
      utm_medium: "recipient_loop",
      utm_campaign: "shared_song_recipient",
      utm_content: `${kind}_generic_install`,
    });
    return `${publicBaseUrl}/download?${query.toString()}`;
  }

  function buildPlayShareUrl(
    shareId,
    { versioned = true, socialCacheToken = null } = {},
  ) {
    const params = new URLSearchParams();
    if (versioned && shareCoverVersion) {
      params.set("sv", String(shareCoverVersion));
    }
    if (socialCacheToken) {
      params.set("smv", String(socialCacheToken).slice(0, 64));
    }
    const query = params.toString();
    return `${sharePublicBaseUrl}/play/${shareId}${query ? `?${query}` : ""}`;
  }

  function buildFreshPlayShareUrl(shareId) {
    return buildPlayShareUrl(shareId, {
      socialCacheToken: Date.now(),
    });
  }

  function buildPoemShareUrl(shareId, { versioned = true } = {}) {
    if (!versioned || !shareCoverVersion) {
      return `${sharePublicBaseUrl}/poem/${shareId}`;
    }
    return `${sharePublicBaseUrl}/poem/${shareId}?sv=${encodeURIComponent(String(shareCoverVersion))}`;
  }

  function buildGiftShareUrl(shareId, { versioned = true } = {}) {
    if (!versioned || !shareCoverVersion) {
      return `${sharePublicBaseUrl}/g/${shareId}`;
    }
    return `${sharePublicBaseUrl}/g/${shareId}?sv=${encodeURIComponent(String(shareCoverVersion))}`;
  }

  function buildRequestedShareUrl(request, expectedPath, fallbackUrl) {
    const fallback = fallbackUrl;
    const rawUrl = request?.raw?.url;
    if (!rawUrl || typeof rawUrl !== "string") {
      return fallback;
    }
    try {
      const parsed = new URL(rawUrl, sharePublicBaseUrl);
      if (parsed.pathname !== expectedPath) {
        return fallback;
      }
      return parsed.toString();
    } catch (_) {
      return fallback;
    }
  }

  function buildRequestedPlayShareUrl(request, shareId) {
    return buildRequestedShareUrl(
      request,
      `/play/${shareId}`,
      buildPlayShareUrl(shareId),
    );
  }

  function buildRequestedPoemShareUrl(request, shareId) {
    return buildRequestedShareUrl(
      request,
      `/poem/${shareId}`,
      buildPoemShareUrl(shareId),
    );
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

  function buildShareCoverUrl(
    shareId,
    { socialCacheToken, artworkVersion, variant } = {},
  ) {
    const params = new URLSearchParams();
    if (shareCoverVersion) {
      params.set("v", String(shareCoverVersion));
    }
    if (socialCacheToken) {
      params.set("smv", String(socialCacheToken));
    }
    // Artwork generated_at as a separate cache-bust token. When recipient name
    // or occasion changes, artwork is regenerated and this timestamp shifts,
    // forcing WhatsApp/iMessage crawlers to re-fetch the OG card.
    if (artworkVersion) {
      params.set("av", String(artworkVersion));
    }
    if (variant) {
      params.set("variant", String(variant));
    }
    const query = params.toString();
    const suffix = query ? `?${query}` : "";
    return `${sharePublicBaseUrl}/share/${shareId}/cover.jpg${suffix}`;
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
    return `${sharePublicBaseUrl}/poem/${shareId}/og-image.png${suffix}`;
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

  const SAFE_ID_RE = /^[a-zA-Z0-9._-]+$/;

  function getVersionDir(track, trackVersion) {
    const storageDir = appConfig.STORAGE_DIR || config.STORAGE_DIR;
    if (!storageDir) {
      throw new Error("[PathConstruction] STORAGE_DIR is not configured");
    }
    if (!SAFE_ID_RE.test(track.user_id) || !SAFE_ID_RE.test(track.id)) {
      throw new Error(
        "[SecurityGuard:PathTraversal] Invalid ID format in path construction",
      );
    }
    return path.join(
      storageDir,
      "tracks",
      track.user_id,
      track.id,
      `v${trackVersion.version_num}`,
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
        console.error(
          `[sendMediaFile] Failed to stat file: ${filePath}`,
          err.message,
        );
        sendError(
          reply,
          500,
          "FILE_ACCESS_ERROR",
          "Unable to access audio file.",
        );
      }
      return;
    }

    // Generate ETag from file mtime for cache validation
    const etag = `"${stat.mtime.getTime()}-${stat.size}"`;
    const lastModified = stat.mtime.toUTCString();

    // Helper to normalize ETags (strip W/ weak prefix for comparison)
    const normalizeEtag = (tag) => (tag ? tag.replace(/^W\//, "") : null);

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
    const cacheControl =
      options.cacheControl ||
      `public, max-age=${config.AUDIO_CACHE_MAX_AGE_SEC}${immutableStr}`;
    const cacheHeaders = {
      "Cache-Control": cacheControl,
      ETag: etag,
      "Last-Modified": lastModified,
    };

    const range = request.headers.range;

    // For small files (< 512KB), buffer to avoid "stream closed prematurely" under
    // concurrent load (e.g. Facebook sending 6-10 crawler requests simultaneously).
    const useBuffer = stat.size < 512 * 1024;

    if (!range) {
      reply
        .type(contentType)
        .header("Content-Length", stat.size)
        .header("Accept-Ranges", "bytes")
        .headers(cacheHeaders)
        .send(
          useBuffer ? fs.readFileSync(filePath) : fs.createReadStream(filePath),
        );
      return;
    }
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (!match) {
      reply
        .type(contentType)
        .header("Content-Length", stat.size)
        .header("Accept-Ranges", "bytes")
        .headers(cacheHeaders)
        .send(
          useBuffer ? fs.readFileSync(filePath) : fs.createReadStream(filePath),
        );
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
      reply.code(416).header("Content-Range", `bytes */${stat.size}`).send();
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
    const promptById = new Map(
      Array.isArray(prompts)
        ? prompts.map((prompt) => [prompt.id, prompt])
        : [],
    );
    const orderedPromptIds = Array.isArray(prompts)
      ? prompts.map((prompt) => prompt.id)
      : [];
    const acceptedIds = orderedPromptIds.filter((id) => metrics[id]?.accepted);
    let chunkIds = acceptedIds.length
      ? acceptedIds
      : Object.keys(metrics || {});

    if (chunkIds.length === 0 && storageProvider.type === "local") {
      const localDir = path.join(
        appConfig.STORAGE_DIR,
        "enrollment",
        "raw",
        userId,
        session.id,
      );
      if (fs.existsSync(localDir)) {
        chunkIds = fs
          .readdirSync(localDir)
          .filter((file) => file.endsWith(".wav"))
          .map((file) => path.basename(file, ".wav"));
      }
    }

    const files = [];
    const chunkEntries = [];
    const missingChunks = [];
    let tempDir = null;
    if (storageProvider.type !== "local") {
      tempDir = fs.mkdtempSync(
        path.join(appConfig.STORAGE_DIR, "tmp-enrollment-"),
      );
    }

    for (const chunkId of chunkIds) {
      const key = enrollmentChunkKey({
        userId,
        sessionId: session.id,
        chunkId,
      });
      const exists = await storageProvider.objectExists({ key });

      if (!exists) {
        missingChunks.push({ chunkId, key });
        continue;
      }
      if (storageProvider.resolveLocalPath) {
        const filePath = storageProvider.resolveLocalPath(key);
        files.push(filePath);
        chunkEntries.push({
          chunkId,
          filePath,
          prompt: promptById.get(chunkId) || null,
        });
        continue;
      }
      const localPath = path.join(tempDir, `${chunkId}.wav`);
      await storageProvider.downloadToFile({ key, filePath: localPath });
      files.push(localPath);
      chunkEntries.push({
        chunkId,
        filePath: localPath,
        prompt: promptById.get(chunkId) || null,
      });
    }

    if (missingChunks.length > 0) {
      console.warn("[Enrollment:resolve] Missing chunks:", {
        sessionId: session.id,
        missing: missingChunks.map((c) => c.chunkId),
      });
    }

    return { files, chunkEntries, tempDir, missingChunks };
  }

  async function ensureShareHls({ share, track, trackVersion }) {
    const hasLocalTrackContext = Boolean(
      track?.user_id &&
      track?.id &&
      trackVersion?.version_num != null &&
      (appConfig.STORAGE_DIR || config.STORAGE_DIR),
    );
    if (!hasLocalTrackContext) {
      return null;
    }
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
        console.error(
          `[ensureShareHls] HLS creation failed for share ${share.id}:`,
          err.message,
        );
        return null;
      }
    }
    return { playlistPath, hlsDir };
  }

  function shareVideoKeyForTrackVersion(track, trackVersion) {
    // New filename ("share-teaser.mp4") so the ~600 existing cached share.mp4
    // files (full-length) regenerate as the preview-only 15s teaser.
    return `${trackVersionKey({
      userId: track.user_id,
      trackId: track.id,
      versionNum: trackVersion.version_num,
    })}/share-teaser.mp4`;
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
      console.error(
        `[ensureLocalFileFromStorage] Failed for key ${key}:`,
        err.message,
      );
      return false;
    }
  }

  async function isShareMp4Ready({ track, trackVersion }) {
    const versionDir = getVersionDir(track, trackVersion);
    const mp4Path = path.join(versionDir, "share-teaser.mp4");
    if (fs.existsSync(mp4Path)) {
      return true;
    }
    if (storageProvider.type === "local") {
      return false;
    }
    try {
      return await storageProvider.objectExists({
        key: shareVideoKeyForTrackVersion(track, trackVersion),
      });
    } catch (err) {
      console.error(
        `[isShareMp4Ready] Failed to check storage existence for track ${track?.id || "unknown"}:`,
        err.message,
      );
      return false;
    }
  }

  async function ensureShareMp4({ track, trackVersion }) {
    const versionDir = getVersionDir(track, trackVersion);
    const mp4Path = path.join(versionDir, "share-teaser.mp4");
    const shareVideoKey = shareVideoKeyForTrackVersion(track, trackVersion);
    if (fs.existsSync(mp4Path)) {
      return mp4Path;
    }
    // If this server instance was restarted, recover the pre-generated teaser
    // from object storage.
    if (storageProvider.type !== "local") {
      const downloaded = await ensureLocalFileFromStorage({
        key: shareVideoKey,
        localPath: mp4Path,
      });
      if (downloaded) {
        return mp4Path;
      }
    }

    // Teaser-only: the share video is sourced exclusively from the preview —
    // the full master is never embedded in a publicly-served unfurl video.
    let { audioPath } = resolveShareVideoAudio({ versionDir });

    if (!audioPath && storageProvider.type !== "local") {
      const previewKey = trackPreviewKey({
        userId: track.user_id,
        trackId: track.id,
        versionNum: trackVersion.version_num,
      });
      await ensureLocalFileFromStorage({
        key: previewKey,
        localPath: path.join(versionDir, "preview.m4a"),
      });
      ({ audioPath } = resolveShareVideoAudio({ versionDir }));
    }

    if (!audioPath) {
      // No preview → no unfurl video. Routes fall through to 404.
      return null;
    }

    // Prefer per-song occasion artwork (track-level), fall back to the legacy
    // version-level gradient cover, then to the default OG asset. Mirrors the
    // OG /share/:shareId/cover.jpg precedence so unfurl previews and the
    // share MP4 thumbnail show the same image.
    //
    // On fresh containers (Railway redeploy) neither file exists locally —
    // we must try BOTH S3 keys, not just the legacy cover. Hydrating only
    // cover_1024.jpg silently downgrades paid-tier per-song artwork to the
    // generic fallback in the share-MP4 thumbnail.
    const storageRoot =
      process.env.STORAGE_ROOT || path.resolve(process.cwd(), "storage");
    const artworkKey = trackArtworkKey({
      userId: track.user_id,
      trackId: track.id,
    });
    const trackArtworkPath = path.join(storageRoot, artworkKey);
    const legacyCoverPath = path.join(versionDir, "cover_1024.jpg");
    const fallbackArtwork = path.join(
      process.cwd(),
      "public",
      "assets",
      "og-song.png",
    );
    if (!fs.existsSync(trackArtworkPath) && storageProvider.type !== "local") {
      await ensureLocalFileFromStorage({
        key: artworkKey,
        localPath: trackArtworkPath,
      });
    }
    if (
      !fs.existsSync(trackArtworkPath) &&
      !fs.existsSync(legacyCoverPath) &&
      storageProvider.type !== "local"
    ) {
      const coverKey = `${trackVersionKey({
        userId: track.user_id,
        trackId: track.id,
        versionNum: trackVersion.version_num,
      })}/cover_1024.jpg`;
      await ensureLocalFileFromStorage({
        key: coverKey,
        localPath: legacyCoverPath,
      });
    }

    const resolvedArtwork = fs.existsSync(trackArtworkPath)
      ? trackArtworkPath
      : fs.existsSync(legacyCoverPath)
        ? legacyCoverPath
        : fallbackArtwork;
    if (!fs.existsSync(resolvedArtwork)) {
      return null;
    }
    try {
      await generateShareMp4({
        artworkPath: resolvedArtwork,
        audioPath,
        outputPath: mp4Path,
        songTitle: track.title,
        recipientName: track.recipient_name,
        occasion: track.occasion,
        maxDuration: SHARE_TEASER_MAX_SECONDS,
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
            uploadErr.message,
          );
        }
      }
      return mp4Path;
    } catch (err) {
      console.error(
        `[ensureShareMp4] MP4 generation failed for track ${track.id}:`,
        err.message,
      );
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
      await db
        .prepare(
          `INSERT INTO rate_limits (user_id, action_type, window_start_ms, window_seconds, count, limit_count)
         VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT(user_id, action_type, window_start_ms)
         DO UPDATE SET count = rate_limits.count + 1`,
        )
        .run(userId, actionKey, currentWindowStart, windowSeconds, limit);

      // Step 2: Read back current and previous window counts post-increment.
      const currentWindow = await db
        .prepare(
          "SELECT count FROM rate_limits WHERE user_id = ? AND action_type = ? AND window_start_ms = ?",
        )
        .get(userId, actionKey, currentWindowStart);
      const previousWindow = await db
        .prepare(
          "SELECT count FROM rate_limits WHERE user_id = ? AND action_type = ? AND window_start_ms = ?",
        )
        .get(userId, actionKey, previousWindowStart);

      const currentCount = currentWindow?.count || 0;
      const previousCount = previousWindow?.count || 0;

      // Sliding window approximation: weight previous window by remaining time
      const weightedCount = currentCount + previousCount * (1 - windowProgress);

      // Step 3: If over limit, roll back the increment and deny.
      if (weightedCount > limit) {
        await db
          .prepare(
            `UPDATE rate_limits
           SET count = CASE
             WHEN count > 0 THEN count - 1
             ELSE 0
           END
           WHERE user_id = ? AND action_type = ? AND window_start_ms = ?`,
          )
          .run(userId, actionKey, currentWindowStart);
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
    await db
      .prepare("UPDATE users SET risk_level = ? WHERE id = ?")
      .run(level, userId);
  }

  async function addAuditEntry({
    userId,
    action,
    resourceType,
    resourceId,
    metadata,
  }) {
    await db
      .prepare(
        "INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        newUuid(),
        userId || null,
        action,
        resourceType || null,
        resourceId || null,
        toJson(metadata),
        nowIso(),
      );
  }

  async function addShareAccessLog({ shareTokenId, eventType, metadata }) {
    await db
      .prepare(
        "INSERT INTO share_access_log (id, share_token_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(newUuid(), shareTokenId, eventType, toJson(metadata), nowIso());
  }

  const giftOpsMonitor = createGiftOpsMonitor({
    db,
    logger: app.log,
    redactGiftContacts,
    upsertGiftIncident,
    resolveGiftIncident,
  });
  const logGiftLifecycle = giftOpsMonitor.logGiftLifecycle;
  const createGiftIncident = giftOpsMonitor.recordGiftIncident;
  const clearGiftIncident = giftOpsMonitor.clearGiftIncident;

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
    return (
      message.includes("UNIQUE") || message.toLowerCase().includes("duplicate")
    );
  }

  async function ensureGiftWalletRow(userId) {
    const now = nowIso();
    await db
      .prepare(
        `INSERT INTO gift_wallet (user_id, balance, updated_at)
       VALUES (?, 0, ?)
       ON CONFLICT(user_id) DO NOTHING`,
      )
      .run(userId, now);

    const wallet = await db
      .prepare(
        "SELECT user_id, balance, updated_at FROM gift_wallet WHERE user_id = ?",
      )
      .get(userId);
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
        [userId, timestamp],
      );

      if (idempotencyKey) {
        const existingResult = await query(
          `SELECT id, balance_after
           FROM gift_wallet_transactions
           WHERE user_id = ? AND idempotency_key = ?
           ORDER BY created_at DESC
           LIMIT 1`,
          [userId, idempotencyKey],
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
          [
            numAmount,
            timestamp,
            userId,
            numAmount,
            numAmount,
            MAX_WALLET_BALANCE,
          ],
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
          [
            numAmount,
            timestamp,
            userId,
            numAmount,
            numAmount,
            MAX_WALLET_BALANCE,
          ],
        );
        if (!updatedResult?.rowCount) {
          const err = new Error("INSUFFICIENT_GIFT_TOKENS");
          err.code = "INSUFFICIENT_GIFT_TOKENS";
          throw err;
        }
        const walletResult = await query(
          "SELECT balance FROM gift_wallet WHERE user_id = ?",
          [userId],
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
          ],
        );
      } catch (err) {
        if (idempotencyKey && isUniqueConstraintError(err)) {
          // Another request committed the same idempotency key after our pre-check.
          // Revert this request's balance mutation before returning the existing tx.
          const revertResult = await query(
            "UPDATE gift_wallet SET balance = balance - ?, updated_at = ? WHERE user_id = ? AND balance >= ?",
            [numAmount, timestamp, userId, numAmount],
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
            [userId, idempotencyKey],
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
    const rows = await db
      .prepare(
        `SELECT id, type, amount, balance_before, balance_after, source, reference_type, reference_id, description, metadata_json, created_at
       FROM gift_wallet_transactions
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      )
      .all(userId, Math.max(1, Math.min(Number(limit) || 20, 100)));

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

  async function ensureTrackGiftShareToken({
    trackId,
    senderUserId,
    giftOrderId,
    versionNum = null,
    sendAtIso,
    expiresInDays = 30,
    requireAppClaim = true,
    externalQuery = null,
  }) {
    const query = externalQuery || db.query.bind(db);
    const trackResult = await query("SELECT * FROM tracks WHERE id = ?", [
      trackId,
    ]);
    const track = trackResult?.rows?.[0] || null;
    if (!track || track.user_id !== senderUserId || track.deleted_at) {
      const err = new Error("TRACK_NOT_FOUND");
      err.code = "TRACK_NOT_FOUND";
      throw err;
    }

    const resolvedVersionNum = Number(versionNum || track.latest_version || 1);
    const trackVersionResult = await query(
      "SELECT * FROM track_versions WHERE track_id = ? AND version_num = ?",
      [track.id, resolvedVersionNum],
    );
    const trackVersion = trackVersionResult?.rows?.[0] || null;
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
      new Date(sendAtIso).getTime() + expiresInDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const claimPin = String(crypto.randomInt(100000, 1000000));
    const streamKeyId = newUuid();
    const streamKey = crypto.randomBytes(16).toString("base64");

    const shareId = newShareId();

    await query(
      `INSERT INTO share_tokens (
        id, track_id, track_version_id, creator_id, status,
        bound_device_id, bound_device_platform, bound_app_version, bound_at,
        web_stream_allowed, app_save_allowed, expires_at, created_at, last_accessed_at, access_count,
        stream_key_id, stream_key, claim_pin, claim_attempts,
        utm_source, utm_medium, utm_campaign, referrer, created_ip, created_user_agent,
        delivery_source, gift_order_id, claim_policy, dispatch_at, dispatched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        shareId,
        track.id,
        trackVersion.id,
        senderUserId,
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
        null,
      ],
    );
    return {
      shareId,
      shareUrl: buildGiftShareUrl(shareId),
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
    externalQuery = null,
  }) {
    const query = externalQuery || db.query.bind(db);
    const poemResult = await query(
      "SELECT * FROM poems WHERE id = ? AND deleted_at IS NULL",
      [poemId],
    );
    const poem = poemResult?.rows?.[0] || null;
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
      new Date(sendAtIso).getTime() + expiresInDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const claimPin = String(crypto.randomInt(100000, 1000000));

    const shareId = newShareId();

    await query(
      `INSERT INTO poem_share_tokens (
        id, poem_id, creator_id, status, bound_device_id, bound_user_id, bound_at,
        claim_pin, claim_attempts, allow_save, expires_at, created_at, last_accessed_at, access_count,
        utm_source, utm_medium, utm_campaign, referrer, created_ip, created_user_agent,
        delivery_source, gift_order_id, claim_policy, dispatch_at, dispatched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
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
        null,
      ],
    );
    return {
      shareId,
      shareUrl: buildGiftShareUrl(shareId),
      claimPin,
      expiresAt,
    };
  }

  function renderGiftSummary(giftRow) {
    const contentSnapshot = giftRow.content_snapshot_json
      ? parseJson(
          giftRow.content_snapshot_json,
          null,
          `gift_${giftRow.id}_content_snapshot`,
        )
      : null;
    const contentTitle =
      giftRow.content_title ||
      (contentSnapshot && typeof contentSnapshot.title === "string"
        ? contentSnapshot.title
        : null);
    const recipientName =
      giftRow.recipient_name ||
      (contentSnapshot && typeof contentSnapshot.recipient_name === "string"
        ? contentSnapshot.recipient_name
        : null);

    const status = String(giftRow.status || "").toLowerCase();
    const dispatchStatus = String(giftRow.dispatch_status || "").toLowerCase();
    const deliveryLocked =
      dispatchStatus.startsWith("partial") ||
      status === "dispatching" ||
      status === "dispatched";

    return {
      id: giftRow.id,
      sender_user_id: giftRow.sender_user_id,
      content_type: giftRow.content_type,
      content_id: giftRow.content_id,
      content_title: contentTitle,
      recipient_name: recipientName,
      sender_display_name: giftRow.sender_display_name || null,
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
      can_edit:
        !deliveryLocked &&
        (status === "scheduled" || status === "dispatch_retry"),
      can_cancel:
        !deliveryLocked &&
        (status === "scheduled" || status === "dispatch_retry"),
    };
  }

  async function createGiftDeliveryOutboxRows({
    giftOrderId,
    channels,
    recipientPhone,
    recipientEmail,
    sendAtIso,
    baselineAttemptCount = 0,
    nextRetryAt = null,
    externalQuery = null,
  }) {
    const query = externalQuery || db.query.bind(db);
    const timestamp = nowIso();

    for (const channel of channels) {
      const recipient = channel === "sms" ? recipientPhone : recipientEmail;
      if (!recipient) continue;
      const providerName = channel === "sms" ? "twilio" : "resend";

      await query(
        `INSERT INTO gift_delivery_outbox (
          id, gift_order_id, channel, recipient, status, attempt_count,
          provider_message_id, last_error, send_after, next_retry_at, last_attempt_at, locked_at,
          payload_json, created_at, updated_at, provider_name, first_queued_at, first_attempt_started_at,
          provider_accepted_at, receipt_status, receipt_event_at, receipt_updated_at, receipt_payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newUuid(),
          giftOrderId,
          channel,
          recipient,
          "pending",
          Math.max(0, Number(baselineAttemptCount || 0)),
          null,
          null,
          sendAtIso,
          nextRetryAt || sendAtIso,
          null,
          null,
          toJson({}),
          timestamp,
          timestamp,
          providerName,
          timestamp,
          null,
          null,
          null,
          null,
          null,
          null,
        ],
      );
    }
  }

  async function ensureGiftDeliveryOutboxRows(gift, externalQuery = null) {
    const query = externalQuery || db.query.bind(db);
    const existingResult = await query(
      "SELECT id FROM gift_delivery_outbox WHERE gift_order_id = ? LIMIT 1",
      [gift.id],
    );
    if ((existingResult?.rows || []).length > 0) {
      return;
    }

    const channels = parseGiftChannelsJson(gift.channels_json);
    if (!channels.length) {
      const err = new Error("GIFT_DELIVERY_CONFIG_INVALID");
      err.code = "GIFT_DELIVERY_CONFIG_INVALID";
      throw err;
    }

    await createGiftDeliveryOutboxRows({
      giftOrderId: gift.id,
      channels,
      recipientPhone: gift.recipient_phone,
      recipientEmail: gift.recipient_email,
      sendAtIso: gift.send_at,
      baselineAttemptCount: Number(gift.dispatch_attempts || 0),
      nextRetryAt: gift.next_retry_at || gift.send_at,
      externalQuery: query,
    });
  }

  function buildGiftSenderLabel(senderUser, giftRow) {
    const frozen =
      typeof giftRow?.sender_display_name === "string"
        ? giftRow.sender_display_name.trim()
        : "";
    if (frozen) return frozen;

    const displayName =
      typeof senderUser?.display_name === "string"
        ? senderUser.display_name.trim()
        : "";
    if (displayName) return displayName;

    const emailLocal =
      typeof senderUser?.email === "string"
        ? senderUser.email.split("@")[0]?.trim()
        : "";
    if (emailLocal) return emailLocal;

    return "A friend";
  }

  async function recordGiftDispatchAttempt({
    giftId,
    channel,
    status,
    providerMessageId = null,
    errorMessage = null,
    payload = {},
    createdAt,
  }) {
    await db
      .prepare(
        `INSERT INTO gift_dispatch_attempts (
        id, gift_order_id, channel, status, provider_message_id, error_message, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newUuid(),
        giftId,
        channel,
        status,
        providerMessageId,
        errorMessage,
        toJson(payload),
        createdAt,
      );
  }

  async function markGiftDeliverySent({
    deliveryId,
    providerMessageId,
    payloadMeta,
    sentAt,
  }) {
    await db
      .prepare(
        `UPDATE gift_delivery_outbox
       SET status = 'sent',
           attempt_count = attempt_count + 1,
           provider_message_id = ?,
           last_error = NULL,
           next_retry_at = NULL,
           last_attempt_at = ?,
           provider_accepted_at = COALESCE(provider_accepted_at, ?),
           receipt_status = COALESCE(receipt_status, 'accepted'),
           receipt_event_at = COALESCE(receipt_event_at, ?),
           receipt_updated_at = ?,
           receipt_payload_json = ?,
           locked_at = NULL,
           payload_json = ?,
           updated_at = ?
       WHERE id = ?`,
      )
      .run(
        providerMessageId,
        sentAt,
        sentAt,
        sentAt,
        sentAt,
        toJson(payloadMeta),
        toJson(payloadMeta),
        sentAt,
        deliveryId,
      );
  }

  async function markGiftDeliveryFailed({
    deliveryId,
    attemptCount,
    errorMessage,
    nextRetryAt,
    failedAt,
  }) {
    await db
      .prepare(
        `UPDATE gift_delivery_outbox
       SET status = 'failed',
           attempt_count = ?,
           last_error = ?,
           next_retry_at = ?,
           last_attempt_at = ?,
           receipt_updated_at = ?,
           locked_at = NULL,
           updated_at = ?
       WHERE id = ?`,
      )
      .run(
        attemptCount,
        String(errorMessage || "").slice(0, 500),
        nextRetryAt,
        failedAt,
        failedAt,
        failedAt,
        deliveryId,
      );
  }

  async function applyGiftDeliveryReceipt({
    providerName,
    providerMessageId,
    receiptStatus,
    receiptEventAt,
    receiptPayload = {},
    incidentSummary = null,
  }) {
    if (!providerMessageId) {
      await createGiftIncident({
        incidentKey: `gift_unknown_receipt:${providerName}:${crypto.createHash("sha1").update(toJson(receiptPayload)).digest("hex")}`,
        incidentType: "gift_unknown_receipt",
        severity: "warning",
        resourceType: "gift_receipt",
        resourceId: providerName,
        summary:
          incidentSummary ||
          "Gift delivery receipt could not be matched to an outbox row",
        detail: `Unknown provider message id for ${providerName}`,
        metadata: { provider_name: providerName },
      });
      return { updated: false, reason: "missing_provider_message_id" };
    }

    const delivery = await db
      .prepare(
        `SELECT gdo.*, go.id as gift_id, go.status as gift_status
       FROM gift_delivery_outbox gdo
       JOIN gift_orders go ON go.id = gdo.gift_order_id
       WHERE gdo.provider_message_id = ?
       ORDER BY gdo.updated_at DESC
       LIMIT 1`,
      )
      .get(providerMessageId);

    if (!delivery) {
      await createGiftIncident({
        incidentKey: `gift_unknown_receipt:${providerName}:${providerMessageId}`,
        incidentType: "gift_unknown_receipt",
        severity: "warning",
        resourceType: "gift_receipt",
        resourceId: providerMessageId,
        summary:
          incidentSummary ||
          "Gift delivery receipt could not be matched to an outbox row",
        detail: `No outbox row matched provider message id ${providerMessageId}`,
        metadata: {
          provider_name: providerName,
          provider_message_id: providerMessageId,
        },
      });
      return { updated: false, reason: "unknown_provider_message_id" };
    }

    const nextState = chooseReceiptState({
      currentStatus: delivery.receipt_status,
      currentEventAt: delivery.receipt_event_at,
      nextStatus: receiptStatus,
      nextEventAt: receiptEventAt,
    });

    if (nextState.shouldUpdate) {
      await db
        .prepare(
          `UPDATE gift_delivery_outbox
         SET receipt_status = ?,
             receipt_event_at = ?,
             receipt_updated_at = ?,
             receipt_payload_json = ?,
             updated_at = ?
         WHERE id = ?`,
        )
        .run(
          nextState.nextStatus,
          receiptEventAt || nowIso(),
          nowIso(),
          toJson(receiptPayload),
          nowIso(),
          delivery.id,
        );
    }

    if (
      ["undelivered", "bounced", "complained", "failed"].includes(
        String(receiptStatus || "").toLowerCase(),
      )
    ) {
      await createGiftIncident({
        incidentKey: `gift_receipt_failure:${delivery.id}`,
        incidentType: "gift_receipt_failure",
        severity: "warning",
        giftOrderId: delivery.gift_id,
        outboxId: delivery.id,
        summary: `Gift ${delivery.channel} receipt reported ${receiptStatus}`,
        detail: `Provider ${providerName} reported ${receiptStatus} for delivery ${delivery.id}`,
        metadata: {
          provider_name: providerName,
          provider_message_id: providerMessageId,
          receipt_status: receiptStatus,
        },
      });
    } else if (String(receiptStatus || "").toLowerCase() === "delivered") {
      await clearGiftIncident(`gift_receipt_failure:${delivery.id}`);
    }

    if (delivery.gift_status === "cancelled") {
      await createGiftIncident({
        incidentKey: `gift_receipt_after_cancel:${delivery.id}`,
        incidentType: "gift_receipt_after_cancel",
        severity: "info",
        giftOrderId: delivery.gift_id,
        outboxId: delivery.id,
        summary: "Receipt arrived after gift cancellation",
        detail: `Provider ${providerName} sent ${receiptStatus} after cancellation`,
        metadata: {
          provider_message_id: providerMessageId,
          receipt_status: receiptStatus,
        },
      });
    }

    await updateGiftAggregateObservability(delivery.gift_id);
    return {
      updated: nextState.shouldUpdate,
      giftId: delivery.gift_id,
      outboxId: delivery.id,
    };
  }

  async function recoverStaleGiftDeliveryRows(giftId, now) {
    await db
      .prepare(
        `UPDATE gift_delivery_outbox
       SET status = 'failed',
           last_error = COALESCE(last_error, 'stale_channel_send_recovered'),
           next_retry_at = ?,
           locked_at = NULL,
           updated_at = ?
       WHERE gift_order_id = ? AND status = 'sending'`,
      )
      .run(now, now, giftId);
  }

  function summarizeGiftDeliveryRows({
    outboxRows,
    fallbackChannels,
    dispatchAttempts,
    maxAttempts,
  }) {
    const totalChannels = outboxRows.length || fallbackChannels.length;
    const sentRows = outboxRows.filter((row) => row.status === "sent");
    const retryableRows = outboxRows.filter(
      (row) =>
        row.status === "pending" ||
        (row.status === "failed" &&
          Boolean(row.next_retry_at) &&
          Number(row.attempt_count || 0) < maxAttempts),
    );
    const exhaustedRows = outboxRows.filter(
      (row) =>
        row.status === "failed" &&
        (Number(row.attempt_count || 0) >= maxAttempts || !row.next_retry_at),
    );
    const nextRetryAt =
      retryableRows
        .map((row) => row.next_retry_at || row.send_after)
        .filter(Boolean)
        .sort()[0] || null;
    const nextAttempts = Math.max(
      Number(dispatchAttempts || 0),
      ...outboxRows.map((row) => Number(row.attempt_count || 0)),
    );

    return {
      totalChannels,
      sentRows,
      retryableRows,
      exhaustedRows,
      nextRetryAt,
      nextAttempts,
      allDelivered: sentRows.length === totalChannels && totalChannels > 0,
      partiallyDelivered: sentRows.length > 0,
    };
  }

  function computeGiftDeliveryLagMs(gift, outboxRows) {
    const sendAtMs = new Date(gift.send_at).getTime();
    if (!Number.isFinite(sendAtMs)) return null;
    const firstAcceptedMs = outboxRows
      .map((row) =>
        new Date(
          row.provider_accepted_at ||
            row.last_attempt_at ||
            row.updated_at ||
            row.created_at,
        ).getTime(),
      )
      .filter(
        (value, index) =>
          outboxRows[index]?.status === "sent" && Number.isFinite(value),
      )
      .sort((a, b) => a - b)[0];
    if (!Number.isFinite(firstAcceptedMs)) return null;
    return Math.max(0, firstAcceptedMs - sendAtMs);
  }

  async function updateGiftAggregateObservability(
    giftId,
    { outboxRows = null, finalStatus = null } = {},
  ) {
    const gift = await db
      .prepare("SELECT * FROM gift_orders WHERE id = ?")
      .get(giftId);
    if (!gift) return null;

    const rows =
      outboxRows ||
      (await db
        .prepare(
          "SELECT * FROM gift_delivery_outbox WHERE gift_order_id = ? ORDER BY created_at ASC",
        )
        .all(giftId));

    const firstAttemptStartedAt =
      rows
        .map((row) => row.first_attempt_started_at)
        .filter(Boolean)
        .sort()[0] || null;
    const lastDispatchCompletedAt =
      rows
        .map((row) => row.last_attempt_at || row.updated_at)
        .filter(Boolean)
        .sort()
        .slice(-1)[0] || null;
    const lastSuccessfulDeliveryAt =
      rows
        .filter((row) => row.status === "sent")
        .map(
          (row) =>
            row.provider_accepted_at || row.last_attempt_at || row.updated_at,
        )
        .filter(Boolean)
        .sort()
        .slice(-1)[0] || null;
    const deliveryLagMs = computeGiftDeliveryLagMs(gift, rows);
    const overdueDetectedAt = [
      "scheduled",
      "dispatch_retry",
      "dispatching",
    ].includes(finalStatus || gift.status)
      ? gift.overdue_detected_at
      : null;

    await db
      .prepare(
        `UPDATE gift_orders
       SET first_dispatch_started_at = COALESCE(first_dispatch_started_at, ?),
           last_dispatch_completed_at = ?,
           last_successful_delivery_at = ?,
           delivery_lag_ms = COALESCE(?, delivery_lag_ms),
           overdue_detected_at = ?,
           updated_at = ?
       WHERE id = ?`,
      )
      .run(
        firstAttemptStartedAt,
        lastDispatchCompletedAt,
        lastSuccessfulDeliveryAt,
        deliveryLagMs,
        overdueDetectedAt,
        nowIso(),
        giftId,
      );

    return db.prepare("SELECT * FROM gift_orders WHERE id = ?").get(giftId);
  }

  async function syncGiftDeliveryShareDispatch(gift, dispatchedAt) {
    if (gift.content_type === "song") {
      await db
        .prepare(
          "UPDATE share_tokens SET dispatched_at = ?, dispatch_at = COALESCE(dispatch_at, ?), gift_order_id = COALESCE(gift_order_id, ?) WHERE id = ?",
        )
        .run(dispatchedAt, gift.send_at, gift.id, gift.share_token_id);
      return;
    }

    if (gift.content_type === "poem") {
      await db
        .prepare(
          "UPDATE poem_share_tokens SET dispatched_at = ?, dispatch_at = COALESCE(dispatch_at, ?), gift_order_id = COALESCE(gift_order_id, ?) WHERE id = ?",
        )
        .run(dispatchedAt, gift.send_at, gift.id, gift.share_token_id);
    }
  }

  async function revokeGiftDeliveryShare(gift) {
    if (gift.content_type === "song") {
      await db
        .prepare(
          "UPDATE share_tokens SET status = 'revoked', web_stream_allowed = 0, dispatched_at = NULL WHERE id = ? AND gift_order_id = ? AND delivery_source = 'gift'",
        )
        .run(gift.share_token_id, gift.id);
      return;
    }

    if (gift.content_type === "poem") {
      await db
        .prepare(
          "UPDATE poem_share_tokens SET status = 'revoked', dispatched_at = NULL WHERE id = ? AND gift_order_id = ? AND delivery_source = 'gift'",
        )
        .run(gift.share_token_id, gift.id);
    }
  }

  async function sendGiftSmsViaTwilio({ to, body, giftId, outboxId }) {
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
    if (twilioStatusCallbackBaseUrl) {
      payload.append(
        "StatusCallback",
        `${twilioStatusCallbackBaseUrl.replace(/\/$/, "")}/gifts/webhooks/twilio-status?gift_id=${encodeURIComponent(giftId)}&outbox_id=${encodeURIComponent(outboxId)}`,
      );
    }
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

  function sanitizeGiftTextField(text) {
    if (typeof text !== "string") return "";
    return text
      .replace(/[\r\n\t]/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function buildGiftDeliveryMessage({ giftRow, senderLabel }) {
    const noun = giftRow.content_type === "poem" ? "poem" : "song";
    const verb =
      giftRow.content_type === "poem" ? "Tap to read" : "Tap to listen";
    const sender = senderLabel || "A friend";
    const recipient = sanitizeGiftTextField(giftRow.recipient_name);
    const greeting = recipient ? `Hey ${recipient}, ` : "";
    const rawMessage =
      typeof giftRow.message === "string" ? giftRow.message.trim() : "";
    const safeMsgText = sanitizeGiftTextField(rawMessage);
    const note = safeMsgText
      ? `"${safeMsgText.length > 100 ? safeMsgText.slice(0, 97) + "..." : safeMsgText}"\n`
      : "";
    return `${greeting}${sender} sent you a ${noun} on Porizo.\n${note}${verb}: ${giftRow.share_url}\nPIN: ${giftRow.claim_pin}`;
  }

  function getGiftShareUrlDeliveryError(shareUrl) {
    if (!shareUrl || typeof shareUrl !== "string") {
      return "INVALID_GIFT_SHARE_URL";
    }
    try {
      const parsed = new URL(shareUrl);
      const hostname = String(parsed.hostname || "")
        .trim()
        .toLowerCase();
      if (
        !hostname ||
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1"
      ) {
        return "GIFT_SHARE_URL_NOT_PUBLIC";
      }
      return null;
    } catch {
      return "INVALID_GIFT_SHARE_URL";
    }
  }

  function isNonRetryableGiftDeliveryError(errorMessage) {
    return (
      errorMessage === "GIFT_SHARE_URL_NOT_PUBLIC" ||
      errorMessage === "INVALID_GIFT_SHARE_URL"
    );
  }

  function computeGiftRetryAt(attemptNumber) {
    const backoffMinutes = Math.min(
      60,
      Math.max(1, 2 ** Math.max(0, Number(attemptNumber || 1) - 1)),
    );
    return new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();
  }

  async function dispatchGiftById(giftId) {
    const giftSchedulingEnabled = await getFeatureFlag(
      db,
      "gift_scheduling_enabled",
    );
    if (!giftSchedulingEnabled) {
      return { skipped: true, reason: "feature_disabled" };
    }

    const dispatchStart = nowIso();
    const lock = await db
      .prepare(
        `UPDATE gift_orders
       SET status = 'dispatching', dispatch_status = 'pending', dispatch_started_at = ?, first_dispatch_started_at = COALESCE(first_dispatch_started_at, ?), updated_at = ?
       WHERE id = ? AND status IN ('scheduled', 'dispatch_retry')`,
      )
      .run(dispatchStart, dispatchStart, dispatchStart, giftId);
    if (!lock.changes) {
      return { skipped: true, reason: "not_dispatchable" };
    }

    const gift = await db
      .prepare("SELECT * FROM gift_orders WHERE id = ?")
      .get(giftId);
    if (!gift) {
      return { skipped: true, reason: "not_found" };
    }

    try {
      logGiftLifecycle("info", "dispatch_started", {
        gift_id: gift.id,
        send_at: gift.send_at,
        dispatch_status: gift.dispatch_status,
      });
      await ensureGiftDeliveryOutboxRows(gift);

      const channels = parseGiftChannelsJson(gift.channels_json);
      const senderUser = await db
        .prepare("SELECT display_name, email FROM users WHERE id = ?")
        .get(gift.sender_user_id);
      const senderLabel = buildGiftSenderLabel(senderUser, gift);
      const payloadText = buildGiftDeliveryMessage({
        giftRow: gift,
        senderLabel,
      });
      const now = nowIso();
      const errors = [];

      await recoverStaleGiftDeliveryRows(gift.id, now);

      const dueRows = await db
        .prepare(
          `SELECT *
         FROM gift_delivery_outbox
         WHERE gift_order_id = ?
           AND status IN ('pending', 'failed')
           AND COALESCE(next_retry_at, send_after) <= ?
         ORDER BY created_at ASC`,
        )
        .all(gift.id, now);

      if (!dueRows.length) {
        logGiftLifecycle("info", "dispatch_noop", {
          gift_id: gift.id,
          reason: "no_due_rows",
        });
      }

      for (const delivery of dueRows) {
        const lockResult = await db
          .prepare(
            `UPDATE gift_delivery_outbox
           SET status = 'sending',
               locked_at = ?,
               first_attempt_started_at = COALESCE(first_attempt_started_at, ?),
               updated_at = ?
           WHERE id = ? AND status IN ('pending', 'failed')`,
          )
          .run(now, now, now, delivery.id);
        if (!lockResult.changes) {
          continue;
        }

        logGiftLifecycle("info", "channel_send_started", {
          gift_id: gift.id,
          outbox_id: delivery.id,
          channel: delivery.channel,
          recipient: delivery.recipient,
          attempt_count: Number(delivery.attempt_count || 0) + 1,
        });

        try {
          let providerMessageId = null;
          let payloadMeta = {};
          const shareUrlError = getGiftShareUrlDeliveryError(gift.share_url);
          if (shareUrlError) {
            throw new Error(shareUrlError);
          }

          if (delivery.channel === "sms") {
            const smsEnabled = await getFeatureFlag(db, "gift_sms_enabled");
            if (!smsEnabled) {
              throw new Error("SMS_CHANNEL_DISABLED");
            }
            if (!delivery.recipient) {
              throw new Error("MISSING_RECIPIENT_PHONE");
            }
            const smsResult = await sendGiftSmsViaTwilio({
              to: delivery.recipient,
              body: payloadText,
              giftId: gift.id,
              outboxId: delivery.id,
            });
            providerMessageId = smsResult.providerMessageId;
            payloadMeta = { simulated: smsResult.simulated };
          } else if (delivery.channel === "email") {
            const emailEnabled = await getFeatureFlag(db, "gift_email_enabled");
            if (!emailEnabled) {
              throw new Error("EMAIL_CHANNEL_DISABLED");
            }
            if (!delivery.recipient) {
              throw new Error("MISSING_RECIPIENT_EMAIL");
            }

            let simulated = false;
            providerMessageId = "simulated_email";
            if (emailService.isConfigured()) {
              const sent = await emailService.sendGiftDeliveryEmail({
                to: delivery.recipient,
                senderName: senderLabel,
                recipientName: gift.recipient_name || "",
                shareUrl: gift.share_url,
                claimPin: gift.claim_pin,
                contentType: gift.content_type,
                contentTitle: gift.content_title || "",
                occasion: "",
                message: gift.message || "",
                tags: [
                  { name: "gift_order_id", value: gift.id },
                  { name: "gift_outbox_id", value: delivery.id },
                ],
              });
              providerMessageId = sent.messageId || providerMessageId;
            } else if (process.env.NODE_ENV === "production") {
              throw new Error("EMAIL_NOT_CONFIGURED");
            } else {
              simulated = true;
            }
            payloadMeta = { simulated };
          } else {
            throw new Error("UNKNOWN_DELIVERY_CHANNEL");
          }

          const sentAt = nowIso();
          await recordGiftDispatchAttempt({
            giftId: gift.id,
            channel: delivery.channel,
            status: "success",
            providerMessageId,
            payload: payloadMeta,
            createdAt: sentAt,
          });

          await markGiftDeliverySent({
            deliveryId: delivery.id,
            providerMessageId,
            payloadMeta,
            sentAt,
          });

          await clearGiftIncident(`gift_channel_failure:${delivery.id}`);
          logGiftLifecycle("info", "channel_send_accepted", {
            gift_id: gift.id,
            outbox_id: delivery.id,
            channel: delivery.channel,
            provider_message_id: providerMessageId,
          });
        } catch (err) {
          const failedAt = nowIso();
          const nextAttemptCount = Number(delivery.attempt_count || 0) + 1;
          const errorMessage = String(err.message || err);
          const nextRetryAt = isNonRetryableGiftDeliveryError(errorMessage)
            ? null
            : nextAttemptCount >= giftDispatchMaxAttempts
              ? null
              : computeGiftRetryAt(nextAttemptCount);

          errors.push(`${delivery.channel}:${errorMessage}`);

          await recordGiftDispatchAttempt({
            giftId: gift.id,
            channel: delivery.channel,
            status: "failed",
            errorMessage,
            createdAt: failedAt,
          });

          await markGiftDeliveryFailed({
            deliveryId: delivery.id,
            attemptCount: nextAttemptCount,
            errorMessage,
            nextRetryAt,
            failedAt,
          });

          await createGiftIncident({
            incidentKey: `gift_channel_failure:${delivery.id}`,
            incidentType: "channel_delivery_failed",
            severity: nextRetryAt ? "warning" : "critical",
            giftOrderId: gift.id,
            outboxId: delivery.id,
            summary: `Gift ${delivery.channel} delivery failed`,
            detail: errorMessage,
            metadata: {
              channel: delivery.channel,
              attempt_count: nextAttemptCount,
              next_retry_at: nextRetryAt,
              provider_name:
                delivery.provider_name ||
                (delivery.channel === "sms" ? "twilio" : "resend"),
            },
          });
          logGiftLifecycle("warn", "channel_send_failed", {
            gift_id: gift.id,
            outbox_id: delivery.id,
            channel: delivery.channel,
            attempt_count: nextAttemptCount,
            next_retry_at: nextRetryAt,
            error: errorMessage,
          });
        }
      }

      const outboxRows = await db
        .prepare(
          `SELECT *
         FROM gift_delivery_outbox
         WHERE gift_order_id = ?
         ORDER BY created_at ASC`,
        )
        .all(gift.id);

      const {
        sentRows,
        retryableRows,
        exhaustedRows,
        nextRetryAt,
        nextAttempts,
        allDelivered,
        partiallyDelivered,
      } = summarizeGiftDeliveryRows({
        outboxRows,
        fallbackChannels: channels,
        dispatchAttempts: gift.dispatch_attempts,
        maxAttempts: giftDispatchMaxAttempts,
      });

      if (allDelivered) {
        const dispatchedAt = nowIso();
        await db
          .prepare(
            `UPDATE gift_orders
           SET status = 'dispatched',
               dispatch_status = 'sent',
               dispatch_attempts = ?,
               last_dispatch_error = NULL,
               next_retry_at = NULL,
               dispatch_started_at = NULL,
               last_dispatch_completed_at = ?,
               last_successful_delivery_at = ?,
               delivery_lag_ms = COALESCE(?, delivery_lag_ms),
               overdue_detected_at = NULL,
               dispatched_at = ?,
               updated_at = ?
           WHERE id = ?`,
          )
          .run(
            nextAttempts,
            dispatchedAt,
            dispatchedAt,
            computeGiftDeliveryLagMs(gift, outboxRows),
            dispatchedAt,
            dispatchedAt,
            gift.id,
          );

        await syncGiftDeliveryShareDispatch(gift, dispatchedAt);
        await resolveGiftIncidentsForGift(db, gift.id, [
          "channel_delivery_failed",
          "gift_overdue",
          "gift_dispatch_stalled",
          "gift_unknown_receipt",
        ]);

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
        logGiftLifecycle("info", "dispatch_completed", {
          gift_id: gift.id,
          channels,
          dispatch_lag_ms: computeGiftDeliveryLagMs(gift, outboxRows),
        });
        return { dispatched: true };
      }

      const exhausted =
        !partiallyDelivered &&
        retryableRows.length === 0 &&
        exhaustedRows.length > 0;
      const partialComplete = partiallyDelivered && retryableRows.length === 0;

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
          app.log.error(
            { giftId: gift.id, err: refundErr },
            "Failed to auto-refund gift token",
          );
        }

        await revokeGiftDeliveryShare(gift);
        await createGiftIncident({
          incidentKey: `gift_delivery_exhausted:${gift.id}`,
          incidentType: "gift_delivery_exhausted",
          severity: "critical",
          giftOrderId: gift.id,
          summary: "Gift delivery exhausted all retries",
          detail: errors.join("; ") || "Gift delivery exhausted all retries.",
          metadata: {
            attempts: nextAttempts,
            sent_channels: sentRows.map((row) => row.channel),
          },
        });
      }

      await db
        .prepare(
          `UPDATE gift_orders
         SET status = ?,
             dispatch_status = ?,
             dispatch_attempts = ?,
             last_dispatch_error = ?,
             next_retry_at = ?,
             dispatch_started_at = NULL,
             last_dispatch_completed_at = ?,
             last_successful_delivery_at = CASE WHEN ? THEN COALESCE(last_successful_delivery_at, ?) ELSE last_successful_delivery_at END,
             delivery_lag_ms = COALESCE(?, delivery_lag_ms),
             overdue_detected_at = CASE WHEN ? THEN NULL ELSE overdue_detected_at END,
             dispatched_at = CASE WHEN ? THEN COALESCE(dispatched_at, ?) ELSE dispatched_at END,
             refund_transaction_id = COALESCE(?, refund_transaction_id),
             updated_at = ?
         WHERE id = ?`,
        )
        .run(
          exhausted
            ? "failed"
            : partialComplete
              ? "dispatched"
              : "dispatch_retry",
          exhausted
            ? "failed"
            : partialComplete
              ? "partial"
              : partiallyDelivered
                ? "partial_retry"
                : "retrying",
          nextAttempts,
          errors.join("; ") || null,
          exhausted || partialComplete ? null : nextRetryAt,
          nowIso(),
          partiallyDelivered ? 1 : 0,
          partiallyDelivered ? nowIso() : null,
          computeGiftDeliveryLagMs(gift, outboxRows),
          partiallyDelivered || exhausted ? 1 : 0,
          partialComplete ? 1 : 0,
          partialComplete ? nowIso() : null,
          refundTxId,
          nowIso(),
          gift.id,
        );

      await updateGiftAggregateObservability(gift.id, {
        outboxRows,
        finalStatus: exhausted
          ? "failed"
          : partialComplete
            ? "dispatched"
            : "dispatch_retry",
      });

      await addAuditEntry({
        userId: gift.sender_user_id,
        action: exhausted
          ? "gift_dispatch_failed"
          : partialComplete
            ? "gift_partially_dispatched"
            : "gift_dispatch_retry",
        resourceType: "gift_order",
        resourceId: gift.id,
        metadata: {
          errors,
          attempts: nextAttempts,
          refund_tx_id: refundTxId,
          sent_channels: sentRows.map((row) => row.channel),
          pending_channels: retryableRows.map((row) => row.channel),
        },
      });
      eventsService.emit(
        exhausted
          ? "gift_failed"
          : partialComplete
            ? "gift_partially_dispatched"
            : "gift_retry",
        {
          userId: gift.sender_user_id,
          resourceType: "gift_order",
          resourceId: gift.id,
          metadata: {
            errors,
            attempts: nextAttempts,
            sent_channels: sentRows.map((row) => row.channel),
            pending_channels: retryableRows.map((row) => row.channel),
          },
        },
      );

      if (!exhausted && retryableRows.length > 0) {
        await createGiftIncident({
          incidentKey: `gift_retry_pending:${gift.id}`,
          incidentType: "gift_dispatch_retry",
          severity: partiallyDelivered ? "warning" : "info",
          giftOrderId: gift.id,
          summary: partiallyDelivered
            ? "Gift partially delivered and is waiting to retry remaining channels"
            : "Gift delivery scheduled for retry",
          detail: errors.join("; ") || null,
          metadata: {
            sent_channels: sentRows.map((row) => row.channel),
            pending_channels: retryableRows.map((row) => row.channel),
            next_retry_at: nextRetryAt,
          },
        });
      } else {
        await clearGiftIncident(`gift_retry_pending:${gift.id}`);
      }

      logGiftLifecycle(
        exhausted ? "error" : "warn",
        exhausted
          ? "dispatch_exhausted"
          : partialComplete
            ? "dispatch_partial_complete"
            : "dispatch_retry_scheduled",
        {
          gift_id: gift.id,
          attempts: nextAttempts,
          errors,
          next_retry_at: nextRetryAt,
          sent_channels: sentRows.map((row) => row.channel),
          pending_channels: retryableRows.map((row) => row.channel),
        },
      );

      return { dispatched: false, partial: partialComplete, errors };
    } catch (dispatchErr) {
      // Recover from stuck 'dispatching' state — increment attempts to respect max limit
      const retryAt = computeGiftRetryAt(
        Number(gift?.dispatch_attempts || 0) + 1,
      );
      await db
        .prepare(
          `UPDATE gift_orders
         SET status = 'dispatch_retry',
             dispatch_status = 'error',
             dispatch_attempts = dispatch_attempts + 1,
             next_retry_at = ?,
             last_dispatch_error = ?,
             dispatch_started_at = NULL,
             last_dispatch_completed_at = ?,
             updated_at = ?
         WHERE id = ? AND status = 'dispatching'`,
        )
        .run(
          retryAt,
          String(dispatchErr.message || dispatchErr).slice(0, 500),
          nowIso(),
          nowIso(),
          giftId,
        );
      await createGiftIncident({
        incidentKey: `gift_dispatch_stalled:${giftId}`,
        incidentType: "gift_dispatch_stalled",
        severity: "critical",
        giftOrderId: giftId,
        summary: "Gift dispatch crashed and was moved back to retry",
        detail: String(dispatchErr.message || dispatchErr),
        metadata: { next_retry_at: retryAt },
      });
      logGiftLifecycle("error", "dispatch_crashed", {
        gift_id: giftId,
        next_retry_at: retryAt,
        error: String(dispatchErr.message || dispatchErr),
      });
      throw dispatchErr;
    }
  }

  app.decorate("dispatchGiftById", dispatchGiftById);

  app.post("/gifts/webhooks/twilio-status", async (request, reply) => {
    const authToken =
      process.env.TWILIO_AUTH_TOKEN ||
      appConfig.TWILIO_AUTH_TOKEN ||
      config.TWILIO_AUTH_TOKEN;
    const signature = request.headers["x-twilio-signature"];
    if (!authToken || !signature) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }

    const webhookUrl = `${twilioStatusCallbackBaseUrl.replace(/\/$/, "")}${request.raw.url}`;
    const isValid = twilio.validateRequest(
      authToken,
      String(signature),
      webhookUrl,
      request.body || {},
    );
    if (!isValid) {
      reply.code(401).send({ error: "INVALID_SIGNATURE" });
      return;
    }

    const normalized = normalizeTwilioReceipt(request.body || {});
    const result = await applyGiftDeliveryReceipt({
      providerName: normalized.providerName,
      providerMessageId: normalized.providerMessageId,
      receiptStatus: normalized.receiptStatus,
      receiptEventAt: normalized.receiptEventAt,
      receiptPayload: normalized.metadata,
      incidentSummary:
        "Twilio delivery receipt could not be matched to a gift outbox row",
    });

    logGiftLifecycle("info", "twilio_receipt_processed", {
      provider_message_id: normalized.providerMessageId,
      receipt_status: normalized.receiptStatus,
      updated: result.updated,
      gift_id: result.giftId || null,
      outbox_id: result.outboxId || null,
    });
    reply.send({ received: true, updated: result.updated });
  });

  app.post(
    "/gifts/webhooks/resend-events",
    {
      preParsing: async (request, _reply, payload) => {
        // Capture raw body for Svix signature verification before Fastify parses it
        const chunks = [];
        for await (const chunk of payload) {
          chunks.push(chunk);
        }
        request.rawBody = Buffer.concat(chunks).toString("utf-8");
        const { Readable } = require("stream");
        return Readable.from([request.rawBody]);
      },
    },
    async (request, reply) => {
      const webhookSecret =
        process.env.RESEND_WEBHOOK_SECRET ||
        appConfig.RESEND_WEBHOOK_SECRET ||
        config.RESEND_WEBHOOK_SECRET;
      if (!webhookSecret) {
        reply.code(404).send({ error: "NOT_CONFIGURED" });
        return;
      }

      const headers = {
        id: request.headers["svix-id"],
        timestamp: request.headers["svix-timestamp"],
        signature: request.headers["svix-signature"],
      };
      if (!headers.id || !headers.timestamp || !headers.signature) {
        reply.code(401).send({ error: "INVALID_SIGNATURE" });
        return;
      }

      let verifiedPayload;
      try {
        const resend = new Resend(
          process.env.RESEND_API_KEY ||
            appConfig.RESEND_API_KEY ||
            config.RESEND_API_KEY ||
            "re_test",
        );
        verifiedPayload = resend.webhooks.verify({
          payload:
            request.rawBody ||
            (typeof request.body === "string"
              ? request.body
              : JSON.stringify(request.body || {})),
          headers,
          webhookSecret,
        });
      } catch (err) {
        reply
          .code(401)
          .send({ error: "INVALID_SIGNATURE", message: err.message });
        return;
      }

      const normalized = normalizeResendReceipt(verifiedPayload || {});
      const result = await applyGiftDeliveryReceipt({
        providerName: normalized.providerName,
        providerMessageId: normalized.providerMessageId,
        receiptStatus: normalized.receiptStatus,
        receiptEventAt: normalized.receiptEventAt,
        receiptPayload: normalized.metadata,
        incidentSummary:
          "Resend delivery receipt could not be matched to a gift outbox row",
      });

      logGiftLifecycle("info", "resend_receipt_processed", {
        provider_message_id: normalized.providerMessageId,
        receipt_status: normalized.receiptStatus,
        updated: result.updated,
        gift_id: result.giftId || null,
        outbox_id: result.outboxId || null,
      });
      reply.send({ received: true, updated: result.updated });
    },
  );

  async function findTrackVersion(trackId, versionNum) {
    return db
      .prepare(
        "SELECT * FROM track_versions WHERE track_id = ? AND version_num = ?",
      )
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
    return (
      status === "failed" || status === "dead_letter" || status === "blocked"
    );
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

  function extractRenderPolicyTermsFromJob(jobRow, lyricsJson) {
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
    const terms = extractRenderPolicyTerms(...sources);

    // Fallback: when error messages yield no terms (e.g. vague "sensitive_word_error"),
    // re-scan the lyrics using the policy sanitizer to identify likely triggers
    if (terms.length === 0 && lyricsJson) {
      try {
        const lyrics =
          typeof lyricsJson === "string" ? JSON.parse(lyricsJson) : lyricsJson;
        const provider = resolveProviderFromErrorCode(jobRow.error_code);
        const { violations } = scanLyricsForProviderPolicy({
          lyrics,
          provider,
        });
        if (violations.length > 0) {
          const sorted = violations.sort(
            (a, b) =>
              (a.severity === "hard" ? 0 : 1) - (b.severity === "hard" ? 0 : 1),
          );
          const rescanTerms = [...new Set(sorted.map((v) => v.term))].slice(
            0,
            8,
          );
          return [
            ...new Set(rescanTerms.flatMap((t) => expandPolicyTermVariants(t))),
          ];
        }
      } catch (err) {
        console.warn(
          "[extractRenderPolicyTermsFromJob] lyrics rescan failed for job",
          jobRow?.id,
          err?.message,
        );
      }
    }

    return terms;
  }

  function resolveProviderFromErrorCode(errorCode) {
    if (!errorCode) return "suno";
    if (errorCode.startsWith("E301")) return "elevenlabs";
    return "suno";
  }

  async function findLatestFailedJobForVersion(trackVersionId, workflowType) {
    return db
      .prepare(
        `SELECT * FROM jobs
         WHERE track_version_id = ? AND workflow_type = ? AND status IN ('failed', 'dead_letter', 'blocked')
         ORDER BY COALESCE(completed_at, updated_at) DESC
         LIMIT 1`,
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

    if (
      !message &&
      (code === "E302_SUNO_ERROR" || code === "E302_SUNO_INCOMPLETE_OUTPUT")
    ) {
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

  const { classifyError } = require("./utils/step-classification");

  // Map fine-grained categories to backward-compatible wire values.
  // Old iOS clients only recognize: policy_content, policy_validation, quality_gate,
  // provider_transient, infra_retryable, infra_terminal, entitlement_limit.
  // New categories are exposed via error_subcategory for updated clients.
  const WIRE_COMPAT_MAP = {
    processing_retryable: "infra_retryable",
    processing_terminal: "infra_terminal",
    input_missing: "infra_terminal",
    provider_retryable: "infra_retryable",
    provider_terminal: "infra_terminal",
    unknown_terminal: "infra_terminal",
  };

  function classifyRenderFailure(rawMessage, rawCode, step = null) {
    const message = typeof rawMessage === "string" ? rawMessage : "";
    const code = typeof rawCode === "string" ? rawCode : "";
    const result = classifyError(message, code, step);
    const wireCategory = WIRE_COMPAT_MAP[result.category] || result.category;
    return {
      error_category: wireCategory,
      error_subcategory:
        result.category !== wireCategory ? result.category : undefined,
      can_auto_rewrite: result.canAutoRewrite,
      suggested_action: result.suggestedAction,
      provider: result.provider,
    };
  }

  async function findActiveJobForVersion(trackVersionId, workflowType) {
    return db
      .prepare(
        "SELECT * FROM jobs WHERE track_version_id = ? AND workflow_type = ? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1",
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
    await db
      .prepare(
        "UPDATE tracks SET latest_version = latest_version + 1, updated_at = ? WHERE id = ?",
      )
      .run(now, trackId);
    const track = await db
      .prepare("SELECT latest_version FROM tracks WHERE id = ?")
      .get(trackId);
    return track.latest_version;
  }

  async function getTrackVersions(track, baseUrl) {
    if (!track || !track.id) {
      return [];
    }
    const versions = await db
      .prepare(
        "SELECT * FROM track_versions WHERE track_id = ? ORDER BY version_num",
      )
      .all(track.id);

    const versionIds = versions.map((version) => version.id).filter(Boolean);
    const latestFailedJobByVersion = new Map();
    if (versionIds.length > 0) {
      // Use db.query() instead of db.prepare() to avoid plan-cache pollution from
      // variable-length IN clauses (each unique param count creates a new cached entry).
      const placeholders = versionIds.map(() => "?").join(",");
      const { rows: failedJobs } = await db.query(
        `SELECT track_version_id, error_code, error_message, step, step_data, updated_at, completed_at
         FROM jobs
         WHERE track_version_id IN (${placeholders})
           AND status IN ('failed', 'dead_letter', 'blocked')
         ORDER BY COALESCE(completed_at, updated_at) DESC`,
        versionIds,
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
        ? classifyRenderFailure(
            latestFailure?.error_message,
            latestFailure?.error_code,
            latestFailure?.step,
          )
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
          latestFailure?.error_code,
        ),
        last_error_terms: extractRenderPolicyTermsFromJob(
          latestFailure,
          version.lyrics_json,
        ),
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
    const updateResult = await db
      .prepare(
        `UPDATE track_library_entries
       SET origin = CASE WHEN origin = 'created' THEN origin ELSE ? END,
           share_token_id = COALESCE(?, share_token_id),
           added_at = CASE WHEN removed_at IS NOT NULL THEN ? ELSE added_at END,
           removed_at = NULL, updated_at = ?
       WHERE user_id = ? AND track_id = ?`,
      )
      .run(origin, shareTokenId, addedAt, now, userId, trackId);

    if (updateResult.changes > 0) {
      return;
    }

    await db
      .prepare(
        `INSERT INTO track_library_entries
       (user_id, track_id, origin, share_token_id, added_at, removed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(userId, trackId, origin, shareTokenId, addedAt, now);
  }

  async function upsertPoemLibraryEntry({
    userId,
    poemId,
    origin,
    shareTokenId = null,
    addedAt = nowIso(),
  }) {
    const now = nowIso();
    const updateResult = await db
      .prepare(
        `UPDATE poem_library_entries
       SET origin = CASE WHEN origin = 'created' THEN origin ELSE ? END,
           share_token_id = COALESCE(?, share_token_id),
           added_at = CASE WHEN removed_at IS NOT NULL THEN ? ELSE added_at END,
           removed_at = NULL, updated_at = ?
       WHERE user_id = ? AND poem_id = ?`,
      )
      .run(origin, shareTokenId, addedAt, now, userId, poemId);

    if (updateResult.changes > 0) {
      return;
    }

    await db
      .prepare(
        `INSERT INTO poem_library_entries
       (user_id, poem_id, origin, share_token_id, added_at, removed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(userId, poemId, origin, shareTokenId, addedAt, now);
  }

  async function getTrackForLibrary(userId, trackId) {
    return db
      .prepare(
        `SELECT t.*,
              tle.origin AS library_origin,
              tle.added_at AS library_added_at,
              tle.share_token_id AS library_share_token_id,
              st.claim_pin AS share_claim_pin,
              st.expires_at AS share_expires_at,
              st.status AS share_status,
              CASE WHEN t.user_id = ? THEN 1 ELSE 0 END AS can_edit,
              CASE WHEN t.user_id = ? THEN 1 ELSE 0 END AS can_share,
              1 AS can_delete
       FROM tracks t
       JOIN track_library_entries tle
         ON tle.track_id = t.id
        AND tle.user_id = ?
        AND tle.removed_at IS NULL
       LEFT JOIN share_tokens st
         ON st.id = t.share_token_id
        AND st.status NOT IN ('revoked', 'expired')
       WHERE t.id = ?
         AND t.deleted_at IS NULL
         AND NOT (COALESCE(t.funding_source, 'standard') = 'gift_token' AND tle.origin = 'created')`,
      )
      .get(userId, userId, userId, trackId);
  }

  async function getPoemForLibrary(userId, poemId) {
    return db
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
       WHERE p.id = ?
         AND p.deleted_at IS NULL
         AND NOT (COALESCE(p.funding_source, 'standard') = 'gift_token' AND ple.origin = 'created')`,
      )
      .get(userId, userId, userId, poemId);
  }

  async function hydrateTrackCoverImages(trackRows) {
    if (!Array.isArray(trackRows) || trackRows.length === 0) {
      return [];
    }

    const trackIds = [
      ...new Set(trackRows.map((row) => row?.id).filter(Boolean)),
    ];
    if (trackIds.length === 0) {
      return trackRows;
    }

    // Use db.query() instead of db.prepare() to avoid plan-cache pollution from
    // variable-length IN clauses (each unique param count creates a new cached entry).
    const placeholders = trackIds.map(() => "?").join(",");
    const { rows: versions } = await db.query(
      `SELECT track_id, version_num, cover_image_url, cover_image_small_url, cover_image_large_url
         FROM track_versions
        WHERE track_id IN (${placeholders})
          AND version_num = (
            SELECT MAX(tv2.version_num)
              FROM track_versions tv2
             WHERE tv2.track_id = track_versions.track_id
          )`,
      trackIds,
    );

    const byTrackVersion = new Map();
    for (const version of versions) {
      const versionNum = Number(version.version_num || 0);
      byTrackVersion.set(`${version.track_id}:${versionNum}`, version);
    }

    return trackRows.map((row) => {
      const latestVersionNum = Number(row.latest_version || 0);
      const latestVersion = byTrackVersion.get(`${row.id}:${latestVersionNum}`);

      // Re-sign artwork_url for every response so iOS AsyncImage / iMessage
      // crawlers can fetch without an Authorization header. The DB stores the
      // raw unsigned path (`/tracks/<id>/artwork.jpg?v=<ms>`); we extract the
      // cache-bust stamp and rebuild a signed URL with a fresh expiry.
      //
      // We deliberately DO NOT bind to share_token here. The route accepts a
      // bare-HMAC capability URL (sig + exp without share_token) for any
      // caller, which covers owner playback uniformly. Binding owner-context
      // URLs to share_token state means revoking the share also kills the
      // owner's own playback — the route has no fallback when the paired
      // share check fails. Share-bound URLs (long-lived iMessage / WhatsApp
      // unfurls where revocation coupling is desired) should be minted at
      // the share-page boundary, not here.
      let signedArtworkUrl = row.artwork_url ?? null;
      if (signedArtworkUrl && row.id) {
        const cacheBustMatch = String(row.artwork_url).match(/[?&]v=(\d+)/);
        try {
          signedArtworkUrl = buildSignedArtworkUrl({
            trackId: row.id,
            versionStamp: cacheBustMatch ? cacheBustMatch[1] : Date.now(),
          });
        } catch (err) {
          // Refuse to leak an unsigned URL — clients would see a guaranteed 401.
          // Better to omit so iOS falls through to the gradient placeholder.
          console.warn(
            `[hydrateTrackCoverImages] sign failed for track ${row.id}: ${err.message}; dropping artwork_url`,
          );
          signedArtworkUrl = null;
        }
      }

      return {
        ...row,
        artwork_url: signedArtworkUrl,
        cover_image_url:
          latestVersion?.cover_image_url ?? row.cover_image_url ?? null,
        cover_image_small_url:
          latestVersion?.cover_image_small_url ??
          row.cover_image_small_url ??
          null,
        cover_image_large_url:
          latestVersion?.cover_image_large_url ??
          row.cover_image_large_url ??
          null,
      };
    });
  }

  function withTrackLibraryFlags(trackRow) {
    if (!trackRow) {
      return null;
    }
    const rest = { ...trackRow };
    delete rest.story_context_json;

    // Construct share_url from share_token_id if a valid share exists
    const hasShare =
      rest.share_token_id &&
      rest.share_status &&
      rest.share_status !== "revoked" &&
      rest.share_status !== "expired";
    const result = {
      ...rest,
      can_edit: asBool(trackRow.can_edit),
      can_share: asBool(trackRow.can_share),
      can_delete: asBool(trackRow.can_delete),
      share_url: hasShare ? buildFreshPlayShareUrl(rest.share_token_id) : null,
      claim_pin:
        hasShare && asBool(trackRow.can_edit) ? rest.share_claim_pin : null,
      share_expires_at: hasShare ? rest.share_expires_at : null,
    };
    // Clean up internal join fields
    delete result.share_claim_pin;
    delete result.share_status;
    return result;
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

  async function retryFailedJob({
    trackVersionId,
    workflowType,
    userId,
    track,
    trackVersion,
    retryStepData = null,
  }) {
    // 1. Idempotent: if there's already an active job, return it
    const activeJob = await findActiveJobForVersion(
      trackVersionId,
      workflowType,
    );
    if (activeJob) {
      return { job: activeJob, created: false };
    }

    // 2. Find the failed/DLQ'd job for this track version
    const failedJob = await findLatestFailedJobForVersion(
      trackVersionId,
      workflowType,
    );
    if (!failedJob) {
      return null;
    }

    const { classifyError } = require("./utils/step-classification");
    const classification = classifyError(
      failedJob.error_message,
      failedJob.error_code,
      failedJob.step,
    );

    if (
      classification.category === "policy_content" &&
      classification.canAutoRewrite
    ) {
      const latestTrackVersion =
        (await db
          .prepare("SELECT * FROM track_versions WHERE id = ?")
          .get(trackVersionId)) || trackVersion;
      const currentLyrics = parseJson(
        latestTrackVersion?.lyrics_json,
        null,
        "retry_failed_job_lyrics",
      );
      const provider = deriveRetrySanitizerProvider({
        trackVersion: latestTrackVersion,
        classification,
      });

      if (currentLyrics && provider) {
        const readTimestamp = latestTrackVersion?.lyrics_updated_at || null;
        const sanitized = sanitizeLyricsForProviderPolicy({
          lyrics: currentLyrics,
          provider,
          recipientName: track?.recipient_name || null,
        });
        if (sanitized.blocked) {
          return {
            blocked: true,
            reason: "policy_still_blocked",
            failedJobId: failedJob.id,
          };
        }
        if (sanitized.changed) {
          const now = nowIso();
          const writeResult = await db
            .prepare(
              `UPDATE track_versions
                SET lyrics_json = ?, lyrics_updated_at = ?
              WHERE id = ?
                AND (
                  (lyrics_updated_at IS NULL AND ? IS NULL)
                  OR lyrics_updated_at = ?
                )`,
            )
            .run(
              toJson(sanitized.lyrics),
              now,
              trackVersionId,
              readTimestamp,
              readTimestamp,
            );
          if (writeResult.changes > 0) {
            await addAuditEntry({
              userId,
              action: "auto_sanitize_lyrics",
              resourceType: "track_version",
              resourceId: trackVersionId,
              metadata: {
                provider: sanitized.provider,
                change_count: sanitized.change_count,
                rewrite_passes: sanitized.rewrite_passes,
                original_lyrics_hash: lyricsHashSha256(
                  latestTrackVersion?.lyrics_json,
                ),
              },
            });
            console.log(
              `[retryFailedJob] Auto-sanitized lyrics for policy retry (${sanitized.change_count} changes, provider=${sanitized.provider})`,
            );
          } else {
            console.log(
              `[retryFailedJob] Skipped auto-sanitize write due to concurrent lyrics update (trackVersionId=${trackVersionId})`,
            );
          }
        }
      }
    }

    // 3. Clean stale files for the failed step
    const versionDir = getVersionDir(track, trackVersion);
    if (failedJob.step) {
      cleanStaleStepFiles(versionDir, failedJob.step);
    }

    // 4. Reset job: re-queue with fresh attempts (status guard prevents race condition)
    const now = nowIso();
    const resetResult = await db
      .prepare(
        "UPDATE jobs SET status = 'queued', step = 'queued', step_index = 0, attempts = 0, error_code = NULL, error_message = NULL, progress_pct = 0, completed_at = NULL, next_attempt_at = NULL, locked_by = NULL, locked_at = NULL, step_data = COALESCE(?, step_data), updated_at = ? WHERE id = ? AND status IN ('failed', 'dead_letter', 'blocked')",
      )
      .run(retryStepData, now, failedJob.id);
    if (resetResult.changes === 0) {
      // Job status changed between findLatestFailedJobForVersion and this UPDATE — race condition
      return { conflict: true };
    }

    // 5. Mark DLQ entry as reprocessed (if exists)
    await db
      .prepare(
        "UPDATE dead_letter_queue SET reprocessed_at = ?, reprocess_job_id = ? WHERE job_id = ? AND reprocessed_at IS NULL",
      )
      .run(now, failedJob.id, failedJob.id);

    // 6. Reset track_version and track status
    await db
      .prepare("UPDATE track_versions SET status = 'processing' WHERE id = ?")
      .run(trackVersionId);
    await db
      .prepare(
        "UPDATE tracks SET status = 'rendering', updated_at = ? WHERE id = ?",
      )
      .run(now, track.id);

    // 7. Audit trail
    await addAuditEntry({
      userId,
      action: "user_retry_render",
      resourceType: "job",
      resourceId: failedJob.id,
      metadata: { workflow_type: workflowType, failed_step: failedJob.step },
    });

    // 8. Return the re-queued job
    const job = await db
      .prepare("SELECT * FROM jobs WHERE id = ?")
      .get(failedJob.id);
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
    subscriptionManager,
    enableV3OrchestrationRoutes,
    orchestrationExecutorMode,
    orchestrationExternalCommandJson,
    orchestrationExternalTimeoutMs,
    storyEngineDefault,
  });

  // ============ Analytics / Attribution ============
  registerAnalyticsRoutes(app, {
    db,
    appConfig,
    requireUserId,
    sendError,
    addAuditEntry,
    eventsService,
    consumeRateLimit,
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
    // Gate behind admin auth — exposes API keys existence and provider config
    const adminOk = await requireAdminRole(request, reply);
    if (!adminOk) return;

    const healthChecker = createHealthCheckService({
      elevenlabsApiKey: process.env.ELEVENLABS_API_KEY,
      elevenlabsBaseUrl:
        process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io",
      replicateToken: process.env.REPLICATE_API_TOKEN,
      replicateBaseUrl:
        process.env.REPLICATE_BASE_URL || "https://api.replicate.com",
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
    const job = await db
      .prepare("SELECT * FROM jobs WHERE id = ?")
      .get(request.params.id);
    if (!job) {
      sendError(reply, 404, "JOB_NOT_FOUND", "Job not found.");
      return;
    }
    const trackVersion = await db
      .prepare("SELECT * FROM track_versions WHERE id = ?")
      .get(job.track_version_id);
    if (!trackVersion) {
      sendError(
        reply,
        404,
        "TRACK_VERSION_NOT_FOUND",
        "Track version not found.",
      );
      return;
    }
    const track = await db
      .prepare("SELECT * FROM tracks WHERE id = ?")
      .get(trackVersion.track_id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      // SECURITY (P3): return 404 (not 403) for other-users' jobs so the
      // response does not reveal whether a given job id exists.
      sendError(reply, 404, "JOB_NOT_FOUND", "Job not found.");
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
      const failureHints = classifyRenderFailure(
        rawErrorMessage,
        responseJob.error_code,
        responseJob.step,
      );
      responseJob = {
        ...responseJob,
        error_message: normalizeRenderFailureMessage(
          responseJob.error_message,
          responseJob.error_code,
        ),
        error_terms: extractRenderPolicyTermsFromJob(
          {
            ...responseJob,
            error_message: rawErrorMessage,
          },
          trackVersion.lyrics_json,
        ),
        ...failureHints,
      };
    }

    if (
      (responseJob.status === "queued" || responseJob.status === "running") &&
      (isTerminalTrackFailureStatus(track.status) ||
        isTerminalTrackFailureStatus(trackVersion.status))
    ) {
      const latestFailedJob = await findLatestFailedJobForVersion(
        job.track_version_id,
        job.workflow_type,
      );
      const fallbackErrorCode =
        latestFailedJob?.error_code ||
        responseJob.error_code ||
        "RENDER_FAILED";
      const fallbackErrorMessage =
        latestFailedJob?.error_message || responseJob.error_message;

      responseJob = {
        ...responseJob,
        status: "failed",
        progress: 100,
        error_code: fallbackErrorCode,
        error_message: normalizeRenderFailureMessage(
          fallbackErrorMessage,
          fallbackErrorCode,
        ),
        error_terms: extractRenderPolicyTermsFromJob(
          {
            ...(latestFailedJob || {}),
            error_message: fallbackErrorMessage,
          },
          trackVersion.lyrics_json,
        ),
        completed_at:
          latestFailedJob?.completed_at || responseJob.completed_at || nowIso(),
        ...classifyRenderFailure(
          fallbackErrorMessage,
          fallbackErrorCode,
          latestFailedJob?.step || responseJob.step,
        ),
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
  async function serveTrackAudio(
    request,
    reply,
    { track, trackVersion, s3Key, localFileName, contentType },
  ) {
    // R2 is the source of truth — proxy the response to avoid CORS issues
    if (storageProvider.type !== "local") {
      const download = storageProvider.createPresignedDownload({
        key: s3Key,
        expiresInSec: 300,
      });
      try {
        const fetchHeaders = {};
        if (request.headers.range) {
          fetchHeaders.Range = request.headers.range;
        }
        // Always GET upstream — the presigned URL is signed for GET, so a
        // HEAD upstream returns 403. Fastify auto-strips the body for HEAD
        // downstream, which means HEAD pays the R2 download cost. Acceptable:
        // HEAD requests are rare from real audio elements (browsers GET).
        const r2Response = await fetch(download.url, {
          headers: fetchHeaders,
          signal: AbortSignal.timeout(30_000),
        });
        if (!r2Response.ok && r2Response.status !== 206) {
          // Pass 416 through verbatim so clients can recover from out-of-range
          // requests instead of seeing a misleading 404.
          if (r2Response.status === 416) {
            reply.status(416);
            reply.header(
              "Content-Range",
              r2Response.headers.get("content-range") || "*/0",
            );
            reply.header("Cache-Control", "no-store");
            reply.send();
            return;
          }
          sendError(
            reply,
            404,
            "AUDIO_NOT_FOUND",
            "Audio file not found in storage.",
          );
          return;
        }
        // Buffer the upstream response. Songs are 1.8-3 MB; loading them in
        // memory is cheaper and far more reliable than wrapping the web
        // ReadableStream via Readable.fromWeb (which silently emitted 0 bytes
        // under Node 20 + Fastify 4.29 + undici, breaking every share player).
        const upstreamLen = r2Response.headers.get("content-length");
        const upstreamRange = r2Response.headers.get("content-range");

        // Cap upstream size so a misuploaded 1 GB file can't OOM the dyno.
        // 50 MB covers full masters with comfortable headroom.
        const MAX_PROXY_BYTES = 50 * 1024 * 1024;
        const parsedUpstreamLen = upstreamLen ? Number(upstreamLen) : null;
        const expectedLen =
          parsedUpstreamLen !== null && Number.isFinite(parsedUpstreamLen)
            ? parsedUpstreamLen
            : null;
        if (expectedLen !== null && expectedLen > MAX_PROXY_BYTES) {
          console.error(
            `[serveTrackAudio] OVERSIZED key=${s3Key} upstream=${upstreamLen} max=${MAX_PROXY_BYTES}`,
          );
          sendError(
            reply,
            502,
            "STORAGE_OVERSIZED",
            "Storage object exceeds proxy size limit.",
          );
          return;
        }

        const buf = Buffer.from(await r2Response.arrayBuffer());

        // Contract guard: if upstream advertised a length and we got a
        // different number of bytes, do not serve corrupt/truncated audio.
        if (expectedLen !== null && expectedLen !== buf.length) {
          console.error(
            `[serveTrackAudio] BYTE_MISMATCH key=${s3Key} upstream=${upstreamLen} actual=${buf.length}`,
          );
          sendError(
            reply,
            502,
            "STORAGE_TRUNCATED",
            "Storage returned an incomplete audio response.",
          );
          return;
        }
        if (buf.length > MAX_PROXY_BYTES) {
          console.error(
            `[serveTrackAudio] OVERSIZED_BUFFER key=${s3Key} actual=${buf.length} max=${MAX_PROXY_BYTES}`,
          );
          sendError(
            reply,
            502,
            "STORAGE_OVERSIZED",
            "Storage object exceeds proxy size limit.",
          );
          return;
        }
        if (buf.length === 0) {
          console.error(
            `[serveTrackAudio] EMPTY_BODY key=${s3Key} upstream_status=${r2Response.status}`,
          );
          sendError(
            reply,
            502,
            "STORAGE_EMPTY",
            "Storage returned an empty response.",
          );
          return;
        }

        reply.status(r2Response.status);
        reply.header(
          "Content-Type",
          r2Response.headers.get("content-type") || contentType || "audio/mp4",
        );
        reply.header("Content-Length", String(buf.length));
        if (upstreamRange) reply.header("Content-Range", upstreamRange);
        reply.header("Accept-Ranges", "bytes");
        reply.header("Cache-Control", "public, max-age=3600");
        reply.send(buf);
      } catch (err) {
        console.error(
          `[serveTrackAudio] R2 proxy failed for ${s3Key}:`,
          err.message,
        );
        sendError(
          reply,
          502,
          "STORAGE_ERROR",
          "Failed to fetch audio from storage.",
        );
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
      sendError(
        reply,
        404,
        "TRACK_VERSION_NOT_FOUND",
        "Track version not found.",
      );
      return;
    }
    const track = await db
      .prepare("SELECT * FROM tracks WHERE id = ?")
      .get(trackVersion.track_id);
    if (!track || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const key = trackPreviewKey({
      userId: track.user_id,
      trackId: track.id,
      versionNum: trackVersion.version_num,
    }).replace(/\.m4a$/, ".mp3");
    await serveTrackAudio(request, reply, {
      track,
      trackVersion,
      s3Key: key,
      localFileName: "preview.mp3",
      contentType: "audio/mpeg",
    });
  });

  app.get("/preview/:trackVersionId.m4a", async (request, reply) => {
    const trackVersion = await db
      .prepare("SELECT * FROM track_versions WHERE id = ?")
      .get(request.params.trackVersionId);
    if (!trackVersion) {
      sendError(
        reply,
        404,
        "TRACK_VERSION_NOT_FOUND",
        "Track version not found.",
      );
      return;
    }
    const track = await db
      .prepare("SELECT * FROM tracks WHERE id = ?")
      .get(trackVersion.track_id);
    if (!track || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }
    const key = trackPreviewKey({
      userId: track.user_id,
      trackId: track.id,
      versionNum: trackVersion.version_num,
    });
    await serveTrackAudio(request, reply, {
      track,
      trackVersion,
      s3Key: key,
      localFileName: "preview.m4a",
    });
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
      sendError(
        reply,
        404,
        "TRACK_VERSION_NOT_FOUND",
        "Track version not found.",
      );
      return;
    }
    const track = await db
      .prepare("SELECT * FROM tracks WHERE id = ?")
      .get(trackVersion.track_id);
    if (!track || track.user_id !== userId || track.deleted_at) {
      sendError(reply, 403, "FORBIDDEN", "Track does not belong to this user.");
      return;
    }
    const key = trackMasterKey({
      userId: track.user_id,
      trackId: track.id,
      versionNum: trackVersion.version_num,
      format: "m4a",
    });
    await serveTrackAudio(request, reply, {
      track,
      trackVersion,
      s3Key: key,
      localFileName: "full.m4a",
    });
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
      sendError(
        reply,
        404,
        "TRACK_VERSION_NOT_FOUND",
        "Track version not found.",
      );
      return;
    }
    const track = await db
      .prepare("SELECT * FROM tracks WHERE id = ?")
      .get(trackVersion.track_id);
    if (!track || track.deleted_at) {
      sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
      return;
    }

    // Auth: check share-token bypass (preserves OG previews in iMessage/WhatsApp/social)
    const shareToken = request.query.share_token;
    let authorized = false;
    if (shareToken) {
      const share = await db
        .prepare(
          "SELECT * FROM share_tokens WHERE id = ? AND status != 'revoked'",
        )
        .get(shareToken);
      if (share && share.track_id === track.id) {
        authorized = true;
      }
    }
    if (!authorized) {
      const userId = await requireUserId(request, reply);
      if (!userId) return;
      if (track.user_id !== userId) {
        sendError(
          reply,
          403,
          "FORBIDDEN",
          "Track does not belong to this user.",
        );
        return;
      }
    }

    if (storageProvider.type !== "local") {
      const key = `${trackVersionKey({ userId: track.user_id, trackId: track.id, versionNum: trackVersion.version_num })}/cover_${size}.jpg`;
      const download = storageProvider.createPresignedDownload({
        key,
        expiresInSec: 300,
      });
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
    const track = await db
      .prepare("SELECT * FROM tracks WHERE id = ?")
      .get(trackVersion.track_id);
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
      fs.existsSync(path.join(versionDir, name)),
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
    getUserRiskLevel,
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
    createGiftDeliveryOutboxRows,
    dispatchGiftById,
    getGiftShareUrlDeliveryError,
    giftReservationTtlMinutes: config.GIFT_RESERVATION_TTL_MINUTES,
  });

  // ============ Tracks ============
  registerTrackRoutes(app, {
    db,
    config: { ...config, ...appConfig },
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
  const receiverSessionService = createReceiverSessionService(db);
  const appLinkService = createAppLinkService({
    publicBaseUrl,
    appsFlyerOneLinkBaseUrl:
      appConfig.APPSFLYER_ONELINK_BASE_URL ||
      config.APPSFLYER_ONELINK_BASE_URL ||
      process.env.APPSFLYER_ONELINK_BASE_URL ||
      null,
  });

  registerArtworkRoutes(app, {
    db,
    requireUserId,
    sendError,
    storageProvider,
    ensureLocalFileFromStorage,
  });

  registerSharingRoutes(app, {
    db,
    appConfig,
    storageProvider,
    requireUserId,
    sendError,
    addAuditEntry,
    eventsService,
    receiverSessionService,
    appLinkService,
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
    generateSongOgImageSquare,
    generateSongArtworkPreviewImage,
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
    isWhatsAppCrawlerUserAgent,
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
    trackArtworkKey,
    getUserRiskLevel,
    consumeRateLimit,
  });

  // ============ Onboarding V2 ============
  registerOnboardingRoutes(app, {
    requireUserId,
    sendError,
  });

  // ============ ADMIN DASHBOARD API ============
  ({ requireAdminRole } = registerAdminRoutes(app, {
    db,
    appConfig,
    sendError,
    adminAuthService,
    subscriptionManager,
    planConfigService,
    emailService,
    ...(oneSignalService ? { oneSignalService } : {}),
  }));

  // ============ Billing API Routes ============
  registerBillingRoutes(app, {
    db,
    appConfig,
    requireUserId,
    sendError,
    consumeRateLimit,
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
  // SECURITY (P3 boot assertions): turn production misconfiguration footguns into
  // hard failures. Anon/device-token fallbacks bypass auth; ADMIN_SETUP_SECRET
  // exposes the one-time admin bootstrap endpoint.
  if (process.env.NODE_ENV === "production") {
    if (process.env.ALLOW_ANON_USER_ID === "true") {
      throw new Error(
        "ALLOW_ANON_USER_ID must not be enabled in production — it bypasses all authentication",
      );
    }
    if (process.env.ALLOW_DEVICE_TOKEN_FALLBACK === "true") {
      throw new Error(
        "ALLOW_DEVICE_TOKEN_FALLBACK must not be enabled in production — it bypasses authentication",
      );
    }
    if (process.env.ADMIN_SETUP_SECRET) {
      throw new Error(
        "ADMIN_SETUP_SECRET must be unset in production — it exposes the admin bootstrap endpoint",
      );
    }
  }
  const db = await getDatabase({
    dbPath: config.DB_PATH,
    migrationsDir: path.join(process.cwd(), "migrations"),
  });
  ensureDir(config.STORAGE_DIR);
  // DEV_MODE disables all live providers (uses placeholders instead)
  const liveEnabled = config.LIVE_PROVIDERS && !config.DEV_MODE;
  if (liveEnabled) {
    if (
      !/^https:\/\/(?!localhost|127\.0\.0\.1)/i.test(
        config.PUBLIC_BASE_URL || "",
      )
    ) {
      throw new Error(
        "PUBLIC_BASE_URL must be https and not localhost when LIVE_PROVIDERS=true",
      );
    }
    if (!config.SUNO_CALLBACK_HMAC_SECRET) {
      console.warn(
        "SUNO_CALLBACK_HMAC_SECRET is unset; Suno callbacks are disabled.",
      );
    } else if (config.SUNO_CALLBACK_HMAC_SECRET.length < 32) {
      throw new Error(
        "SUNO_CALLBACK_HMAC_SECRET must be at least 32 characters",
      );
    }
  }
  // Env fallback default. Runtime default can be changed via admin app_config.
  const musicProvider = config.MUSIC_PROVIDER || "suno";
  const providerConfig = {
    elevenlabs: {
      // ElevenLabs disabled for music generation routing — only used for TTS guide vocals.
      live: false,
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
      rvcModel: config.DEFAULT_AI_VOICE_MODEL,
      timeoutMs: config.PROVIDER_TIMEOUT_MS,
      demucsModel: config.DEMUCS_SEPARATION_MODEL,
      demucsShifts: config.DEMUCS_SHIFTS,
    },
    // Hugging Face token for Seed-VC (personalized voice mode)
    hfToken: config.HF_TOKEN || null,
  };
  console.log(
    `[Server] HF_TOKEN configured: ${providerConfig.hfToken ? "YES" : "NO"}`,
  );
  if (config.DEV_MODE) {
    console.log(
      "[Server] DEV_MODE enabled - all providers disabled, using placeholders",
    );
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
  console.log(
    `[Storage] Provider: ${storage.type}${storage.type === "s3" ? " (R2/S3)" : " (local filesystem)"}`,
  );
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
    await db
      .prepare(
        "UPDATE enrollment_sessions SET status = 'expired' WHERE status NOT IN ('completed','failed_quality','failed_verification') AND expires_at < ?",
      )
      .run(now);
    await db
      .prepare(
        "UPDATE share_tokens SET status = 'expired' WHERE status NOT IN ('revoked','expired') AND share_type != 'demo' AND expires_at < ?",
      )
      .run(now);
  }, config.CLEANUP_INTERVAL_MS);

  const startupEventsService = createEventsService(db);
  async function addStartupAuditEntry({
    userId,
    action,
    resourceType,
    resourceId,
    metadata,
  }) {
    await db
      .prepare(
        "INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        newUuid(),
        userId || null,
        action,
        resourceType,
        resourceId || null,
        toJson(metadata || {}),
        nowIso(),
      );
  }

  // Validate Apple refresh tokens once per day (best practice for persistent sessions)
  const appleValidationIntervalMs = 24 * 60 * 60 * 1000;
  setInterval(async () => {
    try {
      const rows = await db
        .prepare(
          "SELECT id, user_id, provider_data FROM user_auth_providers WHERE provider = 'apple' AND provider_data IS NOT NULL",
        )
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
          if (
            !Number.isNaN(last) &&
            Date.now() - last < appleValidationIntervalMs
          ) {
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
            .prepare(
              "UPDATE user_auth_providers SET provider_data = ? WHERE id = ?",
            )
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
          console.warn(
            "[AppleSignIn] Refresh token validation failed:",
            err.message,
          );
          providerData.apple_refresh_invalid_at = now;
          providerData.apple_refresh_error =
            err.code || "APPLE_REFRESH_TOKEN_FAILED";
          await db
            .prepare(
              "UPDATE user_auth_providers SET provider_data = ? WHERE id = ?",
            )
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
      console.error(
        "[AppleSignIn] Daily refresh token validation failed:",
        err.message,
      );
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
  const billingServices = {
    planConfigService,
    appleValidator,
    googleValidator,
    subscriptionManager,
    appleWebhookHandler,
  };

  const app = buildServer({
    db,
    config: { ...config, providerStatus },
    storage,
    billingServices,
  });
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
    googleValidator,
    intervalMs: config.SUBSCRIPTION_SYNC_INTERVAL_MS || 60 * 60 * 1000, // Default: 1 hour
  });

  const giftDispatchJob = startGiftDispatchJob({
    db,
    dispatchGiftById: async (giftId) => app.dispatchGiftById(giftId),
    intervalMs: config.GIFT_DISPATCH_INTERVAL_MS || 30 * 1000,
    batchSize: 25,
  });

  // Daily cold-email outbound (ported from marketing/email/cold-daily-send.py).
  // Polls every 5 min; fires once per UTC day after fire_after_utc_hour for
  // each active row in cold_email_campaigns.
  const coldEmailJob = startColdEmailJob({
    db,
    apiKey: process.env.RESEND_API_KEY,
    intervalMs: config.COLD_EMAIL_INTERVAL_MS || 5 * 60 * 1000,
    log: (msg) => app.log.info(msg),
  });

  // Share follow-up email job: polls share_followups every 5 min for rows
  // whose send_at has arrived and dispatches the matching stage email.
  const shareFollowupsJob = startShareFollowupsJob({
    db,
    intervalMs: 5 * 60 * 1000,
    log: (msg) => app.log.info(msg),
  });

  // Start OneSignal tag sync job (updates user segments daily)
  const tagSyncJob = startTagSyncJob({
    db,
    logger: app.log,
    intervalMs: 24 * 60 * 60 * 1000, // 24 hours
  });

  const giftReservationExpiryTimer = setInterval(
    () => {
      app.expireGiftReservations({ limit: 50 }).catch((err) => {
        app.log.error(err, "Gift reservation expiry sweep failed");
      });
    },
    config.GIFT_RESERVATION_SWEEP_INTERVAL_MS || 60 * 1000,
  );

  app.expireGiftReservations({ limit: 50 }).catch((err) => {
    app.log.error(err, "Initial gift reservation expiry sweep failed");
  });

  app.addHook("onClose", async () => {
    clearInterval(saveTimer);
    clearInterval(cleanupTimer);
    fileCleanupJob.stop();
    subscriptionSyncJob.stop();
    giftDispatchJob.stop();
    coldEmailJob.stop();
    shareFollowupsJob.stop();
    tagSyncJob.stop();
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
