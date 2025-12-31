/**
 * Audio watermarking using metadata embedding
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const DEFAULT_TIMEOUT_MS = 60000; // 1 minute

function getFFmpegPath() {
  try {
    return require("ffmpeg-static");
  } catch (err) {
    console.warn("[watermark] ffmpeg-static not found, falling back to system ffmpeg");
    return "ffmpeg";
  }
}

function getFFprobePath() {
  try {
    return require("@ffprobe-installer/ffprobe").path;
  } catch (err) {
    console.warn("[watermark] @ffprobe-installer/ffprobe not found, falling back to system ffprobe");
    return "ffprobe";
  }
}

function runFFmpeg(args, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(getFFmpegPath(), args);
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      ffmpeg.kill("SIGKILL");
      reject(new Error("E303_WATERMARK_TIMEOUT: Operation timed out"));
    }, timeoutMs);

    ffmpeg.stderr.on("data", (data) => { stderr += data.toString(); });
    ffmpeg.on("close", (code) => {
      clearTimeout(timer);
      if (killed) return;
      if (code === 0) resolve();
      else reject(new Error("E303_WATERMARK_ERROR: " + stderr.slice(-500)));
    });
    ffmpeg.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error("E303_WATERMARK_ERROR: " + err.message));
    });
  });
}

function runFFprobe(args, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn(getFFprobePath(), args);
    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      ffprobe.kill("SIGKILL");
      reject(new Error("E304_FFPROBE_TIMEOUT: Operation timed out"));
    }, timeoutMs);

    ffprobe.stdout.on("data", (data) => { stdout += data.toString(); });
    ffprobe.stderr.on("data", (data) => { stderr += data.toString(); });
    ffprobe.on("close", (code) => {
      clearTimeout(timer);
      if (killed) return;
      if (code === 0) resolve(stdout);
      else reject(new Error("E304_FFPROBE_ERROR: " + stderr.slice(-500)));
    });
    ffprobe.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error("E304_FFPROBE_ERROR: " + err.message));
    });
  });
}

async function embedWatermark(inputPath, outputPath, trackVersionId) {
  if (!fs.existsSync(inputPath)) {
    throw new Error("E303_WATERMARK_ERROR: Input file not found: " + inputPath);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const args = [
    "-y",
    "-i", inputPath,
    "-metadata", "comment=porizo:" + trackVersionId,
    "-metadata", "encoded_by=porizo",
    "-c:a", "copy",
    outputPath
  ];

  await runFFmpeg(args);
}

/**
 * Extract watermark from audio file
 * @param {string} filePath - Path to audio file
 * @returns {Promise<{found: boolean, trackVersionId: string|null, error: string|null}>}
 */
async function extractWatermark(filePath) {
  if (!fs.existsSync(filePath)) {
    return { found: false, trackVersionId: null, error: "File not found: " + filePath };
  }

  const args = [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    filePath
  ];

  try {
    const output = await runFFprobe(args);
    const data = JSON.parse(output);
    const comment = data?.format?.tags?.comment || data?.format?.tags?.COMMENT || "";
    if (comment.startsWith("porizo:")) {
      return { found: true, trackVersionId: comment.slice(7), error: null };
    }
    return { found: false, trackVersionId: null, error: null }; // No watermark present
  } catch (err) {
    console.error("[extractWatermark] Error extracting watermark:", err.message);
    return { found: false, trackVersionId: null, error: err.message };
  }
}

module.exports = { embedWatermark, extractWatermark };
