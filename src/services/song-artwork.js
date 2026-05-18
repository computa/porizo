const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { ensureDir } = require("../utils/common");
const { OCCASIONS, getDefault } = require("./artwork-vocab");
const {
  PROMPT_TEMPLATE_VERSION,
  assemblePrompt,
  assembleNegativePrompt,
} = require("./artwork-prompts");
const {
  getImageProvider,
  ModerationRefusalError,
} = require("./image-providers");
const { compositeArtworkWithText } = require("./cover-generator");
const { trackArtworkKey } = require("../storage");

const PAID_TIERS = new Set(["plus", "pro"]);
const FREE_LIBRARY_VARIANT_COUNT = 5;
const GENERATED_IMAGE_DIM = 2048;
const MIN_PROVIDER_IMAGE_BYTES = 1024;
const MIN_PROVIDER_IMAGE_WIDTH = 1280;
const MIN_PROVIDER_IMAGE_HEIGHT = 1280;

const STORAGE_ROOT =
  process.env.STORAGE_ROOT || path.resolve(process.cwd(), "storage");
const PRIMARY_PROVIDER = process.env.IMAGE_PROVIDER || "flux";
const FALLBACK_PROVIDER = "openai";

function libraryPath(occasion, variantIndex) {
  return path.join(
    STORAGE_ROOT,
    "artwork-library",
    "v2",
    occasion,
    `${variantIndex}.jpg`,
  );
}

function pickLibraryVariant({ trackId, userId }) {
  const h = crypto
    .createHash("sha1")
    .update(`${userId}:${trackId}`)
    .digest("hex");
  const n = parseInt(h.slice(0, 8), 16);
  return n % FREE_LIBRARY_VARIANT_COUNT;
}

function trackDir({ userId, trackId }) {
  return path.join(STORAGE_ROOT, "tracks", userId, trackId);
}

function computeContentHash({ occasion, artworkVars, promptVersion }) {
  // recipient_name is excluded — it's never in the prompt.
  // imperfection IS included because it changes the image.
  const normalized = JSON.stringify({
    occasion,
    species: artworkVars.species,
    lighting: artworkVars.lighting,
    palette: artworkVars.palette,
    density: artworkVars.density,
    imperfection: artworkVars.imperfection,
    backdrop: artworkVars.backdrop,
    promptVersion,
  });
  return crypto.createHash("sha1").update(normalized).digest("hex");
}

async function prepareGeneratedBaseImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < MIN_PROVIDER_IMAGE_BYTES) {
    throw new Error(
      `Image provider returned invalid buffer (${buffer && buffer.length} bytes)`,
    );
  }
  const sharp = require("sharp");
  const metadata = await sharp(buffer, { failOn: "error" }).metadata();
  const w = Number(metadata.width || 0);
  const h = Number(metadata.height || 0);
  if (w < MIN_PROVIDER_IMAGE_WIDTH || h < MIN_PROVIDER_IMAGE_HEIGHT) {
    throw new Error(`Provider returned undersized image (${w}x${h})`);
  }
  return sharp(buffer, { failOn: "error" })
    .rotate()
    .resize(GENERATED_IMAGE_DIM, GENERATED_IMAGE_DIM, {
      fit: "cover",
      position: "center",
    })
    .jpeg({ quality: 92, progressive: true, mozjpeg: true })
    .toBuffer();
}

async function tryProviderChain({
  prompt,
  negativePrompt,
  providerFactory,
  logger,
}) {
  // 1. Try primary (Flux by default)
  try {
    const primary = providerFactory(PRIMARY_PROVIDER);
    const buf = await primary.generate({ prompt, negativePrompt });
    return { buf, provider: PRIMARY_PROVIDER };
  } catch (err) {
    if (
      err instanceof ModerationRefusalError ||
      (err && err.name === "ModerationRefusalError")
    ) {
      // No retry on moderation — same prompt will refuse on OpenAI too.
      throw err;
    }
    logger.warn(
      `[song-artwork] primary ${PRIMARY_PROVIDER} failed: ${err.message}; retrying on ${FALLBACK_PROVIDER}`,
    );
  }
  // 2. Try fallback (OpenAI)
  const fallback = providerFactory(FALLBACK_PROVIDER);
  if (typeof fallback.moderationCheck === "function") {
    const mod = await fallback.moderationCheck({ prompt });
    if (mod && mod.flagged) {
      throw new ModerationRefusalError("fallback moderation refused prompt");
    }
  }
  const buf = await fallback.generate({
    prompt,
    size: "1024x1024",
    quality: "high",
  });
  return { buf, provider: FALLBACK_PROVIDER };
}

