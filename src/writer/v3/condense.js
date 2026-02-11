/**
 * V3 Turn Condenser
 *
 * Condenses long user turns for reasoning without dropping core story slots.
 * Raw user text remains stored in conversation/state; this is input shaping only.
 */

const SLOT_RULES = [
  {
    slot: "who",
    weight: 2.2,
    patterns: [
      /\b(mom|mum|mother|dad|father|parent|sister|brother|friend|partner|wife|husband|fiance|fiancee|son|daughter|child|mentor|teacher|grandma|grandpa|aunt|uncle|cousin|colleague|boss)\b/i,
      /\b(my|our)\s+[A-Z][a-z]+/,
      /\bwe\b/i,
    ],
  },
  {
    slot: "where",
    weight: 1.5,
    patterns: [
      /\b(at|in|inside|outside|near|by)\s+[A-Z][a-z]+/,
      /\b(home|school|church|market|hospital|station|airport|office|village|city|street|room)\b/i,
    ],
  },
  {
    slot: "when",
    weight: 1.3,
    patterns: [
      /\b(last|next|this)\s+(year|month|week|night|morning|evening)\b/i,
      /\b(when i was|back then|that day|that night|in \d{4}|on \w+day)\b/i,
    ],
  },
  {
    slot: "want",
    weight: 1.2,
    patterns: [
      /\b(want|wanted|wish|hope|hoped|dream|goal|needed to|trying to|longed to)\b/i,
    ],
  },
  {
    slot: "blocker",
    weight: 1.5,
    patterns: [
      /\b(couldn't|could not|can't|cannot|blocked|stopped|prevented|fear|afraid|anxious|rule|secret|barrier|obstacle|struggle|conflict)\b/i,
    ],
  },
  {
    slot: "stakes",
    weight: 1.6,
    patterns: [
      /\b(lose|lost|risk|at stake|would have|if .* failed|cost|heartbroken|devastated)\b/i,
    ],
  },
  {
    slot: "turn",
    weight: 1.8,
    patterns: [
      /\b(then|after that|suddenly|everything changed|turning point|that moment|from then on)\b/i,
    ],
  },
  {
    slot: "ending_feel",
    weight: 1.0,
    patterns: [
      /\b(hopeful|proud|grateful|peaceful|healing|bittersweet|comforted|joyful|reflective)\b/i,
    ],
  },
  {
    slot: "tone",
    weight: 0.8,
    patterns: [
      /\b(cinematic|realistic|gentle|playful|raw|dramatic|poetic|romantic)\b/i,
    ],
  },
];

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "was", "were", "been", "be", "have", "has", "had",
  "do", "does", "did", "to", "of", "in", "for", "on", "with", "at", "by",
  "from", "as", "it", "its", "he", "she", "they", "them", "his", "her",
  "their", "my", "me", "i", "you", "your", "we", "us", "our", "that", "this",
  "and", "but", "if", "or", "because", "so", "than", "too", "very",
]);

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function splitSentences(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  return normalized
    .split(/(?<=[.!?])\s+|(?:\s*\n+\s*)/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function tokenize(text) {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
}

function extractCoveredSlots(sentence) {
  const covered = [];
  for (const rule of SLOT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(sentence))) {
      covered.push(rule.slot);
    }
  }
  return covered;
}

function sentenceScore(sentence, index, tokenCounts) {
  const coveredSlots = extractCoveredSlots(sentence);
  let score = 0.2;

  for (const slot of coveredSlots) {
    const rule = SLOT_RULES.find((item) => item.slot === slot);
    score += rule ? rule.weight : 0;
  }

  const tokens = tokenize(sentence);
  const noveltyBoost = tokens.reduce((sum, token) => {
    const seenCount = tokenCounts.get(token) || 0;
    return sum + (seenCount <= 1 ? 0.12 : 0.03);
  }, 0);
  score += Math.min(1.2, noveltyBoost);

  if (index === 0) score += 0.25;
  if (sentence.length >= 35 && sentence.length <= 220) score += 0.2;
  if (sentence.length < 20) score -= 0.25;
  if (sentence.length > 260) score -= 0.35;

  return {
    sentence,
    index,
    score: Number(score.toFixed(3)),
    coveredSlots,
  };
}

function buildTokenFrequency(sentences) {
  const counts = new Map();
  for (const sentence of sentences) {
    for (const token of tokenize(sentence)) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }
  return counts;
}

