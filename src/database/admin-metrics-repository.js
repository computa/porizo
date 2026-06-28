"use strict";

function countValue(row) {
  return Number(row?.count || 0);
}

function numericValue(value) {
  return Number(value || 0);
}

function normalizeCountRows(rows) {
  return rows.map((row) => ({
    ...row,
    count: Number(row.count || 0),
  }));
}

function normalizeEnrollmentTrendRows(rows) {
  return rows.map((row) => ({
    ...row,
    started: Number(row.started || 0),
    completed: Number(row.completed || 0),
  }));
}

function normalizeRenderTrendRows(rows) {
  return rows.map((row) => ({
    ...row,
    success: Number(row.success || 0),
    failed: Number(row.failed || 0),
  }));
}

function parseMaybeCostJson(value) {
  if (!value) return null;
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return null;
  }
}

function firstFiniteCost(...values) {
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return null;
}

function parseCostUsd(row) {
  const actual = parseMaybeCostJson(row.actual_cost_json);
  const estimate = parseMaybeCostJson(row.cost_estimate_json);
  return firstFiniteCost(
    actual?.total_usd,
    actual?.usd,
    estimate?.total_usd,
    estimate?.usd,
  );
}

function createdDateBucket(createdAt) {
  return String(createdAt || "").slice(0, 10);
}

function buildDailyCosts(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const date = createdDateBucket(row.created_at);
    if (!date) continue;
    const costUsd = parseCostUsd(row);
    const existing = buckets.get(date) || {
      date,
      renders: 0,
      total_cost_usd: 0,
      numeric_costs: 0,
    };
    existing.renders += 1;
    if (costUsd !== null) {
      existing.total_cost_usd += costUsd;
      existing.numeric_costs += 1;
    }
    buckets.set(date, existing);
  }

  return Array.from(buckets.values())
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((row) => ({
      date: row.date,
      renders: row.renders,
      total_cost_usd:
        row.numeric_costs > 0 ? Number(row.total_cost_usd.toFixed(6)) : null,
    }));
}

function buildCostByType(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const renderType = row.render_type;
    const costUsd = parseCostUsd(row);
    const existing = buckets.get(renderType) || {
      render_type: renderType,
      count: 0,
      total_cost_usd: 0,
      numeric_costs: 0,
    };
    existing.count += 1;
    if (costUsd !== null) {
      existing.total_cost_usd += costUsd;
      existing.numeric_costs += 1;
    }
    buckets.set(renderType, existing);
  }

  return Array.from(buckets.values()).map((row) => ({
    render_type: row.render_type,
    count: row.count,
    avg_cost_usd:
      row.numeric_costs > 0
        ? Number((row.total_cost_usd / row.numeric_costs).toFixed(6))
        : null,
    total_cost_usd:
      row.numeric_costs > 0 ? Number(row.total_cost_usd.toFixed(6)) : null,
  }));
}

function buildStepLatency(stepTimings) {
  const stepLatencyMap = new Map();
  for (const job of stepTimings) {
    const created = new Date(job.created_at).getTime();
    const updated = new Date(job.updated_at).getTime();
    const durationMs = updated - created;
    if (!stepLatencyMap.has(job.step)) {
      stepLatencyMap.set(job.step, []);
    }
    stepLatencyMap.get(job.step).push(durationMs);
  }

  return Array.from(stepLatencyMap.entries())
    .filter(([, durations]) => durations.length > 5)
    .map(([step, durations]) => ({
      step,
      sample_count: durations.length,
      avg_ms: Math.round(
        durations.reduce((a, b) => a + b, 0) / durations.length,
      ),
    }))
    .sort((a, b) => b.avg_ms - a.avg_ms)
    .map((row) => ({
      step: row.step,
      avg_ms: Math.round(row.avg_ms || 0),
      sample_count: row.sample_count,
    }));
}

