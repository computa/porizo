const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { buildLyrics, generateLyrics } = require("../providers/lyrics");
const { moderationCheck } = require("../providers/moderation");
const { writeWav } = require("../utils/audio");
const { buildMusicPlan, renderInstrumental, renderGuideVocal, renderWithProvider } = require("../providers/music");
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

function writePlaceholderOutputs({ storageDir, track, trackVersion, kind }) {
  const versionDir = path.join(
    storageDir,
    "tracks",
    track.user_id,
    track.id,
    `v${trackVersion.version_num}`
  );
  ensureDir(versionDir);
  const audioName = kind === "preview" ? "preview.aac" : "full.aac";
  writeWav(path.join(versionDir, audioName), {
    durationSec: kind === "preview" ? 6 : 12,
    frequencyHz: 300,
  });
  const provenance = {
    track_version_id: trackVersion.id,
    track_id: track.id,
    workflow: kind,
    created_at: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(versionDir, "provenance.json"),
    JSON.stringify(provenance, null, 2),
    "utf8"
  );
}

function parseJson(value, fallback) {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch (err) {
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
}) {
  const selectJobs = db.prepare(
    "SELECT * FROM jobs WHERE status IN ('queued','running') ORDER BY created_at ASC"
  );
  const updateJob = db.prepare(
    "UPDATE jobs SET status = ?, step = ?, step_index = ?, step_data = ?, updated_at = ? WHERE id = ?"
  );
  const updateJobStatus = db.prepare(
    "UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?"
  );
  const updateJobAttempt = db.prepare(
    "UPDATE jobs SET attempts = attempts + 1, status = ?, updated_at = ? WHERE id = ?"
  );
  const getTrackVersion = db.prepare(
    "SELECT * FROM track_versions WHERE id = ?"
  );
  const getTrack = db.prepare("SELECT * FROM tracks WHERE id = ?");
  const updateTrackVersion = db.prepare(
    "UPDATE track_versions SET status = ?, completed_at = ?, preview_url = COALESCE(?, preview_url), full_url = COALESCE(?, full_url), lyrics_json = COALESCE(?, lyrics_json), lyrics_status = COALESCE(?, lyrics_status), lyrics_updated_at = COALESCE(?, lyrics_updated_at), lyrics_approved_at = COALESCE(?, lyrics_approved_at), music_plan_json = COALESCE(?, music_plan_json), moderation_status = COALESCE(?, moderation_status), moderation_reason = COALESCE(?, moderation_reason), instrumental_url = COALESCE(?, instrumental_url), guide_vocal_url = COALESCE(?, guide_vocal_url), voice_conversion_url = COALESCE(?, voice_conversion_url), provenance_json = COALESCE(?, provenance_json) WHERE id = ?"
  );
  const updateTrack = db.prepare(
    "UPDATE tracks SET status = ?, updated_at = ? WHERE id = ?"
  );
  const updateHold = db.prepare(
    "UPDATE billing_holds SET status = ?, resolved_at = ? WHERE id = ?"
  );
  const updateUserRisk = db.prepare("UPDATE users SET risk_level = ? WHERE id = ?");
  const insertAuditLog = db.prepare(
    "INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );

  const stepHandlers = {
    moderation: ({ track, trackVersion }) => {
      if (trackVersion.moderation_status) {
        return { moderation_status: trackVersion.moderation_status };
      }
      const lyrics = parseJson(trackVersion.lyrics_json, null);
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
      const existing = parseJson(trackVersion.lyrics_json, null);
      if (existing) {
        return { lyrics_json: trackVersion.lyrics_json };
      }

      let lyrics;
      try {
        lyrics = await generateLyrics({
          title: track.title,
          recipient_name: track.recipient_name,
          message: track.message,
          style: track.style,
          occasion: track.occasion,
        });
      } catch (err) {
        lyrics = buildLyrics({
          title: track.title,
          recipient_name: track.recipient_name,
          message: track.message,
          style: track.style,
        });
      }

      return {
        lyrics_json: toJson(lyrics),
        lyrics_status: "draft",
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
      const lyrics = parseJson(trackVersion.lyrics_json, null);
      const musicPlan = parseJson(trackVersion.music_plan_json, null);
      if (providerConfig.elevenlabs?.live) {
        const result = await renderWithProvider({
          storageDir,
          track,
          trackVersion,
          kind: "preview",
          providerConfig: providerConfig.elevenlabs,
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
      const lyrics = parseJson(trackVersion.lyrics_json, null);
      const musicPlan = parseJson(trackVersion.music_plan_json, null);
      if (providerConfig.elevenlabs?.live) {
        const result = await renderWithProvider({
          storageDir,
          track,
          trackVersion,
          kind: "full",
          providerConfig: providerConfig.elevenlabs,
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

    guide_vocal: () => ({}),
    guide_vocal_full: () => ({}),

    voice_convert: async ({ track, trackVersion }) => {
      const guideUrl = trackVersion.guide_vocal_url || `${streamBaseUrl}/guide/${trackVersion.id}.wav`;
      const result = await convertVoice({
        storageDir,
        track,
        trackVersion,
        kind: "preview",
        providerConfig: providerConfig.replicate,
        inputUrl: guideUrl,
      });
      return { voice_conversion_url: result?.output_url || null };
    },

    voice_convert_sections: async ({ track, trackVersion }) => {
      const guideUrl = trackVersion.guide_vocal_url || `${streamBaseUrl}/guide/${trackVersion.id}.wav`;
      const result = await convertVoice({
        storageDir,
        track,
        trackVersion,
        kind: "full",
        providerConfig: providerConfig.replicate,
        inputUrl: guideUrl,
      });
      return { voice_conversion_url: result?.output_url || null };
    },

    mix: async ({ track, trackVersion, workflow }) => {
      const versionDir = getVersionDir(storageDir, track, trackVersion);
      ensureDir(versionDir);

      const isFull = workflow === "full_render";
      const vocalFileName = isFull ? "user_vocal_full.wav" : "user_vocal.wav";
      const instFileName = isFull ? "inst_full.wav" : "inst_preview.wav";
      const vocalPath = path.join(versionDir, vocalFileName);
      const instPath = path.join(versionDir, instFileName);
      const mixPath = path.join(versionDir, "mix.wav");

      if (fs.existsSync(vocalPath) && fs.existsSync(instPath)) {
        await mixTracks({
          vocalPath,
          instrumentalPath: instPath,
          outputPath: mixPath,
          vocalGain: 0.85,
          instrumentalGain: 0.65,
        });
      } else {
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
      const outputFileName = isFull ? "full.aac" : "preview.aac";
      const outputPath = path.join(versionDir, outputFileName);

      if (fs.existsSync(mixPath)) {
        await embedWatermark(mixPath, watermarkedPath, trackVersion.id);
        await encodeToAAC(watermarkedPath, outputPath, "128k");

        const hlsDir = path.join(versionDir, "hls");
        try {
          await createHLSPlaylist(outputPath, hlsDir, 4);
        } catch (err) {
          // HLS is optional
        }
      } else {
        writeWav(outputPath, {
          durationSec: isFull ? 12 : 6,
          frequencyHz: 280,
        });
      }

      return {};
    },
  };

  const tick = async () => {
    const jobs = selectJobs.all();
    const now = new Date().toISOString();
    for (const job of jobs) {
      const steps = job.workflow_type === "full_render" ? FULL_STEPS : PREVIEW_STEPS;
      const stepIndex = job.step_index || 0;
      const stepName = steps[stepIndex];
      if (!stepName) {
        updateJobStatus.run("completed", now, job.id);
        continue;
      }
      if (job.status === "queued") {
        job.status = "running";
      }
      const trackVersion = getTrackVersion.get(job.track_version_id);
      const track = trackVersion ? getTrack.get(trackVersion.track_id) : null;
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
                updates.voice_conversion_url || null,
                updates.provenance_json || null,
                trackVersion.id
              );
            }
            stepData = updates || null;
          } catch (err) {
            const maxAttempts = job.max_attempts || 3;
            if ((job.attempts || 0) + 1 >= maxAttempts) {
              updateJobStatus.run("failed", now, job.id);
            } else {
              updateJobAttempt.run("queued", now, job.id);
            }
            continue;
          }
        }
      }
      updateJob.run(job.status, stepName, stepIndex + 1, stepData ? toJson(stepData) : null, now, job.id);

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
        const url = `${streamBaseUrl}/${isFull ? "full" : "preview"}/${trackVersionReady.id}.aac`;
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
        });
        updateJobStatus.run("completed", now, job.id);
      }
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  return {
    tick,
    stop: () => clearInterval(timer),
  };
}

module.exports = {
  startJobRunner,
};
