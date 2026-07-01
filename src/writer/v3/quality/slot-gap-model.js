/**
 * Slot-based gap model for legacy V3 story readiness.
 *
 * This module owns deterministic slot priority, fallback guidance, and
 * slot-level confirmation coverage so quality.js can remain a compatibility
 * facade instead of owning the full legacy evaluator.
 */

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

function sortByPriority(slots, priorityOrder = STORY_SLOT_PRIORITY) {
  const slotSet = new Set(slots);
  return priorityOrder.filter((slot) => slotSet.has(slot));
}

/**
 * Pick a deterministic next question from gap analysis.
 *
 * @param {Object} gapAnalysis - Output from computeStoryGapAnalysis
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

module.exports = {
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
};
