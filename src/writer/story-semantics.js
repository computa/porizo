const { isDeepStrictEqual } = require("node:util");

const STORY_BLOCKS = Object.freeze(["setup", "conflict", "turn", "transformation", "meaning"]);

const BLOCK_ORDER = Object.freeze({
  setup: 0,
  conflict: 1,
  turn: 2,
  transformation: 3,
  meaning: 4,
});

const SECTION_TARGETS = Object.freeze({
  hook: ["meaning", "setup"],
  verse1: ["setup"],
  pre: ["conflict", "turn"],
  chorus: ["meaning"],
  verse2: ["turn", "conflict"],
  bridge: ["transformation", "meaning", "turn"],
  key_lines: ["meaning", "transformation", "turn"],
});

const BLOCK_PHRASES = Object.freeze({
  setup: [
    ["our family", 3],
    ["every day", 3],
    ["day to day", 3],
    ["morning to night", 4],
    ["used to", 2],
    ["we met", 3],
    ["the house", 3],
    ["home", 2],
    ["family", 2],
    ["children", 2],
    ["appointments", 3],
    ["meals", 3],
    ["work", 2],
    ["routine", 2],
    ["kitchen", 2],
    ["school", 2],
    ["road", 1],
    ["street", 1],
    ["trip", 1],
    ["room", 1],
  ],
  conflict: [
    ["fear", 4],
    ["pain", 4],
    ["uncertainty", 4],
    ["bleeding", 5],
    ["worry", 4],
    ["pressure", 3],
    ["struggle", 3],
    ["distance", 3],
    ["loss", 4],
    ["broke", 4],
    ["burden", 3],
    ["hard", 2],
    ["difficult", 3],
    ["risk", 3],
    ["hospital", 3],
  ],
  turn: [
    ["changed everything", 6],
    ["then", 2],
    ["after that", 3],
    ["suddenly", 3],
    ["that day", 4],
    ["the moment", 4],
    ["when we heard", 4],
    ["when it happened", 4],
    ["never forget", 5],
    ["decided", 3],
    ["realized", 3],
    ["news", 2],
  ],
  transformation: [
    ["grow into", 6],
    ["grew into", 6],
    ["became", 4],
    ["become", 3],
    ["grow", 3],
    ["grew", 3],
    ["stronger", 3],
    ["transformed", 4],
    ["learned to", 4],
    ["healed", 4],
    ["closer", 3],
    ["opened up", 4],
    ["found your voice", 5],
    ["found my voice", 5],
    ["made me love", 5],
    ["respect you even more", 6],
    ["watched you", 3],
    ["strong woman", 6],
    ["stronger woman", 6],
    ["rose to", 5],
  ],
  meaning: [
    ["what it meant", 6],
    ["love in action", 7],
    ["sacrifice", 7],
    ["motherhood", 5],
    ["grateful", 5],
    ["appreciate", 5],
    ["thank you", 5],
    ["thankful", 5],
    ["promise", 4],
    ["proud", 4],
    ["forever", 3],
    ["home", 3],
    ["heart of our family", 6],
    ["respect", 3],
    ["love", 3],
    ["means", 3],
    ["meant", 3],
    ["real home", 5],
    ["future", 3],
    ["dream come true", 1],
    ["blooms in", 0.5],
    ["blooming", 0.5],
  ],
});

const LOW_INFORMATION_PATTERNS = Object.freeze([
  /dream come true/i,
  /\bblooms?\b/i,
  /\bstarted in\b/i,
]);

const BLOCK_PATTERNS = Object.freeze({
  setup: [
    /\b(every day|day to day|morning to night|used to|we met|the house|the home|our home|routine)\b/i,
    /\b(home|family|children|child|kitchen|work|school|street|road|room|table|meal|appointment)s?\b/i,
  ],
  conflict: [
    /\b(fear|pain|worry|worried|uncertainty|pressure|struggle|struggled|risk|risky|distance|loss|lost|broke|broken|hard|difficult|hospital|bleeding|scared|alone|burden)\b/i,
  ],
  turn: [
    /\b(changed everything|that day|the moment|after that|suddenly|then|until|when we heard|when it happened|never forget|decided|realized|the news)\b/i,
  ],
  transformation: [
    /\b(grow|grew|growing|become|became|becoming|stronger|transformed|heal|healed|healing|closer|opened up|found your voice|found my voice|rise|rose|changed me|changed us|made me love|respect)\b/i,
  ],
  meaning: [
    /\b(love|grateful|thankful|thank you|appreciate|appreciation|sacrifice|motherhood|fatherhood|friendship|promise|proud|respect|home|meaning|means|meant|future|forever|heart|gift|blessing)\b/i,
  ],
});

