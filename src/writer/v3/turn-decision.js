const { createTurnDecision } = require("./kernel/types");
const {
  detectRepeatedQuestionTheme,
  shouldForceForwardProgressConfirm,
  buildTargetDecisionMeta,
  selectRuntimeQuestionTarget,
  selectAlternativeQuestionTarget,
  buildPlanningContext,
} = require("./kernel/planner");
const { validateQuestionRelevance } = require("./quality");
const { buildSemanticBlockSignature } = require("./semantic-story-package");
const {
  shouldSoftPassQuestion,
  chooseRuntimeFallbackQuestion,
} = require("./runtime-questions");
const { buildReadyConfirmation } = require("./ready-confirmation");

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

// Assemble the canonical return shape for resolveTurnDecision.
// Keeps all analytics fields present for downstream consumers (telemetry, iOS, tests).
function buildDecisionResult({
  adjustedResponse,
  ctx,
  decisionSource,
  llmSuggestions = [],
  forcedGapQuestion = false,
  forcedConfirm = false,
  targetElement = null,
  targetDecision = null,
  repeatEscapeApplied = false,
}) {
  const {
    gapAnalysis,
    gapQuestion,
    elements,
    elementBlock,
    hardElementBlock,
    llmReadySignal,
    hybridReady,
    hardCriticalBlock,
    criticalCoverage,
    hardSemanticBlock,
  } = ctx;
  const turnDecision = createTurnDecision({
    action: adjustedResponse?.action,
    targetElement,
    targetSlot: adjustedResponse?.targetSlot || gapQuestion?.targetSlot || null,
    reason: targetDecision?.winner?.reason || decisionSource,
    alternatives: targetDecision?.alternatives || [],
    confidence: adjustedResponse?.action === "CONFIRM" ? 0.85 : 0.7,
    source: decisionSource,
  });
  return {
    response: adjustedResponse,
    turnDecision,
    gapAnalysis,
    gapQuestion,
    forcedGapQuestion,
    forcedConfirm,
    repeatEscapeApplied,
    decisionSource,
    targetElement,
    targetDecision,
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

function resolveTurnDecision(response, state, options = {}) {
  const ctx = buildPlanningContext({
    state,
    response,
    inputMode: options.inputMode,
    llmReadySignal: deriveLlmReadySignal(response, state),
  });
  const { gapAnalysis, gapQuestion, llmReadySignal, hardSafetyBlock, hardBlockConfirm } = ctx;
  const userMessage = options.userMessage || null;
  const kernelDecision = options.turnDecision || null;
  const kernelTargetDecision = options.targetDecision || null;
  const isKernelDecision = Boolean(kernelDecision?.source);
  let adjustedResponse = { ...response };
  let forcedGapQuestion = false;
  let forcedConfirm = false;
  let decisionSource = isKernelDecision ? kernelDecision.source : "llm";
  let llmSuggestions = Array.isArray(response.suggestions) ? response.suggestions : [];
  let targetElement = kernelDecision?.targetElement || null;
  let repeatEscapeApplied = false;
  let targetDecision = kernelTargetDecision || null;

  const llmHasQuestion = typeof response.question === "string" && response.question.trim().length > 0;
  // Compute semantic block signature for analytics tracking (attachGapTelemetry uses it)
  ctx._semanticBlockSignature = buildSemanticBlockSignature(state?.semantic_story);
  const turnCount = state?.turn_count ?? 0;
  const stateNarrative = state?.narrative_current || state?.narrative || "";
  const narrativeLen = Math.max(stateNarrative.length, (adjustedResponse.narrative || "").length);
  const factCount = Array.isArray(state?.facts)
    ? state.facts.filter(f => (f?.status || "active") === "active").length
    : 0;

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
    targetElement = targetElement || selectRuntimeQuestionTarget(adjustedResponse, gapAnalysis, state?.story_state);
    targetDecision = targetDecision || buildTargetDecisionMeta(gapAnalysis, state?.story_state, adjustedResponse, targetElement);
    if (llmHasQuestion) {
      const trimmedQuestion = adjustedResponse.question.trim();
      const targetLedger = targetDecision?.winner || null;
      const directTarget = targetDecision?.directTarget || null;
      const directTargetLedger = directTarget
        ? [targetDecision?.winner, ...(targetDecision?.alternatives || [])]
          .find((candidate) => candidate?.element === directTarget) || null
        : null;
      const repeatedElementCount = targetLedger?.substantiveAnswerCount || 0;
      const sufficientAnswerCount = targetLedger?.sufficientAnswerCount || 0;
      const directTargetSufficientCount = directTargetLedger?.sufficientAnswerCount || 0;
      const repeatedTheme = detectRepeatedQuestionTheme(trimmedQuestion, targetElement, state?.story_state);
      const repeatedCurrentElement = Boolean(repeatedTheme)
        && (!targetElement || repeatedTheme.priorElement === targetElement);
      const shouldPromoteWinner = Boolean(
        directTarget
          && targetElement
          && directTarget !== targetElement
          && directTargetSufficientCount >= 2
          && ((targetDecision?.winner?.missingSlotCount || 0) > 0 || (targetDecision?.winner?.weakSlotCount || 0) > 0)
      );
      const shouldForceForwardProgress =
        repeatedCurrentElement
        || repeatedElementCount >= 2
        || sufficientAnswerCount >= 2
        || shouldPromoteWinner;

      if (shouldForceForwardProgress) {
        if (shouldForceForwardProgressConfirm(ctx, state, Math.max(repeatedElementCount, sufficientAnswerCount, directTargetSufficientCount))) {
          adjustedResponse = {
            ...adjustedResponse,
            action: "CONFIRM",
            confirmation: adjustedResponse.confirmation || buildReadyConfirmation(state, gapAnalysis),
            question: undefined,
          };
          llmSuggestions = [];
          forcedConfirm = true;
          decisionSource = isKernelDecision ? "kernel_forward_progress_confirm" : "forward_progress_confirm";
          repeatEscapeApplied = true;
          return buildDecisionResult({
            adjustedResponse,
            ctx,
            decisionSource,
            llmSuggestions,
            forcedGapQuestion,
            forcedConfirm,
            targetElement,
            targetDecision,
            repeatEscapeApplied,
          });
        }

        if (shouldPromoteWinner) {
          adjustedResponse = {
            ...adjustedResponse,
            question: chooseRuntimeFallbackQuestion(targetElement, state, userMessage, gapQuestion),
          };
          llmSuggestions = [];
          forcedGapQuestion = true;
          decisionSource = isKernelDecision ? "kernel_forward_progress_retarget" : "forward_progress_retarget";
          repeatEscapeApplied = true;
          return buildDecisionResult({
            adjustedResponse,
            ctx,
            decisionSource,
            llmSuggestions,
            forcedGapQuestion,
            targetElement,
            targetDecision,
            repeatEscapeApplied,
          });
        }

        const alternateTarget = selectAlternativeQuestionTarget(
          gapAnalysis,
          state?.story_state,
          new Set(targetElement ? [targetElement] : [])
        );

        if (alternateTarget && alternateTarget !== targetElement) {
          adjustedResponse = {
            ...adjustedResponse,
            question: chooseRuntimeFallbackQuestion(alternateTarget, state, userMessage, gapQuestion),
          };
          llmSuggestions = [];
          forcedGapQuestion = true;
          decisionSource = isKernelDecision ? "kernel_forward_progress_retarget" : "forward_progress_retarget";
          targetElement = alternateTarget;
          targetDecision = buildTargetDecisionMeta(gapAnalysis, state?.story_state, adjustedResponse, targetElement);
          repeatEscapeApplied = true;
          return buildDecisionResult({
            adjustedResponse,
            ctx,
            decisionSource,
            llmSuggestions,
            forcedGapQuestion,
            targetElement,
            targetDecision,
            repeatEscapeApplied,
          });
        }
      }

      const isRelevant = targetElement
        ? validateQuestionRelevance(trimmedQuestion, targetElement)
        : true;
      const strongerUnresolvedTargetExists = Boolean(
        directTarget &&
        targetDecision?.winner
          && targetDecision.winner.element !== directTarget
          && (targetDecision.winner.missingSlotCount > 0 || targetDecision.winner.weakSlotCount > 0)
      );

      if (!isRelevant && shouldSoftPassQuestion(trimmedQuestion, state, userMessage) && !strongerUnresolvedTargetExists) {
        adjustedResponse = { ...adjustedResponse, question: trimmedQuestion };
        decisionSource = isKernelDecision ? "kernel_soft_pass" : "llm_soft_pass";
      } else if (!isRelevant) {
        adjustedResponse = {
          ...adjustedResponse,
          question: chooseRuntimeFallbackQuestion(targetElement, state, userMessage, gapQuestion),
        };
        llmSuggestions = [];
        forcedGapQuestion = true;
        decisionSource = isKernelDecision ? "kernel_off_target_fallback" : "llm_off_target_fallback";
      } else {
        adjustedResponse = { ...adjustedResponse, question: trimmedQuestion };
        decisionSource = isKernelDecision ? "kernel_validated" : "llm_validated";
      }
    } else {
      // LLM decided to ask but didn't produce a question — fallback
      const fallback = chooseRuntimeFallbackQuestion(targetElement, state, userMessage, gapQuestion);
      adjustedResponse = { ...adjustedResponse, question: fallback };
      llmSuggestions = [];
      forcedGapQuestion = true;
      decisionSource = isKernelDecision ? "kernel_missing_question_fallback" : "llm_missing_question_fallback";
    }
    return buildDecisionResult({
      adjustedResponse,
      ctx,
      decisionSource,
      llmSuggestions,
      forcedGapQuestion,
      targetElement,
      targetDecision,
      repeatEscapeApplied,
    });
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
        const fallback = chooseRuntimeFallbackQuestion(null, state, userMessage, gapQuestion);
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
      decisionSource = isKernelDecision
        ? (kernelDecision.source || "kernel_confirm")
        : (llmReadySignal ? "llm_ready" : "llm_confirm");
    }
    return buildDecisionResult({
      adjustedResponse,
      ctx,
      decisionSource,
      llmSuggestions,
      forcedGapQuestion,
      forcedConfirm,
      targetElement: targetElement || kernelDecision?.targetElement || null,
      targetDecision,
      repeatEscapeApplied,
    });
  }

  // Fallback: unknown action — pass through
  return buildDecisionResult({ adjustedResponse, ctx, decisionSource: "llm_passthrough", llmSuggestions });
}

module.exports = {
  deriveLlmReadySignal,
  buildDecisionResult,
  resolveTurnDecision,
};
