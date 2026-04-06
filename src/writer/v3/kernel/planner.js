const {
  getElementForSlot,
  getSlotLabovElement,
  validateQuestionRelevance,
  computeStoryGapAnalysis,
  computeLabovGapAnalysis,
  pickDeterministicGapQuestion,
  getCriticalConfirmSlotCoverage,
  computeStoryElements,
  getElementConfirmBlock,
} = require("../quality");
const { createPlannerCandidate, createTurnDecision } = require("./types");

const LABOV_QUESTION_ELEMENTS = ["orientation", "complicating_action", "evaluation", "resolution"];
const SEMANTIC_REPEAT_STOP_WORDS = new Set([
  "a", "an", "and", "are", "around", "as", "at", "be", "because", "but", "by",
  "can", "could", "did", "do", "does", "for", "from", "had", "has", "have",
  "how", "i", "if", "in", "into", "is", "it", "its", "just", "me", "more",
  "my", "of", "on", "or", "our", "so", "than", "that", "the", "their", "them",
  "then", "there", "these", "they", "this", "those", "through", "to", "too",
  "up", "us", "was", "we", "were", "what", "when", "where", "which", "who",
  "why", "with", "would", "you", "your",
]);
const SUBSTANTIVE_ANSWER_MIN_CHARS = 24;
const SUFFICIENT_ANSWER_MIN_CHARS = 56;

function inferAskedQuestionElement(question) {
  for (const element of LABOV_QUESTION_ELEMENTS) {
    if (validateQuestionRelevance(question, element)) return element;
  }
  return null;
}

function tokenizeSemanticRepeatText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !SEMANTIC_REPEAT_STOP_WORDS.has(token));
}

function scoreTokenOverlap(tokensA, tokensB) {
  if (!tokensA?.length || !tokensB?.length) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let overlap = 0;
  for (const token of setA) {
    if (setB.has(token)) overlap += 1;
  }
  return overlap / Math.max(1, Math.min(setA.size, setB.size));
}

function countSharedTokens(tokensA, tokensB) {
  if (!tokensA?.length || !tokensB?.length) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let overlap = 0;
  for (const token of setA) {
    if (setB.has(token)) overlap += 1;
  }
  return overlap;
}

function getRankedQuestionTargets(gapAnalysis) {
  if (!gapAnalysis?.labov?.elements) return [];
  return gapAnalysis.labov.elements
    .filter((element) => element && typeof element.weight === "number" && typeof element.strength === "number")
    .filter((element) => LABOV_QUESTION_ELEMENTS.includes(element.element))
    .filter((element) => element.strength < 0.6)
    .map((element) => ({
      element: element.element,
      weight: element.weight,
      currentStrength: element.strength,
      priority: Number((element.weight * (1 - element.strength)).toFixed(3)),
    }))
    .sort((a, b) => b.priority - a.priority);
}

function getLabovElementStrengthMap(gapAnalysis, storyState) {
  const map = new Map();
  const fromGap = Array.isArray(gapAnalysis?.labov?.elements) ? gapAnalysis.labov.elements : [];
  for (const entry of fromGap) {
    if (LABOV_QUESTION_ELEMENTS.includes(entry?.element)) {
      map.set(entry.element, Number(entry.strength || 0));
    }
  }
  for (const element of LABOV_QUESTION_ELEMENTS) {
    if (map.has(element)) continue;
    const fallbackStrength = Number(storyState?.labov?.[element]?.strength || 0);
    map.set(element, fallbackStrength);
  }
  return map;
}

function isSubstantiveAnswerSummary(text) {
  return typeof text === "string" && text.trim().length >= SUBSTANTIVE_ANSWER_MIN_CHARS;
}

function isSufficientAnswerSummary(text) {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (trimmed.length >= SUFFICIENT_ANSWER_MIN_CHARS) return true;
  return tokenizeSemanticRepeatText(trimmed).length >= 10;
}

