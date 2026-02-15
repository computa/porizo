/**
 * Demucs Stem Separation Provider
 *
 * Uses Replicate's Demucs model to separate vocals from instrumentals.
 * This is REQUIRED for proper voice conversion - we must isolate vocals
 * before running Seed-VC, then remix with the original instrumental.
 *
 * @see https://replicate.com/cjwbw/demucs
 */

const Replicate = require("replicate");
const fs = require("fs");
const path = require("path");
const { downloadToFile, ensureDir } = require("./http");

const DEMUCS_MODEL = "cjwbw/demucs:25a173108cff36ef9f80f854c162d01df9e6528be175794b81158fa03836d953";

/**
 * Separate vocals and instrumentals from a mixed audio file
 *
 * @param {Object} options
 * @param {string} options.inputPath - Path to the mixed audio file
 * @param {string} options.outputDir - Directory to save separated stems
 * @param {string} options.replicateApiToken - Replicate API token
 * @param {number} options.timeoutMs - Request timeout (default: 300000)
 * @returns {Promise<{vocals: string, instrumental: string}>} Paths to separated files
 */
async function separateStems({
  inputPath,
  outputDir,
  replicateApiToken,
  timeoutMs = 300000,
  model = "htdemucs_ft",
  shifts = 3,
}) {
  if (!inputPath) {
    throw new Error("E303_DEMUCS_ERROR: Input path is required");
  }
  if (!fs.existsSync(inputPath)) {
    throw new Error(`E303_DEMUCS_ERROR: Input file not found: ${inputPath}`);
  }
  if (!replicateApiToken) {
    throw new Error("E303_DEMUCS_ERROR: Replicate API token is required");
  }

  console.log(`[Demucs] Starting stem separation for: ${inputPath}`);

  ensureDir(outputDir);

  const replicate = new Replicate({
    auth: replicateApiToken,
  });

  try {
    // Read the input file and convert to base64 data URI
    const fileBuffer = fs.readFileSync(inputPath);
    const base64Data = fileBuffer.toString("base64");
    const mimeType = inputPath.endsWith(".mp3") ? "audio/mpeg" : "audio/wav";
    const dataUri = `data:${mimeType};base64,${base64Data}`;

    console.log(`[Demucs] Uploading ${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB to Replicate...`);

    const selectedModel = typeof model === "string" && model.trim() ? model.trim() : "htdemucs_ft";
    const selectedShifts = Number.isFinite(Number(shifts))
      ? Math.max(1, Math.min(5, Math.round(Number(shifts))))
      : 3;

    // Run Demucs for vocal separation
    const output = await replicate.run(DEMUCS_MODEL, {
      input: {
        audio: dataUri,
        model: selectedModel,
        stem: "vocals",     // We specifically want vocals separated
        output_format: "wav",
        clip_mode: "rescale",
        shifts: selectedShifts,
      },
    });

    console.log(`[Demucs] Separation complete, downloading stems...`);

    // Demucs returns URLs for the separated stems
    // When stem="vocals", it returns: { vocals: url, no_vocals: url }
    if (!output) {
      throw new Error("E303_DEMUCS_ERROR: No output received from Demucs");
    }

    const vocalsUrl = output.vocals || output;
    const instrumentalUrl = output.no_vocals || output.other;

    // Download the separated stems
    const vocalsPath = path.join(outputDir, "vocals.wav");
    const instrumentalPath = path.join(outputDir, "instrumental.wav");

    if (vocalsUrl) {
      console.log(`[Demucs] Downloading vocals...`);
      await downloadToFile(vocalsUrl, vocalsPath, timeoutMs);
      console.log(`[Demucs] Saved vocals to: ${vocalsPath}`);
    }

    if (instrumentalUrl) {
      console.log(`[Demucs] Downloading instrumental...`);
      await downloadToFile(instrumentalUrl, instrumentalPath, timeoutMs);
      console.log(`[Demucs] Saved instrumental to: ${instrumentalPath}`);
    }

    // Verify files were created
    if (!fs.existsSync(vocalsPath)) {
      throw new Error("E303_DEMUCS_ERROR: Vocals file was not created");
    }

    return {
      vocals: vocalsPath,
      instrumental: fs.existsSync(instrumentalPath) ? instrumentalPath : null,
    };
  } catch (error) {
    if (error.message && error.message.includes("DEMUCS")) {
      throw error;
    }

    console.error(`[Demucs] Stem separation failed:`, error.message);

    if (error.message && error.message.includes("timeout")) {
      throw new Error("E303_DEMUCS_ERROR: Stem separation timed out");
    }
    if (error.message && error.message.includes("rate limit")) {
      throw new Error("E303_DEMUCS_ERROR: Replicate rate limit exceeded");
    }

    throw new Error(`E303_DEMUCS_ERROR: ${error.message}`);
  }
}

module.exports = {
  separateStems,
  DEMUCS_MODEL,
};
