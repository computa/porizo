/**
 * V2 Reasoner
 *
 * Unified reasoning module that handles perception, reasoning, and action
 * selection in a single LLM call.
 *
 * V3 Update: Uses context-only prompts without embedded decision rules.
 * The LLM makes all qualitative decisions; the harness only validates structure.
 *
 * @module writer/v2/reasoner
 */

const { generateText, isAvailable } = require("../../services/llm-provider");
const { buildContextPrompt } = require("./prompts/builder");
const { callLightweightModel } = require("./fallback-llm");
const { generateSmartHeuristicFallback } = require("./engine");

/**
 * Retry configuration for LLM calls
 * Exponential backoff: delay = baseDelay * 2^attempt (capped at maxDelay)
 */
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 16000,
  // Transient errors that warrant retry (timeout, rate limit, network, server errors)
  retryableErrors: [
    "timeout",
    "rate limit",
    "rate_limit",
    "429",
    // More specific 500 patterns to avoid false positives like "user ID 1500"
    "status 500",
    " 500 ",
    "500 internal",
    "502",
    "503",
    "504",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "ECONNREFUSED",
    "network",
    "overload", // Matches both "overload" and "overloaded"
    "empty response", // For retrying empty LLM responses
  ],
};

/**
 * Check if an error is transient and worth retrying
 * @param {string} errorMessage - Error message to check
 * @returns {boolean} True if error is retryable
 */
function isRetryableError(errorMessage) {
  if (!errorMessage) return false;
  const lowerMsg = errorMessage.toLowerCase();
  return RETRY_CONFIG.retryableErrors.some(pattern =>
    lowerMsg.includes(pattern.toLowerCase())
  );
}

/**
 * Sleep for a given number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate delay for exponential backoff
 * @param {number} attempt - Current attempt number (0-indexed)
 * @returns {number} Delay in milliseconds
 */
function getBackoffDelay(attempt) {
  const delay = RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt);
  return Math.min(delay, RETRY_CONFIG.maxDelayMs);
}

/**
 * Build the reasoning prompt with current state
 *
 * V3: Uses context-only prompt without embedded decision rules.
 * The LLM makes all qualitative decisions holistically.
 *
 * @param {Object} state - Current V2 state
 * @param {string} userInput - User's new input
 * @returns {string} Formatted prompt
 */
function buildReasoningPrompt(state, userInput) {
  // Use v3 context-only prompt builder
  return buildContextPrompt(state, userInput);
}

/**
 * Parse the LLM response into structured data
 *
 * Supports both v3 and legacy response formats:
 * - V3: { decision: { action }, updates: { beats }, output: { question } }
 * - Legacy: { action, question, narrative, beats }
 *
 * @param {string} response - Raw LLM response
 * @returns {{success: boolean, data?: Object, error?: string, raw?: string}}
 */
