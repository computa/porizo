/**
 * Story Reasoning Engine V3
 *
 * An intelligent, thinking story collection system that reasons holistically
 * about each user input. Uses a single unified LLM call per turn instead of
 * a pipeline of specialized extractors.
 *
 * Key differences from V1:
 * - Dynamic beat schemas (not hardcoded arcs)
 * - Single evolving narrative (not element fragments)
 * - Unified reasoning (not extract → integrate → evaluate → select)
 * - User model detection (brief/verbose, emotional/analytical)
 * - Fatigue detection (know when to stop)
 *
 * Architecture:
 * - One LLM call per turn (reason.js)
 * - State management with grounding validation (state.js)
 * - Dynamic beat generation per event type (beats.js)
 * - Quality checks for story completeness (quality.js)
 *
 * @module writer/v3
 */

const { isDeepStrictEqual } = require("node:util");

// Internal modules
const { createInitialState, validateState, addFact, ensureStateDefaults } = require("./state");
const { composeNarrativeFromFacts, getActiveFacts } = require("./narrative");
const { stripFormulaicOpener } = require("./utils");
const { reasonWithFallback } = require("./reasoner");
const {
  applyReasoningResult,
  addTurnToState,
  generateFallbackResponse,
  applyDeterministicFallbackExtraction,
  loadStateFromSession,
  enforceGrounding,
  getElementSuggestions,
  getSlotSuggestions,
  getOccasionDefaultSuggestions,
} = require("./engine");
const {
  getCompletionFromLLM,
  getCompletionScore,
  computeStoryGapAnalysis,
  computeLabovGapAnalysis,
  pickDeterministicGapQuestion,
  getCriticalConfirmSlotCoverage,
  computeStoryElements,
  getElementConfirmBlock,
  getElementForSlot,
  STORY_ELEMENT_DEFINITIONS,
  REFLECTIVE_STORY_ELEMENT_DEFINITIONS,
  RELATIONSHIP_HINT_REGEX,
  TURN_REGEX,
  TURN_CRISIS_REGEX,
  TURN_TRANSFORMATION_REGEX,
  ENDING_FEEL_REGEX,
  APPRECIATION_REGEX,
  WANT_REGEX,
  BLOCKER_REGEX,
  STAKES_REGEX,
  EVALUATION_REGEX,
  SENSORY_REGEX,
  PAST_ACTION_REGEX,
  DEDICATION_REGEX,
  ORIENTATION_REGEX,
  COMPLICATING_REGEX,
  RESOLUTION_REGEX,
  computeQuestionPriority,
  generateTargetedFallbackQuestion,
  validateQuestionRelevance,
  generateStorySpecificSuggestions,
  getSlotLabovElement,
} = require("./quality");
const { condenseForReasoning } = require("./condense");
const { generateElementGuidance } = require("./guidance");
const { normalizeStyle } = require("../../providers/style-registry");
const {
  deriveStoryBlockProfile,
  evaluateNarrativeBlockCoverage,
  repairNarrativeFromBlockProfile,
  repairSongMapWithProfile,
  extractRetainedDetails,
  computeDetailCoverage,
} = require("../story-semantics");
// NOTE: validateSongContract is lazy-required inside ensureCompletedStoryPackage
// to break the circular dependency: songwriter.js → ./v3 → ../songwriter
const { generateText, isAvailable: isLLMAvailable } = require("../../services/llm-provider");
const { StoryVersionConflictError } = require("../../database/story-repository");

// Engine version identifier
const ENGINE_VERSION = "v3";
const MAX_REPEAT_SLOT_ASKS = 1;
const MAX_REPEAT_SEMANTIC_ASKS = 1;
const SUPPORTED_RUNTIME_ENGINE_VERSIONS = new Set(["v2", "v3"]);
const REVISION_SOURCES = new Set(["review_edit", "confirm_notes", "reopen_edit"]);
const REVISION_OPERATION_TYPES = new Set(["append", "replace", "remove", "resolve_conflict", "final_notes"]);
const REVISION_TARGET_TYPES = new Set(["narrative", "fact", "beat", "section", "conflict"]);

// Repository instance (set by initialize)
let storyRepo = null;

// LLM rewrite timeout for confirmation-path narrative enhancement (ms)
const LLM_REWRITE_TIMEOUT_MS = 8000;
// Only attempt LLM rewrite when missing ratio is below this threshold
const LLM_REWRITE_MAX_MISSING_RATIO = 0.4;

/**
 * LLM-powered narrative rewrite that weaves missing details into the prose.
 * Used ONLY on the confirmation path (not per-turn) for cost control.
 *
 * @param {string} prose - Current narrative text
 * @param {string[]} missingDetails - Detail sentences to weave in
 * @param {string} recipientName - Name of the story recipient
 * @returns {Promise<string|null>} Rewritten narrative, or null on failure
 */
async function rewriteNarrativeWithMissingDetails(prose, missingDetails, recipientName) {
  if (!isLLMAvailable()) return null;

  const totalMissingText = missingDetails.join(" ");
  const maxLength = prose.length + totalMissingText.length * 1.3;

  const prompt = `You are rewriting a completed story narrative to weave in missing details.

CURRENT NARRATIVE:
${prose}

MISSING DETAILS THAT MUST BE WOVEN IN:
${missingDetails.map(d => `- ${d}`).join("\n")}

RULES:
- Keep the narrative in third person about ${recipientName || "the person"}
- Do NOT add invented details
- Do NOT remove existing content
- Weave each missing detail naturally into the appropriate part of the story
- Keep total length under ${Math.ceil(maxLength)} characters
- Preserve the story arc: setup → conflict → turning point → transformation → meaning

Return ONLY the rewritten narrative text. No preamble, no explanation.`;

  try {
    const result = await Promise.race([
      generateText({
        prompt,
        taskType: "story",
        temperature: 0.4,
        maxOutputTokens: Math.ceil(maxLength / 3),
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("LLM rewrite timed out")), LLM_REWRITE_TIMEOUT_MS);
      }),
    ]);

    const rewritten = (result?.text || "").trim();
    if (!rewritten || rewritten.length > maxLength * 1.2) return null;
    return rewritten;
  } catch (err) {
    console.warn("[V3] LLM narrative rewrite failed:", err.message);
    return null;
  }
}

/**
 * Enrich template-based slot guidance with LLM-generated context.
 *
 * Maps a target slot to its parent element, calls generateElementGuidance(),
 * and merges the result into the existing slotGuidance shape.
 * Falls back to the original template guidance on failure.
 *
 * @param {Object} templateGuidance - Original template guidance from pickDeterministicGapQuestion
 * @param {string} targetSlot - The slot being targeted (e.g. "turn", "who")
 * @param {Object} state - Current story state
 * @returns {Promise<Object|null>} Enriched guidance or original template
 */
async function enrichSlotGuidance(templateGuidance, targetSlot, state) {
  if (!targetSlot || !state) return templateGuidance;

  const storyMode = state.story_mode || state.storyMode || "default";
  const definitions = storyMode === "reflective_tribute"
    ? REFLECTIVE_STORY_ELEMENT_DEFINITIONS
    : STORY_ELEMENT_DEFINITIONS;

  const elementDef = definitions.find(
    d => d.primarySlot === targetSlot || (d.bonusSlots || []).includes(targetSlot)
  );
  if (!elementDef) return templateGuidance;

  try {
    const guidance = await generateElementGuidance(state, elementDef.id);
    if (!guidance || guidance.state === "strong") return templateGuidance;

    return {
      ...(templateGuidance || {}),
      diagnosis: guidance.diagnosis,
      storyAnchor: guidance.story_anchor,
      suggestion: guidance.suggestion,
      examples: guidance.examples?.length ? guidance.examples : templateGuidance?.examples || [],
    };
  } catch (err) {
    console.warn(`[V3 Engine] enrichSlotGuidance failed for ${targetSlot}:`, err.message);
    return templateGuidance;
  }
}

/**
 * Initialize the V3 engine with a story repository
 *
 * @param {Object} repo - Story repository instance
 */
function initialize(repo) {
  storyRepo = repo;
}

function normalizeRuntimeEngineVersion(value, fallback = ENGINE_VERSION) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (SUPPORTED_RUNTIME_ENGINE_VERSIONS.has(normalized)) {
    // Treat legacy V2-labeled sessions as V3 runtime sessions.
    return ENGINE_VERSION;
  }
  return fallback;
}

function getCanonicalNarrative(state) {
  if (!state || typeof state !== "object") return "";
  if (typeof state.narrative_current === "string" && state.narrative_current.trim()) {
    return state.narrative_current;
  }
  if (typeof state.narrative === "string") {
    return state.narrative;
  }
  return "";
}

function isRichStoryTurn(text) {
  const normalized = typeof text === "string" ? text.trim() : "";
  if (!normalized) return false;

  const sentenceCount = normalized
    .split(/(?<=[.!?])\s+|(?:\s*\n+\s*)/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .length;
  const paragraphCount = normalized
    .split(/\n{2,}/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .length;

  return normalized.length > 1400 || sentenceCount >= 5 || paragraphCount >= 2;
}

function getReasoningCondenseLimit(text, { initial = false } = {}) {
  if (!isRichStoryTurn(text)) {
    return 1700;
  }
  return initial ? 3200 : 2400;
}

function countConsecutiveSlotAsks(gapHistory, slot) {
  if (!Array.isArray(gapHistory) || !slot) return 0;
  let count = 0;
  for (let i = gapHistory.length - 1; i >= 0; i -= 1) {
    const entry = gapHistory[i];
    if (!entry || entry.slot !== slot) break;
    count += 1;
  }
  return count;
}

function buildSemanticBlockSignature(semanticStory = {}) {
  const missing = Array.isArray(semanticStory?.missing_narrative_blocks)
    ? [...semanticStory.missing_narrative_blocks].sort()
    : [];
  const weak = Array.isArray(semanticStory?.weak_contract_sections)
    ? [...semanticStory.weak_contract_sections].sort()
    : [];
  return JSON.stringify({
    missing,
    weak,
    duplicated: Boolean(semanticStory?.duplicated_thesis),
  });
}

function countConsecutiveSemanticAsks(history, signature) {
  if (!Array.isArray(history) || !signature) return 0;
  let count = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (!entry || entry.signature !== signature) break;
    count += 1;
  }
  return count;
}

function normalizeStateForSemanticCompare(state) {
  if (!state || typeof state !== "object") return state;
  const semanticStory = state.semantic_story && typeof state.semantic_story === "object"
    ? { ...state.semantic_story }
    : state.semantic_story;
  if (semanticStory && typeof semanticStory === "object") {
    delete semanticStory.updated_at;
  }
  return {
    ...state,
    semantic_story: semanticStory,
  };
}

async function persistSemanticStateIfChanged(sessionId, session, previousState, nextState) {
  if (!storyRepo || !sessionId || !session) return;
  if (isDeepStrictEqual(
    normalizeStateForSemanticCompare(previousState),
    normalizeStateForSemanticCompare(nextState),
  )) {
    return;
  }

  await storyRepo.updateSession(sessionId, {
    v2State: nextState,
    status: nextState.status || session.status || "active",
    expectedVersion: session.version,
  });
}

function deriveLlmReadySignal(response, state) {
  const action = response?.action;
  if (action === "STOP") return true;

  const readiness = state?.last_reasoning?.story_readiness;
  const userState = state?.last_reasoning?.user_state;
  const strongCount = Array.isArray(readiness?.strong_elements) ? readiness.strong_elements.length : 0;
  const weakCount = Array.isArray(readiness?.weak_elements) ? readiness.weak_elements.length : 0;
  const primitives = state?.primitives || {};
  const atoms = state?.atoms || {};
  const hasPayoff = [
    primitives.resolution,
    primitives.theme,
    atoms.after,
  ].some(value => typeof value === "string" && value.trim());
  const hasTurn = [
    primitives.turning_point,
    atoms.turn,
  ].some(value => typeof value === "string" && value.trim());

  if (action === "CONFIRM") {
    return hasPayoff && (hasTurn || strongCount >= 3);
  }

  if (readiness?.has_emotional_depth === true && hasPayoff && strongCount >= 2 && weakCount <= 2) {
    return true;
  }

  if (userState?.seems_done === true && readiness?.has_emotional_depth === true && hasPayoff && strongCount >= 1) {
    return true;
  }

  return false;
}

function buildReadyConfirmation(state, gapAnalysis) {
  const recipient = state?.recipient_name || "them";
  const narrative = getCanonicalNarrative(state);
  if (narrative) {
    return `I’ve integrated your story into one coherent narrative for ${recipient}. It feels complete and ready. Should I lock this in for lyrics?`;
  }

  const covered = (gapAnalysis?.slots || []).filter((slot) => slot.status === "covered").length;
  return `I have enough detail to move forward for ${recipient} (${covered} core story elements covered). Should I lock this in for lyrics?`;
}

function buildSemanticClarificationPrompt(state) {
  const missingBlocks = Array.isArray(state?.semantic_story?.missing_narrative_blocks)
    ? state.semantic_story.missing_narrative_blocks
    : [];
  const weakSections = Array.isArray(state?.semantic_story?.weak_contract_sections)
    ? state.semantic_story.weak_contract_sections
    : [];
  const primary = missingBlocks[0];

  if (primary === "transformation") {
    return {
      question: "Before I lock this in, tell me one line about how this changed them or how you saw them grow.",
      suggestions: ["It changed everything between us", "They became a different person after that", "I saw them grow stronger"],
    };
  }
  if (primary === "meaning") {
    return {
      question: "Before I lock this in, what does this story ultimately mean to you, beyond what happened?",
      suggestions: ["It taught me what love really means", "This is why they matter so much to me", "It showed me who we really are"],
    };
  }
  if (primary === "turn") {
    return {
      question: "Before I lock this in, what was the exact moment things changed?",
      suggestions: ["There was this one moment when everything shifted", "It all clicked when they said...", "The turning point was when"],
    };
  }
  if (weakSections.includes("chorus")) {
    return {
      question: "Before I lock this in, what is the emotional truth of this story, not just the timeline?",
      suggestions: ["The real feeling underneath all of it is...", "What I keep coming back to is...", "At its core this is about"],
    };
  }
  if (weakSections.includes("bridge")) {
    return {
      question: "Before I lock this in, what realization or transformation should land near the end?",
      suggestions: ["The biggest realization was...", "Looking back now I understand that...", "What I want them to feel is"],
    };
  }
  return {
    question: "Before I lock this in, give me one more line about what changed or what this story means to you.",
    suggestions: ["What matters most is...", "The thing I'll never forget is...", "This changed everything because"],
  };
}

function createStoryNeedsInputError({ question, suggestions, missingBlocks, sessionVersion }) {
  const safeQuestion = typeof question === "string" && question.trim()
    ? question.trim()
    : "Before I lock this in, give me one more line about what changed or what this story means to you.";
  const err = new Error(safeQuestion);
  err.code = "STORY_NEEDS_INPUT";
  err.question = safeQuestion;
  err.suggestions = Array.isArray(suggestions) ? suggestions : [];
  err.missingBlocks = Array.isArray(missingBlocks) ? missingBlocks : [];
  err.sessionVersion = Number.isFinite(Number(sessionVersion)) ? Number(sessionVersion) : null;
  return err;
}

function deriveDraftLifecycle(state) {
  if (!state || typeof state !== "object") return "drafting";
  if (typeof state.draft_lifecycle === "string" && state.draft_lifecycle.trim()) {
    return state.draft_lifecycle;
  }
  if (state.status === "confirmed") return "confirmed";
  if (state.status === "ready_for_confirm") return "review_ready";
  return "drafting";
}

function normalizeRevisionOperation(operation) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    return null;
  }

  const type = REVISION_OPERATION_TYPES.has(operation.type) ? operation.type : "append";
  const targetType = REVISION_TARGET_TYPES.has(operation.target_type) ? operation.target_type : null;
  const targetId = typeof operation.target_id === "string" && operation.target_id.trim()
    ? operation.target_id.trim()
    : null;
  const targetText = typeof operation.target_text === "string" && operation.target_text.trim()
    ? operation.target_text.trim()
    : null;
  const replacementText = typeof operation.replacement_text === "string" && operation.replacement_text.trim()
    ? operation.replacement_text.trim()
    : null;
  const resolution = typeof operation.resolution === "string" && operation.resolution.trim()
    ? operation.resolution.trim()
    : null;

  return {
    type,
    target_type: targetType,
    target_id: targetId,
    target_text: targetText,
    replacement_text: replacementText,
    resolution,
  };
}