function pickSentences(scored, maxChars) {
  if (!Array.isArray(scored) || scored.length === 0) return [];

  const selected = [];
  const selectedSet = new Set();
  let usedChars = 0;

  const trySelect = (item) => {
    if (!item || selectedSet.has(item.index)) return false;
    const nextCost = item.sentence.length + (selected.length > 0 ? 1 : 0);
    if (usedChars + nextCost > maxChars) return false;
    selected.push(item);
    selectedSet.add(item.index);
    usedChars += nextCost;
    return true;
  };

  // 1) Ensure broad slot coverage first.
  for (const slotRule of SLOT_RULES) {
    const candidate = scored
      .filter((item) => item.coveredSlots.includes(slotRule.slot))
      .sort((a, b) => b.score - a.score || a.index - b.index)[0];
    trySelect(candidate);
  }

  // 2) Fill remaining budget by score.
  for (const item of [...scored].sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (usedChars >= maxChars) break;
    trySelect(item);
  }

  return selected.sort((a, b) => a.index - b.index);
}

function clampToWordBoundary(text, maxChars) {
  if (text.length <= maxChars) return text;
  const sliced = text.slice(0, maxChars);
  const lastSpace = sliced.lastIndexOf(" ");
  if (lastSpace < maxChars * 0.6) return sliced.trim();
  return sliced.slice(0, lastSpace).trim();
}

function slotDigest(sentencesBySlot) {
  const digestParts = [];
  for (const rule of SLOT_RULES) {
    const value = sentencesBySlot[rule.slot];
    if (!value) continue;
    digestParts.push(`${rule.slot}: ${value}`);
  }
  return digestParts.join(" | ");
}

function condenseForReasoning(rawInput, options = {}) {
  const normalized = normalizeText(rawInput);
  const maxChars = Number.isFinite(Number(options.maxChars))
    ? Math.max(240, Number(options.maxChars))
    : 1800;

  if (!normalized) {
    return {
      text: "",
      metadata: {
        strategy: "empty",
        original_chars: 0,
        condensed_chars: 0,
        retained_slots: [],
      },
    };
  }

  if (normalized.length <= maxChars) {
    const directSlots = [...new Set(extractCoveredSlots(normalized))];
    return {
      text: normalized,
      metadata: {
        strategy: "pass_through",
        original_chars: normalized.length,
        condensed_chars: normalized.length,
        retained_slots: directSlots,
      },
    };
  }

  const sentences = splitSentences(normalized);
  if (sentences.length === 0) {
    return {
      text: clampToWordBoundary(normalized, maxChars),
      metadata: {
        strategy: "boundary_clamp",
        original_chars: normalized.length,
        condensed_chars: Math.min(normalized.length, maxChars),
        retained_slots: [],
      },
    };
  }

  const tokenCounts = buildTokenFrequency(sentences);
  const scored = sentences.map((sentence, index) => sentenceScore(sentence, index, tokenCounts));
  const picked = pickSentences(scored, Math.max(180, Math.floor(maxChars * 0.72)));

  const condensedBody = picked.map((item) => item.sentence).join(" ");
  const retainedSlots = [...new Set(picked.flatMap((item) => item.coveredSlots))];

  const slotSentenceMap = {};
  for (const rule of SLOT_RULES) {
    const candidate = scored
      .filter((item) => item.coveredSlots.includes(rule.slot))
      .sort((a, b) => b.score - a.score || a.index - b.index)[0];
    if (candidate) {
      slotSentenceMap[rule.slot] = clampToWordBoundary(candidate.sentence, 110);
    }
  }
  const digest = slotDigest(slotSentenceMap);

  let text = condensedBody;
  if (digest) {
    const digestPrefix = "Key details: ";
    const allowedDigest = clampToWordBoundary(digest, Math.floor(maxChars * 0.32));
    text = `${condensedBody} ${digestPrefix}${allowedDigest}`.trim();
  }

  if (text.length > maxChars) {
    text = clampToWordBoundary(text, maxChars);
  }

  if (!text) {
    text = clampToWordBoundary(normalized, maxChars);
  }

  return {
    text,
    metadata: {
      strategy: "slot_weighted_extract",
      original_chars: normalized.length,
      condensed_chars: text.length,
      retained_slots: retainedSlots,
      sentence_count_original: sentences.length,
      sentence_count_condensed: picked.length,
    },
  };
}

module.exports = {
  condenseForReasoning,
};
