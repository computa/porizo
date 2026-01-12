/**
 * V3 Prompt Builder
 *
 * Builds context-only prompts without embedded decision rules.
 * The LLM makes all qualitative decisions; the harness only validates structure.
 *
 * @module writer/v2/prompts/builder
 */

const fs = require("fs");
const path = require("path");

// Load prompt template at module level (cached)
const TEMPLATE_PATH = path.join(__dirname, "reason-v3.md");
const TEMPLATE = (() => {
  try {
    return fs.readFileSync(TEMPLATE_PATH, "utf-8");
  } catch (err) {
    console.error("[V3 Builder] Failed to load prompt template:", err.message);
    return null;
  }
})();

/**
 * Build context-only prompt for V3 reasoning
 *
 * Key difference from V2: No embedded decision rules.
 * Provides context and asks for holistic judgment.
 *
 * @param {Object} state - Current V2 state
 * @param {string} userInput - User's new input
 * @returns {string} Formatted prompt
 */
function buildContextPrompt(state, userInput) {
  if (!TEMPLATE) {
    return buildFallbackPrompt(state, userInput);
  }

  let prompt = TEMPLATE;

  // Basic context replacements
  prompt = prompt.replace(/\{\{recipient_name\}\}/g, state.recipient_name || "the recipient");
  prompt = prompt.replace(/\{\{occasion\}\}/g, state.event?.occasion || "celebration");
  prompt = prompt.replace(/\{\{narrative\}\}/g, state.narrative || "(No story yet)");
  prompt = prompt.replace(/\{\{user_input\}\}/g, userInput || "");

  // Build facts list
  const factsList = buildFactsList(state.facts);
  prompt = prompt.replace(/\{\{facts_list\}\}/g, factsList);

  // Build beats table with strength values
  const beatsTable = buildBeatsTable(state.beats);
  prompt = prompt.replace(/\{\{beats_table\}\}/g, beatsTable);

  // Build conversation history
  const conversationHistory = buildConversationHistory(state.conversation);
  prompt = prompt.replace(/\{\{conversation_history\}\}/g, conversationHistory);

  return prompt;
}

/**
 * Build facts list for prompt
 *
 * @param {Array} facts - Collected facts
 * @returns {string} Formatted facts list
 */
function buildFactsList(facts) {
  if (!facts || facts.length === 0) {
    return "(No facts collected yet)";
  }

  return facts.map(f => `- [${f.id}] ${f.text}`).join("\n");
}

/**
 * Build beats table with strength values
 *
 * @param {Array} beats - Story beats with strength
 * @returns {string} Formatted beats table
 */
function buildBeatsTable(beats) {
  if (!beats || beats.length === 0) {
    return "| (no beats defined) | | |";
  }

  return beats.map(beat => {
    const id = beat.id || "unknown";
    const purpose = beat.purpose || "";
    // Support both old status and new strength format
    const strength = typeof beat.strength === "number"
      ? beat.strength.toFixed(1)
      : statusToStrength(beat.status);
    return `| ${id} | ${purpose} | ${strength}/1.0 |`;
  }).join("\n");
}

/**
 * Convert old status to strength for backward compatibility
 *
 * @param {string} status - Old categorical status
 * @returns {string} Numeric strength as string
 */
function statusToStrength(status) {
  switch (status) {
    case "covered": return "1.0";
    case "weak": return "0.5";
    case "missing": return "0.0";
    default: return "0.0";
  }
}

/**
 * Build conversation history for prompt
 *
 * @param {Array} conversation - Conversation turns
 * @returns {string} Formatted conversation history
 */
function buildConversationHistory(conversation) {
  if (!conversation || conversation.length === 0) {
    return "(New conversation)";
  }

  return conversation.map(turn =>
    `**${turn.role}:** ${turn.content}`
  ).join("\n\n");
}

/**
 * Fallback prompt when template fails to load
 *
 * @param {Object} state - Current state
 * @param {string} userInput - User input
 * @returns {string} Minimal prompt
 */
function buildFallbackPrompt(state, userInput) {
  return `You are a story collector helping create a personalized song for ${state.recipient_name || "someone"}.

Story so far: ${state.narrative || "(none)"}
User said: ${userInput}

Assess holistically whether you have enough emotional depth for a meaningful song.
Respond with JSON including: decision.action (ASK/CONFIRM), decision.confidence (0.0-1.0), and output.question or output.confirmation.`;
}

module.exports = {
  buildContextPrompt,
  buildFactsList,
  buildBeatsTable,
  buildConversationHistory,
};
