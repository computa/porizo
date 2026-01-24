/**
 * V2 State Manager
 *
 * Manages the V2 story session state with:
 * - Schema validation
 * - Grounding checks (no hallucinations)
 * - Immutable updates
 *
 * @module writer/v2/state
 */

const crypto = require("crypto");
const { STORY_MAX_CONVERSATION_TURNS } = require("../../config");

/**
 * Valid session statuses
 */
const VALID_STATUSES = ["active", "ready_for_confirm", "confirmed", "abandoned"];

/**
 * Create initial V2 state for a new session
 *
 * @param {Object} params - Session parameters
 * @param {string} params.recipientName - Who the song is for
 * @param {string} params.occasion - The occasion
 * @param {string} params.initialPrompt - User's initial prompt
 * @returns {Object} Initial V2 state
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

    // Single evolving narrative (3-6 sentences, grounded)
    narrative: "",

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
      pov: "",
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
 * Validate V2 state schema
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
      pov: "",
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
function isStateGrounded(state) {
  // Empty narrative is trivially grounded
  if (!state.narrative || state.narrative.trim() === "") {
    return true;
  }

  // Narrative with no facts = ungrounded (unless empty)
  if (!state.facts || state.facts.length === 0) {
    return false;
  }

  // Filter to only valid facts with string text (defensive against corrupted state)
  const validFacts = state.facts.filter(f => f && typeof f.text === "string");
  if (validFacts.length === 0) {
    return false;
  }

  // Extract significant words from facts (words > 3 chars)
  const factWords = new Set();
  for (const fact of validFacts) {
    const words = fact.text.toLowerCase().split(/\s+/);
    for (const word of words) {
      // Clean punctuation and add if significant
      const cleaned = word.replace(/[.,!?;:'"]/g, "");
      if (cleaned.length > 3) {
        factWords.add(cleaned);
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
  ]);

  // Check narrative words
  const narrativeLower = state.narrative.toLowerCase();
  const narrativeWords = narrativeLower.split(/\s+/);

  // Only check significant words (length > 5 to avoid false positives)
  for (const word of narrativeWords) {
    const cleaned = word.replace(/[.,!?;:'"]/g, "");

    // Skip short words and allowed words
    if (cleaned.length <= 5 || allowedWords.has(cleaned)) {
      continue;
    }

    // Check if word is in facts or is a common word
    if (!factWords.has(cleaned)) {
      // Check if any fact contains this word (partial match)
      const foundInFacts = state.facts.some(f =>
        f.text.toLowerCase().includes(cleaned)
      );
      if (!foundInFacts) {
        return false; // Ungrounded word found
      }
    }
  }

  return true;
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
  return {
    ...state,
    narrative,
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
};
