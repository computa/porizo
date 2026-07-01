"use strict";

const {
  deriveStoryBlockProfile,
  getSignificantWords,
  repairSongMapWithProfile,
} = require("./story-semantics");

const SHORT_FIELD_CHAR_LIMIT = 2000;

function sanitizeContractText(text, maxLength = SHORT_FIELD_CHAR_LIMIT) {
  if (!text || typeof text !== "string") return "";

  return text
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u00A0\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, maxLength)
    .trim();
}

function sanitizeStringArray(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => sanitizeContractText(typeof value === "string" ? value : String(value || "")))
    .filter(Boolean);
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
  return sanitizeContractText(typeof value === "string" ? value : String(value || ""));
}

function normalizeSongMapEntry(value, factMap) {
  if (typeof value === "string") {
    const idea = sanitizeContractText(value);
    return idea ? { idea, source_facts: [] } : null;
  }
  if (!value || typeof value !== "object") return null;

  const idea = sanitizeContractText(value.idea || value.text || value.line || "");
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

/**
 * Compute fraction of significant words in `text` that appear in `referenceWordSet`.
 * Returns 0-1. Used to gate contract ideas and facts against completed story prose.
 */
function significantWordOverlap(text, referenceWordSet) {
  if (!text || !referenceWordSet || referenceWordSet.size === 0) return 0;
  const words = getSignificantWords(text);
  if (words.length === 0) return 0;
  const matching = words.filter((w) => referenceWordSet.has(w));
  return matching.length / words.length;
}

function sectionEntriesSupportBeats(entries, factMap, preferredBeats = []) {
  const preferred = new Set(preferredBeats.map((beat) => String(beat || "").toLowerCase()));
  return (Array.isArray(entries) ? entries : []).some((entry) =>
    getSongMapSourceFacts(entry).some((factId) => preferred.has(String(factMap.get(factId)?.beat || "").toLowerCase()))
  );
}

function validateSongContract(context, options = {}) {
  const facts = Array.isArray(context?.facts) ? context.facts : [];
  const factMap = buildFactMap(facts);
  const songMap = context?.song_map;
  const blockProfile = options.blockProfile || deriveStoryBlockProfile(context);
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

  const unsupportedIdeas = [];
  const completedProse = context?.completed_story_package?.prose || "";
  if (completedProse) {
    const proseWordSet = new Set(getSignificantWords(completedProse));
    for (const [sectionName, entries] of Object.entries(requiredSectionEntries)) {
      for (const entry of entries) {
        const idea = getSongMapIdea(entry);
        if (!idea) continue;
        const overlap = significantWordOverlap(idea, proseWordSet);
        if (overlap < 0.3) {
          unsupportedIdeas.push({ section: sectionName, idea, overlap: Number(overlap.toFixed(2)) });
        }
      }
    }
  }

  const payoffPresent = sectionEntriesSupportBeats(
    [...requiredSectionEntries.chorus, ...requiredSectionEntries.bridge],
    factMap,
    ["meaning", "impact", "detail"]
  ) || !!sanitizeContractText(
    context?.primitives?.resolution ||
    context?.primitives?.theme ||
    context?.atoms?.after ||
    ""
  );
  const turnPresent = sectionEntriesSupportBeats(
    [...requiredSectionEntries.verse2, ...requiredSectionEntries.bridge],
    factMap,
    ["turning_point", "impact", "stakes", "moment"]
  ) || !!sanitizeContractText(
    context?.primitives?.turning_point ||
    context?.atoms?.turn ||
    ""
  );
  const valid = missingSections.length === 0
    && uncitedSections.length === 0
    && brokenCitations.length === 0
    && unsupportedIdeas.length === 0
    && payoffPresent
    && turnPresent;
  const semanticReport = options.semanticReport
    || repairSongMapWithProfile(songMap, context, { blockProfile }).report;
  const finalValid = valid
    && semanticReport.valid
    && !semanticReport.duplicatedThesis;

  return {
    valid: finalValid,
    hasCitedContract: hasCitedSongMap(songMap),
    missingSections,
    uncitedSections,
    brokenCitations,
    unsupportedIdeas,
    payoffPresent,
    turnPresent,
    weakSections: semanticReport.weakSections,
    sectionScores: semanticReport.sectionScores,
    duplicatedThesis: semanticReport.duplicatedThesis,
  };
}

module.exports = {
  buildFactMap,
  getSongMapIdea,
  getSongMapSourceFacts,
  hasCitedSongMap,
  hasSongMapContent,
  normalizeSongMapEntry,
  sanitizeFactId,
  sanitizeSongMap,
  significantWordOverlap,
  validateSongContract,
};