const TRANSFORMATION_WORDS = /\b(grow|grew|become|became|stronger|transformed|respect|admire|grace|courage|heal|healed|closer|learned|learn)\b/i;
const MEANING_WORDS = /\b(grateful|appreciate|sacrifice|motherhood|fatherhood|home|love|respect|warmth|care|structure|meaning|thank|promise|proud|future)\b/i;

function sanitizeText(text) {
  if (typeof text !== "string") return "";
  return text.replace(/\s+/g, " ").trim();
}

function splitStorySentences(text) {
  return sanitizeText(text)
    .split(/(?<=[.!?])\s+/)
    .map((part) => sanitizeText(part))
    .filter(Boolean);
}

function factText(fact) {
  if (!fact) return "";
  return typeof fact === "string" ? fact : fact.text || "";
}

function normalizeKey(text) {
  return sanitizeText(text).toLowerCase();
}

function addPhraseScores(text, scores) {
  const lower = normalizeKey(text);
  for (const block of STORY_BLOCKS) {
    for (const [phrase, weight] of BLOCK_PHRASES[block]) {
      if (lower.includes(phrase)) {
        scores[block] += weight;
      }
    }
  }
}

function addPatternScores(text, scores) {
  for (const block of STORY_BLOCKS) {
    for (const pattern of BLOCK_PATTERNS[block] || []) {
      if (pattern.test(text)) {
        scores[block] += 2.5;
      }
    }
  }
}

function addSourceBoosts(candidate, scores) {
  const sourceType = candidate.sourceType || "";
  const beat = String(candidate.beat || "").toLowerCase();

  if (sourceType === "primitive_resolution" || sourceType === "primitive_theme" || sourceType === "atom_after") {
    scores.meaning += 6;
  }
  if (sourceType === "primitive_turn" || sourceType === "atom_turn") {
    scores.turn += 6;
  }
  if (sourceType === "atom_action") {
    scores.setup += 3;
  }
  if (sourceType === "initial_prompt") {
    scores.setup += 0.5;
    scores.meaning += 0.5;
  }

  if (["context", "scene", "meeting", "relationship", "who"].includes(beat)) scores.setup += 4;
  if (["struggle", "stakes", "blocker"].includes(beat)) scores.conflict += 4;
  if (["turning_point", "moment"].includes(beat)) scores.turn += 5;
  if (["impact", "meaning", "detail"].includes(beat)) scores.meaning += 4;
}

function penalizeLowInformation(text, scores) {
  for (const pattern of LOW_INFORMATION_PATTERNS) {
    if (pattern.test(text)) {
      scores.meaning -= 2.5;
      scores.transformation -= 2;
    }
  }
}

function computeBlockScores(candidate) {
  const scores = {
    setup: 0,
    conflict: 0,
    turn: 0,
    transformation: 0,
    meaning: 0,
  };
  const text = sanitizeText(candidate.text);
  if (!text) return scores;

  addPhraseScores(text, scores);
  addPatternScores(text, scores);
  addSourceBoosts(candidate, scores);
  penalizeLowInformation(text, scores);

  if (TRANSFORMATION_WORDS.test(text)) scores.transformation += 1.5;
  if (MEANING_WORDS.test(text)) scores.meaning += 1.25;

  return scores;
}

function pickPrimaryBlock(scores) {
  let bestBlock = null;
  let bestScore = 0;
  for (const block of STORY_BLOCKS) {
    const score = Number(scores?.[block] || 0);
    if (score > bestScore) {
      bestBlock = block;
      bestScore = score;
    }
  }
  return { block: bestBlock, score: bestScore };
}

function pushCandidate(target, candidate) {
  const text = sanitizeText(candidate.text);
  if (!text) return;
  const key = normalizeKey(text);
  if (target.seen.has(key)) return;
  target.seen.add(key);
  target.items.push(candidate);
}

function gatherSourceCandidates(context) {
  const items = [];
  const seen = new Set();
  const facts = Array.isArray(context?.facts) ? context.facts : [];

  const push = (candidate) => pushCandidate({ items, seen }, candidate);

  splitStorySentences(context?.initial_prompt || context?.message || "")
    .forEach((sentence) => push({ text: sentence, sourceType: "initial_prompt", factIds: [] }));

  for (const fact of facts) {
    const text = sanitizeText(factText(fact));
    if (!text) continue;
    const factIds = fact?.id ? [String(fact.id)] : [];
    const sourceType = "fact";
    const beat = fact?.beat || "";
    const snippets = text.length > 220 ? splitStorySentences(text) : [text];
    for (const snippet of snippets) {
      push({ text: snippet, sourceType, factIds, beat });
    }
  }

  splitStorySentences(context?.summary_text || context?.narrative || "")
    .forEach((sentence) => push({ text: sentence, sourceType: "narrative", factIds: [] }));

  const primitives = context?.primitives || {};
  const atoms = context?.atoms || {};

  const primitiveEntries = [
    ["primitive_resolution", primitives.resolution],
    ["primitive_theme", primitives.theme],
    ["primitive_turn", primitives.turning_point],
    ["atom_after", atoms.after],
    ["atom_turn", atoms.turn],
    ["atom_action", atoms.action],
  ];
  for (const [sourceType, text] of primitiveEntries) {
    if (sanitizeText(text)) push({ text, sourceType, factIds: [] });
  }

  return items;
}

