/**
 * Story-Aware Songwriter
 *
 * Generates lyrics from a confirmed story, ensuring:
 * - Every verse connects to story elements
 * - The story unfolds across verses (not isolated content)
 * - Sensory details are woven throughout
 * - The receiver feels SEEN, not just praised
 *
 * Key principle: We're not writing generic lyrics with inserted names.
 * We're turning their specific story into a song.
 */

const { generateText, isAvailable, ERROR_CODES } = require("../services/llm-provider");
const { sanitizeForPrompt } = require("../services/content-filter");
const {
  getStyleDisplayMap,
  normalizeStyle: normalizeMusicStyle,
} = require("../providers/style-registry");
const { getStoryContextV3 } = require("./v3");

// Syllable constraints for singability
const MIN_SYLLABLES_PER_LINE = 3;
const MAX_SYLLABLES_PER_LINE = 15;
const TARGET_DURATION_SECONDS = { min: 45, max: 60 };
const QUALITY_MIN_SCORE = 75;
const SELF_CORRECTION_MAX = 3;
const FIDELITY_MIN_SCORE = 35; // out of 50 (70%)
const BORDERLINE_FIDELITY_MARGIN = 2;

const factText = (f) => typeof f === "string" ? f : f?.text || "";

const MUSIC_STYLES = Object.freeze(getStyleDisplayMap());

const RELATIONSHIP_DESCRIPTORS = {
  spouse: "life partner and soulmate",
  partner: "loving partner",
  parent: "parent who raised and guided",
  child: "beloved child",
  sibling: "sibling and lifelong companion",
  friend: "cherished friend",
  colleague: "valued colleague and friend",
  mentor: "inspiring mentor",
  grandparent: "wise and loving grandparent",
};

/**
 * The songwriter persona - defines the voice and approach
 */
const SONGWRITER_PERSONA = `You are a storyteller who writes songs. Not a poet. Not a greeting card writer.

YOUR CRAFT:
- The song is a living narrative: a thread of truth that moves from scene to scene
- Concrete, cinematic detail over abstraction: places, objects, weather, sounds, small actions
- Conversational authority: plainspoken, but with depth and surprise
- Emotional honesty without sentimentality; no flattery, no Hallmark tone
- Vivid metaphors that feel earned, never forced
- Subtle internal rhyme and cadence; avoid obvious end-rhyme sing-song
- One unforgettable line that carries the soul of the song (the anchor line)
- Every word must earn its place; compress meaning, cut filler

YOUR RULES:
- NEVER use generic phrases like "you mean the world to me", "you're amazing", "you're the best"
- Prefer sensory details that are already present in the story (objects, sounds, places, body sensations). If the story is sparse, use reflective language instead of inventing sensory scene detail.
- The CHORUS is the emotional truth - what the story MEANS
- Each VERSE moves the story forward - no filler, no repetition
- The recipient should hear this and think "they remembered THAT about me?"
- Avoid clichés, greeting-card language, and AI-sounding symmetry
- Keep language precise; prefer strong nouns and verbs over adjectives
- FAITHFULNESS RULE: Every concrete person, event, place, object, activity, food, and quoted phrase in the lyrics must be traceable to the story context. If the story is sparse, write reflective or emotional lines instead of inventing specifics.

YOUR VOICE:
- Conversational, not formal
- Specific, not abstract
- Nostalgic but not cheesy
- Allow contrast or surprise when it deepens the emotion
- Every line should feel inevitable, not forced`;

/**
 * Sanitize input text for safe LLM processing
 * Removes control characters, excessive whitespace, and dangerous patterns
 * @param {string} text - Raw input text
 * @returns {string} - Sanitized text
 */
function sanitizeInput(text) {
  if (!text || typeof text !== "string") return "";

  return text
    // Remove control characters except newlines and tabs
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    // Remove zero-width characters first (potential injection vectors)
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    // Normalize unicode whitespace to regular spaces (excluding zero-width already removed)
    .replace(/[\u00A0\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000]/g, " ")
    // Collapse multiple spaces to single space
    .replace(/\s+/g, " ")
    // Limit length (2000 chars max per field)
    .slice(0, 2000)
    .trim();
}

/**
 * Validate style against known MUSIC_STYLES
 * @param {string} style - Style to validate
 * @returns {{ valid: boolean, normalized: string }} - Validation result with normalized style
 */
function validateStyle(style) {
  if (!style) return { valid: true, normalized: "pop" };

  const normalized = normalizeMusicStyle(style) || style.toLowerCase().replace(/[\s-]/g, "_");

  if (MUSIC_STYLES[normalized]) {
    return { valid: true, normalized };
  }

  // Check for partial matches
  for (const [key, displayName] of Object.entries(MUSIC_STYLES)) {
    if (displayName.toLowerCase() === style.toLowerCase()) {
      return { valid: true, normalized: key };
    }
  }

  return { valid: false, normalized: "pop" }; // Default to pop if unknown
}

/**
 * Count syllables in a word (approximate)
 */
function countSyllables(text) {
  if (!text) return 0;

  const word = text.toLowerCase().replace(/[^a-z]/g, " ");
  const words = word.split(/\s+/).filter(Boolean);

  let total = 0;
  for (const w of words) {
    let count = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
      .replace(/^y/, "")
      .match(/[aeiouy]+/g);
    total += count ? count.length : 1;
  }

  return total;
}

function countLineSyllables(line) {
  if (!line) return 0;
  return line.split(/\s+/).reduce((sum, word) => sum + countSyllables(word), 0);
}

/**
 * Validate lyrics structure and singability
 */
function validateSingability(lyrics) {
  const issues = [];

  if (!lyrics || !lyrics.sections || lyrics.sections.length === 0) {
    issues.push("No sections found in lyrics");
    return { valid: false, issues };
  }

  for (const section of lyrics.sections) {
    if (!section.lines || section.lines.length === 0) {
      issues.push(`Section '${section.name}' has no lines`);
      continue;
    }

    for (let i = 0; i < section.lines.length; i++) {
      const syllables = countLineSyllables(section.lines[i]);
      if (syllables > MAX_SYLLABLES_PER_LINE) {
        issues.push(`${section.name} line ${i + 1}: ${syllables} syllables (max ${MAX_SYLLABLES_PER_LINE})`);
      }
      if (syllables < MIN_SYLLABLES_PER_LINE) {
        issues.push(`${section.name} line ${i + 1}: ${syllables} syllables (min ${MIN_SYLLABLES_PER_LINE})`);
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Ensure the user's message is reflected somewhere in the lyrics
 */
function anchorMessage(lyrics, message) {
  if (!lyrics || !message) return lyrics;

  const allLines = lyrics.sections.flatMap(s => s.lines);
  const hasMessage = allLines.some(line =>
    line.toLowerCase().includes(message.toLowerCase().slice(0, 12))
  );

  if (hasMessage) return lyrics;

  const result = JSON.parse(JSON.stringify(lyrics));

  for (const section of result.sections) {
    if (section.name === "chorus" && section.lines.length > 0) {
      const messageWords = message.split(" ").slice(0, 6).join(" ");
      section.lines[0] = messageWords;
      result.anchor_line = messageWords;
      break;
    }
  }

  return result;
}

/**
 * Check if recipient name appears in lyrics (anchor enforcement)
 */
function validateRecipientAnchor(lyrics, recipientName) {
  if (!recipientName || !lyrics) {
    return { hasAnchor: true, locations: [] };
  }

  const nameLower = recipientName.toLowerCase().trim();
  const locations = [];

  if (!lyrics.sections) {
    return { hasAnchor: false, locations };
  }

  for (const section of lyrics.sections) {
    if (!section.lines) continue;

    for (let i = 0; i < section.lines.length; i++) {
      if (section.lines[i].toLowerCase().includes(nameLower)) {
        locations.push(`${section.name}:${i + 1}`);
      }
    }
  }

  return { hasAnchor: locations.length > 0, locations };
}

/**
 * Auto-repair lyrics to ensure recipient name appears in chorus
 */
function repairRecipientAnchor(lyrics, recipientName) {
  if (!recipientName || !lyrics) return lyrics;

  const validation = validateRecipientAnchor(lyrics, recipientName);
  if (validation.hasAnchor) return lyrics;

  const result = JSON.parse(JSON.stringify(lyrics));
  const chorus = result.sections.find(s => s.name === "chorus");

  if (chorus && chorus.lines && chorus.lines.length > 0) {
    chorus.lines[0] = `${recipientName}, ${chorus.lines[0]}`;
    result.anchor_line = chorus.lines[0];
  }

  return result;
}

/**
 * Full lyrics validation with all checks
 */
function validateAndRepairLyrics(lyrics, recipientName, style) {
  let result = lyrics;
  const issues = [];

  if (!lyrics || !lyrics.sections) {
    return { valid: false, lyrics: null, issues: ["Invalid lyrics structure"] };
  }

  const styleCheck = validateStyle(style);
  if (!styleCheck.valid) {
    issues.push(`Unknown style '${style}', defaulted to 'pop'`);
  }

  const singability = validateSingability(lyrics);
  if (!singability.valid) {
    issues.push(...singability.issues);
  }

  const anchorCheck = validateRecipientAnchor(lyrics, recipientName);
  if (!anchorCheck.hasAnchor && recipientName) {
    result = repairRecipientAnchor(lyrics, recipientName);
    issues.push(`Repaired: Added recipient name "${recipientName}" to chorus`);
  }

  return {
    valid: issues.filter(i => !i.startsWith("Repaired")).length === 0,
    lyrics: result,
    issues,
  };
}

/** Sanitize a flat string-valued object. NOT for nested objects (use primitives handler). */
function sanitizeStringMap(obj) {
  if (!obj || typeof obj !== "object") return {};
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([_, v]) => v && String(v).trim())
      .map(([k, v]) => [k, sanitizeInput(String(v))])
  );
}

function sanitizeStringArray(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => sanitizeInput(typeof value === "string" ? value : String(value || "")))
    .filter(Boolean);
}

function sanitizeJsonValue(value, depth = 0) {
  if (depth > 3 || value == null) return null;
  if (typeof value === "string") return sanitizeInput(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, 12)
      .map((item) => sanitizeJsonValue(item, depth + 1))
      .filter((item) => item !== null);
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 24)
        .map(([key, entry]) => [key, sanitizeJsonValue(entry, depth + 1)])
        .filter(([_, entry]) => entry !== null)
    );
  }
  return null;
}

function buildFactMap(facts = []) {
  const entries = Array.isArray(facts) ? facts : [];
  return new Map(
    entries
      .filter((fact) => fact && fact.id && fact.text)
      .map((fact) => [String(fact.id), fact])
  );
}

function sanitizeFactId(value) {
  return sanitizeInput(typeof value === "string" ? value : String(value || ""));
}

function normalizeSongMapEntry(value, factMap) {
  if (typeof value === "string") {
    const idea = sanitizeInput(value);
    return idea ? { idea, source_facts: [] } : null;
  }
  if (!value || typeof value !== "object") return null;

  const idea = sanitizeInput(value.idea || value.text || value.line || "");
  if (!idea) return null;

  const rawSourceFacts = Array.isArray(value.source_facts)
    ? value.source_facts
    : Array.isArray(value.facts)
      ? value.facts
      : typeof value.source_facts === "string"
        ? [value.source_facts]
        : typeof value.facts === "string"
          ? [value.facts]
          : [];

  const sourceFacts = rawSourceFacts
    .map(sanitizeFactId)
    .filter((factId) => factId && (!factMap.size || factMap.has(factId)));

  return {
    idea,
    source_facts: [...new Set(sourceFacts)],
  };
}

