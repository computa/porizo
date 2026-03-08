/**
 * V3 Lightweight LLM Fallback
 *
 * When primary LLM fails, use a lightweight model (Haiku/GPT-3.5)
 * with a concise prompt before falling back to heuristics.
 *
 * @module writer/v3/fallback-llm
 */

const { generateText, isAvailable } = require("../../services/llm-provider");

/**
 * Valid actions for lightweight model responses
 */
const VALID_ACTIONS = ["ASK", "CLARIFY", "CONFIRM", "STOP"];

/**
 * Build a concise prompt for lightweight model (Haiku/GPT-3.5)
 *
 * Optimized for:
 * - Minimal tokens (<500 chars target)
 * - Clear decision framing
 * - Essential context only
 *
 * @param {Object} state - V3 story state
 * @param {string} userInput - User's latest input
 * @returns {string} Concise prompt for lightweight model
 */
function buildLightweightPrompt(state, userInput) {
  // Extract key facts (limit to 3 most recent)
  const factList = (state.facts || [])
    .slice(-3)
    .map(f => f.text)
    .join("; ");

  // Find weak beats (strength < 0.5) and get their purposes
  const weakBeats = (state.beats || [])
    .filter(b => (typeof b.strength === "number" ? b.strength < 0.5 : b.status !== "covered"))
    .map(b => b.purpose)
    .slice(0, 2)
    .join(", ");

  // Build concise prompt
  return `Story for ${state.recipient_name || "someone"}.
Facts: ${factList || "none yet"}
Weak: ${weakBeats || "none"}
Turn: ${state.turn_count || 1}
User: "${userInput}"

Action: ASK (need more) | CONFIRM (enough depth) | CLARIFY (unclear) | STOP (user wants to stop)
JSON: {"action":"...", "message":"..."}`;
}

/**
 * Parse response from lightweight model
 *
 * Handles:
 * - Raw JSON
 * - JSON wrapped in markdown code blocks
 * - Malformed responses
 *
 * @param {string} responseText - Raw response from lightweight model
 * @returns {{success: boolean, data?: Object, error?: string}}
 */
function parseLightweightResponse(responseText) {
  try {
    let jsonText = responseText;

    // Extract JSON from markdown code block if present
    const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1].trim();
    }

    // Try to find JSON object in response
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    const data = JSON.parse(jsonText);

    // Validate action field
    if (!data.action) {
      return { success: false, error: "Missing action field" };
    }

    if (!VALID_ACTIONS.includes(data.action)) {
      return { success: false, error: `Invalid action: ${data.action}` };
    }

    return { success: true, data };
  } catch (err) {
    return { success: false, error: `Parse error: ${err.message}` };
  }
}

/**
 * Call lightweight model as fallback
 *
 * This is a stub that will be wired to actual LLM call.
 * For now, returns null to indicate fallback unavailable.
 *
 * @param {Object} state - V3 story state
 * @param {string} userInput - User's latest input
 * @param {Object} options - Options including llmClient
 * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
 */
async function callLightweightModel(state, userInput, options = {}) {
  const { llmClient, _generateTextFn } = options;
  const generateTextFn = _generateTextFn || generateText;

  if (!llmClient && !_generateTextFn && !isAvailable()) {
    return { success: false, error: "No lightweight LLM client configured" };
  }

  try {
    const prompt = buildLightweightPrompt(state, userInput);

    if (llmClient) {
      const response = await llmClient.generate({
        model: options.model || "claude-3-haiku-20240307",
        prompt,
        maxTokens: 180,
        temperature: 0.2,
      });
      return parseLightweightResponse(response);
    }

    const response = await generateTextFn({
      prompt,
      taskType: "simple",
      temperature: 0.2,
      responseMimeType: "application/json",
      maxOutputTokens: 180,
      providers: ["anthropic", "openai", "gemini"],
    });

    if (!response?.text) {
      return { success: false, error: "Lightweight model returned empty response" };
    }

    return parseLightweightResponse(response.text);
  } catch (err) {
    return { success: false, error: `LLM call failed: ${err.message}` };
  }
}

module.exports = {
  VALID_ACTIONS,
  buildLightweightPrompt,
  parseLightweightResponse,
  callLightweightModel,
};