function createAdminMetricsRepository(db) {
  async function getOverviewMetrics({ dayAgo, weekAgo }) {
    const totalUsers = countValue(
      await db.prepare("SELECT COUNT(*) as count FROM users").get(),
    );
    const newUsersToday = countValue(
      await db
        .prepare("SELECT COUNT(*) as count FROM users WHERE created_at > ?")
        .get(dayAgo),
    );
    const newUsersWeek = countValue(
      await db
        .prepare("SELECT COUNT(*) as count FROM users WHERE created_at > ?")
        .get(weekAgo),
    );

    const tierDist = normalizeCountRows(
      await db
        .prepare("SELECT tier, COUNT(*) as count FROM entitlements GROUP BY tier")
        .all(),
    );

    const jobStats = normalizeCountRows(
      await db
        .prepare("SELECT status, COUNT(*) as count FROM jobs GROUP BY status")
        .all(),
    );

    const rendersToday = countValue(
      await db
        .prepare(
          "SELECT COUNT(*) as count FROM track_versions WHERE created_at > ? AND render_type = 'preview'",
        )
        .get(dayAgo),
    );

    return {
      totalUsers,
      newUsersToday,
      newUsersWeek,
      tierDist,
      jobStats,
      rendersToday,
    };
  }

  async function getEnrollmentMetrics({ weekAgo }) {
    const totals = await db
      .prepare(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
        FROM enrollment_sessions`,
      )
      .get();

    const total = numericValue(totals?.total);
    const completed = numericValue(totals?.completed);
    const completionRate =
      total > 0 ? Number(((completed / total) * 100).toFixed(2)) : 0;

    const avgQualityRow = await db
      .prepare(
        `SELECT AVG(quality_score) as avg_score
        FROM voice_profiles
        WHERE quality_score IS NOT NULL`,
      )
      .get();
    const averageQualityScore = Number(
      numericValue(avgQualityRow?.avg_score).toFixed(1),
    );

    const qualityDistribution = normalizeCountRows(
      await db
        .prepare(
          `SELECT
            CASE
              WHEN quality_score < 50 THEN 'Poor (<50)'
              WHEN quality_score < 70 THEN 'Fair (50-69)'
              WHEN quality_score < 85 THEN 'Good (70-84)'
              ELSE 'Excellent (85+)'
            END as bucket,
            COUNT(*) as count
          FROM voice_profiles
          WHERE quality_score IS NOT NULL
          GROUP BY bucket
          ORDER BY MIN(quality_score)`,
        )
        .all(),
    );

    const abandonmentByStep = normalizeCountRows(
      await db
        .prepare(
          `SELECT status as step, COUNT(*) as count
          FROM enrollment_sessions
          WHERE status != 'completed'
          GROUP BY status
          ORDER BY count DESC`,
        )
        .all(),
    );

    const last7Days = normalizeEnrollmentTrendRows(
      await db
        .prepare(
          `SELECT
            DATE(started_at) as date,
            COUNT(*) as started,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
          FROM enrollment_sessions
          WHERE started_at >= ?
          GROUP BY DATE(started_at)
          ORDER BY date ASC`,
        )
        .all(weekAgo),
    );

    return {
      totalEnrollments: total,
      completedEnrollments: completed,
      completionRate,
      averageQualityScore,
      qualityDistribution,
      abandonmentByStep,
      last7Days,
    };
  }

  async function getCostMetrics({ daysAgo }) {
    const dailyCostRows = await db
      .prepare(
        `SELECT created_at, actual_cost_json, cost_estimate_json
        FROM track_versions
        WHERE status IN ('completed', 'preview_ready', 'full_ready')
          AND (actual_cost_json IS NOT NULL OR cost_estimate_json IS NOT NULL)
          AND created_at > ?`,
      )
      .all(daysAgo);

    const costByTypeRows = await db
      .prepare(
        `SELECT render_type, actual_cost_json, cost_estimate_json
        FROM track_versions
        WHERE status IN ('completed', 'preview_ready', 'full_ready')
          AND (actual_cost_json IS NOT NULL OR cost_estimate_json IS NOT NULL)`,
      )
      .all();

    return {
      dailyCosts: buildDailyCosts(dailyCostRows),
      costByType: buildCostByType(costByTypeRows),
    };
  }

  async function getRenderSuccessMetrics({ weekAgo }) {
    const previewStats = await db
      .prepare(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as success
        FROM track_versions
        WHERE render_type = 'preview'`,
      )
      .get();

    const fullStats = await db
      .prepare(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as success
        FROM track_versions
        WHERE render_type = 'full'`,
      )
      .get();

    const previewTotal = numericValue(previewStats?.total);
    const previewSuccess = numericValue(previewStats?.success);
    const fullTotal = numericValue(fullStats?.total);
    const fullSuccess = numericValue(fullStats?.success);

    const errorBreakdown = normalizeCountRows(
      await db
        .prepare(
          `SELECT
            error_code,
            COUNT(*) as count,
            MAX(updated_at) as last_seen
          FROM jobs
          WHERE status = 'failed' AND error_code IS NOT NULL AND updated_at >= ?
          GROUP BY error_code
          ORDER BY count DESC
          LIMIT 20`,
        )
        .all(weekAgo),
    );

    const stepTimings = await db
      .prepare(
        `SELECT
          step,
          created_at,
          updated_at
        FROM jobs
        WHERE status = 'completed' AND step IS NOT NULL AND created_at >= ?`,
      )
      .all(weekAgo);

    const dailyTrend = normalizeRenderTrendRows(
      await db
        .prepare(
          `SELECT
            DATE(completed_at) as date,
            SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as success,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
          FROM track_versions
          WHERE completed_at >= ?
          GROUP BY DATE(completed_at)
          ORDER BY date ASC`,
        )
        .all(weekAgo),
    );

    return {
      successRate: {
        preview:
          previewTotal > 0
            ? Number(((previewSuccess / previewTotal) * 100).toFixed(2))
            : 0,
        full:
          fullTotal > 0
            ? Number(((fullSuccess / fullTotal) * 100).toFixed(2))
            : 0,
      },
      errorBreakdown,
      stepLatency: buildStepLatency(stepTimings),
      dailyTrend,
    };
  }

  async function getRiskMetrics({ now, weekAgo }) {
    const distribution = normalizeCountRows(
      await db
        .prepare(
          `SELECT
            COALESCE(risk_level, 'low') as level,
            COUNT(*) as count
          FROM users
          WHERE deleted_at IS NULL
          GROUP BY risk_level
          ORDER BY
            CASE risk_level
              WHEN 'low' THEN 1
              WHEN 'medium' THEN 2
              WHEN 'high' THEN 3
              WHEN 'blocked' THEN 4
              ELSE 5
            END`,
        )
        .all(),
    );

    const lockedAccounts = countValue(
      await db
        .prepare(
          `SELECT COUNT(*) as count
          FROM users
          WHERE locked_until IS NOT NULL AND locked_until > ?`,
        )
        .get(now),
    );

    const recentEscalations = await db
      .prepare(
        `SELECT
          resource_id as user_id,
          metadata_json,
          created_at as date
        FROM audit_logs
        WHERE action = 'admin_update_risk' AND created_at >= ?
        ORDER BY created_at DESC
        LIMIT 20`,
      )
      .all(weekAgo);

    return {
      distribution,
      lockedAccounts,
      recentEscalations,
    };
  }

  async function getTeaserMetrics({ daysAgo }) {
    const teaserViews = countValue(
      await db
        .prepare(
          `SELECT COUNT(*) as count
           FROM events
           WHERE event_name = 'teaser_viewed' AND created_at > ?`,
        )
        .get(daysAgo),
    );

    const shareClaims = countValue(
      await db
        .prepare(
          `SELECT COUNT(*) as count
           FROM events
           WHERE event_name = 'share_claim' AND created_at > ?`,
        )
        .get(daysAgo),
    );

    const shareStreams = countValue(
      await db
        .prepare(
          `SELECT COUNT(*) as count
           FROM events
           WHERE event_name = 'share_stream' AND created_at > ?`,
        )
        .get(daysAgo),
    );

    const dailyViews = normalizeCountRows(
      await db
        .prepare(
          `SELECT DATE(created_at) as date, COUNT(*) as count
           FROM events
           WHERE event_name = 'teaser_viewed' AND created_at > ?
           GROUP BY DATE(created_at)
           ORDER BY date ASC`,
        )
        .all(daysAgo),
    );

    return {
      teaserViews,
      shareClaims,
      shareStreams,
      dailyViews,
    };
  }

  async function getShareMetrics({ daysAgo }) {
    const created = countValue(
      await db
        .prepare("SELECT COUNT(*) as count FROM share_tokens WHERE created_at > ?")
        .get(daysAgo),
    );

    const claimed = countValue(
      await db
        .prepare(
          `SELECT COUNT(*) as count
           FROM share_tokens
           WHERE status = 'claimed' AND bound_at > ?`,
        )
        .get(daysAgo),
    );

    const byStatus = normalizeCountRows(
      await db
        .prepare(
          `SELECT status, COUNT(*) as count
           FROM share_tokens
           WHERE created_at > ?
           GROUP BY status`,
        )
        .all(daysAgo),
    );

    const avgAccessRaw =
      (
        await db
          .prepare(
            `SELECT AVG(access_count) as avg_access
             FROM share_tokens
             WHERE created_at > ?`,
          )
          .get(daysAgo)
      )?.avg_access ?? 0;
    const avgAccess = Number(avgAccessRaw) || 0;

    const dailyCreated = normalizeCountRows(
      await db
        .prepare(
          `SELECT DATE(created_at) as date, COUNT(*) as count
           FROM share_tokens
           WHERE created_at > ?
           GROUP BY DATE(created_at)
           ORDER BY date ASC`,
        )
        .all(daysAgo),
    );

    return {
      created,
      claimed,
      byStatus,
      avgAccess,
      dailyCreated,
    };
  }

  return {
    getCostMetrics,
    getEnrollmentMetrics,
    getOverviewMetrics,
    getRiskMetrics,
    getRenderSuccessMetrics,
    getShareMetrics,
    getTeaserMetrics,
  };
}

module.exports = {
  createAdminMetricsRepository,
};
