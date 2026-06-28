/**
 * V3 Quality Checks
 *
 * V3 Update: Trust LLM decisions. Harness only provides safety bounds.
 * No fatigue threshold overrides. Content-based fallback heuristics.
 *
 * @module writer/v3/quality
 */
const {
  POEM_GAP_QUESTIONS,
  buildPoemGapQuestion,
  evaluatePoemReadiness,
} = require("./quality/poem-readiness");
const {
  computeQuestionPriority,
  detectEmotionalIntensity,
  generateTargetedFallbackQuestion,
  getQuestionStage,
  validateQuestionRelevance,
} = require("./quality/question-targeting");
const {
  STORY_SLOT_PRIORITY,
  REFLECTIVE_SLOT_PRIORITY,
  STORY_SLOT_WEIGHTS,
  REFLECTIVE_SLOT_WEIGHTS,
  CRITICAL_CONFIRM_SLOT_IDS,
  SLOT_GUIDANCE_TEMPLATES,
  SLOT_TO_ELEMENT_FALLBACK,
  findHighestPriorityGap,
  getSlotGuidance,
  sortByPriority,
  pickDeterministicGapQuestion,
  getCriticalConfirmSlotCoverage,
} = require("./quality/slot-gap-model");
const {
  SLOT_TO_LABOV_ELEMENT,
  getSlotLabovElement,
  createComputeLabovGapAnalysis,
  EVALUATION_REGEX,
  SENSORY_REGEX,
  PAST_ACTION_REGEX,
  DEDICATION_REGEX,
  ORIENTATION_REGEX,
  COMPLICATING_REGEX,
  RESOLUTION_REGEX,
} = require("./quality/labov-gap-analysis");

/**
 * Safety bounds - the only things the harness can override
 */
const SAFETY_BOUNDS = {
  maxTurns: 20,
};

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

/**
 * Beat fallback priority (EXPLICIT - not hidden in function body)
 *
 * Used ONLY when LLM is unavailable to decide which beat to ask about next.
 * Lower index = higher priority (ask about first).
 *
 * Priority rationale:
 * 1. Emotionally pivotal moments (most important for song)
 * 2. Core meaning (what it means to them)
 * 3. Scene/foundation (grounding details)
 * 4. Stakes/tension (drama elements)
 *
 * V3: Made explicit to avoid "flowchart hiding in reasoning system"
 */
const BEAT_FALLBACK_PRIORITY = [
  // Emotionally pivotal moments (highest priority)
  "turning_point",
  "moment",
  "birth_moment",
  "falling",
  // Core meaning
  "meaning",
  // Scene/foundation
  "scene",
  "meeting",
  "discovery",
  "who",
  // Stakes/tension (lowest priority)
  "stakes",
  "scare",
  "struggle",
];

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

const { normalizeOccasion, normalizeText, trimText } = require("./utils");

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

// --- Story Element Definitions (5 display elements from 8 slots) ---

const STORY_ELEMENT_DEFINITIONS = [
  {
    id: "setting",
    displayName: "The Setting",
    purpose: "Where and when the story takes place",
    primarySlot: "moment_destination",
    bonusSlots: [],
    isRequired: true,
  },
  {
    id: "feeling",
    displayName: "The Feeling",
    purpose: "The emotional core of the story",
    primarySlot: "ending_feel",
    bonusSlots: ["tone"],
    isRequired: true,
  },
  {
    id: "bond",
    displayName: "Your Bond",
    purpose: "What makes your relationship special",
    primarySlot: "who",
    bonusSlots: ["want"],
    isRequired: true,
  },
  {
    id: "moment",
    displayName: "The Moment",
    purpose: "A specific memorable moment",
    primarySlot: "turn",
    bonusSlots: ["blocker"],
    isRequired: false,
  },
  {
    id: "details",
    displayName: "The Details",
    purpose: "Specific details that make it personal",
    primarySlot: "stakes",
    bonusSlots: [],
    isRequired: false,
  },
];

