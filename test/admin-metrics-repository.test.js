process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAdminMetricsRepository,
} = require("../src/database/admin-metrics-repository");
const {
  createAdminMetricsService,
} = require("../src/services/admin/metrics-service");

const DAY_AGO = "2026-06-26T10:00:00.000Z";
const WEEK_AGO = "2026-06-20T10:00:00.000Z";
const ENROLLMENT_WEEK_AGO = "2026-06-20T10:00:00.000Z";
const RENDER_WEEK_AGO = "2026-06-20T10:00:00.000Z";
const COST_DAYS_AGO = "2026-06-20T10:00:00.000Z";
const RISK_NOW = "2026-06-27T10:00:00.000Z";
const RISK_WEEK_AGO = "2026-06-20T10:00:00.000Z";

function createMetricsService(adminMetricsRepository) {
  return createAdminMetricsService({
    adminMetricsRepository,
    now: () => new Date(RISK_NOW),
  });
}

let db;
let repository;
let renderVersionCounter;

async function seedUser({ id, createdAt, tier = null }) {
  await db
    .prepare("INSERT INTO users (id, created_at, risk_level) VALUES (?, ?, 'low')")
    .run(id, createdAt);
  if (tier) {
      await db
        .prepare(
          `INSERT INTO entitlements (
          user_id, tier, updated_at
        ) VALUES (?, ?, ?)`,
        )
        .run(id, tier, createdAt);
  }
}

async function seedTrackVersion({ id, renderType, createdAt }) {
  const trackId = `${id}_track`;
  await db
    .prepare(
      `INSERT INTO tracks (
        id, user_id, status, title, latest_version, created_at, updated_at
      ) VALUES (?, 'overview_repo_user_inside_day', 'complete', 'Overview Song', 1, ?, ?)`,
    )
    .run(trackId, createdAt, createdAt);
  await db
    .prepare(
      `INSERT INTO track_versions (
        id, track_id, version_num, status, render_type, params_hash, created_at
      ) VALUES (?, ?, 1, 'complete', ?, ?, ?)`,
    )
    .run(id, trackId, renderType, `${id}_hash`, createdAt);
}

async function seedJob({ id, status, createdAt }) {
  await db
    .prepare(
      `INSERT INTO jobs (
        id, track_version_id, workflow_type, status, created_at, updated_at
      ) VALUES (?, 'overview_repo_version_preview_recent', 'song_render', ?, ?, ?)`,
    )
    .run(id, status, createdAt, createdAt);
}

