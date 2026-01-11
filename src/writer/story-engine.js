/**
 * Story Engine
 *
 * The core conversation engine that manages dynamic story extraction.
 * Uses arc-specific models to determine what questions to ask and
 * when the story is complete enough to generate lyrics.
 *
 * Key principle: Each answer informs the next question.
 * The system builds context iteratively, not all-at-once.
 *
 * Supports both in-memory storage (for tests) and database persistence.
 */

const { v4: uuidv4 } = require("uuid");
const { getModelForOccasion } = require("./story-models");
const { generateNextQuestion, generateStorySummary } = require("./question-generator");
const {
  extractStorySignals,
  mergeSignals,
  isVagueAnswer,
} = require("./signal-extractor");

/**
 * In-memory story session storage (fallback when no repository is set)
 */
const storySessions = new Map();

/**
 * Database repository (injected via initWithRepository)
 */
let storyRepository = null;

/**
 * Story session states
 */
const SESSION_STATES = {
  ACTIVE: "active",           // Still asking questions
  READY_FOR_CONFIRM: "ready_for_confirm", // Story complete, awaiting confirmation
  CONFIRMED: "confirmed",     // User confirmed, ready for lyrics
  CANCELLED: "cancelled",     // User cancelled
};

/**
 * Initialize the story engine with a database repository
 *
 * @param {Object} repository - Story repository from createStoryRepository()
 */
function initWithRepository(repository) {
  storyRepository = repository;
}

/**
 * Check if using database persistence
 */
function useDatabase() {
  return storyRepository !== null && process.env.STORY_SESSION_STORAGE !== "memory";
}

/**
 * Get a session from storage (DB or in-memory)
 */
function getSessionFromStorage(storyId) {
  if (useDatabase()) {
    const session = storyRepository.getSession(storyId);
    if (!session) return null;
    return dbSessionToContext(session);
  }
  return storySessions.get(storyId);
}

/**
 * Save a session to storage (DB or in-memory)
 */
function saveSessionToStorage(storyId, storyContext) {
  if (useDatabase()) {
    // Check if session exists
    const existing = storyRepository.getSession(storyId);
    if (existing) {
      storyRepository.updateSession(storyId, contextToDbUpdates(storyContext));
    } else {
      // Create new session
      storyRepository.createSession(storyContext.user_id, contextToDbParams(storyContext));
    }
  } else {
    storySessions.set(storyId, storyContext);
  }
}

/**
 * Delete a session from storage
 */
function deleteSessionFromStorage(storyId) {
  if (useDatabase()) {
    storyRepository.deleteSession(storyId);
  } else {
    storySessions.delete(storyId);
  }
}

/**
 * Convert database session to internal context format
 */
function dbSessionToContext(session) {
  return {
    story_id: session.id,
    user_id: session.userId,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    initial_prompt: session.initialPrompt,
    occasion: session.occasion,
    recipient_name: session.recipientName,
    style: session.style,
    arc: session.arc,
    arcContext: getModelForOccasion(session.occasion).model.getArcContext(),
    elements: session.elements || {},
    questions: [], // Not stored in session, use turns
    answers: [],   // Not stored in session, use turns
    questionCount: session.questionCount,
    state: session.status,
    pendingAnchors: session.pendingAnchors || [],
    currentQuestion: session.currentQuestion,
    summary: session.summary,
    additional_notes: session.additionalNotes,
    confirmed_at: session.confirmedAt,
  };
}

/**
 * Convert internal context to database create params
 */
function contextToDbParams(ctx) {
  return {
    id: ctx.story_id,
    arc: ctx.arc,
    occasion: ctx.occasion,
    recipientName: ctx.recipient_name,
    style: ctx.style,
    initialPrompt: ctx.initial_prompt,
    elements: ctx.elements,
    pendingAnchors: ctx.pendingAnchors,
    currentQuestion: ctx.currentQuestion,
    questionCount: ctx.questionCount,
    status: ctx.state,
  };
}

/**
 * Convert internal context to database update params
 */
