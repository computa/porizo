/**
 * Audio watermarking using metadata embedding
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

function getFFmpegPath() {
  try {
    return require("ffmpeg-static");
  } catch (err) {
    return "ffmpeg";
  }
}

function getFFprobePath() {
  try {
    return require("@ffprobe-installer/ffprobe").path;
  } catch (err) {
    return "ffprobe";
  }
}

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(getFFmpegPath(), args);
    let stderr = "";
    ffmpeg.stderr.on("data", (data) => { stderr += data.toString(); });
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Watermark error: " + stderr.slice(-500)));
    });
    ffmpeg.on("error", (err) => reject(new Error("Watermark error: " + err.message)));
  });
}

function runFFprobe(args) {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn(getFFprobePath(), args);
    let stdout = "";
    let stderr = "";
    ffprobe.stdout.on("data", (data) => { stdout += data.toString(); });
    ffprobe.stderr.on("data", (data) => { stderr += data.toString(); });
    ffprobe.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error("FFprobe error: " + stderr.slice(-500)));
    });
    ffprobe.on("error", (err) => reject(new Error("FFprobe error: " + err.message)));
  });
}

async function embedWatermark(inputPath, outputPath, trackVersionId) {
  if (!fs.existsSync(inputPath)) {
    throw new Error("Input file not found: " + inputPath);
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

async function extractWatermark(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error("File not found: " + filePath);
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
      return comment.slice(7);
    }
    return null;
  } catch (err) {
    return null;
  }
}

module.exports = { embedWatermark, extractWatermark };
