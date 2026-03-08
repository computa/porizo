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
  covered: 0.6,   // >= this is considered "covered" (sufficient content)
  weak: 0.3,      // >= this but < covered is "weak" (partial content)
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

/**
 * Slots that MUST be covered before the engine can confirm completion.
 * Keep this set small to avoid over-constraining the flow.
 */
const CRITICAL_CONFIRM_SLOT_IDS = [
  "moment_destination",
];

const SLOT_GUIDANCE_TEMPLATES = {
  moment_destination: {
    weak: {
      instruction: "Your setting/moment is close, but still too vague.",
      answerTemplate: "In [place], during [time], [person] [specific action/event] that changed things",
      examples: [
        "In Aarhus, during the winter exams, Osita worked night shifts and still funded his siblings' tuition.",
        "At our kitchen table on Sunday night, Dad quietly decided to sell his car so we could stay in school.",
      ],
    },
    missing: {
      instruction: "Add one concrete scene with place, time, and what happened.",
      answerTemplate: "In [place], during [time], [person] [specific action/event] that changed things",
      examples: [
        "In Lagos, during the flood season, Mum carried us across water to get to class.",
        "At the airport in December, she hugged me and said we were starting over together.",
      ],
    },
  },
  stakes: {
    weak: {
      instruction: "State what could have been lost if this failed.",
      answerTemplate: "If this failed, [person] would have lost [specific consequence]",
      examples: [
        "If this failed, he would have lost his visa and the chance to support his parents.",
      ],
    },
    missing: {
      instruction: "Add one explicit consequence.",
      answerTemplate: "If this failed, [person] would have lost [specific consequence]",
      examples: [
        "If this failed, we would have lost our home and my younger brother's schooling.",
      ],
    },
  },
  who: {
    weak: {
      instruction: "Clarify their role and what makes them important to the story.",
      answerTemplate: "[Name] is my [relationship] — they [defining trait or action]",
      examples: [
        "Osita is my older brother — he always stepped up when our parents couldn't.",
      ],
    },
    missing: {
      instruction: "Name the person and their relationship to you.",
      answerTemplate: "[Name] is my [relationship] — they [defining trait or action]",
      examples: [
        "My grandmother Nkechi raised me after my parents moved abroad for work.",
        "Tunde is my best friend since secondary school — we survived everything together.",
      ],
    },
  },
  want: {
    weak: {
      instruction: "Make the desire more specific — what exactly did they hope for?",
      answerTemplate: "[Person] wanted [specific desire] because [reason]",
      examples: [
        "She wanted to hear him say he was proud of her, just once.",
      ],
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
      instruction: "Make the obstacle more concrete — what specifically stood in the way?",
      answerTemplate: "The problem was [specific obstacle] which meant [consequence]",
      examples: [
        "The distance between us had grown into years of silence neither of us knew how to break.",
      ],
    },
    missing: {
      instruction: "Name the main thing standing in the way.",
      answerTemplate: "The problem was [specific obstacle] which meant [consequence]",
      examples: [
        "He was too proud to ask for help, even when the bills were piling up.",
        "We hadn't spoken in three years after the argument at Christmas.",
      ],
    },
  },
  turn: {
    weak: {
      instruction: "Pinpoint the exact moment things shifted — what happened right then?",
      answerTemplate: "Then [specific event] happened, and after that [what changed]",
      examples: [
        "Then she called from the hospital parking lot, and after that we couldn't pretend anymore.",
      ],
    },
    missing: {
      instruction: "Describe the moment that changed everything.",
      answerTemplate: "Then [specific event] happened, and after that [what changed]",
      examples: [
        "He showed up at my graduation even though he said he wouldn't come.",
        "She handed me the letter she'd been carrying for months but never sent.",
      ],
    },
  },
  ending_feel: {
    weak: {
      instruction: "Be more specific about the feeling — what emotion should linger?",
      answerTemplate: "The listener should feel [specific emotion] because [reason]",
      examples: [
        "The listener should feel quietly proud, like witnessing someone finally get what they deserved.",
      ],
    },
    missing: {
      instruction: "Describe how the story should leave the listener feeling.",
      answerTemplate: "The listener should feel [specific emotion] because [reason]",
      examples: [
        "It should feel bittersweet — happy we reconnected but aware of the time we lost.",
        "It should feel hopeful, like the hard part is over and something good is starting.",
      ],
    },
  },
  tone: {
    weak: {
      instruction: "Refine the tone — is it more warm, raw, playful, or cinematic?",
      answerTemplate: "The tone should be [adjective] — like [comparison or feeling]",
      examples: [
        "The tone should be gentle and warm — like a late-night conversation between old friends.",
      ],
    },
    missing: {
      instruction: "Describe the overall feeling and style of the story.",
      answerTemplate: "The tone should be [adjective] — like [comparison or feeling]",
      examples: [
        "Keep it real and a little raw — no sugar-coating, just honest.",
        "Make it cinematic, like a movie scene you can't stop thinking about.",
      ],
    },
  },
};