function contextToDbUpdates(ctx) {
  return {
    elements: ctx.elements,
    pendingAnchors: ctx.pendingAnchors,
    currentQuestion: ctx.currentQuestion,
    questionCount: ctx.questionCount,
    status: ctx.state,
    summary: ctx.summary,
    additionalNotes: ctx.additional_notes,
    confirmedAt: ctx.confirmed_at,
  };
}

/**
 * Start a new story extraction session
 *
 * @param {Object} options
 * @param {string} options.initial_prompt - User's initial story prompt
 * @param {string} options.occasion - The occasion (determines arc)
 * @param {string} options.recipient_name - Who the song is for
 * @param {string} options.style - Music style for eventual lyrics
 * @param {string} [options.user_id] - Optional user ID for tracking
 * @returns {Promise<Object>} { story_id, first_question, arc, progress }
 */
async function startStory({ initial_prompt, occasion, recipient_name, style, user_id }) {
  // Validate inputs
  if (!initial_prompt || initial_prompt.trim().length < 3) {
    throw new Error("initial_prompt is required and must be at least 3 characters");
  }
  if (!recipient_name || recipient_name.trim().length < 1) {
    throw new Error("recipient_name is required");
  }

  // Get the appropriate story model based on occasion
  const { arc, model } = getModelForOccasion(occasion);

  // Create session ID
  const story_id = uuidv4();

  // Initialize story context
  const storyContext = {
    story_id,
    user_id: user_id || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),

    // Inputs
    initial_prompt: initial_prompt.trim(),
    occasion: occasion || "celebration",
    recipient_name: recipient_name.trim(),
    style: style || "pop",

    // Arc info
    arc,
    arcContext: model.getArcContext(),

    // Story elements (filled as user answers)
    elements: {},

    // Conversation history
    questions: [],
    answers: [],
    questionCount: 0,

    // State
    state: SESSION_STATES.ACTIVE,

    // Detected anchors for follow-up
    pendingAnchors: [],
  };

  // Analyze initial prompt for any elements it might already contain
  const initialAnalysis = await analyzeInitialPrompt(
    initial_prompt,
    model,
    recipient_name.trim()
  );
  if (initialAnalysis.detectedElements) {
    Object.assign(storyContext.elements, initialAnalysis.detectedElements);
  }
  storyContext.pendingAnchors = initialAnalysis.anchors || [];

  // Generate first question
  const firstQuestion = await generateNextQuestion(storyContext, model);

  // Record the question
  storyContext.questions.push({
    question: firstQuestion.question,
    element_target: firstQuestion.elementTarget,
    asked_at: new Date().toISOString(),
  });
  storyContext.questionCount = 1;
  storyContext.currentQuestion = firstQuestion;

  // Store session
  if (useDatabase()) {
    storyRepository.createSession(user_id, contextToDbParams(storyContext));
    // Also add the first turn
    storyRepository.addTurn(story_id, {
      question: firstQuestion.question,
      elementTarget: firstQuestion.elementTarget,
      isFollowUp: firstQuestion.isFollowUp || false,
      anchorWord: firstQuestion.anchorWord,
    });
  } else {
    storySessions.set(story_id, storyContext);
  }

  return {
    story_id,
    first_question: firstQuestion.question,
    arc,
    arc_display_name: storyContext.arcContext.arcDisplayName,
    progress: 0,
    recipient_name: storyContext.recipient_name,
  };
}

/**
 * Process an answer and get the next question (or completion status)
 *
 * @param {Object} options
 * @param {string} options.story_id - The story session ID
 * @param {string} options.answer - User's answer to the current question
 * @returns {Promise<Object>} Next question or completion status
 */
