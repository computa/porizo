/**
 * Tests for Audio Quality Service
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const {
  assessAudioQuality,
  calculateQualityGrade,
  scoreReferenceAudio,
  detectReverb,
  detectSinging,
  measureRmsDb,
  getDuration,
} = require("../src/services/audio-quality");

/**
 * Generate a simple WAV buffer for testing
 * @param {Object} options
 * @param {number} options.durationSec - Duration in seconds
 * @param {number} options.sampleRate - Sample rate (default 44100)
 * @param {number} options.frequency - Tone frequency in Hz (default 440)
 * @param {number} options.amplitude - Amplitude 0-1 (default 0.5)
 * @param {number} options.noiseLevel - Noise amplitude 0-1 (default 0)
 * @returns {Buffer} WAV buffer
 */
function generateTestWav({
  durationSec = 1,
  sampleRate = 44100,
  frequency = 440,
  amplitude = 0.5,
  noiseLevel = 0,
}) {
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2; // 16-bit = 2 bytes per sample
  const buffer = Buffer.alloc(44 + dataSize);

  // WAV header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size
  buffer.writeUInt16LE(1, 20); // AudioFormat (PCM)
  buffer.writeUInt16LE(1, 22); // NumChannels
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate
  buffer.writeUInt16LE(2, 32); // BlockAlign
  buffer.writeUInt16LE(16, 34); // BitsPerSample
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Generate samples
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sample = Math.sin(2 * Math.PI * frequency * t) * amplitude;

    // Add noise if specified
    if (noiseLevel > 0) {
      sample += (Math.random() * 2 - 1) * noiseLevel;
    }

    // Clamp and convert to 16-bit
    sample = Math.max(-1, Math.min(1, sample));
    const int16 = Math.round(sample * 32767);
    buffer.writeInt16LE(int16, 44 + i * 2);
  }

  return buffer;
}

/**
 * Generate silence WAV
 */
function generateSilenceWav(durationSec = 1, sampleRate = 44100) {
  return generateTestWav({ durationSec, sampleRate, amplitude: 0 });
}

/**
 * Generate noisy WAV (pure noise, no signal)
 */
function generateNoiseWav(durationSec = 1, noiseLevel = 0.3) {
  return generateTestWav({ durationSec, amplitude: 0, noiseLevel });
}

/**
 * Generate clipped WAV
 */
function generateClippedWav(durationSec = 1) {
  return generateTestWav({ durationSec, amplitude: 1.5 }); // Will be clipped
}

