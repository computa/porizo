"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const { newUuid } = require("../utils/ids");
const { nowIso, toJson, parseJson, ensureDir } = require("../utils/common");
const { isShareUsable, healAndCheckShare } = require("../services/share-service");

function registerSharingRoutes(app, {
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
  generateSongOgImageSquare,
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
  getUserRiskLevel: _getUserRiskLevel,
  consumeRateLimit,
}) {
// Shared guard: lookup share token + reject revoked/expired. Returns share or null (error already sent).
async function resolveValidShare(request, reply) {
  const share = await db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(request.params.shareId);
  if (!share || share.status === "revoked") {
    sendError(reply, 404, "SHARE_NOT_FOUND", "Share token not found.");
    return null;
  }
  if (!await healAndCheckShare(db, share, "share_tokens", "unbound")) {
    sendError(reply, 410, "SHARE_EXPIRED", "Share token expired.");
    return null;
  }
  return share;
}

// ============ Download Token (HMAC-signed, short-lived) ============
const DL_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
// Shared secret for download tokens — env var for multi-instance, random fallback for single-instance
const DL_TOKEN_SECRET = process.env.DL_TOKEN_SECRET
  ? Buffer.from(process.env.DL_TOKEN_SECRET, "hex")
  : crypto.randomBytes(32);

function createDownloadToken(shareId) {
  const expires = Date.now() + DL_TOKEN_TTL_MS;
  const payload = `${shareId}:${expires}`;
  const sig = crypto.createHmac("sha256", DL_TOKEN_SECRET).update(payload).digest("hex").slice(0, 16);
  return `${expires}.${sig}`;
}

function validateDownloadToken(shareId, token) {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [expiresStr, sig] = parts;
  const expires = Number(expiresStr);
  if (!expires || Date.now() > expires) return false;
  const payload = `${shareId}:${expiresStr}`;
  const expected = crypto.createHmac("sha256", DL_TOKEN_SECRET).update(payload).digest("hex").slice(0, 16);
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function isTrackVersionSharePlayable(trackVersion) {
  if (!trackVersion) return false;
  if (trackVersion.full_url || trackVersion.preview_url) return true;
  return [
    "preview_ready",
    "full_ready",
    "ready",
    // Legacy rows/tests may still use "completed" as the terminal status.
    "completed",
  ].includes(trackVersion.status);
}

async function servePublicSharePreviewAudio(request, reply, {
  share,
  track,
  trackVersion,
  ensureLocalFileFromStorage,
  getVersionDir,
  sendMediaFile,
  trackPreviewKey,
  addShareAccessLog,
}) {
  // No rate limit on playback — serving a cached audio file costs nothing.
  // The share link URL itself is the access control.

  const versionDir = getVersionDir(track, trackVersion);

  const localPreview = path.join(versionDir, "preview.m4a");
  const previewKey = trackPreviewKey({
    userId: track.user_id,
    trackId: track.id,
    versionNum: trackVersion.version_num,
  });
  await ensureLocalFileFromStorage({ key: previewKey, localPath: localPreview });
  const audioPath = fs.existsSync(localPreview) ? localPreview : null;

  if (!audioPath && trackVersion.full_url) {
    // No preview file — proxy full render audio via the same path the app uses
    const masterKey = trackMasterKey({ userId: track.user_id, trackId: track.id, versionNum: trackVersion.version_num, format: "m4a" });
    await addShareAccessLog({
      shareTokenId: share.id,
      eventType: "audio_served",
      metadata: { user_agent: request.headers["user-agent"] || null, ip: request.ip || null, type: "full_proxy" },
    });
    await serveTrackAudio(request, reply, { track, trackVersion, s3Key: masterKey, localFileName: "full.m4a" });
    return true;
  }

  if (!audioPath) {
    sendError(reply, 404, "AUDIO_NOT_AVAILABLE", "Audio not available.");
    return true;
  }

  await addShareAccessLog({
    shareTokenId: share.id,
    eventType: "audio_served",
    metadata: { user_agent: request.headers["user-agent"] || null, ip: request.ip || null, type: "preview" },
  });
  sendMediaFile(request, reply, audioPath, "audio/mp4", {
    cacheControl: "public, max-age=300",
  });
  return true;
}

// ============ Song OG Preview Endpoints ============

/**
 * GET /tracks/:id/og-previews - Get all song OG variant thumbnails
 */
app.get("/tracks/:id/og-previews", async (request, reply) => {
  const userId = await requireUserId(request, reply);
  if (!userId) return;

  const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
  if (!track || track.user_id !== userId || track.deleted_at) {
    sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
    return;
  }

  const trackVersion = await findTrackVersion(track.id, track.latest_version);
  let coverPath = null;
  if (trackVersion) {
    const versionDir = getVersionDir(track, trackVersion);
    const candidateCover = path.join(versionDir, "cover_1024.jpg");
    if (fs.existsSync(candidateCover)) coverPath = candidateCover;
  }

  const params = { title: track.title, recipientName: track.recipient_name, occasion: track.occasion, coverPath, brandName: "Porizo" };

  const variants = [];
  for (const name of SONG_VARIANT_NAMES) {
    const buf = await generateSongOgPreview(name, params);
    if (!buf) {
      sendError(reply, 503, "IMAGE_GENERATION_UNAVAILABLE", "Image generation is not available.");
      return;
    }
    variants.push({ name, label: SONG_VARIANT_LABELS[name], preview: `data:image/jpeg;base64,${buf.toString("base64")}` });
  }

  reply
    .header("Cache-Control", "no-store")
    .send({ current_variant: normalizeVariantName(track.og_variant, SONG_VARIANT_NAMES), variants });
});

/**
 * GET /tracks/:id/og-preview/:variant - Get single song OG variant thumbnail
 */
app.get("/tracks/:id/og-preview/:variant", async (request, reply) => {
  const userId = await requireUserId(request, reply);
  if (!userId) return;

  const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(request.params.id);
  if (!track || track.user_id !== userId || track.deleted_at) {
    sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
    return;
  }

  if (!SONG_VARIANT_NAMES.includes(request.params.variant)) {
    sendError(reply, 400, "INVALID_VARIANT", `Invalid variant. Must be one of: ${SONG_VARIANT_NAMES.join(", ")}`);
    return;
  }

  const trackVersion = await findTrackVersion(track.id, track.latest_version);
  let coverPath = null;
  if (trackVersion) {
    const versionDir = getVersionDir(track, trackVersion);
    const candidateCover = path.join(versionDir, "cover_1024.jpg");
    if (fs.existsSync(candidateCover)) coverPath = candidateCover;
  }

  const buf = await generateSongOgPreview(request.params.variant, { title: track.title, recipientName: track.recipient_name, occasion: track.occasion, coverPath, brandName: "Porizo" });
  if (!buf) {
    sendError(reply, 503, "IMAGE_GENERATION_UNAVAILABLE", "Image generation is not available.");
    return;
  }

  reply.type("image/jpeg").header("Cache-Control", "no-store").send(buf);
});

// ============ Poem OG Image ============
// Generates a dynamic 1200×630 social share card with the poem text
// Supports variant dispatch and disk caching
app.get("/poem/:shareId/og-image.png", async (request, reply) => {
  const share = await db.prepare(
    "SELECT p.id AS poem_id, p.user_id, p.title, p.recipient_name, p.occasion, p.verses, p.og_variant FROM poem_share_tokens pst JOIN poems p ON p.id = pst.poem_id WHERE pst.id = ?"
  ).get(request.params.shareId);
  if (!share) return reply.status(404).send("Not found");

  const poemVariant = normalizeVariantName(share.og_variant, POEM_VARIANT_NAMES);
  const variantKey = poemVariant || "default";
  const ogCardVersionSuffix = shareCoverVersion ? `_v${shareCoverVersion}` : "";
  const poemDir = path.join(appConfig.STORAGE_DIR, "poems", share.user_id, share.poem_id);
  const ogFileName = `og_1200x630${ogCardVersionSuffix}_${variantKey}.png`;
  const cachedPath = path.join(poemDir, ogFileName);
  const ogStorageKey = `poems/${share.user_id}/${share.poem_id}/${ogFileName}`;

  if (storageProvider.type !== "local" && !fs.existsSync(cachedPath)) {
    await ensureLocalFileFromStorage({ key: ogStorageKey, localPath: cachedPath });
  }

  if (fs.existsSync(cachedPath)) {
    return reply
      .type("image/png")
      .header("Cache-Control", "public, max-age=86400")
      .send(fs.readFileSync(cachedPath));
  }

  const ogGenerator = getPoemOgGenerator(poemVariant) || generatePoemOgImage;
  const imageBuffer = await ogGenerator({
    title: share.title,
    recipientName: share.recipient_name,
    occasion: share.occasion,
    verses: parseJson(share.verses, []),
  });

  if (!imageBuffer) return reply.status(500).send("Image generation unavailable");

  ensureDir(poemDir);
  fs.writeFileSync(cachedPath, imageBuffer);

  if (storageProvider.type !== "local") {
    try {
      await storageProvider.putFile({
        key: ogStorageKey,
        filePath: cachedPath,
        contentType: "image/png",
      });
    } catch (uploadErr) {
      console.error(`[poem-og] Failed to upload OG image for poem ${share.poem_id}:`, uploadErr.message);
    }
  }

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

  // Keep poem share links on the web viewer by default.
  // Auto-redirecting mobile traffic to the app makes shared links brittle in social apps.

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
  const socialCacheToken = extractSocialCacheToken(request);
  const ogImage = buildPoemOgImageUrl(shareId, { socialCacheToken });
  const ogUrl = buildRequestedPoemShareUrl(request, shareId);

  // Serve the poem viewer HTML with OG tags injected
  const viewerHtml = injectOgTags(poemViewerTemplate, {
    ogTitle,
    ogDescription,
    ogImage,
    ogImageWidth: 1200,
    ogImageHeight: 630,
    ogUrl,
    ogType: "article",
    fbAppId: facebookAppId,
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

  // Keep share links on the web player by default.
  // Auto-redirecting mobile traffic based on referer heuristics breaks real social handoff paths.

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

  const userAgent = request.headers["user-agent"];
  const isCrawler = isSocialCrawlerUserAgent(userAgent);
  const isFacebookCrawler = isFacebookCrawlerUserAgent(userAgent);
  const isWhatsApp = isWhatsAppCrawlerUserAgent(userAgent);
  const isTrackReady = isTrackVersionSharePlayable(trackVersion);

  // Only include video/embed OG tags when the track is fully rendered
  let includeVideoMeta = isTrackReady;
  if (isFacebookCrawler || isWhatsApp) {
    // Facebook prefers og:video thumbnails over og:image — force image cards.
    // WhatsApp ignores og:video entirely — no point including it.
    includeVideoMeta = false;
  }
  if (includeVideoMeta && track && trackVersion) {
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
  } else if (isCrawler && !track) {
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
  const socialCacheToken = extractSocialCacheToken(request);
  const ogUrl = buildRequestedPlayShareUrl(request, shareId);

  // WhatsApp letterboxes 1200x630 images badly — serve a 1200x1200 square variant
  let ogImage, ogImageWidth, ogImageHeight;
  if (isWhatsApp) {
    ogImage = `${publicBaseUrl}/share/${shareId}/cover.jpg?variant=whatsapp&_sc=${socialCacheToken || ""}`;
    ogImageWidth = 1200;
    ogImageHeight = 1200;
  } else {
    ogImage = buildShareCoverUrl(shareId, { socialCacheToken });
    ogImageWidth = 1200;
    ogImageHeight = 630;
  }

  const ogVideo = includeVideoMeta ? `${publicBaseUrl}/share/${shareId}/share.mp4` : null;
  const embedUrl = `${publicBaseUrl}/embed/${shareId}`;
  const oembedUrl = `${publicBaseUrl}/oembed?url=${encodeURIComponent(ogUrl)}&format=json`;

  // Serve the web player HTML with OG tags injected
  const playerHtml = injectOgTags(webPlayerTemplate, {
    ogTitle, ogDescription, ogImage, ogImageWidth, ogImageHeight, ogUrl,
    ogType: includeVideoMeta ? "video.other" : "website",
    ogVideo, embedUrl, oembedUrl,
    fbAppId: facebookAppId,
    shareId,
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
  const link = buildPlayShareUrl(shareId);
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
  const share = await resolveValidShare(request, reply);
  if (!share) return;
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

  // Public web playback is preview-only for unbound shares.
  // Claim PIN remains an app ownership/binding control, not a web playback gate.
  const shareStreamUrl = share.web_stream_allowed && !appRequired
    ? `${getBaseUrl(request)}/share/${share.id}/audio`
    : null;

  const lyricsData = parseJson(trackVersion.lyrics_json, null, "share_lyrics");
  const lyrics = lyricsData?.sections || null;

  // dl_token remains gated behind PIN verification because downloads are meant for intentional export.
  const hasPinProtection = Boolean(share.claim_pin);
  const dlToken = hasPinProtection ? null : createDownloadToken(share.id);

  reply.send({
    status: "unbound",
    track_preview: trackInfo,
    track: trackInfo, // Alias for web player compatibility
    can_access: canAccess,
    app_required: appRequired,
    web_stream_url: shareStreamUrl,
    app_download_url: buildShareAppDownloadUrl({ shareId: share.id }),
    ...(dlToken && { dl_token: dlToken }),
    ...(share.share_type === "demo" && { is_demo: true }),
    ...(lyrics && { lyrics }),
  });
});

app.post("/share/:shareId/claim", { schema: schemas.shareClaim }, async (request, reply) => {
  const share = await resolveValidShare(request, reply);
  if (!share) return;
  if (share.share_type === "demo") {
    sendError(reply, 403, "DEMO_SHARE", "Demo shares cannot be claimed.");
    return;
  }
  const body = request.body || {};
  const { pin } = body;
  let deviceToken = getDeviceTokenPayload(request, reply, { required: false });
  if (!deviceToken && allowDeviceTokenFallback && (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development')) {
    const fallbackDeviceId = body.device_id || request.headers["x-device-id"];
    const fallbackPlatform = body.platform || request.headers["x-platform"];
    if (fallbackDeviceId && fallbackPlatform) {
      deviceToken = {
        device_id: fallbackDeviceId,
        platform: fallbackPlatform,
        app_version: body.app_version || request.headers["x-app-version"] || null,
        sub: null,
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
  const claimUserId = deviceToken.sub || null;

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

    if (!pin) {
      // Empty/missing PIN — don't increment lockout counter (not a real guess)
      sendError(reply, 401, "INVALID_PIN", "Invalid PIN. Please check with the sender.");
      return;
    }
    // Timing-safe PIN comparison to prevent side-channel attacks
    const pinStr = String(pin);
    const pinMatch = pinStr.length === share.claim_pin.length &&
      crypto.timingSafeEqual(Buffer.from(pinStr), Buffer.from(share.claim_pin));
    if (!pinMatch) {
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
  // Atomic claim: WHERE guards prevent TOCTOU race — two concurrent claims
  // will both pass the JS checks above, but only one UPDATE will match.
  const claimResult = await db.prepare(
    "UPDATE share_tokens SET status = ?, bound_device_id = ?, bound_device_platform = ?, bound_app_version = ?, bound_user_id = COALESCE(?, bound_user_id), bound_at = ?, web_stream_allowed = ?, claim_attempts = 0 WHERE id = ? AND bound_device_id IS NULL AND status = 'unbound'"
  ).run("claimed", deviceId, platform, appVersion, claimUserId, claimAt, 0, share.id);
  if (claimResult.changes === 0) {
    console.warn("[SecurityGuard:ClaimRace] Concurrent claim rejected for share", share.id);
    sendError(reply, 409, "TOKEN_ALREADY_BOUND", "Share token already bound to another device.");
    return;
  }

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
  const share = await resolveValidShare(request, reply);
  if (!share) return;

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
      metadata: { platform: platform || "web", claimed: false, mode: "preview" },
    });

    eventsService.emit("share_stream", {
      resourceType: "share",
      resourceId: share.id,
      metadata: {
        platform: platform || "web",
        claimed: false,
        track_id: share.track_id,
        mode: "preview",
      },
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });

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

// Public preview endpoint for unbound web playback (no auth headers required).
// This intentionally serves the preview asset, not the full downloadable master.
app.get("/share/:shareId/audio", async (request, reply) => {
  const share = await resolveValidShare(request, reply);
  if (!share) return;
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
  await servePublicSharePreviewAudio(request, reply, {
    share,
    track,
    trackVersion,
    ensureLocalFileFromStorage,
    getVersionDir,
    sendMediaFile,
    trackPreviewKey,
    addShareAccessLog,
  });
});

// Teaser endpoint — serves preview.m4a without PIN for social sharing funnels.
// Kept as an alias for compatibility with older clients and cached cards.
app.get("/share/:shareId/teaser", async (request, reply) => {
  const share = await resolveValidShare(request, reply);
  if (!share) return;
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
  await servePublicSharePreviewAudio(request, reply, {
    share,
    track,
    trackVersion,
    ensureLocalFileFromStorage,
    getVersionDir,
    sendMediaFile,
    trackPreviewKey,
    addShareAccessLog,
  });
});

// Stable cover image endpoint for social crawlers.
// Always resolves to a direct image file and never a short-lived DB URL value.
app.get("/share/:shareId/cover.jpg", async (request, reply) => {
  const share = await resolveValidShare(request, reply);
  if (!share) return;
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

  // WhatsApp square variant — 1200x1200 image to avoid letterboxing
  if (request.query.variant === "whatsapp") {
    const squarePath = path.join(versionDir, "share_og_1200x1200_whatsapp.jpg");
    if (!fs.existsSync(squarePath)) {
      // Ensure cover art is available locally for the generator
      let hasCover = fs.existsSync(localCoverPath);
      if (!hasCover && storageProvider.type !== "local") {
        const coverKey = `${trackVersionKey({ userId: track.user_id, trackId: track.id, versionNum: trackVersion.version_num })}/cover_1024.jpg`;
        await ensureLocalFileFromStorage({ key: coverKey, localPath: localCoverPath });
        hasCover = fs.existsSync(localCoverPath);
      }
      const squareBuffer = await generateSongOgImageSquare({
        title: track.title,
        recipientName: track.recipient_name,
        occasion: track.occasion,
        coverPath: hasCover ? localCoverPath : null,
        brandName: "Porizo",
      });
      if (squareBuffer) {
        ensureDir(versionDir);
        fs.writeFileSync(squarePath, squareBuffer);
      }
    }
    if (fs.existsSync(squarePath)) {
      await addShareAccessLog({
        shareTokenId: share.id,
        eventType: "share_cover_served",
        metadata: { reason: "whatsapp_square", user_agent: request.headers["user-agent"] || null },
      });
      return sendMediaFile(request, reply, squarePath, "image/jpeg", { cacheControl: "public, max-age=14400" });
    }
    // Fall through to standard OG card if square generation failed
  }

  const ogCardVersionSuffix = shareCoverVersion ? `_v${shareCoverVersion}` : "";
  const songVariant = normalizeVariantName(track.og_variant, SONG_VARIANT_NAMES);
  const variantSuffix = songVariant ? `_${songVariant}` : "";
  const localOgCardPath = path.join(versionDir, `share_og_1200x630${ogCardVersionSuffix}${variantSuffix}.jpg`);
  const versionStoragePrefix = trackVersionKey({
    userId: track.user_id,
    trackId: track.id,
    versionNum: trackVersion.version_num,
  });
  const coverKey = `${versionStoragePrefix}/cover_1024.jpg`;
  const ogCardKey = `${versionStoragePrefix}/share_og_1200x630${ogCardVersionSuffix}${variantSuffix}.jpg`;

  if (storageProvider.type !== "local") {
    if (!fs.existsSync(localCoverPath)) {
      await ensureLocalFileFromStorage({ key: coverKey, localPath: localCoverPath });
    }
    if (!fs.existsSync(localOgCardPath)) {
      await ensureLocalFileFromStorage({ key: ogCardKey, localPath: localOgCardPath });
    }
  }

  if (!fs.existsSync(localOgCardPath)) {
    const ogGenerator = getSongOgGenerator(songVariant) || generateSongOgImage;
    const generatedOgImage = await ogGenerator({
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

  // Purge 0-byte OG cards left by previous "stream closed prematurely" bug
  if (fs.existsSync(localOgCardPath) && fs.statSync(localOgCardPath).size === 0) {
    fs.unlinkSync(localOgCardPath);
  }
  if (fs.existsSync(localCoverPath) && fs.statSync(localCoverPath).size === 0) {
    fs.unlinkSync(localCoverPath);
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
  return sendMediaFile(request, reply, imagePath, contentType, {
    cacheControl: "public, max-age=14400",
  });
});

// Share MP4 for og:video embeds (iMessage, Discord)
app.get("/share/:shareId/share.mp4", async (request, reply) => {
  const share = await resolveValidShare(request, reply);
  if (!share) return;
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

// Downloadable audiogram for Instagram/Facebook native upload (rate-limited + signed token)
app.get("/share/:shareId/download.mp4", async (request, reply) => {
  const shareId = request.params.shareId;
  const dlToken = request.query.dl_token;

  if (!validateDownloadToken(shareId, dlToken)) {
    sendError(reply, 403, "INVALID_TOKEN", "Download link expired or invalid.");
    return;
  }

  const share = await db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(shareId);
  if (!share || share.status === "revoked") {
    sendError(reply, 404, "SHARE_NOT_FOUND", "Share token not found.");
    return;
  }
  if (!isShareUsable(share)) {
    sendError(reply, 410, "SHARE_EXPIRED", "Share token expired.");
    return;
  }

  // Rate limit: 5 downloads per IP per hour
  const clientIp = request.ip || "unknown";
  const rateLimitResult = await consumeRateLimit(
    `ip:${clientIp}`, "audiogram_download", 5, 3600
  );
  if (rateLimitResult && !rateLimitResult.allowed) {
    if (rateLimitResult.reset_at) {
      const retryMs = Math.max(0, new Date(rateLimitResult.reset_at).getTime() - Date.now());
      reply.header("Retry-After", String(Math.ceil(retryMs / 1000)));
    }
    sendError(reply, 429, "RATE_LIMITED", "Too many downloads. Please try again later.");
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
    sendError(reply, 404, "VIDEO_NOT_FOUND", "Audiogram not available yet.");
    return;
  }

  const safeName = (track.recipient_name || "someone")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .substring(0, 30)
    .toLowerCase();

  await addShareAccessLog({
    shareTokenId: share.id,
    eventType: "audiogram_downloaded",
    metadata: { user_agent: request.headers["user-agent"] || null, ip: clientIp },
  });

  reply
    .header("Content-Disposition", `attachment; filename="porizo-song-for-${safeName}.mp4"`)
    .header("Content-Type", "video/mp4")
    .header("Cache-Control", "private, no-cache");
  const stream = fs.createReadStream(mp4Path);
  return reply.send(stream);
});

app.get("/share/:shareId/playlist", async (request, reply) => {
  const share = await resolveValidShare(request, reply);
  if (!share) return;
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
  const share = await resolveValidShare(request, reply);
  if (!share) return;
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
  const share = await resolveValidShare(request, reply);
  if (!share) return;
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
    share_url: buildPlayShareUrl(share.id),
    claim_pin: share.claim_pin,
    status: share.status,
    created_at: share.created_at,
    expires_at: share.expires_at,
    is_expired: !isShareUsable(share),
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
  if (!isShareUsable(share)) {
    sendError(reply, 410, "SHARE_EXPIRED", "Share has expired.");
    return;
  }

  // Generate QR code for the web player URL
  const shareUrl = buildPlayShareUrl(share.id);

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
  if (!isShareUsable(share)) {
    sendError(reply, 410, "SHARE_EXPIRED", "Share has expired.");
    return;
  }

  // Generate QR code for the web player URL
  const shareUrl = buildPlayShareUrl(share.id);
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
  const trackVersion = await findTrackVersion(track.id, versionNum);
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

}

module.exports = { registerSharingRoutes };