function parseReasoningResponse(response) {
  try {
    // Try to extract JSON from markdown code blocks
    let jsonStr = response;
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    // Try to find JSON object in response
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        success: false,
        error: "No JSON object found in response",
        raw: response,
      };
    }
    jsonStr = jsonMatch[0];

    const data = JSON.parse(jsonStr);

    // Normalize v3 format to legacy format for backward compatibility
    // V3 has: decision.action, output.question, updates.narrative
    // Legacy has: action, question, narrative
    if (data.decision?.action && !data.action) {
      data.action = data.decision.action;
    }
    if (data.output?.question && !data.question) {
      data.question = data.output.question;
    }
    if (data.output?.confirmation && !data.confirmation) {
      data.confirmation = data.output.confirmation;
    }
    if (data.updates?.narrative && !data.narrative) {
      data.narrative = data.updates.narrative;
    }

    // Normalize updates to legacy fields for engine compatibility
    if (data.updates?.beats && !data.beats) {
      data.beats = data.updates.beats;
    }
    if (data.updates?.new_facts && !data.reasoning?.new_facts) {
      data.reasoning = data.reasoning || {};
      data.reasoning.new_facts = data.updates.new_facts;
    }
    if (data.updates?.event && !data.event) {
      data.event = data.updates.event;
    }

    // Validate required fields exist (action is required, others depend on action)
    if (!data.action) {
      return {
        success: false,
        error: "Missing required field: action",
        raw: response,
      };
    }

    // Validate action is one of allowed values
    if (!["ASK", "CLARIFY", "CONFIRM", "STOP"].includes(data.action)) {
      return {
        success: false,
        error: `Invalid action: ${data.action}`,
        raw: response,
      };
    }

    // If action is ASK, question is required
    if (data.action === "ASK" && !data.question) {
      return {
        success: false,
        error: "Action is ASK but no question provided",
        raw: response,
      };
    }

    // If action is CLARIFY, question is required
    if (data.action === "CLARIFY" && !data.question) {
      return {
        success: false,
        error: "Action is CLARIFY but no question provided",
        raw: response,
      };
    }

    // If action is CONFIRM, confirmation message is required
    if (data.action === "CONFIRM" && !data.confirmation) {
      return {
        success: false,
        error: "Action is CONFIRM but no confirmation message provided",
        raw: response,
      };
    }

    // Validate and correct strength values (with feedback, not silent)
    // Support both v3 (updates.beats) and legacy (beats) locations
    const beatsToProcess = data.updates?.beats || data.beats;
    if (beatsToProcess && Array.isArray(beatsToProcess)) {
      for (const beat of beatsToProcess) {
        if (typeof beat.strength === "number") {
          if (beat.strength < 0 || beat.strength > 1) {
            // Log warning - don't silently hide LLM errors
            console.warn(`[V2 Reasoner] Beat "${beat.id}" has out-of-range strength: ${beat.strength} (expected 0-1)`);
            // Track original value for debugging/monitoring
            beat._original_strength = beat.strength;
            beat._strength_corrected = true;
            // Clamp to valid range
            beat.strength = Math.max(0, Math.min(1, beat.strength));
          }
        }
      }
    }

    return {
      success: true,
      data,
    };
  } catch (err) {
    return {
      success: false,
      error: `JSON parse error: ${err.message}`,
      raw: response,
    };
  }
}

/**
 * Run unified reasoning on user input with retry logic
 *
 * Implements exponential backoff for transient errors (timeout, rate limit, network).
 * Does NOT retry on parse errors (those indicate LLM response issues).
 *
 * @param {Object} state - Current V2 state
 * @param {string} userInput - User's new input
 * @param {Object} options - Options for testing
 * @param {number} options.maxRetries - Override max retries (for testing)
 * @param {Function} options._sleepFn - Override sleep function (for testing)
 * @param {Function} options._generateTextFn - Override generateText (for testing)
 * @returns {Promise<{success: boolean, data?: Object, error?: string, retryCount?: number}>}
 */
async function reason(state, userInput, options = {}) {
  const generateTextFn = options._generateTextFn ?? generateText;

  // Skip availability check when using mock (for testing)
  if (!options._generateTextFn && !isAvailable()) {
    return {
      success: false,
      error: "LLM not available",
      fallback: true,
    };
  }

  const prompt = buildReasoningPrompt(state, userInput);
  const maxRetries = options.maxRetries ?? RETRY_CONFIG.maxRetries;
  const sleepFn = options._sleepFn ?? sleep;

  let lastError = null;
  let retryCount = 0;
  const errorHistory = []; // Track all errors for debugging

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await generateTextFn({
        prompt,
        taskType: "lyrics", // Use same model as lyrics generation
        temperature: 0.7,
      });

      // generateText returns { text, provider, model, usage, ... }
      // We need the text property for parsing
      if (!result || !result.text) {
        // Empty response is often transient (connection dropped, streaming failure)
        // Make it retryable by throwing
        throw new Error("LLM returned empty response");
      }

      const parsed = parseReasoningResponse(result.text);

      if (!parsed.success) {
        console.error("[V2 Reasoner] Parse error:", parsed.error);
        console.error("[V2 Reasoner] Raw response:", result.text.substring(0, 500));
        // Parse errors are NOT retryable - the LLM responded but with bad format
      }

      // Include retry count and error history in response for monitoring
      parsed.retryCount = retryCount;
      if (errorHistory.length > 0) {
        parsed.errorHistory = errorHistory;
      }
      return parsed;

    } catch (err) {
      // Track all errors for debugging
      errorHistory.push({
        attempt: attempt + 1,
        error: err.message,
        retryable: isRetryableError(err.message),
      });
      lastError = err.message;
      console.error(`[V2 Reasoner] LLM error (attempt ${attempt + 1}/${maxRetries + 1}):`, err.message);

      // Check if error is retryable
      if (isRetryableError(err.message) && attempt < maxRetries) {
        const delay = getBackoffDelay(attempt);
        console.warn(`[V2 Reasoner] Retrying in ${delay}ms...`);
        await sleepFn(delay);
        retryCount++;
      } else {
        // Non-retryable error or max retries exhausted
        break;
      }
    }
  }

  // All retries exhausted
  return {
    success: false,
    error: lastError,
    errorHistory,
    retryCount,
  };
}

