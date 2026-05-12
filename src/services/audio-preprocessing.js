/**
 * Audio Preprocessing Service - Cleans and normalizes audio for voice conversion
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const os = require("os");
const { vadTrim } = require("../utils/qc");
const {
  assessAudioQuality,
  calculateQualityGrade,
  GRADE_VALUES,
} = require("./audio-quality");

const TARGET_LUFS = -20;
const TARGET_LUFS_SUNG = -18;
const NOISE_REDUCTION_AMOUNT = 12;
const NOISE_REDUCTION_AGGRESSIVE = 20;

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
        reject(
          new Error(`FFmpeg failed (code ${code}): ${stderr.slice(-500)}`),
        );
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

  const args = [
    "-y",
    "-i",
    inputPath,
    "-af",
    `afftdn=nr=${nr}:nf=-25:tn=1`,
    "-ar",
    "44100",
    "-ac",
    "1",
    "-acodec",
    "pcm_s16le",
    outputPath,
  ];

  await runFfmpeg(args);
}

/**
 * Enhanced preprocessing pipeline with stacked filters for noisy environments
 * Pipeline: highpass → noise gate → afftdn → compressor → loudnorm
 * @param {string} inputPath - Input WAV file path
 * @param {string} outputPath - Output WAV file path
 * @param {Object} options - Options
 * @param {boolean} options.isSung - Whether this is sung audio (different parameters)
 * @param {number} options.measuredSnr - Measured SNR to determine aggressiveness
 * @returns {Promise<void>}
 */