function getElementTargetLedger(gapAnalysis, storyState) {
  const ledger = new Map();
  const ranked = getRankedQuestionTargets(gapAnalysis);
  const strengthMap = getLabovElementStrengthMap(gapAnalysis, storyState);
  const storyMode = gapAnalysis?.storyMode || "default";

  for (const element of LABOV_QUESTION_ELEMENTS) {
    const candidate = ranked.find((entry) => entry.element === element);
    ledger.set(element, {
      element,
      weight: candidate?.weight || 0,
      currentStrength: candidate?.currentStrength ?? strengthMap.get(element) ?? 0,
      missingSlotCount: 0,
      weakSlotCount: 0,
      answeredCount: 0,
      substantiveAnswerCount: 0,
      sufficientAnswerCount: 0,
      lastAnsweredRound: 0,
      bestSlot: null,
      bestSlotState: null,
    });
  }

  for (const slot of Array.isArray(gapAnalysis?.slots) ? gapAnalysis.slots : []) {
    const targetElement = getSlotLabovElement(slot?.slot) || getElementForSlot(storyMode, slot?.slot)?.id || null;
    if (!targetElement || !ledger.has(targetElement)) continue;
    const entry = ledger.get(targetElement);
    if (slot.status === "missing") {
      entry.missingSlotCount += 1;
    } else if (slot.status === "weak") {
      entry.weakSlotCount += 1;
    }
    const entryBestState = entry.bestSlotState === "missing" ? 2 : entry.bestSlotState === "weak" ? 1 : 0;
    const slotStateRank = slot.status === "missing" ? 2 : slot.status === "weak" ? 1 : 0;
    if (!entry.bestSlot || slotStateRank > entryBestState) {
      entry.bestSlot = slot.slot || null;
      entry.bestSlotState = slot.status || null;
    }
  }

  const questions = Array.isArray(storyState?.questionsAsked) ? storyState.questionsAsked : [];
  for (const asked of questions) {
    if (!asked?.answered) continue;
    const targetElement = asked.targetElement || inferAskedQuestionElement(asked.question || "");
    if (!targetElement || !ledger.has(targetElement)) continue;
    const entry = ledger.get(targetElement);
    entry.answeredCount += 1;
    if (isSubstantiveAnswerSummary(asked.answerSummary)) {
      entry.substantiveAnswerCount += 1;
    }
    if (isSufficientAnswerSummary(asked.answerSummary)) {
      entry.sufficientAnswerCount += 1;
    }
    if (Number.isFinite(Number(asked.round))) {
      entry.lastAnsweredRound = Math.max(entry.lastAnsweredRound, Number(asked.round));
    }
  }

  return ledger;
}

function scoreQuestionTargetCandidate(candidate, ledgerEntry, directTarget = null) {
  const missingSlotCount = ledgerEntry?.missingSlotCount || 0;
  const weakSlotCount = ledgerEntry?.weakSlotCount || 0;
  const answeredCount = ledgerEntry?.answeredCount || 0;
  const substantiveAnswerCount = ledgerEntry?.substantiveAnswerCount || 0;
  const sufficientAnswerCount = ledgerEntry?.sufficientAnswerCount || 0;
  const strengthGap = Math.max(0, 1 - Number(candidate?.currentStrength || 0));
  const unresolvedBonus = (missingSlotCount * 120) + (weakSlotCount * 45);
  const strengthBonus = Math.round(strengthGap * 24);
  const directTargetBonus = directTarget && candidate.element === directTarget ? 18 : 0;
  const priorityBonus = Math.round(Number(candidate?.priority || 0) * 100);
  const answerPenalty = (answeredCount * 6) + (substantiveAnswerCount * 14) + (sufficientAnswerCount * 26);
  const sufficientPenalty = sufficientAnswerCount >= 2 ? 48 : 0;
  const score = priorityBonus + unresolvedBonus + strengthBonus + directTargetBonus - answerPenalty - sufficientPenalty;

  const reasons = [];
  if (missingSlotCount > 0) reasons.push(`missingSlots=${missingSlotCount}`);
  if (weakSlotCount > 0) reasons.push(`weakSlots=${weakSlotCount}`);
  reasons.push(`strength=${Number(candidate?.currentStrength || 0).toFixed(2)}`);
  if (directTargetBonus) reasons.push("directTargetBonus");
  if (answeredCount > 0) reasons.push(`answered=${answeredCount}`);
  if (substantiveAnswerCount > 0) reasons.push(`substantiveAnswers=${substantiveAnswerCount}`);
  if (sufficientAnswerCount > 0) reasons.push(`sufficientAnswers=${sufficientAnswerCount}`);
  if (sufficientPenalty) reasons.push("repeatPenalty");

  return createPlannerCandidate({
    element: candidate.element,
    score,
    reason: reasons.join(", "),
    reasons,
    weight: candidate.weight,
    currentStrength: candidate.currentStrength,
    missingSlotCount,
    weakSlotCount,
    answeredCount,
    substantiveAnswerCount,
    sufficientAnswerCount,
    bestSlot: ledgerEntry?.bestSlot || null,
    bestSlotState: ledgerEntry?.bestSlotState || null,
    lastAnsweredRound: ledgerEntry?.lastAnsweredRound || 0,
  });
}

