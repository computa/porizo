/**
 * V2 Reasoner
 *
 * Unified reasoning module that handles perception, reasoning, and action
 * selection in a single LLM call.
 *
 * @module writer/v2/reasoner
 */

const fs = require("fs");
const path = require("path");
const { generateText, isAvailable } = require("../../services/llm-provider");

// Load prompt template at module level (cached)
const PROMPT_TEMPLATE_PATH = path.join(__dirname, "prompts", "reason.md");
const PROMPT_TEMPLATE = (() => {
  try {
    return fs.readFileSync(PROMPT_TEMPLATE_PATH, "utf-8");
  } catch (err) {
    // CRITICAL: This is a deployment failure - should trigger alerts
    console.error("[V2 Reasoner] CRITICAL: Failed to load prompt template");
    console.error("[V2 Reasoner] Path:", PROMPT_TEMPLATE_PATH);
    console.error("[V2 Reasoner] Error:", err.code, err.message);
    console.error("[V2 Reasoner] Falling back to degraded inline template");
    return null;
  }
})();

/**
 * Build the reasoning prompt with current state
 *
 * @param {Object} state - Current V2 state
 * @param {string} userInput - User's new input
 * @returns {string} Formatted prompt
 */
function buildReasoningPrompt(state, userInput) {
  // Use cached template or fallback
  const template = PROMPT_TEMPLATE || getInlineTemplate();

  // Replace placeholders
  let prompt = template
    .replace("{{recipient_name}}", state.recipient_name || "")
    .replace("{{occasion}}", state.event?.occasion || state.initial_prompt || "")
    .replace("{{narrative}}", state.narrative || "(No narrative yet)")
    .replace("{{user_input}}", userInput);

  // Build beats table (defensive: handle undefined)
  const beatsTable = (state.beats || []).map(beat =>
    `| ${beat.id} | ${beat.purpose} | ${beat.status} | ${beat.evidence?.join(", ") || "none"} |`
  ).join("\n");
  prompt = prompt.replace(/{{#each beats}}[\s\S]*?{{\/each}}/g, beatsTable || "| (no beats yet) | | | |");

  // Build conversation history (defensive: handle undefined)
  const conversationHistory = (state.conversation || []).map(turn =>
    `**${turn.role}:** ${turn.content}`
  ).join("\n\n");
  prompt = prompt.replace(/{{#each conversation}}[\s\S]*?{{\/each}}/g, conversationHistory || "(New conversation)");

  return prompt;
}

/**
 * Parse the LLM response into structured data
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

    // Validate required fields exist
    const requiredFields = ["action", "narrative", "reasoning"];
    const missingFields = requiredFields.filter(f => !data[f]);

    if (missingFields.length > 0) {
      return {
        success: false,
        error: `Missing required fields: ${missingFields.join(", ")}`,
        raw: response,
      };
    }

    // Type validation for required fields
    if (typeof data.action !== "string") {
      return {
        success: false,
        error: `action must be a string, got ${typeof data.action}`,
        raw: response,
      };
    }
    if (typeof data.narrative !== "string") {
      return {
        success: false,
        error: `narrative must be a string, got ${typeof data.narrative}`,
        raw: response,
      };
    }
    if (typeof data.reasoning !== "object" || data.reasoning === null) {
      return {
        success: false,
        error: "reasoning must be an object",
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
 * Inline template fallback (for testing without file access)
 */
function getInlineTemplate() {
  return `You are a story collector helping someone create a personalized song.

**Recipient:** {{recipient_name}}
**Occasion:** {{occasion}}
**Narrative so far:** {{narrative}}
**Conversation:** {{#each conversation}}{{role}}: {{content}}{{/each}}
**User's new input:** {{user_input}}

Analyze the input and respond with JSON:
{
  "reasoning": { "new_facts": [], "decision": "ASK|CLARIFY|CONFIRM|STOP", "decision_reason": "" },
  "narrative": "updated narrative",
  "beats": [],
  "user_model": { "style": "brief", "fatigue_signals": 0, "tone_preference": "neutral" },
  "action": "ASK|CLARIFY|CONFIRM|STOP",
  "question": "question if ASK"
}`;
}

module.exports = {
  buildReasoningPrompt,
  parseReasoningResponse,
  reason,
};
