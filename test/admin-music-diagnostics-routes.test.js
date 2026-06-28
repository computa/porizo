require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");

const NOW = "2026-06-27T10:00:00.000Z";

function buildTestApp(db) {
  return buildServer({
    db,
    config: {
      STORAGE_DIR: "/tmp/test-storage",
      PUBLIC_BASE_URL: "http://public.local",
      STREAM_BASE_URL: "http://stream.local",
      ALLOW_ANON_USER_ID: true,
    },
    storage: {
      put: async () => {},
      get: async () => null,
      exists: async () => false,
      delete: async () => {},
      getSignedUrl: async (key) => `http://localhost/${key}`,
    },
  });
}

async function loginAdmin(app) {
  const response = await app.inject({
    method: "POST",
    url: "/admin/auth/login",
    payload: { email: "admin@porizo.app", password: "admin123" },
  });
  assert.equal(response.statusCode, 200, response.body);
  return { Authorization: `Bearer ${response.json().token}` };
}

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
      fields.style ?? "cinematic pop",
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

describe("admin music diagnostics routes", () => {
  let db;
  let app;
  let adminHeaders;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildTestApp(db);
    adminHeaders = await loginAdmin(app);
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("requires an admin session", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/music/diagnostics",
    });
    assert.equal(response.statusCode, 401, response.body);
    assert.equal(response.json().error, "UNAUTHORIZED");
  });

  test("returns parsed diagnostics, filters provider/status, and includes latest job error", async () => {
    await seedTrack(db, {
      id: "diag_route_suno_track",
      userId: "diag_route_suno_user",
      title: "Suno Route",
      style: "bright pop",
      voiceMode: "clone",
    });
    await seedTrackVersion(db, {
      id: "diag_route_suno_version",
      trackId: "diag_route_suno_track",
      versionNum: 2,
      status: "ready",
      createdAt: "2026-06-27T08:00:00.000Z",
      completedAt: "2026-06-27T09:00:00.000Z",
      musicPlanJson: JSON.stringify({
        provider_resolved: "suno",
        provider_support: "strong",
        provider_support_score: 0.92,
        provider_resolution_reason: "best_style_match",
        generation_mode: "full",
        plan_schema_version: "music-plan-v3",
        style_prompt_compact: "bright emotional pop",
        provider_style_hint: "warm vocal",
        style_negative_constraints: ["no EDM"],
        style_intent: { mood: "warm" },
      }),
      provenanceJson: JSON.stringify({
        music: { provider: "elevenlabs" },
        quality: {
          last_evaluation: { passed: true, score: 0.86 },
          reroll_count: 2,
        },
      }),
    });
    await seedJob(db, {
      id: "diag_route_suno_old_job",
      trackVersionId: "diag_route_suno_version",
      errorCode: "OLD_PROVIDER_ERROR",
      errorMessage: "old failure",
      completedAt: "2026-06-27T08:30:00.000Z",
      updatedAt: "2026-06-27T08:35:00.000Z",
    });
    await seedJob(db, {
      id: "diag_route_suno_latest_job",
      trackVersionId: "diag_route_suno_version",
      errorCode: "LATEST_PROVIDER_ERROR",
      errorMessage: "latest failure",
      completedAt: "2026-06-27T09:30:00.000Z",
      updatedAt: "2026-06-27T09:35:00.000Z",
    });

    await seedTrack(db, {
      id: "diag_route_eleven_track",
      userId: "diag_route_eleven_user",
      title: "Eleven Route",
    });
    await seedTrackVersion(db, {
      id: "diag_route_eleven_version",
      trackId: "diag_route_eleven_track",
      status: "failed",
      createdAt: "2026-06-27T07:00:00.000Z",
      provenanceJson: JSON.stringify({ music: { provider: "elevenlabs" } }),
    });

    await seedTrack(db, {
      id: "diag_route_bad_json_track",
      userId: "diag_route_bad_json_user",
      title: "Bad JSON Route",
    });
    await seedTrackVersion(db, {
      id: "diag_route_bad_json_version",
      trackId: "diag_route_bad_json_track",
      status: "ready",
      createdAt: "2026-06-27T06:00:00.000Z",
      musicPlanJson: "{bad-json",
      provenanceJson: "{bad-json",
    });

    const filtered = await app.inject({
      method: "GET",
      url: "/admin/dashboard/music/diagnostics?provider=suno&status=ready&limit=10",
      headers: adminHeaders,
    });
    assert.equal(filtered.statusCode, 200, filtered.body);
    assert.equal(filtered.json().diagnostics.length, 1);

    const [diagnostic] = filtered.json().diagnostics;
    assert.deepEqual(diagnostic, {
      track_version_id: "diag_route_suno_version",
      track_id: "diag_route_suno_track",
      version_num: 2,
      user_id: "diag_route_suno_user",
      title: "Suno Route",
      style: "bright pop",
      voice_mode: "clone",
      status: "ready",
      created_at: "2026-06-27T08:00:00.000Z",
      completed_at: "2026-06-27T09:00:00.000Z",
      provider: "suno",
      provider_support: "strong",
      provider_support_score: 0.92,
      provider_resolution_reason: "best_style_match",
      generation_mode: "full",
      plan_schema_version: "music-plan-v3",
      style_prompt_compact: "bright emotional pop",
      provider_style_hint: "warm vocal",
      style_negative_constraints: ["no EDM"],
      style_intent: { mood: "warm" },
      quality_gate: { passed: true, score: 0.86 },
      reroll_count: 2,
      last_error_code: "LATEST_PROVIDER_ERROR",
      last_error_message: "latest failure",
      last_error_at: "2026-06-27T09:35:00.000Z",
    });

    const unfiltered = await app.inject({
      method: "GET",
      url: "/admin/dashboard/music/diagnostics?limit=10",
      headers: adminHeaders,
    });
    assert.equal(unfiltered.statusCode, 200, unfiltered.body);
    const byId = Object.fromEntries(
      unfiltered.json().diagnostics.map((row) => [row.track_version_id, row]),
    );
    assert.equal(byId.diag_route_eleven_version.provider, "elevenlabs");
    assert.equal(byId.diag_route_bad_json_version.provider, null);
    assert.equal(byId.diag_route_bad_json_version.quality_gate, null);
    assert.equal(byId.diag_route_bad_json_version.reroll_count, 0);
  });
});
