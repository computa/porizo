"use strict";

/**
 * Poem readiness gap questions
 */
const POEM_GAP_QUESTIONS = {
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
      return POEM_GAP_QUESTIONS.turn;
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
      return POEM_GAP_QUESTIONS.context;
    case "emotion":
      if (context.turningDetail) {
        return `When ${context.turningDetail} happened, what feeling hit you hardest — gratitude, surprise, being seen, something else?`;
      }
      if (context.emotionalCue) {
        return `You’ve described the moment as ${context.emotionalCue}. What feeling underneath that do you most want the poem to hold onto?`;
      }
      return POEM_GAP_QUESTIONS.emotion;
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
      return POEM_GAP_QUESTIONS.narrative;
    default:
      return (
        POEM_GAP_QUESTIONS[gapId] ||
        POEM_GAP_QUESTIONS.narrative
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

module.exports = {
  POEM_GAP_QUESTIONS,
  buildPoemGapQuestion,
  evaluatePoemReadiness,
};