function sanitizeSongMap(songMap, facts = []) {
  if (!songMap || typeof songMap !== "object") return null;
  const factMap = buildFactMap(facts);
  const handleArray = (value) => {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => normalizeSongMapEntry(entry, factMap))
      .filter(Boolean);
  };
  const normalized = {
    hook: normalizeSongMapEntry(songMap.hook, factMap),
    verse1: handleArray(songMap.verse1),
    pre: handleArray(songMap.pre),
    chorus: handleArray(songMap.chorus),
    verse2: handleArray(songMap.verse2),
    bridge: handleArray(songMap.bridge),
    motifs: sanitizeStringArray(songMap.motifs),
    key_lines: handleArray(songMap.key_lines),
  };
  const hasContent = Object.values(normalized).some((value) =>
    (value && typeof value === "object" && !Array.isArray(value) && typeof value.idea === "string" && value.idea) ||
    (Array.isArray(value) && value.length > 0)
  );
  return hasContent ? normalized : null;
}

function hasSongMapContent(songMap) {
  return !!(songMap && Object.values(songMap).some((value) =>
    (value && typeof value === "object" && !Array.isArray(value) && typeof value.idea === "string" && value.idea) ||
    (Array.isArray(value) && value.length > 0)
  ));
}

function hasStructuredStoryData(context) {
  if (!context || typeof context !== "object") return false;
  if (hasSongMapContent(context.song_map)) return true;
  if (Array.isArray(context.facts) && context.facts.length > 0) return true;
  if (Array.isArray(context.beats) && context.beats.length > 0) return true;
  if (Array.isArray(context.motifs) && context.motifs.length > 0) return true;

  const textFields = [
    context.narrative,
    context.summary_text,
    context.soul,
  ].filter((value) => typeof value === "string" && value.trim());
  if (textFields.length > 0) return true;

  const objectHasValue = (value) => !!(value && typeof value === "object" && Object.values(value).some((entry) => {
    if (typeof entry === "string") return !!entry.trim();
    if (Array.isArray(entry)) return entry.length > 0;
    if (entry && typeof entry === "object") return objectHasValue(entry);
    return false;
  }));

  return objectHasValue(context.atoms)
    || objectHasValue(context.primitives)
    || objectHasValue(context.elements);
}

function hasCitedSongMap(songMap) {
  if (!songMap || typeof songMap !== "object") return false;
  const entries = [
    songMap.hook,
    ...(songMap.verse1 || []),
    ...(songMap.pre || []),
    ...(songMap.chorus || []),
    ...(songMap.verse2 || []),
    ...(songMap.bridge || []),
    ...(songMap.key_lines || []),
  ].filter(Boolean);
  return entries.some((entry) => Array.isArray(entry.source_facts) && entry.source_facts.length > 0);
}

function getSongMapIdea(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return entry;
  if (typeof entry === "object" && typeof entry.idea === "string") return entry.idea;
  return "";
}

function getSongMapSourceFacts(entry) {
  if (!entry || typeof entry !== "object" || !Array.isArray(entry.source_facts)) return [];
  return entry.source_facts.filter(Boolean);
}

function formatSongMapEntry(entry, factMap) {
  const idea = getSongMapIdea(entry);
  if (!idea) return "";
  const support = getSongMapSourceFacts(entry)
    .map((factId) => factMap.get(factId)?.text)
    .filter(Boolean);
  if (support.length === 0) return `- ${idea}`;
  return `- ${idea}\n  Support: ${support.join("; ")}`;
}

function selectFactsByBeat(facts, preferredBeats = []) {
  const normalizedBeats = preferredBeats.map((beat) => String(beat || "").toLowerCase());
  return (facts || []).filter((fact) => {
    const beat = String(fact?.beat || "").toLowerCase();
    return normalizedBeats.includes(beat);
  });
}

