"use strict";

const fs = require("fs");
const path = require("path");

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
    if (
      !storageProvider ||
      typeof storageProvider.downloadToFile !== "function"
    ) {
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
      httpDownloadToFile || require("../../providers/http").downloadToFile;
    await download(providerAudioUrl, providerLocalPath, 120000);
    return { source: "provider_url", key: null, url: providerAudioUrl };
  }

  return { source: null, key: null, url: null };
}

function createMixSteps({
  assertFrozenContract,
  assertPersonalizedContract,
  blendVocals,
  db,
  ensureDir,
  ensureUserVocalFromGuide,
  getFeatureFlags,
  getMusicProviderConfig,
  getProviderAudioKey,
  getProviderAudioUrl,
  getVersionDir,
  isProviderCompleteAudioPipeline,
  mixTracks,
  mixTracksPersonalized,
  parseJson,
  providerConfig,
  resolveRenderContract,
  runFFmpeg,
  storageDir,
  storageProvider,
  writeWav,
}) {
  return {
    async mix({ track, trackVersion, workflow }) {
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
  };
}

module.exports = {
  createMixSteps,
  hydrateProviderCompleteAudio,
};
