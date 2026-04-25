/**
 * Seed-VC Provider - Zero-shot singing voice conversion via Hugging Face Space
 *
 * Uses the Gradio client to call the Plachta/Seed-VC Space for converting
 * a source audio (guide vocal) to sound like a reference voice (user's enrollment sample).
 *
 * This enables personalized voice mode without requiring per-user model training.
 *
 * @see https://huggingface.co/spaces/Plachta/Seed-VC
 * @see https://github.com/Plachtaa/seed-vc
 */

const path = require("path");
const fs = require("fs");
const { ensureDir, downloadToFile } = require("./http");

// Dynamic import for ES module
let Client = null;
let handle_file = null;

async function getGradioClient() {
  if (!Client) {
    const gradio = await import("@gradio/client");
    Client = gradio.Client;
    handle_file = gradio.handle_file;
  }
  return { Client, handle_file };
}

const SEEDVC_SPACE = "Plachta/Seed-VC";
const DEFAULT_DIFFUSION_STEPS = 25; // 30-50 for best quality, 4-10 for fastest
const DEFAULT_LENGTH_ADJUST = 1.0;
const DEFAULT_INFERENCE_CFG_RATE = 0.7;
const DEFAULT_F0_CONDITION = true;
const DEFAULT_AUTO_F0_ADJUST = false;
const DEFAULT_PITCH_SHIFT = 0;
const DOWNLOAD_RETRY_ATTEMPTS = 3;

function isRetryableSeedVcDownloadError(error) {
  const message = error && error.message ? String(error.message) : "";
  if (!message) {
    return false;
  }
  return (
    message === "request_timeout" ||
    message.startsWith("download_error:network:") ||
    message.startsWith("download_error:502:") ||
    message.startsWith("download_error:503:") ||
    message.startsWith("download_error:504:") ||
    message.includes("download_error:corrupted:File too small")
  );
}

