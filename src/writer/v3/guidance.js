/**
 * V3 Story Element Guidance
 *
 * Generates story-aware, LLM-powered guidance for weak story elements.
 * Replaces static SLOT_GUIDANCE_TEMPLATES with contextual guidance grounded
 * in the user's actual narrative, facts, and story atoms.
 *
 * Fallback: If LLM is unavailable, falls back to template-based guidance
 * from quality.js for resilience.
 *
 * @module writer/v3/guidance
 */

const { generateText, isAvailable } = require("../../services/llm-provider");
const {
  SLOT_GUIDANCE_TEMPLATES,
  STORY_ELEMENT_DEFINITIONS,
  SLOT_TO_ELEMENT_FALLBACK,
} = require("./quality");

/**
 * Generate story-aware guidance for a specific element.
 *
 * @param {Object} state - V3 story state (narrative, atoms, facts, etc.)
 * @param {string} elementId - Element to generate guidance for (e.g. "moment")
 * @param {Object} [options] - Options
 * @param {Function} [options._generateTextFn] - Override for testing
 * @returns {Promise<ElementGuidance>}
 */
async function generateElementGuidance(state, elementId, options = {}) {
  const elementDef = findElementDefinition(elementId, state);
  if (!elementDef) {
    return null;
  }

  const element = findElementFromState(state, elementId);
  const strength = element?.strength ?? 0;
  const elementState = strength >= 0.7 ? "strong" : strength > 0 ? "weak" : "missing";

  // Strong elements don't need guidance
  if (elementState === "strong") {
    return {
      element_id: elementId,
      element_name: elementDef.displayName,
      strength,
      state: elementState,
      diagnosis: null,
      story_anchor: null,
      suggestion: null,
      examples: [],
    };
  }

  // Try LLM-generated guidance
  const generateTextFn = options._generateTextFn ?? generateText;
  const llmAvailable = options._generateTextFn || isAvailable();

  if (llmAvailable) {
    try {
      const result = await callGuidanceLLM(state, elementDef, elementState, generateTextFn);
      if (result) {
        return {
          element_id: elementId,
          element_name: elementDef.displayName,
          strength,
          state: elementState,
          ...result,
        };
      }
    } catch (err) {
      console.warn(`[Guidance] LLM guidance failed for ${elementId}:`, err.message);
    }
  }

  // Fallback to template guidance
  return buildTemplateFallback(elementDef, elementState, strength, state);
}

/**
 * Call LLM to generate contextual guidance.
 *
 * @param {Object} state - Story state
 * @param {Object} elementDef - Element definition
 * @param {string} elementState - "weak" or "missing"
 * @param {Function} generateTextFn - LLM generation function
 * @returns {Promise<{diagnosis: string, story_anchor: string|null, suggestion: string, examples: string[]}|null>}
 */
async function callGuidanceLLM(state, elementDef, elementState, generateTextFn) {
  const prompt = buildGuidancePrompt(state, elementDef, elementState);

  const response = await generateTextFn({
    prompt,
    taskType: "simple",
    temperature: 0.3,
    responseMimeType: "application/json",
    maxOutputTokens: 300,
    providers: ["gemini", "anthropic"],
  });

  if (!response?.text) {
    return null;
  }

  return parseGuidanceResponse(response.text);
}

/**
 * Build the LLM prompt for element guidance.
 *
 * Kept concise (~600-800 tokens) for fast inference on lightweight models.
 */