function buildStructuredRevisionPrompt(revisionRequest, operation) {
  const trimmedRequest = typeof revisionRequest === "string" ? revisionRequest.trim() : "";
  const normalizedOperation = normalizeRevisionOperation(operation);
  if (!normalizedOperation) {
    return trimmedRequest;
  }

  const targetBits = [
    normalizedOperation.target_type ? `target type: ${normalizedOperation.target_type}` : null,
    normalizedOperation.target_id ? `target id: ${normalizedOperation.target_id}` : null,
    normalizedOperation.target_text ? `target text: "${normalizedOperation.target_text}"` : null,
  ].filter(Boolean);
  const targetContext = targetBits.length > 0 ? ` (${targetBits.join(", ")})` : "";

  switch (normalizedOperation.type) {
    case "replace":
      return `Replace the specified draft content${targetContext}.${normalizedOperation.replacement_text ? ` New text: "${normalizedOperation.replacement_text}".` : ""}${trimmedRequest ? ` User note: ${trimmedRequest}` : ""}`.trim();
    case "remove":
      return `Remove the specified draft content${targetContext}.${trimmedRequest ? ` User note: ${trimmedRequest}` : ""}`.trim();
    case "resolve_conflict":
      return `Resolve the specified story conflict${targetContext}.${normalizedOperation.resolution ? ` Resolution: ${normalizedOperation.resolution}.` : ""}${trimmedRequest ? ` User note: ${trimmedRequest}` : ""}`.trim();
    case "final_notes":
      return `Apply these final notes before lock-in: ${trimmedRequest}`.trim();
    case "append":
    default:
      return trimmedRequest;
  }
}

function buildFactInventory(state) {
  return getActiveFacts(state?.facts || []).map((fact) => ({
    id: fact.id,
    text: fact.text,
    beat: fact.beat || null,
    source_turn: Number.isFinite(Number(fact.source_turn)) ? Number(fact.source_turn) : null,
    status: fact.status || "active",
  }));
}

/**
 * Derive a structured summary from state.facts and state.conversation.
 *
 * This is a read-only derivation — state.facts remains the source of truth.
 * The returned object powers {{already_known}} and {{already_asked}} prompt
 * injections so the LLM stops re-asking about answered topics.
 *
 * @param {Object} state - Current V3 state
 * @returns {Object} Derived story state with labov, sensoryDetails, questionsAsked
 */
function extractStoryState(state) {
  const facts = Array.isArray(state?.facts)
    ? state.facts.filter((f) => (f?.status || "active") === "active")
    : [];
  const conversation = Array.isArray(state?.conversation) ? state.conversation : [];

  // --- Recipient ---
  const recipientName = state?.atoms?.who || null;
  let relationship = null;
  const factsCorpus = facts.map((f) => f.text || "").join(" ");
  const relMatch = factsCorpus.match(RELATIONSHIP_HINT_REGEX);
  if (relMatch) {
    relationship = relMatch[1].toLowerCase();
  }

  // --- Labov element classification ---
  // ORIENTATION_REGEX, COMPLICATING_REGEX, RESOLUTION_REGEX, EVALUATION_REGEX
  // all imported from quality.js to ensure scoring and fact tracking agree

  const labov = {
    orientation: { strength: 0, key_facts: [] },
    complicating_action: { strength: 0, key_facts: [] },
    evaluation: { strength: 0, key_facts: [] },
    resolution: { strength: 0, key_facts: [] },
  };

  for (const fact of facts) {
    const text = fact.text || "";
    if (!text.trim()) continue;

    // A fact can contribute to multiple Labov elements
    if (ORIENTATION_REGEX.test(text) || RELATIONSHIP_HINT_REGEX.test(text)) {
      labov.orientation.key_facts.push(text);
    }
    if (COMPLICATING_REGEX.test(text) || TURN_REGEX.test(text) || TURN_CRISIS_REGEX.test(text)) {
      labov.complicating_action.key_facts.push(text);
    }
    if (EVALUATION_REGEX.test(text) || ENDING_FEEL_REGEX.test(text) || APPRECIATION_REGEX.test(text)) {
      labov.evaluation.key_facts.push(text);
    }
    if (RESOLUTION_REGEX.test(text) || TURN_TRANSFORMATION_REGEX.test(text)) {
      labov.resolution.key_facts.push(text);
    }
  }

  // Atoms boost orientation
  if (state?.atoms?.who) labov.orientation.strength += 0.3;
  if (state?.atoms?.where) labov.orientation.strength += 0.2;
  if (state?.atoms?.when) labov.orientation.strength += 0.2;
  labov.orientation.strength += Math.min(0.3, labov.orientation.key_facts.length * 0.15);
  labov.orientation.strength = Math.min(1, labov.orientation.strength);

  labov.complicating_action.strength = Math.min(1, labov.complicating_action.key_facts.length * 0.25);
  labov.evaluation.strength = Math.min(1, labov.evaluation.key_facts.length * 0.2);
  labov.resolution.strength = Math.min(1, labov.resolution.key_facts.length * 0.3);

  // --- Sensory details ---
  // Extract concrete nouns, proper nouns, specific objects from facts
  const PROPER_NOUN_REGEX = /\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\b/g;
  // /g for .match() (all occurrences), separate /i-only for .test() to avoid lastIndex bug
  const SPECIFIC_DETAIL_MATCH_REGEX = /\b(mint chocolate chip|dancing queen|vanilla|strawberry|chocolate|roses|guitar|piano|sunset|beach|rain|snow|coffee|wine|candle|photograph|letter|ring|necklace|bracelet|song|melody|lullaby)\b/gi;
  const SPECIFIC_DETAIL_TEST_REGEX = /\b(mint chocolate chip|dancing queen|vanilla|strawberry|chocolate|roses|guitar|piano|sunset|beach|rain|snow|coffee|wine|candle|photograph|letter|ring|necklace|bracelet|song|melody|lullaby)\b/i;
  const sensorySet = new Set();
  const recipientLower = (recipientName || "").toLowerCase();
  for (const fact of facts) {
    const text = fact.text || "";
    const specificMatches = text.match(SPECIFIC_DETAIL_MATCH_REGEX) || [];
    for (const m of specificMatches) {
      sensorySet.add(m.toLowerCase());
    }
    // Also grab proper nouns that aren't the recipient name
    const properMatches = text.match(PROPER_NOUN_REGEX) || [];
    for (const m of properMatches) {
      const lower = m.toLowerCase();
      if (lower !== recipientLower && lower.length > 2 && !["the", "and", "but", "she", "her", "his", "they"].includes(lower)) {
        // Only include multi-word proper nouns or known-specific single words
        if (m.includes(" ") || SPECIFIC_DETAIL_TEST_REGEX.test(m)) {
          sensorySet.add(m);
        }
      }
    }
  }
  const sensoryDetails = [...sensorySet];

  // --- Questions asked by the assistant ---
  const questionsAsked = [];
  for (let i = 0; i < conversation.length; i++) {
    const turn = conversation[i];
    if (turn.role !== "assistant") continue;
    const content = turn.content || "";
    // Extract questions (sentences ending with ?)
    const questionMatches = content.match(/[^.!?]*\?/g);
    if (!questionMatches) continue;

    // Determine which round this is (count user turns before this assistant turn)
    const round = conversation.slice(0, i).filter((t) => t.role === "user").length;

    // Check if there's a user response after this assistant turn
    const nextUserTurn = conversation.slice(i + 1).find((t) => t.role === "user");
    const answered = Boolean(nextUserTurn);
    const answerSummary = answered
      ? (nextUserTurn.content || "").slice(0, 100)
      : null;

    for (const q of questionMatches) {
      const trimmedQ = q.trim();
      if (trimmedQ.length < 10) continue; // Skip very short fragments
      questionsAsked.push({
        round,
        question: trimmedQ,
        answered,
        answerSummary,
      });
    }
  }

  const occasion = state?.occasion || state?.event?.occasion || undefined;

  return {
    recipient: { name: recipientName, relationship },
    labov,
    sensoryDetails,
    questionsAsked,
    occasion,
  };
}

function buildConflictInventory(state) {
  const conflicts = Array.isArray(state?.open_conflicts) ? state.open_conflicts : [];
  return conflicts.map((conflict) => ({
    id: conflict.id || null,
    type: conflict.type || "fact_conflict",
    summary: conflict.summary || `${conflict.first_fact_id || "fact"} conflicts with ${conflict.second_fact_id || conflict.conflicting_fact_id || "another fact"}`,
    first_fact_id: conflict.first_fact_id || null,
    second_fact_id: conflict.second_fact_id || conflict.conflicting_fact_id || null,
    source_turn: Number.isFinite(Number(conflict.source_turn)) ? Number(conflict.source_turn) : null,
    status: conflict.status || "open",
  }));
}

function buildDraftDiff(state, previousScore, currentScore) {
  const revisions = Array.isArray(state?.narrative_revisions) ? state.narrative_revisions : [];
  if (revisions.length === 0) return null;
  const latest = revisions[revisions.length - 1];
  const previous = revisions.length > 1 ? revisions[revisions.length - 2] : null;
  return {
    from_version: previous?.version || 0,
    to_version: latest?.version || state?.narrative_version || 0,
    before_text: previous?.narrative || "",
    after_text: latest?.narrative || getCanonicalNarrative(state),
    timestamp: latest?.timestamp || state?.updated_at || null,
    integration_delta: state?.last_integration_delta || null,
    before_score: previousScore ?? null,
    after_score: currentScore ?? null,
  };
}

function summarizeIntegrationDelta(integrationDelta) {
  if (!integrationDelta || typeof integrationDelta !== "object") return null;
  const parts = [];
  if (integrationDelta.narrative_rewritten) parts.push("narrative rewritten");
  if (Array.isArray(integrationDelta.added_facts) && integrationDelta.added_facts.length > 0) {
    parts.push(`${integrationDelta.added_facts.length} detail added`);
  }
  if (Array.isArray(integrationDelta.updated_facts) && integrationDelta.updated_facts.length > 0) {
    parts.push(`${integrationDelta.updated_facts.length} detail updated`);
  }
  if (Array.isArray(integrationDelta.superseded_facts) && integrationDelta.superseded_facts.length > 0) {
    parts.push(`${integrationDelta.superseded_facts.length} detail replaced`);
  }
  if (Array.isArray(integrationDelta.conflicts_detected) && integrationDelta.conflicts_detected.length > 0) {
    parts.push(`${integrationDelta.conflicts_detected.length} conflict noted`);
  }
  if (Array.isArray(integrationDelta.conflicts_resolved) && integrationDelta.conflicts_resolved.length > 0) {
    parts.push(`${integrationDelta.conflicts_resolved.length} conflict resolved`);
  }
  return parts.length > 0 ? parts.join(" • ") : null;
}