const REFLECTIVE_STORY_ELEMENT_DEFINITIONS = [
  {
    id: "setting",
    displayName: "The Setting",
    purpose: "Where and when the story takes place",
    primarySlot: "moment_destination",
    bonusSlots: [],
    isRequired: true,
  },
  {
    id: "feeling",
    displayName: "The Feeling",
    purpose: "The emotional core of the story",
    primarySlot: "ending_feel",
    bonusSlots: ["tone"],
    isRequired: true,
  },
  {
    id: "bond",
    displayName: "Your Bond",
    purpose: "What makes your relationship special",
    primarySlot: "who",
    bonusSlots: [],
    isRequired: true,
  },
  {
    id: "moment",
    displayName: "The Moment",
    purpose: "A specific memorable moment or season",
    primarySlot: "turn",
    bonusSlots: ["moment_destination"],
    isRequired: false,
  },
  {
    id: "details",
    displayName: "The Details",
    purpose: "Specific details that make it personal",
    primarySlot: "moment_destination",
    bonusSlots: ["turn"],
    isRequired: false,
  },
];

const ELEMENT_CONFIRM_THRESHOLD = 0.7;

function getStoryElementDefinitions(storyMode = "default") {
  return storyMode === "reflective_tribute"
    ? REFLECTIVE_STORY_ELEMENT_DEFINITIONS
    : STORY_ELEMENT_DEFINITIONS;
}

function getElementForSlot(storyMode = "default", slotId) {
  if (!slotId) return null;
  return (
    getStoryElementDefinitions(storyMode).find(
      (def) => def.primarySlot === slotId || def.bonusSlots.includes(slotId),
    ) || null
  );
}

function blendStrength(primaryStrength, bonusStrength, bonusWeight = 0.25) {
  return Math.max(
    primaryStrength,
    (1 - bonusWeight) * primaryStrength + bonusWeight * bonusStrength,
  );
}

function computeStoryElements(gapAnalysis) {
  // Labov branch: map Labov elements directly to the 5 display element IDs
  if (
    gapAnalysis?.readinessProfile === "labov" &&
    gapAnalysis?.labov?.elements
  ) {
    const labovByName = Object.fromEntries(
      gapAnalysis.labov.elements.map((e) => [e.element, e]),
    );
    const orientation = labovByName.orientation || { strength: 0 };
    const complicating = labovByName.complicating_action || { strength: 0 };
    const evaluation = labovByName.evaluation || { strength: 0 };
    const resolution = labovByName.resolution || { strength: 0 };
    const specificity = labovByName.specificity_bonus || { strength: 0 };

    const definitions = getStoryElementDefinitions(
      gapAnalysis.storyMode || "default",
    );
    return definitions.map((def) => {
      let strength = 0;
      if (def.id === "setting") {
        strength = orientation.strength;
      } else if (def.id === "feeling") {
        strength = evaluation.strength;
      } else if (def.id === "bond") {
        // Blend of orientation + complicating_action (relationship context)
        strength = blendStrength(
          orientation.strength,
          complicating.strength,
          0.3,
        );
      } else if (def.id === "moment") {
        // Blend complicating action with resolution (outcome enriches the moment)
        strength = blendStrength(
          complicating.strength,
          resolution.strength,
          0.25,
        );
      } else if (def.id === "details") {
        strength = specificity.strength;
      }
      return {
        id: def.id,
        display_name: def.displayName,
        purpose: def.purpose,
        strength: Number(clamp(strength).toFixed(2)),
        is_required: def.isRequired,
      };
    });
  }

  // Legacy branch: slot-based mapping
  const slotById = new Map((gapAnalysis.slots || []).map((s) => [s.slot, s]));
  const storyMode = gapAnalysis?.storyMode || "default";
  const elementSignals = gapAnalysis?.elementSignals || {};
  const definitions = getStoryElementDefinitions(storyMode);

  return definitions.map((def) => {
    const primaryConf = slotById.get(def.primarySlot)?.confidence || 0;
    let strength = primaryConf;
    if (def.bonusSlots.length > 0) {
      const bonusConf =
        def.bonusSlots.reduce(
          (sum, sid) => sum + (slotById.get(sid)?.confidence || 0),
          0,
        ) / def.bonusSlots.length;
      strength = blendStrength(primaryConf, bonusConf);
    }

    if (storyMode === "reflective_tribute") {
      if (def.id === "bond") {
        strength = Math.max(
          strength,
          blendStrength(
            primaryConf,
            elementSignals.relationshipDepth || 0,
            0.3,
          ),
        );
      } else if (def.id === "moment") {
        strength = Math.max(
          strength,
          elementSignals.reflectiveMomentStrength || 0,
        );
      } else if (def.id === "details") {
        strength = Math.max(strength, elementSignals.detailSpecificity || 0);
      }
    }
    return {
      id: def.id,
      display_name: def.displayName,
      purpose: def.purpose,
      strength: Number(clamp(strength).toFixed(2)),
      is_required: def.isRequired,
    };
  });
}