function inferSourceFactsForIdea(idea, facts, preferredBeats = []) {
  const normalizedIdea = sanitizeInput(idea).toLowerCase();
  if (!normalizedIdea) return [];
  const ideaWords = normalizedIdea.split(/\W+/).filter((word) => word.length > 3);
  const preferred = new Set(preferredBeats.map((beat) => String(beat || "").toLowerCase()));

  const scoredFacts = (facts || [])
    .filter((fact) => fact && fact.id && fact.text)
    .map((fact, index) => {
      const text = String(fact.text || "").toLowerCase();
      const factWords = text.split(/\W+/).filter((word) => word.length > 3);
      const overlap = ideaWords.length > 0
        ? ideaWords.filter((word) => factWords.includes(word)).length
        : 0;
      const beatBoost = preferred.has(String(fact.beat || "").toLowerCase()) ? 2 : 0;
      const score = overlap + beatBoost - (index * 0.01);
      return { fact, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(({ fact }) => fact.id);

  if (scoredFacts.length > 0) return [...new Set(scoredFacts)];

  const preferredFacts = selectFactsByBeat(facts, preferredBeats).slice(0, 2).map((fact) => fact.id);
  if (preferredFacts.length > 0) return [...new Set(preferredFacts)];

  return (facts || []).slice(0, 2).map((fact) => fact.id).filter(Boolean);
}

function filterFactsForPrompt(facts, narrativeText) {
  if (!Array.isArray(facts) || facts.length === 0) return [];
  const narrativeWords = new Set(
    sanitizeInput(narrativeText || "")
      .toLowerCase()
      .split(/\W+/)
      .filter((word) => word.length > 3)
  );

  const eligibleFacts = facts
    .filter((fact) => {
      const text = factText(fact).trim();
      if (!text) return false;
      if (text.length > 500) return false;
      if (text.length < 10) return false;
      return true;
    });

  const filteredFacts = eligibleFacts
    .filter((fact) => {
      const text = factText(fact).trim();

      if (narrativeWords.size > 0) {
        const words = text.toLowerCase().split(/\W+/).filter((word) => word.length > 3);
        if (words.length > 0) {
          const overlap = words.filter((word) => narrativeWords.has(word)).length / words.length;
          if (overlap > 0.8) return false;
        }
      }
      return true;
    });

  const minimumFacts = Math.min(2, eligibleFacts.length);
  if (filteredFacts.length >= minimumFacts) {
    return filteredFacts.slice(0, 10);
  }

  const fallbackFacts = [...filteredFacts];
  for (const fact of eligibleFacts) {
    if (fallbackFacts.length >= minimumFacts || fallbackFacts.length >= 10) break;
    if (fallbackFacts.includes(fact)) continue;
    fallbackFacts.push(fact);
  }
  return fallbackFacts.slice(0, 10);
}

function sentenceSplit(text) {
  return sanitizeInput(text)
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeContractSectionEntries(entries, facts, preferredBeats = []) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const idea = getSongMapIdea(entry);
      if (!idea) return null;
      const existing = getSongMapSourceFacts(entry).filter(Boolean);
      const source_facts = existing.length > 0
        ? existing
        : inferSourceFactsForIdea(idea, facts, preferredBeats);
      return {
        idea,
        source_facts: [...new Set(source_facts)],
      };
    })
    .filter(Boolean);
}

function sectionEntriesSupportBeats(entries, factMap, preferredBeats = []) {
  const preferred = new Set(preferredBeats.map((beat) => String(beat || "").toLowerCase()));
  return (Array.isArray(entries) ? entries : []).some((entry) =>
    getSongMapSourceFacts(entry).some((factId) => preferred.has(String(factMap.get(factId)?.beat || "").toLowerCase()))
  );
}

function validateSongContract(context) {
  const facts = Array.isArray(context?.facts) ? context.facts : [];
  const factMap = buildFactMap(facts);
  const songMap = context?.song_map;
  const requiredSectionEntries = {
    verse1: Array.isArray(songMap?.verse1) ? songMap.verse1 : [],
    chorus: Array.isArray(songMap?.chorus) ? songMap.chorus : [],
    verse2: Array.isArray(songMap?.verse2) ? songMap.verse2 : [],
    bridge: Array.isArray(songMap?.bridge) ? songMap.bridge : [],
  };

  const missingSections = [];
  if (requiredSectionEntries.verse1.length === 0) missingSections.push("verse1");
  if (requiredSectionEntries.chorus.length === 0) missingSections.push("chorus");
  if (requiredSectionEntries.verse2.length === 0 && requiredSectionEntries.bridge.length === 0) {
    missingSections.push("verse2_or_bridge");
  }

  const uncitedSections = [];
  const brokenCitations = [];
  for (const [sectionName, entries] of Object.entries(requiredSectionEntries)) {
    if (entries.length === 0) continue;
    const citedEntries = entries.filter((entry) => getSongMapSourceFacts(entry).length > 0);
    if (citedEntries.length === 0) {
      uncitedSections.push(sectionName);
    }
    for (const entry of citedEntries) {
      const invalid = getSongMapSourceFacts(entry).filter((factId) => !factMap.has(factId));
      if (invalid.length > 0) {
        brokenCitations.push({
          section: sectionName,
          idea: getSongMapIdea(entry),
          source_facts: invalid,
        });
      }
    }
  }

  const payoffPresent = sectionEntriesSupportBeats(
    [...requiredSectionEntries.chorus, ...requiredSectionEntries.bridge],
    factMap,
    ["meaning", "impact", "detail"]
  ) || !!sanitizeInput(
    context?.primitives?.resolution ||
    context?.primitives?.theme ||
    context?.atoms?.after ||
    ""
  );
  const turnPresent = sectionEntriesSupportBeats(
    [...requiredSectionEntries.verse2, ...requiredSectionEntries.bridge],
    factMap,
    ["turning_point", "impact", "stakes", "moment"]
  ) || !!sanitizeInput(
    context?.primitives?.turning_point ||
    context?.atoms?.turn ||
    ""
  );
  const valid = missingSections.length === 0
    && uncitedSections.length === 0
    && brokenCitations.length === 0
    && payoffPresent
    && turnPresent;

  return {
    valid,
    hasCitedContract: hasCitedSongMap(songMap),
    missingSections,
    uncitedSections,
    brokenCitations,
    payoffPresent,
    turnPresent,
  };
}

function repairSongContract(context) {
  const facts = Array.isArray(context?.facts) ? context.facts : [];
  const existing = context?.song_map || {};
  const narrativeSentences = sentenceSplit(context?.narrative || context?.summary_text || "");
  const setupFacts = selectFactsByBeat(facts, ["context", "scene", "meeting", "relationship", "who"]);
  const changeFacts = selectFactsByBeat(facts, ["moment", "struggle", "stakes", "discovery", "turning_point", "impact"]);
  const resolutionText = sanitizeInput(
    context?.primitives?.resolution ||
    context?.primitives?.theme ||
    context?.atoms?.after ||
    narrativeSentences.at(-1) ||
    ""
  );
  const turnText = sanitizeInput(
    context?.primitives?.turning_point ||
    context?.atoms?.turn ||
    changeFacts[0]?.text ||
    ""
  );

  const repaired = {
    hook: existing.hook ? normalizeSongMapEntry(existing.hook, buildFactMap(facts)) : null,
    verse1: normalizeContractSectionEntries(existing.verse1, facts, ["context", "scene", "meeting", "relationship", "who"]),
    pre: normalizeContractSectionEntries(existing.pre, facts, ["stakes", "struggle", "moment"]),
    chorus: normalizeContractSectionEntries(existing.chorus, facts, ["meaning", "impact", "detail"]),
    verse2: normalizeContractSectionEntries(existing.verse2, facts, ["turning_point", "impact", "stakes", "moment"]),
    bridge: normalizeContractSectionEntries(existing.bridge, facts, ["impact", "meaning", "turning_point", "detail"]),
    motifs: sanitizeStringArray(existing.motifs),
    key_lines: normalizeContractSectionEntries(existing.key_lines, facts, ["meaning", "impact"]),
  };

  if (repaired.verse1.length === 0) {
    const sourceFacts = (setupFacts.length > 0 ? setupFacts : facts.slice(0, 2));
    repaired.verse1 = sourceFacts.map((fact) => ({
      idea: sanitizeInput(fact.text),
      source_facts: fact.id ? [fact.id] : [],
    })).filter((entry) => entry.idea);
  }

  if (repaired.verse2.length === 0 && turnText) {
    repaired.verse2 = [{
      idea: turnText,
      source_facts: inferSourceFactsForIdea(turnText, facts, ["turning_point", "impact", "stakes", "moment"]),
    }];
  }

  if (repaired.chorus.length === 0 && resolutionText) {
    repaired.chorus = [{
      idea: resolutionText,
      source_facts: inferSourceFactsForIdea(resolutionText, facts, ["meaning", "impact", "detail"]),
    }];
  }

  if (repaired.bridge.length === 0 && repaired.verse2.length === 0 && resolutionText) {
    repaired.bridge = [{
      idea: resolutionText,
      source_facts: inferSourceFactsForIdea(resolutionText, facts, ["meaning", "impact", "detail"]),
    }];
  } else if (repaired.bridge.length === 0 && resolutionText) {
    repaired.bridge = [{
      idea: resolutionText,
      source_facts: inferSourceFactsForIdea(resolutionText, facts, ["impact", "meaning", "detail"]),
    }];
  }

  if (!repaired.hook) {
    const hookIdea = getSongMapIdea(repaired.chorus[0]) || resolutionText || sanitizeInput(context?.message || "");
    repaired.hook = hookIdea
      ? {
        idea: hookIdea,
        source_facts: inferSourceFactsForIdea(hookIdea, facts, ["meaning", "impact", "detail"]),
      }
      : null;
  } else if (getSongMapSourceFacts(repaired.hook).length === 0) {
    repaired.hook.source_facts = inferSourceFactsForIdea(repaired.hook.idea, facts, ["meaning", "impact", "detail"]);
  }

  if (repaired.key_lines.length === 0) {
    const keyCandidates = [repaired.hook, repaired.bridge[0], repaired.chorus[0]].filter(Boolean);
    repaired.key_lines = keyCandidates.map((entry) => ({
      idea: getSongMapIdea(entry),
      source_facts: getSongMapSourceFacts(entry).length > 0
        ? getSongMapSourceFacts(entry)
        : inferSourceFactsForIdea(getSongMapIdea(entry), facts, ["meaning", "impact", "detail"]),
    })).filter((entry) => entry.idea);
  }

  return repaired;
}

function ensureSongContract(context) {
  if (!hasStructuredStoryData(context)) {
    return {
      context,
      report: {
        valid: false,
        hasCitedContract: false,
        missingSections: [],
        uncitedSections: [],
        brokenCitations: [],
        payoffPresent: false,
        turnPresent: false,
      },
      repaired: false,
      initialReport: {
        valid: false,
        hasCitedContract: false,
        missingSections: [],
        uncitedSections: [],
        brokenCitations: [],
        payoffPresent: false,
        turnPresent: false,
      },
    };
  }

  const initialReport = validateSongContract(context);
  if (initialReport.valid) {
    return {
      context,
      report: initialReport,
      repaired: false,
      initialReport,
    };
  }

  const repairedSongMap = repairSongContract(context);
  const repairedContext = {
    ...context,
    song_map: repairedSongMap,
  };
  const repairedReport = validateSongContract(repairedContext);
  return {
    context: repairedContext,
    report: repairedReport,
    repaired: true,
    initialReport,
  };
}

function flattenLyricsText(lyrics) {
  if (!lyrics || typeof lyrics !== "object") return "";
  return (lyrics.sections || [])
    .flatMap((section) => Array.isArray(section?.lines) ? section.lines : [])
    .map((line) => (typeof line === "string" ? line : (line && line.text) || ""))
    .filter(Boolean)
    .join("\n");
}

function serializeLyricsDraftForPrompt(lyrics) {
  if (!lyrics || typeof lyrics !== "object" || !Array.isArray(lyrics.sections)) return "";
  const sections = lyrics.sections
    .map((section) => {
      const name = sanitizeInput(section?.name || "section").toUpperCase();
      const lines = Array.isArray(section?.lines) ? section.lines : [];
      if (lines.length === 0) return "";
      return `${name}:\n${lines.map((line) => `- ${sanitizeForPrompt(typeof line === "string" ? line : (line && line.text) || "")}`).join("\n")}`;
    })
    .filter(Boolean);
  return sections.join("\n\n");
}

function aggregateUsage(total = {}, usage = {}) {
  const next = { ...total };
  for (const [key, value] of Object.entries(usage || {})) {
    if (typeof value === "number" && Number.isFinite(value)) {
      next[key] = (next[key] || 0) + value;
    }
  }
  return next;
}

function getSectionPromptConfig(sectionName) {
  const key = String(sectionName || "").toLowerCase();
  const defaults = { lineRange: "4-6", role: "carry the story forward" };
  if (key === "verse1") {
    return {
      ...defaults,
      heading: "VERSE 1",
      role: "set the scene and establish the beginning of the story",
    };
  }
  if (key === "pre") {
    return {
      ...defaults,
      heading: "PRE-CHORUS",
      role: "build tension toward the chorus without inventing new specifics",
    };
  }
  if (key === "chorus") {
    return {
      ...defaults,
      heading: "CHORUS",
      role: "state what the story means emotionally and carry the anchor line",
    };
  }
  if (key === "verse2") {
    return {
      ...defaults,
      heading: "VERSE 2",
      role: "develop the change, consequence, or turning point",
    };
  }
  if (key === "bridge") {
    return {
      heading: "BRIDGE",
      lineRange: "2-4",
      role: "deliver the reflective turn, vow, or emotional culmination",
    };
  }
  return {
    heading: String(sectionName || "SECTION").toUpperCase(),
    ...defaults,
  };
}

function getSectionContractEntries(songMap, sectionName) {
  if (!songMap || typeof songMap !== "object") return [];
  const key = String(sectionName || "").toLowerCase();
  if (key === "hook") {
    return songMap.hook ? [songMap.hook] : [];
  }
  return Array.isArray(songMap[key]) ? songMap[key] : [];
}

function formatSectionContractEntries(entries, factMap) {
  const formatted = (Array.isArray(entries) ? entries : [])
    .map((entry) => formatSongMapEntry(entry, factMap))
    .filter(Boolean);
  return formatted.length > 0 ? formatted.join("\n") : "";
}

function summarizeExistingSections(sections = []) {
  if (!Array.isArray(sections) || sections.length === 0) return "";
  return sections
    .filter((section) => section && Array.isArray(section.lines) && section.lines.length > 0)
    .map((section) => {
      const name = sanitizeInput(section.name || "section").toUpperCase();
      const lines = section.lines
        .map((line) => sanitizeForPrompt(typeof line === "string" ? line : (line && line.text) || ""))
        .filter(Boolean);
      return lines.length > 0
        ? `${name}:\n${lines.map((line) => `- ${line}`).join("\n")}`
        : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function getSectionText(lyrics, sectionName) {
  if (!lyrics || !Array.isArray(lyrics.sections)) return "";
  const section = lyrics.sections.find((entry) => String(entry?.name || "").toLowerCase() === String(sectionName || "").toLowerCase());
  if (!section || !Array.isArray(section.lines)) return "";
  return section.lines
    .map((line) => typeof line === "string" ? line : (line && line.text) || "")
    .filter(Boolean)
    .join("\n");
}

function buildSectionRepairNote(sectionName, fidelity, previousDraft) {
  if (!fidelity || typeof fidelity !== "object") return "";
  const normalizedSection = String(sectionName || "").toLowerCase();
  const sectionAliases = new Set([
    normalizedSection,
    normalizedSection.replace("verse", "verse "),
    normalizedSection.replace("pre", "pre-chorus"),
  ]);
  const notes = [];
  const maybeAdd = (label, values) => {
    const items = (Array.isArray(values) ? values : [])
      .filter((value) => typeof value === "string" && value.trim())
      .filter((value) => {
        const lower = value.toLowerCase();
        return [...sectionAliases].some((alias) => lower.includes(alias));
      });
    if (items.length > 0) {
      notes.push(`${label}: ${items.slice(0, 3).join("; ")}`);
    }
  };

  maybeAdd("Missing contract work", fidelity.uncovered_song_map_slots);
  maybeAdd("Rewrite targets", fidelity.rewrite_targets);
  maybeAdd("Broken citations", fidelity.broken_citations);

  const unsupportedLines = (Array.isArray(fidelity.unsupported_lines) ? fidelity.unsupported_lines : [])
    .filter((line) => typeof line === "string" && line.trim())
    .filter((line) => {
      const sectionText = getSectionText(previousDraft, normalizedSection).toLowerCase();
      return sectionText && sectionText.includes(line.toLowerCase());
    });
  if (unsupportedLines.length > 0) {
    notes.push(`Unsupported lines to replace: ${unsupportedLines.slice(0, 3).join("; ")}`);
  }

  if (notes.length === 0 && typeof fidelity.feedback === "string" && fidelity.feedback.trim()) {
    notes.push(`Judge guidance: ${fidelity.feedback.trim()}`);
  }
  return notes.join(". ");
}

function identifySectionsForRepair(fidelity, previousDraft) {
  const sectionNames = ["verse1", "pre", "chorus", "verse2", "bridge"];
  const targeted = new Set();

  const scanStrings = (values = []) => {
    for (const value of values) {
      const lower = String(value || "").toLowerCase();
      for (const sectionName of sectionNames) {
        if (lower.includes(sectionName) || (sectionName === "pre" && lower.includes("pre-chorus"))) {
          targeted.add(sectionName);
        }
      }
    }
  };

  scanStrings(fidelity?.uncovered_song_map_slots);
  scanStrings(fidelity?.rewrite_targets);
  scanStrings(fidelity?.broken_citations);

  const unsupportedLines = Array.isArray(fidelity?.unsupported_lines) ? fidelity.unsupported_lines : [];
  for (const sectionName of sectionNames) {
    const sectionText = getSectionText(previousDraft, sectionName).toLowerCase();
    if (!sectionText) continue;
    if (unsupportedLines.some((line) => typeof line === "string" && sectionText.includes(line.toLowerCase()))) {
      targeted.add(sectionName);
    }
  }

  if (targeted.size === 0) {
    const hasGlobalFailure = [
      fidelity?.invented_details,
      fidelity?.missing_story_beats,
      fidelity?.unsupported_lines,
      fidelity?.rewrite_targets,
    ].some((value) => Array.isArray(value) && value.length > 0);
    if (hasGlobalFailure) return null;
  }

  return [...targeted];
}

function normalizeSectionPayload(payload, sectionName) {
  const lines = Array.isArray(payload?.lines)
    ? payload.lines
      .map((line) => typeof line === "string" ? line : (line && line.text) || "")
      .map((line) => sanitizeInput(line))
      .filter(Boolean)
    : [];
  const storyElementsUsed = sanitizeStringArray(payload?.story_elements_used);
  return {
    section: {
      name: sectionName,
      lines,
    },
    anchor_line: sanitizeInput(payload?.anchor_line || ""),
    story_elements_used: storyElementsUsed,
  };
}

function deriveTitleFromSectionLyrics(context, sections, anchorLine) {
  const explicitTitle = sanitizeInput(context?.title || "");
  if (explicitTitle) return explicitTitle;
  const hookIdea = sanitizeInput(getSongMapIdea(context?.song_map?.hook));
  if (hookIdea) return hookIdea.slice(0, 80);
  const keyLine = sanitizeInput(getSongMapIdea(context?.song_map?.key_lines?.[0]));
  if (keyLine) return keyLine.slice(0, 80);
  if (anchorLine) return sanitizeInput(anchorLine).slice(0, 80);
  const chorusSection = (sections || []).find((section) => section?.name === "chorus");
  const chorusLine = sanitizeInput(chorusSection?.lines?.[0] || "");
  if (chorusLine) return chorusLine.slice(0, 80);
  const message = sanitizeInput(context?.message || "");
  return message ? message.slice(0, 80) : "For You";
}

function stitchSectionLyrics(context, generatedSections, extras = {}) {
  const sections = (Array.isArray(generatedSections) ? generatedSections : [])
    .filter((section) => section && Array.isArray(section.lines) && section.lines.length > 0);
  const anchorLine = sanitizeInput(extras.anchorLine || "");
  const storyElementsUsed = sanitizeStringArray(extras.storyElementsUsed);

  return {
    title: deriveTitleFromSectionLyrics(context, sections, anchorLine),
    style: context.style || "pop",
    sections,
    anchor_line: anchorLine || sanitizeInput(getSongMapIdea(context?.song_map?.hook) || ""),
    story_elements_used: storyElementsUsed,
  };
}

async function generateSectionLyrics(context, sectionName, options = {}) {
  const normalizedSection = String(sectionName || "").toLowerCase();
  const promptContext = normalizeContext(context);
  const factMap = buildFactMap(promptContext.facts);
  const config = getSectionPromptConfig(normalizedSection);
  const sectionEntries = getSectionContractEntries(promptContext.song_map, normalizedSection);
  const hookEntry = promptContext.song_map?.hook ? formatSongMapEntry(promptContext.song_map.hook, factMap) : "";
  const keyLines = formatSectionContractEntries(promptContext.song_map?.key_lines || [], factMap);
  const motifs = sanitizeStringArray(promptContext.motifs || promptContext.song_map?.motifs || []);
  const priorSectionsText = summarizeExistingSections(options.priorSections);
  const previousSectionDraft = options.previousDraft
    ? getSectionText(options.previousDraft, normalizedSection)
    : "";
  const repairNote = sanitizeForPrompt(options.repairNote || "");
  const narrative = sanitizeForPrompt(promptContext.narrative || promptContext.summary_text || "");
  const message = sanitizeForPrompt(promptContext.message || "");

  const prompt = `${SONGWRITER_PERSONA}

## SECTION TASK
Write ONLY the ${config.heading} of a ${promptContext.style || "pop"} song for ${sanitizeForPrompt(promptContext.recipient_name || "someone special")}.

SECTION ROLE:
- ${config.role}
- Write ${config.lineRange} lines
- Use only story details grounded in this section contract or already-established prior sections
- If the source is thin, stay reflective instead of inventing specifics

GLOBAL STORY BRIEF:
- Occasion: ${sanitizeForPrompt(promptContext.occasion || "celebration")}
- Core message: ${message || "tell the story truthfully"}
${narrative ? `- Narrative: ${narrative}` : ""}

PRIMARY SECTION CONTRACT:
${formatSectionContractEntries(sectionEntries, factMap)}

${hookEntry ? `HOOK / ANCHOR:\n${hookEntry}\n` : ""}${keyLines ? `KEY LINES:\n${keyLines}\n` : ""}${motifs.length > 0 ? `MOTIFS:\n${motifs.map((motif) => `- ${sanitizeForPrompt(motif)}`).join("\n")}\n` : ""}${priorSectionsText ? `PRIOR SECTIONS FOR CONTINUITY:\n${priorSectionsText}\n` : ""}${previousSectionDraft ? `PREVIOUS ${config.heading} DRAFT TO REWRITE:\n${previousSectionDraft}\n` : ""}${repairNote ? `SECTION REPAIR NOTE:\n${repairNote}\n` : ""}
## OUTPUT
Return ONLY valid JSON:
{
  "lines": ["line1", "line2", "line3", "line4"],
  "anchor_line": "only set when this section contains the anchor line, otherwise empty string",
  "story_elements_used": ["facts or ideas you used from the contract"]
}`.trim();

  const llmResult = await generateText({
    prompt,
    taskType: "lyrics",
    temperature: 0.7,
    responseMimeType: "application/json",
  });

  const rawText = (llmResult.text || "").trim();
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`E201_LYRICS_ERROR: No JSON found in ${normalizedSection} response`);
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (parseErr) {
    console.error(`[Songwriter] Failed to parse ${normalizedSection} JSON:`, parseErr.message);
    throw new Error(`Failed to parse generated ${normalizedSection}`);
  }

  return {
    ...normalizeSectionPayload(parsed, normalizedSection),
    provider: llmResult.provider,
    model: llmResult.model,
    usage: llmResult.usage,
  };
}

function getSectionGenerationOrder(context) {
  const songMap = context?.song_map || {};
  return ["verse1", "pre", "chorus", "verse2", "bridge"]
    .filter((sectionName) => {
      const entries = getSectionContractEntries(songMap, sectionName);
      return Array.isArray(entries) && entries.length > 0;
    });
}

async function generateLyricsBySection(context, options = {}) {
  const order = getSectionGenerationOrder(context);
  if (order.length === 0) {
    throw new Error("E201_LYRICS_ERROR: No section contract available");
  }

  const previousDraft = options.previousDraft && Array.isArray(options.previousDraft.sections)
    ? options.previousDraft
    : null;
  const sectionsToRegenerate = Array.isArray(options.sectionsToRegenerate) && options.sectionsToRegenerate.length > 0
    ? new Set(options.sectionsToRegenerate.map((section) => String(section || "").toLowerCase()))
    : null;
  const previousSectionsByName = new Map(
    (previousDraft?.sections || [])
      .filter((section) => section && section.name)
      .map((section) => [String(section.name).toLowerCase(), section])
  );

  const generatedSections = [];
  let anchorLine = "";
  let storyElementsUsed = [];
  let provider = null;
  let model = null;
  let usage = {};

  for (const sectionName of order) {
    const shouldReuse = sectionsToRegenerate
      && !sectionsToRegenerate.has(sectionName)
      && previousSectionsByName.has(sectionName);

    if (shouldReuse) {
      const reusedSection = previousSectionsByName.get(sectionName);
      generatedSections.push({
        name: sectionName,
        lines: (reusedSection.lines || []).map((line) => typeof line === "string" ? line : (line && line.text) || "").filter(Boolean),
      });
      if (!anchorLine && sectionName === "chorus") {
        anchorLine = sanitizeInput(previousDraft.anchor_line || reusedSection.lines?.[0] || "");
      }
      continue;
    }

    const sectionResult = await generateSectionLyrics(context, sectionName, {
      priorSections: generatedSections,
      previousDraft,
      repairNote: buildSectionRepairNote(sectionName, options.fidelity, previousDraft),
    });
    generatedSections.push(sectionResult.section);
    if (!provider && sectionResult.provider) provider = sectionResult.provider;
    if (!model && sectionResult.model) model = sectionResult.model;
    usage = aggregateUsage(usage, sectionResult.usage);
    if (!anchorLine && sectionResult.anchor_line) {
      anchorLine = sectionResult.anchor_line;
    }
    storyElementsUsed = [...storyElementsUsed, ...sectionResult.story_elements_used];
  }

  return {
    lyrics: stitchSectionLyrics(context, generatedSections, {
      anchorLine,
      storyElementsUsed: [...new Set(storyElementsUsed)],
    }),
    provider,
    model,
    usage,
  };
}

function buildStoryCertificationBlock(storyContext) {
  const ensured = ensureSongContract(normalizeContext(storyContext));
  const normalized = ensured.context;
  const parts = [];
  const factMap = buildFactMap(normalized.facts);

  if (normalized.narrative) {
    parts.push(`Narrative:\n${normalized.narrative.slice(0, 2400)}`);
  }

  const facts = filterFactsForPrompt(normalized.facts || [], normalized.narrative)
    .map((fact) => ({ id: fact.id || "", text: factText(fact) }))
    .filter((fact) => fact.text);
  if (facts.length > 0) {
    parts.push(`Key facts:\n${facts.slice(0, 10).map((fact) => `- [${fact.id || "fact"}] ${fact.text}`).join("\n")}`);
  }

  if (normalized.song_map && hasSongMapContent(normalized.song_map)) {
    const songMapLines = [];
    if (normalized.song_map.hook) {
      const hookIdea = getSongMapIdea(normalized.song_map.hook);
      const hookSources = getSongMapSourceFacts(normalized.song_map.hook);
      songMapLines.push(`- hook: ${hookIdea}${hookSources.length > 0 ? ` [source_facts: ${hookSources.join(", ")}]` : ""}`);
    }
    for (const key of ["verse1", "pre", "chorus", "verse2", "bridge", "key_lines"]) {
      const lines = normalized.song_map[key] || [];
      if (Array.isArray(lines) && lines.length > 0) {
        songMapLines.push(`- ${key}: ${lines.map((entry) => {
          const idea = getSongMapIdea(entry);
          const sources = getSongMapSourceFacts(entry);
          const support = sources
            .map((factId) => factMap.get(factId)?.text)
            .filter(Boolean)
            .join("; ");
          return `${idea}${sources.length > 0 ? ` [source_facts: ${sources.join(", ")}${support ? ` => ${support}` : ""}]` : ""}`;
        }).join(" | ")}`);
      }
    }
    if (songMapLines.length > 0) {
      parts.push(`Primary song map:\n${songMapLines.join("\n")}`);
    }
  }

  const primitiveEntries = [
    ["turning_point", normalized.primitives?.turning_point],
    ["resolution", normalized.primitives?.resolution],
    ["theme", normalized.primitives?.theme],
    ["inciting_incident", normalized.primitives?.inciting_incident],
    ["conflict_external", normalized.primitives?.conflict?.external],
    ["conflict_internal", normalized.primitives?.conflict?.internal],
  ].filter(([, value]) => typeof value === "string" && value.trim());
  if (primitiveEntries.length > 0) {
    parts.push(`Story primitives:\n${primitiveEntries.map(([key, value]) => `- ${key}: ${value}`).join("\n")}`);
  }

  const beatEntries = (normalized.beats || [])
    .filter((beat) => beat && beat.id && (typeof beat.strength === "number" || beat.status))
    .sort((a, b) => (b.strength || 0) - (a.strength || 0))
    .slice(0, 8)
    .map((beat) => `- ${beat.id}: strength ${typeof beat.strength === "number" ? beat.strength.toFixed(2) : beat.status || "unknown"}`);
  if (beatEntries.length > 0) {
    parts.push(`Story beats:\n${beatEntries.join("\n")}`);
  }

  if (Array.isArray(normalized.motifs) && normalized.motifs.length > 0) {
    parts.push(`Motifs:\n${normalized.motifs.slice(0, 6).map((motif) => `- ${motif}`).join("\n")}`);
  }

  if (ensured.repaired || !ensured.initialReport.valid) {
    parts.push(`Contract validation:\n- valid: ${ensured.report.valid}\n- repaired: ${ensured.repaired}\n- missing_sections: ${(ensured.initialReport.missingSections || []).join(", ") || "none"}\n- uncited_sections: ${(ensured.initialReport.uncitedSections || []).join(", ") || "none"}`);
  }

  return parts.filter(Boolean).join("\n\n");
}

function normalizeContext(raw = {}) {
  const recipient_name = sanitizeInput(raw.recipient_name || raw.recipientName || raw.recipient || "");
  const message = sanitizeInput(raw.message || raw.initial_prompt || raw.initialPrompt || "");
  const occasion = sanitizeInput(raw.occasion || raw.eventType || raw.arc || "");
  const styleInput = sanitizeInput(raw.style || raw.music_style || "");
  const styleCheck = validateStyle(styleInput);
  const style = styleCheck.normalized;

  const title = sanitizeInput(raw.title || "");
  const relationship_type = sanitizeInput(raw.relationship_type || raw.relationshipType || "");
  const years_known = raw.years_known ?? raw.yearsKnown;
  const specific_memory = sanitizeInput(raw.specific_memory || raw.specificMemory || "");
  const special_phrases = sanitizeInput(raw.special_phrases || raw.specialPhrases || "");
  const what_makes_them_special = sanitizeInput(raw.what_makes_them_special || raw.whatMakesThemSpecial || "");
  const initial_prompt = sanitizeInput(raw.initial_prompt || raw.initialPrompt || raw.message || "");

  const summary_text = sanitizeInput(
    raw.summary?.summary_text || raw.summary?.text || raw.narrative || ""
  );
  const soul = sanitizeInput(raw.summary?.soul || raw.soul || raw.what_makes_them_special || "");
  const narrative = sanitizeInput(raw.narrative || summary_text || "");

  const elements = sanitizeStringMap(raw.elements);

  const facts = Array.isArray(raw.facts)
    ? raw.facts
      .map((f, index) => {
        if (typeof f === "string") {
          return {
            id: `fact_${index + 1}`,
            text: sanitizeInput(f),
            beat: null,
            source_turn: null,
            confidence: null,
          };
        }
        if (f?.text == null) return null;
        return {
          id: sanitizeFactId(f.id || `fact_${index + 1}`),
          text: sanitizeInput(f.text),
          beat: f.beat || null,
          source_turn: f.source_turn ?? null,
          confidence: f.confidence ?? null,
        };
      })
      .filter(Boolean)
    : [];

  const beats = Array.isArray(raw.beats)
    ? raw.beats.filter(b => b && b.strength >= 0.3 && b.status !== "missing")
    : [];

  const atoms = sanitizeStringMap(raw.atoms);

  // NOTE: primitives intentionally NOT using sanitizeStringMap — handles nested objects (e.g., conflict.external)
  const primitives = (raw.primitives && typeof raw.primitives === "object")
    ? Object.fromEntries(
        Object.entries(raw.primitives)
          .filter(([_, v]) => v != null)
          .map(([k, v]) => {
            if (typeof v === "string") return [k, sanitizeInput(v)];
            if (typeof v === "object") {
              // Recursively sanitize nested object string values (e.g., conflict.external)
              return [k, Object.fromEntries(
                Object.entries(v)
                  .filter(([_, sv]) => sv != null)
                  .map(([sk, sv]) => [sk, typeof sv === "string" ? sanitizeInput(sv) : sv])
              )];
            }
            return [k, v];
          })
      )
    : {};

  const dials = sanitizeStringMap(raw.dials);
  const motifs = sanitizeStringArray(raw.motifs);
  const song_map = sanitizeSongMap(raw.song_map || raw.songMap, facts);
  const evaluation = raw.evaluation && typeof raw.evaluation === "object"
    ? sanitizeJsonValue(raw.evaluation)
    : null;

  const memoryAnswersRaw = raw.memory_answers || raw.memoryAnswers;
  const memory_answers = Array.isArray(memoryAnswersRaw)
    ? memoryAnswersRaw
      .map(a => ({
        question_id: sanitizeInput(a?.question_id),
        question: sanitizeInput(a?.question),
        answer: sanitizeInput(a?.answer),
      }))
      .filter(a => a.question && a.answer)
    : [];

  return {
    title,
    recipient_name,
    message,
    occasion,
    style,
    relationship_type,
    years_known,
    specific_memory,
    special_phrases,
    what_makes_them_special,
    memory_answers,
    initial_prompt,
    summary_text,
    narrative,
    soul,
    elements,
    facts,
    beats,
    atoms,
    primitives,
    dials,
    motifs,
    song_map,
    evaluation,
  };
}

function buildStoryArcSection(context, contractReport = null) {
  const { beats, atoms, primitives, facts, song_map, motifs } = context;
  // Guard: skip if no structured story data
  if (!beats?.length && !atoms?.who && !primitives?.theme && !facts?.length && !hasSongMapContent(song_map)) return "";

  // Sort facts by source_turn for temporal order (preserve beat metadata)
  const sortedFacts = [...(facts || [])]
    .sort((a, b) => (a.source_turn || 0) - (b.source_turn || 0));
  const factMap = buildFactMap(sortedFacts);
  const contractFirst = hasSongMapContent(song_map) && !!contractReport?.valid;

  const sections = [];
  sections.push("## STORY ARC → SONG STRUCTURE\n");
  sections.push("Your song must tell this story in order. Each section has a specific job:\n");

  if (hasSongMapContent(song_map)) {
    sections.push(contractFirst
      ? "PRIMARY STORY-TO-SONG CONTRACT (treat this as binding story scaffolding):\n"
      : "PRIMARY STORY-TO-SONG MAP (follow this before improvising):\n");
    if (song_map.hook) sections.push(`HOOK:\n${formatSongMapEntry(song_map.hook, factMap)}\n`);
    if (Array.isArray(song_map.verse1) && song_map.verse1.length > 0) {
      sections.push(`VERSE 1 (SETUP):\n${song_map.verse1.map((entry) => formatSongMapEntry(entry, factMap)).filter(Boolean).join("\n")}\n→ Tell these setup beats in order.\n`);
    }
    if (Array.isArray(song_map.pre) && song_map.pre.length > 0) {
      sections.push(`PRE:\n${song_map.pre.map((entry) => formatSongMapEntry(entry, factMap)).filter(Boolean).join("\n")}\n`);
    }
    if (Array.isArray(song_map.chorus) && song_map.chorus.length > 0) {
      sections.push(`CHORUS (MEANING):\n${song_map.chorus.map((entry) => formatSongMapEntry(entry, factMap)).filter(Boolean).join("\n")}\n→ Keep the chorus anchored in what the story means.\n`);
    }
    if (Array.isArray(song_map.verse2) && song_map.verse2.length > 0) {
      sections.push(`VERSE 2 (CHANGE + CONSEQUENCE):\n${song_map.verse2.map((entry) => formatSongMapEntry(entry, factMap)).filter(Boolean).join("\n")}\n→ Carry the change and consequence, not just extra keywords.\n`);
    }
    if (Array.isArray(song_map.bridge) && song_map.bridge.length > 0) {
      sections.push(`BRIDGE (TURN / VOW / REFLECTION):\n${song_map.bridge.map((entry) => formatSongMapEntry(entry, factMap)).filter(Boolean).join("\n")}\n`);
    }
    if (Array.isArray(song_map.key_lines) && song_map.key_lines.length > 0) {
      sections.push(`KEY LINES TO PRESERVE:\n${song_map.key_lines.map((entry) => formatSongMapEntry(entry, factMap)).filter(Boolean).join("\n")}\n`);
    }
  }

  if (contractFirst) {
    if (motifs?.length) {
      sections.push(`RECURRING MOTIFS:\n${motifs.map((motif) => `- ${motif}`).join("\n")}\n`);
    }
    return sections.join("\n");
  }

  // Data-driven song section mapping (verse/bridge/chorus → story beats)
  const sectionDefs = [
    {
      label: "VERSE 1 (THE BEGINNING)",
      instruction: "Paint the scene. Where did this story start?",
      entries: [atoms?.where && `Setting: ${atoms.where}`, atoms?.when && `When: ${atoms.when}`, atoms?.who && `Who: ${atoms.who}`],
      beatFilter: ["context", "scene", "meeting", "relationship"],
    },
    {
      label: "VERSE 2 (THE DEVELOPMENT)",
      instruction: "What made this story worth telling?",
      entries: [atoms?.action && `What happened: ${atoms.action}`, atoms?.stakes && `What was at stake: ${atoms.stakes}`, primitives?.inciting_incident && `Key event: ${primitives.inciting_incident}`, primitives?.conflict?.external && `Challenge: ${primitives.conflict.external}`, primitives?.conflict?.internal && `Inner struggle: ${primitives.conflict.internal}`],
      beatFilter: ["moment", "struggle", "stakes", "discovery"],
    },
    {
      label: "BRIDGE (THE TURNING POINT)",
      instruction: "The moment everything changed.",
      entries: [atoms?.turn && `The turn: ${atoms.turn}`, primitives?.turning_point && `Turning point: ${primitives.turning_point}`],
      beatFilter: ["turning_point", "impact"],
    },
    {
      label: "CHORUS (THE EMOTIONAL TRUTH)",
      instruction: "What the story MEANS. Not a compliment list — the truth underneath.",
      entries: [primitives?.resolution && `Resolution: ${primitives.resolution}`, primitives?.theme && `Theme: ${primitives.theme}`, atoms?.after && `After: ${atoms.after}`],
      beatFilter: ["meaning", "detail"],
      factLabel: "Emotional details",
    },
  ];

  for (const def of sectionDefs) {
    const details = def.entries.filter(Boolean);
    const beatFacts = sortedFacts
      .filter(f => def.beatFilter.includes(f.beat?.toLowerCase()))
      .map(factText).filter(Boolean);
    if (beatFacts.length) details.push(`${def.factLabel || "Story details"}:\n${beatFacts.map(f => `  - ${f}`).join("\n")}`);
    if (details.length) sections.push(`${def.label}:\n${details.join("\n")}\n→ ${def.instruction}\n`);
  }

  // Sensory palette from atoms
  const sensory = [atoms?.sound, atoms?.smell, atoms?.physical, atoms?.object]
    .filter(Boolean);
  if (sensory.length) {
    sections.push(`SENSORY PALETTE (weave these in):\n${sensory.map(s => `- ${s}`).join("\n")}\n`);
  }
  if (motifs?.length) {
    sections.push(`RECURRING MOTIFS:\n${motifs.map((motif) => `- ${motif}`).join("\n")}\n`);
  }

  return sections.join("\n");
}

function buildSongwriterPrompt(context, options = {}) {
  const normalized = normalizeContext(context);
  const hasStructuredStory = hasStructuredStoryData(normalized);
  const ensured = ensureSongContract(normalized);
  const prepared = ensured.context;
  const contractReport = ensured.report;
  const revisionNote = sanitizeInput(options.revisionNote || "");
  const previousDraft = serializeLyricsDraftForPrompt(options.previousDraft);
  const styleName = MUSIC_STYLES[prepared.style] || prepared.style || "Pop";
  const relationshipDesc = prepared.relationship_type
    ? RELATIONSHIP_DESCRIPTORS[prepared.relationship_type] || prepared.relationship_type
    : null;

  const safe = {
    ...prepared,
    message: sanitizeForPrompt(prepared.message),
    specific_memory: sanitizeForPrompt(prepared.specific_memory),
    special_phrases: sanitizeForPrompt(prepared.special_phrases),
    what_makes_them_special: sanitizeForPrompt(prepared.what_makes_them_special),
    narrative: sanitizeForPrompt(prepared.narrative),
    summary_text: sanitizeForPrompt(prepared.summary_text),
    soul: sanitizeForPrompt(prepared.soul),
    elements: Object.fromEntries(
      Object.entries(prepared.elements || {}).map(([key, value]) => [key, sanitizeForPrompt(value)])
    ),
    facts: Array.isArray(prepared.facts)
      ? prepared.facts.map(f => ({
        ...f,
        id: sanitizeFactId(f.id),
        text: sanitizeForPrompt(f.text),
      }))
      : [],
    motifs: Array.isArray(prepared.motifs)
      ? prepared.motifs.map((motif) => sanitizeForPrompt(motif))
      : [],
    song_map: prepared.song_map
      ? {
        hook: prepared.song_map.hook
          ? {
            idea: sanitizeForPrompt(getSongMapIdea(prepared.song_map.hook)),
            source_facts: getSongMapSourceFacts(prepared.song_map.hook),
          }
          : null,
        verse1: (prepared.song_map.verse1 || []).map((entry) => ({
          idea: sanitizeForPrompt(getSongMapIdea(entry)),
          source_facts: getSongMapSourceFacts(entry),
        })),
        pre: (prepared.song_map.pre || []).map((entry) => ({
          idea: sanitizeForPrompt(getSongMapIdea(entry)),
          source_facts: getSongMapSourceFacts(entry),
        })),
        chorus: (prepared.song_map.chorus || []).map((entry) => ({
          idea: sanitizeForPrompt(getSongMapIdea(entry)),
          source_facts: getSongMapSourceFacts(entry),
        })),
        verse2: (prepared.song_map.verse2 || []).map((entry) => ({
          idea: sanitizeForPrompt(getSongMapIdea(entry)),
          source_facts: getSongMapSourceFacts(entry),
        })),
        bridge: (prepared.song_map.bridge || []).map((entry) => ({
          idea: sanitizeForPrompt(getSongMapIdea(entry)),
          source_facts: getSongMapSourceFacts(entry),
        })),
        motifs: (prepared.song_map.motifs || []).map((line) => sanitizeForPrompt(line)),
        key_lines: (prepared.song_map.key_lines || []).map((entry) => ({
          idea: sanitizeForPrompt(getSongMapIdea(entry)),
          source_facts: getSongMapSourceFacts(entry),
        })),
      }
      : null,
    memory_answers: Array.isArray(prepared.memory_answers)
      ? prepared.memory_answers.map(a => ({
        question_id: a.question_id,
        question: sanitizeForPrompt(a.question),
        answer: sanitizeForPrompt(a.answer),
      }))
      : [],
  };

  const contextSections = [];
  contextSections.push(`RECIPIENT: ${safe.recipient_name || "someone special"}`);
  contextSections.push(`OCCASION: ${safe.occasion || "celebration"}`);
  contextSections.push(`MUSIC STYLE: ${styleName}`);

  if (safe.message) {
    contextSections.push(`CORE MESSAGE: "${safe.message}"`);
  }

  if (relationshipDesc) {
    contextSections.push(`RELATIONSHIP: ${safe.recipient_name || "They"} is their ${relationshipDesc}`);
  }

  if (safe.years_known) {
    contextSections.push(`HISTORY: They have known each other for ${safe.years_known} years`);
  }

  if (safe.specific_memory) {
    contextSections.push(`SPECIFIC MEMORY: "${safe.specific_memory}"`);
  }

  if (safe.special_phrases) {
    contextSections.push(`SPECIAL PHRASES/NICKNAMES: "${safe.special_phrases}"`);
  }

  if (safe.what_makes_them_special) {
    contextSections.push(`WHAT MAKES THEM SPECIAL: "${safe.what_makes_them_special}"`);
  }

  const narrativeText = safe.summary_text || safe.narrative;
  if (narrativeText) {
    contextSections.push(`STORY NARRATIVE:\n${narrativeText}`);
  }

  if (safe.soul) {
    contextSections.push(`THE SOUL (most important details):\n${safe.soul}`);
  }

  if (safe.motifs.length > 0) {
    contextSections.push(`RECURRING MOTIFS:\n${safe.motifs.map((motif) => `- ${motif}`).join("\n")}`);
  }

  const detailLines = [];
  for (const [key, value] of Object.entries(safe.elements || {})) {
    if (value && value.trim()) {
      const label = key.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
      detailLines.push(`- ${label}: ${value}`);
    }
  }
  for (const fact of filterFactsForPrompt(safe.facts || [], narrativeText)) {
    if (fact?.text) {
      const prefix = fact.id ? `[${fact.id}] ` : "";
      detailLines.push(`- ${prefix}${fact.text}`);
    }
  }
  if (detailLines.length > 0) {
    contextSections.push(`KEY DETAILS:\n${detailLines.join("\n")}`);
  }

  const supportingStoryLines = [];
  if (safe.atoms?.where) supportingStoryLines.push(`- Setting: ${sanitizeForPrompt(safe.atoms.where)}`);
  if (safe.atoms?.when) supportingStoryLines.push(`- When: ${sanitizeForPrompt(safe.atoms.when)}`);
  if (safe.atoms?.who) supportingStoryLines.push(`- Who: ${sanitizeForPrompt(safe.atoms.who)}`);
  if (safe.atoms?.sound) supportingStoryLines.push(`- Sound: ${sanitizeForPrompt(safe.atoms.sound)}`);
  if (safe.atoms?.smell) supportingStoryLines.push(`- Smell: ${sanitizeForPrompt(safe.atoms.smell)}`);
  if (safe.atoms?.physical) supportingStoryLines.push(`- Physical detail: ${sanitizeForPrompt(safe.atoms.physical)}`);
  if (safe.atoms?.object) supportingStoryLines.push(`- Object: ${sanitizeForPrompt(safe.atoms.object)}`);
  if (safe.primitives?.theme) supportingStoryLines.push(`- Theme: ${sanitizeForPrompt(safe.primitives.theme)}`);
  if (safe.primitives?.resolution) supportingStoryLines.push(`- Resolution: ${sanitizeForPrompt(safe.primitives.resolution)}`);
  if (safe.primitives?.turning_point) supportingStoryLines.push(`- Turning point: ${sanitizeForPrompt(safe.primitives.turning_point)}`);
  if (supportingStoryLines.length > 0) {
    contextSections.push(`SUPPORTING STORY DETAILS:\n${supportingStoryLines.join("\n")}`);
  }

  if (hasStructuredStory && (ensured.repaired || !ensured.initialReport.valid)) {
    contextSections.push(
      `CONTRACT REPAIR:\n- valid: ${contractReport.valid}\n- repaired internally: ${ensured.repaired ? "yes" : "no"}\n- missing sections repaired: ${(ensured.initialReport.missingSections || []).join(", ") || "none"}\n- uncited sections repaired: ${(ensured.initialReport.uncitedSections || []).join(", ") || "none"}`
    );
  }

  if (Array.isArray(safe.memory_answers) && safe.memory_answers.length > 0) {
    const answersText = safe.memory_answers
      .map(a => `- ${a.question}: "${a.answer}"`)
      .join("\n");
    contextSections.push(`DEEPER STORY DETAILS:\n${answersText}`);
  }

  // Story arc mapping (only emitted when structured story data exists)
  const storyArcSection = buildStoryArcSection(safe, contractReport);

  const revisionSection = revisionNote
    ? `\n## REVISION NOTE\n${revisionNote}\n`
    : "";
  const previousDraftSection = previousDraft
    ? `\n## PREVIOUS DRAFT TO REWRITE\nThis draft has musical material worth preserving, but it failed story certification. Keep any grounded lines that already work. Rewrite the weak or unsupported parts until the full song tells the story faithfully.\n${previousDraft}\n`
    : "";

  return `${SONGWRITER_PERSONA}

## SONG BRIEF
${contextSections.join("\n")}
${storyArcSection ? `\n${storyArcSection}` : ""}
${previousDraftSection}
## YOUR TASK
Transform this story into a ${styleName} song that makes ${safe.recipient_name || "them"} feel truly SEEN.

Think like a legendary songwriter:
1. **EMOTIONAL EXCAVATION**: Find the specific moment or feeling that makes this relationship unique. Avoid generic praise.
2. **SCENE WORK**: Turn moments into scenes (place, object, sound, light, motion). Use grounded imagery.
3. **THE ANCHOR LINE**: Create one powerful line that captures the essence of the message and appears in the chorus.
4. **CADENCE**: Each line should be 6-12 syllables for singability in ${styleName} style. Prefer internal rhythm to obvious rhyme.
5. **PERSONAL TOUCHES**: If nicknames or special phrases were provided, incorporate them naturally.
6. **REVISION PASS**: Before output, remove any cliché or abstract line; replace with specific, story-rooted language.

CRITICAL — TELL THE STORY:
- Verse 1 must set the scene (place, time, how it began)
- Verse 2 must develop what happened (the events, the challenge)
- Bridge must capture the turning point or emotional shift
- Chorus must express what the whole story means emotionally
- The listener should be able to RECONSTRUCT the story from the lyrics alone
- Do NOT just mention details — NARRATE them in sequence
${revisionSection}

## PROVIDER-SAFE LYRIC GUIDELINES
- Keep lyrics original and personal; do NOT reference real artists, celebrities, or producer tags.
- Do NOT use brand/product names or "in the style of X" language.
- When a place name overlaps with a celebrity name (e.g., Madonna University, Prince Street), describe the place without the celebrity word — use "the campus", "our school", "the old road", etc. instead.
- Keep content PG-13: avoid explicit sexual content, graphic violence, hate speech, and drug-use references.
- Avoid direct age callouts (especially numeric ages); prefer age-neutral wording unless strictly required by story context.

## STRUCTURE
Create:
- 1 CHORUS (4-6 lines) - The emotional heart, featuring the anchor line and recipient's name
- 2-3 VERSES (4-6 lines each) - Story and details that build to the chorus
- 1 BRIDGE (optional, 2-4 lines) - A reflective or forward-looking moment

## QUALITY GATE (self-check before output)
- If the story includes sensory detail, does each verse use at least one story-grounded sensory or behavioral detail?
- Is the chorus the emotional truth of the story (not a compliment list)?
- Are there any clichés or generic praise lines? If yes, replace them.
- Does the anchor line feel singular and unforgettable?
- Do the lyrics clearly reflect the provided story details?
- Can you point to where every concrete lyric detail came from in the story context? If not, replace it.
- Do any lines risk provider rejection (real artist names, brands, explicit content, drugs, graphic violence)?
If any check fails, revise once silently before returning JSON.

## OUTPUT FORMAT
Return ONLY valid JSON:
{
  "title": "Song title that captures the essence",
  "style": "${safe.style || "pop"}",
  "sections": [
    {"name": "verse1", "lines": ["line1", "line2", "line3", "line4"]},
    {"name": "chorus", "lines": ["line1 with ${safe.recipient_name || "the recipient"}", "line2", "line3", "line4"]},
    {"name": "verse2", "lines": ["line1", "line2", "line3", "line4"]},
    {"name": "bridge", "lines": ["line1", "line2"]}
  ],
  "anchor_line": "The most powerful line from the chorus",
  "story_elements_used": ["list of story details woven into lyrics"]
}`.trim();
}

function buildFidelityRepairNote(fidelity) {
  if (!fidelity || typeof fidelity !== "object") return "";

  const parts = [];
  const missing = Array.isArray(fidelity.missing_story_beats)
    ? fidelity.missing_story_beats
    : (Array.isArray(fidelity.missed_facts) ? fidelity.missed_facts : []);
  const invented = Array.isArray(fidelity.invented_details) ? fidelity.invented_details : [];
  const uncoveredSongMapSlots = Array.isArray(fidelity.uncovered_song_map_slots)
    ? fidelity.uncovered_song_map_slots
    : [];
  const brokenCitations = Array.isArray(fidelity.broken_citations)
    ? fidelity.broken_citations
    : [];
  const unsupportedLines = Array.isArray(fidelity.unsupported_lines)
    ? fidelity.unsupported_lines
    : [];
  const flattened = typeof fidelity.flattened_emotional_arc === "string" ? fidelity.flattened_emotional_arc.trim() : "";
  const rewriteTargets = Array.isArray(fidelity.rewrite_targets) ? fidelity.rewrite_targets : [];
  const feedback = typeof fidelity.feedback === "string" ? fidelity.feedback.trim() : "";

  if (missing.length > 0) parts.push(`Missing story beats/details: ${missing.slice(0, 4).join("; ")}`);
  if (uncoveredSongMapSlots.length > 0) parts.push(`Story sections still missing: ${uncoveredSongMapSlots.slice(0, 4).join("; ")}`);
  if (brokenCitations.length > 0) parts.push(`Broken citations: ${brokenCitations.slice(0, 4).join("; ")}`);
  if (invented.length > 0) parts.push(`Invented details to remove: ${invented.slice(0, 4).join("; ")}`);
  if (unsupportedLines.length > 0) parts.push(`Unsupported lines to replace: ${unsupportedLines.slice(0, 4).join("; ")}`);
  if (flattened) parts.push(`Emotional arc issue: ${flattened}`);
  if (rewriteTargets.length > 0) parts.push(`Lines to rethink: ${rewriteTargets.slice(0, 4).join("; ")}`);
  if (feedback) parts.push(`Judge guidance: ${feedback}`);

  return parts.join(". ");
}

function refineContextForRetry(context, fidelity) {
  if (!context || typeof context !== "object") return context;
  const next = {
    ...context,
    dials: { ...(context.dials || {}) },
  };

  const songMap = context.song_map;
  if (hasSongMapContent(songMap)) {
    const storySpine = [
      getSongMapIdea(songMap.hook),
      ...(songMap.verse1 || []).slice(0, 2),
      ...(songMap.verse2 || []).slice(0, 2),
      ...(songMap.chorus || []).slice(0, 2),
      ...(songMap.bridge || []).slice(0, 2),
      ...(songMap.key_lines || []).slice(0, 2),
    ]
      .map((entry) => getSongMapIdea(entry))
      .filter(Boolean);

    if (storySpine.length > 0) {
      const spineText = storySpine.join(" ");
      if (!String(next.narrative || "").includes(spineText)) {
        next.narrative = [next.narrative, `Story spine: ${spineText}`].filter(Boolean).join("\n");
      }
    }
  }

  const missing = Array.isArray(fidelity?.missing_story_beats)
    ? fidelity.missing_story_beats.slice(0, 4).join("; ")
    : "";
  const uncoveredSongMapSlots = Array.isArray(fidelity?.uncovered_song_map_slots)
    ? fidelity.uncovered_song_map_slots.slice(0, 4).join("; ")
    : "";
  const focusRepair = [missing, uncoveredSongMapSlots].filter(Boolean).join("; ");
  if (focusRepair) {
    next.dials.focus = sanitizeInput(`repair:${focusRepair}`);
  }

  return next;
}

async function generateLyricsWithLLM(context, options = {}) {
  const prompt = buildSongwriterPrompt(context, options);
  const llmResult = await generateText({
    prompt,
    taskType: "lyrics",
    temperature: 0.7,
    responseMimeType: "application/json",
  });

  const rawText = (llmResult.text || "").trim();
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("E201_LYRICS_ERROR: No JSON found in response");
  }

  let lyrics;
  try {
    lyrics = JSON.parse(jsonMatch[0]);
  } catch (parseErr) {
    console.error("[Songwriter] Failed to parse lyrics JSON:", parseErr.message);
    throw new Error("Failed to parse generated lyrics");
  }

  // Normalize lines: LLMs sometimes return {text: "..."} objects instead of plain strings
  if (lyrics && Array.isArray(lyrics.sections)) {
    for (const section of lyrics.sections) {
      if (Array.isArray(section.lines)) {
        section.lines = section.lines.map(line =>
          typeof line === "string" ? line : (line && line.text) || String(line || "")
        );
      }
    }
  }

  return {
    lyrics,
    provider: llmResult.provider,
    model: llmResult.model,
    usage: llmResult.usage,
  };
}

/**
 * Build fallback lyrics without LLM
 */
function buildLyrics(context) {
  const normalized = normalizeContext(context);
  const name = normalized.recipient_name || "";
  const hasName = Boolean(normalized.recipient_name);

  const anchorLine = hasName
    ? `${name}, ${normalized.message || "this song's for you"}`
    : "This one's for you";

  const sections = [];

  sections.push({
    name: "verse1",
    lines: [
      normalized.specific_memory || "From the very start",
      normalized.what_makes_them_special || "Something caught my eye",
      "I knew right then and there",
      "This moment would define",
    ].map(line => line.split(" ").slice(0, 8).join(" ")),
  });

  sections.push({
    name: "chorus",
    lines: [
      anchorLine,
      normalized.special_phrases || "You light up every day",
      normalized.message || "This is your story",
      hasName ? `${name}, this song's for you` : "This song's for you",
    ].map(line => line.split(" ").slice(0, 10).join(" ")),
  });

  sections.push({
    name: "verse2",
    lines: [
      "Looking back now I can see",
      "Every moment led to this",
      normalized.soul || "When our paths aligned",
      "Nothing was the same",
    ].map(line => line.split(" ").slice(0, 8).join(" ")),
  });

  return {
    title: normalized.title || (hasName ? `For ${name}` : "For You"),
    style: normalized.style || "pop",
    sections,
    anchor_line: anchorLine,
  };
}

async function generateLyricsFromContext(context) {
  const normalized = normalizeContext(context);
  const ensured = ensureSongContract(normalized);
  const workingContext = ensured.context;
  const canUseSectionedGeneration = ensured.report.valid && ensured.initialReport.hasCitedContract;

  if (!isAvailable()) {
    const err = new Error("AI_UNAVAILABLE");
    err.code = "AI_UNAVAILABLE";
    throw err;
  }

  let lastQuality = 0;
  let bestLyrics = null;
  let bestQuality = 0;
  let bestFidelityScore = -1;
  let lastFidelity = null;
  let lastDraft = null;
  const hasStoryContext = !!(workingContext.narrative || (workingContext.facts && workingContext.facts.length > 0));

  for (let attempt = 0; attempt <= SELF_CORRECTION_MAX; attempt++) {
    try {
      const repairNote = buildFidelityRepairNote(lastFidelity);
      const retryContext = lastFidelity ? refineContextForRetry(workingContext, lastFidelity) : workingContext;
      const safeFeedback = repairNote ? sanitizeForPrompt(repairNote).slice(0, 320) : null;
      const revisionParts = [];
      if (safeFeedback) {
        revisionParts.push(`STORY FIDELITY REPAIR: ${safeFeedback}. Rewrite to narrate the events in sequence, preserve the real payoff, and remove unsupported specifics.`);
      }
      if (attempt > 0 && lastQuality < QUALITY_MIN_SCORE) {
        revisionParts.push("QUALITY REPAIR: tighten cadence, remove generic filler, keep the anchor line singular, and make every section pull specific weight in the story.");
      } else if (attempt > 0 && !safeFeedback) {
        revisionParts.push("The first draft was too generic. Use more concrete details from the story, add vivid imagery, avoid clichés, and make the anchor line singular and unforgettable.");
      }
      const revisionNote = revisionParts.join(" ");
      const sectionsToRegenerate = canUseSectionedGeneration && lastFidelity
        ? identifySectionsForRepair(lastFidelity, lastDraft)
        : null;
      const llmResult = canUseSectionedGeneration
        ? await generateLyricsBySection(retryContext, {
          previousDraft: lastDraft,
          fidelity: lastFidelity,
          sectionsToRegenerate,
        })
        : await generateLyricsWithLLM(retryContext, {
          revisionNote,
          previousDraft: lastDraft,
        });
      const validated = validateAndRepairLyrics(llmResult.lyrics, normalized.recipient_name, normalized.style);
      const lyrics = validated.lyrics || llmResult.lyrics;
      const qualityScore = assessQuality(lyrics, workingContext);
      lastQuality = qualityScore;
      lastDraft = lyrics;

      if (qualityScore >= QUALITY_MIN_SCORE) {
        // Track best quality-passing lyrics
        const candidateResult = {
          lyrics,
          lyrics_status: "generated",
          provider: llmResult.provider,
          model: llmResult.model,
          usage: llmResult.usage,
          filtered_fact_count: filterFactsForPrompt(workingContext.facts || [], workingContext.narrative).length,
          contract_validation: {
            valid: ensured.report.valid,
            repaired: ensured.repaired,
            missing_sections: ensured.initialReport.missingSections || [],
            uncited_sections: ensured.initialReport.uncitedSections || [],
          },
          validation_issues: validated.issues.length > 0 ? validated.issues : undefined,
        };
        if (!bestLyrics || qualityScore > bestQuality) {
          bestLyrics = candidateResult;
          bestQuality = qualityScore;
        }

        // Run fidelity judge if story context exists
        if (hasStoryContext) {
          try {
            const fidelity = await assessNarrativeFidelity(lyrics, workingContext);
            candidateResult.fidelity_debug = fidelity;
            if (
              !bestLyrics ||
              fidelity.total > bestFidelityScore ||
              (fidelity.total === bestFidelityScore && qualityScore > bestQuality)
            ) {
              bestLyrics = candidateResult;
              bestQuality = qualityScore;
              bestFidelityScore = fidelity.total;
            }
            if (Number.isFinite(fidelity.total) && fidelity.total >= FIDELITY_MIN_SCORE) {
              return { ...candidateResult, acceptance_reason: "quality_and_fidelity_passed" };
            }
            lastFidelity = fidelity;
          } catch (judgeErr) {
            console.warn("[Songwriter] Fidelity judge failed, accepting quality-passing lyrics:", judgeErr.message);
            return { ...candidateResult, acceptance_reason: "judge_unavailable_quality_passed" };
          }

          if (attempt >= SELF_CORRECTION_MAX) {
            const inventedDetails = Array.isArray(lastFidelity?.invented_details) ? lastFidelity.invented_details : [];
            const isBorderlinePass = inventedDetails.length === 0
              && Number.isFinite(lastFidelity?.total)
              && lastFidelity.total >= (FIDELITY_MIN_SCORE - BORDERLINE_FIDELITY_MARGIN);
            if (isBorderlinePass) {
              return {
                ...candidateResult,
                acceptance_reason: "self_correction_exhausted_borderline_fidelity",
              };
            }
            const fidelityError = new Error("LYRICS_FIDELITY_LOW");
            fidelityError.code = "LYRICS_FIDELITY_LOW";
            fidelityError.fidelity = lastFidelity;
            throw fidelityError;
          }
          continue; // retry with fidelity feedback
        }

        // No story context — skip judge, return immediately
        return { ...candidateResult, acceptance_reason: "quality_passed_no_story_context" };
      }
    } catch (err) {
      if (
        err &&
        (
          err.code === "AI_UNAVAILABLE" ||
          err.message === "AI_UNAVAILABLE" ||
          err.code === ERROR_CODES.ALL_PROVIDERS_FAILED
        )
      ) {
        const error = new Error("AI_UNAVAILABLE");
        error.code = "AI_UNAVAILABLE";
        throw error;
      }
      if (err && err.code === "LYRICS_FIDELITY_LOW") {
        throw err;
      }
      throw err;
    }
  }

  // Quality gate failed on all attempts — return best if we have one
  if (bestLyrics) {
    console.warn("[Songwriter] Quality below threshold, returning best attempt");
    return bestLyrics;
  }
  const qualityError = new Error("LYRICS_QUALITY_LOW");
  qualityError.code = "LYRICS_QUALITY_LOW";
  qualityError.quality_score = lastQuality;
  throw qualityError;
}

/**
 * Assess quality of generated lyrics
 */
function assessQuality(lyrics, storyContext) {
  let score = 100;
  const sections = lyrics.sections || [];
  const allLines = sections.flatMap(s => s.lines || []);
  const lyricsText = allLines.join(" ").toLowerCase();

  const recipient = storyContext.recipient_name || "";
  if (recipient) {
    const hasRecipientName = allLines.some(
      line => line.toLowerCase().includes(recipient.toLowerCase())
    );
    if (!hasRecipientName) score -= 20;
  }

  const genericPhrases = [
    "you mean the world",
    "you're amazing",
    "you're the best",
    "i love you so much",
    "you're so special",
    "you are my everything",
    "i can't live without you",
    "from the moment i met you",
    "you light up my life",
    "till the end of time",
    "forever and always",
    "you're my sunshine",
    "thank you for everything",
    "you are my rock",
    "you complete me",
  ];
  for (const phrase of genericPhrases) {
    if (allLines.some(line => line.toLowerCase().includes(phrase))) {
      score -= 8;
    }
  }

  const elementsText = Object.values(storyContext.elements || {}).join(" ");
  const factsText = Array.isArray(storyContext.facts)
    ? storyContext.facts.map(factText).join(" ")
    : "";
  const storyContent = `${elementsText} ${factsText}`.toLowerCase();
  const storyWords = storyContent.split(/\s+/).filter(w => w.length > 4);

  let storyConnectionCount = 0;
  const matchedStoryWords = new Set();
  for (const word of storyWords) {
    if (lyricsText.includes(word)) {
      storyConnectionCount++;
      matchedStoryWords.add(word);
    }
  }
  const storyConnectionRate = storyWords.length > 0
    ? storyConnectionCount / Math.min(storyWords.length, 10)
    : 0;

  if (storyConnectionRate < 0.3) score -= 15;
  if (storyConnectionRate > 0.5) score += 6;
  if (storyWords.length > 0 && matchedStoryWords.size < 2) score -= 10;

  const sensoryWords = [
    "rain", "wind", "snow", "summer", "winter", "morning", "night",
    "light", "shadow", "street", "door", "kitchen", "room", "bed",
    "porch", "stairs", "car", "bus", "train", "phone", "letter",
    "photo", "glass", "coffee", "tea", "bread", "music", "guitar",
    "drum", "whisper", "silence", "laughter", "tears", "hands", "eyes",
    "breath", "heartbeat", "smell", "taste", "touch", "saw", "heard",
  ];
  const sensorySet = new Set(sensoryWords);
  const storyHasSensory = Boolean(
    storyContext?.atoms?.sound ||
    storyContext?.atoms?.smell ||
    storyContext?.atoms?.physical ||
    storyContext?.atoms?.object ||
    sensoryWords.some((word) => storyContent.includes(word))
  );
  const verseSections = sections.filter(s => (s.name || "").toLowerCase().includes("verse"));
  if (storyHasSensory) {
    for (const verse of verseSections) {
      const verseText = (verse.lines || []).join(" ").toLowerCase();
      const hasSensory = verseText.split(/\W+/).some(word => sensorySet.has(word));
      if (!hasSensory) score -= 8;
    }
  }

  const anchorLine = (lyrics.anchor_line || "").toLowerCase();
  if (anchorLine) {
    const genericAnchors = [
      "this song's for you",
      "this ones for you",
      "this one's for you",
      "for you",
    ];
    if (genericAnchors.some(p => anchorLine.includes(p))) {
      score -= 10;
    }
    if (anchorLine.split(/\s+/).length < 5) score -= 6;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * LLM-as-judge: Score how well lyrics tell the story.
 * Returns { scores, total, missed_facts, feedback } or throws on failure.
 */
async function assessNarrativeFidelity(lyrics, storyContext) {
  const storyBlock = buildStoryCertificationBlock(storyContext);
  const lyricsText = flattenLyricsText(lyrics);

  const prompt = `You are a story fidelity judge for song lyrics. Score how well these lyrics TELL the story (not just mention keywords).

STORY:
${storyBlock}

LYRICS:
${lyricsText}

  Score 0-10 each:
1. COVERAGE: How many key story facts appear in the lyrics?
2. SEQUENTIAL FLOW: Do lyrics tell the story beginning→middle→end?
3. SPECIFICITY: Are details narrated into scenes or just name-dropped?
4. EMOTIONAL TRUTH: Does the chorus capture what the story means?
5. FAITHFULNESS: Do the lyrics avoid unsupported concrete details? Deduct for each invented person, event, object, place, activity, food, or quoted phrase not grounded in the story.

Use the full story package, especially the primary song map, to judge whether each song section is carrying the right part of the story. A lyric that mentions the right keywords in the wrong section should lose points.

Return ONLY valid JSON:
{"scores":{"coverage":N,"flow":N,"specificity":N,"emotional_truth":N,"faithfulness":N},"total":N,"missed_facts":["fact not in lyrics"],"missing_story_beats":["missing setup/turn/payoff detail"],"uncovered_song_map_slots":["verse1/chorus/bridge slot not expressed"],"broken_citations":["contract item cites the wrong fact"],"unsupported_lines":["lyric line not supported by the story"],"invented_details":["detail not in story"],"flattened_emotional_arc":"short note or empty string","rewrite_targets":["line or issue to fix"],"feedback":"one sentence: what to fix"}`;

  const result = await generateText({
    prompt,
    taskType: "fidelity_judge",
    temperature: 0.1,
    responseMimeType: "application/json",
  });

  const rawText = (result.text || "").trim();
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in fidelity judge response");

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error("Malformed JSON from fidelity judge");
  }

  // Compute total server-side — never trust the LLM's self-reported total
  const scores = parsed.scores || {};
  const requiredScoreKeys = ["coverage", "flow", "specificity", "emotional_truth", "faithfulness"];
  const numericScores = {};
  for (const key of requiredScoreKeys) {
    const value = Number(scores[key]);
    if (!Number.isFinite(value)) {
      throw new Error(`Malformed fidelity judge score: ${key}`);
    }
    if (value < 0 || value > 10) {
      throw new Error(`Fidelity judge score out of range for ${key}: ${value}`);
    }
    numericScores[key] = value;
  }
  const computed = requiredScoreKeys.reduce((sum, key) => sum + numericScores[key], 0);
  if (computed < 0 || computed > 50) {
    throw new Error(`Fidelity scores out of range: ${computed}`);
  }
  parsed.scores = { ...scores, ...numericScores };
  parsed.total = computed;

  return parsed;
}

/**
 * Write a song from a confirmed story
 */
async function writeSong(story_id) {
  const storyContext = await getStoryContextV3(story_id);
  const status = storyContext.state || storyContext.status;

  if (status !== "confirmed") {
    throw new Error("Story must be confirmed before generating lyrics");
  }

  const normalized = normalizeContext({
    recipient_name: storyContext.recipientName,
    occasion: storyContext.occasion,
    style: storyContext.style,
    initial_prompt: storyContext.initialPrompt,
    narrative: storyContext.narrative,
    summary: storyContext.summary,
    facts: storyContext.facts,
    elements: storyContext.elements,
    beats: storyContext.beats,
    atoms: storyContext.atoms,
    primitives: storyContext.primitives,
    motifs: storyContext.motifs,
    song_map: storyContext.song_map,
    evaluation: storyContext.evaluation,
    dials: storyContext.dials,
  });

  const result = await generateLyricsFromContext(normalized);
  const arc = normalized.occasion || storyContext.eventType || "unified";

  return {
    ...result,
    quality_score: assessQuality(result.lyrics, normalized),
    arc_used: arc,
    validation_issues: result.validation_issues,
  };
}

/**
 * Generate lyrics directly from story context (without story_id)
 */
async function writeSongFromContext(context) {
  const normalized = normalizeContext(context);
  const result = await generateLyricsFromContext(normalized);
  return {
    ...result,
    quality_score: assessQuality(result.lyrics, normalized),
  };
}

async function generateLyrics(context) {
  return writeSongFromContext(context);
}

function isAIAvailable() {
  return isAvailable();
}

module.exports = {
  writeSong,
  writeSongFromContext,
  generateLyrics,
  isAIAvailable,
  buildSongwriterPrompt,
  buildLyrics,
  sanitizeInput,
  validateStyle,
  countSyllables,
  validateSingability,
  anchorMessage,
  validateRecipientAnchor,
  repairRecipientAnchor,
  validateAndRepairLyrics,
  MUSIC_STYLES,
  RELATIONSHIP_DESCRIPTORS,
  TARGET_DURATION_SECONDS,
  SONGWRITER_PERSONA,
  assessNarrativeFidelity,
  assessQuality,
  FIDELITY_MIN_SCORE,
};
