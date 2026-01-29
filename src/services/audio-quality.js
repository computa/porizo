/**
 * Audio Quality Service - Measures and grades audio quality for voice conversion
 *
 * Quality Grades:
 * - A: Excellent (SNR >= 25dB, no clipping, low reverb) -> Best conversion quality
 * - B: Good (SNR >= 18dB, minimal clipping, acceptable reverb) -> Good quality
 * - C: Acceptable (SNR >= 12dB, some issues) -> Usable with adjusted parameters
 * - F: Poor (SNR < 12dB or critical issues) -> Fallback to AI voice recommended
 */

const { parseWavBuffer } = require("../utils/audio");
const { calculateSNR, calculateClippingRatio, vadTrim } = require("../utils/qc");

// Quality thresholds by grade
const QUALITY_THRESHOLDS = {
  A: { minSnr: 25, maxClipping: 0.01, maxReverb: 0.2 },
  B: { minSnr: 18, maxClipping: 0.03, maxReverb: 0.4 },
  C: { minSnr: 12, maxClipping: 0.05, maxReverb: 0.6 },
};

// Numeric grade values for comparison (lower = better)
const GRADE_VALUES = { A: 1, B: 2, C: 3, F: 4 };

// Audio analysis constants
const FRAME_SIZE = 512;
const HOP_SIZE = 256;
const MIN_ENERGY_THRESHOLD = 0.1;
const PEAK_MULTIPLIER = 1.5;
const DECAY_WINDOW = 20;
const PITCH_STABILITY_THRESHOLD = 0.05; // 5% pitch variation tolerance
const MIN_PITCH_HZ = 80;
const MAX_PITCH_HZ = 500;
const SUSTAINED_RUN_THRESHOLD = 3;

/**
 * Extract normalized float samples from WAV buffer
 * @param {Buffer} buffer - WAV audio buffer
 * @returns {{samples: Float32Array, sampleRate: number}|null}
 */
function extractSamples(buffer) {
  const wavInfo = parseWavBuffer(buffer);
  if (wavInfo.bitsPerSample !== 16) return null;

  const numSamples = Math.floor(wavInfo.dataSize / 2);
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    samples[i] = buffer.readInt16LE(wavInfo.dataOffset + i * 2) / 32768;
  }
  return { samples, sampleRate: wavInfo.sampleRate };
}

/**
 * Detect reverb level using autocorrelation decay analysis
 * @param {Buffer} buffer - WAV audio buffer
 * @returns {number} Reverb level 0-1 (higher = more reverberant)
 */
function detectReverb(buffer) {
  try {
    const extracted = extractSamples(buffer);
    if (!extracted || extracted.samples.length < 4096) return 0.5;

    const { samples } = extracted;
    const energies = [];

    for (let i = 0; i < samples.length - FRAME_SIZE; i += HOP_SIZE) {
      let energy = 0;
      for (let j = 0; j < FRAME_SIZE; j++) {
        energy += samples[i + j] * samples[i + j];
      }
      energies.push(Math.sqrt(energy / FRAME_SIZE));
    }

    if (energies.length < 10) return 0.5;

    let totalDecayRatio = 0;
    let decayCount = 0;

    for (let i = 1; i < energies.length - 5; i++) {
      if (energies[i] > energies[i - 1] * PEAK_MULTIPLIER && energies[i] > MIN_ENERGY_THRESHOLD) {
        const peakEnergy = energies[i];
        let decayFrames = 0;

        for (let j = i + 1; j < Math.min(i + DECAY_WINDOW, energies.length); j++) {
          if (energies[j] > peakEnergy * 0.3) {
            decayFrames++;
          } else {
            break;
          }
        }

        totalDecayRatio += decayFrames / DECAY_WINDOW;
        decayCount++;
      }
    }

    if (decayCount === 0) return 0.3;

    return Math.min(1, totalDecayRatio / decayCount);
  } catch (e) {
    console.warn("[AudioQuality] Reverb detection failed:", e.message);
    return 0.5;
  }
}

/**
 * Detect if audio contains singing (vs speech)
 * Uses F0 variance and sustained pitch detection
 * @param {Buffer} buffer - WAV audio buffer
 * @returns {{isSinging: boolean, confidence: number}}
 */
