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
const {
  STORY_SLOT_PRIORITY,
  findHighestPriorityGap,
  getSlotGuidance,
  getElementForSlot,
  computeQuestionPriority,
  getQuestionStage,
  detectEmotionalIntensity,
} = require("../quality");

function loadTemplate(name) {
  const templatePath = path.join(__dirname, name);
  try {
    return fs.readFileSync(templatePath, "utf-8");
  } catch (err) {
    console.error(`[V3 Builder] Failed to load prompt template "${name}":`, err.message);
    return null;
  }
}

// In development, hot-reload templates from disk on every call
// so autoresearch prompt mutations take effect without server restart.
// In production, cache at module level for performance.
const HOT_RELOAD = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

const _TEMPLATE = loadTemplate("reason-v3.md");
const _TEMPLATE_SELECTION = loadTemplate("reason-v3-selection.md");
const _TEMPLATE_OUTLINE = loadTemplate("reason-v3-outline.md");
const _TEMPLATE_EDITOR = loadTemplate("reason-v3-editor.md");
const _TEMPLATE_POV = loadTemplate("reason-v3-pov.md");

// Accessors that hot-reload in dev, return cached in production
function getTemplate(name, cached) {
  return HOT_RELOAD ? loadTemplate(name) || cached : cached;
}

Object.defineProperties(module, {
  _templateGetters: { value: true },
});

// Use these getters everywhere instead of the constants directly
const TEMPLATE = HOT_RELOAD ? null : _TEMPLATE;
const TEMPLATE_SELECTION = HOT_RELOAD ? null : _TEMPLATE_SELECTION;
const TEMPLATE_OUTLINE = HOT_RELOAD ? null : _TEMPLATE_OUTLINE;
const TEMPLATE_EDITOR = HOT_RELOAD ? null : _TEMPLATE_EDITOR;
const TEMPLATE_POV = HOT_RELOAD ? null : _TEMPLATE_POV;

function getMainTemplate() { return HOT_RELOAD ? loadTemplate("reason-v3.md") || _TEMPLATE : _TEMPLATE; }
function getSelectionTemplate() { return HOT_RELOAD ? loadTemplate("reason-v3-selection.md") || _TEMPLATE_SELECTION : _TEMPLATE_SELECTION; }
function getOutlineTemplate() { return HOT_RELOAD ? loadTemplate("reason-v3-outline.md") || _TEMPLATE_OUTLINE : _TEMPLATE_OUTLINE; }
function getEditorTemplate() { return HOT_RELOAD ? loadTemplate("reason-v3-editor.md") || _TEMPLATE_EDITOR : _TEMPLATE_EDITOR; }
function getPovTemplate() { return HOT_RELOAD ? loadTemplate("reason-v3-pov.md") || _TEMPLATE_POV : _TEMPLATE_POV; }

const DEFAULT_PROMPT_LIMITS = {
  maxNarrativeChars: 4000,
  maxUserInputChars: 2400,
  maxFacts: 18,
  maxFactChars: 180,
  maxAtoms: 13,
  maxAtomValueChars: 140,
  maxPrimitiveValueChars: 220,
  maxMotifs: 8,
  maxMotifChars: 72,
  maxBeats: 8,
  maxBeatPurposeChars: 120,
  maxConversationTurns: 10,
  maxConversationCharsPerTurn: 320,
  maxStructuredJsonChars: 4200,
  maxRetainedDetails: 15,
  maxRetainedDetailChars: 120,
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

function prioritizeStructuredKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const priority = [
    "song_map",
    "hook",
    "verse1",
    "chorus",
    "verse2",
    "bridge",
    "pre",
    "key_lines",
    "motifs",
    "facts",
    "beats",
    "narrative",
    "summary",
    "primitives",
    "atoms",
  ];
  const rank = new Map(priority.map((key, index) => [key, index]));
  return Object.keys(value).sort((a, b) => {
    const aRank = rank.has(a) ? rank.get(a) : Number.MAX_SAFE_INTEGER;
    const bRank = rank.has(b) ? rank.get(b) : Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;
    return a.localeCompare(b);
  });
}

