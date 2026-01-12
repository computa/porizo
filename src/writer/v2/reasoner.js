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

module.exports = {
  buildReasoningPrompt,
  parseReasoningResponse,
  reason,
};
