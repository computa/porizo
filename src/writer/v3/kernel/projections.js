const { createStageProjection } = require("./types");

function compactString(text, maxChars = 180) {
  const normalized = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  if (!normalized) return null;
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function takeActiveFacts(state, { maxFacts = 6, maxChars = 140 } = {}) {
  const facts = Array.isArray(state?.facts)
    ? state.facts.filter((fact) => (fact?.status || "active") === "active")
    : [];
  return facts.slice(-maxFacts).map((fact) => ({
    id: fact.id || null,
    beat: fact.beat || null,
    text: compactString(fact.text, maxChars),
  }));
}

function pickAtomFields(state, keys, maxChars = 120) {
  const atoms = state?.atoms || {};
  return Object.fromEntries(
    keys
      .map((key) => [key, compactString(atoms[key], maxChars)])
      .filter(([, value]) => value)
  );
}

function pickPrimitiveFields(state, maxChars = 140) {
  const primitives = state?.primitives || {};
  return {
    setting: {
      place: compactString(primitives?.setting?.place, maxChars),
      time: compactString(primitives?.setting?.time, maxChars),
      atmosphere: compactString(primitives?.setting?.atmosphere, maxChars),
    },
    conflict: {
      internal: compactString(primitives?.conflict?.internal, maxChars),
      external: compactString(primitives?.conflict?.external, maxChars),
    },
    turning_point: compactString(primitives?.turning_point, maxChars),
    resolution: compactString(primitives?.resolution, maxChars),
    theme: compactString(primitives?.theme, maxChars),
  };
}

function takeRecentQuestions(state, { maxEntries = 4, maxChars = 160 } = {}) {
  const asked = Array.isArray(state?.story_state?.questionsAsked) ? state.story_state.questionsAsked : [];
  return asked.slice(-maxEntries).map((entry) => ({
    round: entry.round || 0,
    targetElement: entry.targetElement || null,
    answered: Boolean(entry.answered),
    question: compactString(entry.question, maxChars),
    answerSummary: compactString(entry.answerSummary, maxChars),
  }));
}

function buildIngestProjection(state, previousQuestion, options = {}) {
  return createStageProjection({
    recipientName: state?.recipient_name || null,
    occasion: state?.event?.occasion || null,
    storyMode: state?.story_mode || state?.storyMode || "default",
    initialPrompt: compactString(state?.initial_prompt, options.maxInitialPromptChars || 220),
    previousQuestion: compactString(previousQuestion, options.maxQuestionChars || 180),
    narrative: compactString(state?.narrative_current || state?.narrative, options.maxNarrativeChars || 360),
    atoms: pickAtomFields(state, ["who", "where", "when", "action", "stakes", "turn", "after"], options.maxAtomChars || 120),
    primitives: pickPrimitiveFields(state, options.maxPrimitiveChars || 140),
    activeFacts: takeActiveFacts(state, {
      maxFacts: options.maxFacts || 6,
      maxChars: options.maxFactChars || 140,
    }),
    recentQuestions: takeRecentQuestions(state, {
      maxEntries: options.maxRecentQuestions || 4,
      maxChars: options.maxQuestionChars || 160,
    }),
  });
}

function buildPlannerProjection(state, gapAnalysis) {
  return createStageProjection({
    turnCount: Number(state?.turn_count || 0),
    readinessScore: typeof gapAnalysis?.readinessScore === "number" ? gapAnalysis.readinessScore : 0,
    missingSlots: Array.isArray(gapAnalysis?.missingSlots) ? gapAnalysis.missingSlots.slice(0, 6) : [],
    weakSlots: Array.isArray(gapAnalysis?.weakSlots) ? gapAnalysis.weakSlots.slice(0, 6) : [],
    questionsAsked: takeRecentQuestions(state),
  });
}

function buildQuestionComposeProjection(state, decision, gapAnalysis, gapQuestion, options = {}) {
  return createStageProjection({
    recipientName: state?.recipient_name || null,
    occasion: state?.event?.occasion || null,
    targetElement: decision?.targetElement || null,
    targetSlot: decision?.targetSlot || gapQuestion?.targetSlot || null,
    targetReason: decision?.reason || null,
    previousQuestion: compactString(options.previousQuestion, 180),
    narrative: compactString(state?.narrative_current || state?.narrative, 320),
    activeFacts: takeActiveFacts(state, { maxFacts: 5, maxChars: 120 }),
    missingSlots: Array.isArray(gapAnalysis?.missingSlots) ? gapAnalysis.missingSlots.slice(0, 4) : [],
    weakSlots: Array.isArray(gapAnalysis?.weakSlots) ? gapAnalysis.weakSlots.slice(0, 4) : [],
  });
}

function buildConfirmComposeProjection(state, decision, gapAnalysis) {
  return createStageProjection({
    recipientName: state?.recipient_name || null,
    occasion: state?.event?.occasion || null,
    targetElement: decision?.targetElement || null,
    readinessScore: typeof gapAnalysis?.readinessScore === "number" ? gapAnalysis.readinessScore : 0,
    coveredSlots: Array.isArray(gapAnalysis?.slots)
      ? gapAnalysis.slots.filter((slot) => slot.status === "covered").map((slot) => slot.slot).slice(0, 6)
      : [],
    narrative: compactString(state?.narrative_current || state?.narrative, 360),
  });
}

module.exports = {
  buildIngestProjection,
  buildPlannerProjection,
  buildQuestionComposeProjection,
  buildConfirmComposeProjection,
};