function buildRevisionHistory(state) {
  const revisions = Array.isArray(state?.narrative_revisions) ? state.narrative_revisions : [];
  const revisionRequests = Array.isArray(state?.revision_requests) ? state.revision_requests : [];

  const requestsByVersion = new Map();
  for (let i = revisionRequests.length - 1; i >= 0; i--) {
    const entry = revisionRequests[i];
    const ver = Number(entry?.after_version || entry?.narrative_version || 0);
    if (!requestsByVersion.has(ver)) {
      requestsByVersion.set(ver, entry);
    }
  }

  return revisions.map((revision, index) => {
    const previous = index > 0 ? revisions[index - 1] : null;
    const matchingRequest = requestsByVersion.get(Number(revision?.version || 0)) || null;

    return {
      id: matchingRequest?.id || `version_${revision.version || index + 1}`,
      version: revision.version || index + 1,
      source: matchingRequest?.source || (index === 0 ? "system_review" : "conversation"),
      request: matchingRequest?.request || null,
      status: matchingRequest?.status || "applied",
      timestamp: matchingRequest?.requested_at || revision.timestamp || null,
      summary: summarizeIntegrationDelta(matchingRequest?.integration_delta || revision.integration || state?.last_integration_delta || null),
      before_text: matchingRequest?.before_narrative ?? previous?.narrative ?? "",
      after_text: matchingRequest?.after_narrative ?? revision.narrative ?? "",
      before_version: matchingRequest?.before_version ?? previous?.version ?? 0,
      after_version: matchingRequest?.after_version ?? revision.version ?? 0,
      operation: matchingRequest?.operation || null,
      integration_delta: matchingRequest?.integration_delta || revision.integration || null,
    };
  });
}

function buildPendingRevision(state) {
  if (state?.pending_revision && typeof state.pending_revision === "object") {
    return state.pending_revision;
  }
  const lastRevision = state?.last_revision_request;
  if (lastRevision?.status === "clarification_needed") {
    return {
      id: lastRevision.id,
      request: lastRevision.request,
      source: lastRevision.source,
      operation: lastRevision.operation || null,
      waiting_for: "clarification",
      follow_up_question: null,
      requested_at: lastRevision.requested_at || null,
    };
  }
  return null;
}

function buildStoryProvenance(state, sessionId, engineVersion) {
  return {
    story_id: sessionId,
    engine_version: engineVersion,
    draft_lifecycle: deriveDraftLifecycle(state),
    narrative_version: Number(state?.narrative_version || 0),
    confirmed_narrative_version: Number(state?.last_confirmed_narrative_version || 0) || null,
    confirmed_at: state?.last_confirmed_at || state?.confirmed_at || null,
  };
}

function buildDraftMetadataBundle(state, sessionId, engineVersion, { beforeScore, afterScore } = {}) {
  return {
    draftLifecycle: deriveDraftLifecycle(state),
    factInventory: buildFactInventory(state),
    openConflicts: buildConflictInventory(state),
    revisionHistory: buildRevisionHistory(state),
    draftDiff: buildDraftDiff(state, beforeScore, afterScore),
    pendingRevision: buildPendingRevision(state),
    storyProvenance: buildStoryProvenance(state, sessionId, engineVersion),
  };
}

function applySemanticNarrativeRepair(state, narrative, missingBlocks = []) {
  const nextNarrative = typeof narrative === "string" ? narrative.trim() : "";
  if (!nextNarrative || nextNarrative === getCanonicalNarrative(state)) {
    return state;
  }

  const now = new Date().toISOString();
  const nextVersion = Math.max(Number(state?.narrative_version || 0), 0) + 1;
  const revisionEntry = {
    version: nextVersion,
    turn: state?.turn_count || 0,
    narrative: nextNarrative,
    timestamp: now,
    integration: {
      added_facts: [],
      updated_facts: [],
      superseded_facts: [],
      semantic_repair: true,
      repaired_blocks: [...missingBlocks],
    },
  };
  const integrationDelta = {
    turn: state?.turn_count || 0,
    timestamp: now,
    added_facts: [],
    updated_facts: [],
    superseded_facts: [],
    conflicts_detected: [],
    conflicts_resolved: [],
    narrative_rewritten: true,
    semantic_repair: true,
    repaired_blocks: [...missingBlocks],
  };

  return {
    ...state,
    narrative: nextNarrative,
    narrative_current: nextNarrative,
    narrative_version: nextVersion,
    narrative_revisions: [...(Array.isArray(state?.narrative_revisions) ? state.narrative_revisions : []), revisionEntry].slice(-40),
    integration_history: [...(Array.isArray(state?.integration_history) ? state.integration_history : []), integrationDelta].slice(-40),
    last_integration_delta: integrationDelta,
    updated_at: now,
  };
}

function ensureSemanticStoryIntegrity(state) {
  if (!state || typeof state !== "object") return state;

  const blockProfile = deriveStoryBlockProfile(state);
  let nextState = state;
  let repairedNarrative = false;
  let repairedSongMap = false;
  let narrativeCoverage = evaluateNarrativeBlockCoverage(getCanonicalNarrative(nextState), blockProfile);

  if ((blockProfile.enforcedNarrativeBlocks || []).length > 0 && narrativeCoverage.missingBlocks.length > 0) {
    const repaired = repairNarrativeFromBlockProfile(getCanonicalNarrative(nextState), blockProfile);
    if (repaired.repaired && repaired.narrative) {
      nextState = applySemanticNarrativeRepair(nextState, repaired.narrative, repaired.addedBlocks);
      repairedNarrative = true;
      narrativeCoverage = repaired.coverage;
    }
  }

  const songMapRepair = repairSongMapWithProfile(nextState.song_map, nextState, { blockProfile });
  if (songMapRepair.repaired) {
    nextState = {
      ...nextState,
      song_map: songMapRepair.song_map,
      updated_at: new Date().toISOString(),
    };
    repairedSongMap = true;
  }

  const baseSemanticValidity = {
    rich_story: blockProfile.richStory,
    required_blocks: blockProfile.requiredBlocks,
    enforced_narrative_blocks: blockProfile.enforcedNarrativeBlocks || [],
    missing_narrative_blocks: narrativeCoverage.missingBlocks,
    contract_valid: songMapRepair.report.valid,
    weak_contract_sections: songMapRepair.report.weakSections,
    duplicated_thesis: songMapRepair.report.duplicatedThesis,
    repaired_narrative: repairedNarrative,
    repaired_song_map: repairedSongMap,
  };
  const semanticSignature = buildSemanticBlockSignature(baseSemanticValidity);
  const overrideActive = state?.semantic_override?.signature === semanticSignature
    && Number(state?.semantic_override?.count || 0) >= MAX_REPEAT_SEMANTIC_ASKS;
  const nextSemanticValidity = {
    ...baseSemanticValidity,
    can_confirm: overrideActive || (narrativeCoverage.missingBlocks.length === 0 && songMapRepair.report.valid),
    exhaustion_override: overrideActive,
  };
  const previousSemanticValidity = nextState.semantic_story && typeof nextState.semantic_story === "object"
    ? { ...nextState.semantic_story }
    : null;
  if (previousSemanticValidity && typeof previousSemanticValidity === "object") {
    delete previousSemanticValidity.updated_at;
  }
  const semanticValidity = previousSemanticValidity && isDeepStrictEqual(previousSemanticValidity, nextSemanticValidity)
    ? nextState.semantic_story
    : {
      ...nextSemanticValidity,
      updated_at: new Date().toISOString(),
    };

  return {
    ...nextState,
    semantic_story: semanticValidity,
  };
}

/**
 * Build or update the completed story package on state.
 *
 * The package captures:
 * - retained_details: normalized inventory of concrete details from all sources
 * - detail_coverage_map: per-detail status (preserved/paraphrased/missing) vs prose
 * - semantic_block_profile: story block presence (setup, conflict, turn, transformation, meaning)
 * - prose: the authoritative completed story narrative
 *
 * Built once when narrative is first ready, then updated incrementally on follow-up turns.
 *
 * DESIGN: Two-tier narrative repair
 *
 *   Per-turn (this function): Append-only repair.
 *     Fast, no LLM call, keeps per-turn latency < 200ms.
 *     Missing required details are appended as sentences.
 *
 *   At confirmation (confirmStoryV3): LLM-powered rewrite.
 *     Weaves missing details naturally into prose. 8s timeout.
 *     Only fires when requiredMissing/requiredTotal < 0.4.
 *     Fallback: append-only result preserved on failure.
 *
 *   This is deliberate: per-turn LLM rewrite would add ~$0.02/turn
 *   (estimate) and 5-8s latency per chat message.
 *
 * @param {Object} state - V3 story state
 * @param {Object} context - Story context with facts, conversation, initial_prompt
 * @returns {{ state: Object, repaired: boolean, coverage: Object }}
 */
const COMPLETED_STORY_SCHEMA_VERSION = 2;

function ensureCompletedStoryPackage(state, context) {
  if (!state || typeof state !== "object") {
    return { state, repaired: false, coverage: null };
  }

  const narrative = getCanonicalNarrative(state);
  if (!narrative) {
    return { state, repaired: false, coverage: null };
  }

  // If package already exists, narrative hasn't changed, and schema is current, reuse it
  const existing = state.completed_story_package;
  if (
    existing &&
    typeof existing === "object" &&
    existing.prose === narrative &&
    existing.schema_version === COMPLETED_STORY_SCHEMA_VERSION &&
    Array.isArray(existing.retained_details) &&
    existing.retained_details.length > 0
  ) {
    // Lazy backfill: add content-hash IDs to existing details that lack them
    if (existing.retained_details.some(d => !d.id)) {
      const { detailId, normalizeKey } = require("../story-semantics");
      existing.retained_details.forEach(d => {
        if (!d.id) d.id = detailId(d.category, normalizeKey(d.text));
      });
    }
    return { state, repaired: false, coverage: existing.detail_coverage_map };
  }

  // Extract retained details from all source material
  const retainedDetails = extractRetainedDetails(context || state);
  if (!retainedDetails.length) {
    return { state, repaired: false, coverage: null };
  }

  // Compute coverage of retained details against current narrative
  let coverage = computeDetailCoverage(retainedDetails, narrative);
  let repairedNarrative = narrative;
  let repaired = false;

  // If required details are missing, attempt additive repair (one pass only)
  if (coverage.stats.requiredMissing > 0) {
    const missingSentences = coverage.missingRequired
      .map((entry) => entry.text)
      .filter((text) => typeof text === "string" && text.trim().length > 0);

    if (missingSentences.length > 0) {
      // Additive: append missing detail sentences to the narrative
      const suffix = missingSentences.join(" ");
      repairedNarrative = `${narrative.trimEnd()} ${suffix}`;
      coverage = computeDetailCoverage(retainedDetails, repairedNarrative);
      repaired = true;
    }
  }

  const blockProfile = deriveStoryBlockProfile(context || state);

  // Warn when condensation may have caused detail loss
  const detailBudgetWarning =
    repairedNarrative.length > 3000 && coverage.stats.coverageRate < 0.8
      ? `Story is ${repairedNarrative.length} characters with ${coverage.stats.missing} details below coverage threshold. Consider focusing on the most important moments.`
      : null;

  const completedStoryPackage = {
    prose: repairedNarrative,
    retained_details: retainedDetails,
    detail_coverage_map: coverage,
    semantic_block_profile: blockProfile,
    detail_budget_warning: detailBudgetWarning,
    schema_version: COMPLETED_STORY_SCHEMA_VERSION,
    built_at: new Date().toISOString(),
  };

  let nextState = state;

  // If narrative was repaired, apply through the standard repair path
  if (repaired && repairedNarrative !== narrative) {
    nextState = applySemanticNarrativeRepair(nextState, repairedNarrative, ["detail_coverage_repair"]);
  }

  // Re-derive song_map from repaired prose (don't use stale pre-repair blockProfile)
  if (repaired && nextState.song_map) {
    // Lazy require to break circular dependency: songwriter.js → ./v3 → ../songwriter
    const { validateSongContract } = require("../songwriter");
    const freshProfile = deriveStoryBlockProfile(nextState);
    const reDerived = repairSongMapWithProfile(nextState.song_map, nextState, { blockProfile: freshProfile });

    // Guard: only accept if re-derivation improves or maintains validity
    const oldValid = validateSongContract?.(nextState)?.valid;
    const newState = { ...nextState, song_map: reDerived.song_map };
    const newValid = validateSongContract?.(newState)?.valid;

    if (newValid || !oldValid) {
      // Accept: either new is valid, or old wasn't valid either (can't get worse)
      nextState = newState;
    }
    // else: keep original song_map (re-derivation would degrade)
  }

  nextState = {
    ...nextState,
    completed_story_package: completedStoryPackage,
  };

  console.log(
    `[V3] Completed story package: ${coverage.stats.preserved}/${coverage.stats.total} preserved, ` +
    `${coverage.stats.paraphrased} paraphrased, ${coverage.stats.requiredMissing} required missing` +
    (repaired ? " (repaired)" : ""),
  );

  return { state: nextState, repaired, coverage };
}

