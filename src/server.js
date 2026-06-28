const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { getDatabase } = require("./database");
const config = require("./config");
const { createHLSPlaylist } = require("./utils/hls");
const { generateShareMp4 } = require("./utils/ffmpeg");
const {
  resolveShareVideoAudio,
  SHARE_TEASER_MAX_SECONDS,
} = require("./media/share-video-source");
const { newUuid } = require("./utils/ids");
const { ensureDir, parseJson, toJson, nowIso } = require("./utils/common");
const { stableStringify } = require("./utils/stable-json");
const {
  buildShareUrlHelpers,
  deriveSharePublicBaseUrl,
} = require("./utils/share-urls");
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
const {
  createHealthCheckRuntimeConfig,
  createProviderRuntimeConfig,
  createStorageRuntimeConfig,
} = require("./providers/provider-config");
const { startCleanupJob } = require("./jobs/cleanup");
const { startSubscriptionSyncJob } = require("./jobs/subscription-sync");
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
const { createRequireUser } = require("./middleware/require-user");
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
const {
  createRateLimitRepository,
} = require("./database/rate-limit-repository");
const {
  createPoemLibraryRepository,
} = require("./database/poem-library-repository");
const {
  createTrackLibraryRepository,
} = require("./database/track-library-repository");
const {
  createTrackVersionRepository,
} = require("./database/track-version-repository");
const {
  createJobDurabilityRepository,
} = require("./database/job-durability-repository");
const {
  createGiftWalletRepository,
} = require("./database/gift-wallet-repository");
const writer = require("./writer");
const adminAuthService = require("./services/admin-auth-service");
const { createEventsService } = require("./services/events-service");
const {
  createReceiverSessionService,
} = require("./services/receiver-session-service");
const { createAppLinkService } = require("./services/app-link-service");
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
const { createHealthCheckService } = require("./workflows/health-check");
const { buildTrackVersionUrls } = require("./services/track-urls");
const { refreshAppleToken } = require("./services/apple-signin");
const { startTagSyncJob } = require("./services/onesignal");
const {
  createFastifyApp,
  registerFormUrlEncodedParser,
  registerStaticAndSecurityBootstrap,
} = require("./plugins/http-bootstrap");
const {
  giftDeliveryPlugin,
  startGiftDeliveryRuntime,
} = require("./plugins/gift-delivery");
const { validationSchemas } = require("./schemas/http-validation");

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
  config: appConfig = {},
  storage,
  cdnSigner = null,
  billingServices = null,
  oneSignalService = null,
}) {
  let requireAdminRole; // Forward declaration — assigned by registerAdminRoutes below
  const app = createFastifyApp();
  registerFormUrlEncodedParser(app);
  const derivedProviderRuntime = createProviderRuntimeConfig(appConfig);
  const runtimeProviderConfig =
    appConfig.providerConfig || derivedProviderRuntime.providerConfig;
  const runtimeProviderStatus =
    appConfig.providerStatus || derivedProviderRuntime.providerStatus;

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

  const giftWalletRepository = createGiftWalletRepository(db);

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
    giftWalletRepository,
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
  const rateLimitRepository = createRateLimitRepository(db);
  writer.initWithRepository(storyRepository);
  const poemLibraryRepository = createPoemLibraryRepository(db);
  const trackLibraryRepository = createTrackLibraryRepository(db);
  const trackVersionRepository = createTrackVersionRepository(db);
  const jobDurabilityRepository = createJobDurabilityRepository(db);

  // Initialize events service for unified telemetry
  const eventsService = createEventsService(db);
  // In-process lock table to dedupe concurrent poem TTS generation per poem.
  const poemAudioGenerationLocks = new Map();

  registerStaticAndSecurityBootstrap(app, { enableDebugRoutes });

  // ============ Authentication Routes ============
  registerLegalRoutes(app, { db });
  registerWellKnownRoutes(app);
  registerInternalSunoCallbackRoutes(app, { appConfig, sendError });
  registerMcpRoutes(app);
  registerBlogRoutes(app, { db, config: appConfig });
  registerAuthRoutes(app, { db, subscriptionManager, storageProvider });

  const schemas = validationSchemas;

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

  const requireUserId = createRequireUser({
    authService,
    ensureUser,
    sendError,
    allowAnonUserId,
    attachUserId: false,
  });

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

  const {
    buildShareAppDownloadUrl,
    buildPlayShareUrl,
    buildFreshPlayShareUrl,
    buildPoemShareUrl,
    buildGiftShareUrl,
    buildRequestedPlayShareUrl,
    buildRequestedPoemShareUrl,
    extractSocialCacheToken,
    buildShareCoverUrl,
    buildPoemOgImageUrl,
  } = buildShareUrlHelpers({
    publicBaseUrl,
    sharePublicBaseUrl,
    shareCoverVersion,
  });

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
    try {
      const result = await rateLimitRepository.consume({
        key: userId,
        action: actionKey,
        max: limit,
        windowMs: windowSeconds * 1000,
      });
      return {
        allowed: result.allowed,
        remaining: result.remaining,
        reset_at: result.resetAt,
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

  async function hasGiftWalletReceiptCredit(args) {
    return giftWalletRepository.hasReceiptCredit(args);
  }

  async function applyGiftWalletTransaction(args) {
    return giftWalletRepository.applyTransaction(args);
  }

  async function getGiftWalletSummary(userId, limit = 20) {
    return giftWalletRepository.getSummary(userId, limit);
  }

  async function findTrackVersion(trackId, versionNum) {
    return trackVersionRepository.findByTrackIdAndVersion({
      trackId,
      versionNum,
    });
  }

  async function findJob(jobId) {
    return jobDurabilityRepository.findById(jobId);
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
    return jobDurabilityRepository.findLatestFailedForVersion({
      trackVersionId,
      workflowType,
    });
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
    return jobDurabilityRepository.findActiveForVersion({
      trackVersionId,
      workflowType,
    });
  }

  async function getTrackVersions(track, baseUrl) {
    if (!track || !track.id) {
      return [];
    }
    const versions = await trackVersionRepository.listByTrackId(track.id);

    const versionIds = versions.map((version) => version.id).filter(Boolean);
    const latestFailedJobByVersion = new Map();
    if (versionIds.length > 0) {
      const failedJobs =
        await jobDurabilityRepository.listLatestFailuresForTrackVersions(
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
    await trackLibraryRepository.upsertTrackLibraryEntry({
      userId,
      trackId,
      origin,
      shareTokenId,
      addedAt,
    });
  }

  async function upsertPoemLibraryEntry({
    userId,
    poemId,
    origin,
    shareTokenId = null,
    addedAt = nowIso(),
  }) {
    await poemLibraryRepository.upsertPoemLibraryEntry({
      userId,
      poemId,
      origin,
      shareTokenId,
      addedAt,
    });
  }

  async function getTrackForLibrary(userId, trackId) {
    return trackLibraryRepository.getTrackForLibrary({ userId, trackId });
  }

  async function getPoemForLibrary(userId, poemId) {
    return poemLibraryRepository.getPoemForLibrary({ userId, poemId });
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

    const versions =
      await trackVersionRepository.listLatestCoverVersionsForTracks(trackIds);

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
        (await trackVersionRepository.findById(trackVersionId)) || trackVersion;
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
    const job = await jobDurabilityRepository.findById(failedJob.id);
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
    providerConfig: runtimeProviderConfig,
    appConfig,
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
    providers: runtimeProviderStatus,
  }));

  /**
   * GET /health/providers - Check external provider health
   *
   * Returns real-time health status of ElevenLabs, Replicate, and other providers.
   * Includes circuit breaker state if job runner is active.
   */
  app.get("/health/providers", async (request, reply) => {
    // Gate behind admin auth — exposes API keys existence and provider config
    const adminOk = await requireAdminRole(request, reply, [
      "admin",
      "superadmin",
    ]);
    if (!adminOk) return;

    const healthChecker = createHealthCheckService(
      createHealthCheckRuntimeConfig(runtimeProviderConfig, {
        timeoutMs: 5000,
      }),
    );

    try {
      const health = await healthChecker.getOverallHealth();

      // Include circuit breaker state if available from job runner
      // Note: jobRunner reference would need to be stored at server level
      // For now, just return provider health
      reply.send({
        ...health,
        circuitBreakers: runtimeProviderStatus,
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
    const job = await jobDurabilityRepository.findById(request.params.id);
    if (!job) {
      sendError(reply, 404, "JOB_NOT_FOUND", "Job not found.");
      return;
    }
    const trackVersion = await trackVersionRepository.findById(
      job.track_version_id,
    );
    if (!trackVersion) {
      sendError(
        reply,
        404,
        "TRACK_VERSION_NOT_FOUND",
        "Track version not found.",
      );
      return;
    }
    const track = await trackVersionRepository.findTrackById(
      trackVersion.track_id,
    );
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
    const trackVersion = await trackVersionRepository.findById(
      request.params.trackVersionId,
    );
    if (!trackVersion) {
      sendError(
        reply,
        404,
        "TRACK_VERSION_NOT_FOUND",
        "Track version not found.",
      );
      return;
    }
    const track = await trackVersionRepository.findTrackById(
      trackVersion.track_id,
    );
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
    const trackVersion = await trackVersionRepository.findById(
      request.params.trackVersionId,
    );
    if (!trackVersion) {
      sendError(
        reply,
        404,
        "TRACK_VERSION_NOT_FOUND",
        "Track version not found.",
      );
      return;
    }
    const track = await trackVersionRepository.findTrackById(
      trackVersion.track_id,
    );
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
    const trackVersion = await trackVersionRepository.findById(
      request.params.trackVersionId,
    );
    if (!trackVersion) {
      sendError(
        reply,
        404,
        "TRACK_VERSION_NOT_FOUND",
        "Track version not found.",
      );
      return;
    }
    const track = await trackVersionRepository.findTrackById(
      trackVersion.track_id,
    );
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
    const trackVersion = await trackVersionRepository.findById(trackVersionId);
    if (!trackVersion) {
      sendError(
        reply,
        404,
        "TRACK_VERSION_NOT_FOUND",
        "Track version not found.",
      );
      return;
    }
    const track = await trackVersionRepository.findTrackById(
      trackVersion.track_id,
    );
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
    const trackVersion = await trackVersionRepository.findById(
      request.params.trackVersionId,
    );
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
    const track = await trackVersionRepository.findTrackById(
      trackVersion.track_id,
    );
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
  giftDeliveryPlugin(app, {
    db,
    appConfig,
    config,
    requireUserId,
    sendError,
    addAuditEntry,
    eventsService,
    giftWalletRepository,
    trackVersionRepository,
    buildGiftShareUrl,
    twilioStatusCallbackBaseUrl,
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
    hasGiftWalletReceiptCredit,
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
  const authFallbackEnv = process.env.NODE_ENV;
  const allowDevAuthFallback =
    authFallbackEnv === "development" || authFallbackEnv === "test";
  if (
    !allowDevAuthFallback &&
    (process.env.ALLOW_ANON_USER_ID === "true" ||
      process.env.ALLOW_DEVICE_TOKEN_FALLBACK === "true")
  ) {
    throw new Error(
      "Auth fallback env vars are only allowed when NODE_ENV is development or test",
    );
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
  const { providerConfig, providerStatus } =
    createProviderRuntimeConfig(config);
  console.log(
    `[Server] HF_TOKEN configured: ${providerConfig.hfToken ? "YES" : "NO"}`,
  );
  if (config.DEV_MODE) {
    console.log(
      "[Server] DEV_MODE enabled - all providers disabled, using placeholders",
    );
  }
  const storage = createStorageProvider(createStorageRuntimeConfig(config));
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
    config: { ...config, providerConfig, providerStatus },
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

  const giftDeliveryRuntime = startGiftDeliveryRuntime({ app, db, config });

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

  app.addHook("onClose", async () => {
    clearInterval(saveTimer);
    clearInterval(cleanupTimer);
    fileCleanupJob.stop();
    subscriptionSyncJob.stop();
    giftDeliveryRuntime.stop();
    coldEmailJob.stop();
    shareFollowupsJob.stop();
    tagSyncJob.stop();
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
