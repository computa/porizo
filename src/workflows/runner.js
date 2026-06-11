const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const config = require("../config");
const { waitForArtworkReady } = require("./artwork-barrier");
const { recoverOrphanedArtworkJobs } = require("../jobs/artwork-job");
const {
  generateLyrics,
  assessRequiredDetailCoverage,
} = require("../providers/lyrics");
const { moderationCheck } = require("../providers/moderation");
const { writeWav } = require("../utils/audio");
const {
  ensureDir,
  parseJson,
  toJson,
  getVersionDir,
  nowIso,
  clampNumber,
} = require("../utils/common");
const { generatePrefixedId } = require("../utils/ids");
const { extractPolicyTermsFromMessage } = require("../utils/policy-terms");
const {
  buildMusicPlan,
  renderInstrumental,
  renderGuideVocal,
  renderWithProvider,
} = require("../providers/music");
const { resolveMusicProvider } = require("../providers/provider-style-routing");
const { sanitizeStyleOverrides } = require("../providers/style-registry");
const {
  submitSunoTask,
  pollSunoTaskOnce,
  downloadSunoAudio,
  logSunoCreditUsage,
  isSunoPolicyError,
  classifySunoStatus,
  inspectSunoAudioReadiness,
} = require("../providers/suno");
const { generateSpeech, lyricsToText } = require("../providers/elevenlabs");
const { convertVoice } = require("../providers/voice");
const {
  convertVoice: convertVoiceElevenLabs,
} = require("../providers/elevenlabs-voice");
const { separateStems } = require("../providers/demucs");
const {
  runFFmpeg,
  mixTracks,
  mixTracksPersonalized,
  blendVocals,
  polishVocal,
  encodeToAAC,
} = require("../utils/ffmpeg");
const { embedWatermark } = require("../utils/watermark");
const { createHLSPlaylist } = require("../utils/hls");
const {
  trackMasterKey,
  trackPreviewKey,
  trackVersionKey,
  trackHLSKey,
} = require("../storage/index");
const { CircuitBreaker } = require("./circuit-breaker");
const { createDLQService } = require("./dlq");
const { createJobDurabilityService } = require("./durability");
const {
  getFeatureFlag,
  getFeatureFlags,
} = require("../services/feature-flags");
const pushNotification = require("../services/push-notification");
const {
  generateCover,
  isSharpAvailable,
} = require("../services/cover-generator");
const { alignLyrics } = require("../providers/whisper");
const {
  alignSectionsToTimestamps,
  sectionsToText,
} = require("../utils/lyrics-alignment");
const {
  sanitizeLyricsForProviderPolicy,
} = require("../services/lyrics-policy-sanitizer");
const {
  buildLyricsContext,
  summarizeLyricsContextForLog,
} = require("../writer/lyrics-context");
const {
  buildRenderContract,
  resolveRenderContract,
  assertFrozenContract,
  assertPersonalizedContract,
  getProviderAudioUrl,
  getProviderAudioKey,
  extractProviderAudioUrl,
  sanitizeProviderRoutingForContract,
  sanitizeLyricsForAllMusicProviders,
  isProviderCompleteAudioPipeline,
  isSunoVoicePersonaPipeline,
  shouldSkipStep,
  PERSONALIZED_VOICE_MODES,
} = require("./render-contract");
const {
  classifyError,
  PROVIDER_STEPS,
} = require("../utils/step-classification");
const { createOrGetShareToken } = require("../services/share-service");
const { upsertGiftIncident } = require("../services/gift-delivery-ops");
const {
  findActiveProviderProfileForUser,
  getProviderProfileById,
  recoverStaleVoiceProviderJobs,
} = require("../services/voice-provider-profile-service");
const {
  hasPersonaConsentScope,
  runSunoVoicePersonaJob,
} = require("../services/suno-voice-persona-service");

/**
 * Pure-resolution variant of the closure-scoped `resolveSunoPersonaForRender`
 * helper used by the render-tick path. H22: extracted to module scope so the
 * 4 guard branches (no profile id, profile mismatch/inactive/deleted, missing
 * provider_profile_id, missing consent) can be unit-tested without spinning
 * up a job runner. The closure version inside `startJobRunner` delegates to
 * this so behavior stays in lockstep.
 *
 * @param {object} args
 * @param {import('better-sqlite3').Database|object} args.db - any object that
 *   supports `prepare(sql).get(...)`. In production it's the real DB; in
 *   tests it's a stub returning a fixed providerProfile.
 * @param {{user_id: string}} args.track
 * @param {{pipeline?: string, voice_provider_profile_id?: string}} args.renderContract
 * @param {{suno_voice_persona_persona_model?: string, suno_voice_persona_audio_weight?: number}} args.runtimeConfig
 * @returns {Promise<{personaId: string, personaModel: string, audioWeight: number}|null>}
 */
async function resolveSunoPersonaForRenderImpl({
  db,
  track,
  renderContract,
  runtimeConfig,
}) {
  if (!isSunoVoicePersonaPipeline(renderContract?.pipeline)) {
    return null;
  }
  const localProfileId = renderContract.voice_provider_profile_id;
  if (!localProfileId) {
    throw new Error(
      "E302_SUNO_PERSONA_NOT_READY: Missing frozen voice provider profile.",
    );
  }
  const providerProfile = await getProviderProfileById(db, localProfileId);
  if (
    !providerProfile ||
    providerProfile.user_id !== track.user_id ||
    providerProfile.provider !== "suno" ||
    providerProfile.status !== "active" ||
    providerProfile.deleted_at
  ) {
    throw new Error(
      "E302_SUNO_PERSONA_NOT_READY: Active Suno voice persona profile not found.",
    );
  }
  if (!providerProfile.provider_profile_id) {
    throw new Error(
      "E302_SUNO_PERSONA_NOT_READY: Suno voice persona id is not ready.",
    );
  }
  if (!hasPersonaConsentScope(providerProfile.consent_scope)) {
    throw new Error(
      "E302_SUNO_PERSONA_CONSENT_REQUIRED: Suno voice persona consent is required.",
    );
  }
  return {
    personaId: providerProfile.provider_profile_id,
    personaModel:
      runtimeConfig?.suno_voice_persona_persona_model || "voice_persona",
    audioWeight: runtimeConfig?.suno_voice_persona_audio_weight ?? 0.85,
  };
}

// Provider identifiers for circuit breaker tracking
const PROVIDERS = {
  SUNO: "suno",
  ELEVENLABS: "elevenlabs",
  REPLICATE: "replicate",
  SEEDVC: "seedvc",
};

async function ensureRenderSharePreGeneration({
  db,
  trackReady,
  trackVersionReady,
  streamBaseUrl,
  renderType,
  createShareToken = createOrGetShareToken,
  createIncident = upsertGiftIncident,
}) {
  try {
    await createShareToken({
      db,
      trackId: trackReady.id,
      trackVersionId: trackVersionReady.id,
      userId: trackReady.user_id,
      buildShareUrl: (shareId) => `${streamBaseUrl}/play/${shareId}`,
    });
    return { ok: true };
  } catch (shareErr) {
    console.warn(
      `[JobRunner] Share pre-generation failed (non-fatal):`,
      shareErr.message,
    );
    try {
      await createIncident(db, {
        incidentKey: `share_pre_generation:${trackVersionReady.id}`,
        incidentType: "share_pre_generation_failed",
        severity: "warning",
        resourceType: "track_version",
        resourceId: trackVersionReady.id,
        summary: "Share pre-generation failed during render completion",
        detail: String(shareErr.message || shareErr),
        metadata: {
          track_id: trackReady.id,
          track_version_id: trackVersionReady.id,
          user_id: trackReady.user_id,
          render_type: renderType,
        },
      });
    } catch (incidentErr) {
      console.warn(
        `[JobRunner] Failed to persist share pre-generation incident:`,
        incidentErr.message,
      );
    }
    return { ok: false, error: shareErr };
  }
}

const PREVIEW_STEPS = [
  "moderation",
  "lyrics",
  "music_plan",
  "instrumental",
  "guide_vocal",
  "voice_convert",
  "mix",
  "watermark",
  "ready",
];

const FULL_STEPS = [
  "moderation",
  "lyrics",
  "music_plan",
  "instrumental_full",
  "guide_vocal_full",
  "voice_convert_sections",
  "mix",
  "watermark",
  "ready",
];

// Step memoization: map step names to their trackVersion output fields
// Steps not listed here are either not memoizable or have handler-level checks
const MAX_CIRCUIT_PARKS = 20; // Max times a job can be parked before DLQ (~10 min at 30s cooldown)

const STEP_MEMO_FIELDS = {
  moderation: { field: "moderation_status", skipValue: "passed" },
  lyrics: { field: "lyrics_json" },
  music_plan: { field: "music_plan_json" },
  instrumental: { field: "instrumental_url", localFile: "inst_preview.mp3" },
  guide_vocal: { field: "guide_vocal_url", localFile: "guide_vocal.mp3" },
  // instrumental_full/guide_vocal_full: excluded — share DB column with preview, handler has own fs.existsSync
  // voice_convert/voice_convert_sections: excluded — handler's own fs.existsSync is correct
  // mix, watermark, ready: not memoizable (file processing / quality gate)
};

// Map step names to all possible providers (dynamic — runtime config chooses one).
// PROVIDER_STEPS (imported from step-classification.js) is the canonical list of which
// steps are provider steps. If you add a case here, add to PROVIDER_STEPS too.
function getStepProviders(stepName) {
  switch (stepName) {
    case "instrumental":
    case "instrumental_full":
      return [PROVIDERS.SUNO, PROVIDERS.ELEVENLABS];
    case "guide_vocal":
    case "guide_vocal_full":
      return [PROVIDERS.ELEVENLABS];
    case "voice_convert":
    case "voice_convert_sections":
      return [PROVIDERS.REPLICATE, PROVIDERS.SEEDVC];
    default:
      if (PROVIDER_STEPS.has(stepName)) {
        console.warn(
          `[JobRunner] PROVIDER_STEPS contains '${stepName}' but getStepProviders has no case for it — add one`,
        );
      }
      return []; // CPU-only steps
  }
}

/**
 * Intermediate files generated during render that can be cleaned up
 * after successful completion to save disk space
 */
const TEMP_FILES = [
  "inst_preview.mp3",
  "guide_vocal.mp3",
  "suno_complete.mp3",
  "source_mixed.mp3",
  "source_mixed.wav",
  "voice_converted.wav",
  "instrumental.mp3",
];

/**
 * Clean up intermediate files after successful render.
 * Keeps final output files (preview.m4a, full.m4a) and removes temp files.
 *
 * @param {string} versionDir - Directory containing render output
 * @returns {{success: boolean, cleaned: number, totalBytes: number, criticalError: string|null}}
 */
function cleanupTempFiles(versionDir) {
  if (!versionDir || !fs.existsSync(versionDir)) {
    return { success: true, cleaned: 0, totalBytes: 0, criticalError: null };
  }

  let cleaned = 0;
  let totalBytes = 0;
  let criticalError = null;

  for (const file of TEMP_FILES) {
    const filePath = path.join(versionDir, file);
    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        totalBytes += stats.size;
        fs.unlinkSync(filePath);
        cleaned++;
      }
    } catch (err) {
      // Differentiate critical errors (disk full, permissions) from minor issues
      if (err.code === "ENOSPC") {
        criticalError = `ENOSPC: Disk full, cannot cleanup ${file}`;
        console.error(`[JobRunner] CRITICAL: ${criticalError}:`, err.message);
      } else if (err.code === "EACCES" || err.code === "EPERM") {
        console.error(
          `[JobRunner] Permission denied cleaning up ${file}:`,
          err.message,
        );
      } else {
        // Log but don't fail - cleanup is best-effort for other errors
        console.warn(
          `[JobRunner] Failed to cleanup temp file ${file}:`,
          err.message,
        );
      }
    }
  }

  if (cleaned > 0) {
    const savedMB = (totalBytes / (1024 * 1024)).toFixed(2);
    console.log(
      `[JobRunner] Cleaned up ${cleaned} temp files, saved ${savedMB} MB`,
    );
  }

  return { success: !criticalError, cleaned, totalBytes, criticalError };
}

/**
 * Map of step names to intermediate files that may be corrupt/stale after failure.
 * Used by cleanStaleStepFiles to surgically remove only the files for a specific
 * failed step, preserving work from earlier steps that succeeded.
 *
 * Files listed in CACHED_INPUT_FILES are "reusable inputs" — downloaded from
 * ephemeral provider URLs (e.g. Suno). They are only deleted if 0 bytes (corrupt).
 * All other files are "outputs" — always deleted since they may be partially written.
 */
const CACHED_INPUT_FILES = new Set(["source_for_conversion.mp3"]);

const STALE_STEP_FILES = {
  voice_convert: [
    "stems/vocals.wav",
    "stems/vocals_compressed.mp3",
    "user_vocal.wav",
    "source_for_conversion.mp3",
  ],
  voice_convert_sections: [
    "stems/vocals.wav",
    "stems/vocals_compressed.mp3",
    "user_vocal_full.wav",
    "source_for_conversion.mp3",
  ],
  instrumental: ["inst_preview.mp3", "inst_preview.wav", "instrumental.mp3"],
  instrumental_full: ["inst_full.mp3", "inst_full.wav", "instrumental.mp3"],
  guide_vocal: ["guide_vocal.mp3", "guide_vocal.wav"],
  guide_vocal_full: ["guide_vocal_full.mp3", "guide_vocal_full.wav"],
  mix: ["mix.wav", "preview.m4a", "full.m4a"],
  watermark: ["watermarked.wav", "preview.m4a", "full.m4a"],
};

/**
 * Remove intermediate files for a specific failed step so a retry starts clean.
 * Unlike cleanupTempFiles (post-success cleanup of all temps), this is surgical:
 * only removes files from the step that failed.
 *
 * @param {string} versionDir - Directory containing render output
 * @param {string} stepName - The workflow step that failed
 * @returns {string[]} List of file paths that were removed
 */
function cleanStaleStepFiles(versionDir, stepName) {
  if (!versionDir || !fs.existsSync(versionDir)) {
    return [];
  }
  const files = STALE_STEP_FILES[stepName];
  if (!files) {
    return [];
  }
  const removed = [];
  for (const relPath of files) {
    const filePath = path.join(versionDir, relPath);
    try {
      if (!fs.existsSync(filePath)) continue;

      // Cached inputs (e.g. source_for_conversion.mp3) are downloaded from
      // ephemeral provider URLs. Preserve them if valid — re-download may fail
      // when the URL expires. Only delete if 0 bytes (corrupt/incomplete).
      if (CACHED_INPUT_FILES.has(relPath)) {
        const size = fs.statSync(filePath).size;
        if (size > 0) {
          console.log(
            `[JobRunner] Preserving cached input ${relPath} (${size} bytes)`,
          );
          continue;
        }
      }

      fs.unlinkSync(filePath);
      removed.push(filePath);
    } catch (err) {
      console.warn(
        `[JobRunner] Failed to clean stale file ${relPath}:`,
        err.message,
      );
    }
  }
  if (removed.length > 0) {
    console.log(
      `[JobRunner] Cleaned ${removed.length} stale file(s) for step '${stepName}'`,
    );
  }
  return removed;
}

/**
 * Download audio from URL and extract vocals using Demucs.
 * Used by Musicfy and TopMediai providers which need isolated vocals.
 *
 * @param {Object} params
 * @param {string} params.inputUrl - URL of audio to download
 * @param {string} params.versionDir - Directory to store files
 * @param {Object} params.providerConfig - Provider configuration
 * @param {Object} params.durabilityService - Durability service for retries
 * @returns {Promise<string>} Path to extracted vocals WAV file
 */
async function downloadAndExtractVocals({
  inputUrl,
  versionDir,
  providerConfig,
  durabilityService,
}) {
  const { downloadToFile } = require("../providers/http");

  // Download source audio (delete 0-byte remnants from prior failed attempts)
  const sourcePath = path.join(versionDir, "source_for_conversion.mp3");
  if (fs.existsSync(sourcePath) && fs.statSync(sourcePath).size === 0) {
    console.warn(`[JobRunner] Removing 0-byte stale source file`);
    fs.unlinkSync(sourcePath);
  }
  if (!fs.existsSync(sourcePath)) {
    console.log(`[JobRunner] Downloading source audio for voice conversion...`);
    try {
      await downloadToFile(
        inputUrl,
        sourcePath,
        providerConfig.replicate?.timeoutMs || 300000,
      );
    } catch (err) {
      // Reclassify 0-byte downloads as expired URL — retrying won't help
      if (err.message?.includes("File too small (0 bytes")) {
        throw new Error(
          `E301_SOURCE_URL_EXPIRED: Provider audio URL returned empty response (URL likely expired)`,
        );
      }
      throw err;
    }
  }

  // Check if vocals already extracted (delete 0-byte remnants)
  const stemsDir = path.join(versionDir, "stems");
  const vocalsPath = path.join(stemsDir, "vocals.wav");
  if (fs.existsSync(vocalsPath) && fs.statSync(vocalsPath).size === 0) {
    console.warn(`[JobRunner] Removing 0-byte stale vocals file`);
    fs.unlinkSync(vocalsPath);
  }
  if (fs.existsSync(vocalsPath)) {
    console.log(`[JobRunner] Using existing extracted vocals`);
    return vocalsPath;
  }

  // Extract vocals using Demucs
  console.log(`[JobRunner] Extracting vocals using Demucs...`);
  const replicateToken = providerConfig.replicate?.token;
  if (!replicateToken) {
    throw new Error(
      "E301_MISSING_CONFIG: REPLICATE_API_TOKEN required for Demucs stem separation",
    );
  }

  ensureDir(stemsDir);
  const stemResult = await durabilityService.executeWithDurability({
    provider: "replicate",
    fn: () =>
      separateStems({
        inputPath: sourcePath,
        outputDir: stemsDir,
        replicateApiToken: replicateToken,
        timeoutMs: providerConfig.replicate?.timeoutMs || 300000,
        model: providerConfig.replicate?.demucsModel || null,
        shifts: providerConfig.replicate?.demucsShifts,
      }),
  });

  console.log(`[JobRunner] Vocals extracted: ${stemResult.vocals}`);
  return stemResult.vocals;
}

/**
 * Perform voice conversion using the configured provider (ElevenLabs or Seed-VC).
 * Shared by both preview (voice_convert) and full render (voice_convert_sections).
 */
async function performVoiceConversion({
  db,
  track,
  trackVersion,
  kind,
  versionDir,
  conversionSourceUrl,
  providerConfig,
  durabilityService,
  storageDir,
  storageProvider,
  renderContract,
}) {
  const voiceConversionProvider =
    renderContract?.voice_conversion_provider ??
    (await getFeatureFlag(db, "voice_conversion_provider")) ??
    "seedvc";
  if (renderContract?.voice_mode === "user_voice") {
    throw new Error(
      `E302_PERSONALIZED_VOICE_CONVERSION_DISABLED: My Voice must use Suno voice persona; ${voiceConversionProvider || "unknown"} voice conversion is disabled.`,
    );
  }
  console.log(
    `[JobRunner] Voice conversion provider (${kind}): ${voiceConversionProvider}`,
  );

  if (voiceConversionProvider === "elevenlabs") {
    const elevenlabsApiKey =
      providerConfig.elevenlabs?.apiKey || process.env.ELEVENLABS_API_KEY;
    if (!elevenlabsApiKey) {
      throw new Error(
        "E305_ELEVENLABS_VOICE_ERROR: ELEVENLABS_API_KEY not configured",
      );
    }

    const voiceProfile = await db
      .prepare(
        "SELECT elevenlabs_voice_id FROM voice_profiles WHERE user_id = ? AND status = 'active'",
      )
      .get(track.user_id);

    if (!voiceProfile?.elevenlabs_voice_id) {
      throw new Error(
        "E305_ELEVENLABS_VOICE_ERROR: No ElevenLabs voice clone found for user. Re-enroll voice to create clone.",
      );
    }

    const voiceChangerFlags = await getFeatureFlags(db, [
      "elevenlabs_stability",
      "elevenlabs_similarity_boost",
    ]);
    const stability = voiceChangerFlags.elevenlabs_stability ?? 0.4;
    const similarityBoost =
      voiceChangerFlags.elevenlabs_similarity_boost ?? 0.85;

    console.log(
      `[JobRunner] Using ElevenLabs Voice Changer: voiceId=${voiceProfile.elevenlabs_voice_id}, stability=${stability}, similarityBoost=${similarityBoost}`,
    );

    const sourceAudioPath = await downloadAndExtractVocals({
      inputUrl: conversionSourceUrl,
      versionDir,
      providerConfig,
      durabilityService,
    });

    // Compress WAV→MP3 before upload — ElevenLabs rejects files >50MB
    const compressedPath = sourceAudioPath.replace(/\.wav$/, "_compressed.mp3");
    if (!fs.existsSync(compressedPath)) {
      console.log(
        `[JobRunner] Compressing vocals for ElevenLabs upload: ${path.basename(sourceAudioPath)}`,
      );
      await runFFmpeg([
        "-y",
        "-i",
        sourceAudioPath,
        "-b:a",
        "192k",
        "-ar",
        "44100",
        "-ac",
        "1",
        compressedPath,
      ]);
    }

    const outputFilename =
      kind === "full" ? "user_vocal_full.wav" : "user_vocal.wav";
    const outputPath = path.join(versionDir, outputFilename);

    return durabilityService.executeWithDurability({
      provider: PROVIDERS.ELEVENLABS,
      fn: () =>
        convertVoiceElevenLabs({
          apiKey: elevenlabsApiKey,
          voiceId: voiceProfile.elevenlabs_voice_id,
          sourceAudioPath: compressedPath,
          outputPath,
          timeoutMs: providerConfig.replicate?.timeoutMs || 300000,
          settings: {
            stability,
            similarityBoost,
            removeBackgroundNoise: true,
          },
        }),
    });
  }

  // Default: Seed-VC provider
  const diffusionStepsFlag =
    kind === "full"
      ? "seedvc_diffusion_steps_full"
      : "seedvc_diffusion_steps_preview";
  const diffusionStepsDefault = kind === "full" ? 90 : 60;

  const seedFlags = await getFeatureFlags(db, [
    "seedvc_cfg_rate",
    diffusionStepsFlag,
    "seedvc_auto_f0_adjust",
    "seedvc_f0_condition",
    "seedvc_pitch_shift",
    "timbre_blend_ratio",
    "timbre_cfg_rate",
  ]);
  const cfgRate = seedFlags.seedvc_cfg_rate ?? config.SEEDVC_CFG_RATE;
  const diffusionSteps = seedFlags[diffusionStepsFlag] ?? diffusionStepsDefault;
  const autoF0Adjust = seedFlags.seedvc_auto_f0_adjust ?? false;
  const f0Condition = seedFlags.seedvc_f0_condition ?? true;
  const pitchShift = seedFlags.seedvc_pitch_shift ?? 0;

  const blendRatio = seedFlags.timbre_blend_ratio ?? 0.25;
  const timbreCfgRate = seedFlags.timbre_cfg_rate ?? 0.35;
  const effectiveCfgRate = blendRatio < 1.0 ? timbreCfgRate : cfgRate;
  console.log(
    `[JobRunner] Using Seed-VC (${kind}): cfgRate=${effectiveCfgRate}` +
      (blendRatio < 1.0 ? ` (timbre blend mode, blend=${blendRatio})` : "") +
      `, diffusionSteps=${diffusionSteps}`,
  );

  return durabilityService.executeWithDurability({
    provider: PROVIDERS.SEEDVC,
    fn: () =>
      convertVoice({
        storageDir,
        track,
        trackVersion,
        kind,
        providerConfig: providerConfig.replicate,
        inputUrl: conversionSourceUrl,
        seedvcConfig: {
          timeoutMs: providerConfig.replicate?.timeoutMs || 300000,
          hfToken: providerConfig.hfToken || null,
          replicateToken: providerConfig.replicate?.token || null,
          demucsModel: providerConfig.replicate?.demucsModel || null,
          demucsShifts: providerConfig.replicate?.demucsShifts,
          params: {
            diffusionSteps,
            lengthAdjust: 1.0,
            cfgRate: effectiveCfgRate,
            autoF0Adjust,
            f0Condition,
            pitchShift,
          },
        },
        db,
        storage: storageProvider,
      }),
  });
}