async function continueStory({ story_id, answer }) {
  // Get session
  const storyContext = getSessionFromStorage(story_id);
  if (!storyContext) {
    throw new Error(`Story session not found: ${story_id}`);
  }

  if (storyContext.state !== SESSION_STATES.ACTIVE) {
    throw new Error(`Story session is not active: ${storyContext.state}`);
  }

  // Validate answer
  if (!answer || answer.trim().length < 2) {
    return {
      error: "Please provide a more detailed answer",
      current_question: storyContext.currentQuestion?.question,
      progress: getProgress(storyContext),
    };
  }

  const trimmedAnswer = answer.trim();

  // Get the model
  const { model } = getModelForOccasion(storyContext.occasion);

  // Record the answer
  const currentQuestion = storyContext.currentQuestion;
  storyContext.answers.push({
    question: currentQuestion?.question,
    answer: trimmedAnswer,
    element_target: currentQuestion?.elementTarget,
    answered_at: new Date().toISOString(),
  });

  // Check for vague answers that won't help the story
  if (isVagueAnswer(trimmedAnswer)) {
    return {
      error: "That's a bit vague - can you share a specific memory or detail?",
      current_question: storyContext.currentQuestion?.question,
      progress: getProgress(storyContext),
      hint: "Think about a specific moment, place, or feeling",
    };
  }

  // Extract story signals from the answer (multi-element extraction)
  const extraction = await extractStorySignals(trimmedAnswer, storyContext, model);

  // Merge extracted signals into story elements
  // This allows one answer to populate multiple elements
  if (Object.keys(extraction.signals).length > 0) {
    storyContext.elements = mergeSignals(storyContext.elements, extraction.signals);
  } else if (currentQuestion?.elementTarget) {
    // Fallback: if no signals extracted, assign to target element
    const existing = storyContext.elements[currentQuestion.elementTarget] || "";
    storyContext.elements[currentQuestion.elementTarget] = existing
      ? `${existing} ${trimmedAnswer}`
      : trimmedAnswer;
  }

  // Use anchors from extraction (LLM-detected) or fall back to model's heuristic
  const newAnchors =
    extraction.anchors.length > 0
      ? extraction.anchors
      : model.extractAnchors(trimmedAnswer);

  // Deduplicate anchors - only add if not already in pending
  const existingWords = new Set(
    storyContext.pendingAnchors.map((a) => a.word.toLowerCase())
  );
  const uniqueAnchors = newAnchors.filter(
    (a) => !existingWords.has(a.word.toLowerCase())
  );
  storyContext.pendingAnchors.push(...uniqueAnchors);

  // Update timestamp
  storyContext.updated_at = new Date().toISOString();

  // Update turn with answer in DB
  if (useDatabase()) {
    const latestTurn = storyRepository.getLatestUnansweredTurn(story_id);
    if (latestTurn) {
      storyRepository.updateTurnAnswer(latestTurn.id, trimmedAnswer, {
        elementTarget: currentQuestion?.elementTarget,
        anchorsExtracted: uniqueAnchors.map((a) => a.word),
      });
    }
  }

  // Check if story is complete
  const completionStatus = model.isStoryComplete(storyContext);

  if (completionStatus.complete) {
    // Story is complete - generate summary for confirmation
    storyContext.state = SESSION_STATES.READY_FOR_CONFIRM;

    const summary = await generateStorySummary(storyContext, model);
    storyContext.summary = summary;

    // Update session
    saveSessionToStorage(story_id, storyContext);

    return {
      complete: true,
      story_summary: summary.summary_text,
      soul_of_story: summary.soul,
      progress: completionStatus.progress,
      ready_for_confirmation: true,
      elements_filled: completionStatus.filledElements,
      total_elements: completionStatus.totalElements,
    };
  }

  // Not complete - generate next question
  const nextQuestion = await generateNextQuestion(storyContext, model);

  // Record the question
  storyContext.questions.push({
    question: nextQuestion.question,
    element_target: nextQuestion.elementTarget,
    asked_at: new Date().toISOString(),
  });
  storyContext.questionCount++;
  storyContext.currentQuestion = nextQuestion;

  // Remove used anchor if this was a follow-up
  if (nextQuestion.anchorWord) {
    storyContext.pendingAnchors = storyContext.pendingAnchors.filter(
      (a) => a.word.toLowerCase() !== nextQuestion.anchorWord.toLowerCase()
    );
  }

  // Update session
  saveSessionToStorage(story_id, storyContext);

  // Add turn to DB
  if (useDatabase()) {
    storyRepository.addTurn(story_id, {
      question: nextQuestion.question,
      elementTarget: nextQuestion.elementTarget,
      isFollowUp: nextQuestion.isFollowUp || false,
      anchorWord: nextQuestion.anchorWord,
    });
  }

  return {
    complete: false,
    next_question: nextQuestion.question,
    progress: completionStatus.progress,
    questions_asked: storyContext.questionCount,
    story_so_far: buildStorySoFar(storyContext),
  };
}