function buildGuidancePrompt(state, elementDef, elementState) {
  const narrative = (state.narrative || "").trim();
  const recipientName = state.recipient_name || "the recipient";
  const occasion = state.occasion || "a special occasion";

  // Collect facts related to this element's slots
  const relatedFacts = (state.facts || [])
    .filter(f => f.beat === elementDef.id || f.beat === elementDef.primarySlot)
    .map(f => f.text)
    .slice(0, 3);

  // Extract relevant atoms
  const atoms = state.atoms || {};
  const relevantAtoms = {};
  const slotKeys = [elementDef.primarySlot, ...(elementDef.bonusSlots || [])];
  for (const key of slotKeys) {
    if (atoms[key]) relevantAtoms[key] = atoms[key];
  }

  // Truncate narrative to save tokens
  const narrativeExcerpt = narrative.length > 600
    ? narrative.slice(0, 600) + "..."
    : narrative;

  return `You are a story coach helping someone write a personal ${occasion} story for ${recipientName}.

STORY SO FAR:
${narrativeExcerpt || "(No narrative yet)"}

RELATED FACTS COLLECTED:
${relatedFacts.length > 0 ? relatedFacts.map(f => `- ${f}`).join("\n") : "(none)"}

ELEMENT TO STRENGTHEN: "${elementDef.displayName}"
PURPOSE: ${elementDef.purpose}
STATE: ${elementState}

Your job: Help the user strengthen "${elementDef.displayName}" with a response grounded in their specific story.

Return JSON:
{
  "diagnosis": "1-2 sentences explaining what's ${elementState} about this element, referencing their specific story content",
  "story_anchor": "exact short quote from the narrative that this element relates to, or null if no narrative exists",
  "suggestion": "a direct question asking for the specific detail needed, using the recipient's name",
  "examples": ["2 concrete examples based on THEIR story context, not generic examples"]
}

Rules:
- diagnosis must reference specific content from the story, not be generic
- story_anchor must be a verbatim quote from the narrative (5-15 words), or null
- suggestion must be phrased as a question
- examples must feel like they could belong in THIS story (use the recipient's name, the occasion, the setting)`;
}

/**
 * Parse and validate the LLM guidance response.
 */
function parseGuidanceResponse(responseText) {
  try {
    let jsonText = responseText;

    // Extract JSON from code blocks
    const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1].trim();
    }

    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    const data = JSON.parse(jsonText);

    // Validate required fields
    if (!data.diagnosis || typeof data.diagnosis !== "string") return null;
    if (!data.suggestion || typeof data.suggestion !== "string") return null;

    return {
      diagnosis: data.diagnosis.slice(0, 300),
      story_anchor: typeof data.story_anchor === "string" ? data.story_anchor.slice(0, 100) : null,
      suggestion: data.suggestion.slice(0, 200),
      examples: Array.isArray(data.examples)
        ? data.examples.filter(e => typeof e === "string").slice(0, 2).map(e => e.slice(0, 200))
        : [],
    };
  } catch {
    return null;
  }
}

/**
 * Build fallback guidance from static templates when LLM is unavailable.
 */
function buildTemplateFallback(elementDef, elementState, strength, _state) {
  const slotId = elementDef.primarySlot;
  const template = SLOT_GUIDANCE_TEMPLATES[slotId];
  const variant = template?.[elementState] || template?.weak || template?.missing;

  return {
    element_id: elementDef.id,
    element_name: elementDef.displayName,
    strength,
    state: elementState,
    diagnosis: variant?.instruction || `This element needs more detail.`,
    story_anchor: null,
    suggestion: SLOT_TO_ELEMENT_FALLBACK[slotId]?.prompt || "Can you add more detail here?",
    examples: variant?.examples || [],
  };
}

/**
 * Find element definition, respecting story mode for reflective stories.
 */
function findElementDefinition(elementId, state) {
  const storyMode = state?.story_mode || state?.storyMode || "default";
  // Import reflective definitions if needed
  const { REFLECTIVE_STORY_ELEMENT_DEFINITIONS } = require("./quality");
  const definitions = storyMode === "reflective_tribute"
    ? REFLECTIVE_STORY_ELEMENT_DEFINITIONS
    : STORY_ELEMENT_DEFINITIONS;
  return definitions.find(d => d.id === elementId) || null;
}

/**
 * Find the computed element (with strength) from story state.
 */
function findElementFromState(state, elementId) {
  // Check storyElements from last reasoning
  const elements = state.story_elements || state.storyElements || [];
  const match = elements.find(e => e.id === elementId);
  if (match) return match;

  // Check readiness element scores
  const readiness = state.readiness || state.last_reasoning?.story_readiness;
  if (readiness?.elementScores) {
    const scoreMatch = readiness.elementScores.find(e => e.id === elementId);
    if (scoreMatch) return { strength: scoreMatch.strength };
  }

  return null;
}

module.exports = {
  generateElementGuidance,
  buildGuidancePrompt,
  parseGuidanceResponse,
  buildTemplateFallback,
  findElementDefinition,
};
