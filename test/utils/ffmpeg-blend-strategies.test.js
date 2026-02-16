const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const {
  blendVocals,
  measureBandEnergy,
  getFFmpegPath,
} = require("../../src/utils/ffmpeg");
const { writeWav } = require("../../src/utils/audio");

const TEST_DIR = path.join(__dirname, "..", "..", "storage", "test-blend-strategies");

function probeFormat(outputPath) {
  const ffmpegPath = getFFmpegPath();
  const ffprobeCandidate = ffmpegPath.replace(/ffmpeg$/, "ffprobe");
  const ffprobePath = fs.existsSync(ffprobeCandidate) ? ffprobeCandidate : "ffprobe";
  const probe = execFileSync(ffprobePath, [
    "-v", "error",
    "-select_streams", "a:0",
    "-show_entries", "stream=sample_rate,channels",
    "-of", "csv=p=0",
    outputPath,
  ], { encoding: "utf-8" }).trim();
  const [sampleRate, channels] = probe.split(",");
  return { sampleRate, channels };
}

describe("Timbre Blend Strategies", () => {
  before(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    // Original AI vocal at 440Hz (A4), converted user vocal at 330Hz (E4)
    writeWav(path.join(TEST_DIR, "original.wav"), { durationSec: 3, frequencyHz: 440 });
    writeWav(path.join(TEST_DIR, "converted.wav"), { durationSec: 3, frequencyHz: 330 });
    writeWav(path.join(TEST_DIR, "short-orig.wav"), { durationSec: 0.1, frequencyHz: 440 });
    writeWav(path.join(TEST_DIR, "short-conv.wav"), { durationSec: 0.1, frequencyHz: 330 });
  });

  after(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // --- Strategy router ---

  describe("strategy router", () => {
    test("defaults to amplitude when no strategy specified", async () => {
      const outputPath = path.join(TEST_DIR, "default-strategy.wav");
      await blendVocals({
        originalVocalPath: path.join(TEST_DIR, "original.wav"),
        convertedVocalPath: path.join(TEST_DIR, "converted.wav"),
        outputPath,
        blendRatio: 0.25,
      });
      assert.ok(fs.existsSync(outputPath));
      const stats = fs.statSync(outputPath);
      assert.ok(stats.size > 1000);
    });

    test("falls back to amplitude for unknown strategy", async () => {
      const outputPath = path.join(TEST_DIR, "unknown-strategy.wav");
      await blendVocals({
        originalVocalPath: path.join(TEST_DIR, "original.wav"),
        convertedVocalPath: path.join(TEST_DIR, "converted.wav"),
        outputPath,
        blendRatio: 0.25,
        strategy: "nonexistent_strategy",
      });
      assert.ok(fs.existsSync(outputPath));
    });

    test("throws for missing original vocal file", async () => {
      await assert.rejects(
        () => blendVocals({
          originalVocalPath: path.join(TEST_DIR, "nonexistent.wav"),
          convertedVocalPath: path.join(TEST_DIR, "converted.wav"),
          outputPath: path.join(TEST_DIR, "should-not-exist.wav"),
        }),
        (err) => {
          assert.ok(err.message.includes("E301"));
          assert.ok(err.message.includes("Original vocal file not found"));
          return true;
        }
      );
    });

    test("throws for missing converted vocal file", async () => {
      await assert.rejects(
        () => blendVocals({
          originalVocalPath: path.join(TEST_DIR, "original.wav"),
          convertedVocalPath: path.join(TEST_DIR, "nonexistent.wav"),
          outputPath: path.join(TEST_DIR, "should-not-exist.wav"),
        }),
        (err) => {
          assert.ok(err.message.includes("E301"));
          assert.ok(err.message.includes("Converted vocal file not found"));
          return true;
        }
      );
    });
  });

  // --- Amplitude ---

  describe("amplitude", () => {
    test("produces valid 44100Hz stereo output", async () => {
      const outputPath = path.join(TEST_DIR, "amplitude-probe.wav");
      await blendVocals({
        originalVocalPath: path.join(TEST_DIR, "original.wav"),
        convertedVocalPath: path.join(TEST_DIR, "converted.wav"),
        outputPath,
        strategy: "amplitude",
        blendRatio: 0.25,
      });
      const { sampleRate, channels } = probeFormat(outputPath);
      assert.equal(sampleRate, "44100");
      assert.equal(channels, "2");
    });

    test("handles short audio", async () => {
      const outputPath = path.join(TEST_DIR, "amplitude-short.wav");
      await blendVocals({
        originalVocalPath: path.join(TEST_DIR, "short-orig.wav"),
        convertedVocalPath: path.join(TEST_DIR, "short-conv.wav"),
        outputPath,
        strategy: "amplitude",
        blendRatio: 0.25,
      });
      assert.ok(fs.existsSync(outputPath));
    });
  });

  // --- Spectral Crossover ---

  describe("spectral_crossover", () => {
    test("produces valid output with meaningful content", async () => {
      const outputPath = path.join(TEST_DIR, "spectral-normal.wav");
      await blendVocals({
        originalVocalPath: path.join(TEST_DIR, "original.wav"),
        convertedVocalPath: path.join(TEST_DIR, "converted.wav"),
        outputPath,
        strategy: "spectral_crossover",
        strategyParams: { lowCrossover: 300, highCrossover: 3000, midBlendRatio: 0.30 },
      });
      assert.ok(fs.existsSync(outputPath));
      const stats = fs.statSync(outputPath);
      assert.ok(stats.size > 1000);
    });

    test("produces valid 44100Hz stereo output", async () => {
      const outputPath = path.join(TEST_DIR, "spectral-probe.wav");
      await blendVocals({
        originalVocalPath: path.join(TEST_DIR, "original.wav"),
        convertedVocalPath: path.join(TEST_DIR, "converted.wav"),
        outputPath,
        strategy: "spectral_crossover",
        strategyParams: { lowCrossover: 300, highCrossover: 3000, midBlendRatio: 0.30 },
      });
      const { sampleRate, channels } = probeFormat(outputPath);
      assert.equal(sampleRate, "44100");
      assert.equal(channels, "2");
    });

    test("handles short audio", async () => {
      const outputPath = path.join(TEST_DIR, "spectral-short.wav");
      await blendVocals({
        originalVocalPath: path.join(TEST_DIR, "short-orig.wav"),
        convertedVocalPath: path.join(TEST_DIR, "short-conv.wav"),
        outputPath,
        strategy: "spectral_crossover",
        strategyParams: { lowCrossover: 300, highCrossover: 3000, midBlendRatio: 0.30 },
      });
      assert.ok(fs.existsSync(outputPath));
    });

    test("works with custom crossover frequencies", async () => {
      const outputPath = path.join(TEST_DIR, "spectral-custom.wav");
      await blendVocals({
        originalVocalPath: path.join(TEST_DIR, "original.wav"),
        convertedVocalPath: path.join(TEST_DIR, "converted.wav"),
        outputPath,
        strategy: "spectral_crossover",
        strategyParams: { lowCrossover: 200, highCrossover: 4000, midBlendRatio: 0.50 },
      });
      assert.ok(fs.existsSync(outputPath));
      assert.ok(fs.statSync(outputPath).size > 1000);
    });
  });

  // --- Vocal Doubling ---

  describe("vocal_doubling", () => {
    test("produces valid output with meaningful content", async () => {
      const outputPath = path.join(TEST_DIR, "doubling-normal.wav");
      await blendVocals({
        originalVocalPath: path.join(TEST_DIR, "original.wav"),
        convertedVocalPath: path.join(TEST_DIR, "converted.wav"),
        outputPath,
        strategy: "vocal_doubling",
        strategyParams: { doublingLevel: 0.12, presenceCutFreq: 4000, presenceCutGain: -8 },
      });
      assert.ok(fs.existsSync(outputPath));
      assert.ok(fs.statSync(outputPath).size > 1000);
    });

    test("produces valid 44100Hz stereo output", async () => {
      const outputPath = path.join(TEST_DIR, "doubling-probe.wav");
      await blendVocals({
        originalVocalPath: path.join(TEST_DIR, "original.wav"),
        convertedVocalPath: path.join(TEST_DIR, "converted.wav"),
        outputPath,
        strategy: "vocal_doubling",
        strategyParams: { doublingLevel: 0.12, presenceCutFreq: 4000, presenceCutGain: -8 },
      });
      const { sampleRate, channels } = probeFormat(outputPath);
      assert.equal(sampleRate, "44100");
      assert.equal(channels, "2");
    });

    test("handles short audio", async () => {
      const outputPath = path.join(TEST_DIR, "doubling-short.wav");
      await blendVocals({
        originalVocalPath: path.join(TEST_DIR, "short-orig.wav"),
        convertedVocalPath: path.join(TEST_DIR, "short-conv.wav"),
        outputPath,
        strategy: "vocal_doubling",
        strategyParams: { doublingLevel: 0.12, presenceCutFreq: 4000, presenceCutGain: -8 },
      });
      assert.ok(fs.existsSync(outputPath));
    });

    test("works with aggressive compression settings", async () => {
      const outputPath = path.join(TEST_DIR, "doubling-aggressive.wav");
      await blendVocals({
        originalVocalPath: path.join(TEST_DIR, "original.wav"),
        convertedVocalPath: path.join(TEST_DIR, "converted.wav"),
        outputPath,
        strategy: "vocal_doubling",
        strategyParams: { doublingLevel: 0.25, presenceCutFreq: 3000, presenceCutGain: -12 },
      });
      assert.ok(fs.existsSync(outputPath));
      assert.ok(fs.statSync(outputPath).size > 1000);
    });
  });

  // --- Formant Transfer ---

  describe("formant_transfer", () => {
    test("produces valid output with meaningful content", async () => {
      const outputPath = path.join(TEST_DIR, "formant-normal.wav");
      await blendVocals({
        originalVocalPath: path.join(TEST_DIR, "original.wav"),
        convertedVocalPath: path.join(TEST_DIR, "converted.wav"),
        outputPath,
        strategy: "formant_transfer",
        strategyParams: { transferStrength: 0.5, maxGainDb: 12 },
      });
      assert.ok(fs.existsSync(outputPath));
      assert.ok(fs.statSync(outputPath).size > 1000);
    });

    test("produces valid 44100Hz stereo output", async () => {
      const outputPath = path.join(TEST_DIR, "formant-probe.wav");
      await blendVocals({
        originalVocalPath: path.join(TEST_DIR, "original.wav"),
        convertedVocalPath: path.join(TEST_DIR, "converted.wav"),
        outputPath,
        strategy: "formant_transfer",
        strategyParams: { transferStrength: 0.5, maxGainDb: 12 },
      });
      const { sampleRate, channels } = probeFormat(outputPath);
      assert.equal(sampleRate, "44100");
      assert.equal(channels, "2");
    });

    test("handles short audio", async () => {
      const outputPath = path.join(TEST_DIR, "formant-short.wav");
      await blendVocals({
        originalVocalPath: path.join(TEST_DIR, "short-orig.wav"),
        convertedVocalPath: path.join(TEST_DIR, "short-conv.wav"),
        outputPath,
        strategy: "formant_transfer",
        strategyParams: { transferStrength: 0.5, maxGainDb: 12 },
      });
      assert.ok(fs.existsSync(outputPath));
    });

    test("works with zero transfer strength (passthrough)", async () => {
      const outputPath = path.join(TEST_DIR, "formant-zero.wav");
      await blendVocals({
        originalVocalPath: path.join(TEST_DIR, "original.wav"),
        convertedVocalPath: path.join(TEST_DIR, "converted.wav"),
        outputPath,
        strategy: "formant_transfer",
        strategyParams: { transferStrength: 0, maxGainDb: 12 },
      });
      assert.ok(fs.existsSync(outputPath));
    });
  });

  // --- measureBandEnergy ---

  describe("measureBandEnergy", () => {
    test("returns energy values for each band", async () => {
      const bands = [250, 500, 1000, 2000];
      const energy = await measureBandEnergy(path.join(TEST_DIR, "original.wav"), bands);
      assert.equal(energy.length, bands.length);
      for (const val of energy) {
        assert.equal(typeof val, "number");
        assert.ok(val <= 0, "Energy in dB should be <= 0");
        assert.ok(val >= -100, "Energy should be reasonable (>= -100 dB)");
      }
    });

    test("440Hz tone has most energy near 500Hz band", async () => {
      const bands = [125, 250, 500, 1000, 2000, 4000];
      const energy = await measureBandEnergy(path.join(TEST_DIR, "original.wav"), bands);
      const idx500 = bands.indexOf(500);
      const peak = Math.max(...energy);
      assert.equal(energy[idx500], peak, "440Hz tone should peak at 500Hz band");
    });
  });
});
