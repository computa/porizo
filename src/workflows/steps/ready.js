"use strict";

function createReadySteps({
  clampNumber,
  evaluateRenderQuality,
  getRuntimeMusicRoutingConfig,
  mergeProvenanceJson,
  nowIso,
  parseJson,
  providerConfig,
  tightenMusicPlanForReroll,
  toJson,
}) {
  return {
    async ready({ track, trackVersion, workflow }) {
      const runtimeConfig = await getRuntimeMusicRoutingConfig();
      const qualityThreshold = clampNumber(
        runtimeConfig.quality_threshold,
        0,
        100,
        72,
      );
      const maxRerolls = Math.max(
        0,
        Math.min(3, Number(runtimeConfig.max_rerolls ?? 1) || 0),
      );
      const rerollEnabled = runtimeConfig.auto_reroll_enabled !== false;
      const musicPlan = parseJson(
        trackVersion.music_plan_json,
        null,
        "ready_music_plan",
      );
      const provenanceState = parseJson(
        trackVersion.provenance_json,
        {},
        "ready_provenance",
      );
      const rerollCount = Number(provenanceState?.quality?.reroll_count || 0);
      const liveMusicProviderAvailable =
        Boolean(providerConfig?.elevenlabs?.live) ||
        Boolean(providerConfig?.suno?.live);

      if (!liveMusicProviderAvailable) {
        const skippedQuality = {
          passed: true,
          skipped: true,
          reason: "live_music_provider_unavailable",
          threshold: qualityThreshold,
          total_score: 100,
        };
        const provenance_json = mergeProvenanceJson(
          trackVersion.provenance_json,
          {
            quality: {
              threshold: qualityThreshold,
              last_evaluation: skippedQuality,
              reroll_count: rerollCount,
            },
            timeline: [
              {
                at: nowIso(),
                step: "ready",
                event: "quality_gate_skipped",
              },
            ],
          },
        );
        return { provenance_json, quality_gate: skippedQuality };
      }

      const qualityReport = await evaluateRenderQuality({
        track,
        trackVersion,
        workflowType: workflow,
        musicPlan,
        qualityThreshold,
      });

      const provenance_json = mergeProvenanceJson(
        trackVersion.provenance_json,
        {
          quality: {
            threshold: qualityThreshold,
            last_evaluation: qualityReport,
            reroll_count: qualityReport.passed
              ? rerollCount
              : rerollEnabled && rerollCount < maxRerolls
                ? rerollCount + 1
                : rerollCount,
          },
          timeline: [
            {
              at: nowIso(),
              step: "ready",
              event: qualityReport.passed
                ? "quality_gate_passed"
                : "quality_gate_failed",
              score: qualityReport.total_score,
              threshold: qualityThreshold,
              reroll_count: rerollCount,
            },
          ],
        },
      );

      if (qualityReport.passed) {
        return {
          provenance_json,
          quality_gate: qualityReport,
        };
      }

      if (rerollEnabled && rerollCount < maxRerolls) {
        const tightenedPlan = tightenMusicPlanForReroll(
          musicPlan,
          qualityReport,
        );
        return {
          reroll_requested: true,
          reroll_count: rerollCount + 1,
          reroll_reason: qualityReport.summary,
          music_plan_json: tightenedPlan ? toJson(tightenedPlan) : null,
          quality_gate: qualityReport,
          provenance_json,
        };
      }

      throw new Error(`E302_QUALITY_GATE_FAILED: ${qualityReport.summary}`);
    },
  };
}

module.exports = { createReadySteps };
