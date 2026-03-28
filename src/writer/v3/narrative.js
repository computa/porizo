/**
 * Narrative utilities
 *
 * Detects append-style updates so we can enforce full story rewrites.
 *
 * @module writer/v3/narrative
 */

const { normalizeText } = require("./utils");

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
  const maxFacts = options.maxFacts ?? 12;
  const maxSentences = options.maxSentences ?? 9;
  const maxFactWords = options.maxFactWords ?? 30;
  const atoms = state?.atoms || {};
  const motifs = Array.isArray(state?.motifs) ? state.motifs : [];

  if (facts.length === 0) return "";

  const beatOrder = [
    "context",
    "scene",
    "who",
    "turning_point",
    "impact",
    "meaning",
    "relationship",
    "moment",
    "struggle",
    "stakes",
    "meeting",
    "discovery",
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
  const rawSubject = normalizeText(atoms.who || recipient);
  const subject = recipient && /\b(i|my|mine|me|we|our|us)\b/i.test(rawSubject)
    ? recipient
    : rawSubject;
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
    sentences.push(ensureSentence(`It happened${timePiece}${placePiece}`.trim()));
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
      return ensureSentence(/^what this means/i.test(text) ? text : `What this means is ${text}`);
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
      sentences.push(ensureSentence(`That detail still stands out: ${motif}`));
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

function normalizePovMode(rawPov) {
  const value = normalizeText(rawPov).toLowerCase();
  if (!value) return "recipient";

  if (
    value === "first" ||
    value === "first_person" ||
    value === "first-person" ||
    value === "self"
  ) {
    return "first_person";
  }
  if (
    value === "third" ||
    value === "third_person" ||
    value === "third-person"
  ) {
    return "third_person";
  }
  if (
    value === "second" ||
    value === "second_person" ||
    value === "second-person" ||
    value === "recipient" ||
    value === "recipient_focused" ||
    value === "recipient-focused"
  ) {
    return "recipient";
  }
  if (value.includes("first")) return "first_person";
  if (value.includes("third")) return "third_person";
  if (value.includes("second") || value.includes("recipient") || value.includes("you")) {
    return "recipient";
  }
  return "recipient";
}

function resolveDesiredNarrativePov(input) {
  if (typeof input === "string") {
    return normalizePovMode(input);
  }
  return normalizePovMode(input?.dials?.pov);
}

function hasFirstPersonVoice(narrative) {
  const narrativeText = normalizeText(narrative).toLowerCase();
  if (!narrativeText) return false;
  return /\b(i|we|my|our|me|us)\b/.test(narrativeText);
}

function hasRecipientVoice(narrative, recipientName) {
  const narrativeText = normalizeText(narrative).toLowerCase();
  if (!narrativeText) return false;
  if (/\b(you|your|yours)\b/.test(narrativeText)) return true;
  return hasRecipientAnchor(narrativeText, recipientName);
}

function narrativeNeedsPovAlignment(narrative, recipientName, desiredPov = "recipient") {
  const pov = normalizePovMode(desiredPov);
  if (!narrative || !normalizeText(narrative)) return false;

  if (pov === "first_person") {
    return !hasFirstPersonVoice(narrative);
  }

  if (pov === "third_person") {
    return hasFirstPersonVoice(narrative) || !hasRecipientAnchor(narrative, recipientName);
  }

  return hasFirstPersonVoice(narrative) || !hasRecipientVoice(narrative, recipientName);
}

function applyCase(template, replacement) {
  if (!template) return replacement;
  if (template.length > 1 && template.toUpperCase() === template) {
    return replacement.toUpperCase();
  }
  if (template[0] === template[0].toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function rewriteNarrativeToRecipientFocus(narrative, recipientName) {
  const text = normalizeText(narrative);
  if (!text) return text;

  const recipient = normalizeText(recipientName) || "the recipient";
  const possessive = recipient.endsWith("s") ? `${recipient}'` : `${recipient}'s`;
  const replacements = [
    { pattern: /\bI am\b/gi, value: `${recipient} is` },
    { pattern: /\bI'm\b/gi, value: `${recipient} is` },
    { pattern: /\bI was\b/gi, value: `${recipient} was` },
    { pattern: /\bI\b/gi, value: recipient },
    { pattern: /\bme\b/gi, value: recipient },
    { pattern: /\bmy\b/gi, value: possessive },
    { pattern: /\bmine\b/gi, value: possessive },
    { pattern: /\bwe are\b/gi, value: `${recipient} and loved ones are` },
    { pattern: /\bwe were\b/gi, value: `${recipient} and loved ones were` },
    { pattern: /\bwe\b/gi, value: recipient },
    { pattern: /\bus\b/gi, value: recipient },
    { pattern: /\bour\b/gi, value: possessive },
    { pattern: /\bours\b/gi, value: possessive },
  ];

  let next = text;
  for (const { pattern, value } of replacements) {
    next = next.replace(pattern, (match) => applyCase(match, value));
  }
  return next;
}

module.exports = {
  isAppendStyleNarrative,
  composeNarrativeFromFacts,
  getActiveFacts,
  hasRecipientAnchor,
  hasFirstPersonVoice,
  narrativeNeedsPovAlignment,
  resolveDesiredNarrativePov,
  rewriteNarrativeToRecipientFocus,
  selectAnchorFacts,
  narrativeCoversAnchors,
};
