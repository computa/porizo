/**
 * Image provider registry.
 *
 * Adds a layer of indirection so a single env var (`IMAGE_PROVIDER`) switches
 * between providers. New adapters drop in below; they must export the same
 * shape as `openai-image.js`: { name, model, dataHandling, generate, ModerationRefusalError, ImageGenerationError }.
 */

const openai = require("./openai-image");

const PROVIDERS = {
  openai,
  // 'gemini': require('./gemini-image'),  // Nano Banana / Gemini 2.5 Flash Image — defer until needed
  // 'xai':    require('./xai-image'),     // Grok Image — defer until needed
};

function getImageProvider(name = process.env.IMAGE_PROVIDER || "openai") {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(
      `Unknown image provider: ${name}. Available: ${Object.keys(PROVIDERS).join(", ")}`,
    );
  }
  return provider;
}

module.exports = {
  getImageProvider,
  // Re-export error classes from the default provider for convenient catch blocks.
  // ModerationRefusalError is used by song-artwork.js to decide the fallback path.
  // ImageGenerationError is the generic envelope tests assert against.
  ModerationRefusalError: openai.ModerationRefusalError,
  ImageGenerationError: openai.ImageGenerationError,
};
