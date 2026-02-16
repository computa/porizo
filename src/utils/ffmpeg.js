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

// --- Blend helpers ---

function clamp(value, min, max, fallback) {
  const n = Number(value) || fallback;
  return Math.max(min, Math.min(max, n));
}

const STEREO_44100 = ["-ac", "2", "-ar", "44100"];
const LOUDNORM = "loudnorm=I=-18:TP=-1:LRA=11";

// --- Blend strategy: Amplitude (v2 current behavior) ---

async function blendAmplitude({ originalVocalPath, convertedVocalPath, outputPath, blendRatio = 0.25, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const origVol = (1 - blendRatio).toFixed(3);
  const convVol = blendRatio.toFixed(3);

  const args = [
    "-y", "-i", originalVocalPath, "-i", convertedVocalPath,
    "-filter_complex",
    `[0:a]${LOUDNORM},volume=${origVol}[orig];` +
    `[1:a]${LOUDNORM},volume=${convVol}[conv];` +
    `[orig][conv]amix=inputs=2:duration=longest`,
    ...STEREO_44100, outputPath,
  ];

  await runFFmpeg(args, timeoutMs);
}

// --- Blend strategy: Spectral Crossover ---
// Split vocals into 3 frequency bands. User's timbre only in formant band (300-3kHz).
// AI owns lows + highs for body and air. One perceived voice, not two.

async function blendSpectralCrossover({ originalVocalPath, convertedVocalPath, outputPath, strategyParams = {}, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const lowCrossover = clamp(strategyParams.lowCrossover, 20, 20000, 300);
  const highCrossover = clamp(strategyParams.highCrossover, 20, 20000, 3000);
  const midBlendRatio = clamp(strategyParams.midBlendRatio, 0, 1, 0.30);
  const crossoverOrder = strategyParams.crossoverOrder || '4th';
  const origMidVol = (1 - midBlendRatio).toFixed(3);
  const convMidVol = midBlendRatio.toFixed(3);

  const args = [
    "-y", "-i", originalVocalPath, "-i", convertedVocalPath,
    "-filter_complex",
    `[0:a]${LOUDNORM}[ai_norm];` +
    `[1:a]${LOUDNORM}[conv_norm];` +
    `[ai_norm]acrossover=split=${lowCrossover} ${highCrossover}:order=${crossoverOrder}[ai_low][ai_mid][ai_high];` +
    `[conv_norm]highpass=f=${lowCrossover}:poles=2,lowpass=f=${highCrossover}:poles=2[conv_mid];` +
    `[ai_mid]volume=${origMidVol}[ai_mid_s];` +
    `[conv_mid]volume=${convMidVol}[conv_mid_s];` +
    `[ai_mid_s][conv_mid_s]amix=inputs=2:duration=longest:weights=1 1:normalize=0[blended_mid];` +
    `[ai_low][blended_mid][ai_high]amix=inputs=3:duration=longest:weights=1 1 1:normalize=0`,
    ...STEREO_44100, outputPath,
  ];

  await runFFmpeg(args, timeoutMs);
}

// --- Blend strategy: Vocal Doubling ---
// Studio technique: heavy-compress the converted vocal, EQ-carve presence,
// mix at subliminal level (10-15%). One voice with subtle warmth, not two.

async function blendVocalDoubling({ originalVocalPath, convertedVocalPath, outputPath, strategyParams = {}, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const doublingLevel = clamp(strategyParams.doublingLevel, 0, 1, 0.12);
  const presenceCutFreq = clamp(strategyParams.presenceCutFreq, 100, 20000, 4000);
  const presenceCutGain = clamp(strategyParams.presenceCutGain, -20, 0, -8);
  const warmthGain = clamp(strategyParams.warmthGain, 0, 12, 2);
  const origVol = (1 - doublingLevel).toFixed(3);
  const convVol = doublingLevel.toFixed(3);

  const args = [
    "-y", "-i", originalVocalPath, "-i", convertedVocalPath,
    "-filter_complex",
    `[0:a]${LOUDNORM},volume=${origVol}[ai_scaled];` +
    `[1:a]${LOUDNORM},` +
    `acompressor=threshold=0.03:ratio=12:attack=1:release=50:makeup=4:knee=2,` +
    `equalizer=f=${presenceCutFreq}:t=q:w=1.5:g=${presenceCutGain},` +
    `equalizer=f=200:t=q:w=0.8:g=${warmthGain},` +
    `highpass=f=120,lowpass=f=8000,` +
    `volume=${convVol}[conv_proc];` +
    `[ai_scaled][conv_proc]amix=inputs=2:duration=longest:weights=1 1:normalize=0`,
    ...STEREO_44100, outputPath,
  ];

  await runFFmpeg(args, timeoutMs);
}

// --- Blend strategy: Formant Transfer ---
// Two-pass: measure spectral energy at formant bands for both vocals,
// compute gain differences, apply as parametric EQ to AI vocal.
// Output is a SINGLE signal (AI vocal with EQ), not two mixed signals.

function runFFmpegCapture(args, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(getFFmpegPath(), args);
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ffmpeg.kill("SIGKILL");
      reject(new Error("E301_FFMPEG_TIMEOUT: FFmpeg capture timed out after " + (timeoutMs / 1000) + "s"));
    }, timeoutMs);

    function settle(fn) {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      fn();
    }

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
      if (stderr.length > MAX_STDERR_SIZE) {
        stderr = "[earlier output truncated]\n" + stderr.slice(-MAX_STDERR_SIZE);
      }
    });

    ffmpeg.on("close", (code) => {
      settle(() => {
        if (code === 0) resolve(stderr);
        else reject(new Error("E301_FFMPEG_ERROR: " + stderr.slice(-500)));
      });
    });

    ffmpeg.on("error", (err) => {
      settle(() => reject(new Error("E301_FFMPEG_ERROR: " + err.message)));
    });
  });
}

