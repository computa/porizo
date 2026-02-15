/**
 * FFmpeg wrapper for audio processing
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { FFMPEG_TIMEOUT_MS, FFMPEG_MAX_STDERR_SIZE } = require("../config");

// Use config values for timeouts and buffer limits
const DEFAULT_TIMEOUT_MS = FFMPEG_TIMEOUT_MS;
const MAX_STDERR_SIZE = FFMPEG_MAX_STDERR_SIZE;

function getFFmpegPath() {
  try {
    return require("ffmpeg-static");
  } catch (err) {
    console.warn("[ffmpeg] ffmpeg-static not found, falling back to system ffmpeg");
    return "ffmpeg";
  }
}

function runFFmpeg(args, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(getFFmpegPath(), args);
    let stderr = "";
    let killed = false;

    // Timeout handler
    const timer = setTimeout(() => {
      killed = true;
      ffmpeg.kill("SIGKILL");
      reject(new Error("E301_FFMPEG_TIMEOUT: FFmpeg operation timed out after " + (timeoutMs / 1000) + "s"));
    }, timeoutMs);

    // Cap stderr buffer to prevent memory leak on long-running operations
    // Keep the END of stderr because that's where actual errors appear
    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
      if (stderr.length > MAX_STDERR_SIZE) {
        console.warn(`[ffmpeg] stderr exceeded ${MAX_STDERR_SIZE} bytes, keeping end`);
        stderr = "[earlier output truncated]\n" + stderr.slice(-MAX_STDERR_SIZE);
      }
    });

    ffmpeg.on("close", (code) => {
      clearTimeout(timer);
      if (killed) return; // Already rejected via timeout
      if (code === 0) resolve();
      else reject(new Error("E301_FFMPEG_ERROR: " + stderr.slice(-500)));
    });

    ffmpeg.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error("E301_FFMPEG_ERROR: " + err.message));
    });
  });
}

async function mixTracks({ vocalPath, instrumentalPath, outputPath, vocalGain = 0.8, instrumentalGain = 0.6, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!fs.existsSync(vocalPath)) {
    throw new Error("E301_FFMPEG_ERROR: Vocal file not found: " + vocalPath);
  }
  if (!fs.existsSync(instrumentalPath)) {
    throw new Error("E301_FFMPEG_ERROR: Instrumental file not found: " + instrumentalPath);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const args = [
    "-y",
    "-i", vocalPath,
    "-i", instrumentalPath,
    "-filter_complex",
    `[0:a]volume=${vocalGain}[v];[1:a]volume=${instrumentalGain}[i];[v][i]amix=inputs=2:duration=longest`,
    "-ac", "2",
    "-ar", "44100",
    outputPath
  ];

  await runFFmpeg(args, timeoutMs);
}

async function mixTracksPersonalized({
  vocalPath,
  instrumentalPath,
  outputPath,
  vocalGain = 0.95,
  instrumentalGain = 0.62,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!fs.existsSync(vocalPath)) {
    throw new Error("E301_FFMPEG_ERROR: Vocal file not found: " + vocalPath);
  }
  if (!fs.existsSync(instrumentalPath)) {
    throw new Error("E301_FFMPEG_ERROR: Instrumental file not found: " + instrumentalPath);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const args = [
    "-y",
    "-i", vocalPath,
    "-i", instrumentalPath,
    "-filter_complex",
    `[0:a]volume=${vocalGain},acompressor=threshold=-20dB:ratio=3:attack=5:release=80,highpass=f=80,lowpass=f=12000,aecho=0.8:0.88:40:0.25[v];` +
      `[1:a]volume=${instrumentalGain}[i];` +
      `[v][i]amix=inputs=2:duration=longest,loudnorm=I=-14:TP=-1:LRA=11`,
    "-ac", "2",
    "-ar", "44100",
    outputPath,
  ];

  await runFFmpeg(args, timeoutMs);
}

async function blendVocals({
  originalVocalPath,
  convertedVocalPath,
  outputPath,
  blendRatio = 0.6,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!fs.existsSync(originalVocalPath)) {
    throw new Error("E301_FFMPEG_ERROR: Original vocal file not found: " + originalVocalPath);
  }
  if (!fs.existsSync(convertedVocalPath)) {
    throw new Error("E301_FFMPEG_ERROR: Converted vocal file not found: " + convertedVocalPath);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const origVol = (1 - blendRatio).toFixed(3);
  const convVol = blendRatio.toFixed(3);

  const args = [
    "-y",
    "-i", originalVocalPath,
    "-i", convertedVocalPath,
    "-filter_complex",
    `[0:a]loudnorm=I=-18:TP=-1:LRA=11,volume=${origVol}[orig];` +
    `[1:a]loudnorm=I=-18:TP=-1:LRA=11,volume=${convVol}[conv];` +
    `[orig][conv]amix=inputs=2:duration=longest`,
    "-ac", "2",
    "-ar", "44100",
    outputPath,
  ];

  await runFFmpeg(args, timeoutMs);
}

async function encodeToAAC(inputPath, outputPath, bitrate = "128k", timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!fs.existsSync(inputPath)) {
    throw new Error("E302_ENCODING_ERROR: Input file not found: " + inputPath);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  // Use M4A container (MP4 with AAC) for better iOS compatibility
  // Raw ADTS AAC has issues with iOS AVPlayer streaming
  const args = [
    "-y",
    "-i", inputPath,
    "-c:a", "aac",
    "-b:a", bitrate,
    "-ar", "44100",
    "-ac", "2",
    "-f", "ipod",  // Force M4A/MP4 container format
    "-movflags", "+faststart",  // Enable streaming playback
    outputPath
  ];

  await runFFmpeg(args, timeoutMs);
}

module.exports = {
  getFFmpegPath,
  runFFmpeg,
  mixTracks,
  mixTracksPersonalized,
  blendVocals,
  encodeToAAC,
  DEFAULT_TIMEOUT_MS,
};