const GAP_QUESTION_TEMPLATES = {
  moment_destination: {
    prompt: "What is the exact moment and setting this story should build toward?",
    quickReplies: ["At home", "At school/work", "During a trip", "At a celebration", "You suggest"],
  },
  who: {
    prompt: "Who is this mainly about, and what is your relationship to them?",
    quickReplies: ["Parent", "Partner", "Friend", "Sibling", "You suggest"],
  },
  want: {
    prompt: "What did they want most in this moment?",
    quickReplies: ["To be accepted", "To feel safe", "To prove themselves", "To protect someone", "You suggest"],
  },
  blocker: {
    prompt: "What was the main thing standing in the way?",
    quickReplies: ["A person", "A fear", "A rule", "A secret", "You suggest"],
  },
  stakes: {
    prompt: "If this failed, what would be lost?",
    quickReplies: ["Trust", "The relationship", "A big opportunity", "Self-belief", "You suggest"],
  },
  turn: {
    prompt: "What happened that changed everything?",
    quickReplies: ["A conversation", "A decision", "Unexpected news", "A near miss", "You suggest"],
  },
  ending_feel: {
    prompt: "How should this story leave the listener feeling?",
    quickReplies: ["Hopeful", "Proud", "Bittersweet", "Comforted", "You suggest"],
  },
  tone: {
    prompt: "What tone should we use for this story?",
    quickReplies: ["Cinematic", "Realistic", "Gentle", "Playful", "You suggest"],
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
  "turning_point", "moment", "birth_moment", "falling",
  // Core meaning
  "meaning",
  // Scene/foundation
  "scene", "meeting", "discovery", "who",
  // Stakes/tension (lowest priority)
  "stakes", "scare", "struggle",
];

const RELATIONSHIP_HINT_REGEX = /\b(mom|mum|mother|dad|father|parent|sister|brother|friend|partner|wife|husband|fiance|fiancee|son|daughter|child|mentor|teacher|grandma|grandpa|aunt|uncle|cousin|colleague|boss)\b/i;
const WANT_REGEX = /\b(want(?:ed|s)?|wish(?:ed|es)?|hope(?:d|s)?|dream(?:ed|s)?|goal|trying to|needed to|need to|longed to|in order to|so that)\b/i;
const BLOCKER_REGEX = /\b(couldn't|could not|can't|cannot|blocked|stopped|prevented|afraid|fear|anxious|rule|secret|barrier|obstacle|challenge|struggle|conflict)\b/i;
const STAKES_REGEX = /\b(if we failed|if i failed|if they failed|if this failed|lose|lost|risk(?:ed|s)?|at stake|cost us|cost me|would have lost|without this)\b/i;
const STAKES_WEAK_REGEX = /\b(mattered|important|meant everything|heartbroken|devastating)\b/i;
const TURN_REGEX = /\b(turning point|everything changed|that moment|suddenly|after that|then i knew)\b/i;
const ENDING_FEEL_REGEX = /\b(hopeful|tragic|funny|reflective|bittersweet|uplifting|comforting|joyful|proud|peaceful|healing|grateful|inspired)\b/i;
const TONE_REGEX = /\b(cinematic|realistic|comedic|romantic|playful|serious|raw|poetic|gentle|dramatic|upbeat|melancholic)\b/i;

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function hasText(value) {
  return normalizeText(value).length > 0;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function toConfidence(status, evidenceCount = 0) {
  const base = status === "covered" ? 0.78 : (status === "weak" ? 0.48 : 0.12);
  const evidenceBoost = status === "missing" ? 0 : Math.min(0.18, evidenceCount * 0.05);
  return Number(clamp(base + evidenceBoost).toFixed(2));
}

function getBeatStrength(state, beatId) {
  const beat = (state?.beats || []).find((candidate) => candidate?.id === beatId);
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
  const canonicalNarrative = hasText(state?.narrative_current) ? state.narrative_current : state?.narrative;
  if (hasText(canonicalNarrative)) corpus.push(canonicalNarrative);
  for (const fact of state?.facts || []) {
    if ((fact?.status || "active") !== "active") continue;
    if (hasText(fact?.text)) corpus.push(fact.text);
  }
  return corpus.join(" ").toLowerCase();
}

function firstText(...values) {
  for (const value of values) {
    if (hasText(value)) return normalizeText(value);
  }
  return "";
}

function normalizeSlot(slot, status, reason, evidence = []) {
  const cleanedEvidence = evidence.filter(hasText).map(normalizeText).slice(0, 4);
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
function findHighestPriorityGap(missingSlots, weakSlots) {
  return STORY_SLOT_PRIORITY.find((s) => missingSlots.includes(s))
    || STORY_SLOT_PRIORITY.find((s) => weakSlots.includes(s))
    || null;
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
    examples: Array.isArray(variant.examples) ? variant.examples.slice(0, 3) : [],
  };
}

function formatPromptWithGuidance(prompt, slotGuidance) {
  if (!slotGuidance) return prompt;
  const example = Array.isArray(slotGuidance.examples) && slotGuidance.examples.length > 0
    ? ` Example: "${slotGuidance.examples[0]}"`
    : "";
  return `${prompt} ${slotGuidance.instruction} Use this format: ${slotGuidance.answerTemplate}.${example}`;
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
    primitives.turning_point
  );
  const hasMomentBeat = hasBeatCoverage(state, ["moment", "scene", "discovery"], STRENGTH_THRESHOLDS.weak);

  if (place && time && (moment || hasMomentBeat)) {
    return normalizeSlot(
      "moment_destination",
      "covered",
      "Moment, place, and time context are present.",
      [place, time, moment]
    );
  }

  if ((place || time) && (moment || hasMomentBeat)) {
    return normalizeSlot(
      "moment_destination",
      "weak",
      "Partial setting is present but the destination moment needs precision.",
      [place, time, moment]
    );
  }

  return normalizeSlot(
    "moment_destination",
    "missing",
    "The core moment destination and setting are unclear.",
    [place, time, moment]
  );
}

function evaluateWhoSlot(state) {
  const atoms = state?.atoms || {};
  const primitives = state?.primitives || {};
  const whoText = normalizeText(atoms.who);
  const recipient = normalizeText(state?.recipient_name);
  const characters = Array.isArray(primitives.characters) ? primitives.characters : [];
  const hasCharacter = characters.some((character) =>
    hasText(character?.name) || hasText(character?.role)
  );
  const relationshipHint = RELATIONSHIP_HINT_REGEX.test(
    [whoText, recipient, ...characters.map((character) => `${character?.name || ""} ${character?.role || ""}`)]
      .join(" ")
  );

  if ((hasText(whoText) || hasCharacter) && relationshipHint) {
    return normalizeSlot(
      "who",
      "covered",
      "Subject and relationship context are clear.",
      [whoText, recipient]
    );
  }

  if (hasText(whoText) || hasCharacter || hasText(recipient)) {
    return normalizeSlot(
      "who",
      "weak",
      "A subject exists, but relationship detail is still thin.",
      [whoText, recipient]
    );
  }

  return normalizeSlot(
    "who",
    "missing",
    "No clear subject or relationship is identified.",
    []
  );
}

function evaluateWantSlot(state, corpus) {
  const primitives = state?.primitives || {};
  const characters = Array.isArray(primitives.characters) ? primitives.characters : [];
  const explicitDesire = characters.find((character) => hasText(character?.desire))?.desire || "";
  const beatSignal = hasBeatCoverage(state, ["meaning", "moment"], STRENGTH_THRESHOLDS.weak);

  if (hasText(explicitDesire) || WANT_REGEX.test(corpus)) {
    return normalizeSlot(
      "want",
      "covered",
      "A concrete desire or goal is present.",
      [explicitDesire]
    );
  }

  if (beatSignal) {
    return normalizeSlot(
      "want",
      "weak",
      "Motivation is implied but not explicit yet.",
      [explicitDesire]
    );
  }

  return normalizeSlot(
    "want",
    "missing",
    "What the protagonist wants is not explicit.",
    []
  );
}

function evaluateBlockerSlot(state, corpus) {
  const primitives = state?.primitives || {};
  const conflictInternal = normalizeText(primitives.conflict?.internal);
  const conflictExternal = normalizeText(primitives.conflict?.external);
  const atoms = state?.atoms || {};
  const secret = normalizeText(atoms.secret);
  const struggleBeat = hasBeatCoverage(state, ["struggle", "stakes"], STRENGTH_THRESHOLDS.weak);

  if (hasText(conflictInternal) || hasText(conflictExternal) || hasText(secret)) {
    return normalizeSlot(
      "blocker",
      "covered",
      "A concrete obstacle is captured.",
      [conflictInternal, conflictExternal, secret]
    );
  }

  if (BLOCKER_REGEX.test(corpus) || struggleBeat) {
    return normalizeSlot(
      "blocker",
      "weak",
      "Some friction exists, but the blocker is still vague.",
      []
    );
  }

  return normalizeSlot(
    "blocker",
    "missing",
    "No clear blocker is defined.",
    []
  );
}

function evaluateStakesSlot(state, corpus) {
  const atoms = state?.atoms || {};
  const stakesText = normalizeText(atoms.stakes);
  const stakesBeatCovered = hasBeatCoverage(state, ["stakes", "impact"], STRENGTH_THRESHOLDS.covered);
  const stakesBeatWeak = hasBeatCoverage(state, ["stakes", "impact"], STRENGTH_THRESHOLDS.weak);

  if (hasText(stakesText) || STAKES_REGEX.test(corpus) || stakesBeatCovered) {
    return normalizeSlot(
      "stakes",
      "covered",
      "Consequences are explicit.",
      [stakesText]
    );
  }

  if (STAKES_WEAK_REGEX.test(corpus) || stakesBeatWeak) {
    return normalizeSlot(
      "stakes",
      "weak",
      "Importance is implied but concrete consequences are missing.",
      [stakesText]
    );
  }

  return normalizeSlot(
    "stakes",
    "missing",
    "No explicit consequences are captured.",
    [stakesText]
  );
}

function evaluateTurnSlot(state, corpus) {
  const atoms = state?.atoms || {};
  const primitives = state?.primitives || {};
  const turnText = firstText(atoms.turn, primitives.turning_point);
  const turnBeatCovered = hasBeatCoverage(state, ["turning_point", "moment"], STRENGTH_THRESHOLDS.covered);
  const turnBeatWeak = hasBeatCoverage(state, ["turning_point", "moment"], STRENGTH_THRESHOLDS.weak);

  if (hasText(turnText) || turnBeatCovered) {
    return normalizeSlot(
      "turn",
      "covered",
      "A clear turning point is present.",
      [turnText]
    );
  }

  if (TURN_REGEX.test(corpus) || turnBeatWeak) {
    return normalizeSlot(
      "turn",
      "weak",
      "A shift is hinted at but the decisive turn is unclear.",
      [turnText]
    );
  }

  return normalizeSlot(
    "turn",
    "missing",
    "No clear turning point is captured yet.",
    [turnText]
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
      [endingText]
    );
  }

  if (hasText(endingText) || hasEmotion) {
    return normalizeSlot(
      "ending_feel",
      "weak",
      "Ending is partially defined, but emotional intent is unclear.",
      [endingText]
    );
  }

  return normalizeSlot(
    "ending_feel",
    "missing",
    "Desired ending emotion is not defined.",
    []
  );
}

