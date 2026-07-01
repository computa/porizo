"use strict";

const fs = require("fs");
const path = require("path");

function createVoiceConversionSteps({
  applyVocalPolish,
  assertFrozenContract,
  assertPersonalizedContract,
  convertVoice,
  db,
  durabilityService,
  ensureUserVocalFromGuide,
  getProviderAudioUrl,
  getVersionDir,
  parseJson,
  performVoiceConversion,
  providerConfig,
  PROVIDERS,
  resolveRenderContract,
  shouldSkipStep,
  storageDir,
  storageProvider,
}) {
  async function runVoiceConversion({ track, trackVersion, kind }) {
    const isFull = kind === "full";
    const stepName = isFull ? "voice_convert_sections" : "voice_convert";
    const outputFileName = isFull ? "user_vocal_full.wav" : "user_vocal.wav";
    const versionDir = getVersionDir(storageDir, track, trackVersion);
    const outputFile = path.join(versionDir, outputFileName);

    // Reuse existing file if present (saves API credits).
    if (fs.existsSync(outputFile)) {
      console.log(
        `[JobRunner] Reusing existing voice conversion: ${outputFileName}`,
      );
      return { voice_conversion_url: null };
    }

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
    const guideUrl = trackVersion.guide_vocal_url;
    const providerAudioUrl = getProviderAudioUrl(trackVersion);
    const conversionSourceUrl =
      renderContract.pipeline === "provider_audio_personalized_convert"
        ? providerAudioUrl
        : guideUrl;

    // AI voice (non-personalized): use guide vocal for voice conversion.
    if (!isPersonalized) {
      if (providerConfig.replicate?.live && guideUrl) {
        const result = await durabilityService.executeWithDurability({
          provider: PROVIDERS.REPLICATE,
          fn: () =>
            convertVoice({
              storageDir,
              track,
              trackVersion,
              kind,
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
        kind,
      });
      if (!ensured) {
        throw new Error(
          "E301_GUIDE_VOCAL_MISSING: guide vocal required for AI voice conversion",
        );
      }
      return { voice_conversion_url: guideUrl || null };
    }

    // Personalized mode requires source audio for voice conversion.
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
      kind,
      versionDir,
      conversionSourceUrl,
      providerConfig,
      durabilityService,
      storageDir,
      storageProvider,
      renderContract,
    });

    await applyVocalPolish({ db, outputFile, versionDir, kind });

    return { voice_conversion_url: result?.output_url || null };
  }

  return {
    voice_convert: ({ track, trackVersion }) =>
      runVoiceConversion({ track, trackVersion, kind: "preview" }),
    voice_convert_sections: ({ track, trackVersion }) =>
      runVoiceConversion({ track, trackVersion, kind: "full" }),
  };
}

module.exports = { createVoiceConversionSteps };
