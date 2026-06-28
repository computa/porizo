const {
  STORY_SLOT_PRIORITY,
  REFLECTIVE_SLOT_PRIORITY,
  STORY_SLOT_WEIGHTS,
  REFLECTIVE_SLOT_WEIGHTS,
  CRITICAL_CONFIRM_SLOT_IDS,
  sortByPriority,
} = require("./slot-gap-model");
const { createComputeLabovGapAnalysis } = require("./labov-gap-analysis");
const { normalizeOccasion, normalizeText, trimText } = require("../utils");

/**
 * Beat strength thresholds (EXPLICIT - not hidden magic numbers)
 *
 * These are interpretation thresholds for LLM-provided strength values.
 * The LLM decides strength (0-1); we interpret for backwards compatibility.
 *
 * V3: Made explicit to avoid "flowchart hiding in reasoning system"
 */
const STRENGTH_THRESHOLDS = {
  covered: 0.6, // >= this is considered "covered" (sufficient content)
  weak: 0.3, // >= this but < covered is "weak" (partial content)
  // < weak is "missing"
};

const RELATIONSHIP_HINT_REGEX =
  /\b(mom|mum|mother|dad|father|parent|sister|brother|friend|partner|wife|husband|fiance|fiancee|son|daughter|child|mentor|teacher|grandma|grandpa|aunt|uncle|cousin|colleague|boss)\b/i;
const WANT_REGEX =
  /\b(want(?:ed|s)?|wish(?:ed|es)?|hope(?:d|s)?|dream(?:ed|s)?|goal|trying to|needed to|need to|longed to|in order to|so that)\b/i;
const BLOCKER_REGEX =
  /\b(couldn't|could not|can't|cannot|blocked|stopped|prevented|afraid|fear|anxious|rule|secret|barrier|obstacle|challenge|struggle|conflict)\b/i;
const STAKES_REGEX =
  /\b(if we failed|if i failed|if they failed|if this failed|lose|lost|risk(?:ed|s)?|at stake|cost us|cost me|would have lost|without this)\b/i;
const STAKES_WEAK_REGEX =
  /\b(mattered|important|meant everything|heartbroken|devastating)\b/i;
const TURN_REGEX =
  /\b(turning point|everything changed|that moment|suddenly|after that|then i knew)\b/i;
const TURN_MEMORY_REGEX =
  /\b(i(?:'|’)ll never forget|i will never forget|i(?:'|’)ll always remember|i will always remember)\b/i;
const TURN_CRISIS_REGEX =
  /\b(high[- ]risk|bleeding|hospital|pregnan(?:cy|t)|twins?|fear|pain|uncertainty|complication|emergency|crisis|surgery|diagnosis|labou?r|delivery)\b/i;
const TURN_RESPONSE_REGEX =
  /\b(stayed strong|endured|survived|overcame|followed every instruction|kept every appointment|did everything|carried (?:them|him|her) safely)\b/i;
const TURN_TRANSFORMATION_REGEX =
  /\b(from that day|watching you become|made me love|made me respect|because of you)\b/i;
const ENDING_FEEL_REGEX =
  /\b(hopeful|tragic|funny|reflective|bittersweet|uplifting|comforting|joyful|proud|peaceful|healing|grateful|inspired|honou?red|loved|seen)\b/i;
const TONE_REGEX =
  /\b(cinematic|realistic|comedic|romantic|playful|serious|raw|poetic|gentle|dramatic|upbeat|melancholic)\b/i;
const APPRECIATION_REGEX =
  /\b(appreciat(?:e|ion)|grateful|gratitude|thankful|celebrat(?:e|ion)|honou?r|motherhood|fatherhood|selfless|sacrifice|steady presence|show(?:ing)? up|for all you do|care|support)\b/i;
const REFLECTIVE_OCCASIONS = new Set([
  "thank_you",
  "gratitude",
  "encouragement",
  "advice",
  "mothers-day",
  "fathers-day",
  "mother's-day",
  "father's-day",
]);