function shrinkStructuredValue(value, maxChars, depth = 0) {
  if (!Number.isFinite(maxChars) || maxChars <= 0 || value == null) return value;
  if (depth > 5) {
    return typeof value === "string" ? truncateText(value, Math.max(8, maxChars - 2)) : null;
  }
  if (typeof value === "string") {
    return truncateText(value, Math.max(8, maxChars - 2));
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    const result = [];
    for (const item of value) {
      const remainingBudget = Math.max(16, maxChars - JSON.stringify(result).length - 2);
      const trimmed = shrinkStructuredValue(item, remainingBudget, depth + 1);
      if (trimmed == null || trimmed === "") continue;
      result.push(trimmed);
      if (JSON.stringify(result).length > maxChars) {
        result.pop();
        break;
      }
    }
    return result;
  }
  if (typeof value === "object") {
    const result = {};
    for (const key of prioritizeStructuredKeys(value)) {
      const remainingBudget = Math.max(16, maxChars - JSON.stringify(result).length - key.length - 6);
      const trimmed = shrinkStructuredValue(value[key], remainingBudget, depth + 1);
      if (trimmed == null || trimmed === "" || (Array.isArray(trimmed) && trimmed.length === 0)) continue;
      result[key] = trimmed;
      if (JSON.stringify(result).length > maxChars) {
        delete result[key];
      }
    }
    return result;
  }
  return null;
}

function serializeWithinLimit(value, maxChars) {
  if (!Number.isFinite(maxChars) || maxChars <= 0) {
    return JSON.stringify(value);
  }

  let current = shrinkStructuredValue(value, maxChars);
  let serialized = JSON.stringify(current);
  if (serialized.length <= maxChars) return serialized;

  if (Array.isArray(current)) {
    current = [...current];
    while (current.length > 0) {
      current.pop();
      serialized = JSON.stringify(current);
      if (serialized.length <= maxChars) return serialized;
    }
    return "[]";
  }

  if (current && typeof current === "object") {
    current = { ...current };
    const keys = prioritizeStructuredKeys(current).reverse();
    while (keys.length > 0) {
      delete current[keys.shift()];
      serialized = JSON.stringify(current);
      if (serialized.length <= maxChars) return serialized;
    }
    return "{}";
  }

  if (typeof current === "string") {
    return JSON.stringify(truncateText(current, Math.max(8, maxChars - 2)));
  }

  return truncateText(serialized, maxChars) || "{}";
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
    return serializeWithinLimit(value, maxChars) || "{}";
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
  const storyMode = state?.story_mode || state?.storyMode || readiness?.story_mode || readiness?.storyMode || "default";

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
    const targetElement = getElementForSlot(storyMode, targetSlot);
    const elementText = targetElement
      ? `\nVisible Story Strength focus: ${targetElement.displayName}`
        + `\nThis slot ("${targetSlot}") contributes to the visible element "${targetElement.displayName}".`
        + `\nThe user sees Story Strength bars. Your question and suggestions should help strengthen "${targetElement.displayName}" while still targeting "${targetSlot}".`
      : "";

    result += `\n\n**SLOT TARGETING**: Your next question should target the "${targetSlot}" gap.`
      + `\nReason: ${reason}`
      + guidanceText
      + elementText
      + `\nYou MUST set "question_target_slot": "${targetSlot}" in your decision object — without this field, your question will be replaced by a generic template.`
      + `\nYou MUST target exactly this slot. If you choose a different slot, your question will be replaced.`
      + `\nReference what the user already shared and make the question feel natural and specific to their story.`;
  }

  return result;
}

/**
 * Build the retained-details inventory section for the reasoning prompt.
 *
 * Pure function — reads only from the `details` array and `limits`.
 * Required details (initial_prompt first, then conversation) fill slots
 * before optional details. The result is a bullet list with stable IDs.
 *
 * @param {Array} details - Retained detail objects from extractRetainedDetails
 * @param {Object} limits - Prompt limits (uses maxRetainedDetails)
 * @returns {string} Formatted inventory section
 */
