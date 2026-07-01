"use strict";

const fs = require("fs");
const path = require("path");

function createWatermarkSteps({
  createHLSPlaylist,
  embedWatermark,
  encodeToAAC,
  ensureDir,
  getMusicProviderConfig,
  getVersionDir,
  parseJson,
  providerConfig,
  storageDir,
  writeWav,
}) {
  return {
    async watermark({ track, trackVersion, workflow }) {
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
          // HLS is optional - streaming may be unavailable but download will work.
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

      // SVC-10: Clean up intermediate files after successful watermark.
      try {
        const intermediateMixPath = path.join(versionDir, "mix.wav");
        if (fs.existsSync(intermediateMixPath)) {
          fs.unlinkSync(intermediateMixPath);
        }
      } catch (e) {
        /* best-effort cleanup - preserve on failure for retry */
      }
      try {
        if (fs.existsSync(watermarkedPath)) {
          fs.unlinkSync(watermarkedPath);
        }
      } catch (e) {
        /* best-effort cleanup */
      }

      return {};
    },
  };
}

module.exports = { createWatermarkSteps };
