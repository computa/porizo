/**
 * V3 State Manager
 *
 * Manages the V3 story session state with:
 * - Schema validation
 * - Grounding checks (no hallucinations)
 * - Immutable updates
 *
 * @module writer/v3/state
 */

const crypto = require("crypto");
const { STORY_MAX_CONVERSATION_TURNS } = require("../../config");

/**
 * Valid session statuses
 */
const VALID_STATUSES = ["active", "ready_for_confirm", "confirmed", "abandoned"];

/**
 * Create initial V3 state for a new session
 *
 * @param {Object} params - Session parameters
 * @param {string} params.recipientName - Who the song is for
 * @param {string} params.occasion - The occasion
 * @param {string} params.initialPrompt - User's initial prompt
 * @returns {Object} Initial V3 state
 */
function createInitialState({ recipientName, occasion, initialPrompt }) {
  const now = new Date().toISOString();

  return {
    // Event understanding (populated after first LLM call)
    event: {
      title: "",
      type: "",
      confidence: 0,
      people: [recipientName],
      timeframe: "",
      occasion: occasion || "",
    },

    // Grounded facts (audit trail)
    facts: [],

    // Single evolving narrative (canonical + backward-compatible alias)
    narrative_current: "",
    narrative: "",
    narrative_version: 0,
    narrative_revisions: [],
    integration_history: [],
    last_integration_delta: null,
    open_conflicts: [],

    // Dynamic beat schema (generated per event)
    beats: [],

    // Story atoms (fine-grained detail fields)
    atoms: {
      who: "",
      where: "",
      when: "",
      turn: "",
      object: "",
      sound: "",
      smell: "",
      physical: "",
      action: "",
      stakes: "",
      secret: "",
      after: "",
      dialogue: "",
    },

    // Narrative primitives (structured representation)
    primitives: {
      characters: [],
      setting: {
        place: "",
        time: "",
        atmosphere: "",
        sensory_tags: [],
      },
      inciting_incident: "",
      conflict: {
        internal: "",
        external: "",
      },
      turning_point: "",
      resolution: "",
      theme: "",
      motifs: [],
    },

    // Recurring motifs (concrete, story-rooted)
    motifs: [],

    // Story dials (inferred, not user-configured yet)
    dials: {
      tone: "",
      pov: "recipient",
      length: "",
      realism: "",
      focus: "",
    },

    // Song map for downstream lyrics alignment
    song_map: null,

    // Quality/evaluation snapshot from the reasoning step
    evaluation: null,

    // User signals
    user_model: {
      style: "unknown", // brief | verbose | emotional | analytical | unknown
      fatigue_signals: 0, // Count of short answers, skips
      tone_preference: "neutral", // Detected from language
    },

    // Reasoning trace (debuggable)
    last_reasoning: null,

    // Conversation history
    conversation: [],

    // Session meta
    turn_count: 0,
    status: "active", // active | ready_for_confirm | confirmed | abandoned
    recipient_name: recipientName,
    initial_prompt: initialPrompt,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Validate V3 state schema
 *
 * @param {Object} state - State to validate
 * @returns {{valid: boolean, errors: string[]}} Validation result
 */
function validateState(state) {
  const errors = [];

  // Required fields
  const requiredFields = [
    "event",
    "facts",
    "narrative",
    "beats",
    "user_model",
    "turn_count",
    "status",
  ];

  for (const field of requiredFields) {
    if (state[field] === undefined) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Type checks
  if (state.facts !== undefined && !Array.isArray(state.facts)) {
    errors.push("facts must be an array");
  }

  if (state.beats !== undefined && !Array.isArray(state.beats)) {
    errors.push("beats must be an array");
  }

  if (typeof state.narrative !== "string" && state.narrative !== undefined) {
    errors.push("narrative must be a string");
  }

  if (state.atoms !== undefined && (typeof state.atoms !== "object" || Array.isArray(state.atoms))) {
    errors.push("atoms must be an object");
  }

  if (state.primitives !== undefined && (typeof state.primitives !== "object" || Array.isArray(state.primitives))) {
    errors.push("primitives must be an object");
  }

  if (state.motifs !== undefined && !Array.isArray(state.motifs)) {
    errors.push("motifs must be an array");
  }

  if (state.dials !== undefined && (typeof state.dials !== "object" || Array.isArray(state.dials))) {
    errors.push("dials must be an object");
  }

  if (state.narrative_revisions !== undefined && !Array.isArray(state.narrative_revisions)) {
    errors.push("narrative_revisions must be an array");
  }

  if (state.integration_history !== undefined && !Array.isArray(state.integration_history)) {
    errors.push("integration_history must be an array");
  }

  if (state.open_conflicts !== undefined && !Array.isArray(state.open_conflicts)) {
    errors.push("open_conflicts must be an array");
  }

  // Status validation
  if (state.status && !VALID_STATUSES.includes(state.status)) {
    errors.push(`Invalid status: ${state.status}. Must be one of: ${VALID_STATUSES.join(", ")}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Ensure new fields exist on legacy state objects (backward-compatible defaults)
 *
 * @param {Object} state - Parsed state from storage
 * @returns {Object} State with defaults applied
 */
function ensureStateDefaults(state) {
  if (!state || typeof state !== "object") return state;

  const next = { ...state };

  if (!next.atoms) {
    next.atoms = {
      who: "",
      where: "",
      when: "",
      turn: "",
      object: "",
      sound: "",
      smell: "",
      physical: "",
      action: "",
      stakes: "",
      secret: "",
      after: "",
      dialogue: "",
    };
  }

  if (!next.primitives) {
    next.primitives = {
      characters: [],
      setting: {
        place: "",
        time: "",
        atmosphere: "",
        sensory_tags: [],
      },
      inciting_incident: "",
      conflict: {
        internal: "",
        external: "",
      },
      turning_point: "",
      resolution: "",
      theme: "",
      motifs: [],
    };
  }

  if (!Array.isArray(next.motifs)) {
    next.motifs = [];
  }

  if (!next.dials) {
    next.dials = {
      tone: "",
      pov: "recipient",
      length: "",
      realism: "",
      focus: "",
    };
  }

  if (next.song_map === undefined) {
    next.song_map = null;
  }

  if (next.evaluation === undefined) {
    next.evaluation = null;
  }

  const narrativeCurrent = typeof next.narrative_current === "string"
    ? next.narrative_current
    : (typeof next.narrative === "string" ? next.narrative : "");
  next.narrative_current = narrativeCurrent;

  if (typeof next.narrative !== "string") {
    next.narrative = narrativeCurrent;
  } else if (!next.narrative && narrativeCurrent) {
    next.narrative = narrativeCurrent;
  }

  if (!Array.isArray(next.narrative_revisions)) {
    next.narrative_revisions = [];
  }

  if (!Array.isArray(next.integration_history)) {
    next.integration_history = [];
  }

  if (!Array.isArray(next.open_conflicts)) {
    next.open_conflicts = [];
  }

  if (typeof next.narrative_version !== "number" || Number.isNaN(next.narrative_version)) {
    const baseVersion = narrativeCurrent ? 1 : 0;
    next.narrative_version = Math.max(baseVersion, next.narrative_revisions.length);
  }

  if (next.last_integration_delta === undefined) {
    next.last_integration_delta = null;
  }

  return next;
}

/**
 * Check if narrative is grounded in facts (no hallucinations)
 *
 * This is a heuristic check that verifies the narrative doesn't contain
 * significant content not present in the facts. Uses keyword matching.
 *
 * @param {Object} state - State with facts and narrative
 * @returns {boolean} True if narrative is grounded in facts
 */
function assessStateGrounding(state) {
  const currentState = state && typeof state === "object" ? state : {};
  const result = {
    grounded: true,
    reason: "ok",
    matched: 0,
    unmatched: 0,
    total: 0,
    coverage: 1,
  };

  // Empty narrative is trivially grounded
  if (!currentState.narrative || currentState.narrative.trim() === "") {
    return result;
  }

  // Narrative with no facts = ungrounded (unless empty)
  if (!currentState.facts || currentState.facts.length === 0) {
    return {
      ...result,
      grounded: false,
      reason: "no_facts",
      coverage: 0,
    };
  }

  // Filter to only valid facts with string text (defensive against corrupted state)
  const validFacts = currentState.facts.filter(
    (f) => f && typeof f.text === "string" && (f.status || "active") === "active"
  );
  if (validFacts.length === 0) {
    return {
      ...result,
      grounded: false,
      reason: "no_active_facts",
      coverage: 0,
    };
  }

  const normalizeToken = (token) => token
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
  const tokenVariants = (token) => {
    const normalized = normalizeToken(token);
    if (!normalized) return [];
    const variants = new Set([normalized]);
    if (normalized.length > 6 && normalized.endsWith("ing")) {
      variants.add(normalized.slice(0, -3));
    }
    if (normalized.length > 5 && normalized.endsWith("ed")) {
      variants.add(normalized.slice(0, -2));
    }
    if (normalized.length > 5 && normalized.endsWith("es")) {
      variants.add(normalized.slice(0, -2));
    }
    if (normalized.length > 4 && normalized.endsWith("s")) {
      variants.add(normalized.slice(0, -1));
    }
    return [...variants].filter(Boolean);
  };

  // Extract significant words from facts (words > 3 chars) and variants
  const factWords = new Set();
  for (const fact of validFacts) {
    const words = fact.text.toLowerCase().split(/\s+/);
    for (const word of words) {
      const variants = tokenVariants(word);
      for (const variant of variants) {
        if (variant.length > 3) {
          factWords.add(variant);
        }
      }
    }
  }

  // Common connecting/filler words that don't need grounding
  const allowedWords = new Set([
    // Pronouns and determiners
    "their", "there", "they", "them", "that", "this", "these", "those",
    "what", "which", "where", "when", "while", "with",
    // Modals and auxiliaries
    "would", "could", "should", "might", "have", "been", "being", "having",
    // Common narrative words
    "moment", "everything", "something", "nothing", "everyone", "someone",
    "before", "after", "during", "through", "about", "around",
    // Contractions expanded
    "that's", "they'd", "she'd", "he'd", "we'd", "it's", "wasn't", "didn't",
    // Time words
    "then", "now", "later", "soon", "always", "never", "still",
    // Connectors
    "because", "however", "although", "therefore", "finally",
    // Common verbs
    "changed", "felt", "knew", "thought", "realized", "became",
    // Narrative glue / abstractions
    "story", "memory", "moment", "feeling", "feelings", "emotion", "journey",
    "chapter", "version", "person", "people", "future", "past",
  ]);

  // Check narrative words via coverage ratio instead of all-or-nothing matching.
  // This reduces false positives when the model paraphrases grounded details.
  const narrativeWords = currentState.narrative.toLowerCase().split(/\s+/);
  let matched = 0;
  let unmatched = 0;

  for (const word of narrativeWords) {
    const cleaned = normalizeToken(word);

    // Skip short words and allowed words
    if (cleaned.length <= 5 || allowedWords.has(cleaned)) {
      continue;
    }

    const variants = tokenVariants(cleaned);
    const foundInFacts = variants.some((variant) => factWords.has(variant));
    if (foundInFacts) {
      matched += 1;
    } else {
      const partialMatch = validFacts.some((fact) =>
        variants.some((variant) => variant.length >= 5 && fact.text.toLowerCase().includes(variant))
      );
      if (partialMatch) {
        matched += 1;
      } else {
        unmatched += 1;
      }
    }
  }

  if (matched === 0 && unmatched === 0) {
    return result;
  }

  const total = matched + unmatched;
  const coverage = total > 0 ? matched / total : 1;
  result.matched = matched;
  result.unmatched = unmatched;
  result.total = total;
  result.coverage = coverage;

  // Accept when most significant narrative tokens are grounded, or when only a
  // small number remain unmatched.
  if (coverage >= 0.55) {
    return result;
  }
  if (matched >= 4 && unmatched <= 2) {
    return result;
  }

  return {
    ...result,
    grounded: false,
    reason: "coverage_low",
  };
}

function isStateGrounded(state) {
  return assessStateGrounding(state).grounded;
}

/**
 * Add a fact to state (immutable)
 *
 * @param {Object} state - Current state
 * @param {Object} factData - Fact to add
 * @param {string} factData.text - Fact text
 * @param {string} factData.beat - Associated beat ID
 * @param {number} factData.sourceTurn - Turn number where fact was extracted
 * @returns {Object} New state with fact added
 */
function addFact(state, { text, beat, sourceTurn }) {
  // Check for duplicates (case-insensitive)
  const normalizedText = normalizeFactText(text);
  const isDuplicate = state.facts.some(
    f => normalizeFactText(f.text) === normalizedText
  );

  if (isDuplicate) {
    return state; // Return unchanged
  }

  const newFact = {
    id: createFactId(text),
    text,
    beat,
    source_turn: sourceTurn,
    status: "active",
    superseded_by: "",
    superseded_at: "",
    supersedes_fact_id: "",
    confidence: 0.8,
  };

  return {
    ...state,
    facts: [...state.facts, newFact],
    updated_at: new Date().toISOString(),
  };
}

function normalizeFactText(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createFactId(text) {
  const normalized = normalizeFactText(text);
  if (!normalized) {
    return `f_${crypto.randomBytes(4).toString("hex")}`;
  }
  const hash = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 10);
  return `f_${hash}`;
}

/**
 * Update narrative (immutable)
 *
 * @param {Object} state - Current state
 * @param {string} narrative - New narrative text
 * @returns {Object} New state with updated narrative
 */
function updateNarrative(state, narrative) {
  const nextNarrative = typeof narrative === "string" ? narrative : "";
  return {
    ...state,
    narrative: nextNarrative,
    narrative_current: nextNarrative,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Update beat status (immutable)
 *
 * @param {Object} state - Current state
 * @param {string} beatId - Beat ID to update
 * @param {string} status - New status (missing | weak | covered)
 * @param {string[]} evidence - Fact IDs that support this beat
 * @returns {Object} New state with updated beat
 */
function updateBeatStatus(state, beatId, status, evidence = []) {
  const beats = state.beats.map(beat => {
    if (beat.id === beatId) {
      return { ...beat, status, evidence };
    }
    return beat;
  });

  return {
    ...state,
    beats,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Update user model (immutable)
 *
 * @param {Object} state - Current state
 * @param {Object} updates - Fields to update
 * @returns {Object} New state with updated user model
 */
function updateUserModel(state, updates) {
  return {
    ...state,
    user_model: { ...state.user_model, ...updates },
    updated_at: new Date().toISOString(),
  };
}

/**
 * Add conversation turn (immutable)
 *
 * Keeps conversation within STORY_MAX_CONVERSATION_TURNS limit to prevent
 * unbounded memory growth. Drops oldest turns when limit is exceeded.
 *
 * @param {Object} state - Current state
 * @param {Object} turn - Turn to add
 * @param {string} turn.role - "user" or "assistant"
 * @param {string} turn.content - Message content
 * @returns {Object} New state with conversation turn added
 */
function addConversationTurn(state, { role, content }) {
  const newTurn = {
    role,
    content,
    timestamp: new Date().toISOString(),
  };

  // Keep conversation within size limit by dropping oldest turns
  let updatedConversation = [...state.conversation, newTurn];
  if (updatedConversation.length > STORY_MAX_CONVERSATION_TURNS) {
    const turnsDropped = updatedConversation.length - STORY_MAX_CONVERSATION_TURNS;
    // Keep most recent turns, drop oldest
    updatedConversation = updatedConversation.slice(-STORY_MAX_CONVERSATION_TURNS);
    console.warn(`[State] Trimmed conversation: dropped ${turnsDropped} oldest turns, keeping ${STORY_MAX_CONVERSATION_TURNS}`);
  }

  return {
    ...state,
    conversation: updatedConversation,
    // Increment turn count only for user messages
    turn_count: role === "user" ? state.turn_count + 1 : state.turn_count,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Set reasoning trace (immutable)
 *
 * @param {Object} state - Current state
 * @param {Object} reasoning - Reasoning data from LLM
 * @returns {Object} New state with reasoning trace
 */
function setReasoningTrace(state, reasoning) {
  return {
    ...state,
    last_reasoning: {
      ...reasoning,
      turn: state.turn_count,
    },
    updated_at: new Date().toISOString(),
  };
}

/**
 * Set session status (immutable)
 *
 * @param {Object} state - Current state
 * @param {string} status - New status
 * @returns {Object} New state with updated status
 */
function setStatus(state, status) {
  return {
    ...state,
    status,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Set event information (immutable)
 *
 * @param {Object} state - Current state
 * @param {Object} event - Event data from LLM inference
 * @returns {Object} New state with updated event
 */
function setEvent(state, event) {
  return {
    ...state,
    event: { ...state.event, ...event },
    updated_at: new Date().toISOString(),
  };
}

/**
 * Set beats schema (immutable)
 *
 * @param {Object} state - Current state
 * @param {Array} beats - Beat schema array
 * @returns {Object} New state with beats
 */
function setBeats(state, beats) {
  return {
    ...state,
    beats,
    updated_at: new Date().toISOString(),
  };
}

module.exports = {
  // Constants
  VALID_STATUSES,

  // State creation and validation
  createInitialState,
  validateState,
  isStateGrounded,
  ensureStateDefaults,

  // Immutable state updates
  addFact,
  updateNarrative,
  updateBeatStatus,
  updateUserModel,
  addConversationTurn,
  setReasoningTrace,
  setStatus,
  setEvent,
  setBeats,
  createFactId,
  assessStateGrounding,
};