function getElementConfirmBlock(elements) {
  const blocked = elements.filter(
    (el) => el.is_required && el.strength < ELEMENT_CONFIRM_THRESHOLD,
  );
  return {
    hasElementBlock: blocked.length > 0,
    blockedElements: blocked.map((el) => el.id),
    weakestElement:
      blocked.length > 0
        ? blocked.reduce((a, b) => (a.strength < b.strength ? a : b))
        : null,
  };
}

/**
 * Check if story has all required beats covered
 * Supports both status (legacy) and strength (v3) schemas
 *
 * @param {Object} state - V3 state
 * @returns {boolean} True if all required beats are covered
 */
function isStoryComplete(state) {
  if (!state.beats || state.beats.length === 0) return false;

  const requiredBeats = state.beats.filter((b) => b.required);

  // Support both schemas: status === "covered" OR strength >= threshold
  const isCovered = (b) =>
    b.status === "covered" ||
    (typeof b.strength === "number" &&
      b.strength >= STRENGTH_THRESHOLDS.covered);

  return requiredBeats.every(isCovered);
}

/**
 * V3: Determine if should confirm - trusts LLM decision with safety bounds
 *
 * @param {Object} state - V3 state
 * @param {Object} llmDecision - LLM's decision { action, confidence }
 * @returns {{shouldConfirm: boolean, source: string, confidence?: number, reason?: string}}
 */
function shouldConfirmFromLLM(state, llmDecision) {
  // Safety bound: force confirm after max turns
  if (state.turn_count >= SAFETY_BOUNDS.maxTurns) {
    return {
      shouldConfirm: true,
      source: "safety_bound",
      reason: `Turn limit (${SAFETY_BOUNDS.maxTurns}) reached`,
    };
  }

  // Handle null/undefined LLM decision gracefully
  if (!llmDecision) {
    return {
      shouldConfirm: false,
      source: "error",
      reason: "No LLM decision provided",
    };
  }

  // Trust LLM decision
  const shouldConfirm =
    llmDecision.action === "CONFIRM" || llmDecision.action === "STOP";

  return {
    shouldConfirm,
    source: "llm",
    confidence: llmDecision.confidence,
  };
}

/**
 * V3: Get completion assessment from LLM reasoning
 *
 * Uses LLM's holistic story_readiness assessment, not beat counting formula.
 * The LLM evaluates emotional depth and identifies strong/weak elements.
 *
 * @param {Object} llmReasoning - LLM's reasoning output with story_readiness
 * @returns {Object} Completion assessment { hasEmotionalDepth, strongElements, weakElements, score }
 */
