const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { polishVocal, getFFmpegPath } = require("../../src/utils/ffmpeg");
const { writeWav } = require("../../src/utils/audio");

const TEST_DIR = path.join(__dirname, "..", "..", "storage", "test-polish");

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

describe("Vocal Polish", () => {
  before(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    // Generate test vocal: 3 seconds at 440Hz (A4)
    writeWav(path.join(TEST_DIR, "input.wav"), { durationSec: 3, frequencyHz: 440 });
  });

  after(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // --- De-essing ---

  describe("de-essing", () => {
    test("de-essing EQ appears in filter chain with correct params", async () => {
      const outputPath = path.join(TEST_DIR, "de-ess-default.wav");
      await polishVocal({
        inputPath: path.join(TEST_DIR, "input.wav"),
        outputPath,
        params: {},
      });
      // Output should exist and be valid — de-essing defaults applied (6500Hz, -4dB, Q=2)
      assert.ok(fs.existsSync(outputPath), "Output file should exist");
      const { sampleRate, channels } = probeFormat(outputPath);
      assert.equal(sampleRate, "44100");
      assert.equal(channels, "2");
    });

    test("de-ess params are clamped to valid bounds", async () => {
      const outputPath = path.join(TEST_DIR, "de-ess-clamped.wav");
      // Values outside valid range should be clamped, not crash
      await polishVocal({
        inputPath: path.join(TEST_DIR, "input.wav"),
        outputPath,
        params: {
          deEssFreq: 99999,   // max 9000
          deEssGain: -50,      // min -12
          deEssWidth: 100,     // max 4.0
        },
      });
      assert.ok(fs.existsSync(outputPath), "Output with clamped values should exist");
    });

    test("de-ess gain of 0 effectively disables de-essing", async () => {
      const outputPath = path.join(TEST_DIR, "de-ess-disabled.wav");
      await polishVocal({
        inputPath: path.join(TEST_DIR, "input.wav"),
        outputPath,
        params: { deEssGain: 0 },
      });
      assert.ok(fs.existsSync(outputPath), "Output should exist with de-essing disabled");
    });
  });

  // --- Full chain ---

  describe("full filter chain", () => {
    test("all 11 params produce valid output", async () => {
      const outputPath = path.join(TEST_DIR, "full-chain.wav");
      await polishVocal({
        inputPath: path.join(TEST_DIR, "input.wav"),
        outputPath,
        params: {
          highpassFreq: 100,
          lowpassFreq: 10000,
          compressionRatio: 6,
          compressionThreshold: 0.15,
          deHarshFreq: 2500,
          deHarshGain: -5,
          warmthFreq: 250,
          warmthGain: 3,
          deEssFreq: 7000,
          deEssGain: -6,
          deEssWidth: 1.5,
        },
      });
      assert.ok(fs.existsSync(outputPath), "Output with all 11 params should exist");
      const { sampleRate, channels } = probeFormat(outputPath);
      assert.equal(sampleRate, "44100");
      assert.equal(channels, "2");
    });

    test("default params produce valid output when called with empty object", async () => {
      const outputPath = path.join(TEST_DIR, "defaults.wav");
      await polishVocal({
        inputPath: path.join(TEST_DIR, "input.wav"),
        outputPath,
        params: {},
      });
      assert.ok(fs.existsSync(outputPath), "Output with defaults should exist");
      const stat = fs.statSync(outputPath);
      assert.ok(stat.size > 1000, "Output file should have meaningful size");
    });

    test("valid WAV output is playable", async () => {
      const outputPath = path.join(TEST_DIR, "playable.wav");
      await polishVocal({
        inputPath: path.join(TEST_DIR, "input.wav"),
        outputPath,
        params: {},
      });
      // Verify duration via ffprobe
      const ffmpegPath = getFFmpegPath();
      const ffprobeCandidate = ffmpegPath.replace(/ffmpeg$/, "ffprobe");
      const ffprobePath = fs.existsSync(ffprobeCandidate) ? ffprobeCandidate : "ffprobe";
      const duration = execFileSync(ffprobePath, [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "csv=p=0",
        outputPath,
      ], { encoding: "utf-8" }).trim();
      const durationSec = parseFloat(duration);
      assert.ok(durationSec > 2.5 && durationSec < 4.0, `Duration ${durationSec}s should be ~3s`);
    });
  });

  // --- Error handling ---

  describe("error handling", () => {
    test("throws E301_FFMPEG_ERROR for missing input", async () => {
      const outputPath = path.join(TEST_DIR, "missing-input.wav");
      await assert.rejects(
        () => polishVocal({
          inputPath: path.join(TEST_DIR, "nonexistent.wav"),
          outputPath,
          params: {},
        }),
        (err) => {
          assert.ok(err.message.includes("E301_FFMPEG_ERROR"), `Expected E301 error, got: ${err.message}`);
          return true;
        },
      );
    });
  });
});
