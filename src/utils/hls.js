/**
 * HLS playlist generation for streaming
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

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
      else reject(new Error("HLS error: " + stderr.slice(-500)));
    });
    ffmpeg.on("error", (err) => reject(new Error("HLS error: " + err.message)));
  });
}

async function createHLSPlaylist(inputPath, outputDir, segmentDuration = 4, options = {}) {
  if (!fs.existsSync(inputPath)) {
    throw new Error("Input file not found: " + inputPath);
  }
  
  fs.mkdirSync(outputDir, { recursive: true });
  
  const playlistPath = path.join(outputDir, "playlist.m3u8");
  const segmentPattern = path.join(outputDir, "segment%03d.ts");
  
  const args = [
    "-y",
    "-i", inputPath,
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "44100",
    "-ac", "2",
    "-f", "hls",
    "-hls_time", String(segmentDuration),
    "-hls_list_size", "0",
    "-hls_segment_filename", segmentPattern
  ];
  
  if (options.keyId && options.keyUrl) {
    const keyPath = path.join(outputDir, "encryption.key");
    const key = crypto.randomBytes(16);
    fs.writeFileSync(keyPath, key);
    
    const keyInfoPath = path.join(outputDir, "keyinfo.txt");
    const keyInfoContent = [
      options.keyUrl,
      keyPath,
      key.toString("hex")
    ].join("\n");
    fs.writeFileSync(keyInfoPath, keyInfoContent);
    
    args.push("-hls_key_info_file", keyInfoPath);
  }
  
  args.push(playlistPath);
  
  await runFFmpeg(args);
  
  return { playlistPath, outputDir };
}

module.exports = { createHLSPlaylist };
