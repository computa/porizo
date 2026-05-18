/**
 * Image provider registry.
 *
 * Adds a layer of indirection so a single env var (`IMAGE_PROVIDER`) switches
 * between providers. New adapters drop in below; they must export the same
 * shape as `openai-image.js`: { name, model, dataHandling, generate, ModerationRefusalError, ImageGenerationError }.
 */

const openai = require("./openai-image");
const flux = require("./flux-image");

const PROVIDERS = {
  openai,
  flux,
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
  // Re-export error classes from the OpenAI adapter. Each adapter defines its
  // own error classes (Flux's extend Error directly, not openai.ModerationRefusalError),
  // so this re-export only covers the OpenAI-routed path today. Task 7 rewires
  // song-artwork.js to handle both adapters' refusals — likely via `err.name ===
  // "ModerationRefusalError"` duck-typing rather than a sibling instanceof check.
  ModerationRefusalError: openai.ModerationRefusalError,
  ImageGenerationError: openai.ImageGenerationError,
};
