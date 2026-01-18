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

function loadTemplate(name) {
  const templatePath = path.join(__dirname, name);
  try {
    return fs.readFileSync(templatePath, "utf-8");
  } catch (err) {
    console.error(`[V3 Builder] Failed to load prompt template "${name}":`, err.message);
    return null;
  }
}

// Load prompt templates at module level (cached)
const TEMPLATE = loadTemplate("reason-v3.md");
const TEMPLATE_SELECTION = loadTemplate("reason-v3-selection.md");
const TEMPLATE_OUTLINE = loadTemplate("reason-v3-outline.md");
const TEMPLATE_EDITOR = loadTemplate("reason-v3-editor.md");
const TEMPLATE_POV = loadTemplate("reason-v3-pov.md");

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

  // Build atoms summary
  const atomsSummary = buildAtomsSummary(state.atoms);
  prompt = prompt.replace(/\{\{atoms_summary\}\}/g, atomsSummary);

  // Build primitives summary
  const primitivesSummary = buildPrimitivesSummary(state.primitives);
  prompt = prompt.replace(/\{\{primitives_summary\}\}/g, primitivesSummary);

  // Build motifs list
  const motifsList = buildMotifsList(state.motifs, state.primitives);
  prompt = prompt.replace(/\{\{motifs_list\}\}/g, motifsList);

  // Build story dials summary
  const dialsSummary = buildDialsSummary(state.dials);
  prompt = prompt.replace(/\{\{dials_summary\}\}/g, dialsSummary);

  // Build beats table with strength values
  const beatsTable = buildBeatsTable(state.beats);
  prompt = prompt.replace(/\{\{beats_table\}\}/g, beatsTable);

  // Build conversation history
  const conversationHistory = buildConversationHistory(state.conversation);
  prompt = prompt.replace(/\{\{conversation_history\}\}/g, conversationHistory);

  return prompt;
}

function buildSelectionPrompt(state, userInput) {
  if (!TEMPLATE_SELECTION) {
    return buildContextPrompt(state, userInput);
  }

  let prompt = TEMPLATE_SELECTION;

  prompt = prompt.replace(/\{\{recipient_name\}\}/g, state.recipient_name || "the recipient");
  prompt = prompt.replace(/\{\{occasion\}\}/g, state.event?.occasion || "celebration");
  prompt = prompt.replace(/\{\{narrative\}\}/g, state.narrative || "(No story yet)");
  prompt = prompt.replace(/\{\{user_input\}\}/g, userInput || "");

  const factsList = buildFactsList(state.facts);
  prompt = prompt.replace(/\{\{facts_list\}\}/g, factsList);

  const atomsSummary = buildAtomsSummary(state.atoms);
  prompt = prompt.replace(/\{\{atoms_summary\}\}/g, atomsSummary);

  const primitivesSummary = buildPrimitivesSummary(state.primitives);
  prompt = prompt.replace(/\{\{primitives_summary\}\}/g, primitivesSummary);

  const motifsList = buildMotifsList(state.motifs, state.primitives);
  prompt = prompt.replace(/\{\{motifs_list\}\}/g, motifsList);

  const dialsSummary = buildDialsSummary(state.dials);
  prompt = prompt.replace(/\{\{dials_summary\}\}/g, dialsSummary);

  const conversationHistory = buildConversationHistory(state.conversation);
  prompt = prompt.replace(/\{\{conversation_history\}\}/g, conversationHistory);

  return prompt;
}

function buildOutlinePrompt(state, userInput, selectionJson) {
  if (!TEMPLATE_OUTLINE) {
    return buildContextPrompt(state, userInput);
  }

  let prompt = TEMPLATE_OUTLINE;

  prompt = prompt.replace(/\{\{recipient_name\}\}/g, state.recipient_name || "the recipient");
  prompt = prompt.replace(/\{\{occasion\}\}/g, state.event?.occasion || "celebration");
  prompt = prompt.replace(/\{\{narrative\}\}/g, state.narrative || "(No story yet)");
  prompt = prompt.replace(/\{\{user_input\}\}/g, userInput || "");
  prompt = prompt.replace(/\{\{selection_json\}\}/g, selectionJson || "{}");

  const factsList = buildFactsList(state.facts);
  prompt = prompt.replace(/\{\{facts_list\}\}/g, factsList);

  const beatsTable = buildBeatsTable(state.beats);
  prompt = prompt.replace(/\{\{beats_table\}\}/g, beatsTable);

  const conversationHistory = buildConversationHistory(state.conversation);
  prompt = prompt.replace(/\{\{conversation_history\}\}/g, conversationHistory);

  return prompt;
}

function buildEditorPrompt(state, userInput, writerJson, selectionJson, outlineJson) {
  if (!TEMPLATE_EDITOR) {
    return buildContextPrompt(state, userInput);
  }

  let prompt = TEMPLATE_EDITOR;

  prompt = prompt.replace(/\{\{recipient_name\}\}/g, state.recipient_name || "the recipient");
  prompt = prompt.replace(/\{\{occasion\}\}/g, state.event?.occasion || "celebration");
  prompt = prompt.replace(/\{\{narrative\}\}/g, state.narrative || "(No story yet)");
  prompt = prompt.replace(/\{\{user_input\}\}/g, userInput || "");
  prompt = prompt.replace(/\{\{selection_json\}\}/g, selectionJson || "{}");
  prompt = prompt.replace(/\{\{outline_json\}\}/g, outlineJson || "{}");
  prompt = prompt.replace(/\{\{writer_json\}\}/g, writerJson || "{}");

  const factsList = buildFactsList(state.facts);
  prompt = prompt.replace(/\{\{facts_list\}\}/g, factsList);

  return prompt;
}

