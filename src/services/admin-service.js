/**
 * Admin Dashboard Service
 * Provides queries and actions for the admin dashboard.
 */

const crypto = require("crypto");

/**
 * Escape SQL LIKE wildcards to prevent pattern injection
 */
function escapeLikePattern(str) {
  return str.replace(/[%_\\]/g, "\\$&");
}

/**
 * Generate a secure audit log ID
 */
function generateAuditId() {
  return `audit_${crypto.randomBytes(12).toString("hex")}`;
}

/**
 * Apply bounds to limit/offset to prevent DoS
 */
function safeBounds(limit, offset, maxLimit = 100) {
  return {
    limit: Math.min(Math.max(parseInt(limit) || 50, 1), maxLimit),
    offset: Math.max(parseInt(offset) || 0, 0),
  };
}

class AdminService {
  constructor(db) {
    this.db = db;
  }

  /**
   * Insert an audit log entry (reduces repetitive audit logging code)
   */
  async _audit(adminId, action, resourceType, resourceId, metadata = {}) {
    const enriched = {
      actor: "admin",
      admin_id: adminId,
      ...metadata,
    };
    await this.db.prepare(
      'INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(generateAuditId(), adminId, action, resourceType, resourceId, JSON.stringify(enriched), new Date().toISOString());
  }

  // ============ USER MANAGEMENT ============

  /**
   * Search users with optional filters
   * Returns user data with adoption metrics (tier, track_count, voice_status, credits_used, last_active)
   */
  async searchUsers({ email, userId, riskLevel, tier, trackId, shareId, recipientName, limit = 50, offset = 0 }) {
    const bounds = safeBounds(limit, offset);

    let sql = `
      SELECT
        u.id, u.email, u.display_name, u.risk_level, u.locked_until, u.created_at,
        COALESCE(e.tier, 'free') as tier,
        COALESCE(e.credits_used_total, 0) as credits_used,
        COALESCE(track_counts.track_count, 0) as track_count,
        COALESCE(vp.status, 'none') as voice_status,
        COALESCE(activity.last_active, u.created_at) as last_active
      FROM users u
      LEFT JOIN entitlements e ON e.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*) as track_count
        FROM tracks
        GROUP BY user_id
      ) track_counts ON track_counts.user_id = u.id
      LEFT JOIN voice_profiles vp ON vp.user_id = u.id AND vp.deleted_at IS NULL
      LEFT JOIN (
        SELECT user_id, MAX(created_at) as last_active
        FROM tracks
        GROUP BY user_id
      ) activity ON activity.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (email) {
      const escaped = escapeLikePattern(email);
      sql += " AND u.email LIKE ? ESCAPE '\\'";
      params.push(`%${escaped}%`);
    }
    if (userId) {
      sql += ' AND u.id = ?';
      params.push(userId);
    }
    if (riskLevel) {
      sql += ' AND u.risk_level = ?';
      params.push(riskLevel);
    }
    if (tier) {
      // Filter by subscription tier (free, trial, pro, plus)
      if (tier === 'free') {
        sql += " AND (e.tier = 'free' OR e.tier IS NULL)";
      } else {
        sql += ' AND e.tier = ?';
        params.push(tier);
      }
    }
    if (trackId) {
      sql += " AND EXISTS (SELECT 1 FROM tracks t2 WHERE t2.id = ? AND t2.user_id = u.id)";
      params.push(trackId);
    }
    if (shareId) {
      sql += `
        AND EXISTS (
          SELECT 1
          FROM share_tokens st
          JOIN tracks t3 ON t3.id = st.track_id
          WHERE st.id = ? AND t3.user_id = u.id
        )
      `;
      params.push(shareId);
    }
    if (recipientName) {
      const escaped = escapeLikePattern(recipientName);
      sql += " AND EXISTS (SELECT 1 FROM tracks t4 WHERE t4.user_id = u.id AND t4.recipient_name LIKE ? ESCAPE '\\')";
      params.push(`%${escaped}%`);
    }

    sql += ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?';
    params.push(bounds.limit, bounds.offset);

    return await this.db.prepare(sql).all(...params);
  }

  /**
   * Get aggregate user statistics for summary banner
   * Returns counts by tier and conversion rate
   */
  async getUserStats() {
    const stats = await this.db.prepare(`
      SELECT
        COUNT(*) as total_users,
        SUM(CASE WHEN e.tier IN ('pro', 'plus') THEN 1 ELSE 0 END) as paid_users,
        SUM(CASE WHEN e.tier = 'trial' THEN 1 ELSE 0 END) as trial_users,
        SUM(CASE WHEN e.tier = 'free' OR e.tier IS NULL THEN 1 ELSE 0 END) as free_users
      FROM users u
      LEFT JOIN entitlements e ON e.user_id = u.id
    `).get();

    return {
      totalUsers: stats.total_users || 0,
      paidUsers: stats.paid_users || 0,
      trialUsers: stats.trial_users || 0,
      freeUsers: stats.free_users || 0,
      conversionRate: stats.total_users > 0
        ? ((stats.paid_users / stats.total_users) * 100).toFixed(1)
        : '0.0',
    };
  }

  /**
   * Get detailed user information with related data
   */
  async getUserDetail(userId) {
    const user = await this.db.prepare(
      'SELECT * FROM users WHERE id = ?'
    ).get(userId);

    if (!user) return null;

    const voiceProfile = await this.db.prepare(
      'SELECT id, status, quality_score, created_at FROM voice_profiles WHERE user_id = ? AND deleted_at IS NULL'
    ).get(userId);

    const entitlements = await this.db.prepare(
      'SELECT * FROM entitlements WHERE user_id = ?'
    ).get(userId);

    const subscription = await this.db.prepare(
      'SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(userId);

    const tracks = await this.db.prepare(
      'SELECT id, title, occasion, status, created_at FROM tracks WHERE user_id = ? ORDER BY created_at DESC LIMIT 10'
    ).all(userId);

    const shares = await this.db.prepare(
      `SELECT st.id, st.status, st.access_count, t.title
       FROM share_tokens st
       JOIN tracks t ON st.track_id = t.id
       WHERE t.user_id = ?
       ORDER BY st.created_at DESC LIMIT 10`
    ).all(userId);

    return { user, voiceProfile, entitlements, subscription, tracks, shares };
  }

  /**
   * Update user risk level
   */
  async updateUserRisk(userId, riskLevel, adminId, reason) {
    await this.db.prepare('UPDATE users SET risk_level = ? WHERE id = ?').run(riskLevel, userId);
    await this._audit(adminId, 'admin_update_risk', 'user', userId, { riskLevel, reason });
    return { success: true };
  }

  /**
   * Lock or unlock a user account
   */
  async lockUser(userId, locked, adminId, reason) {
    const lockedUntil = locked ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() : null;
    await this.db.prepare('UPDATE users SET locked_until = ? WHERE id = ?').run(lockedUntil, userId);
    await this._audit(adminId, locked ? 'admin_lock_user' : 'admin_unlock_user', 'user', userId, { reason });
    return { success: true, lockedUntil };
  }

  // ============ METRICS ============

  /**
   * Get overview dashboard metrics
   */
  async getOverviewMetrics() {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const totalUsers = (await this.db.prepare('SELECT COUNT(*) as count FROM users').get())?.count ?? 0;
    const newUsersToday = (await this.db.prepare('SELECT COUNT(*) as count FROM users WHERE created_at > ?').get(dayAgo))?.count ?? 0;
    const newUsersWeek = (await this.db.prepare('SELECT COUNT(*) as count FROM users WHERE created_at > ?').get(weekAgo))?.count ?? 0;

    const tierDist = await this.db.prepare('SELECT tier, COUNT(*) as count FROM entitlements GROUP BY tier').all();

    const jobStats = await this.db.prepare('SELECT status, COUNT(*) as count FROM jobs GROUP BY status').all();

    const rendersToday = (await this.db.prepare(
      "SELECT COUNT(*) as count FROM track_versions WHERE created_at > ? AND render_type = 'preview'"
    ).get(dayAgo))?.count ?? 0;

    return { totalUsers, newUsersToday, newUsersWeek, tierDist, jobStats, rendersToday };
  }

  // ============ STORY SESSIONS ============

  /**
   * List story sessions with optional filters
   */
  async listStorySessions({ status, engineVersion, limit = 50, offset = 0 }) {
    const bounds = safeBounds(limit, offset);
    let sql = `
      SELECT
        ss.id,
        ss.user_id,
        ss.status,
        ss.engine_version,
        ss.recipient_name,
        ss.occasion,
        ss.question_count,
        ss.created_at,
        ss.updated_at,
        ss.confirmed_at,
        u.email as user_email
      FROM story_sessions ss
      LEFT JOIN users u ON ss.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      sql += " AND ss.status = ?";
      params.push(status);
    }
    if (engineVersion) {
      sql += " AND ss.engine_version = ?";
      params.push(engineVersion);
    }

    sql += " ORDER BY ss.updated_at DESC LIMIT ? OFFSET ?";
    params.push(bounds.limit, bounds.offset);

    return await this.db.prepare(sql).all(...params);
  }

