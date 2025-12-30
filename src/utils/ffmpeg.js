/**
 * FFmpeg wrapper for audio processing
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

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(getFFmpegPath(), args);
    let stderr = "";
    ffmpeg.stderr.on("data", (data) => { stderr += data.toString(); });
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("E301_FFMPEG_ERROR: " + stderr.slice(-500)));
    });
    ffmpeg.on("error", (err) => reject(new Error("E301_FFMPEG_ERROR: " + err.message)));
  });
}

async function mixTracks({ vocalPath, instrumentalPath, outputPath, vocalGain = 0.8, instrumentalGain = 0.6 }) {
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
  
  await runFFmpeg(args);
}

async function encodeToAAC(inputPath, outputPath, bitrate = "128k") {
  if (!fs.existsSync(inputPath)) {
    throw new Error("E302_ENCODING_ERROR: Input file not found: " + inputPath);
  }
  
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  
  const args = [
    "-y",
    "-i", inputPath,
    "-c:a", "aac",
    "-b:a", bitrate,
    "-ar", "44100",
    "-ac", "2",
    outputPath
  ];
  
  await runFFmpeg(args);
}

module.exports = { getFFmpegPath, mixTracks, encodeToAAC };
