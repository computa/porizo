const { clamp } = require("./story-gap-analysis");

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

module.exports = {
  STORY_ELEMENT_DEFINITIONS,
  REFLECTIVE_STORY_ELEMENT_DEFINITIONS,
  ELEMENT_CONFIRM_THRESHOLD,
  getStoryElementDefinitions,
  getElementForSlot,
  computeStoryElements,
  getElementConfirmBlock,
};
