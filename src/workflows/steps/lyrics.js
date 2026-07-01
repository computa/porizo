"use strict";

function createLyricsSteps({
  assertPolicySanitizerPreservedStoryDetails,
  buildLyricsContext,
  generateLyrics,
  mergeProvenanceJson,
  nowIso,
  parseJson,
  sanitizeLyricsForAllMusicProviders,
  summarizeLyricsContextForLog,
  toJson,
}) {
  return {
    async lyrics({ track, trackVersion }) {
      const existing = parseJson(trackVersion.lyrics_json, null, "lyrics_json");
      if (existing) {
        const existingProvenance = parseJson(
          trackVersion.provenance_json,
          {},
          "provenance_json",
        );
        console.log(
          `[JobRunner] Skipping lyrics regeneration: existing lyrics_json found ${JSON.stringify(
            {
              quality_score: existingProvenance?.lyrics?.quality_score ?? null,
              acceptance_reason:
                existingProvenance?.lyrics?.acceptance_reason || null,
              provider: existingProvenance?.lyrics?.provider || null,
              model: existingProvenance?.lyrics?.model || null,
              filtered_fact_count:
                existingProvenance?.lyrics?.filtered_fact_count ?? null,
              prompt_budget: existingProvenance?.lyrics?.prompt_budget || null,
              lyrics_summary:
                existingProvenance?.lyrics?.lyrics_summary || null,
              story_context_summary:
                existingProvenance?.lyrics?.story_context_summary || null,
              fidelity: existingProvenance?.lyrics?.fidelity || null,
            },
          )}`,
        );
        return { lyrics_json: trackVersion.lyrics_json };
      }

      try {
        const lyricsContext = buildLyricsContext(track);
        const lyricsContextSummary =
          summarizeLyricsContextForLog(lyricsContext);
        console.log(
          `[JobRunner] Lyrics context summary=${JSON.stringify(lyricsContextSummary)}`,
        );

        const result = await generateLyrics(lyricsContext);
        const compliance = sanitizeLyricsForAllMusicProviders(result.lyrics, {
          recipientName: track?.recipient_name || null,
        });
        if (compliance.changed) {
          console.warn(
            `[JobRunner] Lyrics compliance sanitizer applied ${compliance.change_count} edit(s) across providers`,
          );
          assertPolicySanitizerPreservedStoryDetails({
            originalLyrics: result.lyrics,
            sanitizedLyrics: compliance.lyrics,
            storyContext: lyricsContext,
            provider: "all",
            step: "lyrics",
            trackId: track.id,
          });
        }
        if (compliance.blocked) {
          const blockedTerms = compliance.reports
            .flatMap((report) => report.violation_terms || [])
            .filter(Boolean)
            .slice(0, 8);
          throw new Error(
            `E302_PROVIDER_POLICY_ERROR: Generated lyrics still contain restricted terms (${blockedTerms.join(", ") || "unknown"}).`,
          );
        }
        const lyricsProvenance = mergeProvenanceJson(
          trackVersion.provenance_json,
          {
            lyrics: {
              compliance_sanitized: compliance.changed,
              compliance_change_count: compliance.change_count,
              compliance_reports: compliance.reports,
              provider: result.provider || null,
              model: result.model || null,
              usage: result.usage || null,
              quality_score: result.quality_score ?? null,
              acceptance_reason: result.acceptance_reason || null,
              filtered_fact_count: Number.isFinite(result.filtered_fact_count)
                ? result.filtered_fact_count
                : null,
              story_context_summary: lyricsContextSummary,
              prompt_input_summary: result.prompt_input_summary || null,
              prompt_budget: result.prompt_budget || null,
              lyrics_summary: result.lyrics_summary || null,
              contract_validation: result.contract_validation || null,
              fidelity: result.fidelity_debug || null,
            },
            timeline: compliance.changed
              ? [
                  {
                    at: nowIso(),
                    step: "lyrics",
                    event: "lyrics_policy_sanitized",
                    change_count: compliance.change_count,
                  },
                ]
              : [],
          },
        );

        return {
          lyrics_json: toJson(compliance.lyrics),
          lyrics_status: result.lyrics_status,
          lyrics_updated_at: new Date().toISOString(),
          provenance_json: lyricsProvenance,
        };
      } catch (err) {
        if (
          err &&
          (err.code === "AI_UNAVAILABLE" || err.message === "AI_UNAVAILABLE")
        ) {
          throw new Error("E201_LYRICS_ERROR: AI_UNAVAILABLE");
        }
        if (err && err.code === "LYRICS_QUALITY_LOW") {
          const qualityScore = Number.isFinite(err.quality_score)
            ? err.quality_score
            : "unknown";
          throw new Error(
            `E201_LYRICS_ERROR: LYRICS_QUALITY_LOW: quality score ${qualityScore}`,
          );
        }
        if (err && err.code === "LYRICS_FIDELITY_LOW") {
          const fidelityReason =
            err.fidelity?.feedback || "story fidelity below threshold";
          throw new Error(
            `E201_LYRICS_ERROR: LYRICS_FIDELITY_LOW: ${fidelityReason}`,
          );
        }
        throw err;
      }
    },
  };
}

module.exports = { createLyricsSteps };
