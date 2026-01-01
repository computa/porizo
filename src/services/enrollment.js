/**
 * Enrollment service - validates enrollment audio and manages sessions
 */

const fs = require("fs");
const path = require("path");
const { analyzeAudioQuality } = require("../utils/qc");
const { parseWavBuffer } = require("../utils/audio");

const MIN_TOTAL_DURATION_SEC = 10;
const SNR_THRESHOLD_DB = 15;
const CLIPPING_THRESHOLD = 0.05;

/**
 * Validates enrollment audio chunks for quality
 * @param {Object} options
 * @param {string} options.userId - User ID
 * @param {string} options.sessionId - Enrollment session ID
 * @param {string} options.storageDir - Base storage directory
 * @returns {Promise<{passed: boolean, metrics: Object, errors: string[]}>}
 */
async function validateEnrollmentAudio({ userId, sessionId, storageDir }) {
  const chunkDir = path.join(storageDir, "enrollment", "raw", userId, sessionId);
  const errors = [];
  const aggregatedMetrics = {
    snr_db: 0,
    clipping_ratio: 0,
    total_duration_sec: 0,
    chunk_count: 0,
    chunk_results: [],
  };

  if (!fs.existsSync(chunkDir)) {
    errors.push("E104_SESSION_NOT_FOUND: No audio chunks found");
    return { passed: false, metrics: aggregatedMetrics, errors };
  }

  const chunkFiles = fs.readdirSync(chunkDir)
    .filter((f) => f.endsWith(".wav"))
    .sort();

  if (chunkFiles.length === 0) {
    errors.push("E104_SESSION_NOT_FOUND: No audio chunks found");
    return { passed: false, metrics: aggregatedMetrics, errors };
  }

  let totalSnr = 0;
  let totalClipping = 0;
  let totalDuration = 0;

  for (const file of chunkFiles) {
    const filePath = path.join(chunkDir, file);
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

  aggregatedMetrics.chunk_count = chunkFiles.length;
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

module.exports = {
  validateEnrollmentAudio,
};