function buildRetainedDetailsSection(details, limits) {
  if (!Array.isArray(details) || !details.length) return "(No detail inventory yet)";
  const max = limits.maxRetainedDetails || 15;
  const required = details.filter(d => d.required);
  const optional = details.filter(d => !d.required);
  // Sort required: initial-prompt first, then conversation
  const sortedRequired = [...required].sort((a, b) => {
    const aInit = a.source === "initial_prompt" ? 1 : 0;
    const bInit = b.source === "initial_prompt" ? 1 : 0;
    return bInit - aInit;
  });
  const selected = sortedRequired.length >= max
    ? sortedRequired.slice(0, max)
    : [...sortedRequired, ...optional].slice(0, max);
  const maxChars = limits.maxRetainedDetailChars || 120;
  return selected
    .map(d => {
      const text = d.text.length > maxChars ? d.text.slice(0, maxChars - 1) + "…" : d.text;
      return `- [${d.id || '?'}]${d.required ? ' (REQ)' : ''} ${text}`;
    })
    .join("\n");
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
  const tmpl = getMainTemplate();
  if (!tmpl) {
    return buildFallbackPrompt(state, userInput);
  }

  const limits = resolvePromptLimits(options);
  let prompt = tmpl;

  // Basic context replacements
  prompt = prompt.replace(/\{\{recipient_name\}\}/g, state.recipient_name || "the recipient");
  prompt = prompt.replace(/\{\{occasion\}\}/g, (state.event?.occasion || "celebration").replace(/_/g, " "));
  prompt = prompt.replace(/\{\{narrative\}\}/g, truncateText(getCurrentNarrative(state), limits.maxNarrativeChars) || "(No story yet)");
  prompt = prompt.replace(/\{\{user_input\}\}/g, truncateText(userInput || "", limits.maxUserInputChars));

  // Build retained details inventory
  const retainedDetails = options.retainedDetails || [];
  const retainedSection = buildRetainedDetailsSection(retainedDetails, limits);
  prompt = prompt.replace(/\{\{retained_details\}\}/g, retainedSection);

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

  // Anti-repetition: already known facts and already asked questions
  const alreadyKnown = buildAlreadyKnown(state.story_state || null);
  prompt = prompt.replace(/\{\{already_known\}\}/g, alreadyKnown);
  const alreadyAsked = buildAlreadyAsked(state.story_state || null);
  prompt = prompt.replace(/\{\{already_asked\}\}/g, alreadyAsked);

  // Question targeting: Labov-aware information-gain + funnel staging
  const questionTargeting = buildQuestionTargeting(state, state.labov_analysis || null, userInput);
  prompt = prompt.replace(/\{\{question_targeting\}\}/g, questionTargeting);

  return prompt;
}

function buildSelectionPrompt(state, userInput, options = {}) {
  const tmplSel = getSelectionTemplate();
  if (!tmplSel) {
    return buildContextPrompt(state, userInput, options);
  }

  const limits = resolvePromptLimits(options);
  let prompt = tmplSel;

  prompt = prompt.replace(/\{\{recipient_name\}\}/g, state.recipient_name || "the recipient");
  prompt = prompt.replace(/\{\{occasion\}\}/g, (state.event?.occasion || "celebration").replace(/_/g, " "));
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

  // Anti-repetition: already known facts
  const alreadyKnown = buildAlreadyKnown(state.story_state || null);
  prompt = prompt.replace(/\{\{already_known\}\}/g, alreadyKnown);

  return prompt;
}

function buildOutlinePrompt(state, userInput, selectionJson, options = {}) {
  const tmplOut = getOutlineTemplate();
  if (!tmplOut) {
    return buildContextPrompt(state, userInput, options);
  }

  const limits = resolvePromptLimits(options);
  let prompt = tmplOut;

  prompt = prompt.replace(/\{\{recipient_name\}\}/g, state.recipient_name || "the recipient");
  prompt = prompt.replace(/\{\{occasion\}\}/g, (state.event?.occasion || "celebration").replace(/_/g, " "));
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
  const tmplEd = getEditorTemplate();
  if (!tmplEd) {
    return buildContextPrompt(state, userInput, options);
  }

  const limits = resolvePromptLimits(options);
  let prompt = tmplEd;

  prompt = prompt.replace(/\{\{recipient_name\}\}/g, state.recipient_name || "the recipient");
  prompt = prompt.replace(/\{\{occasion\}\}/g, (state.event?.occasion || "celebration").replace(/_/g, " "));
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
  const tmplPov = getPovTemplate();
  if (!tmplPov) {
    return buildContextPrompt(state, userInput, options);
  }

  const limits = resolvePromptLimits(options);
  let prompt = tmplPov;

  prompt = prompt.replace(/\{\{recipient_name\}\}/g, state.recipient_name || "the recipient");
  prompt = prompt.replace(/\{\{occasion\}\}/g, (state.event?.occasion || "celebration").replace(/_/g, " "));
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
 * Build the ALREADY KNOWN section for anti-repetition injection.
 *
 * Reads from state.story_state (derived by extractStoryState).
 * Returns empty string when story_state is null/undefined (graceful degradation).
 * Capped at 10 bullet items to stay within prompt budget.
 *
 * @param {Object|null} storyState - Derived story state from extractStoryState
 * @returns {string} Formatted section or empty string
 */
function buildAlreadyKnown(storyState) {
  if (!storyState || typeof storyState !== "object") return "";

  const items = [];

  // Recipient line
  if (storyState.recipient?.name) {
    const rel = storyState.recipient.relationship
      ? `, ${storyState.recipient.relationship}`
      : "";
    items.push(`Recipient: ${storyState.recipient.name}${rel}`);
  }

  // Labov key facts
  const labov = storyState.labov;
  if (labov && typeof labov === "object") {
    for (const element of ["orientation", "complicating_action", "evaluation", "resolution"]) {
      const el = labov[element];
      if (el && Array.isArray(el.key_facts)) {
        for (const fact of el.key_facts) {
          if (typeof fact === "string" && fact.trim()) {
            items.push(fact.trim());
          }
        }
      }
    }
  }

  // Sensory details
  if (Array.isArray(storyState.sensoryDetails)) {
    for (const detail of storyState.sensoryDetails) {
      if (typeof detail === "string" && detail.trim()) {
        items.push(detail.trim());
      }
    }
  }

  if (items.length === 0) return "";

  // Deduplicate (case-insensitive) and cap at 10
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(item);
    }
  }
  const capped = deduped.slice(0, 10);

  return "ALREADY KNOWN (do NOT ask about these):\n"
    + capped.map((item) => `- ${item}`).join("\n");
}

