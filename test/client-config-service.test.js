"use strict";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  createClientConfigService,
} = require("../src/services/client-config-service");

function withAmplitudeApiKey(value, fn) {
  const previous = process.env.AMPLITUDE_API_KEY;
  if (value === undefined) {
    delete process.env.AMPLITUDE_API_KEY;
  } else {
    process.env.AMPLITUDE_API_KEY = value;
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous === undefined) {
        delete process.env.AMPLITUDE_API_KEY;
      } else {
        process.env.AMPLITUDE_API_KEY = previous;
      }
    });
}

describe("client config service", () => {
  test("composes only the public app config contract", async () => {
    await withAmplitudeApiKey(undefined, async () => {
      const service = createClientConfigService({
        appConfigRepository: {
          listActiveGiftBundles: async () => [
            {
              product_id: "bundle_public",
              token_count: 1,
              display_name: "1 Gift",
              sort_order: 10,
            },
          ],
          findActiveOnboardingSample: async () => ({
            label: "Demo Sample",
            audio_url: "/audio/demo.mp3",
          }),
        },
        db: { id: "test-db" },
        getFeatureFlag: async (_db, id) => id !== "gift_prepay_enforced",
        getMusicProviderConfig: async () => ({
          default_provider: "suno",
          auto_style_routing: true,
          elevenlabs_generation_mode: "song",
          suno_api_key: "must-not-leak",
        }),
        getSTTConfig: async () => ({
          primary_provider: "apple",
          fallback_provider: "openai",
          whisperkit_model: "medium",
          provider_status: {},
        }),
        resolveIOSAppUpdatePolicy: async () => ({
          recommended_version: "1.5.0",
        }),
      });

      const body = await service.getClientConfig();

      assert.deepEqual(Object.keys(body).sort(), [
        "analytics",
        "app_update",
        "flags",
        "gift_bundles",
        "music",
        "onboarding",
        "stt",
      ]);
      assert.deepEqual(body.music, {
        default_provider: "suno",
        auto_style_routing: true,
        elevenlabs_generation_mode: "song",
      });
      assert.deepEqual(body.flags, {
        show_design_screens: true,
        my_voice_enabled: true,
        gift_scheduling_enabled: true,
        gift_prepay_enforced: false,
        magic_login_enabled: true,
      });
      assert.deepEqual(body.gift_bundles, [
        {
          product_id: "bundle_public",
          token_count: 1,
          display_name: "1 Gift",
          sort_order: 10,
        },
      ]);
      assert.equal(body.onboarding.sample_audio_url, "/audio/demo.mp3");
      assert.equal(body.onboarding.sample_label, "Demo Sample");
      assert.equal(body.onboarding.splash_demo_recipient, "Demo Sample");
      assert.equal(body.app_update.recommended_version, "1.5.0");
      assert.equal(body.analytics, null);
    });
  });

  test("falls back when optional config tables are absent", async () => {
    const service = createClientConfigService({
      appConfigRepository: {
        listActiveGiftBundles: async () => {
          throw new Error("no such table: gift_bundles");
        },
        findActiveOnboardingSample: async () => {
          throw new Error("no such table: onboarding_samples");
        },
      },
      db: {},
      getFeatureFlag: async () => false,
      getMusicProviderConfig: async () => ({
        default_provider: "elevenlabs",
        auto_style_routing: false,
        elevenlabs_generation_mode: "music",
      }),
      getSTTConfig: async () => ({ primary_provider: "apple" }),
      resolveIOSAppUpdatePolicy: async () => null,
    });

    const body = await service.getClientConfig();

    assert.deepEqual(body.gift_bundles, []);
    assert.equal(body.onboarding.sample_audio_url, null);
    assert.equal(body.onboarding.sample_label, null);
    assert.equal(body.onboarding.splash_demo_recipient, null);
  });
});
