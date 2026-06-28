"use strict";

function createMusicPlanSteps({
  buildMusicPlan,
  buildRenderContract,
  db,
  findActiveProviderProfileForUser,
  findActiveVoiceProfileForUser,
  getMusicProviderConfig,
  getProviderProfileById,
  hasPersonaConsentScope,
  mergeProvenanceJson,
  nowIso,
  parseJson,
  PERSONALIZED_VOICE_MODES,
  toJson,
}) {
  return {
    async music_plan({ track, trackVersion, job }) {
      const musicConfig = await getMusicProviderConfig({
        requestedStyle: track.style,
      });
      const runtimeMusicConfig = musicConfig?.runtimeConfig || {
        elevenlabs_generation_mode: "composition_plan",
        style_overrides: {},
      };
      if (musicConfig?.routing) {
        console.log(
          `[JobRunner] Music provider routing: style=${musicConfig.routing.style} requested=${musicConfig.routing.requested_provider} resolved=${musicConfig.routing.provider} support=${musicConfig.routing.support} reason=${musicConfig.routing.reason}`,
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
      // Thread voice_gender into music plan so Suno receives vocal metatags.
      if (track.voice_gender) {
        plan.voice_gender = track.voice_gender;
      }
      let voiceConversionProvider = null;
      let userVoiceEngine = null;
      let voiceProviderProfileId = null;
      if (PERSONALIZED_VOICE_MODES.has(track.voice_mode)) {
        const activeVoiceProfile = await findActiveVoiceProfileForUser(db, {
          userId: track.user_id,
        });
        if (!activeVoiceProfile) {
          throw new Error(
            "E302_VOICE_PROFILE_REQUIRED: Active voice profile required for My Voice.",
          );
        }
        const renderRequest =
          parseJson(job?.step_data, {}, "render_request_step_data")
            ?.render_request || {};
        const frozenEngine =
          typeof renderRequest.user_voice_engine === "string"
            ? renderRequest.user_voice_engine
            : null;
        let sunoProviderProfile = null;
        if (
          frozenEngine === "suno_voice_persona" &&
          renderRequest.voice_provider_profile_id
        ) {
          sunoProviderProfile = await getProviderProfileById(
            db,
            renderRequest.voice_provider_profile_id,
          );
          if (
            sunoProviderProfile?.user_id !== track.user_id ||
            sunoProviderProfile?.provider !== "suno" ||
            sunoProviderProfile?.status !== "active"
          ) {
            sunoProviderProfile = null;
          }
        } else {
          sunoProviderProfile = await findActiveProviderProfileForUser(db, {
            userId: track.user_id,
            provider: "suno",
          });
        }
        if (
          (!frozenEngine || frozenEngine === "suno_voice_persona") &&
          sunoProviderProfile &&
          sunoProviderProfile.provider_profile_id &&
          hasPersonaConsentScope(sunoProviderProfile.consent_scope)
        ) {
          userVoiceEngine = "suno_voice_persona";
          voiceProviderProfileId = sunoProviderProfile.id;
        } else {
          if (frozenEngine && frozenEngine !== "suno_voice_persona") {
            throw new Error(
              `E302_PERSONALIZED_VOICE_CONVERSION_DISABLED: My Voice no longer supports '${frozenEngine}' voice conversion. Recreate the render after Suno voice persona is ready.`,
            );
          }
          throw new Error(
            "E302_SUNO_PERSONA_NOT_READY: Active Suno voice persona is required for My Voice renders.",
          );
        }
      }
      const renderContract = buildRenderContract({
        provider: plan.provider_resolved || musicConfig?.provider || null,
        voiceMode: track.voice_mode,
        voiceConversionProvider,
        userVoiceEngine,
        voiceProviderProfileId,
      });
      console.log(
        `[JobRunner] Render contract: track=${track.id} voice_mode=${renderContract.voice_mode} pipeline=${renderContract.pipeline} user_voice_engine=${renderContract.user_voice_engine || "none"} provider_profile=${renderContract.voice_provider_profile_id ? "present" : "none"}`,
      );
      plan.render_contract = renderContract;
      const provenance_json = mergeProvenanceJson(
        trackVersion?.provenance_json || null,
        {
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
              at: nowIso(),
              step: "music_plan",
              event: "music_plan_built",
              provider: plan.provider_resolved || musicConfig?.provider || null,
              style: plan.style,
              generation_mode: plan.generation_mode || "composition_plan",
              voice_mode: renderContract.voice_mode,
              pipeline: renderContract.pipeline,
            },
          ],
        },
      );
      return { music_plan_json: toJson(plan), provenance_json };
    },
  };
}

module.exports = { createMusicPlanSteps };
