/**
 * Story Reasoning Engine V2
 *
 * An intelligent, thinking story collection system that reasons holistically
 * about each user input. Uses a single unified LLM call per turn instead of
 * a pipeline of specialized extractors.
 *
 * Key differences from V1:
 * - Dynamic beat schemas (not hardcoded arcs)
 * - Single evolving narrative (not element fragments)
 * - Unified reasoning (not extract → integrate → evaluate → select)
 * - User model detection (brief/verbose, emotional/analytical)
 * - Fatigue detection (know when to stop)
 *
 * Architecture:
 * - One LLM call per turn (reason.js)
 * - State management with grounding validation (state.js)
 * - Dynamic beat generation per event type (beats.js)
 * - Quality checks for story completeness (quality.js)
 *
 * @module writer/v2
 */

// Internal modules
const { createInitialState, validateState, addFact } = require("./state");
const { composeNarrativeFromFacts } = require("./narrative");
const { reasonWithFallback } = require("./reasoner");
const {
  applyReasoningResult,
  addTurnToState,
  generateFallbackResponse,
  loadStateFromSession,
  enforceGrounding,
} = require("./engine");
const { getCompletionFromLLM, getCompletionScore } = require("./quality");

// Engine version identifier
const ENGINE_VERSION = "v2";

// Repository instance (set by initialize)
let storyRepo = null;

/**
 * Initialize the V2 engine with a story repository
 *
 * @param {Object} repo - Story repository instance
 */
function initialize(repo) {
  storyRepo = repo;
}

/**
 * Start a new V2 story session
 *
 * Creates session, generates beats for the occasion, and returns first question.
 *
 * @param {Object} options - Session options
 * @param {string} options.userId - User ID
 * @param {string} options.recipientName - Who the song is for
 * @param {string} options.occasion - The occasion (birthday, anniversary, etc.)
 * @param {string} options.initialPrompt - User's initial story prompt
 * @returns {Promise<Object>} Session with first question
 */
async function startStoryV2(options) {
  if (!storyRepo) {
    throw new Error("V2 Engine not initialized - call initialize() with repository first");
  }

  // Validate options
  if (!options || typeof options !== "object") {
    throw new Error("startStoryV2 requires an options object");
  }

  const { userId, recipientName, occasion, initialPrompt } = options;

  if (!userId) throw new Error("startStoryV2: userId is required");
  if (!recipientName) throw new Error("startStoryV2: recipientName is required");

  // 1. Create initial state
  const v2State = createInitialState({ recipientName, occasion, initialPrompt });

  // 2. Initialize with empty beats; V3 requires LLM-generated beats per story
  v2State.beats = [];
  v2State.event.occasion = occasion;

  // 3. Add initial prompt to conversation history BEFORE reasoning
  // This ensures the LLM has context about what the user initially shared
  let stateWithPrompt = addTurnToState(v2State, "user", initialPrompt);

  // 4. Create database session
  const session = storyRepo.createSession(userId, {
    arc: occasion || "unified",
    occasion,
    recipientName,
    initialPrompt,
    engineVersion: ENGINE_VERSION,
    v2State: stateWithPrompt,
  });

  // 5. Generate first question using reasoner or fallback
  let response;
  let finalState = stateWithPrompt;
  let usedFallback = false;
  try {
    const result = await reasonWithFallback(stateWithPrompt, initialPrompt);
    if (result.success) {
      response = {
        action: result.data.action,
        question: result.data.question,
        confirmation: result.data.confirmation,
        narrative: result.data.narrative,
      };
      // Update state with reasoning result
      finalState = applyReasoningResult(stateWithPrompt, result.data, initialPrompt);
      // Enforce grounding - narrative must be supported by facts
      finalState = enforceGrounding(finalState);
      usedFallback = result.fallback || false;
    } else if (result.errorCode === "NARRATIVE_REWRITE_REQUIRED") {
      finalState = addFact(finalState, {
        text: initialPrompt,
        beat: "context",
        sourceTurn: finalState.turn_count || 1,
      });
      const recomposed = composeNarrativeFromFacts(finalState);
      if (recomposed) {
        finalState = { ...finalState, narrative: recomposed };
      }
      response = {
        action: "CLARIFY",
        question: "I want to make sure I'm capturing this correctly. Can you share one concrete moment or detail from this story?",
        narrative: finalState.narrative,
      };
      usedFallback = true;
    } else {
      // LLM failed - use fallback
      response = generateFallbackResponse(stateWithPrompt);
      usedFallback = true;
    }
  } catch (err) {
    console.error("[V2 Engine] startStoryV2 reasoning error:", err.message);
    response = generateFallbackResponse(stateWithPrompt);
    usedFallback = true;
  }

  // Validate state and force clarification if invalid
  const validation = validateState(finalState);
  if (!validation.valid) {
    console.warn("[V2 Engine] Invalid state after reasoning:", validation.errors.join("; "));
    response = {
      action: "CLARIFY",
      question: "I want to make sure I understood. Can you share one concrete moment or detail from this story?",
    };
    finalState = addTurnToState(stateWithPrompt, "assistant", response.question);
    usedFallback = true;
  } else if (finalState.grounding_enforced && finalState.grounding_issue === "no_facts" && response.action === "CONFIRM") {
    response = {
      action: "CLARIFY",
      question: "Before I summarize, could you share one specific moment or detail that stands out?",
    };
    finalState = addTurnToState(finalState, "assistant", response.question);
    usedFallback = true;
  } else {
    // Add assistant's response to conversation history
    const assistantMessage = response.question || response.confirmation || response.narrative;
    if (assistantMessage) {
      finalState = addTurnToState(finalState, "assistant", assistantMessage);
    }
  }

  storyRepo.updateSession(session.id, { v2State: finalState });

  return {
    sessionId: session.id,
    engineVersion: ENGINE_VERSION,
    action: response.action,
    question: response.question || response.confirmation,
    narrative: response.narrative || finalState.narrative || "",
    completionScore: getCompletionScoreForState(finalState),
    fallback: response.fallback || usedFallback,
  };
}

