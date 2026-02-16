const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const config = require("../config");
const { generateLyrics } = require("../providers/lyrics");
const { moderationCheck } = require("../providers/moderation");
const { writeWav } = require("../utils/audio");
const { ensureDir, parseJson, toJson, getVersionDir } = require("../utils/common");
const { extractPolicyTermsFromMessage } = require("../utils/policy-terms");
const { buildMusicPlan, renderInstrumental, renderGuideVocal, renderWithProvider } = require("../providers/music");
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
const { runFFmpeg, mixTracks, mixTracksPersonalized, blendVocals, encodeToAAC } = require("../utils/ffmpeg");
const { embedWatermark } = require("../utils/watermark");
const { createHLSPlaylist } = require("../utils/hls");
const {
  trackMasterKey,
  trackPreviewKey,
  trackHLSKey,
} = require("../storage/index");
const { CircuitBreaker } = require("./circuit-breaker");
const { createDLQService } = require("./dlq");
const { createJobDurabilityService } = require("./durability");
const { getFeatureFlag, getFeatureFlags } = require("../services/feature-flags");
const pushNotification = require("../services/push-notification");
const { generateCover, isSharpAvailable } = require("../services/cover-generator");
const { sanitizeLyricsForProviderPolicy } = require("../services/lyrics-policy-sanitizer");
const {
  buildRenderContract,
  resolveRenderContract,
  getProviderAudioUrl,
  extractProviderAudioUrl,
  sanitizeProviderRoutingForContract,
  sanitizeLyricsForAllMusicProviders,
  shouldSkipStep,
} = require("./render-contract");

// Provider identifiers for circuit breaker tracking
const PROVIDERS = {
  SUNO: "suno",
  ELEVENLABS: "elevenlabs",
  REPLICATE: "replicate",
  SEEDVC: "seedvc",
};

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
        console.error(`[JobRunner] Permission denied cleaning up ${file}:`, err.message);
      } else {
        // Log but don't fail - cleanup is best-effort for other errors
        console.warn(`[JobRunner] Failed to cleanup temp file ${file}:`, err.message);
      }
    }
  }

  if (cleaned > 0) {
    const savedMB = (totalBytes / (1024 * 1024)).toFixed(2);
    console.log(`[JobRunner] Cleaned up ${cleaned} temp files, saved ${savedMB} MB`);
  }

  return { success: !criticalError, cleaned, totalBytes, criticalError };
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
async function uploadTrackOutputsToS3({ storageProvider, storageDir, track, trackVersion, kind }) {
  const versionDir = path.join(
    storageDir,
    "tracks",
    track.user_id,
    track.id,
    `v${trackVersion.version_num}`
  );

  const isPreview = kind === "preview";
  const audioFileName = isPreview ? "preview.m4a" : "full.m4a";
  const localAudioPath = path.join(versionDir, audioFileName);

  const uploadedKeys = {};

  // Upload main audio file
  if (fs.existsSync(localAudioPath)) {
    const audioKey = isPreview
      ? trackPreviewKey({ userId: track.user_id, trackId: track.id, versionNum: trackVersion.version_num })
      : trackMasterKey({ userId: track.user_id, trackId: track.id, versionNum: trackVersion.version_num, format: "m4a" });

    await storageProvider.putFile({
      key: audioKey,
      filePath: localAudioPath,
      contentType: "audio/mp4",
    });
    uploadedKeys.audioKey = audioKey;
    console.log(`[JobRunner] Uploaded ${kind} audio to S3: ${audioKey}`);
  }

  // Upload HLS files if they exist
  const hlsDir = path.join(versionDir, "hls");
  if (fs.existsSync(hlsDir)) {
    const hlsFiles = fs.readdirSync(hlsDir);
    const hlsBaseKey = trackHLSKey({ userId: track.user_id, trackId: track.id, versionNum: trackVersion.version_num });
    uploadedKeys.hlsKeys = [];

    for (const file of hlsFiles) {
      const localPath = path.join(hlsDir, file);
      if (fs.statSync(localPath).isFile()) {
        const s3Key = hlsBaseKey + file;
        const contentType = file.endsWith(".m3u8") ? "application/x-mpegURL" : "video/MP2T";
        await storageProvider.putFile({
          key: s3Key,
          filePath: localPath,
          contentType,
        });
        uploadedKeys.hlsKeys.push(s3Key);
      }
    }
    console.log(`[JobRunner] Uploaded ${uploadedKeys.hlsKeys.length} HLS files to S3`);
  }

  return uploadedKeys;
}