function rankQuestionTargetCandidates(gapAnalysis, storyState, options = {}) {
  const ranked = getRankedQuestionTargets(gapAnalysis);
  const directTarget = options.directTarget || null;
  const ledger = getElementTargetLedger(gapAnalysis, storyState);
  const candidates = LABOV_QUESTION_ELEMENTS.map((element) => {
    const rankedCandidate = ranked.find((candidate) => candidate.element === element);
    const ledgerEntry = ledger.get(element);
    return scoreQuestionTargetCandidate(
      rankedCandidate || {
        element,
        weight: ledgerEntry?.weight || 0,
        currentStrength: ledgerEntry?.currentStrength || 0,
        priority: (ledgerEntry?.missingSlotCount || ledgerEntry?.weakSlotCount)
          ? (1 - (ledgerEntry?.currentStrength || 0))
          : 0,
      },
      ledgerEntry,
      directTarget
    );
  });
  return candidates.sort((a, b) => b.score - a.score);
}

function getRecentAnsweredQuestions(storyState, limit = 4) {
  const questions = Array.isArray(storyState?.questionsAsked) ? storyState.questionsAsked : [];
  return questions.filter((entry) => entry?.answered).slice(-limit);
}

function detectRepeatedQuestionTheme(question, targetElement, storyState) {
  const currentTokens = tokenizeSemanticRepeatText(question);
  const recentAnswered = getRecentAnsweredQuestions(storyState);
  if (recentAnswered.length === 0) return null;

  for (let index = recentAnswered.length - 1; index >= 0; index -= 1) {
    const entry = recentAnswered[index];
    const entryElement = entry.targetElement || inferAskedQuestionElement(entry.question || "");
    const entryQuestionTokens = tokenizeSemanticRepeatText(entry.question || "");
    const entryAnswerTokens = tokenizeSemanticRepeatText(entry.answerSummary || "");
    const questionOverlap = scoreTokenOverlap(currentTokens, entryQuestionTokens);
    const answerOverlap = scoreTokenOverlap(currentTokens, entryAnswerTokens);
    const sharedQuestionTokens = countSharedTokens(currentTokens, entryQuestionTokens);
    const sharedAnswerTokens = countSharedTokens(currentTokens, entryAnswerTokens);
    const sameElement = Boolean(targetElement) && entryElement === targetElement;
    const substantiveAnswer = isSubstantiveAnswerSummary(entry.answerSummary);

    if (
      sameElement &&
      substantiveAnswer &&
      (
        currentTokens.length === 0 ||
        sharedQuestionTokens >= 1 ||
        sharedAnswerTokens >= 1 ||
        questionOverlap >= 0.34 ||
        answerOverlap >= 0.26
      )
    ) {
      return {
        priorQuestion: entry.question || null,
        priorAnswerSummary: entry.answerSummary || null,
        priorElement: entryElement || null,
        questionOverlap,
        answerOverlap,
      };
    }

    if (
      (sharedQuestionTokens >= 2 && questionOverlap >= 0.45) ||
      (sharedAnswerTokens >= 2 && answerOverlap >= 0.45)
    ) {
      return {
        priorQuestion: entry.question || null,
        priorAnswerSummary: entry.answerSummary || null,
        priorElement: entryElement || null,
        questionOverlap,
        answerOverlap,
      };
    }
  }

  return null;
}

