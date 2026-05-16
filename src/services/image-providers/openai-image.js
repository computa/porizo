/**
 * OpenAI image generation adapter (gpt-image-2).
 *
 * Endpoint: POST https://api.openai.com/v1/images/generations
 * Model:    gpt-image-2 (April 2026; current OpenAI default)
 * Pricing reference (1024×1024):
 *   low:    $0.006
 *   medium: $0.053
 *   high:   $0.211
 *
 * Moderation refusal is surfaced as a typed ModerationRefusalError so the job
 * handler can fall back to the curated library without retrying.
 */

const NAME = "openai";
const ENDPOINT = "https://api.openai.com/v1/images/generations";
const MODEL = "gpt-image-2";
const VALID_SIZES = new Set(["1024x1024", "1024x1536", "1536x1024"]);
const VALID_QUALITIES = new Set(["low", "medium", "high"]);

// Hard timeout for the OpenAI fetch. Empirically gpt-image-2 high-quality
// 1024x1536 lands at 108-115s with occasional spillover, so 180s gives one
// retry's worth of headroom before the typed retry policy kicks in.
// Configurable via env so ops can tune without a code change.
const OPENAI_TIMEOUT_MS = (() => {
  const raw = parseInt(process.env.OPENAI_IMAGE_TIMEOUT_MS || "180000", 10);
  if (!Number.isFinite(raw) || raw < 5000 || raw > 600000) return 180000;
  return raw;
})();

const dataHandling = {
  processorLocation: "US",
  retention:
    "Per OpenAI Enterprise terms — inputs not used for training when API key has zero-retention flag set",
  containsPII: false, // recipient_name MUST NOT be in the prompt; only neutral subject/style.
};

class ModerationRefusalError extends Error {
  constructor(message, originalError) {
    super(message);
    this.name = "ModerationRefusalError";
    this.code = "moderation_blocked";
    this.cause = originalError;
  }
}

class ImageGenerationError extends Error {
  constructor(message, originalError) {
    super(message);
    this.name = "ImageGenerationError";
    this.cause = originalError;
  }
}

/**
 * Generate one image and return the raw bytes as a Buffer.
 *
 * @param {Object} params
 * @param {string} params.prompt    Full prompt; recipient PII must NOT appear here.
 * @param {string} [params.size]    "1024x1024" | "1024x1536" | "1536x1024" (default: 1024x1536)
 * @param {string} [params.quality] "low" | "medium" | "high" (default: "high")
 * @param {string} [params.apiKey]  Overrides env (used by the library-bootstrap script)
 * @returns {Promise<Buffer>} PNG/JPEG bytes
 * @throws {ModerationRefusalError} when OpenAI rejects the prompt
 * @throws {ImageGenerationError}   for any other failure
 */
async function generate({
  prompt,
  size = "1024x1536",
  quality = "high",
  apiKey,
} = {}) {
  if (!prompt || typeof prompt !== "string") {
    throw new ImageGenerationError(
      "generate() requires a non-empty prompt string",
    );
  }
  if (!VALID_SIZES.has(size)) {
    throw new ImageGenerationError(
      `Invalid size: ${size}. Expected one of ${[...VALID_SIZES].join(", ")}`,
    );
  }
  if (!VALID_QUALITIES.has(quality)) {
    throw new ImageGenerationError(
      `Invalid quality: ${quality}. Expected one of ${[...VALID_QUALITIES].join(", ")}`,
    );
  }

  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) {
    throw new ImageGenerationError("OPENAI_API_KEY is not set");
  }

  let response;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        size,
        quality,
        n: 1,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new ImageGenerationError(
        `OpenAI request timed out after ${OPENAI_TIMEOUT_MS}ms`,
        err,
      );
    }
    throw new ImageGenerationError(
      `Network error contacting OpenAI: ${err.message}`,
      err,
    );
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // ignore JSON parse — payload will stay null
    }
    const code = payload && payload.error && payload.error.code;
    if (response.status === 400 && code === "moderation_blocked") {
      throw new ModerationRefusalError(
        `OpenAI refused generation: ${payload.error.message || "moderation_blocked"}`,
        payload,
      );
    }
    const message =
      (payload && payload.error && payload.error.message) ||
      `HTTP ${response.status} from OpenAI`;
    throw new ImageGenerationError(message, payload);
  }

  const data = await response.json();
  const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) {
    throw new ImageGenerationError(
      "OpenAI response missing b64_json field",
      data,
    );
  }

  return Buffer.from(b64, "base64");
}

module.exports = {
  name: NAME,
  model: MODEL,
  dataHandling,
  generate,
  ModerationRefusalError,
  ImageGenerationError,
};
