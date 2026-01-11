/**
 * Story Engine
 *
 * The core conversation engine that manages dynamic story extraction.
 * Uses arc-specific models to determine what questions to ask and
 * when the story is complete enough to generate lyrics.
 *
 * Key principle: Each answer informs the next question.
 * The system builds context iteratively, not all-at-once.
 */

const { v4: uuidv4 } = require("uuid");
const { getModelForOccasion } = require("./story-models");
const { generateNextQuestion, generateStorySummary } = require("./question-generator");

/**
 * In-memory story session storage
 * In production, this would be backed by a database
 */
const storySessions = new Map();

/**
 * Story session states
 */
const SESSION_STATES = {
  ACTIVE: "active",           // Still asking questions
  READY_FOR_CONFIRM: "ready", // Story complete, awaiting confirmation
  CONFIRMED: "confirmed",     // User confirmed, ready for lyrics
  CANCELLED: "cancelled",     // User cancelled
};

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
  const initialAnalysis = analyzeInitialPrompt(initial_prompt, model);
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
  storySessions.set(story_id, storyContext);

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
  const storyContext = storySessions.get(story_id);
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

  // Update the relevant story element
  if (currentQuestion?.elementTarget) {
    // Append to existing content if element already has some
    const existing = storyContext.elements[currentQuestion.elementTarget] || "";
    storyContext.elements[currentQuestion.elementTarget] = existing
      ? `${existing} ${trimmedAnswer}`
      : trimmedAnswer;
  }

  // Extract anchors from this answer for potential follow-up
  const newAnchors = model.extractAnchors(trimmedAnswer);
  storyContext.pendingAnchors.push(...newAnchors);

  // Update timestamp
  storyContext.updated_at = new Date().toISOString();

  // Check if story is complete
  const completionStatus = model.isStoryComplete(storyContext);

  if (completionStatus.complete) {
    // Story is complete - generate summary for confirmation
    storyContext.state = SESSION_STATES.READY_FOR_CONFIRM;

    const summary = await generateStorySummary(storyContext, model);
    storyContext.summary = summary;

    // Update session
    storySessions.set(story_id, storyContext);

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

  // Update session
  storySessions.set(story_id, storyContext);

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
  const storyContext = storySessions.get(story_id);
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
  storySessions.set(story_id, storyContext);

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
  const storyContext = storySessions.get(story_id);
  if (!storyContext) {
    throw new Error(`Story session not found: ${story_id}`);
  }

  if (additional_notes) {
    storyContext.additional_notes = additional_notes;
  }

  storyContext.state = SESSION_STATES.CONFIRMED;
  storyContext.confirmed_at = new Date().toISOString();
  storySessions.set(story_id, storyContext);

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
  const storyContext = storySessions.get(story_id);
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
  const storyContext = storySessions.get(story_id);
  if (!storyContext) {
    throw new Error(`Story session not found: ${story_id}`);
  }

  // Add the detail to a generic "additional" element
  const existing = storyContext.elements.additional || "";
  storyContext.elements.additional = existing
    ? `${existing} ${additional_detail}`
    : additional_detail;

  // Mark as active again for more questions if needed
  storyContext.state = SESSION_STATES.ACTIVE;

  // Regenerate summary
  const { model } = getModelForOccasion(storyContext.occasion);
  const summary = await generateStorySummary(storyContext, model);
  storyContext.summary = summary;

  // Check if we should ask more questions or just confirm
  const completionStatus = model.isStoryComplete(storyContext);
  if (completionStatus.complete || completionStatus.reachedMaxQuestions) {
    storyContext.state = SESSION_STATES.READY_FOR_CONFIRM;
  }

  storySessions.set(story_id, storyContext);

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
  const storyContext = storySessions.get(story_id);
  if (storyContext) {
    storyContext.state = SESSION_STATES.CANCELLED;
    storySessions.set(story_id, storyContext);
  }
}

// ============ Helper Functions ============

/**
 * Analyze initial prompt to extract any elements already present
 */
function analyzeInitialPrompt(prompt, model) {
  const detected = {};
  const anchors = [];
  const lowerPrompt = prompt.toLowerCase();

  // Check each element's anchor words
  for (const [elementId, element] of Object.entries(model.STORY_ELEMENTS)) {
    for (const anchor of element.anchorWords || []) {
      if (lowerPrompt.includes(anchor)) {
        // Don't mark as filled, but note it for context
        anchors.push({
          word: anchor,
          element: elementId,
          fromInitial: true,
        });
      }
    }
  }

  // If prompt contains location indicators, note the setting might be present
  const locationWords = ["at", "in", "on", "the"];
  const hasLocation = locationWords.some((w) => lowerPrompt.includes(` ${w} `));

  return {
    detectedElements: detected,
    anchors,
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
 */
function cleanupOldSessions(maxAgeMs = 24 * 60 * 60 * 1000) {
  const now = Date.now();
  for (const [id, session] of storySessions.entries()) {
    const age = now - new Date(session.updated_at).getTime();
    if (age > maxAgeMs) {
      storySessions.delete(id);
    }
  }
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
  SESSION_STATES,
};
