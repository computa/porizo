const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { generateLyrics } = require("../providers/lyrics");
const { moderationCheck } = require("../providers/moderation");
const { writeWav } = require("../utils/audio");
const { buildMusicPlan, renderInstrumental, renderGuideVocal, renderWithProvider } = require("../providers/music");
const { generateSpeech, lyricsToText } = require("../providers/elevenlabs");
const { convertVoice } = require("../providers/voice");
const { mixTracks, encodeToAAC } = require("../utils/ffmpeg");
const { embedWatermark } = require("../utils/watermark");
const { createHLSPlaylist } = require("../utils/hls");

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

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
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

function parseJson(value, fallback, context = "unknown", { required = false } = {}) {
  if (!value) {
    if (required) {
      throw new Error(`E501_PARSE_ERROR: ${context} is required but was empty`);
    }
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch (err) {
    console.error(`[parseJson] Failed to parse JSON for ${context}:`, err.message, "Value prefix:", String(value).slice(0, 100));
    if (required) {
      throw new Error(`E501_PARSE_ERROR: Failed to parse ${context}: ${err.message}`);
    }
    return fallback;
  }
}

function toJson(value) {
  if (value === undefined) {
    return null;
  }
  return JSON.stringify(value);
}

function getVersionDir(storageDir, track, trackVersion) {
  return path.join(
    storageDir,
    "tracks",
    track.user_id,
    track.id,
    `v${trackVersion.version_num}`
  );
}

function startJobRunner({
  db,
  storageDir,
  streamBaseUrl,
  intervalMs = 1000,
  providerConfig = {},
  recoverStaleJobs = true,
  staleJobTimeoutMinutes = 5,
  devMode = false,
}) {
  // Helper to get active music provider config (elevenlabs or suno)
  const getMusicProviderConfig = () => {
    if (providerConfig.suno?.live) {
      return providerConfig.suno;
    }
    if (providerConfig.elevenlabs?.live) {
      return providerConfig.elevenlabs;
    }
    return null;
  };

  // Stale job recovery: reset jobs stuck in 'running' status
  // This handles cases where process crashed mid-step
  // Note: Use julianday for reliable datetime comparison across ISO 8601 formats
  const recoverStaleJobsStmt = db.prepare(`
    UPDATE jobs
    SET status = 'queued',
        attempts = attempts + 1,
        updated_at = ?
    WHERE status = 'running'
      AND julianday(replace(replace(updated_at, 'T', ' '), 'Z', ''))
          < julianday('now', '-' || ? || ' minutes')
  `);

  function performStaleJobRecovery() {
    if (!recoverStaleJobs) return;
    try {
      const now = new Date().toISOString();
      // Params: 1. SET updated_at = ?, 2. julianday('now', '-' || ? || ' minutes')
      const result = recoverStaleJobsStmt.run(now, staleJobTimeoutMinutes);
      if (result.changes > 0) {
        console.warn(`[JobRunner] Recovered ${result.changes} stale jobs stuck in 'running' status`);
      }
    } catch (err) {
      console.error(`[JobRunner] Failed to recover stale jobs:`, err.message);
    }
  }

  // Recover stale jobs at startup
  performStaleJobRecovery();

  const selectJobs = db.prepare(
    "SELECT * FROM jobs WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at ASC"
  );
  const updateJob = db.prepare(
    "UPDATE jobs SET status = ?, step = ?, step_index = ?, step_data = ?, next_attempt_at = NULL, updated_at = ? WHERE id = ?"
  );
  const updateJobStatus = db.prepare(
    "UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?"
  );
  const updateJobFailure = db.prepare(
    "UPDATE jobs SET status = ?, step = ?, step_index = ?, error_code = ?, error_message = ?, next_attempt_at = NULL, updated_at = ? WHERE id = ?"
  );
  const updateJobAttempt = db.prepare(
    "UPDATE jobs SET attempts = attempts + 1, status = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?"
  );
  const getTrackVersion = db.prepare(
    "SELECT * FROM track_versions WHERE id = ?"
  );
  const getTrack = db.prepare("SELECT * FROM tracks WHERE id = ?");
  const updateTrackVersion = db.prepare(
    "UPDATE track_versions SET status = ?, completed_at = ?, preview_url = COALESCE(?, preview_url), full_url = COALESCE(?, full_url), lyrics_json = COALESCE(?, lyrics_json), lyrics_status = COALESCE(?, lyrics_status), lyrics_updated_at = COALESCE(?, lyrics_updated_at), lyrics_approved_at = COALESCE(?, lyrics_approved_at), music_plan_json = COALESCE(?, music_plan_json), moderation_status = COALESCE(?, moderation_status), moderation_reason = COALESCE(?, moderation_reason), instrumental_url = COALESCE(?, instrumental_url), guide_vocal_url = COALESCE(?, guide_vocal_url), guide_access_token = COALESCE(?, guide_access_token), voice_conversion_url = COALESCE(?, voice_conversion_url), provenance_json = COALESCE(?, provenance_json) WHERE id = ?"
  );
  const updateTrack = db.prepare(
    "UPDATE tracks SET status = ?, updated_at = ? WHERE id = ?"
  );
  const updateHold = db.prepare(
    "UPDATE billing_holds SET status = ?, resolved_at = ? WHERE id = ?"
  );
  const getHold = db.prepare("SELECT * FROM billing_holds WHERE id = ?");
  const refundCredits = db.prepare(
    "UPDATE entitlements SET credits_balance = credits_balance + ?, updated_at = ? WHERE user_id = ?"
  );
  const updateUserRisk = db.prepare("UPDATE users SET risk_level = ? WHERE id = ?");
  const insertAuditLog = db.prepare(
    "INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );

  function getErrorInfo(err) {
    const message = err && err.message ? String(err.message) : "unknown_error";
    if (message.startsWith("provider_error:")) {
      const parts = message.split(":");
      const status = parts[1] || "unknown";
      return { code: `provider_error_${status}`, message };
    }
    const code = message.includes(":") ? message.split(":")[0] : message;
    return { code, message };
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

  function releaseHoldIfNeeded({ track, trackVersion, now, reason }) {
    if (!track || !trackVersion || !trackVersion.billing_hold_id) {
      return;
    }
    const hold = getHold.get(trackVersion.billing_hold_id);
    if (!hold || hold.status !== "held") {
      return;
    }
    updateHold.run("released", now, hold.id);
    refundCredits.run(hold.credits_held, now, hold.user_id);
    insertAuditLog.run(
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

      // generateLyrics now handles fallback internally and always returns { lyrics, lyrics_status }
      const result = await generateLyrics({
        title: track.title,
        recipient_name: track.recipient_name,
        message: track.message,
        style: track.style,
        occasion: track.occasion,
      });

      if (result.lyrics_status === "fallback") {
        console.warn(`[JobRunner] Using fallback template lyrics for track ${track.id}: ${result.fallback_reason || "unknown"}`);
      }

      return {
        lyrics_json: toJson(result.lyrics),
        lyrics_status: result.lyrics_status,
        lyrics_updated_at: new Date().toISOString(),
      };
    },

    music_plan: ({ track }) => {
      const plan = buildMusicPlan({
        style: track.style,
        durationTarget: track.duration_target,
      });
      return { music_plan_json: toJson(plan) };
    },

    instrumental: async ({ track, trackVersion }) => {
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
      if (musicConfig) {
        const result = await renderWithProvider({
          storageDir,
          track,
          trackVersion,
          kind: "preview",
          providerConfig: musicConfig,
          lyrics,
          musicPlan,
        });
        return {
          instrumental_url: result?.raw?.instrumental_url || null,
          guide_vocal_url: result?.raw?.guide_vocal_url || null,
        };
      } else {
        renderInstrumental({ storageDir, track, trackVersion, kind: "preview" });
        renderGuideVocal({ storageDir, track, trackVersion, kind: "preview" });
      }
      return {};
    },

    instrumental_full: async ({ track, trackVersion }) => {
      const lyrics = parseJson(trackVersion.lyrics_json, null, "instrumental_full_lyrics");
      const musicPlan = parseJson(trackVersion.music_plan_json, null, "instrumental_full_music_plan");
      if (!lyrics) {
        throw new Error("E302_WORKFLOW_ERROR: lyrics_json is required before instrumental_full step");
      }
      const musicConfig = getMusicProviderConfig();
      if (musicConfig) {
        const result = await renderWithProvider({
          storageDir,
          track,
          trackVersion,
          kind: "full",
          providerConfig: musicConfig,
          lyrics,
          musicPlan,
        });
        return {
          instrumental_url: result?.raw?.instrumental_url || null,
          guide_vocal_url: result?.raw?.guide_vocal_url || null,
        };
      } else {
        renderInstrumental({ storageDir, track, trackVersion, kind: "full" });
        renderGuideVocal({ storageDir, track, trackVersion, kind: "full" });
      }
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
        await generateSpeech({
          baseUrl: providerConfig.elevenlabs.baseUrl,
          apiKey: providerConfig.elevenlabs.apiKey,
          voiceId: providerConfig.elevenlabs.ttsVoiceId,
          text: text,
          outputPath: filePath,
          timeoutMs: providerConfig.elevenlabs.timeoutMs,
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
        await generateSpeech({
          baseUrl: providerConfig.elevenlabs.baseUrl,
          apiKey: providerConfig.elevenlabs.apiKey,
          voiceId: providerConfig.elevenlabs.ttsVoiceId,
          text: text,
          outputPath: filePath,
          timeoutMs: providerConfig.elevenlabs.timeoutMs,
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

      // Only call voice conversion if we have a real guide vocal URL
      // Without TTS-generated guide vocals, we fall back to stub mode
      const guideUrl = trackVersion.guide_vocal_url;
      // Voice mode: "user_voice" uses Seed-VC for personalized voice, "ai_voice" uses RVC with preset models
      // Legacy "personalized" value supported for backward compatibility
      const isPersonalized = track.voice_mode === "user_voice" || track.voice_mode === "personalized";

      if ((providerConfig.replicate?.live || isPersonalized) && !guideUrl) {
        throw new Error("E301_GUIDE_VOCAL_MISSING: guide_vocal_url required for voice conversion");
      }

      const effectiveConfig = guideUrl ? providerConfig.replicate : null;
      const result = await convertVoice({
        storageDir,
        track,
        trackVersion,
        kind: "preview",
        providerConfig: effectiveConfig,
        inputUrl: guideUrl || `${streamBaseUrl}/guide/${trackVersion.id}`,
        // Seed-VC config for personalized mode
        // Higher diffusion steps = better quality but slower (25=fast, 50=balanced, 100=best)
        seedvcConfig: {
          timeoutMs: providerConfig.replicate?.timeoutMs || 300000,
          hfToken: providerConfig.hfToken || null,
          replicateToken: providerConfig.replicate?.token || null, // For Demucs stem separation
          params: {
            diffusionSteps: 50, // Increased for better voice cloning quality
            lengthAdjust: 1.0,
            cfgRate: 0.7, // Balance: user's voice timbre with AI enhancement
          },
        },
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

      const guideUrl = trackVersion.guide_vocal_url;
      // Voice mode: "user_voice" uses Seed-VC for personalized voice, "ai_voice" uses RVC with preset models
      // Legacy "personalized" value supported for backward compatibility
      const isPersonalized = track.voice_mode === "user_voice" || track.voice_mode === "personalized";

      if ((providerConfig.replicate?.live || isPersonalized) && !guideUrl) {
        throw new Error("E301_GUIDE_VOCAL_MISSING: guide_vocal_url required for voice conversion");
      }

      const effectiveConfig = guideUrl ? providerConfig.replicate : null;
      const result = await convertVoice({
        storageDir,
        track,
        trackVersion,
        kind: "full",
        providerConfig: effectiveConfig,
        inputUrl: guideUrl || `${streamBaseUrl}/guide/${trackVersion.id}`,
        // Seed-VC config for personalized mode
        // Higher diffusion steps = better quality but slower (25=fast, 50=balanced, 100=best)
        seedvcConfig: {
          timeoutMs: providerConfig.replicate?.timeoutMs || 300000,
          hfToken: providerConfig.hfToken || null,
          replicateToken: providerConfig.replicate?.token || null, // For Demucs stem separation
          params: {
            diffusionSteps: 100, // Higher quality for full render
            lengthAdjust: 1.0,
            cfgRate: 0.7, // Balance: user's voice timbre with AI enhancement
          },
        },
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

      const isPersonalized = track.voice_mode === "user_voice" || track.voice_mode === "personalized";
      const usingSuno = providerConfig.suno?.live;

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
            vocalGain: 0.9,       // Slightly louder vocals for clarity
            instrumentalGain: 0.7, // Balanced instrumental
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
      const jobs = selectJobs.all(now);
    for (const job of jobs) {
      const steps = job.workflow_type === "full_render" ? FULL_STEPS : PREVIEW_STEPS;
      const stepIndex = job.step_index || 0;
      const stepName = steps[stepIndex];
      if (!stepName) {
        updateJobStatus.run("completed", now, job.id);
        continue;
      }
      if (job.status === "queued") {
        // Mark as running in DB BEFORE processing to prevent concurrent picks
        updateJobStatus.run("running", now, job.id);
        job.status = "running";
      }
      const trackVersion = getTrackVersion.get(job.track_version_id);
      const track = trackVersion ? getTrack.get(trackVersion.track_id) : null;

      // Fail job if track or trackVersion was deleted during processing
      if (!track || !trackVersion) {
        console.error(`[JobRunner] Job ${job.id} failed: track or trackVersion not found (may have been deleted)`);
        updateJobFailure.run(
          "failed",
          stepName,
          stepIndex,
          "E404_RESOURCE_DELETED",
          "Track or track version was deleted during processing",
          now,
          job.id
        );
        continue;
      }

      let stepData = null;
      if (track && trackVersion) {
        const handler = stepHandlers[stepName];
        if (handler) {
          try {
            const updates = await handler({ track, trackVersion, workflow: job.workflow_type });
            if (updates && Object.keys(updates).length) {
              updateTrackVersion.run(
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
              updateJobAttempt.run("queued", nextAttemptAt, now, job.id);
              continue;
            }
            if (attemptNumber >= maxAttempts) {
              const errorInfo = getErrorInfo(err);
              updateJobFailure.run(
                "failed",
                stepName,
                stepIndex,
                errorInfo.code,
                errorInfo.message,
                now,
                job.id
              );
              updateTrackVersion.run(
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
              updateTrack.run("failed", now, track.id);
              releaseHoldIfNeeded({
                track,
                trackVersion,
                now,
                reason: "job_failed",
              });
            } else {
              updateJobAttempt.run("queued", null, now, job.id);
            }
            continue;
          }
        }
      }
      // Set status back to 'queued' so next tick can pick up the next step
      updateJob.run("queued", stepName, stepIndex + 1, stepData ? toJson(stepData) : null, now, job.id);

      if (stepData && stepData.status_override === "blocked") {
        updateTrackVersion.run(
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
        updateTrack.run("failed", now, track.id);
        updateUserRisk.run("high", track.user_id);
        updateJobStatus.run("blocked", now, job.id);
        insertAuditLog.run(
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
        const trackVersionReady = getTrackVersion.get(job.track_version_id);
        if (!trackVersionReady) {
          updateJobStatus.run("failed", now, job.id);
          continue;
        }
        const trackReady = getTrack.get(trackVersionReady.track_id);
        if (!trackReady) {
          updateJobStatus.run("failed", now, job.id);
          continue;
        }
        const isFull = job.workflow_type === "full_render";
        const url = `${streamBaseUrl}/${isFull ? "full" : "preview"}/${trackVersionReady.id}.m4a`;
        const status = isFull ? "full_ready" : "preview_ready";
        updateTrackVersion.run(
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
        updateTrack.run(isFull ? "ready" : "preview_ready", now, trackReady.id);
        if (isFull && trackVersionReady.billing_hold_id) {
          updateHold.run("captured", now, trackVersionReady.billing_hold_id);
        }
        insertAuditLog.run(
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
        updateJobStatus.run("completed", now, job.id);
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
    stop: () => clearInterval(timer),
  };
}

module.exports = {
  startJobRunner,
};
