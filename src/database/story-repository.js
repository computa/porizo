/**
 * Story Repository
 *
 * Database access layer for story sessions and turns.
 * Replaces in-memory Map() storage with persistent database storage.
 */

const { newUuid } = require("../utils/ids");

// Default session TTL: 24 hours
const DEFAULT_SESSION_TTL_HOURS = 24;

/**
 * Safely parse JSON with fallback value
 * Prevents crashes from corrupted or malformed JSON in database
 *
 * @param {string|null} str - JSON string to parse
 * @param {*} fallback - Fallback value if parsing fails
 * @returns {*} Parsed value or fallback
 */
function safeJsonParse(str, fallback = null) {
  if (str === null || str === undefined) return fallback;
  if (typeof str !== "string") return str; // Already parsed
  try {
    return JSON.parse(str);
  } catch (err) {
    // Log as error with truncated value for debugging data corruption
    console.error("[StoryRepository] JSON parse FAILED - DATA CORRUPTION:", {
      error: err.message,
      truncatedValue: str.length > 100 ? str.substring(0, 100) + "..." : str,
    });
    return fallback;
  }
}

/**
 * Create a story repository instance
 *
 * @param {Object} db - Database adapter (from sqlite.js)
 * @returns {Object} Repository methods
 */
function createStoryRepository(db) {
  /**
   * Create a new story session
   *
   * @param {string} userId - User ID
   * @param {Object} params - Session parameters
   * @returns {Object} Created session
   */
  async function createSession(userId, params) {
    const id = params.id || newUuid();
    const now = new Date().toISOString();
    const expiresAt = new Date(
      Date.now() + DEFAULT_SESSION_TTL_HOURS * 60 * 60 * 1000
    ).toISOString();

    const elementsJson = JSON.stringify(params.elements || {});
    const pendingAnchorsJson = JSON.stringify(params.pendingAnchors || []);
    const currentQuestionJson = params.currentQuestion
      ? JSON.stringify(params.currentQuestion)
      : null;

    // V2 support: engine version and state
    const engineVersion = params.engineVersion || "v1";
    const v2StateJson = params.v2State ? JSON.stringify(params.v2State) : null;

    await db.prepare(
      `
      INSERT INTO story_sessions (
        id, user_id, status, arc, occasion, recipient_name, style,
        initial_prompt, elements_json, pending_anchors_json,
        current_question_json, question_count,
        engine_version, v2_state_json,
        created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      id,
      userId,
      params.status || "active",
      params.arc,
      params.occasion || null,
      params.recipientName,
      params.style || null,
      params.initialPrompt,
      elementsJson,
      pendingAnchorsJson,
      currentQuestionJson,
      params.questionCount || 0,
      engineVersion,
      v2StateJson,
      now,
      now,
      expiresAt
    );

    return {
      id,
      userId,
      status: params.status || "active",
      arc: params.arc,
      occasion: params.occasion,
      recipientName: params.recipientName,
      style: params.style,
      initialPrompt: params.initialPrompt,
      elements: params.elements || {},
      pendingAnchors: params.pendingAnchors || [],
      currentQuestion: params.currentQuestion || null,
      questionCount: params.questionCount || 0,
      engineVersion,
      v2State: params.v2State || null,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    };
  }

  /**
   * Get a story session by ID
   *
   * @param {string} sessionId - Session ID
   * @returns {Object|null} Session or null if not found
   */
  async function getSession(sessionId) {
    const row = await db
      .prepare(
        `
      SELECT * FROM story_sessions WHERE id = ?
    `
      )
      .get(sessionId);

    if (!row) return null;

    return hydrateSession(row);
  }

  /**
   * Update a story session
   *
   * @param {string} sessionId - Session ID
   * @param {Object} updates - Fields to update
   * @returns {Object|null} Updated session or null if not found
   */
  async function updateSession(sessionId, updates) {
    const now = new Date().toISOString();
    const expiresAt = new Date(
      Date.now() + DEFAULT_SESSION_TTL_HOURS * 60 * 60 * 1000
    ).toISOString();
    const setClauses = ["updated_at = ?"];
    const values = [now];

    if (updates.status !== undefined) {
      setClauses.push("status = ?");
      values.push(updates.status);
    }

    if (updates.elements !== undefined) {
      setClauses.push("elements_json = ?");
      values.push(JSON.stringify(updates.elements));
    }

    if (updates.pendingAnchors !== undefined) {
      setClauses.push("pending_anchors_json = ?");
      values.push(JSON.stringify(updates.pendingAnchors));
    }

    if (updates.currentQuestion !== undefined) {
      setClauses.push("current_question_json = ?");
      values.push(
        updates.currentQuestion ? JSON.stringify(updates.currentQuestion) : null
      );
    }

    if (updates.questionCount !== undefined) {
      setClauses.push("question_count = ?");
      values.push(updates.questionCount);
    }

    if (updates.summary !== undefined) {
      setClauses.push("summary_json = ?");
      values.push(updates.summary ? JSON.stringify(updates.summary) : null);
    }

    if (updates.additionalNotes !== undefined) {
      setClauses.push("additional_notes = ?");
      values.push(updates.additionalNotes);
    }

    if (updates.confirmedAt !== undefined) {
      setClauses.push("confirmed_at = ?");
      values.push(updates.confirmedAt);
    }

    // V2 support
    if (updates.engineVersion !== undefined) {
      setClauses.push("engine_version = ?");
      values.push(updates.engineVersion);
    }

    if (updates.v2State !== undefined) {
      setClauses.push("v2_state_json = ?");
      values.push(updates.v2State ? JSON.stringify(updates.v2State) : null);
    }

    // Extend session TTL on any update
    setClauses.push("expires_at = ?");
    values.push(expiresAt);

    values.push(sessionId);

    const result = await db
      .prepare(
        `
      UPDATE story_sessions
      SET ${setClauses.join(", ")}
      WHERE id = ?
    `
      )
      .run(...values);

    if (result.changes === 0) return null;

    return getSession(sessionId);
  }

  /**
   * Delete a story session
   *
   * @param {string} sessionId - Session ID
   * @returns {boolean} True if deleted
   */
  async function deleteSession(sessionId) {
    const result = await db
      .prepare(
        `
      DELETE FROM story_sessions WHERE id = ?
    `
      )
      .run(sessionId);

    return result.changes > 0;
  }

  /**
   * Add a conversation turn to a session
   *
   * @param {string} sessionId - Session ID
   * @param {Object} turnData - Turn data
   * @returns {Object} Created turn
   */
  async function addTurn(sessionId, turnData) {
    const id = newUuid();
    const now = new Date().toISOString();

    // Get next turn number
    const lastTurn = await db
      .prepare(
        `
      SELECT MAX(turn_number) as max_turn FROM story_turns WHERE session_id = ?
    `
      )
      .get(sessionId);

    const turnNumber = (lastTurn?.max_turn || 0) + 1;

    const extractedSignalsJson = turnData.extractedSignals
      ? JSON.stringify(turnData.extractedSignals)
      : null;

    await db.prepare(
      `
      INSERT INTO story_turns (
        id, session_id, turn_number, question, element_target,
        is_follow_up, anchor_word, answer, extracted_signals_json,
        asked_at, answered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      id,
      sessionId,
      turnNumber,
      turnData.question,
      turnData.elementTarget || null,
      turnData.isFollowUp ? 1 : 0,
      turnData.anchorWord || null,
      turnData.answer || null,
      extractedSignalsJson,
      now,
      turnData.answer ? now : null
    );

    return {
      id,
      sessionId,
      turnNumber,
      question: turnData.question,
      elementTarget: turnData.elementTarget,
      isFollowUp: turnData.isFollowUp || false,
      anchorWord: turnData.anchorWord,
      answer: turnData.answer,
      extractedSignals: turnData.extractedSignals,
      askedAt: now,
      answeredAt: turnData.answer ? now : null,
    };
  }

  /**
   * Update a turn with an answer
   *
   * @param {string} turnId - Turn ID
   * @param {string} answer - User's answer
   * @param {Object} extractedSignals - Extracted signals from the answer
   * @returns {boolean} True if updated
   */
  async function updateTurnAnswer(turnId, answer, extractedSignals = null) {
    const now = new Date().toISOString();
    const extractedSignalsJson = extractedSignals
      ? JSON.stringify(extractedSignals)
      : null;

    const result = await db
      .prepare(
        `
      UPDATE story_turns
      SET answer = ?, extracted_signals_json = ?, answered_at = ?
      WHERE id = ?
    `
      )
      .run(answer, extractedSignalsJson, now, turnId);

    return result.changes > 0;
  }

  /**
   * Get all turns for a session
   *
   * @param {string} sessionId - Session ID
   * @returns {Array} List of turns
   */
  async function getTurns(sessionId) {
    const rows = await db
      .prepare(
        `
      SELECT * FROM story_turns
      WHERE session_id = ?
      ORDER BY turn_number ASC
    `
      )
      .all(sessionId);

    return rows.map(hydrateTurn);
  }

  /**
   * Get the latest unanswered turn for a session
   *
   * @param {string} sessionId - Session ID
   * @returns {Object|null} Latest unanswered turn or null
   */
  async function getLatestUnansweredTurn(sessionId) {
    const row = await db
      .prepare(
        `
      SELECT * FROM story_turns
      WHERE session_id = ? AND answer IS NULL
      ORDER BY turn_number DESC
      LIMIT 1
    `
      )
      .get(sessionId);

    return row ? hydrateTurn(row) : null;
  }

  /**
   * Expire stale sessions
   *
   * @param {number} maxAgeHours - Max age in hours (default: 24)
   * @returns {number} Number of sessions expired
   */
  async function expireStaleSessions(maxAgeHours = DEFAULT_SESSION_TTL_HOURS) {
    const now = new Date().toISOString();
    const cutoff = new Date(
      Date.now() - maxAgeHours * 60 * 60 * 1000
    ).toISOString();

    // Use ISO string for current time to avoid TEXT vs TIMESTAMP comparison in PostgreSQL
    const result = await db
      .prepare(
        `
      UPDATE story_sessions
      SET status = 'expired'
      WHERE status = 'active'
        AND (expires_at < ? OR updated_at < ?)
    `
      )
      .run(now, cutoff);

    return result.changes;
  }

  /**
   * Get active sessions for a user
   *
   * @param {string} userId - User ID
   * @returns {Array} List of active sessions
   */
  async function getActiveSessionsForUser(userId) {
    const rows = await db
      .prepare(
        `
      SELECT * FROM story_sessions
      WHERE user_id = ? AND status = 'active'
      ORDER BY updated_at DESC
    `
      )
      .all(userId);

    return rows.map(hydrateSession);
  }

  /**
   * Hydrate a session row from database format
   * Uses safeJsonParse to prevent crashes from corrupted JSON
   */
  function hydrateSession(row) {
    return {
      id: row.id,
      userId: row.user_id,
      status: row.status,
      arc: row.arc,
      occasion: row.occasion,
      recipientName: row.recipient_name,
      style: row.style,
      initialPrompt: row.initial_prompt,
      elements: safeJsonParse(row.elements_json, {}),
      pendingAnchors: safeJsonParse(row.pending_anchors_json, []),
      currentQuestion: safeJsonParse(row.current_question_json, null),
      questionCount: row.question_count,
      summary: safeJsonParse(row.summary_json, null),
      additionalNotes: row.additional_notes,
      // V2 support
      engineVersion: row.engine_version || "v1",
      v2State: safeJsonParse(row.v2_state_json, null),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      confirmedAt: row.confirmed_at,
      expiresAt: row.expires_at,
    };
  }

  /**
   * Hydrate a turn row from database format
   * Uses safeJsonParse to prevent crashes from corrupted JSON
   */
  function hydrateTurn(row) {
    return {
      id: row.id,
      sessionId: row.session_id,
      turnNumber: row.turn_number,
      question: row.question,
      elementTarget: row.element_target,
      isFollowUp: row.is_follow_up === 1,
      anchorWord: row.anchor_word,
      answer: row.answer,
      extractedSignals: safeJsonParse(row.extracted_signals_json, null),
      askedAt: row.asked_at,
      answeredAt: row.answered_at,
    };
  }

  return {
    createSession,
    getSession,
    updateSession,
    deleteSession,
    addTurn,
    updateTurnAnswer,
    getTurns,
    getLatestUnansweredTurn,
    expireStaleSessions,
    getActiveSessionsForUser,
  };
}

module.exports = { createStoryRepository };
