/**
 * Narrative utilities
 *
 * Detects append-style updates so we can enforce full story rewrites.
 *
 * @module writer/v3/narrative
 */

function normalizeText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isFactActive(fact) {
  if (!fact || typeof fact !== "object") return false;
  if (typeof fact.text !== "string" || !fact.text.trim()) return false;
  return (fact.status || "active") === "active";
}

function getActiveFacts(facts) {
  return (Array.isArray(facts) ? facts : []).filter(isFactActive);
}

function splitSentences(text) {
  return normalizeText(text)
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function ensureSentence(text) {
  const trimmed = normalizeText(text);
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function stripLeadingFillers(text) {
  const trimmed = normalizeText(text);
  const fillers = [
    "i think",
    "i remember",
    "i recall",
    "we remember",
    "we recall",
    "it was",
    "there was",
    "there were",
    "we were",
    "we had",
    "she was",
    "he was",
    "they were",
  ];

  for (const filler of fillers) {
    if (trimmed.toLowerCase().startsWith(filler + " ")) {
      return trimmed.slice(filler.length).trim();
    }
  }
  return trimmed;
}

function distillFact(text, maxWords = 16) {
  const cleaned = stripLeadingFillers(String(text || ""));
  if (!cleaned) return "";

  const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0] || cleaned;
  const words = firstSentence.split(/\s+/);
  if (words.length <= maxWords) {
    return firstSentence.replace(/\s+/g, " ").trim();
  }
  return words.slice(0, maxWords).join(" ").trim() + "...";
}

function hasDigits(text) {
  return /\d/.test(text || "");
}

function hasCapitalizedWord(text) {
  const words = String(text || "").split(/\s+/);
  return words.some(word => /^[A-Z][a-z]+/.test(word));
}

function selectAnchorFacts(facts, maxAnchors = 3) {
  const candidates = getActiveFacts(facts).map(f => f.text);

  const scored = candidates.map(text => {
    const score =
      (hasDigits(text) ? 3 : 0) +
      (hasCapitalizedWord(text) ? 2 : 0) +
      Math.min(text.length / 80, 1);
    return { text, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxAnchors)
    .map(item => item.text);
}

function significantTokens(text) {
  const stop = new Set([
    "this", "that", "with", "from", "into", "over", "under", "about",
    "their", "there", "they", "them", "when", "where", "what", "which",
    "have", "has", "had", "been", "being", "were", "was", "are", "and",
    "the", "for", "but", "your", "yours", "our", "ours", "her", "his",
    "she", "him", "who", "then", "than", "after", "before", "during",
  ]);
  return String(text || "")
    .toLowerCase()
    .replace(/[.,!?;:'"]/g, "")
    .split(/\s+/)
    .filter(token => token.length >= 4 && !stop.has(token));
}

function narrativeCoversAnchors(narrative, anchors, minCoverage = 1) {
  const narrativeText = normalizeText(narrative).toLowerCase();
  if (!narrativeText) return false;

  let covered = 0;
  for (const anchor of anchors) {
    const distilled = distillFact(anchor, 12);
    if (!distilled) continue;
    if (narrativeText.includes(distilled.toLowerCase())) {
      covered += 1;
      continue;
    }

    const tokens = significantTokens(distilled);
    const overlap = tokens.filter(token => narrativeText.includes(token)).length;
    if (overlap >= 2) {
      covered += 1;
    }
  }

  return covered >= minCoverage;
}

/**
 * Detects append-style narrative updates.
 *
 * Heuristic:
 * - strict prefix with meaningful delta OR
 * - high sentence overlap with extra sentences appended
 *
 * @param {string} previous
 * @param {string} next
 * @returns {boolean}
 */
function isAppendStyleNarrative(previous, next) {
  const prev = normalizeText(previous);
  const nextText = normalizeText(next);

  if (!prev || !nextText) return false;
  if (prev.length >= 80 && nextText.startsWith(prev)) {
    const delta = nextText.length - prev.length;
    if (delta >= 20) return true;
  }

  const prevSentences = splitSentences(prev);
  const nextSentences = splitSentences(nextText);

  if (prevSentences.length < 2 || nextSentences.length <= prevSentences.length) {
    return false;
  }

  const prevSet = new Set(prevSentences.map(sentence => sentence.toLowerCase()));
  const overlap = nextSentences.filter(sentence => prevSet.has(sentence.toLowerCase())).length;
  const overlapRatio = overlap / prevSentences.length;

  return overlapRatio >= 0.7;
}

/**
 * Compose a narrative from existing facts (deterministic fallback).
 *
 * @param {Object} state
 * @returns {string}
 */
function composeNarrativeFromFacts(state, options = {}) {
  const recipient = normalizeText(state?.recipient_name || "");
  const occasion = normalizeText(state?.event?.occasion || "");
  const facts = getActiveFacts(state?.facts || []);
  const maxFacts = options.maxFacts ?? 9;
  const maxSentences = options.maxSentences ?? 9;
  const maxFactWords = options.maxFactWords ?? 30;
  const atoms = state?.atoms || {};
  const motifs = Array.isArray(state?.motifs) ? state.motifs : [];

  if (facts.length === 0) return "";

  const beatOrder = [
    "context",
    "scene",
    "who",
    "relationship",
    "meeting",
    "moment",
    "discovery",
    "struggle",
    "stakes",
    "turning_point",
    "impact",
    "meaning",
    "detail",
  ];

  const seenFactIds = new Set();
  const chronologicalFacts = [...facts].sort(
    (a, b) => (a.source_turn || 0) - (b.source_turn || 0)
  );
  const selectedFacts = [];

  for (const beatId of beatOrder) {
    const candidate = chronologicalFacts.find((fact) => {
      if (seenFactIds.has(fact.id)) return false;
      return normalizeText(fact.beat).toLowerCase() === beatId;
    });
    if (!candidate) continue;
    selectedFacts.push(candidate);
    seenFactIds.add(candidate.id);
    if (selectedFacts.length >= maxFacts) break;
  }

  const latestTurn = chronologicalFacts.reduce(
    (maxTurn, fact) => Math.max(maxTurn, Number(fact.source_turn || 0)),
    0
  );
  const latestFacts = chronologicalFacts.filter(
    (fact) => Number(fact.source_turn || 0) === latestTurn
  );
  for (const fact of latestFacts) {
    if (selectedFacts.length >= maxFacts) break;
    if (seenFactIds.has(fact.id)) continue;
    selectedFacts.push(fact);
    seenFactIds.add(fact.id);
  }

  for (const fact of chronologicalFacts) {
    if (selectedFacts.length >= maxFacts) break;
    if (seenFactIds.has(fact.id)) continue;
    selectedFacts.push(fact);
    seenFactIds.add(fact.id);
  }

  const sentences = [];
  const subject = normalizeText(atoms.who || recipient);
  if (recipient || occasion || subject) {
    const occasionText = occasion || "special occasion";
    const subjectText = subject || recipient || "someone I care about";
    sentences.push(
      ensureSentence(`This ${occasionText} story is about ${subjectText}`)
    );
  }

  const whereText = normalizeText(atoms.where || "");
  const whenText = normalizeText(atoms.when || "");
  if (whereText || whenText) {
    const timePiece = whenText ? ` ${whenText}` : "";
    const placePiece = whereText ? ` in ${whereText}` : "";
    sentences.push(ensureSentence(`I remember it happened${timePiece}${placePiece}`.trim()));
  }

  const normalizeFactSentence = (factText) => {
    const cleaned = normalizeText(factText);
    if (!cleaned) return "";
    const words = cleaned.split(/\s+/);
    if (words.length <= maxFactWords) return cleaned;
    return `${words.slice(0, maxFactWords).join(" ")}...`;
  };

  const factToSentence = (fact) => {
    const beat = normalizeText(fact?.beat).toLowerCase();
    const text = normalizeFactSentence(fact?.text);
    if (!text) return "";

    if (beat === "turning_point") {
      return ensureSentence(
        /^the turning point/i.test(text) ? text : `The turning point was ${text}`
      );
    }
    if (beat === "stakes") {
      return ensureSentence(/^what was at stake/i.test(text) ? text : `What was at stake was ${text}`);
    }
    if (beat === "meaning") {
      return ensureSentence(/^to me/i.test(text) ? text : `To me, ${text}`);
    }
    if (beat === "impact") {
      return ensureSentence(/^after/i.test(text) ? text : `After that, ${text}`);
    }
    if (beat === "struggle") {
      return ensureSentence(/^the hardest part/i.test(text) ? text : `The hardest part was ${text}`);
    }
    return ensureSentence(text);
  };

  for (const fact of selectedFacts) {
    if (sentences.length >= maxSentences) break;
    const sentence = factToSentence(fact);
    if (sentence) {
      sentences.push(sentence);
    }
  }

  if (sentences.length < maxSentences) {
    const motif = normalizeText(
      motifs[0] ||
        atoms.object ||
        atoms.sound ||
        atoms.smell ||
        atoms.action ||
        atoms.physical ||
        ""
    );
    if (motif) {
      sentences.push(ensureSentence(`That detail still stays with me: ${motif}`));
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const sentence of sentences) {
    const normalized = normalizeText(sentence).toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(sentence);
  }

  return deduped.slice(0, maxSentences).join(" ");
}

function hasRecipientAnchor(narrative, recipientName) {
  const narrativeText = normalizeText(narrative).toLowerCase();
  const recipientText = normalizeText(recipientName).toLowerCase();
  if (!recipientText) return true;
  return narrativeText.includes(recipientText);
}

function hasFirstPersonVoice(narrative) {
  const narrativeText = normalizeText(narrative).toLowerCase();
  if (!narrativeText) return false;
  return /\b(i|we|my|our|me|us)\b/.test(narrativeText);
}

module.exports = {
  isAppendStyleNarrative,
  composeNarrativeFromFacts,
  getActiveFacts,
  hasRecipientAnchor,
  hasFirstPersonVoice,
  selectAnchorFacts,
  narrativeCoversAnchors,
};