function getTurnProgressScore(state, gapAnalysis, action, elements) {
  if (!elements) elements = computeStoryElements(gapAnalysis);
  const requiredEls = elements.filter(el => el.is_required);
  const optionalEls = elements.filter(el => !el.is_required);
  const weightedSum = requiredEls.reduce((s, el) => s + el.strength * 2, 0)
    + optionalEls.reduce((s, el) => s + el.strength, 0);
  const weightedMax = requiredEls.length * 2 + optionalEls.length;
  const score = Math.round((weightedSum / Math.max(weightedMax, 1)) * 100);
  if (action === "CONFIRM" || action === "STOP") {
    return Math.max(score, 90);
  }
  return score;
}

function computeDecisionContext(response, state, options = {}) {
  const useLabovScoring = state?.flags?.labov_scoring === true;
  const gapAnalysis = useLabovScoring
    ? computeLabovGapAnalysis(state, { occasion: state?.event?.occasion || state?.occasion, turnCount: state?.turn_count })
    : computeStoryGapAnalysis(state);
  const gapQuestion = pickDeterministicGapQuestion(gapAnalysis);
  const criticalCoverage = getCriticalConfirmSlotCoverage(gapAnalysis);
  const elements = computeStoryElements(gapAnalysis);
  const elementBlock = getElementConfirmBlock(elements);
  const llmReadySignal = deriveLlmReadySignal(response, state);
  const hardSafetyBlock = state?.last_reasoning?.safety?.blocked === true ||
    state?.last_reasoning?.safety?.requires_refusal === true ||
    state?.last_reasoning?.safety_violation === true;
  const hardGroundingBlock = state?.grounding_enforced && state?.grounding_issue === "no_facts";
  const hardCriticalBlock = criticalCoverage.hasBlockingGap;
  const hardElementBlock = elementBlock.hasElementBlock;
  const hardSemanticBlock = state?.semantic_story?.can_confirm === false;
  const isRevision = options.inputMode === "revision";
  // Option C (Hybrid): LLM drives the conversation; code guards safety only.
  // Element/critical/semantic blocks are computed for analytics (progress bar,
  // story elements UI) but no longer override the LLM's question or action.
  const turnCount = state?.turn_count ?? 0;
  const hardBlockConfirm = hardSafetyBlock || hardGroundingBlock;
  const hybridReady = !hardBlockConfirm && (gapAnalysis.isStoryReady || llmReadySignal);

  return {
    gapAnalysis, gapQuestion, criticalCoverage, elements,
    elementBlock, hardElementBlock, llmReadySignal,
    hardSafetyBlock, hardGroundingBlock, hardCriticalBlock,
    hardSemanticBlock, hardBlockConfirm, hybridReady, isRevision,
    useLabovScoring,
  };
}

function resolveTurnDecision(response, state, options = {}) {
  const ctx = computeDecisionContext(response, state, options);
  const { gapAnalysis, gapQuestion, elements, elementBlock, hardElementBlock,
    hybridReady, llmReadySignal, hardSafetyBlock, hardBlockConfirm,
    hardCriticalBlock, criticalCoverage, hardSemanticBlock } = ctx;
  const userMessage = options.userMessage || null;
  let adjustedResponse = { ...response };
  let forcedGapQuestion = false;
  let forcedConfirm = false;
  let decisionSource = "llm";
  let llmSuggestions = Array.isArray(response.suggestions) ? response.suggestions : [];

  const llmHasQuestion = typeof response.question === "string" && response.question.trim().length > 0;
  // Compute semantic block signature for analytics tracking (attachGapTelemetry uses it)
  ctx._semanticBlockSignature = buildSemanticBlockSignature(state?.semantic_story);
  const turnCount = state?.turn_count ?? 0;
  const stateNarrative = state?.narrative_current || state?.narrative || "";
  const narrativeLen = Math.max(stateNarrative.length, (adjustedResponse.narrative || "").length);
  const factCount = Array.isArray(state?.facts) ? state.facts.filter(f => (f?.status || "active") === "active").length : 0;

  // --- STOP is always pass-through ---
  if (adjustedResponse.action === "STOP") {
    return buildDecisionResult({ adjustedResponse, ctx, decisionSource: "user_stop", llmSuggestions });
  }

  // --- Safety block: absolute override (profanity, impersonation) ---
  if (hardSafetyBlock) {
    const recipientFirst = (state?.recipient_name || "them").split(/\s/)[0];
    adjustedResponse = {
      action: "CLARIFY",
      question: `I want to help create something beautiful for ${recipientFirst}. Could you share a bit more about what they mean to you?`,
      narrative: adjustedResponse.narrative,
    };
    llmSuggestions = [];
    forcedGapQuestion = true;
    return buildDecisionResult({ adjustedResponse, ctx, decisionSource: "safety_block", llmSuggestions, forcedGapQuestion });
  }

  // --- Grounding block: no facts at all (hallucination guard) ---
  // Force fallback question — LLM's question may reference hallucinated details
  if (hardBlockConfirm) {
    adjustedResponse = {
      action: "CLARIFY",
      question: "I want to make sure I capture your story right. Could you tell me more?",
      narrative: adjustedResponse.narrative,
    };
    forcedGapQuestion = true;
    return buildDecisionResult({ adjustedResponse, ctx, decisionSource: "grounding_block", llmSuggestions, forcedGapQuestion });
  }

  // --- LLM says ASK or CLARIFY: trust the LLM's question ---
  if (adjustedResponse.action === "ASK" || adjustedResponse.action === "CLARIFY") {
    if (llmHasQuestion) {
      // LLM generated a question — use it as-is
      decisionSource = "llm";
    } else {
      // LLM decided to ask but didn't produce a question — fallback
      const fallback = gapQuestion?.prompt || buildGenericGapFallback(state);
      adjustedResponse = { ...adjustedResponse, question: fallback };
      llmSuggestions = [];
      forcedGapQuestion = true;
      decisionSource = "llm_missing_question_fallback";
    }
    return buildDecisionResult({ adjustedResponse, ctx, decisionSource, llmSuggestions, forcedGapQuestion });
  }

  // --- LLM says CONFIRM: apply lightweight quality gates ---
  if (adjustedResponse.action === "CONFIRM") {
    // Gate: too early (less than 2 turns), too thin narrative, too few facts
    const tooEarly = turnCount < 2;
    const tooThin = narrativeLen < 100;
    const tooFewFacts = factCount < 2;

    if (tooEarly || tooThin || tooFewFacts) {
      // Downgrade to ASK — use LLM's own question if it has one, else fallback
      if (llmHasQuestion) {
        adjustedResponse = { ...adjustedResponse, action: "ASK", confirmation: undefined };
        decisionSource = "min_quality_gate_with_llm_question";
      } else {
        const fallback = gapQuestion?.prompt || buildGenericGapFallback(state);
        adjustedResponse = { ...adjustedResponse, action: "ASK", question: fallback, confirmation: undefined };
        llmSuggestions = [];
        forcedGapQuestion = true;
        decisionSource = "min_quality_gate_fallback";
      }
    } else {
      // LLM says CONFIRM and quality gates pass — trust it
      adjustedResponse = {
        ...adjustedResponse,
        confirmation: adjustedResponse.confirmation || buildReadyConfirmation(state, gapAnalysis),
        question: undefined,
      };
      forcedConfirm = adjustedResponse.action !== response.action;
      decisionSource = llmReadySignal ? "llm_ready" : "llm_confirm";
    }
    return buildDecisionResult({ adjustedResponse, ctx, decisionSource, llmSuggestions, forcedGapQuestion, forcedConfirm });
  }

  // Fallback: unknown action — pass through
  return buildDecisionResult({ adjustedResponse, ctx, decisionSource: "llm_passthrough", llmSuggestions });
}

// Assemble the canonical return shape for resolveTurnDecision.
// Keeps all analytics fields present for downstream consumers (telemetry, iOS, tests).
function buildDecisionResult({ adjustedResponse, ctx, decisionSource, llmSuggestions = [], forcedGapQuestion = false, forcedConfirm = false }) {
  const { gapAnalysis, gapQuestion, elements, elementBlock, hardElementBlock,
    llmReadySignal, hybridReady, hardCriticalBlock, criticalCoverage,
    hardSemanticBlock } = ctx;
  return {
    response: adjustedResponse,
    gapAnalysis,
    gapQuestion,
    forcedGapQuestion,
    forcedConfirm,
    repeatEscapeApplied: false,
    decisionSource,
    llmSuggestions,
    llmReadySignal,
    hybridReady,
    criticalSlotBlock: hardCriticalBlock,
    criticalBlockingSlots: criticalCoverage.blockingSlots,
    elements,
    elementBlock: hardElementBlock,
    blockedElements: elementBlock.blockedElements,
    semanticBlock: hardSemanticBlock,
    semanticBlockSignature: ctx._semanticBlockSignature || null,
  };
}

function buildGenericGapFallback(state) {
  const recipientFirst = (state?.recipient_name || "them").split(/\s/)[0];
  return `What's something about ${recipientFirst} that always stays with you?`;
}

function attachGapTelemetry(state, gapAnalysis, gapQuestion, responseAction, decisionMeta = {}) {
  const now = new Date().toISOString();
  const slotMap = {};
  for (const slot of gapAnalysis.slots || []) {
    slotMap[slot.slot] = {
      status: slot.status,
      confidence: slot.confidence,
      reason: slot.reason,
      evidence: slot.evidence || [],
    };
  }

  const nextGapHistory = Array.isArray(state.gap_history) ? [...state.gap_history] : [];
  if (gapQuestion && (responseAction === "ASK" || responseAction === "CLARIFY")) {
    nextGapHistory.push({
      slot: gapQuestion.targetSlot,
      reason: gapQuestion.reason,
      turn: state.turn_count || 0,
      asked_at: now,
    });
  }

  const nextSemanticHistory = Array.isArray(state.semantic_history) ? [...state.semantic_history] : [];
  if (
    decisionMeta.semanticBlockSignature
    && (responseAction === "ASK" || responseAction === "CLARIFY")
    && decisionMeta.decisionSource === "semantic_integrity_gate"
  ) {
    nextSemanticHistory.push({
      signature: decisionMeta.semanticBlockSignature,
      turn: state.turn_count || 0,
      asked_at: now,
    });
  }

  return {
    ...state,
    story_slots: slotMap,
    current_gap: gapQuestion?.targetSlot || null,
    gap_history: nextGapHistory,
    semantic_history: nextSemanticHistory,
    // Persist Labov analysis for prompt builder to consume on next turn
    labov_analysis: gapAnalysis.labov ? { labov: gapAnalysis.labov } : state.labov_analysis || null,
    readiness: {
      score: gapAnalysis.readinessScore,
      is_story_ready: gapAnalysis.isStoryReady,
      profile: gapAnalysis.readinessProfile || "incomplete",
      missing_slots: gapAnalysis.missingSlots,
      weak_slots: gapAnalysis.weakSlots,
      gates: gapAnalysis.gates,
      decision_source: decisionMeta.decisionSource || "unknown",
      llm_ready_signal: Boolean(decisionMeta.llmReadySignal),
      hybrid_ready: Boolean(decisionMeta.hybridReady),
      updated_at: now,
    },
    last_turn_decision: {
      action: responseAction,
      source: decisionMeta.decisionSource || "unknown",
      llm_ready_signal: Boolean(decisionMeta.llmReadySignal),
      hybrid_ready: Boolean(decisionMeta.hybridReady),
      llm_target_slot: decisionMeta.llmTargetSlot || null,
      timestamp: now,
    },
  };
}

function buildResponseSuggestions({ action, occasion, targetSlot, storyMode, llmSuggestions, state, userMessage }) {
  // No suggestions for terminal actions
  if (action === "STOP" || action === "CONFIRM") {
    return [];
  }

  // 1. Story-specific suggestions extracted from the user's actual content
  // These are always preferred over LLM-generated or template suggestions
  if (state && userMessage) {
    const storySpecific = generateStorySpecificSuggestions(state, userMessage);
    if (storySpecific.length >= 3) {
      return storySpecific;
    }
  }

  // 2. Aligned LLM suggestions (fallback when story-specific extraction didn't yield enough)
  if (Array.isArray(llmSuggestions) && llmSuggestions.length > 0) {
    return llmSuggestions.slice(0, 3);
  }

  // 2. Slot-specific static suggestions (exact targetSlot lookup)
  if (targetSlot) {
    const slotSuggestions = getSlotSuggestions(occasion, targetSlot);
    if (slotSuggestions.length > 0) return slotSuggestions;
  }

  // 3. Element fallback tied to the exact target slot
  const targetElement = getElementForSlot(storyMode, targetSlot);
  if (targetElement) {
    const elementSuggestions = getElementSuggestions(occasion, targetElement.id);
    if (elementSuggestions.length > 0) return elementSuggestions;
  }

  // 4. Occasion generic fallback (last resort)
  return getOccasionDefaultSuggestions(occasion);
}