/**
 * Apply vocal polish if enabled — de-harsh, warmth, de-ess, compress, normalize.
 * Graceful fallback: on failure, keeps the raw conversion output.
 */
async function applyVocalPolish({ db, outputFile, versionDir, kind }) {
  const polishEnabled =
    (await getFeatureFlag(db, "vocal_polish_enabled")) ?? true;
  if (!polishEnabled || !fs.existsSync(outputFile)) return;

  try {
    const polishFlags = await getFeatureFlags(db, [
      "vocal_polish_highpass_freq",
      "vocal_polish_lowpass_freq",
      "vocal_polish_compression_ratio",
      "vocal_polish_compression_threshold",
      "vocal_polish_compression_attack",
      "vocal_polish_compression_release",
      "vocal_polish_compression_knee",
      "vocal_polish_compression_makeup",
      "vocal_polish_de_harsh_freq",
      "vocal_polish_de_harsh_gain",
      "vocal_polish_warmth_freq",
      "vocal_polish_warmth_gain",
      "vocal_polish_de_ess_freq",
      "vocal_polish_de_ess_gain",
      "vocal_polish_de_ess_width",
      "vocal_polish_mud_cut_freq",
      "vocal_polish_mud_cut_gain",
      "vocal_polish_presence_freq",
      "vocal_polish_presence_gain",
      "vocal_polish_air_freq",
      "vocal_polish_air_gain",
      "vocal_polish_saturation",
      "vocal_polish_reverb_enabled",
      "vocal_polish_reverb_delay",
      "vocal_polish_reverb_decay",
      "vocal_polish_target_lufs",
    ]);
    const polishParams = {
      // Phase 1: Clean (subtractive)
      highpassFreq: polishFlags["vocal_polish_highpass_freq"] ?? 80,
      mudCutFreq: polishFlags["vocal_polish_mud_cut_freq"] ?? 300,
      mudCutGain: polishFlags["vocal_polish_mud_cut_gain"] ?? -2,
      deHarshFreq: polishFlags["vocal_polish_de_harsh_freq"] ?? 3000,
      deHarshGain: polishFlags["vocal_polish_de_harsh_gain"] ?? -3,
      deEssFreq: polishFlags["vocal_polish_de_ess_freq"] ?? 7500,
      deEssGain: polishFlags["vocal_polish_de_ess_gain"] ?? -3,
      deEssWidth: polishFlags["vocal_polish_de_ess_width"] ?? 2.0,
      // Phase 2: Singing dynamics
      compressionRatio: polishFlags["vocal_polish_compression_ratio"] ?? 2.5,
      compressionThreshold:
        polishFlags["vocal_polish_compression_threshold"] ?? 0.06,
      compressionAttack: polishFlags["vocal_polish_compression_attack"] ?? 20,
      compressionRelease:
        polishFlags["vocal_polish_compression_release"] ?? 300,
      compressionKnee: polishFlags["vocal_polish_compression_knee"] ?? 6,
      compressionMakeup: polishFlags["vocal_polish_compression_makeup"] ?? 3,
      // Phase 3: Color (additive + saturation)
      saturationAmount: polishFlags["vocal_polish_saturation"] ?? 0.08,
      presenceFreq: polishFlags["vocal_polish_presence_freq"] ?? 4000,
      presenceGain: polishFlags["vocal_polish_presence_gain"] ?? 2.5,
      airFreq: polishFlags["vocal_polish_air_freq"] ?? 12000,
      airGain: polishFlags["vocal_polish_air_gain"] ?? 2,
      warmthFreq: polishFlags["vocal_polish_warmth_freq"] ?? 200,
      warmthGain: polishFlags["vocal_polish_warmth_gain"] ?? 1.5,
      // Phase 4: Reverb
      reverbEnabled: polishFlags["vocal_polish_reverb_enabled"] ?? true,
      reverbDelay: polishFlags["vocal_polish_reverb_delay"] ?? 25,
      reverbDecay: polishFlags["vocal_polish_reverb_decay"] ?? 0.3,
      // Phase 5: Final
      lowpassFreq: polishFlags["vocal_polish_lowpass_freq"] ?? 15000,
      targetLufs: polishFlags["vocal_polish_target_lufs"] ?? -16,
    };
    const polishedPath = path.join(
      versionDir,
      `user_vocal_${kind}_polished.wav`,
    );
    console.log(
      `[JobRunner] Applying vocal polish (${kind}): ${JSON.stringify(polishParams)}`,
    );
    await polishVocal({
      inputPath: outputFile,
      outputPath: polishedPath,
      params: polishParams,
    });
    fs.renameSync(polishedPath, outputFile);
    console.log(`[JobRunner] Vocal polish complete (${kind})`);
  } catch (polishErr) {
    console.error(
      `[JobRunner] Vocal polish failed (${kind}), using raw conversion:`,
      polishErr.message,
    );
  }
}

/**
 * Upload track outputs to S3 storage provider
 *
 * @param {Object} params - Upload parameters
 * @param {Object} params.storageProvider - S3 storage provider instance
 * @param {string} params.storageDir - Local storage directory
 * @param {Object} params.track - Track object with id and user_id
 * @param {Object} params.trackVersion - Track version object
 * @param {string} params.kind - 'preview' or 'full'
 * @returns {Promise<Object>} S3 keys for uploaded files
 */
async function uploadTrackOutputsToS3({
  storageProvider,
  storageDir,
  track,
  trackVersion,
  kind,
}) {
  const versionDir = path.join(
    storageDir,
    "tracks",
    track.user_id,
    track.id,
    `v${trackVersion.version_num}`,
  );

  const isPreview = kind === "preview";
  const audioFileName = isPreview ? "preview.m4a" : "full.m4a";
  const localAudioPath = path.join(versionDir, audioFileName);

  const uploadedKeys = {};

  // Upload main audio file
  if (fs.existsSync(localAudioPath)) {
    const audioKey = isPreview
      ? trackPreviewKey({
          userId: track.user_id,
          trackId: track.id,
          versionNum: trackVersion.version_num,
        })
      : trackMasterKey({
          userId: track.user_id,
          trackId: track.id,
          versionNum: trackVersion.version_num,
          format: "m4a",
        });

    await storageProvider.putFile({
      key: audioKey,
      filePath: localAudioPath,
      contentType: "audio/mp4",
    });
    uploadedKeys.audioKey = audioKey;
    console.log(`[JobRunner] Uploaded ${kind} audio to S3: ${audioKey}`);
  }

  // Upload cover images if they exist
  const coverSizes = ["256", "1024"];
  for (const size of coverSizes) {
    const coverPath = path.join(versionDir, `cover_${size}.jpg`);
    if (fs.existsSync(coverPath)) {
      const coverKey = `${trackVersionKey({ userId: track.user_id, trackId: track.id, versionNum: trackVersion.version_num })}/cover_${size}.jpg`;
      await storageProvider.putFile({
        key: coverKey,
        filePath: coverPath,
        contentType: "image/jpeg",
      });
      console.log(`[JobRunner] Uploaded cover_${size}.jpg to S3: ${coverKey}`);
    }
  }

  // Upload HLS files if they exist (non-fatal — master .m4a is the critical asset)
  const hlsDir = path.join(versionDir, "hls");
  if (fs.existsSync(hlsDir)) {
    const hlsFiles = fs.readdirSync(hlsDir);
    const hlsBaseKey = trackHLSKey({
      userId: track.user_id,
      trackId: track.id,
      versionNum: trackVersion.version_num,
    });
    uploadedKeys.hlsKeys = [];

    try {
      for (const file of hlsFiles) {
        const localPath = path.join(hlsDir, file);
        if (fs.statSync(localPath).isFile()) {
          const s3Key = hlsBaseKey + file;
          const contentType = file.endsWith(".m3u8")
            ? "application/x-mpegURL"
            : "video/MP2T";
          await storageProvider.putFile({
            key: s3Key,
            filePath: localPath,
            contentType,
          });
          uploadedKeys.hlsKeys.push(s3Key);
        }
      }
      console.log(
        `[JobRunner] Uploaded ${uploadedKeys.hlsKeys.length} HLS files to S3`,
      );
    } catch (hlsErr) {
      console.error(
        `[JobRunner] HLS upload failed (non-fatal): ${hlsErr.message}. ${uploadedKeys.hlsKeys.length}/${hlsFiles.length} segments uploaded. Streaming may be unavailable but download will work.`,
      );
      uploadedKeys.hlsPartial = true;
    }
  }

  return uploadedKeys;
}

async function hydrateProviderCompleteAudio({
  providerLocalPath,
  providerAudioKey = null,
  providerAudioUrl = null,
  storageProvider = null,
  httpDownloadToFile = null,
}) {
  if (fs.existsSync(providerLocalPath)) {
    return { source: "local", key: null, url: null };
  }

  if (providerAudioKey) {
    if (!storageProvider || typeof storageProvider.downloadToFile !== "function") {
      throw new Error(
        `E301_PROVIDER_AUDIO_MIRROR_UNAVAILABLE: Durable provider audio key exists but storage download is unavailable (${providerAudioKey})`,
      );
    }
    try {
      await storageProvider.downloadToFile({
        key: providerAudioKey,
        filePath: providerLocalPath,
      });
    } catch (err) {
      throw new Error(
        `E301_PROVIDER_AUDIO_MIRROR_UNAVAILABLE: Failed to hydrate durable provider audio (${providerAudioKey}) - ${err?.message || err}`,
      );
    }
    console.log(
      `[Mix] Hydrated provider-complete audio from storage: ${providerAudioKey}`,
    );
    return { source: "storage", key: providerAudioKey, url: null };
  }

  if (providerAudioUrl) {
    const download =
      httpDownloadToFile ||
      require("../providers/http").downloadToFile;
    await download(providerAudioUrl, providerLocalPath, 120000);
    return { source: "provider_url", key: null, url: providerAudioUrl };
  }

  return { source: null, key: null, url: null };
}

function writePlaceholderOutputs({
  storageDir,
  track,
  trackVersion,
  kind,
  devMode = false,
}) {
  const versionDir = path.join(
    storageDir,
    "tracks",
    track.user_id,
    track.id,
    `v${trackVersion.version_num}`,
  );
  ensureDir(versionDir);
  const audioName = kind === "preview" ? "preview.m4a" : "full.m4a";
  const audioPath = path.join(versionDir, audioName);
  if (!fs.existsSync(audioPath)) {
    // In production (devMode=false), fail if no real audio was generated
    if (!devMode) {
      throw new Error(
        `E302_WORKFLOW_ERROR: No audio file generated for ${kind} render. Check provider configuration.`,
      );
    }
    console.warn(
      `[JobRunner] Writing placeholder audio for ${kind} (DEV_MODE)`,
    );
    writeWav(audioPath, {
      durationSec: kind === "preview" ? 6 : 12,
      frequencyHz: 300,
    });
  }
  const provenance = {
    track_version_id: trackVersion.id,
    track_id: track.id,
    workflow: kind,
    created_at: new Date().toISOString(),
  };
  const provenancePath = path.join(versionDir, "provenance.json");
  if (!fs.existsSync(provenancePath)) {
    fs.writeFileSync(
      provenancePath,
      JSON.stringify(provenance, null, 2),
      "utf8",
    );
  }
}

async function ensureUserVocalFromGuide({ versionDir, kind }) {
  const outputFile = kind === "full" ? "user_vocal_full.wav" : "user_vocal.wav";
  const outputPath = path.join(versionDir, outputFile);
  if (fs.existsSync(outputPath)) {
    return outputPath;
  }

  const guideMp3 = kind === "full" ? "guide_vocal_full.mp3" : "guide_vocal.mp3";
  const guideWav = kind === "full" ? "guide_vocal_full.wav" : "guide_vocal.wav";
  const mp3Path = path.join(versionDir, guideMp3);
  const wavPath = path.join(versionDir, guideWav);
  let sourcePath = null;

  if (fs.existsSync(mp3Path)) {
    sourcePath = mp3Path;
  } else if (fs.existsSync(wavPath)) {
    sourcePath = wavPath;
  }

  if (!sourcePath) {
    return null;
  }

  ensureDir(versionDir);

  if (sourcePath.endsWith(".wav")) {
    fs.copyFileSync(sourcePath, outputPath);
    return outputPath;
  }

  await runFFmpeg([
    "-y",
    "-i",
    sourcePath,
    "-ar",
    "44100",
    "-ac",
    "2",
    outputPath,
  ]);
  return outputPath;
}