function selectAlternativeQuestionTarget(gapAnalysis, storyState, excludedElements = new Set()) {
  const candidates = rankQuestionTargetCandidates(gapAnalysis, storyState);
  const unresolvedPreferred = candidates.find((candidate) =>
    !excludedElements.has(candidate.element)
      && candidate.sufficientAnswerCount < 2
      && (candidate.missingSlotCount > 0 || candidate.weakSlotCount > 0)
  );
  if (unresolvedPreferred) return unresolvedPreferred.element;
  return candidates.find((candidate) => !excludedElements.has(candidate.element))?.element || null;
}

function shouldForceForwardProgressConfirm(ctx, state, repeatedElementCount = 0) {
  if (ctx?.gapAnalysis?.isStoryReady) return true;

  const readinessScore = typeof ctx?.gapAnalysis?.readinessScore === "number"
    ? ctx.gapAnalysis.readinessScore
    : 0;
  const coveredSlots = Array.isArray(ctx?.gapAnalysis?.slots)
    ? ctx.gapAnalysis.slots.filter((slot) => slot.status === "covered").length
    : 0;
  const turnCount = Number(state?.turn_count || 0);
  const factCount = Array.isArray(state?.facts)
    ? state.facts.filter((fact) => (fact?.status || "active") === "active").length
    : 0;
  const narrativeLength = String(state?.narrative_current || state?.narrative || "").length;

  if (
    repeatedElementCount >= 2 &&
    turnCount >= 4 &&
    factCount >= 4 &&
    coveredSlots >= 4 &&
    readinessScore >= 0.58 &&
    narrativeLength >= 180
  ) {
    return true;
  }

  if (
    repeatedElementCount >= 3 &&
    turnCount >= 5 &&
    factCount >= 5 &&
    coveredSlots >= 4 &&
    readinessScore >= 0.5 &&
    narrativeLength >= 220
  ) {
    return true;
  }

  return false;
}

function buildTargetDecisionMeta(gapAnalysis, storyState, response, targetElement) {
  const directTargetCandidate = getSlotLabovElement(response?.targetSlot);
  const directTarget = LABOV_QUESTION_ELEMENTS.includes(directTargetCandidate)
    ? directTargetCandidate
    : null;
  const candidates = rankQuestionTargetCandidates(gapAnalysis, storyState, { directTarget });
  const winner = candidates.find((candidate) => candidate.element === targetElement) || null;
  return {
    directTarget,
    winner: winner ? { ...winner } : null,
    alternatives: candidates
      .filter((candidate) => candidate.element !== targetElement)
      .slice(0, 3)
      .map((candidate) => ({ ...candidate })),
  };
}

function selectRuntimeQuestionTarget(response, gapAnalysis, storyState, options = {}) {
  const excludedElements = options.excludedElements instanceof Set ? options.excludedElements : new Set();
  const directTargetCandidate = getSlotLabovElement(response?.targetSlot);
  const directTarget = LABOV_QUESTION_ELEMENTS.includes(directTargetCandidate)
    ? directTargetCandidate
    : null;
  const candidates = rankQuestionTargetCandidates(gapAnalysis, storyState, { directTarget });
  const preferred = candidates.find((candidate) =>
    !excludedElements.has(candidate.element)
      && candidate.sufficientAnswerCount < 2
      && (candidate.missingSlotCount > 0 || candidate.weakSlotCount > 0)
  );
  if (preferred) return preferred.element;
  if (directTarget && !excludedElements.has(directTarget)) return directTarget;
  return candidates.find((candidate) => !excludedElements.has(candidate.element))?.element || null;
}

function summarizeTargetAlternatives(targetDecision) {
  if (!targetDecision?.alternatives?.length) return null;
  return targetDecision.alternatives
    .map((candidate) => `${candidate.element}:${candidate.score}[${candidate.reason}]`)
    .join(" | ");
}

