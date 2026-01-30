/**
 * Enrollment service - validates enrollment audio and manages sessions
 *
 * Enhanced with:
 * - Audio preprocessing (noise suppression, normalization, VAD trim)
 * - Quality grading (A/B/C/F) instead of binary pass/fail
 * - Adaptive thresholds based on preprocessing results
 */

const fs = require("fs");
const path = require("path");
const { analyzeAudioQuality } = require("../utils/qc");
const { parseWavBuffer } = require("../utils/audio");
const { assessAudioQuality, calculateQualityGrade, GRADE_VALUES } = require("./audio-quality");
const { preprocessAudio, preprocessBatch } = require("./audio-preprocessing");

const MIN_TOTAL_DURATION_SEC = 10;
const SNR_THRESHOLD_DB = 15;
const CLIPPING_THRESHOLD = 0.05;

// Minimum acceptable grade for enrollment (C or better)
const MIN_ACCEPTABLE_GRADE = "C";

/**
 * Validates enrollment audio chunks for quality
 * @param {Object} options
 * @param {string} options.userId - User ID
 * @param {string} options.sessionId - Enrollment session ID
 * @param {string} options.storageDir - Base storage directory
 * @returns {Promise<{passed: boolean, metrics: Object, errors: string[]}>}
 */
async function validateEnrollmentAudio({ userId, sessionId, storageDir, chunkFiles }) {
  const chunkDir = storageDir
    ? path.join(storageDir, "enrollment", "raw", userId, sessionId)
    : null;
  const errors = [];
  const aggregatedMetrics = {
    snr_db: 0,
    clipping_ratio: 0,
    total_duration_sec: 0,
    chunk_count: 0,
    chunk_results: [],
  };

  let filePaths = Array.isArray(chunkFiles) ? chunkFiles.slice() : [];

  if (filePaths.length === 0 && chunkDir && fs.existsSync(chunkDir)) {
    filePaths = fs
      .readdirSync(chunkDir)
      .filter((f) => f.endsWith(".wav"))
      .sort()
      .map((file) => path.join(chunkDir, file));
  }

  if (filePaths.length === 0) {
    errors.push("E104_SESSION_NOT_FOUND: No audio chunks found");
    return { passed: false, metrics: aggregatedMetrics, errors };
  }

  let totalSnr = 0;
  let totalClipping = 0;
  let totalDuration = 0;

  for (const filePath of filePaths) {
    const file = path.basename(filePath);
    let buffer;
    try {
      buffer = fs.readFileSync(filePath);
    } catch (err) {
      console.error(`[Enrollment] Failed to read chunk file ${file}:`, err.message);
      errors.push(`E104_FILE_READ_ERROR: Could not read ${file}: ${err.message}`);
      continue;
    }

    const chunkResult = analyzeAudioQuality(buffer);
    aggregatedMetrics.chunk_results.push({
      file,
      ...chunkResult,
    });

    // Calculate duration using proper WAV parsing (handles iOS extended WAV)
    try {
      const wavInfo = parseWavBuffer(buffer);
      totalDuration += wavInfo.durationSec;
    } catch (e) {
      // Fallback: estimate duration from file size
      const estimatedDuration = (buffer.length - 44) / 2 / 44100;
      totalDuration += estimatedDuration;
    }

    if (chunkResult.passed) {
      totalSnr += chunkResult.metrics.snr_db;
      totalClipping += chunkResult.metrics.clipping_ratio;
    } else {
      for (const err of chunkResult.errors) {
        if (!errors.includes(err)) {
          errors.push(err);
        }
      }
    }
  }

  aggregatedMetrics.chunk_count = filePaths.length;
  aggregatedMetrics.total_duration_sec = totalDuration;

  const passedChunks = aggregatedMetrics.chunk_results.filter((r) => r.passed).length;
  if (passedChunks > 0) {
    aggregatedMetrics.snr_db = totalSnr / passedChunks;
    aggregatedMetrics.clipping_ratio = totalClipping / passedChunks;
  }

  if (totalDuration < MIN_TOTAL_DURATION_SEC) {
    errors.push(
      "E105_INSUFFICIENT_DURATION: Need " + MIN_TOTAL_DURATION_SEC + "s, got " + totalDuration.toFixed(1) + "s"
    );
  }

  const hasNoisy = aggregatedMetrics.chunk_results.some(
    (r) => r.errors && r.errors.some((e) => e.includes("E101"))
  );
  const hasClipped = aggregatedMetrics.chunk_results.some(
    (r) => r.errors && r.errors.some((e) => e.includes("E102"))
  );
  const hasSilent = aggregatedMetrics.chunk_results.some(
    (r) => r.errors && r.errors.some((e) => e.includes("E103"))
  );

  if (hasNoisy && !errors.some((e) => e.includes("E101"))) {
    errors.push("E101_AUDIO_TOO_NOISY: SNR below " + SNR_THRESHOLD_DB + "dB threshold");
  }
  if (hasClipped && !errors.some((e) => e.includes("E102"))) {
    errors.push("E102_AUDIO_CLIPPED: Clipping above " + (CLIPPING_THRESHOLD * 100) + "% threshold");
  }
  if (hasSilent && !errors.some((e) => e.includes("E103"))) {
    errors.push("E103_NO_AUDIO_DETECTED: Silent or near-silent audio");
  }

  return {
    passed: errors.length === 0,
    metrics: aggregatedMetrics,
    errors,
  };
}