function getCompletionFromLLM(llmReasoning) {
  const readiness = llmReasoning?.story_readiness || {};

  // LLM's holistic assessment is primary
  const hasDepth = readiness.has_emotional_depth === true;
  const strongElements = readiness.strong_elements || [];
  const weakElements = readiness.weak_elements || [];
  const strongCount = strongElements.length;

  // Score based on LLM assessment, not formula
  // Priority: emotional depth > strong element count
  let score;
  if (hasDepth && strongCount >= 2) {
    // Great: has depth + multiple strong elements
    score = 80 + Math.min(20, strongCount * 5);
  } else if (hasDepth) {
    // Good: has depth, fewer strong elements
    score = 60 + Math.min(20, strongCount * 5);
  } else if (strongCount >= 2) {
    // Decent: strong elements but no emotional depth
    score = 40 + Math.min(20, strongCount * 5);
  } else {
    // Weak: little content
    score = Math.max(10, strongCount * 15);
  }

  return {
    hasEmotionalDepth: hasDepth,
    strongElements,
    weakElements,
    score: Math.min(100, score),
  };
}

/**
 * Check if minimum story elements are covered (FALLBACK)
 *
 * V3: This is a fallback heuristic for when LLM is unavailable.
 * Prefer getCompletionFromLLM() for holistic assessment.
 *
 * Supports both status (legacy) and strength (v3) schemas.
 * Minimum = scene + at least one of (stakes/turning_point) + meaning
 *
 * @param {Object} state - V3 state
 * @returns {boolean} True if minimum coverage met
 */
function hasMinimumCoverage(state) {
  if (!state.beats || state.beats.length === 0) return false;

  // Support both schemas: status-based OR strength-based
  const isCoveredOrWeak = (b) =>
    b.status === "covered" ||
    b.status === "weak" ||
    (typeof b.strength === "number" && b.strength >= STRENGTH_THRESHOLDS.weak);

  const covered = state.beats.filter(isCoveredOrWeak);
  const coveredIds = covered.map((b) => b.id);

  // Need at least 3 beats covered/weak
  if (covered.length < 3) return false;

  // Need meaning
  const hasMeaning = coveredIds.includes("meaning");
  if (!hasMeaning) return false;

  // Need some scene-like beat
  const sceneBeats = ["scene", "meeting", "discovery", "who", "relationship"];
  const hasScene = sceneBeats.some((id) => coveredIds.includes(id));

  // Need some turning point or stakes
  const pivotBeats = [
    "turning_point",
    "stakes",
    "moment",
    "impact",
    "struggle",
  ];
  const hasPivot = pivotBeats.some((id) => coveredIds.includes(id));

  return hasScene && hasPivot;
}

/**
 * Calculate completion score (0-100)
 *
 * Supports both status (legacy) and strength (v3) schemas.
 *
 * @param {Object} state - V3 state
 * @returns {number} Completion percentage
 */
function getCompletionScore(state) {
  if (!state.beats || state.beats.length === 0) return 0;

  const requiredBeats = state.beats.filter((b) => b.required);
  if (requiredBeats.length === 0) return 100;

  let score = 0;
  for (const beat of requiredBeats) {
    const strength = beat.strength;
    // Support both schemas: status-based OR strength-based
    if (
      beat.status === "covered" ||
      (typeof strength === "number" && strength >= STRENGTH_THRESHOLDS.covered)
    ) {
      score += 1;
    } else if (
      beat.status === "weak" ||
      (typeof strength === "number" && strength >= STRENGTH_THRESHOLDS.weak)
    ) {
      score += 0.5;
    }
  }

  return Math.round((score / requiredBeats.length) * 100);
}

/**
 * Get missing or weak required beats, sorted by priority
 *
 * Supports both status (legacy) and strength (v3) schemas.
 *
 * @param {Object} state - V3 state
 * @returns {Array} Array of beats that need attention
 */
function getMissingBeats(state) {
  if (!state.beats || state.beats.length === 0) return [];

  // Support both schemas: status-based OR strength-based
  const needsWork = (b) => {
    // Status-based: missing or weak
    if (b.status === "missing" || b.status === "weak") return true;
    // Strength-based: below covered threshold
    if (
      typeof b.strength === "number" &&
      b.strength < STRENGTH_THRESHOLDS.covered
    )
      return true;
    return false;
  };

  return state.beats
    .filter((b) => b.required && needsWork(b))
    .sort((a, b) => {
      // Sort by strength (lowest first) for strength-based beats
      const aStrength =
        typeof a.strength === "number"
          ? a.strength
          : a.status === "weak"
            ? 0.4
            : 0;
      const bStrength =
        typeof b.strength === "number"
          ? b.strength
          : b.status === "weak"
            ? 0.4
            : 0;
      return aStrength - bStrength;
    });
}

