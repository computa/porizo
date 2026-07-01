"use strict";

const config = require("../config");
const { getFeatureFlag: defaultGetFeatureFlag } = require("./feature-flags");

function createClientConfigService({
  appConfigRepository,
  db,
  getFeatureFlag = defaultGetFeatureFlag,
  getMusicProviderConfig,
  getSTTConfig,
  resolveIOSAppUpdatePolicy,
}) {
  async function getClientConfig() {
    const sttConfig = await getSTTConfig();
    const musicConfig = await getMusicProviderConfig();
    const appUpdatePolicy = await resolveIOSAppUpdatePolicy();
    const showDesignScreens = await getFeatureFlag(db, "show_design_screens");
    const myVoiceEnabled = await getFeatureFlag(db, "my_voice_enabled");
    const giftSchedulingEnabled = await getFeatureFlag(
      db,
      "gift_scheduling_enabled",
    );
    const giftPrepayEnforced = await getFeatureFlag(
      db,
      "gift_prepay_enforced",
    );

    let gift_bundles = [];
    try {
      gift_bundles = await appConfigRepository.listActiveGiftBundles();
    } catch {
      // Table may not exist yet if migration has not run.
    }

    let activeSample = null;
    try {
      activeSample = await appConfigRepository.findActiveOnboardingSample();
    } catch {
      // Table may not exist yet if migration has not run.
    }

    const onboarding = {
      sample_audio_url: activeSample?.audio_url || null,
      sample_label: activeSample?.label || null,
      splash_demo_recipient: activeSample?.label || null,
      splash_lyrics_preview: null,
      launch_flash_audio_url: null,
      launch_flash_title: "The Drive Home",
      launch_flash_recipient: "For Dad",
      launch_flash_lyrics_preview:
        "You kept one hand on the wheel and one eye on me the whole way home...",
      question_graph_version: 2,
      question_graph_url: `${config.PUBLIC_BASE_URL.replace(/\/+$/, "")}/api/onboarding/graph.json`,
    };

    const amplitudeApiKey = process.env.AMPLITUDE_API_KEY || null;
    const analytics = amplitudeApiKey
      ? { amplitude_api_key: amplitudeApiKey }
      : null;

    return {
      stt: sttConfig,
      music: {
        default_provider: musicConfig.default_provider,
        auto_style_routing: musicConfig.auto_style_routing,
        elevenlabs_generation_mode: musicConfig.elevenlabs_generation_mode,
      },
      flags: {
        show_design_screens: showDesignScreens,
        my_voice_enabled: myVoiceEnabled,
        gift_scheduling_enabled: giftSchedulingEnabled,
        gift_prepay_enforced: giftPrepayEnforced,
      },
      gift_bundles,
      onboarding,
      app_update: appUpdatePolicy,
      analytics,
    };
  }

  return { getClientConfig };
}

module.exports = { createClientConfigService };
