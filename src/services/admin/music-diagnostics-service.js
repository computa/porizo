"use strict";

const { safeBounds } = require("./pagination");

function parseJsonObject(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function latestJobsByTrackVersion(jobRows) {
  const latestJobByTrackVersion = new Map();
  for (const job of jobRows) {
    if (!latestJobByTrackVersion.has(job.track_version_id)) {
      latestJobByTrackVersion.set(job.track_version_id, job);
    }
  }
  return latestJobByTrackVersion;
}

function buildDiagnostic(row, latestJob) {
  const musicPlan = parseJsonObject(row.music_plan_json);
  const provenance = parseJsonObject(row.provenance_json);
  const resolvedProvider =
    musicPlan.provider_resolved ||
    provenance?.music?.provider ||
    provenance?.render?.provider ||
    null;

  return {
    track_version_id: row.id,
    track_id: row.track_id,
    version_num: row.version_num,
    user_id: row.user_id,
    title: row.title,
    style: row.style,
    voice_mode: row.voice_mode,
    status: row.status,
    created_at: row.created_at,
    completed_at: row.completed_at,
    provider: resolvedProvider,
    provider_support: musicPlan.provider_support || null,
    provider_support_score: musicPlan.provider_support_score ?? null,
    provider_resolution_reason: musicPlan.provider_resolution_reason || null,
    generation_mode: musicPlan.generation_mode || null,
    plan_schema_version: musicPlan.plan_schema_version || null,
    style_prompt_compact: musicPlan.style_prompt_compact || null,
    provider_style_hint: musicPlan.provider_style_hint || null,
    style_negative_constraints: musicPlan.style_negative_constraints || null,
    style_intent: musicPlan.style_intent || null,
    quality_gate: provenance?.quality?.last_evaluation || null,
    reroll_count: provenance?.quality?.reroll_count ?? 0,
    last_error_code: latestJob?.error_code || null,
    last_error_message: latestJob?.error_message || null,
    last_error_at: latestJob?.updated_at || null,
  };
}

function createAdminMusicDiagnosticsService({
  adminMusicDiagnosticsRepository,
}) {
  if (!adminMusicDiagnosticsRepository) {
    throw new Error("adminMusicDiagnosticsRepository is required");
  }

  async function getRecentMusicDiagnostics({
    limit = 30,
    provider = null,
    status = null,
  }) {
    const bounds = safeBounds(limit, 0, 100);
    const rows =
      (await adminMusicDiagnosticsRepository.listRecentTrackVersions(
        bounds.limit,
      )) || [];
    const jobRows =
      (await adminMusicDiagnosticsRepository.listLatestJobsForTrackVersions(
        rows.map((row) => row.id),
      )) || [];
    const latestJobByTrackVersion = latestJobsByTrackVersion(jobRows);

    const diagnostics = [];
    for (const row of rows) {
      if (status && row.status !== status) {
        continue;
      }

      const diagnostic = buildDiagnostic(
        row,
        latestJobByTrackVersion.get(row.id),
      );
      if (provider && diagnostic.provider !== provider) {
        continue;
      }

      diagnostics.push(diagnostic);
    }

    return { diagnostics };
  }

  return {
    getRecentMusicDiagnostics,
  };
}

module.exports = {
  createAdminMusicDiagnosticsService,
  parseJsonObject,
};