function buildPovPrompt(state, userInput, narrative, songMapJson) {
  if (!TEMPLATE_POV) {
    return buildContextPrompt(state, userInput);
  }

  let prompt = TEMPLATE_POV;

  prompt = prompt.replace(/\{\{recipient_name\}\}/g, state.recipient_name || "the recipient");
  prompt = prompt.replace(/\{\{occasion\}\}/g, state.event?.occasion || "celebration");
  prompt = prompt.replace(/\{\{narrative\}\}/g, narrative || state.narrative || "(No story yet)");
  prompt = prompt.replace(/\{\{user_input\}\}/g, userInput || "");
  prompt = prompt.replace(/\{\{song_map_json\}\}/g, songMapJson || "{}");

  const factsList = buildFactsList(state.facts);
  prompt = prompt.replace(/\{\{facts_list\}\}/g, factsList);

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
 * Build story atoms summary for prompt
 *
 * @param {Object} atoms - Story atoms
 * @returns {string} Formatted atoms summary
 */
function buildAtomsSummary(atoms) {
  if (!atoms || typeof atoms !== "object") {
    return "(No atoms extracted yet)";
  }

  const entries = [
    ["Who", atoms.who],
    ["Where", atoms.where],
    ["When", atoms.when],
    ["What changed", atoms.turn],
    ["Object", atoms.object],
    ["Sound", atoms.sound],
    ["Smell/Taste", atoms.smell],
    ["Body/Feeling", atoms.physical],
    ["Small action", atoms.action],
    ["Stakes", atoms.stakes],
    ["Secret", atoms.secret],
    ["After", atoms.after],
    ["Dialogue", atoms.dialogue],
  ];

  const lines = entries
    .filter(([, value]) => typeof value === "string" && value.trim())
    .map(([label, value]) => `- ${label}: ${value.trim()}`);

  return lines.length > 0 ? lines.join("\n") : "(No atoms extracted yet)";
}

/**
 * Build narrative primitives summary for prompt
 *
 * @param {Object} primitives - Narrative primitives
 * @returns {string} Formatted primitives summary
 */
function buildPrimitivesSummary(primitives) {
  if (!primitives || typeof primitives !== "object") {
    return "(No primitives yet)";
  }

  const lines = [];
  if (Array.isArray(primitives.characters) && primitives.characters.length > 0) {
    const chars = primitives.characters
      .map(c => {
        const name = c.name || "";
        const role = c.role ? ` (${c.role})` : "";
        return `${name}${role}`.trim();
      })
      .filter(Boolean)
      .join(", ");
    if (chars) lines.push(`- Characters: ${chars}`);
  }

  const setting = primitives.setting || {};
  const settingBits = [setting.place, setting.time, setting.atmosphere].filter(Boolean);
  if (settingBits.length > 0) {
    lines.push(`- Setting: ${settingBits.join(" • ")}`);
  }

  if (primitives.inciting_incident) lines.push(`- Inciting incident: ${primitives.inciting_incident}`);
  if (primitives.turning_point) lines.push(`- Turning point: ${primitives.turning_point}`);
  if (primitives.resolution) lines.push(`- Resolution: ${primitives.resolution}`);
  if (primitives.theme) lines.push(`- Theme: ${primitives.theme}`);

  if (primitives.conflict && (primitives.conflict.internal || primitives.conflict.external)) {
    const conflictBits = [];
    if (primitives.conflict.internal) conflictBits.push(`internal: ${primitives.conflict.internal}`);
    if (primitives.conflict.external) conflictBits.push(`external: ${primitives.conflict.external}`);
    lines.push(`- Conflict: ${conflictBits.join(" • ")}`);
  }

  if (Array.isArray(primitives.motifs) && primitives.motifs.length > 0) {
    lines.push(`- Motifs: ${primitives.motifs.join(", ")}`);
  }

  return lines.length > 0 ? lines.join("\n") : "(No primitives yet)";
}

/**
 * Build motifs list for prompt
 *
 * @param {Array} motifs - Motifs array
 * @param {Object} primitives - Primitives (fallback motifs)
 * @returns {string} Formatted motifs list
 */
function buildMotifsList(motifs, primitives) {
  const list = Array.isArray(motifs) && motifs.length > 0
    ? motifs
    : (Array.isArray(primitives?.motifs) ? primitives.motifs : []);

  if (!list || list.length === 0) {
    return "(No motifs identified yet)";
  }

  return list.map(item => `- ${item}`).join("\n");
}

/**
 * Build story dials summary for prompt
 *
 * @param {Object} dials - Story dials
 * @returns {string} Formatted dials summary
 */
function buildDialsSummary(dials) {
  if (!dials || typeof dials !== "object") {
    return "(No dials inferred yet)";
  }

  const entries = [
    ["Tone", dials.tone],
    ["POV", dials.pov],
    ["Length", dials.length],
    ["Realism", dials.realism],
    ["Focus", dials.focus],
  ];

  const lines = entries
    .filter(([, value]) => typeof value === "string" && value.trim())
    .map(([label, value]) => `- ${label}: ${value.trim()}`);

  return lines.length > 0 ? lines.join("\n") : "(No dials inferred yet)";
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
  buildSelectionPrompt,
  buildOutlinePrompt,
  buildEditorPrompt,
  buildPovPrompt,
  buildFactsList,
  buildBeatsTable,
  buildConversationHistory,
  buildAtomsSummary,
  buildPrimitivesSummary,
  buildMotifsList,
  buildDialsSummary,
};