function deriveStoryBlockProfile(context = {}) {
  const candidates = gatherSourceCandidates(context).map((candidate) => {
    const scores = computeBlockScores(candidate);
    const primary = pickPrimaryBlock(scores);
    return {
      ...candidate,
      scores,
      primaryBlock: primary.block,
      primaryScore: primary.score,
    };
  });

  const blocks = {};
  for (const block of STORY_BLOCKS) {
    const ranked = candidates
      .filter((candidate) => Number(candidate.scores[block] || 0) >= 2)
      .sort((a, b) => {
        const diff = Number(b.scores[block] || 0) - Number(a.scores[block] || 0);
        if (diff !== 0) return diff;
        return Number(b.primaryScore || 0) - Number(a.primaryScore || 0);
      });
    blocks[block] = {
      present: ranked.length > 0,
      primary: ranked[0] || null,
      candidates: ranked.slice(0, 8),
    };
  }

  const requiredBlocks = STORY_BLOCKS.filter((block) => blocks[block].present);
  const enforcedNarrativeBlocks = requiredBlocks.length >= 4
    ? requiredBlocks
    : requiredBlocks.filter((block) => ["turn", "transformation", "meaning"].includes(block));
  return {
    richStory: requiredBlocks.length >= 4,
    requiredBlocks,
    enforcedNarrativeBlocks,
    blocks,
  };
}

function evaluateNarrativeBlockCoverage(narrative, blockProfile) {
  const sentences = splitStorySentences(narrative || "").map((sentence) => {
    const scores = computeBlockScores({ text: sentence, sourceType: "narrative_sentence", factIds: [] });
    const primary = pickPrimaryBlock(scores);
    const matchedBlocks = STORY_BLOCKS.filter((block) => Number(scores?.[block] || 0) >= 2)
      .sort((a, b) => (Number(scores?.[b] || 0) - Number(scores?.[a] || 0)) || (BLOCK_ORDER[a] - BLOCK_ORDER[b]));
    return {
      text: sentence,
      scores,
      primaryBlock: primary.score >= 2 ? primary.block : null,
      primaryScore: primary.score,
      matchedBlocks,
    };
  });

  const coverage = {};
  const coveredBlocks = new Set();
  for (const block of blockProfile?.requiredBlocks || []) {
    const sentence = sentences.find((entry) => (entry.matchedBlocks || []).includes(block));
    coverage[block] = {
      covered: Boolean(sentence),
      sentence: sentence?.text || "",
    };
    if (sentence) coveredBlocks.add(block);
  }

  const enforcedNarrativeBlocks = Array.isArray(blockProfile?.enforcedNarrativeBlocks)
    ? blockProfile.enforcedNarrativeBlocks
    : (blockProfile?.requiredBlocks || []);
  return {
    sentences,
    coverage,
    coveredBlocks: [...coveredBlocks],
    unmatchedSentences: sentences.filter((entry) => !entry.matchedBlocks?.length).map((entry) => entry.text),
    missingBlocks: enforcedNarrativeBlocks.filter((block) => !coveredBlocks.has(block)),
  };
}

