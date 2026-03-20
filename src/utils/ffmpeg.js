/**
 * FFmpeg wrapper for audio processing
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { FFMPEG_TIMEOUT_MS, FFMPEG_MAX_STDERR_SIZE } = require("../config");
const { clampNumber } = require("./common");

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
    `[0:a]volume=${vocalGain},highpass=f=80,acompressor=threshold=0.06:ratio=2.5:attack=20:release=300:knee=6:makeup=2,lowpass=f=15000[v];` +
      `[1:a]volume=${instrumentalGain}[i];` +
      `[v][i]amix=inputs=2:duration=longest,loudnorm=I=-14:TP=-1:LRA=11`,
    "-ac", "2",
    "-ar", "44100",
    outputPath,
  ];

  await runFFmpeg(args, timeoutMs);
}

// --- Blend helpers ---

// Local alias for clampNumber — used extensively in blend/polish helpers
const clamp = clampNumber;

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

// --- Blend strategy: Perceptual Primary ---
// User vocal is PRIMARY (dominant), AI vocal provides subtle support via sidechain.
// AI ducks when user is singing, fills gaps when user is silent.
// Solves the "cliff" problem where even small AI amounts mask the user voice.

async function blendPerceptualPrimary({ originalVocalPath, convertedVocalPath, outputPath, strategyParams = {}, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  // aiInfluence: How much AI vocal bleeds through (0-0.5, default 0.15)
  const aiInfluence = clamp(strategyParams.aiInfluence, 0, 0.5, 0.15);
  // duckingStrength: How aggressively AI ducks when user sings (0-1, default 0.85)
  const duckingStrength = clamp(strategyParams.duckingStrength, 0, 1, 0.85);
  // attackMs: How fast the ducking kicks in (5-100ms, default 10)
  const attackMs = clamp(strategyParams.attackMs, 5, 100, 10);
  // releaseMs: How fast AI returns after user stops (50-500ms, default 150)
  const releaseMs = clamp(strategyParams.releaseMs, 50, 500, 150);
  
  // Compute sidechain threshold - lower = more aggressive ducking
  // Map duckingStrength 0-1 to threshold 0.1-0.01 (inverted, lower threshold = more ducking)
  const threshold = (0.1 - (duckingStrength * 0.09)).toFixed(3);
  // Ratio: higher = harder ducking
  const ratio = Math.round(4 + (duckingStrength * 12)); // 4:1 to 16:1

  const args = [
    "-y", "-i", originalVocalPath, "-i", convertedVocalPath,
    "-filter_complex",
    // Normalize both inputs and split user for sidechain + mix
    `[0:a]${LOUDNORM}[ai_norm];` +
    `[1:a]${LOUDNORM},asplit=2[user_main][user_sc];` +
    // AI vocal: reduce volume, apply sidechain compression keyed by user vocal
    // The user_sc copy controls when AI ducks
    `[ai_norm]volume=${aiInfluence}[ai_quiet];` +
    `[ai_quiet][user_sc]sidechaincompress=threshold=${threshold}:ratio=${ratio}:attack=${attackMs}:release=${releaseMs}:level_sc=1[ai_ducked];` +
    // Mix: user_main is primary (full volume), AI fills in ducked
    `[user_main][ai_ducked]amix=inputs=2:duration=longest:weights=1 ${aiInfluence}:normalize=0`,
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
    case 'perceptual_primary':
      return blendPerceptualPrimary({ originalVocalPath, convertedVocalPath, outputPath, strategyParams, timeoutMs });
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

// --- Vocal Polish ---
// Post-process converted vocals to reduce harshness and add warmth.
// Applied after Seed-VC conversion to improve raw output quality.

/**
 * Polish a singing vocal for production quality.
 *
 * Chain order follows professional vocal mixing:
 *   Phase 1 (Clean):  highpass → mud cut → harshness cut → de-ess
 *   Phase 2 (Shape):  singing-appropriate compression (slow attack, gentle ratio)
 *   Phase 3 (Color):  saturation → presence EQ → air EQ → warmth EQ
 *   Phase 4 (Space):  reverb (aecho — upgrade to SoX/Pedalboard later)
 *   Phase 5 (Final):  lowpass → loudnorm limiter
 */