async function startJobRunner({
  db,
  storageDir,
  streamBaseUrl,
  intervalMs = 1000,
  providerConfig = {},
  recoverStaleJobs = true,
  staleJobTimeoutMinutes = 5,
  devMode = false,
  workerId = null,
  storageProvider = null,
  _subscriptionManager = null,
  eventsService = null,
  durabilityConfig = {},
  voiceProviderJobRunner = runSunoVoicePersonaJob,
}) {
  const runnerId = workerId || crypto.randomUUID();
  const sunoPollIntervalSec = 10;
  const MAX_CONCURRENT_VOICE_PROVIDER_JOBS = Math.max(
    0,
    Number(process.env.MAX_CONCURRENT_VOICE_PROVIDER_JOBS || 1),
  );

  // Initialize workflow hardening services
  const circuitBreaker = new CircuitBreaker({
    failureThreshold: durabilityConfig.failureThreshold || 3,
    cooldownMs: durabilityConfig.cooldownMs || 30000,
    halfOpenRequests: durabilityConfig.halfOpenRequests || 1,
  });

  // Adapter for sync await db.prepare to async db.query interface (shared by DLQ and durability)
  const asyncDbAdapter = {
    async query(sql, params = []) {
      const isSelect = sql.trim().toUpperCase().startsWith("SELECT");
      const stmt = db.prepare(sql);
      if (isSelect) {
        const rows = params.length
          ? await stmt.all(...params)
          : await stmt.all();
        return { rows };
      } else {
        const result = params.length
          ? await stmt.run(...params)
          : await stmt.run();
        return { changes: result.changes, rowCount: result.changes };
      }
    },
  };

  // DLQ service - lazily initialized
  let dlqService = null;
  const getDLQService = () => {
    if (!dlqService) {
      dlqService = createDLQService(asyncDbAdapter);
    }
    return dlqService;
  };

  // Durability service for provider calls
  const durabilityService = createJobDurabilityService({
    db: asyncDbAdapter,
    circuitBreaker,
    dlq: getDLQService(),
  });

  const computeProgress = (stepIndex, stepCount) => {
    if (!stepCount) {
      return null;
    }
    const safeIndex = Math.max(0, Math.min(stepIndex, stepCount));
    const pct = Math.floor((safeIndex / stepCount) * 100);
    return Math.min(pct, 99);
  };
  const MUSIC_ROUTING_CACHE_TTL_MS = 15000;
  let cachedMusicRoutingConfig = null;
  let cachedMusicRoutingExpiresAt = 0;

  function mergeProvenanceJson(existingJson, patch) {
    const base = parseJson(existingJson, {}, "provenance_json_base");
    const merged = {
      ...base,
      ...patch,
    };

    const existingTimeline = Array.isArray(base.timeline) ? base.timeline : [];
    const patchTimeline = Array.isArray(patch?.timeline) ? patch.timeline : [];
    if (patchTimeline.length > 0) {
      merged.timeline = [...existingTimeline, ...patchTimeline].slice(-50);
    } else if (existingTimeline.length > 0 && !Array.isArray(merged.timeline)) {
      merged.timeline = existingTimeline.slice(-50);
    }

    return toJson(merged);
  }

  function summarizePolicyTerms(violations, max = 6) {
    if (!Array.isArray(violations) || violations.length === 0) {
      return [];
    }
    const terms = [];
    const seen = new Set();
    for (const violation of violations) {
      const raw = String(violation?.term || "")
        .trim()
        .toLowerCase();
      if (!raw || seen.has(raw)) continue;
      seen.add(raw);
      terms.push(raw);
      if (terms.length >= max) break;
    }
    return terms;
  }

  function buildPolicyPreflightError(preflight) {
    const terms = summarizePolicyTerms(preflight?.violations || [], 5);
    const termList =
      terms.length > 0 ? ` blocked terms: ${terms.join(", ")}` : "";
    return new Error(
      `E302_PROVIDER_POLICY_ERROR: Lyrics contain provider-restricted content.${termList}. Please edit lyrics and try again.`,
    );
  }

  function logProviderRejection({
    provider,
    errorCode,
    errorStatus,
    rejectedTerms,
    lyricsHash,
    style,
    step,
    trackId,
  }) {
    console.warn(
      JSON.stringify({
        event: "provider_rejection",
        provider,
        error_code: errorCode || null,
        error_status: errorStatus || null,
        rejected_terms: Array.isArray(rejectedTerms) ? rejectedTerms : [],
        lyrics_hash: lyricsHash || null,
        style: style || null,
        step: step || null,
        track_id: trackId || null,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  function logSanitizerIntervention({
    provider,
    changeCount,
    rewritePasses,
    violationTerms,
    style,
    step,
    trackId,
  }) {
    console.warn(
      JSON.stringify({
        event: "sanitizer_intervention",
        provider,
        change_count: changeCount || 0,
        rewrite_passes: rewritePasses || 0,
        violation_terms: Array.isArray(violationTerms) ? violationTerms : [],
        style: style || null,
        step: step || null,
        track_id: trackId || null,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  function assertPolicySanitizerPreservedStoryDetails({
    originalLyrics,
    sanitizedLyrics,
    storyContext,
    provider,
    step,
    trackId,
  }) {
    if (!storyContext || typeof assessRequiredDetailCoverage !== "function") {
      return null;
    }
    const before = assessRequiredDetailCoverage(originalLyrics, storyContext);
    if (!before || before.required_count === 0) {
      return null;
    }
    const after = assessRequiredDetailCoverage(sanitizedLyrics, storyContext);
    const newlyMissing = (after.missing_required || []).filter(
      (detail) => !(before.missing_required || []).includes(detail),
    );
    if (newlyMissing.length === 0) {
      return { before, after, newly_missing: [] };
    }

    console.error(
      JSON.stringify({
        event: "lyrics_policy_sanitizer_removed_story_detail",
        provider: provider || null,
        step: step || null,
        track_id: trackId || null,
        required_count: after.required_count,
        before_missing_count: before.missing_required.length,
        after_missing_count: after.missing_required.length,
        newly_missing: newlyMissing.slice(0, 8),
        timestamp: new Date().toISOString(),
      }),
    );
    const err = new Error(
      `E302_POLICY_SANITIZER_REMOVED_REQUIRED_DETAIL: provider policy rewrite removed required story detail (${newlyMissing.slice(0, 3).join("; ")}).`,
    );
    err.code = "E302_POLICY_SANITIZER_REMOVED_REQUIRED_DETAIL";
    err.coverage = { before, after, newly_missing: newlyMissing };
    throw err;
  }

  function lyricsHashSha256(lyricsJson) {
    if (!lyricsJson) return null;
    const text =
      typeof lyricsJson === "string" ? lyricsJson : JSON.stringify(lyricsJson);
    return crypto.createHash("sha256").update(text).digest("hex");
  }

  async function probeAudioDurationSec(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }
    const { execFile } = require("child_process");
    const { promisify } = require("util");
    const execFileAsync = promisify(execFile);

    let ffprobePath = "ffprobe";
    try {
      ffprobePath = require("@ffprobe-installer/ffprobe").path;
    } catch (_err) {
      ffprobePath = "ffprobe";
    }

    try {
      const { stdout } = await execFileAsync(ffprobePath, [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        filePath,
      ]);
      const parsed = JSON.parse(stdout || "{}");
      const duration = Number(parsed?.format?.duration);
      return Number.isFinite(duration) ? duration : null;
    } catch (_err) {
      return null;
    }
  }

  function resolveRerollSourceFiles(workflowType) {
    const isFull = workflowType === "full_render";
    return [
      isFull ? "inst_full.mp3" : "inst_preview.mp3",
      isFull ? "inst_full.wav" : "inst_preview.wav",
      "guide_vocal.mp3",
      "guide_vocal.wav",
      "guide_vocal_full.mp3",
      "guide_vocal_full.wav",
      "user_vocal.wav",
      "user_vocal_full.wav",
      "voice_converted.wav",
      "mix.wav",
      "watermarked.wav",
      "preview.m4a",
      "full.m4a",
      "suno_complete.mp3",
      "elevenlabs_complete.mp3",
      "source_mixed.wav",
      "source_mixed.mp3",
      "instrumental.mp3",
    ];
  }

  function cleanupForReroll(versionDir, workflowType) {
    if (!versionDir || !fs.existsSync(versionDir)) {
      return;
    }

    for (const fileName of resolveRerollSourceFiles(workflowType)) {
      const filePath = path.join(versionDir, fileName);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        console.warn(
          `[JobRunner] Failed to remove reroll artifact ${fileName}:`,
          err.message,
        );
      }
    }

    const hlsDir = path.join(versionDir, "hls");
    if (fs.existsSync(hlsDir)) {
      try {
        fs.rmSync(hlsDir, { recursive: true, force: true });
      } catch (err) {
        console.warn(
          "[JobRunner] Failed to remove reroll HLS directory:",
          err.message,
        );
      }
    }
  }

  function tightenMusicPlanForReroll(musicPlan, qualityReport) {
    if (!musicPlan || typeof musicPlan !== "object") {
      return null;
    }
    const next = JSON.parse(JSON.stringify(musicPlan));
    const existingIntent =
      next.style_intent && typeof next.style_intent === "object"
        ? next.style_intent
        : {};
    const existingNegatives = Array.isArray(next.style_negative_constraints)
      ? next.style_negative_constraints
      : Array.isArray(existingIntent.negative_constraints)
        ? existingIntent.negative_constraints
        : [];
    const tightenedNegatives = Array.from(
      new Set([
        ...existingNegatives,
        `avoid drifting away from ${next.style || "selected style"} identity`,
        "avoid modern pop substitutions unless explicitly requested",
        "preserve cultural rhythmic signature and instrumentation",
      ]),
    ).slice(0, 14);

    next.generation_mode = "compose_detailed";
    next.plan_schema_version = 2;
    next.style_negative_constraints = tightenedNegatives;
    next.style_prompt_compact = [
      next.style_prompt_compact ||
        next.style_prompt ||
        `${next.style || "pop"} arrangement`,
      "Preserve the requested style's rhythmic DNA and instrumentation identity.",
    ]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 320);
    next.provider_style_hint = [
      next.provider_style_hint || "",
      "Enforce stronger style identity and instrumentation adherence.",
    ]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 320);
    next.style_prompt = [
      next.style_prompt_compact,
      next.provider_style_hint,
      tightenedNegatives.length > 0
        ? `Avoid: ${tightenedNegatives.join(", ")}.`
        : null,
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 520);
    next.style_intent = {
      ...existingIntent,
      negative_constraints: tightenedNegatives,
      instruction_override: next.provider_style_hint,
      base_prompt: next.style_prompt_compact,
      arrangement_notes: existingIntent.arrangement_notes
        ? `${existingIntent.arrangement_notes}. Enforce stronger style identity and instrumentation adherence.`
        : "Enforce stronger style identity and instrumentation adherence.",
      reroll_tightening: {
        applied_at: nowIso(),
        reason: qualityReport?.summary || "quality_below_threshold",
      },
    };
    return next;
  }

  async function evaluateRenderQuality({
    track,
    trackVersion,
    workflowType,
    musicPlan,
    qualityThreshold,
  }) {
    const versionDir = getVersionDir(storageDir, track, trackVersion);
    const isFull = workflowType === "full_render";
    const outputPath = path.join(
      versionDir,
      isFull ? "full.m4a" : "preview.m4a",
    );
    const mixPath = path.join(versionDir, "mix.wav");
    const hasOutput = fs.existsSync(outputPath);
    const hasMix = fs.existsSync(mixPath);
    const outputStats = hasOutput ? fs.statSync(outputPath) : null;
    const outputSizeBytes = outputStats?.size || 0;
    const expectedDuration = Number(
      musicPlan?.duration_sec || track.duration_target || 60,
    );
    const actualDuration = await probeAudioDurationSec(outputPath);
    const hasProbeableDuration =
      Number.isFinite(actualDuration) && actualDuration > 0;
    const hasSaneOutputAudio =
      hasOutput &&
      outputSizeBytes >= 90000 &&
      hasProbeableDuration &&
      actualDuration >= 10 &&
      actualDuration <= 15 * 60;

    let styleScore = 55;
    const supportScore = Number(musicPlan?.provider_support_score);
    if (Number.isFinite(supportScore)) {
      styleScore = 40 + supportScore * 14;
    } else if (musicPlan?.provider_support === "strong") {
      styleScore = 92;
    } else if (musicPlan?.provider_support === "medium") {
      styleScore = 78;
    } else if (musicPlan?.provider_support === "weak") {
      styleScore = 62;
    }
    if (musicPlan?.style_support_degraded) {
      styleScore -= 12;
    }
    if (musicPlan?.generation_mode === "compose_detailed") {
      styleScore += 6;
    }
    const compactPromptPresent =
      typeof musicPlan?.style_prompt_compact === "string"
        ? musicPlan.style_prompt_compact.trim().length > 0
        : typeof musicPlan?.style_prompt === "string" &&
          musicPlan.style_prompt.trim().length > 0;
    const providerHintPresent =
      typeof musicPlan?.provider_style_hint === "string"
        ? musicPlan.provider_style_hint.trim().length > 0
        : typeof musicPlan?.style_intent?.instruction_override === "string" &&
          musicPlan.style_intent.instruction_override.trim().length > 0;
    const negativeConstraints = Array.isArray(
      musicPlan?.style_negative_constraints,
    )
      ? musicPlan.style_negative_constraints
      : Array.isArray(musicPlan?.style_intent?.negative_constraints)
        ? musicPlan.style_intent.negative_constraints
        : [];
    if (providerHintPresent) {
      styleScore += 4;
    }
    if (compactPromptPresent) {
      styleScore += 3;
    }
    if (negativeConstraints.length > 0) {
      styleScore += 2;
    }
    styleScore = clampNumber(styleScore, 0, 100, 55);

    const qualityContract = resolveRenderContract({ track, musicPlan });
    const providerLocked =
      qualityContract.provider_locked || musicPlan?.provider_resolved || "suno";
    const providerCompletePath = path.join(
      versionDir,
      `${providerLocked}_complete.mp3`,
    );
    const providerCompleteFallbackPaths = [
      providerCompletePath,
      path.join(versionDir, isFull ? "inst_full.mp3" : "inst_preview.mp3"),
      path.join(versionDir, isFull ? "inst_full.wav" : "inst_preview.wav"),
      path.join(versionDir, "suno_complete.mp3"),
      path.join(versionDir, "elevenlabs_complete.mp3"),
    ];
    const hasProviderCompleteSourceArtifact = providerCompleteFallbackPaths.some(
      (candidatePath) => {
        try {
          const stats = fs.statSync(candidatePath);
          return stats.isFile() && stats.size >= 90000;
        } catch (_err) {
          return false;
        }
      },
    );
    const hasProviderCompleteAudio =
      isProviderCompleteAudioPipeline(qualityContract.pipeline) &&
      (Boolean(getProviderAudioUrl(trackVersion)) ||
        hasProviderCompleteSourceArtifact ||
        hasSaneOutputAudio);

    let vocalScore = 68;
    const directProviderGuide =
      Boolean(trackVersion?.guide_vocal_url) &&
      !String(trackVersion.guide_vocal_url).includes("/guide/");
    const isPersonalized = qualityContract.voice_mode === "user_voice";
    if (hasProviderCompleteAudio) {
      vocalScore = isPersonalized ? 88 : 90;
    } else if (
      isPersonalized &&
      isSunoVoicePersonaPipeline(qualityContract.pipeline)
    ) {
      vocalScore = 58;
    } else if (isPersonalized) {
      const personalizedFile = path.join(
        versionDir,
        isFull ? "user_vocal_full.wav" : "user_vocal.wav",
      );
      vocalScore = fs.existsSync(personalizedFile) ? 82 : 58;
    } else if (directProviderGuide) {
      vocalScore = 90;
    } else if (
      fs.existsSync(
        path.join(
          versionDir,
          isFull ? "guide_vocal_full.mp3" : "guide_vocal.mp3",
        ),
      )
    ) {
      vocalScore = 76;
    } else {
      vocalScore = 60;
    }

    const hasInstrumental =
      fs.existsSync(
        path.join(versionDir, isFull ? "inst_full.mp3" : "inst_preview.mp3"),
      ) ||
      fs.existsSync(
        path.join(versionDir, isFull ? "inst_full.wav" : "inst_preview.wav"),
      ) ||
      fs.existsSync(path.join(versionDir, "stems", "instrumental.wav")) ||
      fs.existsSync(path.join(versionDir, "suno_complete.mp3")) ||
      fs.existsSync(path.join(versionDir, "elevenlabs_complete.mp3"));
    const hasProviderCompleteFinal =
      hasSaneOutputAudio &&
      isProviderCompleteAudioPipeline(qualityContract.pipeline);
    let balanceScore =
      hasProviderCompleteFinal || (hasMix && hasInstrumental)
        ? 84
        : hasMix
          ? 70
          : 45;

    let technicalScore = hasOutput ? 75 : 25;
    if (hasOutput) {
      if (outputSizeBytes >= 150000) {
        technicalScore += 15;
      } else if (outputSizeBytes >= 90000) {
        technicalScore += 8;
      } else if (outputSizeBytes < 30000) {
        technicalScore -= 25;
      }
      if (!hasProbeableDuration) {
        technicalScore -= 25;
      }
    }

    if (Number.isFinite(actualDuration) && expectedDuration > 0) {
      const deltaRatio =
        Math.abs(actualDuration - expectedDuration) / expectedDuration;
      if (deltaRatio <= 0.15) {
        technicalScore += 10;
      } else if (deltaRatio <= 0.3) {
        technicalScore += 3;
      } else {
        technicalScore -= 12;
      }
    }
    technicalScore = clampNumber(technicalScore, 0, 100, 50);
    balanceScore = clampNumber(balanceScore, 0, 100, 60);
    vocalScore = clampNumber(vocalScore, 0, 100, 65);

    const totalScore = Math.round(
      styleScore * 0.45 +
        vocalScore * 0.25 +
        balanceScore * 0.2 +
        technicalScore * 0.1,
    );

    const issues = [];
    if (styleScore < 70) issues.push("style_fidelity_low");
    if (vocalScore < 65) issues.push("vocal_intelligibility_low");
    if (balanceScore < 65) issues.push("mix_balance_low");
    if (technicalScore < 60) issues.push("technical_quality_low");
    if (!hasOutput) issues.push("missing_output_audio");

    const passed =
      totalScore >= qualityThreshold &&
      hasOutput &&
      technicalScore >= 60;
    return {
      passed,
      threshold: qualityThreshold,
      total_score: totalScore,
      output_size_bytes: outputSizeBytes,
      style_adherence_score: styleScore,
      vocal_intelligibility_score: vocalScore,
      instrumental_balance_score: balanceScore,
      technical_score: technicalScore,
      expected_duration_sec: expectedDuration,
      actual_duration_sec: actualDuration,
      issues,
      summary: passed
        ? `Quality gate passed (${totalScore}/${qualityThreshold}).`
        : `Quality gate failed (${totalScore}/${qualityThreshold}): ${issues.join(", ") || "unspecified issues"}.`,
    };
  }

  async function getRuntimeMusicRoutingConfig() {
    const now = Date.now();
    if (cachedMusicRoutingConfig && now < cachedMusicRoutingExpiresAt) {
      return cachedMusicRoutingConfig;
    }

    const envDefaultProvider = providerConfig.suno?.live
      ? "suno"
      : providerConfig.elevenlabs?.live
        ? "elevenlabs"
        : config.MUSIC_PROVIDER || "suno";
    const fallback = {
      default_provider: envDefaultProvider,
      suno_model: config.SUNO_MODEL || "V5",
      auto_style_routing: true,
      elevenlabs_generation_mode: "composition_plan",
      auto_reroll_enabled: true,
      quality_threshold: 72,
      max_rerolls: 1,
      style_overrides: {},
    };

    let value = fallback;
    // U8: persona feature flags fold into the cached routing config to avoid
    // 2 extra DB reads per render tick.
    let personaModel = "voice_persona";
    let audioWeight = 0.85;
    try {
      const personaFlags = await getFeatureFlags(db, [
        "suno_voice_persona_persona_model",
        "suno_voice_persona_audio_weight",
      ]);
      const personaModelFlag = personaFlags.suno_voice_persona_persona_model;
      if (typeof personaModelFlag === "string" && personaModelFlag.trim()) {
        personaModel = personaModelFlag.trim();
      }
      const audioWeightFlag = personaFlags.suno_voice_persona_audio_weight;
      if (audioWeightFlag != null) {
        const numeric = Number(audioWeightFlag);
        if (Number.isFinite(numeric)) {
          audioWeight = Math.max(0, Math.min(1, numeric));
        }
      }
    } catch (err) {
      console.warn(
        "[JobRunner] Failed to read persona feature flags, using defaults:",
        err.message,
      );
    }
    try {
      const row = await db
        .prepare(
          "SELECT value_json FROM app_config WHERE key = 'music_provider_config'",
        )
        .get();
      if (row?.value_json) {
        const parsed = parseJson(row.value_json, {}, "music_provider_config");
        const parsedMaxRerolls = Number(parsed?.max_rerolls);
        value = {
          default_provider: "suno", // ElevenLabs removed from music generation pipeline
          suno_model:
            parsed?.suno_model === "V4_5" ||
            parsed?.suno_model === "V5" ||
            parsed?.suno_model === "V5_5"
              ? parsed.suno_model
              : fallback.suno_model,
          auto_style_routing: parsed?.auto_style_routing !== false,
          elevenlabs_generation_mode:
            parsed?.elevenlabs_generation_mode === "compose_detailed"
              ? "compose_detailed"
              : "composition_plan",
          auto_reroll_enabled: parsed?.auto_reroll_enabled !== false,
          quality_threshold: clampNumber(parsed?.quality_threshold, 0, 100, 72),
          max_rerolls: Number.isInteger(parsedMaxRerolls)
            ? Math.max(0, Math.min(3, parsedMaxRerolls))
            : 1,
          style_overrides: sanitizeStyleOverrides(parsed?.style_overrides),
        };
      }
    } catch (err) {
      console.warn(
        "[JobRunner] Failed to read music_provider_config, using env fallback:",
        err.message,
      );
      value = fallback;
    }

    // U8: attach persona settings to the same cached blob.
    value.suno_voice_persona_persona_model = personaModel;
    value.suno_voice_persona_audio_weight = audioWeight;
    cachedMusicRoutingConfig = value;
    cachedMusicRoutingExpiresAt = now + MUSIC_ROUTING_CACHE_TTL_MS;
    return value;
  }

  // Resolve active music provider (elevenlabs or suno) based on runtime config
  // and style-specific capability routing.
  async function getMusicProviderConfig({
    requestedStyle,
    pinnedProvider,
  } = {}) {
    if (pinnedProvider && providerConfig[pinnedProvider]?.live) {
      const runtimeConfig = await getRuntimeMusicRoutingConfig();
      const routing = resolveMusicProvider({
        requestedStyle,
        defaultProvider: pinnedProvider,
        providerConfig,
        autoStyleRouting: false,
        styleOverrides: runtimeConfig.style_overrides,
      });
      return {
        ...providerConfig[pinnedProvider],
        provider: pinnedProvider,
        sunoModel: pinnedProvider === "suno" ? runtimeConfig.suno_model : null,
        runtimeConfig,
        routing: {
          ...routing,
          reason: "pinned_provider",
          switched: false,
        },
      };
    }

    const runtimeConfig = await getRuntimeMusicRoutingConfig();
    const routing = resolveMusicProvider({
      requestedStyle,
      defaultProvider: runtimeConfig.default_provider,
      providerConfig,
      autoStyleRouting: runtimeConfig.auto_style_routing !== false,
      styleOverrides: runtimeConfig.style_overrides,
    });
    if (!routing.provider) {
      return null;
    }

    return {
      ...providerConfig[routing.provider],
      provider: routing.provider,
      sunoModel: routing.provider === "suno" ? runtimeConfig.suno_model : null,
      routing,
      runtimeConfig,
    };
  }

  // Helper to handle Suno task polling with circuit breaker
  async function pollOrSubmitSunoTask({
    musicConfig,
    job,
    lyrics,
    musicPlan,
    track,
    trackVersion,
    kind,
    routingMetadata,
    sunoPersona = null,
  }) {
    const taskId = job?.external_task_id || null;
    const existingStepData = parseJson(job?.step_data, {}, "suno_step_data");
    const incompleteSuccessPolls = Number(
      existingStepData?.incomplete_success_polls || 0,
    );
    // Wait up to ~6 minutes for Suno audio to finalize (36 polls × 10s).
    // Only declare failure when Suno itself returns FAILED/ERROR status.
    const maxIncompleteSuccessPolls = 36;

    const touchHeartbeat = async () => {
      if (!job) return;
      const stamp = new Date().toISOString();
      await updateJobHeartbeat.run(stamp, stamp, job.id, runnerId);
    };

    const submitTaskForLyrics = async (lyricsPayload) =>
      durabilityService.executeWithDurability({
        provider: PROVIDERS.SUNO,
        fn: () =>
          submitSunoTask({
            baseUrl: musicConfig.baseUrl,
            apiKey: musicConfig.apiKey,
            sunoModel: musicConfig.sunoModel,
            lyrics: lyricsPayload,
            musicPlan,
            track,
            timeoutMs: musicConfig.timeoutMs,
            sunoPersona,
          }),
      });

    function buildPendingResponse({
      taskIdValue,
      status = null,
      incompleteReason = null,
      incompletePolls = incompleteSuccessPolls,
      retryAfterSec = sunoPollIntervalSec,
      reconciling = false,
    }) {
      return {
        pending: true,
        retry_after_sec: retryAfterSec,
        provider: musicConfig.provider,
        task_id: taskIdValue,
        kind,
        suno_reconciling: reconciling,
        incomplete_success_polls: incompletePolls,
        last_suno_status: status,
        last_incomplete_reason: incompleteReason,
        routing: routingMetadata || null,
      };
    }

    function computeNextIncompletePolls({ status, reason }) {
      const nextIncompletePolls = incompleteSuccessPolls + 1;
      if (nextIncompletePolls >= maxIncompleteSuccessPolls) {
        // Only declare failure after exhausting all patience — Suno may still be processing
        console.warn(
          `[Suno] Exhausted ${maxIncompleteSuccessPolls} incomplete polls for task ${taskId || "unknown"} (status=${status || "unknown"}, reason=${reason || "unknown"})`,
        );
        throw new Error(
          `E302_SUNO_INCOMPLETE_OUTPUT: status=${status || "unknown"}, task=${taskId || "unknown"}, reason=${reason || "unknown"}`,
        );
      }
      if (nextIncompletePolls % 6 === 0) {
        console.log(
          `[Suno] Still waiting for audio: task=${taskId}, poll ${nextIncompletePolls}/${maxIncompleteSuccessPolls}, reason=${reason || "unknown"}`,
        );
      }
      return nextIncompletePolls;
    }

    // Poll existing task
    if (taskId) {
      const pollResult = await durabilityService.executeWithDurability({
        provider: PROVIDERS.SUNO,
        fn: () =>
          pollSunoTaskOnce({
            baseUrl: musicConfig.baseUrl,
            apiKey: musicConfig.apiKey,
            taskId,
            timeoutMs: 30000,
            onHeartbeat: touchHeartbeat,
          }),
      });

      const status = pollResult.status;
      console.log(`[Suno] Poll status for ${taskId}: ${status}`);
      const statusInfo = classifySunoStatus(status);

      if (
        statusInfo.phase === "audio_success" ||
        statusInfo.phase === "provisional_success"
      ) {
        const readiness = inspectSunoAudioReadiness(pollResult.response);
        if (!readiness.ready) {
          const nextIncompletePolls = computeNextIncompletePolls({
            status,
            reason: readiness.reason,
          });
          console.warn(
            `[Suno] Poll status ${status} for task ${taskId} but audio not ready (${readiness.reason}); poll ${nextIncompletePolls}/${maxIncompleteSuccessPolls}`,
          );
          return buildPendingResponse({
            taskIdValue: taskId,
            status,
            incompleteReason: readiness.reason,
            incompletePolls: nextIncompletePolls,
            retryAfterSec: Math.max(12, sunoPollIntervalSec),
            reconciling: true,
          });
        }

        let result;
        try {
          result = await downloadSunoAudio({
            storageDir,
            track,
            trackVersion,
            kind,
            statusResponse: pollResult.response,
            storageProvider,
          });
        } catch (downloadErr) {
          const downloadMessage = String(downloadErr?.message || "");
          if (
            downloadMessage.startsWith("E302_SUNO_AUDIO_NOT_READY:") ||
            downloadMessage.startsWith("E302_SUNO_INCOMPLETE_OUTPUT:")
          ) {
            const nextIncompletePolls = computeNextIncompletePolls({
              status,
              reason: "audio_not_ready",
            });
            console.warn(
              `[Suno] Audio artifact not finalized for task ${taskId}; reconciling ${nextIncompletePolls}/${maxIncompleteSuccessPolls}`,
            );
            return buildPendingResponse({
              taskIdValue: taskId,
              status,
              incompleteReason: "audio_not_ready",
              incompletePolls: nextIncompletePolls,
              retryAfterSec: Math.max(15, sunoPollIntervalSec),
              reconciling: true,
            });
          }
          throw downloadErr;
        }
        logSunoCreditUsage(taskId, pollResult.response);
        return {
          instrumental_url: result?.raw?.instrumental_url || null,
          guide_vocal_url: result?.raw?.guide_vocal_url || null,
          provider_audio_key: result?.raw?.provider_audio_key || null,
        };
      }

      if (statusInfo.phase === "failed") {
        const errorMsg = pollResult.response?.data?.errorMessage || status;
        if (isSunoPolicyError(errorMsg)) {
          logProviderRejection({
            provider: "suno",
            errorCode: "E302_SUNO_POLICY_ERROR",
            errorStatus: "poll_failed",
            rejectedTerms: extractPolicyTermsFromMessage(errorMsg),
            lyricsHash: lyricsHashSha256(lyrics),
            style: musicPlan?.style || null,
            step: kind === "full" ? "instrumental_full" : "instrumental",
            trackId: track?.id,
          });
          throw new Error(
            `E302_SUNO_POLICY_ERROR: Generation failed - ${errorMsg}`,
          );
        }
        throw new Error(`E302_SUNO_ERROR: Generation failed - ${errorMsg}`);
      }

      return buildPendingResponse({
        taskIdValue: taskId,
        status,
        retryAfterSec: sunoPollIntervalSec,
      });
    }

    // Submit new task — preflight sanitization via generic provider policy
    const baseSanitized = sanitizeLyricsForProviderPolicy({
      lyrics,
      provider: "suno",
      recipientName: track?.recipient_name || null,
    });
    const lyricsForSubmission = baseSanitized.lyrics;
    if (baseSanitized.changed) {
      console.log(
        `[Suno] Applied preflight lyric normalization (${baseSanitized.change_count} change(s)) before submission`,
      );
    }
    let newTaskId;
    try {
      newTaskId = await submitTaskForLyrics(lyricsForSubmission);
    } catch (submitErr) {
      const submitMessage = String(submitErr?.message || "");
      if (isSunoPolicyError(submitMessage)) {
        logProviderRejection({
          provider: "suno",
          errorCode: "E302_SUNO_POLICY_ERROR",
          errorStatus: "submit_failed",
          rejectedTerms: extractPolicyTermsFromMessage(submitMessage),
          lyricsHash: lyricsHashSha256(lyricsForSubmission),
          style: musicPlan?.style || null,
          step: kind === "full" ? "instrumental_full" : "instrumental",
          trackId: track?.id,
        });
        throw new Error(`E302_SUNO_POLICY_ERROR: ${submitMessage}`);
      }
      throw submitErr;
    }

    if (job) {
      const payload = {
        provider: musicConfig.provider,
        task_id: newTaskId,
        kind,
        suno_reconciling: false,
        routing: routingMetadata || null,
      };
      const stamp = new Date().toISOString();
      await updateJobExternalTask.run(
        newTaskId,
        toJson(payload),
        stamp,
        stamp,
        job.id,
        runnerId,
      );
    }

    return buildPendingResponse({
      taskIdValue: newTaskId,
      retryAfterSec: sunoPollIntervalSec,
    });
  }

  async function recoverSunoResultFromExistingTask({
    musicConfig,
    job,
    track,
    trackVersion,
    kind,
    routingMetadata,
    renderContract,
    step,
  }) {
    const taskId = job?.external_task_id;
    if (!taskId || !musicConfig || musicConfig.provider !== "suno") {
      return null;
    }

    try {
      const pollResult = await pollSunoTaskOnce({
        baseUrl: musicConfig.baseUrl,
        apiKey: musicConfig.apiKey,
        taskId,
        timeoutMs: 30000,
      });
      const status = pollResult?.status;
      const statusInfo = classifySunoStatus(status);
      if (
        !(
          statusInfo.phase === "audio_success" ||
          statusInfo.phase === "provisional_success"
        )
      ) {
        return null;
      }

      const readiness = inspectSunoAudioReadiness(pollResult.response);
      if (!readiness.ready) {
        return null;
      }

      logSunoCreditUsage(taskId, pollResult.response);
      const recovered = await downloadSunoAudio({
        storageDir,
        track,
        trackVersion,
        kind,
        statusResponse: pollResult.response,
        storageProvider,
      });
      const providerAudioUrl = extractProviderAudioUrl(recovered?.raw || {});
      const providerAudioKey = recovered?.raw?.provider_audio_key || null;
      const provenance_json = mergeProvenanceJson(
        trackVersion.provenance_json,
        {
          music: {
            ...(parseJson(trackVersion.provenance_json, {}, "prov_suno_recover")
              ?.music || {}),
            provider: "suno",
            routing: routingMetadata || null,
            render_contract: renderContract,
            provider_audio_url:
              providerAudioUrl || getProviderAudioUrl(trackVersion),
            provider_audio_key:
              providerAudioKey || getProviderAudioKey(trackVersion),
          },
          timeline: [
            {
              at: nowIso(),
              step,
              event: "suno_result_reconciled",
              provider: "suno",
              task_id: taskId,
              status,
            },
          ],
        },
      );

      return {
        instrumental_url:
          providerAudioUrl || recovered?.raw?.instrumental_url || null,
        guide_vocal_url:
          renderContract.pipeline === "guide_tts_and_voice_convert"
            ? recovered?.raw?.guide_vocal_url || null
            : null,
        provider_audio_key: providerAudioKey,
        provider_routing: routingMetadata || null,
        provenance_json,
      };
    } catch (err) {
      console.warn(
        `[JobRunner] Suno reconciliation probe failed for task ${taskId}: ${err?.message || err}`,
      );
      return null;
    }
  }

  async function resolveSunoPersonaForRender({ track, renderContract }) {
    // U8: cached routing config shared with music_provider_config (1 DB call,
    // not 2 extra getFeatureFlag round-trips per render tick).
    const runtimeConfig = await getRuntimeMusicRoutingConfig();
    return resolveSunoPersonaForRenderImpl({
      db,
      track,
      renderContract,
      runtimeConfig,
    });
  }

  // Stale job recovery: reset jobs stuck in 'running' status
  // This handles cases where process crashed mid-step
  // Note: Compute cutoff in JavaScript for database-agnostic comparison
  const recoverStaleJobsStmt = await db.prepare(`
    UPDATE jobs
    SET status = 'queued',
        attempts = attempts + 1,
        locked_by = NULL,
        locked_at = NULL,
        updated_at = ?
    WHERE status = 'running'
      AND COALESCE(last_heartbeat_at, locked_at, updated_at) < ?
  `);
  let cleanOrphanedStepHistory = null;

  async function performStaleJobRecovery() {
    if (!recoverStaleJobs) return;
    try {
      const now = new Date().toISOString();
      // Compute cutoff time in JavaScript: now - staleJobTimeoutMinutes
      const cutoffTime = new Date(
        Date.now() - staleJobTimeoutMinutes * 60 * 1000,
      ).toISOString();
      const result = await recoverStaleJobsStmt.run(now, cutoffTime);
      if (result.changes > 0) {
        console.warn(
          `[JobRunner] Recovered ${result.changes} stale jobs stuck in 'running' status`,
        );
        // Clean orphaned step history entries left 'running' by crashed workers
        if (cleanOrphanedStepHistory) {
          try {
            await cleanOrphanedStepHistory.run(now);
          } catch (_) {
            /* best-effort */
          }
        }
      }
      await recoverStaleVoiceProviderJobs(db, {
        staleBefore: cutoffTime,
        provider: "suno",
      });
    } catch (err) {
      console.error(`[JobRunner] Failed to recover stale jobs:`, err.message);
    }
  }

  // Recover stale jobs at startup
  await performStaleJobRecovery();
  const recoveryIntervalMs = Math.max(
    60000,
    Math.floor((staleJobTimeoutMinutes * 60 * 1000) / 2),
  );
  const recoveryTimer = setInterval(
    performStaleJobRecovery,
    recoveryIntervalMs,
  );

  // --- DLQ Auto-Reprocessor ---
  // Periodically re-queues dead-letter jobs that failed due to transient/infra errors.
  // Skips policy errors (content blocks, quality gates) which need human intervention.
  async function performDLQAutoReprocess() {
    try {
      const cooldownCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const candidates = await db
        .prepare(
          `SELECT dlq.*, j.step, j.error_code, j.error_message, j.track_version_id, j.workflow_type
         FROM dead_letter_queue dlq
         JOIN jobs j ON j.id = dlq.job_id
         WHERE dlq.reprocessed_at IS NULL
           AND dlq.auto_reprocess_count < 2
           AND dlq.moved_at < ?
         ORDER BY dlq.moved_at ASC
         LIMIT 5`,
        )
        .all(cooldownCutoff);

      for (const entry of candidates) {
        // Skip non-retryable errors — delegate to the shared classifier (single source of truth)
        const errCode = entry.error_code || "";
        const errMsg = entry.error_message || entry.failure_reason || "";
        const classification = classifyError(
          errMsg,
          errCode,
          entry.step || null,
        );
        if (!classification.retryable) {
          continue;
        }

        const now = new Date().toISOString();
        const tv = await db
          .prepare("SELECT * FROM track_versions WHERE id = ?")
          .get(entry.track_version_id);
        const track = tv
          ? await db
              .prepare("SELECT * FROM tracks WHERE id = ?")
              .get(tv.track_id)
          : null;

        // Clean stale files before re-queuing
        if (track && tv && entry.step) {
          const versionDir = path.join(
            storageDir,
            "tracks",
            track.user_id,
            track.id,
            `v${tv.version_num}`,
          );
          cleanStaleStepFiles(versionDir, entry.step);
        }

        // Reset job to queued (WHERE status guard prevents race with iOS "Try Again")
        const jobReset = await db
          .prepare(
            "UPDATE jobs SET status = 'queued', step = 'queued', step_index = 0, attempts = 0, error_code = NULL, error_message = NULL, progress_pct = 0, completed_at = NULL, next_attempt_at = NULL, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ? AND status IN ('failed', 'dead_letter')",
          )
          .run(now, entry.job_id);

        // Only update DLQ counter and track statuses if the job was actually reset
        if (!jobReset || jobReset.changes === 0) {
          console.log(
            `[JobRunner] DLQ entry ${entry.id}: job ${entry.job_id} already re-queued by another path, skipping`,
          );
          continue;
        }

        // Update DLQ entry
        await db
          .prepare(
            "UPDATE dead_letter_queue SET reprocessed_at = ?, reprocess_job_id = ?, auto_reprocess_count = auto_reprocess_count + 1 WHERE id = ?",
          )
          .run(now, entry.job_id, entry.id);

        // Reset track_version + track status
        if (tv) {
          await db
            .prepare(
              "UPDATE track_versions SET status = 'processing' WHERE id = ?",
            )
            .run(tv.id);
        }
        if (track) {
          await db
            .prepare(
              "UPDATE tracks SET status = 'rendering', updated_at = ? WHERE id = ?",
            )
            .run(now, track.id);
        }

        const attempt = (entry.auto_reprocess_count || 0) + 1;
        console.log(
          `[JobRunner] Auto-reprocessed DLQ entry ${entry.id} (attempt ${attempt}/2)`,
        );
      }
    } catch (err) {
      console.error(`[JobRunner] DLQ auto-reprocess failed:`, err.message);
    }
  }

  const dlqReprocessTimer = setInterval(performDLQAutoReprocess, 5 * 60 * 1000);
  const dlqReprocessStartupTimer = setTimeout(performDLQAutoReprocess, 30000); // Run once at startup after 30s

  // Durable artwork-job orphan recovery. Sweeps the `jobs` table for any
  // workflow_type='artwork_render' rows stuck queued past their next_attempt_at
  // or running without a heartbeat — restart-survival for the artwork pipeline.
  const artworkRecoverySweep = () => {
    recoverOrphanedArtworkJobs({ db }).catch((err) => {
      console.warn(
        `[JobRunner] artwork orphan recovery failed: ${err.message}`,
      );
    });
  };
  const artworkRecoveryTimer = setInterval(artworkRecoverySweep, 60 * 1000);
  const artworkRecoveryStartupTimer = setTimeout(artworkRecoverySweep, 5000); // Run shortly after startup

  // FOR UPDATE SKIP LOCKED prevents race conditions between workers:
  // - Locks selected rows so other workers won't select them
  // - SKIP LOCKED means workers don't block, they just skip locked rows
  // - LIMIT ensures we only lock what we need (availableSlots)
  // Exclude artwork_render — those jobs are owned by src/jobs/artwork-job.js
  // and dispatched via recoverOrphanedArtworkJobs() / enqueueArtworkJob().
  // Leaving them in this claim query would pull them into the audio pipeline
  // which has no artwork step handler.
  const selectJobsQuery = db.isPostgres
    ? "SELECT * FROM jobs WHERE status = 'queued' AND workflow_type <> 'artwork_render' AND (next_attempt_at IS NULL OR next_attempt_at <= $1) ORDER BY created_at ASC LIMIT $2 FOR UPDATE SKIP LOCKED"
    : "SELECT * FROM jobs WHERE status = 'queued' AND workflow_type <> 'artwork_render' AND (next_attempt_at IS NULL OR next_attempt_at <= $1) ORDER BY created_at ASC LIMIT $2";
  const selectJobs = await db.prepare(selectJobsQuery);
  const claimJob = await db.prepare(
    "UPDATE jobs SET status = 'running', locked_by = ?, locked_at = ?, started_at = COALESCE(started_at, ?), last_heartbeat_at = ?, progress_pct = ?, updated_at = ? WHERE id = ? AND status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)",
  );
  // All job updates include ownership verification (AND locked_by = ?) to prevent
  // data integrity issues when workers lose ownership mid-processing
  const updateJobStep = await db.prepare(
    "UPDATE jobs SET step = ?, step_index = ?, progress_pct = ?, last_heartbeat_at = ?, updated_at = ? WHERE id = ? AND locked_by = ?",
  );
  const updateJob = await db.prepare(
    "UPDATE jobs SET status = ?, step = ?, step_index = ?, step_data = ?, progress_pct = ?, last_heartbeat_at = ?, next_attempt_at = NULL, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ? AND locked_by = ?",
  );
  const updateJobReroll = await db.prepare(
    "UPDATE jobs SET status = ?, step = ?, step_index = ?, step_data = ?, external_task_id = NULL, progress_pct = ?, last_heartbeat_at = ?, next_attempt_at = NULL, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ? AND locked_by = ?",
  );
  const updateJobPending = await db.prepare(
    "UPDATE jobs SET status = ?, step = ?, step_index = ?, step_data = ?, progress_pct = ?, last_heartbeat_at = ?, next_attempt_at = ?, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ? AND locked_by = ?",
  );
  const updateJobStatus = await db.prepare(
    "UPDATE jobs SET status = ?, progress_pct = ?, completed_at = ?, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ? AND locked_by = ?",
  );
  const updateJobHeartbeat = await db.prepare(
    "UPDATE jobs SET last_heartbeat_at = ?, updated_at = ? WHERE id = ? AND locked_by = ?",
  );
  const updateJobFailure = await db.prepare(
    "UPDATE jobs SET status = ?, step = ?, step_index = ?, error_code = ?, error_message = ?, progress_pct = ?, completed_at = ?, next_attempt_at = NULL, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ? AND locked_by = ?",
  );
  const updateJobFailureNoLock = await db.prepare(
    "UPDATE jobs SET status = ?, step = ?, step_index = ?, error_code = ?, error_message = ?, progress_pct = ?, completed_at = ?, next_attempt_at = NULL, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ?",
  );
  const updateJobAttempt = await db.prepare(
    "UPDATE jobs SET attempts = attempts + 1, status = ?, progress_pct = ?, last_heartbeat_at = ?, next_attempt_at = ?, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ? AND locked_by = ?",
  );
  const updateJobExternalTask = await db.prepare(
    "UPDATE jobs SET external_task_id = ?, step_data = ?, last_heartbeat_at = ?, updated_at = ? WHERE id = ? AND locked_by = ?",
  );
  const getTrackVersion = await db.prepare(
    "SELECT * FROM track_versions WHERE id = ?",
  );
  const getTrack = await db.prepare("SELECT * FROM tracks WHERE id = ?");
  const updateTrackVersion = await db.prepare(
    "UPDATE track_versions SET status = ?, completed_at = ?, preview_url = COALESCE(?, preview_url), full_url = COALESCE(?, full_url), lyrics_json = COALESCE(?, lyrics_json), lyrics_status = COALESCE(?, lyrics_status), lyrics_updated_at = COALESCE(?, lyrics_updated_at), lyrics_approved_at = COALESCE(?, lyrics_approved_at), music_plan_json = COALESCE(?, music_plan_json), moderation_status = COALESCE(?, moderation_status), moderation_reason = COALESCE(?, moderation_reason), instrumental_url = COALESCE(?, instrumental_url), guide_vocal_url = COALESCE(?, guide_vocal_url), guide_access_token = COALESCE(?, guide_access_token), voice_conversion_url = COALESCE(?, voice_conversion_url), provenance_json = COALESCE(?, provenance_json) WHERE id = ?",
  );
  const updateTrack = await db.prepare(
    "UPDATE tracks SET status = ?, updated_at = ? WHERE id = ?",
  );
  const updateUserRisk = await db.prepare(
    "UPDATE users SET risk_level = ? WHERE id = ?",
  );
  const insertAuditLog = await db.prepare(
    "INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const updateTrackVersionCover = await db.prepare(
    "UPDATE track_versions SET cover_image_url = ?, cover_image_small_url = ?, cover_image_large_url = ? WHERE id = ?",
  );
  const updateTrackVersionLyricsOnly = await db.prepare(
    "UPDATE track_versions SET lyrics_json = ? WHERE id = ?",
  );

  // Phase 3: Per-user concurrency — find users at capacity
  const getBlockedUsers = await db.prepare(
    `SELECT t.user_id FROM jobs j
     JOIN track_versions tv ON j.track_version_id = tv.id
     JOIN tracks t ON tv.track_id = t.id
     WHERE j.status = 'running' AND j.last_heartbeat_at > ?
     GROUP BY t.user_id HAVING COUNT(*) >= ?`,
  );

  // Phase 2: Step history — observability for each step execution
  const insertStepHistory = await db.prepare(
    "INSERT INTO job_step_history (id, job_id, step_name, attempt, status, started_at, completed_at, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const updateStepHistory = await db.prepare(
    "UPDATE job_step_history SET status = ?, error_message = ?, completed_at = ?, duration_ms = ? WHERE id = ?",
  );
  // Orphan cleanup — mark step history entries as failed when their job is no longer running
  try {
    cleanOrphanedStepHistory = await db.prepare(
      `UPDATE job_step_history SET status = 'failed', error_message = 'Worker crashed', completed_at = ?, duration_ms = 0
       WHERE status = 'running' AND job_id IN (SELECT id FROM jobs WHERE status != 'running')`,
    );
  } catch (_) {
    /* table may not exist yet before migration 072 */
  }

  function getErrorInfo(err) {
    const rawMessage =
      err && err.message ? String(err.message) : "unknown_error";

    if (rawMessage.startsWith("E302_PROVIDER_POLICY_ERROR:")) {
      const detail = rawMessage
        .replace("E302_PROVIDER_POLICY_ERROR:", "")
        .trim();
      return {
        code: "E302_PROVIDER_POLICY_ERROR",
        message:
          detail ||
          "Music generation failed due to provider content policy. Please revise the highlighted lyrics and try again.",
      };
    }

    if (rawMessage.startsWith("E302_SUNO_POLICY_ERROR:")) {
      const detail = rawMessage.replace("E302_SUNO_POLICY_ERROR:", "").trim();
      return {
        code: "E302_SUNO_POLICY_ERROR",
        message:
          detail ||
          "Music generation failed due to lyrics policy. Please adjust the highlighted words and try again.",
      };
    }

    if (rawMessage.startsWith("E302_SUNO_ERROR:")) {
      const detail = rawMessage.replace("E302_SUNO_ERROR:", "").trim();
      if (/no audio url|no audio data|incomplete output/i.test(detail)) {
        return {
          code: "E302_SUNO_INCOMPLETE_OUTPUT",
          message:
            detail ||
            "Suno is still finalizing the audio. Please retry to continue the same generation.",
        };
      }
      return {
        code: "E302_SUNO_ERROR",
        message: detail || "Music generation failed. Please try again.",
      };
    }

    if (rawMessage.startsWith("E302_SUNO_AUDIO_NOT_READY:")) {
      const detail = rawMessage
        .replace("E302_SUNO_AUDIO_NOT_READY:", "")
        .trim();
      return {
        code: "E302_SUNO_INCOMPLETE_OUTPUT",
        message:
          detail ||
          "Suno returned an audio URL, but the file was not finalized yet. Please retry to continue the same task.",
      };
    }

    if (rawMessage.startsWith("E302_SUNO_INCOMPLETE_OUTPUT:")) {
      const detail = rawMessage
        .replace("E302_SUNO_INCOMPLETE_OUTPUT:", "")
        .trim();
      return {
        code: "E302_SUNO_INCOMPLETE_OUTPUT",
        message:
          detail ||
          "Suno is still finalizing the audio. Please retry to continue the same generation.",
      };
    }

    if (rawMessage.startsWith("E302_QUALITY_GATE_FAILED:")) {
      const detail = rawMessage.replace("E302_QUALITY_GATE_FAILED:", "").trim();
      return {
        code: "E302_QUALITY_GATE_FAILED",
        message:
          detail ||
          "Generated output quality was too low. Please retry with a stronger style instruction.",
      };
    }

    if (rawMessage.startsWith("E301_ELEVENLABS_VALIDATION:")) {
      const detail = rawMessage
        .replace("E301_ELEVENLABS_VALIDATION:", "")
        .trim();
      return {
        code: "E301_ELEVENLABS_VALIDATION",
        message:
          detail ||
          "Music prompt validation failed. Please adjust style instructions and retry.",
      };
    }

    if (rawMessage.startsWith("E301_SOURCE_URL_EXPIRED:")) {
      return {
        code: "E301_SOURCE_URL_EXPIRED",
        message: "Audio source expired. Please create a new song to try again.",
      };
    }

    if (rawMessage.startsWith("E301_FFMPEG_TIMEOUT:")) {
      return {
        code: "E301_FFMPEG_TIMEOUT",
        message: "Audio processing timed out. Please try again.",
      };
    }

    if (rawMessage.startsWith("E301_FFMPEG_SPAWN:")) {
      return {
        code: "E301_FFMPEG_SPAWN",
        message: "Audio processor failed to start. Please try again.",
      };
    }

    if (rawMessage.startsWith("E301_FFMPEG_ERROR:")) {
      return { code: "E301_FFMPEG_ERROR", message: "Audio processing failed." };
    }

    if (rawMessage.startsWith("E301_MISSING_INPUTS:")) {
      return { code: "E301_MISSING_INPUTS", message: rawMessage };
    }

    if (rawMessage.startsWith("E301_MISSING_STEMS:")) {
      return { code: "E301_MISSING_STEMS", message: rawMessage };
    }

    if (rawMessage.startsWith("E301_GUIDE_VOCAL_MISSING:")) {
      return { code: "E301_GUIDE_VOCAL_MISSING", message: rawMessage };
    }

    if (rawMessage.startsWith("E201_LYRICS_ERROR:")) {
      const detail = rawMessage.replace("E201_LYRICS_ERROR:", "").trim();
      return {
        code: "E201_LYRICS_ERROR",
        message: detail || "Lyrics generation failed.",
      };
    }

    if (rawMessage.startsWith("E302_WORKFLOW_ERROR:")) {
      return {
        code: "E302_WORKFLOW_ERROR",
        message: "Song creation workflow failed. Please try again.",
      };
    }

    // Parse provider errors and provide user-friendly messages
    if (rawMessage.startsWith("provider_error:")) {
      const parts = rawMessage.split(":");
      const status = parts[1] || "unknown";
      const detail = parts.slice(2).join(":") || "";

      // Map HTTP status codes to user-friendly messages
      let userMessage;
      switch (status) {
        case "502":
          userMessage =
            "Music service temporarily unavailable. Please try again.";
          break;
        case "503":
          userMessage = "Music service is overloaded. Please try again later.";
          break;
        case "504":
          userMessage = "Music service timed out. Please try again.";
          break;
        case "429":
          userMessage =
            "Too many requests. Please wait a moment and try again.";
          break;
        case "timeout":
          userMessage = "Music service request timed out. Please try again.";
          break;
        case "network":
          userMessage =
            "Network error. Please check your connection and try again.";
          break;
        default:
          // For other errors, use a clean message if available, otherwise generic
          userMessage =
            detail.length < 100 && !detail.includes("<")
              ? detail
              : "An error occurred. Please try again.";
      }

      return { code: `provider_error_${status}`, message: userMessage };
    }

    // Handle other error formats
    const code = rawMessage.includes(":")
      ? rawMessage.split(":")[0]
      : rawMessage;
    const cleanMessage =
      rawMessage.length <= 300 ? rawMessage : rawMessage.slice(0, 297) + "...";
    return { code, message: cleanMessage };
  }

  function isNonRetryablePolicyError(err, step) {
    const rawMessage = err && err.message ? String(err.message) : "";
    if (!rawMessage) return false;
    const parsed = getErrorInfo(err);
    return !classifyError(rawMessage, parsed.code, step || null).retryable;
  }

  function isProviderRateLimitError(err) {
    const message = err && err.message ? String(err.message) : "";
    return message.startsWith("provider_error:429:");
  }

  function isCircuitOpenProviderError(err) {
    const message = err && err.message ? String(err.message) : "";
    return message.includes("Circuit breaker open for provider:");
  }

  function isTransientVoiceInfraError(err) {
    const message = err && err.message ? String(err.message) : "";
    if (!message) {
      return false;
    }
    return (
      message.includes("E302_SEEDVC_ERROR: GPU task aborted") ||
      message.includes(
        "Personalized voice conversion failed: E302_SEEDVC_ERROR: GPU task aborted",
      ) ||
      message.includes("download_error:corrupted:File too small") ||
      message.startsWith("download_error:network:") ||
      message.startsWith("download_error:503:") ||
      message.startsWith("download_error:504:")
    );
  }

  function getRetryAfterSeconds(err, attemptNumber = 1) {
    const message = err && err.message ? String(err.message) : "";
    const safeAttempt = Math.max(1, Number(attemptNumber) || 1);

    if (isCircuitOpenProviderError(err)) {
      const cooldownMs = Math.max(
        5000,
        Number(durabilityConfig.cooldownMs) || 30000,
      );
      const baseDelaySec = Math.ceil(cooldownMs / 1000);
      return Math.min(300, baseDelaySec * safeAttempt);
    }

    if (isTransientVoiceInfraError(err)) {
      return Math.min(180, 15 * safeAttempt);
    }

    if (
      message.includes("E302_SUNO_INCOMPLETE_OUTPUT") ||
      message.includes("E302_SUNO_AUDIO_NOT_READY")
    ) {
      return Math.min(120, 15 * safeAttempt);
    }

    // Transient FFmpeg failures: timeout or process spawn failure only
    if (
      message.startsWith("E301_FFMPEG_TIMEOUT:") ||
      message.startsWith("E301_FFMPEG_SPAWN:")
    ) {
      return Math.min(60, 10 * safeAttempt);
    }

    // Transient LLM unavailability during lyrics generation
    if (
      message.startsWith("E201_LYRICS_ERROR:") &&
      message.includes("AI_UNAVAILABLE")
    ) {
      return Math.min(60, 15 * safeAttempt);
    }

    if (!message.startsWith("provider_error:429:")) {
      return null;
    }
    const body = message.split(":").slice(2).join(":");

    const withExponentialBackoff = (baseDelaySec, maxDelaySec = 900) => {
      const cappedBase = Math.max(5, Number(baseDelaySec) || 30);
      const delay = Math.round(cappedBase * Math.pow(2, safeAttempt - 1));
      return Math.min(maxDelaySec, delay);
    };

    try {
      const parsed = JSON.parse(body);
      if (parsed && parsed.retry_after) {
        const seconds = Number(parsed.retry_after);
        if (Number.isFinite(seconds)) {
          return withExponentialBackoff(seconds);
        }
      }
    } catch (parseErr) {
      console.warn(
        `[JobRunner] Could not parse retry_after from rate limit response: ${body.slice(0, 100)}`,
      );
    }

    // Handle throttling payloads that only include descriptive text.
    // Example: "reduced to 6 requests per minute ... less than $5.0 in credit"
    const rpmMatch = body.match(/(\d+)\s*requests?\s*per\s*minute/i);
    const lowCreditHint = /less than\s+\$?\d+(\.\d+)?\s+in credit/i.test(body);
    let baseDelaySec = 45;
    if (rpmMatch) {
      const rpm = Number(rpmMatch[1]);
      if (Number.isFinite(rpm) && rpm > 0) {
        const secondsPerRequest = Math.ceil(60 / rpm);
        baseDelaySec = Math.max(secondsPerRequest * 2, 20);
      }
    }
    if (lowCreditHint) {
      baseDelaySec = Math.max(baseDelaySec, 120);
    }

    return withExponentialBackoff(baseDelaySec);
  }

  function getEffectiveMaxAttempts(job, err) {
    const configuredMaxAttempts = Math.max(1, Number(job?.max_attempts) || 3);
    const message = err && err.message ? String(err.message) : "";
    if (
      message.includes("E302_SUNO_INCOMPLETE_OUTPUT") ||
      message.includes("E302_SUNO_AUDIO_NOT_READY")
    ) {
      // 36 polls (~6 min) per attempt × 3 attempts = ~18 min max. Suno shouldn't take longer than 10 min.
      return configuredMaxAttempts;
    }
    if (isCircuitOpenProviderError(err) || isTransientVoiceInfraError(err)) {
      return Math.max(configuredMaxAttempts, 6);
    }
    if (!isProviderRateLimitError(err)) {
      return configuredMaxAttempts;
    }
    // Rate limits are transient. Allow more retries with spread-out backoff
    // to avoid immediate DLQ on burst throttling.
    return Math.max(configuredMaxAttempts, 6);
  }

  const stepHandlers = {
    moderation: ({ track, trackVersion }) => {
      if (trackVersion.moderation_status) {
        return { moderation_status: trackVersion.moderation_status };
      }
      const lyrics = parseJson(
        trackVersion.lyrics_json,
        null,
        "moderation_lyrics",
      );
      const moderation = moderationCheck({
        title: track.title,
        recipient_name: track.recipient_name,
        message: track.message,
        lyrics: lyrics ? JSON.stringify(lyrics) : null,
      });
      if (!moderation.allowed) {
        return {
          moderation_status: "blocked",
          moderation_reason: moderation.reason,
          status_override: "blocked",
        };
      }
      return { moderation_status: "passed", moderation_reason: null };
    },

    lyrics: async ({ track, trackVersion }) => {
      const existing = parseJson(trackVersion.lyrics_json, null, "lyrics_json");
      if (existing) {
        const existingProvenance = parseJson(
          trackVersion.provenance_json,
          {},
          "provenance_json",
        );
        console.log(
          `[JobRunner] Skipping lyrics regeneration: existing lyrics_json found ${JSON.stringify(
            {
              quality_score: existingProvenance?.lyrics?.quality_score ?? null,
              acceptance_reason:
                existingProvenance?.lyrics?.acceptance_reason || null,
              provider: existingProvenance?.lyrics?.provider || null,
              model: existingProvenance?.lyrics?.model || null,
              filtered_fact_count:
                existingProvenance?.lyrics?.filtered_fact_count ?? null,
              prompt_budget: existingProvenance?.lyrics?.prompt_budget || null,
              lyrics_summary:
                existingProvenance?.lyrics?.lyrics_summary || null,
              story_context_summary:
                existingProvenance?.lyrics?.story_context_summary || null,
              fidelity: existingProvenance?.lyrics?.fidelity || null,
            },
          )}`,
        );
        return { lyrics_json: trackVersion.lyrics_json };
      }

      try {
        const lyricsContext = buildLyricsContext(track);
        const lyricsContextSummary =
          summarizeLyricsContextForLog(lyricsContext);
        console.log(
          `[JobRunner] Lyrics context summary=${JSON.stringify(lyricsContextSummary)}`,
        );

        const result = await generateLyrics(lyricsContext);
        const compliance = sanitizeLyricsForAllMusicProviders(result.lyrics, {
          recipientName: track?.recipient_name || null,
        });
        if (compliance.changed) {
          console.warn(
            `[JobRunner] Lyrics compliance sanitizer applied ${compliance.change_count} edit(s) across providers`,
          );
          assertPolicySanitizerPreservedStoryDetails({
            originalLyrics: result.lyrics,
            sanitizedLyrics: compliance.lyrics,
            storyContext: lyricsContext,
            provider: "all",
            step: "lyrics",
            trackId: track.id,
          });
        }
        if (compliance.blocked) {
          const blockedTerms = compliance.reports
            .flatMap((report) => report.violation_terms || [])
            .filter(Boolean)
            .slice(0, 8);
          throw new Error(
            `E302_PROVIDER_POLICY_ERROR: Generated lyrics still contain restricted terms (${blockedTerms.join(", ") || "unknown"}).`,
          );
        }
        const lyricsProvenance = mergeProvenanceJson(
          trackVersion.provenance_json,
          {
            lyrics: {
              compliance_sanitized: compliance.changed,
              compliance_change_count: compliance.change_count,
              compliance_reports: compliance.reports,
              provider: result.provider || null,
              model: result.model || null,
              usage: result.usage || null,
              quality_score: result.quality_score ?? null,
              acceptance_reason: result.acceptance_reason || null,
              filtered_fact_count: Number.isFinite(result.filtered_fact_count)
                ? result.filtered_fact_count
                : null,
              story_context_summary: lyricsContextSummary,
              prompt_input_summary: result.prompt_input_summary || null,
              prompt_budget: result.prompt_budget || null,
              lyrics_summary: result.lyrics_summary || null,
              contract_validation: result.contract_validation || null,
              fidelity: result.fidelity_debug || null,
            },
            timeline: compliance.changed
              ? [
                  {
                    at: nowIso(),
                    step: "lyrics",
                    event: "lyrics_policy_sanitized",
                    change_count: compliance.change_count,
                  },
                ]
              : [],
          },
        );

        return {
          lyrics_json: toJson(compliance.lyrics),
          lyrics_status: result.lyrics_status,
          lyrics_updated_at: new Date().toISOString(),
          provenance_json: lyricsProvenance,
        };
      } catch (err) {
        if (
          err &&
          (err.code === "AI_UNAVAILABLE" || err.message === "AI_UNAVAILABLE")
        ) {
          throw new Error("E201_LYRICS_ERROR: AI_UNAVAILABLE");
        }
        if (err && err.code === "LYRICS_QUALITY_LOW") {
          const qualityScore = Number.isFinite(err.quality_score)
            ? err.quality_score
            : "unknown";
          throw new Error(
            `E201_LYRICS_ERROR: LYRICS_QUALITY_LOW: quality score ${qualityScore}`,
          );
        }
        if (err && err.code === "LYRICS_FIDELITY_LOW") {
          const fidelityReason =
            err.fidelity?.feedback || "story fidelity below threshold";
          throw new Error(
            `E201_LYRICS_ERROR: LYRICS_FIDELITY_LOW: ${fidelityReason}`,
          );
        }
        throw err;
      }
    },

    music_plan: async ({ track, trackVersion, job }) => {
      const musicConfig = await getMusicProviderConfig({
        requestedStyle: track.style,
      });
      const runtimeMusicConfig = musicConfig?.runtimeConfig || {
        elevenlabs_generation_mode: "composition_plan",
        style_overrides: {},
      };
      if (musicConfig?.routing) {
        console.log(
          `[JobRunner] Music provider routing: style=${musicConfig.routing.style} requested=${musicConfig.routing.requested_provider} resolved=${musicConfig.routing.provider} support=${musicConfig.routing.support} reason=${musicConfig.routing.reason}`,
        );
      }
      const plan = buildMusicPlan({
        style: track.style,
        durationTarget: track.duration_target,
        provider: musicConfig?.provider || null,
        seed: `${track.id}:${track.latest_version || "v"}:${track.style || "style"}`,
        styleOverrides: runtimeMusicConfig.style_overrides,
        generationMode: runtimeMusicConfig.elevenlabs_generation_mode,
      });
      if (musicConfig?.routing) {
        plan.provider_requested = musicConfig.routing.requested_provider;
        plan.provider_resolved = musicConfig.routing.provider;
        plan.provider_support = musicConfig.routing.support;
        plan.provider_support_score = musicConfig.routing.support_score;
        plan.provider_auto_switched = Boolean(musicConfig.routing.switched);
        plan.provider_resolution_reason = musicConfig.routing.reason;
        plan.style_support_degraded = Boolean(musicConfig.routing.degraded);
      }
      // Thread voice_gender into music plan so Suno receives vocal metatags
      if (track.voice_gender) {
        plan.voice_gender = track.voice_gender;
      }
      let voiceConversionProvider = null;
      let userVoiceEngine = null;
      let voiceProviderProfileId = null;
      if (PERSONALIZED_VOICE_MODES.has(track.voice_mode)) {
        const activeVoiceProfile = await db
          .prepare(
            "SELECT id FROM voice_profiles WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
          )
          .get(track.user_id);
        if (!activeVoiceProfile) {
          throw new Error(
            "E302_VOICE_PROFILE_REQUIRED: Active voice profile required for My Voice.",
          );
        }
        const renderRequest =
          parseJson(job?.step_data, {}, "render_request_step_data")
            ?.render_request || {};
        const frozenEngine =
          typeof renderRequest.user_voice_engine === "string"
            ? renderRequest.user_voice_engine
            : null;
        let sunoProviderProfile = null;
        if (
          frozenEngine === "suno_voice_persona" &&
          renderRequest.voice_provider_profile_id
        ) {
          sunoProviderProfile = await getProviderProfileById(
            db,
            renderRequest.voice_provider_profile_id,
          );
          if (
            sunoProviderProfile?.user_id !== track.user_id ||
            sunoProviderProfile?.provider !== "suno" ||
            sunoProviderProfile?.status !== "active"
          ) {
            sunoProviderProfile = null;
          }
        } else {
          sunoProviderProfile = await findActiveProviderProfileForUser(db, {
            userId: track.user_id,
            provider: "suno",
          });
        }
        if (
          (!frozenEngine || frozenEngine === "suno_voice_persona") &&
          sunoProviderProfile &&
          sunoProviderProfile.provider_profile_id &&
          hasPersonaConsentScope(sunoProviderProfile.consent_scope)
        ) {
          userVoiceEngine = "suno_voice_persona";
          voiceProviderProfileId = sunoProviderProfile.id;
        } else {
          if (frozenEngine && frozenEngine !== "suno_voice_persona") {
            throw new Error(
              `E302_PERSONALIZED_VOICE_CONVERSION_DISABLED: My Voice no longer supports '${frozenEngine}' voice conversion. Recreate the render after Suno voice persona is ready.`,
            );
          }
          throw new Error(
            "E302_SUNO_PERSONA_NOT_READY: Active Suno voice persona is required for My Voice renders.",
          );
        }
      }
      const renderContract = buildRenderContract({
        provider: plan.provider_resolved || musicConfig?.provider || null,
        voiceMode: track.voice_mode,
        voiceConversionProvider,
        userVoiceEngine,
        voiceProviderProfileId,
      });
      console.log(
        `[JobRunner] Render contract: track=${track.id} voice_mode=${renderContract.voice_mode} pipeline=${renderContract.pipeline} user_voice_engine=${renderContract.user_voice_engine || "none"} provider_profile=${renderContract.voice_provider_profile_id ? "present" : "none"}`,
      );
      plan.render_contract = renderContract;
      const provenance_json = mergeProvenanceJson(
        trackVersion?.provenance_json || null,
        {
          music: {
            provider: plan.provider_resolved || musicConfig?.provider || null,
            requested_provider: plan.provider_requested || null,
            routing_reason: plan.provider_resolution_reason || null,
            support: plan.provider_support || null,
            support_score: plan.provider_support_score ?? null,
            generation_mode: plan.generation_mode || "composition_plan",
            plan_schema_version: plan.plan_schema_version || null,
            style_prompt_compact: plan.style_prompt_compact || null,
            provider_style_hint: plan.provider_style_hint || null,
            style_intent: plan.style_intent || null,
            render_contract: renderContract,
          },
          timeline: [
            {
              at: nowIso(),
              step: "music_plan",
              event: "music_plan_built",
              provider: plan.provider_resolved || musicConfig?.provider || null,
              style: plan.style,
              generation_mode: plan.generation_mode || "composition_plan",
              voice_mode: renderContract.voice_mode,
              pipeline: renderContract.pipeline,
            },
          ],
        },
      );
      return { music_plan_json: toJson(plan), provenance_json };
    },

    instrumental: async ({ track, trackVersion, job }) => {
      const versionDir = getVersionDir(storageDir, track, trackVersion);
      const instFile = path.join(versionDir, "inst_preview.mp3");

      // Reuse existing file if present (saves API credits)
      if (fs.existsSync(instFile)) {
        console.log(
          `[JobRunner] Reusing existing instrumental: inst_preview.mp3`,
        );
        return {};
      }

      const lyrics = parseJson(
        trackVersion.lyrics_json,
        null,
        "instrumental_lyrics",
      );
      const musicPlan = parseJson(
        trackVersion.music_plan_json,
        null,
        "instrumental_music_plan",
      );
      const renderContract = resolveRenderContract({ track, musicPlan });
      const isPersonalized = renderContract.voice_mode === "user_voice";
      if (isPersonalized) {
        assertFrozenContract(musicPlan);
        assertPersonalizedContract(renderContract, "instrumental");
      }
      if (!lyrics) {
        throw new Error(
          "E302_WORKFLOW_ERROR: lyrics_json is required before instrumental step",
        );
      }

      const pinnedProvider =
        renderContract.provider_locked || musicPlan?.provider_resolved || null;
      const musicConfig = await getMusicProviderConfig({
        requestedStyle: musicPlan?.style || track.style,
        pinnedProvider,
      });
      const routingMetadata = sanitizeProviderRoutingForContract(
        musicConfig?.routing || null,
        renderContract,
      );
      const policyPreflight = musicConfig
        ? sanitizeLyricsForProviderPolicy({
            lyrics,
            provider: musicConfig.provider,
            recipientName: track?.recipient_name || null,
          })
        : null;
      const lyricsForProvider = policyPreflight?.lyrics || lyrics;
      const policyPreflightMeta = policyPreflight
        ? {
            provider: musicConfig.provider,
            changed: Boolean(policyPreflight.changed),
            blocked: Boolean(policyPreflight.blocked),
            rewrite_passes: policyPreflight.rewrite_passes || 0,
            change_count: policyPreflight.change_count || 0,
            violation_terms: summarizePolicyTerms(
              policyPreflight.violations || [],
              8,
            ),
            violation_count: Array.isArray(policyPreflight.violations)
              ? policyPreflight.violations.length
              : 0,
          }
        : null;

      if (policyPreflight?.changed) {
        console.log(
          `[JobRunner] Policy preflight adjusted lyrics for provider=${musicConfig.provider} (${policyPreflight.change_count} edits, passes=${policyPreflight.rewrite_passes})`,
        );
        assertPolicySanitizerPreservedStoryDetails({
          originalLyrics: lyrics,
          sanitizedLyrics: lyricsForProvider,
          storyContext: buildLyricsContext(track),
          provider: musicConfig.provider,
          step: "instrumental",
          trackId: track.id,
        });
        logSanitizerIntervention({
          provider: musicConfig.provider,
          changeCount: policyPreflight.change_count,
          rewritePasses: policyPreflight.rewrite_passes,
          violationTerms: summarizePolicyTerms(
            policyPreflight.violations || [],
            8,
          ),
          style: musicPlan?.style || track.style,
          step: "instrumental",
          trackId: track.id,
        });
      }
      if (policyPreflight?.blocked) {
        logProviderRejection({
          provider: musicConfig.provider,
          errorCode: "E302_PROVIDER_POLICY_ERROR",
          errorStatus: "preflight_blocked",
          rejectedTerms: summarizePolicyTerms(
            policyPreflight.violations || [],
            8,
          ),
          lyricsHash: lyricsHashSha256(trackVersion.lyrics_json),
          style: musicPlan?.style || track.style,
          step: "instrumental",
          trackId: track.id,
        });
        throw buildPolicyPreflightError(policyPreflight);
      }

      if (musicConfig && musicConfig.provider === "suno") {
        const sunoPersona = await resolveSunoPersonaForRender({
          track,
          renderContract,
        });
        try {
          const sunoResult = await pollOrSubmitSunoTask({
            musicConfig,
            job,
            lyrics: lyricsForProvider,
            musicPlan,
            track,
            trackVersion,
            kind: "preview",
            routingMetadata,
            sunoPersona,
          });
          if (sunoResult?.pending) {
            return sunoResult;
          }
          const providerAudioUrl =
            sunoResult?.instrumental_url || sunoResult?.guide_vocal_url || null;
          const providerAudioKey = sunoResult?.provider_audio_key || null;
          const provenance_json = mergeProvenanceJson(
            trackVersion.provenance_json,
            {
              music: {
                ...(parseJson(
                  trackVersion.provenance_json,
                  {},
                  "prov_preview_music_suno",
                )?.music || {}),
                provider: musicConfig.provider,
                routing: routingMetadata,
                render_contract: renderContract,
                provider_audio_url:
                  providerAudioUrl || getProviderAudioUrl(trackVersion),
                provider_audio_key:
                  providerAudioKey || getProviderAudioKey(trackVersion),
                policy_preflight: policyPreflightMeta || null,
              },
              timeline: [
                policyPreflightMeta
                  ? {
                      at: nowIso(),
                      step: "instrumental",
                      event: "policy_preflight_applied",
                      provider: musicConfig.provider,
                      changed: policyPreflightMeta.changed,
                      blocked: policyPreflightMeta.blocked,
                      change_count: policyPreflightMeta.change_count,
                      violation_count: policyPreflightMeta.violation_count,
                    }
                  : null,
                {
                  at: nowIso(),
                  step: "instrumental",
                  event: "music_generated",
                  provider: musicConfig.provider,
                  pipeline: renderContract.pipeline,
                },
              ].filter(Boolean),
            },
          );
          const normalizedSunoResult = {
            ...sunoResult,
            instrumental_url: providerAudioUrl,
            guide_vocal_url:
              renderContract.pipeline === "guide_tts_and_voice_convert"
                ? sunoResult?.guide_vocal_url || null
                : null,
            provider_routing: routingMetadata,
            provenance_json,
          };
          if (policyPreflightMeta) {
            return {
              ...normalizedSunoResult,
              policy_preflight: policyPreflightMeta,
            };
          }
          return normalizedSunoResult;
        } catch (sunoErr) {
          if (
            String(sunoErr?.message || "").includes(
              "E302_SUNO_INCOMPLETE_OUTPUT",
            )
          ) {
            const recoveredResult = await recoverSunoResultFromExistingTask({
              musicConfig,
              job,
              track,
              trackVersion,
              kind: "preview",
              routingMetadata,
              renderContract,
              step: "instrumental",
            });
            if (recoveredResult) {
              console.warn(
                `[JobRunner] Recovered Suno output from existing task for track ${track.id} after incomplete-output error`,
              );
              return recoveredResult;
            }
          }
          throw sunoErr;
        }
      }

      if (musicConfig) {
        const onTaskId = job
          ? async (taskId) => {
              const payload = {
                provider: musicConfig.provider,
                task_id: taskId,
                kind: "preview",
                routing: routingMetadata,
              };
              const stamp = new Date().toISOString();
              await updateJobExternalTask.run(
                taskId,
                toJson(payload),
                stamp,
                stamp,
                job.id,
                runnerId,
              );
            }
          : null;
        const result = await durabilityService.executeWithDurability({
          provider:
            musicConfig.provider === "suno"
              ? PROVIDERS.SUNO
              : PROVIDERS.ELEVENLABS,
          fn: async () =>
            renderWithProvider({
              storageDir,
              track,
              trackVersion,
              kind: "preview",
              providerConfig: musicConfig,
              lyrics: lyricsForProvider,
              musicPlan,
              onTaskId,
              sunoPersona: await resolveSunoPersonaForRender({
                track,
                renderContract,
              }),
              storageProvider,
            }),
        });
        const providerMetadata = result?.raw || {};
        const providerAudioUrl = extractProviderAudioUrl(providerMetadata);
        const providerAudioKey = providerMetadata.provider_audio_key || null;
        const useGuideUrl =
          renderContract.pipeline === "guide_tts_and_voice_convert";
        const provenance_json = mergeProvenanceJson(
          trackVersion.provenance_json,
          {
            music: {
              ...(parseJson(
                trackVersion.provenance_json,
                {},
                "prov_preview_music",
              )?.music || {}),
              provider: musicConfig.provider,
              routing: routingMetadata,
              render_contract: renderContract,
              provider_audio_url:
                providerAudioUrl || getProviderAudioUrl(trackVersion),
              provider_audio_key:
                providerAudioKey || getProviderAudioKey(trackVersion),
              generation_mode:
                providerMetadata.generation_mode ||
                musicPlan?.generation_mode ||
                musicConfig?.runtimeConfig?.elevenlabs_generation_mode ||
                "composition_plan",
              model_id: providerMetadata.model_id || null,
              plan_endpoint: providerMetadata.plan_endpoint || null,
              compose_endpoint: providerMetadata.compose_endpoint || null,
              composition_plan_summary:
                providerMetadata.composition_plan_summary || null,
              response_bytes: providerMetadata.response_bytes || null,
              policy_preflight: policyPreflightMeta || null,
            },
            timeline: [
              policyPreflightMeta
                ? {
                    at: nowIso(),
                    step: "instrumental",
                    event: "policy_preflight_applied",
                    provider: musicConfig.provider,
                    changed: policyPreflightMeta.changed,
                    blocked: policyPreflightMeta.blocked,
                    change_count: policyPreflightMeta.change_count,
                    violation_count: policyPreflightMeta.violation_count,
                  }
                : null,
              {
                at: nowIso(),
                step: "instrumental",
                event: "music_generated",
                provider: musicConfig.provider,
                generation_mode:
                  providerMetadata.generation_mode ||
                  musicPlan?.generation_mode ||
                  musicConfig?.runtimeConfig?.elevenlabs_generation_mode ||
                  "composition_plan",
                pipeline: renderContract.pipeline,
              },
            ].filter(Boolean),
          },
        );
        return {
          instrumental_url:
            providerAudioUrl || result?.raw?.instrumental_url || null,
          guide_vocal_url: useGuideUrl
            ? result?.raw?.guide_vocal_url || null
            : null,
          provider_routing: routingMetadata,
          provenance_json,
        };
      }

      if (isPersonalized) {
        throw new Error(
          "E302_PERSONALIZED_NO_PROVIDER: Personalized render requires a live music provider.",
        );
      }
      renderInstrumental({ storageDir, track, trackVersion, kind: "preview" });
      renderGuideVocal({ storageDir, track, trackVersion, kind: "preview" });
      return {};
    },

    instrumental_full: async ({ track, trackVersion, job }) => {
      const lyrics = parseJson(
        trackVersion.lyrics_json,
        null,
        "instrumental_full_lyrics",
      );
      const musicPlan = parseJson(
        trackVersion.music_plan_json,
        null,
        "instrumental_full_music_plan",
      );
      const renderContract = resolveRenderContract({ track, musicPlan });
      const isPersonalized = renderContract.voice_mode === "user_voice";
      if (isPersonalized) {
        assertFrozenContract(musicPlan);
        assertPersonalizedContract(renderContract, "instrumental_full");
      }
      if (!lyrics) {
        throw new Error(
          "E302_WORKFLOW_ERROR: lyrics_json is required before instrumental_full step",
        );
      }

      const pinnedProvider =
        renderContract.provider_locked || musicPlan?.provider_resolved || null;
      const musicConfig = await getMusicProviderConfig({
        requestedStyle: musicPlan?.style || track.style,
        pinnedProvider,
      });
      const routingMetadata = sanitizeProviderRoutingForContract(
        musicConfig?.routing || null,
        renderContract,
      );
      const policyPreflight = musicConfig
        ? sanitizeLyricsForProviderPolicy({
            lyrics,
            provider: musicConfig.provider,
            recipientName: track?.recipient_name || null,
          })
        : null;
      const lyricsForProvider = policyPreflight?.lyrics || lyrics;
      const policyPreflightMeta = policyPreflight
        ? {
            provider: musicConfig.provider,
            changed: Boolean(policyPreflight.changed),
            blocked: Boolean(policyPreflight.blocked),
            rewrite_passes: policyPreflight.rewrite_passes || 0,
            change_count: policyPreflight.change_count || 0,
            violation_terms: summarizePolicyTerms(
              policyPreflight.violations || [],
              8,
            ),
            violation_count: Array.isArray(policyPreflight.violations)
              ? policyPreflight.violations.length
              : 0,
          }
        : null;

      if (policyPreflight?.changed) {
        console.log(
          `[JobRunner] Policy preflight adjusted lyrics for provider=${musicConfig.provider} (${policyPreflight.change_count} edits, passes=${policyPreflight.rewrite_passes})`,
        );
        assertPolicySanitizerPreservedStoryDetails({
          originalLyrics: lyrics,
          sanitizedLyrics: lyricsForProvider,
          storyContext: buildLyricsContext(track),
          provider: musicConfig.provider,
          step: "instrumental_full",
          trackId: track.id,
        });
        logSanitizerIntervention({
          provider: musicConfig.provider,
          changeCount: policyPreflight.change_count,
          rewritePasses: policyPreflight.rewrite_passes,
          violationTerms: summarizePolicyTerms(
            policyPreflight.violations || [],
            8,
          ),
          style: musicPlan?.style || track.style,
          step: "instrumental_full",
          trackId: track.id,
        });
      }
      if (policyPreflight?.blocked) {
        logProviderRejection({
          provider: musicConfig.provider,
          errorCode: "E302_PROVIDER_POLICY_ERROR",
          errorStatus: "preflight_blocked",
          rejectedTerms: summarizePolicyTerms(
            policyPreflight.violations || [],
            8,
          ),
          lyricsHash: lyricsHashSha256(trackVersion.lyrics_json),
          style: musicPlan?.style || track.style,
          step: "instrumental_full",
          trackId: track.id,
        });
        throw buildPolicyPreflightError(policyPreflight);
      }

      if (musicConfig && musicConfig.provider === "suno") {
        const sunoPersona = await resolveSunoPersonaForRender({
          track,
          renderContract,
        });
        try {
          const sunoResult = await pollOrSubmitSunoTask({
            musicConfig,
            job,
            lyrics: lyricsForProvider,
            musicPlan,
            track,
            trackVersion,
            kind: "full",
            routingMetadata,
            sunoPersona,
          });
          if (sunoResult?.pending) {
            return sunoResult;
          }
          const providerAudioUrl =
            sunoResult?.instrumental_url || sunoResult?.guide_vocal_url || null;
          const providerAudioKey = sunoResult?.provider_audio_key || null;
          const provenance_json = mergeProvenanceJson(
            trackVersion.provenance_json,
            {
              music: {
                ...(parseJson(
                  trackVersion.provenance_json,
                  {},
                  "prov_full_music_suno",
                )?.music || {}),
                provider: musicConfig.provider,
                routing: routingMetadata,
                render_contract: renderContract,
                provider_audio_url:
                  providerAudioUrl || getProviderAudioUrl(trackVersion),
                provider_audio_key:
                  providerAudioKey || getProviderAudioKey(trackVersion),
                policy_preflight: policyPreflightMeta || null,
              },
              timeline: [
                policyPreflightMeta
                  ? {
                      at: nowIso(),
                      step: "instrumental_full",
                      event: "policy_preflight_applied",
                      provider: musicConfig.provider,
                      changed: policyPreflightMeta.changed,
                      blocked: policyPreflightMeta.blocked,
                      change_count: policyPreflightMeta.change_count,
                      violation_count: policyPreflightMeta.violation_count,
                    }
                  : null,
                {
                  at: nowIso(),
                  step: "instrumental_full",
                  event: "music_generated",
                  provider: musicConfig.provider,
                  pipeline: renderContract.pipeline,
                },
              ].filter(Boolean),
            },
          );
          const normalizedSunoResult = {
            ...sunoResult,
            instrumental_url: providerAudioUrl,
            guide_vocal_url:
              renderContract.pipeline === "guide_tts_and_voice_convert"
                ? sunoResult?.guide_vocal_url || null
                : null,
            provider_routing: routingMetadata,
            provenance_json,
          };
          if (policyPreflightMeta) {
            return {
              ...normalizedSunoResult,
              policy_preflight: policyPreflightMeta,
            };
          }
          return normalizedSunoResult;
        } catch (sunoErr) {
          if (
            String(sunoErr?.message || "").includes(
              "E302_SUNO_INCOMPLETE_OUTPUT",
            )
          ) {
            const recoveredResult = await recoverSunoResultFromExistingTask({
              musicConfig,
              job,
              track,
              trackVersion,
              kind: "full",
              routingMetadata,
              renderContract,
              step: "instrumental_full",
            });
            if (recoveredResult) {
              console.warn(
                `[JobRunner] Recovered Suno full output from existing task for track ${track.id} after incomplete-output error`,
              );
              return recoveredResult;
            }
          }
          throw sunoErr;
        }
      }

      if (musicConfig) {
        const onTaskId = job
          ? async (taskId) => {
              const payload = {
                provider: musicConfig.provider,
                task_id: taskId,
                kind: "full",
                routing: routingMetadata,
              };
              const stamp = new Date().toISOString();
              await updateJobExternalTask.run(
                taskId,
                toJson(payload),
                stamp,
                stamp,
                job.id,
                runnerId,
              );
            }
          : null;
        const result = await durabilityService.executeWithDurability({
          provider:
            musicConfig.provider === "suno"
              ? PROVIDERS.SUNO
              : PROVIDERS.ELEVENLABS,
          fn: async () =>
            renderWithProvider({
              storageDir,
              track,
              trackVersion,
              kind: "full",
              providerConfig: musicConfig,
              lyrics: lyricsForProvider,
              musicPlan,
              onTaskId,
              sunoPersona: await resolveSunoPersonaForRender({
                track,
                renderContract,
              }),
              storageProvider,
            }),
        });
        const providerMetadata = result?.raw || {};
        const providerAudioUrl = extractProviderAudioUrl(providerMetadata);
        const providerAudioKey = providerMetadata.provider_audio_key || null;
        const useGuideUrl =
          renderContract.pipeline === "guide_tts_and_voice_convert";
        const provenance_json = mergeProvenanceJson(
          trackVersion.provenance_json,
          {
            music: {
              ...(parseJson(trackVersion.provenance_json, {}, "prov_full_music")
                ?.music || {}),
              provider: musicConfig.provider,
              routing: routingMetadata,
              render_contract: renderContract,
              provider_audio_url:
                providerAudioUrl || getProviderAudioUrl(trackVersion),
              provider_audio_key:
                providerAudioKey || getProviderAudioKey(trackVersion),
              generation_mode:
                providerMetadata.generation_mode ||
                musicPlan?.generation_mode ||
                musicConfig?.runtimeConfig?.elevenlabs_generation_mode ||
                "composition_plan",
              model_id: providerMetadata.model_id || null,
              plan_endpoint: providerMetadata.plan_endpoint || null,
              compose_endpoint: providerMetadata.compose_endpoint || null,
              composition_plan_summary:
                providerMetadata.composition_plan_summary || null,
              response_bytes: providerMetadata.response_bytes || null,
              policy_preflight: policyPreflightMeta || null,
            },
            timeline: [
              policyPreflightMeta
                ? {
                    at: nowIso(),
                    step: "instrumental_full",
                    event: "policy_preflight_applied",
                    provider: musicConfig.provider,
                    changed: policyPreflightMeta.changed,
                    blocked: policyPreflightMeta.blocked,
                    change_count: policyPreflightMeta.change_count,
                    violation_count: policyPreflightMeta.violation_count,
                  }
                : null,
              {
                at: nowIso(),
                step: "instrumental_full",
                event: "music_generated",
                provider: musicConfig.provider,
                generation_mode:
                  providerMetadata.generation_mode ||
                  musicPlan?.generation_mode ||
                  musicConfig?.runtimeConfig?.elevenlabs_generation_mode ||
                  "composition_plan",
                pipeline: renderContract.pipeline,
              },
            ].filter(Boolean),
          },
        );
        return {
          instrumental_url:
            providerAudioUrl || result?.raw?.instrumental_url || null,
          guide_vocal_url: useGuideUrl
            ? result?.raw?.guide_vocal_url || null
            : null,
          provider_routing: routingMetadata,
          provenance_json,
        };
      }

      if (isPersonalized) {
        throw new Error(
          "E302_PERSONALIZED_NO_PROVIDER: Personalized render requires a live music provider.",
        );
      }
      renderInstrumental({ storageDir, track, trackVersion, kind: "full" });
      renderGuideVocal({ storageDir, track, trackVersion, kind: "full" });
      return {};
    },

    guide_vocal: async ({ track, trackVersion }) => {
      const musicPlan = parseJson(
        trackVersion.music_plan_json,
        null,
        "guide_vocal_music_plan",
      );
      const renderContract = resolveRenderContract({ track, musicPlan });
      const isPersonalized = renderContract.voice_mode === "user_voice";
      if (isPersonalized) {
        assertFrozenContract(musicPlan);
        assertPersonalizedContract(renderContract, "guide_vocal");
      }
      if (shouldSkipStep("guide_vocal", renderContract.pipeline)) {
        console.log(
          `[JobRunner] Skipping guide_vocal for track ${track.id}: pipeline=${renderContract.pipeline}`,
        );
        return {};
      }

      const versionDir = getVersionDir(storageDir, track, trackVersion);
      ensureDir(versionDir);
      const token =
        trackVersion.guide_access_token ||
        crypto.randomBytes(16).toString("hex");
      const guideUrl = `${streamBaseUrl}/guide/${trackVersion.id}?token=${token}`;
      const fileName = "guide_vocal.mp3";
      const filePath = path.join(versionDir, fileName);

      // Reuse existing file if present (saves API credits)
      if (fs.existsSync(filePath)) {
        console.log(`[JobRunner] Reusing existing guide vocal: ${fileName}`);
        return {
          guide_vocal_url: guideUrl,
          guide_access_token: token,
        };
      }

      // TTS is always via ElevenLabs (Suno doesn't do TTS)
      const musicConfig = await getMusicProviderConfig({
        requestedStyle: musicPlan?.style || track.style,
        pinnedProvider:
          renderContract.provider_locked ||
          musicPlan?.provider_resolved ||
          null,
      });
      const hasTtsConfig =
        providerConfig.elevenlabs?.ttsVoiceId &&
        providerConfig.elevenlabs?.apiKey;
      if (musicConfig && hasTtsConfig) {
        const lyrics = parseJson(
          trackVersion.lyrics_json,
          null,
          "guide_vocal_lyrics",
        );
        // For preview, only use chorus section to reduce TTS API costs
        const text = lyricsToText(lyrics, { chorusOnly: true });
        if (!text) {
          throw new Error(
            "E301_GUIDE_VOCAL_MISSING: Lyrics unavailable for guide vocal",
          );
        }
        console.log(
          `[JobRunner] Generating TTS guide vocal (chorus only) for track ${track.id}`,
        );
        await durabilityService.executeWithDurability({
          provider: PROVIDERS.ELEVENLABS,
          fn: () =>
            generateSpeech({
              baseUrl: providerConfig.elevenlabs.baseUrl,
              apiKey: providerConfig.elevenlabs.apiKey,
              voiceId: providerConfig.elevenlabs.ttsVoiceId,
              text: text,
              outputPath: filePath,
              timeoutMs: providerConfig.elevenlabs.timeoutMs,
            }),
        });
        return {
          guide_vocal_url: guideUrl,
          guide_access_token: token,
        };
      }

      if (isPersonalized) {
        throw new Error(
          "E302_PERSONALIZED_NO_TTS: Personalized ElevenLabs render requires TTS config for guide vocal.",
        );
      }
      console.log(
        `[JobRunner] Using placeholder guide vocal for track ${track.id} (no live provider)`,
      );
      const wavPath = path.join(versionDir, "guide_vocal.wav");
      if (!fs.existsSync(wavPath)) {
        writeWav(wavPath, { durationSec: 6, frequencyHz: 440 });
      }
      return {
        guide_vocal_url: guideUrl,
        guide_access_token: token,
      };
    },
    guide_vocal_full: async ({ track, trackVersion }) => {
      const musicPlan = parseJson(
        trackVersion.music_plan_json,
        null,
        "guide_vocal_full_music_plan",
      );
      const renderContract = resolveRenderContract({ track, musicPlan });
      const isPersonalized = renderContract.voice_mode === "user_voice";
      if (isPersonalized) {
        assertFrozenContract(musicPlan);
        assertPersonalizedContract(renderContract, "guide_vocal_full");
      }
      if (shouldSkipStep("guide_vocal_full", renderContract.pipeline)) {
        console.log(
          `[JobRunner] Skipping guide_vocal_full for track ${track.id}: pipeline=${renderContract.pipeline}`,
        );
        return {};
      }

      const versionDir = getVersionDir(storageDir, track, trackVersion);
      ensureDir(versionDir);
      const token =
        trackVersion.guide_access_token ||
        crypto.randomBytes(16).toString("hex");
      const guideUrl = `${streamBaseUrl}/guide/${trackVersion.id}?token=${token}&kind=full`;

      // TTS is always via ElevenLabs (Suno doesn't do TTS)
      const musicConfig = await getMusicProviderConfig({
        requestedStyle: musicPlan?.style || track.style,
        pinnedProvider:
          renderContract.provider_locked ||
          musicPlan?.provider_resolved ||
          null,
      });
      const hasTtsConfig =
        providerConfig.elevenlabs?.ttsVoiceId &&
        providerConfig.elevenlabs?.apiKey;
      if (musicConfig && hasTtsConfig) {
        const lyrics = parseJson(
          trackVersion.lyrics_json,
          null,
          "guide_vocal_full_lyrics",
        );
        const text = lyricsToText(lyrics);
        if (!text) {
          throw new Error(
            "E301_GUIDE_VOCAL_MISSING: Lyrics unavailable for guide vocal",
          );
        }
        console.log(
          `[JobRunner] Generating TTS full guide vocal for track ${track.id}`,
        );
        const fileName = "guide_vocal_full.mp3";
        const filePath = path.join(versionDir, fileName);
        await durabilityService.executeWithDurability({
          provider: PROVIDERS.ELEVENLABS,
          fn: () =>
            generateSpeech({
              baseUrl: providerConfig.elevenlabs.baseUrl,
              apiKey: providerConfig.elevenlabs.apiKey,
              voiceId: providerConfig.elevenlabs.ttsVoiceId,
              text: text,
              outputPath: filePath,
              timeoutMs: providerConfig.elevenlabs.timeoutMs,
            }),
        });
        return {
          guide_vocal_url: guideUrl,
          guide_access_token: token,
        };
      }

      if (isPersonalized) {
        throw new Error(
          "E302_PERSONALIZED_NO_TTS: Personalized ElevenLabs render requires TTS config for guide vocal.",
        );
      }
      const wavPath = path.join(versionDir, "guide_vocal_full.wav");
      if (!fs.existsSync(wavPath)) {
        writeWav(wavPath, { durationSec: 12, frequencyHz: 440 });
      }
      return {
        guide_vocal_url: guideUrl,
        guide_access_token: token,
      };
    },

    voice_convert: async ({ track, trackVersion }) => {
      const versionDir = getVersionDir(storageDir, track, trackVersion);
      const outputFile = path.join(versionDir, "user_vocal.wav");

      // Reuse existing file if present (saves API credits)
      if (fs.existsSync(outputFile)) {
        console.log(
          `[JobRunner] Reusing existing voice conversion: user_vocal.wav`,
        );
        return { voice_conversion_url: null };
      }

      const musicPlan = parseJson(
        trackVersion.music_plan_json,
        null,
        "voice_convert_music_plan",
      );
      const renderContract = resolveRenderContract({ track, musicPlan });
      const isPersonalized = renderContract.voice_mode === "user_voice";
      if (isPersonalized) {
        assertFrozenContract(musicPlan);
        assertPersonalizedContract(renderContract, "voice_convert");
      }
      if (shouldSkipStep("voice_convert", renderContract.pipeline)) {
        console.log(
          `[JobRunner] Skipping voice_convert for track ${track.id}: pipeline=${renderContract.pipeline}`,
        );
        return {};
      }
      const guideUrl = trackVersion.guide_vocal_url;
      const providerAudioUrl = getProviderAudioUrl(trackVersion);
      const conversionSourceUrl =
        renderContract.pipeline === "provider_audio_personalized_convert"
          ? providerAudioUrl
          : guideUrl;

      // AI voice (non-personalized): use guide vocal for voice conversion
      if (!isPersonalized) {
        if (providerConfig.replicate?.live && guideUrl) {
          const result = await durabilityService.executeWithDurability({
            provider: PROVIDERS.REPLICATE,
            fn: () =>
              convertVoice({
                storageDir,
                track,
                trackVersion,
                kind: "preview",
                providerConfig: providerConfig.replicate,
                inputUrl: guideUrl,
              }),
          });
          return {
            voice_conversion_url: result?.output_url || guideUrl || null,
          };
        }
        const ensured = await ensureUserVocalFromGuide({
          versionDir,
          kind: "preview",
        });
        if (!ensured) {
          throw new Error(
            "E301_GUIDE_VOCAL_MISSING: guide vocal required for AI voice conversion",
          );
        }
        return { voice_conversion_url: guideUrl || null };
      }

      // Personalized mode requires source audio for voice conversion
      if (!conversionSourceUrl) {
        throw new Error(
          `E301_VOICE_CONVERT_MISSING_INPUT: ${
            renderContract.pipeline === "provider_audio_personalized_convert"
              ? "Provider audio URL"
              : "Guide vocal URL"
          } required for voice conversion`,
        );
      }

      const result = await performVoiceConversion({
        db,
        track,
        trackVersion,
        kind: "preview",
        versionDir,
        conversionSourceUrl,
        providerConfig,
        durabilityService,
        storageDir,
        storageProvider,
        renderContract,
      });

      await applyVocalPolish({ db, outputFile, versionDir, kind: "preview" });

      return { voice_conversion_url: result?.output_url || null };
    },

    voice_convert_sections: async ({ track, trackVersion }) => {
      const versionDir = getVersionDir(storageDir, track, trackVersion);
      const outputFile = path.join(versionDir, "user_vocal_full.wav");

      // Reuse existing file if present (saves API credits)
      if (fs.existsSync(outputFile)) {
        console.log(
          `[JobRunner] Reusing existing voice conversion: user_vocal_full.wav`,
        );
        return { voice_conversion_url: null };
      }

      const musicPlan = parseJson(
        trackVersion.music_plan_json,
        null,
        "voice_convert_sections_music_plan",
      );
      const renderContract = resolveRenderContract({ track, musicPlan });
      const isPersonalized = renderContract.voice_mode === "user_voice";
      if (isPersonalized) {
        assertFrozenContract(musicPlan);
        assertPersonalizedContract(renderContract, "voice_convert_sections");
      }
      if (shouldSkipStep("voice_convert_sections", renderContract.pipeline)) {
        console.log(
          `[JobRunner] Skipping voice_convert_sections for track ${track.id}: pipeline=${renderContract.pipeline}`,
        );
        return {};
      }
      const guideUrl = trackVersion.guide_vocal_url;
      const providerAudioUrl = getProviderAudioUrl(trackVersion);
      const conversionSourceUrl =
        renderContract.pipeline === "provider_audio_personalized_convert"
          ? providerAudioUrl
          : guideUrl;

      // AI voice (non-personalized): use guide vocal for voice conversion
      if (!isPersonalized) {
        if (providerConfig.replicate?.live && guideUrl) {
          const result = await durabilityService.executeWithDurability({
            provider: PROVIDERS.REPLICATE,
            fn: () =>
              convertVoice({
                storageDir,
                track,
                trackVersion,
                kind: "full",
                providerConfig: providerConfig.replicate,
                inputUrl: guideUrl,
              }),
          });
          return {
            voice_conversion_url: result?.output_url || guideUrl || null,
          };
        }
        const ensured = await ensureUserVocalFromGuide({
          versionDir,
          kind: "full",
        });
        if (!ensured) {
          throw new Error(
            "E301_GUIDE_VOCAL_MISSING: guide vocal required for AI voice conversion",
          );
        }
        return { voice_conversion_url: guideUrl || null };
      }

      // Personalized mode requires source audio for voice conversion
      if (!conversionSourceUrl) {
        throw new Error(
          `E301_VOICE_CONVERT_MISSING_INPUT: ${
            renderContract.pipeline === "provider_audio_personalized_convert"
              ? "Provider audio URL"
              : "Guide vocal URL"
          } required for voice conversion`,
        );
      }

      const result = await performVoiceConversion({
        db,
        track,
        trackVersion,
        kind: "full",
        versionDir,
        conversionSourceUrl,
        providerConfig,
        durabilityService,
        storageDir,
        storageProvider,
        renderContract,
      });

      await applyVocalPolish({ db, outputFile, versionDir, kind: "full" });

      return { voice_conversion_url: result?.output_url || null };
    },

    mix: async ({ track, trackVersion, workflow }) => {
      const versionDir = getVersionDir(storageDir, track, trackVersion);
      ensureDir(versionDir);

      const isFull = workflow === "full_render";
      const vocalFileName = isFull ? "user_vocal_full.wav" : "user_vocal.wav";
      const vocalPath = path.join(versionDir, vocalFileName);
      const mixPath = path.join(versionDir, "mix.wav");

      const musicPlan = parseJson(
        trackVersion.music_plan_json,
        null,
        "mix_music_plan",
      );
      const renderContract = resolveRenderContract({ track, musicPlan });
      const isPersonalized = renderContract.voice_mode === "user_voice";
      if (isPersonalized) {
        assertFrozenContract(musicPlan);
        assertPersonalizedContract(renderContract, "mix");
      }
      const musicConfig = await getMusicProviderConfig({
        requestedStyle: musicPlan?.style || track.style,
        pinnedProvider:
          renderContract.provider_locked ||
          musicPlan?.provider_resolved ||
          null,
      });
      const providerAudioUrl = getProviderAudioUrl(trackVersion);
      const providerAudioKey = getProviderAudioKey(trackVersion);

      if (isProviderCompleteAudioPipeline(renderContract.pipeline)) {
        const providerLocalPath = path.join(
          versionDir,
          `${renderContract.provider_locked}_complete.mp3`,
        );
        await hydrateProviderCompleteAudio({
          providerLocalPath,
          providerAudioKey,
          providerAudioUrl,
          storageProvider,
        });
        const providerFallbackPaths = [
          path.join(versionDir, isFull ? "inst_full.mp3" : "inst_preview.mp3"),
          path.join(versionDir, isFull ? "inst_full.wav" : "inst_preview.wav"),
        ];
        const sourcePath = fs.existsSync(providerLocalPath)
          ? providerLocalPath
          : providerFallbackPaths.find((candidatePath) =>
              fs.existsSync(candidatePath),
            ) || null;
        if (!sourcePath) {
          throw new Error(
            `E301_MISSING_INPUTS: Provider-complete audio missing for ${isPersonalized ? "user voice" : "AI voice"} mix`,
          );
        }
        await runFFmpeg([
          "-y",
          "-i",
          sourcePath,
          "-ar",
          "44100",
          "-ac",
          "2",
          mixPath,
        ]);
        console.log(
          `[Mix] ${isPersonalized ? "User voice persona" : "AI voice"}: using provider-complete audio directly (provider=${renderContract.provider_locked})`,
        );
        return {};
      }

      if (!isPersonalized && !fs.existsSync(vocalPath)) {
        const ensured = await ensureUserVocalFromGuide({
          versionDir,
          kind: isFull ? "full" : "preview",
        });
        if (ensured) {
          console.log(
            `[Mix] AI voice: built missing vocal from guide for track ${track.id}`,
          );
        }
      }

      const instBaseName = isFull ? "inst_full" : "inst_preview";

      // Personalized Suno: Demucs instrumental is REQUIRED (no silent fallback)
      if (
        isPersonalized &&
        renderContract.provider_locked === "suno" &&
        fs.existsSync(vocalPath)
      ) {
        const separatedInstPath = path.join(
          versionDir,
          "stems",
          "instrumental.wav",
        );
        if (!fs.existsSync(separatedInstPath)) {
          throw new Error(
            "E301_MISSING_STEMS: Demucs stem separation required for personalized Suno voice. " +
              "Voice conversion produces vocals-only; instrumental stems must exist.",
          );
        }

        // Timbre blending: mix original AI vocals with converted vocals before final mix
        // Batch-fetch all blend flags in one query to avoid N+1
        const blendFlags = await getFeatureFlags(db, [
          "timbre_blend_ratio",
          "timbre_blend_strategy",
          "spectral_crossover_low_hz",
          "spectral_crossover_high_hz",
          "spectral_mid_blend_ratio",
          "doubling_level",
          "doubling_presence_cut_freq",
          "doubling_presence_cut_gain",
          "formant_transfer_strength",
          "formant_max_gain_db",
          "perceptual_ai_influence",
          "perceptual_ducking_strength",
          "perceptual_attack_ms",
          "perceptual_release_ms",
        ]);
        const blendRatio = blendFlags["timbre_blend_ratio"] ?? 0.25;
        const blendStrategy =
          blendFlags["timbre_blend_strategy"] ?? "amplitude";
        const originalVocalsPath = path.join(versionDir, "stems", "vocals.wav");
        let finalVocalPath = vocalPath;

        if (blendRatio < 1.0 && fs.existsSync(originalVocalsPath)) {
          const blendedPath = path.join(versionDir, "blended_vocal.wav");

          // Map strategy names to their flag-sourced params
          const strategyParamsMap = {
            spectral_crossover: {
              lowCrossover: blendFlags["spectral_crossover_low_hz"] ?? 300,
              highCrossover: blendFlags["spectral_crossover_high_hz"] ?? 3000,
              midBlendRatio: blendFlags["spectral_mid_blend_ratio"] ?? 0.3,
            },
            vocal_doubling: {
              doublingLevel: blendFlags["doubling_level"] ?? 0.12,
              presenceCutFreq: blendFlags["doubling_presence_cut_freq"] ?? 4000,
              presenceCutGain: blendFlags["doubling_presence_cut_gain"] ?? -8,
            },
            formant_transfer: {
              transferStrength: blendFlags["formant_transfer_strength"] ?? 0.5,
              maxGainDb: blendFlags["formant_max_gain_db"] ?? 12,
            },
            perceptual_primary: {
              aiInfluence: blendFlags["perceptual_ai_influence"] ?? 0.15,
              duckingStrength:
                blendFlags["perceptual_ducking_strength"] ?? 0.85,
              attackMs: blendFlags["perceptual_attack_ms"] ?? 10,
              releaseMs: blendFlags["perceptual_release_ms"] ?? 150,
            },
          };
          const strategyParams = strategyParamsMap[blendStrategy] || {};

          console.log(
            `[Mix] Timbre blending: strategy=${blendStrategy}, blend=${blendRatio}, params=${JSON.stringify(strategyParams)}`,
          );
          try {
            await blendVocals({
              originalVocalPath: originalVocalsPath,
              convertedVocalPath: vocalPath,
              outputPath: blendedPath,
              blendRatio,
              strategy: blendStrategy,
              strategyParams,
            });
            finalVocalPath = blendedPath;
          } catch (blendErr) {
            console.error(
              `[Mix] Timbre blend (${blendStrategy}) failed, falling back to 100% converted:`,
              blendErr,
            );
          }
        } else if (blendRatio < 1.0) {
          console.warn(
            `[Mix] Timbre blend requested but stems/vocals.wav missing — using 100% converted`,
          );
        }

        console.log(
          `[Mix] Personalized voice: mixing ${blendRatio < 1.0 ? "blended" : "converted"} vocals with Demucs instrumental`,
        );
        await mixTracksPersonalized({
          vocalPath: finalVocalPath,
          instrumentalPath: separatedInstPath,
          outputPath: mixPath,
          vocalGain: 1.0,
          instrumentalGain: 0.62,
        });
        return {};
      }

      // Standard path: find instrumental in order of preference
      let instPath = path.join(versionDir, "stems", "instrumental.wav");
      if (!fs.existsSync(instPath)) {
        instPath = path.join(versionDir, `${instBaseName}.mp3`);
      }
      if (!fs.existsSync(instPath)) {
        instPath = path.join(versionDir, `${instBaseName}.wav`);
      }

      if (fs.existsSync(vocalPath) && fs.existsSync(instPath)) {
        if (isPersonalized) {
          await mixTracksPersonalized({
            vocalPath,
            instrumentalPath: instPath,
            outputPath: mixPath,
            vocalGain: 0.95,
            instrumentalGain: 0.62,
          });
        } else {
          // Standard mixing: separate vocal + instrumental tracks
          await mixTracks({
            vocalPath,
            instrumentalPath: instPath,
            outputPath: mixPath,
            vocalGain: 0.85,
            instrumentalGain: 0.65,
          });
        }
      } else {
        const requireRealAudio = musicConfig || providerConfig.replicate?.live;
        if (requireRealAudio) {
          throw new Error(
            "E301_MISSING_INPUTS: Vocal or instrumental missing for mix",
          );
        }
        writeWav(mixPath, { durationSec: isFull ? 12 : 6, frequencyHz: 260 });
      }

      return {};
    },

    watermark: async ({ track, trackVersion, workflow }) => {
      const versionDir = getVersionDir(storageDir, track, trackVersion);
      ensureDir(versionDir);

      const isFull = workflow === "full_render";
      const musicPlan = parseJson(
        trackVersion.music_plan_json,
        null,
        "watermark_music_plan",
      );
      const musicConfig = await getMusicProviderConfig({
        requestedStyle: musicPlan?.style || track.style,
        pinnedProvider: musicPlan?.provider_resolved || null,
      });
      const mixPath = path.join(versionDir, "mix.wav");
      const watermarkedPath = path.join(versionDir, "watermarked.wav");
      const outputFileName = isFull ? "full.m4a" : "preview.m4a";
      const outputPath = path.join(versionDir, outputFileName);

      if (fs.existsSync(mixPath)) {
        await embedWatermark(mixPath, watermarkedPath, trackVersion.id);
        await encodeToAAC(watermarkedPath, outputPath, "128k");

        const hlsDir = path.join(versionDir, "hls");
        try {
          await createHLSPlaylist(outputPath, hlsDir, 4);
        } catch (err) {
          console.error(
            `[JobRunner] HLS playlist creation failed for track ${track.id}:`,
            err.message,
          );
          // HLS is optional - streaming may be unavailable but download will work
        }
      } else {
        const requireRealAudio = musicConfig || providerConfig.replicate?.live;
        if (requireRealAudio) {
          throw new Error("E301_MISSING_INPUTS: Mix missing for watermark");
        }
        writeWav(outputPath, {
          durationSec: isFull ? 12 : 6,
          frequencyHz: 280,
        });
      }

      // SVC-10: Clean up intermediate files after successful watermark
      try {
        const intermediateMixPath = path.join(versionDir, "mix.wav");
        if (fs.existsSync(intermediateMixPath))
          fs.unlinkSync(intermediateMixPath);
      } catch (e) {
        /* best-effort cleanup — preserve on failure for retry */
      }
      try {
        if (fs.existsSync(watermarkedPath)) fs.unlinkSync(watermarkedPath);
      } catch (e) {
        /* best-effort cleanup */
      }

      return {};
    },

    ready: async ({ track, trackVersion, workflow }) => {
      const runtimeConfig = await getRuntimeMusicRoutingConfig();
      const qualityThreshold = clampNumber(
        runtimeConfig.quality_threshold,
        0,
        100,
        72,
      );
      const maxRerolls = Math.max(
        0,
        Math.min(3, Number(runtimeConfig.max_rerolls ?? 1) || 0),
      );
      const rerollEnabled = runtimeConfig.auto_reroll_enabled !== false;
      const musicPlan = parseJson(
        trackVersion.music_plan_json,
        null,
        "ready_music_plan",
      );
      const provenanceState = parseJson(
        trackVersion.provenance_json,
        {},
        "ready_provenance",
      );
      const rerollCount = Number(provenanceState?.quality?.reroll_count || 0);
      const liveMusicProviderAvailable =
        Boolean(providerConfig?.elevenlabs?.live) ||
        Boolean(providerConfig?.suno?.live);

      if (!liveMusicProviderAvailable) {
        const skippedQuality = {
          passed: true,
          skipped: true,
          reason: "live_music_provider_unavailable",
          threshold: qualityThreshold,
          total_score: 100,
        };
        const provenance_json = mergeProvenanceJson(
          trackVersion.provenance_json,
          {
            quality: {
              threshold: qualityThreshold,
              last_evaluation: skippedQuality,
              reroll_count: rerollCount,
            },
            timeline: [
              {
                at: nowIso(),
                step: "ready",
                event: "quality_gate_skipped",
              },
            ],
          },
        );
        return { provenance_json, quality_gate: skippedQuality };
      }

      const qualityReport = await evaluateRenderQuality({
        track,
        trackVersion,
        workflowType: workflow,
        musicPlan,
        qualityThreshold,
      });

      const provenance_json = mergeProvenanceJson(
        trackVersion.provenance_json,
        {
          quality: {
            threshold: qualityThreshold,
            last_evaluation: qualityReport,
            reroll_count: qualityReport.passed
              ? rerollCount
              : rerollEnabled && rerollCount < maxRerolls
                ? rerollCount + 1
                : rerollCount,
          },
          timeline: [
            {
              at: nowIso(),
              step: "ready",
              event: qualityReport.passed
                ? "quality_gate_passed"
                : "quality_gate_failed",
              score: qualityReport.total_score,
              threshold: qualityThreshold,
              reroll_count: rerollCount,
            },
          ],
        },
      );

      if (qualityReport.passed) {
        return {
          provenance_json,
          quality_gate: qualityReport,
        };
      }

      if (rerollEnabled && rerollCount < maxRerolls) {
        const tightenedPlan = tightenMusicPlanForReroll(
          musicPlan,
          qualityReport,
        );
        return {
          reroll_requested: true,
          reroll_count: rerollCount + 1,
          reroll_reason: qualityReport.summary,
          music_plan_json: tightenedPlan ? toJson(tightenedPlan) : null,
          quality_gate: qualityReport,
          provenance_json,
        };
      }

      throw new Error(`E302_QUALITY_GATE_FAILED: ${qualityReport.summary}`);
    },
  };

  // Concurrent job processing configuration
  const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_JOBS || "3", 10);
  const MAX_CONCURRENT_PER_USER = parseInt(
    process.env.MAX_CONCURRENT_PER_USER || "1",
    10,
  );
  let activeJobs = 0;
  const processingJobs = new Set();

  // Shared helper: advance job to next step or mark completed
  async function advanceToNextStep({
    job,
    steps,
    stepIndex,
    stepData,
    now,
    runnerId,
  }) {
    const nextIndex = stepIndex + 1;
    const nextStep = steps[nextIndex] || null;
    const nextPct = computeProgress(nextIndex, steps.length);
    if (nextStep) {
      await updateJob.run(
        "queued",
        nextStep,
        nextIndex,
        stepData ? toJson(stepData) : null,
        nextPct,
        now,
        now,
        job.id,
        runnerId,
      );
    } else {
      await updateJobStatus.run("completed", 100, now, now, job.id, runnerId);
    }
  }

  // Extract job processing logic into separate async function
  const processJob = async (job) => {
    const now = new Date().toISOString();
    console.log(
      `[JobRunner] Processing job ${job.id}: type=${job.workflow_type}, step=${job.step}, step_index=${job.step_index}`,
    );
    const steps =
      job.workflow_type === "full_render" ? FULL_STEPS : PREVIEW_STEPS;
    const stepIndex = job.step_index || 0;
    const progressPct = computeProgress(stepIndex, steps.length);
    const claim = await claimJob.run(
      runnerId,
      now,
      now,
      now,
      progressPct,
      now,
      job.id,
      now,
    );
    if (claim.changes === 0) {
      return;
    }
    job.status = "running";
    const stepName = steps[stepIndex];
    if (!stepName) {
      const terminalUpdate = await updateJobStatus.run(
        "completed",
        100,
        now,
        now,
        job.id,
        runnerId,
      );
      if (!terminalUpdate || terminalUpdate.changes === 0) {
        console.warn(
          `[JobRunner] Could not complete terminal job ${job.id}; lock ownership lost`,
        );
      }
      return;
    }
    const stepUpdate = await updateJobStep.run(
      stepName,
      stepIndex,
      progressPct,
      now,
      now,
      job.id,
      runnerId,
    );
    if (stepUpdate.changes === 0) {
      console.warn(
        `[JobRunner] Lost ownership of job ${job.id} during step update, skipping`,
      );
      return;
    }
    const trackVersion = await getTrackVersion.get(job.track_version_id);
    const track = trackVersion
      ? await getTrack.get(trackVersion.track_id)
      : null;

    // Fail job if track or trackVersion was deleted during processing
    if (!track || !trackVersion) {
      console.error(
        `[JobRunner] Job ${job.id} failed: track or trackVersion not found (may have been deleted)`,
      );
      await updateJobFailure.run(
        "failed",
        stepName,
        stepIndex,
        "E404_RESOURCE_DELETED",
        "Track or track version was deleted during processing",
        100,
        now,
        now,
        job.id,
        runnerId,
      );
      return;
    }

    // Emit render_start once per job when first claimed
    if (
      eventsService &&
      (job.workflow_type === "preview_render" ||
        job.workflow_type === "full_render") &&
      !job.started_at
    ) {
      try {
        eventsService.emit("render_start", {
          userId: track.user_id,
          resourceType: "track_version",
          resourceId: trackVersion.id,
          metadata: {
            track_id: track.id,
            render_type:
              job.workflow_type === "full_render" ? "full" : "preview",
          },
        });
      } catch (eventErr) {
        console.warn(
          `[JobRunner] Failed to emit render_start for job ${job.id}:`,
          eventErr.message,
        );
      }
    }

    // Parse step_data once for both circuit breaker parking and memoization
    const parsedStepData = parseJson(job.step_data, {}, "step_data_parse");

    // Phase 4: Circuit breaker parking — park job if all providers for this step are open
    const stepProviders = getStepProviders(stepName);
    if (
      stepProviders.length > 0 &&
      stepProviders.every((p) => circuitBreaker.isOpen(p))
    ) {
      const parkCount = parsedStepData.circuit_park_count || 0;

      if (parkCount >= MAX_CIRCUIT_PARKS) {
        console.error(
          `[JobRunner] Job ${job.id} exceeded max circuit breaker parks (${parkCount}), failing to DLQ`,
        );
        await updateJobFailure.run(
          "failed",
          stepName,
          stepIndex,
          "S503_PROVIDER_UNAVAILABLE",
          `All providers unavailable after ${parkCount} circuit breaker parks`,
          progressPct,
          now,
          now,
          job.id,
          runnerId,
        );
        try {
          const dlq = getDLQService();
          await dlq.moveToDeadLetter({
            jobId: job.id,
            reason: `Provider unavailable after ${parkCount} parks`,
          });
        } catch (dlqErr) {
          console.error(
            `[JobRunner] Failed to move job ${job.id} to DLQ:`,
            dlqErr.message,
          );
        }
        return;
      }

      const cooldownMs = Math.max(
        5000,
        Number(durabilityConfig.cooldownMs) || 30000,
      );
      const nextAttemptAt = new Date(Date.now() + cooldownMs).toISOString();
      const updatedStepData = toJson({
        ...parsedStepData,
        circuit_park_count: parkCount + 1,
      });
      console.warn(
        `[JobRunner] All providers circuit-open for ${stepName}, parking job ${job.id} (park ${parkCount + 1}/${MAX_CIRCUIT_PARKS})`,
      );
      await updateJobPending.run(
        "queued",
        stepName,
        stepIndex,
        updatedStepData,
        progressPct,
        now,
        nextAttemptAt,
        now,
        job.id,
        runnerId,
      );
      return;
    }

    // Phase 1: Step memoization — skip already-completed steps on retry
    const memo = STEP_MEMO_FIELDS[stepName];
    const isReroll = parsedStepData.reroll_count > 0;

    if (memo && !isReroll && trackVersion[memo.field]) {
      const skipAllowed =
        !memo.skipValue || trackVersion[memo.field] === memo.skipValue;

      if (skipAllowed) {
        let fileOk = true;
        if (memo.localFile) {
          const versionDir = getVersionDir(storageDir, track, trackVersion);
          fileOk = fs.existsSync(path.join(versionDir, memo.localFile));
          if (!fileOk) {
            console.warn(
              `[JobRunner] Memoized file missing for step "${stepName}" (${memo.localFile}), re-executing`,
            );
          }
        }

        if (fileOk) {
          console.log(
            `[JobRunner] Skipping memoized step "${stepName}" for job ${job.id} (${memo.field} exists)`,
          );
          try {
            await insertStepHistory.run(
              generatePrefixedId("sh"),
              job.id,
              stepName,
              0,
              "skipped",
              now,
              now,
              0,
            );
          } catch (_) {
            /* best-effort */
          }
          await advanceToNextStep({
            job,
            steps,
            stepIndex,
            stepData: null,
            now,
            runnerId,
          });
          return;
        }
      }
    }

    // Phase 2: File-dependency safety check — detect missing intermediate files
    // after container restarts. Steps like watermark/ready depend on files produced
    // by prior steps (mix.wav, full.m4a). If those files are gone (deploy wiped
    // ephemeral storage), reset to the earliest step that can regenerate them.
    const isFullRender = job.workflow_type === "full_render";
    const FILE_DEPS = {
      watermark: ["mix.wav"],
      ready: [isFullRender ? "full.m4a" : "preview.m4a"],
    };
    const requiredFiles = FILE_DEPS[stepName];
    if (requiredFiles && track && trackVersion) {
      const versionDir = getVersionDir(storageDir, track, trackVersion);
      const missing = requiredFiles.filter(
        (f) => !fs.existsSync(path.join(versionDir, f)),
      );
      if (missing.length > 0) {
        // Find the earliest non-memoizable step that produces the missing file
        const resetStep = stepName === "ready" ? "watermark" : "mix";
        const resetIndex = steps.indexOf(resetStep);
        if (resetIndex >= 0 && resetIndex < stepIndex) {
          console.warn(
            `[JobRunner] Missing intermediate files for step "${stepName}": [${missing.join(", ")}]. ` +
              `Resetting job ${job.id} to step "${resetStep}" (container restart recovery).`,
          );
          await updateJobPending.run(
            "queued",
            resetStep,
            resetIndex,
            null,
            progressPct,
            now,
            null,
            now,
            job.id,
            runnerId,
          );
          return;
        }
      }
    }

    let stepData = null;
    let isPending = false;
    if (track && trackVersion) {
      const handler = stepHandlers[stepName];
      if (handler) {
        const stepHistoryId = generatePrefixedId("sh");
        const stepStartMs = Date.now();
        try {
          await insertStepHistory.run(
            stepHistoryId,
            job.id,
            stepName,
            (job.attempts || 0) + 1,
            "running",
            now,
            null,
            null,
          );
        } catch (_) {
          /* best-effort */
        }
        try {
          const updates = await handler({
            track,
            trackVersion,
            workflow: job.workflow_type,
            job,
          });
          isPending = Boolean(updates && updates.pending);
          if (!isPending && updates && Object.keys(updates).length) {
            await updateTrackVersion.run(
              trackVersion.status,
              trackVersion.completed_at,
              null,
              null,
              updates.lyrics_json || null,
              updates.lyrics_status || null,
              updates.lyrics_updated_at || null,
              updates.lyrics_approved_at || null,
              updates.music_plan_json || null,
              updates.moderation_status || null,
              updates.moderation_reason || null,
              updates.instrumental_url || null,
              updates.guide_vocal_url || null,
              updates.guide_access_token || null,
              updates.voice_conversion_url || null,
              updates.provenance_json || null,
              trackVersion.id,
            );
          }
          stepData = updates || null;
          if (job?.id && updates && Object.keys(updates).length > 0) {
            try {
              await durabilityService.saveCheckpoint({
                jobId: job.id,
                step: stepName,
                data: updates,
              });
            } catch (checkpointErr) {
              console.warn(
                `[JobRunner] Failed to save checkpoint for job ${job.id} step ${stepName}: ${checkpointErr.message}`,
              );
            }
          }
          const stepEndMs = Date.now();
          try {
            await updateStepHistory.run(
              "completed",
              null,
              new Date(stepEndMs).toISOString(),
              stepEndMs - stepStartMs,
              stepHistoryId,
            );
          } catch (_) {
            /* best-effort */
          }
        } catch (err) {
          const stepEndMs = Date.now();
          try {
            await updateStepHistory.run(
              "failed",
              err.message,
              new Date(stepEndMs).toISOString(),
              stepEndMs - stepStartMs,
              stepHistoryId,
            );
          } catch (_) {
            /* best-effort */
          }
          // Log the error for debugging
          console.error(
            `[JobRunner] Step ${stepName} failed for job ${job.id}:`,
            err.message || err,
          );
          const maxAttempts = getEffectiveMaxAttempts(job, err);
          const attemptNumber = (job.attempts || 0) + 1;
          const nonRetryablePolicyError = isNonRetryablePolicyError(
            err,
            stepName,
          );
          const retryAfter = getRetryAfterSeconds(err, attemptNumber);
          if (
            !nonRetryablePolicyError &&
            retryAfter &&
            attemptNumber < maxAttempts
          ) {
            const nextAttemptAt = new Date(
              Date.now() + retryAfter * 1000,
            ).toISOString();
            console.warn(
              `[JobRunner] Retrying job ${job.id} after ${retryAfter}s (attempt ${attemptNumber}/${maxAttempts})`,
            );
            await updateJobAttempt.run(
              "queued",
              progressPct,
              now,
              nextAttemptAt,
              now,
              job.id,
              runnerId,
            );
            return;
          }
          if (nonRetryablePolicyError || attemptNumber >= maxAttempts) {
            if (nonRetryablePolicyError) {
              const musicPlanForTelemetry = parseJson(
                trackVersion?.music_plan_json,
                null,
                "telemetry_music_plan",
              );
              logProviderRejection({
                provider: musicPlanForTelemetry?.provider_resolved || null,
                errorCode: err?.message?.split(":")[0] || null,
                errorStatus: "job_failed",
                rejectedTerms: extractPolicyTermsFromMessage(
                  err?.message || "",
                ),
                lyricsHash: lyricsHashSha256(trackVersion?.lyrics_json),
                style: musicPlanForTelemetry?.style || track?.style,
                step: stepName,
                trackId: track?.id,
              });
            }
            const errorInfo = getErrorInfo(err);
            const failureUpdate = await updateJobFailure.run(
              "failed",
              stepName,
              stepIndex,
              errorInfo.code,
              errorInfo.message,
              100,
              now,
              now,
              job.id,
              runnerId,
            );
            if (!failureUpdate || failureUpdate.changes === 0) {
              console.error(
                `[JobRunner] Lost ownership while marking job ${job.id} failed; forcing terminal failure state`,
              );
              await updateJobFailureNoLock.run(
                "failed",
                stepName,
                stepIndex,
                errorInfo.code,
                errorInfo.message,
                100,
                now,
                now,
                job.id,
              );
            }
            await updateTrackVersion.run(
              "failed",
              now,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              trackVersion.id,
            );
            await updateTrack.run("failed", now, track.id);

            // Move to DLQ for debugging and potential reprocessing
            try {
              const dlq = getDLQService();
              await dlq.moveToDeadLetter({
                jobId: job.id,
                reason: `Max retries (${maxAttempts}) exceeded: ${errorInfo.message}`,
              });
              console.log(
                `[JobRunner] Moved job ${job.id} to DLQ after ${maxAttempts} failed attempts`,
              );
            } catch (dlqErr) {
              // CRITICAL: DLQ insertion failed - update job to make this visible to operators
              console.error(
                `[JobRunner] CRITICAL: Failed to move job ${job.id} to DLQ:`,
                dlqErr.message,
              );
              try {
                await db
                  .prepare(
                    "UPDATE jobs SET error_message = error_message || ' [DLQ_INSERT_FAILED: ' || ? || ']', updated_at = ? WHERE id = ?",
                  )
                  .run(dlqErr.message, now, job.id);
              } catch (updateErr) {
                console.error(
                  `[JobRunner] Failed to update job ${job.id} with DLQ error:`,
                  updateErr.message,
                );
              }
            }
          } else {
            await updateJobAttempt.run(
              "queued",
              progressPct,
              now,
              null,
              now,
              job.id,
              runnerId,
            );
          }
          return;
        }
      }
    }
    if (isPending) {
      const retryAfterSec = stepData?.retry_after_sec || sunoPollIntervalSec;
      const nextAttemptAt = new Date(
        Date.now() + retryAfterSec * 1000,
      ).toISOString();
      await updateJobPending.run(
        "queued",
        stepName,
        stepIndex,
        stepData ? toJson(stepData) : null,
        progressPct,
        now,
        nextAttemptAt,
        now,
        job.id,
        runnerId,
      );
      return;
    }
    if (stepData && stepData.status_override === "blocked") {
      await updateTrackVersion.run(
        "blocked",
        now,
        null,
        null,
        stepData.lyrics_json || null,
        stepData.lyrics_status || null,
        stepData.lyrics_updated_at || null,
        stepData.lyrics_approved_at || null,
        stepData.music_plan_json || null,
        stepData.moderation_status || "blocked",
        stepData.moderation_reason || "blocked",
        stepData.instrumental_url || null,
        stepData.guide_vocal_url || null,
        stepData.guide_access_token || null,
        stepData.voice_conversion_url || null,
        stepData.provenance_json || null,
        trackVersion.id,
      );
      await updateTrack.run("failed", now, track.id);
      await updateUserRisk.run("high", track.user_id);
      await updateJobStatus.run("blocked", 100, now, now, job.id, runnerId);
      await insertAuditLog.run(
        crypto.randomUUID(),
        track.user_id,
        "moderation_blocked",
        "track_version",
        trackVersion.id,
        JSON.stringify({ reason: stepData.moderation_reason || "blocked" }),
        now,
      );
      return;
    }

    if (stepName === "ready" && stepData && stepData.reroll_requested) {
      const rerollStepName =
        job.workflow_type === "full_render"
          ? "instrumental_full"
          : "instrumental";
      const rerollStepIndex = steps.indexOf(rerollStepName);
      const rerollProgress = computeProgress(rerollStepIndex, steps.length);
      const versionDir = getVersionDir(storageDir, track, trackVersion);
      cleanupForReroll(versionDir, job.workflow_type);
      await updateJobReroll.run(
        "queued",
        rerollStepName,
        rerollStepIndex,
        toJson({
          reroll_count: stepData.reroll_count || 1,
          reroll_reason: stepData.reroll_reason || "quality_gate_failed",
          quality_gate: stepData.quality_gate || null,
        }),
        rerollProgress,
        now,
        now,
        job.id,
        runnerId,
      );
      return;
    }

    if (stepName === "ready") {
      const trackVersionReady = await getTrackVersion.get(job.track_version_id);
      if (!trackVersionReady) {
        console.error(
          `[JobRunner] Job ${job.id} ready step: trackVersion ${job.track_version_id} not found`,
        );
        await updateJobStatus.run("failed", 100, now, now, job.id, runnerId);
        return;
      }
      const trackReady = await getTrack.get(trackVersionReady.track_id);
      if (!trackReady) {
        console.error(
          `[JobRunner] Job ${job.id} ready step: track ${trackVersionReady.track_id} not found`,
        );
        await updateJobStatus.run("failed", 100, now, now, job.id, runnerId);
        return;
      }
      const isFull = job.workflow_type === "full_render";
      const resolvedStreamBase =
        trackVersionReady.stream_base_url || streamBaseUrl;
      const url = `${resolvedStreamBase}/${isFull ? "full" : "preview"}/${trackVersionReady.id}.m4a`;
      const status = isFull ? "full_ready" : "preview_ready";
      let generatedCover = null;

      // Generate cover images before upload so storage sync can include them, but do not
      // publish cover URLs until the render commit succeeds.
      if (isSharpAvailable()) {
        try {
          const versionDir = path.join(
            storageDir,
            "tracks",
            trackReady.user_id,
            trackReady.id,
            `v${trackVersionReady.version_num}`,
          );
          generatedCover = await generateCover({
            versionDir,
            track: trackReady,
            trackVersion: trackVersionReady,
            streamBaseUrl: resolvedStreamBase,
          });
        } catch (coverErr) {
          // Cover generation failure is non-fatal - track still plays without cover
          console.warn(
            `[JobRunner] Cover generation failed for track ${trackReady.id}:`,
            coverErr.message,
          );
        }
      }

      // Align lyrics to audio timestamps before upload, but use a narrow write so
      // alignment cannot accidentally advance ready status.
      if (trackVersionReady.lyrics_json) {
        try {
          const lyricsData = parseJson(
            trackVersionReady.lyrics_json,
            null,
            "alignment_lyrics",
          );
          const sections =
            lyricsData?.sections ||
            (Array.isArray(lyricsData) ? lyricsData : null);
          if (
            sections &&
            sections.length > 0 &&
            sections[0].startTime === undefined
          ) {
            const vDir = path.join(
              storageDir,
              "tracks",
              trackReady.user_id,
              trackReady.id,
              `v${trackVersionReady.version_num}`,
            );
            const audioFile = path.join(
              vDir,
              isFull ? "full.m4a" : "preview.m4a",
            );
            if (fs.existsSync(audioFile)) {
              const lyricsText = sectionsToText(sections);
              const whisperResult = await alignLyrics(audioFile, lyricsText);
              const enriched = alignSectionsToTimestamps(
                sections,
                whisperResult,
              );
              const enrichedData = lyricsData?.sections
                ? { ...lyricsData, sections: enriched }
                : enriched;
              const enrichedJson = toJson(enrichedData);
              await updateTrackVersionLyricsOnly.run(
                enrichedJson,
                trackVersionReady.id,
              );
              trackVersionReady.lyrics_json = enrichedJson;
              console.log(
                `[JobRunner] Lyrics aligned for track ${trackReady.id} (${whisperResult.words?.length || 0} words matched)`,
              );
            }
          }
        } catch (alignErr) {
          console.warn(
            `[JobRunner] Lyrics alignment failed for track ${trackReady.id}:`,
            alignErr.message,
          );
          // Non-fatal — web player will use estimation fallback
        }
      }

      // Upload to S3 before publishing ready state so clients can never observe
      // preview/full readiness without the actual audio asset being available.
      let s3UploadSucceeded = true;
      if (storageProvider && storageProvider.type === "s3") {
        try {
          await uploadTrackOutputsToS3({
            storageProvider,
            storageDir,
            track: trackReady,
            trackVersion: trackVersionReady,
            kind: isFull ? "full" : "preview",
          });
        } catch (s3Error) {
          s3UploadSucceeded = false;
          console.error(
            `[JobRunner] S3 upload failed for track ${trackReady.id}:`,
            {
              error: s3Error.message,
              trackId: trackReady.id,
              versionNum: trackVersionReady.version_num,
            },
          );

          if (process.env.NODE_ENV === "production") {
            // Use the standard failure path: update job, track_version, track, DLQ, and billing hold
            const readyStepIndex = steps.indexOf("ready");
            await updateJobFailure.run(
              "failed",
              "ready",
              readyStepIndex,
              "S3_UPLOAD_FAILED",
              s3Error.message,
              100,
              now,
              now,
              job.id,
              runnerId,
            );
            await updateTrackVersion.run(
              "failed",
              now,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              trackVersionReady.id,
            );
            await updateTrack.run("failed", now, trackReady.id);
            try {
              const dlq = getDLQService();
              await dlq.moveToDeadLetter({
                jobId: job.id,
                reason: `S3 upload failed: ${s3Error.message}`,
              });
              console.log(
                `[JobRunner] Moved job ${job.id} to DLQ after S3 failure`,
              );
            } catch (dlqErr) {
              console.error(
                `[JobRunner] DLQ move failed for job ${job.id}:`,
                dlqErr.message,
              );
            }
            return;
          }
          // In dev mode, warn loudly that this would fail in production
          console.warn(
            `[JobRunner] ⚠️  DEV MODE: S3 upload failed, using local files only.`,
          );
          console.warn(
            `[JobRunner] ⚠️  This render would FAIL in production! Fix S3 configuration.`,
          );
          console.warn(`[JobRunner] S3 Error: ${s3Error.message}`);
        }
      }

      const completionProvenance = mergeProvenanceJson(
        trackVersionReady.provenance_json,
        {
          render: {
            workflow: isFull ? "full_render" : "preview_render",
            completed_at: now,
            provider:
              parseJson(
                trackVersionReady.music_plan_json,
                {},
                "ready_completion_music_plan",
              )?.provider_resolved || null,
          },
          timeline: [
            {
              at: nowIso(),
              step: "ready",
              event: "render_completed",
              workflow: isFull ? "full_render" : "preview_render",
            },
          ],
        },
      );

      // Wait briefly for parallel artwork to finish. If artwork isn't ready
      // within ARTWORK_BARRIER_TIMEOUT_MS (default 60s), release READY anyway
      // with artwork_url=NULL — audio is the product, artwork is enhancement.
      try {
        await waitForArtworkReady({ db, trackVersionId: trackVersionReady.id });
      } catch (barrierErr) {
        console.warn(
          `[JobRunner] Artwork barrier error for ${trackVersionReady.id}:`,
          barrierErr.message,
        );
      }

      // Commit ready-state only after upload success (or dev-mode local fallback).
      await updateTrackVersion.run(
        status,
        now,
        isFull ? null : url,
        isFull ? url : null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        completionProvenance,
        trackVersionReady.id,
      );
      await updateTrack.run(
        isFull ? "ready" : "preview_ready",
        now,
        trackReady.id,
      );
      if (generatedCover) {
        await updateTrackVersionCover.run(
          generatedCover.coverUrl,
          generatedCover.smallUrl,
          generatedCover.largeUrl,
          trackVersionReady.id,
        );
      }
      // Song entitlement is consumed when a version first starts generation.
      // Full render on the same version reuses that entitlement, so the runner
      // should never deduct again at completion.
      await insertAuditLog.run(
        crypto.randomUUID(),
        trackReady.user_id,
        "render_completed",
        "track_version",
        trackVersionReady.id,
        JSON.stringify({ render_type: isFull ? "full" : "preview" }),
        now,
      );
      writePlaceholderOutputs({
        storageDir,
        track: trackReady,
        trackVersion: { ...trackVersionReady, preview_url: url, full_url: url },
        kind: isFull ? "full" : "preview",
        devMode,
      });

      // Pre-generate share link so it's ready when user opens share screen (non-fatal)
      await ensureRenderSharePreGeneration({
        db,
        trackReady,
        trackVersionReady,
        streamBaseUrl,
        renderType: isFull ? "full" : "preview",
      });

      // Clean up intermediate files only after fully successful render (including S3)
      // In dev mode with S3 failure, keep temp files for debugging
      if (s3UploadSucceeded) {
        const versionDir = path.join(
          storageDir,
          "tracks",
          trackReady.user_id,
          trackReady.id,
          `v${trackVersionReady.version_num}`,
        );
        cleanupTempFiles(versionDir);
      }

      if (eventsService) {
        try {
          eventsService.emit("render_ready", {
            userId: trackReady.user_id,
            resourceType: "track_version",
            resourceId: trackVersionReady.id,
            metadata: {
              render_type: isFull ? "full" : "preview",
              track_id: trackReady.id,
            },
          });
        } catch (eventErr) {
          console.warn(
            `[JobRunner] Failed to emit render_ready for job ${job.id}:`,
            eventErr.message,
          );
        }
      }

      // Send push notification to user's devices (fire-and-forget)
      if (pushNotification.isConfigured()) {
        try {
          const devices = await db
            .prepare(
              "SELECT push_token FROM devices WHERE user_id = ? AND push_token IS NOT NULL",
            )
            .all(trackReady.user_id);
          for (const device of devices || []) {
            if (device.push_token) {
              pushNotification
                .sendRenderComplete(
                  device.push_token,
                  trackReady.id,
                  trackReady.title,
                )
                .catch((err) => {
                  console.warn(
                    `[JobRunner] Push notification failed:`,
                    err.message,
                  );
                });
            }
          }
        } catch (pushErr) {
          // Push notification failure should not affect job completion
          console.warn(
            `[JobRunner] Failed to send push notifications:`,
            pushErr.message,
          );
        }
      }

      await updateJobStatus.run("completed", 100, now, now, job.id, runnerId);
      return;
    }

    // Set status back to 'queued' so next tick can pick up the next step.
    // Keep terminal transitions (blocked/ready) above while lock ownership is held.
    await advanceToNextStep({ job, steps, stepIndex, stepData, now, runnerId });
  };

  // Tick function dispatches jobs to available concurrent slots
  const tick = async () => {
    const now = new Date().toISOString();
    const availableSlots = MAX_CONCURRENT - activeJobs;
    if (availableSlots <= 0) return;

    // Phase 3: Per-user fairness — find users at capacity (heartbeat-aware)
    // Skip the 3-table JOIN when no jobs are running (common idle case)
    let blockedUserIds = new Set();
    if (activeJobs > 0) {
      const heartbeatCutoff = new Date(
        Date.now() - 2 * 60 * 1000,
      ).toISOString();
      const blockedUsers = await getBlockedUsers.all(
        heartbeatCutoff,
        MAX_CONCURRENT_PER_USER,
      );
      blockedUserIds = new Set(blockedUsers.map((r) => r.user_id));
    }

    // Fetch extra candidates to compensate for user filtering
    const fetchLimit = availableSlots + blockedUserIds.size;
    const candidates = await selectJobs.all(now, fetchLimit);
    let candidateUsersByJobId = new Map();
    if (blockedUserIds.size > 0 && candidates.length > 0) {
      const ids = candidates.map((job) => job.track_version_id).filter(Boolean);
      if (ids.length > 0) {
        const placeholders = ids.map(() => "?").join(",");
        const { rows } = await db.query(
          `SELECT tv.id AS track_version_id, t.user_id
             FROM track_versions tv
             JOIN tracks t ON t.id = tv.track_id
            WHERE tv.id IN (${placeholders})`,
          ids,
        );
        candidateUsersByJobId = new Map(
          rows.map((row) => [row.track_version_id, row.user_id]),
        );
      }
    }

    const eligibleJobs = [];
    for (const job of candidates) {
      if (processingJobs.has(job.id)) continue;
      if (blockedUserIds.size > 0) {
        const candidateUserId = candidateUsersByJobId.get(job.track_version_id);
        if (candidateUserId && blockedUserIds.has(candidateUserId)) continue;
      }
      eligibleJobs.push(job);
      if (eligibleJobs.length >= availableSlots) break;
    }

    if (eligibleJobs.length > 0) {
      console.log(
        `[JobRunner] Found ${candidates.length} queued job(s), processing ${eligibleJobs.length} (${activeJobs}/${MAX_CONCURRENT} slots in use${blockedUserIds.size > 0 ? `, ${blockedUserIds.size} user(s) at capacity` : ""})`,
      );
    }

    for (const job of eligibleJobs) {
      processingJobs.add(job.id);
      activeJobs++;

      // Process job in background (don't await)
      processJob(job)
        .catch((err) => console.error(`[JobRunner] Job ${job.id} error:`, err))
        .finally(() => {
          activeJobs--;
          processingJobs.delete(job.id);
        });
    }
  };

  const voiceProviderProcessingJobs = new Set();
  let activeVoiceProviderJobs = 0;
  let voiceProviderLaneDisabled = false;
  let selectVoiceProviderJobs = null;

  const heartbeatVoiceProviderJob = async (jobId) => {
    const heartbeatAt = new Date().toISOString();
    await db
      .prepare(
        "UPDATE voice_provider_jobs SET locked_at = ? WHERE id = ? AND locked_by = ? AND status = ?",
      )
      .run(heartbeatAt, jobId, runnerId, "running");
  };

  const tickVoiceProviderJobs = async () => {
    if (voiceProviderLaneDisabled || MAX_CONCURRENT_VOICE_PROVIDER_JOBS <= 0) {
      return;
    }
    const availableSlots =
      MAX_CONCURRENT_VOICE_PROVIDER_JOBS - activeVoiceProviderJobs;
    if (availableSlots <= 0) {
      return;
    }
    const now = new Date().toISOString();
    try {
      if (!selectVoiceProviderJobs) {
        selectVoiceProviderJobs = db.prepare(
          `SELECT *
             FROM voice_provider_jobs
            WHERE status = 'pending'
              AND provider = 'suno'
              AND attempts < max_attempts
              AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
            ORDER BY updated_at ASC, created_at ASC
            LIMIT ?`,
        );
      }
    } catch (err) {
      const message = String(err?.message || err || "");
      if (/voice_provider_jobs|no such table|does not exist/i.test(message)) {
        voiceProviderLaneDisabled = true;
        console.warn(
          "[JobRunner] Suno voice persona job lane disabled; voice_provider_jobs table is unavailable.",
        );
        return;
      }
      throw err;
    }
    let candidates = [];
    try {
      candidates = await selectVoiceProviderJobs.all(now, availableSlots);
    } catch (err) {
      const message = String(err?.message || err || "");
      if (/voice_provider_jobs|no such table|does not exist/i.test(message)) {
        voiceProviderLaneDisabled = true;
        console.warn(
          "[JobRunner] Suno voice persona job lane disabled; voice_provider_jobs table is unavailable.",
        );
        return;
      }
      throw err;
    }
    const eligibleJobs = candidates.filter(
      (job) => !voiceProviderProcessingJobs.has(job.id),
    );
    if (eligibleJobs.length > 0) {
      console.log(
        `[JobRunner] Found ${eligibleJobs.length} Suno voice persona job(s) ` +
          `(${activeVoiceProviderJobs}/${MAX_CONCURRENT_VOICE_PROVIDER_JOBS} slots in use)`,
      );
    }
    for (const job of eligibleJobs) {
      voiceProviderProcessingJobs.add(job.id);
      activeVoiceProviderJobs++;
      const heartbeatEveryMs = Math.max(
        30_000,
        Math.min(120_000, Math.floor((staleJobTimeoutMinutes * 60_000) / 2)),
      );
      const heartbeatTimer = setInterval(() => {
        heartbeatVoiceProviderJob(job.id).catch((err) => {
          console.warn(
            "[JobRunner] Failed to heartbeat Suno voice persona job:",
            err.message,
          );
        });
      }, heartbeatEveryMs);
      voiceProviderJobRunner({
        db,
        jobId: job.id,
        config,
        lockedBy: runnerId,
      })
        .catch((err) => {
          console.error(
            `[JobRunner] Suno voice persona job ${job.id} error:`,
            err.message || err,
          );
        })
        .finally(() => {
          clearInterval(heartbeatTimer);
          activeVoiceProviderJobs--;
          voiceProviderProcessingJobs.delete(job.id);
        });
    }
  };

  const timer = setInterval(async () => {
    try {
      await tick();
      await tickVoiceProviderJobs();
    } catch (err) {
      console.error("[JobRunner] Unhandled error in tick:", err);
    }
  }, intervalMs);
  return {
    tick,
    stop: () => {
      clearInterval(timer);
      clearInterval(recoveryTimer);
      clearInterval(dlqReprocessTimer);
      clearInterval(artworkRecoveryTimer);
      clearTimeout(dlqReprocessStartupTimer);
      clearTimeout(artworkRecoveryStartupTimer);
    },
    tickVoiceProviderJobs,
    // Expose concurrent job stats for health checks
    getActiveJobs: () => activeJobs,
    getMaxConcurrent: () => MAX_CONCURRENT,
    getProcessingJobIds: () => [...processingJobs],
    getActiveVoiceProviderJobs: () => activeVoiceProviderJobs,
    getProcessingVoiceProviderJobIds: () => [...voiceProviderProcessingJobs],
    isVoiceProviderLaneDisabled: () => voiceProviderLaneDisabled,
    // Expose workflow hardening services for health checks and admin
    getCircuitBreakerStats: () => circuitBreaker.getAllStats(),
    getCircuitBreakerState: (provider) => circuitBreaker.getState(provider),
    isCircuitOpen: (provider) => circuitBreaker.isOpen(provider),
    getDLQService,
    getDurabilityService: () => durabilityService,
    performDLQAutoReprocess,
  };
}

module.exports = {
  startJobRunner,
  cleanStaleStepFiles,
  _testing: {
    performVoiceConversion,
    hydrateProviderCompleteAudio,
    applyVocalPolish,
    ensureRenderSharePreGeneration,
    resolveSunoPersonaForRenderImpl,
  },
};
