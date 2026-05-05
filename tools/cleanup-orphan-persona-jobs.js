#!/usr/bin/env node
/**
 * Cleanup Orphan Persona Jobs (U4 deploy gate)
 *
 * Drains in-flight render jobs whose frozen render_contract resolves to the
 * Suno-persona pipeline but lacks a voice_provider_profile_id. Without this,
 * jobs queued before U4 deploy would either retry forever or fail with the
 * mid-render E302_SUNO_PERSONA_NOT_READY error (which iOS surfaces as
 * "infra_terminal/retry" — wrong UX for an unrecoverable structural error).
 *
 * USAGE (DRY-RUN — default; reports affected count, makes no changes):
 *   node tools/cleanup-orphan-persona-jobs.js
 *
 * USAGE (APPLY):
 *   node tools/cleanup-orphan-persona-jobs.js --apply
 *
 * SAFETY:
 *   - Reads via DATABASE_URL/Postgres when DB_PROVIDER=postgres, or local
 *     sqlite path when DB_PROVIDER=sqlite/DB_PATH is set.
 *   - Apply step is idempotent: marks affected jobs as `failed` with a
 *     specific last_error, never deletes rows.
 *   - Logs the affected job IDs (truncated for redaction).
 */

const path = require("node:path");
const { getDatabase } = require("../src/database");

function shortId(id) {
  if (typeof id !== "string") return null;
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const migrationsDir = path.join(process.cwd(), "migrations");
  const db = await getDatabase({
    provider:
      process.env.DB_PROVIDER ||
      (process.env.DATABASE_URL ? "postgres" : "sqlite"),
    dbPath: process.env.DB_PATH || ":memory:",
    migrationsDir,
  });

  // Find jobs whose music_plan_json carries a Suno-persona contract with a null
  // voice_provider_profile_id, AND that are in flight (queued or running).
  const sql = `
    SELECT j.id AS job_id, j.status AS job_status, j.track_version_id,
           tv.music_plan_json
      FROM jobs j
      JOIN track_versions tv ON tv.id = j.track_version_id
     WHERE j.workflow_type IN ('preview_render', 'full_render', 'render')
       AND j.status IN ('queued', 'running')
       AND tv.music_plan_json IS NOT NULL
  `;
  const rows = await db.prepare(sql).all();
  const orphans = [];
  for (const row of rows) {
    let plan;
    try {
      plan = JSON.parse(row.music_plan_json);
    } catch (_) {
      continue;
    }
    const contract = plan?.render_contract;
    if (
      contract &&
      contract.pipeline === "suno_voice_persona_complete_audio" &&
      !contract.voice_provider_profile_id
    ) {
      orphans.push(row);
    }
  }

  console.log(
    JSON.stringify({
      event: "cleanup_orphan_persona_jobs.scan",
      total_jobs_scanned: rows.length,
      orphan_count: orphans.length,
      orphans: orphans.map((r) => ({
        job_id: shortId(r.job_id),
        status: r.job_status,
        track_version_id: shortId(r.track_version_id),
      })),
      apply,
    }),
  );

  if (!apply || orphans.length === 0) {
    console.log(
      "[cleanup] dry-run complete (no rows changed). Re-run with --apply to drain.",
    );
    if (typeof db.close === "function") {
      await db.close();
    }
    return;
  }

  // Drain the entire user-visible state machine: jobs + track_versions + tracks.
  // Failing only the job leaves track_versions stuck in 'processing' and tracks
  // in 'rendering', so the user gets ALREADY_RENDERING permanently when retrying.
  const errMsg =
    "E302_SUNO_PERSONA_PROFILE_MISSING_AT_FREEZE: pre-existing job at U4 deploy time";
  const updatedAt = new Date().toISOString();
  for (const orphan of orphans) {
    await db
      .prepare(
        `UPDATE jobs
            SET status = 'failed',
                last_error = ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(errMsg, updatedAt, orphan.job_id);

    if (orphan.track_version_id) {
      const tvRow = await db
        .prepare("SELECT id, track_id FROM track_versions WHERE id = ?")
        .get(orphan.track_version_id);
      await db
        .prepare(
          `UPDATE track_versions
              SET status = 'failed',
                  failure_reason = ?,
                  updated_at = ?
            WHERE id = ?`,
        )
        .run(errMsg, updatedAt, orphan.track_version_id);
      if (tvRow?.track_id) {
        await db
          .prepare(
            `UPDATE tracks
                SET status = 'failed',
                    updated_at = ?
              WHERE id = ?`,
          )
          .run(updatedAt, tvRow.track_id);
      }
    }
  }
  console.log(
    `[cleanup] drained ${orphans.length} orphan persona render jobs and reset their track_versions/tracks rows.`,
  );
  if (typeof db.close === "function") {
    await db.close();
  }
}

main().catch((err) => {
  console.error("[cleanup] FAILED:", err?.message || err);
  process.exit(1);
});
