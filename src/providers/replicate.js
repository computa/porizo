const path = require("path");
const { fetchJson, downloadToFile, ensureDir } = require("./http");
const { pollWithBackoff, createPollingConfig } = require("../utils/polling");

/**
 * Wait for a Replicate prediction to complete with exponential backoff
 * @param {Object} options - Wait options
 * @param {string} options.baseUrl - Replicate API base URL
 * @param {string} options.token - Replicate API token
 * @param {string} options.predictionId - Prediction ID to wait for
 * @param {number} options.timeoutMs - Maximum wait time
 * @returns {Promise<Object>} Completed prediction result
 */
async function waitForPrediction({ baseUrl, token, predictionId, timeoutMs }) {
  const pollingConfig = createPollingConfig("replicate");

  // Derive max attempts from timeoutMs if provided (convert timeout to attempt count)
  // Average interval approximation: (initial + max) / 2 = (2000 + 15000) / 2 = 8500ms
  const avgIntervalMs = (pollingConfig.initialIntervalMs + pollingConfig.maxIntervalMs) / 2;
  const derivedMaxAttempts = timeoutMs
    ? Math.max(5, Math.ceil(timeoutMs / avgIntervalMs))
    : pollingConfig.maxAttempts;

  try {
    const pollResult = await pollWithBackoff(
      async () => {
        const result = await fetchJson(
          `${baseUrl}/v1/predictions/${predictionId}`,
          {
            headers: { Authorization: `Token ${token}` },
          },
          30000 // Individual request timeout
        );

        if (result.status === "succeeded") {
          return { done: true, result };
        }
        if (result.status === "failed" || result.status === "canceled") {
          return {
            done: false,
            failed: true,
            error: result.error || "Prediction failed",
          };
        }
        return { done: false, result };
      },
      {
        ...pollingConfig,
        maxAttempts: derivedMaxAttempts,
        onPoll: (attempt, interval) => {
          console.log(`[Replicate] Polling prediction ${predictionId}, attempt ${attempt}/${derivedMaxAttempts}, next interval: ${interval}ms`);
        },
      }
    );
    return pollResult.result;
  } catch (pollErr) {
    const errMessage = pollErr?.message ?? String(pollErr || "unknown error");
    const errorType = errMessage.includes("Prediction failed") ? "failed"
      : (errMessage.includes("exceeded") || errMessage.includes("timeout")) ? "timeout"
      : "poll_error";
    throw new Error(`replicate_${errorType}: prediction=${predictionId}, ${errMessage}`);
  }
}

function normalizeOutputUrl(output) {
  if (!output) {
    return null;
  }
  if (Array.isArray(output)) {
    return output[0];
  }
  if (typeof output === "string") {
    return output;
  }
  if (typeof output === "object" && output.url) {
    return output.url;
  }
  return null;
}