/**
 * V3: Get next beat to ask about - follows LLM's contextual assessment
 *
 * Uses the LLM's weak_elements order from story_readiness, not a hardcoded
 * priority array. The LLM understands story context and can prioritize
 * beats that make sense for this specific story.
 *
 * @param {Object} state - V3 state
 * @param {Object} llmReasoning - LLM's reasoning output with story_readiness
 * @returns {Object|null} Next beat to ask about, or null if all covered
 */
function getNextBeatFromLLM(state, llmReasoning) {
  const beats = state?.beats || [];
  if (beats.length === 0) return null;

  const weakElements = llmReasoning?.story_readiness?.weak_elements || [];

  // Helper to check if beat needs work
  const needsWork = (b) => {
    // Strength-based: needs work if below covered threshold
    if (typeof b.strength === "number")
      return b.strength < STRENGTH_THRESHOLDS.covered;
    // Status-based: needs work if not covered
    return b.status !== "covered";
  };

  // If LLM specified weak elements, follow that order
  if (weakElements.length > 0) {
    for (const weakId of weakElements) {
      const beat = beats.find((b) => b.id === weakId);
      if (beat && needsWork(beat)) {
        return beat;
      }
    }
  }

  // Fallback: pick required beat with lowest strength
  const uncovered = beats.filter((b) => b.required !== false && needsWork(b));

  if (uncovered.length === 0) return null;

  // Sort by strength (lowest first), defaulting to 0 for status-based
  uncovered.sort((a, b) => {
    const aStrength =
      typeof a.strength === "number"
        ? a.strength
        : a.status === "weak"
          ? 0.4
          : 0;
    const bStrength =
      typeof b.strength === "number"
        ? b.strength
        : b.status === "weak"
          ? 0.4
          : 0;
    return aStrength - bStrength;
  });

  return uncovered[0];
}

/**
 * Get the most important beat to ask about next (FALLBACK)
 *
 * V3: This is a fallback heuristic for when LLM is unavailable.
 * Prefer getNextBeatFromLLM() for contextual assessment.
 *
 * Prioritizes emotionally important beats first:
 * 1. Turning point / pivotal moment
 * 2. Meaning (core to the song)
 * 3. Scene / foundation
 * 4. Stakes / tension
 *
 * @param {Object} state - V3 state
 * @returns {Object|null} Next beat to ask about, or null if none
 */
function getNextBeatToAsk(state) {
  const missing = getMissingBeats(state);
  if (missing.length === 0) return null;

  // Sort by explicit fallback priority (defined at module level)
  missing.sort((a, b) => {
    const aIndex = BEAT_FALLBACK_PRIORITY.indexOf(a.id);
    const bIndex = BEAT_FALLBACK_PRIORITY.indexOf(b.id);
    const aPriority = aIndex === -1 ? 999 : aIndex;
    const bPriority = bIndex === -1 ? 999 : bIndex;
    return aPriority - bPriority;
  });

  return missing[0];
}

// ─── Story-Specific Suggestions ───────────────────────────────────
// Extracts key phrases from the user's story and builds tappable
// suggestion chips. Replaces LLM-generated generic suggestions.

const ACTIVITY_REGEX =
  /\b(fishing|dancing|cooking|singing|playing|running|swimming|hiking|traveling|camping|gardening|painting|reading|driving|walking|baking|shopping|working|studying|celebrating|laughing|crying)\b/i;
const NAMED_ITEM_REGEX =
  /(?:["']([^"']{3,30})["']|(?:called|named|song|movie|book|place)\s+(\w[\w\s]{2,25}))/i;