function evaluateToneSlot(state, corpus) {
  const dials = state?.dials || {};
  const toneText = normalizeText(dials.tone);
  const weakToneHint = firstText(dials.focus, dials.realism, dials.pov);
  const hasTonePattern = TONE_REGEX.test(corpus);

  if (hasText(toneText) || hasTonePattern) {
    return normalizeSlot(
      "tone",
      "covered",
      "Tone direction is explicit.",
      [toneText]
    );
  }

  if (hasText(weakToneHint)) {
    return normalizeSlot(
      "tone",
      "weak",
      "Some stylistic hints exist, but tone is not explicit.",
      [weakToneHint]
    );
  }

  return normalizeSlot(
    "tone",
    "missing",
    "No tone direction is captured.",
    []
  );
}

function sortByPriority(slots) {
  const slotSet = new Set(slots);
  return STORY_SLOT_PRIORITY.filter((slot) => slotSet.has(slot));
}

/**
 * Compute deterministic gap analysis for story questioning.
 *
 * @param {Object} state - Current story state
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
  const missingSlots = sortByPriority(slots.filter((slot) => slot.status === "missing").map((slot) => slot.slot));
  const weakSlots = sortByPriority(slots.filter((slot) => slot.status === "weak").map((slot) => slot.slot));

  const weightSum = STORY_SLOT_PRIORITY.reduce((sum, slot) => sum + (STORY_SLOT_WEIGHTS[slot] || 1), 0);
  const weightedConfidence = STORY_SLOT_PRIORITY.reduce((sum, slotId) => {
    const slot = slotById.get(slotId);
    const confidence = slot ? slot.confidence : 0;
    return sum + (confidence * (STORY_SLOT_WEIGHTS[slotId] || 1));
  }, 0);
  const readinessScore = Number((weightedConfidence / Math.max(weightSum, 1)).toFixed(2));

  const coveredCount = slots.filter((slot) => slot.status === "covered").length;
  const coveredOrWeakCount = slots.filter((slot) => slot.status === "covered" || slot.status === "weak").length;
  const blockerCovered = slotById.get("blocker")?.status === "covered";
  const stakesCovered = slotById.get("stakes")?.status === "covered";
  const whoCovered = slotById.get("who")?.status === "covered";
  const momentCovered = slotById.get("moment_destination")?.status === "covered";
  const turnAtLeastWeak = ["covered", "weak"].includes(slotById.get("turn")?.status || "missing");
  const endingAtLeastWeak = ["covered", "weak"].includes(slotById.get("ending_feel")?.status || "missing");
  const criticalConfirmSlotsCovered = CRITICAL_CONFIRM_SLOT_IDS.every(
    (slotId) => slotById.get(slotId)?.status === "covered"
  );
  const noSafetyBlock = !(
    state?.last_reasoning?.safety?.blocked === true ||
    state?.last_reasoning?.safety?.requires_refusal === true ||
    state?.last_reasoning?.safety_violation === true
  );

  const dramaticReady = (
    blockerCovered &&
    stakesCovered &&
    coveredCount >= 5 &&
    noSafetyBlock &&
    readinessScore >= 0.72
  );

  // Reflective stories may not always have explicit blocker/stakes phrasing.
  // Accept completion when identity, moment, turn, and emotional ending are coherent.
  const reflectiveReady = (
    whoCovered &&
    momentCovered &&
    turnAtLeastWeak &&
    endingAtLeastWeak &&
    coveredCount >= 4 &&
    coveredOrWeakCount >= 6 &&
    noSafetyBlock &&
    readinessScore >= 0.62
  );

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
    : (reflectiveReady ? "reflective" : "incomplete");

  return {
    slots,
    missingSlots,
    weakSlots,
    readinessScore,
    isStoryReady,
    readinessProfile,
    gates,
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
 *   quickReplies: string[],
 *   inputMode: string,
 *   reason: string
 * }|null}
 */
