"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function createGuideVocalSteps({
  assertFrozenContract,
  assertPersonalizedContract,
  durabilityService,
  ensureDir,
  generateSpeech,
  getMusicProviderConfig,
  getVersionDir,
  lyricsToText,
  parseJson,
  providerConfig,
  PROVIDERS,
  resolveRenderContract,
  shouldSkipStep,
  storageDir,
  streamBaseUrl,
  writeWav,
  createGuideAccessToken = () => crypto.randomBytes(16).toString("hex"),
}) {
  async function generateGuideVocal({ track, trackVersion, kind }) {
    const isFull = kind === "full";
    const stepName = isFull ? "guide_vocal_full" : "guide_vocal";
    const musicPlan = parseJson(
      trackVersion.music_plan_json,
      null,
      `${stepName}_music_plan`,
    );
    const renderContract = resolveRenderContract({ track, musicPlan });
    const isPersonalized = renderContract.voice_mode === "user_voice";
    if (isPersonalized) {
      assertFrozenContract(musicPlan);
      assertPersonalizedContract(renderContract, stepName);
    }
    if (shouldSkipStep(stepName, renderContract.pipeline)) {
      console.log(
        `[JobRunner] Skipping ${stepName} for track ${track.id}: pipeline=${renderContract.pipeline}`,
      );
      return {};
    }

    const versionDir = getVersionDir(storageDir, track, trackVersion);
    ensureDir(versionDir);
    const token =
      trackVersion.guide_access_token || createGuideAccessToken(trackVersion);
    const guideUrl = `${streamBaseUrl}/guide/${trackVersion.id}?token=${token}${
      isFull ? "&kind=full" : ""
    }`;
    const fileName = isFull ? "guide_vocal_full.mp3" : "guide_vocal.mp3";
    const filePath = path.join(versionDir, fileName);

    if (fs.existsSync(filePath)) {
      console.log(`[JobRunner] Reusing existing guide vocal: ${fileName}`);
      return {
        guide_vocal_url: guideUrl,
        guide_access_token: token,
      };
    }

    // TTS is always via ElevenLabs (Suno doesn't do TTS).
    const musicConfig = await getMusicProviderConfig({
      requestedStyle: musicPlan?.style || track.style,
      pinnedProvider:
        renderContract.provider_locked || musicPlan?.provider_resolved || null,
    });
    const hasTtsConfig =
      providerConfig.elevenlabs?.ttsVoiceId && providerConfig.elevenlabs?.apiKey;
    if (musicConfig && hasTtsConfig) {
      const lyrics = parseJson(
        trackVersion.lyrics_json,
        null,
        `${stepName}_lyrics`,
      );
      const text = lyricsToText(lyrics, { chorusOnly: !isFull });
      if (!text) {
        throw new Error(
          "E301_GUIDE_VOCAL_MISSING: Lyrics unavailable for guide vocal",
        );
      }
      console.log(
        `[JobRunner] Generating TTS ${isFull ? "full " : ""}guide vocal${
          isFull ? "" : " (chorus only)"
        } for track ${track.id}`,
      );
      await durabilityService.executeWithDurability({
        provider: PROVIDERS.ELEVENLABS,
        fn: () =>
          generateSpeech({
            baseUrl: providerConfig.elevenlabs.baseUrl,
            apiKey: providerConfig.elevenlabs.apiKey,
            voiceId: providerConfig.elevenlabs.ttsVoiceId,
            text,
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
    if (!isFull) {
      console.log(
        `[JobRunner] Using placeholder guide vocal for track ${track.id} (no live provider)`,
      );
    }
    const wavPath = path.join(
      versionDir,
      isFull ? "guide_vocal_full.wav" : "guide_vocal.wav",
    );
    if (!fs.existsSync(wavPath)) {
      writeWav(wavPath, {
        durationSec: isFull ? 12 : 6,
        frequencyHz: 440,
      });
    }
    return {
      guide_vocal_url: guideUrl,
      guide_access_token: token,
    };
  }

  return {
    guide_vocal: ({ track, trackVersion }) =>
      generateGuideVocal({ track, trackVersion, kind: "preview" }),
    guide_vocal_full: ({ track, trackVersion }) =>
      generateGuideVocal({ track, trackVersion, kind: "full" }),
  };
}

module.exports = { createGuideVocalSteps };
