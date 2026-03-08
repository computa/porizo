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

// Internal modules
const { createInitialState, validateState, addFact, ensureStateDefaults } = require("./state");
const { composeNarrativeFromFacts, getActiveFacts } = require("./narrative");
const { reasonWithFallback } = require("./reasoner");
const {
  applyReasoningResult,
  addTurnToState,
  generateFallbackResponse,
  applyDeterministicFallbackExtraction,
  loadStateFromSession,
  enforceGrounding,
  getSuggestionsForQuestion,
} = require("./engine");
const {
  getCompletionFromLLM,
  getCompletionScore,
  computeStoryGapAnalysis,
  pickDeterministicGapQuestion,
  getCriticalConfirmSlotCoverage,
  computeStoryElements,
  getElementConfirmBlock,
} = require("./quality");
const { condenseForReasoning } = require("./condense");

// Engine version identifier
const ENGINE_VERSION = "v3";
const MAX_REPEAT_SLOT_ASKS = 1;
const SUPPORTED_RUNTIME_ENGINE_VERSIONS = new Set(["v2", "v3"]);
const REVISION_SOURCES = new Set(["review_edit", "confirm_notes", "reopen_edit"]);
const REVISION_OPERATION_TYPES = new Set(["append", "replace", "remove", "resolve_conflict", "final_notes"]);
const REVISION_TARGET_TYPES = new Set(["narrative", "fact", "beat", "section", "conflict"]);

// Repository instance (set by initialize)
let storyRepo = null;

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

