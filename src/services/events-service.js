/**
 * Events Service
 * Unified telemetry service for tracking user actions, funnel events,
 * and analytics across the platform.
 */

const crypto = require("crypto");

/**
 * Generate a unique event ID
 */
function generateEventId() {
  return `evt_${crypto.randomBytes(12).toString("hex")}`;
}

class EventsService {
  constructor(db) {
    this.db = db;
  }

  /**
   * Emit a new event
   * @param {string} eventName - The event type (e.g., 'story_start', 'share_claim')
   * @param {Object} options - Event options
   * @param {string} [options.id] - Caller-supplied event id for idempotent inserts. When provided, duplicate ids are silently ignored via ON CONFLICT DO NOTHING. If omitted, a new id is generated.
   * @param {string} [options.userId] - User who triggered the event
   * @param {string} [options.resourceType] - Type of resource (track, share, user)
   * @param {string} [options.resourceId] - ID of the resource
   * @param {Object} [options.metadata] - Additional event-specific data
   * @param {string} [options.ip] - IP address of the request
   * @param {string} [options.userAgent] - User agent string
   * @returns {Promise<{ id: string, duplicate: boolean }>} The event id and whether the caller-supplied id already existed (duplicate). For auto-generated ids, `duplicate` is always false.
   */
  async emit(eventName, { id, userId, resourceType, resourceId, metadata, ip, userAgent } = {}) {
    const eventId = id || generateEventId();
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    const result = this.db
      .prepare(
        `INSERT INTO events (id, event_name, user_id, resource_type, resource_id, metadata_json, ip_address, user_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO NOTHING`
      )
      .run(eventId, eventName, userId || null, resourceType || null, resourceId || null, metadataJson, ip || null, userAgent || null);

    // SQLite and Postgres report 0 changes when ON CONFLICT fires.
    const changes = typeof result?.changes === "number" ? result.changes : Number(result?.rowCount ?? 0);
    const duplicate = id != null && changes === 0;
    return { id: eventId, duplicate };
  }

  /**
   * Query events with optional filters
   * @param {Object} filters - Query filters
   * @param {string} [filters.eventName] - Filter by event type
   * @param {string} [filters.userId] - Filter by user
   * @param {string} [filters.resourceType] - Filter by resource type
   * @param {string} [filters.resourceId] - Filter by resource ID
   * @param {string} [filters.startDate] - Filter events after this date (ISO string)
   * @param {string} [filters.endDate] - Filter events before this date (ISO string)
   * @param {number} [filters.limit=100] - Maximum results to return
   * @param {number} [filters.offset=0] - Offset for pagination
   * @returns {Array} Array of event objects
   */
  async query({ eventName, userId, resourceType, resourceId, startDate, endDate, limit = 100, offset = 0 } = {}) {
    const safeBounds = {
      limit: Math.min(Math.max(parseInt(limit) || 100, 1), 1000),
      offset: Math.max(parseInt(offset) || 0, 0),
    };

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
    params.push(safeBounds.limit, safeBounds.offset);

    return await this.db.prepare(sql).all(...params);
  }

  /**
   * Count events by name over a time period
   * @param {string} eventName - The event type to count
   * @param {number} [days=7] - Number of days to look back
   * @returns {number} Count of matching events
   */
  async countByName(eventName, days = 7) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db
      .prepare("SELECT COUNT(*) as count FROM events WHERE event_name = ? AND created_at >= ?")
      .get(eventName, startDate);
    return result?.count || 0;
  }

  /**
   * Get event counts grouped by name for dashboard
   * @param {number} [days=7] - Number of days to look back
   * @returns {Array} Array of {event_name, count} objects
   */
  async getEventCounts(days = 7) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    return this.db
      .prepare(
        `SELECT event_name, COUNT(*) as count
         FROM events
         WHERE created_at >= ?
         GROUP BY event_name
         ORDER BY count DESC`
      )
      .all(startDate);
  }

  /**
   * Get daily event counts for a specific event type (for charts)
   * @param {string} eventName - The event type
   * @param {number} [days=30] - Number of days to look back
   * @returns {Array} Array of {date, count} objects
   */
  async getDailyEventCounts(eventName, days = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    return this.db
      .prepare(
        `SELECT DATE(created_at) as date, COUNT(*) as count
         FROM events
         WHERE event_name = ? AND created_at >= ?
         GROUP BY DATE(created_at)
         ORDER BY date ASC`
      )
      .all(eventName, startDate);
  }

  /**
   * Get funnel metrics (conversion between sequential events)
   * @param {string} startEvent - The entry event
   * @param {string} endEvent - The conversion event
   * @param {number} [days=7] - Number of days to look back
   * @returns {Object} {startCount, endCount, conversionRate}
   */
  async getFunnelMetrics(startEvent, endEvent, days = 7) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const startCount = this.db
      .prepare("SELECT COUNT(*) as count FROM events WHERE event_name = ? AND created_at >= ?")
      .get(startEvent, startDate)?.count || 0;

    const endCount = this.db
      .prepare("SELECT COUNT(*) as count FROM events WHERE event_name = ? AND created_at >= ?")
      .get(endEvent, startDate)?.count || 0;

    return {
      startCount,
      endCount,
      conversionRate: startCount > 0 ? ((endCount / startCount) * 100).toFixed(2) : "0.00",
    };
  }

  /**
   * Get user's event history
   * @param {string} userId - User ID
   * @param {number} [limit=50] - Max events to return
   * @returns {Array} Array of events for the user
   */
  async getUserEvents(userId, limit = 50) {
    return this.db
      .prepare("SELECT * FROM events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(userId, Math.min(limit, 200));
  }
}

/**
 * Create an events service instance
 * @param {Object} db - Database instance
 * @returns {EventsService}
 */
function createEventsService(db) {
  return new EventsService(db);
}

module.exports = { EventsService, createEventsService };
