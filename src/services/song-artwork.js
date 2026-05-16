const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { ensureDir } = require("../utils/common");
const {
  VALID_OCCASIONS,
  VALID_STYLES,
  buildPrompt,
} = require("./artwork-prompts");
const {
  getImageProvider,
  ModerationRefusalError,
} = require("./image-providers");
const { compositeArtworkWithText } = require("./cover-generator");
const { trackArtworkKey } = require("../storage");

const PAID_TIERS = new Set(["plus", "pro"]);

// Order is load-bearing — pickStyleVariant indexes n % STYLE_LIST.length.
// Reordering or inserting would re-bucket every existing track. Append-only.
const STYLE_LIST = Array.from(VALID_STYLES);

const STORAGE_ROOT =
  process.env.STORAGE_ROOT || path.resolve(process.cwd(), "storage");

function libraryPath(occasion, style) {
  return path.join(STORAGE_ROOT, "artwork-library", occasion, style, "v1.jpg");
}

function trackDir({ userId, trackId }) {
  return path.join(STORAGE_ROOT, "tracks", userId, trackId);
}

function pickStyleVariant({ trackId, userId }) {
  const h = crypto
    .createHash("sha1")
    .update(`${userId}:${trackId}`)
    .digest("hex");
  const n = parseInt(h.slice(0, 8), 16);
  return STYLE_LIST[n % STYLE_LIST.length];
}

function computeContentHash({ recipientName, occasion, style }) {
  const normalized = `${String(recipientName || "").trim()}|${occasion}|${style}`;
  return crypto.createHash("sha1").update(normalized).digest("hex");
}

/**
 * Generate (or reuse) song artwork.
 *
 * @param {Object} args
 * @param {string} args.userId
 * @param {string} args.trackId
 * @param {string} args.occasion         Must be a member of VALID_OCCASIONS
 * @param {string} args.recipientName    Composited locally; never sent to AI
 * @param {string} args.tier             'free' | 'plus' | 'pro'
 * @param {string} [args.senderName]     Track owner's display name. First token is composited
 *                                       locally as the "by {First}" attribution on the artwork.
 *                                       Never sent to the AI provider. Intentionally excluded
 *                                       from the content hash so existing tracks aren't force-
 *                                       regenerated when the field is added.
 * @param {string} [args.previousContentHash]  From tracks.artwork_content_hash; skip if matches
 * @param {boolean} [args.forceRegenerate]     Skip the idempotency check (admin/debug only)
 * @param {Object} [args.dependencies]
 * @param {Function} [args.dependencies.providerFactory]  Override getImageProvider (testing)
 * @param {Function} [args.dependencies.compositeFn]      Override compositeArtworkWithText (testing)
 * @param {Function} [args.dependencies.libraryPathFn]    Override libraryPath (testing)
 * @param {Object}   [args.dependencies.storageProvider]  Optional S3 uploader
 * @param {Object}   [args.dependencies.logger]           { info, warn, error }
 *
 * @returns {Promise<Object>} {skipped, artworkPath, artworkUrl, styleVariant, source, contentHash, provider, prompt, moderationPassed}
 */