function detectSinging(buffer) {
  const DEFAULT_RESULT = { isSinging: false, confidence: 0.5 };

  try {
    const extracted = extractSamples(buffer);
    if (!extracted) return DEFAULT_RESULT;

    const { samples, sampleRate } = extracted;
    if (samples.length < sampleRate) return DEFAULT_RESULT;

    const frameSize = Math.floor(sampleRate * 0.03); // 30ms frames
    const hopSize = Math.floor(frameSize / 2);
    const minLag = Math.floor(sampleRate / MAX_PITCH_HZ);
    const maxLag = Math.floor(sampleRate / MIN_PITCH_HZ);
    const pitchPeriods = [];

    for (let frameStart = 0; frameStart < samples.length - frameSize; frameStart += hopSize) {
      let maxCorr = 0;
      let bestLag = 0;

      for (let lag = minLag; lag < Math.min(maxLag, frameSize / 2); lag++) {
        let corr = 0;
        let energy1 = 0;
        let energy2 = 0;

        for (let i = 0; i < frameSize - lag; i++) {
          corr += samples[frameStart + i] * samples[frameStart + i + lag];
          energy1 += samples[frameStart + i] * samples[frameStart + i];
          energy2 += samples[frameStart + i + lag] * samples[frameStart + i + lag];
        }

        const normCorr = (energy1 > 0 && energy2 > 0)
          ? corr / Math.sqrt(energy1 * energy2)
          : 0;

        if (normCorr > maxCorr && normCorr > 0.5) {
          maxCorr = normCorr;
          bestLag = lag;
        }
      }

      if (bestLag > 0 && maxCorr > 0.5) {
        pitchPeriods.push(sampleRate / bestLag);
      }
    }

    if (pitchPeriods.length < 5) {
      return { isSinging: false, confidence: 0.3 };
    }

    const meanPitch = pitchPeriods.reduce((a, b) => a + b, 0) / pitchPeriods.length;
    const variance = pitchPeriods.reduce((sum, p) => sum + (p - meanPitch) ** 2, 0) / pitchPeriods.length;
    const coeffOfVariation = Math.sqrt(variance) / meanPitch;

    let sustainedCount = 0;
    let currentRun = 1;

    for (let i = 1; i < pitchPeriods.length; i++) {
      const pitchRatio = pitchPeriods[i] / pitchPeriods[i - 1];
      const isStable = pitchRatio > (1 - PITCH_STABILITY_THRESHOLD) && pitchRatio < (1 + PITCH_STABILITY_THRESHOLD);
      if (isStable) {
        currentRun++;
        if (currentRun >= SUSTAINED_RUN_THRESHOLD) sustainedCount++;
      } else {
        currentRun = 1;
      }
    }

    const sustainRatio = sustainedCount / pitchPeriods.length;
    const isSinging = sustainRatio > 0.15 && coeffOfVariation < 0.5;
    const confidence = Math.min(1, sustainRatio * 2 + (0.5 - Math.min(0.5, coeffOfVariation)));

    return { isSinging, confidence };
  } catch (e) {
    console.warn("[AudioQuality] Singing detection failed:", e.message);
    return DEFAULT_RESULT;
  }
}

/**
 * Measure RMS level for volume consistency
 * @param {Buffer} buffer - WAV audio buffer
 * @returns {number} RMS level in dB (typically -60 to 0)
 */
function measureRmsDb(buffer) {
  try {
    const extracted = extractSamples(buffer);
    if (!extracted || extracted.samples.length === 0) return -60;

    const { samples } = extracted;
    let sumSquares = 0;
    for (let i = 0; i < samples.length; i++) {
      sumSquares += samples[i] * samples[i];
    }

    const rms = Math.sqrt(sumSquares / samples.length);
    return rms > 0 ? 20 * Math.log10(rms) : -60;
  } catch (e) {
    console.warn("[AudioQuality] RMS measurement failed:", e.message);
    return -30;
  }
}

/**
 * Get audio duration in seconds
 * @param {Buffer} buffer - WAV audio buffer
 * @returns {number} Duration in seconds
 */
function getDuration(buffer) {
  try {
    const wavInfo = parseWavBuffer(buffer);
    return wavInfo.durationSec || 0;
  } catch (e) {
    console.warn("[AudioQuality] Duration calculation failed:", e.message);
    return 0;
  }
}

/**
 * Comprehensive audio quality assessment
 * @param {Buffer} buffer - WAV audio buffer
 * @returns {Object} Quality assessment with metrics and grade
 */