function ensureSentence(text) {
  const normalized = sanitizeText(text);
  if (!normalized) return "";
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function repairNarrativeFromBlockProfile(narrative, blockProfile) {
  const existing = evaluateNarrativeBlockCoverage(narrative, blockProfile);
  if (!blockProfile?.enforcedNarrativeBlocks?.length || existing.missingBlocks.length === 0) {
    return {
      narrative: sanitizeText(narrative),
      repaired: false,
      addedBlocks: [],
      coverage: existing,
    };
  }

  const ordered = existing.sentences.map((entry) => entry.text);
  const presentKeys = new Set(ordered.map(normalizeKey));

  for (const block of STORY_BLOCKS) {
    if (!(blockProfile.enforcedNarrativeBlocks || []).includes(block)) continue;
    if (existing.coveredBlocks.includes(block)) continue;
    const candidate = blockProfile.blocks?.[block]?.primary;
    const candidateText = ensureSentence(candidate?.text || "");
    if (candidateText && !presentKeys.has(normalizeKey(candidateText))) {
      ordered.push(candidateText);
      presentKeys.add(normalizeKey(candidateText));
    }
  }

  if (ordered.length === 0) {
    return {
      narrative: sanitizeText(narrative),
      repaired: false,
      addedBlocks: [],
      coverage: existing,
    };
  }

  return {
    narrative: ordered.join(" "),
    repaired: true,
    addedBlocks: existing.missingBlocks,
    coverage: evaluateNarrativeBlockCoverage(ordered.join(" "), blockProfile),
  };
}

function getSongMapIdea(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return sanitizeText(entry);
  if (typeof entry === "object") return sanitizeText(entry.idea || entry.text || entry.line || "");
  return "";
}

function getSongMapSourceFacts(entry, factIdSet) {
  const raw = Array.isArray(entry?.source_facts)
    ? entry.source_facts
    : Array.isArray(entry?.facts)
      ? entry.facts
      : typeof entry?.source_facts === "string"
        ? [entry.source_facts]
        : typeof entry?.facts === "string"
          ? [entry.facts]
          : [];
  return [...new Set(raw.map((value) => sanitizeText(String(value || ""))).filter((factId) => factId && (!factIdSet || factIdSet.has(factId))))];
}

function normalizeSongMapEntries(entries, factIdSet) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const idea = getSongMapIdea(entry);
      if (!idea) return null;
      return {
        idea,
        source_facts: getSongMapSourceFacts(entry, factIdSet),
      };
    })
    .filter(Boolean);
}

function inferSourceFactsForText(text, facts = [], preferredBeats = []) {
  const normalized = normalizeKey(text);
  if (!normalized) return [];
  const tokens = normalized.split(/\W+/).filter((token) => token.length > 3);
  const preferred = new Set(preferredBeats.map((beat) => String(beat || "").toLowerCase()));

  return (Array.isArray(facts) ? facts : [])
    .filter((fact) => fact && fact.id && factText(fact))
    .map((fact, index) => {
      const lower = normalizeKey(factText(fact));
      const factTokens = lower.split(/\W+/).filter((token) => token.length > 3);
      const overlap = tokens.filter((token) => factTokens.includes(token)).length;
      const beatBoost = preferred.has(String(fact.beat || "").toLowerCase()) ? 2 : 0;
      return { id: String(fact.id), score: overlap + beatBoost - (index * 0.01) };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((entry) => entry.id);
}

function classifyIdeaBlock(idea, context = {}) {
  const scores = computeBlockScores({ text: idea, sourceType: "song_map", factIds: [] });
  const primary = pickPrimaryBlock(scores);
  return {
    scores,
    primaryBlock: primary.score >= 2 ? primary.block : null,
    primaryScore: primary.score,
    lowInformation: LOW_INFORMATION_PATTERNS.some((pattern) => pattern.test(idea)),
    hasMeaningSignals: MEANING_WORDS.test(idea),
    hasTransformationSignals: TRANSFORMATION_WORDS.test(idea),
    context,
  };
}

function scoreSectionPurposeFitness(sectionName, idea, context = {}, blockProfile) {
  const effectiveBlockProfile = blockProfile || deriveStoryBlockProfile(context);
  const normalizedSection = String(sectionName || "").toLowerCase();
  const targets = SECTION_TARGETS[normalizedSection] || [];
  const classification = classifyIdeaBlock(idea, context);
  const blockScores = classification.scores;

  let score = 0;
  for (const block of targets) {
    score += Number(blockScores[block] || 0) * 2;
  }
  if (classification.primaryBlock && targets.includes(classification.primaryBlock)) {
    score += 4;
  }
  if (normalizedSection === "chorus" && classification.primaryBlock && classification.primaryBlock !== "meaning") {
    score -= 4;
  }
  if (
    normalizedSection === "bridge"
    && classification.primaryBlock
    && !["transformation", "turn"].includes(classification.primaryBlock)
    && effectiveBlockProfile?.blocks?.transformation?.present
  ) {
    score -= 4;
  }
  if (
    normalizedSection === "verse2"
    && classification.primaryBlock === "meaning"
  ) {
    score -= 3;
  }

  if (["chorus", "bridge"].includes(normalizedSection)) {
    score -= Number(blockScores.setup || 0);
    score -= Number(blockScores.conflict || 0) * 0.5;
  }
  if (normalizedSection === "chorus" && !classification.hasMeaningSignals) {
    score -= 3;
  }
  if (normalizedSection === "bridge" && !classification.hasTransformationSignals) {
    score -= 2.5;
  }
  if (classification.lowInformation && ["chorus", "bridge"].includes(normalizedSection)) {
    score -= 4;
  }

  const strongestMeaning = effectiveBlockProfile?.blocks?.meaning?.primary?.text || "";
  if (
    normalizedSection === "chorus"
    && strongestMeaning
    && normalizeKey(strongestMeaning) !== normalizeKey(idea)
    && score < 10
  ) {
    score -= 2;
  }

  return {
    score,
    ...classification,
  };
}

function buildSectionCandidatePool(sectionName, songMap, context, blockProfile, factIdSet) {
  const normalizedSection = String(sectionName || "").toLowerCase();
  const existingEntries = normalizedSection === "hook"
    ? (songMap?.hook ? [{
      idea: getSongMapIdea(songMap.hook),
      source_facts: getSongMapSourceFacts(songMap.hook, factIdSet),
    }] : [])
    : normalizeSongMapEntries(songMap?.[normalizedSection], factIdSet);
  const targets = SECTION_TARGETS[normalizedSection] || [];
  const candidates = [];
  const seen = new Set();
  const push = (entry) => {
    const idea = sanitizeText(entry?.idea || entry?.text || "");
    if (!idea) return;
    const key = normalizeKey(idea);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      idea,
      source_facts: Array.isArray(entry?.source_facts) ? [...new Set(entry.source_facts.filter(Boolean))] : [],
    });
  };

  existingEntries.forEach(push);

  for (const block of targets) {
    for (const candidate of blockProfile?.blocks?.[block]?.candidates || []) {
      push({
        idea: candidate.text,
        source_facts: candidate.factIds?.length
          ? candidate.factIds
          : inferSourceFactsForText(candidate.text, context?.facts || [], block === "setup"
            ? ["context", "scene", "meeting", "relationship", "who"]
            : block === "conflict"
              ? ["struggle", "stakes", "blocker"]
              : block === "turn"
                ? ["turning_point", "moment", "impact"]
                : ["meaning", "impact", "detail"]),
      });
    }
  }

  return candidates;
}

