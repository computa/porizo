/**
 * V2 Safety Bounds
 *
 * Safety-only validation module. The harness ONLY enforces hard limits
 * and structural validation - it never makes quality judgments.
 *
 * Philosophy: "The harness doesn't make decisions—it validates LLM decisions
 * and provides safety backups."
 *
 * @module writer/v2/safety
 */

/**
 * Safety bounds - the ONLY things the harness can override
 * These are hard limits, not quality judgments.
 */
const SAFETY_BOUNDS = {
  maxTurns: 20,                 // Maximum conversation turns
  maxNarrativeLength: 2000,     // Max characters in narrative
  maxFactsPerTurn: 5,           // Max facts to add per turn
  minQuestionLength: 5,         // Min characters for a question
  maxQuestionLength: 500,       // Max characters for a question
};

/**
 * Valid action types
 */
const VALID_ACTIONS = ["ASK", "CLARIFY", "CONFIRM", "STOP"];

/**
 * Validate response structure (NO quality judgments)
 *
 * Only checks:
 * - Required fields exist
 * - Field types are correct
 * - Values are within safety bounds
 *
 * Does NOT check:
 * - Question quality or relevance
 * - Beat coverage adequacy
 * - Story completeness
 *
 * @param {Object} response - LLM response to validate
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateStructure(response) {
  const errors = [];

  // Check action exists and is valid
  if (!response.action) {
    errors.push("Missing required field: action");
  } else if (!VALID_ACTIONS.includes(response.action)) {
    errors.push(`Invalid action: ${response.action}. Must be one of: ${VALID_ACTIONS.join(", ")}`);
  }

  // Action-specific validation
  if (response.action === "ASK" || response.action === "CLARIFY") {
    if (!response.question) {
      errors.push(`${response.action} action requires question field`);
    } else {
      // Length bounds (safety, not quality)
      if (response.question.length < SAFETY_BOUNDS.minQuestionLength) {
        errors.push(`Question too short (min ${SAFETY_BOUNDS.minQuestionLength} chars)`);
      }
      if (response.question.length > SAFETY_BOUNDS.maxQuestionLength) {
        errors.push(`Question too long (max ${SAFETY_BOUNDS.maxQuestionLength} chars)`);
      }
    }
  }

  if (response.action === "CONFIRM") {
    if (!response.confirmation) {
      errors.push("CONFIRM action requires confirmation field");
    }
  }

  // STOP action requires no additional fields

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Apply safety bounds to decision (limits only, NO quality override)
 *
 * Can only override in these cases:
 * - Max turns reached → force CONFIRM
 *
 * Does NOT override based on:
 * - Fatigue signals
 * - Beat coverage
 * - Content quality
 *
 * @param {Object} state - V2 state
 * @param {Object} decision - LLM decision to potentially bound
 * @returns {{decision: Object, warnings: string[]}}
 */
function applySafetyBounds(state, decision) {
  const warnings = [];
  const newDecision = { ...decision };
  const turnCount = state.turn_count || 0;

  // Safety bound: force CONFIRM after max turns (for ASK only)
  if (turnCount >= SAFETY_BOUNDS.maxTurns && decision.action === "ASK") {
    newDecision.action = "CONFIRM";
    newDecision.forced = true;
    newDecision.forcedReason = "max_turns";
    newDecision.confirmation = newDecision.confirmation ||
      `I've gathered enough details about ${state.recipient_name || "your story"}. Let's work with what we have.`;
    warnings.push(`Turn limit (${SAFETY_BOUNDS.maxTurns}) reached, forcing CONFIRM`);
  }

  // CLARIFY also gets bounded at max turns
  if (turnCount >= SAFETY_BOUNDS.maxTurns && decision.action === "CLARIFY") {
    newDecision.action = "CONFIRM";
    newDecision.forced = true;
    newDecision.forcedReason = "max_turns";
    newDecision.confirmation = newDecision.confirmation ||
      `Let's work with what we have so far.`;
    warnings.push(`Turn limit (${SAFETY_BOUNDS.maxTurns}) reached, forcing CONFIRM`);
  }

  return {
    decision: newDecision,
    warnings,
  };
}

/**
 * Check if state is within all safety bounds
 *
 * @param {Object} state - V2 state
 * @returns {{safe: boolean, violations: string[]}}
 */
function checkStateSafety(state) {
  const violations = [];

  if ((state.turn_count || 0) > SAFETY_BOUNDS.maxTurns) {
    violations.push(`Turn count (${state.turn_count}) exceeds max (${SAFETY_BOUNDS.maxTurns})`);
  }

  if ((state.narrative?.length || 0) > SAFETY_BOUNDS.maxNarrativeLength) {
    violations.push(`Narrative length (${state.narrative.length}) exceeds max (${SAFETY_BOUNDS.maxNarrativeLength})`);
  }

  return {
    safe: violations.length === 0,
    violations,
  };
}

module.exports = {
  SAFETY_BOUNDS,
  VALID_ACTIONS,
  validateStructure,
  applySafetyBounds,
  checkStateSafety,
};
