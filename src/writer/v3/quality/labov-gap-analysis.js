/**
 * Labov 6-element gap analysis for V3 story questioning.
 *
 * This module is dependency-injected by quality.js so the public quality API can
 * stay stable while the large deterministic Labov evaluator lives in a leaf.
 */

/**
 * Reverse mapping: slot name -> Labov element.
 * Used for element-level comparison when Labov scoring is active.
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

const ORIENTATION_REGEX =
  /\b(met|lived|grew up|moved to|born|raised|since|college|school|park|kitchen|airport|home|house|summer|winter|year|day|night|morning|childhood)\b/i;
const COMPLICATING_REGEX =
  /\b(changed|suddenly|then|happened|showed up|found out|realized|broke|left|lost|arrived|called|ran|fell|crashed|woke|fought|discovered|everything changed)\b/i;
const RESOLUTION_REGEX =
  /\b(now|today|since then|from that day|looking back|still|always will|never forgot|became|forgave|healed|stronger|better)\b/i;

const LABOV_DEFAULT_WEIGHTS = {
  orientation: 0.2,
  complicating_action: 0.25,
  evaluation: 0.35,
  resolution: 0.1,
  coda: 0.05,
  specificity_bonus: 0.05,
};

function createComputeLabovGapAnalysis({
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
}) {
  function isTributeOccasion(occasion) {
    if (!occasion) return false;
    const normalized = normalizeOccasion(occasion);
    return (
      TRIBUTE_OCCASION_REGEX.test(normalized) ||
      normalized === "thank-you" ||
      normalized === "thank_you"
    );
  }

  function labovStatus(strength) {
    if (strength >= STRENGTH_THRESHOLDS.covered) return "covered";
    if (strength >= STRENGTH_THRESHOLDS.weak) return "weak";
    return "missing";
  }

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

    const factCorpus = facts.map((f) => f.text || "").join(" ");
    const totalProperNouns = factCorpus
      .split(/\s+/)
      .filter((w, i) => i > 0 && /^[A-Z][a-z]/.test(w)).length;

    const hasSensory =
      SENSORY_REGEX.test(corpus) ||
      SENSORY_REGEX.test(factCorpus.toLowerCase());
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

  return function computeLabovGapAnalysis(state, options = {}) {
    const corpus = buildCorpus(state);
    const storyMode = isReflectiveTributeStory(state, corpus)
      ? "reflective_tribute"
      : "default";

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
      occasionAdjustment = "celebration: orientation 0.20->0.30, complicating_action 0.25->0.10, evaluation 0.35->0.45, resolution 0.10->0.05";
    } else if (isTribute) {
      weights.resolution = 0.05;
      weights.evaluation = 0.4;
      occasionAdjustment = "tribute: resolution 0.10->0.05, evaluation 0.35->0.40";
    }

    const rawElements = [
      evaluateLabovOrientation(state, corpus),
      evaluateLabovComplicatingAction(state, corpus),
      evaluateLabovEvaluation(state, corpus),
      evaluateLabovResolution(state, corpus),
      evaluateLabovCoda(state, corpus),
      evaluateLabovSpecificityBonus(state, corpus),
    ];

    const elements = rawElements.map((el) => ({
      ...el,
      weight: weights[el.element],
    }));

    const weightedScore = Number(
      elements.reduce((sum, el) => sum + el.strength * el.weight, 0).toFixed(2),
    );

    const labovSlots = mapLabovToSlots(rawElements);
    const missingSlots = labovSlots
      .filter((s) => s.status === "missing")
      .map((s) => s.slot);
    const weakSlots = labovSlots
      .filter((s) => s.status === "weak")
      .map((s) => s.slot);

    const readinessScore = weightedScore;
    const coreTrio = rawElements.filter((e) =>
      ["orientation", "complicating_action", "evaluation"].includes(e.element),
    );
    const coreTrioCovered = coreTrio.every(
      (e) => e.strength >= STRENGTH_THRESHOLDS.covered,
    );
    const isStoryReady = readinessScore >= 0.6 || coreTrioCovered;

    const turnCount = options.turnCount ?? null;
    const canProceedAnyway = typeof turnCount === "number" && turnCount >= 2;

    const noSafetyBlock = !(
      state?.last_reasoning?.safety?.blocked === true ||
      state?.last_reasoning?.safety?.requires_refusal === true ||
      state?.last_reasoning?.safety_violation === true
    );

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
  };
}

module.exports = {
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
};