/**
 * Enhanced enrollment validation with preprocessing and quality grading
 * @param {Object} options
 * @param {string} options.userId - User ID
 * @param {string} options.sessionId - Enrollment session ID
 * @param {string} options.storageDir - Base storage directory
 * @param {string[]} options.chunkFiles - Array of chunk file paths (optional)
 * @param {boolean} options.applyPreprocessing - Whether to preprocess audio (default true)
 * @returns {Promise<{passed: boolean, grade: string, metrics: Object, errors: string[], preprocessingResults: Object}>}
 */
async function validateEnrollmentWithGrading({
  userId,
  sessionId,
  storageDir,
  chunkFiles,
  applyPreprocessing = true,
}) {
  console.log("[Enrollment:QC] START", { userId, sessionId, files: chunkFiles?.length || 0 });

  const chunkDir = storageDir
    ? path.join(storageDir, "enrollment", "raw", userId, sessionId)
    : null;
  const errors = [];

  // Get file paths
  let filePaths = Array.isArray(chunkFiles) ? chunkFiles.slice() : [];
  if (filePaths.length === 0 && chunkDir && fs.existsSync(chunkDir)) {
    filePaths = fs
      .readdirSync(chunkDir)
      .filter((f) => f.endsWith(".wav"))
      .sort()
      .map((file) => path.join(chunkDir, file));
    console.log("[Enrollment:QC] Loaded from dir:", { chunkDir, count: filePaths.length });
  }

  if (filePaths.length === 0) {
    console.warn("[Enrollment:QC] No files found", { userId, sessionId });
    errors.push("E104_SESSION_NOT_FOUND: No audio chunks found");
    return {
      passed: false,
      grade: "F",
      metrics: { chunk_count: 0, total_duration_sec: 0 },
      errors,
      preprocessingResults: null,
    };
  }

  // Preprocess if enabled
  let preprocessingResults = null;
  let processedPaths = filePaths;

  if (applyPreprocessing) {
    try {
      preprocessingResults = await preprocessBatch(filePaths);
      // Use processed files if available
      processedPaths = preprocessingResults.results
        .filter((r) => !r.error && r.outputPath)
        .map((r) => r.outputPath);

      // Fall back to original if preprocessing failed for all
      if (processedPaths.length === 0) {
        console.warn("[Enrollment] All preprocessing failed, using original files");
        processedPaths = filePaths;
      }
    } catch (e) {
      console.warn("[Enrollment] Batch preprocessing failed, using original files:", e.message);
      processedPaths = filePaths;
    }
  }

  // Assess quality of each chunk
  const chunkResults = [];
  let totalDuration = 0;
  let totalScore = 0;

  for (const filePath of processedPaths) {
    try {
      const buffer = fs.readFileSync(filePath);
      const metrics = assessAudioQuality(buffer);
      const { grade, score, issues } = calculateQualityGrade(metrics);

      chunkResults.push({
        file: path.basename(filePath),
        grade,
        score,
        metrics,
        issues,
      });

      totalDuration += metrics.duration_sec;
      totalScore += score;

      // Collect issues as errors if grade is F
      if (grade === "F") {
        for (const issue of issues) {
          if (!errors.includes(issue)) {
            errors.push(issue);
          }
        }
      }
    } catch (e) {
      console.error(`[Enrollment] Failed to assess ${path.basename(filePath)}:`, e.message);
      chunkResults.push({
        file: path.basename(filePath),
        grade: "F",
        score: 0,
        error: e.message,
      });
    }
  }

  // Calculate overall grade from chunk grades
  const gradeCounts = { A: 0, B: 0, C: 0, F: 0 };
  for (const result of chunkResults) {
    gradeCounts[result.grade]++;
  }

  // Overall grade: worst grade that appears in >25% of chunks, or average
  let overallGrade = "A";
  const total = chunkResults.length;
  if (gradeCounts.F > total * 0.25) overallGrade = "F";
  else if (gradeCounts.C > total * 0.25) overallGrade = "C";
  else if (gradeCounts.B > total * 0.25) overallGrade = "B";

  // Duration check
  if (totalDuration < MIN_TOTAL_DURATION_SEC) {
    errors.push(
      `E105_INSUFFICIENT_DURATION: Need ${MIN_TOTAL_DURATION_SEC}s, got ${totalDuration.toFixed(1)}s`
    );
  }

  // Pass if grade is acceptable and no critical errors
  const gradeAcceptable = GRADE_VALUES[overallGrade] <= GRADE_VALUES[MIN_ACCEPTABLE_GRADE];
  const passed = gradeAcceptable && errors.length === 0;

  console.log("[Enrollment:QC] DONE", {
    passed,
    grade: overallGrade,
    duration: totalDuration.toFixed(1) + 's',
    chunks: chunkResults.length,
    grades: gradeCounts,
    errors: errors.length > 0 ? errors : undefined,
  });

  return {
    passed,
    grade: overallGrade,
    metrics: {
      chunk_count: chunkResults.length,
      total_duration_sec: totalDuration,
      average_score: total > 0 ? totalScore / total : 0,
      grade_distribution: gradeCounts,
      chunk_results: chunkResults,
    },
    errors,
    preprocessingResults,
  };
}

module.exports = {
  validateEnrollmentAudio,
  validateEnrollmentWithGrading,
  MIN_ACCEPTABLE_GRADE,
};