function hasText(value) {
  return trimText(value).length > 0;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function toConfidence(status, evidenceCount = 0) {
  const base = status === "covered" ? 0.75 : status === "weak" ? 0.35 : 0.05;
  const evidenceBoost =
    status === "missing" ? 0 : Math.min(0.2, evidenceCount * 0.05);
  return Number(clamp(base + evidenceBoost).toFixed(2));
}

function getBeatStrength(state, beatId) {
  const beat = (state?.beats || []).find(
    (candidate) => candidate?.id === beatId,
  );
  if (!beat) return 0;
  if (typeof beat.strength === "number") return beat.strength;
  if (beat.status === "covered") return 1;
  if (beat.status === "weak") return 0.45;
  return 0;
}

function hasBeatCoverage(state, beatIds, threshold) {
  return beatIds.some((beatId) => getBeatStrength(state, beatId) >= threshold);
}

function buildCorpus(state) {
  const corpus = [];
  const canonicalNarrative = hasText(state?.narrative_current)
    ? state.narrative_current
    : state?.narrative;
  if (hasText(canonicalNarrative)) corpus.push(canonicalNarrative);
  for (const fact of state?.facts || []) {
    if ((fact?.status || "active") !== "active") continue;
    if (hasText(fact?.text)) corpus.push(fact.text);
  }
  // Include raw user conversation messages so regex evaluators can detect
  // Labov elements even before the LLM pipeline extracts atoms/primitives
  for (const msg of state?.conversation || []) {
    if (msg?.role === "user" && hasText(msg?.content)) corpus.push(msg.content);
  }
  return corpus.join(" ").toLowerCase();
}

function firstText(...values) {
  for (const value of values) {
    if (hasText(value)) return trimText(value);
  }
  return "";
}

function normalizeSlot(slot, status, reason, evidence = []) {
  const cleanedEvidence = evidence
    .filter(hasText)
    .map(normalizeText)
    .slice(0, 4);
  return {
    slot,
    status,
    confidence: toConfidence(status, cleanedEvidence.length),
    reason,
    evidence: cleanedEvidence,
  };
}

function hasStrongTurnScene(corpus) {
  const hasExplicitPivot = TURN_REGEX.test(corpus);
  const hasMemoryAnchor = TURN_MEMORY_REGEX.test(corpus);
  const hasCrisis = TURN_CRISIS_REGEX.test(corpus);
  const hasResponse = TURN_RESPONSE_REGEX.test(corpus);
  const hasTransformation = TURN_TRANSFORMATION_REGEX.test(corpus);

  return (
    hasExplicitPivot ||
    (hasMemoryAnchor && hasCrisis) ||
    (hasCrisis && hasResponse) ||
    (hasMemoryAnchor && hasTransformation)
  );
}

function hasWeakTurnSignal(corpus) {
  return (
    TURN_MEMORY_REGEX.test(corpus) ||
    TURN_CRISIS_REGEX.test(corpus) ||
    TURN_RESPONSE_REGEX.test(corpus) ||
    TURN_TRANSFORMATION_REGEX.test(corpus)
  );
}

function isReflectiveTributeStory(state, corpus) {
  const occasion = normalizeOccasion(state?.event?.occasion || state?.occasion);
  if (REFLECTIVE_OCCASIONS.has(occasion)) return true;

  if (
    occasion === "birthday" ||
    occasion === "celebration" ||
    occasion === "custom"
  ) {
    return APPRECIATION_REGEX.test(corpus);
  }

  return (
    APPRECIATION_REGEX.test(corpus) &&
    !BLOCKER_REGEX.test(corpus) &&
    !STAKES_REGEX.test(corpus)
  );
}

function countActiveFacts(state) {
  return Array.isArray(state?.facts)
    ? state.facts.filter(
        (fact) =>
          (fact?.status || "active") === "active" && hasText(fact?.text),
      ).length
    : 0;
}

function computeElementSignals(state, corpus) {
  const atoms = state?.atoms || {};
  const primitives = state?.primitives || {};
  const activeFacts = countActiveFacts(state);
  const detailFragments = [
    atoms.where,
    atoms.when,
    atoms.action,
    atoms.dialogue,
    atoms.object,
    atoms.physical,
    primitives.turning_point,
    primitives.inciting_incident,
  ].filter(hasText);

  const detailSpecificity = clamp(
    Math.min(0.45, detailFragments.length * 0.1) +
      Math.min(0.3, activeFacts * 0.08) +
      (detailFragments.some((value) => trimText(value).split(/\s+/).length >= 6)
        ? 0.12
        : 0),
  );

  const relationshipDepth = clamp(
    (hasText(atoms.who) ? 0.35 : 0) +
      (hasText(state?.recipient_name) ? 0.1 : 0) +
      (RELATIONSHIP_HINT_REGEX.test(corpus) ? 0.2 : 0) +
      (Array.isArray(primitives.characters) && primitives.characters.length > 0
        ? 0.15
        : 0) +
      (activeFacts >= 2 ? 0.1 : 0),
  );

  const reflectiveMomentStrength = clamp(
    (hasText(firstText(atoms.turn, primitives.turning_point)) ? 0.45 : 0) +
      (hasText(atoms.action) ? 0.15 : 0) +
      (hasText(atoms.where) || hasText(atoms.when) ? 0.15 : 0) +
      (hasStrongTurnScene(corpus) ? 0.2 : 0),
  );

  return {
    detailSpecificity: Number(detailSpecificity.toFixed(2)),
    relationshipDepth: Number(relationshipDepth.toFixed(2)),
    reflectiveMomentStrength: Number(reflectiveMomentStrength.toFixed(2)),
  };
}

const computeLabovGapAnalysis = createComputeLabovGapAnalysis({
  normalizeOccasion,
  hasText,
  clamp,
  firstText,
  buildCorpus,
  normalizeSlot,
  STRENGTH_THRESHOLDS,
  CRITICAL_CONFIRM_SLOT_IDS,
  isReflectiveTributeStory,
  computeElementSignals,
  RELATIONSHIP_HINT_REGEX,
  BLOCKER_REGEX,
  STAKES_REGEX,
  STAKES_WEAK_REGEX,
  TURN_CRISIS_REGEX,
  TURN_REGEX,
  TURN_TRANSFORMATION_REGEX,
  ENDING_FEEL_REGEX,
  APPRECIATION_REGEX,
});

function evaluateMomentDestinationSlot(state) {
  const atoms = state?.atoms || {};
  const primitives = state?.primitives || {};
  const place = firstText(atoms.where, primitives.setting?.place);
  const time = firstText(atoms.when, primitives.setting?.time);
  const moment = firstText(
    atoms.action,
    atoms.dialogue,
    atoms.physical,
    primitives.inciting_incident,
    primitives.turning_point,
  );
  const hasMomentBeat = hasBeatCoverage(
    state,
    ["moment", "scene", "discovery"],
    STRENGTH_THRESHOLDS.weak,
  );

  if (place && time && (moment || hasMomentBeat)) {
    return normalizeSlot(
      "moment_destination",
      "covered",
      "Moment, place, and time context are present.",
      [place, time, moment],
    );
  }

  if ((place || time) && (moment || hasMomentBeat)) {
    return normalizeSlot(
      "moment_destination",
      "weak",
      "Partial setting is present but the destination moment needs precision.",
      [place, time, moment],
    );
  }

  return normalizeSlot(
    "moment_destination",
    "missing",
    "The core moment destination and setting are unclear.",
    [place, time, moment],
  );
}

function evaluateWhoSlot(state) {
  const atoms = state?.atoms || {};
  const primitives = state?.primitives || {};
  const whoText = trimText(atoms.who);
  const recipient = trimText(state?.recipient_name);
  const characters = Array.isArray(primitives.characters)
    ? primitives.characters
    : [];
  const hasCharacter = characters.some(
    (character) => hasText(character?.name) || hasText(character?.role),
  );
  const relationshipHint = RELATIONSHIP_HINT_REGEX.test(
    [
      whoText,
      recipient,
      ...characters.map(
        (character) => `${character?.name || ""} ${character?.role || ""}`,
      ),
    ].join(" "),
  );

  if ((hasText(whoText) || hasCharacter) && relationshipHint) {
    return normalizeSlot(
      "who",
      "covered",
      "Subject and relationship context are clear.",
      [whoText, recipient],
    );
  }

  if (hasText(whoText) || hasCharacter || hasText(recipient)) {
    return normalizeSlot(
      "who",
      "weak",
      "A subject exists, but relationship detail is still thin.",
      [whoText, recipient],
    );
  }

  return normalizeSlot(
    "who",
    "missing",
    "No clear subject or relationship is identified.",
    [],
  );
}

function evaluateWantSlot(state, corpus) {
  const primitives = state?.primitives || {};
  const characters = Array.isArray(primitives.characters)
    ? primitives.characters
    : [];
  const explicitDesire =
    characters.find((character) => hasText(character?.desire))?.desire || "";
  const beatSignal = hasBeatCoverage(
    state,
    ["meaning", "moment"],
    STRENGTH_THRESHOLDS.weak,
  );

  if (hasText(explicitDesire) || WANT_REGEX.test(corpus)) {
    return normalizeSlot(
      "want",
      "covered",
      "A concrete desire or goal is present.",
      [explicitDesire],
    );
  }

  if (beatSignal) {
    return normalizeSlot(
      "want",
      "weak",
      "Motivation is implied but not explicit yet.",
      [explicitDesire],
    );
  }

  return normalizeSlot(
    "want",
    "missing",
    "What the protagonist wants is not explicit.",
    [],
  );
}

function evaluateBlockerSlot(state, corpus) {
  const primitives = state?.primitives || {};
  const conflictInternal = trimText(primitives.conflict?.internal);
  const conflictExternal = trimText(primitives.conflict?.external);
  const atoms = state?.atoms || {};
  const secret = trimText(atoms.secret);
  const struggleBeat = hasBeatCoverage(
    state,
    ["struggle", "stakes"],
    STRENGTH_THRESHOLDS.weak,
  );

  if (
    hasText(conflictInternal) ||
    hasText(conflictExternal) ||
    hasText(secret)
  ) {
    return normalizeSlot(
      "blocker",
      "covered",
      "A concrete obstacle is captured.",
      [conflictInternal, conflictExternal, secret],
    );
  }

  if (BLOCKER_REGEX.test(corpus) || struggleBeat) {
    return normalizeSlot(
      "blocker",
      "weak",
      "Some friction exists, but the blocker is still vague.",
      [],
    );
  }

  return normalizeSlot(
    "blocker",
    "missing",
    "No clear blocker is defined.",
    [],
  );
}

function evaluateStakesSlot(state, corpus) {
  const atoms = state?.atoms || {};
  const stakesText = trimText(atoms.stakes);
  const stakesBeatCovered = hasBeatCoverage(
    state,
    ["stakes", "impact"],
    STRENGTH_THRESHOLDS.covered,
  );
  const stakesBeatWeak = hasBeatCoverage(
    state,
    ["stakes", "impact"],
    STRENGTH_THRESHOLDS.weak,
  );

  if (hasText(stakesText) || STAKES_REGEX.test(corpus) || stakesBeatCovered) {
    return normalizeSlot("stakes", "covered", "Consequences are explicit.", [
      stakesText,
    ]);
  }

  if (STAKES_WEAK_REGEX.test(corpus) || stakesBeatWeak) {
    return normalizeSlot(
      "stakes",
      "weak",
      "Importance is implied but concrete consequences are missing.",
      [stakesText],
    );
  }

  return normalizeSlot(
    "stakes",
    "missing",
    "No explicit consequences are captured.",
    [stakesText],
  );
}

function evaluateTurnSlot(state, corpus) {
  const atoms = state?.atoms || {};
  const primitives = state?.primitives || {};
  const turnText = firstText(atoms.turn, primitives.turning_point);
  const turnBeatCovered = hasBeatCoverage(
    state,
    ["turning_point", "moment"],
    STRENGTH_THRESHOLDS.covered,
  );
  const turnBeatWeak = hasBeatCoverage(
    state,
    ["turning_point", "moment"],
    STRENGTH_THRESHOLDS.weak,
  );
  const strongTurnScene = hasStrongTurnScene(corpus);

  if (hasText(turnText) || turnBeatCovered) {
    return normalizeSlot(
      "turn",
      "covered",
      "A clear turning point is present.",
      [turnText],
    );
  }

  if (strongTurnScene || hasWeakTurnSignal(corpus) || turnBeatWeak) {
    return normalizeSlot(
      "turn",
      "weak",
      "A shift is hinted at but the decisive turn is unclear.",
      [turnText],
    );
  }

  return normalizeSlot(
    "turn",
    "missing",
    "No clear turning point is captured yet.",
    [turnText],
  );
}

function evaluateEndingFeelSlot(state, corpus) {
  const primitives = state?.primitives || {};
  const atoms = state?.atoms || {};
  const endingText = firstText(atoms.after, primitives.resolution);
  const hasEmotion = ENDING_FEEL_REGEX.test(corpus);

  if (hasText(endingText) && hasEmotion) {
    return normalizeSlot(
      "ending_feel",
      "covered",
      "Ending direction and emotional outcome are both present.",
      [endingText],
    );
  }

  if (hasText(endingText) || hasEmotion) {
    return normalizeSlot(
      "ending_feel",
      "weak",
      "Ending is partially defined, but emotional intent is unclear.",
      [endingText],
    );
  }

  return normalizeSlot(
    "ending_feel",
    "missing",
    "Desired ending emotion is not defined.",
    [],
  );
}

function evaluateToneSlot(state, corpus) {
  const dials = state?.dials || {};
  const toneText = trimText(dials.tone);
  const weakToneHint = firstText(dials.focus, dials.realism, dials.pov);
  const hasTonePattern = TONE_REGEX.test(corpus);

  if (hasText(toneText) || hasTonePattern) {
    return normalizeSlot("tone", "covered", "Tone direction is explicit.", [
      toneText,
    ]);
  }

  if (hasText(weakToneHint)) {
    return normalizeSlot(
      "tone",
      "weak",
      "Some stylistic hints exist, but tone is not explicit.",
      [weakToneHint],
    );
  }

  return normalizeSlot("tone", "missing", "No tone direction is captured.", []);
}

/**
 * Compute deterministic gap analysis for story questioning.
 *
 * @returns {{
 *   slots: Array,
 *   missingSlots: string[],
 *   weakSlots: string[],
 *   readinessScore: number,
 *   isStoryReady: boolean,
 *   gates: Object
 * }}
 */
function computeStoryGapAnalysis(state) {
  const corpus = buildCorpus(state);
  const storyMode = isReflectiveTributeStory(state, corpus)
    ? "reflective_tribute"
    : "default";
  const priorityOrder =
    storyMode === "reflective_tribute"
      ? REFLECTIVE_SLOT_PRIORITY
      : STORY_SLOT_PRIORITY;
  const weightMap =
    storyMode === "reflective_tribute"
      ? REFLECTIVE_SLOT_WEIGHTS
      : STORY_SLOT_WEIGHTS;

  const slots = [
    evaluateMomentDestinationSlot(state),
    evaluateWhoSlot(state),
    evaluateWantSlot(state, corpus),
    evaluateBlockerSlot(state, corpus),
    evaluateStakesSlot(state, corpus),
    evaluateTurnSlot(state, corpus),
    evaluateEndingFeelSlot(state, corpus),
    evaluateToneSlot(state, corpus),
  ];

  const slotById = new Map(slots.map((slot) => [slot.slot, slot]));
  const missingSlots = sortByPriority(
    slots.filter((slot) => slot.status === "missing").map((slot) => slot.slot),
    priorityOrder,
  );
  const weakSlots = sortByPriority(
    slots.filter((slot) => slot.status === "weak").map((slot) => slot.slot),
    priorityOrder,
  );

  const weightSum = priorityOrder.reduce(
    (sum, slot) => sum + (weightMap[slot] || 1),
    0,
  );
  const weightedConfidence = priorityOrder.reduce((sum, slotId) => {
    const slot = slotById.get(slotId);
    const confidence = slot ? slot.confidence : 0;
    return sum + confidence * (weightMap[slotId] || 1);
  }, 0);
  const readinessScore = Number(
    (weightedConfidence / Math.max(weightSum, 1)).toFixed(2),
  );

  const coveredCount = slots.filter((slot) => slot.status === "covered").length;
  const coveredOrWeakCount = slots.filter(
    (slot) => slot.status === "covered" || slot.status === "weak",
  ).length;
  const blockerCovered = slotById.get("blocker")?.status === "covered";
  const stakesCovered = slotById.get("stakes")?.status === "covered";
  const whoCovered = slotById.get("who")?.status === "covered";
  const momentCovered =
    slotById.get("moment_destination")?.status === "covered";
  const turnAtLeastWeak = ["covered", "weak"].includes(
    slotById.get("turn")?.status || "missing",
  );
  const endingAtLeastWeak = ["covered", "weak"].includes(
    slotById.get("ending_feel")?.status || "missing",
  );
  const criticalConfirmSlotsCovered = CRITICAL_CONFIRM_SLOT_IDS.every(
    (slotId) => slotById.get(slotId)?.status === "covered",
  );
  const noSafetyBlock = !(
    state?.last_reasoning?.safety?.blocked === true ||
    state?.last_reasoning?.safety?.requires_refusal === true ||
    state?.last_reasoning?.safety_violation === true
  );

  const dramaticReady =
    blockerCovered &&
    stakesCovered &&
    endingAtLeastWeak &&
    coveredCount >= 5 &&
    noSafetyBlock &&
    readinessScore >= 0.72;

  // Reflective stories may not always have explicit blocker/stakes phrasing.
  // Accept completion when identity, moment, turn, and emotional ending are coherent.
  const reflectiveReady =
    whoCovered &&
    momentCovered &&
    turnAtLeastWeak &&
    slotById.get("ending_feel")?.status === "covered" &&
    coveredCount >= 4 &&
    coveredOrWeakCount >= 6 &&
    noSafetyBlock &&
    readinessScore >= 0.62;

  const gates = {
    blockerCovered,
    stakesCovered,
    enoughCoveredSlots: coveredCount >= 5,
    enoughCoveredOrWeakSlots: coveredOrWeakCount >= 6,
    momentCovered,
    whoCovered,
    turnAtLeastWeak,
    endingAtLeastWeak,
    criticalConfirmSlotsCovered,
    noSafetyBlock,
    dramaticReady,
    reflectiveReady,
  };

  const isStoryReady = dramaticReady || reflectiveReady;
  const readinessProfile = dramaticReady
    ? "dramatic"
    : reflectiveReady
      ? "reflective"
      : "incomplete";

  return {
    slots,
    missingSlots,
    weakSlots,
    readinessScore,
    isStoryReady,
    readinessProfile,
    storyMode,
    elementSignals: computeElementSignals(state, corpus),
    gates,
  };
}

module.exports = {
  STRENGTH_THRESHOLDS,
  RELATIONSHIP_HINT_REGEX,
  WANT_REGEX,
  BLOCKER_REGEX,
  STAKES_REGEX,
  TURN_REGEX,
  TURN_CRISIS_REGEX,
  TURN_TRANSFORMATION_REGEX,
  ENDING_FEEL_REGEX,
  APPRECIATION_REGEX,
  clamp,
  computeElementSignals,
  computeLabovGapAnalysis,
  computeStoryGapAnalysis,
};
