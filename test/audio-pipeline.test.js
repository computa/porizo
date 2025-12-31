const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

// Test will fail until we implement the modules
const { mixTracks, encodeToAAC, getFFmpegPath } = require("../src/utils/ffmpeg");
const { embedWatermark, extractWatermark } = require("../src/utils/watermark");
const { createHLSPlaylist } = require("../src/utils/hls");
const { writeWav } = require("../src/utils/audio");

const TEST_DIR = path.join(__dirname, "..", "storage", "test-audio-pipeline");

describe("Audio Pipeline", () => {
  before(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });

    // Create test audio files
    writeWav(path.join(TEST_DIR, "vocal.wav"), { durationSec: 3, frequencyHz: 440 });
    writeWav(path.join(TEST_DIR, "instrumental.wav"), { durationSec: 3, frequencyHz: 220 });
  });

  after(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("FFmpeg Setup", () => {
    it("should find ffmpeg binary", () => {
      const ffmpegPath = getFFmpegPath();
      assert.ok(ffmpegPath, "Should return ffmpeg path");
      assert.ok(fs.existsSync(ffmpegPath), `FFmpeg binary should exist at ${ffmpegPath}`);
    });
  });

  describe("mixTracks", () => {
    it("should mix vocal and instrumental tracks", async () => {
      const outputPath = path.join(TEST_DIR, "mixed.wav");
      await mixTracks({
        vocalPath: path.join(TEST_DIR, "vocal.wav"),
        instrumentalPath: path.join(TEST_DIR, "instrumental.wav"),
        outputPath,
        vocalGain: 0.8,
        instrumentalGain: 0.6,
      });

      assert.ok(fs.existsSync(outputPath), "Mixed file should exist");
      const stats = fs.statSync(outputPath);
      assert.ok(stats.size > 1000, "Mixed file should have content");
    });

    it("should handle missing input files gracefully", async () => {
      try {
        await mixTracks({
          vocalPath: path.join(TEST_DIR, "nonexistent.wav"),
          instrumentalPath: path.join(TEST_DIR, "instrumental.wav"),
          outputPath: path.join(TEST_DIR, "should-not-exist.wav"),
        });
        assert.fail("Should throw error for missing file");
      } catch (err) {
        assert.ok(err.message.includes("E301") || err.message.includes("not found"), "Should return FFmpeg error");
      }
    });
  });

  describe("encodeToAAC", () => {
    it("should encode WAV to AAC", async () => {
      const inputPath = path.join(TEST_DIR, "vocal.wav");
      const outputPath = path.join(TEST_DIR, "output.aac");

      await encodeToAAC(inputPath, outputPath, "128k");

      assert.ok(fs.existsSync(outputPath), "AAC file should exist");
      const stats = fs.statSync(outputPath);
      assert.ok(stats.size > 100, "AAC file should have content");
      // AAC files are typically smaller than WAV
      const inputStats = fs.statSync(inputPath);
      assert.ok(stats.size < inputStats.size, "AAC should be smaller than WAV");
    });

    it("should use default bitrate when not specified", async () => {
      const inputPath = path.join(TEST_DIR, "vocal.wav");
      const outputPath = path.join(TEST_DIR, "output-default.aac");

      await encodeToAAC(inputPath, outputPath);

      assert.ok(fs.existsSync(outputPath), "AAC file should exist");
    });
  });

  describe("embedWatermark", () => {
    it("should embed track version ID in audio metadata", async () => {
      const inputPath = path.join(TEST_DIR, "vocal.wav");
      const outputPath = path.join(TEST_DIR, "watermarked.wav");
      const trackVersionId = "test-track-version-12345";

      await embedWatermark(inputPath, outputPath, trackVersionId);

      assert.ok(fs.existsSync(outputPath), "Watermarked file should exist");
      const stats = fs.statSync(outputPath);
      assert.ok(stats.size > 0, "Watermarked file should have content");
    });

    it("should allow extraction of watermark", async () => {
      const inputPath = path.join(TEST_DIR, "vocal.wav");
      const outputPath = path.join(TEST_DIR, "watermarked-extract.wav");
      const trackVersionId = "extract-test-67890";

      await embedWatermark(inputPath, outputPath, trackVersionId);
      const result = await extractWatermark(outputPath);

      assert.strictEqual(result.found, true, "Watermark should be found");
      assert.strictEqual(result.trackVersionId, trackVersionId, "Extracted watermark should match embedded");
      assert.strictEqual(result.error, null, "Should have no error");
    });
  });

  describe("createHLSPlaylist", () => {
    it("should create HLS playlist with segments", async () => {
      const inputPath = path.join(TEST_DIR, "vocal.wav");
      const outputDir = path.join(TEST_DIR, "hls");

      await createHLSPlaylist(inputPath, outputDir, 2); // 2 second segments

      const playlistPath = path.join(outputDir, "playlist.m3u8");
      assert.ok(fs.existsSync(playlistPath), "Playlist file should exist");

      const playlistContent = fs.readFileSync(playlistPath, "utf8");
      assert.ok(playlistContent.includes("#EXTM3U"), "Playlist should have M3U header");
      assert.ok(playlistContent.includes("#EXT-X-TARGETDURATION"), "Playlist should have target duration");
      assert.ok(playlistContent.includes(".ts"), "Playlist should reference .ts segments");

      // Check that at least one segment file exists
      const files = fs.readdirSync(outputDir);
      const segments = files.filter(f => f.endsWith(".ts"));
      assert.ok(segments.length > 0, "Should have at least one segment file");
    });

    it("should create encrypted HLS when key is provided", async () => {
      const inputPath = path.join(TEST_DIR, "vocal.wav");
      const outputDir = path.join(TEST_DIR, "hls-encrypted");
      const keyId = "test-key-id";

      await createHLSPlaylist(inputPath, outputDir, 2, { keyId, keyUrl: "/api/key" });

      const playlistPath = path.join(outputDir, "playlist.m3u8");
      const playlistContent = fs.readFileSync(playlistPath, "utf8");
      assert.ok(playlistContent.includes("#EXT-X-KEY"), "Playlist should have encryption key reference");
    });
  });
});
