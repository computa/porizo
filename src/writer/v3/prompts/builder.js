/**
 * V3 Prompt Builder
 *
 * Builds context-only prompts without embedded decision rules.
 * The LLM makes all qualitative decisions; the harness only validates structure.
 *
 * @module writer/v3/prompts/builder
 */

const fs = require("fs");
const path = require("path");
const { resolveDesiredNarrativePov } = require("../narrative");
const { STORY_SLOT_PRIORITY, findHighestPriorityGap, getSlotGuidance } = require("../quality");

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

const DEFAULT_PROMPT_LIMITS = {
  maxNarrativeChars: 1400,
  maxUserInputChars: 900,
  maxFacts: 18,
  maxFactChars: 180,
  maxAtoms: 13,
  maxAtomValueChars: 140,
  maxPrimitiveValueChars: 160,
  maxMotifs: 8,
  maxMotifChars: 72,
  maxBeats: 8,
  maxBeatPurposeChars: 96,
  maxConversationTurns: 10,
  maxConversationCharsPerTurn: 240,
  maxStructuredJsonChars: 2200,
};

function resolvePromptLimits(options = {}) {
  return {
    ...DEFAULT_PROMPT_LIMITS,
    ...(options || {}),
  };
}

function truncateText(value, maxChars) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text) return "";
  if (!Number.isFinite(maxChars) || maxChars <= 0 || text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function serializeStructuredContext(value, limits) {
  const maxChars = limits?.maxStructuredJsonChars;
  if (typeof value === "string") {
    return truncateText(value, maxChars);
  }
  if (value === undefined || value === null) {
    return "{}";
  }
  try {
    return truncateText(JSON.stringify(value), maxChars) || "{}";
  } catch {
    return truncateText(String(value), maxChars) || "{}";
  }
}

/**
 * Build gap targeting section from prior-turn slot analysis.
 *
 * Reads state.story_slots (slot coverage map) and state.readiness
 * (missing/weak slot lists), both populated by attachGapTelemetry
 * at the end of the previous turn.
 *
 * Returns a combined string with:
 * 1. Slot coverage table (~100 tokens)
 * 2. Targeting instruction when gaps exist (~80 tokens)
 *
 * @param {Object} state - Current V3 state
 * @returns {string} Gap targeting prompt section
 */
function buildGapTargeting(state) {
  const slots = state?.story_slots;
  const readiness = state?.readiness;

  if (!slots || typeof slots !== "object" || Object.keys(slots).length === 0) {
    return "(No gap analysis yet — first turn)";
  }

  // Coverage table uses prior-turn slot data (one turn stale by design).
  const rows = STORY_SLOT_PRIORITY.map((slotId) => {
    const slot = slots[slotId];
    if (!slot) return `| ${slotId} | unknown | — |`;
    // Cap at 2 evidence items to stay within ~100 token budget for this section
    const evidence = Array.isArray(slot.evidence) && slot.evidence.length > 0
      ? slot.evidence.slice(0, 2).join("; ")
      : "—";
    return `| ${slotId} | ${slot.status} | ${evidence} |`;
  });

  let result = "| Slot | Status | Evidence |\n|------|--------|----------|\n" + rows.join("\n");

  const missingSlots = Array.isArray(readiness?.missing_slots) ? readiness.missing_slots : [];
  const weakSlots = Array.isArray(readiness?.weak_slots) ? readiness.weak_slots : [];
  if (missingSlots.length > 0) result += `\nMissing: ${missingSlots.join(", ")}`;
  if (weakSlots.length > 0) result += `\nWeak: ${weakSlots.join(", ")}`;

  // Find highest-priority uncovered slot (shared algorithm with pickDeterministicGapQuestion)
  const targetSlot = findHighestPriorityGap(missingSlots, weakSlots);

  if (targetSlot) {
    const slotState = missingSlots.includes(targetSlot) ? "missing" : "weak";
    const slotData = slots[targetSlot];
    const reason = slotData?.reason || `${slotState === "missing" ? "Missing" : "Weak"} ${targetSlot} details.`;
    const guidance = getSlotGuidance(targetSlot, slotState);
    const guidanceText = guidance ? `\nGuidance: ${guidance.instruction}` : "";

    result += `\n\n**SLOT TARGETING**: Your next question should target the "${targetSlot}" gap.`
      + `\nReason: ${reason}`
      + guidanceText
      + `\nYou MUST set "question_target_slot": "${targetSlot}" in your decision object — without this field, your question will be replaced by a generic template.`
      + `\nIf this slot does not fit the story's occasion, you may target a different gap from the table above — but you MUST still include "question_target_slot" with the slot you chose.`
      + `\nReference what the user already shared and make the question feel natural and specific to their story.`;
  }

  return result;
}

/**
 * Build context-only prompt for V3 reasoning
 *
 * Key difference from V2: No embedded decision rules.
 * Provides context and asks for holistic judgment.
 *
 * @param {Object} state - Current V3 state
 * @param {string} userInput - User's new input
 * @returns {string} Formatted prompt
 */
function buildContextPrompt(state, userInput, options = {}) {
  if (!TEMPLATE) {
    return buildFallbackPrompt(state, userInput);
  }

  const limits = resolvePromptLimits(options);
  let prompt = TEMPLATE;

  // Basic context replacements
  prompt = prompt.replace(/\{\{recipient_name\}\}/g, state.recipient_name || "the recipient");
  prompt = prompt.replace(/\{\{occasion\}\}/g, state.event?.occasion || "celebration");
  prompt = prompt.replace(/\{\{narrative\}\}/g, truncateText(getCurrentNarrative(state), limits.maxNarrativeChars) || "(No story yet)");
  prompt = prompt.replace(/\{\{user_input\}\}/g, truncateText(userInput || "", limits.maxUserInputChars));

  // Build facts list
  const factsList = buildFactsList(state.facts, limits);
  prompt = prompt.replace(/\{\{facts_list\}\}/g, factsList);

  // Build atoms summary
  const atomsSummary = buildAtomsSummary(state.atoms, limits);
  prompt = prompt.replace(/\{\{atoms_summary\}\}/g, atomsSummary);

  // Build primitives summary
  const primitivesSummary = buildPrimitivesSummary(state.primitives, limits);
  prompt = prompt.replace(/\{\{primitives_summary\}\}/g, primitivesSummary);

  // Build motifs list
  const motifsList = buildMotifsList(state.motifs, state.primitives, limits);
  prompt = prompt.replace(/\{\{motifs_list\}\}/g, motifsList);

  // Build story dials summary
  const dialsSummary = buildDialsSummary(state.dials, limits);
  prompt = prompt.replace(/\{\{dials_summary\}\}/g, dialsSummary);

  // Build beats table with strength values
  const beatsTable = buildBeatsTable(state.beats, limits);
  prompt = prompt.replace(/\{\{beats_table\}\}/g, beatsTable);

  // Build gap targeting section from prior-turn slot analysis
  const gapTargeting = buildGapTargeting(state);
  prompt = prompt.replace(/\{\{gap_targeting\}\}/g, gapTargeting);

  // Build conversation history
  const conversationHistory = buildConversationHistory(state.conversation, limits);
  prompt = prompt.replace(/\{\{conversation_history\}\}/g, conversationHistory);

  return prompt;
}

function buildSelectionPrompt(state, userInput, options = {}) {
  if (!TEMPLATE_SELECTION) {
    return buildContextPrompt(state, userInput, options);
  }

  const limits = resolvePromptLimits(options);
  let prompt = TEMPLATE_SELECTION;

  prompt = prompt.replace(/\{\{recipient_name\}\}/g, state.recipient_name || "the recipient");
  prompt = prompt.replace(/\{\{occasion\}\}/g, state.event?.occasion || "celebration");
  prompt = prompt.replace(/\{\{narrative\}\}/g, truncateText(getCurrentNarrative(state), limits.maxNarrativeChars) || "(No story yet)");
  prompt = prompt.replace(/\{\{user_input\}\}/g, truncateText(userInput || "", limits.maxUserInputChars));

  const factsList = buildFactsList(state.facts, limits);
  prompt = prompt.replace(/\{\{facts_list\}\}/g, factsList);

  const atomsSummary = buildAtomsSummary(state.atoms, limits);
  prompt = prompt.replace(/\{\{atoms_summary\}\}/g, atomsSummary);

  const primitivesSummary = buildPrimitivesSummary(state.primitives, limits);
  prompt = prompt.replace(/\{\{primitives_summary\}\}/g, primitivesSummary);

  const motifsList = buildMotifsList(state.motifs, state.primitives, limits);
  prompt = prompt.replace(/\{\{motifs_list\}\}/g, motifsList);

  const dialsSummary = buildDialsSummary(state.dials, limits);
  prompt = prompt.replace(/\{\{dials_summary\}\}/g, dialsSummary);

  const conversationHistory = buildConversationHistory(state.conversation, limits);
  prompt = prompt.replace(/\{\{conversation_history\}\}/g, conversationHistory);

  return prompt;
}

function buildOutlinePrompt(state, userInput, selectionJson, options = {}) {
  if (!TEMPLATE_OUTLINE) {
    return buildContextPrompt(state, userInput, options);
  }

  const limits = resolvePromptLimits(options);
  let prompt = TEMPLATE_OUTLINE;

  prompt = prompt.replace(/\{\{recipient_name\}\}/g, state.recipient_name || "the recipient");
  prompt = prompt.replace(/\{\{occasion\}\}/g, state.event?.occasion || "celebration");
  prompt = prompt.replace(/\{\{narrative\}\}/g, truncateText(getCurrentNarrative(state), limits.maxNarrativeChars) || "(No story yet)");
  prompt = prompt.replace(/\{\{user_input\}\}/g, truncateText(userInput || "", limits.maxUserInputChars));
  prompt = prompt.replace(/\{\{selection_json\}\}/g, serializeStructuredContext(selectionJson, limits));

  const factsList = buildFactsList(state.facts, limits);
  prompt = prompt.replace(/\{\{facts_list\}\}/g, factsList);

  const beatsTable = buildBeatsTable(state.beats, limits);
  prompt = prompt.replace(/\{\{beats_table\}\}/g, beatsTable);

  const conversationHistory = buildConversationHistory(state.conversation, limits);
  prompt = prompt.replace(/\{\{conversation_history\}\}/g, conversationHistory);

  return prompt;
}

function buildEditorPrompt(state, userInput, writerJson, selectionJson, outlineJson, options = {}) {
  if (!TEMPLATE_EDITOR) {
    return buildContextPrompt(state, userInput, options);
  }

  const limits = resolvePromptLimits(options);
  let prompt = TEMPLATE_EDITOR;

  prompt = prompt.replace(/\{\{recipient_name\}\}/g, state.recipient_name || "the recipient");
  prompt = prompt.replace(/\{\{occasion\}\}/g, state.event?.occasion || "celebration");
  prompt = prompt.replace(/\{\{narrative\}\}/g, truncateText(getCurrentNarrative(state), limits.maxNarrativeChars) || "(No story yet)");
  prompt = prompt.replace(/\{\{user_input\}\}/g, truncateText(userInput || "", limits.maxUserInputChars));
  prompt = prompt.replace(/\{\{selection_json\}\}/g, serializeStructuredContext(selectionJson, limits));
  prompt = prompt.replace(/\{\{outline_json\}\}/g, serializeStructuredContext(outlineJson, limits));
  prompt = prompt.replace(/\{\{writer_json\}\}/g, serializeStructuredContext(writerJson, limits));

  const factsList = buildFactsList(state.facts, limits);
  prompt = prompt.replace(/\{\{facts_list\}\}/g, factsList);

  return prompt;
}

function buildPovPrompt(state, userInput, narrative, songMapJson, options = {}) {
  if (!TEMPLATE_POV) {
    return buildContextPrompt(state, userInput, options);
  }

  const limits = resolvePromptLimits(options);
  let prompt = TEMPLATE_POV;

  prompt = prompt.replace(/\{\{recipient_name\}\}/g, state.recipient_name || "the recipient");
  prompt = prompt.replace(/\{\{occasion\}\}/g, state.event?.occasion || "celebration");
  prompt = prompt.replace(/\{\{narrative\}\}/g, truncateText(narrative || getCurrentNarrative(state), limits.maxNarrativeChars) || "(No story yet)");
  prompt = prompt.replace(/\{\{user_input\}\}/g, truncateText(userInput || "", limits.maxUserInputChars));
  prompt = prompt.replace(/\{\{song_map_json\}\}/g, serializeStructuredContext(songMapJson, limits));
  prompt = prompt.replace(/\{\{pov_instruction\}\}/g, buildPovInstruction(state));

  const factsList = buildFactsList(state.facts, limits);
  prompt = prompt.replace(/\{\{facts_list\}\}/g, factsList);

  return prompt;
}

/**
 * Build facts list for prompt
 *
 * @param {Array} facts - Collected facts
 * @returns {string} Formatted facts list
 */
function buildFactsList(facts, options = {}) {
  const limits = resolvePromptLimits(options);
  const list = Array.isArray(facts) ? facts.filter((fact) => (fact?.status || "active") === "active") : [];
  if (list.length === 0) {
    return "(No facts collected yet)";
  }

  const maxFacts = Math.max(1, Number(limits.maxFacts || DEFAULT_PROMPT_LIMITS.maxFacts));
  const selected = list.slice(-maxFacts);
  const lines = selected.map((fact) => {
    const id = fact?.id || "fact";
    const text = truncateText(fact?.text || "", limits.maxFactChars);
    return `- [${id}] ${text}`;
  });

  const omitted = list.length - selected.length;
  if (omitted > 0) {
    lines.push(`- ... ${omitted} earlier fact(s) omitted for brevity`);
  }

  return lines.join("\n");
}

function getCurrentNarrative(state) {
  if (!state || typeof state !== "object") return "";
  if (typeof state.narrative_current === "string" && state.narrative_current.trim()) {
    return state.narrative_current;
  }
  if (typeof state.narrative === "string") {
    return state.narrative;
  }
  return "";
}

function buildPovInstruction(state) {
  const recipient = (state?.recipient_name || "the recipient").trim();
  const desiredPov = resolveDesiredNarrativePov(state);
  if (desiredPov === "first_person") {
    return "Rewrite the narrative into first person (I/we), preserving facts and meaning.";
  }
  if (desiredPov === "third_person") {
    return `Rewrite the narrative into third person centered on ${recipient}. Use their name or third-person pronouns, preserving facts and meaning.`;
  }
  return `Rewrite the narrative into recipient-focused voice centered on ${recipient}. Prefer "you/your" or "${recipient}" and avoid writer-centered "I/my/we" unless directly quoted from facts.`;
}

/**
 * Build story atoms summary for prompt
 *
 * @param {Object} atoms - Story atoms
 * @returns {string} Formatted atoms summary
 */
function buildAtomsSummary(atoms, options = {}) {
  const limits = resolvePromptLimits(options);
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
    .slice(0, Math.max(1, Number(limits.maxAtoms || DEFAULT_PROMPT_LIMITS.maxAtoms)))
    .map(([label, value]) => `- ${label}: ${truncateText(value.trim(), limits.maxAtomValueChars)}`);

  return lines.length > 0 ? lines.join("\n") : "(No atoms extracted yet)";
}

/**
 * Build narrative primitives summary for prompt
 *
 * @param {Object} primitives - Narrative primitives
 * @returns {string} Formatted primitives summary
 */
function buildPrimitivesSummary(primitives, options = {}) {
  const limits = resolvePromptLimits(options);
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
    if (chars) lines.push(`- Characters: ${truncateText(chars, limits.maxPrimitiveValueChars)}`);
  }

  const setting = primitives.setting || {};
  const settingBits = [setting.place, setting.time, setting.atmosphere].filter(Boolean);
  if (settingBits.length > 0) {
    lines.push(`- Setting: ${truncateText(settingBits.join(" • "), limits.maxPrimitiveValueChars)}`);
  }

  if (primitives.inciting_incident) lines.push(`- Inciting incident: ${truncateText(primitives.inciting_incident, limits.maxPrimitiveValueChars)}`);
  if (primitives.turning_point) lines.push(`- Turning point: ${truncateText(primitives.turning_point, limits.maxPrimitiveValueChars)}`);
  if (primitives.resolution) lines.push(`- Resolution: ${truncateText(primitives.resolution, limits.maxPrimitiveValueChars)}`);
  if (primitives.theme) lines.push(`- Theme: ${truncateText(primitives.theme, limits.maxPrimitiveValueChars)}`);

  if (primitives.conflict && (primitives.conflict.internal || primitives.conflict.external)) {
    const conflictBits = [];
    if (primitives.conflict.internal) conflictBits.push(`internal: ${primitives.conflict.internal}`);
    if (primitives.conflict.external) conflictBits.push(`external: ${primitives.conflict.external}`);
    lines.push(`- Conflict: ${truncateText(conflictBits.join(" • "), limits.maxPrimitiveValueChars)}`);
  }

  if (Array.isArray(primitives.motifs) && primitives.motifs.length > 0) {
    lines.push(`- Motifs: ${truncateText(primitives.motifs.join(", "), limits.maxPrimitiveValueChars)}`);
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
function buildMotifsList(motifs, primitives, options = {}) {
  const limits = resolvePromptLimits(options);
  const list = Array.isArray(motifs) && motifs.length > 0
    ? motifs
    : (Array.isArray(primitives?.motifs) ? primitives.motifs : []);

  if (!list || list.length === 0) {
    return "(No motifs identified yet)";
  }

  return list
    .slice(0, Math.max(1, Number(limits.maxMotifs || DEFAULT_PROMPT_LIMITS.maxMotifs)))
    .map(item => `- ${truncateText(item, limits.maxMotifChars)}`)
    .join("\n");
}

/**
 * Build story dials summary for prompt
 *
 * @param {Object} dials - Story dials
 * @returns {string} Formatted dials summary
 */
function buildDialsSummary(dials, options = {}) {
  const limits = resolvePromptLimits(options);
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
    .map(([label, value]) => `- ${label}: ${truncateText(value.trim(), limits.maxAtomValueChars)}`);

  return lines.length > 0 ? lines.join("\n") : "(No dials inferred yet)";
}

/**
 * Build beats table with strength values
 *
 * @param {Array} beats - Story beats with strength
 * @returns {string} Formatted beats table
 */
function buildBeatsTable(beats, options = {}) {
  const limits = resolvePromptLimits(options);
  if (!beats || beats.length === 0) {
    return "| (no beats defined) | | |";
  }

  const maxBeats = Math.max(1, Number(limits.maxBeats || DEFAULT_PROMPT_LIMITS.maxBeats));
  const selected = beats.slice(0, maxBeats);
  const rows = selected.map(beat => {
    const id = beat.id || "unknown";
    const purpose = truncateText(beat.purpose || "", limits.maxBeatPurposeChars);
    // Support both old status and new strength format
    const strength = typeof beat.strength === "number"
      ? beat.strength.toFixed(1)
      : statusToStrength(beat.status);
    return `| ${id} | ${purpose} | ${strength}/1.0 |`;
  });

  const omitted = beats.length - selected.length;
  if (omitted > 0) {
    rows.push(`| ... | ${omitted} additional beat(s) omitted | - |`);
  }

  return rows.join("\n");
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
function buildConversationHistory(conversation, options = {}) {
  const limits = resolvePromptLimits(options);
  if (!conversation || conversation.length === 0) {
    return "(New conversation)";
  }

  const maxTurns = Math.max(1, Number(limits.maxConversationTurns || DEFAULT_PROMPT_LIMITS.maxConversationTurns));
  const selected = conversation.slice(-maxTurns);
  const omitted = conversation.length - selected.length;
  const lines = [];

  if (omitted > 0) {
    lines.push(`(Conversation trimmed: ${omitted} earlier turn(s) omitted)`);
  }

  for (const turn of selected) {
    const role = typeof turn?.role === "string" ? turn.role : "user";
    const content = truncateText(turn?.content || "", limits.maxConversationCharsPerTurn);
    lines.push(`**${role}:** ${content}`);
  }

  return lines.join("\n\n");
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
  buildGapTargeting,
  buildFactsList,
  buildBeatsTable,
  buildConversationHistory,
  buildAtomsSummary,
  buildPrimitivesSummary,
  buildMotifsList,
  buildDialsSummary,
};