/**
 * Get story summary for user confirmation
 *
 * @param {string} story_id - The story session ID
 * @returns {Promise<Object>} { summary_text, soul_of_story, can_proceed }
 */
async function getStorySummary(story_id) {
  const storyContext = getSessionFromStorage(story_id);
  if (!storyContext) {
    throw new Error(`Story session not found: ${story_id}`);
  }

  // If we already have a summary, return it
  if (storyContext.summary) {
    return {
      summary_text: storyContext.summary.summary_text,
      soul_of_story: storyContext.summary.soul,
      can_proceed: storyContext.state === SESSION_STATES.READY_FOR_CONFIRM,
      recipient_name: storyContext.recipient_name,
      arc: storyContext.arc,
    };
  }

  // Generate summary
  const { model } = getModelForOccasion(storyContext.occasion);
  const summary = await generateStorySummary(storyContext, model);
  storyContext.summary = summary;
  saveSessionToStorage(story_id, storyContext);

  return {
    summary_text: summary.summary_text,
    soul_of_story: summary.soul,
    can_proceed: true,
    recipient_name: storyContext.recipient_name,
    arc: storyContext.arc,
  };
}

/**
 * Confirm the story and mark ready for lyrics generation
 *
 * @param {string} story_id - The story session ID
 * @param {string} [additional_notes] - Any additional notes from user
 * @returns {Object} Confirmation status
 */
function confirmStory(story_id, additional_notes) {
  const storyContext = getSessionFromStorage(story_id);
  if (!storyContext) {
    throw new Error(`Story session not found: ${story_id}`);
  }

  if (additional_notes) {
    storyContext.additional_notes = additional_notes;
  }

  storyContext.state = SESSION_STATES.CONFIRMED;
  storyContext.confirmed_at = new Date().toISOString();
  saveSessionToStorage(story_id, storyContext);

  return {
    confirmed: true,
    story_id,
    ready_for_lyrics: true,
  };
}

/**
 * Get the full story context for lyrics generation
 *
 * @param {string} story_id - The story session ID
 * @returns {Object} Full story context
 */
function getStoryContext(story_id) {
  const storyContext = getSessionFromStorage(story_id);
  if (!storyContext) {
    throw new Error(`Story session not found: ${story_id}`);
  }

  return {
    story_id: storyContext.story_id,
    initial_prompt: storyContext.initial_prompt,
    recipient_name: storyContext.recipient_name,
    occasion: storyContext.occasion,
    style: storyContext.style,
    arc: storyContext.arc,
    elements: storyContext.elements,
    summary: storyContext.summary,
    additional_notes: storyContext.additional_notes,
    state: storyContext.state,
    conversation: storyContext.answers,
  };
}

/**
 * Add more details to an existing story (after confirmation prompt)
 *
 * @param {string} story_id - The story session ID
 * @param {string} additional_detail - More context from user
 * @returns {Promise<Object>} Updated summary
 */
async function addMoreDetails(story_id, additional_detail) {
  const storyContext = getSessionFromStorage(story_id);
  if (!storyContext) {
    throw new Error(`Story session not found: ${story_id}`);
  }

  // Get the model to use for signal extraction
  const { model } = getModelForOccasion(storyContext.occasion);

  // Use signal extraction to route to proper elements
  const extraction = await extractStorySignals(additional_detail, storyContext, model);

  // Merge extracted signals into story elements
  if (Object.keys(extraction.signals).length > 0) {
    storyContext.elements = mergeSignals(storyContext.elements, extraction.signals);
  } else {
    // Fallback: if no signals extracted, add to generic "additional" element
    const existing = storyContext.elements.additional || "";
    storyContext.elements.additional = existing
      ? `${existing} ${additional_detail}`
      : additional_detail;
  }

  // Mark as active again for more questions if needed
  storyContext.state = SESSION_STATES.ACTIVE;

  // Regenerate summary
  const summary = await generateStorySummary(storyContext, model);
  storyContext.summary = summary;

  // Check if we should ask more questions or just confirm
  const completionStatus = model.isStoryComplete(storyContext);
  if (completionStatus.complete || completionStatus.reachedMaxQuestions) {
    storyContext.state = SESSION_STATES.READY_FOR_CONFIRM;
  }

  saveSessionToStorage(story_id, storyContext);

  return {
    summary_text: summary.summary_text,
    soul_of_story: summary.soul,
    ready_for_confirmation: storyContext.state === SESSION_STATES.READY_FOR_CONFIRM,
  };
}

