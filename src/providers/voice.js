/**
 * Voice conversion provider - routes between AI voice (Replicate RVC) and
 * personalized voice (Seed-VC) based on track.voice_mode
 *
 * Voice modes:
 * - "ai_voice" (default): Uses pre-trained RVC models via Replicate (e.g., "Squidward")
 * - "personalized" or "user_voice": Uses user's enrolled voice via Seed-VC zero-shot conversion
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { convertVoice: replicateConvert } = require("./replicate");
const { convertVoice: seedvcConvert, checkAvailability: checkSeedVcAvailability } = require("./seedvc");
const { separateStems } = require("./demucs");
const { writeWav } = require("../utils/audio");
const { scoreReferenceAudio, GRADE_VALUES } = require("../services/audio-quality");
const { getAdaptiveConversionParams, normalizeVolume } = require("../services/audio-preprocessing");

const MIN_REFERENCE_DURATION_SEC = 6;
const MIN_SINGING_DURATION_SEC = 6;

/**
 * Score a single audio buffer and build a candidate object.
 * Shared by local and S3 collection loops.
 */
function buildCandidate({ buffer, filePath, fileName, preferSinging, extraFields = {} }) {
  const result = scoreReferenceAudio(buffer);
  const isSungSample = Boolean(result.metrics?.is_singing) || fileName.includes("sung");
  const durationSec = result.metrics?.duration_sec || 0;
  const minDuration = isSungSample ? MIN_SINGING_DURATION_SEC : MIN_REFERENCE_DURATION_SEC;
  const isTooShort = durationSec > 0 && durationSec < minDuration;
  const effectiveScore = preferSinging
    ? result.suitability.forSinging
    : result.suitability.forSpeech;

  return {
    candidate: {
      path: filePath,
      file: fileName,
      grade: result.grade,
      score: effectiveScore,
      isSungSample,
      metrics: result.metrics,
      ...extraFields,
    },
    isTooShort,
  };
}

/**
 * Select the best reference audio candidate from collected candidates.
 * Handles short-candidate fallback, sorting, and grade warnings.
 */
function selectBestCandidate({ candidates, shortCandidates, sourceLabel = "" }) {
  if (candidates.length === 0 && shortCandidates.length > 0) {
    console.warn(`[Voice] No reference met minimum duration${sourceLabel}, falling back to shorter samples`);
    candidates.push(...shortCandidates);
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.isSungSample !== b.isSungSample) return a.isSungSample ? -1 : 1;
    return 0;
  });

  const best = candidates[0];
  console.log(`[Voice] Selected reference audio${sourceLabel}: ${best.file} (grade: ${best.grade}, score: ${best.score}, sung: ${best.isSungSample})`);

  if (GRADE_VALUES[best.grade] >= GRADE_VALUES["C"]) {
    console.warn(`[Voice] Warning: Best reference audio is grade ${best.grade}. Voice conversion quality may be affected.`);
  }

  return best;
}

/**
 * Find the best reference audio from user's enrollment using quality scoring.
 * Supports both local filesystem and S3/R2 storage.
 *
 * @param {Object} options
 * @param {string} options.storageDir - Base storage directory (for local storage)
 * @param {string} options.userId - User ID
 * @param {boolean} options.preferSinging - Prefer singing samples (default true)
 * @param {Object} options.storage - Storage provider (optional, for S3/R2 support)
 * @returns {Promise<{path: string, grade: string, score: number}|null>} Best reference audio or null
 */
