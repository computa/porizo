/**
 * HLS playlist generation for streaming
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const DEFAULT_TIMEOUT_MS = 120000; // 2 minutes

function getFFmpegPath() {
  try {
    return require("ffmpeg-static");
  } catch (err) {
    console.warn("[hls] ffmpeg-static not found, falling back to system ffmpeg");
    return "ffmpeg";
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
      reject(new Error("E305_HLS_TIMEOUT: HLS generation timed out after " + (timeoutMs / 1000) + "s"));
    }, timeoutMs);

    ffmpeg.stderr.on("data", (data) => { stderr += data.toString(); });
    ffmpeg.on("close", (code) => {
      clearTimeout(timer);
      if (killed) return;
      if (code === 0) resolve();
      else reject(new Error("E305_HLS_ERROR: " + stderr.slice(-500)));
    });
    ffmpeg.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error("E305_HLS_ERROR: " + err.message));
    });
  });
}

async function createHLSPlaylist(inputPath, outputDir, segmentDuration = 4, options = {}) {
  if (!fs.existsSync(inputPath)) {
    throw new Error("E305_HLS_ERROR: Input file not found: " + inputPath);
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

  const shouldEncrypt = Boolean(options.keyUrl && (options.key || options.keyId));
  if (shouldEncrypt) {
    const keyPath = path.join(outputDir, "encryption.key");
    let key = null;
    if (options.key) {
      if (Buffer.isBuffer(options.key)) {
        key = options.key;
      } else if (typeof options.key === "string") {
        key = Buffer.from(options.key, options.keyEncoding || "base64");
      }
    }
    if (!key) {
      key = crypto.randomBytes(16);
    }
    if (key.length !== 16) {
      throw new Error("E305_HLS_ERROR: HLS key must be 16 bytes.");
    }
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

  await runFFmpeg(args, options.timeoutMs || DEFAULT_TIMEOUT_MS);

  return { playlistPath, outputDir };
}

module.exports = { createHLSPlaylist, DEFAULT_TIMEOUT_MS };