/**
 * Cancel a story session
 *
 * @param {string} story_id - The story session ID
 */
function cancelStory(story_id) {
  const storyContext = getSessionFromStorage(story_id);
  if (storyContext) {
    storyContext.state = SESSION_STATES.CANCELLED;
    saveSessionToStorage(story_id, storyContext);
  }
}

// ============ Helper Functions ============

/**
 * Analyze initial prompt to extract any story elements already present
 * Uses signal extraction to populate elements from the initial prompt
 *
 * @param {string} prompt - Initial prompt text
 * @param {Object} model - Story model
 * @param {string} recipientName - Recipient name for context
 * @returns {Promise<Object>} { detectedElements, anchors }
 */
async function analyzeInitialPrompt(prompt, model, recipientName) {
  // Create minimal context for signal extraction
  const minimalContext = {
    recipient_name: recipientName,
    elements: {},
    arcContext: model.getArcContext(),
  };

  // Use signal extraction to find any elements in the initial prompt
  const extraction = await extractStorySignals(prompt, minimalContext, model);

  // If prompt is long enough and we got signals, use them
  // But mark them as from initial (may need follow-up)
  const detectedElements = {};
  if (prompt.trim().length > 30 && Object.keys(extraction.signals).length > 0) {
    for (const [elementId, content] of Object.entries(extraction.signals)) {
      // Only include if the content is substantial
      if (content && content.trim().length > 15) {
        detectedElements[elementId] = content;
      }
    }
  }

  // If prompt contains location indicators, note the setting might be present
  const lowerPrompt = prompt.toLowerCase();
  const locationWords = ["at the", "in the", "on the", "at a", "in a"];
  const hasLocation = locationWords.some((w) => lowerPrompt.includes(w));

  return {
    detectedElements,
    anchors: extraction.anchors,
    hasLocationHint: hasLocation,
  };
}

/**
 * Get progress percentage
 */
function getProgress(storyContext) {
  const { model } = getModelForOccasion(storyContext.occasion);
  const status = model.isStoryComplete(storyContext);
  return status.progress;
}

/**
 * Build a brief "story so far" for context
 */
function buildStorySoFar(storyContext) {
  const parts = [];

  if (storyContext.initial_prompt) {
    parts.push(storyContext.initial_prompt);
  }

  for (const [key, value] of Object.entries(storyContext.elements)) {
    if (value && value.length > 0) {
      parts.push(value);
    }
  }

  return parts.join(" ").slice(0, 500); // Limit length
}

/**
 * Clean up old sessions (call periodically)
 * For in-memory: cleans the Map
 * For DB: calls repository.expireStaleSessions()
 */
function cleanupOldSessions(maxAgeMs = 24 * 60 * 60 * 1000) {
  if (useDatabase()) {
    const maxAgeHours = Math.floor(maxAgeMs / (60 * 60 * 1000));
    return storyRepository.expireStaleSessions(maxAgeHours);
  }

  // In-memory cleanup
  const now = Date.now();
  let cleaned = 0;
  for (const [id, session] of storySessions.entries()) {
    const age = now - new Date(session.updated_at).getTime();
    if (age > maxAgeMs) {
      storySessions.delete(id);
      cleaned++;
    }
  }
  return cleaned;
}

module.exports = {
  startStory,
  continueStory,
  getStorySummary,
  confirmStory,
  getStoryContext,
  addMoreDetails,
  cancelStory,
  cleanupOldSessions,
  initWithRepository,
  SESSION_STATES,
};