function repairSongMapWithProfile(songMap, context = {}, options = {}) {
  const facts = Array.isArray(context?.facts) ? context.facts : [];
  const factIdSet = new Set(facts.filter((fact) => fact && fact.id).map((fact) => String(fact.id)));
  const blockProfile = options.blockProfile || deriveStoryBlockProfile(context);
  const usedTexts = new Set();
  const normalized = {
    hook: songMap?.hook ? {
      idea: getSongMapIdea(songMap.hook),
      source_facts: getSongMapSourceFacts(songMap.hook, factIdSet),
    } : null,
    verse1: normalizeSongMapEntries(songMap?.verse1, factIdSet),
    pre: normalizeSongMapEntries(songMap?.pre, factIdSet),
    chorus: normalizeSongMapEntries(songMap?.chorus, factIdSet),
    verse2: normalizeSongMapEntries(songMap?.verse2, factIdSet),
    bridge: normalizeSongMapEntries(songMap?.bridge, factIdSet),
    motifs: Array.isArray(songMap?.motifs) ? songMap.motifs.slice(0, 8).map((value) => sanitizeText(String(value || ""))).filter(Boolean) : [],
    key_lines: normalizeSongMapEntries(songMap?.key_lines, factIdSet),
  };

  const scores = {};
  const weakSections = [];

  const pickSectionEntries = (
    sectionName,
    {
      minEntries = 1,
      maxEntries = 2,
      excludeTexts = [],
      preferredPrimaryBlocks = [],
      allowUsedTextReuse = false,
    } = {},
  ) => {
    const preferredBlocks = new Set((Array.isArray(preferredPrimaryBlocks) ? preferredPrimaryBlocks : []).map(normalizeKey));
    const pool = buildSectionCandidatePool(sectionName, normalized, context, blockProfile, factIdSet)
      .map((entry) => ({
        ...entry,
        fitness: scoreSectionPurposeFitness(sectionName, entry.idea, context, blockProfile),
      }))
      .sort((a, b) => {
        const aPreferred = preferredBlocks.has(normalizeKey(a.fitness.primaryBlock || "")) ? 1 : 0;
        const bPreferred = preferredBlocks.has(normalizeKey(b.fitness.primaryBlock || "")) ? 1 : 0;
        if (aPreferred !== bPreferred) return bPreferred - aPreferred;
        return b.fitness.score - a.fitness.score;
      });

    const picked = [];
    const blocked = new Set(excludeTexts.map(normalizeKey));
    for (const entry of pool) {
      const key = normalizeKey(entry.idea);
      if (blocked.has(key)) continue;
      if (!allowUsedTextReuse && usedTexts.has(key) && sectionName !== "key_lines") continue;
      picked.push({
        idea: entry.idea,
        source_facts: entry.source_facts.length > 0
          ? entry.source_facts
          : inferSourceFactsForText(entry.idea, facts, SECTION_TARGETS[sectionName]),
      });
      usedTexts.add(key);
      if (picked.length >= maxEntries) break;
    }

    const topScore = pool[0]?.fitness?.score ?? 0;
    scores[sectionName] = topScore;
    if (topScore < 6 && minEntries > 0) weakSections.push(sectionName);
    const fallbackEntry = pool.find((entry) => !blocked.has(normalizeKey(entry.idea))) || pool[0];
    if (picked.length < minEntries && fallbackEntry) {
      picked.push({
        idea: fallbackEntry.idea,
        source_facts: fallbackEntry.source_facts,
      });
    }
    return picked.slice(0, maxEntries);
  };

  const repaired = {
    hook: normalized.hook,
    verse1: pickSectionEntries("verse1", {
      minEntries: 1,
      maxEntries: 2,
      preferredPrimaryBlocks: ["setup"],
    }),
    pre: pickSectionEntries("pre", { minEntries: 0, maxEntries: 2 }),
    chorus: pickSectionEntries("chorus", {
      minEntries: 1,
      maxEntries: 2,
      preferredPrimaryBlocks: ["meaning"],
    }),
    verse2: pickSectionEntries("verse2", {
      minEntries: 0,
      maxEntries: 2,
      preferredPrimaryBlocks: ["turn", "conflict"],
    }),
    bridge: [],
    motifs: normalized.motifs,
    key_lines: [],
  };

  if (repaired.verse2.length === 0) {
    repaired.verse2 = pickSectionEntries("verse2", {
      minEntries: 1,
      maxEntries: 1,
      preferredPrimaryBlocks: ["turn", "conflict"],
    });
  }
    repaired.bridge = pickSectionEntries("bridge", {
      minEntries: 1,
      maxEntries: 1,
      excludeTexts: repaired.chorus.map((entry) => entry.idea),
      preferredPrimaryBlocks: blockProfile?.blocks?.transformation?.present
        ? ["transformation", "turn"]
        : ["turn", "meaning"],
    });
  if (repaired.bridge.length === 0) {
    repaired.bridge = pickSectionEntries("bridge", {
      minEntries: 1,
      maxEntries: 1,
      excludeTexts: repaired.chorus.map((entry) => entry.idea),
      allowUsedTextReuse: true,
      preferredPrimaryBlocks: blockProfile?.blocks?.transformation?.present
        ? ["transformation", "turn"]
        : ["turn", "meaning"],
    });
  }

  const hookIdea = getSongMapIdea(normalized.hook)
    || repaired.chorus[0]?.idea
    || blockProfile?.blocks?.meaning?.primary?.text
    || sanitizeText(context?.message || "");
  repaired.hook = hookIdea ? {
    idea: hookIdea,
    source_facts: getSongMapSourceFacts(normalized.hook, factIdSet).length > 0
      ? getSongMapSourceFacts(normalized.hook, factIdSet)
      : inferSourceFactsForText(hookIdea, facts, ["meaning", "impact", "detail"]),
  } : null;

  const keyLinePool = [repaired.hook, repaired.chorus[0], repaired.bridge[0], repaired.verse1[0]]
    .filter(Boolean)
    .map((entry) => ({
      idea: entry.idea,
      source_facts: entry.source_facts,
    }));
  const seenKeyLines = new Set();
  repaired.key_lines = keyLinePool.filter((entry) => {
    const key = normalizeKey(entry.idea);
    if (!entry.idea || seenKeyLines.has(key)) return false;
    seenKeyLines.add(key);
    return true;
  }).slice(0, 3);

  const chorusIdea = repaired.chorus[0]?.idea || "";
  const bridgeIdea = repaired.bridge[0]?.idea || "";
  const duplicatedThesis = chorusIdea && bridgeIdea && normalizeKey(chorusIdea) === normalizeKey(bridgeIdea);

  const valid = repaired.verse1.length > 0
    && repaired.chorus.length > 0
    && (repaired.verse2.length > 0 || repaired.bridge.length > 0)
    && scores.chorus >= 6
    && scores.bridge >= 6
    && !duplicatedThesis;

  const repairedChanged = !isDeepStrictEqual(normalized, repaired);

  return {
    song_map: repaired,
    repaired: repairedChanged,
    report: {
      valid,
      weakSections: [...new Set(weakSections)],
      sectionScores: scores,
      duplicatedThesis,
    },
    blockProfile,
  };
}

