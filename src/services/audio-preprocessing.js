/**
 * Audio Preprocessing Service - Cleans and normalizes audio for voice conversion
 *
 * Pipeline:
 * 1. Noise suppression (FFmpeg afftdn filter)
 * 2. RMS normalization (target -20 LUFS)
 * 3. VAD trimming (remove silence)
 * 4. Quality assessment
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const os = require("os");
const { vadTrim } = require("../utils/qc");
const { assessAudioQuality, calculateQualityGrade, GRADE_VALUES } = require("./audio-quality");

const TARGET_LUFS = -20;
const NOISE_REDUCTION_AMOUNT = 12; // dB of noise reduction

/**
 * Run FFmpeg command with timeout
 * @param {string[]} args - FFmpeg arguments
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<void>}
 */
function runFfmpeg(args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("FFmpeg timeout"));
    }, timeoutMs);

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg failed (code ${code}): ${stderr.slice(-500)}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Apply noise suppression using FFmpeg's afftdn filter
 * @param {string} inputPath - Input WAV file path
 * @param {string} outputPath - Output WAV file path
 * @param {Object} options - Options
 * @param {number} options.noiseReduction - Noise reduction in dB (default 12)
 * @returns {Promise<void>}
 */
async function applyNoiseSuppression(inputPath, outputPath, options = {}) {
  const nr = options.noiseReduction || NOISE_REDUCTION_AMOUNT;

  // afftdn: Adaptive FFT Denoiser
  // nr: noise reduction in dB
  // nf: noise floor in dB
  // tn: enable noise tracking
  const args = [
    "-y",
    "-i", inputPath,
    "-af", `afftdn=nr=${nr}:nf=-25:tn=1`,
    "-ar", "44100",
    "-ac", "1",
    "-acodec", "pcm_s16le",
    outputPath,
  ];

  await runFfmpeg(args);
}

/**
 * Normalize audio to target LUFS
 * @param {string} inputPath - Input WAV file path
 * @param {string} outputPath - Output WAV file path
 * @param {number} targetLufs - Target loudness (default -20)
 * @returns {Promise<void>}
 */
async function normalizeVolume(inputPath, outputPath, targetLufs = TARGET_LUFS) {
  // Two-pass loudness normalization
  // First pass: measure loudness
  // Second pass: apply gain
  const args = [
    "-y",
    "-i", inputPath,
    "-af", `loudnorm=I=${targetLufs}:LRA=11:TP=-1.5:print_format=summary`,
    "-ar", "44100",
    "-ac", "1",
    "-acodec", "pcm_s16le",
    outputPath,
  ];

  await runFfmpeg(args);
}

/**
 * Apply VAD trimming to remove silence
 * @param {Buffer} inputBuffer - Input WAV buffer
 * @param {number} thresholdDb - Silence threshold in dB
 * @returns {Buffer} Trimmed WAV buffer
 */
function applyVadTrim(inputBuffer, thresholdDb = -40) {
  return vadTrim(inputBuffer, thresholdDb);
}

/**
 * Full preprocessing pipeline for enrollment audio
 * @param {Object} options
 * @param {string} options.inputPath - Input WAV file path
 * @param {string} options.outputPath - Output WAV file path (optional)
 * @param {boolean} options.applyNoiseSuppression - Apply noise suppression
 * @param {boolean} options.applyNormalization - Apply volume normalization
 * @param {boolean} options.applyVadTrim - Apply VAD trimming
 * @returns {Promise<{outputPath: string, metrics: Object, grade: string, improved: boolean}>}
 */