  /**
   * Get full story session details with turns
   */
  async getStorySessionDetail(sessionId) {
    const session = await this.db.prepare(`
      SELECT ss.*, u.email as user_email
      FROM story_sessions ss
      LEFT JOIN users u ON ss.user_id = u.id
      WHERE ss.id = ?
    `).get(sessionId);

    if (!session) return null;

    const turns = await this.db.prepare(`
      SELECT * FROM story_turns
      WHERE session_id = ?
      ORDER BY turn_number ASC
    `).all(sessionId);

    return { session, turns };
  }

  /**
   * Get job health metrics
   */
  async getJobMetrics() {
    const jobsByStatus = await this.db.prepare('SELECT status, COUNT(*) as count FROM jobs GROUP BY status').all();

    const jobsByWorkflow = await this.db.prepare(
      'SELECT workflow_type, status, COUNT(*) as count FROM jobs GROUP BY workflow_type, status'
    ).all();

    // Stale jobs: running for more than 30 minutes
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const staleJobs = (await this.db.prepare(
      "SELECT COUNT(*) as count FROM jobs WHERE status = 'running' AND updated_at < ?"
    ).get(thirtyMinAgo))?.count ?? 0;

    // Recent failures grouped by error code
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentFailures = await this.db.prepare(
      "SELECT error_code, COUNT(*) as count FROM jobs WHERE status = 'failed' AND created_at > ? GROUP BY error_code ORDER BY count DESC LIMIT 10"
    ).all(weekAgo);

    const dlqCount = (await this.db.prepare(
      "SELECT COUNT(*) as count FROM dead_letter_queue WHERE reprocessed_at IS NULL"
    ).get())?.count ?? 0;

    return { jobsByStatus, jobsByWorkflow, staleJobs, recentFailures, dlqCount };
  }