async function applyEnhancedPreprocessing(inputPath, outputPath, options = {}) {
  const { isSung = false, measuredSnr = 15 } = options;

  const isVeryNoisy = measuredSnr < 10;
  const isNoisy = measuredSnr < 15;

  const filters = [];

  const highpassFreq = isSung ? 60 : 80;
  filters.push(`highpass=f=${highpassFreq}`);

  if (isVeryNoisy) {
    filters.push("agate=threshold=-40dB:ratio=2:attack=10:release=100");
  }

  const noiseReduction = isVeryNoisy ? 20 : isNoisy ? 15 : 10;
  const noiseFloor = isVeryNoisy ? -30 : -25;
  filters.push(`afftdn=nr=${noiseReduction}:nf=${noiseFloor}:tn=1`);

  const threshold = isSung ? -25 : -20;
  const ratio = isSung ? 4 : 3;
  const attack = isSung ? 3 : 5;
  const release = isSung ? 100 : 50;
  filters.push(
    `acompressor=threshold=${threshold}dB:ratio=${ratio}:attack=${attack}:release=${release}`,
  );

  const targetLufs = isSung ? TARGET_LUFS_SUNG : TARGET_LUFS;
  const lra = isSung ? 14 : 11;
  filters.push(`loudnorm=I=${targetLufs}:LRA=${lra}:TP=-1.5`);

  const filterChain = filters.join(",");

  const args = [
    "-y",
    "-i",
    inputPath,
    "-af",
    filterChain,
    "-ar",
    "44100",
    "-ac",
    "1",
    "-acodec",
    "pcm_s16le",
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
async function normalizeVolume(
  inputPath,
  outputPath,
  targetLufs = TARGET_LUFS,
) {
  const args = [
    "-y",
    "-i",
    inputPath,
    "-af",
    `loudnorm=I=${targetLufs}:LRA=11:TP=-1.5:print_format=summary`,
    "-ar",
    "44100",
    "-ac",
    "1",
    "-acodec",
    "pcm_s16le",
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
 * @param {boolean} options.isSung - Whether this is a sung prompt (uses different parameters)
 * @param {boolean} options.useEnhancedPipeline - Use the enhanced stacked filter pipeline
 * @returns {Promise<{outputPath: string, metrics: Object, grade: string, improved: boolean}>}
 */
async function preprocessAudio(options) {
  const {
    inputPath,
    outputPath: customOutputPath,
    applyNoiseSuppression: doNoiseSuppression = true,
    applyNormalization = true,
    applyVadTrim: doVadTrim = true,
    isSung = false,
    useEnhancedPipeline = false,
  } = options;

  // Create temp directory for intermediate files
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-preprocess-"));
  const stages = [];

  try {
    const originalBuffer = fs.readFileSync(inputPath);
    const originalMetrics = assessAudioQuality(originalBuffer);
    const { grade: originalGrade } = calculateQualityGrade(originalMetrics);

    let currentPath = inputPath;

    if (useEnhancedPipeline && doNoiseSuppression) {
      const enhancedPath = path.join(tempDir, "enhanced.wav");
      try {
        await applyEnhancedPreprocessing(currentPath, enhancedPath, {
          isSung,
          measuredSnr: originalMetrics.snr_db,
        });
        currentPath = enhancedPath;
        stages.push("enhanced_pipeline");
      } catch (e) {
        console.warn(
          "[Preprocessing] Enhanced pipeline failed, falling back:",
          e.message,
        );
        stages.push("enhanced_pipeline_FAILED");
      }
    }

    if (
      doNoiseSuppression &&
      originalMetrics.snr_db < 25 &&
      !stages.includes("enhanced_pipeline")
    ) {
      const denoisedPath = path.join(tempDir, "denoised.wav");
      try {
        const noiseReduction = isSung
          ? originalMetrics.snr_db < 12
            ? 20
            : 15
          : originalMetrics.snr_db < 15
            ? 15
            : 10;
        await applyNoiseSuppression(currentPath, denoisedPath, {
          noiseReduction,
        });
        currentPath = denoisedPath;
        stages.push("noise_suppression");
      } catch (e) {
        console.warn(
          "[Preprocessing] Noise suppression failed, skipping:",
          e.message,
        );
        stages.push("noise_suppression_FAILED");
      }
    }

    if (applyNormalization && !stages.includes("enhanced_pipeline")) {
      const normalizedPath = path.join(tempDir, "normalized.wav");
      try {
        const targetLufs = isSung ? TARGET_LUFS_SUNG : TARGET_LUFS;
        await normalizeVolume(currentPath, normalizedPath, targetLufs);
        currentPath = normalizedPath;
        stages.push("normalization");
      } catch (e) {
        console.warn(
          "[Preprocessing] Normalization failed, skipping:",
          e.message,
        );
        stages.push("normalization_FAILED");
      }
    }

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

    const outputPath =
      customOutputPath || inputPath.replace(".wav", "_processed.wav");
    fs.writeFileSync(outputPath, finalBuffer);

    const finalMetrics = assessAudioQuality(finalBuffer);
    const {
      grade: finalGrade,
      tier,
      score,
      issues,
      tips,
    } = calculateQualityGrade(finalMetrics, { isSung });

    const improved =
      GRADE_VALUES[finalGrade] < GRADE_VALUES[originalGrade] ||
      (finalGrade === originalGrade &&
        finalMetrics.snr_db > originalMetrics.snr_db + 3);

    return {
      outputPath,
      metrics: finalMetrics,
      grade: finalGrade,
      tier,
      score,
      tips,
      issues,
      stages,
      improved,
      original: {
        metrics: originalMetrics,
        grade: originalGrade,
      },
    };
  } finally {
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
        case "A":
          totalGradeA++;
          break;
        case "B":
          totalGradeB++;
          break;
        case "C":
          totalGradeC++;
          break;
        case "F":
          totalGradeF++;
          break;
      }
    } catch (e) {
      console.error(
        `[Preprocessing] Failed to process ${chunkPath}:`,
        e.message,
      );
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
      grades: {
        A: totalGradeA,
        B: totalGradeB,
        C: totalGradeC,
        F: totalGradeF,
      },
      overallGrade:
        totalGradeF > chunkPaths.length / 2
          ? "F"
          : totalGradeC > chunkPaths.length / 2
            ? "C"
            : totalGradeB > chunkPaths.length / 2
              ? "B"
              : "A",
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
        diffusionSteps: 80,
        cfgRate: 0.7,
        description: "High quality - strong voice preservation",
      };
    case "B":
      return {
        diffusionSteps: 60,
        cfgRate: 0.65,
        description: "Good quality - balanced conversion",
      };
    case "C":
      return {
        diffusionSteps: 50,
        cfgRate: 0.55,
        description: "Acceptable quality - more smoothing",
      };
    case "F":
      return null; // Recommend AI voice fallback
    default:
      return {
        diffusionSteps: 90,
        cfgRate: 0.7,
        description: "Default parameters",
      };
  }
}

/**
 * Concatenate sung-chunk WAVs into a single Suno-grade persona waveform.
 *
 * Suno's persona pipeline (upload-cover → generate-persona) expects the input
 * to look like a coherent music track, not a sequence of stitched voice clips.
 * Naive byte-concat of two recorded chunks fails because:
 *   1. Each chunk has ~0.5-0.8s of leading/trailing silence from tap-to-record
 *      UX, producing 4-5 silent gaps per persona file.
 *   2. The concat boundary itself is a hard cut — Suno reads this as two
 *      separate tracks.
 *   3. Phone-mic recordings land at ~-28 LUFS; Suno expects music-grade input
 *      closer to -14 to -16 LUFS.
 *
 * Pipeline (single ffmpeg invocation, filter_complex):
 *   1. silenceremove on each input: trim leading + trailing silence at -40dB
 *   2. acrossfade pairwise: chain inputs with `crossfadeMs` overlap
 *   3. loudnorm: normalize the concatenated result to `targetLufs`
 *
 * @param {string[]} inputs - Absolute paths to input WAVs (≥1)
 * @param {string} output - Absolute path for the resulting WAV
 * @param {Object} [opts]
 * @param {number} [opts.crossfadeMs=200] - Pairwise crossfade duration in ms
 * @param {number} [opts.targetLufs=-16] - Final integrated loudness target
 * @param {number} [opts.silenceThresholdDb=-40] - Silence detection threshold
 * @param {number} [opts.timeoutMs=45000] - ffmpeg timeout
 * @returns {Promise<void>}
 */
async function buildPersonaWaveform(inputs, output, opts = {}) {
  const crossfadeMs = Number.isFinite(opts.crossfadeMs)
    ? opts.crossfadeMs
    : 200;
  const targetLufs = Number.isFinite(opts.targetLufs) ? opts.targetLufs : -16;
  const silenceThresholdDb = Number.isFinite(opts.silenceThresholdDb)
    ? opts.silenceThresholdDb
    : -40;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 45000;
  const crossfadeSec = (crossfadeMs / 1000).toFixed(3);

  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error("buildPersonaWaveform: at least one input required");
  }

  const trim = (idx, outLabel) =>
    `[${idx}:a]silenceremove=start_periods=1:start_silence=0.1:` +
    `start_threshold=${silenceThresholdDb}dB:detection=peak,` +
    `silenceremove=stop_periods=-1:stop_silence=0.1:` +
    `stop_threshold=${silenceThresholdDb}dB:detection=peak[${outLabel}]`;

  const parts = inputs.map((_, idx) => trim(idx, `t${idx}`));

  let lastLabel = "t0";
  for (let i = 1; i < inputs.length; i += 1) {
    const out = i === inputs.length - 1 ? "xfade" : `x${i}`;
    parts.push(
      `[${lastLabel}][t${i}]acrossfade=d=${crossfadeSec}:c1=tri:c2=tri[${out}]`,
    );
    lastLabel = out;
  }

  const preNormLabel = inputs.length === 1 ? "t0" : "xfade";
  parts.push(`[${preNormLabel}]loudnorm=I=${targetLufs}:LRA=11:TP=-1.5[out]`);

  const filterComplex = parts.join(";");

  const args = ["-y"];
  for (const input of inputs) {
    args.push("-i", input);
  }
  args.push(
    "-filter_complex",
    filterComplex,
    "-map",
    "[out]",
    "-ar",
    "44100",
    "-ac",
    "1",
    "-acodec",
    "pcm_s16le",
    output,
  );

  await runFfmpeg(args, timeoutMs);
}

module.exports = {
  preprocessAudio,
  preprocessBatch,
  applyNoiseSuppression,
  applyEnhancedPreprocessing,
  normalizeVolume,
  applyVadTrim,
  buildPersonaWaveform,
  getAdaptiveConversionParams,
  TARGET_LUFS,
  TARGET_LUFS_SUNG,
  NOISE_REDUCTION_AMOUNT,
  NOISE_REDUCTION_AGGRESSIVE,
};
