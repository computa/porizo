/**
 * V3 Quality Checks
 *
 * V3 Update: Trust LLM decisions. Harness only provides safety bounds.
 * No fatigue threshold overrides. Content-based fallback heuristics.
 *
 * @module writer/v3/quality
 */

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
 * Canonical deterministic slot priority for gap-driven questioning.
 * Lower index = higher question priority.
 */
const STORY_SLOT_PRIORITY = [
  "moment_destination",
  "who",
  "want",
  "blocker",
  "stakes",
  "turn",
  "ending_feel",
  "tone",
];

const REFLECTIVE_SLOT_PRIORITY = [
  "moment_destination",
  "who",
  "turn",
  "ending_feel",
  "tone",
  "want",
  "stakes",
  "blocker",
];

const STORY_SLOT_WEIGHTS = {
  moment_destination: 1.0,
  who: 1.0,
  want: 1.0,
  blocker: 1.2,
  stakes: 1.2,
  turn: 1.0,
  ending_feel: 0.8,
  tone: 0.6,
};

const REFLECTIVE_SLOT_WEIGHTS = {
  ...STORY_SLOT_WEIGHTS,
  want: 0.7,
  blocker: 0.35,
  stakes: 0.35,
  turn: 1.1,
  ending_feel: 1.0,
};

/**
 * Slots that MUST be covered before the engine can confirm completion.
 * Keep this set small to avoid over-constraining the flow.
 */
const CRITICAL_CONFIRM_SLOT_IDS = ["moment_destination", "ending_feel"];

/**
 * Reverse mapping: slot name → Labov element.
 * Used for element-level comparison when Labov scoring is active,
 * since the LLM returns slot names but the gap analysis targets Labov elements.
 * Matches the spec mapping in docs/story-guidance-algo-plan.md line 26-33.
 */
const SLOT_TO_LABOV_ELEMENT = {
  moment_destination: "orientation",
  who: "orientation",
  setting: "orientation",
  blocker: "complicating_action",
  stakes: "complicating_action",
  moment: "complicating_action",
  want: "evaluation",
  ending_feel: "evaluation",
  bond: "evaluation",
  feeling: "evaluation",
  turn: "resolution",
  tone: "specificity",
};

function getSlotLabovElement(slot) {
  return SLOT_TO_LABOV_ELEMENT[slot] || null;
}

const SLOT_GUIDANCE_TEMPLATES = {
  moment_destination: {
    weak: {
      instruction: "Your setting/moment is close, but still too vague.",
      answerTemplate:
        "In [place], during [time], [person] [specific action/event] that changed things",
      examples: [
        "In Aarhus, during the winter exams, Osita worked night shifts and still funded his siblings' tuition.",
        "At our kitchen table on Sunday night, Dad quietly decided to sell his car so we could stay in school.",
      ],
    },
    missing: {
      instruction:
        "Add one concrete scene with place, time, and what happened.",
      answerTemplate:
        "In [place], during [time], [person] [specific action/event] that changed things",
      examples: [
        "In Lagos, during the flood season, Mum carried us across water to get to class.",
        "At the airport in December, she hugged me and said we were starting over together.",
      ],
    },
  },
  stakes: {
    weak: {
      instruction: "State what could have been lost if this failed.",
      answerTemplate:
        "If this failed, [person] would have lost [specific consequence]",
      examples: [
        "If this failed, he would have lost his visa and the chance to support his parents.",
      ],
    },
    missing: {
      instruction: "Add one explicit consequence.",
      answerTemplate:
        "If this failed, [person] would have lost [specific consequence]",
      examples: [
        "If this failed, we would have lost our home and my younger brother's schooling.",
      ],
    },
  },
  who: {
    weak: {
      instruction:
        "Clarify their role and what makes them important to the story.",
      answerTemplate:
        "[Name] is my [relationship] — they [defining trait or action]",
      examples: [
        "Osita is my older brother — he always stepped up when our parents couldn't.",
      ],
    },
    missing: {
      instruction: "Name the person and their relationship to you.",
      answerTemplate:
        "[Name] is my [relationship] — they [defining trait or action]",
      examples: [
        "My grandmother Nkechi raised me after my parents moved abroad for work.",
        "Tunde is my best friend since secondary school — we survived everything together.",
      ],
    },
  },
  want: {
    weak: {
      instruction:
        "Make the desire more specific — what exactly did they hope for?",
      answerTemplate: "[Person] wanted [specific desire] because [reason]",
      examples: ["She wanted to hear him say he was proud of her, just once."],
    },
    missing: {
      instruction: "State what the person wanted most in this moment.",
      answerTemplate: "[Person] wanted [specific desire] because [reason]",
      examples: [
        "He wanted to prove he could provide for his family without asking anyone for help.",
        "I wanted her to know I hadn't forgotten everything she sacrificed.",
      ],
    },
  },
  blocker: {
    weak: {
      instruction:
        "Make the obstacle more concrete — what specifically stood in the way?",
      answerTemplate:
        "The problem was [specific obstacle] which meant [consequence]",
      examples: [
        "The distance between us had grown into years of silence neither of us knew how to break.",
      ],
    },
    missing: {
      instruction: "Name the main thing standing in the way.",
      answerTemplate:
        "The problem was [specific obstacle] which meant [consequence]",
      examples: [
        "He was too proud to ask for help, even when the bills were piling up.",
        "We hadn't spoken in three years after the argument at Christmas.",
      ],
    },
  },
  turn: {
    weak: {
      instruction:
        "Pinpoint the exact moment things shifted — what happened right then?",
      answerTemplate:
        "Then [specific event] happened, and after that [what changed]",
      examples: [
        "Then she called from the hospital parking lot, and after that we couldn't pretend anymore.",
      ],
    },
    missing: {
      instruction: "Describe the moment that changed everything.",
      answerTemplate:
        "Then [specific event] happened, and after that [what changed]",
      examples: [
        "He showed up at my graduation even though he said he wouldn't come.",
        "She handed me the letter she'd been carrying for months but never sent.",
      ],
    },
  },
  ending_feel: {
    weak: {
      instruction:
        "Be more specific about the feeling — what emotion should linger?",
      answerTemplate:
        "The listener should feel [specific emotion] because [reason]",
      examples: [
        "The listener should feel quietly proud, like witnessing someone finally get what they deserved.",
      ],
    },
    missing: {
      instruction: "Describe how the story should leave the listener feeling.",
      answerTemplate:
        "The listener should feel [specific emotion] because [reason]",
      examples: [
        "It should feel bittersweet — happy we reconnected but aware of the time we lost.",
        "It should feel hopeful, like the hard part is over and something good is starting.",
      ],
    },
  },
  tone: {
    weak: {
      instruction:
        "Refine the tone — is it more warm, raw, playful, or cinematic?",
      answerTemplate:
        "The tone should be [adjective] — like [comparison or feeling]",
      examples: [
        "The tone should be gentle and warm — like a late-night conversation between old friends.",
      ],
    },
    missing: {
      instruction: "Describe the overall feeling and style of the story.",
      answerTemplate:
        "The tone should be [adjective] — like [comparison or feeling]",
      examples: [
        "Keep it real and a little raw — no sugar-coating, just honest.",
        "Make it cinematic, like a movie scene you can't stop thinking about.",
      ],
    },
  },
};