  /**
   * Get cost metrics for specified number of days
   */
  async getCostMetrics(days = 30) {
    const daysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // PostgreSQL uses jsonb operators, SQLite uses json_extract
    const jsonCost = this.db.isPostgres
      ? `(actual_cost_json::jsonb->>'total_usd')::numeric`
      : `json_extract(actual_cost_json, '$.total_usd')`;

    const dailyCosts = await this.db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as renders,
             SUM(${jsonCost}) as total_cost_usd
      FROM track_versions
      WHERE status = 'completed' AND actual_cost_json IS NOT NULL
        AND created_at > ?
      GROUP BY DATE(created_at) ORDER BY date DESC
    `).all(daysAgo);

    const costByType = await this.db.prepare(`
      SELECT render_type, COUNT(*) as count,
             AVG(${jsonCost}) as avg_cost_usd,
             SUM(${jsonCost}) as total_cost_usd
      FROM track_versions WHERE status = 'completed' AND actual_cost_json IS NOT NULL
      GROUP BY render_type
    `).all();

    return { dailyCosts, costByType };
  }

  // ============ JOB MANAGEMENT ============

  /**
   * List jobs with optional filters
   */
  async listJobs({ status, workflowType, limit = 50, offset = 0 }) {
    const bounds = safeBounds(limit, offset);
    let sql = 'SELECT j.*, tv.track_id FROM jobs j LEFT JOIN track_versions tv ON j.track_version_id = tv.id WHERE 1=1';
    const params = [];

    if (status) {
      sql += ' AND j.status = ?';
      params.push(status);
    }
    if (workflowType) {
      sql += ' AND j.workflow_type = ?';
      params.push(workflowType);
    }

    sql += ' ORDER BY j.created_at DESC LIMIT ? OFFSET ?';
    params.push(bounds.limit, bounds.offset);

    return await this.db.prepare(sql).all(...params);
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobId, adminId) {
    const job = await this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!job) return { success: false, error: 'Job not found' };
    if (job.status !== 'failed') return { success: false, error: 'Job is not failed' };

    await this.db.prepare(
      "UPDATE jobs SET status = 'queued', attempts = 0, error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ?"
    ).run(new Date().toISOString(), jobId);
    await this._audit(adminId, 'admin_retry_job', 'job', jobId);

    return { success: true };
  }

  /**
   * List dead letter queue entries
   * Note: DLQ not implemented in current schema, returns empty array
   */
  async listDLQ({ limit = 50, offset = 0 }) {
    const bounds = safeBounds(limit, offset);
    const rows = await this.db.prepare(`
      SELECT
        dlq.id,
        dlq.job_id,
        dlq.failure_reason,
        dlq.moved_at,
        dlq.reprocessed_at,
        j.workflow_type,
        j.step,
        j.error_code,
        j.error_message,
        j.step_data
      FROM dead_letter_queue dlq
      LEFT JOIN jobs j ON j.id = dlq.job_id
      ORDER BY dlq.moved_at DESC
      LIMIT ? OFFSET ?
    `).all(bounds.limit, bounds.offset);

    return rows.map((row) => ({
      id: row.id,
      job_id: row.job_id,
      workflow_type: row.workflow_type,
      step: row.step,
      error_code: row.error_code || null,
      error_message: row.error_message || row.failure_reason || null,
      payload_json:
        row.step_data == null
          ? null
          : typeof row.step_data === "string"
            ? row.step_data
            : JSON.stringify(row.step_data),
      created_at: row.moved_at,
      reprocessed_at: row.reprocessed_at,
    }));
  }

  /**
   * Reprocess a DLQ entry by re-queuing the original job
   */
  async reprocessDLQ(dlqId, adminId, reason) {
    const entry = await this.db.prepare('SELECT * FROM dead_letter_queue WHERE id = ?').get(dlqId);
    if (!entry) return { success: false, error: 'DLQ entry not found' };
    if (entry.reprocessed_at) return { success: false, error: 'DLQ entry already reprocessed' };

    const job = await this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(entry.job_id);
    if (!job) return { success: false, error: 'Job not found' };

    const now = new Date().toISOString();
    await this.db.prepare(
      "UPDATE jobs SET status = 'queued', attempts = 0, error_code = NULL, error_message = NULL, next_attempt_at = NULL, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ?"
    ).run(now, entry.job_id);

    await this.db.prepare(
      "UPDATE dead_letter_queue SET reprocessed_at = ?, reprocess_job_id = ? WHERE id = ?"
    ).run(now, entry.job_id, dlqId);

    await this._audit(adminId, 'admin_reprocess_dlq', 'job', entry.job_id, { dlqId, reason });
    return { success: true, jobId: entry.job_id, dlqId };
  }

  // ============ MODERATION ============

  /**
   * Get moderation queue (blocked content)
   */
  async getModerationQueue({ limit = 50, offset = 0 }) {
    const bounds = safeBounds(limit, offset);
    return await this.db.prepare(`
      SELECT tv.id, tv.track_id, tv.moderation_status, tv.moderation_reason, tv.moderation_details_json,
             t.title, t.occasion, t.recipient_name, t.user_id, tv.created_at
      FROM track_versions tv
      JOIN tracks t ON tv.track_id = t.id
      WHERE tv.moderation_status = 'blocked'
      ORDER BY tv.created_at DESC LIMIT ? OFFSET ?
    `).all(bounds.limit, bounds.offset);
  }

  /**
   * Override moderation decision (approve blocked content)
   */
  async overrideModeration(versionId, adminId, reason) {
    await this.db.prepare(
      "UPDATE track_versions SET moderation_status = 'approved', moderation_reason = ? WHERE id = ?"
    ).run(`Admin override: ${reason}`, versionId);
    await this._audit(adminId, 'admin_moderation_override', 'track_version', versionId, { reason });
    return { success: true };
  }

  // ============ SHARE MANAGEMENT ============

  /**
   * List share tokens with optional filters
   */
  async listShares({ status, trackId, userId, limit = 50, offset = 0 }) {
    const bounds = safeBounds(limit, offset);
    let sql = `
      SELECT
        st.id,
        st.track_id,
        st.status,
        st.access_count,
        st.bound_device_id,
        st.stream_key,
        st.created_at,
        st.expires_at,
        t.title as track_title
      FROM share_tokens st
      JOIN tracks t ON st.track_id = t.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      sql += " AND st.status = ?";
      params.push(status);
    }
    if (trackId) {
      sql += " AND st.track_id = ?";
      params.push(trackId);
    }
    if (userId) {
      sql += " AND t.user_id = ?";
      params.push(userId);
    }

    sql += " ORDER BY st.created_at DESC LIMIT ? OFFSET ?";
    params.push(bounds.limit, bounds.offset);

