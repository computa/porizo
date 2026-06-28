"use strict";

function createAdminStorySessionRepository(db) {
  async function listSessions({ status, engineVersion, limit, offset }) {
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
    params.push(limit, offset);

    return db.prepare(sql).all(...params);
  }

  async function getSessionDetail(sessionId) {
    const session = db
      .prepare(
        `
      SELECT ss.*, u.email as user_email
      FROM story_sessions ss
      LEFT JOIN users u ON ss.user_id = u.id
      WHERE ss.id = ?
    `,
      )
      .get(sessionId);

    if (!session) return null;

    const turns = db
      .prepare(
        `
      SELECT * FROM story_turns
      WHERE session_id = ?
      ORDER BY turn_number ASC
    `,
      )
      .all(sessionId);

    return { session, turns };
  }

  return {
    listSessions,
    getSessionDetail,
  };
}

module.exports = { createAdminStorySessionRepository };