/**
 * Generate 3 suggestion chips specific to THIS user's story.
 * Deterministic — no LLM calls. Extracts details from conversation
 * and builds short, tappable prompts from them.
 *
 * @param {Object} state - Story state with facts, conversation, atoms
 * @param {string} userMessage - The user's latest message
 * @returns {string[]} 3 story-specific suggestion chips (max 8 words each)
 */
function generateStorySpecificSuggestions(state, userMessage) {
  const suggestions = [];
  const text = userMessage || "";
  const recipient = state?.atoms?.who || state?.recipient_name || "them";
  const firstName = recipient.split(/\s/)[0];

  // 1. Extract proper nouns (capitalized words, not sentence starters)
  const words = text.split(/\s+/);
  const properNouns = [];
  // Start at i=0: a name at the sentence start ("Sarah showed up...") is a real
  // proper noun. The stopword regex below already filters sentence-starters like
  // "My"/"The", so the prior i=1 skip only dropped legitimate leading names.
  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[^a-zA-Z']/g, "");
    // Title-case only (capital + lowercase): real names like "Sarah", not
    // all-caps acknowledgements/acronyms ("OK", "USA") or the pronoun "I".
    if (
      w.length >= 2 &&
      /^[A-Z][a-z]/.test(w) &&
      !/^(The|And|But|For|With|This|That|She|Her|His|He|They|Our|My|We|It|In|On|At|Is|Was|Are|Were|Did|Has|Had|Do|Every|Yet|You|When|After|Before|Because|From|Into)$/.test(
        w,
      )
    ) {
      properNouns.push(w);
    }
  }

  // 2. Extract activities/events
  const activities = [
    ...text.matchAll(new RegExp(ACTIVITY_REGEX.source, "gi")),
  ].map((m) => m[1].toLowerCase());

  // 3. Extract named items (quoted phrases, named things)
  const namedItems = [
    ...text.matchAll(new RegExp(NAMED_ITEM_REGEX.source, "gi")),
  ].map((m) => (m[1] || m[2]).trim());

  // 4. Extract time/place references
  const timePlace = [];
  const tpMatch = text.match(
    /\b(every\s+\w+|Saturday|Sunday|summer|winter|morning|evening|night|college|school|hospital|park|kitchen|home|church|beach)\b/gi,
  );
  if (tpMatch) timePlace.push(...tpMatch.map((s) => s.toLowerCase()));

  // 5. Build suggestions from extracted details
  // Priority: specific moments > activities > time/place > fallback

  // Suggestion type A: "What [recipient] said/did during [activity]"
  if (activities.length > 0) {
    suggestions.push("What " + firstName + " said while " + activities[0]);
  }

  // Suggestion type B: "The [time/place] that stands out most"
  if (timePlace.length > 0) {
    suggestions.push("The " + timePlace[0] + " that stands out most");
  }

  // Suggestion type C: "How [specific detail] made you feel"
  // Reference any named person/thing they mentioned other than the recipient —
  // even a single one. Echoing the recipient back ("How <recipient> changed
  // things") is covered by types D/F, so exclude their own name here.
  const otherNouns = properNouns.filter(
    (n) => n.toLowerCase() !== firstName.toLowerCase(),
  );
  if (otherNouns.length > 0) {
    suggestions.push(
      "How " + otherNouns[otherNouns.length - 1] + " changed things",
    );
  } else if (namedItems.length > 0) {
    suggestions.push("The story behind " + namedItems[0]);
  }

  // Suggestion type D: "A moment only you two share"
  if (suggestions.length < 3) {
    suggestions.push("A moment only you and " + firstName + " share");
  }

  // Suggestion type E: Activity-based
  if (suggestions.length < 3 && activities.length > 1) {
    suggestions.push(
      "The best " + activities[activities.length - 1] + " memory",
    );
  }

  // Suggestion type F: Emotional prompt
  if (suggestions.length < 3) {
    suggestions.push("What you wish " + firstName + " knew");
  }

  // 6. Trim to exactly 3, max 8 words each
  const result = suggestions.slice(0, 3).map((s) => {
    const words = s.split(/\s+/);
    return words.length > 8 ? words.slice(0, 8).join(" ") : s;
  });

  // 7. If still < 3, fill with occasion-aware fallbacks
  const occasion = state?.event?.occasion || state?.occasion || "birthday";
  const OCCASION_FALLBACKS = {
    birthday: [
      "A birthday tradition you share",
      "Their funniest birthday moment",
      "What makes " + firstName + " special",
    ],
    anniversary: [
      "Your first date memory",
      "A challenge you overcame together",
      "What keeps your love strong",
    ],
    memorial: [
      "A lesson they taught you",
      "Their favorite saying",
      "A sound that reminds you of them",
    ],
    bereavement: [
      "What you miss most",
      "Their kindest moment",
      "How they showed love",
    ],
    thank_you: [
      "The moment you knew",
      "What they sacrificed",
      "How they changed your path",
    ],
    mothers_day: [
      "A sacrifice she made",
      "Her signature meal or habit",
      "What she said that stuck",
    ],
    fathers_day: [
      "A lesson he repeated",
      "His proudest moment of you",
      "What he'd never say aloud",
    ],
    friendship: [
      "An inside joke between you",
      "When they had your back",
      "What makes them irreplaceable",
    ],
  };
  const fallbacks = OCCASION_FALLBACKS[occasion] || OCCASION_FALLBACKS.birthday;
  while (result.length < 3) {
    result.push(fallbacks[result.length] || "A detail only you know");
  }

  return result;
}