async function measureBandEnergy(filePath, bands, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const perBandTimeout = Math.max(5000, Math.floor(timeoutMs * 0.8));
  const results = [];
  for (const freq of bands) {
    const bw = freq < 200 ? freq * 0.8 : freq * 0.5;
    const lowF = Math.max(20, Math.round(freq - bw));
    const highF = Math.round(freq + bw);
    const args = [
      "-i", filePath,
      "-af", `highpass=f=${lowF},lowpass=f=${highF},volumedetect`,
      "-f", "null", "-",
    ];
    const stderr = await runFFmpegCapture(args, perBandTimeout);
    const match = stderr.match(/mean_volume:\s*([-\d.]+)\s*dB/);
    if (match) {
      results.push(parseFloat(match[1]));
    } else {
      console.warn(`[ffmpeg] measureBandEnergy: no mean_volume for ${freq}Hz band, defaulting to -60dB`);
      results.push(-60);
    }
  }
  return results;
}

async function blendFormantTransfer({ originalVocalPath, convertedVocalPath, outputPath, strategyParams = {}, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const transferStrength = clamp(strategyParams.transferStrength, 0, 1, 0.5);
  const maxGainDb = clamp(strategyParams.maxGainDb, 1, 24, 12);
  const bands = [125, 250, 500, 1000, 1500, 2000, 3000, 4000];

  const [aiEnergy, convEnergy] = await Promise.all([
    measureBandEnergy(originalVocalPath, bands, timeoutMs),
    measureBandEnergy(convertedVocalPath, bands, timeoutMs),
  ]);

  const eqChain = bands.map((freq, i) => {
    const diff = clamp(convEnergy[i] - aiEnergy[i], -maxGainDb, maxGainDb, 0);
    const gain = (diff * transferStrength).toFixed(1);
    return Math.abs(diff * transferStrength) >= 0.5
      ? `equalizer=f=${freq}:t=q:w=0.707:g=${gain}` : null;
  }).filter(Boolean).join(',');

  const filter = eqChain
    ? `[0:a]${LOUDNORM},${eqChain}`
    : `[0:a]${LOUDNORM}`;

  const args = ["-y", "-i", originalVocalPath, "-filter_complex", filter, ...STEREO_44100, outputPath];
  await runFFmpeg(args, timeoutMs);
}

// --- Strategy router ---

async function blendVocals({
  originalVocalPath,
  convertedVocalPath,
  outputPath,
  blendRatio = 0.25,
  strategy = 'amplitude',
  strategyParams = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!fs.existsSync(originalVocalPath)) {
    throw new Error("E301_FFMPEG_ERROR: Original vocal file not found: " + originalVocalPath);
  }
  if (!fs.existsSync(convertedVocalPath)) {
    throw new Error("E301_FFMPEG_ERROR: Converted vocal file not found: " + convertedVocalPath);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  switch (strategy) {
    case 'spectral_crossover':
      return blendSpectralCrossover({ originalVocalPath, convertedVocalPath, outputPath, strategyParams, timeoutMs });
    case 'vocal_doubling':
      return blendVocalDoubling({ originalVocalPath, convertedVocalPath, outputPath, strategyParams, timeoutMs });
    case 'formant_transfer':
      return blendFormantTransfer({ originalVocalPath, convertedVocalPath, outputPath, strategyParams, timeoutMs });
    default:
      if (strategy !== 'amplitude') {
        console.error(`[ffmpeg] blendVocals: unknown strategy "${strategy}", falling back to amplitude`);
      }
      return blendAmplitude({ originalVocalPath, convertedVocalPath, outputPath, blendRatio, timeoutMs });
  }
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
  runFFmpegCapture,
  mixTracks,
  mixTracksPersonalized,
  blendVocals,
  blendAmplitude,
  blendSpectralCrossover,
  blendVocalDoubling,
  blendFormantTransfer,
  measureBandEnergy,
  encodeToAAC,
  DEFAULT_TIMEOUT_MS,
};
