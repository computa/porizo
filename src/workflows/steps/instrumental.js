"use strict";

const fs = require("fs");
const path = require("path");

function createInstrumentalSteps({
  assertFrozenContract,
  assertPersonalizedContract,
  assertPolicySanitizerPreservedStoryDetails,
  buildLyricsContext,
  buildPolicyPreflightError,
  durabilityService,
  extractProviderAudioUrl,
  getMusicProviderConfig,
  getProviderAudioKey,
  getProviderAudioUrl,
  getVersionDir,
  jobDurabilityRepository,
  logProviderRejection,
  logSanitizerIntervention,
  lyricsHashSha256,
  mergeProvenanceJson,
  nowIso,
  parseJson,
  pollOrSubmitSunoTask,
  PROVIDERS,
  recoverSunoResultFromExistingTask,
  renderGuideVocal,
  renderInstrumental,
  renderWithProvider,
  resolveRenderContract,
  resolveSunoPersonaForRender,
  runnerId,
  sanitizeLyricsForProviderPolicy,
  sanitizeProviderRoutingForContract,
  storageDir,
  storageProvider,
  summarizePolicyTerms,
  toJson,
}) {
  async function runInstrumental({ track, trackVersion, job, kind }) {
    const isFull = kind === "full";
    const stepName = isFull ? "instrumental_full" : "instrumental";
    const versionDir = getVersionDir(storageDir, track, trackVersion);

    if (!isFull) {
      const instFile = path.join(versionDir, "inst_preview.mp3");
      if (fs.existsSync(instFile)) {
        console.log(
          "[JobRunner] Reusing existing instrumental: inst_preview.mp3",
        );
        return {};
      }
    }

    const lyrics = parseJson(
      trackVersion.lyrics_json,
      null,
      `${stepName}_lyrics`,
    );
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
    if (!lyrics) {
      throw new Error(
        `E302_WORKFLOW_ERROR: lyrics_json is required before ${stepName} step`,
      );
    }

    const pinnedProvider =
      renderContract.provider_locked || musicPlan?.provider_resolved || null;
    const musicConfig = await getMusicProviderConfig({
      requestedStyle: musicPlan?.style || track.style,
      pinnedProvider,
    });
    const routingMetadata = sanitizeProviderRoutingForContract(
      musicConfig?.routing || null,
      renderContract,
    );
    const policyPreflight = musicConfig
      ? sanitizeLyricsForProviderPolicy({
          lyrics,
          provider: musicConfig.provider,
          recipientName: track?.recipient_name || null,
        })
      : null;
    const lyricsForProvider = policyPreflight?.lyrics || lyrics;
    const policyPreflightMeta = policyPreflight
      ? {
          provider: musicConfig.provider,
          changed: Boolean(policyPreflight.changed),
          blocked: Boolean(policyPreflight.blocked),
          rewrite_passes: policyPreflight.rewrite_passes || 0,
          change_count: policyPreflight.change_count || 0,
          violation_terms: summarizePolicyTerms(
            policyPreflight.violations || [],
            8,
          ),
          violation_count: Array.isArray(policyPreflight.violations)
            ? policyPreflight.violations.length
            : 0,
        }
      : null;

    if (policyPreflight?.changed) {
      console.log(
        `[JobRunner] Policy preflight adjusted lyrics for provider=${musicConfig.provider} (${policyPreflight.change_count} edits, passes=${policyPreflight.rewrite_passes})`,
      );
      assertPolicySanitizerPreservedStoryDetails({
        originalLyrics: lyrics,
        sanitizedLyrics: lyricsForProvider,
        storyContext: buildLyricsContext(track),
        provider: musicConfig.provider,
        step: stepName,
        trackId: track.id,
      });
      logSanitizerIntervention({
        provider: musicConfig.provider,
        changeCount: policyPreflight.change_count,
        rewritePasses: policyPreflight.rewrite_passes,
        violationTerms: summarizePolicyTerms(policyPreflight.violations || [], 8),
        style: musicPlan?.style || track.style,
        step: stepName,
        trackId: track.id,
      });
    }
    if (policyPreflight?.blocked) {
      logProviderRejection({
        provider: musicConfig.provider,
        errorCode: "E302_PROVIDER_POLICY_ERROR",
        errorStatus: "preflight_blocked",
        rejectedTerms: summarizePolicyTerms(policyPreflight.violations || [], 8),
        lyricsHash: lyricsHashSha256(trackVersion.lyrics_json),
        style: musicPlan?.style || track.style,
        step: stepName,
        trackId: track.id,
      });
      throw buildPolicyPreflightError(policyPreflight);
    }

    if (musicConfig && musicConfig.provider === "suno") {
      const sunoPersona = await resolveSunoPersonaForRender({
        track,
        renderContract,
      });
      try {
        const sunoResult = await pollOrSubmitSunoTask({
          musicConfig,
          job,
          lyrics: lyricsForProvider,
          musicPlan,
          track,
          trackVersion,
          kind,
          routingMetadata,
          sunoPersona,
        });
        if (sunoResult?.pending) {
          return sunoResult;
        }
        const providerAudioUrl =
          sunoResult?.instrumental_url || sunoResult?.guide_vocal_url || null;
        const providerAudioKey = sunoResult?.provider_audio_key || null;
        const provenance_json = mergeProvenanceJson(
          trackVersion.provenance_json,
          {
            music: {
              ...(parseJson(
                trackVersion.provenance_json,
                {},
                isFull ? "prov_full_music_suno" : "prov_preview_music_suno",
              )?.music || {}),
              provider: musicConfig.provider,
              routing: routingMetadata,
              render_contract: renderContract,
              provider_audio_url:
                providerAudioUrl || getProviderAudioUrl(trackVersion),
              provider_audio_key:
                providerAudioKey || getProviderAudioKey(trackVersion),
              policy_preflight: policyPreflightMeta || null,
            },
            timeline: [
              policyPreflightMeta
                ? {
                    at: nowIso(),
                    step: stepName,
                    event: "policy_preflight_applied",
                    provider: musicConfig.provider,
                    changed: policyPreflightMeta.changed,
                    blocked: policyPreflightMeta.blocked,
                    change_count: policyPreflightMeta.change_count,
                    violation_count: policyPreflightMeta.violation_count,
                  }
                : null,
              {
                at: nowIso(),
                step: stepName,
                event: "music_generated",
                provider: musicConfig.provider,
                pipeline: renderContract.pipeline,
              },
            ].filter(Boolean),
          },
        );
        const normalizedSunoResult = {
          ...sunoResult,
          instrumental_url: providerAudioUrl,
          guide_vocal_url:
            renderContract.pipeline === "guide_tts_and_voice_convert"
              ? sunoResult?.guide_vocal_url || null
              : null,
          provider_routing: routingMetadata,
          provenance_json,
        };
        if (policyPreflightMeta) {
          return {
            ...normalizedSunoResult,
            policy_preflight: policyPreflightMeta,
          };
        }
        return normalizedSunoResult;
      } catch (sunoErr) {
        if (
          String(sunoErr?.message || "").includes(
            "E302_SUNO_INCOMPLETE_OUTPUT",
          )
        ) {
          const recoveredResult = await recoverSunoResultFromExistingTask({
            musicConfig,
            job,
            track,
            trackVersion,
            kind,
            routingMetadata,
            renderContract,
            step: stepName,
          });
          if (recoveredResult) {
            console.warn(
              `[JobRunner] Recovered Suno ${isFull ? "full " : ""}output from existing task for track ${track.id} after incomplete-output error`,
            );
            return recoveredResult;
          }
        }
        throw sunoErr;
      }
    }

    if (musicConfig) {
      const onTaskId = job
        ? async (taskId) => {
            const payload = {
              provider: musicConfig.provider,
              task_id: taskId,
              kind,
              routing: routingMetadata,
            };
            const stamp = new Date().toISOString();
            await jobDurabilityRepository.attachExternalTask({
              jobId: job.id,
              runnerId,
              externalTaskId: taskId,
              stepDataJson: toJson(payload),
              heartbeatAt: stamp,
              updatedAt: stamp,
            });
          }
        : null;
      const result = await durabilityService.executeWithDurability({
        provider:
          musicConfig.provider === "suno"
            ? PROVIDERS.SUNO
            : PROVIDERS.ELEVENLABS,
        fn: async () =>
          renderWithProvider({
            storageDir,
            track,
            trackVersion,
            kind,
            providerConfig: musicConfig,
            lyrics: lyricsForProvider,
            musicPlan,
            onTaskId,
            sunoPersona: await resolveSunoPersonaForRender({
              track,
              renderContract,
            }),
            storageProvider,
          }),
      });
      const providerMetadata = result?.raw || {};
      const providerAudioUrl = extractProviderAudioUrl(providerMetadata);
      const providerAudioKey = providerMetadata.provider_audio_key || null;
      const useGuideUrl =
        renderContract.pipeline === "guide_tts_and_voice_convert";
      const provenance_json = mergeProvenanceJson(
        trackVersion.provenance_json,
        {
          music: {
            ...(parseJson(
              trackVersion.provenance_json,
              {},
              isFull ? "prov_full_music" : "prov_preview_music",
            )?.music || {}),
            provider: musicConfig.provider,
            routing: routingMetadata,
            render_contract: renderContract,
            provider_audio_url:
              providerAudioUrl || getProviderAudioUrl(trackVersion),
            provider_audio_key:
              providerAudioKey || getProviderAudioKey(trackVersion),
            generation_mode:
              providerMetadata.generation_mode ||
              musicPlan?.generation_mode ||
              musicConfig?.runtimeConfig?.elevenlabs_generation_mode ||
              "composition_plan",
            model_id: providerMetadata.model_id || null,
            plan_endpoint: providerMetadata.plan_endpoint || null,
            compose_endpoint: providerMetadata.compose_endpoint || null,
            composition_plan_summary:
              providerMetadata.composition_plan_summary || null,
            response_bytes: providerMetadata.response_bytes || null,
            policy_preflight: policyPreflightMeta || null,
          },
          timeline: [
            policyPreflightMeta
              ? {
                  at: nowIso(),
                  step: stepName,
                  event: "policy_preflight_applied",
                  provider: musicConfig.provider,
                  changed: policyPreflightMeta.changed,
                  blocked: policyPreflightMeta.blocked,
                  change_count: policyPreflightMeta.change_count,
                  violation_count: policyPreflightMeta.violation_count,
                }
              : null,
            {
              at: nowIso(),
              step: stepName,
              event: "music_generated",
              provider: musicConfig.provider,
              generation_mode:
                providerMetadata.generation_mode ||
                musicPlan?.generation_mode ||
                musicConfig?.runtimeConfig?.elevenlabs_generation_mode ||
                "composition_plan",
              pipeline: renderContract.pipeline,
            },
          ].filter(Boolean),
        },
      );
      return {
        instrumental_url:
          providerAudioUrl || result?.raw?.instrumental_url || null,
        guide_vocal_url: useGuideUrl
          ? result?.raw?.guide_vocal_url || null
          : null,
        provider_routing: routingMetadata,
        provenance_json,
      };
    }

    if (isPersonalized) {
      throw new Error(
        "E302_PERSONALIZED_NO_PROVIDER: Personalized render requires a live music provider.",
      );
    }
    renderInstrumental({ storageDir, track, trackVersion, kind });
    renderGuideVocal({ storageDir, track, trackVersion, kind });
    return {};
  }

  return {
    instrumental(context) {
      return runInstrumental({ ...context, kind: "preview" });
    },
    instrumental_full(context) {
      return runInstrumental({ ...context, kind: "full" });
    },
  };
}

module.exports = { createInstrumentalSteps };