function planTurn({ state, gapAnalysis, response = {}, forceConfirm = false, source = "kernel_planner" }) {
  const storyState = state?.story_state || {};
  const targetElement = selectRuntimeQuestionTarget(response, gapAnalysis, storyState);
  const targetDecision = buildTargetDecisionMeta(gapAnalysis, storyState, response, targetElement);
  const winner = targetDecision?.winner;
  const strongestRepeatCount = Math.max(
    winner?.substantiveAnswerCount || 0,
    winner?.sufficientAnswerCount || 0,
  );
  const shouldConfirm = forceConfirm || shouldForceForwardProgressConfirm({ gapAnalysis }, state, strongestRepeatCount);

  if (shouldConfirm) {
    return {
      decision: createTurnDecision({
        action: "CONFIRM",
        targetElement,
        targetSlot: winner?.bestSlot || response?.targetSlot || null,
        reason: forceConfirm ? "explicit_force_confirm" : "forward_progress_or_ready",
        alternatives: targetDecision?.alternatives || [],
        confidence: gapAnalysis?.isStoryReady ? 0.9 : 0.72,
        source,
      }),
      targetDecision,
    };
  }

  return {
    decision: createTurnDecision({
      action: response?.action === "CLARIFY" ? "CLARIFY" : "ASK",
      targetElement,
      targetSlot: winner?.bestSlot || response?.targetSlot || null,
      reason: winner?.reason || "unresolved_slot_priority",
      alternatives: targetDecision?.alternatives || [],
      confidence: winner?.missingSlotCount > 0 ? 0.82 : 0.68,
      source,
    }),
    targetDecision,
  };
}

function buildPlanningContext({ state, response = {}, inputMode = "answer", llmReadySignal = false }) {
  const useLabovScoring = state?.flags?.labov_scoring === true;
  const gapAnalysis = useLabovScoring
    ? computeLabovGapAnalysis(state, { occasion: state?.event?.occasion || state?.occasion, turnCount: state?.turn_count })
    : computeStoryGapAnalysis(state);
  const gapQuestion = pickDeterministicGapQuestion(gapAnalysis);
  const criticalCoverage = getCriticalConfirmSlotCoverage(gapAnalysis);
  const elements = computeStoryElements(gapAnalysis);
  const elementBlock = getElementConfirmBlock(elements);
  const hardSafetyBlock = state?.last_reasoning?.safety?.blocked === true
    || state?.last_reasoning?.safety?.requires_refusal === true
    || state?.last_reasoning?.safety_violation === true;
  const hardGroundingBlock = state?.grounding_enforced && state?.grounding_issue === "no_facts";
  const hardCriticalBlock = criticalCoverage.hasBlockingGap;
  const hardElementBlock = elementBlock.hasElementBlock;
  const hardSemanticBlock = state?.semantic_story?.can_confirm === false;
  const hardBlockConfirm = hardSafetyBlock || hardGroundingBlock;
  const hybridReady = !hardBlockConfirm && (gapAnalysis.isStoryReady || llmReadySignal);

  return {
    gapAnalysis,
    gapQuestion,
    criticalCoverage,
    elements,
    elementBlock,
    hardElementBlock,
    llmReadySignal,
    hardSafetyBlock,
    hardGroundingBlock,
    hardCriticalBlock,
    hardSemanticBlock,
    hardBlockConfirm,
    hybridReady,
    isRevision: inputMode === "revision",
    useLabovScoring,
    response,
  };
}

module.exports = {
  LABOV_QUESTION_ELEMENTS,
  inferAskedQuestionElement,
  tokenizeSemanticRepeatText,
  getRankedQuestionTargets,
  getLabovElementStrengthMap,
  isSubstantiveAnswerSummary,
  isSufficientAnswerSummary,
  getElementTargetLedger,
  scoreQuestionTargetCandidate,
  rankQuestionTargetCandidates,
  getRecentAnsweredQuestions,
  detectRepeatedQuestionTheme,
  selectAlternativeQuestionTarget,
  shouldForceForwardProgressConfirm,
  buildTargetDecisionMeta,
  selectRuntimeQuestionTarget,
  summarizeTargetAlternatives,
  buildPlanningContext,
  planTurn,
};
