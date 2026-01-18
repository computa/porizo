/**
 * Admin Dashboard Service
 * Provides queries and actions for the admin dashboard.
 */

class AdminService {
  constructor(db) {
    this.db = db;
  }

  // ============ USER MANAGEMENT ============

  /**
   * Search users with optional filters
   */
  searchUsers({ email, userId, riskLevel, limit = 50, offset = 0 }) {
    let sql = 'SELECT id, email, display_name, risk_level, locked_until, created_at FROM users WHERE 1=1';
    const params = [];

    if (email) {
      sql += ' AND email LIKE ?';
      params.push(`%${email}%`);
    }
    if (userId) {
      sql += ' AND id = ?';
      params.push(userId);
    }
    if (riskLevel) {
      // risk_level is TEXT: 'low', 'medium', 'high'
      sql += ' AND risk_level = ?';
      params.push(riskLevel);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return this.db.prepare(sql).all(...params);
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
    const now = new Date().toISOString();

    this.db.prepare(
      'UPDATE users SET risk_level = ? WHERE id = ?'
    ).run(riskLevel, userId);

    // Audit log
    this.db.prepare(
      'INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      adminId,
      'admin_update_risk',
      'user',
      userId,
      JSON.stringify({ riskLevel, reason }),
      now
    );

    return { success: true };
  }

  /**
   * Lock or unlock a user account
   */
  lockUser(userId, locked, adminId, reason) {
    const now = new Date().toISOString();
    const lockedUntil = locked ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() : null;

    this.db.prepare(
      'UPDATE users SET locked_until = ? WHERE id = ?'
    ).run(lockedUntil, userId);

    this.db.prepare(
      'INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      adminId,
      locked ? 'admin_lock_user' : 'admin_unlock_user',
      'user',
      userId,
      JSON.stringify({ reason }),
      now
    );

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
    params.push(limit, offset);

    return this.db.prepare(sql).all(...params);
  }

  /**
   * Retry a failed job
   */
  retryJob(jobId, adminId) {
    const job = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!job) return { success: false, error: 'Job not found' };
    if (job.status !== 'failed') return { success: false, error: 'Job is not failed' };

    const now = new Date().toISOString();

    this.db.prepare(
      "UPDATE jobs SET status = 'queued', attempts = 0, error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ?"
    ).run(now, jobId);

    this.db.prepare(
      'INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      adminId,
      'admin_retry_job',
      'job',
      jobId,
      '{}',
      now
    );

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
    return this.db.prepare(`
      SELECT tv.id, tv.track_id, tv.moderation_status, tv.moderation_reason, tv.moderation_details_json,
             t.title, t.occasion, t.recipient_name, t.user_id, tv.created_at
      FROM track_versions tv
      JOIN tracks t ON tv.track_id = t.id
      WHERE tv.moderation_status = 'blocked'
      ORDER BY tv.created_at DESC LIMIT ? OFFSET ?
    `).all(limit, offset);
  }

  /**
   * Override moderation decision (approve blocked content)
   */
  overrideModeration(versionId, adminId, reason) {
    const now = new Date().toISOString();

    this.db.prepare(
      "UPDATE track_versions SET moderation_status = 'approved', moderation_reason = ? WHERE id = ?"
    ).run(`Admin override: ${reason}`, versionId);

    this.db.prepare(
      'INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      adminId,
      'admin_moderation_override',
      'track_version',
      versionId,
      JSON.stringify({ reason }),
      now
    );

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
    const now = new Date().toISOString();

    this.db.prepare(
      'UPDATE share_tokens SET bound_device_id = ? WHERE id = ?'
    ).run(newDeviceId, shareId);

    this.db.prepare(
      'INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      adminId,
      'share_rebound',
      'share_token',
      shareId,
      JSON.stringify({ oldDeviceId, newDeviceId, reason }),
      now
    );

    return { success: true, oldDeviceId, newDeviceId };
  }
}

module.exports = { AdminService };
