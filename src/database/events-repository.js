"use strict";

function createEventsRepository(db) {
  async function insertEvent({
    id,
    eventName,
    userId = null,
    resourceType = null,
    resourceId = null,
    metadataJson = null,
    ip = null,
    userAgent = null,
  }) {
    return db
      .prepare(
        `INSERT INTO events (id, event_name, user_id, resource_type, resource_id, metadata_json, ip_address, user_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO NOTHING`,
      )
      .run(
        id,
        eventName,
        userId,
        resourceType,
        resourceId,
        metadataJson,
        ip,
        userAgent,
      );
  }

  async function queryEvents({
    eventName,
    userId,
    resourceType,
    resourceId,
    startDate,
    endDate,
    limit,
    offset,
  } = {}) {
    let sql = "SELECT * FROM events WHERE 1=1";
    const params = [];

    if (eventName) {
      sql += " AND event_name = ?";
      params.push(eventName);
    }
    if (userId) {
      sql += " AND user_id = ?";
      params.push(userId);
    }
    if (resourceType) {
      sql += " AND resource_type = ?";
      params.push(resourceType);
    }
    if (resourceId) {
      sql += " AND resource_id = ?";
      params.push(resourceId);
    }
    if (startDate) {
      sql += " AND created_at >= ?";
      params.push(startDate);
    }
    if (endDate) {
      sql += " AND created_at <= ?";
      params.push(endDate);
    }

    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    return db.prepare(sql).all(...params);
  }

  async function countByNameSince(eventName, startDate) {
    return db
      .prepare("SELECT COUNT(*) as count FROM events WHERE event_name = ? AND created_at >= ?")
      .get(eventName, startDate);
  }

  async function getEventCountsSince(startDate) {
    return db
      .prepare(
        `SELECT event_name, COUNT(*) as count
         FROM events
         WHERE created_at >= ?
         GROUP BY event_name
         ORDER BY count DESC`,
      )
      .all(startDate);
  }

  async function getDailyEventCountsSince(eventName, startDate) {
    return db
      .prepare(
        `SELECT DATE(created_at) as date, COUNT(*) as count
         FROM events
         WHERE event_name = ? AND created_at >= ?
         GROUP BY DATE(created_at)
         ORDER BY date ASC`,
      )
      .all(eventName, startDate);
  }

  async function getAdminEventCountsAfter(startDate) {
    return db
      .prepare(
        `SELECT event_name, COUNT(*) as count
         FROM events
         WHERE created_at > ?
         GROUP BY event_name
         ORDER BY count DESC`,
      )
      .all(startDate);
  }

  async function getAdminDailyEventCountsAfter(eventName, startDate) {
    return db
      .prepare(
        `SELECT DATE(created_at) as date, COUNT(*) as count
         FROM events
         WHERE event_name = ? AND created_at > ?
         GROUP BY DATE(created_at)
         ORDER BY date ASC`,
      )
      .all(eventName, startDate);
  }

  async function countDistinctUsersForEventAfter(eventName, startDate) {
    return db
      .prepare(
        `SELECT COUNT(DISTINCT user_id) as c
         FROM events
         WHERE event_name = ? AND created_at > ? AND user_id IS NOT NULL`,
      )
      .get(eventName, startDate);
  }

  async function countDistinctUsersConvertedAfter(startEvent, endEvent, startDate) {
    return db
      .prepare(
        `SELECT COUNT(DISTINCT s.user_id) as c
         FROM events s
         WHERE s.event_name = ?
           AND s.created_at > ?
           AND s.user_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM events e
             WHERE e.event_name = ?
               AND e.user_id = s.user_id
               AND e.created_at >= s.created_at
           )`,
      )
      .get(startEvent, startDate, endEvent);
  }

  async function getFunnelCountsSince(startEvent, endEvent, startDate) {
    const [start, end] = await Promise.all([
      countByNameSince(startEvent, startDate),
      countByNameSince(endEvent, startDate),
    ]);
    return {
      startCount: Number(start?.count || 0),
      endCount: Number(end?.count || 0),
    };
  }

  async function getUserEvents(userId, limit) {
    return db
      .prepare("SELECT * FROM events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(userId, limit);
  }

  async function getAdminUserEvents(userId, limit) {
    return db
      .prepare(
        `SELECT id, event_name, user_id, resource_type, resource_id, metadata_json, created_at
         FROM events
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(userId, limit);
  }

  async function insertAuditLog({
    id,
    userId,
    action,
    resourceType,
    resourceId,
    metadataJson,
    createdAt,
  }) {
    return db
      .prepare(
        `INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        action,
        resourceType,
        resourceId,
        metadataJson,
        createdAt,
      );
  }

  async function insertUserAnalyticsReadAudit({
    id,
    adminId,
    targetUserId,
    metadataJson,
    createdAt,
  }) {
    return insertAuditLog({
      id,
      userId: adminId,
      action: "analytics.user.read",
      resourceType: "user_analytics",
      resourceId: targetUserId,
      metadataJson,
      createdAt,
    });
  }

  return {
    insertEvent,
    queryEvents,
    countByNameSince,
    getEventCountsSince,
    getDailyEventCountsSince,
    getAdminEventCountsAfter,
    getAdminDailyEventCountsAfter,
    countDistinctUsersForEventAfter,
    countDistinctUsersConvertedAfter,
    getFunnelCountsSince,
    getUserEvents,
    getAdminUserEvents,
    insertAuditLog,
    insertUserAnalyticsReadAudit,
  };
}

module.exports = { createEventsRepository };
