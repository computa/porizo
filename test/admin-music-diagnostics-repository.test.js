require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAdminMusicDiagnosticsRepository,
} = require("../src/database/admin-music-diagnostics-repository");

const NOW = "2026-06-27T10:00:00.000Z";

async function seedTrack(db, fields) {
  await db
    .prepare(
      `INSERT INTO tracks (
        id, user_id, status, title, style, voice_mode, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fields.id,
      fields.userId,
      fields.status ?? "complete",
      fields.title ?? fields.id,
      fields.style ?? "pop",
      fields.voiceMode ?? "personalized",
      fields.createdAt ?? NOW,
      fields.updatedAt ?? NOW,
    );
}

async function seedTrackVersion(db, fields) {
  await db
    .prepare(
      `INSERT INTO track_versions (
        id, track_id, version_num, status, render_type, params_hash,
        created_at, completed_at, music_plan_json, provenance_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fields.id,
      fields.trackId,
      fields.versionNum ?? 1,
      fields.status ?? "ready",
      fields.renderType ?? "full",
      fields.paramsHash ?? `${fields.id}_hash`,
      fields.createdAt ?? NOW,
      fields.completedAt ?? null,
      fields.musicPlanJson ?? null,
      fields.provenanceJson ?? null,
    );
}

async function seedJob(db, fields) {
  await db
    .prepare(
      `INSERT INTO jobs (
        id, track_version_id, workflow_type, status, step,
        error_code, error_message, completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fields.id,
      fields.trackVersionId,
      fields.workflowType ?? "render",
      fields.status ?? "failed",
      fields.step ?? "music",
      fields.errorCode ?? null,
      fields.errorMessage ?? null,
      fields.completedAt ?? null,
      fields.createdAt ?? NOW,
      fields.updatedAt ?? NOW,
    );
}

describe("admin music diagnostics repository", () => {
  let db;
  let repository;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAdminMusicDiagnosticsRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("lists recent track versions with joined track fields in diagnostic order", async () => {
    await seedTrack(db, { id: "diag_track_old", userId: "diag_user_old" });
    await seedTrack(db, { id: "diag_track_new", userId: "diag_user_new" });
    await seedTrackVersion(db, {
      id: "diag_version_old",
      trackId: "diag_track_old",
      createdAt: "2026-06-25T10:00:00.000Z",
      completedAt: "2026-06-25T11:00:00.000Z",
    });
    await seedTrackVersion(db, {
      id: "diag_version_new",
      trackId: "diag_track_new",
      createdAt: "2026-06-26T10:00:00.000Z",
      completedAt: null,
    });

    const rows = await repository.listRecentTrackVersions(10);

    assert.deepEqual(
      rows.map((row) => row.id),
      ["diag_version_new", "diag_version_old"],
    );
    assert.equal(rows[0].track_id, "diag_track_new");
    assert.equal(rows[0].user_id, "diag_user_new");
    assert.equal(rows[0].style, "pop");
  });

  test("lists latest jobs for track versions with stable latest-first ordering", async () => {
    await seedJob(db, {
      id: "diag_job_old",
      trackVersionId: "diag_version_jobs",
      errorCode: "OLD",
      completedAt: "2026-06-25T10:00:00.000Z",
      updatedAt: "2026-06-25T10:05:00.000Z",
    });
    await seedJob(db, {
      id: "diag_job_new",
      trackVersionId: "diag_version_jobs",
      errorCode: "NEW",
      errorMessage: "latest failure",
      completedAt: "2026-06-27T10:00:00.000Z",
      updatedAt: "2026-06-27T10:05:00.000Z",
    });
    await seedJob(db, {
      id: "diag_job_other",
      trackVersionId: "diag_version_other",
      errorCode: "OTHER",
      updatedAt: "2026-06-26T10:00:00.000Z",
    });

    const rows = await repository.listLatestJobsForTrackVersions([
      "diag_version_jobs",
      "diag_version_other",
    ]);

    assert.deepEqual(
      rows.map((row) => `${row.track_version_id}:${row.error_code}`),
      [
        "diag_version_jobs:NEW",
        "diag_version_jobs:OLD",
        "diag_version_other:OTHER",
      ],
    );
    assert.equal(rows[0].error_message, "latest failure");
    assert.deepEqual(
      await repository.listLatestJobsForTrackVersions([]),
      [],
    );
  });

  test("finds blend analysis track context and latest active voice profile", async () => {
    await db
      .prepare("INSERT INTO users (id, created_at, risk_level) VALUES (?, ?, 'low')")
      .run("diag_user_voice", NOW);
    await seedTrack(db, {
      id: "diag_track_blend",
      userId: "diag_user_voice",
    });
    await seedTrackVersion(db, {
      id: "diag_version_blend",
      trackId: "diag_track_blend",
      versionNum: 3,
    });

    const insertVoiceProfile = db.prepare(
      `INSERT INTO voice_profiles (
        id, user_id, status, embedding_ref, quality_score, quality_tier,
        quality_metrics_json, model_version, consent_version, consent_at,
        last_verified_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    await insertVoiceProfile.run(
      "diag_voice_old",
      "diag_user_voice",
      "active",
      "voice_profiles/diag_user_voice/old/embedding.bin",
      72,
      "good",
      "{}",
      "embed_test",
      "2.0",
      NOW,
      "2026-06-27T10:01:00.000Z",
      "2026-06-27T10:01:00.000Z",
    );
    await insertVoiceProfile.run(
      "diag_voice_latest",
      "diag_user_voice",
      "active",
      "voice_profiles/diag_user_voice/latest/embedding.bin",
      88,
      "excellent",
      "{}",
      "embed_test",
      "2.0",
      NOW,
      "2026-06-27T10:02:00.000Z",
      "2026-06-27T10:02:00.000Z",
    );

    const context =
      await repository.findTrackVersionBlendContext("diag_version_blend");
    assert.equal(context.id, "diag_version_blend");
    assert.equal(context.track_id, "diag_track_blend");
    assert.equal(context.user_id, "diag_user_voice");
    assert.equal(context.version_num, 3);

    const voiceProfile =
      await repository.findLatestActiveVoiceProfileForUser("diag_user_voice");
    assert.equal(voiceProfile.id, "diag_voice_latest");
    assert.equal(voiceProfile.quality_score, 88);
  });
});