async function generateSongArtwork({
  userId,
  trackId,
  occasion,
  recipientName,
  senderName,
  tier,
  artworkVars,
  previousContentHash,
  forceRegenerate = false,
  dependencies = {},
}) {
  if (!userId || !trackId)
    throw new Error("generateSongArtwork requires userId and trackId");
  if (!OCCASIONS.includes(occasion))
    throw new Error(`Invalid occasion: ${occasion}`);

  const providerFactory = dependencies.providerFactory || getImageProvider;
  const compositeFn = dependencies.compositeFn || compositeArtworkWithText;
  const prepareGeneratedImageFn =
    dependencies.prepareGeneratedImageFn || prepareGeneratedBaseImage;
  const libraryPathFn = dependencies.libraryPathFn || libraryPath;
  const storageProvider = dependencies.storageProvider || null;
  const logger = dependencies.logger || console;

  const vars = artworkVars || {
    ...getDefault(occasion),
    picked_by: "fallback_no_extractor",
    picked_at: new Date().toISOString(),
  };
  const promptVersion = PROMPT_TEMPLATE_VERSION;
  const contentHash = computeContentHash({
    occasion,
    artworkVars: vars,
    promptVersion,
  });

  if (
    !forceRegenerate &&
    previousContentHash &&
    previousContentHash === contentHash
  ) {
    return {
      skipped: true,
      reason: "unchanged",
      contentHash,
      artworkVars: vars,
      promptVersion,
    };
  }

  const outDir = trackDir({ userId, trackId });
  ensureDir(outDir);
  const isPaid = PAID_TIERS.has(String(tier || "").toLowerCase());
  const v2Enabled =
    String(process.env.ARTWORK_V2_ENABLED || "true").toLowerCase() !== "false";
  const useGenerator = isPaid && v2Enabled;

  let baseImagePath;
  let source = "fallback";
  let provider = null;
  let prompt = null;
  let moderationPassed = true;

  if (useGenerator) {
    prompt = assemblePrompt({ occasion, vars });
    const negativePrompt = assembleNegativePrompt();
    try {
      const { buf, provider: usedProvider } = await tryProviderChain({
        prompt,
        negativePrompt,
        providerFactory,
        logger,
      });
      const normalized = await prepareGeneratedImageFn(buf);
      const generatedPath = path.join(outDir, "artwork_base.jpg");
      await fs.promises.writeFile(generatedPath, normalized);
      baseImagePath = generatedPath;
      source = "generated";
      provider = usedProvider;
    } catch (err) {
      if (
        err instanceof ModerationRefusalError ||
        (err && err.name === "ModerationRefusalError")
      ) {
        moderationPassed = false;
        logger.warn(
          `[song-artwork] moderation refusal for track ${trackId}; using library`,
        );
      } else {
        moderationPassed = false;
        logger.warn(
          `[song-artwork] all providers failed for track ${trackId}: ${err.message}; using library`,
        );
      }
      source = "fallback";
      const variant = pickLibraryVariant({ userId, trackId });
      baseImagePath = libraryPathFn(occasion, variant);
    }
  } else {
    const variant = pickLibraryVariant({ userId, trackId });
    baseImagePath = libraryPathFn(occasion, variant);
    source = "library";
  }

  if (!fs.existsSync(baseImagePath)) {
    const err = new Error(
      `Artwork base missing — library v2 not bootstrapped? Expected: ${baseImagePath}. ` +
        `Run scripts/build-artwork-library-v2.mjs.`,
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
    targetAspect: "1:1",
  });

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
    } catch (uploadErr) {
      logger.warn(
        `[song-artwork] S3 upload failed for track ${trackId}: ${uploadErr.message}`,
      );
    }
  }

  const versionStamp = Date.now();
  return {
    skipped: false,
    artworkPath,
    artworkUrl: `/tracks/${trackId}/artwork.jpg?v=${versionStamp}`,
    source,
    provider,
    prompt,
    moderationPassed,
    promptVersion,
    artworkVars: vars,
    contentHash,
    generatedAt: new Date(versionStamp),
  };
}

module.exports = {
  generateSongArtwork,
  pickLibraryVariant,
  computeContentHash,
  prepareGeneratedBaseImage,
  libraryPath,
  PROMPT_TEMPLATE_VERSION,
  FREE_LIBRARY_VARIANT_COUNT,
};
