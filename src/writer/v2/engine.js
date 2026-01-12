/**
 * V2 Engine Core
 *
 * Handles state integration, conversation tracking, and fallback heuristics.
 * This module connects the reasoner output to the state management layer.
 *
 * @module writer/v2/engine
 */

const { getNextBeatToAsk, shouldConfirm } = require("./quality");

/**
 * Apply reasoning result to state (immutable)
 *
 * Takes the LLM reasoning output and updates state accordingly:
 * - Updates narrative
 * - Adds new facts with audit trail
 * - Updates beat statuses
 * - Updates user model
 * - Stores reasoning trace
 *
 * @param {Object} state - Current V2 state
 * @param {Object} reasoningResult - Parsed reasoning response from LLM
 * @param {string} userInput - Original user input (for source tracking)
 * @returns {Object} Updated state (new object, original unchanged)
 */
function applyReasoningResult(state, reasoningResult, userInput) {
  let newState = { ...state };

  // 1. Update narrative
  if (reasoningResult.narrative) {
    newState = {
      ...newState,
      narrative: reasoningResult.narrative,
    };
  }

  // 2. Add new facts from reasoning
  if (reasoningResult.reasoning?.new_facts) {
    // Defensive: filter to only facts with valid text strings
    const existingFactTexts = new Set(
      (state.facts || [])
        .filter(f => f && typeof f.text === "string")
        .map(f => f.text.toLowerCase().trim())
    );

    // Filter existing facts to ensure valid structure
    const newFacts = (state.facts || []).filter(f => f && typeof f.text === "string");
    for (const fact of reasoningResult.reasoning.new_facts) {
      // Skip facts without valid text
      if (!fact || typeof fact.text !== "string") {
        console.warn("[V2 Engine] Skipping invalid fact:", JSON.stringify(fact));
        continue;
      }
      const normalizedText = fact.text.toLowerCase().trim();
      if (!existingFactTexts.has(normalizedText)) {
        newFacts.push({
          id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          text: fact.text,
          beat: fact.beat,
          source_turn: state.turn_count + 1,
        });
        existingFactTexts.add(normalizedText);
      }
    }
    newState = { ...newState, facts: newFacts };
  }

  // 3. Update beats from reasoning result (deep clone to prevent mutation)
  if (reasoningResult.beats && Array.isArray(reasoningResult.beats)) {
    newState = {
      ...newState,
      beats: reasoningResult.beats.map(b => ({
        ...b,
        evidence: b.evidence ? [...b.evidence] : [],
      })),
    };
  }

  // 4. Update user model
  if (reasoningResult.user_model) {
    newState = {
      ...newState,
      user_model: {
        ...state.user_model,
        ...reasoningResult.user_model,
      },
    };
  }

  // 5. Store reasoning trace for debugging
  if (reasoningResult.reasoning) {
    newState = {
      ...newState,
      last_reasoning: reasoningResult.reasoning,
    };
  }

  // 6. Update status based on action
  if (reasoningResult.action === "CONFIRM") {
    newState = { ...newState, status: "ready_for_confirm" };
  } else if (reasoningResult.action === "STOP") {
    newState = { ...newState, status: "abandoned" };
  }

  // 7. Update timestamp
  newState = {
    ...newState,
    updated_at: new Date().toISOString(),
  };

  return newState;
}

/**
 * Add a conversation turn to state (immutable)
 *
 * Tracks conversation history for context in future reasoning.
 * Only increments turn_count for user messages.
 *
 * @param {Object} state - Current V2 state
 * @param {string} role - "user" or "assistant"
 * @param {string} content - Message content
 * @returns {Object} Updated state
 * @throws {Error} If role is not "user" or "assistant"
 */
function addTurnToState(state, role, content) {
  if (!["user", "assistant"].includes(role)) {
    throw new Error(`[V2 Engine] Invalid conversation role: ${role} - must be 'user' or 'assistant'`);
  }

  const newTurn = {
    role,
    content,
    timestamp: new Date().toISOString(),
  };

  return {
    ...state,
    conversation: [...(state.conversation || []), newTurn],
    turn_count: role === "user" ? (state.turn_count || 0) + 1 : (state.turn_count || 0),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Generate fallback response when LLM is unavailable
 *
 * Uses heuristics to decide what to ask next:
 * - Checks beat coverage to find missing required beats
 * - Respects fatigue signals to confirm early
 * - Provides generic but useful questions
 *
 * @param {Object} state - Current V2 state
 * @returns {Object} Fallback response with action and question/confirmation
 */
function generateFallbackResponse(state) {
  // Log fallback activation for monitoring
  const coveredBeats = state.beats?.filter(b => b.status === "covered").length || 0;
  console.warn("[V2 Engine] FALLBACK TRIGGERED - LLM unavailable, using heuristic response");
  console.warn("[V2 Engine] State: turn_count=%d, beats_covered=%d", state.turn_count || 0, coveredBeats);

  // Check if we should confirm
  if (shouldConfirm(state)) {
    return {
      action: "CONFIRM",
      confirmation: "I think I have a good sense of your story. Does this capture what you want to share?",
      fallback: true,
      fallback_reason: "llm_unavailable",
    };
  }

  // Find next beat to ask about
  const nextBeat = getNextBeatToAsk(state);

  // Generate question based on next beat
  if (nextBeat) {
    const questions = {
      // Story structure beats
      turning_point: "What was the pivotal moment in this story?",
      moment: "Can you describe a specific moment that stands out?",
      birth_moment: "What was it like when you first met them?",
      falling: "When did you realize how much they meant to you?",

      // Meaning beats
      meaning: "What does this person or moment mean to you?",

      // Scene beats
      scene: "Where and when did this happen?",
      meeting: "How did you two first meet?",
      discovery: "How did you find out?",
      who: "Tell me about who this person is to you.",

      // Stakes beats
      stakes: "What was at risk or what made this so important?",
      scare: "Was there a moment of fear or uncertainty?",
      struggle: "What challenges did you face?",

      // Character beats
      character: "What makes them unique or special?",
      memory: "What's a favorite memory you have together?",
    };

    const question = questions[nextBeat.id] ||
      `Tell me more about ${nextBeat.purpose || "your story"}.`;

    return {
      action: "ASK",
      question,
      targetBeat: nextBeat.id,
      fallback: true,
      fallback_reason: "llm_unavailable",
    };
  }

  // Default fallback
  return {
    action: "ASK",
    question: "Tell me more about what makes this story special to you.",
    fallback: true,
    fallback_reason: "llm_unavailable",
  };
}

/**
 * Serialize state for database storage
 *
 * @param {Object} state - V2 state to serialize
 * @returns {string} JSON string
 */
function saveStateToSession(state) {
  return JSON.stringify(state);
}

/**
 * Deserialize state from database storage
 *
 * @param {string} json - JSON string from database
 * @returns {Object|null} V2 state object, or null if invalid
 */
function loadStateFromSession(json) {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch (err) {
    console.error("[V2 Engine] Failed to parse session state:", err.message);
    console.error("[V2 Engine] Corrupted JSON (first 200 chars):", json.substring(0, 200));
    return null;
  }
}

module.exports = {
  applyReasoningResult,
  addTurnToState,
  generateFallbackResponse,
  saveStateToSession,
  loadStateFromSession,
};
