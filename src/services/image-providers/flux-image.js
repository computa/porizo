/**
 * Flux 1.1 Pro Ultra adapter via Replicate.
 *
 * Endpoint: POST https://api.replicate.com/v1/predictions
 * Model:    black-forest-labs/flux-1.1-pro-ultra
 * Output:   2048×2048 native JPEG; we request aspect_ratio "1:1" + output_format "jpg".
 *
 * Cost:    ~$0.06 per image (May 2026 pricing).
 *
 * Errors:
 *   ModerationRefusalError — Replicate's safety checker rejected the prompt or output.
 *   ImageGenerationError   — any other failure (timeout, 5xx, malformed response).
 */

const NAME = "flux";
const MODEL = "black-forest-labs/flux-1.1-pro-ultra";
const BASE_URL = "https://api.replicate.com";
const PREDICTIONS_URL = `${BASE_URL}/v1/predictions`;
const DEFAULT_TIMEOUT_MS = (() => {
  const raw = parseInt(process.env.FLUX_TIMEOUT_MS || "120000", 10);
  // Mirrors openai-image.js: clamp to sane bounds, fall back to the default
  // on malformed input so a typo in env doesn't make the polling loop exit
  // immediately with "timed out after NaNms".
  if (!Number.isFinite(raw) || raw < 5_000 || raw > 600_000) return 120_000;
  return raw;
})();
const POLL_INTERVAL_MS = 2000;
const DOWNLOAD_TIMEOUT_MS = 30_000;

const dataHandling = {
  processorLocation: "US (Replicate)",
  retention:
    "Replicate retains prediction inputs for 30 days for debugging; configure org-level deletion if stricter retention is needed.",
  containsPII: false,
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

function isModerationFailure(replicateError) {
  if (!replicateError) return false;
  const msg = String(replicateError).toLowerCase();
  return (
    msg.includes("nsfw") ||
    msg.includes("safety_checker") ||
    msg.includes("content policy")
  );
}

async function generate({
  prompt,
  negativePrompt,
  apiKey,
  size: _size, // ignored — Flux Pro Ultra is fixed at 2048×2048
  quality: _quality, // ignored — single quality tier
  fetchFn = fetch,
  sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  if (!prompt || typeof prompt !== "string") {
    throw new ImageGenerationError(
      "generate() requires a non-empty prompt string",
    );
  }
  const token = apiKey || process.env.REPLICATE_API_TOKEN;
  if (!token) {
    throw new ImageGenerationError("REPLICATE_API_TOKEN is not set");
  }

  // 1. POST to create prediction
  let createResp;
  try {
    createResp = await fetchFn(PREDICTIONS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Token ${token}`,
      },
      body: JSON.stringify({
        model: MODEL,
        input: {
          prompt,
          negative_prompt: negativePrompt || "",
          aspect_ratio: "1:1",
          output_format: "jpg",
          output_quality: 92,
          safety_tolerance: 2, // default; lower number = stricter
        },
      }),
    });
  } catch (err) {
    throw new ImageGenerationError(
      `Network error contacting Replicate: ${err.message}`,
      err,
    );
  }
  if (!createResp.ok && createResp.status !== 201) {
    let payload = null;
    try {
      payload = await createResp.json();
    } catch {
      /* ignore */
    }
    throw new ImageGenerationError(
      `Replicate create failed: HTTP ${createResp.status} ${(payload && payload.detail) || ""}`,
      payload,
    );
  }
  const created = await createResp.json();
  if (!created || !created.id) {
    throw new ImageGenerationError(
      `Replicate response missing prediction id`,
      created,
    );
  }
  if (created.status === "failed" && isModerationFailure(created.error)) {
    throw new ModerationRefusalError(
      `Flux refused generation: ${created.error}`,
      created,
    );
  }
  const predictionId = created.id;

  // 2. Poll for completion
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  let prediction = created;
  while (prediction.status !== "succeeded" && Date.now() < deadline) {
    if (prediction.status === "failed" || prediction.status === "canceled") {
      if (isModerationFailure(prediction.error)) {
        throw new ModerationRefusalError(
          `Flux failed (moderation): ${prediction.error}`,
          prediction,
        );
      }
      throw new ImageGenerationError(
        `Flux prediction ${prediction.status}: ${prediction.error || "unknown"}`,
        prediction,
      );
    }
    await sleepFn(POLL_INTERVAL_MS);
    let pollResp;
    try {
      pollResp = await fetchFn(`${PREDICTIONS_URL}/${predictionId}`, {
        headers: { Authorization: `Token ${token}` },
      });
    } catch (err) {
      throw new ImageGenerationError(
        `Network error polling Replicate: ${err.message}`,
        err,
      );
    }
    if (!pollResp.ok) {
      throw new ImageGenerationError(
        `Replicate poll failed: HTTP ${pollResp.status}`,
      );
    }
    prediction = await pollResp.json();
  }
  if (prediction.status !== "succeeded") {
    throw new ImageGenerationError(
      `Flux timed out after ${DEFAULT_TIMEOUT_MS}ms`,
    );
  }

  // 3. Normalize output URL — Replicate returns string or array of strings
  const outputUrl = Array.isArray(prediction.output)
    ? prediction.output[0]
    : prediction.output;
  if (!outputUrl) {
    throw new ImageGenerationError(`Flux returned no output URL`, prediction);
  }

  // 4. Download image bytes
  // Bound the download so a stuck Replicate CDN can't hang the whole job
  // until the surrounding 5/15/45s retry policy kicks in. `fetchFn` is
  // injectable for tests; we attempt to pass `signal` but fall back silently
  // if the injected fake doesn't honor it.
  let downloadResp;
  const dlController =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const dlTimer = dlController
    ? setTimeout(() => dlController.abort(), DOWNLOAD_TIMEOUT_MS)
    : null;
  try {
    downloadResp = await fetchFn(
      outputUrl,
      dlController ? { signal: dlController.signal } : undefined,
    );
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new ImageGenerationError(
        `Flux output download timed out after ${DOWNLOAD_TIMEOUT_MS}ms`,
        err,
      );
    }
    throw new ImageGenerationError(
      `Failed to download Flux output: ${err.message}`,
      err,
    );
  } finally {
    if (dlTimer) clearTimeout(dlTimer);
  }
  if (!downloadResp.ok) {
    throw new ImageGenerationError(
      `Flux output download HTTP ${downloadResp.status}`,
    );
  }
  const arrayBuffer = await downloadResp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = {
  name: NAME,
  model: MODEL,
  dataHandling,
  generate,
  // No moderationCheck export — Replicate gates at generation time; pre-flight moderation is OpenAI's responsibility.
  ModerationRefusalError,
  ImageGenerationError,
};
