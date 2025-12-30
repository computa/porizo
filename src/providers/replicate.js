const path = require("path");
const { fetchJson, downloadToFile, ensureDir } = require("./http");

async function waitForPrediction({ baseUrl, token, predictionId, timeoutMs }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await fetchJson(
      `${baseUrl}/v1/predictions/${predictionId}`,
      {
        headers: { Authorization: `Token ${token}` },
      },
      timeoutMs
    );
    if (result.status === "succeeded" || result.status === "failed") {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("replicate_timeout");
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
  similarityStrength,
}) {
  const payload = {
    version: modelVersion,
    input: {
      audio: inputUrl,
      similarity_strength: similarityStrength || "medium",
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

  const finished = await waitForPrediction({
    baseUrl,
    token,
    predictionId: prediction.id,
    timeoutMs,
  });

  if (finished.status !== "succeeded") {
    throw new Error(`replicate_failed:${finished.error || "unknown"}`);
  }

  const outputUrl = normalizeOutputUrl(finished.output);
  if (!outputUrl) {
    throw new Error("replicate_missing_output");
  }

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

  const finished = await waitForPrediction({
    baseUrl,
    token,
    predictionId: prediction.id,
    timeoutMs,
  });

  if (finished.status !== "succeeded") {
    throw new Error(`replicate_failed:${finished.error || "unknown"}`);
  }

  const embeddingUrl = normalizeOutputUrl(finished.output);
  if (!embeddingUrl) {
    throw new Error("replicate_missing_embedding");
  }

  return {
    embedding_url: embeddingUrl,
    prediction_id: finished.id,
  };
}

module.exports = {
  convertVoice,
  extractEmbedding,
};