describe("Audio Quality Service", () => {
  describe("assessAudioQuality", () => {
    it("should return valid metrics for clean audio", () => {
      const buffer = generateTestWav({ durationSec: 2, amplitude: 0.5 });
      const metrics = assessAudioQuality(buffer);

      assert.ok(metrics.snr_db > 0, "SNR should be positive");
      assert.ok(metrics.clipping_ratio >= 0, "Clipping ratio should be non-negative");
      assert.ok(metrics.clipping_ratio < 0.01, "Clean audio should have minimal clipping");
      assert.ok(metrics.duration_sec > 0, "Duration should be positive");
      assert.ok(metrics.vad_ratio > 0, "VAD ratio should be positive");
    });

    it("should detect low SNR in noisy audio", () => {
      const buffer = generateTestWav({ durationSec: 2, amplitude: 0.1, noiseLevel: 0.3 });
      const metrics = assessAudioQuality(buffer);

      // Noisy audio should have lower SNR
      assert.ok(metrics.snr_db < 20, "Noisy audio should have low SNR");
    });

    it("should return low VAD ratio for silence", () => {
      const buffer = generateSilenceWav(2);
      const metrics = assessAudioQuality(buffer);

      assert.ok(metrics.vad_ratio < 0.3, "Silence should have low VAD ratio");
    });
  });

  describe("calculateQualityGrade", () => {
    it("should return grade A for excellent metrics", () => {
      const metrics = {
        snr_db: 30,
        clipping_ratio: 0,
        reverb_level: 0.1,
        vad_ratio: 0.8,
        duration_sec: 30,
        is_singing: true,
        singing_confidence: 0.8,
      };

      const result = calculateQualityGrade(metrics);
      assert.equal(result.grade, "A", "Excellent metrics should yield grade A");
      assert.ok(result.score >= 80, "Score should be >= 80 for grade A");
      assert.equal(result.issues.length, 0, "Should have no issues");
    });

    it("should return grade F for poor metrics", () => {
      const metrics = {
        snr_db: 5,
        clipping_ratio: 0.1,
        reverb_level: 0.8,
        vad_ratio: 0.2,
        duration_sec: 5,
        is_singing: false,
        singing_confidence: 0,
      };

      const result = calculateQualityGrade(metrics);
      assert.equal(result.grade, "F", "Poor metrics should yield grade F");
      assert.ok(result.issues.length > 0, "Should have issues listed");
    });

    it("should penalize low SNR", () => {
      const baseMetrics = {
        snr_db: 30,
        clipping_ratio: 0,
        reverb_level: 0.1,
        vad_ratio: 0.8,
        duration_sec: 20,
        is_singing: false,
        singing_confidence: 0,
      };

      const goodResult = calculateQualityGrade(baseMetrics);
      const poorResult = calculateQualityGrade({ ...baseMetrics, snr_db: 10 });

      assert.ok(
        goodResult.score > poorResult.score,
        "Lower SNR should result in lower score"
      );
    });

    it("should penalize clipping", () => {
      const baseMetrics = {
        snr_db: 25,
        clipping_ratio: 0,
        reverb_level: 0.1,
        vad_ratio: 0.8,
        duration_sec: 20,
        is_singing: false,
        singing_confidence: 0,
      };

      const cleanResult = calculateQualityGrade(baseMetrics);
      const clippedResult = calculateQualityGrade({ ...baseMetrics, clipping_ratio: 0.1 });

      assert.ok(
        cleanResult.score > clippedResult.score,
        "Clipping should result in lower score"
      );
    });

    it("should give bonus for singing content", () => {
      // Use metrics that don't max out the score (100) so singing bonus is visible
      // snr_db: 20 gives -10 penalty, reverb: 0.45 gives -10 penalty = base 80
      const baseMetrics = {
        snr_db: 20,
        clipping_ratio: 0,
        reverb_level: 0.45,
        vad_ratio: 0.8,
        duration_sec: 20,
        is_singing: false,
        singing_confidence: 0,
      };

      const speechResult = calculateQualityGrade(baseMetrics);
      const singingResult = calculateQualityGrade({
        ...baseMetrics,
        is_singing: true,
        singing_confidence: 0.8,
      });

      assert.ok(
        singingResult.score > speechResult.score,
        "Singing content should get bonus score"
      );
    });
  });

  describe("scoreReferenceAudio", () => {
    it("should return complete scoring object", () => {
      const buffer = generateTestWav({ durationSec: 5, amplitude: 0.5 });
      const result = scoreReferenceAudio(buffer);

      assert.ok(result.metrics, "Should have metrics");
      assert.ok(result.grade, "Should have grade");
      assert.ok(typeof result.score === "number", "Should have numeric score");
      assert.ok(result.suitability, "Should have suitability scores");
      assert.ok(typeof result.suitability.forSinging === "number", "Should have singing suitability");
      assert.ok(typeof result.suitability.forSpeech === "number", "Should have speech suitability");
    });
  });

  describe("measureRmsDb", () => {
    it("should return reasonable dB for moderate amplitude", () => {
      const buffer = generateTestWav({ durationSec: 1, amplitude: 0.5 });
      const rmsDb = measureRmsDb(buffer);

      // 0.5 amplitude sine wave has RMS of 0.5/sqrt(2) ≈ 0.354
      // 20*log10(0.354) ≈ -9 dB
      assert.ok(rmsDb > -20, "RMS should be > -20 dB for moderate amplitude");
      assert.ok(rmsDb < 0, "RMS should be < 0 dB");
    });

    it("should return low dB for silence", () => {
      const buffer = generateSilenceWav(1);
      const rmsDb = measureRmsDb(buffer);

      assert.ok(rmsDb <= -50, "Silence should have very low RMS");
    });
  });

  describe("getDuration", () => {
    it("should return correct duration", () => {
      const buffer = generateTestWav({ durationSec: 3.5 });
      const duration = getDuration(buffer);

      assert.ok(Math.abs(duration - 3.5) < 0.1, "Duration should be approximately 3.5 seconds");
    });
  });

  describe("detectReverb", () => {
    it("should return value between 0 and 1", () => {
      const buffer = generateTestWav({ durationSec: 2, amplitude: 0.5 });
      const reverb = detectReverb(buffer);

      assert.ok(reverb >= 0, "Reverb should be >= 0");
      assert.ok(reverb <= 1, "Reverb should be <= 1");
    });
  });

  describe("detectSinging", () => {
    it("should return confidence value", () => {
      const buffer = generateTestWav({ durationSec: 2, frequency: 440 });
      const result = detectSinging(buffer);

      assert.ok(typeof result.isSinging === "boolean", "Should return boolean isSinging");
      assert.ok(typeof result.confidence === "number", "Should return numeric confidence");
      assert.ok(result.confidence >= 0 && result.confidence <= 1, "Confidence should be 0-1");
    });
  });
});