// Maps slots to their parent display element for fallback prompts.
// Used only when the LLM fails to generate a contextual question.
// These are soft, open-ended prompts tied to the 5-element UI the user sees.
const SLOT_TO_ELEMENT_FALLBACK = {
  moment_destination: {
    element: "The Setting",
    prompt: "Tell me more about where and when this takes place.",
  },
  who: {
    element: "Your Bond",
    prompt: "Tell me more about what makes your relationship special.",
  },
  want: {
    element: "Your Bond",
    prompt: "What did they want most in that moment?",
  },
  blocker: {
    element: "The Moment",
    prompt: "Was there anything that made this harder?",
  },
  stakes: {
    element: "The Details",
    prompt: "What would it have meant if things went differently?",
  },
  turn: {
    element: "The Moment",
    prompt: "What happened in that moment, and what changed after it?",
  },
  ending_feel: {
    element: "The Feeling",
    prompt: "How do you want someone to feel hearing this?",
  },
  tone: {
    element: "The Feeling",
    prompt: "What kind of mood fits this story?",
  },
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

// --- Labov-specific regex patterns ---
const EVALUATION_REGEX =
  /\b(felt|feel|feeling|meant|means|made me|changed|realize[d]?|understood|grateful|loved|special|important|connected)\b/i;
const SENSORY_REGEX =
  /\b(smell[s]?|taste[d]?|sound[s]?|hear[d]?|saw|see|touch|warm|cold|bright|dark|loud|quiet|sweet|bitter)\b/i;
const PAST_ACTION_REGEX =
  /\b(went|came|ran|walked|drove|called|said|told|gave|took|brought|showed|made|played|danced|laughed|cried|sang|cooked)\b/i;
const DEDICATION_REGEX =
  /\b(happy birthday|for you|on your|this is for|here'?s to|celebrating|wishing|this mother'?s? day|this father'?s? day|this anniversary|i want you to know|i see you|i appreciate you|thank you for|you deserve|you mean)\b/i;

const TRIBUTE_OCCASION_REGEX =
  /\b(memorial|bereavement|tribute|thank[_\s-]?you|in[_\s-]?memory)\b/i;

// Labov element classification regexes (shared with extractStoryState in index.js)
const ORIENTATION_REGEX =
  /\b(met|lived|grew up|moved to|born|raised|since|college|school|park|kitchen|airport|home|house|summer|winter|year|day|night|morning|childhood)\b/i;
const COMPLICATING_REGEX =
  /\b(changed|suddenly|then|happened|showed up|found out|realized|broke|left|lost|arrived|called|ran|fell|crashed|woke|fought|discovered|everything changed)\b/i;
const RESOLUTION_REGEX =
  /\b(now|today|since then|from that day|looking back|still|always will|never forgot|became|forgave|healed|stronger|better)\b/i;

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

/**
 * Find highest-priority uncovered slot from missing/weak lists.
 * Shared by buildGapTargeting (prompt builder) and pickDeterministicGapQuestion.
 */
function findHighestPriorityGap(
  missingSlots,
  weakSlots,
  priorityOrder = STORY_SLOT_PRIORITY,
) {
  return (
    priorityOrder.find((s) => missingSlots.includes(s)) ||
    priorityOrder.find((s) => weakSlots.includes(s)) ||
    null
  );
}

function getSlotGuidance(slotId, slotState) {
  const template = SLOT_GUIDANCE_TEMPLATES[slotId];
  if (!template) return null;
  const variant = template[slotState] || template.weak || template.missing;
  if (!variant) return null;
  return {
    slot: slotId,
    state: slotState,
    instruction: variant.instruction,
    answerTemplate: variant.answerTemplate,
    examples: Array.isArray(variant.examples)
      ? variant.examples.slice(0, 3)
      : [],
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

function sortByPriority(slots, priorityOrder = STORY_SLOT_PRIORITY) {
  const slotSet = new Set(slots);
  return priorityOrder.filter((slot) => slotSet.has(slot));
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
 * Pick a deterministic next question from gap analysis.
 *
 * @param {Object} gapAnalysis - Output from computeStoryGapAnalysis
 * @param {Object} state - Current story state
 * @returns {{
 *   targetSlot: string,
 *   prompt: string,
 *   inputMode: string,
 *   reason: string,
 *   slotGuidance: object
 * }|null}
 */
function pickDeterministicGapQuestion(gapAnalysis) {
  if (!gapAnalysis || typeof gapAnalysis !== "object") return null;

  const missingSlots = Array.isArray(gapAnalysis.missingSlots)
    ? gapAnalysis.missingSlots
    : [];
  const weakSlots = Array.isArray(gapAnalysis.weakSlots)
    ? gapAnalysis.weakSlots
    : [];
  const storyMode = gapAnalysis.storyMode || "default";
  const priorityOrder =
    storyMode === "reflective_tribute"
      ? REFLECTIVE_SLOT_PRIORITY
      : STORY_SLOT_PRIORITY;

  let targetSlot = findHighestPriorityGap(
    missingSlots,
    weakSlots,
    priorityOrder,
  );
  if (
    storyMode === "reflective_tribute" &&
    (targetSlot === "blocker" || targetSlot === "stakes")
  ) {
    const alternateMissing = missingSlots.filter(
      (slot) => slot !== "blocker" && slot !== "stakes",
    );
    const alternateWeak = weakSlots.filter(
      (slot) => slot !== "blocker" && slot !== "stakes",
    );
    targetSlot =
      findHighestPriorityGap(alternateMissing, alternateWeak, priorityOrder) ||
      targetSlot;
  }
  if (!targetSlot) return null;

  const fallback = SLOT_TO_ELEMENT_FALLBACK[targetSlot];
  if (!fallback) return null;

  const slotDetails = Array.isArray(gapAnalysis.slots)
    ? gapAnalysis.slots.find((slot) => slot.slot === targetSlot)
    : null;
  const slotState =
    slotDetails?.status ||
    (missingSlots.includes(targetSlot) ? "missing" : "weak");
  const slotGuidance = getSlotGuidance(targetSlot, slotState);
  let prompt = fallback.prompt;

  if (storyMode === "reflective_tribute") {
    if (targetSlot === "blocker") {
      prompt =
        "Was there a season or challenge that revealed their strength more clearly?";
    } else if (targetSlot === "stakes") {
      prompt = "What did their care or sacrifice mean for you or your family?";
    }
  }

  return {
    targetSlot,
    prompt,
    inputMode: "freeform",
    reason:
      slotDetails?.reason ||
      `${slotState === "missing" ? "Missing" : "Weak"} ${targetSlot} details.`,
    slotGuidance,
  };
}

function getCriticalConfirmSlotCoverage(gapAnalysis) {
  if (!gapAnalysis || typeof gapAnalysis !== "object") {
    return { hasBlockingGap: false, blockingSlots: [] };
  }

  // Labov-aware: check core trio element strength directly
  if (gapAnalysis.labov) {
    const { orientation, complicating_action, evaluation } = gapAnalysis.labov;
    const blocking = [];
    if ((orientation?.strength || 0) < 0.5) blocking.push("orientation");
    if ((complicating_action?.strength || 0) < 0.5)
      blocking.push("complicating_action");
    if ((evaluation?.strength || 0) < 0.5) blocking.push("evaluation");
    return { hasBlockingGap: blocking.length > 0, blockingSlots: blocking };
  }

  const slots = Array.isArray(gapAnalysis.slots) ? gapAnalysis.slots : [];
  const slotMap = new Map(slots.map((slot) => [slot.slot, slot.status]));

  const blockingSlots = CRITICAL_CONFIRM_SLOT_IDS.filter((slotId) => {
    const status = slotMap.get(slotId);
    return status !== "covered";
  });

  return {
    hasBlockingGap: blockingSlots.length > 0,
    blockingSlots,
  };
}

/**
 * Poem readiness gap questions
 */
const POEM_GAP_QUESTION_DEFAULTS = {
  narrative:
    "Could you share the story in one clear paragraph so I can write the poem from it?",
  who: "Who is this about, and what’s your relationship to them?",
  turn: "Think of one specific scene: what did they do, say, or reveal that made this matter so much to you?",
  context: "Where and when did this happen?",
  emotion: "What feeling was strongest in that moment?",
};

function firstNonEmptyString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function normalizePoemPlaceCandidate(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/[.,;:!?]+$/, "");
  if (!trimmed) return "";

  if (
    /\b(?:was|were|is|are|became|worked as|work as)\b/i.test(trimmed) &&
    /\b(teacher|nurse|doctor|engineer|student|mentor|boss|manager|parent|mother|father|friend|partner|wife|husband|coach)\b/i.test(
      trimmed,
    )
  ) {
    return "";
  }

  if (
    trimmed.split(/\s+/).length > 8 &&
    !/\b(beach|cafe|park|garden|church|hospital|airport|station|kitchen|porch|classroom|campus|school|room|table|home|house|city|town|village)\b/i.test(
      trimmed,
    )
  ) {
    return "";
  }

  return trimmed;
}

function extractLikelyPlaceFromFactTexts(factTexts) {
  const locationMatch = factTexts
    .map((text) => {
      const match = text.match(
        /\b(?:at|in|inside|outside|near|by|on)\s+((?:the\s+)?(?:beach|cafe|park|garden|church|hospital|airport|station|kitchen|porch|classroom|campus|school|room|table|home))\b/i,
      );
      return match ? normalizePoemPlaceCandidate(match[1]) : "";
    })
    .find(Boolean);

  return locationMatch || "";
}

function extractPoemGuidanceContext(state) {
  const atoms = state?.atoms || {};
  const primitives = state?.primitives || {};
  const facts = Array.isArray(state?.facts) ? state.facts : [];
  const activeFacts = facts.filter(
    (fact) => fact && fact.status !== "superseded",
  );
  const factTexts = activeFacts
    .map((fact) => (typeof fact.text === "string" ? fact.text.trim() : ""))
    .filter(Boolean);

  const recipientName = firstNonEmptyString([
    state?.recipientName,
    state?.recipient_name,
  ]);
  const relationship = firstNonEmptyString([
    atoms.relationship,
    primitives.relationship,
  ]);
  const place = firstNonEmptyString([
    normalizePoemPlaceCandidate(atoms.where),
    normalizePoemPlaceCandidate(primitives.setting?.place),
    extractLikelyPlaceFromFactTexts(factTexts),
  ]);
  const time = firstNonEmptyString([
    atoms.when,
    primitives.setting?.time,
    factTexts.find((text) =>
      /last year|birthday|anniversary|graduation|wedding|sunset|night|morning|summer/i.test(
        text,
      ),
    ),
  ]);
  const turningDetail = firstNonEmptyString([
    atoms.turn,
    primitives.turning_point,
    factTexts.find((text) =>
      /note|letter|speech|hug|look|said|gift|surprise|toast|call/i.test(text),
    ),
  ]);
  const emotionalCue = firstNonEmptyString([
    atoms.feeling,
    primitives.feeling,
    factTexts.find((text) =>
      /warm|grateful|seen|loved|proud|safe|quietly magical|overwhelmed|relieved/i.test(
        text,
      ),
    ),
  ]);

  return {
    recipientName,
    relationship,
    place,
    time,
    turningDetail,
    emotionalCue,
  };
}

function buildPoemGapQuestion(state, gapId) {
  const context = extractPoemGuidanceContext(state);
  const recipient = context.recipientName || "them";

  switch (gapId) {
    case "who":
      if (context.relationship) {
        return `You’ve already shown what ${recipient} did. What should the poem understand about your relationship to ${recipient} so it knows why this matters so much?`;
      }
      return `Who is ${recipient} to you — friend, partner, sibling, parent, mentor — and what makes that bond special?`;
    case "turn":
      if (context.place && context.turningDetail) {
        return `At ${context.place}, what happened around ${context.turningDetail} that made the moment land so deeply for you?`;
      }
      if (context.place) {
        return `At ${context.place}, what was the exact moment that made this feel bigger than an ordinary memory?`;
      }
      if (context.turningDetail) {
        return `When ${context.turningDetail} happened, what changed for you emotionally in that instant?`;
      }
      return POEM_GAP_QUESTION_DEFAULTS.turn;
    case "context":
      if (context.place && !context.time) {
        return `I can picture ${context.place}. When was this happening — last year, on your birthday, or another specific moment in time?`;
      }
      if (context.time && !context.place) {
        return `I know this happened ${context.time}. Where were you when it happened?`;
      }
      if (context.place || context.time) {
        const joined = [context.time, context.place]
          .filter(Boolean)
          .join(" at ");
        return `I have part of the setting (${joined}). What missing time-or-place detail would help someone picture it clearly?`;
      }
      return POEM_GAP_QUESTION_DEFAULTS.context;
    case "emotion":
      if (context.turningDetail) {
        return `When ${context.turningDetail} happened, what feeling hit you hardest — gratitude, surprise, being seen, something else?`;
      }
      if (context.emotionalCue) {
        return `You’ve described the moment as ${context.emotionalCue}. What feeling underneath that do you most want the poem to hold onto?`;
      }
      return POEM_GAP_QUESTION_DEFAULTS.emotion;
    case "narrative":
      if (context.recipientName || context.place || context.time) {
        const parts = [context.time, context.place]
          .filter(Boolean)
          .join(" at ");
        const framing = [
          context.recipientName ? `with ${context.recipientName}` : "",
          parts,
        ]
          .filter(Boolean)
          .join(" ");
        return `Tell me the story in one clean paragraph${framing ? ` about what happened ${framing}` : ""}, so the poem can follow it from beginning to feeling.`;
      }
      return POEM_GAP_QUESTION_DEFAULTS.narrative;
    default:
      return (
        POEM_GAP_QUESTION_DEFAULTS[gapId] ||
        POEM_GAP_QUESTION_DEFAULTS.narrative
      );
  }
}

/**
 * Evaluate story readiness for poem generation
 *
 * Ensures confirmed stories have no critical gaps before poem writing.
 *
 * @param {Object} state - Story context or V3 state
 * @returns {{is_complete: boolean, gaps: Array, suggested_question: string|null}}
 */
function evaluatePoemReadiness(state) {
  const gaps = [];
  const atoms = state?.atoms || {};
  const primitives = state?.primitives || {};
  const narrative = (state?.narrative || state?.summary?.text || "").trim();

  if (!narrative) {
    gaps.push({ id: "narrative", label: "Narrative missing" });
  }

  const hasWho =
    (typeof atoms.who === "string" && atoms.who.trim().length > 0) ||
    (Array.isArray(primitives.characters) && primitives.characters.length > 0);
  if (!hasWho) {
    gaps.push({ id: "who", label: "People or relationship missing" });
  }

  const hasTurn =
    (typeof atoms.turn === "string" && atoms.turn.trim().length > 0) ||
    (typeof primitives.turning_point === "string" &&
      primitives.turning_point.trim().length > 0);
  if (!hasTurn) {
    gaps.push({ id: "turn", label: "Turning point missing" });
  }

  const hasContext =
    (typeof atoms.where === "string" && atoms.where.trim().length > 0) ||
    (typeof atoms.when === "string" && atoms.when.trim().length > 0) ||
    (typeof primitives.setting?.place === "string" &&
      primitives.setting.place.trim().length > 0) ||
    (typeof primitives.setting?.time === "string" &&
      primitives.setting.time.trim().length > 0);
  if (!hasContext) {
    gaps.push({ id: "context", label: "Time or place missing" });
  }

  const hasEmotionalDepth =
    state?.last_reasoning?.story_readiness?.has_emotional_depth;
  if (hasEmotionalDepth === false) {
    gaps.push({ id: "emotion", label: "Emotional arc is thin" });
  }

  const suggested =
    gaps.length > 0 ? buildPoemGapQuestion(state, gaps[0].id) : null;

  return {
    is_complete: gaps.length === 0,
    gaps,
    suggested_question: suggested,
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

// ---------------------------------------------------------------------------
// Labov 6-Element Gap Analysis
// ---------------------------------------------------------------------------

/**
 * Default Labov element weights.
 * These sum to 1.0 and express relative importance of each narrative element.
 */
const LABOV_DEFAULT_WEIGHTS = {
  orientation: 0.2,
  complicating_action: 0.25,
  evaluation: 0.35,
  resolution: 0.1,
  coda: 0.05,
  specificity_bonus: 0.05,
};

/**
 * Occasion patterns that trigger tribute/memorial weight adjustment:
 * de-weight resolution (0.10 -> 0.05), add to evaluation (0.35 -> 0.40).
 */
function isTributeOccasion(occasion) {
  if (!occasion) return false;
  const normalized = normalizeOccasion(occasion);
  return (
    TRIBUTE_OCCASION_REGEX.test(normalized) ||
    normalized === "thank-you" ||
    normalized === "thank_you"
  );
}

/**
 * Classify a Labov element strength into status.
 * Follows the same thresholds as the legacy system for consistency.
 */
function labovStatus(strength) {
  if (strength >= STRENGTH_THRESHOLDS.covered) return "covered";
  if (strength >= STRENGTH_THRESHOLDS.weak) return "weak";
  return "missing";
}

// --- Individual Labov element evaluators ---

function evaluateLabovOrientation(state, corpus) {
  const atoms = state?.atoms || {};
  const hasWho = hasText(atoms.who);
  const hasWhere = hasText(atoms.where);
  const hasWhen = hasText(atoms.when);
  const hasRelationship = RELATIONSHIP_HINT_REGEX.test(corpus);
  const hasSettingPrimitive =
    hasText(state?.primitives?.setting?.place) ||
    hasText(state?.primitives?.setting?.time);
  const evidence = [];

  let strength = 0;
  if (hasWho) {
    strength += 0.35;
    evidence.push(atoms.who);
  }
  if (hasWhere || hasSettingPrimitive) {
    strength += 0.25;
    evidence.push(atoms.where || state?.primitives?.setting?.place || "");
  }
  if (hasWhen) {
    strength += 0.15;
    evidence.push(atoms.when);
  }
  if (hasRelationship) {
    strength += 0.25;
    evidence.push("relationship hint in corpus");
  }

  strength = clamp(strength);
  return {
    element: "orientation",
    strength,
    status: labovStatus(strength),
    evidence: evidence.filter(hasText),
  };
}

function evaluateLabovComplicatingAction(state, corpus) {
  const primitives = state?.primitives || {};
  const atoms = state?.atoms || {};
  const hasConflict =
    hasText(primitives.conflict?.internal) ||
    hasText(primitives.conflict?.external);
  const hasPastAction = PAST_ACTION_REGEX.test(corpus);
  const hasBlockerSignal = BLOCKER_REGEX.test(corpus);
  const hasCrisisSignal = TURN_CRISIS_REGEX.test(corpus);
  const hasStakesSignal =
    STAKES_REGEX.test(corpus) || STAKES_WEAK_REGEX.test(corpus);
  const hasAction = hasText(atoms.action);
  const hasIncitingIncident = hasText(primitives.inciting_incident);
  const evidence = [];

  let strength = 0;
  if (hasConflict) {
    strength += 0.35;
    evidence.push(
      primitives.conflict?.internal || primitives.conflict?.external || "",
    );
  }
  if (hasPastAction) {
    strength += 0.2;
    evidence.push("past-tense action verbs in corpus");
  }
  if (hasBlockerSignal) {
    strength += 0.15;
    evidence.push("blocker language in corpus");
  }
  if (hasCrisisSignal) {
    strength += 0.15;
    evidence.push("crisis/high-stakes language in corpus");
  }
  if (hasStakesSignal) {
    strength += 0.1;
    evidence.push("stakes language in corpus");
  }
  if (hasAction) {
    strength += 0.15;
    evidence.push(atoms.action);
  }
  if (hasIncitingIncident) {
    strength += 0.1;
    evidence.push(primitives.inciting_incident);
  }

  strength = clamp(strength);
  return {
    element: "complicating_action",
    strength,
    status: labovStatus(strength),
    evidence: evidence.filter(hasText),
  };
}

function evaluateLabovEvaluation(state, corpus) {
  const atoms = state?.atoms || {};
  const primitives = state?.primitives || {};
  const hasAfter = hasText(atoms.after);
  const hasResolution = hasText(primitives.resolution);
  const hasEmotionalLanguage = EVALUATION_REGEX.test(corpus);
  const hasEndingFeel = ENDING_FEEL_REGEX.test(corpus);
  const hasAppreciation = APPRECIATION_REGEX.test(corpus);
  const evidence = [];

  // Count intensifiers (multiple emotional markers = stronger evaluation)
  const emotionalMatches = (corpus.match(EVALUATION_REGEX) || []).length;
  const intensifierBonus = clamp(emotionalMatches * 0.05, 0, 0.15);

  let strength = 0;
  if (hasEmotionalLanguage) {
    strength += 0.3;
    evidence.push("emotional/subjective language in corpus");
  }
  if (hasAfter) {
    strength += 0.2;
    evidence.push(atoms.after);
  }
  if (hasResolution) {
    strength += 0.15;
    evidence.push(primitives.resolution);
  }
  if (hasEndingFeel) {
    strength += 0.15;
    evidence.push("ending feel language in corpus");
  }
  if (hasAppreciation) {
    strength += 0.1;
    evidence.push("appreciation language");
  }
  strength += intensifierBonus;

  strength = clamp(strength);
  return {
    element: "evaluation",
    strength,
    status: labovStatus(strength),
    evidence: evidence.filter(hasText),
  };
}

function evaluateLabovResolution(state, corpus) {
  const atoms = state?.atoms || {};
  const primitives = state?.primitives || {};
  const hasTurnText = hasText(firstText(atoms.turn, primitives.turning_point));
  const hasTurnRegex = TURN_REGEX.test(corpus);
  const hasTransformation = TURN_TRANSFORMATION_REGEX.test(corpus);
  const hasChangeResult =
    /\b(after that|from then on|since then|changed|became|grew|learned)\b/i.test(
      corpus,
    );
  const evidence = [];

  let strength = 0;
  if (hasTurnText) {
    strength += 0.4;
    evidence.push(atoms.turn || primitives.turning_point || "");
  }
  if (hasTurnRegex) {
    strength += 0.25;
    evidence.push("turning point language in corpus");
  }
  if (hasTransformation) {
    strength += 0.2;
    evidence.push("transformation language in corpus");
  }
  if (hasChangeResult) {
    strength += 0.15;
    evidence.push("change/result language in corpus");
  }

  strength = clamp(strength);
  return {
    element: "resolution",
    strength,
    status: labovStatus(strength),
    evidence: evidence.filter(hasText),
  };
}

function evaluateLabovCoda(state, corpus) {
  const hasDedication = DEDICATION_REGEX.test(corpus);
  const hasPresentShift =
    /\b(today|now|still|always will|every time|whenever I)\b/i.test(corpus);
  const hasOccasionConnection =
    /\b(on this day|this birthday|this anniversary|this occasion|on your special)\b/i.test(
      corpus,
    );
  const evidence = [];

  let strength = 0;
  if (hasDedication) {
    strength += 0.45;
    evidence.push("dedication language in corpus");
  }
  if (hasPresentShift) {
    strength += 0.35;
    evidence.push("present-tense shift in corpus");
  }
  if (hasOccasionConnection) {
    strength += 0.2;
    evidence.push("occasion-connection in corpus");
  }

  strength = clamp(strength);
  return {
    element: "coda",
    strength,
    status: labovStatus(strength),
    evidence: evidence.filter(hasText),
  };
}

function evaluateLabovSpecificityBonus(state, corpus) {
  const atoms = state?.atoms || {};
  const facts = Array.isArray(state?.facts)
    ? state.facts.filter((f) => (f?.status || "active") === "active")
    : [];
  const evidence = [];

  // Proper nouns from facts (corpus is lowercased so can't detect capitalization there)
  const factCorpus = facts.map((f) => f.text || "").join(" ");
  const totalProperNouns = factCorpus
    .split(/\s+/)
    .filter((w, i) => i > 0 && /^[A-Z][a-z]/.test(w)).length;

  const hasSensory =
    SENSORY_REGEX.test(corpus) || SENSORY_REGEX.test(factCorpus.toLowerCase());
  const hasDialogue =
    hasText(atoms.dialogue) ||
    /["'].+["']/.test(corpus) ||
    /["'].+["']/.test(factCorpus);
  const hasConcreteDetail =
    hasText(atoms.object) ||
    hasText(atoms.sound) ||
    hasText(atoms.smell) ||
    hasText(atoms.physical);

  let strength = 0;
  if (totalProperNouns >= 2) {
    strength += 0.3;
    evidence.push(`${totalProperNouns} proper nouns`);
  } else if (totalProperNouns >= 1) {
    strength += 0.15;
    evidence.push(`${totalProperNouns} proper noun`);
  }
  if (hasSensory) {
    strength += 0.25;
    evidence.push("sensory words");
  }
  if (hasDialogue) {
    strength += 0.25;
    evidence.push("quoted dialogue");
  }
  if (hasConcreteDetail) {
    strength += 0.2;
    evidence.push("concrete detail atoms");
  }

  strength = clamp(strength);
  return {
    element: "specificity_bonus",
    strength,
    status: labovStatus(strength),
    evidence: evidence.filter(hasText),
  };
}

/**
 * Map Labov element evaluations to the 8 backward-compatible slot IDs.
 * This ensures the rest of the system (prompt builder, guidance, etc.) can consume
 * Labov results without changes.
 */
function mapLabovToSlots(labovElements) {
  const byElement = Object.fromEntries(
    labovElements.map((e) => [e.element, e]),
  );

  const orientation = byElement.orientation || {
    strength: 0,
    status: "missing",
    evidence: [],
  };
  const complicating = byElement.complicating_action || {
    strength: 0,
    status: "missing",
    evidence: [],
  };
  const evaluation = byElement.evaluation || {
    strength: 0,
    status: "missing",
    evidence: [],
  };
  const resolution = byElement.resolution || {
    strength: 0,
    status: "missing",
    evidence: [],
  };
  const specificity = byElement.specificity_bonus || {
    strength: 0,
    status: "missing",
    evidence: [],
  };

  return [
    normalizeSlot(
      "moment_destination",
      orientation.status,
      "Labov orientation -> moment_destination",
      orientation.evidence,
    ),
    normalizeSlot(
      "who",
      orientation.status,
      "Labov orientation -> who",
      orientation.evidence,
    ),
    normalizeSlot(
      "want",
      evaluation.status,
      "Labov evaluation -> want",
      evaluation.evidence,
    ),
    normalizeSlot(
      "blocker",
      complicating.status,
      "Labov complicating_action -> blocker",
      complicating.evidence,
    ),
    normalizeSlot(
      "stakes",
      complicating.status,
      "Labov complicating_action -> stakes",
      complicating.evidence,
    ),
    normalizeSlot(
      "turn",
      resolution.status,
      "Labov resolution -> turn",
      resolution.evidence,
    ),
    normalizeSlot(
      "ending_feel",
      evaluation.status,
      "Labov evaluation -> ending_feel",
      evaluation.evidence,
    ),
    normalizeSlot(
      "tone",
      specificity.status,
      "Labov specificity_bonus -> tone",
      specificity.evidence,
    ),
  ];
}

/**
 * Compute Labov 6-element gap analysis for story questioning.
 *
 * Evaluates story completeness using Labov's narrative elements:
 * orientation, complicating action, evaluation, resolution, coda, specificity bonus.
 *
 * All detection is deterministic (regex + state field checks). No LLM calls.
 *
 * @param {Object} state - V3 story state
 * @param {Object} [options={}] - Options
 * @param {string} [options.occasion] - Occasion (birthday, memorial, etc.)
 * @param {number} [options.turnCount] - Current turn count
 * @returns {Object} Gap analysis compatible with legacy computeStoryGapAnalysis return shape
 */
function computeLabovGapAnalysis(state, options = {}) {
  const corpus = buildCorpus(state);
  const storyMode = isReflectiveTributeStory(state, corpus)
    ? "reflective_tribute"
    : "default";

  // Determine weights (occasion-aware adjustment)
  const occasionRaw =
    options.occasion || state?.event?.occasion || state?.occasion || "";
  const isTribute = isTributeOccasion(occasionRaw);
  const CELEBRATION_SIMPLE_OCCASIONS = new Set([
    "celebration",
    "birthday",
    "graduation",
    "get-well",
    "get_well",
    "friendship",
  ]);
  const normalizedOccasion = normalizeOccasion(occasionRaw);
  const isCelebration = CELEBRATION_SIMPLE_OCCASIONS.has(normalizedOccasion);
  const weights = { ...LABOV_DEFAULT_WEIGHTS };
  let occasionAdjustment = null;
  if (isCelebration) {
    weights.orientation = 0.3;
    weights.complicating_action = 0.1;
    weights.evaluation = 0.45;
    weights.resolution = 0.05;
    occasionAdjustment = `celebration: orientation 0.20->0.30, complicating_action 0.25->0.10, evaluation 0.35->0.45, resolution 0.10->0.05`;
  } else if (isTribute) {
    weights.resolution = 0.05;
    weights.evaluation = 0.4;
    occasionAdjustment = `tribute: resolution 0.10->0.05, evaluation 0.35->0.40`;
  }

  // Evaluate each Labov element
  const rawElements = [
    evaluateLabovOrientation(state, corpus),
    evaluateLabovComplicatingAction(state, corpus),
    evaluateLabovEvaluation(state, corpus),
    evaluateLabovResolution(state, corpus),
    evaluateLabovCoda(state, corpus),
    evaluateLabovSpecificityBonus(state, corpus),
  ];

  // Attach weights to each element
  const elements = rawElements.map((el) => ({
    ...el,
    weight: weights[el.element],
  }));

  // Compute weighted score
  const weightedScore = Number(
    elements.reduce((sum, el) => sum + el.strength * el.weight, 0).toFixed(2),
  );

  // Map to backward-compatible 8 slots
  const labovSlots = mapLabovToSlots(rawElements);
  const missingSlots = labovSlots
    .filter((s) => s.status === "missing")
    .map((s) => s.slot);
  const weakSlots = labovSlots
    .filter((s) => s.status === "weak")
    .map((s) => s.slot);

  // Readiness — two paths to ready:
  // 1. Weighted score >= 0.60 (all elements contribute)
  // 2. Core trio covered: orientation + complicating_action + evaluation all >= 0.60
  //    These three carry 80% of the weight and are sufficient for a song
  const readinessScore = weightedScore;
  const coreTrio = rawElements.filter((e) =>
    ["orientation", "complicating_action", "evaluation"].includes(e.element),
  );
  const coreTrioCovered = coreTrio.every(
    (e) => e.strength >= STRENGTH_THRESHOLDS.covered,
  );
  const isStoryReady = readinessScore >= 0.6 || coreTrioCovered;

  // "Good enough" escape
  const turnCount = options.turnCount ?? null;
  const canProceedAnyway = typeof turnCount === "number" && turnCount >= 2;

  // Safety block check (same as legacy)
  const noSafetyBlock = !(
    state?.last_reasoning?.safety?.blocked === true ||
    state?.last_reasoning?.safety?.requires_refusal === true ||
    state?.last_reasoning?.safety_violation === true
  );

  // Backward-compatible gates
  const slotById = new Map(labovSlots.map((s) => [s.slot, s]));
  const coveredCount = labovSlots.filter((s) => s.status === "covered").length;
  const coveredOrWeakCount = labovSlots.filter(
    (s) => s.status === "covered" || s.status === "weak",
  ).length;
  const gates = {
    blockerCovered: slotById.get("blocker")?.status === "covered",
    stakesCovered: slotById.get("stakes")?.status === "covered",
    enoughCoveredSlots: coveredCount >= 5,
    enoughCoveredOrWeakSlots: coveredOrWeakCount >= 6,
    momentCovered: slotById.get("moment_destination")?.status === "covered",
    whoCovered: slotById.get("who")?.status === "covered",
    turnAtLeastWeak: ["covered", "weak"].includes(
      slotById.get("turn")?.status || "missing",
    ),
    endingAtLeastWeak: ["covered", "weak"].includes(
      slotById.get("ending_feel")?.status || "missing",
    ),
    criticalConfirmSlotsCovered: CRITICAL_CONFIRM_SLOT_IDS.every(
      (slotId) => slotById.get(slotId)?.status === "covered",
    ),
    noSafetyBlock,
  };

  return {
    slots: labovSlots,
    missingSlots,
    weakSlots,
    readinessScore,
    isStoryReady,
    readinessProfile: "labov",
    storyMode,
    elementSignals: computeElementSignals(state, corpus),
    gates,
    ...(canProceedAnyway ? { canProceedAnyway: true } : {}),
    labov: {
      elements,
      weightedScore,
      occasionAdjustment,
    },
  };
}

// ---------------------------------------------------------------------------
// Question Priority (information-gain targeting)
// ---------------------------------------------------------------------------

/**
 * Compute the highest-value next question target from Labov gap analysis.
 *
 * Priority = element.weight * (1 - element.strength)
 * Skips elements already sufficiently covered (strength >= 0.6).
 * Skips optional elements (weight <= 0.05) that have any coverage.
 *
 * @param {Object|null} labovAnalysis - Return value of computeLabovGapAnalysis()
 * @returns {Object|null} Target with { element, priority, weight, currentStrength, reason }, or null if all covered
 */
function computeQuestionPriority(labovAnalysis) {
  if (!labovAnalysis?.labov?.elements) return null;

  const elements = labovAnalysis.labov.elements;
  let bestTarget = null;
  let bestPriority = -1;

  for (const el of elements) {
    // Skip elements already sufficiently covered
    if (el.strength >= STRENGTH_THRESHOLDS.covered) continue;
    // Skip optional elements with very low weight that have some coverage
    if (el.weight <= 0.05 && el.strength > 0) continue;

    const priority = el.weight * (1 - el.strength);
    if (priority > bestPriority) {
      bestPriority = priority;
      bestTarget = el;
    }
  }

  return bestTarget
    ? {
        element: bestTarget.element,
        priority: Number(bestPriority.toFixed(3)),
        weight: bestTarget.weight,
        currentStrength: bestTarget.strength,
        reason: `${bestTarget.element} has highest information gain (weight ${bestTarget.weight} \u00d7 gap ${(1 - bestTarget.strength).toFixed(2)} = ${bestPriority.toFixed(3)})`,
      }
    : null;
}

// ---------------------------------------------------------------------------
// Question Funnel Staging
// ---------------------------------------------------------------------------

/**
 * Determine the question funnel stage based on conversation turn count.
 *
 * - Turn 0-1: OPEN (broad, inviting questions)
 * - Turn 2: PROBING (build on specifics they mentioned)
 * - Turn 3+: CLOSED (specific detail extraction)
 *
 * @param {number|null|undefined} turnCount - Current turn count
 * @returns {{ stage: string, description: string }}
 */
function getQuestionStage(turnCount) {
  if (!turnCount || turnCount <= 1)
    return {
      stage: "OPEN",
      description: "Broad, inviting questions. Let them share freely.",
    };
  if (turnCount === 2)
    return {
      stage: "PROBING",
      description: "Build on specifics they mentioned. Deepen their details.",
    };
  return {
    stage: "CLOSED",
    description: "Specific detail extraction. Fill in vivid details.",
  };
}

// ---------------------------------------------------------------------------
// Emotional Intensity Detection
// ---------------------------------------------------------------------------

const VULNERABILITY_REGEX =
  /\b(breakup|divorce|loss|death|died|funeral|cancer|sick|hospital|depression|anxiety|lonely|scared|crying|tears|grief|heartbreak|betrayal)\b/i;
const INTENSIFIER_REGEX =
  /\b(never forget|always remember|changed everything|meant the world|most important|deeply|truly|absolutely|completely|forever)\b/i;
const FIRST_PERSON_EMOTION_REGEX =
  /\b(i felt|i feel|made me feel|i couldn't|i was so|i cried|i laughed|broke my heart|fills my heart|i knew then)\b/i;

/**
 * Detect emotional intensity from the user's latest message.
 *
 * Counts signal categories (vulnerability, intensifier, first-person emotion).
 * - 0 signals: low
 * - 1 signal: medium
 * - 2+ signals: high
 *
 * @param {string|null} userMessage - The user's latest message
 * @returns {{ intensity: string, signals: string[] }}
 */
function detectEmotionalIntensity(userMessage) {
  if (!userMessage) return { intensity: "low", signals: [] };
  const text = userMessage.toLowerCase();
  const signals = [];

  if (VULNERABILITY_REGEX.test(text)) signals.push("vulnerability");
  if (INTENSIFIER_REGEX.test(text)) signals.push("intensifier");
  if (FIRST_PERSON_EMOTION_REGEX.test(text))
    signals.push("first_person_emotion");

  const intensity =
    signals.length >= 2 ? "high" : signals.length === 1 ? "medium" : "low";
  return { intensity, signals };
}

// ---------------------------------------------------------------------------
// Question Enforcement — Targeted Fallback + Relevance Validation
// ---------------------------------------------------------------------------

/**
 * Relevance keyword sets per Labov element.
 * Used by validateQuestionRelevance to check whether a question addresses the target.
 */
const RELEVANCE_KEYWORDS = {
  orientation:
    /\b(where|when|who|setting|place|time of|day|night|morning|evening|season|year|city|town|house|room|with you|together|at the|around|scene)\b/i,
  complicating_action:
    /\b(what happened|moment|happened|event|then what|what did|how did|turning point|came next|first time|remember when|did .+ (say|do|react)|one time|was there a time|specific time|stands? out|what.s the story|keep coming back)\b/i,
  evaluation:
    /\b(feel\w*|felt|mean\w*|meant|matter\w*|emotion\w*|why .+ (important|special|significant)|what .+ (mean|matter)|heart|soul|cherish|value|love|miss|grateful|proud|bittersweet)\b/i,
  resolution:
    /\b(change\w*|after\b|different|now\b|end\w*|outcome|result|became|turn out|since then|looking back|today|ultimately|in the end|what.s different|how .+ (turn|work) out)\b/i,
};

/**
 * Check if the LLM's generated question actually targets the intended Labov element.
 * Returns true if the question addresses the target, false if it's off-target or generic.
 *
 * @param {string} question - The LLM-generated question
 * @param {string} targetElement - The intended Labov element
 * @returns {boolean}
 */
function validateQuestionRelevance(question, targetElement) {
  if (!question || !targetElement) return false;
  const pattern = RELEVANCE_KEYWORDS[targetElement];
  if (!pattern) return false;
  return pattern.test(question);
}

/**
 * Extract the most salient anchor phrase from the user's message.
 * Prefers proper nouns, named events, and sensory details.
 * Falls back to the first noun phrase of 2+ words.
 *
 * @param {string} text - Raw user message
 * @returns {string|null} The best anchor phrase, or null
 */
function extractAnchor(text) {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed.length < 3) return null;

  // 1. Proper nouns: capitalized words (skip common sentence starters)
  //    Match "Marcus", "Lagos", "Christmas Eve", "Lake Okonkwo", "Sarah"
  const COMMON_STARTERS = new Set([
    "I",
    "It",
    "My",
    "We",
    "He",
    "She",
    "The",
    "They",
    "Our",
    "His",
    "Her",
    "There",
    "This",
    "That",
    "When",
    "After",
    "Before",
    "One",
    "So",
    "But",
    "And",
    "Then",
    "Yeah",
    "Yes",
    "No",
  ]);
  const properNouns = [];
  const sentences = trimmed.split(/[.!?]+/).filter(Boolean);
  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const clean = words[i].replace(/[^a-zA-Z'-]/g, "");
      if (clean.length >= 2 && /^[A-Z]/.test(clean)) {
        // Skip common sentence-initial words (pronouns, articles, etc.)
        if (i === 0 && COMMON_STARTERS.has(clean)) continue;
        // Collect consecutive capitalized words as a phrase
        let phrase = clean;
        for (let j = i + 1; j < words.length; j++) {
          const next = words[j].replace(/[^a-zA-Z'-]/g, "");
          if (next.length >= 2 && /^[A-Z]/.test(next)) {
            phrase += " " + next;
            i = j;
          } else break;
        }
        properNouns.push(phrase);
      }
    }
  }
  if (properNouns.length > 0) return properNouns[0];

  // 2. Named events or specific details (multi-word descriptive phrases)
  const specificPatterns = [
    /(?:that|the|my|his|her|our|their)\s+(?:\w+\s+){0,2}(?:morning|evening|night|day|summer|winter|birthday|wedding|ceremony|graduation|funeral|holiday|trip|vacation|Christmas|anniversary)/i,
    /(?:red|blue|green|yellow|white|black|old|little|small|big)\s+\w+/i,
    /(?:at|in|on|by|near)\s+(?:the|a|my|our|his|her)\s+\w+/i,
  ];
  for (const pattern of specificPatterns) {
    const match = trimmed.match(pattern);
    if (match) return match[0].trim();
  }

  // 3. Action-laden phrases (past tense verbs with objects)
  const actionMatch = trimmed.match(
    /(?:taught me|showed me|gave me|took me|brought me|made me|told me|called me|carried me|showed up|flew in|stayed up|woke up|drove to|walked to|ran to)\s*(?:\w+(?:\s+\w+)?)?/i,
  );
  if (actionMatch) return actionMatch[0].trim();

  // 4. Last resort: the longest noun-like phrase (3+ chars, no stop words)
  const STOP_WORDS = new Set([
    "the",
    "and",
    "but",
    "for",
    "with",
    "that",
    "this",
    "was",
    "were",
    "been",
    "have",
    "has",
    "had",
    "are",
    "not",
    "its",
    "also",
    "than",
    "just",
    "very",
    "really",
    "yeah",
    "yes",
  ]);
  const contentWords = trimmed.split(/\s+/).filter((w) => {
    const clean = w.replace(/[^a-zA-Z]/g, "").toLowerCase();
    return clean.length >= 3 && !STOP_WORDS.has(clean);
  });
  if (contentWords.length > 0) {
    // Return the first two content words joined
    return contentWords
      .slice(0, Math.min(2, contentWords.length))
      .join(" ")
      .replace(/[^a-zA-Z0-9' -]/g, "");
  }

  return null;
}

/**
 * Template arrays per element + funnel stage for targeted fallback questions.
 * Each template has a `{anchor}` placeholder for the extracted detail.
 * Multiple options per cell to avoid repetition across turns.
 */
const TARGETED_QUESTION_TEMPLATES = {
  orientation: {
    OPEN: [
      "Tell me more about {anchor} -- where were you, and who was there?",
      "{anchor} -- can you paint the scene for me? Where and when was this?",
    ],
    PROBING: [
      "{anchor} -- what was the setting like? What time of day, what was happening around you?",
      "When you think about {anchor}, what do you see around you?",
    ],
    CLOSED: [
      "Was {anchor} during the day or at night?",
      "Were you alone for {anchor}, or was someone with you?",
    ],
  },
  complicating_action: {
    OPEN: [
      "Was there a moment that really stands out with {anchor}?",
      "Tell me about a specific time with {anchor} that you keep coming back to.",
    ],
    PROBING: [
      "{anchor} -- what happened right after that?",
      "The part about {anchor} -- what did they do or say next?",
    ],
    CLOSED: [
      "Did something specific happen with {anchor} that changed the direction of things?",
      "Was there one moment with {anchor} where everything shifted?",
    ],
  },
  evaluation: {
    OPEN: [
      "{anchor} -- what does that mean to you now, looking back?",
      "When you think about {anchor}, what feelings come up?",
    ],
    PROBING: [
      "{anchor} -- why does that matter so much to you?",
      "What is it about {anchor} that stays with you?",
    ],
    CLOSED: [
      "Does {anchor} still feel the same way it did back then?",
      "Is {anchor} something you feel grateful for, or is it more bittersweet?",
    ],
  },
  resolution: {
    OPEN: [
      "After {anchor}, how did things change?",
      "What's different now because of {anchor}?",
    ],
    PROBING: [
      "{anchor} -- what happened in the end? How did it turn out?",
      "Looking back at {anchor}, what changed after that?",
    ],
    CLOSED: [
      "Did {anchor} end the way you expected?",
      "After {anchor}, were things better or just different?",
    ],
  },
};

/**
 * Generate a fallback question that specifically targets the given Labov element,
 * grounded in the user's actual story content. Used when the LLM ignores the
 * question_targeting injection.
 *
 * DETERMINISTIC: no LLM calls. Uses template selection + anchor extraction.
 *
 * @param {string} targetElement - The Labov element to target (orientation, complicating_action, evaluation, resolution)
 * @param {Object} state - Story state with facts, conversation, atoms, turn_count
 * @param {string} userMessage - The user's latest message
 * @returns {string|null} A targeted, story-specific question, or null if inputs are invalid
 */
function generateTargetedFallbackQuestion(targetElement, state, userMessage) {
  if (!targetElement || !TARGETED_QUESTION_TEMPLATES[targetElement])
    return null;
  if (
    !userMessage ||
    typeof userMessage !== "string" ||
    userMessage.trim().length === 0
  )
    return null;

  // 1. Determine funnel stage from turn count
  const turnCount = state?.turn_count ?? 0;
  const { stage } = getQuestionStage(turnCount);

  // 2. Extract anchor from user message
  // For sparse inputs (<5 words), sentence-starter capitals (e.g., "Happy") produce
  // nonsensical anchors. Use the recipient name instead — more meaningful.
  const wordCount = (userMessage || "").split(/\s+/).filter(Boolean).length;
  let anchor;
  if (wordCount < 5) {
    anchor =
      (state?.atoms?.who || state?.recipient_name || "").split(/\s/)[0] || null;
  }
  if (!anchor) {
    anchor = extractAnchor(userMessage);
  }

  // 3. If user message is thin (very short / no good anchor), try state facts
  if (!anchor && state?.facts) {
    const activeFacts = (state.facts || []).filter(
      (f) => (f?.status || "active") === "active" && f?.text,
    );
    for (const fact of activeFacts) {
      anchor = extractAnchor(fact.text);
      if (anchor) break;
    }
  }

  // 4. Ultimate fallback anchor: use a content word from the message itself
  if (!anchor) {
    const words = userMessage
      .trim()
      .split(/\s+/)
      .filter((w) => w.length >= 3);
    anchor = words.length > 0 ? words.slice(0, 2).join(" ") : "that";
  }

  // 5. Select template (use turn_count modulo to vary across turns)
  const templates = TARGETED_QUESTION_TEMPLATES[targetElement][stage];
  if (!templates || templates.length === 0) return null;
  const templateIndex = turnCount % templates.length;
  const template = templates[templateIndex];

  // 6. Fill template
  return template.replace(/\{anchor\}/g, anchor);
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
  POEM_GAP_QUESTIONS: POEM_GAP_QUESTION_DEFAULTS,
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
