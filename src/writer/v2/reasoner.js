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
const { buildLightweightPrompt, parseLightweightResponse, callLightweightModel } = require("./fallback-llm");
const { generateSmartHeuristicFallback } = require("./engine");

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

    // Clamp strength values to 0-1 range
    // Support both v3 (updates.beats) and legacy (beats) locations
    const beatsToProcess = data.updates?.beats || data.beats;
    if (beatsToProcess && Array.isArray(beatsToProcess)) {
      for (const beat of beatsToProcess) {
        if (typeof beat.strength === "number") {
          beat.strength = Math.max(0, Math.min(1, beat.strength));
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
 * Run unified reasoning on user input
 *
 * @param {Object} state - Current V2 state
 * @param {string} userInput - User's new input
 * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
 */
async function reason(state, userInput) {
  if (!isAvailable()) {
    return {
      success: false,
      error: "LLM not available",
      fallback: true,
    };
  }

  const prompt = buildReasoningPrompt(state, userInput);

  try {
    const response = await generateText({
      prompt,
      taskType: "lyrics", // Use same model as lyrics generation
      temperature: 0.7,
    });

    const parsed = parseReasoningResponse(response);

    if (!parsed.success) {
      console.error("[V2 Reasoner] Parse error:", parsed.error);
      console.error("[V2 Reasoner] Raw response:", response.substring(0, 500));
    }

    return parsed;
  } catch (err) {
    console.error("[V2 Reasoner] LLM error:", err.message);
    return {
      success: false,
      error: err.message,
    };
  }
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
  // Add the user input to conversation for done signal detection
  const stateWithInput = {
    ...state,
    conversation: [
      ...(state.conversation || []),
      { role: "user", content: userInput },
    ],
  };

  const heuristicResponse = generateSmartHeuristicFallback(stateWithInput);

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
  };
}

module.exports = {
  buildReasoningPrompt,
  parseReasoningResponse,
  reason,
  reasonWithFallback,
};
