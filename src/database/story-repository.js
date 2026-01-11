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
  function createSession(userId, params) {
    const id = newUuid();
    const now = new Date().toISOString();
    const expiresAt = new Date(
      Date.now() + DEFAULT_SESSION_TTL_HOURS * 60 * 60 * 1000
    ).toISOString();

    const elementsJson = JSON.stringify(params.elements || {});
    const pendingAnchorsJson = JSON.stringify(params.pendingAnchors || []);
    const currentQuestionJson = params.currentQuestion
      ? JSON.stringify(params.currentQuestion)
      : null;

    db.prepare(
      `
      INSERT INTO story_sessions (
        id, user_id, status, arc, occasion, recipient_name, style,
        initial_prompt, elements_json, pending_anchors_json,
        current_question_json, question_count, created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  function getSession(sessionId) {
    const row = db
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
  function updateSession(sessionId, updates) {
    const now = new Date().toISOString();
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

    values.push(sessionId);

    const result = db
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
  function deleteSession(sessionId) {
    const result = db
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
  function addTurn(sessionId, turnData) {
    const id = newUuid();
    const now = new Date().toISOString();

    // Get next turn number
    const lastTurn = db
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

    db.prepare(
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
  function updateTurnAnswer(turnId, answer, extractedSignals = null) {
    const now = new Date().toISOString();
    const extractedSignalsJson = extractedSignals
      ? JSON.stringify(extractedSignals)
      : null;

    const result = db
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
  function getTurns(sessionId) {
    const rows = db
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
  function getLatestUnansweredTurn(sessionId) {
    const row = db
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
  function expireStaleSessions(maxAgeHours = DEFAULT_SESSION_TTL_HOURS) {
    const cutoff = new Date(
      Date.now() - maxAgeHours * 60 * 60 * 1000
    ).toISOString();

    const result = db
      .prepare(
        `
      UPDATE story_sessions
      SET status = 'expired'
      WHERE status = 'active'
        AND (expires_at < datetime('now') OR updated_at < ?)
    `
      )
      .run(cutoff);

    return result.changes;
  }

  /**
   * Get active sessions for a user
   *
   * @param {string} userId - User ID
   * @returns {Array} List of active sessions
   */
  function getActiveSessionsForUser(userId) {
    const rows = db
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
      elements: JSON.parse(row.elements_json || "{}"),
      pendingAnchors: JSON.parse(row.pending_anchors_json || "[]"),
      currentQuestion: row.current_question_json
        ? JSON.parse(row.current_question_json)
        : null,
      questionCount: row.question_count,
      summary: row.summary_json ? JSON.parse(row.summary_json) : null,
      additionalNotes: row.additional_notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      confirmedAt: row.confirmed_at,
      expiresAt: row.expires_at,
    };
  }

  /**
   * Hydrate a turn row from database format
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
      extractedSignals: row.extracted_signals_json
        ? JSON.parse(row.extracted_signals_json)
        : null,
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
