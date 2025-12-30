const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

// Test will fail until we implement the module
const { analyzeAudioQuality, vadTrim, calculateSNR, calculateClippingRatio } = require("../src/utils/qc");
const { writeWav } = require("../src/utils/audio");

const TEST_DIR = path.join(__dirname, "..", "storage", "test-qc");

describe("QC Functions", () => {
  before(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  after(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("calculateSNR", () => {
    it("should return high SNR for clean sine wave", () => {
      // Clean 440Hz sine wave should have high SNR (>20dB)
      const cleanPath = path.join(TEST_DIR, "clean.wav");
      writeWav(cleanPath, { durationSec: 2, frequencyHz: 440, sampleRate: 44100 });
      const buffer = fs.readFileSync(cleanPath);
      const snr = calculateSNR(buffer);
      assert.ok(snr > 20, `Expected SNR > 20dB, got ${snr}dB`);
    });

    it("should return low SNR for noisy audio", () => {
      // Create noisy audio by mixing with random noise
      const noisyPath = path.join(TEST_DIR, "noisy.wav");
      createNoisyWav(noisyPath, { durationSec: 2, noiseLevel: 0.5 });
      const buffer = fs.readFileSync(noisyPath);
      const snr = calculateSNR(buffer);
      assert.ok(snr < 15, `Expected SNR < 15dB for noisy audio, got ${snr}dB`);
    });
  });

  describe("calculateClippingRatio", () => {
    it("should return 0 for non-clipped audio", () => {
      const cleanPath = path.join(TEST_DIR, "no-clip.wav");
      writeWav(cleanPath, { durationSec: 1, frequencyHz: 440 });
      const buffer = fs.readFileSync(cleanPath);
      const ratio = calculateClippingRatio(buffer);
      assert.strictEqual(ratio, 0, "Clean sine wave should have 0% clipping");
    });

    it("should detect clipping in over-driven audio", () => {
      const clippedPath = path.join(TEST_DIR, "clipped.wav");
      createClippedWav(clippedPath, { durationSec: 1, clipRatio: 0.2 });
      const buffer = fs.readFileSync(clippedPath);
      const ratio = calculateClippingRatio(buffer);
      assert.ok(ratio > 0.05, `Expected clipping ratio > 5%, got ${(ratio * 100).toFixed(1)}%`);
    });
  });

  describe("vadTrim", () => {
    it("should trim leading silence", () => {
      const silentPath = path.join(TEST_DIR, "leading-silence.wav");
      createWavWithSilence(silentPath, { leadingSilenceSec: 1, audioSec: 1, trailingSilenceSec: 0 });
      const buffer = fs.readFileSync(silentPath);
      const trimmed = vadTrim(buffer, -40);
      // Trimmed buffer should be smaller (removed ~1 second of silence)
      assert.ok(trimmed.length < buffer.length, "Trimmed buffer should be smaller");
    });

    it("should trim trailing silence", () => {
      const silentPath = path.join(TEST_DIR, "trailing-silence.wav");
      createWavWithSilence(silentPath, { leadingSilenceSec: 0, audioSec: 1, trailingSilenceSec: 1 });
      const buffer = fs.readFileSync(silentPath);
      const trimmed = vadTrim(buffer, -40);
      assert.ok(trimmed.length < buffer.length, "Trimmed buffer should be smaller");
    });

    it("should preserve audio content", () => {
      const path1 = path.join(TEST_DIR, "with-silence.wav");
      createWavWithSilence(path1, { leadingSilenceSec: 0.5, audioSec: 1, trailingSilenceSec: 0.5 });
      const buffer = fs.readFileSync(path1);
      const trimmed = vadTrim(buffer, -40);
      // Should still have audio content (not empty)
      assert.ok(trimmed.length > 44, "Trimmed buffer should have audio content"); // 44 = WAV header
    });
  });

  describe("analyzeAudioQuality", () => {
    it("should pass for clean audio", () => {
      const cleanPath = path.join(TEST_DIR, "good-audio.wav");
      writeWav(cleanPath, { durationSec: 2, frequencyHz: 440 });
      const buffer = fs.readFileSync(cleanPath);
      const result = analyzeAudioQuality(buffer);
      assert.strictEqual(result.passed, true, "Clean audio should pass QC");
      assert.ok(result.metrics.snr_db > 15, "SNR should be > 15dB");
      assert.ok(result.metrics.clipping_ratio < 0.05, "Clipping should be < 5%");
    });

    it("should fail for noisy audio with E101 error", () => {
      const noisyPath = path.join(TEST_DIR, "bad-noisy.wav");
      createNoisyWav(noisyPath, { durationSec: 2, noiseLevel: 0.8 });
      const buffer = fs.readFileSync(noisyPath);
      const result = analyzeAudioQuality(buffer);
      assert.strictEqual(result.passed, false, "Noisy audio should fail QC");
      assert.ok(result.errors.some(e => e.includes("E101")), "Should include E101 error");
    });

    it("should fail for clipped audio with E102 error", () => {
      const clippedPath = path.join(TEST_DIR, "bad-clipped.wav");
      createClippedWav(clippedPath, { durationSec: 1, clipRatio: 0.2 });
      const buffer = fs.readFileSync(clippedPath);
      const result = analyzeAudioQuality(buffer);
      assert.strictEqual(result.passed, false, "Clipped audio should fail QC");
      assert.ok(result.errors.some(e => e.includes("E102")), "Should include E102 error");
    });
  });
});

// Helper functions to create test audio files

function createNoisyWav(filePath, { durationSec = 2, noiseLevel = 0.5, sampleRate = 44100 }) {
  const totalSamples = Math.floor(durationSec * sampleRate);
  const buffer = Buffer.alloc(44 + totalSamples * 2);

  // WAV header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + totalSamples * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(totalSamples * 2, 40);

  // Generate noisy audio (signal + noise)
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const signal = Math.sin(2 * Math.PI * 440 * t) * (1 - noiseLevel);
    const noise = (Math.random() * 2 - 1) * noiseLevel;
    const sample = Math.max(-1, Math.min(1, signal + noise));
    buffer.writeInt16LE(Math.round(sample * 0x7fff), 44 + i * 2);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
}

function createClippedWav(filePath, { durationSec = 1, clipRatio = 0.2, sampleRate = 44100 }) {
  const totalSamples = Math.floor(durationSec * sampleRate);
  const buffer = Buffer.alloc(44 + totalSamples * 2);

  // WAV header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + totalSamples * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(totalSamples * 2, 40);

  // Generate clipped audio (overdrive to cause clipping)
  const gain = 1 + clipRatio * 5; // Higher gain = more clipping
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * 440 * t) * gain;
    // Clamp to [-1, 1] - this creates clipping
    const clipped = Math.max(-1, Math.min(1, sample));
    buffer.writeInt16LE(Math.round(clipped * 0x7fff), 44 + i * 2);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
}

function createWavWithSilence(filePath, { leadingSilenceSec = 0, audioSec = 1, trailingSilenceSec = 0, sampleRate = 44100 }) {
  const leadingSamples = Math.floor(leadingSilenceSec * sampleRate);
  const audioSamples = Math.floor(audioSec * sampleRate);
  const trailingSamples = Math.floor(trailingSilenceSec * sampleRate);
  const totalSamples = leadingSamples + audioSamples + trailingSamples;
  const buffer = Buffer.alloc(44 + totalSamples * 2);

  // WAV header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + totalSamples * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(totalSamples * 2, 40);

  // Leading silence
  for (let i = 0; i < leadingSamples; i++) {
    buffer.writeInt16LE(0, 44 + i * 2);
  }

  // Audio content (440Hz sine)
  for (let i = 0; i < audioSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * 440 * t);
    buffer.writeInt16LE(Math.round(sample * 0x7fff), 44 + (leadingSamples + i) * 2);
  }

  // Trailing silence
  for (let i = 0; i < trailingSamples; i++) {
    buffer.writeInt16LE(0, 44 + (leadingSamples + audioSamples + i) * 2);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
}