async function findReferenceAudio({ storageDir, userId, preferSinging = true, storage = null }) {
  // If storage provider is S3, fetch from remote storage
  if (storage && storage.type === "s3") {
    return findReferenceAudioFromS3({ userId, preferSinging, storage });
  }

  // Local filesystem path
  const enrollmentDir = path.join(storageDir, "enrollment", "raw", userId);

  if (!fs.existsSync(enrollmentDir)) {
    console.warn(`[Voice] No enrollment directory found for user ${userId}`);
    return null;
  }

  // Collect all available chunks from all sessions
  const candidates = [];
  const shortCandidates = [];
  const sessions = fs.readdirSync(enrollmentDir)
    .filter(f => fs.statSync(path.join(enrollmentDir, f)).isDirectory())
    .sort()
    .reverse(); // Most recent first

  for (const sessionId of sessions) {
    const sessionDir = path.join(enrollmentDir, sessionId);
    const wavFiles = fs.readdirSync(sessionDir)
      .filter(f => f.endsWith(".wav"))
      .sort();

    for (const file of wavFiles) {
      const filePath = path.join(sessionDir, file);
      try {
        const buffer = fs.readFileSync(filePath);
        const built = buildCandidate({ buffer, filePath, fileName: file, preferSinging, extraFields: { sessionId } });
        if (built.isTooShort) {
          shortCandidates.push(built.candidate);
        } else {
          candidates.push(built.candidate);
        }
      } catch (e) {
        console.warn(`[Voice] Failed to score ${file}:`, e.message);
      }
    }
  }

  // Add clean concatenated audio as a fallback candidate
  const cleanDir = path.join(storageDir, "enrollment", "clean", userId);
  if (fs.existsSync(cleanDir)) {
    const cleanSessions = fs.readdirSync(cleanDir)
      .filter(f => fs.statSync(path.join(cleanDir, f)).isDirectory())
      .sort()
      .reverse();

    for (const sessionId of cleanSessions) {
      const cleanPath = path.join(cleanDir, sessionId, "clean.wav");
      if (fs.existsSync(cleanPath)) {
        try {
          const buffer = fs.readFileSync(cleanPath);
          const built = buildCandidate({ buffer, filePath: cleanPath, fileName: "clean.wav", preferSinging, extraFields: { sessionId } });
          if (built.isTooShort) {
            shortCandidates.push(built.candidate);
          } else {
            candidates.push(built.candidate);
          }
        } catch (e) {
          console.warn(`[Voice] Failed to score clean reference ${cleanPath}:`, e.message);
        }
        break;
      }
    }
  }

  const best = selectBestCandidate({ candidates, shortCandidates });
  if (!best) {
    console.warn(`[Voice] No reference audio found for user ${userId}`);
    return null;
  }

  return {
    path: best.path,
    grade: best.grade,
    score: best.score,
    metrics: best.metrics,
  };
}

/**
 * Find reference audio from S3/R2 storage
 * Downloads enrollment files to a temp directory for processing
 */