function pickDeterministicGapQuestion(gapAnalysis, state) {
  if (!gapAnalysis || typeof gapAnalysis !== "object") return null;

  const missingSlots = Array.isArray(gapAnalysis.missingSlots) ? gapAnalysis.missingSlots : [];
  const weakSlots = Array.isArray(gapAnalysis.weakSlots) ? gapAnalysis.weakSlots : [];

  const targetSlot = findHighestPriorityGap(missingSlots, weakSlots);
  if (!targetSlot) return null;

  const template = GAP_QUESTION_TEMPLATES[targetSlot];
  if (!template) return null;

  const slotDetails = Array.isArray(gapAnalysis.slots)
    ? gapAnalysis.slots.find((slot) => slot.slot === targetSlot)
    : null;
  const slotState = slotDetails?.status || (missingSlots.includes(targetSlot) ? "missing" : "weak");
  const recipient = normalizeText(state?.recipient_name);
  const slotGuidance = getSlotGuidance(targetSlot, slotState);

  let prompt = template.prompt;
  if (targetSlot === "who" && recipient) {
    prompt = `Who is this mainly about in relation to ${recipient}, and what role do they play in your life?`;
  }
  prompt = formatPromptWithGuidance(prompt, slotGuidance);

  return {
    targetSlot,
    prompt,
    quickReplies: [...template.quickReplies],
    inputMode: "single_choice_or_text",
    reason: slotDetails?.reason || `${slotState === "missing" ? "Missing" : "Weak"} ${targetSlot} details.`,
    slotGuidance,
  };
}