function assessAudioQuality(buffer) {
  const metrics = {
    snr_db: 0,
    clipping_ratio: 0,
    reverb_level: 0,
    rms_db: 0,
    duration_sec: 0,
    vad_ratio: 0,
    is_singing: false,
    singing_confidence: 0,
  };

  try {
    // Core metrics from existing QC
    metrics.snr_db = calculateSNR(buffer);
    metrics.clipping_ratio = calculateClippingRatio(buffer);

    // New metrics
    metrics.reverb_level = detectReverb(buffer);
    metrics.rms_db = measureRmsDb(buffer);
    metrics.duration_sec = getDuration(buffer);

    // VAD ratio - use parsed dataSize to handle extended WAV headers (iOS adds JUNK/LIST chunks)
    const trimmed = vadTrim(buffer, -40);
    const origWavInfo = parseWavBuffer(buffer);
    const trimmedWavInfo = parseWavBuffer(trimmed);
    const origSize = origWavInfo.dataSize;
    const trimSize = trimmedWavInfo.dataSize;
    metrics.vad_ratio = origSize > 0 ? trimSize / origSize : 0;

    // Singing detection
    const singingResult = detectSinging(buffer);
    metrics.is_singing = singingResult.isSinging;
    metrics.singing_confidence = singingResult.confidence;
  } catch (e) {
    console.warn("[AudioQuality] Assessment error:", e.message);
  }

  return metrics;
}

/**
 * Calculate quality grade from metrics
 * @param {Object} metrics - Audio metrics from assessAudioQuality
 * @returns {{grade: string, score: number, issues: string[]}}
 */
function calculateQualityGrade(metrics) {
  const issues = [];
  let score = 100;

  // SNR scoring (most important)
  if (metrics.snr_db < 12) {
    score -= 50;
    issues.push(`Very noisy (SNR ${metrics.snr_db.toFixed(1)}dB)`);
  } else if (metrics.snr_db < 18) {
    score -= 25;
    issues.push(`Noisy (SNR ${metrics.snr_db.toFixed(1)}dB)`);
  } else if (metrics.snr_db < 25) {
    score -= 10;
  }

  // Clipping scoring
  if (metrics.clipping_ratio > 0.05) {
    score -= 30;
    issues.push(`Clipping detected (${(metrics.clipping_ratio * 100).toFixed(1)}%)`);
  } else if (metrics.clipping_ratio > 0.03) {
    score -= 15;
    issues.push(`Minor clipping (${(metrics.clipping_ratio * 100).toFixed(1)}%)`);
  } else if (metrics.clipping_ratio > 0.01) {
    score -= 5;
  }

  // Reverb scoring
  if (metrics.reverb_level > 0.6) {
    score -= 20;
    issues.push("High reverb detected");
  } else if (metrics.reverb_level > 0.4) {
    score -= 10;
    issues.push("Moderate reverb");
  }

  // VAD ratio
  if (metrics.vad_ratio < 0.3) {
    score -= 15;
    issues.push("Low voice activity");
  }

  // Duration bonus for reference selection
  if (metrics.duration_sec >= 30) {
    score += 10;
  } else if (metrics.duration_sec < 10) {
    score -= 10;
    issues.push("Short duration");
  }

  // Singing bonus for voice conversion
  if (metrics.is_singing && metrics.singing_confidence > 0.6) {
    score += 15;
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  // Determine grade
  let grade;
  if (score >= 80) grade = "A";
  else if (score >= 60) grade = "B";
  else if (score >= 40) grade = "C";
  else grade = "F";

  return { grade, score, issues };
}

/**
 * Score a chunk for reference audio selection
 * Higher score = better reference candidate
 * @param {Buffer} buffer - WAV audio buffer
 * @returns {Object} Score and metrics
 */
function scoreReferenceAudio(buffer) {
  const metrics = assessAudioQuality(buffer);
  const { grade, score, issues } = calculateQualityGrade(metrics);

  return {
    metrics,
    grade,
    score,
    issues,
    // Computed suitability for voice conversion reference
    suitability: {
      forSinging: metrics.is_singing ? score + 15 : score,
      forSpeech: metrics.is_singing ? score : score + 5,
    },
  };
}

module.exports = {
  assessAudioQuality,
  calculateQualityGrade,
  scoreReferenceAudio,
  detectReverb,
  detectSinging,
  measureRmsDb,
  getDuration,
  QUALITY_THRESHOLDS,
  GRADE_VALUES,
};