async function generateSongArtwork({
  userId,
  trackId,
  occasion,
  recipientName,
  senderName,
  tier,
  previousContentHash,
  forceRegenerate = false,
  dependencies = {},
}) {
  if (!userId || !trackId) {
    throw new Error("generateSongArtwork requires userId and trackId");
  }
  if (!VALID_OCCASIONS.has(occasion)) {
    throw new Error(`Invalid occasion: ${occasion}`);
  }

  const providerFactory = dependencies.providerFactory || getImageProvider;
  const compositeFn = dependencies.compositeFn || compositeArtworkWithText;
  const libraryPathFn = dependencies.libraryPathFn || libraryPath;
  const storageProvider = dependencies.storageProvider || null;
  const logger = dependencies.logger || console;

  const style = pickStyleVariant({ trackId, userId });
  if (!VALID_STYLES.has(style)) {
    // Defense-in-depth — STYLE_LIST is the source of truth and must stay in sync.
    throw new Error(`pickStyleVariant returned invalid style: ${style}`);
  }
  const contentHash = computeContentHash({ recipientName, occasion, style });

  if (
    !forceRegenerate &&
    previousContentHash &&
    previousContentHash === contentHash
  ) {
    return {
      skipped: true,
      reason: "unchanged",
      contentHash,
      styleVariant: style,
    };
  }

  const outDir = trackDir({ userId, trackId });
  ensureDir(outDir);

  const isPaid = PAID_TIERS.has(String(tier || "").toLowerCase());

  let baseImagePath = libraryPathFn(occasion, style);
  let source = "library";
  let prompt = null;
  let provider = null;
  let moderationPassed = true;

  if (isPaid) {
    const providerName = process.env.IMAGE_PROVIDER || "openai";
    provider = providerName;
    prompt = buildPrompt({ occasion, style });
    try {
      const adapter = providerFactory(providerName);
      // Pre-flight moderation — cheap pre-check before burning a $0.21 gen.
      // Soft-fail on infra issues so we don't gate on the moderation endpoint.
      if (typeof adapter.moderationCheck === "function") {
        const mod = await adapter.moderationCheck({ prompt });
        if (mod && mod.flagged) {
          moderationPassed = false;
          throw new ModerationRefusalError(
            `Pre-flight moderation flagged prompt for track ${trackId}`,
          );
        }
      }
      const buf = await adapter.generate({
        prompt,
        size: "1024x1536",
        quality: "high",
      });
      const generatedPath = path.join(outDir, "artwork_base.jpg");
      await fs.promises.writeFile(generatedPath, buf);
      baseImagePath = generatedPath;
      source = "generated";
      moderationPassed = true;
    } catch (err) {
      // Audit column is NOT NULL (migration 111). Conservative default: false
      // when a check never definitively passed. The `source` column ('fallback'
      // vs 'generated') distinguishes refusal from infra failure.
      if (err instanceof ModerationRefusalError) {
        moderationPassed = false;
      } else {
        moderationPassed = false;
        logger.warn(
          `[song-artwork] Provider ${providerName} failed for track ${trackId}; ` +
            `falling back to library. reason=${err && err.message}`,
        );
      }
      source = "fallback";
      baseImagePath = libraryPathFn(occasion, style);
    }
  }

  if (!fs.existsSync(baseImagePath)) {
    // Permanent config error — the library hasn't been bootstrapped. Mark as
    // non-transient so artwork-job's retry loop skips the 5/15/45s backoff.
    const err = new Error(
      `Artwork base missing — library not bootstrapped? Expected: ${baseImagePath}. ` +
        `Run scripts/build-artwork-library.mjs.`,
    );
    err.code = "LIBRARY_NOT_BOOTSTRAPPED";
    err.permanent = true;
    throw err;
  }

  const artworkPath = await compositeFn({
    baseImagePath,
    recipientName,
    senderName,
    occasion,
    outputDir: outDir,
    targetAspect: "9:16",
  });

  // Upload to remote storage when configured (S3 in production). Local dev
  // skips this since artworkPath is already at the served location.
  if (
    storageProvider &&
    storageProvider.type !== "local" &&
    typeof storageProvider.putFile === "function"
  ) {
    try {
      const remoteKey = trackArtworkKey({ userId, trackId });
      await storageProvider.putFile({
        key: remoteKey,
        filePath: artworkPath,
        contentType: "image/jpeg",
      });
      logger.info(
        `[song-artwork] Uploaded artwork to ${storageProvider.type} key=${remoteKey} (track=${trackId})`,
      );
    } catch (uploadErr) {
      logger.warn(
        `[song-artwork] S3 upload failed for track ${trackId}: ${uploadErr.message}. ` +
          `Artwork stays available locally; cross-instance fetches will 404 until regenerate.`,
      );
    }
  }

  const versionStamp = Date.now();

  return {
    skipped: false,
    artworkPath,
    artworkUrl: `/tracks/${trackId}/artwork.jpg?v=${versionStamp}`,
    styleVariant: style,
    source,
    contentHash,
    provider,
    prompt,
    moderationPassed,
    generatedAt: new Date(versionStamp),
  };
}

module.exports = {
  generateSongArtwork,
  pickStyleVariant,
  computeContentHash,
  libraryPath,
  STYLE_LIST,
};