    return await this.db.prepare(sql).all(...params);
  }

  /**
   * Rebind a share token to a new device
   */
  async rebindShare(shareId, newDeviceId, adminId, reason) {
    const share = await this.db.prepare('SELECT * FROM share_tokens WHERE id = ?').get(shareId);
    if (!share) return { success: false, error: 'Share not found' };

    const oldDeviceId = share.bound_device_id;
    await this.db.prepare('UPDATE share_tokens SET bound_device_id = ? WHERE id = ?').run(newDeviceId, shareId);
    await this._audit(adminId, 'share_rebound', 'share_token', shareId, { oldDeviceId, newDeviceId, reason });
    return { success: true, oldDeviceId, newDeviceId };
  }

  // ============ SYSTEM HEALTH & SECURITY ============

  /**
   * Get system health metrics (jobs, DLQ, recent errors)
   */
  async getSystemHealth() {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const jobs = await this.db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM jobs
      WHERE created_at > ?
    `).get(dayAgo);

    const dlqCount = (await this.db.prepare(
      "SELECT COUNT(*) as count FROM dead_letter_queue WHERE reprocessed_at IS NULL"
    ).get())?.count ?? 0;

    const recentErrors = await this.db.prepare(`
      SELECT workflow_type, step, COUNT(*) as count
      FROM jobs
      WHERE status = 'failed' AND updated_at > ?
      GROUP BY workflow_type, step
      ORDER BY count DESC LIMIT 10
    `).all(dayAgo);

    return {
      jobs: { running: jobs?.running || 0, queued: jobs?.queued || 0, failed: jobs?.failed || 0 },
      dlqCount,
      recentErrors,
      checkedAt: new Date().toISOString()
    };
  }

  /**
   * Search auth events (login attempts, token events, etc.)
   */
  async searchAuthEvents({ eventType, userId, startDate, endDate, limit = 50, offset = 0 }) {
    const bounds = safeBounds(limit, offset);
    let sql = `
      SELECT ae.*, u.email as user_email
      FROM auth_events ae
      LEFT JOIN users u ON ae.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (eventType) {
      sql += ' AND ae.event_type = ?';
      params.push(eventType);
    }
    if (userId) {
      sql += ' AND ae.user_id = ?';
      params.push(userId);
    }
    if (startDate) {
      sql += ' AND ae.created_at >= ?';
      params.push(startDate);
    }
    if (endDate) {
      sql += ' AND ae.created_at <= ?';
      params.push(endDate);
    }

    sql += ' ORDER BY ae.created_at DESC LIMIT ? OFFSET ?';
    params.push(bounds.limit, bounds.offset);

    return await this.db.prepare(sql).all(...params);
  }

  /**
   * Get auth event statistics (last 24h)
   */
  async getAuthEventStats() {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const stats = await this.db.prepare(`
      SELECT
        event_type,
        COUNT(*) as count
      FROM auth_events
      WHERE created_at > ?
      GROUP BY event_type
    `).all(dayAgo);

    const loginSuccess = stats.find(s => s.event_type === 'login_success')?.count || 0;
    const loginFailed = stats.find(s => s.event_type === 'login_failed')?.count || 0;

    return { byType: stats, loginSuccess, loginFailed };
  }

  /**
   * Get Apple refresh-token audit stats (validation + failures)
   */
  async getAppleRefreshTokenStats(days = 7) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const rows = await this.db.prepare(`
      SELECT action, COUNT(*) as count, MAX(created_at) as last_seen
      FROM audit_logs
      WHERE action IN ('apple_refresh_token_validated', 'apple_refresh_token_invalid')
        AND created_at >= ?
      GROUP BY action
    `).all(startDate);

    const validated = rows.find(r => r.action === 'apple_refresh_token_validated')?.count || 0;
    const invalid = rows.find(r => r.action === 'apple_refresh_token_invalid')?.count || 0;
    const lastValidated = rows.find(r => r.action === 'apple_refresh_token_validated')?.last_seen || null;
    const lastInvalid = rows.find(r => r.action === 'apple_refresh_token_invalid')?.last_seen || null;

    return {
      validated,
      invalid,
      lastValidated,
      lastInvalid,
      byAction: rows,
    };
  }

  /**
   * Search admin action audit logs
   */
  async searchAuditLogs({ action, resourceType, startDate, endDate, limit = 50, offset = 0 }) {
    const bounds = safeBounds(limit, offset);
    let sql = `
      SELECT al.*, au.email as admin_email
      FROM audit_logs al
      LEFT JOIN admin_users au ON al.user_id = au.id
      WHERE 1=1
    `;
    const params = [];

    if (action) {
      const escaped = escapeLikePattern(action);
      sql += " AND al.action LIKE ? ESCAPE '\\'";
      params.push(`%${escaped}%`);
    }
    if (resourceType) {
      sql += ' AND al.resource_type = ?';
      params.push(resourceType);
    }
    if (startDate) {
      sql += ' AND al.created_at >= ?';
      params.push(startDate);
    }
    if (endDate) {
      sql += ' AND al.created_at <= ?';
      params.push(endDate);
    }

    sql += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
    params.push(bounds.limit, bounds.offset);

    return await this.db.prepare(sql).all(...params);
  }

  /**
   * Get rate limits with optional filters
   */
  async getRateLimits({ userId, actionType, nearLimit = false, limit = 50, offset = 0 }) {
    const bounds = safeBounds(limit, offset);
    let sql = `
      SELECT rl.*, u.email as user_email
      FROM rate_limits rl
      LEFT JOIN users u ON rl.user_id = u.id
      WHERE rl.window_start_ms > ?
    `;
    const params = [Date.now() - 86400000]; // Last 24h

    if (userId) {
      sql += ' AND rl.user_id = ?';
      params.push(userId);
    }
    if (actionType) {
      sql += ' AND rl.action_type = ?';
      params.push(actionType);
    }
    if (nearLimit) {
      sql += ' AND (rl.count * 1.0 / rl.limit_count) >= 0.8';
    }

    sql += ' ORDER BY (rl.count * 1.0 / rl.limit_count) DESC LIMIT ? OFFSET ?';
    params.push(bounds.limit, bounds.offset);

    return await this.db.prepare(sql).all(...params);
  }

  /**
   * Reset a user's rate limit for specific action
   */
  async resetUserRateLimit(userId, actionType, adminId, reason) {
    await this.db.prepare('DELETE FROM rate_limits WHERE user_id = ? AND action_type = ?').run(userId, actionType);
    await this._audit(adminId, 'admin_reset_rate_limit', 'user', userId, { actionType, reason });
    return { success: true };
  }

  /**
   * Get voice profile consent logs
   */
  async getConsentLogs({ consentVersion, startDate, endDate, limit = 50, offset = 0 }) {
    const bounds = safeBounds(limit, offset);
    let sql = `
      SELECT vp.id, vp.user_id, vp.consent_version, vp.consent_at, vp.status, u.email as user_email
      FROM voice_profiles vp
      LEFT JOIN users u ON vp.user_id = u.id
      WHERE vp.consent_at IS NOT NULL
    `;
    const params = [];

    if (consentVersion) {
      sql += ' AND vp.consent_version = ?';
      params.push(consentVersion);
    }
    if (startDate) {
      sql += ' AND vp.consent_at >= ?';
      params.push(startDate);
    }
    if (endDate) {
      sql += ' AND vp.consent_at <= ?';
      params.push(endDate);
    }

    sql += ' ORDER BY vp.consent_at DESC LIMIT ? OFFSET ?';
    params.push(bounds.limit, bounds.offset);

    return await this.db.prepare(sql).all(...params);
  }

  /**
   * Get security configuration
   */
  async getSecurityConfig() {
    const config = await this.db.prepare('SELECT * FROM security_config WHERE id = ?').get('default');
    if (config) {
      return {
        sessionDurationHours: config.session_duration_hours,
        maxFailedLoginAttempts: config.max_failed_logins,
        lockoutDurationMinutes: config.lockout_minutes,
        rateLimitDefaults: JSON.parse(config.rate_limit_defaults_json || '{}')
      };
    }
    // Return defaults if no config exists
    return {
      sessionDurationHours: 8,
      maxFailedLoginAttempts: 5,
      lockoutDurationMinutes: 15,
      rateLimitDefaults: {
        enrollment_start: { limit: 3, windowSeconds: 86400 },
        render_preview: { limit: 20, windowSeconds: 86400 },
        track_create: { limit: 20, windowSeconds: 3600 }
      }
    };
  }

  /**
   * Update security configuration
   */
  async updateSecurityConfig(config, adminId) {
    const now = new Date().toISOString();
    await this.db.prepare(`
      INSERT OR REPLACE INTO security_config (id, session_duration_hours, max_failed_logins, lockout_minutes, rate_limit_defaults_json, updated_at, updated_by)
      VALUES ('default', ?, ?, ?, ?, ?, ?)
    `).run(
      config.sessionDurationHours,
      config.maxFailedLoginAttempts,
      config.lockoutDurationMinutes,
      JSON.stringify(config.rateLimitDefaults),
      now,
      adminId
    );
    await this._audit(adminId, 'admin_update_security_config', 'config', 'security', config);
    return { success: true };
  }

  // ============ VOICE PROFILE MANAGEMENT ============

  /**
   * Force a user's voice profile to require re-verification
   */
  async forceVoiceReverify(userId, adminId, reason) {
    const profile = await this.db.prepare(
      "SELECT id, status FROM voice_profiles WHERE user_id = ? AND status IN ('completed', 'active') AND deleted_at IS NULL"
    ).get(userId);

    if (!profile) {
      return { success: false, error: 'No active voice profile found' };
    }

    await this.db.prepare(
      "UPDATE voice_profiles SET status = 'pending_reverification', last_verified_at = NULL WHERE id = ?"
    ).run(profile.id);
    await this._audit(adminId, 'admin_force_reverify', 'voice_profile', profile.id, { targetUserId: userId, previousStatus: profile.status, reason });

    return { success: true, voiceProfileId: profile.id };
  }

  // ============ USER SESSION MANAGEMENT ============

  /**
   * Get active sessions for a user
   */
  async getUserSessions(userId, limit = 20) {
    return await this.db.prepare(`
      SELECT id, device_name, ip_address, user_agent, created_at, last_active_at
      FROM user_sessions
      WHERE user_id = ? AND revoked_at IS NULL
      ORDER BY last_active_at DESC
      LIMIT ?
    `).all(userId, limit);
  }

  /**
   * Revoke a specific user session
   */
  async revokeUserSession(userId, sessionId, adminId, reason) {
    const result = await this.db.prepare(
      'UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL'
    ).run(new Date().toISOString(), sessionId, userId);

    if (result.changes === 0) {
      return { success: false, error: 'Session not found or already revoked' };
    }

    await this._audit(adminId, 'admin_revoke_session', 'session', sessionId, { targetUserId: userId, reason });
    return { success: true };
  }

  /**
   * Revoke all sessions for a user
   */
  async revokeAllUserSessions(userId, adminId, reason) {
    const result = await this.db.prepare(
      'UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL'
    ).run(new Date().toISOString(), userId);

    await this._audit(adminId, 'admin_revoke_all_sessions', 'user', userId, { sessionsRevoked: result.changes, reason });
    return { success: true, sessionsRevoked: result.changes };
  }

  // ============ PROVIDER CONTROL PLANE ============

  /**
   * Get status of all external providers
   */
  async getProviderStatus() {
    return await this.db.prepare('SELECT * FROM provider_status ORDER BY provider_name').all();
  }

  /**
   * Set provider status (active, paused, disabled)
   */
  async setProviderStatus(providerName, status, adminId, reason) {
    const now = new Date().toISOString();
    const isPaused = status === 'paused';

    await this.db.prepare(`
      INSERT INTO provider_status (id, provider_name, status, paused_at, paused_by, pause_reason, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_name) DO UPDATE SET
        status = excluded.status,
        paused_at = CASE WHEN excluded.status = 'paused' THEN excluded.paused_at ELSE NULL END,
        paused_by = CASE WHEN excluded.status = 'paused' THEN excluded.paused_by ELSE NULL END,
        pause_reason = CASE WHEN excluded.status = 'paused' THEN excluded.pause_reason ELSE NULL END,
        updated_at = excluded.updated_at
    `).run(`prov_${providerName}`, providerName, status, isPaused ? now : null, isPaused ? adminId : null, reason, now);

    await this._audit(adminId, `admin_set_provider_${status}`, 'provider', providerName, { status, reason });
    return { success: true };
  }

  // ============ QUEUE CONTROL PLANE ============

  /**
   * Get status of all job queues
   */
  async getQueueStatus() {
    return await this.db.prepare('SELECT * FROM queue_status ORDER BY queue_name').all();
  }

  /**
   * Set queue status (active, paused, draining)
   */
  async setQueueStatus(queueName, status, adminId, reason) {
    const now = new Date().toISOString();
    const isPaused = status === 'paused';

    await this.db.prepare(`
      UPDATE queue_status SET
        status = ?,
        paused_at = CASE WHEN ? THEN ? ELSE NULL END,
        paused_by = CASE WHEN ? THEN ? ELSE NULL END,
        pause_reason = CASE WHEN ? THEN ? ELSE NULL END,
        updated_at = ?
      WHERE queue_name = ?
    `).run(status, isPaused, now, isPaused, adminId, isPaused, reason, now, queueName);

    await this._audit(adminId, `admin_set_queue_${status}`, 'queue', queueName, { status, reason });
    return { success: true };
  }

  // ============ BILLING & REVENUE ============

  /**
   * Get revenue metrics for dashboard
   * @param {number} days - Number of days to look back
   */
  async getRevenueMetrics(days = 30) {
    const daysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Total revenue from credit transactions (purchases)
    const revenueData = await this.db.prepare(`
      SELECT
        SUM(CASE WHEN type = 'purchase' THEN amount ELSE 0 END) as total_purchases,
        SUM(CASE WHEN type = 'subscription' THEN amount ELSE 0 END) as subscription_revenue,
        COUNT(DISTINCT user_id) as paying_users
      FROM credit_transactions
      WHERE created_at > ? AND type IN ('purchase', 'subscription')
    `).get(daysAgo);

    // Subscription revenue by tier
    const subscriptionsByTier = await this.db.prepare(`
      SELECT
        tier,
        COUNT(*) as count,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count
      FROM subscriptions
      WHERE created_at > ?
      GROUP BY tier
    `).all(daysAgo);

    // Trial conversions (trials that became active subscriptions)
    const trialData = await this.db.prepare(`
      SELECT
        COUNT(CASE WHEN status = 'trial' THEN 1 END) as current_trials,
        COUNT(CASE WHEN status = 'active' AND original_purchase_date IS NOT NULL THEN 1 END) as converted_trials
      FROM subscriptions
      WHERE created_at > ?
    `).get(daysAgo);

    // Churn (cancelled subscriptions in period)
    const churnData = await this.db.prepare(`
      SELECT COUNT(*) as cancelled
      FROM subscriptions
      WHERE cancelled_at > ? AND cancelled_at IS NOT NULL
    `).get(daysAgo);

    const activeSubscriptions = (await this.db.prepare(`
      SELECT COUNT(*) as count FROM subscriptions WHERE status = 'active'
    `).get())?.count ?? 0;

    const churnRate = activeSubscriptions > 0
      ? ((churnData.cancelled / activeSubscriptions) * 100).toFixed(2)
      : '0.00';

    return {
      totalRevenue: (revenueData.total_purchases || 0) + (revenueData.subscription_revenue || 0),
      subscriptionRevenue: revenueData.subscription_revenue || 0,
      songPurchases: revenueData.total_purchases || 0,
      payingUsers: revenueData.paying_users || 0,
      subscriptionsByTier,
      trialCount: trialData.current_trials || 0,
      trialConversions: trialData.converted_trials || 0,
      cancellations: churnData.cancelled || 0,
      churnRate,
    };
  }

  /**
   * Get subscription health metrics
   */
  async getSubscriptionHealth() {
    // Active subscriptions by tier
    const byTier = await this.db.prepare(`
      SELECT tier, COUNT(*) as count
      FROM subscriptions
      WHERE status = 'active'
      GROUP BY tier
    `).all();

    // Trial count
    const trialCount = (await this.db.prepare(`
      SELECT COUNT(*) as count FROM subscriptions WHERE status = 'trial'
    `).get())?.count ?? 0;

    // Expiring this week
    // Use ISO string for current time to avoid TEXT vs TIMESTAMP comparison in PostgreSQL
    const now = new Date().toISOString();
    const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const expiringThisWeek = (await this.db.prepare(`
      SELECT COUNT(*) as count
      FROM subscriptions
      WHERE status = 'active' AND expires_at <= ? AND expires_at > ?
    `).get(weekFromNow, now))?.count ?? 0;

    // Recent cancellations (last 7 days)
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentCancellations = (await this.db.prepare(`
      SELECT COUNT(*) as count
      FROM subscriptions
      WHERE cancelled_at > ?
    `).get(weekAgo))?.count ?? 0;

    // Grace period subscriptions
    // Use ISO string for current time comparison
    const inGracePeriod = (await this.db.prepare(`
      SELECT COUNT(*) as count
      FROM subscriptions
      WHERE grace_period_expires_at > ? AND status != 'active'
    `).get(now))?.count ?? 0;

    return {
      activeSubscriptions: byTier,
      totalActive: byTier.reduce((sum, t) => sum + t.count, 0),
      trialCount,
      expiringThisWeek,
      recentCancellations,
      inGracePeriod,
    };
  }

  /**
   * Get recent billing transactions
   */
  async getBillingTransactions({ limit = 50, offset = 0 } = {}) {
    const bounds = safeBounds(limit, offset);
    return await this.db.prepare(`
      SELECT ct.*, u.email as user_email
      FROM credit_transactions ct
      LEFT JOIN users u ON ct.user_id = u.id
      ORDER BY ct.created_at DESC
      LIMIT ? OFFSET ?
    `).all(bounds.limit, bounds.offset);
  }

  /**
   * Get webhook health metrics
   */
  async getWebhookHealth() {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Last webhook received (from audit logs)
    const lastWebhook = await this.db.prepare(`
      SELECT created_at
      FROM audit_logs
      WHERE action LIKE 'webhook_%'
      ORDER BY created_at DESC
      LIMIT 1
    `).get();

    // Webhooks by type (last 24h)
    const webhooksByType = await this.db.prepare(`
      SELECT action as webhook_type, COUNT(*) as count
      FROM audit_logs
      WHERE action LIKE 'webhook_%' AND created_at > ?
      GROUP BY action
    `).all(dayAgo);

    // Failed webhooks (from audit logs with error in metadata)
    const failedWebhooks = (await this.db.prepare(`
      SELECT COUNT(*) as count
      FROM audit_logs
      WHERE action LIKE 'webhook_%'
        AND created_at > ?
        AND metadata_json LIKE '%"error"%'
    `).get(dayAgo))?.count ?? 0;

    return {
      lastWebhookReceived: lastWebhook?.created_at || null,
      webhooksByType,
      failedWebhooks,
      pendingRetries: 0, // Would need a webhook retry queue table
    };
  }

  // ============ GROWTH & ATTRIBUTION ============

  /**
   * Get UTM attribution breakdown
   * @param {number} days - Number of days to look back
   */
  async getAttribution(days = 30) {
    const daysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Attribution by source
    const bySource = await this.db.prepare(`
      SELECT utm_source, COUNT(*) as count
      FROM share_tokens
      WHERE created_at > ? AND utm_source IS NOT NULL
      GROUP BY utm_source
      ORDER BY count DESC
    `).all(daysAgo);

    // Attribution by medium
    const byMedium = await this.db.prepare(`
      SELECT utm_medium, COUNT(*) as count
      FROM share_tokens
      WHERE created_at > ? AND utm_medium IS NOT NULL
      GROUP BY utm_medium
      ORDER BY count DESC
    `).all(daysAgo);

    // Attribution by campaign
    const byCampaign = await this.db.prepare(`
      SELECT utm_campaign, COUNT(*) as count
      FROM share_tokens
      WHERE created_at > ? AND utm_campaign IS NOT NULL
      GROUP BY utm_campaign
      ORDER BY count DESC
    `).all(daysAgo);

    // Total shares with attribution
    const withAttribution = (await this.db.prepare(`
      SELECT COUNT(*) as count
      FROM share_tokens
      WHERE created_at > ? AND (utm_source IS NOT NULL OR utm_medium IS NOT NULL OR utm_campaign IS NOT NULL)
    `).get(daysAgo))?.count ?? 0;

    const totalShares = (await this.db.prepare(`
      SELECT COUNT(*) as count FROM share_tokens WHERE created_at > ?
    `).get(daysAgo))?.count ?? 0;

    return {
      bySource,
      byMedium,
      byCampaign,
      withAttribution,
      totalShares,
      attributionRate: totalShares > 0 ? ((withAttribution / totalShares) * 100).toFixed(2) : '0.00',
    };
  }

  /**
   * Get teaser funnel metrics (views → clicks → conversions)
   * @param {number} days - Number of days to look back
   */
  async getTeaserMetrics(days = 7) {
    const daysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Teaser views from events table
    const teaserViews = (await this.db.prepare(`
      SELECT COUNT(*) as count
      FROM events
      WHERE event_name = 'teaser_viewed' AND created_at > ?
    `).get(daysAgo))?.count ?? 0;

    // Share claims (conversions)
    const shareClaims = (await this.db.prepare(`
      SELECT COUNT(*) as count
      FROM events
      WHERE event_name = 'share_claim' AND created_at > ?
    `).get(daysAgo))?.count ?? 0;

    // Share streams
    const shareStreams = (await this.db.prepare(`
      SELECT COUNT(*) as count
      FROM events
      WHERE event_name = 'share_stream' AND created_at > ?
    `).get(daysAgo))?.count ?? 0;

    // Daily breakdown
    const dailyViews = await this.db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM events
      WHERE event_name = 'teaser_viewed' AND created_at > ?
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `).all(daysAgo);

    return {
      teaserViews,
      shareClaims,
      shareStreams,
      viewToClaimRate: teaserViews > 0 ? ((shareClaims / teaserViews) * 100).toFixed(2) : '0.00',
      viewToStreamRate: teaserViews > 0 ? ((shareStreams / teaserViews) * 100).toFixed(2) : '0.00',
      dailyViews,
    };
  }

  /**
   * Get share performance metrics
   * @param {number} days - Number of days to look back
   */
  async getShareMetrics(days = 30) {
    const daysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Shares created
    const created = (await this.db.prepare(`
      SELECT COUNT(*) as count FROM share_tokens WHERE created_at > ?
    `).get(daysAgo))?.count ?? 0;

    // Shares claimed
    const claimed = (await this.db.prepare(`
      SELECT COUNT(*) as count FROM share_tokens WHERE status = 'claimed' AND bound_at > ?
    `).get(daysAgo))?.count ?? 0;

    // Share by status
    const byStatus = await this.db.prepare(`
      SELECT status, COUNT(*) as count
      FROM share_tokens
      WHERE created_at > ?
      GROUP BY status
    `).all(daysAgo);

    // Average access count
    const avgAccess = (await this.db.prepare(`
      SELECT AVG(access_count) as avg_access
      FROM share_tokens
      WHERE created_at > ?
    `).get(daysAgo))?.avg_access ?? 0;

    // Daily creation trend
    const dailyCreated = await this.db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM share_tokens
      WHERE created_at > ?
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `).all(daysAgo);

    return {
      created,
      claimed,
      claimRate: created > 0 ? ((claimed / created) * 100).toFixed(2) : '0.00',
      byStatus,
      avgAccessCount: avgAccess.toFixed(1),
      dailyCreated,
    };
  }

  // ============ ENROLLMENT METRICS ============

  /**
   * Get voice enrollment metrics
   */
  async getEnrollmentMetrics() {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Total and completed enrollments
    const totals = await this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM enrollment_sessions
    `).get();

    const total = Number(totals?.total) || 0;
    const completed = Number(totals?.completed) || 0;
    const completionRate = total > 0 ? ((completed / total) * 100).toFixed(2) : '0.00';

    // Average quality score from voice profiles
    const avgQuality = (await this.db.prepare(`
      SELECT AVG(quality_score) as avg_score
      FROM voice_profiles
      WHERE quality_score IS NOT NULL
    `).get())?.avg_score ?? 0;

    // Quality score distribution (buckets of 10)
    const qualityDistribution = await this.db.prepare(`
      SELECT
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
      ORDER BY MIN(quality_score)
    `).all();

    // Abandonment by status (excludes completed)
    const abandonmentByStep = await this.db.prepare(`
      SELECT status as step, COUNT(*) as count
      FROM enrollment_sessions
      WHERE status != 'completed'
      GROUP BY status
      ORDER BY count DESC
    `).all();

    // Last 7 days trend
    const last7Days = await this.db.prepare(`
      SELECT
        DATE(started_at) as date,
        COUNT(*) as started,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM enrollment_sessions
      WHERE started_at >= ?
      GROUP BY DATE(started_at)
      ORDER BY date ASC
    `).all(weekAgo);

    return {
      totalEnrollments: total,
      completedEnrollments: completed,
      completionRate: parseFloat(completionRate),
      averageQualityScore: Number(avgQuality.toFixed(1)),
      qualityDistribution,
      abandonmentByStep,
      last7Days,
    };
  }

  // ============ RENDER PIPELINE METRICS ============

  /**
   * Get render pipeline success metrics
   */
  async getRenderSuccessMetrics() {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Success rate by render type
    const previewStats = await this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as success
      FROM track_versions
      WHERE render_type = 'preview'
    `).get();

    const fullStats = await this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as success
      FROM track_versions
      WHERE render_type = 'full'
    `).get();

    const previewTotal = Number(previewStats?.total) || 0;
    const previewSuccess = Number(previewStats?.success) || 0;
    const fullTotal = Number(fullStats?.total) || 0;
    const fullSuccess = Number(fullStats?.success) || 0;

    // Error breakdown by error_code (last 7 days)
    const errorBreakdown = await this.db.prepare(`
      SELECT
        error_code,
        COUNT(*) as count,
        MAX(updated_at) as last_seen
      FROM jobs
      WHERE status = 'failed' AND error_code IS NOT NULL AND updated_at >= ?
      GROUP BY error_code
      ORDER BY count DESC
      LIMIT 20
    `).all(weekAgo);

    // Step-level latency - fetch timestamps and calculate in JS for PostgreSQL compatibility
    const stepTimings = await this.db.prepare(`
      SELECT
        step,
        created_at,
        updated_at
      FROM jobs
      WHERE status = 'completed' AND step IS NOT NULL AND created_at >= ?
    `).all(weekAgo);

    // Calculate step latencies in JavaScript
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

    const stepLatency = Array.from(stepLatencyMap.entries())
      .filter(([, durations]) => durations.length > 5)
      .map(([step, durations]) => ({
        step,
        sample_count: durations.length,
        avg_ms: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
      }))
      .sort((a, b) => b.avg_ms - a.avg_ms);

    // Daily trend (last 7 days)
    const dailyTrend = await this.db.prepare(`
      SELECT
        DATE(completed_at) as date,
        SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM track_versions
      WHERE completed_at >= ?
      GROUP BY DATE(completed_at)
      ORDER BY date ASC
    `).all(weekAgo);

    return {
      successRate: {
        preview: previewTotal > 0 ? parseFloat(((previewSuccess / previewTotal) * 100).toFixed(2)) : 0,
        full: fullTotal > 0 ? parseFloat(((fullSuccess / fullTotal) * 100).toFixed(2)) : 0,
      },
      errorBreakdown,
      stepLatency: stepLatency.map(s => ({
        step: s.step,
        avg_ms: Math.round(s.avg_ms || 0),
        sample_count: s.sample_count,
      })),
      dailyTrend,
    };
  }

  // ============ RISK METRICS ============

  /**
   * Get user risk distribution metrics
   */
  async getRiskMetrics() {
    const now = new Date().toISOString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Risk level distribution
    const distribution = await this.db.prepare(`
      SELECT
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
        END
    `).all();

    // Locked accounts
    // Use ISO string for current time to avoid TEXT vs TIMESTAMP comparison in PostgreSQL
    const lockedAccounts = (await this.db.prepare(`
      SELECT COUNT(*) as count
      FROM users
      WHERE locked_until IS NOT NULL AND locked_until > ?
    `).get(now))?.count ?? 0;

    // Recent escalations (from audit logs)
    const recentEscalations = await this.db.prepare(`
      SELECT
        resource_id as user_id,
        metadata_json,
        created_at as date
      FROM audit_logs
      WHERE action = 'admin_update_risk' AND created_at >= ?
      ORDER BY created_at DESC
      LIMIT 20
    `).all(weekAgo);

    // Parse escalations to extract from/to risk levels
    const parsedEscalations = recentEscalations.map(e => {
      try {
        const meta = JSON.parse(e.metadata_json || '{}');
        return {
          user_id: e.user_id,
          to: meta.riskLevel || 'unknown',
          reason: meta.reason || '',
          date: e.date,
        };
      } catch (parseError) {
        console.warn(`[AdminService] Malformed metadata_json in audit_logs for user ${e.user_id}:`, parseError.message);
        return {
          user_id: e.user_id,
          to: 'unknown',
          reason: '[metadata parse error]',
          date: e.date,
        };
      }
    });

    return {
      distribution,
      lockedAccounts: Number(lockedAccounts),
      recentEscalations: parsedEscalations,
    };
  }
}

module.exports = { AdminService };
