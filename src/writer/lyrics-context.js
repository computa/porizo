/**
 * Shared helper for building the full lyrics generation context from a track record.
 *
 * Used by:
 *   - src/workflows/runner.js  (lyrics step in preview/full render)
 *   - src/routes/tracks.js     (lyrics generation endpoint)
 *
 * This is the single source of truth for which fields reach `generateLyrics()`.
 * Both creation paths (story-flow and direct POST /tracks) store their context
 * in `track.story_context_json`; this helper reads ALL fields from both schemas
 * so that the songwriter always receives the richest context available.
 */

const { parseJson } = require("../utils/common");

/**
 * Build the full context object that generateLyrics() expects.
 *
 * @param {Object} track - A track row from the database.
 * @param {string}  track.title
 * @param {string}  track.recipient_name
 * @param {string}  track.message
 * @param {string}  track.style
 * @param {string}  track.occasion
 * @param {string} [track.story_context_json] - Serialised story context (may be null).
 * @returns {Object} Flat object suitable for passing directly to generateLyrics().
 */
function buildLyricsContext(track) {
  const storyCtx = parseJson(track.story_context_json, {}, "story_context");

  return {
    // ── Track-level fields (always present) ──────────────────────────
    title: track.title,
    recipient_name: track.recipient_name,
    message: track.message,
    style: track.style,
    occasion: track.occasion,

    // ── Story-flow fields (from story_context_json, may be absent) ───
    narrative: storyCtx.narrative || storyCtx.summary?.text || "",
    facts: storyCtx.facts || [],
    beats: storyCtx.beats || [],
    atoms: storyCtx.atoms || {},
    primitives: storyCtx.primitives || {},
    motifs: storyCtx.motifs || [],
    song_map: storyCtx.song_map || null,
    evaluation: storyCtx.evaluation || null,
    completed_story_package: storyCtx.completed_story_package
      ? {
          ...storyCtx.completed_story_package,
          // Reconstruct detail_coverage_map from decomposed fields stored by to-track.
          // The serializer splits detail_coverage_map into detail_coverage_stats and
          // missing_required; downstream code reads detail_coverage_map, so we reassemble.
          detail_coverage_map: storyCtx.completed_story_package.detail_coverage_map || {
            stats: storyCtx.completed_story_package.detail_coverage_stats || null,
            missingRequired: storyCtx.completed_story_package.missing_required || [],
          },
        }
      : null,
    dials: storyCtx.dials || {},
    summary: storyCtx.summary || null,

    // ── Elements (present in both old and new story_context_json) ────
    elements: storyCtx.elements || {},

    // ── Direct-creation fields (backward compat) ─────────────────────
    relationship_type: storyCtx.relationship_type,
    years_known: storyCtx.years_known,
    specific_memory: storyCtx.specific_memory,
    special_phrases: storyCtx.special_phrases,
    what_makes_them_special: storyCtx.what_makes_them_special,
    memory_answers: storyCtx.memory_answers,
  };
}

function summarizeCoverageForLog(completedStoryPackage) {
  if (!completedStoryPackage || typeof completedStoryPackage !== "object") {
    return null;
  }

  const coverage = completedStoryPackage.detail_coverage_map || {};
  const stats = coverage.stats || completedStoryPackage.detail_coverage_stats || null;
  const missingRequired = coverage.missingRequired || completedStoryPackage.missing_required || [];
  const retainedDetails = Array.isArray(completedStoryPackage.retained_details)
    ? completedStoryPackage.retained_details
    : [];

  return {
    prose_chars: String(completedStoryPackage.prose || "").length,
    retained_details_count: retainedDetails.length,
    coverage_stats: stats,
    missing_required_count: missingRequired.length,
    missing_required_preview: missingRequired.slice(0, 4).map((detail) =>
      typeof detail === "string" ? detail : (detail?.text || detail?.id || String(detail || ""))
    ),
    detail_budget_warning: completedStoryPackage.detail_budget_warning || null,
    llm_rewrite_applied: Boolean(completedStoryPackage.llm_rewrite_applied),
    schema_version: completedStoryPackage.schema_version || null,
  };
}

function summarizeSongMapForLog(songMap) {
  if (!songMap || typeof songMap !== "object") {
    return null;
  }

  const slotLengths = Object.fromEntries(
    ["verse1", "pre", "chorus", "verse2", "bridge", "key_lines"].map((slot) => [
      slot,
      Array.isArray(songMap[slot]) ? songMap[slot].length : 0,
    ])
  );

  return {
    has_hook: Boolean(songMap.hook),
    ...slotLengths,
    motif_count: Array.isArray(songMap.motifs) ? songMap.motifs.length : 0,
  };
}

function summarizeLyricsContextForLog(context = {}) {
  const completedStory = summarizeCoverageForLog(context.completed_story_package);
  const narrative = context.completed_story_package?.prose || context.narrative || context.summary?.text || "";

  return {
    recipient_name: context.recipient_name || null,
    occasion: context.occasion || null,
    style: context.style || null,
    narrative_chars: String(narrative || "").length,
    facts_count: Array.isArray(context.facts) ? context.facts.length : 0,
    beats_count: Array.isArray(context.beats) ? context.beats.length : 0,
    motifs_count: Array.isArray(context.motifs) ? context.motifs.length : 0,
    memory_answer_count: Array.isArray(context.memory_answers) ? context.memory_answers.length : 0,
    elements_count: context.elements && typeof context.elements === "object"
      ? Object.keys(context.elements).filter((key) => Boolean(context.elements[key])).length
      : 0,
    atoms_count: context.atoms && typeof context.atoms === "object"
      ? Object.keys(context.atoms).filter((key) => Boolean(context.atoms[key])).length
      : 0,
    primitives_count: context.primitives && typeof context.primitives === "object"
      ? Object.keys(context.primitives).filter((key) => Boolean(context.primitives[key])).length
      : 0,
    has_completed_story_package: Boolean(completedStory),
    completed_story: completedStory,
    song_map: summarizeSongMapForLog(context.song_map),
    has_specific_memory: Boolean(context.specific_memory),
    has_special_phrases: Boolean(context.special_phrases),
    has_message: Boolean(context.message),
  };
}

module.exports = {
  buildLyricsContext,
  summarizeLyricsContextForLog,
  summarizeCoverageForLog,
  summarizeSongMapForLog,
};