async function downloadSeedVcOutputWithRetry({ url, outputPath, timeoutMs }) {
  let lastError;
  for (let attempt = 1; attempt <= DOWNLOAD_RETRY_ATTEMPTS; attempt++) {
    try {
      await downloadToFile(url, outputPath, timeoutMs);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableSeedVcDownloadError(error) || attempt === DOWNLOAD_RETRY_ATTEMPTS) {
        throw error;
      }
      const waitMs = Math.min(8000, attempt * 2000);
      console.warn(
        `[Seed-VC] Output download attempt ${attempt}/${DOWNLOAD_RETRY_ATTEMPTS} failed (${error.message}); retrying in ${waitMs}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastError || new Error("E302_SEEDVC_ERROR: Failed to download Seed-VC output");
}

/**
 * Convert voice using Seed-VC (zero-shot singing voice conversion)
 *
 * @param {Object} options
 * @param {string} options.storageDir - Base storage directory
 * @param {Object} options.track - Track object with id, user_id
 * @param {Object} options.trackVersion - Track version with version_num
 * @param {string} options.sourceAudioPath - Path to source audio (guide vocal)
 * @param {string} options.referenceAudioPath - Path to reference audio (user's enrolled voice)
 * @param {number} options.timeoutMs - Request timeout in milliseconds
 * @param {string} options.kind - "preview" or "full"
 * @param {Object} options.params - Optional conversion parameters
 * @param {number} options.params.diffusionSteps - Quality vs speed tradeoff (default: 25)
 * @param {number} options.params.lengthAdjust - Output length adjustment (default: 1.0)
 * @param {number} options.params.cfgRate - Inference CFG rate (default: 0.7)
 * @param {string} options.hfToken - Optional Hugging Face token for private/rate-limited access
 * @returns {Promise<{file: string, output_path: string}>}
 */
async function convertVoice({
  storageDir,
  track,
  trackVersion,
  sourceAudioPath,
  referenceAudioPath,
  timeoutMs = 300000,
  kind = "preview",
  params = {},
  hfToken = null,
}) {
  // Input validation
  if (!track || !track.user_id || !track.id) {
    throw new Error("E302_SEEDVC_ERROR: Valid track with user_id and id required");
  }
  if (!trackVersion || !trackVersion.version_num) {
    throw new Error("E302_SEEDVC_ERROR: Valid trackVersion with version_num required");
  }
  if (!sourceAudioPath) {
    throw new Error("E302_SEEDVC_ERROR: Source audio path is required");
  }
  if (!referenceAudioPath) {
    throw new Error("E302_SEEDVC_ERROR: Reference audio path is required");
  }

  // Verify files exist
  if (!fs.existsSync(sourceAudioPath)) {
    throw new Error(`E302_SEEDVC_ERROR: Source audio not found: ${sourceAudioPath}`);
  }
  if (!fs.existsSync(referenceAudioPath)) {
    throw new Error(`E302_SEEDVC_ERROR: Reference audio not found: ${referenceAudioPath}`);
  }

  console.log(`[Seed-VC] Starting personalized voice conversion for track ${track.id}`);
  console.log(`[Seed-VC] Source: ${sourceAudioPath}`);
  console.log(`[Seed-VC] Reference: ${referenceAudioPath}`);
  console.log(`[Seed-VC] HF_TOKEN configured: ${hfToken ? "YES" : "NO"}`);

  const {
    diffusionSteps = DEFAULT_DIFFUSION_STEPS,
    lengthAdjust = DEFAULT_LENGTH_ADJUST,
    cfgRate = DEFAULT_INFERENCE_CFG_RATE,
    f0Condition = DEFAULT_F0_CONDITION,
    autoF0Adjust = DEFAULT_AUTO_F0_ADJUST,
    pitchShift = DEFAULT_PITCH_SHIFT,
  } = params;

  try {
    const { Client, handle_file } = await getGradioClient();

    // Connect to Seed-VC Space
    // @gradio/client v2.0.1 only reads 'token' property (not 'hf_token')
    const connectOptions = {};
    if (hfToken) {
      connectOptions.token = hfToken;
    }

    console.log(`[Seed-VC] Connecting to ${SEEDVC_SPACE}...`);
    const client = await Client.connect(SEEDVC_SPACE, connectOptions);

    // Get API info to find correct endpoint
    // Seed-VC Space typically has endpoints like /predict or similar
    console.log(`[Seed-VC] Submitting conversion job...`);

    // The Seed-VC Space expects positional arguments in this order:
    // source, target, diffusion_steps, length_adjust, inference_cfg_rate, f0_condition, auto_f0_adjust, pitch_shift
    //
    // For singing voice conversion, set f0_condition=true and auto_f0_adjust=false
    const result = await client.predict("/predict", [
      handle_file(sourceAudioPath),    // source audio (the audio to convert)
      handle_file(referenceAudioPath), // reference audio (the target voice)
      diffusionSteps,                  // quality vs speed tradeoff
      lengthAdjust,                    // output length adjustment
      cfgRate,                         // inference CFG rate
      f0Condition,                     // f0_condition - enable for singing voice
      autoF0Adjust,                    // auto_f0_adjust
      pitchShift,                      // pitch_shift in semitones
    ]);

    console.log(`[Seed-VC] Conversion complete for track ${track.id}`);

    // Seed-VC returns two outputs:
    // - data[0]: streaming mp3 (M3U playlist for progressive playback)
    // - data[1]: final audio as a file object with URL
    const outputData = result.data;

    if (!outputData || outputData.length === 0) {
      throw new Error("E302_SEEDVC_ERROR: No output received from Seed-VC");
    }

    console.log(`[Seed-VC] Result data length: ${outputData.length}`);

    // Prepare output directory
    const versionDir = path.join(
      storageDir,
      "tracks",
      track.user_id,
      track.id,
      `v${trackVersion.version_num}`
    );
    ensureDir(versionDir);

    const fileName = kind === "preview" ? "user_vocal.wav" : "user_vocal_full.wav";
    const outputPath = path.join(versionDir, fileName);

    // Use the second output (final audio), fallback to first
    const outputValue = outputData.length > 1 && outputData[1] ? outputData[1] : outputData[0];
    console.log(`[Seed-VC] Using output ${outputData.length > 1 ? 'data[1]' : 'data[0]'}`);

    // Handle different output formats from Gradio
    if (typeof outputValue === "string") {
      // Could be a file path or URL
      if (outputValue.startsWith("http")) {
        // Download from URL
        console.log(`[Seed-VC] Downloading from URL: ${outputValue.substring(0, 80)}...`);
        await downloadSeedVcOutputWithRetry({
          url: outputValue,
          outputPath,
          timeoutMs,
        });
      } else if (fs.existsSync(outputValue)) {
        // Copy from local path
        fs.copyFileSync(outputValue, outputPath);
      } else {
        throw new Error(`E302_SEEDVC_ERROR: Unknown output format: ${outputValue}`);
      }
    } else if (outputValue && outputValue.url) {
      // Gradio file object with URL (most common for remote Spaces)
      console.log(`[Seed-VC] Downloading from file URL: ${outputValue.url.substring(0, 80)}...`);
      await downloadSeedVcOutputWithRetry({
        url: outputValue.url,
        outputPath,
        timeoutMs,
      });
    } else if (outputValue && outputValue.path) {
      // Gradio file object with path
      fs.copyFileSync(outputValue.path, outputPath);
    } else {
      console.error("[Seed-VC] Unexpected output format:", outputValue);
      throw new Error("E302_SEEDVC_ERROR: Unexpected output format from Seed-VC");
    }

    console.log(`[Seed-VC] Saved converted audio to ${outputPath}`);

    return {
      file: fileName,
      output_path: outputPath,
    };
  } catch (error) {
    // Handle Gradio-specific errors
    if (error.message && error.message.includes("SEEDVC")) {
      throw error;
    }

    console.error(`[Seed-VC] Voice conversion failed for track ${track.id}:`, error.message);

    // Check for common Gradio Space errors
    if (error.message && error.message.includes("Queue full")) {
      throw new Error("E302_SEEDVC_ERROR: Seed-VC service is busy, try again later");
    }
    if (error.message && error.message.includes("timeout")) {
      throw new Error("E302_SEEDVC_ERROR: Voice conversion timed out");
    }
    if (error.message && error.message.includes("connection")) {
      throw new Error("E302_SEEDVC_ERROR: Failed to connect to Seed-VC service");
    }

    throw new Error(`E302_SEEDVC_ERROR: ${error.message}`);
  }
}

/**
 * Check if Seed-VC service is available
 * @returns {Promise<boolean>}
 */
async function checkAvailability() {
  try {
    const { Client } = await getGradioClient();
    await Client.connect(SEEDVC_SPACE);
    // If we can connect, the service is available
    return true;
  } catch (error) {
    console.warn("[Seed-VC] Service check failed:", error.message);
    return false;
  }
}

module.exports = {
  convertVoice,
  checkAvailability,
  SEEDVC_SPACE,
};