/**
 * Run reasoning with three-tier fallback: Primary → Lightweight → Heuristic
 *
 * Gracefully degrades when higher-tier methods fail:
 * - Tier 1: Primary LLM (Sonnet) - Full reasoning with rich context
 * - Tier 2: Lightweight LLM (Haiku) - Concise prompt, fast response
 * - Tier 3: Smart Heuristics - Done signal detection + contextual questions
 *
 * @param {Object} state - Current V2 state
 * @param {string} userInput - User's new input
 * @param {Object} options - Options for testing/mocking
 * @param {Object} options.mockPrimaryResult - Mock primary LLM result (for testing)
 * @param {Object} options.mockLightweightResult - Mock lightweight result (for testing)
 * @returns {Promise<{success: boolean, data?: Object, tier: string, fallback: boolean}>}
 */
async function reasonWithFallback(state, userInput, options = {}) {
  const { mockPrimaryResult, mockLightweightResult } = options;

  // Tier 1: Primary LLM
  let primaryResult;
  if (mockPrimaryResult !== undefined) {
    // Use mock for testing
    primaryResult = mockPrimaryResult;
  } else {
    primaryResult = await reason(state, userInput);
  }

  if (primaryResult.success) {
    return {
      success: true,
      data: primaryResult.data,
      tier: "primary",
      fallback: false,
    };
  }

  console.warn("[V2 Reasoner] Primary LLM failed, trying lightweight fallback");
  console.warn("[V2 Reasoner] Primary error:", primaryResult.error);

  // Tier 2: Lightweight LLM (Haiku)
  let lightweightResult;
  if (mockLightweightResult !== undefined) {
    // Use mock for testing
    lightweightResult = mockLightweightResult;
  } else {
    lightweightResult = await callLightweightModel(state, userInput, options);
  }

  if (lightweightResult.success) {
    // Normalize lightweight response format
    const data = { ...lightweightResult.data };

    // Normalize message → question for ASK/CLARIFY actions
    if ((data.action === "ASK" || data.action === "CLARIFY") && data.message && !data.question) {
      data.question = data.message;
    }

    // Normalize message → confirmation for CONFIRM action
    if (data.action === "CONFIRM" && data.message && !data.confirmation) {
      data.confirmation = data.message;
    }

    return {
      success: true,
      data,
      tier: "lightweight",
      fallback: true,
    };
  }

  console.warn("[V2 Reasoner] Lightweight LLM failed, using heuristic fallback");
  console.warn("[V2 Reasoner] Lightweight error:", lightweightResult.error);

  // Tier 3: Smart Heuristics
  try {
    // Add the user input to conversation for done signal detection
    const stateWithInput = {
      ...state,
      conversation: [
        ...(state.conversation || []),
        { role: "user", content: userInput },
      ],
    };

    const heuristicResponse = generateSmartHeuristicFallback(stateWithInput);

    // Validate heuristic response has required fields
    if (!heuristicResponse || !heuristicResponse.action) {
      console.error("[V2 Reasoner] Heuristic returned invalid response:", heuristicResponse);
      return {
        success: false,
        error: "Heuristic fallback produced invalid response",
        tier: "heuristic",
        fallback: true,
      };
    }

    console.warn("[V2 Reasoner] Heuristic response:", heuristicResponse.action);

    // Normalize heuristic response to expected format
    const data = {
      action: heuristicResponse.action,
      question: heuristicResponse.question,
      confirmation: heuristicResponse.confirmation,
      targetBeat: heuristicResponse.targetBeat,
      reason: heuristicResponse.reason,
    };

    return {
      success: true,
      data,
      tier: "heuristic",
      fallback: true,
      confidence: "low", // Explicit signal that this is heuristic-based
    };
  } catch (err) {
    console.error("[V2 Reasoner] Heuristic fallback threw:", err.message);
    return {
      success: false,
      error: `Heuristic fallback failed: ${err.message}`,
      tier: "heuristic",
      fallback: true,
    };
  }
}

module.exports = {
  buildReasoningPrompt,
  parseReasoningResponse,
  reason,
  reasonWithFallback,
  // Exported for testing
  RETRY_CONFIG,
  isRetryableError,
  getBackoffDelay,
  sleep,
};
