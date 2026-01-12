/**
 * V2 Engine Core
 *
 * Handles state integration, conversation tracking, and fallback heuristics.
 * This module connects the reasoner output to the state management layer.
 *
 * @module writer/v2/engine
 */

const { getNextBeatToAsk, shouldConfirm } = require("./quality");
const { isStateGrounded } = require("./state");

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

  // 3. Update beats from reasoning result (reconcile with facts to validate evidence)
  if (reasoningResult.beats && Array.isArray(reasoningResult.beats)) {
    newState = {
      ...newState,
      beats: reconcileBeats(state.beats || [], reasoningResult.beats, newState.facts),
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

  // 7. Apply inferred event if confidence exceeds threshold
  // This allows the LLM to correct/refine the event type based on story content
  const EVENT_CONFIDENCE_THRESHOLD = 0.7;
  if (reasoningResult.event &&
      typeof reasoningResult.event.confidence === "number" &&
      reasoningResult.event.confidence >= EVENT_CONFIDENCE_THRESHOLD) {
    newState = {
      ...newState,
      event: {
        ...newState.event,
        type: reasoningResult.event.type,
        title: reasoningResult.event.title,
        inferred_confidence: reasoningResult.event.confidence,
        // Preserve original occasion - this is user intent
      },
    };
  }

  // 8. Update timestamp
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

/**
 * Enforce that narrative is grounded in facts
 *
 * If narrative contains ungrounded content, rebuild from facts.
 * This prevents LLM hallucination from leaking into the story.
 *
 * @param {Object} state - V2 state
 * @returns {Object} State with grounded narrative
 */
function enforceGrounding(state) {
  // If already grounded, return unchanged
  if (isStateGrounded(state)) {
    return state;
  }

  console.warn("[V2 Engine] Narrative contains ungrounded content, rebuilding from facts");

  // Rebuild narrative from facts only (filter invalid facts defensively)
  const validFacts = (state.facts || []).filter(f => f && typeof f.text === "string");
  const factTexts = validFacts.map(f => f.text);
  const groundedNarrative = factTexts.length > 0
    ? factTexts.join(" ")
    : state.narrative || ""; // Preserve if no facts yet

  return {
    ...state,
    narrative: groundedNarrative,
    grounding_enforced: true,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Reconcile LLM's beat assessment with actual facts
 *
 * Validates that beat evidence references exist in the facts list.
 * Demotes beats to "weak" if evidence is thin, or "missing" if invalid.
 *
 * @param {Array} existingBeats - Current beats with metadata
 * @param {Array} llmBeats - LLM's updated beat assessments
 * @param {Array} facts - Collected facts
 * @returns {Array} Reconciled beats with validated evidence
 */
function reconcileBeats(existingBeats, llmBeats, facts) {
  const factIds = new Set((facts || []).map(f => f.id));
  const factById = new Map((facts || []).map(f => [f.id, f]));

  return llmBeats.map(llmBeat => {
    // Find matching existing beat to preserve metadata
    const existing = existingBeats.find(b => b.id === llmBeat.id) || {};

    // Validate evidence references - filter to only IDs that exist in facts
    const validEvidence = (llmBeat.evidence || []).filter(factId =>
      factIds.has(factId)
    );

    // Determine status based on validated evidence
    let status = llmBeat.status;

    if (status === "covered") {
      if (validEvidence.length === 0) {
        // LLM said covered but no valid evidence
        console.warn(`[V2 Engine] Beat ${llmBeat.id} marked covered but has no valid evidence`);
        status = "missing";
      } else {
        // Check if evidence is substantial (total text length >= 20 chars)
        const evidenceTexts = validEvidence.map(id => factById.get(id)?.text || "");
        const totalLength = evidenceTexts.join(" ").length;
        if (totalLength < 20) {
          status = "weak"; // Demote to weak if evidence is thin
        }
      }
    }

    return {
      // Preserve metadata from existing beat (required, purpose, etc.)
      ...existing,
      // Apply LLM updates
      ...llmBeat,
      // Override with validated values
      evidence: validEvidence,
      status,
    };
  });
}

module.exports = {
  applyReasoningResult,
  addTurnToState,
  generateFallbackResponse,
  enforceGrounding,
  reconcileBeats,
  saveStateToSession,
  loadStateFromSession,
};
