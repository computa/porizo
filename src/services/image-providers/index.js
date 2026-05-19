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
  // Re-export OpenAI's error classes for legacy callers that import error
  // shapes directly from the registry. Each adapter defines its OWN classes
  // (Flux's `ModerationRefusalError` extends `Error` directly — it is NOT a
  // subclass of openai.ModerationRefusalError), so any consumer that may
  // receive errors from EITHER adapter must duck-type via
  //   err instanceof ModerationRefusalError || err?.name === "ModerationRefusalError"
  // See `tryProviderChain` in src/services/song-artwork.js for the canonical
  // dual-check; never use bare `instanceof` against this re-export when the
  // primary provider might be Flux.
  ModerationRefusalError: openai.ModerationRefusalError,
  ImageGenerationError: openai.ImageGenerationError,
};
