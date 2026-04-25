const STORY_CONTEXT_NARRATIVE_MAX_LENGTH = 12000;
const STORY_CONTEXT_FACTS_MAX = 40;
const STORY_CONTEXT_BEATS_MAX = 20;
const STORY_CONTEXT_RETAINED_DETAILS_MAX = 80;
const IMPORTANT_FACT_BEATS = new Set([
  "turning_point",
  "impact",
  "stakes",
  "meaning",
  "detail",
  "resolution",
]);
const IMPORTANT_DETAIL_CATEGORIES = new Set([
  "turning_point",
  "sacrifice",
  "gratitude",
  "transformation",
  "meaning",
  "impact",
  "payoff",
  "required",
]);

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function compactStoryTextForTrackContext(value, maxLength = STORY_CONTEXT_NARRATIVE_MAX_LENGTH) {
  const text = normalizeText(value);
  if (!text || text.length <= maxLength) {
    return text;
  }

  const marker = `\n[Story middle compacted for track context; required retained details carry omitted specifics. Original chars: ${text.length}.]\n`;
  const available = maxLength - marker.length;
  if (available <= 1000) {
    return text.slice(0, maxLength);
  }

  const headLength = Math.floor(available * 0.55);
  const tailLength = available - headLength;
  const head = text.slice(0, headLength).trimEnd();
  const tail = text.slice(text.length - tailLength).trimStart();
  return `${head}${marker}${tail}`;
}

function sourceFactIdsFromSongMapEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return [];
  }
  const raw = Array.isArray(entry.source_facts)
    ? entry.source_facts
    : Array.isArray(entry.sourceFacts)
      ? entry.sourceFacts
      : [];
  return raw.map((value) => String(value || "").trim()).filter(Boolean);
}

function collectSongMapSourceFactIds(songMap) {
  if (!songMap || typeof songMap !== "object") {
    return new Set();
  }
  const ids = new Set(sourceFactIdsFromSongMapEntry(songMap.hook));
  for (const key of ["verse1", "pre", "chorus", "verse2", "bridge", "key_lines"]) {
    const entries = Array.isArray(songMap[key]) ? songMap[key] : [];
    for (const entry of entries) {
      for (const id of sourceFactIdsFromSongMapEntry(entry)) {
        ids.add(id);
      }
    }
  }
  return ids;
}

function selectTopStable(items, maxItems, scoreFn) {
  const rows = (Array.isArray(items) ? items : [])
    .map((item, index) => ({ item, index, score: Number(scoreFn(item, index)) || 0 }));
  if (rows.length <= maxItems) {
    return rows.map((row) => row.item);
  }
  return rows
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxItems)
    .sort((a, b) => a.index - b.index)
    .map((row) => row.item);
}

function selectFactsForTrackContext(facts, songMap, maxItems = STORY_CONTEXT_FACTS_MAX) {
  const citedFactIds = collectSongMapSourceFactIds(songMap);
  const allFacts = Array.isArray(facts) ? facts : [];
  return selectTopStable(allFacts, maxItems, (fact, index) => {
    const id = String(fact?.id || "").trim();
    const beat = String(fact?.beat || "").trim().toLowerCase();
    let score = Math.max(0, allFacts.length - index) / Math.max(1, allFacts.length);
    if (id && citedFactIds.has(id)) score += 100;
    if (IMPORTANT_FACT_BEATS.has(beat)) score += 50;
    if (fact?.required === true || fact?.must_keep === true) score += 100;
    return score;
  });
}

function selectRetainedDetailsForTrackContext(details, maxItems = STORY_CONTEXT_RETAINED_DETAILS_MAX) {
  const allDetails = Array.isArray(details) ? details : [];
  return selectTopStable(allDetails, maxItems, (detail, index) => {
    const category = String(detail?.category || detail?.beat || "").trim().toLowerCase();
    let score = Math.max(0, allDetails.length - index) / Math.max(1, allDetails.length);
    if (detail?.required === true || detail?.must_keep === true) score += 100;
    if (IMPORTANT_DETAIL_CATEGORIES.has(category)) score += 50;
    return score;
  });
}

function buildTrackStoryContextPayload(storyContext, { storyId } = {}) {
  const csp = storyContext?.completed_story_package || null;
  const songMap = storyContext?.song_map || null;
  return {
    story_id: storyId || storyContext?.story_id || storyContext?.id || null,
    elements: storyContext?.elements || {},
    narrative: compactStoryTextForTrackContext(storyContext?.narrative || ""),
    facts: selectFactsForTrackContext(storyContext?.facts || [], songMap),
    beats: (storyContext?.beats || []).slice(0, STORY_CONTEXT_BEATS_MAX),
    atoms: storyContext?.atoms || {},
    primitives: storyContext?.primitives || {},
    motifs: storyContext?.motifs || [],
    song_map: songMap,
    evaluation: storyContext?.evaluation || null,
    completed_story_package: csp
      ? {
          prose: compactStoryTextForTrackContext(csp.prose || ""),
          retained_details: selectRetainedDetailsForTrackContext(csp.retained_details || []),
          detail_coverage_stats: csp.detail_coverage_map?.stats || null,
          missing_required: csp.detail_coverage_map?.missingRequired || [],
          semantic_block_profile: csp.semantic_block_profile || null,
          schema_version: csp.schema_version || null,
          detail_budget_warning: csp.detail_budget_warning || null,
          llm_rewrite_applied: csp.llm_rewrite_applied || false,
        }
      : null,
    dials: storyContext?.dials || {},
    summary: storyContext?.summary,
    arc: storyContext?.eventType || "unified",
    narrative_version: typeof storyContext?.narrativeVersion === "number" ? storyContext.narrativeVersion : 0,
    engine_version: storyContext?.engineVersion || null,
  };
}

module.exports = {
  STORY_CONTEXT_NARRATIVE_MAX_LENGTH,
  STORY_CONTEXT_FACTS_MAX,
  STORY_CONTEXT_BEATS_MAX,
  STORY_CONTEXT_RETAINED_DETAILS_MAX,
  compactStoryTextForTrackContext,
  selectFactsForTrackContext,
  selectRetainedDetailsForTrackContext,
  buildTrackStoryContextPayload,
};