async function preprocessAudio(options) {
  const {
    inputPath,
    outputPath: customOutputPath,
    applyNoiseSuppression = true,
    applyNormalization = true,
    applyVadTrim: doVadTrim = true,
  } = options;

  // Create temp directory for intermediate files
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-preprocess-"));
  const stages = [];

  try {
    // Read original for quality comparison
    const originalBuffer = fs.readFileSync(inputPath);
    const originalMetrics = assessAudioQuality(originalBuffer);
    const { grade: originalGrade } = calculateQualityGrade(originalMetrics);

    let currentPath = inputPath;

    // Stage 1: Noise suppression (if SNR is low)
    if (applyNoiseSuppression && originalMetrics.snr_db < 25) {
      const denoisedPath = path.join(tempDir, "denoised.wav");
      try {
        await applyNoiseSuppression(currentPath, denoisedPath, {
          noiseReduction: originalMetrics.snr_db < 15 ? 15 : 10,
        });
        currentPath = denoisedPath;
        stages.push("noise_suppression");
      } catch (e) {
        console.warn("[Preprocessing] Noise suppression failed, skipping:", e.message);
        stages.push("noise_suppression_FAILED");
      }
    }

    // Stage 2: Volume normalization
    if (applyNormalization) {
      const normalizedPath = path.join(tempDir, "normalized.wav");
      try {
        await normalizeVolume(currentPath, normalizedPath);
        currentPath = normalizedPath;
        stages.push("normalization");
      } catch (e) {
        console.warn("[Preprocessing] Normalization failed, skipping:", e.message);
        stages.push("normalization_FAILED");
      }
    }

    // Stage 3: VAD trimming (in-memory)
    let finalBuffer = fs.readFileSync(currentPath);
    if (doVadTrim) {
      try {
        finalBuffer = applyVadTrim(finalBuffer, -40);
        stages.push("vad_trim");
      } catch (e) {
        console.warn("[Preprocessing] VAD trim failed, skipping:", e.message);
        stages.push("vad_trim_FAILED");
      }
    }

    // Write final output
    const outputPath = customOutputPath || inputPath.replace(".wav", "_processed.wav");
    fs.writeFileSync(outputPath, finalBuffer);

    // Assess final quality
    const finalMetrics = assessAudioQuality(finalBuffer);
    const { grade: finalGrade, score, issues } = calculateQualityGrade(finalMetrics);

    // Check if preprocessing improved quality (use numeric GRADE_VALUES for comparison)
    const improved = GRADE_VALUES[finalGrade] < GRADE_VALUES[originalGrade] ||
      (finalGrade === originalGrade && finalMetrics.snr_db > originalMetrics.snr_db + 3);

    return {
      outputPath,
      metrics: finalMetrics,
      grade: finalGrade,
      score,
      issues,
      stages,
      improved,
      original: {
        metrics: originalMetrics,
        grade: originalGrade,
      },
    };
  } finally {
    // Cleanup temp files
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      console.warn("[Preprocessing] Cleanup failed:", e.message);
    }
  }
}

/**
 * Preprocess a batch of enrollment chunks
 * @param {string[]} chunkPaths - Array of WAV file paths
 * @param {Object} options - Preprocessing options
 * @returns {Promise<{results: Object[], summary: Object}>}
 */
async function preprocessBatch(chunkPaths, options = {}) {
  const results = [];
  let totalImproved = 0;
  let totalGradeA = 0;
  let totalGradeB = 0;
  let totalGradeC = 0;
  let totalGradeF = 0;

  for (const chunkPath of chunkPaths) {
    try {
      const result = await preprocessAudio({
        inputPath: chunkPath,
        ...options,
      });

      results.push({
        path: chunkPath,
        ...result,
      });

      if (result.improved) totalImproved++;

      switch (result.grade) {
        case "A": totalGradeA++; break;
        case "B": totalGradeB++; break;
        case "C": totalGradeC++; break;
        case "F": totalGradeF++; break;
      }
    } catch (e) {
      console.error(`[Preprocessing] Failed to process ${chunkPath}:`, e.message);
      results.push({
        path: chunkPath,
        error: e.message,
        grade: "F",
      });
      totalGradeF++;
    }
  }

  return {
    results,
    summary: {
      total: chunkPaths.length,
      improved: totalImproved,
      grades: { A: totalGradeA, B: totalGradeB, C: totalGradeC, F: totalGradeF },
      overallGrade: totalGradeF > chunkPaths.length / 2 ? "F" :
        totalGradeC > chunkPaths.length / 2 ? "C" :
          totalGradeB > chunkPaths.length / 2 ? "B" : "A",
    },
  };
}

/**
 * Get recommended Seed-VC parameters based on quality grade
 * @param {string} grade - Quality grade (A/B/C/F)
 * @returns {Object|null} Seed-VC config or null if should fallback to AI voice
 */
function getAdaptiveConversionParams(grade) {
  switch (grade) {
    case "A":
      return {
        diffusionSteps: 150,
        cfgRate: 0.7,
        description: "High quality - maximum user voice preservation",
      };
    case "B":
      return {
        diffusionSteps: 100,
        cfgRate: 0.6,
        description: "Good quality - balanced conversion",
      };
    case "C":
      return {
        diffusionSteps: 75,
        cfgRate: 0.5,
        description: "Acceptable quality - more AI smoothing",
      };
    case "F":
      return null; // Recommend AI voice fallback
    default:
      return {
        diffusionSteps: 100,
        cfgRate: 0.6,
        description: "Default parameters",
      };
  }
}

module.exports = {
  preprocessAudio,
  preprocessBatch,
  applyNoiseSuppression,
  normalizeVolume,
  applyVadTrim,
  getAdaptiveConversionParams,
  TARGET_LUFS,
  NOISE_REDUCTION_AMOUNT,
};