async function convertVoice({
  baseUrl,
  token,
  modelVersion,
  storageDir,
  track,
  trackVersion,
  inputUrl,
  timeoutMs,
  kind,
  _similarityStrength,
  rvcModel = "Squidward", // Configurable AI voice model
}) {
  // Input validation
  if (!token) {
    throw new Error("E302_REPLICATE_ERROR: API token is required");
  }
  if (!modelVersion) {
    throw new Error("E302_REPLICATE_ERROR: Model version is required");
  }
  if (!track || !track.user_id || !track.id) {
    throw new Error("E302_REPLICATE_ERROR: Valid track with user_id and id required");
  }
  if (!trackVersion || !trackVersion.version_num) {
    throw new Error("E302_REPLICATE_ERROR: Valid trackVersion with version_num required");
  }
  if (!inputUrl) {
    throw new Error("E302_REPLICATE_ERROR: Input URL is required");
  }

  console.log(`[Replicate] Starting voice conversion for track ${track.id}, kind: ${kind}, model: ${rvcModel}`);

  // VOICE MODE ARCHITECTURE:
  // - "ai_voice" mode: Uses pre-trained RVC models (this function) with configurable rvcModel
  // - "user_voice" mode: Uses Seed-VC for zero-shot voice cloning (see seedvc.js)
  // The rvcModel parameter allows configuring different AI voice characters.
  // Default: "Squidward" for testing; production should use appropriate voice models.

  const payload = {
    version: modelVersion,
    input: {
      // RVC model parameters (zsxkib/realistic-voice-cloning)
      song_input: inputUrl,
      rvc_model: rvcModel, // Configurable AI voice model (default: "Squidward")
      pitch_detection_algorithm: "rmvpe",
      index_rate: 0.5,
      filter_radius: 3,
      rms_mix_rate: 0.25,
      protect: 0.33,
      output_format: "mp3",
    },
  };
  const prediction = await fetchJson(
    `${baseUrl}/v1/predictions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Token ${token}`,
      },
      body: JSON.stringify(payload),
    },
    timeoutMs
  );

  // Check if prediction was created successfully
  if (!prediction || !prediction.id) {
    const errorDetail = prediction?.detail || prediction?.error || "Unknown error";
    console.error(`[Replicate] Failed to create prediction for track ${track.id}:`, errorDetail);
    throw new Error(`provider_error:${prediction?.status || 500}:${JSON.stringify(prediction || {})}`);
  }

  console.log(`[Replicate] Prediction created: ${prediction.id}`);

  const finished = await waitForPrediction({
    baseUrl,
    token,
    predictionId: prediction.id,
    timeoutMs,
  });

  if (finished.status !== "succeeded") {
    console.error(`[Replicate] Voice conversion failed for track ${track.id}:`, finished.error || "unknown");
    throw new Error(`replicate_failed:${finished.error || "unknown"}`);
  }

  const outputUrl = normalizeOutputUrl(finished.output);
  if (!outputUrl) {
    console.error(`[Replicate] No output URL in response for track ${track.id}`);
    throw new Error("replicate_missing_output");
  }

  console.log(`[Replicate] Voice conversion completed for track ${track.id}, prediction: ${finished.id}`);
  const versionDir = path.join(
    storageDir,
    "tracks",
    track.user_id,
    track.id,
    `v${trackVersion.version_num}`
  );
  ensureDir(versionDir);
  const fileName = kind === "preview" ? "user_vocal.wav" : "user_vocal_full.wav";
  await downloadToFile(outputUrl, path.join(versionDir, fileName), timeoutMs);
  return {
    file: fileName,
    output_url: outputUrl,
    prediction_id: finished.id,
  };
}

/**
 * Extract voice embedding using ECAPA-TDNN model via Replicate
 * @param {Object} options
 * @param {string} options.baseUrl - Replicate API base URL
 * @param {string} options.token - Replicate API token
 * @param {string} options.modelVersion - Model version hash for embedding extraction
 * @param {string} options.audioUrl - URL of audio file to extract embedding from
 * @param {number} options.timeoutMs - Request timeout in milliseconds
 * @returns {Promise<{embedding_url: string, prediction_id: string}>}
 */
async function extractEmbedding({
  baseUrl,
  token,
  modelVersion,
  audioUrl,
  timeoutMs,
}) {
  if (!token) {
    throw new Error("replicate_missing_token");
  }
  if (!modelVersion) {
    throw new Error("replicate_missing_model_version");
  }
  if (!audioUrl) {
    throw new Error("replicate_missing_audio_url");
  }

  console.log(`[Replicate] Starting embedding extraction, model: ${modelVersion.slice(0, 12)}...`);
  const payload = {
    version: modelVersion,
    input: {
      audio: audioUrl,
    },
  };

  const prediction = await fetchJson(
    `${baseUrl}/v1/predictions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Token ${token}`,
      },
      body: JSON.stringify(payload),
    },
    timeoutMs
  );

  // Validate prediction response before using
  if (!prediction || !prediction.id) {
    const errorDetail = prediction?.detail || prediction?.error || "Unknown error";
    console.error(`[Replicate] Failed to create embedding prediction:`, errorDetail);
    throw new Error(`replicate_prediction_failed:${errorDetail}`);
  }

  const finished = await waitForPrediction({
    baseUrl,
    token,
    predictionId: prediction.id,
    timeoutMs,
  });

  if (finished.status !== "succeeded") {
    console.error(`[Replicate] Embedding extraction failed:`, finished.error || "unknown");
    throw new Error(`replicate_failed:${finished.error || "unknown"}`);
  }

  const embeddingUrl = normalizeOutputUrl(finished.output);
  if (!embeddingUrl) {
    console.error(`[Replicate] No embedding URL in response, prediction: ${finished.id}`);
    throw new Error("replicate_missing_embedding");
  }

  console.log(`[Replicate] Embedding extraction completed, prediction: ${finished.id}`);
  return {
    embedding_url: embeddingUrl,
    prediction_id: finished.id,
  };
}

module.exports = {
  convertVoice,
  extractEmbedding,
};