// --- Detail categories for the retained-detail ledger ---
const DETAIL_CATEGORIES = Object.freeze([
  "people", "places", "events", "conflicts",
  "turning_points", "transformations", "meanings", "concrete_details",
]);

// Patterns for extracting named entities and concrete details
const PROPER_NOUN_PATTERN = /\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]+)*/g;
const QUOTED_PHRASE_PATTERN = /[\u201C"']([^\u201D"']+)[\u201D"']/g;
const NUMBER_PHRASE_PATTERN = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+\w+/gi;
const PLACE_INDICATOR_PATTERN = /\b(?:in|from|at|to)\s+([A-Z][a-z]+(?:[,\s]+[A-Z][a-z]+)*)/g;

// Stop words excluded from significant-word overlap computation
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "was", "are", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "shall", "can", "need",
  "that", "this", "these", "those", "what", "which", "who", "whom",
  "how", "when", "where", "why", "not", "no", "nor", "so", "very",
  "just", "also", "than", "then", "too", "into", "about", "over",
  "such", "some", "any", "each", "every", "all", "both", "few",
  "more", "most", "other", "its", "our", "your", "their", "his", "her",
  "my", "me", "him", "them", "she", "he", "you", "we", "they", "i",
]);

function getSignificantWords(text) {
  return normalizeKey(text)
    .split(/\W+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function classifySentenceCategory(sentence) {
  const lower = normalizeKey(sentence);
  const categories = [];

  const tryCategory = (category, blockKey) => {
    if (categories.includes(category)) return;
    for (const pattern of BLOCK_PATTERNS[blockKey] || []) {
      if (pattern.test(sentence)) { categories.push(category); return; }
    }
    for (const [phrase] of BLOCK_PHRASES[blockKey] || []) {
      if (lower.includes(phrase)) { categories.push(category); return; }
    }
  };

  tryCategory("conflicts", "conflict");
  tryCategory("turning_points", "turn");

  if (TRANSFORMATION_WORDS.test(sentence)) categories.push("transformations");
  else tryCategory("transformations", "transformation");

  if (MEANING_WORDS.test(sentence)) {
    if (!categories.includes("meanings")) categories.push("meanings");
  } else {
    tryCategory("meanings", "meaning");
  }

  tryCategory("events", "setup");

  return categories;
}

// Common words that start sentences but are not proper nouns
const COMMON_SENTENCE_STARTERS = new Set([
  "the", "this", "that", "these", "those", "there", "then", "they",
  "she", "her", "his", "him", "he", "what", "when", "where", "why",
  "how", "who", "which", "but", "and", "also", "just", "not", "now",
  "our", "your", "their", "its", "here", "some", "all", "any", "each",
  "every", "both", "more", "most", "other", "one", "two", "three",
  "four", "five", "six", "seven", "eight", "nine", "ten", "after",
  "before", "during", "while", "because", "since", "until", "once",
  "still", "yet", "even", "over", "under", "between", "through",
  "into", "with", "from", "about", "like", "very", "really",
  "sometimes", "always", "never", "often", "everything", "nothing",
]);

function extractNamedEntities(text) {
  const entities = { people: [], places: [], concrete_details: [] };
  const raw = sanitizeText(text);

  let match;
  const properNouns = new Set();
  const propPattern = new RegExp(PROPER_NOUN_PATTERN.source, "g");
  while ((match = propPattern.exec(raw)) !== null) {
    const name = match[0].trim();
    if (COMMON_SENTENCE_STARTERS.has(name.toLowerCase())) continue;
    const before = raw.slice(0, match.index);
    const atSentenceStart = match.index === 0 || /[.!?]\s*$/.test(before);
    if (!atSentenceStart || name.split(/\s+/).length >= 2) {
      properNouns.add(name);
    }
  }
  entities.people.push(...properNouns);

  const quotePattern = new RegExp(QUOTED_PHRASE_PATTERN.source, "g");
  while ((match = quotePattern.exec(raw)) !== null) {
    entities.concrete_details.push(match[1].trim());
  }

  const numPattern = new RegExp(NUMBER_PHRASE_PATTERN.source, "gi");
  while ((match = numPattern.exec(raw)) !== null) {
    entities.concrete_details.push(match[0].trim());
  }

  const placePattern = new RegExp(PLACE_INDICATOR_PATTERN.source, "g");
  while ((match = placePattern.exec(raw)) !== null) {
    entities.places.push(match[1].trim());
  }

  return entities;
}

function extractRetainedDetails(context) {
  if (!context || typeof context !== "object") return [];

  const details = [];
  const seenKeys = new Set();

  const addDetail = (category, text, source, required) => {
    const clean = sanitizeText(text);
    if (!clean || clean.length < 3) return;
    const key = `${category}::${normalizeKey(clean)}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    details.push({ category, text: clean, source, required });
  };

  const sourcePairs = [];

  const initialPrompt = sanitizeText(context.initial_prompt || context.message || "");
  if (initialPrompt) {
    sourcePairs.push({ text: initialPrompt, source: "initial_prompt" });
  }

  const conversation = Array.isArray(context.conversation) ? context.conversation : [];
  conversation.forEach((turn, index) => {
    if (turn?.role === "user" && sanitizeText(turn.content || "")) {
      sourcePairs.push({ text: sanitizeText(turn.content), source: `conversation_turn_${index}` });
    }
  });

  const facts = Array.isArray(context.facts) ? context.facts : [];
  for (const fact of facts) {
    const text = sanitizeText(factText(fact));
    if (text) {
      sourcePairs.push({ text, source: `fact_${fact?.id || "unknown"}` });
    }
  }

  for (const { text: sourceText, source } of sourcePairs) {
    const sentences = splitStorySentences(sourceText);
    const isInitialPrompt = source === "initial_prompt";

    const entities = extractNamedEntities(sourceText);
    for (const name of entities.people) {
      addDetail("people", name, source, isInitialPrompt);
    }
    for (const place of entities.places) {
      addDetail("places", place, source, false);
    }
    for (const concrete of entities.concrete_details) {
      addDetail("concrete_details", concrete, source, isInitialPrompt);
    }

    for (const sentence of sentences) {
      const categories = classifySentenceCategory(sentence);

      if (categories.length === 0) {
        const sigWords = getSignificantWords(sentence);
        if (sigWords.length >= 3) {
          addDetail("concrete_details", sentence, source, isInitialPrompt);
        }
        continue;
      }

      for (const category of categories) {
        const required = isInitialPrompt && [
          "events", "conflicts", "turning_points", "transformations", "meanings",
        ].includes(category);
        addDetail(category, sentence, source, required);
      }
    }
  }

  return details;
}

function computeDetailCoverage(retainedDetails, prose) {
  if (!Array.isArray(retainedDetails) || !retainedDetails.length) {
    return {
      coverage: [],
      stats: { total: 0, preserved: 0, paraphrased: 0, missing: 0, requiredMissing: 0, coverageRate: 1 },
      missingRequired: [],
    };
  }

  const normalizedProse = normalizeKey(prose || "");
  const proseWords = getSignificantWords(prose || "");
  const proseWordSet = new Set(proseWords);

  const coverage = retainedDetails.map((detail) => {
    const detailLower = normalizeKey(detail.text);
    const detailSigWords = getSignificantWords(detail.text);

    // Preserved: detail text (or significant substring) appears verbatim in prose
    if (normalizedProse.includes(detailLower)) {
      return { detail, status: "preserved", match: detail.text };
    }

    // Check for significant multi-word fragments (3+ consecutive words from the lowered text)
    if (detailSigWords.length >= 3) {
      const words = detailLower.split(/\W+/).filter(Boolean);
      for (let i = 0; i <= words.length - 3; i++) {
        const fragment = words.slice(i, i + 3).join(" ");
        if (fragment.length >= 8 && normalizedProse.includes(fragment)) {
          return { detail, status: "preserved", match: fragment };
        }
      }
    }

    // Paraphrased: >50% significant word overlap
    if (detailSigWords.length > 0) {
      const overlapping = detailSigWords.filter((word) => proseWordSet.has(word));
      const overlapRate = overlapping.length / detailSigWords.length;
      if (overlapRate > 0.5) {
        return { detail, status: "paraphrased", match: overlapping.join(", ") };
      }
    }

    // Short details (names, numbers): any significant word present counts as paraphrased
    if (detailSigWords.length <= 2 && detailSigWords.length > 0) {
      const found = detailSigWords.find((word) => proseWordSet.has(word));
      if (found) {
        return { detail, status: "paraphrased", match: found };
      }
    }

    return { detail, status: "missing", match: null };
  });

  const preserved = coverage.filter((entry) => entry.status === "preserved").length;
  const paraphrased = coverage.filter((entry) => entry.status === "paraphrased").length;
  const missing = coverage.filter((entry) => entry.status === "missing").length;
  const requiredMissing = coverage.filter(
    (entry) => entry.status === "missing" && entry.detail.required,
  ).length;
  const total = coverage.length;

  return {
    coverage,
    stats: {
      total,
      preserved,
      paraphrased,
      missing,
      requiredMissing,
      coverageRate: total > 0 ? Number(((preserved + paraphrased) / total).toFixed(2)) : 1,
    },
    missingRequired: coverage
      .filter((entry) => entry.status === "missing" && entry.detail.required)
      .map((entry) => ({
        category: entry.detail.category,
        text: entry.detail.text,
        source: entry.detail.source,
      })),
  };
}

module.exports = {
  STORY_BLOCKS,
  BLOCK_ORDER,
  DETAIL_CATEGORIES,
  deriveStoryBlockProfile,
  evaluateNarrativeBlockCoverage,
  repairNarrativeFromBlockProfile,
  scoreSectionPurposeFitness,
  repairSongMapWithProfile,
  splitStorySentences,
  extractRetainedDetails,
  computeDetailCoverage,
  getSignificantWords,
};