function deriveLlmReadySignal(response, state) {
  const action = response?.action;
  if (action === "CONFIRM" || action === "STOP") return true;

  const readiness = state?.last_reasoning?.story_readiness;
  const userState = state?.last_reasoning?.user_state;
  const strongCount = Array.isArray(readiness?.strong_elements) ? readiness.strong_elements.length : 0;
  const weakCount = Array.isArray(readiness?.weak_elements) ? readiness.weak_elements.length : 0;

  if (readiness?.has_emotional_depth === true && strongCount >= 2 && weakCount <= 2) {
    return true;
  }

  if (userState?.seems_done === true && readiness?.has_emotional_depth === true && strongCount >= 1) {
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

function buildDraftDiff(state) {
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

function buildDraftMetadataBundle(state, sessionId, engineVersion) {
  return {
    draftLifecycle: deriveDraftLifecycle(state),
    factInventory: buildFactInventory(state),
    openConflicts: buildConflictInventory(state),
    revisionHistory: buildRevisionHistory(state),
    draftDiff: buildDraftDiff(state),
    pendingRevision: buildPendingRevision(state),
    storyProvenance: buildStoryProvenance(state, sessionId, engineVersion),
  };
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

function resolveTurnDecision(response, state, options = {}) {
  const gapAnalysis = computeStoryGapAnalysis(state);
  let gapQuestion = pickDeterministicGapQuestion(gapAnalysis, state);
  const criticalCoverage = getCriticalConfirmSlotCoverage(gapAnalysis);
  const elements = computeStoryElements(gapAnalysis);
  const elementBlock = getElementConfirmBlock(elements);
  const hardElementBlock = elementBlock.hasElementBlock;
  let adjustedResponse = { ...response };
  let forcedGapQuestion = false;
  let forcedConfirm = false;
  let repeatEscapeApplied = false;
  let decisionSource = "llm";
  const llmReadySignal = deriveLlmReadySignal(response, state);
  const hardSafetyBlock = state?.last_reasoning?.safety?.blocked === true ||
    state?.last_reasoning?.safety?.requires_refusal === true ||
    state?.last_reasoning?.safety_violation === true;
  const hardGroundingBlock = state?.grounding_enforced && state?.grounding_issue === "no_facts";
  const hardCriticalBlock = criticalCoverage.hasBlockingGap;
  const isRevision = options.inputMode === "revision";
  let hardBlockConfirm = hardSafetyBlock || hardGroundingBlock || (!isRevision && (hardCriticalBlock || hardElementBlock));
  const hybridReady = !hardBlockConfirm && (gapAnalysis.isStoryReady || llmReadySignal);

  if (gapQuestion) {
    const repeatedCount = countConsecutiveSlotAsks(state?.gap_history || [], gapQuestion.targetSlot);
    if (repeatedCount >= MAX_REPEAT_SLOT_ASKS) {
      const prunedAnalysis = {
        ...gapAnalysis,
        missingSlots: (gapAnalysis.missingSlots || []).filter(slot => slot !== gapQuestion.targetSlot),
        weakSlots: (gapAnalysis.weakSlots || []).filter(slot => slot !== gapQuestion.targetSlot),
      };
      const alternateQuestion = pickDeterministicGapQuestion(prunedAnalysis, state);
      if (alternateQuestion) {
        gapQuestion = {
          ...alternateQuestion,
          reason: `${alternateQuestion.reason} (repeat-slot escape from ${gapQuestion.targetSlot})`,
        };
        repeatEscapeApplied = true;
      }
    }
  }

  // STOP means user intent to stop collecting; don't force additional asks.
  if (adjustedResponse.action === "STOP") {
    return {
      response: adjustedResponse,
      gapAnalysis,
      gapQuestion: null,
      forcedGapQuestion,
      forcedConfirm,
      repeatEscapeApplied,
      decisionSource,
      llmReadySignal,
      hybridReady,
      criticalSlotBlock: hardCriticalBlock,
      criticalBlockingSlots: criticalCoverage.blockingSlots,
      elements,
      elementBlock: hardElementBlock,
      blockedElements: elementBlock.blockedElements,
    };
  }

  // Exhaustion escape: if blocking slot has been asked MAX times
  // with no alternate found, yield to avoid infinite loops.
  // Does NOT fire for safety blocks.
  if (hardBlockConfirm && !hardSafetyBlock && gapQuestion) {
    const repeatedCount = countConsecutiveSlotAsks(
      state?.gap_history || [], gapQuestion.targetSlot
    );
    if (repeatedCount >= MAX_REPEAT_SLOT_ASKS && !repeatEscapeApplied) {
      // Yield: exhaustion override — allow CONFIRM despite blocking gap
      hardBlockConfirm = false;
      gapQuestion = null;
      decisionSource = "exhaustion_escape";
      adjustedResponse = {
        ...adjustedResponse,
        action: "CONFIRM",
        confirmation: adjustedResponse.confirmation || buildReadyConfirmation(state, gapAnalysis),
        question: undefined,
      };
      forcedConfirm = true;
    }
  }

  // --- LLM slot targeting (critical priority) ---
  // Exhaustion escape above clears gapQuestion and hardBlockConfirm, so this is safe.
  if (hardBlockConfirm && (adjustedResponse.action === "CONFIRM" || hybridReady)) {
    const llmProvidedQuestion = typeof response.question === "string"
      && response.question.length > 0;
    // Accept LLM question when it targets ANY valid gap, not just the deterministic top slot.
    // The LLM has contextual awareness about which gap is most natural to ask about.
    const llmTargetedValidGap = llmProvidedQuestion
      && response.targetSlot
      && ((gapAnalysis.missingSlots || []).includes(response.targetSlot)
          || (gapAnalysis.weakSlots || []).includes(response.targetSlot));
    const weakName = elementBlock.weakestElement?.display_name || "a story element";
    const elementFallback = `Before I finalize, ${weakName} still needs more detail. Could you share something specific?`;
    const useQuestion = llmTargetedValidGap
      ? response.question
      : (gapQuestion?.prompt || elementFallback);

    // Track actual slot for gap_history when LLM targets a different valid gap
    if (llmTargetedValidGap && gapQuestion && response.targetSlot !== gapQuestion.targetSlot) {
      gapQuestion = { ...gapQuestion, targetSlot: response.targetSlot, reason: `LLM targeted ${response.targetSlot} (deterministic: ${gapQuestion.targetSlot})` };
    }

    adjustedResponse = {
      action: "CLARIFY",
      question: useQuestion,
      narrative: adjustedResponse.narrative,
    };
    forcedGapQuestion = true;
    if (llmTargetedValidGap) {
      decisionSource = "llm_slot_targeted_critical";
    } else if (hardCriticalBlock) {
      decisionSource = "critical_slot_gate";
    } else {
      decisionSource = "hard_block";
    }
  } else if (hybridReady) {
    adjustedResponse = {
      ...adjustedResponse,
      action: "CONFIRM",
      confirmation: adjustedResponse.confirmation || buildReadyConfirmation(state, gapAnalysis),
      question: undefined,
    };
    forcedConfirm = adjustedResponse.action !== response.action;
    decisionSource = llmReadySignal ? "llm_or_hybrid_ready" : "deterministic_ready";
  // --- LLM slot targeting (normal priority) ---
  } else if (gapQuestion) {
    const llmAskedQuestion = response.action === "ASK"
      && typeof response.question === "string"
      && response.question.length > 0;
    // Accept LLM question when it targets ANY valid gap (missing or weak),
    // not just the deterministic system's top choice. The LLM has contextual
    // awareness about which gap is most natural for this story/occasion.
    const llmTargetedValidGap = llmAskedQuestion
      && response.targetSlot
      && ((gapAnalysis.missingSlots || []).includes(response.targetSlot)
          || (gapAnalysis.weakSlots || []).includes(response.targetSlot));

    if (llmTargetedValidGap) {
      const isExactMatch = response.targetSlot === gapQuestion.targetSlot;
      adjustedResponse = {
        ...adjustedResponse,
        action: "ASK",
        question: response.question,
        confirmation: undefined,
      };
      // Track actual slot for gap_history when LLM targets a different valid gap
      if (!isExactMatch) {
        gapQuestion = { ...gapQuestion, targetSlot: response.targetSlot, reason: `LLM targeted ${response.targetSlot} (deterministic: ${gapQuestion.targetSlot})` };
      }
      forcedGapQuestion = false;
      decisionSource = isExactMatch ? "llm_slot_targeted" : "llm_slot_targeted_alternate";
    } else {
      // LLM didn't ask, or targeted covered/invalid slot — fall back to deterministic template
      adjustedResponse = {
        ...adjustedResponse,
        action: "ASK",
        question: gapQuestion.prompt,
        confirmation: undefined,
      };
      forcedGapQuestion = response.action !== "ASK" || response.question !== gapQuestion.prompt;
      decisionSource = "deterministic_gap";
    }
  }

  return {
    response: adjustedResponse,
    gapAnalysis,
    gapQuestion,
    forcedGapQuestion,
    forcedConfirm,
    repeatEscapeApplied,
    decisionSource,
    llmReadySignal,
    hybridReady,
    criticalSlotBlock: hardCriticalBlock,
    criticalBlockingSlots: criticalCoverage.blockingSlots,
    elements,
    elementBlock: hardElementBlock,
    blockedElements: elementBlock.blockedElements,
  };
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

  return {
    ...state,
    story_slots: slotMap,
    current_gap: gapQuestion?.targetSlot || null,
    gap_history: nextGapHistory,
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

function buildResponseSuggestions({ action, question, occasion, state, gapQuestion }) {
  if (action === "STOP" || action === "CONFIRM") {
    return [];
  }
  if (gapQuestion?.quickReplies?.length) {
    return gapQuestion.quickReplies;
  }
  return getSuggestionsForQuestion(occasion, question || "", state);
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
  const condensedInitialInput = condenseForReasoning(initialPrompt, { maxChars: 1700 });
  try {
    const result = await reasonWithFallback(stateWithPrompt, condensedInitialInput.text || initialPrompt);
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

  const gapResolution = resolveTurnDecision(response, finalState);
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

  await storyRepo.updateSession(session.id, {
    v2State: finalState,
    status: finalState.status || "active",
  });

  const suggestions = buildResponseSuggestions({
    action: response.action,
    question: response.question || response.confirmation || "",
    occasion,
    state: finalState,
    gapQuestion: gapResolution.gapQuestion,
  });

  return {
    sessionId: session.id,
    engineVersion: effectiveEngineVersion,
    action: response.action,
    question: response.question || response.confirmation,
    narrative: response.narrative || getCanonicalNarrative(finalState) || "",
    completionScore: getTurnProgressScore(finalState, gapResolution.gapAnalysis, response.action, gapResolution.elements),
    fallback: response.fallback || usedFallback,
    suggestions,
    targetSlot: gapResolution.gapQuestion?.targetSlot || null,
    gapReason: gapResolution.gapQuestion?.reason || null,
    slotGuidance: gapResolution.gapQuestion?.slotGuidance || null,
    missingSlots: gapResolution.gapAnalysis.missingSlots || [],
    weakSlots: gapResolution.gapAnalysis.weakSlots || [],
    readinessScore: gapResolution.gapAnalysis.readinessScore,
    isStoryReady: gapResolution.gapAnalysis.isStoryReady,
    storyElements: gapResolution.elements,
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

  if (!sessionId) throw new Error("continueStoryV3: sessionId is required");
  if (!answer) throw new Error("continueStoryV3: answer is required");

  // 1. Get session and validate
  const session = await storyRepo.getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
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
  const priorNarrative = getCanonicalNarrative(v2State);
  const priorNarrativeVersion = Number(v2State.narrative_version || 0);
  const priorDraftLifecycle = deriveDraftLifecycle(v2State);

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
  const condensedAnswerInput = condenseForReasoning(normalizedAnswer, { maxChars: 1700 });

  // 4. Run reasoning
  let response;
  let usedFallback = false;
  try {
    const result = await reasonWithFallback(v2State, condensedAnswerInput.text || normalizedAnswer);
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

  const gapResolution = resolveTurnDecision(response, v2State, { inputMode });
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

  // 5. Save updated state
  await storyRepo.updateSession(sessionId, {
    v2State,
    status: v2State.status || session.status || "active",
  });

  // 6. Ensure narrative is populated (always, with stronger guarantee on completion)
  let finalNarrative = response.narrative || getCanonicalNarrative(v2State);
  if (!finalNarrative && getActiveFacts(v2State.facts || []).length > 0) {
    finalNarrative = composeNarrativeFromFacts(v2State) || "";
    const reason = response.action === "STOP" || response.action === "CONFIRM"
      ? "completion action"
      : "missing narrative";
    console.warn(`[V3 Engine] Composed narrative from facts for ${reason}`);
  }

  // Generate contextual suggestions for the next question (only if not complete)
  const occasion = v2State.event?.occasion || session.occasion;
  const suggestions = buildResponseSuggestions({
    action: response.action,
    question: response.question || response.confirmation || "",
    occasion,
    state: v2State,
    gapQuestion: gapResolution.gapQuestion,
  });

  return {
    sessionId,
    engineVersion: sessionEngineVersion,
    action: response.action,
    question: response.question || response.confirmation,
    narrative: finalNarrative,
    completionScore: getTurnProgressScore(v2State, gapResolution.gapAnalysis, response.action, gapResolution.elements),
    turnCount: v2State.turn_count,
    fallback: response.fallback || usedFallback,
    suggestions,
    targetSlot: gapResolution.gapQuestion?.targetSlot || null,
    gapReason: gapResolution.gapQuestion?.reason || null,
    slotGuidance: gapResolution.gapQuestion?.slotGuidance || null,
    missingSlots: gapResolution.gapAnalysis.missingSlots || [],
    weakSlots: gapResolution.gapAnalysis.weakSlots || [],
    readinessScore: gapResolution.gapAnalysis.readinessScore,
    isStoryReady: gapResolution.gapAnalysis.isStoryReady,
    storyElements: gapResolution.elements,
    narrativeVersion: v2State.narrative_version || 0,
    integrationDelta: v2State.last_integration_delta || null,
    revisionRequest: inputMode === "revision" ? v2State.last_revision_request || null : null,
    ...buildDraftMetadataBundle(v2State, sessionId, sessionEngineVersion),
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
async function getStoryContextV3(sessionId) {
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

  // Build context for lyrics generation
  const canonicalNarrative = getCanonicalNarrative(v2State);
  const activeFacts = getActiveFacts(v2State.facts || []);

  return {
    sessionId,
    engineVersion: sessionEngineVersion,
    recipientName: v2State.recipient_name,
    occasion: v2State.event?.occasion || session.occasion,
    style: session.style || v2State.dials?.style || null,
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
    ...buildDraftMetadataBundle(v2State, sessionId, sessionEngineVersion),
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

  const conversation = Array.isArray(v2State.conversation) ? v2State.conversation : [];
  const lastAssistant = conversation.findLast((turn) => turn.role === "assistant");

  return {
    sessionId,
    userId: session.userId,
    engineVersion: sessionEngineVersion,
    recipientName: v2State.recipient_name,
    occasion: v2State.event?.occasion || session.occasion,
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
    storyElements: computeStoryElements(computeStoryGapAnalysis(v2State)),
    ...buildDraftMetadataBundle(v2State, sessionId, sessionEngineVersion),
    conversation,
    currentQuestion: lastAssistant?.content || null,
    updatedAt: session.updatedAt,
    createdAt: session.createdAt,
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

  const gapAnalysis = computeStoryGapAnalysis(reviewState);
  const reviewPrompt = buildReadyConfirmation(reviewState, gapAnalysis);

  const lastTurn = reviewState.conversation?.[reviewState.conversation.length - 1];
  if (lastTurn?.role !== "assistant" || lastTurn?.content !== reviewPrompt) {
    reviewState = addTurnToState(reviewState, "assistant", reviewPrompt);
  }

  await storyRepo.updateSession(sessionId, {
    v2State: reviewState,
    status: "ready_for_confirm",
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
    storyElements: computeStoryElements(gapAnalysis),
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
  });

  // Ensure narrative is populated for confirmation
  let finalNarrative = getCanonicalNarrative(v2State);
  if (!finalNarrative) {
    finalNarrative = composeNarrativeFromFacts(v2State) || "";
    console.warn("[V3 Engine] Composed narrative from facts for confirmation");
  }

  return {
    sessionId,
    engineVersion: sessionEngineVersion,
    status: "confirmed",
    narrative: finalNarrative,
    completionScore: getCompletionScoreForState(v2State),
    confirmedAt: v2State.confirmed_at,
    narrativeVersion: v2State.narrative_version || 0,
    storyElements: computeStoryElements(computeStoryGapAnalysis(v2State)),
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
  prepareStoryReviewV3,
  confirmStoryV3,

  // Internal modules (for testing/debugging)
  __internal: {
    state: require("./state"),
    beats: require("./beats"),
    reasoner: require("./reasoner"),
    engine: require("./engine"),
    quality: require("./quality"),
    resolveTurnDecision,
    deriveLlmReadySignal,
    getTurnProgressScore,
  },
};