function hasReviewableDraft(state, narrative = "") {
  const trimmedNarrative = typeof narrative === "string" ? narrative.trim() : "";
  const trimmedPrompt = typeof state?.initial_prompt === "string" ? state.initial_prompt.trim() : "";
  const turnCount = Number(state?.turn_count || 0);
  return trimmedNarrative.length >= 160 || trimmedPrompt.length >= 160 || turnCount >= 2;
}

function buildReadinessWhy({ gapAnalysis, responseAction, decisionSource, isUserOverridable, hardBlockConfirm, gapQuestion }) {
  if (gapAnalysis.isStoryReady || responseAction === "CONFIRM" || responseAction === "STOP") {
    return "The draft covers the core story beats well enough to move into review.";
  }
  if (hardBlockConfirm && gapQuestion?.targetSlot) {
    return `The draft still has a blocking gap around ${gapQuestion.targetSlot.replace(/_/g, " ")}.`;
  }
  if (gapQuestion?.targetSlot) {
    return `The strongest next improvement is around ${gapQuestion.targetSlot.replace(/_/g, " ")}.`;
  }
  if (isUserOverridable) {
    return "The draft is substantial enough to review even though the engine can still ask for more detail.";
  }
  if (decisionSource === "llm") {
    return "The model wants one more round of detail before review.";
  }
  return "The story still needs more detail before review.";
}

function buildCanonicalReadiness({
  state,
  gapAnalysis,
  elements,
  gapQuestion,
  responseAction,
  decisionSource,
  hardBlockConfirm = false,
  criticalBlockingSlots = [],
  blockedElements = [],
}) {
  const narrative = getCanonicalNarrative(state) || "";
  const isReady = Boolean(
    gapAnalysis?.isStoryReady ||
    responseAction === "CONFIRM" ||
    responseAction === "STOP"
  );
  const isUserOverridable = !isReady && hasReviewableDraft(state, narrative);
  const recommendedNextAction = isReady
    ? "confirm"
    : (isUserOverridable ? "review" : "clarify");
  const primaryGap = gapQuestion ? {
    slot: gapQuestion.targetSlot || null,
    state: (gapAnalysis?.missingSlots || []).includes(gapQuestion.targetSlot) ? "missing" : "weak",
    reason: gapQuestion.reason || null,
    guidance: gapQuestion.slotGuidance || null,
    element_id: getElementForSlot(gapAnalysis?.storyMode || "default", gapQuestion.targetSlot)?.id || null,
    element_display_name: getElementForSlot(gapAnalysis?.storyMode || "default", gapQuestion.targetSlot)?.displayName || null,
  } : null;

  return {
    score: typeof gapAnalysis?.readinessScore === "number" ? gapAnalysis.readinessScore : 0,
    percent: Math.round((typeof gapAnalysis?.readinessScore === "number" ? gapAnalysis.readinessScore : 0) * 100),
    is_ready: isReady,
    is_user_overridable: isUserOverridable,
    story_mode: gapAnalysis?.storyMode || "default",
    profile: gapAnalysis?.readinessProfile || "incomplete",
    recommended_next_action: recommendedNextAction,
    decision_source: decisionSource || "unknown",
    primary_gap: primaryGap,
    missing_slots: gapAnalysis?.missingSlots || [],
    weak_slots: gapAnalysis?.weakSlots || [],
    blocked_slots: criticalBlockingSlots || [],
    blocked_elements: blockedElements || [],
    element_scores: elements || [],
    why: buildReadinessWhy({
      gapAnalysis,
      responseAction,
      decisionSource,
      isUserOverridable,
      hardBlockConfirm,
      gapQuestion,
    }),
  };
}

/**
 * Start a new V3 story session
 *
 * Creates session, generates beats for the occasion, and returns first question.
 *
 * @param {Object} options - Session options
 * @param {string} options.userId - User ID
 * @param {string} options.recipientName - Who the song is for
 * @param {string} options.occasion - The occasion (birthday, anniversary, etc.)
 * @param {string} options.initialPrompt - User's initial story prompt
 * @returns {Promise<Object>} Session with first question
 */
async function startStoryV3(options) {
  if (!storyRepo) {
    throw new Error("V3 Engine not initialized - call initialize() with repository first");
  }

  // Validate options
  if (!options || typeof options !== "object") {
    throw new Error("startStoryV3 requires an options object");
  }

  const { userId, recipientName, occasion, initialPrompt, style } = options;
  const effectiveEngineVersion = normalizeRuntimeEngineVersion(
    options.engineVersion || options.engine_version,
    ENGINE_VERSION
  );

  if (!userId) throw new Error("startStoryV3: userId is required");
  if (!recipientName) throw new Error("startStoryV3: recipientName is required");

  const normalizedStyle =
    typeof style === "string" && style.trim()
      ? style.trim().toLowerCase()
      : null;

  // 1. Create initial state
  const v2State = createInitialState({ recipientName, occasion, initialPrompt });

  // 2. Initialize with empty beats; V3 requires LLM-generated beats per story
  v2State.beats = [];
  v2State.event.occasion = occasion;

  // 3. Add initial prompt to conversation history BEFORE reasoning
  // This ensures the LLM has context about what the user initially shared
  let stateWithPrompt = addTurnToState(v2State, "user", initialPrompt);
  if (normalizedStyle) {
    stateWithPrompt = {
      ...stateWithPrompt,
      dials: {
        ...(stateWithPrompt.dials || {}),
        style: normalizedStyle,
      },
    };
  }

  // 4. Create database session
  const session = await storyRepo.createSession(userId, {
    arc: occasion || "unified",
    occasion,
    recipientName,
    style: normalizedStyle,
    initialPrompt,
    engineVersion: effectiveEngineVersion,
    v2State: stateWithPrompt,
  });

  // 5. Generate first question using reasoner or fallback
  let response;
  let finalState = stateWithPrompt;
  let usedFallback = false;
  const condensedInitialInput = condenseForReasoning(initialPrompt, {
    maxChars: getReasoningCondenseLimit(initialPrompt, { initial: true }),
  });
  // Eager detail extraction for constraint-first coverage (turn 1)
  const initialRetainedDetails = extractRetainedDetails({
    initial_prompt: stateWithPrompt.initial_prompt,
    facts: stateWithPrompt.facts || [],
  });
  console.log(`[V3] Detail inventory injected: ${initialRetainedDetails.length} total, ${initialRetainedDetails.filter(d => d.required).length} required`);

  try {
    const result = await reasonWithFallback(stateWithPrompt, condensedInitialInput.text || initialPrompt, { retainedDetails: initialRetainedDetails });
    if (result.success) {
      response = {
        action: result.data.action,
        question: result.data.question,
        confirmation: result.data.confirmation,
        narrative: result.data.narrative,
        targetSlot: result.data.targetSlot || null,
      };
      // Update state with reasoning result
      finalState = applyReasoningResult(stateWithPrompt, result.data, initialPrompt);
      // Enforce grounding - narrative must be supported by facts
      finalState = enforceGrounding(finalState);
      usedFallback = result.fallback || false;
    } else if (result.errorCode === "NARRATIVE_REWRITE_REQUIRED") {
      finalState = addFact(finalState, {
        text: initialPrompt,
        beat: "context",
        sourceTurn: finalState.turn_count || 1,
      });
      const recomposed = composeNarrativeFromFacts(finalState);
      if (recomposed) {
        finalState = { ...finalState, narrative: recomposed };
      }
      response = {
        action: "CLARIFY",
        question: "I want to make sure I'm capturing this correctly. Can you share one concrete moment or detail from this story?",
        narrative: getCanonicalNarrative(finalState),
      };
      usedFallback = true;
    } else {
      // LLM failed - use fallback
      response = generateFallbackResponse(stateWithPrompt);
      usedFallback = true;
    }
  } catch (err) {
    console.error("[V3 Engine] startStoryV3 reasoning error:", err.message);
    response = generateFallbackResponse(stateWithPrompt);
    usedFallback = true;
  }

  finalState = applyDeterministicFallbackExtraction(finalState, initialPrompt);
  finalState = ensureSemanticStoryIntegrity(finalState);
  finalState = {
    ...finalState,
    last_condensation: {
      stage: "start",
      ...condensedInitialInput.metadata,
    },
  };

  // Validate state and force clarification if invalid
  const validation = validateState(finalState);
  if (!validation.valid) {
    console.warn("[V3 Engine] Invalid state after reasoning:", validation.errors.join("; "));
    response = {
      action: "CLARIFY",
      question: "I want to make sure I understood. Can you share one concrete moment or detail from this story?",
    };
    usedFallback = true;
  } else if (finalState.grounding_enforced && finalState.grounding_issue === "no_facts" && response.action === "CONFIRM") {
    response = {
      action: "CLARIFY",
      question: "Before I summarize, could you share one specific moment or detail that stands out?",
    };
    usedFallback = true;
  }

  const gapResolution = resolveTurnDecision(response, finalState, { userMessage: initialPrompt });
  response = gapResolution.response;
  finalState = attachGapTelemetry(
    finalState,
    gapResolution.gapAnalysis,
    gapResolution.gapQuestion,
    response.action,
    {
      decisionSource: gapResolution.decisionSource,
      llmReadySignal: gapResolution.llmReadySignal,
      hybridReady: gapResolution.hybridReady,
      llmTargetSlot: response.targetSlot || null,
      semanticBlockSignature: gapResolution.semanticBlockSignature || null,
    }
  );
  finalState = {
    ...finalState,
    draft_lifecycle: response.action === "CONFIRM" || response.action === "STOP" ? "review_ready" : "drafting",
  };
  if (gapResolution.forcedGapQuestion || gapResolution.forcedConfirm) {
    usedFallback = true;
  }

  // Add assistant's response to conversation history
  const assistantMessage = response.question || response.confirmation || response.narrative;
  if (assistantMessage) {
    finalState = addTurnToState(finalState, "assistant", assistantMessage);
  }

  // Derive anti-repetition state (powers {{already_known}} and {{already_asked}} prompt injections)
  finalState = { ...finalState, story_state: extractStoryState(finalState) };

  await storyRepo.updateSession(session.id, {
    v2State: finalState,
    status: finalState.status || "active",
    expectedVersion: session.version,
  });

  const targetSlot = gapResolution.gapQuestion?.targetSlot || null;
  const enrichedGuidance = targetSlot
    ? await enrichSlotGuidance(gapResolution.gapQuestion?.slotGuidance || null, targetSlot, finalState)
    : null;

  const suggestions = buildResponseSuggestions({
    action: response.action,
    occasion,
    targetSlot,
    storyMode: gapResolution.gapAnalysis.storyMode,
    llmSuggestions: gapResolution.llmSuggestions,
    state: finalState,
    userMessage: initialPrompt,
  });

  return {
    sessionId: session.id,
    engineVersion: effectiveEngineVersion,
    action: response.action,
    question: response.question || response.confirmation,
    narrative: stripFormulaicOpener(response.narrative || getCanonicalNarrative(finalState) || ""),
    completionScore: getTurnProgressScore(finalState, gapResolution.gapAnalysis, response.action, gapResolution.elements),
    fallback: response.fallback || usedFallback,
    suggestions,
    targetSlot,
    gapReason: gapResolution.gapQuestion?.reason || null,
    slotGuidance: enrichedGuidance,
    missingSlots: gapResolution.gapAnalysis.missingSlots || [],
    weakSlots: gapResolution.gapAnalysis.weakSlots || [],
    readinessScore: gapResolution.gapAnalysis.readinessScore,
    isStoryReady: gapResolution.gapAnalysis.isStoryReady,
    canProceedAnyway: Boolean(gapResolution.gapAnalysis.canProceedAnyway),
    storyElements: gapResolution.elements,
    readiness: buildCanonicalReadiness({
      state: finalState,
      gapAnalysis: gapResolution.gapAnalysis,
      elements: gapResolution.elements,
      gapQuestion: gapResolution.gapQuestion,
      responseAction: response.action,
      decisionSource: gapResolution.decisionSource,
      hardBlockConfirm: gapResolution.criticalSlotBlock || gapResolution.elementBlock || gapResolution.semanticBlock,
      criticalBlockingSlots: gapResolution.criticalBlockingSlots,
      blockedElements: gapResolution.blockedElements,
    }),
    narrativeVersion: finalState.narrative_version || 0,
    integrationDelta: finalState.last_integration_delta || null,
    ...buildDraftMetadataBundle(finalState, session.id, effectiveEngineVersion),
  };
}

/**
 * Continue a V3 story session with user's answer
 *
 * Processes answer through reasoner, updates state, returns next question.
 *
 * @param {Object} options - Continue options
 * @param {string} options.sessionId - Session ID
 * @param {string} options.answer - User's answer
 * @returns {Promise<Object>} Next question or confirmation
 */
