const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const config = require("../config");
const { generateLyrics } = require("../providers/lyrics");
const { moderationCheck } = require("../providers/moderation");
const { writeWav } = require("../utils/audio");
const { ensureDir, parseJson, toJson, getVersionDir } = require("../utils/common");
const { buildMusicPlan, renderInstrumental, renderGuideVocal, renderWithProvider } = require("../providers/music");
const { submitSunoTask, pollSunoTaskOnce, downloadSunoAudio, logSunoCreditUsage } = require("../providers/suno");
const { generateSpeech, lyricsToText } = require("../providers/elevenlabs");
const { convertVoice } = require("../providers/voice");
const { runFFmpeg, mixTracks, encodeToAAC } = require("../utils/ffmpeg");
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
const { getFeatureFlag } = require("../services/feature-flags");
const pushNotification = require("../services/push-notification");

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
  subscriptionManager = null,
  eventsService = null,
  durabilityConfig = {},
}) {
  const runnerId = workerId || crypto.randomUUID();
  const sunoPollIntervalSec = 10;

  // Initialize workflow hardening services
  const circuitBreaker = new CircuitBreaker({
    failureThreshold: durabilityConfig.failureThreshold || 5,
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
  // Helper to get active music provider config (elevenlabs or suno)
  function getMusicProviderConfig() {
    if (providerConfig.suno?.live) {
      return providerConfig.suno;
    }
    if (providerConfig.elevenlabs?.live) {
      return providerConfig.elevenlabs;
    }
    return null;
  }

  // Helper to handle Suno task polling with circuit breaker
  async function pollOrSubmitSunoTask({ musicConfig, job, lyrics, musicPlan, track, trackVersion, kind }) {
    const taskId = job?.external_task_id || null;

    const touchHeartbeat = async () => {
      if (!job) return;
      const stamp = new Date().toISOString();
      await updateJobHeartbeat.run(stamp, stamp, job.id);
    };

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

      if (status === "SUCCESS") {
        logSunoCreditUsage(taskId, pollResult.response);
        const result = await downloadSunoAudio({
          storageDir,
          track,
          trackVersion,
          kind,
          statusResponse: pollResult.response,
        });
        return {
          instrumental_url: result?.raw?.instrumental_url || null,
          guide_vocal_url: result?.raw?.guide_vocal_url || null,
        };
      }

      if (status === "FAILED" || status === "ERROR") {
        const errorMsg = pollResult.response?.data?.errorMessage || "Unknown error";
        throw new Error(`E302_SUNO_ERROR: Generation failed - ${errorMsg}`);
      }

      return { pending: true, retry_after_sec: sunoPollIntervalSec };
    }

    // Submit new task
    const newTaskId = await durabilityService.executeWithDurability({
      provider: PROVIDERS.SUNO,
      fn: () => submitSunoTask({
        baseUrl: musicConfig.baseUrl,
        apiKey: musicConfig.apiKey,
        lyrics,
        musicPlan,
        track,
        timeoutMs: musicConfig.timeoutMs,
      }),
    });

    if (job) {
      const payload = { provider: musicConfig.provider, task_id: newTaskId, kind };
      const stamp = new Date().toISOString();
      await updateJobExternalTask.run(newTaskId, toJson(payload), stamp, stamp, job.id);
    }

    return { pending: true, retry_after_sec: sunoPollIntervalSec };
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

  const selectJobs = await db.prepare(
    "SELECT * FROM jobs WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at ASC"
  );
  const claimJob = await db.prepare(
    "UPDATE jobs SET status = 'running', locked_by = ?, locked_at = ?, started_at = COALESCE(started_at, ?), last_heartbeat_at = ?, progress_pct = ?, updated_at = ? WHERE id = ? AND status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)"
  );
  const updateJobStep = await db.prepare(
    "UPDATE jobs SET step = ?, step_index = ?, progress_pct = ?, last_heartbeat_at = ?, updated_at = ? WHERE id = ?"
  );
  const updateJob = await db.prepare(
    "UPDATE jobs SET status = ?, step = ?, step_index = ?, step_data = ?, progress_pct = ?, last_heartbeat_at = ?, next_attempt_at = NULL, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ?"
  );
  const updateJobPending = await db.prepare(
    "UPDATE jobs SET status = ?, step = ?, step_index = ?, step_data = ?, progress_pct = ?, last_heartbeat_at = ?, next_attempt_at = ?, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ?"
  );
  const updateJobStatus = await db.prepare(
    "UPDATE jobs SET status = ?, progress_pct = ?, completed_at = ?, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ?"
  );
  const updateJobHeartbeat = await db.prepare(
    "UPDATE jobs SET last_heartbeat_at = ?, updated_at = ? WHERE id = ?"
  );
  const updateJobFailure = await db.prepare(
    "UPDATE jobs SET status = ?, step = ?, step_index = ?, error_code = ?, error_message = ?, progress_pct = ?, completed_at = ?, next_attempt_at = NULL, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ?"
  );
  const updateJobAttempt = await db.prepare(
    "UPDATE jobs SET attempts = attempts + 1, status = ?, progress_pct = ?, last_heartbeat_at = ?, next_attempt_at = ?, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ?"
  );
  const updateJobExternalTask = await db.prepare(
    "UPDATE jobs SET external_task_id = ?, step_data = ?, last_heartbeat_at = ?, updated_at = ? WHERE id = ?"
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

  function getErrorInfo(err) {
    const rawMessage = err && err.message ? String(err.message) : "unknown_error";

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

  function getRetryAfterSeconds(err) {
    const message = err && err.message ? String(err.message) : "";
    if (!message.startsWith("provider_error:429:")) {
      return null;
    }
    const body = message.split(":").slice(2).join(":");
    try {
      const parsed = JSON.parse(body);
      if (parsed && parsed.retry_after) {
        const seconds = Number(parsed.retry_after);
        return Number.isFinite(seconds) ? seconds : null;
      }
    } catch (parseErr) {
      console.warn(`[JobRunner] Could not parse retry_after from rate limit response: ${body.slice(0, 100)}`);
    }
    return 10; // Default 10 second retry
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

        return {
          lyrics_json: toJson(result.lyrics),
          lyrics_status: result.lyrics_status,
          lyrics_updated_at: new Date().toISOString(),
        };
      } catch (err) {
        if (err && (err.code === "AI_UNAVAILABLE" || err.message === "AI_UNAVAILABLE")) {
          throw new Error("E201_LYRICS_ERROR: AI_UNAVAILABLE");
        }
        throw err;
      }
    },

    music_plan: ({ track }) => {
      const plan = buildMusicPlan({
        style: track.style,
        durationTarget: track.duration_target,
      });
      return { music_plan_json: toJson(plan) };
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
      if (!lyrics) {
        throw new Error("E302_WORKFLOW_ERROR: lyrics_json is required before instrumental step");
      }

      const musicConfig = getMusicProviderConfig();

      if (musicConfig && musicConfig.provider === "suno") {
        return pollOrSubmitSunoTask({ musicConfig, job, lyrics, musicPlan, track, trackVersion, kind: "preview" });
      }

      if (musicConfig) {
        const onTaskId = job
          ? async (taskId) => {
              const payload = { provider: musicConfig.provider, task_id: taskId, kind: "preview" };
              const stamp = new Date().toISOString();
              await updateJobExternalTask.run(taskId, toJson(payload), stamp, stamp, job.id);
            }
          : null;
        const result = await renderWithProvider({
          storageDir,
          track,
          trackVersion,
          kind: "preview",
          providerConfig: musicConfig,
          lyrics,
          musicPlan,
          onTaskId,
        });
        return {
          instrumental_url: result?.raw?.instrumental_url || null,
          guide_vocal_url: result?.raw?.guide_vocal_url || null,
        };
      }

      renderInstrumental({ storageDir, track, trackVersion, kind: "preview" });
      renderGuideVocal({ storageDir, track, trackVersion, kind: "preview" });
      return {};
    },

    instrumental_full: async ({ track, trackVersion, job }) => {
      const lyrics = parseJson(trackVersion.lyrics_json, null, "instrumental_full_lyrics");
      const musicPlan = parseJson(trackVersion.music_plan_json, null, "instrumental_full_music_plan");
      if (!lyrics) {
        throw new Error("E302_WORKFLOW_ERROR: lyrics_json is required before instrumental_full step");
      }

      const musicConfig = getMusicProviderConfig();

      if (musicConfig && musicConfig.provider === "suno") {
        return pollOrSubmitSunoTask({ musicConfig, job, lyrics, musicPlan, track, trackVersion, kind: "full" });
      }

      if (musicConfig) {
        const onTaskId = job
          ? async (taskId) => {
              const payload = { provider: musicConfig.provider, task_id: taskId, kind: "full" };
              const stamp = new Date().toISOString();
              await updateJobExternalTask.run(taskId, toJson(payload), stamp, stamp, job.id);
            }
          : null;
        const result = await renderWithProvider({
          storageDir,
          track,
          trackVersion,
          kind: "full",
          providerConfig: musicConfig,
          lyrics,
          musicPlan,
          onTaskId,
        });
        return {
          instrumental_url: result?.raw?.instrumental_url || null,
          guide_vocal_url: result?.raw?.guide_vocal_url || null,
        };
      }

      renderInstrumental({ storageDir, track, trackVersion, kind: "full" });
      renderGuideVocal({ storageDir, track, trackVersion, kind: "full" });
      return {};
    },

    guide_vocal: async ({ track, trackVersion }) => {
      // If Suno was used, it already generated combined audio with vocals.
      // The guide_vocal_url was set in the instrumental step to the Suno CDN URL.
      // Don't overwrite it with a localhost URL!
      if (trackVersion.guide_vocal_url && trackVersion.guide_vocal_url.includes('suno')) {
        console.log(`[JobRunner] Suno already generated vocals for track ${track.id}, skipping TTS`);
        return {}; // Don't overwrite - keep the Suno CDN URL
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
      const musicConfig = getMusicProviderConfig();
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
      // If Suno was used, it already generated combined audio with vocals.
      // The guide_vocal_url was set in the instrumental_full step to the Suno CDN URL.
      // Don't overwrite it with a localhost URL!
      if (trackVersion.guide_vocal_url && trackVersion.guide_vocal_url.includes('suno')) {
        console.log(`[JobRunner] Suno already generated vocals for track ${track.id}, skipping TTS (full)`);
        return {}; // Don't overwrite - keep the Suno CDN URL
      }

      const versionDir = getVersionDir(storageDir, track, trackVersion);
      ensureDir(versionDir);
      const token =
        trackVersion.guide_access_token || crypto.randomBytes(16).toString("hex");
      const guideUrl = `${streamBaseUrl}/guide/${trackVersion.id}?token=${token}&kind=full`;

      // TTS is always via ElevenLabs (Suno doesn't do TTS)
      const musicConfig = getMusicProviderConfig();
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

      // Voice mode determines conversion strategy:
      // - "user_voice" / "personalized": Use Seed-VC for personalized voice cloning
      // - "ai_voice" (default): Use provider vocals if available, otherwise synthesize from guide
      const isPersonalized = track.voice_mode === "user_voice" || track.voice_mode === "personalized";
      const guideUrl = trackVersion.guide_vocal_url;
      const musicConfig = getMusicProviderConfig();
      const usingSuno = musicConfig?.provider === "suno";

      // AI voice mode: prefer provider vocals (Suno) or generate from guide
      if (!isPersonalized) {
        if (usingSuno && guideUrl && guideUrl.includes("suno")) {
          console.log(`[JobRunner] AI voice mode: skipping voice conversion (Suno provides vocals)`);
          return { voice_conversion_url: guideUrl || null };
        }
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

      // Personalized mode requires guide vocal URL for voice conversion
      if (!guideUrl) {
        throw new Error("E301_GUIDE_VOCAL_MISSING: guide_vocal_url required for personalized voice conversion");
      }

      // Read Seed-VC params from feature flags (fallback to env/default)
      // getFeatureFlag returns defaults on DB errors, so this is resilient
      const cfgRate = await getFeatureFlag(db, 'seedvc_cfg_rate') ?? config.SEEDVC_CFG_RATE;
      const diffusionSteps = await getFeatureFlag(db, 'seedvc_diffusion_steps_preview') ?? 50;
      console.log(`[JobRunner] Voice conversion params: cfgRate=${cfgRate}, diffusionSteps=${diffusionSteps}`);

      const result = await durabilityService.executeWithDurability({
        provider: PROVIDERS.SEEDVC,
        fn: () => convertVoice({
          storageDir,
          track,
          trackVersion,
          kind: "preview",
          providerConfig: providerConfig.replicate,
          inputUrl: guideUrl,
          // Seed-VC config for personalized mode
          // Higher diffusion steps = better quality but slower (25=fast, 50=balanced, 100=best)
          seedvcConfig: {
            timeoutMs: providerConfig.replicate?.timeoutMs || 300000,
            hfToken: providerConfig.hfToken || null,
            replicateToken: providerConfig.replicate?.token || null, // For Demucs stem separation
            params: {
              diffusionSteps,
              lengthAdjust: 1.0,
              cfgRate,
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

      // Voice mode determines conversion strategy:
      // - "user_voice" / "personalized": Use Seed-VC for personalized voice cloning
      // - "ai_voice" (default): Use provider vocals if available, otherwise synthesize from guide
      const isPersonalized = track.voice_mode === "user_voice" || track.voice_mode === "personalized";
      const guideUrl = trackVersion.guide_vocal_url;
      const musicConfig = getMusicProviderConfig();
      const usingSuno = musicConfig?.provider === "suno";

      // AI voice mode: prefer provider vocals (Suno) or generate from guide
      if (!isPersonalized) {
        if (usingSuno && guideUrl && guideUrl.includes("suno")) {
          console.log(`[JobRunner] AI voice mode (full): skipping voice conversion (Suno provides vocals)`);
          return { voice_conversion_url: guideUrl || null };
        }
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

      // Personalized mode requires guide vocal URL for voice conversion
      if (!guideUrl) {
        throw new Error("E301_GUIDE_VOCAL_MISSING: guide_vocal_url required for personalized voice conversion");
      }

      // Read Seed-VC params from feature flags (fallback to env/default)
      // getFeatureFlag returns defaults on DB errors, so this is resilient
      const cfgRate = await getFeatureFlag(db, 'seedvc_cfg_rate') ?? config.SEEDVC_CFG_RATE;
      const diffusionSteps = await getFeatureFlag(db, 'seedvc_diffusion_steps_full') ?? 100;
      console.log(`[JobRunner] Voice conversion params (full): cfgRate=${cfgRate}, diffusionSteps=${diffusionSteps}`);

      const result = await durabilityService.executeWithDurability({
        provider: PROVIDERS.SEEDVC,
        fn: () => convertVoice({
          storageDir,
          track,
          trackVersion,
          kind: "full",
          providerConfig: providerConfig.replicate,
          inputUrl: guideUrl,
          // Seed-VC config for personalized mode
          // Higher diffusion steps = better quality but slower (25=fast, 50=balanced, 100=best)
          seedvcConfig: {
            timeoutMs: providerConfig.replicate?.timeoutMs || 300000,
            hfToken: providerConfig.hfToken || null,
            replicateToken: providerConfig.replicate?.token || null, // For Demucs stem separation
            params: {
              diffusionSteps,
              lengthAdjust: 1.0,
              cfgRate,
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

      const isPersonalized = track.voice_mode === "user_voice" || track.voice_mode === "personalized";
      const usingSuno = providerConfig.suno?.live;
      const guideUrl = trackVersion.guide_vocal_url || "";

      // For AI voice mode with Suno: Suno already provides complete mixed audio.
      // Download directly from the guide_vocal_url (which is the Suno CDN URL).
      if (!isPersonalized && usingSuno && trackVersion.guide_vocal_url) {
        const sunoUrl = trackVersion.guide_vocal_url;
        console.log(`[Mix] AI voice with Suno: downloading complete audio from ${sunoUrl}`);

        // Check if we already have the Suno audio locally
        const sunoLocalPath = path.join(versionDir, "suno_complete.mp3");
        if (!fs.existsSync(sunoLocalPath)) {
          const { downloadToFile } = require("../providers/http");
          await downloadToFile(sunoUrl, sunoLocalPath, 120000);
        }

        // Convert to WAV for watermarking using execFile (safe, no shell injection)
        const { execFile } = require("child_process");
        const { promisify } = require("util");
        const execFileAsync = promisify(execFile);
        await execFileAsync("ffmpeg", ["-y", "-i", sunoLocalPath, "-ar", "44100", "-ac", "2", mixPath]);
        console.log(`[Mix] AI voice with Suno: using complete Suno audio directly`);
        return {};
      }

      // For AI voice mode with ElevenLabs: ElevenLabs provides complete mixed audio.
      // Download directly from the guide_vocal_url (which is the ElevenLabs CDN URL).
      const usingElevenLabs = providerConfig.elevenlabs?.live;
      if (!isPersonalized && usingElevenLabs && trackVersion.guide_vocal_url && !guideUrl.includes("/guide/")) {
        const elevenLabsUrl = trackVersion.guide_vocal_url;
        console.log(`[Mix] AI voice with ElevenLabs: downloading complete audio from ${elevenLabsUrl}`);

        // Check if we already have the ElevenLabs audio locally
        const elevenLabsLocalPath = path.join(versionDir, "elevenlabs_complete.mp3");
        if (!fs.existsSync(elevenLabsLocalPath)) {
          const { downloadToFile } = require("../providers/http");
          await downloadToFile(elevenLabsUrl, elevenLabsLocalPath, 120000);
        }

        // Convert to WAV for watermarking using execFile (safe, no shell injection)
        const { execFile } = require("child_process");
        const { promisify } = require("util");
        const execFileAsync = promisify(execFile);
        await execFileAsync("ffmpeg", ["-y", "-i", elevenLabsLocalPath, "-ar", "44100", "-ac", "2", mixPath]);
        console.log(`[Mix] AI voice with ElevenLabs: using complete audio directly`);
        return {};
      }

      if (!isPersonalized && !fs.existsSync(vocalPath)) {
        const ensured = await ensureUserVocalFromGuide({ versionDir, kind: isFull ? "full" : "preview" });
        if (ensured) {
          console.log(`[Mix] AI voice: built missing vocal from guide for track ${track.id}`);
        }
      }

      // Check for instrumental in order of preference:
      // 1. stems/instrumental.wav (from Demucs separation - BEST for personalized voice)
      // 2. inst_preview.mp3 / inst_full.mp3 (ElevenLabs)
      // 3. inst_preview.wav / inst_full.wav (stub)
      const instBaseName = isFull ? "inst_full" : "inst_preview";

      // First check for Demucs-separated instrumental (used for personalized voice)
      let instPath = path.join(versionDir, "stems", "instrumental.wav");

      // Fall back to ElevenLabs/standard instrumental
      if (!fs.existsSync(instPath)) {
        instPath = path.join(versionDir, `${instBaseName}.mp3`);
      }
      if (!fs.existsSync(instPath)) {
        instPath = path.join(versionDir, `${instBaseName}.wav`);
      }

      // Check if we have Demucs-separated instrumental
      const hasSeparatedInstrumental = fs.existsSync(path.join(versionDir, "stems", "instrumental.wav"));

      if (isPersonalized && usingSuno && fs.existsSync(vocalPath)) {
        if (hasSeparatedInstrumental) {
          // CORRECT PATH: Mix converted vocals with preserved Demucs instrumental
          const separatedInstPath = path.join(versionDir, "stems", "instrumental.wav");
          console.log(`[Mix] Personalized voice: mixing converted vocals with Demucs instrumental`);
          console.log(`[Mix] Vocals: ${vocalPath}`);
          console.log(`[Mix] Instrumental: ${separatedInstPath}`);

          await mixTracks({
            vocalPath,
            instrumentalPath: separatedInstPath,
            outputPath: mixPath,
            vocalGain: 1.0,       // Natural vocal level
            instrumentalGain: 0.6, // Balanced instrumental
          });
        } else {
          // FALLBACK: No stem separation available, use Seed-VC output directly
          // (This will have poor quality but at least doesn't fail)
          console.warn(`[Mix] WARNING: No separated instrumental found, using Seed-VC output directly`);
          console.warn(`[Mix] Voice quality will be poor - Demucs stem separation is required for good results`);
          fs.copyFileSync(vocalPath, mixPath);
        }
      } else if (fs.existsSync(vocalPath) && fs.existsSync(instPath)) {
        // Standard mixing: separate vocal + instrumental tracks
        await mixTracks({
          vocalPath,
          instrumentalPath: instPath,
          outputPath: mixPath,
          vocalGain: 0.85,
          instrumentalGain: 0.65,
        });
      } else {
        const requireRealAudio =
          getMusicProviderConfig() || providerConfig.replicate?.live;
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
        const requireRealAudio =
          getMusicProviderConfig() || providerConfig.replicate?.live;
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
  };

  // Mutex to prevent concurrent tick execution
  let isProcessing = false;

  const tick = async () => {
    // Prevent overlapping ticks
    if (isProcessing) {
      return;
    }
    isProcessing = true;

    try {
      const now = new Date().toISOString();
      const jobs = await selectJobs.all(now);
      if (jobs.length > 0) {
        console.log(`[JobRunner] Found ${jobs.length} queued job(s)`);
      }
    for (const job of jobs) {
      console.log(`[JobRunner] Processing job ${job.id}: type=${job.workflow_type}, step=${job.step}, step_index=${job.step_index}`);
      const steps = job.workflow_type === "full_render" ? FULL_STEPS : PREVIEW_STEPS;
      const stepIndex = job.step_index || 0;
      const stepName = steps[stepIndex];
      const progressPct = computeProgress(stepIndex, steps.length);
      if (!stepName) {
        await updateJobStatus.run("completed", 100, now, now, job.id);
        continue;
      }
      const claim = await claimJob.run(runnerId, now, now, now, progressPct, now, job.id, now);
      if (claim.changes === 0) {
        continue;
      }
      job.status = "running";
      await updateJobStep.run(stepName, stepIndex, progressPct, now, now, job.id);
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
          job.id
        );
        continue;
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
          } catch (err) {
            // Log the error for debugging
            console.error(`[JobRunner] Step ${stepName} failed for job ${job.id}:`, err.message || err);
            const maxAttempts = job.max_attempts || 3;
            const attemptNumber = (job.attempts || 0) + 1;
            const retryAfter = getRetryAfterSeconds(err);
            if (retryAfter && attemptNumber < maxAttempts) {
              const nextAttemptAt = new Date(Date.now() + retryAfter * 1000).toISOString();
              await updateJobAttempt.run("queued", progressPct, now, nextAttemptAt, now, job.id);
              continue;
            }
            if (attemptNumber >= maxAttempts) {
              const errorInfo = getErrorInfo(err);
              await updateJobFailure.run(
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
              await updateJobAttempt.run("queued", progressPct, now, null, now, job.id);
            }
            continue;
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
          job.id
        );
        continue;
      }
      // Set status back to 'queued' so next tick can pick up the next step
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
        job.id
      );

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
        await updateJobStatus.run("blocked", 100, now, now, job.id);
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
        continue;
      }

      if (stepName === "ready") {
        const trackVersionReady = await getTrackVersion.get(job.track_version_id);
        if (!trackVersionReady) {
          console.error(`[JobRunner] Job ${job.id} ready step: trackVersion ${job.track_version_id} not found`);
          await updateJobStatus.run("failed", 100, now, now, job.id);
          continue;
        }
        const trackReady = await getTrack.get(trackVersionReady.track_id);
        if (!trackReady) {
          console.error(`[JobRunner] Job ${job.id} ready step: track ${trackVersionReady.track_id} not found`);
          await updateJobStatus.run("failed", 100, now, now, job.id);
          continue;
        }
        const isFull = job.workflow_type === "full_render";
        const resolvedStreamBase =
          trackVersionReady.stream_base_url || streamBaseUrl;
        const url = `${resolvedStreamBase}/${isFull ? "full" : "preview"}/${trackVersionReady.id}.m4a`;
        const status = isFull ? "full_ready" : "preview_ready";
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
          JSON.stringify({
            track_version_id: trackVersionReady.id,
            track_id: trackReady.id,
            workflow: isFull ? "full_render" : "preview_render",
            completed_at: now,
          }),
          trackVersionReady.id
        );
        await updateTrack.run(isFull ? "ready" : "preview_ready", now, trackReady.id);
        if (isFull && trackVersionReady.billing_hold_id) {
          await updateHold.run("captured", now, trackVersionReady.billing_hold_id);
        }
        // Deduct song from user's balance on full render completion
        if (isFull && subscriptionManager) {
          try {
            await subscriptionManager.spendSong(trackReady.user_id, trackReady.id);
            console.log(`[JobRunner] Deducted song for user ${trackReady.user_id}, track ${trackReady.id}`);
          } catch (spendErr) {
            // Log but don't fail the render - song already rendered
            console.error(`[JobRunner] Failed to deduct song for user ${trackReady.user_id}:`, spendErr.message);
          }
        }
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
              const updateJobFailure = await db.prepare(`
                UPDATE jobs SET status = ?, step = ?, step_index = ?, error_code = ?, error_message = ?, retry_count = retry_count + 1, updated_at = ?
                WHERE id = ?
              `);
              await updateJobFailure.run("failed", "ready", PREVIEW_STEPS.indexOf("ready"), "S3_UPLOAD_FAILED", s3Error.message, now, job.id);
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

        await updateJobStatus.run("completed", 100, now, now, job.id);
      }
    }
    } finally {
      isProcessing = false;
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