function getCriticalConfirmSlotCoverage(gapAnalysis) {
  if (!gapAnalysis || typeof gapAnalysis !== "object") {
    return { hasBlockingGap: false, blockingSlots: [] };
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
const POEM_GAP_QUESTIONS = {
  narrative: "Could you share the story in one clear paragraph so I can write the poem from it?",
  who: "Who is this about, and what’s your relationship to them?",
  turn: "What was the moment that changed everything or made this feel important?",
  context: "Where and when did this happen?",
  emotion: "What feeling was strongest in that moment?",
};

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
    (typeof primitives.turning_point === "string" && primitives.turning_point.trim().length > 0);
  if (!hasTurn) {
    gaps.push({ id: "turn", label: "Turning point missing" });
  }

  const hasContext =
    (typeof atoms.where === "string" && atoms.where.trim().length > 0) ||
    (typeof atoms.when === "string" && atoms.when.trim().length > 0) ||
    (typeof primitives.setting?.place === "string" && primitives.setting.place.trim().length > 0) ||
    (typeof primitives.setting?.time === "string" && primitives.setting.time.trim().length > 0);
  if (!hasContext) {
    gaps.push({ id: "context", label: "Time or place missing" });
  }

  const hasEmotionalDepth = state?.last_reasoning?.story_readiness?.has_emotional_depth;
  if (hasEmotionalDepth === false) {
    gaps.push({ id: "emotion", label: "Emotional arc is thin" });
  }

  const suggested = gaps.length > 0 ? (POEM_GAP_QUESTIONS[gaps[0].id] || POEM_GAP_QUESTIONS.narrative) : null;

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

  const requiredBeats = state.beats.filter(b => b.required);

  // Support both schemas: status === "covered" OR strength >= threshold
  const isCovered = (b) =>
    b.status === "covered" || (typeof b.strength === "number" && b.strength >= STRENGTH_THRESHOLDS.covered);

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
  const shouldConfirm = llmDecision.action === "CONFIRM" ||
                        llmDecision.action === "STOP";

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
  const coveredIds = covered.map(b => b.id);

  // Need at least 3 beats covered/weak
  if (covered.length < 3) return false;

  // Need meaning
  const hasMeaning = coveredIds.includes("meaning");
  if (!hasMeaning) return false;

  // Need some scene-like beat
  const sceneBeats = ["scene", "meeting", "discovery", "who", "relationship"];
  const hasScene = sceneBeats.some(id => coveredIds.includes(id));

  // Need some turning point or stakes
  const pivotBeats = ["turning_point", "stakes", "moment", "impact", "struggle"];
  const hasPivot = pivotBeats.some(id => coveredIds.includes(id));

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

  const requiredBeats = state.beats.filter(b => b.required);
  if (requiredBeats.length === 0) return 100;

  let score = 0;
  for (const beat of requiredBeats) {
    const strength = beat.strength;
    // Support both schemas: status-based OR strength-based
    if (beat.status === "covered" || (typeof strength === "number" && strength >= STRENGTH_THRESHOLDS.covered)) {
      score += 1;
    } else if (beat.status === "weak" || (typeof strength === "number" && strength >= STRENGTH_THRESHOLDS.weak)) {
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
    if (typeof b.strength === "number" && b.strength < STRENGTH_THRESHOLDS.covered) return true;
    return false;
  };

  return state.beats
    .filter(b => b.required && needsWork(b))
    .sort((a, b) => {
      // Sort by strength (lowest first) for strength-based beats
      const aStrength = typeof a.strength === "number" ? a.strength : (a.status === "weak" ? 0.4 : 0);
      const bStrength = typeof b.strength === "number" ? b.strength : (b.status === "weak" ? 0.4 : 0);
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
    if (typeof b.strength === "number") return b.strength < STRENGTH_THRESHOLDS.covered;
    // Status-based: needs work if not covered
    return b.status !== "covered";
  };

  // If LLM specified weak elements, follow that order
  if (weakElements.length > 0) {
    for (const weakId of weakElements) {
      const beat = beats.find(b => b.id === weakId);
      if (beat && needsWork(beat)) {
        return beat;
      }
    }
  }

  // Fallback: pick required beat with lowest strength
  const uncovered = beats
    .filter(b => b.required !== false && needsWork(b));

  if (uncovered.length === 0) return null;

  // Sort by strength (lowest first), defaulting to 0 for status-based
  uncovered.sort((a, b) => {
    const aStrength = typeof a.strength === "number" ? a.strength : (a.status === "weak" ? 0.4 : 0);
    const bStrength = typeof b.strength === "number" ? b.strength : (b.status === "weak" ? 0.4 : 0);
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

module.exports = {
  SAFETY_BOUNDS,
  STRENGTH_THRESHOLDS,
  STORY_SLOT_PRIORITY,
  STORY_SLOT_WEIGHTS,
  CRITICAL_CONFIRM_SLOT_IDS,
  GAP_QUESTION_TEMPLATES,
  SLOT_GUIDANCE_TEMPLATES,
  BEAT_FALLBACK_PRIORITY,
  findHighestPriorityGap,
  getSlotGuidance,
  POEM_GAP_QUESTIONS,
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
};