async function continueStoryV3(options) {
  if (!storyRepo) {
    throw new Error("V3 Engine not initialized - call initialize() with repository first");
  }

  // Validate options
  if (!options || typeof options !== "object") {
    throw new Error("continueStoryV3 requires an options object");
  }

  const { sessionId, answer } = options;
  const inputMode = options.inputMode === "revision" ? "revision" : "answer";
  const revisionSource = REVISION_SOURCES.has(options.revisionSource) ? options.revisionSource : "review_edit";
  const revisionOperation = normalizeRevisionOperation(options.revisionOperation);
  const expectedSessionVersion = Number.isFinite(Number(options.expectedSessionVersion))
    ? Number(options.expectedSessionVersion)
    : null;

  if (!sessionId) throw new Error("continueStoryV3: sessionId is required");
  if (!answer) throw new Error("continueStoryV3: answer is required");

  // 1. Get session and validate
  const session = await storyRepo.getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  if (expectedSessionVersion !== null && Number(session.version) !== expectedSessionVersion) {
    throw new StoryVersionConflictError(sessionId, expectedSessionVersion);
  }
  const sessionEngineVersion = normalizeRuntimeEngineVersion(session.engineVersion, "");
  if (!sessionEngineVersion) {
    throw new Error(`Session ${sessionId} has unsupported engine version: ${session.engineVersion}`);
  }

  // 2. Load and validate state
  let v2State = session.v2State;
  if (!v2State) {
    throw new Error(`Session ${sessionId} has no V3 state`);
  }

  // If state came from JSON, it might need parsing
  if (typeof v2State === "string") {
    v2State = loadStateFromSession(v2State);
    if (!v2State) {
      throw new Error(`Session ${sessionId} has corrupted V3 state`);
    }
  }
  v2State = ensureStateDefaults(v2State);
  if (inputMode !== "revision" && v2State.status === "ready_for_confirm") {
    console.warn("[V3] Reverting session from ready_for_confirm to active (guidance follow-up):", { sessionId });
    v2State = {
      ...v2State,
      status: "active",
      draft_lifecycle: "drafting",
    };
  }
  const priorNarrative = getCanonicalNarrative(v2State);
  const priorNarrativeVersion = Number(v2State.narrative_version || 0);
  const priorDraftLifecycle = deriveDraftLifecycle(v2State);
  const priorGapAnalysis = computeStoryGapAnalysis(v2State);
  const priorCompletionScore = getTurnProgressScore(v2State, priorGapAnalysis, null, null);

  // 3. Add user turn to conversation history
  const normalizedAnswer = inputMode === "revision"
    ? buildStructuredRevisionPrompt(answer, revisionOperation)
    : answer;
  const userTurnMetadata = inputMode === "revision"
    ? { kind: "revision_request", source: revisionSource }
    : null;
  v2State = addTurnToState(v2State, "user", normalizedAnswer, userTurnMetadata);
  if (inputMode === "revision") {
    v2State = {
      ...v2State,
      status: "active",
      draft_lifecycle: priorDraftLifecycle === "confirmed" ? "reopened" : "drafting",
      reopen_count: priorDraftLifecycle === "confirmed"
        ? Number(v2State.reopen_count || 0) + 1
        : Number(v2State.reopen_count || 0),
    };
  }
  const condensedAnswerInput = condenseForReasoning(normalizedAnswer, {
    maxChars: getReasoningCondenseLimit(normalizedAnswer),
  });

  // 4. Run reasoning — with eager detail inventory for constraint-first coverage
  const turnRetainedDetails = extractRetainedDetails({
    initial_prompt: v2State.initial_prompt,
    conversation: v2State.conversation,
    facts: v2State.facts,
  });
  console.log(`[V3] Detail inventory injected: ${turnRetainedDetails.length} total, ${turnRetainedDetails.filter(d => d.required).length} required`);

  let response;
  let usedFallback = false;
  try {
    const result = await reasonWithFallback(v2State, condensedAnswerInput.text || normalizedAnswer, { retainedDetails: turnRetainedDetails });
    if (result.success) {
      // Apply reasoning result to state
      v2State = applyReasoningResult(v2State, result.data, normalizedAnswer);

      // Enforce grounding - narrative must be supported by facts
      v2State = enforceGrounding(v2State);

      // Ensure narrative exists when we have facts
      if (!getCanonicalNarrative(v2State) && getActiveFacts(v2State.facts || []).length > 0) {
        const recomposed = composeNarrativeFromFacts(v2State);
        if (recomposed) {
          v2State = {
            ...v2State,
            narrative: recomposed,
            narrative_current: recomposed,
          };
        }
      }

      response = {
        action: result.data.action,
        question: result.data.question,
        confirmation: result.data.confirmation,
        narrative: result.data.narrative || getCanonicalNarrative(v2State),
        targetSlot: result.data.targetSlot || null,
      };
      usedFallback = result.fallback || false;

    } else if (result.errorCode === "NARRATIVE_REWRITE_REQUIRED") {
      v2State = addFact(v2State, {
        text: normalizedAnswer,
        beat: "context",
        sourceTurn: v2State.turn_count || 1,
      });
      const recomposed = composeNarrativeFromFacts(v2State);
      if (recomposed) {
        v2State = {
          ...v2State,
          narrative: recomposed,
          narrative_current: recomposed,
        };
      }
      response = {
        action: "CLARIFY",
        question: "I want to make sure I'm capturing this correctly. Can you share one concrete moment or detail from this story?",
        narrative: getCanonicalNarrative(v2State),
      };
      usedFallback = true;
    } else {
      // LLM failed - use fallback
      response = generateFallbackResponse(v2State);
      usedFallback = true;
    }
  } catch (err) {
    console.error("[V3 Engine] continueStoryV3 reasoning error:", err.message);
    response = generateFallbackResponse(v2State);
    usedFallback = true;
  }

  v2State = applyDeterministicFallbackExtraction(v2State, normalizedAnswer);
  v2State = ensureSemanticStoryIntegrity(v2State);

  // Build/update completed story package — coverage enforcement
  let packageResult;
  try {
    const storyPackageContext = {
      initial_prompt: v2State.initial_prompt,
      conversation: v2State.conversation,
      facts: v2State.facts,
    };
    packageResult = ensureCompletedStoryPackage(v2State, storyPackageContext);
    v2State = packageResult.state;
  } catch (pkgErr) {
    console.warn("[V3] ensureCompletedStoryPackage failed, continuing without:", pkgErr.message);
    packageResult = { state: v2State, repaired: false, coverage: null };
  }

  // F5: Pass-2 semantic integrity — if repair appended missing sentences,
  // re-derive semantic_story and song_map from the repaired prose
  if (packageResult.repaired) {
    v2State = ensureSemanticStoryIntegrity(v2State);
    // Sync repaired prose back into package (R5)
    v2State.completed_story_package.prose = v2State.narrative;
    // Update semantic_block_profile from fresh semantic analysis (CR-2)
    v2State.completed_story_package.semantic_block_profile =
      v2State.semantic_story?.semantic_block_profile || v2State.completed_story_package.semantic_block_profile;
  }

  // If required details are still missing after repair, block confirmation
  // Tolerance of 2 accounts for lexical false negatives in coverage detection
  const REQUIRED_MISSING_TOLERANCE = 2;
  const hardDetailCoverageBlock = packageResult.coverage
    && packageResult.coverage.stats.requiredMissing > REQUIRED_MISSING_TOLERANCE;
  if (hardDetailCoverageBlock) {
    // Feed into semantic_story so the existing hardSemanticBlock gate picks it up
    const currentSemantic = v2State.semantic_story || {};
    if (currentSemantic.can_confirm !== false) {
      v2State = {
        ...v2State,
        semantic_story: {
          ...currentSemantic,
          can_confirm: false,
          detail_coverage_block: true,
          missing_required_details: packageResult.coverage.missingRequired,
          updated_at: new Date().toISOString(),
        },
      };
    }
  }

  v2State = {
    ...v2State,
    last_condensation: {
      stage: "continue",
      ...condensedAnswerInput.metadata,
    },
  };

  // Validate state and force clarification if invalid
  const validation = validateState(v2State);
  if (!validation.valid) {
    console.warn("[V3 Engine] Invalid state after reasoning:", validation.errors.join("; "));
    response = {
      action: "CLARIFY",
      question: "I want to make sure I understood. Can you share one concrete moment or detail from this story?",
    };
    usedFallback = true;
  } else if (v2State.grounding_enforced && v2State.grounding_issue === "no_facts" && response.action === "CONFIRM") {
    response = {
      action: "CLARIFY",
      question: "Before I summarize, could you share one specific moment or detail that stands out?",
    };
    usedFallback = true;
  }

  const gapResolution = resolveTurnDecision(response, v2State, { inputMode, userMessage: answer });
  response = gapResolution.response;
  v2State = attachGapTelemetry(
    v2State,
    gapResolution.gapAnalysis,
    gapResolution.gapQuestion,
    response.action,
    {
      decisionSource: gapResolution.decisionSource,
      llmReadySignal: gapResolution.llmReadySignal,
      hybridReady: gapResolution.hybridReady,
      llmTargetSlot: response.targetSlot || null,
      semanticBlockSignature: gapResolution.semanticBlockSignature || null,
    }
  );
  if (inputMode !== "revision") {
    v2State = {
      ...v2State,
      draft_lifecycle: response.action === "CONFIRM" || response.action === "STOP"
        ? "review_ready"
        : (priorDraftLifecycle === "reopened" ? "reopened" : "drafting"),
    };
  }
  if (gapResolution.forcedGapQuestion || gapResolution.forcedConfirm) {
    usedFallback = true;
  }

  const assistantMessage = response.question || response.confirmation;
  if (assistantMessage) {
    v2State = addTurnToState(v2State, "assistant", assistantMessage);
  }

  if (inputMode === "revision") {
    const needsClarification = response.action === "ASK" || response.action === "CLARIFY";
    const revisionRecord = {
      id: `rev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      source: revisionSource,
      request: answer,
      operation: revisionOperation,
      requested_at: new Date().toISOString(),
      status: needsClarification ? "clarification_needed" : "applied",
      resulting_action: response.action,
      narrative_version: v2State.narrative_version || 0,
      before_version: priorNarrativeVersion,
      after_version: Number(v2State.narrative_version || 0),
      before_narrative: priorNarrative,
      after_narrative: getCanonicalNarrative(v2State),
      integration_delta: v2State.last_integration_delta || null,
    };

    v2State = {
      ...v2State,
      revision_requests: [...(Array.isArray(v2State.revision_requests) ? v2State.revision_requests : []), revisionRecord].slice(-40),
      last_revision_request: revisionRecord,
      draft_lifecycle: needsClarification
        ? (priorDraftLifecycle === "confirmed" ? "reopened" : "drafting")
        : "review_ready",
      pending_revision: needsClarification
        ? {
          id: revisionRecord.id,
          request: revisionRecord.request,
          source: revisionRecord.source,
          operation: revisionRecord.operation,
          waiting_for: "clarification",
          follow_up_question: response.question || response.confirmation || null,
          requested_at: revisionRecord.requested_at,
          before_version: priorNarrativeVersion,
        }
        : null,
    };
  } else if (v2State.pending_revision) {
    v2State = {
      ...v2State,
      pending_revision: null,
    };
  }

  if (inputMode !== "revision" && priorDraftLifecycle === "reopened") {
    v2State = {
      ...v2State,
      draft_lifecycle: response.action === "CONFIRM" || response.action === "STOP"
        ? "review_ready"
        : "reopened",
    };
  }

  // Derive anti-repetition state (powers {{already_known}} and {{already_asked}} prompt injections)
  v2State = { ...v2State, story_state: extractStoryState(v2State) };

  // 5. Save updated state
  await storyRepo.updateSession(sessionId, {
    v2State,
    status: v2State.status || session.status || "active",
    expectedVersion: session.version,
  });

  // 6. Ensure narrative is populated (always, with stronger guarantee on completion)
  let finalNarrative = stripFormulaicOpener(response.narrative || getCanonicalNarrative(v2State) || "");
  if (!finalNarrative && getActiveFacts(v2State.facts || []).length > 0) {
    finalNarrative = composeNarrativeFromFacts(v2State) || "";
    const reason = response.action === "STOP" || response.action === "CONFIRM"
      ? "completion action"
      : "missing narrative";
    console.warn(`[V3 Engine] Composed narrative from facts for ${reason}`);
  }

  // Generate contextual suggestions for the next question (only if not complete)
  const occasion = v2State.event?.occasion || session.occasion;

  const continueTargetSlot = gapResolution.gapQuestion?.targetSlot || null;
  const continueEnrichedGuidance = continueTargetSlot
    ? await enrichSlotGuidance(gapResolution.gapQuestion?.slotGuidance || null, continueTargetSlot, v2State)
    : null;
  const afterCompletionScore = getTurnProgressScore(v2State, gapResolution.gapAnalysis, response.action, gapResolution.elements);

  const suggestions = buildResponseSuggestions({
    action: response.action,
    occasion,
    targetSlot: continueTargetSlot,
    storyMode: gapResolution.gapAnalysis.storyMode,
    llmSuggestions: gapResolution.llmSuggestions,
    state: v2State,
    userMessage: answer,
  });

  return {
    sessionId,
    engineVersion: sessionEngineVersion,
    action: response.action,
    question: response.question || response.confirmation,
    narrative: finalNarrative,
    completionScore: afterCompletionScore,
    turnCount: v2State.turn_count,
    fallback: response.fallback || usedFallback,
    suggestions,
    targetSlot: continueTargetSlot,
    gapReason: gapResolution.gapQuestion?.reason || null,
    slotGuidance: continueEnrichedGuidance,
    missingSlots: gapResolution.gapAnalysis.missingSlots || [],
    weakSlots: gapResolution.gapAnalysis.weakSlots || [],
    readinessScore: gapResolution.gapAnalysis.readinessScore,
    isStoryReady: gapResolution.gapAnalysis.isStoryReady,
    canProceedAnyway: Boolean(gapResolution.gapAnalysis.canProceedAnyway),
    storyElements: gapResolution.elements,
    readiness: buildCanonicalReadiness({
      state: v2State,
      gapAnalysis: gapResolution.gapAnalysis,
      elements: gapResolution.elements,
      gapQuestion: gapResolution.gapQuestion,
      responseAction: response.action,
      decisionSource: gapResolution.decisionSource,
      hardBlockConfirm: gapResolution.criticalSlotBlock || gapResolution.elementBlock || gapResolution.semanticBlock,
      criticalBlockingSlots: gapResolution.criticalBlockingSlots,
      blockedElements: gapResolution.blockedElements,
    }),
    narrativeVersion: v2State.narrative_version || 0,
    integrationDelta: v2State.last_integration_delta || null,
    revisionRequest: inputMode === "revision" ? v2State.last_revision_request || null : null,
    ...buildDraftMetadataBundle(v2State, sessionId, sessionEngineVersion, {
      beforeScore: priorCompletionScore,
      afterScore: afterCompletionScore,
    }),
  };
}

async function reviseStoryV3(sessionId, revisionRequest, options = {}) {
  return continueStoryV3({
    sessionId,
    answer: revisionRequest,
    inputMode: "revision",
    revisionSource: options.source,
    revisionOperation: options.operation,
  });
}

/**
 * Get story context for lyrics generation (V3)
 *
 * Extracts narrative, facts, and metadata from confirmed session.
 *
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object>} Story context with narrative, facts, and metadata
 */
async function getStoryContextV3(sessionId, { includeReadiness = true, includeMetadata = true } = {}) {
  if (!storyRepo) {
    throw new Error("V3 Engine not initialized - call initialize() with repository first");
  }

  const session = await storyRepo.getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const sessionEngineVersion = normalizeRuntimeEngineVersion(session.engineVersion, "");
  if (!sessionEngineVersion) {
    throw new Error(`Session ${sessionId} has unsupported engine version: ${session.engineVersion}`);
  }

  let v2State = session.v2State;
  if (typeof v2State === "string") {
    v2State = loadStateFromSession(v2State);
    if (!v2State) {
      throw new Error(`Session ${sessionId} has corrupted V3 state`);
    }
  }
  const originalState = v2State;
  v2State = ensureSemanticStoryIntegrity(v2State);

  // Build/reuse completed story package for lyrics generation context
  let packageResult;
  try {
    const packageContext = {
      initial_prompt: v2State.initial_prompt,
      conversation: v2State.conversation,
      facts: v2State.facts,
    };
    packageResult = ensureCompletedStoryPackage(v2State, packageContext);
    v2State = packageResult.state;
  } catch (pkgErr) {
    console.warn("[V3] ensureCompletedStoryPackage failed in getStoryContext, continuing without:", pkgErr.message);
    packageResult = { state: v2State, repaired: false, coverage: null };
  }

  // F5: Pass-2 semantic integrity — if repair appended missing sentences,
  // re-derive semantic_story and song_map from the repaired prose
  if (packageResult?.repaired) {
    v2State = ensureSemanticStoryIntegrity(v2State);
    // Sync repaired prose back into package (R5)
    v2State.completed_story_package.prose = v2State.narrative;
    // Update semantic_block_profile from fresh semantic analysis (CR-2)
    v2State.completed_story_package.semantic_block_profile =
      v2State.semantic_story?.semantic_block_profile || v2State.completed_story_package.semantic_block_profile;
  }

  // Single persist after both passes (R1)
  try {
    await persistSemanticStateIfChanged(sessionId, session, originalState, v2State);
  } catch (persistErr) {
    console.warn("[V3] Semantic persist in read path failed:", persistErr.message);
  }

  const metadataBundle = includeMetadata
    ? buildDraftMetadataBundle(v2State, sessionId, sessionEngineVersion)
    : {};

  // Build context for lyrics generation
  // If completed story package exists, its prose is the authoritative narrative
  const completedPackage = v2State.completed_story_package;
  const canonicalNarrative = (completedPackage && completedPackage.prose)
    ? completedPackage.prose
    : getCanonicalNarrative(v2State);
  const activeFacts = getActiveFacts(v2State.facts || []);

  let contextGapAnalysis = null;
  let contextElements = null;
  let readinessData = null;
  if (includeReadiness) {
    contextGapAnalysis = computeStoryGapAnalysis(v2State);
    contextElements = computeStoryElements(contextGapAnalysis);
    readinessData = buildCanonicalReadiness({
      state: v2State,
      gapAnalysis: contextGapAnalysis,
      elements: contextElements,
      gapQuestion: null,
      responseAction: "CONFIRM",
      decisionSource: "session_snapshot",
    });
  }

  return {
    sessionId,
    engineVersion: sessionEngineVersion,
    recipientName: v2State.recipient_name,
    occasion: v2State.event?.occasion || session.occasion,
    style: v2State.dials?.style || session.style || null,
    eventType: v2State.event?.type || session.arc,
    initialPrompt: v2State.initial_prompt || session.initialPrompt,
    narrative: canonicalNarrative,
    facts: activeFacts,
    beats: v2State.beats || [],
    atoms: v2State.atoms || {},
    primitives: v2State.primitives || {},
    motifs: v2State.motifs || [],
    dials: v2State.dials || {},
    song_map: v2State.song_map || null,
    evaluation: v2State.evaluation || null,
    userModel: v2State.user_model,
    status: v2State.status,
    turnCount: v2State.turn_count,
    completionScore: getCompletionScoreForState(v2State),
    narrativeVersion: v2State.narrative_version || 0,
    readiness: readinessData,
    completed_story_package: completedPackage || null,
    ...metadataBundle,
    // For lyrics generation, provide a summary
    summary: {
      text: canonicalNarrative,
      factCount: activeFacts.length,
      beatsUncovered: v2State.beats?.filter(b =>
        typeof b.strength === "number" ? b.strength < 0.6 : b.status !== "covered"
      ).length || 0,
    },
  };
}

/**
 * Get full story session state for resume (V3)
 *
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object>} Session snapshot
 */
async function getStorySessionV3(sessionId) {
  if (!storyRepo) {
    throw new Error("V3 Engine not initialized - call initialize() with repository first");
  }

  const session = await storyRepo.getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const sessionEngineVersion = normalizeRuntimeEngineVersion(session.engineVersion, "");
  if (!sessionEngineVersion) {
    throw new Error(`Session ${sessionId} has unsupported engine version: ${session.engineVersion}`);
  }

  let v2State = session.v2State;
  if (typeof v2State === "string") {
    v2State = loadStateFromSession(v2State);
    if (!v2State) {
      throw new Error(`Session ${sessionId} has corrupted V3 state`);
    }
  }
  const originalState = v2State;
  v2State = ensureSemanticStoryIntegrity(v2State);
  await persistSemanticStateIfChanged(sessionId, session, originalState, v2State);

  const conversation = Array.isArray(v2State.conversation) ? v2State.conversation : [];
  const lastAssistant = conversation.findLast((turn) => turn.role === "assistant");
  const sessionGapAnalysis = computeStoryGapAnalysis(v2State);
  const sessionElements = computeStoryElements(sessionGapAnalysis);

  return {
    sessionId,
    userId: session.userId,
    engineVersion: sessionEngineVersion,
    recipientName: v2State.recipient_name,
    occasion: v2State.event?.occasion || session.occasion,
    style: v2State.dials?.style || session.style || null,
    eventType: v2State.event?.type || session.arc,
    initialPrompt: v2State.initial_prompt || session.initialPrompt || null,
    narrative: getCanonicalNarrative(v2State),
    facts: v2State.facts || [],
    activeFacts: getActiveFacts(v2State.facts || []),
    beats: v2State.beats || [],
    atoms: v2State.atoms || {},
    primitives: v2State.primitives || {},
    motifs: v2State.motifs || [],
    dials: v2State.dials || {},
    song_map: v2State.song_map || null,
    evaluation: v2State.evaluation || null,
    userModel: v2State.user_model,
    status: v2State.status,
    turnCount: v2State.turn_count,
    completionScore: getCompletionScoreForState(v2State),
    narrativeVersion: v2State.narrative_version || 0,
    integrationDelta: v2State.last_integration_delta || null,
    lastRevisionRequest: v2State.last_revision_request || null,
    storyElements: sessionElements,
    readiness: buildCanonicalReadiness({
      state: v2State,
      gapAnalysis: sessionGapAnalysis,
      elements: sessionElements,
      gapQuestion: null,
      responseAction: v2State.status === "confirmed" ? "CONFIRM" : "ASK",
      decisionSource: "session_snapshot",
    }),
    ...buildDraftMetadataBundle(v2State, sessionId, sessionEngineVersion),
    conversation,
    currentQuestion: lastAssistant?.content || null,
    updatedAt: session.updatedAt,
    createdAt: session.createdAt,
  };
}

async function updateStoryStyleV3(sessionId, style) {
  if (!storyRepo) {
    throw new Error("V3 Engine not initialized - call initialize() with repository first");
  }

  const session = await storyRepo.getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const sessionEngineVersion = normalizeRuntimeEngineVersion(session.engineVersion, "");
  if (!sessionEngineVersion) {
    throw new Error(`Session ${sessionId} has unsupported engine version: ${session.engineVersion}`);
  }

  const rawStyle = typeof style === "string" ? style.trim() : "";
  const normalizedStyle = rawStyle ? normalizeStyle(rawStyle) : null;

  let v2State = session.v2State;
  if (typeof v2State === "string") {
    v2State = loadStateFromSession(v2State);
    if (!v2State) {
      throw new Error(`Session ${sessionId} has corrupted V3 state`);
    }
  }

  const now = new Date().toISOString();
  const nextState = {
    ...v2State,
    dials: {
      ...(v2State?.dials || {}),
      style: normalizedStyle,
    },
    updated_at: now,
  };

  await storyRepo.updateSession(sessionId, {
    style: normalizedStyle,
    v2State: nextState,
    expectedVersion: session.version,
  });

  return {
    sessionId,
    engineVersion: sessionEngineVersion,
    style: normalizedStyle,
  };
}

async function prepareStoryReviewV3(sessionId) {
  if (!storyRepo) {
    throw new Error("V3 Engine not initialized - call initialize() with repository first");
  }

  const session = await storyRepo.getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const sessionEngineVersion = normalizeRuntimeEngineVersion(session.engineVersion, "");
  if (!sessionEngineVersion) {
    throw new Error(`Session ${sessionId} has unsupported engine version: ${session.engineVersion}`);
  }

  let v2State = session.v2State;
  if (typeof v2State === "string") {
    v2State = loadStateFromSession(v2State);
    if (!v2State) {
      throw new Error(`Session ${sessionId} has corrupted V3 state`);
    }
  }
  v2State = ensureStateDefaults(v2State);

  const existingCanonicalNarrative = getCanonicalNarrative(v2State);
  let finalNarrative = existingCanonicalNarrative;
  if (!finalNarrative) {
    finalNarrative = composeNarrativeFromFacts(v2State) || v2State.initial_prompt || "";
  }

  const synthesizedFirstNarrative = Boolean(finalNarrative) && !existingCanonicalNarrative;
  const synthesizedNarrativeVersion = Math.max(Number(v2State.narrative_version || 0), finalNarrative ? 1 : 0);
  const reviewTimestamp = new Date().toISOString();
  const synthesizedIntegrationDelta = synthesizedFirstNarrative
    ? {
      turn: v2State.turn_count || 0,
      timestamp: reviewTimestamp,
      added_facts: [],
      updated_facts: [],
      superseded_facts: [],
      conflicts_detected: [],
      conflicts_resolved: [],
      narrative_rewritten: true,
    }
    : null;
  const nextNarrativeRevisions = Array.isArray(v2State.narrative_revisions)
    ? [...v2State.narrative_revisions]
    : [];
  if (synthesizedFirstNarrative && synthesizedNarrativeVersion > 0 && finalNarrative) {
    const alreadyRecorded = nextNarrativeRevisions.some((revision) =>
      revision?.version === synthesizedNarrativeVersion && revision?.narrative === finalNarrative
    );
    if (!alreadyRecorded) {
      nextNarrativeRevisions.push({
        version: synthesizedNarrativeVersion,
        turn: v2State.turn_count || 0,
        narrative: finalNarrative,
        timestamp: reviewTimestamp,
        integration: {
          added_facts: [],
          updated_facts: [],
          superseded_facts: [],
        },
      });
    }
  }
  const nextIntegrationHistory = Array.isArray(v2State.integration_history)
    ? [...v2State.integration_history]
    : [];
  if (synthesizedIntegrationDelta) {
    nextIntegrationHistory.push(synthesizedIntegrationDelta);
  }
  let reviewState = {
    ...v2State,
    narrative: finalNarrative,
    narrative_current: finalNarrative,
    narrative_version: synthesizedFirstNarrative ? synthesizedNarrativeVersion : v2State.narrative_version,
    narrative_revisions: nextNarrativeRevisions,
    integration_history: nextIntegrationHistory,
    last_integration_delta: synthesizedIntegrationDelta || v2State.last_integration_delta || null,
    status: "ready_for_confirm",
    draft_lifecycle: "review_ready",
    updated_at: reviewTimestamp,
  };
  reviewState = ensureSemanticStoryIntegrity(reviewState);
  if (reviewState.semantic_story?.can_confirm === false) {
    const semanticSignature = buildSemanticBlockSignature(reviewState.semantic_story);
    const repeatedCount = countConsecutiveSemanticAsks(reviewState.semantic_history || [], semanticSignature);
    if (repeatedCount >= MAX_REPEAT_SEMANTIC_ASKS) {
      reviewState = ensureSemanticStoryIntegrity({
        ...reviewState,
        semantic_override: {
          signature: semanticSignature,
          count: repeatedCount,
          overridden_at: new Date().toISOString(),
        },
      });
    }
  }
  if (reviewState.semantic_story?.can_confirm === false) {
    const clarification = buildSemanticClarificationPrompt(reviewState);
    const question = clarification.question;
    const nextState = addTurnToState({
      ...reviewState,
      status: "active",
      draft_lifecycle: "drafting",
      semantic_history: [
        ...(Array.isArray(reviewState.semantic_history) ? reviewState.semantic_history : []),
        {
          signature: buildSemanticBlockSignature(reviewState.semantic_story),
          turn: reviewState.turn_count || 0,
          asked_at: new Date().toISOString(),
        },
      ].slice(-20),
    }, "assistant", question);

    await storyRepo.updateSession(sessionId, {
      v2State: nextState,
      status: "active",
      expectedVersion: session.version,
    });

    return {
      sessionId,
      engineVersion: sessionEngineVersion,
      action: "ASK",
      question,
      narrative: getCanonicalNarrative(nextState),
      completionScore: getCompletionScoreForState(nextState),
      turnCount: nextState.turn_count,
      fallback: false,
      suggestions: [],
      targetSlot: null,
      gapReason: "semantic_integrity",
      slotGuidance: null,
      missingSlots: [],
      weakSlots: [],
      readinessScore: 0,
      isStoryReady: false,
      storyElements: [],
      readiness: buildCanonicalReadiness({
        state: nextState,
        gapAnalysis: computeStoryGapAnalysis(nextState),
        elements: computeStoryElements(computeStoryGapAnalysis(nextState)),
        gapQuestion: null,
        responseAction: "ASK",
        decisionSource: "semantic_integrity",
        hardBlockConfirm: true,
      }),
      narrativeVersion: nextState.narrative_version || 0,
      integrationDelta: nextState.last_integration_delta || null,
      ...buildDraftMetadataBundle(nextState, sessionId, sessionEngineVersion),
    };
  }

  const gapAnalysis = computeStoryGapAnalysis(reviewState);
  const reviewElements = computeStoryElements(gapAnalysis);
  const reviewPrompt = buildReadyConfirmation(reviewState, gapAnalysis);

  const lastTurn = reviewState.conversation?.[reviewState.conversation.length - 1];
  if (lastTurn?.role !== "assistant" || lastTurn?.content !== reviewPrompt) {
    reviewState = addTurnToState(reviewState, "assistant", reviewPrompt);
  }

  await storyRepo.updateSession(sessionId, {
    v2State: reviewState,
    status: "ready_for_confirm",
    expectedVersion: session.version,
  });

  return {
    sessionId,
    engineVersion: sessionEngineVersion,
    action: "CONFIRM",
    question: reviewPrompt,
    narrative: finalNarrative,
    completionScore: 100,
    turnCount: reviewState.turn_count,
    fallback: false,
    suggestions: [],
    targetSlot: null,
    gapReason: null,
    slotGuidance: null,
    missingSlots: gapAnalysis.missingSlots || [],
    weakSlots: gapAnalysis.weakSlots || [],
    readinessScore: gapAnalysis.readinessScore,
    isStoryReady: gapAnalysis.isStoryReady,
    storyElements: reviewElements,
    readiness: buildCanonicalReadiness({
      state: reviewState,
      gapAnalysis,
      elements: reviewElements,
      gapQuestion: null,
      responseAction: "CONFIRM",
      decisionSource: "review_ready",
    }),
    narrativeVersion: reviewState.narrative_version || 0,
    integrationDelta: reviewState.last_integration_delta || null,
    ...buildDraftMetadataBundle(reviewState, sessionId, sessionEngineVersion),
  };
}

/**
 * Confirm story and mark ready for lyrics generation (V3)
 *
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object>} Confirmed session
 */
async function confirmStoryV3(sessionId, options = {}) {
  if (!storyRepo) {
    throw new Error("V3 Engine not initialized - call initialize() with repository first");
  }

  const session = await storyRepo.getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const sessionEngineVersion = normalizeRuntimeEngineVersion(session.engineVersion, "");
  if (!sessionEngineVersion) {
    throw new Error(`Session ${sessionId} has unsupported engine version: ${session.engineVersion}`);
  }

  let v2State = session.v2State;
  if (typeof v2State === "string") {
    v2State = loadStateFromSession(v2State);
    if (!v2State) {
      throw new Error(`Session ${sessionId} has corrupted V3 state`);
    }
  }
  v2State = ensureSemanticStoryIntegrity(v2State);
  if (v2State.semantic_story?.can_confirm === false) {
    let guidanceError;
    try {
      const clarification = buildSemanticClarificationPrompt(v2State);
      const semanticSignature = buildSemanticBlockSignature(v2State.semantic_story);
      const nextSemanticHistory = [
        ...(Array.isArray(v2State.semantic_history) ? v2State.semantic_history : []),
        {
          signature: semanticSignature,
          turn: v2State.turn_count || 0,
          asked_at: new Date().toISOString(),
        },
      ].slice(-20);
      console.warn("[V3] Reverting session from ready_for_confirm to active (confirm guidance):", { sessionId });
      const nextState = ensureSemanticStoryIntegrity({
        ...v2State,
        status: "active",
        draft_lifecycle: "drafting",
        semantic_history: nextSemanticHistory,
      });
      await storyRepo.updateSession(sessionId, {
        v2State: nextState,
        status: "active",
        expectedVersion: session.version,
      });
      guidanceError = createStoryNeedsInputError({
        question: clarification.question,
        suggestions: clarification.suggestions,
        missingBlocks: nextState.semantic_story?.missing_narrative_blocks,
        sessionVersion: Number(session.version) + 1,
      });
    } catch (guidanceErr) {
      if (guidanceErr?.name === "StoryVersionConflictError") {
        throw guidanceErr;
      }
      const fallbackClarification = buildSemanticClarificationPrompt(v2State);
      guidanceError = createStoryNeedsInputError({
        question: fallbackClarification.question,
        suggestions: fallbackClarification.suggestions,
        missingBlocks: v2State.semantic_story?.missing_narrative_blocks,
        sessionVersion: session.version,
      });
    }
    throw guidanceError;
  }

  // Build/finalize completed story package before confirmation
  const confirmPackageContext = {
    initial_prompt: v2State.initial_prompt,
    conversation: v2State.conversation,
    facts: v2State.facts,
  };
  let confirmPackageResult;
  try {
    confirmPackageResult = ensureCompletedStoryPackage(v2State, confirmPackageContext);
    v2State = confirmPackageResult.state;
  } catch (pkgErr) {
    console.warn("[V3] ensureCompletedStoryPackage failed at confirmation, proceeding without package:", pkgErr.message);
    confirmPackageResult = { state: v2State, repaired: false, coverage: null };
  }

  // F5: Pass-2 semantic integrity — if repair appended missing sentences,
  // re-derive semantic_story and song_map from the repaired prose
  if (confirmPackageResult.repaired) {
    v2State = ensureSemanticStoryIntegrity(v2State);
    // Sync repaired prose back into package (R5)
    v2State.completed_story_package.prose = v2State.narrative;
    // Update semantic_block_profile from fresh semantic analysis (CR-2)
    v2State.completed_story_package.semantic_block_profile =
      v2State.semantic_story?.semantic_block_profile || v2State.completed_story_package.semantic_block_profile;
  }

  // F6: If required details are still missing after append-only repair,
  // attempt a one-time LLM rewrite of the narrative to weave them in.
  // Guarded by ratio threshold (CR-8): only when < 40% of required details are missing
  // (if too many are missing, the rewrite would be a full re-creation, not a weave).
  if (
    confirmPackageResult.coverage &&
    confirmPackageResult.coverage.stats.requiredMissing > 0
  ) {
    const requiredTotal = (v2State.completed_story_package?.retained_details || [])
      .filter(d => d.required).length;
    const missingRatio = confirmPackageResult.coverage.stats.requiredMissing /
      Math.max(1, requiredTotal);

    if (missingRatio < LLM_REWRITE_MAX_MISSING_RATIO) {
      const missingDetails = (confirmPackageResult.coverage.missingRequired || [])
        .map(entry => entry.text)
        .filter(t => typeof t === "string" && t.trim().length > 0);

      if (missingDetails.length > 0) {
        try {
          const rewritten = await rewriteNarrativeWithMissingDetails(
            v2State.completed_story_package?.prose || v2State.narrative,
            missingDetails,
            v2State.recipient_name,
          );
          if (rewritten) {
            // Coverage regression guard: only accept if it improves coverage
            const retainedDetails = v2State.completed_story_package?.retained_details || [];
            const newCoverage = computeDetailCoverage(retainedDetails, rewritten);

            if (newCoverage.stats.requiredMissing < confirmPackageResult.coverage.stats.requiredMissing) {
              v2State.narrative = rewritten;
              if (v2State.completed_story_package) {
                v2State.completed_story_package.prose = rewritten;
                v2State.completed_story_package.detail_coverage_map = newCoverage;
                v2State.completed_story_package.llm_rewrite_applied = true;
              }
              // Pass-3: re-derive semantic_story and song_map from LLM-rewritten prose
              v2State = ensureSemanticStoryIntegrity(v2State);
              if (v2State.completed_story_package) {
                v2State.completed_story_package.prose = v2State.narrative;
                v2State.completed_story_package.semantic_block_profile =
                  v2State.semantic_story?.semantic_block_profile ||
                  v2State.completed_story_package.semantic_block_profile;
              }
              console.log(
                `[V3] LLM narrative rewrite improved coverage: ` +
                `${confirmPackageResult.coverage.stats.requiredMissing} → ${newCoverage.stats.requiredMissing} missing`,
              );
            }
          }
        } catch (rewriteErr) {
          console.warn("[V3] LLM narrative rewrite failed, keeping append-only result:", rewriteErr.message);
        }
      }
    } else {
      console.warn(
        `[V3] Confirmation: ${confirmPackageResult.coverage.stats.requiredMissing} required details ` +
        `still missing (ratio ${missingRatio.toFixed(2)} >= ${LLM_REWRITE_MAX_MISSING_RATIO}), ` +
        `skipping LLM rewrite — too many missing for a weave.`,
      );
    }
  }

  const additionalNotes = typeof options.additionalNotes === "string"
    ? options.additionalNotes.trim()
    : "";
  const now = new Date().toISOString();

  // Update status to confirmed
  v2State = {
    ...v2State,
    status: "confirmed",
    draft_lifecycle: "confirmed",
    confirmed_at: now,
    last_confirmed_at: now,
    last_confirmed_narrative_version: Number(v2State.narrative_version || 0) || null,
    pending_revision: null,
    updated_at: now,
  };

  // Save to database
  await storyRepo.updateSession(sessionId, {
    v2State,
    status: "confirmed",
    additionalNotes: additionalNotes || undefined,
    expectedVersion: session.version,
  });

  // Ensure narrative is populated for confirmation
  let finalNarrative = getCanonicalNarrative(v2State);
  if (!finalNarrative) {
    finalNarrative = composeNarrativeFromFacts(v2State) || "";
    console.warn("[V3 Engine] Composed narrative from facts for confirmation");
  }

  const confirmGapAnalysis = computeStoryGapAnalysis(v2State);
  const confirmElements = computeStoryElements(confirmGapAnalysis);

  return {
    sessionId,
    engineVersion: sessionEngineVersion,
    status: "confirmed",
    narrative: finalNarrative,
    completionScore: getCompletionScoreForState(v2State),
    confirmedAt: v2State.confirmed_at,
    narrativeVersion: v2State.narrative_version || 0,
    storyElements: confirmElements,
    readiness: buildCanonicalReadiness({
      state: v2State,
      gapAnalysis: confirmGapAnalysis,
      elements: confirmElements,
      gapQuestion: null,
      responseAction: "CONFIRM",
      decisionSource: "confirmed",
    }),
    ...buildDraftMetadataBundle(v2State, sessionId, sessionEngineVersion),
  };
}

function getCompletionScoreForState(state) {
  if (state?.last_reasoning?.story_readiness) {
    return getCompletionFromLLM(state.last_reasoning).score;
  }
  return getCompletionScore(state);
}

module.exports = {
  // Engine identifier
  ENGINE_VERSION,

  // Initialization
  initialize,

  // Core API
  startStoryV3,
  continueStoryV3,
  reviseStoryV3,
  getStoryContextV3,
  getStorySessionV3,
  updateStoryStyleV3,
  prepareStoryReviewV3,
  confirmStoryV3,

  // Story state derivation (anti-repetition)
  extractStoryState,

  // Internal modules (for testing/debugging)
  __internal: {
    state: require("./state"),
    beats: require("./beats"),
    reasoner: require("./reasoner"),
    engine: require("./engine"),
    quality: require("./quality"),
    semantics: require("../story-semantics"),
    resolveTurnDecision,
    buildResponseSuggestions,
    buildSemanticClarificationPrompt,
    buildSemanticBlockSignature,
    deriveLlmReadySignal,
    getTurnProgressScore,
    ensureSemanticStoryIntegrity,
    ensureCompletedStoryPackage,
  },
};
