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
  hasFirstPersonVoice,
  selectAnchorFacts,
  narrativeCoversAnchors,
} = require("./narrative");
const { isStateGrounded, createFactId } = require("./state");

function normalizeTextValue(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed;
}

function tokenizeSignificant(text) {
  return normalizeTextValue(text)
    .toLowerCase()
    .replace(/[.,!?;:'"]/g, "")
    .split(/\s+/)
    .filter(token => token.length >= 4);
}

function buildSupportTexts(state, userInput) {
  const supportTexts = [];
  if (typeof userInput === "string" && userInput.trim()) {
    supportTexts.push(userInput);
  }
  for (const fact of state.facts || []) {
    if (fact && typeof fact.text === "string") {
      supportTexts.push(fact.text);
    }
  }
  return supportTexts;
}

function isSupportedValue(value, supportTexts) {
  const candidate = normalizeTextValue(value);
  if (!candidate) return false;

  const lower = candidate.toLowerCase();
  if (supportTexts.some(text => text.toLowerCase().includes(lower))) {
    return true;
  }

  const tokens = tokenizeSignificant(candidate);
  if (tokens.length === 0) return false;

  const supportTokenSet = new Set();
  for (const text of supportTexts) {
    for (const token of tokenizeSignificant(text)) {
      supportTokenSet.add(token);
    }
  }

  const overlap = tokens.filter(token => supportTokenSet.has(token)).length;
  const requiredOverlap = tokens.length <= 2 ? 1 : 2;
  return overlap >= requiredOverlap;
}

function mergeAtoms(existing, incoming, supportTexts) {
  if (!incoming || typeof incoming !== "object") return existing;
  const next = { ...(existing || {}) };

  for (const [key, value] of Object.entries(incoming)) {
    const normalized = normalizeTextValue(value);
    if (!normalized) continue;
    if (!isSupportedValue(normalized, supportTexts)) continue;
    next[key] = normalized;
  }

  return next;
}

function mergeMotifs(existing, incoming, supportTexts) {
  const next = Array.isArray(existing) ? [...existing] : [];
  if (!Array.isArray(incoming)) return next;

  for (const motif of incoming) {
    const normalized = normalizeTextValue(motif);
    if (!normalized) continue;
    if (!isSupportedValue(normalized, supportTexts)) continue;
    if (!next.some(item => item.toLowerCase() === normalized.toLowerCase())) {
      next.push(normalized);
    }
  }
  return next;
}

function mergeDials(existing, incoming) {
  if (!incoming || typeof incoming !== "object") return existing;
  const next = { ...(existing || {}) };
  for (const [key, value] of Object.entries(incoming)) {
    const normalized = normalizeTextValue(value);
    if (!normalized) continue;
    next[key] = normalized;
  }
  return next;
}

function mergePrimitives(existing, incoming, supportTexts) {
  if (!incoming || typeof incoming !== "object") return existing;
  const next = JSON.parse(JSON.stringify(existing || {}));

  if (Array.isArray(incoming.characters)) {
    const existingChars = Array.isArray(next.characters) ? next.characters : [];
    const merged = [...existingChars];
    for (const character of incoming.characters) {
      if (!character || typeof character !== "object") continue;
      const name = normalizeTextValue(character.name || character.role || "");
      if (!name) continue;
      if (!isSupportedValue(name, supportTexts)) continue;
      const entry = {
        name: normalizeTextValue(character.name || ""),
        role: normalizeTextValue(character.role || ""),
        desire: normalizeTextValue(character.desire || ""),
        fear: normalizeTextValue(character.fear || ""),
        flaw: normalizeTextValue(character.flaw || ""),
      };
      const already = merged.some(item =>
        (item.name && entry.name && item.name.toLowerCase() === entry.name.toLowerCase()) ||
        (item.role && entry.role && item.role.toLowerCase() === entry.role.toLowerCase())
      );
      if (!already) merged.push(entry);
    }
    next.characters = merged;
  }

  if (incoming.setting && typeof incoming.setting === "object") {
    next.setting = next.setting || {};
    const place = normalizeTextValue(incoming.setting.place);
    if (place && isSupportedValue(place, supportTexts)) next.setting.place = place;
    const time = normalizeTextValue(incoming.setting.time);
    if (time && isSupportedValue(time, supportTexts)) next.setting.time = time;
    const atmosphere = normalizeTextValue(incoming.setting.atmosphere);
    if (atmosphere && isSupportedValue(atmosphere, supportTexts)) next.setting.atmosphere = atmosphere;
    const tags = Array.isArray(incoming.setting.sensory_tags) ? incoming.setting.sensory_tags : [];
    const mergedTags = Array.isArray(next.setting.sensory_tags) ? [...next.setting.sensory_tags] : [];
    for (const tag of tags) {
      const normalized = normalizeTextValue(tag);
      if (!normalized) continue;
      if (!isSupportedValue(normalized, supportTexts)) continue;
      if (!mergedTags.some(item => item.toLowerCase() === normalized.toLowerCase())) {
        mergedTags.push(normalized);
      }
    }
    next.setting.sensory_tags = mergedTags;
  }

  const mergeDerivedField = (key, value) => {
    const normalized = normalizeTextValue(value);
    if (!normalized) return;
    if (!isSupportedValue(normalized, supportTexts)) return;
    next[key] = normalized;
  };

  mergeDerivedField("inciting_incident", incoming.inciting_incident);
  if (incoming.conflict && typeof incoming.conflict === "object") {
    next.conflict = next.conflict || {};
    const internal = normalizeTextValue(incoming.conflict.internal);
    if (internal && isSupportedValue(internal, supportTexts)) next.conflict.internal = internal;
    const external = normalizeTextValue(incoming.conflict.external);
    if (external && isSupportedValue(external, supportTexts)) next.conflict.external = external;
  }
  mergeDerivedField("turning_point", incoming.turning_point);
  mergeDerivedField("resolution", incoming.resolution);
  mergeDerivedField("theme", incoming.theme);

  if (Array.isArray(incoming.motifs)) {
    next.motifs = mergeMotifs(next.motifs, incoming.motifs, supportTexts);
  }

  return next;
}

function sanitizeSongMap(songMap, supportTexts) {
  if (!songMap || typeof songMap !== "object") return null;

  const sanitized = {};
  const handleString = (value) => {
    const normalized = normalizeTextValue(value);
    if (!normalized) return "";
    if (!isSupportedValue(normalized, supportTexts)) return "";
    return normalized;
  };
  const handleArray = (value) => {
    if (!Array.isArray(value)) return [];
    return value
      .map(handleString)
      .filter(Boolean);
  };

  if (songMap.hook !== undefined) sanitized.hook = handleString(songMap.hook);
  if (songMap.verse1 !== undefined) sanitized.verse1 = handleArray(songMap.verse1);
  if (songMap.verse2 !== undefined) sanitized.verse2 = handleArray(songMap.verse2);
  if (songMap.pre !== undefined) sanitized.pre = handleArray(songMap.pre);
  if (songMap.chorus !== undefined) sanitized.chorus = handleArray(songMap.chorus);
  if (songMap.bridge !== undefined) sanitized.bridge = handleArray(songMap.bridge);
  if (songMap.key_lines !== undefined) sanitized.key_lines = handleArray(songMap.key_lines);
  if (songMap.motifs !== undefined) sanitized.motifs = handleArray(songMap.motifs);

  const hasContent = Object.values(sanitized).some(value =>
    (typeof value === "string" && value) || (Array.isArray(value) && value.length > 0)
  );

  return hasContent ? sanitized : null;
}

function ensureAtomFacts(state, atoms) {
  if (!atoms || typeof atoms !== "object") return state;

  const beatMap = {
    who: "who",
    where: "scene",
    when: "scene",
    turn: "turning_point",
    object: "sensory",
    sound: "sensory",
    smell: "sensory",
    physical: "sensory",
    action: "moment",
    stakes: "stakes",
    secret: "stakes",
    after: "impact",
    dialogue: "moment",
  };

  const existingFacts = (state.facts || []).filter(f => f && typeof f.text === "string");
  const existingSet = new Set(existingFacts.map(f => f.text.toLowerCase().trim()));
  const nextFacts = [...existingFacts];

  for (const [key, value] of Object.entries(atoms)) {
    const normalized = normalizeTextValue(value);
    if (!normalized) continue;
    const lower = normalized.toLowerCase();
    if (existingSet.has(lower)) continue;

    nextFacts.push({
      id: createFactId(normalized),
      text: normalized,
      beat: beatMap[key] || "detail",
      source_turn: state.turn_count + 1,
    });
    existingSet.add(lower);
  }

  if (nextFacts.length === existingFacts.length) {
    return state;
  }

  return {
    ...state,
    facts: nextFacts,
  };
}

function getMissingCoreAtoms(state) {
  const atoms = state.atoms || {};
  const missing = [];
  if (!normalizeTextValue(atoms.who)) missing.push("who");
  if (!normalizeTextValue(atoms.where)) missing.push("where");
  if (!normalizeTextValue(atoms.when)) missing.push("when");
  if (!normalizeTextValue(atoms.turn)) missing.push("turn");
  return missing;
}

function buildAtomQuestion(atomKey, state, userStyle) {
  const recipient = state.recipient_name || "them";
  switch (atomKey) {
    case "who":
      return userStyle === "brief"
        ? `Who is this about?`
        : `Who is this really about — and what role do they play in your life?`;
    case "where":
      return userStyle === "brief"
        ? `Where did it happen?`
        : `Where were you when this happened? A place or setting helps me picture it.`;
    case "when":
      return userStyle === "brief"
        ? `When did it happen?`
        : `When was this — even roughly (like “last winter” or “in 2019”)?`;
    case "turn":
      return userStyle === "brief"
        ? `What changed?`
        : `What was the turning point — the moment things shifted for you and ${recipient}?`;
    default:
      return `Tell me one concrete detail that brings this to life.`;
  }
}

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
          id: createFactId(fact.text),
          text: fact.text,
          beat: fact.beat,
          source_turn: state.turn_count + 1,
        });
        existingFactTexts.add(normalizedText);
      }
    }
    newState = { ...newState, facts: newFacts };
  }

  // Build support corpus for grounding checks (user input + facts)
  const supportTexts = buildSupportTexts(newState, userInput);

  // 2b. Merge story atoms (grounded only)
  const atomsInput = updates.atoms || reasoningResult.atoms;
  if (atomsInput) {
    newState = {
      ...newState,
      atoms: mergeAtoms(newState.atoms || {}, atomsInput, supportTexts),
    };
    newState = ensureAtomFacts(newState, newState.atoms);
  }

  // 2c. Merge narrative primitives (grounded where possible)
  const primitivesInput = updates.primitives || reasoningResult.primitives;
  if (primitivesInput) {
    newState = {
      ...newState,
      primitives: mergePrimitives(newState.primitives || {}, primitivesInput, supportTexts),
    };
  }

  // 2d. Merge motifs (grounded only)
  const motifsInput = updates.motifs || reasoningResult.motifs;
  if (motifsInput) {
    newState = {
      ...newState,
      motifs: mergeMotifs(newState.motifs || [], motifsInput, supportTexts),
    };
  }

  // 2e. Merge dials (inferred)
  const dialsInput = updates.dials || reasoningResult.dials;
  if (dialsInput) {
    newState = {
      ...newState,
      dials: mergeDials(newState.dials || {}, dialsInput),
    };
  }

  // 2f. Song map (sanitized for grounding)
  const songMapInput = updates.song_map || reasoningResult.song_map;
  if (songMapInput) {
    newState = {
      ...newState,
      song_map: sanitizeSongMap(songMapInput, supportTexts),
    };
  }

  // 2g. Store evaluation (rubric scores) if provided
  const evaluationInput = reasoningResult.reasoning?.evaluation || updates.evaluation;
  if (evaluationInput && typeof evaluationInput === "object") {
    newState = {
      ...newState,
      evaluation: evaluationInput,
    };
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

  if (newState.narrative && !hasFirstPersonVoice(newState.narrative)) {
    const existingFeedback = newState._reasoning_feedback || [];
    newState._reasoning_feedback = [
      ...existingFeedback,
      {
        type: "missing_first_person_voice",
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

  // Priority: fill missing core atoms first (who/where/when/turn)
  const missingCoreAtoms = getMissingCoreAtoms(state);
  if (missingCoreAtoms.length > 0) {
    question = buildAtomQuestion(missingCoreAtoms[0], state, userStyle);
    return {
      action: "ASK",
      question,
      targetAtom: missingCoreAtoms[0],
      narrative: fallbackNarrative,
      fallback: true,
      tier: "heuristic",
      reason: "missing_core_atoms",
      heuristic_score: richnessScore,
    };
  }

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

function normalizeEvidenceText(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findBestFactMatch(normalizedEvidence, factTokensIndex) {
  const evidenceTokens = normalizedEvidence.split(" ").filter(Boolean);
  if (evidenceTokens.length === 0) return null;

  let bestId = null;
  let bestScore = 0;

  for (const [factId, tokens] of factTokensIndex.entries()) {
    if (!tokens || tokens.length === 0) continue;
    let overlap = 0;
    for (const token of evidenceTokens) {
      if (tokens.includes(token)) overlap += 1;
    }
    const score = overlap / Math.max(tokens.length, evidenceTokens.length);
    if (score > bestScore) {
      bestScore = score;
      bestId = factId;
    }
  }

  if (bestScore >= 0.55) {
    return bestId;
  }

  return null;
}

function normalizeBeatsFromLLM(llmBeats, existingBeats, facts) {
  const fallbackBeats = buildFallbackBeats(existingBeats);

  if (!llmBeats || !Array.isArray(llmBeats) || llmBeats.length === 0) {
    return { beats: fallbackBeats, invalidEvidence: [] };
  }

  const factIds = new Set((facts || []).map(f => f.id));
  const factTextIndex = new Map();
  const factTokensIndex = new Map();
  for (const fact of facts || []) {
    if (!fact || typeof fact.text !== "string") continue;
    const normalized = normalizeEvidenceText(fact.text);
    if (!normalized || factTextIndex.has(normalized)) continue;
    factTextIndex.set(normalized, fact.id);
    factTokensIndex.set(fact.id, normalized.split(" ").filter(Boolean));
  }
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
        if (typeof factId !== "string") {
          invalidEvidence.push({ beat: id, evidence_id: String(factId) });
          continue;
        }
        const trimmed = factId.trim();
        if (factIds.has(trimmed)) {
          validEvidence.push(trimmed);
        } else {
          const normalizedText = normalizeEvidenceText(trimmed);
          const remappedId = normalizedText ? factTextIndex.get(normalizedText) : null;
          if (remappedId) {
            validEvidence.push(remappedId);
          } else {
            const fuzzyMatch = normalizedText
              ? findBestFactMatch(normalizedText, factTokensIndex)
              : null;
            if (fuzzyMatch) {
              validEvidence.push(fuzzyMatch);
            } else {
              invalidEvidence.push({ beat: id, evidence_id: trimmed });
            }
          }
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
