/**
 * Shared helper for building the full lyrics generation context from a track record.
 *
 * Used by:
 *   - src/workflows/runner.js  (lyrics step in preview/full render)
 *   - src/routes/tracks.js     (lyrics reroll endpoint)
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

module.exports = { buildLyricsContext };
