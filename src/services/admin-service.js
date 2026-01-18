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
  _audit(adminId, action, resourceType, resourceId, metadata = {}) {
    this.db.prepare(
      'INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(generateAuditId(), adminId, action, resourceType, resourceId, JSON.stringify(metadata), new Date().toISOString());
  }

  // ============ USER MANAGEMENT ============

  /**
   * Search users with optional filters
   * Returns user data with adoption metrics (tier, track_count, voice_status, credits_used, last_active)
   */
  searchUsers({ email, userId, riskLevel, tier, limit = 50, offset = 0 }) {
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

    sql += ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?';
    params.push(bounds.limit, bounds.offset);

    return this.db.prepare(sql).all(...params);
  }

  /**
   * Get aggregate user statistics for summary banner
   * Returns counts by tier and conversion rate
   */
  getUserStats() {
    const stats = this.db.prepare(`
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
  getUserDetail(userId) {
    const user = this.db.prepare(
      'SELECT * FROM users WHERE id = ?'
    ).get(userId);

    if (!user) return null;

    const voiceProfile = this.db.prepare(
      'SELECT id, status, quality_score, created_at FROM voice_profiles WHERE user_id = ? AND deleted_at IS NULL'
    ).get(userId);

    const entitlements = this.db.prepare(
      'SELECT * FROM entitlements WHERE user_id = ?'
    ).get(userId);

    const subscription = this.db.prepare(
      'SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(userId);

    const tracks = this.db.prepare(
      'SELECT id, title, occasion, status, created_at FROM tracks WHERE user_id = ? ORDER BY created_at DESC LIMIT 10'
    ).all(userId);

    const shares = this.db.prepare(
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
  updateUserRisk(userId, riskLevel, adminId, reason) {
    this.db.prepare('UPDATE users SET risk_level = ? WHERE id = ?').run(riskLevel, userId);
    this._audit(adminId, 'admin_update_risk', 'user', userId, { riskLevel, reason });
    return { success: true };
  }

  /**
   * Lock or unlock a user account
   */
  lockUser(userId, locked, adminId, reason) {
    const lockedUntil = locked ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() : null;
    this.db.prepare('UPDATE users SET locked_until = ? WHERE id = ?').run(lockedUntil, userId);
    this._audit(adminId, locked ? 'admin_lock_user' : 'admin_unlock_user', 'user', userId, { reason });
    return { success: true, lockedUntil };
  }

  // ============ METRICS ============

  /**
   * Get overview dashboard metrics
   */
  getOverviewMetrics() {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const totalUsers = this.db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const newUsersToday = this.db.prepare('SELECT COUNT(*) as count FROM users WHERE created_at > ?').get(dayAgo).count;
    const newUsersWeek = this.db.prepare('SELECT COUNT(*) as count FROM users WHERE created_at > ?').get(weekAgo).count;

    const tierDist = this.db.prepare('SELECT tier, COUNT(*) as count FROM entitlements GROUP BY tier').all();

    const jobStats = this.db.prepare('SELECT status, COUNT(*) as count FROM jobs GROUP BY status').all();

    const rendersToday = this.db.prepare(
      "SELECT COUNT(*) as count FROM track_versions WHERE created_at > ? AND render_type = 'preview'"
    ).get(dayAgo).count;

    return { totalUsers, newUsersToday, newUsersWeek, tierDist, jobStats, rendersToday };
  }

  /**
   * Get job health metrics
   */
  getJobMetrics() {
    const jobsByStatus = this.db.prepare('SELECT status, COUNT(*) as count FROM jobs GROUP BY status').all();

    const jobsByWorkflow = this.db.prepare(
      'SELECT workflow_type, status, COUNT(*) as count FROM jobs GROUP BY workflow_type, status'
    ).all();

    // Stale jobs: running for more than 30 minutes
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const staleJobs = this.db.prepare(
      "SELECT COUNT(*) as count FROM jobs WHERE status = 'running' AND updated_at < ?"
    ).get(thirtyMinAgo).count;

    // Recent failures grouped by error code
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentFailures = this.db.prepare(
      "SELECT error_code, COUNT(*) as count FROM jobs WHERE status = 'failed' AND created_at > ? GROUP BY error_code ORDER BY count DESC LIMIT 10"
    ).all(weekAgo);

    // DLQ is not implemented in current schema, return 0
    const dlqCount = 0;

    return { jobsByStatus, jobsByWorkflow, staleJobs, recentFailures, dlqCount };
  }

  /**
   * Get cost metrics for specified number of days
   */
  getCostMetrics(days = 30) {
    const daysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const dailyCosts = this.db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as renders,
             SUM(json_extract(actual_cost_json, '$.total_usd')) as total_cost_usd
      FROM track_versions
      WHERE status = 'completed' AND actual_cost_json IS NOT NULL
        AND created_at > ?
      GROUP BY DATE(created_at) ORDER BY date DESC
    `).all(daysAgo);

    const costByType = this.db.prepare(`
      SELECT render_type, COUNT(*) as count,
             AVG(json_extract(actual_cost_json, '$.total_usd')) as avg_cost_usd,
             SUM(json_extract(actual_cost_json, '$.total_usd')) as total_cost_usd
      FROM track_versions WHERE status = 'completed' AND actual_cost_json IS NOT NULL
      GROUP BY render_type
    `).all();

    return { dailyCosts, costByType };
  }

  // ============ JOB MANAGEMENT ============

  /**
   * List jobs with optional filters
   */
  listJobs({ status, workflowType, limit = 50, offset = 0 }) {
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

    return this.db.prepare(sql).all(...params);
  }

  /**
   * Retry a failed job
   */
  retryJob(jobId, adminId) {
    const job = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!job) return { success: false, error: 'Job not found' };
    if (job.status !== 'failed') return { success: false, error: 'Job is not failed' };

    this.db.prepare(
      "UPDATE jobs SET status = 'queued', attempts = 0, error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ?"
    ).run(new Date().toISOString(), jobId);
    this._audit(adminId, 'admin_retry_job', 'job', jobId);

    return { success: true };
  }

  /**
   * List dead letter queue entries
   * Note: DLQ not implemented in current schema, returns empty array
   */
  listDLQ({ limit = 50, offset = 0 }) {
    // DLQ table doesn't exist in current schema
    return [];
  }

  // ============ MODERATION ============

  /**
   * Get moderation queue (blocked content)
   */
  getModerationQueue({ limit = 50, offset = 0 }) {
    const bounds = safeBounds(limit, offset);
    return this.db.prepare(`
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
  overrideModeration(versionId, adminId, reason) {
    this.db.prepare(
      "UPDATE track_versions SET moderation_status = 'approved', moderation_reason = ? WHERE id = ?"
    ).run(`Admin override: ${reason}`, versionId);
    this._audit(adminId, 'admin_moderation_override', 'track_version', versionId, { reason });
    return { success: true };
  }

  // ============ SHARE MANAGEMENT ============

  /**
   * Rebind a share token to a new device
   */
  rebindShare(shareId, newDeviceId, adminId, reason) {
    const share = this.db.prepare('SELECT * FROM share_tokens WHERE id = ?').get(shareId);
    if (!share) return { success: false, error: 'Share not found' };

    const oldDeviceId = share.bound_device_id;
    this.db.prepare('UPDATE share_tokens SET bound_device_id = ? WHERE id = ?').run(newDeviceId, shareId);
    this._audit(adminId, 'share_rebound', 'share_token', shareId, { oldDeviceId, newDeviceId, reason });
    return { success: true, oldDeviceId, newDeviceId };
  }

  // ============ SYSTEM HEALTH & SECURITY ============

  /**
   * Get system health metrics (jobs, DLQ, recent errors)
   */
  getSystemHealth() {
    const jobs = this.db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM jobs
      WHERE created_at > datetime('now', '-24 hours')
    `).get();

    // DLQ not implemented in current schema - return 0
    const dlqCount = 0;

    const recentErrors = this.db.prepare(`
      SELECT workflow_type, step, COUNT(*) as count
      FROM jobs
      WHERE status = 'failed' AND updated_at > datetime('now', '-24 hours')
      GROUP BY workflow_type, step
      ORDER BY count DESC LIMIT 10
    `).all();

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
  searchAuthEvents({ eventType, userId, startDate, endDate, limit = 50, offset = 0 }) {
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

    return this.db.prepare(sql).all(...params);
  }

  /**
   * Get auth event statistics (last 24h)
   */
  getAuthEventStats() {
    const stats = this.db.prepare(`
      SELECT
        event_type,
        COUNT(*) as count
      FROM auth_events
      WHERE created_at > datetime('now', '-24 hours')
      GROUP BY event_type
    `).all();

    const loginSuccess = stats.find(s => s.event_type === 'login_success')?.count || 0;
    const loginFailed = stats.find(s => s.event_type === 'login_failed')?.count || 0;

    return { byType: stats, loginSuccess, loginFailed };
  }

  /**
   * Search admin action audit logs
   */
  searchAuditLogs({ action, resourceType, startDate, endDate, limit = 50, offset = 0 }) {
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

    return this.db.prepare(sql).all(...params);
  }

  /**
   * Get rate limits with optional filters
   */
  getRateLimits({ userId, actionType, nearLimit = false, limit = 50, offset = 0 }) {
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

    return this.db.prepare(sql).all(...params);
  }

  /**
   * Reset a user's rate limit for specific action
   */
  resetUserRateLimit(userId, actionType, adminId, reason) {
    this.db.prepare('DELETE FROM rate_limits WHERE user_id = ? AND action_type = ?').run(userId, actionType);
    this._audit(adminId, 'admin_reset_rate_limit', 'user', userId, { actionType, reason });
    return { success: true };
  }

  /**
   * Get voice profile consent logs
   */
  getConsentLogs({ consentVersion, startDate, endDate, limit = 50, offset = 0 }) {
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

    return this.db.prepare(sql).all(...params);
  }

  /**
   * Get security configuration
   */
  getSecurityConfig() {
    const config = this.db.prepare('SELECT * FROM security_config WHERE id = ?').get('default');
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
  updateSecurityConfig(config, adminId) {
    const now = new Date().toISOString();
    this.db.prepare(`
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
    this._audit(adminId, 'admin_update_security_config', 'config', 'security', config);
    return { success: true };
  }

  // ============ VOICE PROFILE MANAGEMENT ============

  /**
   * Force a user's voice profile to require re-verification
   */
  forceVoiceReverify(userId, adminId, reason) {
    const profile = this.db.prepare(
      "SELECT id, status FROM voice_profiles WHERE user_id = ? AND status IN ('completed', 'active') AND deleted_at IS NULL"
    ).get(userId);

    if (!profile) {
      return { success: false, error: 'No active voice profile found' };
    }

    this.db.prepare(
      "UPDATE voice_profiles SET status = 'pending_reverification', last_verified_at = NULL WHERE id = ?"
    ).run(profile.id);
    this._audit(adminId, 'admin_force_reverify', 'voice_profile', profile.id, { targetUserId: userId, previousStatus: profile.status, reason });

    return { success: true, voiceProfileId: profile.id };
  }

  // ============ USER SESSION MANAGEMENT ============

  /**
   * Get active sessions for a user
   */
  getUserSessions(userId, limit = 20) {
    return this.db.prepare(`
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
  revokeUserSession(userId, sessionId, adminId, reason) {
    const result = this.db.prepare(
      'UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL'
    ).run(new Date().toISOString(), sessionId, userId);

    if (result.changes === 0) {
      return { success: false, error: 'Session not found or already revoked' };
    }

    this._audit(adminId, 'admin_revoke_session', 'session', sessionId, { targetUserId: userId, reason });
    return { success: true };
  }

  /**
   * Revoke all sessions for a user
   */
  revokeAllUserSessions(userId, adminId, reason) {
    const result = this.db.prepare(
      'UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL'
    ).run(new Date().toISOString(), userId);

    this._audit(adminId, 'admin_revoke_all_sessions', 'user', userId, { sessionsRevoked: result.changes, reason });
    return { success: true, sessionsRevoked: result.changes };
  }

  // ============ PROVIDER CONTROL PLANE ============

  /**
   * Get status of all external providers
   */
  getProviderStatus() {
    return this.db.prepare('SELECT * FROM provider_status ORDER BY provider_name').all();
  }

  /**
   * Set provider status (active, paused, disabled)
   */
  setProviderStatus(providerName, status, adminId, reason) {
    const now = new Date().toISOString();
    const isPaused = status === 'paused';

    this.db.prepare(`
      INSERT INTO provider_status (id, provider_name, status, paused_at, paused_by, pause_reason, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_name) DO UPDATE SET
        status = excluded.status,
        paused_at = CASE WHEN excluded.status = 'paused' THEN excluded.paused_at ELSE NULL END,
        paused_by = CASE WHEN excluded.status = 'paused' THEN excluded.paused_by ELSE NULL END,
        pause_reason = CASE WHEN excluded.status = 'paused' THEN excluded.pause_reason ELSE NULL END,
        updated_at = excluded.updated_at
    `).run(`prov_${providerName}`, providerName, status, isPaused ? now : null, isPaused ? adminId : null, reason, now);

    this._audit(adminId, `admin_set_provider_${status}`, 'provider', providerName, { status, reason });
    return { success: true };
  }

  // ============ QUEUE CONTROL PLANE ============

  /**
   * Get status of all job queues
   */
  getQueueStatus() {
    return this.db.prepare('SELECT * FROM queue_status ORDER BY queue_name').all();
  }

  /**
   * Set queue status (active, paused, draining)
   */
  setQueueStatus(queueName, status, adminId, reason) {
    const now = new Date().toISOString();
    const isPaused = status === 'paused';

    this.db.prepare(`
      UPDATE queue_status SET
        status = ?,
        paused_at = CASE WHEN ? THEN ? ELSE NULL END,
        paused_by = CASE WHEN ? THEN ? ELSE NULL END,
        pause_reason = CASE WHEN ? THEN ? ELSE NULL END,
        updated_at = ?
      WHERE queue_name = ?
    `).run(status, isPaused, now, isPaused, adminId, isPaused, reason, now, queueName);

    this._audit(adminId, `admin_set_queue_${status}`, 'queue', queueName, { status, reason });
    return { success: true };
  }
}

module.exports = { AdminService };