async function findReferenceAudioFromS3({ userId, preferSinging, storage }) {
  const prefix = `enrollment/raw/${userId}/`;
  console.log(`[Voice] Searching S3 for enrollment files with prefix: ${prefix}`);

  // List sessions (subdirectories)
  const { prefixes: sessionPrefixes } = await storage.listObjects({ prefix });

  if (!sessionPrefixes || sessionPrefixes.length === 0) {
    console.warn(`[Voice] No enrollment sessions found in S3 for user ${userId}`);
    return null;
  }

  // Sort sessions by name (reverse for most recent first, assuming timestamp-based names)
  const sortedSessions = sessionPrefixes.sort().reverse();
  console.log(`[Voice] Found ${sortedSessions.length} enrollment sessions in S3`);

  // Create temp directory for downloaded files
  const tempDir = path.join(os.tmpdir(), `porizo-enrollment-${userId}-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const candidates = [];
  const shortCandidates = [];

  try {
    for (const sessionPrefix of sortedSessions) {
      // List files in this session
      const { keys } = await storage.listObjects({ prefix: sessionPrefix });
      const wavFiles = keys.filter(k => k.endsWith(".wav"));

      for (const key of wavFiles) {
        const fileName = path.basename(key);
        const localPath = path.join(tempDir, fileName);

        try {
          await storage.downloadToFile({ key, filePath: localPath });
          const buffer = fs.readFileSync(localPath);
          const built = buildCandidate({ buffer, filePath: localPath, fileName, preferSinging, extraFields: { s3Key: key } });
          if (built.isTooShort) {
            shortCandidates.push(built.candidate);
          } else {
            candidates.push(built.candidate);
          }
        } catch (e) {
          console.warn(`[Voice] Failed to process ${key}:`, e.message);
        }
      }

      // If we have good candidates from recent session, no need to check older ones
      if (candidates.length > 0 && candidates.some(c => GRADE_VALUES[c.grade] <= GRADE_VALUES["B"])) {
        break;
      }
    }

    // Add clean audio as fallback candidate
    const cleanPrefix = `enrollment/clean/${userId}/`;
    const { prefixes: cleanSessions } = await storage.listObjects({ prefix: cleanPrefix });

    if (cleanSessions && cleanSessions.length > 0) {
      const sortedCleanSessions = cleanSessions.sort().reverse();
      for (const sessionPrefix of sortedCleanSessions) {
        const cleanKey = `${sessionPrefix}clean.wav`;
        const exists = await storage.objectExists({ key: cleanKey });
        if (exists) {
          const localPath = path.join(tempDir, "clean.wav");
          await storage.downloadToFile({ key: cleanKey, filePath: localPath });
          try {
            const buffer = fs.readFileSync(localPath);
            const built = buildCandidate({ buffer, filePath: localPath, fileName: "clean.wav", preferSinging, extraFields: { s3Key: cleanKey } });
            if (built.isTooShort) {
              shortCandidates.push(built.candidate);
            } else {
              candidates.push(built.candidate);
            }
          } catch (e) {
            console.warn(`[Voice] Failed to score clean reference ${cleanKey}:`, e.message);
          }
          break;
        }
      }
    }

    const best = selectBestCandidate({ candidates, shortCandidates, sourceLabel: " from S3" });
    if (!best) {
      console.warn(`[Voice] No reference audio found in S3 for user ${userId}`);
      fs.rmSync(tempDir, { recursive: true, force: true });
      return null;
    }

    return {
      path: best.path,
      grade: best.grade,
      score: best.score,
      metrics: best.metrics,
      tempDir,
    };
  } catch (e) {
    // Clean up temp dir on error
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw e;
  }
}

/**
 * Convert voice using appropriate provider based on voice_mode
 *
 * @param {Object} options
 * @param {string} options.storageDir - Base storage directory
 * @param {Object} options.track - Track object with id, user_id, voice_mode
 * @param {Object} options.trackVersion - Track version with version_num
 * @param {string} options.kind - "preview" or "full"
 * @param {Object} options.providerConfig - Provider configuration (replicate config)
 * @param {string} options.inputUrl - URL of guide vocal to convert
 * @param {number} options.similarityStrength - Voice similarity parameter
 * @param {Object} options.seedvcConfig - Seed-VC specific config (optional)
 * @param {Object} options.db - Database instance for voice profile lookup
 * @param {Object} options.storage - Storage provider (optional, for S3/R2 support)
 * @returns {Promise<{file: string, output_url?: string}>}
 */
async function convertVoice({
  storageDir,
  track,
  trackVersion,
  kind,
  providerConfig,
  inputUrl,
  similarityStrength,
  seedvcConfig = {},
  db = null,
  storage = null,
}) {
  const voiceMode = track.voice_mode || "ai_voice";

  console.log(`[Voice] Converting with mode: ${voiceMode} for track ${track.id}`);

  // Route based on voice_mode
  // Accept both "personalized" and "user_voice" for personalized voice cloning
  const isPersonalizedMode = voiceMode === "personalized" || voiceMode === "user_voice";

  if (isPersonalizedMode) {
    return convertPersonalizedVoice({
      storageDir,
      track,
      trackVersion,
      kind,
      inputUrl,
      seedvcConfig,
      db,
      storage,
    });
  }

  // Default: AI voice using Replicate RVC
  return convertAiVoice({
    storageDir,
    track,
    trackVersion,
    kind,
    providerConfig,
    inputUrl,
    similarityStrength,
  });
}

/**
 * Convert using AI voice (pre-trained RVC models via Replicate)
 */
async function convertAiVoice({
  storageDir,
  track,
  trackVersion,
  kind,
  providerConfig,
  inputUrl,
  similarityStrength,
}) {
  if (providerConfig?.live) {
    console.log(`[Voice] Using Replicate RVC for AI voice conversion`);
    return replicateConvert({
      baseUrl: providerConfig.baseUrl,
      token: providerConfig.token,
      modelVersion: providerConfig.modelVersion,
      storageDir,
      track,
      trackVersion,
      inputUrl,
      timeoutMs: providerConfig.timeoutMs,
      kind,
      similarityStrength,
    });
  }

  // Stub mode: generate placeholder
  console.log(`[Voice] Using stub mode for AI voice conversion (no live provider)`);
  const versionDir = path.join(
    storageDir,
    "tracks",
    track.user_id,
    track.id,
    `v${trackVersion.version_num}`
  );
  const fileName = kind === "preview" ? "user_vocal.wav" : "user_vocal_full.wav";
  writeWav(path.join(versionDir, fileName), {
    durationSec: kind === "preview" ? 4 : 10,
    frequencyHz: 330,
  });
  return { file: fileName };
}

/**
 * Convert using personalized voice (user's enrolled voice via Seed-VC)
 *
 * IMPORTANT: This function now includes STEM SEPARATION before voice conversion.
 * Seed-VC is designed to work on ISOLATED VOCALS, not mixed audio.
 * We must:
 * 1. Separate vocals from instrumental using Demucs
 * 2. Run Seed-VC on only the isolated vocals
 * 3. Return both converted vocals and instrumental for later mixing
 */
async function convertPersonalizedVoice({
  storageDir,
  track,
  trackVersion,
  kind,
  inputUrl,
  seedvcConfig,
  db,
  storage = null,
}) {
  // Validate voice profile is active (prevents use of deactivated profiles)
  if (!db) {
    throw new Error("E302_VOICE_ERROR: Database connection required for voice profile validation");
  }

  const hasActiveProfile = await db.prepare(
    "SELECT 1 FROM voice_profiles WHERE user_id = ? AND status = 'active' LIMIT 1"
  ).get(track.user_id);

  if (!hasActiveProfile) {
    throw new Error("E302_VOICE_ERROR: No active voice profile. Please re-enroll your voice.");
  }
  console.log(`[Voice] Verified active voice profile for user ${track.user_id}`);

  // Best-effort preflight only; do not hard-fail before conversion attempt.
  // Shared endpoints can transiently fail health checks but still process jobs.
  console.log(`[Voice] Checking Seed-VC service availability...`);
  const isAvailable = await checkSeedVcAvailability();
  if (!isAvailable) {
    console.warn("[Voice] Seed-VC preflight unavailable; continuing with direct conversion attempt");
  } else {
    console.log(`[Voice] Seed-VC service is available`);
  }

  // Find user's best reference audio from enrollment using quality scoring
  const referenceResult = await findReferenceAudio({
    storageDir,
    userId: track.user_id,
    preferSinging: true, // For voice conversion, prefer singing samples
    storage,
  });

  if (!referenceResult) {
    throw new Error(
      "E302_VOICE_ERROR: No enrolled voice found for personalized mode. " +
      "User must complete voice enrollment first."
    );
  }

  const referenceAudioPath = referenceResult.path;
  const referenceTempDir = referenceResult.tempDir;
  const referenceGrade = referenceResult.grade;
  console.log(`[Voice] Reference audio quality: grade ${referenceGrade}, score ${referenceResult.score}`);

  // Get adaptive conversion parameters based on reference quality
  const adaptiveParams = getAdaptiveConversionParams(referenceGrade);

  if (!adaptiveParams) {
    // Grade F - recommend AI voice fallback
    console.warn(`[Voice] Reference audio is grade F - recommending AI voice fallback`);
    throw new Error(
      "E302_VOICE_ERROR: Reference audio quality too low for personalized voice conversion. " +
      "Please re-enroll in a quieter environment or use AI voice mode."
    );
  }

  console.log(`[Voice] Using adaptive params: ${adaptiveParams.description}`);

  // For personalized mode, we need to download the guide vocal to a local file
  // because Seed-VC (via Gradio) works with file paths
  const versionDir = path.join(
    storageDir,
    "tracks",
    track.user_id,
    track.id,
    `v${trackVersion.version_num}`
  );

  // Check if guide vocal exists locally (could be from Suno or TTS)
  const guideFileName = kind === "preview" ? "guide_vocal.mp3" : "guide_vocal_full.mp3";
  let mixedAudioPath = path.join(versionDir, guideFileName);

  // Also check for .wav version
  if (!fs.existsSync(mixedAudioPath)) {
    const guideWavName = kind === "preview" ? "guide_vocal.wav" : "guide_vocal_full.wav";
    mixedAudioPath = path.join(versionDir, guideWavName);
  }

  // If guide vocal is a URL (Suno CDN), we need to download it first
  if (!fs.existsSync(mixedAudioPath) && inputUrl) {
    console.log(`[Voice] Downloading source audio from ${inputUrl}`);
    const { downloadToFile, ensureDir } = require("./http");
    ensureDir(versionDir);
    const downloadPath = path.join(versionDir, "source_mixed.mp3");
    await downloadToFile(inputUrl, downloadPath, seedvcConfig.timeoutMs || 120000);
    mixedAudioPath = downloadPath;
  }

  if (!fs.existsSync(mixedAudioPath)) {
    throw new Error(
      "E302_VOICE_ERROR: Source audio not found. Cannot perform personalized voice conversion."
    );
  }

  // ============================================================
  // STEP 1: STEM SEPARATION - Extract vocals from the mixed audio
  // This is CRITICAL: Seed-VC only works well on isolated vocals
  // ============================================================
  console.log(`[Voice] Starting stem separation with Demucs...`);
  console.log(`[Voice] Mixed audio: ${mixedAudioPath}`);

  const stemsDir = path.join(versionDir, "stems");
  let isolatedVocalsPath;
  let instrumentalPath;

  // Check if we have Replicate token for Demucs
  const replicateToken = seedvcConfig.replicateToken || process.env.REPLICATE_API_TOKEN;
  if (!replicateToken) {
    throw new Error(
      "E302_VOICE_ERROR: Stem separation required for personalized voice conversion. " +
      "REPLICATE_API_TOKEN is missing."
    );
  }

  try {
    const stemResult = await separateStems({
      inputPath: mixedAudioPath,
      outputDir: stemsDir,
      replicateApiToken: replicateToken,
      timeoutMs: seedvcConfig.timeoutMs || 300000,
      model: seedvcConfig.demucsModel || null,
      shifts: seedvcConfig.demucsShifts,
    });

    isolatedVocalsPath = stemResult.vocals;
    instrumentalPath = stemResult.instrumental;

    if (!isolatedVocalsPath || !instrumentalPath) {
      throw new Error("Missing vocal or instrumental stem output");
    }

    console.log(`[Voice] Stem separation complete`);
    console.log(`[Voice] Isolated vocals: ${isolatedVocalsPath}`);
    console.log(`[Voice] Instrumental: ${instrumentalPath}`);
  } catch (stemError) {
    console.error(`[Voice] Stem separation failed:`, stemError.message);
    throw new Error(
      `E302_VOICE_ERROR: Stem separation failed for personalized voice conversion: ${stemError.message}`
    );
  }

  // ============================================================
  // STEP 2: VOICE CONVERSION - Run Seed-VC on isolated vocals only
  // ============================================================
  console.log(`[Voice] Using Seed-VC for personalized voice conversion`);
  console.log(`[Voice] Source (isolated vocals): ${isolatedVocalsPath}`);
  console.log(`[Voice] Reference (user voice): ${referenceAudioPath}`);

  const seedvcTempDir = fs.mkdtempSync(path.join(os.tmpdir(), `porizo-seedvc-${track.id}-${Date.now()}-`));
  const normalizedSourcePath = path.join(seedvcTempDir, "source.wav");
  const normalizedReferencePath = path.join(seedvcTempDir, "reference.wav");
  const referenceIsSinging = Boolean(referenceResult.metrics?.is_singing);

  try {
    // Normalize/resample to Seed-VC expected format (44.1kHz mono)
    const sourceTargetLufs = referenceIsSinging ? -18 : -20;
    const refTargetLufs = referenceIsSinging ? -18 : -20;

    await normalizeVolume(isolatedVocalsPath, normalizedSourcePath, sourceTargetLufs);
    await normalizeVolume(referenceAudioPath, normalizedReferencePath, refTargetLufs);

    const flagParams = seedvcConfig.params || {};
    const baseCfgRate = Number.isFinite(flagParams.cfgRate)
      ? flagParams.cfgRate
      : (adaptiveParams.cfgRate ?? 0.65);
    const baseSteps = Number.isFinite(flagParams.diffusionSteps)
      ? flagParams.diffusionSteps
      : (adaptiveParams.diffusionSteps ?? (kind === "preview" ? 60 : 90));

    const cfgRate = Math.min(0.85, Math.max(0.1, baseCfgRate));
    const diffusionStepsMax = kind === "preview" ? 150 : 200;
    const diffusionSteps = Math.min(diffusionStepsMax, Math.max(30, Math.round(baseSteps)));

    const conversionParams = {
      diffusionSteps,
      cfgRate,
      lengthAdjust: Number.isFinite(flagParams.lengthAdjust) ? flagParams.lengthAdjust : 1.0,
      autoF0Adjust: flagParams.autoF0Adjust ?? false,
      f0Condition: flagParams.f0Condition ?? true,
      pitchShift: flagParams.pitchShift ?? 0,
    };

    console.log(`[Voice] Final conversion params: steps=${conversionParams.diffusionSteps}, cfg=${conversionParams.cfgRate} ` +
      `(adaptive: ${adaptiveParams.diffusionSteps}/${adaptiveParams.cfgRate}, flags: ${flagParams.diffusionSteps}/${flagParams.cfgRate})`);

    const result = await seedvcConvert({
      storageDir,
      track,
      trackVersion,
      sourceAudioPath: normalizedSourcePath,
      referenceAudioPath: normalizedReferencePath,
      timeoutMs: seedvcConfig.timeoutMs || 300000,
      kind,
      params: conversionParams,
      hfToken: seedvcConfig.hfToken || null,
    });

    return {
      file: result.file,
      output_path: result.output_path,
      // Return instrumental path for mixing step
      instrumental_path: instrumentalPath,
    };
  } catch (error) {
    console.error(`[Voice] Seed-VC conversion failed:`, error.message);
    throw new Error(`E302_VOICE_ERROR: Personalized voice conversion failed: ${error.message}`);
  } finally {
    try {
      fs.rmSync(seedvcTempDir, { recursive: true, force: true });
    } catch (e) {
      console.warn("[Voice] Failed to clean up Seed-VC temp dir:", e.message);
    }
    if (referenceTempDir) {
      try {
        fs.rmSync(referenceTempDir, { recursive: true, force: true });
      } catch (e) {
        console.warn("[Voice] Failed to clean up reference temp dir:", e.message);
      }
    }
  }
}

module.exports = {
  convertVoice,
  findReferenceAudio,
};
