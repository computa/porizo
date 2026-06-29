"use strict";

const {
  parseJson,
  toJson,
  nowIso: defaultNowIso,
} = require("../utils/common");
const { extractPolicyTermsFromMessage } = require("../utils/policy-terms");
const {
  sanitizeLyricsForProviderPolicy: defaultSanitizeLyricsForProviderPolicy,
} = require("../services/lyrics-policy-sanitizer");
const {
  submitSunoTask: defaultSubmitSunoTask,
  pollSunoTaskOnce: defaultPollSunoTaskOnce,
  downloadSunoAudio: defaultDownloadSunoAudio,
  logSunoCreditUsage: defaultLogSunoCreditUsage,
  isSunoPolicyError: defaultIsSunoPolicyError,
  classifySunoStatus: defaultClassifySunoStatus,
  inspectSunoAudioReadiness: defaultInspectSunoAudioReadiness,
} = require("../providers/suno");

function createSunoTaskOrchestrator({
  durabilityService,
  jobDurabilityRepository,
  runnerId,
  storageDir,
  storageProvider,
  PROVIDERS,
  sunoPollIntervalSec = 10,
  logProviderRejection,
  lyricsHashSha256,
  extractProviderAudioUrl,
  mergeProvenanceJson,
  getProviderAudioUrl,
  getProviderAudioKey,
  nowIso = defaultNowIso,
  submitSunoTask = defaultSubmitSunoTask,
  pollSunoTaskOnce = defaultPollSunoTaskOnce,
  downloadSunoAudio = defaultDownloadSunoAudio,
  logSunoCreditUsage = defaultLogSunoCreditUsage,
  isSunoPolicyError = defaultIsSunoPolicyError,
  classifySunoStatus = defaultClassifySunoStatus,
  inspectSunoAudioReadiness = defaultInspectSunoAudioReadiness,
  sanitizeLyricsForProviderPolicy = defaultSanitizeLyricsForProviderPolicy,
}) {
  if (!durabilityService) {
    throw new Error("durabilityService is required");
  }
  if (!jobDurabilityRepository) {
    throw new Error("jobDurabilityRepository is required");
  }

  async function pollOrSubmitSunoTask({
    musicConfig,
    job,
    lyrics,
    musicPlan,
    track,
    trackVersion,
    kind,
    routingMetadata,
    sunoPersona = null,
  }) {
    const taskId = job?.external_task_id || null;
    const existingStepData = parseJson(job?.step_data, {}, "suno_step_data");
    const incompleteSuccessPolls = Number(
      existingStepData?.incomplete_success_polls || 0,
    );
    const maxIncompleteSuccessPolls = 36;

    const touchHeartbeat = async () => {
      if (!job) return;
      const stamp = new Date().toISOString();
      await jobDurabilityRepository.heartbeatOwnedJob({
        jobId: job.id,
        runnerId,
        heartbeatAt: stamp,
        updatedAt: stamp,
      });
    };

    const submitTaskForLyrics = async (lyricsPayload) =>
      durabilityService.executeWithDurability({
        provider: PROVIDERS.SUNO,
        fn: () =>
          submitSunoTask({
            baseUrl: musicConfig.baseUrl,
            apiKey: musicConfig.apiKey,
            sunoModel: musicConfig.sunoModel,
            lyrics: lyricsPayload,
            musicPlan,
            track,
            timeoutMs: musicConfig.timeoutMs,
            sunoPersona,
          }),
      });

    function buildPendingResponse({
      taskIdValue,
      status = null,
      incompleteReason = null,
      incompletePolls = incompleteSuccessPolls,
      retryAfterSec = sunoPollIntervalSec,
      reconciling = false,
    }) {
      return {
        pending: true,
        retry_after_sec: retryAfterSec,
        provider: musicConfig.provider,
        task_id: taskIdValue,
        kind,
        suno_reconciling: reconciling,
        incomplete_success_polls: incompletePolls,
        last_suno_status: status,
        last_incomplete_reason: incompleteReason,
        routing: routingMetadata || null,
      };
    }

    function computeNextIncompletePolls({ status, reason }) {
      const nextIncompletePolls = incompleteSuccessPolls + 1;
      if (nextIncompletePolls >= maxIncompleteSuccessPolls) {
        console.warn(
          `[Suno] Exhausted ${maxIncompleteSuccessPolls} incomplete polls for task ${taskId || "unknown"} (status=${status || "unknown"}, reason=${reason || "unknown"})`,
        );
        throw new Error(
          `E302_SUNO_INCOMPLETE_OUTPUT: status=${status || "unknown"}, task=${taskId || "unknown"}, reason=${reason || "unknown"}`,
        );
      }
      if (nextIncompletePolls % 6 === 0) {
        console.log(
          `[Suno] Still waiting for audio: task=${taskId}, poll ${nextIncompletePolls}/${maxIncompleteSuccessPolls}, reason=${reason || "unknown"}`,
        );
      }
      return nextIncompletePolls;
    }

    if (taskId) {
      const pollResult = await durabilityService.executeWithDurability({
        provider: PROVIDERS.SUNO,
        fn: () =>
          pollSunoTaskOnce({
            baseUrl: musicConfig.baseUrl,
            apiKey: musicConfig.apiKey,
            taskId,
            timeoutMs: 30000,
            onHeartbeat: touchHeartbeat,
          }),
      });

      const status = pollResult.status;
      console.log(`[Suno] Poll status for ${taskId}: ${status}`);
      const statusInfo = classifySunoStatus(status);

      if (
        statusInfo.phase === "audio_success" ||
        statusInfo.phase === "provisional_success"
      ) {
        const readiness = inspectSunoAudioReadiness(pollResult.response);
        if (!readiness.ready) {
          const nextIncompletePolls = computeNextIncompletePolls({
            status,
            reason: readiness.reason,
          });
          console.warn(
            `[Suno] Poll status ${status} for task ${taskId} but audio not ready (${readiness.reason}); poll ${nextIncompletePolls}/${maxIncompleteSuccessPolls}`,
          );
          return buildPendingResponse({
            taskIdValue: taskId,
            status,
            incompleteReason: readiness.reason,
            incompletePolls: nextIncompletePolls,
            retryAfterSec: Math.max(12, sunoPollIntervalSec),
            reconciling: true,
          });
        }

        let result;
        try {
          result = await downloadSunoAudio({
            storageDir,
            track,
            trackVersion,
            kind,
            statusResponse: pollResult.response,
            storageProvider,
          });
        } catch (downloadErr) {
          const downloadMessage = String(downloadErr?.message || "");
          if (
            downloadMessage.startsWith("E302_SUNO_AUDIO_NOT_READY:") ||
            downloadMessage.startsWith("E302_SUNO_INCOMPLETE_OUTPUT:")
          ) {
            const nextIncompletePolls = computeNextIncompletePolls({
              status,
              reason: "audio_not_ready",
            });
            console.warn(
              `[Suno] Audio artifact not finalized for task ${taskId}; reconciling ${nextIncompletePolls}/${maxIncompleteSuccessPolls}`,
            );
            return buildPendingResponse({
              taskIdValue: taskId,
              status,
              incompleteReason: "audio_not_ready",
              incompletePolls: nextIncompletePolls,
              retryAfterSec: Math.max(15, sunoPollIntervalSec),
              reconciling: true,
            });
          }
          throw downloadErr;
        }
        logSunoCreditUsage(taskId, pollResult.response);
        return {
          instrumental_url: result?.raw?.instrumental_url || null,
          guide_vocal_url: result?.raw?.guide_vocal_url || null,
          provider_audio_key: result?.raw?.provider_audio_key || null,
        };
      }

      if (statusInfo.phase === "failed") {
        const errorMsg = pollResult.response?.data?.errorMessage || status;
        if (isSunoPolicyError(errorMsg)) {
          logProviderRejection({
            provider: "suno",
            errorCode: "E302_SUNO_POLICY_ERROR",
            errorStatus: "poll_failed",
            rejectedTerms: extractPolicyTermsFromMessage(errorMsg),
            lyricsHash: lyricsHashSha256(lyrics),
            style: musicPlan?.style || null,
            step: kind === "full" ? "instrumental_full" : "instrumental",
            trackId: track?.id,
          });
          throw new Error(
            `E302_SUNO_POLICY_ERROR: Generation failed - ${errorMsg}`,
          );
        }
        throw new Error(`E302_SUNO_ERROR: Generation failed - ${errorMsg}`);
      }

      return buildPendingResponse({
        taskIdValue: taskId,
        status,
        retryAfterSec: sunoPollIntervalSec,
      });
    }

    const baseSanitized = sanitizeLyricsForProviderPolicy({
      lyrics,
      provider: "suno",
      recipientName: track?.recipient_name || null,
    });
    const lyricsForSubmission = baseSanitized.lyrics;
    if (baseSanitized.changed) {
      console.log(
        `[Suno] Applied preflight lyric normalization (${baseSanitized.change_count} change(s)) before submission`,
      );
    }
    let newTaskId;
    try {
      newTaskId = await submitTaskForLyrics(lyricsForSubmission);
    } catch (submitErr) {
      const submitMessage = String(submitErr?.message || "");
      if (isSunoPolicyError(submitMessage)) {
        logProviderRejection({
          provider: "suno",
          errorCode: "E302_SUNO_POLICY_ERROR",
          errorStatus: "submit_failed",
          rejectedTerms: extractPolicyTermsFromMessage(submitMessage),
          lyricsHash: lyricsHashSha256(lyricsForSubmission),
          style: musicPlan?.style || null,
          step: kind === "full" ? "instrumental_full" : "instrumental",
          trackId: track?.id,
        });
        throw new Error(`E302_SUNO_POLICY_ERROR: ${submitMessage}`);
      }
      throw submitErr;
    }

    if (job) {
      const payload = {
        provider: musicConfig.provider,
        task_id: newTaskId,
        kind,
        suno_reconciling: false,
        routing: routingMetadata || null,
      };
      const stamp = new Date().toISOString();
      await jobDurabilityRepository.attachExternalTask({
        jobId: job.id,
        runnerId,
        externalTaskId: newTaskId,
        stepDataJson: toJson(payload),
        heartbeatAt: stamp,
        updatedAt: stamp,
      });
    }

    return buildPendingResponse({
      taskIdValue: newTaskId,
      retryAfterSec: sunoPollIntervalSec,
    });
  }

  async function recoverSunoResultFromExistingTask({
    musicConfig,
    job,
    track,
    trackVersion,
    kind,
    routingMetadata,
    renderContract,
    step,
  }) {
    const taskId = job?.external_task_id;
    if (!taskId || !musicConfig || musicConfig.provider !== "suno") {
      return null;
    }

    try {
      const pollResult = await pollSunoTaskOnce({
        baseUrl: musicConfig.baseUrl,
        apiKey: musicConfig.apiKey,
        taskId,
        timeoutMs: 30000,
      });
      const status = pollResult?.status;
      const statusInfo = classifySunoStatus(status);
      if (
        !(
          statusInfo.phase === "audio_success" ||
          statusInfo.phase === "provisional_success"
        )
      ) {
        return null;
      }

      const readiness = inspectSunoAudioReadiness(pollResult.response);
      if (!readiness.ready) {
        return null;
      }

      logSunoCreditUsage(taskId, pollResult.response);
      const recovered = await downloadSunoAudio({
        storageDir,
        track,
        trackVersion,
        kind,
        statusResponse: pollResult.response,
        storageProvider,
      });
      const providerAudioUrl = extractProviderAudioUrl(recovered?.raw || {});
      const providerAudioKey = recovered?.raw?.provider_audio_key || null;
      const provenance_json = mergeProvenanceJson(
        trackVersion.provenance_json,
        {
          music: {
            ...(parseJson(trackVersion.provenance_json, {}, "prov_suno_recover")
              ?.music || {}),
            provider: "suno",
            routing: routingMetadata || null,
            render_contract: renderContract,
            provider_audio_url:
              providerAudioUrl || getProviderAudioUrl(trackVersion),
            provider_audio_key:
              providerAudioKey || getProviderAudioKey(trackVersion),
          },
          timeline: [
            {
              at: nowIso(),
              step,
              event: "suno_result_reconciled",
              provider: "suno",
              task_id: taskId,
              status,
            },
          ],
        },
      );

      return {
        instrumental_url:
          providerAudioUrl || recovered?.raw?.instrumental_url || null,
        guide_vocal_url:
          renderContract.pipeline === "guide_tts_and_voice_convert"
            ? recovered?.raw?.guide_vocal_url || null
            : null,
        provider_audio_key: providerAudioKey,
        provider_routing: routingMetadata || null,
        provenance_json,
      };
    } catch (err) {
      console.warn(
        `[JobRunner] Suno reconciliation probe failed for task ${taskId}: ${err?.message || err}`,
      );
      return null;
    }
  }

  return {
    pollOrSubmitSunoTask,
    recoverSunoResultFromExistingTask,
  };
}

module.exports = { createSunoTaskOrchestrator };