/**
 * Continue a V2 story session with user's answer
 *
 * Processes answer through reasoner, updates state, returns next question.
 *
 * @param {Object} options - Continue options
 * @param {string} options.sessionId - Session ID
 * @param {string} options.answer - User's answer
 * @returns {Promise<Object>} Next question or confirmation
 */
async function continueStoryV2(options) {
  if (!storyRepo) {
    throw new Error("V2 Engine not initialized - call initialize() with repository first");
  }

  // Validate options
  if (!options || typeof options !== "object") {
    throw new Error("continueStoryV2 requires an options object");
  }

  const { sessionId, answer } = options;

  if (!sessionId) throw new Error("continueStoryV2: sessionId is required");
  if (!answer) throw new Error("continueStoryV2: answer is required");

  // 1. Get session and validate
  const session = storyRepo.getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  if (session.engineVersion !== ENGINE_VERSION) {
    throw new Error(`Session ${sessionId} is not V2 (found ${session.engineVersion})`);
  }

  // 2. Load and validate state
  let v2State = session.v2State;
  if (!v2State) {
    throw new Error(`Session ${sessionId} has no V2 state`);
  }

  // If state came from JSON, it might need parsing
  if (typeof v2State === "string") {
    v2State = loadStateFromSession(v2State);
    if (!v2State) {
      throw new Error(`Session ${sessionId} has corrupted V2 state`);
    }
  }

  // 3. Add user turn to conversation history
  v2State = addTurnToState(v2State, "user", answer);

  // 4. Run reasoning
  let response;
  let usedFallback = false;
  try {
    const result = await reasonWithFallback(v2State, answer);
    if (result.success) {
      // Apply reasoning result to state
      v2State = applyReasoningResult(v2State, result.data, answer);

      // Enforce grounding - narrative must be supported by facts
      v2State = enforceGrounding(v2State);

      response = {
        action: result.data.action,
        question: result.data.question,
        confirmation: result.data.confirmation,
        narrative: result.data.narrative || v2State.narrative,
      };
      usedFallback = result.fallback || false;

    } else if (result.errorCode === "NARRATIVE_REWRITE_REQUIRED") {
      v2State = addFact(v2State, {
        text: answer,
        beat: "context",
        sourceTurn: v2State.turn_count || 1,
      });
      const recomposed = composeNarrativeFromFacts(v2State);
      if (recomposed) {
        v2State = { ...v2State, narrative: recomposed };
      }
      response = {
        action: "CLARIFY",
        question: "I want to make sure I'm capturing this correctly. Can you share one concrete moment or detail from this story?",
        narrative: v2State.narrative,
      };
      usedFallback = true;
    } else {
      // LLM failed - use fallback
      response = generateFallbackResponse(v2State);
      usedFallback = true;
    }
  } catch (err) {
    console.error("[V2 Engine] continueStoryV2 reasoning error:", err.message);
    response = generateFallbackResponse(v2State);
    usedFallback = true;
  }

  // Validate state and force clarification if invalid
  const validation = validateState(v2State);
  if (!validation.valid) {
    console.warn("[V2 Engine] Invalid state after reasoning:", validation.errors.join("; "));
    response = {
      action: "CLARIFY",
      question: "I want to make sure I understood. Can you share one concrete moment or detail from this story?",
    };
    v2State = addTurnToState(v2State, "assistant", response.question);
    usedFallback = true;
  } else if (v2State.grounding_enforced && v2State.grounding_issue === "no_facts" && response.action === "CONFIRM") {
    response = {
      action: "CLARIFY",
      question: "Before I summarize, could you share one specific moment or detail that stands out?",
    };
    v2State = addTurnToState(v2State, "assistant", response.question);
    usedFallback = true;
  } else {
    const assistantMessage = response.question || response.confirmation;
    if (assistantMessage) {
      v2State = addTurnToState(v2State, "assistant", assistantMessage);
    }
  }

  // 5. Save updated state
  storyRepo.updateSession(sessionId, { v2State });

  return {
    sessionId,
    engineVersion: ENGINE_VERSION,
    action: response.action,
    question: response.question || response.confirmation,
    narrative: response.narrative || v2State.narrative,
    completionScore: getCompletionScoreForState(v2State),
    turnCount: v2State.turn_count,
    fallback: response.fallback || usedFallback,
  };
}

