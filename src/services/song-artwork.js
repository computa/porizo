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
  ImageGenerationError,
} = require("./image-providers");
const { compositeArtworkWithText } = require("./cover-generator");
const { trackArtworkKey } = require("../storage");

const PAID_TIERS = new Set(["plus", "pro"]);
const FREE_LIBRARY_VARIANT_COUNT = 5;
const GENERATED_IMAGE_DIM = 2048;
const MIN_PROVIDER_IMAGE_BYTES = 1024;
// Floor matches OpenAI's max square (1024×1024 from gpt-image-2) so the OpenAI
// fallback path is reachable. Flux returns 2048×2048; both pass and get
// resized up to GENERATED_IMAGE_DIM via the sharp pipeline below.
const MIN_PROVIDER_IMAGE_WIDTH = 1024;
const MIN_PROVIDER_IMAGE_HEIGHT = 1024;

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
  // recipient_name is excluded — it's PII and is composited as overlay text
  // AFTER generation (see cover-generator.js), never passed to the image
  // model. Keeping it out of the hash also means two recipients with the same
  // vars share a cache slot.
  // imperfection IS included because it changes the generated image.
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
  let primaryError = null;
  try {
    const primary = providerFactory(PRIMARY_PROVIDER);
    const buf = await primary.generate({ prompt, negativePrompt });
    return { buf, provider: PRIMARY_PROVIDER };
  } catch (err) {
    if (
      err instanceof ModerationRefusalError ||
      (err && err.name === "ModerationRefusalError")
    ) {
      // Treat a moderation refusal as authoritative — surface it to the
      // outer handler so the caller drops to the library fallback. We don't
      // retry on OpenAI here because the policy contract is "one provider's
      // refusal ends the attempt"; we don't want to burn a second API call
      // (and quota, and latency) on a prompt the system has already deemed
      // unsafe. The fallback path below DOES still run OpenAI's pre-flight
      // moderationCheck — that's a different code path triggered only by
      // non-moderation infra failures.
      throw err;
    }
    primaryError = err;
    logger.warn(
      `[song-artwork] primary ${PRIMARY_PROVIDER} failed: ${err.message}; retrying on ${FALLBACK_PROVIDER}`,
    );
  }
  // 2. Try fallback (OpenAI). If it ALSO fails, wrap both errors so the
  // outer caller can log the full failure surface instead of dropping the
  // primary error on the floor.
  try {
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
  } catch (fallbackErr) {
    if (
      fallbackErr instanceof ModerationRefusalError ||
      (fallbackErr && fallbackErr.name === "ModerationRefusalError")
    ) {
      // Fallback's pre-flight moderation refused — propagate as a moderation
      // event (the prompt itself is the problem). The primary error context
      // is irrelevant here.
      throw fallbackErr;
    }
    // Both providers had infra failures. Re-throw a wrapped error carrying
    // both contexts so the outer logger sees Flux+OpenAI in one line.
    const wrapped = new ImageGenerationError(
      `both providers failed — primary(${PRIMARY_PROVIDER})=${primaryError ? primaryError.message : "n/a"}; fallback(${FALLBACK_PROVIDER})=${fallbackErr.message}`,
      { primary: primaryError, fallback: fallbackErr },
    );
    wrapped.primaryError = primaryError;
    wrapped.fallbackError = fallbackErr;
    throw wrapped;
  }
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
  let uploadFailed = false;

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
        // Real moderation event — the prompt was refused. moderation_passed=false
        // is the operator's signal that this row needs content review, not ops.
        moderationPassed = false;
        logger.warn(
          `[song-artwork] moderation refusal for track ${trackId}; using library`,
        );
      } else {
        // Infrastructure failure — keep moderation_passed=true so the row's
        // (source=fallback, moderation_passed=true) combination identifies
        // "infra failed" without a schema change. Log at error level so this
        // pages ops, not just shows up as a warn in info-volume logs.
        const primaryMsg =
          err && err.primaryError ? err.primaryError.message : null;
        const fallbackMsg =
          err && err.fallbackError ? err.fallbackError.message : err.message;
        logger.error(
          `[song-artwork] all providers failed for track ${trackId}; using library — primary=${primaryMsg || "n/a"}; fallback=${fallbackMsg}`,
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
      // Remote upload failed but the local file landed — render is artistically
      // complete. We must NOT silently return success: the caller persists
      // artworkUrl as the canonical pointer, and any cross-instance reader
      // (redeployed worker, share-link service on a different box) will 404
      // because the file lives only on this box's disk. Surface uploadFailed
      // so the caller can re-attempt or flag the row for ops attention.
      uploadFailed = true;
      logger.error(
        `[song-artwork] S3 upload failed for track ${trackId}: ${uploadErr.message} — local file persists, but cross-instance reads will 404 until reuploaded`,
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
    uploadFailed,
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