module.exports = {
  SAFETY_BOUNDS,
  STRENGTH_THRESHOLDS,
  STORY_SLOT_PRIORITY,
  STORY_SLOT_WEIGHTS,
  CRITICAL_CONFIRM_SLOT_IDS,
  SLOT_TO_LABOV_ELEMENT,
  getSlotLabovElement,
  SLOT_TO_ELEMENT_FALLBACK,
  SLOT_GUIDANCE_TEMPLATES,
  BEAT_FALLBACK_PRIORITY,
  findHighestPriorityGap,
  getSlotGuidance,
  POEM_GAP_QUESTIONS,
  buildPoemGapQuestion,
  isStoryComplete,
  shouldConfirmFromLLM,
  getCompletionFromLLM,
  hasMinimumCoverage,
  getCompletionScore,
  getMissingBeats,
  getNextBeatFromLLM,
  getNextBeatToAsk,
  evaluatePoemReadiness,
  computeStoryGapAnalysis,
  pickDeterministicGapQuestion,
  getCriticalConfirmSlotCoverage,
  STORY_ELEMENT_DEFINITIONS,
  REFLECTIVE_STORY_ELEMENT_DEFINITIONS,
  ELEMENT_CONFIRM_THRESHOLD,
  getStoryElementDefinitions,
  getElementForSlot,
  computeStoryElements,
  getElementConfirmBlock,
  computeLabovGapAnalysis,
  computeQuestionPriority,
  getQuestionStage,
  detectEmotionalIntensity,
  generateTargetedFallbackQuestion,
  validateQuestionRelevance,
  generateStorySpecificSuggestions,
  // Regex constants (used by extractStoryState for Labov classification)
  RELATIONSHIP_HINT_REGEX,
  TURN_REGEX,
  TURN_CRISIS_REGEX,
  TURN_TRANSFORMATION_REGEX,
  ENDING_FEEL_REGEX,
  APPRECIATION_REGEX,
  WANT_REGEX,
  BLOCKER_REGEX,
  STAKES_REGEX,
  // Labov-specific regex (used by extractStoryState for classification)
  EVALUATION_REGEX,
  SENSORY_REGEX,
  PAST_ACTION_REGEX,
  DEDICATION_REGEX,
  ORIENTATION_REGEX,
  COMPLICATING_REGEX,
  RESOLUTION_REGEX,
};