/**
 * Build the ALREADY ASKED section for anti-repetition injection.
 *
 * Reads from state.story_state.questionsAsked (derived by extractStoryState).
 * Returns empty string when story_state is null/undefined (graceful degradation).
 * Capped at 5 items to stay within prompt budget.
 *
 * @param {Object|null} storyState - Derived story state from extractStoryState
 * @returns {string} Formatted section or empty string
 */
function buildAlreadyAsked(storyState) {
  if (!storyState || typeof storyState !== "object") return "";

  const questions = Array.isArray(storyState.questionsAsked)
    ? storyState.questionsAsked
    : [];

  if (questions.length === 0) return "";

  const capped = questions.slice(-5); // Most recent 5

  const lines = capped.map((q) => {
    const roundLabel = `Round ${q.round || "?"}`;
    const questionText = (q.question || "").slice(0, 120);
    if (q.answered && q.answerSummary) {
      const answer = q.answerSummary.slice(0, 80);
      return `- ${roundLabel}: "${questionText}" -> Answered: "${answer}"`;
    }
    return `- ${roundLabel}: "${questionText}" -> Pending/Unanswered`;
  });

  return "ALREADY ASKED (do NOT repeat these questions):\n" + lines.join("\n");
}

/**
 * Build the QUESTION TARGETING section for Labov-aware sessions.
 *
 * Combines information-gain priority, funnel stage, and emotional intensity
 * into a single prompt injection block. Returns empty string for legacy
 * sessions (no Labov data), ensuring backward compatibility.
 *
 * @param {Object} state - Current V3 state (needs turn_count)
 * @param {Object|null} labovAnalysis - Return value of computeLabovGapAnalysis, or null
 * @param {string} userMessage - The user's latest message
 * @returns {string} Targeting block or empty string
 */
function buildQuestionTargeting(state, labovAnalysis, userMessage) {
  if (!labovAnalysis?.labov) return "";

  const priority = computeQuestionPriority(labovAnalysis);
  const stage = getQuestionStage(state?.turn_count);
  const emotion = detectEmotionalIntensity(userMessage);

  let targeting = "";

  if (priority) {
    targeting += `QUESTION TARGET: ${priority.element} \u2014 ${priority.reason}\n`;
  } else {
    targeting += `QUESTION TARGET: None \u2014 all elements sufficiently covered. Story is ready.\n`;
  }

  targeting += `QUESTION STAGE: ${stage.stage} (${stage.description})\n`;
  targeting += `EMOTIONAL INTENSITY: ${emotion.intensity}`;
  if (emotion.intensity === "high") {
    targeting += " \u2192 Deepen this emotional thread instead of jumping to next element.\n";
    if (priority && priority.element !== "evaluation") {
      targeting += `EMOTION OVERRIDE: User shared something vulnerable. Target "evaluation" (emotional meaning) instead of "${priority.element}".\n`;
    }
  } else {
    targeting += "\n";
  }

  if (userMessage) {
    const preview = userMessage.length > 200 ? userMessage.slice(0, 200) + "..." : userMessage;
    targeting += `\nThe user just said: "${preview}"\nBuild your question on something THEY said. Use the "Yes, And" technique.\n`;
  }

  return targeting;
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
  buildQuestionTargeting,
  buildFactsList,
  buildBeatsTable,
  buildConversationHistory,
  buildAtomsSummary,
  buildPrimitivesSummary,
  buildMotifsList,
  buildDialsSummary,
  serializeStructuredContext,
  buildRetainedDetailsSection,
  buildAlreadyKnown,
  buildAlreadyAsked,
};
