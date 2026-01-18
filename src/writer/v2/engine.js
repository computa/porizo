/**
 * V2 Engine Core
 *
 * Handles state integration, conversation tracking, and fallback heuristics.
 * This module connects the reasoner output to the state management layer.
 *
 * @module writer/v2/engine
 */

const { DEFAULT_BEATS, getStatusFromStrength } = require("./beats");
const {
  isAppendStyleNarrative,
  composeNarrativeFromFacts,
  hasRecipientAnchor,
  selectAnchorFacts,
  narrativeCoversAnchors,
} = require("./narrative");
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
function applyReasoningResult(state, reasoningResult, _userInput) {
  let newState = { ...state };
  const updates = reasoningResult.updates || {};

  // 1. Update narrative (enforce rewrite, reject append-only updates)
  const nextNarrative = updates.narrative || reasoningResult.narrative;
  let shouldRecompose = false;
  if (nextNarrative) {
    const previousNarrative = state.narrative || "";
    const isAppendStyle = isAppendStyleNarrative(previousNarrative, nextNarrative);

    if (!isAppendStyle) {
      newState = {
        ...newState,
        narrative: nextNarrative,
      };
    } else {
      const existingFeedback = newState._reasoning_feedback || [];
      newState._reasoning_feedback = [
        ...existingFeedback,
        {
          type: "append_style_narrative",
          turn: state.turn_count,
          timestamp: new Date().toISOString(),
        },
      ];
      console.warn("[V2 Engine] Rejecting append-style narrative update");
      shouldRecompose = true;
    }

    const narrativeMode = updates.narrative_mode || reasoningResult.narrative_mode;
    if (narrativeMode && narrativeMode !== "rewritten") {
      const existingFeedback = newState._reasoning_feedback || [];
      newState._reasoning_feedback = [
        ...existingFeedback,
        {
          type: "narrative_mode_mismatch",
          mode: narrativeMode,
          turn: state.turn_count,
          timestamp: new Date().toISOString(),
        },
      ];
      shouldRecompose = true;
    }
  }

  // 2. Add new facts from reasoning
  const newFactsInput = updates.new_facts || reasoningResult.reasoning?.new_facts;
  if (newFactsInput) {
    // Defensive: filter to only facts with valid text strings
    const existingFactTexts = new Set(
      (state.facts || [])
        .filter(f => f && typeof f.text === "string")
        .map(f => f.text.toLowerCase().trim())
    );

    // Filter existing facts to ensure valid structure
    const newFacts = (state.facts || []).filter(f => f && typeof f.text === "string");
    for (const fact of newFactsInput) {
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

  if (shouldRecompose) {
    const recomposed = composeNarrativeFromFacts(newState);
    if (recomposed) {
      newState = {
        ...newState,
        narrative: recomposed,
      };
    }
  }

  // If no narrative provided but we have facts, compose a narrative
  if (!newState.narrative && (newState.facts || []).length > 0) {
    const recomposed = composeNarrativeFromFacts(newState);
    if (recomposed) {
      newState = {
        ...newState,
        narrative: recomposed,
      };
    }
  }

  if (newState.narrative && !hasRecipientAnchor(newState.narrative, newState.recipient_name)) {
    const existingFeedback = newState._reasoning_feedback || [];
    newState._reasoning_feedback = [
      ...existingFeedback,
      {
        type: "missing_recipient_anchor",
        turn: state.turn_count,
        timestamp: new Date().toISOString(),
      },
    ];
    const recomposed = composeNarrativeFromFacts(newState);
    if (recomposed) {
      newState = {
        ...newState,
        narrative: recomposed,
      };
    }
  }

  if (newState.narrative) {
    const anchors = selectAnchorFacts(newState.facts || [], 3);
    const minCoverage = Math.min(2, anchors.length);
    if (anchors.length > 0 && !narrativeCoversAnchors(newState.narrative, anchors, minCoverage)) {
      const existingFeedback = newState._reasoning_feedback || [];
      newState._reasoning_feedback = [
        ...existingFeedback,
        {
          type: "missing_anchor_facts",
          anchors,
          turn: state.turn_count,
          timestamp: new Date().toISOString(),
        },
      ];
      const recomposed = composeNarrativeFromFacts(newState);
      if (recomposed) {
        newState = {
          ...newState,
          narrative: recomposed,
        };
      }
    }
  }

  // 3. Update beats from reasoning result (LLM-provided full schema)
  const beatsInput = updates.beats || reasoningResult.beats;
  if (beatsInput && Array.isArray(beatsInput)) {
    const { beats: reconciledBeats, invalidEvidence } = reconcileBeats(state.beats || [], beatsInput, newState.facts);
    newState = {
      ...newState,
      beats: reconciledBeats,
    };

    // Track invalid evidence for monitoring (feedback loop)
    if (invalidEvidence && invalidEvidence.length > 0) {
      const existingFeedback = newState._reasoning_feedback || [];
      newState._reasoning_feedback = [
        ...existingFeedback,
        {
          type: "invalid_evidence",
          items: invalidEvidence,
          turn: state.turn_count,
          timestamp: new Date().toISOString(),
        },
      ];
      console.warn(`[V2 Engine] Filtered ${invalidEvidence.length} invalid evidence IDs:`,
        invalidEvidence.map(e => `${e.beat}:${e.evidence_id}`).join(", "));
    }
  } else if (!newState.beats || newState.beats.length === 0) {
    // Emergency fallback if no beats exist
    const fallbackResult = normalizeBeatsFromLLM(null, state.beats || [], newState.facts);
    newState = {
      ...newState,
      beats: fallbackResult.beats,
    };
  }

  // 4. Update user model from LLM's user_state assessment
  const userState = reasoningResult.reasoning?.user_state;
  if (userState) {
    const currentUserModel = state.user_model || {};
    const updatedUserModel = { ...currentUserModel };

    // Extract style from LLM reasoning (brief|verbose|emotional|analytical|unknown)
    const validStyles = ["brief", "verbose", "emotional", "analytical", "unknown"];
    if (userState.style && validStyles.includes(userState.style)) {
      updatedUserModel.style = userState.style;
    }

    // Map tone to tone_preference if provided
    if (userState.tone && typeof userState.tone === "string") {
      updatedUserModel.tone_preference = userState.tone;
    }

    // Increment fatigue_signals for low engagement or brief style with short answers
    if (userState.engagement === "low" ||
        (userState.style === "brief" && userState.seems_done)) {
      updatedUserModel.fatigue_signals = (currentUserModel.fatigue_signals || 0) + 1;
    }

    newState = {
      ...newState,
      user_model: updatedUserModel,
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
  const eventUpdate = updates.event || reasoningResult.event;
  if (eventUpdate &&
      typeof eventUpdate.confidence === "number" &&
      eventUpdate.confidence >= EVENT_CONFIDENCE_THRESHOLD) {
    newState = {
      ...newState,
      event: {
        ...newState.event,
        type: eventUpdate.type,
        title: eventUpdate.title,
        inferred_confidence: eventUpdate.confidence,
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
 * Delegates to generateSmartHeuristicFallback with llm_unavailable marker.
 *
 * @param {Object} state - Current V2 state
 * @returns {Object} Fallback response with action and question/confirmation
 */
function generateFallbackResponse(state) {
  return {
    ...generateSmartHeuristicFallback(state, null),
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
 * Find a relevant fact for contextual question generation
 *
 * Looks for a fact that relates to the target beat, prioritizing
 * shorter facts that work well in conversational framing.
 *
 * @param {Array} facts - Array of fact objects
 * @param {string|null} beatId - Target beat ID to find relevant facts for
 * @returns {Object|null} Relevant fact or null if none found
 */
function findRelevantFact(facts, beatId) {
  if (!facts || facts.length === 0) return null;

  // If we have a target beat, look for facts associated with it
  if (beatId) {
    const beatFacts = facts.filter(f => f.beat === beatId);
    if (beatFacts.length > 0) {
      // Prefer shorter facts (easier to quote in a question)
      beatFacts.sort((a, b) => (a.text?.length || 0) - (b.text?.length || 0));
      // Return shortest fact if it's reasonable length (< 100 chars)
      if (beatFacts[0].text?.length < 100) {
        return beatFacts[0];
      }
    }
  }

  // Fallback: find any short, quotable fact
  const shortFacts = facts
    .filter(f => f.text && f.text.length > 10 && f.text.length < 60)
    .slice(-3); // Get most recent short facts

  if (shortFacts.length > 0) {
    return shortFacts[shortFacts.length - 1]; // Return most recent
  }

  return null;
}

/**
 * Generate smart heuristic fallback response
 *
 * Uses graduated richness scoring and LLM's user_state.seems_done when available.
 *
 * @param {Object} state - V2 story state
 * @param {Object|null} llmReasoning - Optional LLM reasoning with user_state.seems_done
 * @returns {Object} Response with action, question/confirmation, heuristic_score, and metadata
 */
function generateSmartHeuristicFallback(state, llmReasoning = null) {
  const factCount = state.facts?.length || 0;
  const narrativeLength = state.narrative?.length || 0;
  const turnCount = state.turn_count || 0;
  const fallbackNarrative = state.narrative || composeNarrativeFromFacts(state) || "";
  // Backward compatible: check both strength (v3) and status (v2)
  const beatsCovered = (state.beats || []).filter(b =>
    (typeof b.strength === "number" ? b.strength >= 0.5 : false) || b.status === "covered"
  ).length;
  const beatsTotal = (state.beats || []).length;

  // Calculate graduated richness score (0-1 scale, transparent)
  // This replaces magic number thresholds with a visible gradient
  const richnessScore = calculateRichnessScore({
    facts: factCount,
    narrativeChars: narrativeLength,
    beatsCovered,
    beatsTotal,
  });

  // Log fallback activation for monitoring
  console.warn("[V2 Engine] SMART HEURISTIC TRIGGERED");
  console.warn(`[V2 Engine] State: turns=${turnCount}, facts=${factCount}, narrative_len=${narrativeLength}, richness_score=${richnessScore.toFixed(2)}`);

  // Decision 1: LLM explicitly says user is done AND we have content → CONFIRM
  // This trusts the LLM's semantic understanding over keyword matching
  if (llmReasoning?.user_state?.seems_done === true && factCount >= 2) {
    return {
      action: "CONFIRM",
      confirmation: `I've captured ${factCount} details about ${state.recipient_name || "your story"}. Ready to create your song?`,
      narrative: fallbackNarrative,
      fallback: true,
      tier: "heuristic",
      reason: "LLM detected user is done",
      heuristic_score: richnessScore,
    };
  }

  // Decision 2: High richness score OR high turns → CONFIRM
  // This is content-based, not keyword-based
  if (richnessScore >= 0.6 || turnCount >= 10) {
    return {
      action: "CONFIRM",
      confirmation: buildConfirmationMessage(state),
      narrative: fallbackNarrative,
      fallback: true,
      tier: "heuristic",
      reason: richnessScore >= 0.6 ? "high_richness_score" : "high_turn_count",
      heuristic_score: richnessScore,
    };
  }

  // Otherwise: ASK a contextual question
  const keywords = extractKeywords(state.narrative || "");
  const weakBeat = (state.beats || [])
    .filter(b => (typeof b.strength === "number" ? b.strength < 0.5 : b.status !== "covered"))
    .filter(b => b.required !== false)[0];

  // Get user style for question adaptation
  const userStyle = state.user_model?.style || "unknown";

  // Find relevant fact for richer context
  const relevantFact = findRelevantFact(state.facts, weakBeat?.id);

  let question;

  // Build contextual question - adapted to user style
  // Phase 3: Enhanced contextuality with "I noticed you mentioned..." framing
  if (weakBeat && keywords.length > 0) {
    // Reference both narrative content and weak beat purpose
    if (userStyle === "brief") {
      // Shorter question for brief users
      question = `More about ${keywords[0]}?`;
    } else if (userStyle === "emotional") {
      // Emotion-focused for emotional users
      question = `What does ${keywords[0]} make you feel, especially about ${weakBeat.purpose || "this"}?`;
    } else if (userStyle === "analytical") {
      // Fact-focused for analytical users
      question = `I noticed you mentioned ${keywords[0]}. Can you walk me through how that connects to ${weakBeat.purpose || "the story"}?`;
    } else {
      // Standard question with contextual framing
      if (relevantFact) {
        // Reference a specific fact for richer context
        question = `You mentioned that ${relevantFact.text}. Can you tell me more about ${weakBeat.purpose || keywords[0]}?`;
      } else if (keywords.length >= 2) {
        // Use multiple keywords for richer reference
        question = `I noticed you mentioned ${keywords[0]} and ${keywords[1]}. What does ${weakBeat.purpose || "this"} mean to you?`;
      } else {
        question = `I noticed you mentioned ${keywords[0]}. What does that mean to you, especially regarding ${weakBeat.purpose || "this"}?`;
      }
    }
  } else if (weakBeat && weakBeat.purpose) {
    // Reference beat purpose with recipient
    if (userStyle === "brief") {
      question = `About ${weakBeat.purpose}?`;
    } else if (userStyle === "emotional") {
      question = `How does ${weakBeat.purpose} with ${state.recipient_name || "them"} make you feel?`;
    } else if (userStyle === "analytical") {
      question = `Can you describe ${weakBeat.purpose} with ${state.recipient_name || "them"} in more detail?`;
    } else {
      question = `Tell me about ${weakBeat.purpose} with ${state.recipient_name || "them"}.`;
    }
  } else if (keywords.length > 0) {
    // Reference narrative content with enhanced framing
    if (userStyle === "brief") {
      question = `More about ${keywords[0]}?`;
    } else if (keywords.length >= 2) {
      question = `I noticed you mentioned ${keywords[0]} and ${keywords[1]}. Can you tell me more about that?`;
    } else {
      question = `I noticed you mentioned ${keywords[0]}. Can you tell me more about that?`;
    }
  } else if (state.recipient_name) {
    // Fallback to recipient-based question
    if (userStyle === "emotional") {
      question = `What feelings come up when you think of ${state.recipient_name}?`;
    } else {
      question = `What makes ${state.recipient_name} special to you?`;
    }
  } else {
    // Generic fallback
    question = "Tell me more about what makes this story special.";
  }

  return {
    action: "ASK",
    question,
    targetBeat: weakBeat?.id,
    narrative: fallbackNarrative,
    fallback: true,
    tier: "heuristic",
    reason: "need_more_content",
    heuristic_score: richnessScore,
  };
}

/**
 * Calculate graduated richness score
 *
 * Transparent scoring that replaces magic number thresholds.
 * Each component contributes to a 0-1 scale.
 *
 * @param {Object} metrics - Content metrics
 * @returns {number} Score from 0 to 1
 */
function calculateRichnessScore(metrics) {
  const { facts, narrativeChars, beatsCovered, beatsTotal } = metrics;

  // Component contributions (weights sum to ~1.0)
  // - Facts: 5 facts = full contribution (0.3)
  // - Narrative: 200 chars = full contribution (0.3)
  // - Beats: all covered = full contribution (0.4)
  const factContribution = Math.min(facts / 5, 1) * 0.3;
  const narrativeContribution = Math.min(narrativeChars / 200, 1) * 0.3;
  const beatContribution = beatsTotal > 0
    ? (beatsCovered / beatsTotal) * 0.4
    : 0;

  const raw = factContribution + narrativeContribution + beatContribution;

  // Clamp to 0-1
  return Math.min(1, Math.max(0, raw));
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
  const groundedNarrative = composeNarrativeFromFacts(state);

  return {
    ...state,
    narrative: groundedNarrative,
    grounding_enforced: true,
    grounding_issue: groundedNarrative ? "ungrounded_narrative" : "no_facts",
    updated_at: new Date().toISOString(),
  };
}

/**
 * Reconcile LLM's beat assessment with actual facts
 *
 * Validates that beat evidence references exist in the facts list.
 * Tracks invalid evidence IDs for monitoring and feedback.
 *
 * @param {Array} existingBeats - Current beats with metadata
 * @param {Array} llmBeats - LLM's updated beat assessments
 * @param {Array} facts - Collected facts
 * @returns {{beats: Array, invalidEvidence: Array}} Reconciled beats and invalid evidence
 */
function reconcileBeats(existingBeats, llmBeats, facts) {
  return normalizeBeatsFromLLM(llmBeats, existingBeats, facts);
}

function normalizeBeatId(id) {
  if (!id || typeof id !== "string") return "";
  return id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeBeatsFromLLM(llmBeats, existingBeats, facts) {
  const fallbackBeats = buildFallbackBeats(existingBeats);

  if (!llmBeats || !Array.isArray(llmBeats) || llmBeats.length === 0) {
    return { beats: fallbackBeats, invalidEvidence: [] };
  }

  const factIds = new Set((facts || []).map(f => f.id));
  const normalized = [];
  const invalidEvidence = [];
  const seen = new Set();

  for (const beat of llmBeats) {
    if (!beat || typeof beat !== "object") continue;

    const id = normalizeBeatId(beat.id);
    const purpose = typeof beat.purpose === "string" ? beat.purpose.trim() : "";

    if (!id || !purpose || seen.has(id)) {
      continue;
    }

    const required = typeof beat.required === "boolean" ? beat.required : true;
    const strength = typeof beat.strength === "number"
      ? Math.max(0, Math.min(1, beat.strength))
      : (beat.status ? strengthFromStatus(beat.status) : 0);

    // Track valid and invalid evidence separately
    const validEvidence = [];
    if (Array.isArray(beat.evidence)) {
      for (const factId of beat.evidence) {
        if (factIds.has(factId)) {
          validEvidence.push(factId);
        } else {
          invalidEvidence.push({ beat: id, evidence_id: factId });
        }
      }
    }
    const evidence = validEvidence;

    normalized.push({
      id,
      purpose,
      required,
      strength,
      status: getStatusFromStrength(strength),
      evidence,
    });
    seen.add(id);
  }

  return {
    beats: normalized.length > 0 ? normalized : fallbackBeats,
    invalidEvidence,
  };
}

function buildFallbackBeats(existingBeats) {
  if (existingBeats && existingBeats.length > 0) {
    return existingBeats;
  }

  return DEFAULT_BEATS.map(beat => ({
    ...beat,
    strength: 0,
    status: "missing",
    evidence: [],
  }));
}

function strengthFromStatus(status) {
  if (status === "covered") return 1;
  if (status === "weak") return 0.5;
  return 0;
}

module.exports = {
  applyReasoningResult,
  addTurnToState,
  generateFallbackResponse,
  generateSmartHeuristicFallback,
  enforceGrounding,
  reconcileBeats,
  saveStateToSession,
  loadStateFromSession,
};