function writePlaceholderOutputs({ storageDir, track, trackVersion, kind, devMode = false }) {
  const versionDir = path.join(
    storageDir,
    "tracks",
    track.user_id,
    track.id,
    `v${trackVersion.version_num}`
  );
  ensureDir(versionDir);
  const audioName = kind === "preview" ? "preview.m4a" : "full.m4a";
  const audioPath = path.join(versionDir, audioName);
  if (!fs.existsSync(audioPath)) {
    // In production (devMode=false), fail if no real audio was generated
    if (!devMode) {
      throw new Error(`E302_WORKFLOW_ERROR: No audio file generated for ${kind} render. Check provider configuration.`);
    }
    console.warn(`[JobRunner] Writing placeholder audio for ${kind} (DEV_MODE)`);
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
    fs.writeFileSync(provenancePath, JSON.stringify(provenance, null, 2), "utf8");
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

  await runFFmpeg(["-y", "-i", sourcePath, "-ar", "44100", "-ac", "2", outputPath]);
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
}) {
  const runnerId = workerId || crypto.randomUUID();
  const sunoPollIntervalSec = 10;

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
        const rows = params.length ? await stmt.all(...params) : await stmt.all();
        return { rows };
      } else {
        const result = params.length ? await stmt.run(...params) : await stmt.run();
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

  function clampNumber(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return Math.max(min, Math.min(max, numeric));
  }

  function toIsoNow() {
    return new Date().toISOString();
  }

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
    const termList = terms.length > 0 ? ` blocked terms: ${terms.join(", ")}` : "";
    return new Error(
      `E302_PROVIDER_POLICY_ERROR: Lyrics contain provider-restricted content.${termList}. Please edit lyrics and try again.`
    );
  }

  function logProviderRejection({ provider, errorCode, errorStatus, rejectedTerms, lyricsHash, style, step, trackId }) {
    console.warn(JSON.stringify({
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
    }));
  }

  function logSanitizerIntervention({ provider, changeCount, rewritePasses, violationTerms, style, step, trackId }) {
    console.warn(JSON.stringify({
      event: "sanitizer_intervention",
      provider,
      change_count: changeCount || 0,
      rewrite_passes: rewritePasses || 0,
      violation_terms: Array.isArray(violationTerms) ? violationTerms : [],
      style: style || null,
      step: step || null,
      track_id: trackId || null,
      timestamp: new Date().toISOString(),
    }));
  }

  function lyricsHashSha256(lyricsJson) {
    if (!lyricsJson) return null;
    const text = typeof lyricsJson === "string" ? lyricsJson : JSON.stringify(lyricsJson);
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
        console.warn(`[JobRunner] Failed to remove reroll artifact ${fileName}:`, err.message);
      }
    }

    const hlsDir = path.join(versionDir, "hls");
    if (fs.existsSync(hlsDir)) {
      try {
        fs.rmSync(hlsDir, { recursive: true, force: true });
      } catch (err) {
        console.warn("[JobRunner] Failed to remove reroll HLS directory:", err.message);
      }
    }
  }

  function tightenMusicPlanForReroll(musicPlan, qualityReport) {
    if (!musicPlan || typeof musicPlan !== "object") {
      return null;
    }
    const next = JSON.parse(JSON.stringify(musicPlan));
    const existingIntent = next.style_intent && typeof next.style_intent === "object"
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
      ])
    ).slice(0, 14);

    next.generation_mode = "compose_detailed";
    next.plan_schema_version = 2;
    next.style_negative_constraints = tightenedNegatives;
    next.style_prompt_compact = [
      next.style_prompt_compact || next.style_prompt || `${next.style || "pop"} arrangement`,
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
      tightenedNegatives.length > 0 ? `Avoid: ${tightenedNegatives.join(", ")}.` : null,
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
        applied_at: toIsoNow(),
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
    const outputPath = path.join(versionDir, isFull ? "full.m4a" : "preview.m4a");
    const mixPath = path.join(versionDir, "mix.wav");
    const hasOutput = fs.existsSync(outputPath);
    const hasMix = fs.existsSync(mixPath);

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
    const compactPromptPresent = typeof musicPlan?.style_prompt_compact === "string"
      ? musicPlan.style_prompt_compact.trim().length > 0
      : typeof musicPlan?.style_prompt === "string" && musicPlan.style_prompt.trim().length > 0;
    const providerHintPresent = typeof musicPlan?.provider_style_hint === "string"
      ? musicPlan.provider_style_hint.trim().length > 0
      : typeof musicPlan?.style_intent?.instruction_override === "string" &&
        musicPlan.style_intent.instruction_override.trim().length > 0;
    const negativeConstraints = Array.isArray(musicPlan?.style_negative_constraints)
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

    let vocalScore = 68;
    const directProviderGuide = Boolean(trackVersion?.guide_vocal_url) && !String(trackVersion.guide_vocal_url).includes("/guide/");
    const isPersonalized = track.voice_mode === "user_voice" || track.voice_mode === "personalized";
    if (isPersonalized) {
      const personalizedFile = path.join(versionDir, isFull ? "user_vocal_full.wav" : "user_vocal.wav");
      vocalScore = fs.existsSync(personalizedFile) ? 82 : 58;
    } else if (directProviderGuide) {
      vocalScore = 90;
    } else if (fs.existsSync(path.join(versionDir, isFull ? "guide_vocal_full.mp3" : "guide_vocal.mp3"))) {
      vocalScore = 76;
    } else {
      vocalScore = 60;
    }

    const hasInstrumental =
      fs.existsSync(path.join(versionDir, isFull ? "inst_full.mp3" : "inst_preview.mp3")) ||
      fs.existsSync(path.join(versionDir, isFull ? "inst_full.wav" : "inst_preview.wav")) ||
      fs.existsSync(path.join(versionDir, "stems", "instrumental.wav")) ||
      fs.existsSync(path.join(versionDir, "suno_complete.mp3")) ||
      fs.existsSync(path.join(versionDir, "elevenlabs_complete.mp3"));
    let balanceScore = hasMix && hasInstrumental ? 84 : hasMix ? 70 : 45;

    let technicalScore = hasOutput ? 75 : 25;
    if (hasOutput) {
      const stats = fs.statSync(outputPath);
      if (stats.size >= 150000) {
        technicalScore += 15;
      } else if (stats.size >= 90000) {
        technicalScore += 8;
      } else if (stats.size < 30000) {
        technicalScore -= 25;
      }
    }

    const expectedDuration = Number(musicPlan?.duration_sec || track.duration_target || 60);
    const actualDuration = await probeAudioDurationSec(outputPath);
    if (Number.isFinite(actualDuration) && expectedDuration > 0) {
      const deltaRatio = Math.abs(actualDuration - expectedDuration) / expectedDuration;
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
      technicalScore * 0.1
    );

    const issues = [];
    if (styleScore < 70) issues.push("style_fidelity_low");
    if (vocalScore < 65) issues.push("vocal_intelligibility_low");
    if (balanceScore < 65) issues.push("mix_balance_low");
    if (technicalScore < 60) issues.push("technical_quality_low");
    if (!hasOutput) issues.push("missing_output_audio");

    const passed = totalScore >= qualityThreshold && hasOutput;
    return {
      passed,
      threshold: qualityThreshold,
      total_score: totalScore,
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

    const envDefaultProvider =
      providerConfig.suno?.live
        ? "suno"
        : providerConfig.elevenlabs?.live
          ? "elevenlabs"
          : config.MUSIC_PROVIDER || "suno";
    const fallback = {
      default_provider: envDefaultProvider,
      auto_style_routing: true,
      elevenlabs_generation_mode: "composition_plan",
      auto_reroll_enabled: true,
      quality_threshold: 72,
      max_rerolls: 1,
      style_overrides: {},
    };

    let value = fallback;
    try {
      const row = await db
        .prepare("SELECT value_json FROM app_config WHERE key = 'music_provider_config'")
        .get();
      if (row?.value_json) {
        const parsed = parseJson(row.value_json, {}, "music_provider_config");
        const parsedMaxRerolls = Number(parsed?.max_rerolls);
        value = {
          default_provider: parsed?.default_provider === "elevenlabs" ? "elevenlabs" : "suno",
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
      console.warn("[JobRunner] Failed to read music_provider_config, using env fallback:", err.message);
      value = fallback;
    }

    cachedMusicRoutingConfig = value;
    cachedMusicRoutingExpiresAt = now + MUSIC_ROUTING_CACHE_TTL_MS;
    return value;
  }

  // Resolve active music provider (elevenlabs or suno) based on runtime config
  // and style-specific capability routing.
  async function getMusicProviderConfig({ requestedStyle, pinnedProvider } = {}) {
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
  }) {
    const taskId = job?.external_task_id || null;
    const existingStepData = parseJson(job?.step_data, {}, "suno_step_data");
    const incompleteSuccessPolls = Number(existingStepData?.incomplete_success_polls || 0);
    const maxIncompleteSuccessPolls = 18;

    const touchHeartbeat = async () => {
      if (!job) return;
      const stamp = new Date().toISOString();
      await updateJobHeartbeat.run(stamp, stamp, job.id, runnerId);
    };

    const submitTaskForLyrics = async (lyricsPayload) =>
      durabilityService.executeWithDurability({
        provider: PROVIDERS.SUNO,
        fn: () => submitSunoTask({
          baseUrl: musicConfig.baseUrl,
          apiKey: musicConfig.apiKey,
          lyrics: lyricsPayload,
          musicPlan,
          track,
          timeoutMs: musicConfig.timeoutMs,
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
        throw new Error(
          `E302_SUNO_INCOMPLETE_OUTPUT: status=${status || "unknown"}, task=${taskId || "unknown"}, reason=${reason || "unknown"}`
        );
      }
      return nextIncompletePolls;
    }

    // Poll existing task
    if (taskId) {
      const pollResult = await durabilityService.executeWithDurability({
        provider: PROVIDERS.SUNO,
        fn: () => pollSunoTaskOnce({
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

      if (statusInfo.phase === "audio_success" || statusInfo.phase === "provisional_success") {
        const readiness = inspectSunoAudioReadiness(pollResult.response);
        if (!readiness.ready) {
          const nextIncompletePolls = computeNextIncompletePolls({
            status,
            reason: readiness.reason,
          });
          console.warn(
            `[Suno] Poll status ${status} for task ${taskId} but audio not ready (${readiness.reason}); poll ${nextIncompletePolls}/${maxIncompleteSuccessPolls}`
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
              `[Suno] Audio artifact not finalized for task ${taskId}; reconciling ${nextIncompletePolls}/${maxIncompleteSuccessPolls}`
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
          throw new Error(`E302_SUNO_POLICY_ERROR: Generation failed - ${errorMsg}`);
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
    const baseSanitized = sanitizeLyricsForProviderPolicy({ lyrics, provider: "suno" });
    const lyricsForSubmission = baseSanitized.lyrics;
    if (baseSanitized.changed) {
      console.log(
        `[Suno] Applied preflight lyric normalization (${baseSanitized.change_count} change(s)) before submission`
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
      await updateJobExternalTask.run(newTaskId, toJson(payload), stamp, stamp, job.id, runnerId);
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
      if (!(statusInfo.phase === "audio_success" || statusInfo.phase === "provisional_success")) {
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
      });
      const providerAudioUrl = extractProviderAudioUrl(recovered?.raw || {});
      const provenance_json = mergeProvenanceJson(trackVersion.provenance_json, {
        music: {
          ...(parseJson(trackVersion.provenance_json, {}, "prov_suno_recover")?.music || {}),
          provider: "suno",
          routing: routingMetadata || null,
          render_contract: renderContract,
          provider_audio_url: providerAudioUrl || getProviderAudioUrl(trackVersion),
        },
        timeline: [
          {
            at: toIsoNow(),
            step,
            event: "suno_result_reconciled",
            provider: "suno",
            task_id: taskId,
            status,
          },
        ],
      });

      return {
        instrumental_url: providerAudioUrl || recovered?.raw?.instrumental_url || null,
        guide_vocal_url:
          renderContract.pipeline === "guide_tts_and_voice_convert"
            ? recovered?.raw?.guide_vocal_url || null
            : null,
        provider_routing: routingMetadata || null,
        provenance_json,
      };
    } catch (err) {
      console.warn(
        `[JobRunner] Suno reconciliation probe failed for task ${taskId}: ${err?.message || err}`
      );
      return null;
    }
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

  async function performStaleJobRecovery() {
    if (!recoverStaleJobs) return;
    try {
      const now = new Date().toISOString();
      // Compute cutoff time in JavaScript: now - staleJobTimeoutMinutes
      const cutoffTime = new Date(Date.now() - staleJobTimeoutMinutes * 60 * 1000).toISOString();
      const result = await recoverStaleJobsStmt.run(now, cutoffTime);
      if (result.changes > 0) {
        console.warn(`[JobRunner] Recovered ${result.changes} stale jobs stuck in 'running' status`);
      }
    } catch (err) {
      console.error(`[JobRunner] Failed to recover stale jobs:`, err.message);
    }
  }

  // Recover stale jobs at startup
  await performStaleJobRecovery();
  const recoveryIntervalMs = Math.max(60000, Math.floor((staleJobTimeoutMinutes * 60 * 1000) / 2));
  const recoveryTimer = setInterval(performStaleJobRecovery, recoveryIntervalMs);

  // FOR UPDATE SKIP LOCKED prevents race conditions between workers:
  // - Locks selected rows so other workers won't select them
  // - SKIP LOCKED means workers don't block, they just skip locked rows
  // - LIMIT ensures we only lock what we need (availableSlots)
  const selectJobsQuery = db.isPostgres
    ? "SELECT * FROM jobs WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= $1) ORDER BY created_at ASC LIMIT $2 FOR UPDATE SKIP LOCKED"
    : "SELECT * FROM jobs WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= $1) ORDER BY created_at ASC LIMIT $2";
  const selectJobs = await db.prepare(selectJobsQuery);
  const claimJob = await db.prepare(
    "UPDATE jobs SET status = 'running', locked_by = ?, locked_at = ?, started_at = COALESCE(started_at, ?), last_heartbeat_at = ?, progress_pct = ?, updated_at = ? WHERE id = ? AND status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)"
  );
  // All job updates include ownership verification (AND locked_by = ?) to prevent
  // data integrity issues when workers lose ownership mid-processing
  const updateJobStep = await db.prepare(
    "UPDATE jobs SET step = ?, step_index = ?, progress_pct = ?, last_heartbeat_at = ?, updated_at = ? WHERE id = ? AND locked_by = ?"
  );
  const updateJob = await db.prepare(
    "UPDATE jobs SET status = ?, step = ?, step_index = ?, step_data = ?, progress_pct = ?, last_heartbeat_at = ?, next_attempt_at = NULL, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ? AND locked_by = ?"
  );
  const updateJobReroll = await db.prepare(
    "UPDATE jobs SET status = ?, step = ?, step_index = ?, step_data = ?, external_task_id = NULL, progress_pct = ?, last_heartbeat_at = ?, next_attempt_at = NULL, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ? AND locked_by = ?"
  );
  const updateJobPending = await db.prepare(
    "UPDATE jobs SET status = ?, step = ?, step_index = ?, step_data = ?, progress_pct = ?, last_heartbeat_at = ?, next_attempt_at = ?, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ? AND locked_by = ?"
  );
  const updateJobStatus = await db.prepare(
    "UPDATE jobs SET status = ?, progress_pct = ?, completed_at = ?, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ? AND locked_by = ?"
  );
  const updateJobHeartbeat = await db.prepare(
    "UPDATE jobs SET last_heartbeat_at = ?, updated_at = ? WHERE id = ? AND locked_by = ?"
  );
  const updateJobFailure = await db.prepare(
    "UPDATE jobs SET status = ?, step = ?, step_index = ?, error_code = ?, error_message = ?, progress_pct = ?, completed_at = ?, next_attempt_at = NULL, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ? AND locked_by = ?"
  );
  const updateJobFailureNoLock = await db.prepare(
    "UPDATE jobs SET status = ?, step = ?, step_index = ?, error_code = ?, error_message = ?, progress_pct = ?, completed_at = ?, next_attempt_at = NULL, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ?"
  );
  const updateJobAttempt = await db.prepare(
    "UPDATE jobs SET attempts = attempts + 1, status = ?, progress_pct = ?, last_heartbeat_at = ?, next_attempt_at = ?, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ? AND locked_by = ?"
  );
  const updateJobExternalTask = await db.prepare(
    "UPDATE jobs SET external_task_id = ?, step_data = ?, last_heartbeat_at = ?, updated_at = ? WHERE id = ? AND locked_by = ?"
  );
  const getTrackVersion = await db.prepare(
    "SELECT * FROM track_versions WHERE id = ?"
  );
  const getTrack = await db.prepare("SELECT * FROM tracks WHERE id = ?");
  const updateTrackVersion = await db.prepare(
    "UPDATE track_versions SET status = ?, completed_at = ?, preview_url = COALESCE(?, preview_url), full_url = COALESCE(?, full_url), lyrics_json = COALESCE(?, lyrics_json), lyrics_status = COALESCE(?, lyrics_status), lyrics_updated_at = COALESCE(?, lyrics_updated_at), lyrics_approved_at = COALESCE(?, lyrics_approved_at), music_plan_json = COALESCE(?, music_plan_json), moderation_status = COALESCE(?, moderation_status), moderation_reason = COALESCE(?, moderation_reason), instrumental_url = COALESCE(?, instrumental_url), guide_vocal_url = COALESCE(?, guide_vocal_url), guide_access_token = COALESCE(?, guide_access_token), voice_conversion_url = COALESCE(?, voice_conversion_url), provenance_json = COALESCE(?, provenance_json) WHERE id = ?"
  );
  const updateTrack = await db.prepare(
    "UPDATE tracks SET status = ?, updated_at = ? WHERE id = ?"
  );
  const updateHold = await db.prepare(
    "UPDATE billing_holds SET status = ?, resolved_at = ? WHERE id = ?"
  );
  const getHold = await db.prepare("SELECT * FROM billing_holds WHERE id = ?");
  const refundCredits = await db.prepare(
    "UPDATE entitlements SET credits_balance = credits_balance + ?, updated_at = ? WHERE user_id = ?"
  );
  const updateUserRisk = await db.prepare("UPDATE users SET risk_level = ? WHERE id = ?");
  const insertAuditLog = await db.prepare(
    "INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const updateTrackVersionCover = await db.prepare(
    "UPDATE track_versions SET cover_image_url = ?, cover_image_small_url = ?, cover_image_large_url = ? WHERE id = ?"
  );

  function getErrorInfo(err) {
    const rawMessage = err && err.message ? String(err.message) : "unknown_error";

    if (rawMessage.startsWith("E302_PROVIDER_POLICY_ERROR:")) {
      const detail = rawMessage.replace("E302_PROVIDER_POLICY_ERROR:", "").trim();
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
        message: detail || "Music generation failed due to lyrics policy. Please adjust the highlighted words and try again.",
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
      const detail = rawMessage.replace("E302_SUNO_AUDIO_NOT_READY:", "").trim();
      return {
        code: "E302_SUNO_INCOMPLETE_OUTPUT",
        message:
          detail ||
          "Suno returned an audio URL, but the file was not finalized yet. Please retry to continue the same task.",
      };
    }

    if (rawMessage.startsWith("E302_SUNO_INCOMPLETE_OUTPUT:")) {
      const detail = rawMessage.replace("E302_SUNO_INCOMPLETE_OUTPUT:", "").trim();
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
        message: detail || "Generated output quality was too low. Please retry with a stronger style instruction.",
      };
    }

    if (rawMessage.startsWith("E301_ELEVENLABS_VALIDATION:")) {
      const detail = rawMessage.replace("E301_ELEVENLABS_VALIDATION:", "").trim();
      return {
        code: "E301_ELEVENLABS_VALIDATION",
        message: detail || "Music prompt validation failed. Please adjust style instructions and retry.",
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
          userMessage = "Music service temporarily unavailable. Please try again.";
          break;
        case "503":
          userMessage = "Music service is overloaded. Please try again later.";
          break;
        case "504":
          userMessage = "Music service timed out. Please try again.";
          break;
        case "429":
          userMessage = "Too many requests. Please wait a moment and try again.";
          break;
        case "timeout":
          userMessage = "Music service request timed out. Please try again.";
          break;
        case "network":
          userMessage = "Network error. Please check your connection and try again.";
          break;
        default:
          // For other errors, use a clean message if available, otherwise generic
          userMessage = detail.length < 100 && !detail.includes("<") ? detail : "An error occurred. Please try again.";
      }

      return { code: `provider_error_${status}`, message: userMessage };
    }

    // Handle other error formats
    const code = rawMessage.includes(":") ? rawMessage.split(":")[0] : rawMessage;
    const cleanMessage = rawMessage.length < 150 ? rawMessage : "An error occurred. Please try again.";
    return { code, message: cleanMessage };
  }

  function isNonRetryablePolicyError(err) {
    const rawMessage = err && err.message ? String(err.message) : "";
    if (!rawMessage) {
      return false;
    }
    return (
      rawMessage.includes("E302_PROVIDER_POLICY_ERROR") ||
      rawMessage.includes("E302_SUNO_POLICY_ERROR") ||
      rawMessage.includes("E302_QUALITY_GATE_FAILED") ||
      rawMessage.includes("E301_ELEVENLABS_VALIDATION") ||
      isSunoPolicyError(rawMessage)
    );
  }

  function isProviderRateLimitError(err) {
    const message = err && err.message ? String(err.message) : "";
    return message.startsWith("provider_error:429:");
  }

  function getRetryAfterSeconds(err, attemptNumber = 1) {
    const message = err && err.message ? String(err.message) : "";
    if (
      message.includes("E302_SUNO_INCOMPLETE_OUTPUT") ||
      message.includes("E302_SUNO_AUDIO_NOT_READY")
    ) {
      const safeAttempt = Math.max(1, Number(attemptNumber) || 1);
      return Math.min(120, 15 * safeAttempt);
    }
    if (!message.startsWith("provider_error:429:")) {
      return null;
    }
    const body = message.split(":").slice(2).join(":");
    const safeAttempt = Math.max(1, Number(attemptNumber) || 1);

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
      console.warn(`[JobRunner] Could not parse retry_after from rate limit response: ${body.slice(0, 100)}`);
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
      return Math.max(configuredMaxAttempts, 8);
    }
    if (!isProviderRateLimitError(err)) {
      return configuredMaxAttempts;
    }
    // Rate limits are transient. Allow more retries with spread-out backoff
    // to avoid immediate DLQ on burst throttling.
    return Math.max(configuredMaxAttempts, 6);
  }

  async function releaseHoldIfNeeded({ track, trackVersion, now, reason }) {
    if (!track || !trackVersion || !trackVersion.billing_hold_id) {
      return;
    }
    const hold = await getHold.get(trackVersion.billing_hold_id);
    if (!hold || hold.status !== "held") {
      return;
    }
    await updateHold.run("released", now, hold.id);
    await refundCredits.run(hold.credits_held, now, hold.user_id);
    await insertAuditLog.run(
      crypto.randomUUID(),
      hold.user_id,
      "billing_hold_released",
      "billing_hold",
      hold.id,
      JSON.stringify({
        reason: reason || "job_failed",
        track_version_id: trackVersion.id,
      }),
      now
    );
  }

  const stepHandlers = {
    moderation: ({ track, trackVersion }) => {
      if (trackVersion.moderation_status) {
        return { moderation_status: trackVersion.moderation_status };
      }
      const lyrics = parseJson(trackVersion.lyrics_json, null, "moderation_lyrics");
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
        return { lyrics_json: trackVersion.lyrics_json };
      }

      try {
        const result = await generateLyrics({
          title: track.title,
          recipient_name: track.recipient_name,
          message: track.message,
          style: track.style,
          occasion: track.occasion,
        });
        const compliance = sanitizeLyricsForAllMusicProviders(result.lyrics);
        if (compliance.changed) {
          console.warn(
            `[JobRunner] Lyrics compliance sanitizer applied ${compliance.change_count} edit(s) across providers`
          );
        }
        if (compliance.blocked) {
          const blockedTerms = compliance.reports
            .flatMap((report) => report.violation_terms || [])
            .filter(Boolean)
            .slice(0, 8);
          throw new Error(
            `E302_PROVIDER_POLICY_ERROR: Generated lyrics still contain restricted terms (${blockedTerms.join(", ") || "unknown"}).`
          );
        }
        const lyricsProvenance = mergeProvenanceJson(trackVersion.provenance_json, {
          lyrics: {
            compliance_sanitized: compliance.changed,
            compliance_change_count: compliance.change_count,
            compliance_reports: compliance.reports,
          },
          timeline: compliance.changed
            ? [
                {
                  at: toIsoNow(),
                  step: "lyrics",
                  event: "lyrics_policy_sanitized",
                  change_count: compliance.change_count,
                },
              ]
            : [],
        });

        return {
          lyrics_json: toJson(compliance.lyrics),
          lyrics_status: result.lyrics_status,
          lyrics_updated_at: new Date().toISOString(),
          provenance_json: lyricsProvenance,
        };
      } catch (err) {
        if (err && (err.code === "AI_UNAVAILABLE" || err.message === "AI_UNAVAILABLE")) {
          throw new Error("E201_LYRICS_ERROR: AI_UNAVAILABLE");
        }
        throw err;
      }
    },

    music_plan: async ({ track, trackVersion }) => {
      const musicConfig = await getMusicProviderConfig({ requestedStyle: track.style });
      const runtimeMusicConfig = musicConfig?.runtimeConfig || {
        elevenlabs_generation_mode: "composition_plan",
        style_overrides: {},
      };
      if (musicConfig?.routing) {
        console.log(
          `[JobRunner] Music provider routing: style=${musicConfig.routing.style} requested=${musicConfig.routing.requested_provider} resolved=${musicConfig.routing.provider} support=${musicConfig.routing.support} reason=${musicConfig.routing.reason}`
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
      const renderContract = buildRenderContract({
        provider: plan.provider_resolved || musicConfig?.provider || null,
        voiceMode: track.voice_mode,
      });
      plan.render_contract = renderContract;
      const provenance_json = mergeProvenanceJson(trackVersion?.provenance_json || null, {
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
            at: toIsoNow(),
            step: "music_plan",
            event: "music_plan_built",
            provider: plan.provider_resolved || musicConfig?.provider || null,
            style: plan.style,
            generation_mode: plan.generation_mode || "composition_plan",
            voice_mode: renderContract.voice_mode,
            pipeline: renderContract.pipeline,
          },
        ],
      });
      return { music_plan_json: toJson(plan), provenance_json };
    },

    instrumental: async ({ track, trackVersion, job }) => {
      const versionDir = getVersionDir(storageDir, track, trackVersion);
      const instFile = path.join(versionDir, "inst_preview.mp3");

      // Reuse existing file if present (saves API credits)
      if (fs.existsSync(instFile)) {
        console.log(`[JobRunner] Reusing existing instrumental: inst_preview.mp3`);
        return {};
      }

      const lyrics = parseJson(trackVersion.lyrics_json, null, "instrumental_lyrics");
      const musicPlan = parseJson(trackVersion.music_plan_json, null, "instrumental_music_plan");
      const renderContract = resolveRenderContract({ track, musicPlan });
      if (!lyrics) {
        throw new Error("E302_WORKFLOW_ERROR: lyrics_json is required before instrumental step");
      }

      const pinnedProvider = renderContract.provider_locked || musicPlan?.provider_resolved || null;
      const musicConfig = await getMusicProviderConfig({
        requestedStyle: musicPlan?.style || track.style,
        pinnedProvider,
      });
      const routingMetadata = sanitizeProviderRoutingForContract(musicConfig?.routing || null, renderContract);
      const policyPreflight = musicConfig
        ? sanitizeLyricsForProviderPolicy({
            lyrics,
            provider: musicConfig.provider,
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
            violation_terms: summarizePolicyTerms(policyPreflight.violations || [], 8),
            violation_count: Array.isArray(policyPreflight.violations)
              ? policyPreflight.violations.length
              : 0,
          }
        : null;

      if (policyPreflight?.changed) {
        console.warn(
          `[JobRunner] Policy preflight adjusted lyrics for provider=${musicConfig.provider} (${policyPreflight.change_count} edits, passes=${policyPreflight.rewrite_passes})`
        );
        logSanitizerIntervention({
          provider: musicConfig.provider,
          changeCount: policyPreflight.change_count,
          rewritePasses: policyPreflight.rewrite_passes,
          violationTerms: summarizePolicyTerms(policyPreflight.violations || [], 8),
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
          rejectedTerms: summarizePolicyTerms(policyPreflight.violations || [], 8),
          lyricsHash: lyricsHashSha256(trackVersion.lyrics_json),
          style: musicPlan?.style || track.style,
          step: "instrumental",
          trackId: track.id,
        });
        throw buildPolicyPreflightError(policyPreflight);
      }

      if (musicConfig && musicConfig.provider === "suno") {
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
          });
          if (sunoResult?.pending) {
            return sunoResult;
          }
          const providerAudioUrl = sunoResult?.instrumental_url || sunoResult?.guide_vocal_url || null;
          const provenance_json = mergeProvenanceJson(trackVersion.provenance_json, {
            music: {
              ...(parseJson(trackVersion.provenance_json, {}, "prov_preview_music_suno")?.music || {}),
              provider: musicConfig.provider,
              routing: routingMetadata,
              render_contract: renderContract,
              provider_audio_url: providerAudioUrl || getProviderAudioUrl(trackVersion),
              policy_preflight: policyPreflightMeta || null,
            },
            timeline: [
              policyPreflightMeta
                ? {
                    at: toIsoNow(),
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
                at: toIsoNow(),
                step: "instrumental",
                event: "music_generated",
                provider: musicConfig.provider,
                pipeline: renderContract.pipeline,
              },
            ].filter(Boolean),
          });
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
          if (String(sunoErr?.message || "").includes("E302_SUNO_INCOMPLETE_OUTPUT")) {
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
                `[JobRunner] Recovered Suno output from existing task for track ${track.id} after incomplete-output error`
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
              await updateJobExternalTask.run(taskId, toJson(payload), stamp, stamp, job.id, runnerId);
            }
          : null;
        const result = await durabilityService.executeWithDurability({
          provider: musicConfig.provider === "suno" ? PROVIDERS.SUNO : PROVIDERS.ELEVENLABS,
          fn: () => renderWithProvider({
            storageDir,
            track,
            trackVersion,
            kind: "preview",
            providerConfig: musicConfig,
            lyrics: lyricsForProvider,
            musicPlan,
            onTaskId,
          }),
        });
        const providerMetadata = result?.raw || {};
        const providerAudioUrl = extractProviderAudioUrl(providerMetadata);
        const useGuideUrl = renderContract.pipeline === "guide_tts_and_voice_convert";
        const provenance_json = mergeProvenanceJson(trackVersion.provenance_json, {
          music: {
            ...(parseJson(trackVersion.provenance_json, {}, "prov_preview_music")?.music || {}),
            provider: musicConfig.provider,
            routing: routingMetadata,
            render_contract: renderContract,
            provider_audio_url: providerAudioUrl || getProviderAudioUrl(trackVersion),
            generation_mode:
              providerMetadata.generation_mode ||
              musicPlan?.generation_mode ||
              musicConfig?.runtimeConfig?.elevenlabs_generation_mode ||
              "composition_plan",
            model_id: providerMetadata.model_id || null,
            plan_endpoint: providerMetadata.plan_endpoint || null,
            compose_endpoint: providerMetadata.compose_endpoint || null,
            composition_plan_summary: providerMetadata.composition_plan_summary || null,
            response_bytes: providerMetadata.response_bytes || null,
            policy_preflight: policyPreflightMeta || null,
          },
          timeline: [
            policyPreflightMeta
              ? {
                  at: toIsoNow(),
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
              at: toIsoNow(),
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
        });
        return {
          instrumental_url: providerAudioUrl || result?.raw?.instrumental_url || null,
          guide_vocal_url: useGuideUrl ? (result?.raw?.guide_vocal_url || null) : null,
          provider_routing: routingMetadata,
          provenance_json,
        };
      }

      renderInstrumental({ storageDir, track, trackVersion, kind: "preview" });
      renderGuideVocal({ storageDir, track, trackVersion, kind: "preview" });
      return {};
    },

    instrumental_full: async ({ track, trackVersion, job }) => {
      const lyrics = parseJson(trackVersion.lyrics_json, null, "instrumental_full_lyrics");
      const musicPlan = parseJson(trackVersion.music_plan_json, null, "instrumental_full_music_plan");
      const renderContract = resolveRenderContract({ track, musicPlan });
      if (!lyrics) {
        throw new Error("E302_WORKFLOW_ERROR: lyrics_json is required before instrumental_full step");
      }

      const pinnedProvider = renderContract.provider_locked || musicPlan?.provider_resolved || null;
      const musicConfig = await getMusicProviderConfig({
        requestedStyle: musicPlan?.style || track.style,
        pinnedProvider,
      });
      const routingMetadata = sanitizeProviderRoutingForContract(musicConfig?.routing || null, renderContract);
      const policyPreflight = musicConfig
        ? sanitizeLyricsForProviderPolicy({
            lyrics,
            provider: musicConfig.provider,
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
            violation_terms: summarizePolicyTerms(policyPreflight.violations || [], 8),
            violation_count: Array.isArray(policyPreflight.violations)
              ? policyPreflight.violations.length
              : 0,
          }
        : null;

      if (policyPreflight?.changed) {
        console.warn(
          `[JobRunner] Policy preflight adjusted lyrics for provider=${musicConfig.provider} (${policyPreflight.change_count} edits, passes=${policyPreflight.rewrite_passes})`
        );
        logSanitizerIntervention({
          provider: musicConfig.provider,
          changeCount: policyPreflight.change_count,
          rewritePasses: policyPreflight.rewrite_passes,
          violationTerms: summarizePolicyTerms(policyPreflight.violations || [], 8),
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
          rejectedTerms: summarizePolicyTerms(policyPreflight.violations || [], 8),
          lyricsHash: lyricsHashSha256(trackVersion.lyrics_json),
          style: musicPlan?.style || track.style,
          step: "instrumental_full",
          trackId: track.id,
        });
        throw buildPolicyPreflightError(policyPreflight);
      }

      if (musicConfig && musicConfig.provider === "suno") {
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
          });
          if (sunoResult?.pending) {
            return sunoResult;
          }
          const providerAudioUrl = sunoResult?.instrumental_url || sunoResult?.guide_vocal_url || null;
          const provenance_json = mergeProvenanceJson(trackVersion.provenance_json, {
            music: {
              ...(parseJson(trackVersion.provenance_json, {}, "prov_full_music_suno")?.music || {}),
              provider: musicConfig.provider,
              routing: routingMetadata,
              render_contract: renderContract,
              provider_audio_url: providerAudioUrl || getProviderAudioUrl(trackVersion),
              policy_preflight: policyPreflightMeta || null,
            },
            timeline: [
              policyPreflightMeta
                ? {
                    at: toIsoNow(),
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
                at: toIsoNow(),
                step: "instrumental_full",
                event: "music_generated",
                provider: musicConfig.provider,
                pipeline: renderContract.pipeline,
              },
            ].filter(Boolean),
          });
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
          if (String(sunoErr?.message || "").includes("E302_SUNO_INCOMPLETE_OUTPUT")) {
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
                `[JobRunner] Recovered Suno full output from existing task for track ${track.id} after incomplete-output error`
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
              await updateJobExternalTask.run(taskId, toJson(payload), stamp, stamp, job.id, runnerId);
            }
          : null;
        const result = await durabilityService.executeWithDurability({
          provider: musicConfig.provider === "suno" ? PROVIDERS.SUNO : PROVIDERS.ELEVENLABS,
          fn: () => renderWithProvider({
            storageDir,
            track,
            trackVersion,
            kind: "full",
            providerConfig: musicConfig,
            lyrics: lyricsForProvider,
            musicPlan,
            onTaskId,
          }),
        });
        const providerMetadata = result?.raw || {};
        const providerAudioUrl = extractProviderAudioUrl(providerMetadata);
        const useGuideUrl = renderContract.pipeline === "guide_tts_and_voice_convert";
        const provenance_json = mergeProvenanceJson(trackVersion.provenance_json, {
          music: {
            ...(parseJson(trackVersion.provenance_json, {}, "prov_full_music")?.music || {}),
            provider: musicConfig.provider,
            routing: routingMetadata,
            render_contract: renderContract,
            provider_audio_url: providerAudioUrl || getProviderAudioUrl(trackVersion),
            generation_mode:
              providerMetadata.generation_mode ||
              musicPlan?.generation_mode ||
              musicConfig?.runtimeConfig?.elevenlabs_generation_mode ||
              "composition_plan",
            model_id: providerMetadata.model_id || null,
            plan_endpoint: providerMetadata.plan_endpoint || null,
            compose_endpoint: providerMetadata.compose_endpoint || null,
            composition_plan_summary: providerMetadata.composition_plan_summary || null,
            response_bytes: providerMetadata.response_bytes || null,
            policy_preflight: policyPreflightMeta || null,
          },
          timeline: [
            policyPreflightMeta
              ? {
                  at: toIsoNow(),
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
              at: toIsoNow(),
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
        });
        return {
          instrumental_url: providerAudioUrl || result?.raw?.instrumental_url || null,
          guide_vocal_url: useGuideUrl ? (result?.raw?.guide_vocal_url || null) : null,
          provider_routing: routingMetadata,
          provenance_json,
        };
      }

      renderInstrumental({ storageDir, track, trackVersion, kind: "full" });
      renderGuideVocal({ storageDir, track, trackVersion, kind: "full" });
      return {};
    },

    guide_vocal: async ({ track, trackVersion }) => {
      const musicPlan = parseJson(trackVersion.music_plan_json, null, "guide_vocal_music_plan");
      const renderContract = resolveRenderContract({ track, musicPlan });
      if (shouldSkipStep("guide_vocal", renderContract.pipeline)) {
        console.log(
          `[JobRunner] Skipping guide_vocal for track ${track.id}: pipeline=${renderContract.pipeline}`
        );
        return {};
      }

      const versionDir = getVersionDir(storageDir, track, trackVersion);
      ensureDir(versionDir);
      const token =
        trackVersion.guide_access_token || crypto.randomBytes(16).toString("hex");
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
        pinnedProvider: renderContract.provider_locked || musicPlan?.provider_resolved || null,
      });
      const hasTtsConfig = providerConfig.elevenlabs?.ttsVoiceId && providerConfig.elevenlabs?.apiKey;
      if (musicConfig && hasTtsConfig) {
        const lyrics = parseJson(trackVersion.lyrics_json, null, "guide_vocal_lyrics");
        // For preview, only use chorus section to reduce TTS API costs
        const text = lyricsToText(lyrics, { chorusOnly: true });
        if (!text) {
          throw new Error("E301_GUIDE_VOCAL_MISSING: Lyrics unavailable for guide vocal");
        }
        console.log(`[JobRunner] Generating TTS guide vocal (chorus only) for track ${track.id}`);
        await durabilityService.executeWithDurability({
          provider: PROVIDERS.ELEVENLABS,
          fn: () => generateSpeech({
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

      console.log(`[JobRunner] Using placeholder guide vocal for track ${track.id} (no live provider)`);
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
      const musicPlan = parseJson(trackVersion.music_plan_json, null, "guide_vocal_full_music_plan");
      const renderContract = resolveRenderContract({ track, musicPlan });
      if (shouldSkipStep("guide_vocal_full", renderContract.pipeline)) {
        console.log(
          `[JobRunner] Skipping guide_vocal_full for track ${track.id}: pipeline=${renderContract.pipeline}`
        );
        return {};
      }

      const versionDir = getVersionDir(storageDir, track, trackVersion);
      ensureDir(versionDir);
      const token =
        trackVersion.guide_access_token || crypto.randomBytes(16).toString("hex");
      const guideUrl = `${streamBaseUrl}/guide/${trackVersion.id}?token=${token}&kind=full`;

      // TTS is always via ElevenLabs (Suno doesn't do TTS)
      const musicConfig = await getMusicProviderConfig({
        requestedStyle: musicPlan?.style || track.style,
        pinnedProvider: renderContract.provider_locked || musicPlan?.provider_resolved || null,
      });
      const hasTtsConfig = providerConfig.elevenlabs?.ttsVoiceId && providerConfig.elevenlabs?.apiKey;
      if (musicConfig && hasTtsConfig) {
        const lyrics = parseJson(trackVersion.lyrics_json, null, "guide_vocal_full_lyrics");
        const text = lyricsToText(lyrics);
        if (!text) {
          throw new Error("E301_GUIDE_VOCAL_MISSING: Lyrics unavailable for guide vocal");
        }
        console.log(`[JobRunner] Generating TTS full guide vocal for track ${track.id}`);
        const fileName = "guide_vocal_full.mp3";
        const filePath = path.join(versionDir, fileName);
        await durabilityService.executeWithDurability({
          provider: PROVIDERS.ELEVENLABS,
          fn: () => generateSpeech({
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
        console.log(`[JobRunner] Reusing existing voice conversion: user_vocal.wav`);
        return { voice_conversion_url: null };
      }

      const musicPlan = parseJson(trackVersion.music_plan_json, null, "voice_convert_music_plan");
      const renderContract = resolveRenderContract({ track, musicPlan });
      if (shouldSkipStep("voice_convert", renderContract.pipeline)) {
        console.log(
          `[JobRunner] Skipping voice_convert for track ${track.id}: pipeline=${renderContract.pipeline}`
        );
        return {};
      }

      const isPersonalized = renderContract.voice_mode === "user_voice";
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
            fn: () => convertVoice({
              storageDir,
              track,
              trackVersion,
              kind: "preview",
              providerConfig: providerConfig.replicate,
              inputUrl: guideUrl,
            }),
          });
          return { voice_conversion_url: result?.output_url || guideUrl || null };
        }
        const ensured = await ensureUserVocalFromGuide({ versionDir, kind: "preview" });
        if (!ensured) {
          throw new Error("E301_GUIDE_VOCAL_MISSING: guide vocal required for AI voice conversion");
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
          } required for voice conversion`
        );
      }

      // Read Seed-VC params from feature flags (fallback to env/default)
      // getFeatureFlag returns defaults on DB errors, so this is resilient
      const cfgRate = await getFeatureFlag(db, 'seedvc_cfg_rate') ?? config.SEEDVC_CFG_RATE;
      const diffusionSteps = await getFeatureFlag(db, 'seedvc_diffusion_steps_preview') ?? 60;

      // Timbre blend: use gentler cfg_rate when blending is active
      const blendRatio = await getFeatureFlag(db, 'timbre_blend_ratio') ?? 0.25;
      const timbreCfgRate = await getFeatureFlag(db, 'timbre_cfg_rate') ?? 0.35;
      const effectiveCfgRate = blendRatio < 1.0 ? timbreCfgRate : cfgRate;
      console.log(`[JobRunner] Voice conversion params: cfgRate=${effectiveCfgRate}` +
        (blendRatio < 1.0 ? ` (timbre blend mode, blend=${blendRatio})` : '') +
        `, diffusionSteps=${diffusionSteps}`);

      const result = await durabilityService.executeWithDurability({
        provider: PROVIDERS.SEEDVC,
        fn: () => convertVoice({
          storageDir,
          track,
          trackVersion,
          kind: "preview",
          providerConfig: providerConfig.replicate,
          inputUrl: conversionSourceUrl,
          // Seed-VC config for personalized mode
          // Higher diffusion steps = better quality but slower (25=fast, 50=balanced, 100=best)
          seedvcConfig: {
            timeoutMs: providerConfig.replicate?.timeoutMs || 300000,
            hfToken: providerConfig.hfToken || null,
            replicateToken: providerConfig.replicate?.token || null, // For Demucs stem separation
            demucsModel: providerConfig.replicate?.demucsModel || null,
            demucsShifts: providerConfig.replicate?.demucsShifts,
            params: {
              diffusionSteps,
              lengthAdjust: 1.0,
              cfgRate: effectiveCfgRate,
            },
          },
          db, // Pass db for voice profile validation
          storage: storageProvider, // Pass storage provider for S3/R2 enrollment files
        }),
      });
      return { voice_conversion_url: result?.output_url || null };
    },

    voice_convert_sections: async ({ track, trackVersion }) => {
      const versionDir = getVersionDir(storageDir, track, trackVersion);
      const outputFile = path.join(versionDir, "user_vocal_full.wav");

      // Reuse existing file if present (saves API credits)
      if (fs.existsSync(outputFile)) {
        console.log(`[JobRunner] Reusing existing voice conversion: user_vocal_full.wav`);
        return { voice_conversion_url: null };
      }

      const musicPlan = parseJson(trackVersion.music_plan_json, null, "voice_convert_sections_music_plan");
      const renderContract = resolveRenderContract({ track, musicPlan });
      if (shouldSkipStep("voice_convert_sections", renderContract.pipeline)) {
        console.log(
          `[JobRunner] Skipping voice_convert_sections for track ${track.id}: pipeline=${renderContract.pipeline}`
        );
        return {};
      }

      const isPersonalized = renderContract.voice_mode === "user_voice";
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
            fn: () => convertVoice({
              storageDir,
              track,
              trackVersion,
              kind: "full",
              providerConfig: providerConfig.replicate,
              inputUrl: guideUrl,
            }),
          });
          return { voice_conversion_url: result?.output_url || guideUrl || null };
        }
        const ensured = await ensureUserVocalFromGuide({ versionDir, kind: "full" });
        if (!ensured) {
          throw new Error("E301_GUIDE_VOCAL_MISSING: guide vocal required for AI voice conversion");
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
          } required for voice conversion`
        );
      }

      // Read Seed-VC params from feature flags (fallback to env/default)
      // getFeatureFlag returns defaults on DB errors, so this is resilient
      const cfgRate = await getFeatureFlag(db, 'seedvc_cfg_rate') ?? config.SEEDVC_CFG_RATE;
      const diffusionSteps = await getFeatureFlag(db, 'seedvc_diffusion_steps_full') ?? 90;

      // Timbre blend: use gentler cfg_rate when blending is active
      const blendRatio = await getFeatureFlag(db, 'timbre_blend_ratio') ?? 0.25;
      const timbreCfgRate = await getFeatureFlag(db, 'timbre_cfg_rate') ?? 0.35;
      const effectiveCfgRate = blendRatio < 1.0 ? timbreCfgRate : cfgRate;
      console.log(`[JobRunner] Voice conversion params (full): cfgRate=${effectiveCfgRate}` +
        (blendRatio < 1.0 ? ` (timbre blend mode, blend=${blendRatio})` : '') +
        `, diffusionSteps=${diffusionSteps}`);

      const result = await durabilityService.executeWithDurability({
        provider: PROVIDERS.SEEDVC,
        fn: () => convertVoice({
          storageDir,
          track,
          trackVersion,
          kind: "full",
          providerConfig: providerConfig.replicate,
          inputUrl: conversionSourceUrl,
          // Seed-VC config for personalized mode
          // Higher diffusion steps = better quality but slower (25=fast, 50=balanced, 100=best)
          seedvcConfig: {
            timeoutMs: providerConfig.replicate?.timeoutMs || 300000,
            hfToken: providerConfig.hfToken || null,
            replicateToken: providerConfig.replicate?.token || null, // For Demucs stem separation
            demucsModel: providerConfig.replicate?.demucsModel || null,
            demucsShifts: providerConfig.replicate?.demucsShifts,
            params: {
              diffusionSteps,
              lengthAdjust: 1.0,
              cfgRate: effectiveCfgRate,
            },
          },
          db, // Pass db for voice profile validation
          storage: storageProvider, // Pass storage provider for S3/R2 enrollment files
        }),
      });
      return { voice_conversion_url: result?.output_url || null };
    },

    mix: async ({ track, trackVersion, workflow }) => {
      const versionDir = getVersionDir(storageDir, track, trackVersion);
      ensureDir(versionDir);

      const isFull = workflow === "full_render";
      const vocalFileName = isFull ? "user_vocal_full.wav" : "user_vocal.wav";
      const vocalPath = path.join(versionDir, vocalFileName);
      const mixPath = path.join(versionDir, "mix.wav");

      const musicPlan = parseJson(trackVersion.music_plan_json, null, "mix_music_plan");
      const renderContract = resolveRenderContract({ track, musicPlan });
      const isPersonalized = renderContract.voice_mode === "user_voice";
      const musicConfig = await getMusicProviderConfig({
        requestedStyle: musicPlan?.style || track.style,
        pinnedProvider: renderContract.provider_locked || musicPlan?.provider_resolved || null,
      });
      const providerAudioUrl = getProviderAudioUrl(trackVersion);

      if (!isPersonalized && renderContract.pipeline === "provider_complete_audio") {
        const providerLocalPath = path.join(versionDir, `${renderContract.provider_locked}_complete.mp3`);
        if (!fs.existsSync(providerLocalPath) && providerAudioUrl) {
          const { downloadToFile } = require("../providers/http");
          await downloadToFile(providerAudioUrl, providerLocalPath, 120000);
        }
        const providerFallbackPath = path.join(versionDir, isFull ? "inst_full.mp3" : "inst_preview.mp3");
        const sourcePath = fs.existsSync(providerLocalPath)
          ? providerLocalPath
          : fs.existsSync(providerFallbackPath)
            ? providerFallbackPath
            : null;
        if (!sourcePath) {
          throw new Error("E301_MISSING_INPUTS: Provider-complete audio missing for AI voice mix");
        }
        const { execFile } = require("child_process");
        const { promisify } = require("util");
        const execFileAsync = promisify(execFile);
        await execFileAsync("ffmpeg", ["-y", "-i", sourcePath, "-ar", "44100", "-ac", "2", mixPath]);
        console.log(
          `[Mix] AI voice: using provider-complete audio directly (provider=${renderContract.provider_locked})`
        );
        return {};
      }

      if (!isPersonalized && !fs.existsSync(vocalPath)) {
        const ensured = await ensureUserVocalFromGuide({ versionDir, kind: isFull ? "full" : "preview" });
        if (ensured) {
          console.log(`[Mix] AI voice: built missing vocal from guide for track ${track.id}`);
        }
      }

      const instBaseName = isFull ? "inst_full" : "inst_preview";

      // Personalized Suno: Demucs instrumental is REQUIRED (no silent fallback)
      if (isPersonalized && renderContract.provider_locked === "suno" && fs.existsSync(vocalPath)) {
        const separatedInstPath = path.join(versionDir, "stems", "instrumental.wav");
        if (!fs.existsSync(separatedInstPath)) {
          throw new Error(
            "E301_MISSING_STEMS: Demucs stem separation required for personalized Suno voice. " +
            "Voice conversion produces vocals-only; instrumental stems must exist."
          );
        }

        // Timbre blending: mix original AI vocals with converted vocals before final mix
        // Batch-fetch all blend flags in one query to avoid N+1
        const blendFlags = await getFeatureFlags(db, [
          'timbre_blend_ratio', 'timbre_blend_strategy',
          'spectral_crossover_low_hz', 'spectral_crossover_high_hz', 'spectral_mid_blend_ratio',
          'doubling_level', 'doubling_presence_cut_freq', 'doubling_presence_cut_gain',
          'formant_transfer_strength', 'formant_max_gain_db',
          'perceptual_ai_influence', 'perceptual_ducking_strength', 'perceptual_attack_ms', 'perceptual_release_ms',
        ]);
        const blendRatio = blendFlags['timbre_blend_ratio'] ?? 0.25;
        const blendStrategy = blendFlags['timbre_blend_strategy'] ?? 'amplitude';
        const originalVocalsPath = path.join(versionDir, "stems", "vocals.wav");
        let finalVocalPath = vocalPath;

        if (blendRatio < 1.0 && fs.existsSync(originalVocalsPath)) {
          const blendedPath = path.join(versionDir, "blended_vocal.wav");

          // Map strategy names to their flag-sourced params
          const strategyParamsMap = {
            spectral_crossover: {
              lowCrossover: blendFlags['spectral_crossover_low_hz'] ?? 300,
              highCrossover: blendFlags['spectral_crossover_high_hz'] ?? 3000,
              midBlendRatio: blendFlags['spectral_mid_blend_ratio'] ?? 0.30,
            },
            vocal_doubling: {
              doublingLevel: blendFlags['doubling_level'] ?? 0.12,
              presenceCutFreq: blendFlags['doubling_presence_cut_freq'] ?? 4000,
              presenceCutGain: blendFlags['doubling_presence_cut_gain'] ?? -8,
            },
            formant_transfer: {
              transferStrength: blendFlags['formant_transfer_strength'] ?? 0.5,
              maxGainDb: blendFlags['formant_max_gain_db'] ?? 12,
            },
            perceptual_primary: {
              aiInfluence: blendFlags['perceptual_ai_influence'] ?? 0.15,
              duckingStrength: blendFlags['perceptual_ducking_strength'] ?? 0.85,
              attackMs: blendFlags['perceptual_attack_ms'] ?? 10,
              releaseMs: blendFlags['perceptual_release_ms'] ?? 150,
            },
          };
          const strategyParams = strategyParamsMap[blendStrategy] || {};

          console.log(`[Mix] Timbre blending: strategy=${blendStrategy}, blend=${blendRatio}, params=${JSON.stringify(strategyParams)}`);
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
            console.error(`[Mix] Timbre blend (${blendStrategy}) failed, falling back to 100% converted:`, blendErr);
          }
        } else if (blendRatio < 1.0) {
          console.warn(`[Mix] Timbre blend requested but stems/vocals.wav missing — using 100% converted`);
        }

        console.log(`[Mix] Personalized voice: mixing ${blendRatio < 1.0 ? 'blended' : 'converted'} vocals with Demucs instrumental`);
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
          throw new Error("E301_MISSING_INPUTS: Vocal or instrumental missing for mix");
        }
        writeWav(mixPath, { durationSec: isFull ? 12 : 6, frequencyHz: 260 });
      }

      return {};
    },

    watermark: async ({ track, trackVersion, workflow }) => {
      const versionDir = getVersionDir(storageDir, track, trackVersion);
      ensureDir(versionDir);

      const isFull = workflow === "full_render";
      const musicPlan = parseJson(trackVersion.music_plan_json, null, "watermark_music_plan");
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
          console.error(`[JobRunner] HLS playlist creation failed for track ${track.id}:`, err.message);
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

      return {};
    },

    ready: async ({ track, trackVersion, workflow }) => {
      const runtimeConfig = await getRuntimeMusicRoutingConfig();
      const qualityThreshold = clampNumber(runtimeConfig.quality_threshold, 0, 100, 72);
      const maxRerolls = Math.max(0, Math.min(3, Number(runtimeConfig.max_rerolls ?? 1) || 0));
      const rerollEnabled = runtimeConfig.auto_reroll_enabled !== false;
      const musicPlan = parseJson(trackVersion.music_plan_json, null, "ready_music_plan");
      const provenanceState = parseJson(trackVersion.provenance_json, {}, "ready_provenance");
      const rerollCount = Number(provenanceState?.quality?.reroll_count || 0);
      const liveMusicProviderAvailable =
        Boolean(providerConfig?.elevenlabs?.live) || Boolean(providerConfig?.suno?.live);

      if (!liveMusicProviderAvailable) {
        const skippedQuality = {
          passed: true,
          skipped: true,
          reason: "live_music_provider_unavailable",
          threshold: qualityThreshold,
          total_score: 100,
        };
        const provenance_json = mergeProvenanceJson(trackVersion.provenance_json, {
          quality: {
            threshold: qualityThreshold,
            last_evaluation: skippedQuality,
            reroll_count: rerollCount,
          },
          timeline: [
            {
              at: toIsoNow(),
              step: "ready",
              event: "quality_gate_skipped",
            },
          ],
        });
        return { provenance_json, quality_gate: skippedQuality };
      }

      const qualityReport = await evaluateRenderQuality({
        track,
        trackVersion,
        workflowType: workflow,
        musicPlan,
        qualityThreshold,
      });

      const provenance_json = mergeProvenanceJson(trackVersion.provenance_json, {
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
            at: toIsoNow(),
            step: "ready",
            event: qualityReport.passed ? "quality_gate_passed" : "quality_gate_failed",
            score: qualityReport.total_score,
            threshold: qualityThreshold,
            reroll_count: rerollCount,
          },
        ],
      });

      if (qualityReport.passed) {
        return {
          provenance_json,
          quality_gate: qualityReport,
        };
      }

      if (rerollEnabled && rerollCount < maxRerolls) {
        const tightenedPlan = tightenMusicPlanForReroll(musicPlan, qualityReport);
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
  const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_JOBS || '3', 10);
  let activeJobs = 0;
  const processingJobs = new Set();

  // Extract job processing logic into separate async function
  const processJob = async (job) => {
    const now = new Date().toISOString();
    console.log(`[JobRunner] Processing job ${job.id}: type=${job.workflow_type}, step=${job.step}, step_index=${job.step_index}`);
    const steps = job.workflow_type === "full_render" ? FULL_STEPS : PREVIEW_STEPS;
    const stepIndex = job.step_index || 0;
    const progressPct = computeProgress(stepIndex, steps.length);
    const claim = await claimJob.run(runnerId, now, now, now, progressPct, now, job.id, now);
    if (claim.changes === 0) {
      return;
    }
    job.status = "running";
    const stepName = steps[stepIndex];
    if (!stepName) {
      const terminalUpdate = await updateJobStatus.run("completed", 100, now, now, job.id, runnerId);
      if (!terminalUpdate || terminalUpdate.changes === 0) {
        console.warn(`[JobRunner] Could not complete terminal job ${job.id}; lock ownership lost`);
      }
      return;
    }
    const stepUpdate = await updateJobStep.run(stepName, stepIndex, progressPct, now, now, job.id, runnerId);
    if (stepUpdate.changes === 0) {
      console.warn(`[JobRunner] Lost ownership of job ${job.id} during step update, skipping`);
      return;
    }
    const trackVersion = await getTrackVersion.get(job.track_version_id);
    const track = trackVersion ? await getTrack.get(trackVersion.track_id) : null;

      // Fail job if track or trackVersion was deleted during processing
      if (!track || !trackVersion) {
        console.error(`[JobRunner] Job ${job.id} failed: track or trackVersion not found (may have been deleted)`);
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
          runnerId
        );
        return;
      }

      // Emit render_start once per job when first claimed
      if (eventsService &&
        (job.workflow_type === "preview_render" || job.workflow_type === "full_render") &&
        !job.started_at
      ) {
        try {
          eventsService.emit("render_start", {
            userId: track.user_id,
            resourceType: "track_version",
            resourceId: trackVersion.id,
            metadata: {
              track_id: track.id,
              render_type: job.workflow_type === "full_render" ? "full" : "preview",
            },
          });
        } catch (eventErr) {
          console.warn(`[JobRunner] Failed to emit render_start for job ${job.id}:`, eventErr.message);
        }
      }

      let stepData = null;
      let isPending = false;
      if (track && trackVersion) {
        const handler = stepHandlers[stepName];
        if (handler) {
          try {
            const updates = await handler({ track, trackVersion, workflow: job.workflow_type, job });
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
                trackVersion.id
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
                  `[JobRunner] Failed to save checkpoint for job ${job.id} step ${stepName}: ${checkpointErr.message}`
                );
              }
            }
          } catch (err) {
            // Log the error for debugging
            console.error(`[JobRunner] Step ${stepName} failed for job ${job.id}:`, err.message || err);
            const maxAttempts = getEffectiveMaxAttempts(job, err);
            const attemptNumber = (job.attempts || 0) + 1;
            const nonRetryablePolicyError = isNonRetryablePolicyError(err);
            const retryAfter = getRetryAfterSeconds(err, attemptNumber);
            if (!nonRetryablePolicyError && retryAfter && attemptNumber < maxAttempts) {
              const nextAttemptAt = new Date(Date.now() + retryAfter * 1000).toISOString();
              console.warn(
                `[JobRunner] Retrying job ${job.id} after ${retryAfter}s (attempt ${attemptNumber}/${maxAttempts})`
              );
              await updateJobAttempt.run("queued", progressPct, now, nextAttemptAt, now, job.id, runnerId);
              return;
            }
            if (nonRetryablePolicyError || attemptNumber >= maxAttempts) {
              if (nonRetryablePolicyError) {
                const musicPlanForTelemetry = parseJson(trackVersion?.music_plan_json, null, "telemetry_music_plan");
                logProviderRejection({
                  provider: musicPlanForTelemetry?.provider_resolved || null,
                  errorCode: err?.message?.split(":")[0] || null,
                  errorStatus: "job_failed",
                  rejectedTerms: extractPolicyTermsFromMessage(err?.message || ""),
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
                runnerId
              );
              if (!failureUpdate || failureUpdate.changes === 0) {
                console.error(
                  `[JobRunner] Lost ownership while marking job ${job.id} failed; forcing terminal failure state`
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
                  job.id
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
                trackVersion.id
              );
              await updateTrack.run("failed", now, track.id);

              // Move to DLQ for debugging and potential reprocessing
              try {
                const dlq = getDLQService();
                await dlq.moveToDeadLetter({
                  jobId: job.id,
                  reason: `Max retries (${maxAttempts}) exceeded: ${errorInfo.message}`,
                });
                console.log(`[JobRunner] Moved job ${job.id} to DLQ after ${maxAttempts} failed attempts`);
              } catch (dlqErr) {
                // CRITICAL: DLQ insertion failed - update job to make this visible to operators
                console.error(`[JobRunner] CRITICAL: Failed to move job ${job.id} to DLQ:`, dlqErr.message);
                try {
                  await db.prepare(
                    "UPDATE jobs SET error_message = error_message || ' [DLQ_INSERT_FAILED: ' || ? || ']', updated_at = ? WHERE id = ?"
                  ).run(dlqErr.message, now, job.id);
                } catch (updateErr) {
                  console.error(`[JobRunner] Failed to update job ${job.id} with DLQ error:`, updateErr.message);
                }
              }

              releaseHoldIfNeeded({
                track,
                trackVersion,
                now,
                reason: "job_failed",
              });
            } else {
              await updateJobAttempt.run("queued", progressPct, now, null, now, job.id, runnerId);
            }
            return;
          }
        }
      }
      if (isPending) {
        const retryAfterSec = stepData?.retry_after_sec || sunoPollIntervalSec;
        const nextAttemptAt = new Date(Date.now() + retryAfterSec * 1000).toISOString();
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
          runnerId
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
          trackVersion.id
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
          now
        );
        releaseHoldIfNeeded({
          track,
          trackVersion,
          now,
          reason: "moderation_blocked",
        });
        return;
      }

      if (stepName === "ready" && stepData && stepData.reroll_requested) {
        const rerollStepName = job.workflow_type === "full_render" ? "instrumental_full" : "instrumental";
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
          runnerId
        );
        return;
      }

      if (stepName === "ready") {
        const trackVersionReady = await getTrackVersion.get(job.track_version_id);
        if (!trackVersionReady) {
          console.error(`[JobRunner] Job ${job.id} ready step: trackVersion ${job.track_version_id} not found`);
          await updateJobStatus.run("failed", 100, now, now, job.id, runnerId);
          return;
        }
        const trackReady = await getTrack.get(trackVersionReady.track_id);
        if (!trackReady) {
          console.error(`[JobRunner] Job ${job.id} ready step: track ${trackVersionReady.track_id} not found`);
          await updateJobStatus.run("failed", 100, now, now, job.id, runnerId);
          return;
        }
        const isFull = job.workflow_type === "full_render";
        const resolvedStreamBase =
          trackVersionReady.stream_base_url || streamBaseUrl;
        const url = `${resolvedStreamBase}/${isFull ? "full" : "preview"}/${trackVersionReady.id}.m4a`;
        const status = isFull ? "full_ready" : "preview_ready";
        const completionProvenance = mergeProvenanceJson(trackVersionReady.provenance_json, {
          render: {
            workflow: isFull ? "full_render" : "preview_render",
            completed_at: now,
            provider: parseJson(trackVersionReady.music_plan_json, {}, "ready_completion_music_plan")
              ?.provider_resolved || null,
          },
          timeline: [
            {
              at: toIsoNow(),
              step: "ready",
              event: "render_completed",
              workflow: isFull ? "full_render" : "preview_render",
            },
          ],
        });
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
          trackVersionReady.id
        );
        await updateTrack.run(isFull ? "ready" : "preview_ready", now, trackReady.id);
        if (isFull && trackVersionReady.billing_hold_id) {
          await updateHold.run("captured", now, trackVersionReady.billing_hold_id);
        }
        // Song deduction now happens at render_full request time via spendSong(),
        // not at completion. This prevents the double-charge that occurred when both
        // the endpoint (credits_balance) and runner (songs_remaining) deducted.
        await insertAuditLog.run(
          crypto.randomUUID(),
          trackReady.user_id,
          "render_completed",
          "track_version",
          trackVersionReady.id,
          JSON.stringify({ render_type: isFull ? "full" : "preview" }),
          now
        );
        writePlaceholderOutputs({
          storageDir,
          track: trackReady,
          trackVersion: { ...trackVersionReady, preview_url: url, full_url: url },
          kind: isFull ? "full" : "preview",
          devMode,
        });

        // Generate cover images (non-blocking - failure doesn't fail the render)
        if (isSharpAvailable()) {
          try {
            const versionDir = path.join(
              storageDir,
              "tracks",
              trackReady.user_id,
              trackReady.id,
              `v${trackVersionReady.version_num}`
            );
            const coverResult = await generateCover({
              versionDir,
              track: trackReady,
              trackVersion: trackVersionReady,
              streamBaseUrl: resolvedStreamBase,
            });
            if (coverResult) {
              await updateTrackVersionCover.run(
                coverResult.coverUrl,
                coverResult.smallUrl,
                coverResult.largeUrl,
                trackVersionReady.id
              );
            }
          } catch (coverErr) {
            // Cover generation failure is non-fatal - track still plays without cover
            console.warn(`[JobRunner] Cover generation failed for track ${trackReady.id}:`, coverErr.message);
          }
        }

        // Upload to S3 if storage provider is configured
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
            const isProduction = process.env.NODE_ENV === "production";
            console.error(`[JobRunner] S3 upload failed for track ${trackReady.id}:`, {
              error: s3Error.message,
              willRetry: isProduction,
              trackId: trackReady.id,
              versionNum: trackVersionReady.version_num,
            });

            if (isProduction) {
              // Mark job as failed with retry_count increment so it can be retried
              const updateJobFailureS3 = await db.prepare(`
                UPDATE jobs SET status = ?, step = ?, step_index = ?, error_code = ?, error_message = ?, retry_count = retry_count + 1, updated_at = ?
                WHERE id = ? AND locked_by = ?
              `);
              await updateJobFailureS3.run("failed", "ready", PREVIEW_STEPS.indexOf("ready"), "S3_UPLOAD_FAILED", s3Error.message, now, job.id, runnerId);
              return; // Don't mark as completed
            }
            // In dev mode, warn loudly that this would fail in production
            console.warn(`[JobRunner] ⚠️  DEV MODE: S3 upload failed, using local files only.`);
            console.warn(`[JobRunner] ⚠️  This render would FAIL in production! Fix S3 configuration.`);
            console.warn(`[JobRunner] S3 Error: ${s3Error.message}`);
          }
        }

        // Clean up intermediate files only after fully successful render (including S3)
        // In dev mode with S3 failure, keep temp files for debugging
        if (s3UploadSucceeded) {
          const versionDir = path.join(
            storageDir,
            "tracks",
            trackReady.user_id,
            trackReady.id,
            `v${trackVersionReady.version_num}`
          );
          cleanupTempFiles(versionDir);
        }

        if (eventsService) {
          try {
            eventsService.emit("render_ready", {
              userId: trackReady.user_id,
              resourceType: "track_version",
              resourceId: trackVersionReady.id,
              metadata: { render_type: isFull ? "full" : "preview", track_id: trackReady.id },
            });
          } catch (eventErr) {
            console.warn(`[JobRunner] Failed to emit render_ready for job ${job.id}:`, eventErr.message);
          }
        }

        // Send push notification to user's devices (fire-and-forget)
        if (pushNotification.isConfigured()) {
          try {
            const devices = await db.prepare(
              "SELECT push_token FROM devices WHERE user_id = ? AND push_token IS NOT NULL"
            ).all(trackReady.user_id);
            for (const device of devices || []) {
              if (device.push_token) {
                pushNotification.sendRenderComplete(
                  device.push_token,
                  trackReady.id,
                  trackReady.title
                ).catch(err => {
                  console.warn(`[JobRunner] Push notification failed:`, err.message);
                });
              }
            }
          } catch (pushErr) {
            // Push notification failure should not affect job completion
            console.warn(`[JobRunner] Failed to send push notifications:`, pushErr.message);
          }
        }

        await updateJobStatus.run("completed", 100, now, now, job.id, runnerId);
        return;
      }

      // Set status back to 'queued' so next tick can pick up the next step.
      // Keep terminal transitions (blocked/ready) above while lock ownership is held.
      const nextStepIndex = stepIndex + 1;
      const nextStepName = steps[nextStepIndex] || stepName;
      const nextProgress = computeProgress(nextStepIndex, steps.length);
      await updateJob.run(
        "queued",
        nextStepName,
        nextStepIndex,
        stepData ? toJson(stepData) : null,
        nextProgress,
        now,
        now,
        job.id,
        runnerId
      );
  };

  // Tick function dispatches jobs to available concurrent slots
  const tick = async () => {
    const now = new Date().toISOString();
    const availableSlots = MAX_CONCURRENT - activeJobs;
    if (availableSlots <= 0) return;

    // Get queued jobs with FOR UPDATE SKIP LOCKED to prevent race conditions
    // The LIMIT ensures we only lock jobs we can actually process
    const jobs = await selectJobs.all(now, availableSlots);
    const jobsToProcess = jobs
      .filter(j => !processingJobs.has(j.id));

    if (jobsToProcess.length > 0) {
      console.log(`[JobRunner] Found ${jobs.length} queued job(s), processing ${jobsToProcess.length} (${activeJobs}/${MAX_CONCURRENT} slots in use)`);
    }

    for (const job of jobsToProcess) {
      processingJobs.add(job.id);
      activeJobs++;

      // Process job in background (don't await)
      processJob(job)
        .catch(err => console.error(`[JobRunner] Job ${job.id} error:`, err))
        .finally(() => {
          activeJobs--;
          processingJobs.delete(job.id);
        });
    }
  };

  const timer = setInterval(async () => {
    try {
      await tick();
    } catch (err) {
      console.error("[JobRunner] Unhandled error in tick:", err);
    }
  }, intervalMs);
  return {
    tick,
    stop: () => {
      clearInterval(timer);
      clearInterval(recoveryTimer);
    },
    // Expose concurrent job stats for health checks
    getActiveJobs: () => activeJobs,
    getMaxConcurrent: () => MAX_CONCURRENT,
    getProcessingJobIds: () => [...processingJobs],
    // Expose workflow hardening services for health checks and admin
    getCircuitBreakerStats: () => circuitBreaker.getAllStats(),
    getCircuitBreakerState: (provider) => circuitBreaker.getState(provider),
    isCircuitOpen: (provider) => circuitBreaker.isOpen(provider),
    getDLQService,
    getDurabilityService: () => durabilityService,
  };
}

module.exports = {
  startJobRunner,
};