async function polishVocal({ inputPath, outputPath, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!fs.existsSync(inputPath)) {
    throw new Error("E301_FFMPEG_ERROR: Input vocal file not found: " + inputPath);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  // --- Phase 1: Clean (subtractive EQ before compression) ---
  const highpassFreq = clamp(params.highpassFreq, 40, 150, 80);
  const mudCutFreq = clamp(params.mudCutFreq, 150, 400, 300);
  const mudCutGain = clamp(params.mudCutGain, -6, 0, -2);
  const deHarshFreq = clamp(params.deHarshFreq, 1000, 5000, 3000);
  const deHarshGain = clamp(params.deHarshGain, -8, 0, -3);
  const deEssFreq = clamp(params.deEssFreq, 4000, 9000, 7500);
  const deEssGain = clamp(params.deEssGain, -12, 0, -3);
  const deEssWidth = clamp(params.deEssWidth, 0.5, 4.0, 2.0);

  // --- Phase 2: Dynamics (singing-appropriate compression) ---
  const compRatio = clamp(params.compressionRatio, 1.5, 6, 2.5);
  const compThreshold = clamp(params.compressionThreshold, 0.02, 0.3, 0.06);
  const compAttack = clamp(params.compressionAttack, 5, 50, 20);
  const compRelease = clamp(params.compressionRelease, 50, 500, 300);
  const compKnee = clamp(params.compressionKnee, 2, 10, 6);
  const compMakeup = clamp(params.compressionMakeup, 0, 8, 3);

  // --- Phase 3: Color (additive EQ + saturation AFTER compression) ---
  const saturation = clamp(params.saturationAmount, 0, 0.3, 0.08);
  const presenceFreq = clamp(params.presenceFreq, 2000, 6000, 4000);
  const presenceGain = clamp(params.presenceGain, 0, 6, 2.5);
  const airFreq = clamp(params.airFreq, 8000, 14000, 12000);
  const airGain = clamp(params.airGain, 0, 6, 2);
  const warmthFreq = clamp(params.warmthFreq, 100, 400, 200);
  const warmthGain = clamp(params.warmthGain, 0, 6, 1.5);

  // --- Phase 4: Space (reverb) ---
  const reverbEnabled = params.reverbEnabled !== false;
  const reverbDelay = clamp(params.reverbDelay, 10, 60, 25);
  const reverbDecay = clamp(params.reverbDecay, 0.1, 0.5, 0.3);

  // --- Phase 5: Final ---
  const lowpassFreq = clamp(params.lowpassFreq, 8000, 18000, 15000);
  const targetLufs = clamp(params.targetLufs, -20, -12, -16);

  // Build filter chain in professional order
  const filters = [
    // Phase 1: Clean
    `highpass=f=${highpassFreq}`,
    `equalizer=f=${mudCutFreq}:t=q:w=2.0:g=${mudCutGain}`,
    `equalizer=f=${deHarshFreq}:t=q:w=1.5:g=${deHarshGain}`,
    `equalizer=f=${deEssFreq}:t=q:w=${deEssWidth}:g=${deEssGain}`,

    // Phase 2: Singing dynamics
    `acompressor=threshold=${compThreshold}:ratio=${compRatio}:attack=${compAttack}:release=${compRelease}:knee=${compKnee}:makeup=${compMakeup}`,
  ];

  // Phase 3: Saturation (subtle soft-clip for warmth + harmonics)
  // tanh(x) = (exp(2x)-1)/(exp(2x)+1) — expanded because FFmpeg <7 lacks tanh()
  if (saturation > 0) {
    const dry = (1.0 - saturation).toFixed(3);
    const wet = saturation.toFixed(3);
    filters.push(`aeval=val(0)*${dry}+${wet}*((exp(6*val(0))-1)/(exp(6*val(0))+1)):c=same`);
  }

  // Phase 3 continued: Additive EQ (after compression — this is what adds "polish")
  filters.push(
    `equalizer=f=${presenceFreq}:t=q:w=1.0:g=${presenceGain}`,
    `treble=g=${airGain}:f=${airFreq}:t=q:w=0.7`,
    `equalizer=f=${warmthFreq}:t=q:w=0.8:g=${warmthGain}`,
  );

  // Phase 4: Reverb (aecho approximation — real reverb via SoX/Pedalboard later)
  if (reverbEnabled) {
    filters.push(`aecho=0.8:${(1.0 - reverbDecay).toFixed(2)}:${reverbDelay}|${reverbDelay + 12}:${reverbDecay}|${(reverbDecay * 0.7).toFixed(2)}`);
  }

  // Phase 5: Final safety
  filters.push(
    `lowpass=f=${lowpassFreq}`,
    `loudnorm=I=${targetLufs}:TP=-1:LRA=11`,
  );

  const args = [
    "-y", "-i", inputPath,
    "-af", filters.join(','),
    ...STEREO_44100, outputPath,
  ];

  await runFFmpeg(args, timeoutMs);
}

/**
 * Generate a share MP4 from artwork image + audio file.
 * Produces a 1280x1280 H.264+AAC video with animated waveform overlay
 * and song title/recipient text. Falls back to still-image approach on failure.
 *
 * If maxDuration is > 0, output is capped at that duration in seconds.
 * If maxDuration is <= 0/null/undefined, full audio duration is preserved.
 * Uses -movflags +faststart for progressive download (critical for iMessage/Discord).
 */
async function generateShareMp4({
  artworkPath,
  audioPath,
  outputPath,
  songTitle,
  recipientName,
  occasion,
  maxDuration = 0,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!fs.existsSync(artworkPath)) {
    throw new Error("E301_FFMPEG_ERROR: Artwork file not found: " + artworkPath);
  }
  if (!fs.existsSync(audioPath)) {
    throw new Error("E301_FFMPEG_ERROR: Audio file not found: " + audioPath);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  // Try animated waveform version first, fall back to still-image on failure
  const hasMetadata = songTitle || recipientName;
  if (hasMetadata) {
    try {
      await _generateAnimatedShareMp4({
        artworkPath, audioPath, outputPath,
        songTitle, recipientName, occasion,
        maxDuration, timeoutMs,
      });
      return;
    } catch (err) {
      console.warn(`[generateShareMp4] Animated version failed, falling back to still: ${err.message}`);
      // Clean up partial output
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
    }
  }

  // Fallback: still-image approach (original behavior)
  const args = [
    "-y",
    "-loop", "1",
    "-i", artworkPath,
    "-i", audioPath,
    "-c:v", "libx264",
    "-tune", "stillimage",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "44100",
    "-ac", "2",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-vf", "scale=1280:1280:force_original_aspect_ratio=decrease,pad=1280:1280:(ow-iw)/2:(oh-ih)/2",
    "-shortest",
  ];
  if (Number(maxDuration) > 0) {
    args.push("-t", String(maxDuration));
  }
  args.push(outputPath);

  await runFFmpeg(args, timeoutMs);
}

// Derive waveform color from the canonical OCCASION_COLORS map (strip # prefix for FFmpeg)
const { OCCASION_COLORS } = require("../services/cover-generator");

function getWaveColor(occasion) {
  const colors = OCCASION_COLORS[occasion] || OCCASION_COLORS.custom;
  return colors.primary.slice(1); // "#FF6B9D" -> "FF6B9D"
}

async function _generateAnimatedShareMp4({
  artworkPath, audioPath, outputPath,
  songTitle, recipientName, occasion,
  maxDuration, timeoutMs,
}) {
  const fontPath = path.join(process.cwd(), "assets", "fonts", "Inter-SemiBold.ttf");
  const hasFont = fs.existsSync(fontPath);

  const waveColor = getWaveColor(occasion);
  const safeTitle = (songTitle || "").replace(/[\\':]/g, "").substring(0, 60);
  const safeRecipient = (recipientName || "").replace(/[\\':]/g, "").substring(0, 40);
  const recipientLine = safeRecipient ? `for ${safeRecipient}` : "";

  // Build filter_complex:
  // [1:a] -> showwaves -> waveform overlay on scaled background image
  // + drawtext for song title and recipient
  const fontOpt = hasFont ? `fontfile=${fontPath.replace(/:/g, "\\\\:")}:` : "";
  let filterParts = [
    `[1:a]showwaves=s=1080x160:mode=cline:rate=25:colors=0x${waveColor}@0.8:scale=sqrt[waves]`,
    `[0:v]scale=1280:1280:force_original_aspect_ratio=decrease,pad=1280:1280:(ow-iw)/2:(oh-ih)/2[bg]`,
    `[bg][waves]overlay=100:1020[v1]`,
  ];

  // Title text
  if (safeTitle) {
    filterParts.push(
      `[v1]drawtext=${fontOpt}text='${safeTitle}':fontsize=44:fontcolor=white:x=(w-tw)/2:y=60[v2]`
    );
    // Recipient text
    if (recipientLine) {
      filterParts.push(
        `[v2]drawtext=${fontOpt}text='${recipientLine}':fontsize=30:fontcolor=0x${waveColor}:x=(w-tw)/2:y=115[out]`
      );
    } else {
      filterParts.push(`[v2]copy[out]`);
    }
  } else {
    filterParts.push(`[v1]copy[out]`);
  }

  const filterComplex = filterParts.join(";");

  const args = [
    "-y",
    "-loop", "1",
    "-i", artworkPath,
    "-i", audioPath,
    "-filter_complex", filterComplex,
    "-map", "[out]",
    "-map", "1:a",
    "-c:v", "libx264",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "44100",
    "-ac", "2",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-shortest",
  ];
  if (Number(maxDuration) > 0) {
    args.push("-t", String(maxDuration));
  }
  args.push(outputPath);

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
  blendPerceptualPrimary,
  polishVocal,
  measureBandEnergy,
  encodeToAAC,
  generateShareMp4,
  DEFAULT_TIMEOUT_MS,
};
