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
 * Uses heuristics and context to decide what to ask next:
 * - Uses narrative/facts context to make questions relevant
 * - Respects fatigue signals to confirm early
 * - Includes fact count in confirmation messages
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
      confirmation: buildConfirmationMessage(state),
      fallback: true,
      fallback_reason: "llm_unavailable",
    };
  }

  // Find next beat to ask about
  const nextBeat = getNextBeatToAsk(state);

  // Generate context-aware question
  const question = buildContextualQuestion(state, nextBeat);

  return {
    action: "ASK",
    question,
    targetBeat: nextBeat?.id,
    fallback: true,
    fallback_reason: "llm_unavailable",
  };
}

/**
 * Build a confirmation message that references collected content
 *
 * @param {Object} state - V2 state
 * @returns {string} Confirmation message
 */
function buildConfirmationMessage(state) {
  const factCount = state.facts?.length || 0;
  if (factCount === 0) {
    return "I have a basic sense of your story. Should I work with what we have?";
  }
  return `I've captured ${factCount} details about your story. Does this feel complete, or is there more you'd like to add?`;
}

/**
 * Build a context-aware question using narrative and facts
 *
 * @param {Object} state - V2 state
 * @param {Object|null} beat - Target beat (optional)
 * @returns {string} Contextual question
 */
function buildContextualQuestion(state, beat) {
  const narrative = state.narrative || "";
  const keywords = extractKeywords(narrative);
  const keyword = keywords[0] || "this";

  // If no specific beat, ask to expand on what we have
  if (!beat) {
    if (narrative && keywords.length > 0) {
      return `You mentioned ${keyword}. Can you tell me more about what that means to you?`;
    }
    return "Tell me more about what makes this story special.";
  }

  // Build question referencing context + beat purpose
  const templates = {
    meaning: keywords.length > 0
      ? `What does ${keyword} mean to you now?`
      : "What does this person or moment mean to you?",
    turning_point: keywords.length > 0
      ? `Was there a specific moment when ${keyword} felt different or changed everything?`
      : "What was the pivotal moment in this story?",
    scene: keywords.length > 0
      ? `Where were you when ${keyword} happened?`
      : "Where and when did this happen?",
    stakes: keywords.length > 0
      ? `What was at risk with ${keyword}?`
      : "What was at risk or what made this so important?",
    character: keywords.length > 0
      ? `What makes them special, especially when it comes to ${keyword}?`
      : "What makes them unique or special?",
    memory: keywords.length > 0
      ? `What's a favorite memory you have about ${keyword}?`
      : "What's a favorite memory you have together?",
  };

  return templates[beat.id] || `Tell me more about ${beat.purpose || keyword}.`;
}

/**
 * Extract keywords from text for context
 *
 * @param {string} text - Text to extract keywords from
 * @returns {string[]} List of significant keywords
 */
function extractKeywords(text) {
  // Defensive: handle non-string input
  if (!text || typeof text !== "string") {
    return [];
  }

  // Common stop words to filter out
  const stopWords = new Set([
    "the", "a", "an", "is", "was", "were", "been", "be", "have", "has", "had",
    "do", "does", "did", "will", "would", "could", "should", "may", "might",
    "must", "shall", "can", "to", "of", "in", "for", "on", "with", "at", "by",
    "from", "as", "into", "through", "during", "before", "after", "above",
    "below", "between", "under", "again", "further", "then", "once", "here",
    "there", "when", "where", "why", "how", "all", "each", "few", "more",
    "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same",
    "so", "than", "too", "very", "just", "and", "but", "if", "or", "because",
    "until", "while", "that", "which", "who", "whom", "this", "these", "those",
    "am", "are", "it", "its", "he", "she", "they", "them", "his", "her",
    "their", "my", "me", "i", "you", "your", "we", "us", "our",
  ]);

  const words = text.toLowerCase()
    .replace(/[.,!?;:'"]/g, "")
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));

  return [...new Set(words)].slice(0, 3);
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
  // Handle null/undefined inputs
  if (!llmBeats) {
    return null;
  }

  const factIds = new Set((facts || []).map(f => f.id));

  return llmBeats.map(llmBeat => {
    // Find matching existing beat to preserve metadata
    const existing = (existingBeats || []).find(b => b.id === llmBeat.id) || {};

    // Validate evidence references - filter to only IDs that exist in facts
    const originalEvidence = llmBeat.evidence || [];
    const validEvidence = originalEvidence.filter(factId =>
      factIds.has(factId)
    );

    // Log if evidence was filtered
    const filteredOut = originalEvidence.filter(id => !factIds.has(id));
    if (filteredOut.length > 0) {
      console.warn(`[V2 Engine] Beat ${llmBeat.id}: filtered invalid evidence IDs: ${filteredOut.join(", ")}`);
    }

    // V3: Trust LLM's assessment - no char-count overrides
    // Only validate structural integrity (evidence IDs exist)
    // LLM's strength/status is trusted as-is

    return {
      // Preserve metadata from existing beat (required, purpose, etc.)
      ...existing,
      // Apply LLM updates (strength, status, evidence, etc.)
      ...llmBeat,
      // Override with validated evidence (structural check only)
      evidence: validEvidence,
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
