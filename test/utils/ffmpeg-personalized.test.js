const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { mixTracksPersonalized, getFFmpegPath } = require("../../src/utils/ffmpeg");
const { writeWav } = require("../../src/utils/audio");

const TEST_DIR = path.join(__dirname, "..", "..", "storage", "test-personalized-mix");

describe("mixTracksPersonalized", () => {
  before(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    // 3-second vocal at 440Hz (A4), 3-second instrumental at 220Hz (A3)
    writeWav(path.join(TEST_DIR, "vocal.wav"), { durationSec: 3, frequencyHz: 440 });
    writeWav(path.join(TEST_DIR, "instrumental.wav"), { durationSec: 3, frequencyHz: 220 });
    // Very short audio (0.1s) - edge case
    writeWav(path.join(TEST_DIR, "short-vocal.wav"), { durationSec: 0.1, frequencyHz: 440 });
    writeWav(path.join(TEST_DIR, "short-inst.wav"), { durationSec: 0.1, frequencyHz: 220 });
    // Silent audio (frequency 0 produces silence)
    writeWav(path.join(TEST_DIR, "silent-vocal.wav"), { durationSec: 2, frequencyHz: 0 });
    writeWav(path.join(TEST_DIR, "silent-inst.wav"), { durationSec: 2, frequencyHz: 0 });
  });

  after(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test("produces valid output with correct format", async () => {
    const outputPath = path.join(TEST_DIR, "mixed-normal.wav");
    await mixTracksPersonalized({
      vocalPath: path.join(TEST_DIR, "vocal.wav"),
      instrumentalPath: path.join(TEST_DIR, "instrumental.wav"),
      outputPath,
    });

    assert.ok(fs.existsSync(outputPath), "Output file should exist");
    const stats = fs.statSync(outputPath);
    assert.ok(stats.size > 1000, "Output should have meaningful content");
  });

  test("output passes ffprobe validation (44100Hz, stereo)", async () => {
    const outputPath = path.join(TEST_DIR, "mixed-probe.wav");
    await mixTracksPersonalized({
      vocalPath: path.join(TEST_DIR, "vocal.wav"),
      instrumentalPath: path.join(TEST_DIR, "instrumental.wav"),
      outputPath,
    });

    // Run ffprobe to validate format — using execFileSync for safety (no shell injection)
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
    assert.equal(sampleRate, "44100", "Sample rate should be 44100");
    assert.equal(channels, "2", "Output should be stereo");
  });

  test("handles very short audio without crashing", async () => {
    const outputPath = path.join(TEST_DIR, "mixed-short.wav");
    await mixTracksPersonalized({
      vocalPath: path.join(TEST_DIR, "short-vocal.wav"),
      instrumentalPath: path.join(TEST_DIR, "short-inst.wav"),
      outputPath,
    });

    assert.ok(fs.existsSync(outputPath), "Output should exist for short audio");
    const stats = fs.statSync(outputPath);
    assert.ok(stats.size > 0, "Output should not be empty");
  });

  test("handles silent audio without crashing", async () => {
    const outputPath = path.join(TEST_DIR, "mixed-silent.wav");
    await mixTracksPersonalized({
      vocalPath: path.join(TEST_DIR, "silent-vocal.wav"),
      instrumentalPath: path.join(TEST_DIR, "silent-inst.wav"),
      outputPath,
    });

    assert.ok(fs.existsSync(outputPath), "Output should exist for silent audio");
  });

  test("respects custom gain parameters", async () => {
    const outputPath = path.join(TEST_DIR, "mixed-custom-gain.wav");
    await mixTracksPersonalized({
      vocalPath: path.join(TEST_DIR, "vocal.wav"),
      instrumentalPath: path.join(TEST_DIR, "instrumental.wav"),
      outputPath,
      vocalGain: 1.0,
      instrumentalGain: 0.4,
    });

    assert.ok(fs.existsSync(outputPath), "Output with custom gains should exist");
    const stats = fs.statSync(outputPath);
    assert.ok(stats.size > 1000, "Output should have content");
  });

  test("throws for missing vocal file", async () => {
    await assert.rejects(
      () =>
        mixTracksPersonalized({
          vocalPath: path.join(TEST_DIR, "nonexistent.wav"),
          instrumentalPath: path.join(TEST_DIR, "instrumental.wav"),
          outputPath: path.join(TEST_DIR, "should-not-exist.wav"),
        }),
      (err) => {
        assert.ok(err.message.includes("E301"), "Should throw E301 error");
        assert.ok(err.message.includes("Vocal file not found"), "Should mention vocal");
        return true;
      }
    );
  });

  test("throws for missing instrumental file", async () => {
    await assert.rejects(
      () =>
        mixTracksPersonalized({
          vocalPath: path.join(TEST_DIR, "vocal.wav"),
          instrumentalPath: path.join(TEST_DIR, "nonexistent.wav"),
          outputPath: path.join(TEST_DIR, "should-not-exist.wav"),
        }),
      (err) => {
        assert.ok(err.message.includes("E301"), "Should throw E301 error");
        assert.ok(err.message.includes("Instrumental file not found"), "Should mention instrumental");
        return true;
      }
    );
  });

  test("creates output directory if it does not exist", async () => {
    const nestedOutput = path.join(TEST_DIR, "nested", "deep", "mixed.wav");
    await mixTracksPersonalized({
      vocalPath: path.join(TEST_DIR, "vocal.wav"),
      instrumentalPath: path.join(TEST_DIR, "instrumental.wav"),
      outputPath: nestedOutput,
    });

    assert.ok(fs.existsSync(nestedOutput), "Output should be created in nested directory");
  });
});