/**
 * Get story context for lyrics generation
 *
 * Extracts narrative, facts, and metadata from confirmed session.
 *
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object>} Story context with narrative, facts, and metadata
 */
async function getStoryContextV2(sessionId) {
  if (!storyRepo) {
    throw new Error("V2 Engine not initialized - call initialize() with repository first");
  }

  const session = storyRepo.getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  if (session.engineVersion !== ENGINE_VERSION) {
    throw new Error(`Session ${sessionId} is not V2 (found ${session.engineVersion})`);
  }

  let v2State = session.v2State;
  if (typeof v2State === "string") {
    v2State = loadStateFromSession(v2State);
    if (!v2State) {
      throw new Error(`Session ${sessionId} has corrupted V2 state`);
    }
  }

  // Build context for lyrics generation
  return {
    sessionId,
    engineVersion: ENGINE_VERSION,
    recipientName: v2State.recipient_name,
    occasion: v2State.event?.occasion || session.occasion,
    eventType: v2State.event?.type || session.arc,
    narrative: v2State.narrative,
    facts: v2State.facts || [],
    beats: v2State.beats || [],
    userModel: v2State.user_model,
    status: v2State.status,
    turnCount: v2State.turn_count,
    completionScore: getCompletionScoreForState(v2State),
    // For lyrics generation, provide a summary
    summary: {
      text: v2State.narrative,
      factCount: v2State.facts?.length || 0,
      beatsUncovered: v2State.beats?.filter(b =>
        typeof b.strength === "number" ? b.strength < 0.6 : b.status !== "covered"
      ).length || 0,
    },
  };
}

/**
 * Confirm story and mark ready for lyrics generation
 *
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object>} Confirmed session
 */
async function confirmStoryV2(sessionId) {
  if (!storyRepo) {
    throw new Error("V2 Engine not initialized - call initialize() with repository first");
  }

  const session = storyRepo.getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  if (session.engineVersion !== ENGINE_VERSION) {
    throw new Error(`Session ${sessionId} is not V2 (found ${session.engineVersion})`);
  }

  let v2State = session.v2State;
  if (typeof v2State === "string") {
    v2State = loadStateFromSession(v2State);
    if (!v2State) {
      throw new Error(`Session ${sessionId} has corrupted V2 state`);
    }
  }

  // Update status to confirmed
  v2State = {
    ...v2State,
    status: "confirmed",
    confirmed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Save to database
  storyRepo.updateSession(sessionId, {
    v2State,
    status: "confirmed",
  });

  return {
    sessionId,
    engineVersion: ENGINE_VERSION,
    status: "confirmed",
    narrative: v2State.narrative,
    completionScore: getCompletionScoreForState(v2State),
    confirmedAt: v2State.confirmed_at,
  };
}

function getCompletionScoreForState(state) {
  if (state?.last_reasoning?.story_readiness) {
    return getCompletionFromLLM(state.last_reasoning).score;
  }
  return getCompletionScore(state);
}

module.exports = {
  // Engine identifier
  ENGINE_VERSION,

  // Initialization
  initialize,

  // Core API
  startStoryV2,
  continueStoryV2,
  getStoryContextV2,
  confirmStoryV2,

  // Internal modules (for testing/debugging)
  __internal: {
    state: require("./state"),
    beats: require("./beats"),
    reasoner: require("./reasoner"),
    engine: require("./engine"),
    quality: require("./quality"),
  },
};
