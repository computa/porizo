"use strict";

function createAdminSecurityObservabilityRepository(db) {
  return {
    searchAuthEvents({ filters, limit, offset }) {
      let sql = `
        SELECT ae.*, u.email as user_email
        FROM auth_events ae
        LEFT JOIN users u ON ae.user_id = u.id
        WHERE 1=1
      `;
      const params = [];

      if (filters.eventType) {
        sql += " AND ae.event_type = ?";
        params.push(filters.eventType);
      }
      if (filters.userId) {
        sql += " AND ae.user_id = ?";
        params.push(filters.userId);
      }
      if (filters.startDate) {
        sql += " AND ae.created_at >= ?";
        params.push(filters.startDate);
      }
      if (filters.endDate) {
        sql += " AND ae.created_at <= ?";
        params.push(filters.endDate);
      }

      sql += " ORDER BY ae.created_at DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);

      return db.prepare(sql).all(...params);
    },

    getAuthEventStats({ since }) {
      return db
        .prepare(
          `SELECT
            event_type,
            COUNT(*) as count
          FROM auth_events
          WHERE created_at > ?
          GROUP BY event_type`,
        )
        .all(since);
    },

    getAppleRefreshTokenStats({ startDate }) {
      return db
        .prepare(
          `SELECT action, COUNT(*) as count, MAX(created_at) as last_seen
          FROM audit_logs
          WHERE action IN ('apple_refresh_token_validated', 'apple_refresh_token_invalid')
            AND created_at >= ?
          GROUP BY action`,
        )
        .all(startDate);
    },

    searchAuditLogs({ filters, limit, offset }) {
      let sql = `
        SELECT al.*, au.email as admin_email
        FROM audit_logs al
        LEFT JOIN admin_users au ON al.user_id = au.id
        WHERE 1=1
      `;
      const params = [];

      if (filters.actionPattern) {
        sql += " AND al.action LIKE ? ESCAPE '\\'";
        params.push(filters.actionPattern);
      }
      if (filters.resourceType) {
        sql += " AND al.resource_type = ?";
        params.push(filters.resourceType);
      }
      if (filters.startDate) {
        sql += " AND al.created_at >= ?";
        params.push(filters.startDate);
      }
      if (filters.endDate) {
        sql += " AND al.created_at <= ?";
        params.push(filters.endDate);
      }

      sql += " ORDER BY al.created_at DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);

      return db.prepare(sql).all(...params);
    },

    getRateLimits({ filters, limit, offset }) {
      let sql = `
        SELECT rl.*, u.email as user_email
        FROM rate_limits rl
        LEFT JOIN users u ON rl.user_id = u.id
        WHERE rl.window_start_ms > ?
      `;
      const params = [filters.windowStartAfterMs];

      if (filters.userId) {
        sql += " AND rl.user_id = ?";
        params.push(filters.userId);
      }
      if (filters.actionType) {
        sql += " AND rl.action_type = ?";
        params.push(filters.actionType);
      }
      if (filters.nearLimit) {
        sql += " AND (rl.count * 1.0 / rl.limit_count) >= 0.8";
      }

      sql += " ORDER BY (rl.count * 1.0 / rl.limit_count) DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);

      return db.prepare(sql).all(...params);
    },

    deleteRateLimitRows(userId, actionType) {
      return db
        .prepare("DELETE FROM rate_limits WHERE user_id = ? AND action_type = ?")
        .run(userId, actionType);
    },

    getConsentLogs({ filters, limit, offset }) {
      let sql = `
        SELECT vp.id, vp.user_id, vp.consent_version, vp.consent_at, vp.status, u.email as user_email
        FROM voice_profiles vp
        LEFT JOIN users u ON vp.user_id = u.id
        WHERE vp.consent_at IS NOT NULL
      `;
      const params = [];

      if (filters.consentVersion) {
        sql += " AND vp.consent_version = ?";
        params.push(filters.consentVersion);
      }
      if (filters.startDate) {
        sql += " AND vp.consent_at >= ?";
        params.push(filters.startDate);
      }
      if (filters.endDate) {
        sql += " AND vp.consent_at <= ?";
        params.push(filters.endDate);
      }

      sql += " ORDER BY vp.consent_at DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);

      return db.prepare(sql).all(...params);
    },
  };
}

module.exports = {
  createAdminSecurityObservabilityRepository,
};