async function seedEnrollmentSession({ id, userId, status, startedAt }) {
  await db
    .prepare(
      `INSERT INTO enrollment_sessions (
        id, user_id, status, started_at, expires_at
      ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, userId, status, startedAt, "2026-07-01T10:00:00.000Z");
}

async function seedVoiceProfile({
  id,
  userId,
  score,
  status = "active",
  deletedAt = null,
}) {
  await db
    .prepare(
      `INSERT INTO voice_profiles (
        id, user_id, status, quality_score, created_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, userId, status, score, "2026-06-26T10:00:00.000Z", deletedAt);
}

async function seedRenderMetricsTrack() {
  await seedUser({
    id: "render_repo_owner",
    createdAt: "2026-06-01T10:00:00.000Z",
  });
  await db
    .prepare(
      `INSERT INTO tracks (
        id, user_id, status, title, latest_version, created_at, updated_at
      ) VALUES (?, 'render_repo_owner', 'complete', 'Render Metrics Song', 1, ?, ?)`,
    )
    .run(
      "render_repo_track",
      "2026-06-01T10:00:00.000Z",
      "2026-06-01T10:00:00.000Z",
    );
}

async function seedRenderTrackVersion({ id, renderType, status, completedAt }) {
  renderVersionCounter += 1;
  await db
    .prepare(
      `INSERT INTO track_versions (
        id, track_id, version_num, status, render_type, params_hash, created_at, completed_at
      ) VALUES (?, 'render_repo_track', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      renderVersionCounter,
      status,
      renderType,
      `${id}_hash`,
      completedAt || "2026-06-26T10:00:00.000Z",
      completedAt,
    );
}

async function seedCostTrackVersion({
  id,
  renderType,
  status = "completed",
  createdAt,
  costEstimateJson = null,
  actualCostJson = null,
}) {
  renderVersionCounter += 1;
  await db
    .prepare(
      `INSERT INTO track_versions (
        id, track_id, version_num, status, render_type, params_hash,
        created_at, cost_estimate_json, actual_cost_json
      ) VALUES (?, 'render_repo_track', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      renderVersionCounter,
      status,
      renderType,
      `${id}_hash`,
      createdAt,
      costEstimateJson,
      actualCostJson,
    );
}

async function seedRenderJob({
  id,
  status,
  step = null,
  errorCode = null,
  createdAt,
  updatedAt,
}) {
  await db
    .prepare(
      `INSERT INTO jobs (
        id, track_version_id, workflow_type, status, step, error_code, created_at, updated_at
      ) VALUES (?, 'render_repo_preview_ready_recent', 'song_render', ?, ?, ?, ?, ?)`,
    )
    .run(id, status, step, errorCode, createdAt, updatedAt);
}

async function seedRiskUser({
  id,
  riskLevel,
  lockedUntil = null,
  deletedAt = null,
}) {
  await db
    .prepare(
      `INSERT INTO users (
        id, created_at, risk_level, locked_until, deleted_at
      ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, "2026-06-01T10:00:00.000Z", riskLevel, lockedUntil, deletedAt);
}

async function seedRiskAudit({ id, resourceId, metadataJson, createdAt }) {
  await db
    .prepare(
      `INSERT INTO audit_logs (
        id, user_id, action, resource_type, resource_id, metadata_json, created_at
      ) VALUES (?, 'admin_repo_risk', 'admin_update_risk', 'user', ?, ?, ?)`,
    )
    .run(id, resourceId, metadataJson, createdAt);
}

function countMap(rows, key = "status") {
  return Object.fromEntries(rows.map((row) => [row[key], row.count]));
}

describe("AdminMetricsRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAdminMetricsRepository(db);
    renderVersionCounter = 0;
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("getOverviewMetrics preserves aggregate semantics and exclusive date boundaries", async () => {
    await seedUser({
      id: "overview_repo_user_inside_day",
      createdAt: "2026-06-26T10:00:01.000Z",
      tier: "pro",
    });
    await seedUser({
      id: "overview_repo_user_at_day_boundary",
      createdAt: DAY_AGO,
      tier: "trial",
    });
    await seedUser({
      id: "overview_repo_user_inside_week",
      createdAt: "2026-06-20T10:00:01.000Z",
      tier: "free",
    });
    await seedUser({
      id: "overview_repo_user_at_week_boundary",
      createdAt: WEEK_AGO,
    });

    await seedTrackVersion({
      id: "overview_repo_version_preview_recent",
      renderType: "preview",
      createdAt: "2026-06-26T10:00:01.000Z",
    });
    await seedTrackVersion({
      id: "overview_repo_version_preview_boundary",
      renderType: "preview",
      createdAt: DAY_AGO,
    });
    await seedTrackVersion({
      id: "overview_repo_version_full_recent",
      renderType: "full",
      createdAt: "2026-06-26T10:00:02.000Z",
    });

    await seedJob({
      id: "overview_repo_job_failed_a",
      status: "failed",
      createdAt: "2026-06-26T10:05:00.000Z",
    });
    await seedJob({
      id: "overview_repo_job_failed_b",
      status: "failed",
      createdAt: "2026-06-26T10:06:00.000Z",
    });
    await seedJob({
      id: "overview_repo_job_running",
      status: "running",
      createdAt: "2026-06-26T10:07:00.000Z",
    });

    const result = await repository.getOverviewMetrics({
      dayAgo: DAY_AGO,
      weekAgo: WEEK_AGO,
    });

    assert.equal(result.totalUsers, 4);
    assert.equal(result.newUsersToday, 1);
    assert.equal(result.newUsersWeek, 3);
    assert.equal(result.rendersToday, 1);
    assert.deepEqual(countMap(result.tierDist, "tier"), {
      free: 1,
      pro: 1,
      trial: 1,
    });
    assert.deepEqual(countMap(result.jobStats), {
      failed: 2,
      running: 1,
    });
    assert.equal(typeof result.tierDist[0].count, "number");
    assert.equal(typeof result.jobStats[0].count, "number");
  });

  test("getOverviewMetrics returns numeric zero counts on an empty database", async () => {
    const result = await repository.getOverviewMetrics({
      dayAgo: DAY_AGO,
      weekAgo: WEEK_AGO,
    });

    assert.deepEqual(result, {
      totalUsers: 0,
      newUsersToday: 0,
      newUsersWeek: 0,
      tierDist: [],
      jobStats: [],
      rendersToday: 0,
    });
  });

  test("getEnrollmentMetrics preserves aggregate semantics and inclusive trend boundary", async () => {
    await seedUser({
      id: "enrollment_repo_user_completed_recent",
      createdAt: "2026-06-26T09:00:00.000Z",
    });
    await seedUser({
      id: "enrollment_repo_user_completed_boundary",
      createdAt: "2026-06-20T09:00:00.000Z",
    });
    await seedUser({
      id: "enrollment_repo_user_recording_recent",
      createdAt: "2026-06-25T09:00:00.000Z",
    });
    await seedUser({
      id: "enrollment_repo_user_processing_recent",
      createdAt: "2026-06-24T09:00:00.000Z",
    });
    await seedUser({
      id: "enrollment_repo_user_failed_old",
      createdAt: "2026-06-10T09:00:00.000Z",
    });

    await seedEnrollmentSession({
      id: "enrollment_repo_completed_recent",
      userId: "enrollment_repo_user_completed_recent",
      status: "completed",
      startedAt: "2026-06-26T10:00:00.000Z",
    });
    await seedEnrollmentSession({
      id: "enrollment_repo_completed_boundary",
      userId: "enrollment_repo_user_completed_boundary",
      status: "completed",
      startedAt: ENROLLMENT_WEEK_AGO,
    });
    await seedEnrollmentSession({
      id: "enrollment_repo_recording_recent",
      userId: "enrollment_repo_user_recording_recent",
      status: "recording",
      startedAt: "2026-06-25T10:00:00.000Z",
    });
    await seedEnrollmentSession({
      id: "enrollment_repo_processing_recent",
      userId: "enrollment_repo_user_processing_recent",
      status: "processing",
      startedAt: "2026-06-24T10:00:00.000Z",
    });
    await seedEnrollmentSession({
      id: "enrollment_repo_failed_old",
      userId: "enrollment_repo_user_failed_old",
      status: "failed",
      startedAt: "2026-06-10T10:00:00.000Z",
    });

    await seedVoiceProfile({
      id: "enrollment_repo_quality_poor",
      userId: "enrollment_repo_user_completed_recent",
      score: 49,
    });
    await seedVoiceProfile({
      id: "enrollment_repo_quality_fair",
      userId: "enrollment_repo_user_completed_boundary",
      score: 50,
    });
    await seedVoiceProfile({
      id: "enrollment_repo_quality_good",
      userId: "enrollment_repo_user_recording_recent",
      score: 70,
    });
    await seedVoiceProfile({
      id: "enrollment_repo_quality_excellent",
      userId: "enrollment_repo_user_processing_recent",
      score: 85,
      status: "deleted",
      deletedAt: "2026-06-27T10:00:00.000Z",
    });
    await seedVoiceProfile({
      id: "enrollment_repo_quality_ignored",
      userId: "enrollment_repo_user_failed_old",
      score: null,
    });

    const result = await repository.getEnrollmentMetrics({
      weekAgo: ENROLLMENT_WEEK_AGO,
    });

    assert.equal(result.totalEnrollments, 5);
    assert.equal(result.completedEnrollments, 2);
    assert.equal(result.completionRate, 40);
    assert.equal(result.averageQualityScore, 63.5);
    assert.deepEqual(countMap(result.qualityDistribution, "bucket"), {
      "Poor (<50)": 1,
      "Fair (50-69)": 1,
      "Good (70-84)": 1,
      "Excellent (85+)": 1,
    });
    assert.deepEqual(countMap(result.abandonmentByStep, "step"), {
      failed: 1,
      processing: 1,
      recording: 1,
    });
    assert.deepEqual(
      Object.fromEntries(
        result.last7Days.map((row) => [
          row.date,
          { started: row.started, completed: row.completed },
        ]),
      ),
      {
        "2026-06-20": { started: 1, completed: 1 },
        "2026-06-24": { started: 1, completed: 0 },
        "2026-06-25": { started: 1, completed: 0 },
        "2026-06-26": { started: 1, completed: 1 },
      },
    );
    assert.equal(typeof result.qualityDistribution[0].count, "number");
    assert.equal(typeof result.abandonmentByStep[0].count, "number");
    assert.equal(typeof result.last7Days[0].started, "number");
    assert.equal(typeof result.last7Days[0].completed, "number");
  });

  test("getEnrollmentMetrics returns numeric zero metrics on an empty database", async () => {
    const result = await repository.getEnrollmentMetrics({
      weekAgo: ENROLLMENT_WEEK_AGO,
    });

    assert.deepEqual(result, {
      totalEnrollments: 0,
      completedEnrollments: 0,
      completionRate: 0,
      averageQualityScore: 0,
      qualityDistribution: [],
      abandonmentByStep: [],
      last7Days: [],
    });
  });

  test("getCostMetrics preserves daily windowing and all-time type aggregates", async () => {
    await seedRenderMetricsTrack();
    await seedCostTrackVersion({
      id: "cost_repo_preview_recent",
      renderType: "preview",
      status: "preview_ready",
      createdAt: "2026-06-26T12:00:00.000Z",
      costEstimateJson: JSON.stringify({ usd: 1.25 }),
    });
    await seedCostTrackVersion({
      id: "cost_repo_full_recent",
      renderType: "full",
      status: "full_ready",
      createdAt: "2026-06-26T13:00:00.000Z",
      costEstimateJson: JSON.stringify({ usd: 2.75 }),
    });
    await seedCostTrackVersion({
      id: "cost_repo_preview_other_day",
      renderType: "preview",
      createdAt: "2026-06-24T08:00:00.000Z",
      actualCostJson: JSON.stringify({ total_usd: 0.5 }),
    });
    await seedCostTrackVersion({
      id: "cost_repo_actual_precedence",
      renderType: "preview",
      status: "preview_ready",
      createdAt: "2026-06-24T10:00:00.000Z",
      costEstimateJson: JSON.stringify({ usd: 5 }),
      actualCostJson: JSON.stringify({ total_usd: "0.25" }),
    });
    await seedCostTrackVersion({
      id: "cost_repo_preview_missing_cost",
      renderType: "preview",
      createdAt: "2026-06-24T09:00:00.000Z",
      actualCostJson: JSON.stringify({ provider: "suno" }),
    });
    await seedCostTrackVersion({
      id: "cost_repo_lyrics_missing_cost",
      renderType: "lyrics",
      createdAt: "2026-06-25T09:00:00.000Z",
      actualCostJson: JSON.stringify({ provider: "writer" }),
    });
    await seedCostTrackVersion({
      id: "cost_repo_preview_boundary",
      renderType: "preview",
      status: "preview_ready",
      createdAt: COST_DAYS_AGO,
      costEstimateJson: JSON.stringify({ usd: 9.99 }),
    });
    await seedCostTrackVersion({
      id: "cost_repo_full_old",
      renderType: "full",
      status: "full_ready",
      createdAt: "2026-06-10T10:00:00.000Z",
      costEstimateJson: JSON.stringify({ usd: 3 }),
    });
    await seedCostTrackVersion({
      id: "cost_repo_ready_excluded",
      renderType: "preview",
      status: "ready",
      createdAt: "2026-06-26T14:00:00.000Z",
      costEstimateJson: JSON.stringify({ usd: 12 }),
    });
    await seedCostTrackVersion({
      id: "cost_repo_null_cost_excluded",
      renderType: "preview",
      status: "preview_ready",
      createdAt: "2026-06-26T15:00:00.000Z",
      actualCostJson: null,
    });

    const result = await repository.getCostMetrics({
      daysAgo: COST_DAYS_AGO,
    });

    assert.deepEqual(result.dailyCosts, [
      {
        date: "2026-06-26",
        renders: 2,
        total_cost_usd: 4,
      },
      {
        date: "2026-06-25",
        renders: 1,
        total_cost_usd: null,
      },
      {
        date: "2026-06-24",
        renders: 3,
        total_cost_usd: 0.75,
      },
    ]);
    assert.deepEqual(
      Object.fromEntries(
        result.costByType.map((row) => [row.render_type, row]),
      ),
      {
        preview: {
          render_type: "preview",
          count: 5,
          avg_cost_usd: 2.9975,
          total_cost_usd: 11.99,
        },
        full: {
          render_type: "full",
          count: 2,
          avg_cost_usd: 2.875,
          total_cost_usd: 5.75,
        },
        lyrics: {
          render_type: "lyrics",
          count: 1,
          avg_cost_usd: null,
          total_cost_usd: null,
        },
      },
    );
    assert.equal(typeof result.dailyCosts[0].renders, "number");
    assert.equal(typeof result.dailyCosts[0].total_cost_usd, "number");
    assert.equal(typeof result.costByType[0].count, "number");
    assert.equal(typeof result.costByType[0].avg_cost_usd, "number");
  });

  test("getCostMetrics returns empty aggregates on an empty database", async () => {
    const result = await repository.getCostMetrics({
      daysAgo: COST_DAYS_AGO,
    });

    assert.deepEqual(result, {
      dailyCosts: [],
      costByType: [],
    });
  });

  test("getRenderSuccessMetrics preserves success, error, latency, and trend semantics", async () => {
    await seedRenderMetricsTrack();

    await seedRenderTrackVersion({
      id: "render_repo_preview_ready_recent",
      renderType: "preview",
      status: "ready",
      completedAt: "2026-06-26T10:00:00.000Z",
    });
    await seedRenderTrackVersion({
      id: "render_repo_preview_failed_recent",
      renderType: "preview",
      status: "failed",
      completedAt: "2026-06-26T11:00:00.000Z",
    });
    await seedRenderTrackVersion({
      id: "render_repo_preview_processing_recent",
      renderType: "preview",
      status: "processing",
      completedAt: "2026-06-26T12:00:00.000Z",
    });
    await seedRenderTrackVersion({
      id: "render_repo_preview_ready_old",
      renderType: "preview",
      status: "ready",
      completedAt: "2026-06-10T10:00:00.000Z",
    });
    await seedRenderTrackVersion({
      id: "render_repo_full_ready_recent",
      renderType: "full",
      status: "ready",
      completedAt: "2026-06-24T10:00:00.000Z",
    });
    await seedRenderTrackVersion({
      id: "render_repo_full_failed_recent",
      renderType: "full",
      status: "failed",
      completedAt: "2026-06-24T11:00:00.000Z",
    });
    await seedRenderTrackVersion({
      id: "render_repo_full_queued_no_completed_at",
      renderType: "full",
      status: "queued",
      completedAt: null,
    });

    await seedRenderJob({
      id: "render_repo_error_timeout_a",
      status: "failed",
      errorCode: "E_TIMEOUT",
      createdAt: "2026-06-26T08:00:00.000Z",
      updatedAt: "2026-06-26T09:00:00.000Z",
    });
    await seedRenderJob({
      id: "render_repo_error_timeout_b",
      status: "failed",
      errorCode: "E_TIMEOUT",
      createdAt: "2026-06-26T10:00:00.000Z",
      updatedAt: "2026-06-26T11:00:00.000Z",
    });
    await seedRenderJob({
      id: "render_repo_error_quota",
      status: "failed",
      errorCode: "E_QUOTA",
      createdAt: "2026-06-25T10:00:00.000Z",
      updatedAt: "2026-06-25T11:00:00.000Z",
    });
    await seedRenderJob({
      id: "render_repo_error_old",
      status: "failed",
      errorCode: "E_OLD",
      createdAt: "2026-06-19T10:00:00.000Z",
      updatedAt: "2026-06-19T11:00:00.000Z",
    });

    for (let index = 0; index < 6; index += 1) {
      const createdAt = new Date(
        Date.parse("2026-06-26T00:00:00.000Z") + index * 60 * 1000,
      ).toISOString();
      await seedRenderJob({
        id: `render_repo_latency_mix_${index}`,
        status: "completed",
        step: "mix",
        createdAt,
        updatedAt: new Date(
          Date.parse(createdAt) + (index + 1) * 1000,
        ).toISOString(),
      });
    }
    for (let index = 0; index < 5; index += 1) {
      const createdAt = new Date(
        Date.parse("2026-06-25T00:00:00.000Z") + index * 60 * 1000,
      ).toISOString();
      await seedRenderJob({
        id: `render_repo_latency_lyrics_${index}`,
        status: "completed",
        step: "lyrics",
        createdAt,
        updatedAt: new Date(Date.parse(createdAt) + 10000).toISOString(),
      });
    }

    const result = await repository.getRenderSuccessMetrics({
      weekAgo: RENDER_WEEK_AGO,
    });

    assert.deepEqual(result.successRate, {
      preview: 50,
      full: 33.33,
    });
    assert.deepEqual(countMap(result.errorBreakdown, "error_code"), {
      E_TIMEOUT: 2,
      E_QUOTA: 1,
    });
    assert.equal(result.errorBreakdown[0].last_seen, "2026-06-26T11:00:00.000Z");
    assert.deepEqual(result.stepLatency, [
      {
        step: "mix",
        sample_count: 6,
        avg_ms: 3500,
      },
    ]);
    assert.deepEqual(
      Object.fromEntries(
        result.dailyTrend.map((row) => [
          row.date,
          { success: row.success, failed: row.failed },
        ]),
      ),
      {
        "2026-06-24": { success: 1, failed: 1 },
        "2026-06-26": { success: 1, failed: 1 },
      },
    );
    assert.equal(typeof result.errorBreakdown[0].count, "number");
    assert.equal(typeof result.dailyTrend[0].success, "number");
    assert.equal(typeof result.dailyTrend[0].failed, "number");
  });

  test("getRenderSuccessMetrics returns zero rates and empty aggregates on an empty database", async () => {
    const result = await repository.getRenderSuccessMetrics({
      weekAgo: RENDER_WEEK_AGO,
    });

    assert.deepEqual(result, {
      successRate: {
        preview: 0,
        full: 0,
      },
      errorBreakdown: [],
      stepLatency: [],
      dailyTrend: [],
    });
  });

  test("getRiskMetrics preserves distribution, lock count, and raw escalation rows", async () => {
    await seedRiskUser({ id: "risk_repo_low_a", riskLevel: "low" });
    await seedRiskUser({
      id: "risk_repo_low_b",
      riskLevel: "low",
      lockedUntil: "2026-06-28T10:00:00.000Z",
    });
    await seedRiskUser({
      id: "risk_repo_medium",
      riskLevel: "medium",
      lockedUntil: RISK_NOW,
    });
    await seedRiskUser({
      id: "risk_repo_high",
      riskLevel: "high",
      lockedUntil: "2026-06-27T10:00:00.001Z",
    });
    await seedRiskUser({
      id: "risk_repo_blocked",
      riskLevel: "blocked",
      lockedUntil: "2026-06-26T10:00:00.000Z",
    });
    await seedRiskUser({
      id: "risk_repo_deleted_locked",
      riskLevel: "blocked",
      lockedUntil: "2026-06-28T10:00:00.000Z",
      deletedAt: "2026-06-26T10:00:00.000Z",
    });

    await seedRiskAudit({
      id: "risk_repo_audit_newest",
      resourceId: "risk_repo_high",
      metadataJson: JSON.stringify({
        riskLevel: "high",
        reason: "chargeback pattern",
      }),
      createdAt: "2026-06-26T10:00:00.000Z",
    });
    await seedRiskAudit({
      id: "risk_repo_audit_empty_metadata",
      resourceId: "risk_repo_low_b",
      metadataJson: "{}",
      createdAt: "2026-06-25T10:00:00.000Z",
    });
    await seedRiskAudit({
      id: "risk_repo_audit_malformed",
      resourceId: "risk_repo_medium",
      metadataJson: "{not-json",
      createdAt: "2026-06-24T10:00:00.000Z",
    });
    await seedRiskAudit({
      id: "risk_repo_audit_boundary",
      resourceId: "risk_repo_blocked",
      metadataJson: JSON.stringify({
        riskLevel: "blocked",
        reason: "voice abuse",
      }),
      createdAt: RISK_WEEK_AGO,
    });
    await seedRiskAudit({
      id: "risk_repo_audit_old",
      resourceId: "risk_repo_low_a",
      metadataJson: JSON.stringify({ riskLevel: "low", reason: "old" }),
      createdAt: "2026-06-19T10:00:00.000Z",
    });
    await db
      .prepare(
        `INSERT INTO audit_logs (
          id, user_id, action, resource_type, resource_id, metadata_json, created_at
        ) VALUES (?, 'admin_repo_risk', 'admin_view_user', 'user', ?, ?, ?)`,
      )
      .run(
        "risk_repo_audit_wrong_action",
        "risk_repo_high",
        JSON.stringify({ riskLevel: "high", reason: "viewed" }),
        "2026-06-26T11:00:00.000Z",
      );

    const result = await repository.getRiskMetrics({
      now: RISK_NOW,
      weekAgo: RISK_WEEK_AGO,
    });

    assert.deepEqual(countMap(result.distribution, "level"), {
      low: 2,
      medium: 1,
      high: 1,
      blocked: 1,
    });
    assert.equal(result.lockedAccounts, 3);
    assert.deepEqual(result.recentEscalations, [
      {
        user_id: "risk_repo_high",
        metadata_json: JSON.stringify({
          riskLevel: "high",
          reason: "chargeback pattern",
        }),
        date: "2026-06-26T10:00:00.000Z",
      },
      {
        user_id: "risk_repo_low_b",
        metadata_json: "{}",
        date: "2026-06-25T10:00:00.000Z",
      },
      {
        user_id: "risk_repo_medium",
        metadata_json: "{not-json",
        date: "2026-06-24T10:00:00.000Z",
      },
      {
        user_id: "risk_repo_blocked",
        metadata_json: JSON.stringify({
          riskLevel: "blocked",
          reason: "voice abuse",
        }),
        date: RISK_WEEK_AGO,
      },
    ]);
    assert.equal(typeof result.distribution[0].count, "number");
    assert.equal(typeof result.lockedAccounts, "number");
  });

  test("getRiskMetrics returns empty distribution, zero locked accounts, and no escalations on an empty database", async () => {
    const result = await repository.getRiskMetrics({
      now: RISK_NOW,
      weekAgo: RISK_WEEK_AGO,
    });

    assert.deepEqual(result, {
      distribution: [],
      lockedAccounts: 0,
      recentEscalations: [],
    });
  });
});

describe("AdminMetricsService overview metrics repository boundary", () => {
  test("getOverviewMetrics delegates date windows without direct database access", async () => {
    const calls = [];
    const service = createMetricsService({
      async getOverviewMetrics({ dayAgo, weekAgo }) {
        calls.push({ dayAgo, weekAgo });
        return {
          totalUsers: 8,
          newUsersToday: 2,
          newUsersWeek: 5,
          tierDist: [{ tier: "pro", count: 3 }],
          jobStats: [{ status: "queued", count: 1 }],
          rendersToday: 4,
        };
      },
    });

    const result = await service.getOverviewMetrics();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].dayAgo, DAY_AGO);
    assert.equal(calls[0].weekAgo, WEEK_AGO);
    assert.deepEqual(result, {
      totalUsers: 8,
      newUsersToday: 2,
      newUsersWeek: 5,
      tierDist: [{ tier: "pro", count: 3 }],
      jobStats: [{ status: "queued", count: 1 }],
      rendersToday: 4,
    });
  });
});

describe("AdminMetricsService enrollment metrics repository boundary", () => {
  test("getEnrollmentMetrics delegates the trend window without direct database access", async () => {
    const calls = [];
    const service = createMetricsService({
      async getEnrollmentMetrics({ weekAgo }) {
        calls.push({ weekAgo });
        return {
          totalEnrollments: 4,
          completedEnrollments: 3,
          completionRate: 75,
          averageQualityScore: 88.5,
          qualityDistribution: [{ bucket: "Excellent (85+)", count: 2 }],
          abandonmentByStep: [{ step: "recording", count: 1 }],
          last7Days: [
            { date: "2026-06-26", started: 4, completed: 3 },
          ],
        };
      },
    });

    const result = await service.getEnrollmentMetrics();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].weekAgo, ENROLLMENT_WEEK_AGO);
    assert.deepEqual(result, {
      totalEnrollments: 4,
      completedEnrollments: 3,
      completionRate: 75,
      averageQualityScore: 88.5,
      qualityDistribution: [{ bucket: "Excellent (85+)", count: 2 }],
      abandonmentByStep: [{ step: "recording", count: 1 }],
      last7Days: [{ date: "2026-06-26", started: 4, completed: 3 }],
    });
  });
});

describe("AdminMetricsService cost metrics repository boundary", () => {
  test("getCostMetrics delegates the cutoff without direct database access", async () => {
    const calls = [];
    const service = createMetricsService({
      async getCostMetrics({ daysAgo }) {
        calls.push({ daysAgo });
        return {
          dailyCosts: [{ date: "2026-06-26", renders: 2, total_cost_usd: 4 }],
          costByType: [
            {
              render_type: "preview",
              count: 2,
              avg_cost_usd: 2,
              total_cost_usd: 4,
            },
          ],
        };
      },
    });

    const result = await service.getCostMetrics(7);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].daysAgo, COST_DAYS_AGO);
    assert.deepEqual(result, {
      dailyCosts: [{ date: "2026-06-26", renders: 2, total_cost_usd: 4 }],
      costByType: [
        {
          render_type: "preview",
          count: 2,
          avg_cost_usd: 2,
          total_cost_usd: 4,
        },
      ],
    });
  });
});

describe("AdminMetricsService render pipeline metrics repository boundary", () => {
  test("getRenderSuccessMetrics delegates the trend window without direct database access", async () => {
    const calls = [];
    const service = createMetricsService({
      async getRenderSuccessMetrics({ weekAgo }) {
        calls.push({ weekAgo });
        return {
          successRate: { preview: 88.5, full: 50 },
          errorBreakdown: [{ error_code: "E_TIMEOUT", count: 2 }],
          stepLatency: [{ step: "mix", avg_ms: 3500, sample_count: 6 }],
          dailyTrend: [{ date: "2026-06-26", success: 1, failed: 1 }],
        };
      },
    });

    const result = await service.getRenderSuccessMetrics();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].weekAgo, RENDER_WEEK_AGO);
    assert.deepEqual(result, {
      successRate: { preview: 88.5, full: 50 },
      errorBreakdown: [{ error_code: "E_TIMEOUT", count: 2 }],
      stepLatency: [{ step: "mix", avg_ms: 3500, sample_count: 6 }],
      dailyTrend: [{ date: "2026-06-26", success: 1, failed: 1 }],
    });
  });
});

describe("AdminMetricsService risk metrics repository boundary", () => {
  test("getRiskMetrics delegates cutoffs and parses escalation metadata without direct database access", async () => {
    const calls = [];
    const service = createMetricsService({
      async getRiskMetrics({ now, weekAgo }) {
        calls.push({ now, weekAgo });
        return {
          distribution: [{ level: "high", count: 1 }],
          lockedAccounts: 2,
          recentEscalations: [
            {
              user_id: "risk_service_high",
              metadata_json: JSON.stringify({
                riskLevel: "high",
                reason: "manual review",
              }),
              date: "2026-06-27T08:00:00.000Z",
            },
            {
              user_id: "risk_service_unknown",
              metadata_json: "{not-json",
              date: "2026-06-27T07:00:00.000Z",
            },
          ],
        };
      },
    });

    const result = await service.getRiskMetrics();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].now, RISK_NOW);
    assert.equal(calls[0].weekAgo, RISK_WEEK_AGO);
    assert.deepEqual(result, {
      distribution: [{ level: "high", count: 1 }],
      lockedAccounts: 2,
      recentEscalations: [
        {
          user_id: "risk_service_high",
          to: "high",
          reason: "manual review",
          date: "2026-06-27T08:00:00.000Z",
        },
        {
          user_id: "risk_service_unknown",
          to: "unknown",
          reason: "[metadata parse error]",
          date: "2026-06-27T07:00:00.000Z",
        },
      ],
    });
  });
});
