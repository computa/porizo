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
const {
  deriveStoryBlockProfile,
  repairSongMapWithProfile,
  getSignificantWords,
} = require("./story-semantics");
const { summarizeLyricsContextForLog } = require("./lyrics-context");

// Syllable constraints for singability
const MIN_SYLLABLES_PER_LINE = 3;
const MAX_SYLLABLES_PER_LINE = 15;
const TARGET_DURATION_SECONDS = { min: 45, max: 60 };
const QUALITY_MIN_SCORE = 75;
const REPAIR_QUALITY_FIDELITY_OVERRIDE_MARGIN = 5;
const SELF_CORRECTION_MAX = 3;
const FIDELITY_MIN_SCORE = 35; // out of 50 (70%)
const BORDERLINE_FIDELITY_MARGIN = 2;
const LYRICS_LLM_MAX_OUTPUT_TOKENS = 3000;
// Repair patches existing sections rather than regenerating the song, so it
// runs at 60% of the full-generation budget with a 1500 floor.
const LYRICS_LLM_REPAIR_MAX_OUTPUT_TOKENS = Math.max(
  1500,
  Math.ceil(LYRICS_LLM_MAX_OUTPUT_TOKENS * 0.6),
);
const SHORT_FIELD_CHAR_LIMIT = 2000;
const LONG_STORY_CHAR_LIMIT = 12000;
const PROMPT_STORY_EXCERPT_CHAR_LIMIT = 2400;
const PROMPT_LEDGER_MAX_ENTRIES = 40;
const FIDELITY_LEDGER_MAX_ENTRIES = 80;
const SECTION_LEDGER_MAX_ENTRIES = 32;
const LEDGER_PROMPT_TEXT_CHAR_LIMIT = 320;
const CANONICAL_REQUIRED_DETAIL_LIMIT = 8;
const STOP_WORDS_FOR_COVERAGE = new Set([
  "the", "and", "for", "that", "this", "with", "from", "into", "about", "your",
  "their", "they", "them", "you", "our", "her", "his", "she", "him", "was",
  "were", "are", "had", "has", "have", "but", "not", "all", "every", "just",
]);

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
function sanitizeText(text, maxLength = SHORT_FIELD_CHAR_LIMIT) {
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
    // Limit length for the caller's field type.
    .slice(0, maxLength)
    .trim();
}

function sanitizeInput(text) {
  return sanitizeText(text, SHORT_FIELD_CHAR_LIMIT);
}

function sanitizeLongStoryInput(text, maxLength = LONG_STORY_CHAR_LIMIT) {
  return sanitizeText(text, maxLength);
}

function sanitizeLongStoryForPrompt(text) {
  let sanitized = sanitizeLongStoryInput(text);
  sanitized = sanitized.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  sanitized = sanitized.replace(/<[^>]*>/g, "");
  sanitized = sanitized.replace(/```[^`]*```/g, "");
  sanitized = sanitized.replace(/###[^\n]*/g, "");
  sanitized = sanitized.replace(/\[\[[^\]]*\]\]/g, "");
  return sanitized.trim();
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

function summarizePromptCompactionText(text, maxLen = 160) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= maxLen) {
    return value;
  }
  return `${value.slice(0, maxLen - 1)}…`;
}

function summarizeArrayPreview(values, maxItems = 4) {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }
  return values.slice(0, maxItems).map((value) => summarizePromptCompactionText(
    typeof value === "string" ? value : (value?.text || value?.idea || value?.id || String(value || "")),
    120
  ));
}

function summarizePromptInputForLog(baseSummary, details = {}) {
  return {
    ...baseSummary,
    prompt_inputs: {
      has_structured_story: Boolean(details.hasStructuredStory),
      has_completed_story: Boolean(details.hasCompletedStory),
      prose_overlap_gating: Boolean(details.proseIsSubstantial),
      narrative_source: details.hasCompletedStory ? "completed_story_package.prose" : "narrative_or_summary",
      key_details_count: details.detailLinesCount || 0,
      supporting_context_count: details.supportingStoryLinesCount || 0,
      memory_answers_included_count: details.memoryAnswersIncludedCount || 0,
      motifs_included_count: details.motifsIncludedCount || 0,
      story_detail_ledger: details.storyDetailLedger || null,
      story_prose_excerpt: details.storyProseExcerpt || null,
      story_arc_present: Boolean(details.storyArcPresent),
      revision_note_present: Boolean(details.revisionNote),
      previous_draft_present: Boolean(details.previousDraft),
      previous_draft_section_count: details.previousDraftSectionCount || 0,
      contract_valid: details.contractValid ?? null,
      contract_repaired: details.contractRepaired ?? null,
      missing_sections: details.missingSections || [],
      uncited_sections: details.uncitedSections || [],
    },
  };
}

function summarizeLyricsOutputForLog(lyrics) {
  const sections = Array.isArray(lyrics?.sections) ? lyrics.sections : [];
  const lines = sections.flatMap((section) => Array.isArray(section.lines) ? section.lines : []);
  const sectionNames = sections.map((section) => section?.name).filter(Boolean);
  const storyElementsUsed = Array.isArray(lyrics?.story_elements_used) ? lyrics.story_elements_used : [];

  return {
    title: lyrics?.title || null,
    style: lyrics?.style || null,
    section_count: sections.length,
    section_names: sectionNames,
    line_count: lines.length,
    word_count: lines.join(" ").split(/\s+/).filter(Boolean).length,
    anchor_line: summarizePromptCompactionText(lyrics?.anchor_line || "", 120),
    story_elements_used_count: storyElementsUsed.length,
    story_elements_used_preview: summarizeArrayPreview(storyElementsUsed, 5),
  };
}

function summarizeFidelityForLog(fidelity) {
  if (!fidelity || typeof fidelity !== "object") {
    return null;
  }

  return {
    total: Number.isFinite(fidelity.total) ? fidelity.total : null,
    coverage: Number.isFinite(fidelity.coverage) ? fidelity.coverage : null,
    flow: Number.isFinite(fidelity.flow) ? fidelity.flow : null,
    specificity: Number.isFinite(fidelity.specificity) ? fidelity.specificity : null,
    emotional_truth: Number.isFinite(fidelity.emotional_truth) ? fidelity.emotional_truth : null,
    faithfulness: Number.isFinite(fidelity.faithfulness) ? fidelity.faithfulness : null,
    missing_story_beats_count: Array.isArray(fidelity.missing_story_beats) ? fidelity.missing_story_beats.length : 0,
    missing_story_beats_preview: summarizeArrayPreview(fidelity.missing_story_beats),
    invented_details_count: Array.isArray(fidelity.invented_details) ? fidelity.invented_details.length : 0,
    invented_details_preview: summarizeArrayPreview(fidelity.invented_details),
    uncovered_song_map_slots: summarizeArrayPreview(fidelity.uncovered_song_map_slots),
    broken_citations: summarizeArrayPreview(fidelity.broken_citations),
    rewrite_targets: summarizeArrayPreview(fidelity.rewrite_targets),
    required_detail_coverage: fidelity.required_detail_coverage
      ? {
        required_count: fidelity.required_detail_coverage.required_count || 0,
        covered_count: fidelity.required_detail_coverage.covered_count || 0,
        missing_required_preview: summarizeArrayPreview(fidelity.required_detail_coverage.missing_required, 6),
      }
      : null,
    judge_compact_evidence: Boolean(fidelity.judge_compact_evidence),
    flattened_emotional_arc: summarizePromptCompactionText(fidelity.flattened_emotional_arc || "", 120),
    feedback: summarizePromptCompactionText(fidelity.feedback || "", 160),
  };
}

function roughTokenEstimate(text) {
  return Math.ceil((text || "").length / 4);
}

function normalizeLedgerText(text) {
  return sanitizeInput(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function inferSectionForBeat(beat) {
  const normalized = String(beat || "").toLowerCase();
  if (["context", "scene", "meeting", "relationship", "who"].includes(normalized)) return "verse1";
  if (["moment", "struggle", "stakes", "discovery", "turning_point"].includes(normalized)) return "verse2";
  if (["meaning", "impact", "detail", "resolution"].includes(normalized)) return "chorus";
  return null;
}

function inferSectionForCategory(category) {
  const normalized = String(category || "").toLowerCase();
  if (["setup", "context", "background", "relationship"].includes(normalized)) return "verse1";
  if (["sacrifice", "turning_point", "conflict", "stakes", "challenge"].includes(normalized)) return "verse2";
  if (["transformation", "growth", "payoff"].includes(normalized)) return "bridge";
  if (["gratitude", "meaning", "resolution", "impact", "theme", "hook"].includes(normalized)) return "chorus";
  return null;
}

function inferSectionForDetailText(text) {
  const normalized = String(text || "").toLowerCase();
  if (/\b(first met|started|beginning|grew up|young girl|young boy|from the start)\b/.test(normalized)) {
    return "verse1";
  }
  if (/\b(pregnancy|bleeding|fear|pain|uncertainty|appointment|instruction|sacrifice|hardest|challenge|struggle)\b/.test(normalized)) {
    return "verse2";
  }
  if (/\b(grow into|strong woman|strong man|became|changed|respect|love.*more|deepened)\b/.test(normalized)) {
    return "bridge";
  }
  if (/\b(grateful|appreciate|see you|thank|meaning|birthday gratitude|love in action|home)\b/.test(normalized)) {
    return "chorus";
  }
  return null;
}

function buildFactSectionMap(songMap) {
  const map = new Map();
  if (!songMap || typeof songMap !== "object") return map;
  for (const sectionName of ["verse1", "pre", "chorus", "verse2", "bridge", "key_lines"]) {
    const entries = Array.isArray(songMap[sectionName]) ? songMap[sectionName] : [];
    for (const entry of entries) {
      for (const factId of getSongMapSourceFacts(entry)) {
        if (!map.has(factId)) {
          map.set(factId, sectionName === "key_lines" ? "chorus" : sectionName);
        }
      }
    }
  }
  for (const factId of getSongMapSourceFacts(songMap.hook)) {
    if (!map.has(factId)) map.set(factId, "chorus");
  }
  return map;
}

function priorityForLedgerDetail(detail = {}) {
  if (detail.required === true) return 100;
  const beat = String(detail.beat || "").toLowerCase();
  const category = String(detail.category || "").toLowerCase();
  if (["turning_point", "meaning", "impact", "stakes"].includes(beat)) return 90;
  if (["sacrifice", "turning_point", "gratitude", "transformation", "required"].includes(category)) return 90;
  if (detail.section === "chorus" || detail.section === "bridge") return 80;
  return 60;
}

function requiredDetailSemanticScore(entry = {}) {
  const text = `${entry.text || ""} ${entry.category || ""} ${entry.section || ""}`.toLowerCase();
  let score = Number(entry.priority) || 0;

  const signals = [
    { pattern: /\b(twin|pregnan|bleed|risk|fear|pain|uncertaint|sacrifice|endured?)\b/i, weight: 45 },
    { pattern: /\b(grateful|gratitude|appreciate|i see you|celebrate|birthday)\b/i, weight: 40 },
    { pattern: /\b(grow|grew|young girl|strong woman|motherhood|became|watched you)\b/i, weight: 36 },
    { pattern: /\b(work|home|house|appointments?|grocery|children|four|responsibilit|structure|stability)\b/i, weight: 34 },
    { pattern: /\b(love|support|kindness|care|dependable|steady|strength)\b/i, weight: 24 },
  ];

  for (const signal of signals) {
    if (signal.pattern.test(text)) score += signal.weight;
  }

  if (entry.source === "song_map") score += 16;
  if (entry.source === "primitive") score += 12;
  if (entry.section === "chorus") score += 8;
  if (entry.section === "verse2" || entry.section === "bridge") score += 5;

  return score;
}

function resolveCanonicalRequiredDetailLimit(options = {}) {
  if (Number.isFinite(options.requiredLimit)) {
    return Math.max(1, Math.floor(options.requiredLimit));
  }

  const envLimit = Number.parseInt(process.env.LYRIC_REQUIRED_DETAIL_LIMIT || "", 10);
  if (Number.isFinite(envLimit) && envLimit > 0) {
    return Math.max(1, Math.min(20, envLimit));
  }

  return CANONICAL_REQUIRED_DETAIL_LIMIT;
}

function capCanonicalRequiredDetails(entries = [], options = {}) {
  const requiredLimit = resolveCanonicalRequiredDetailLimit(options);
  const required = entries.filter((entry) => entry.required);
  if (required.length <= requiredLimit) {
    return entries.map((entry) => ({
      ...entry,
      required_limit: requiredLimit,
      raw_required: entry.required === true,
    }));
  }

  const keep = new Set(
    required
      .map((entry, index) => ({
        key: `${entry.id || ""}\u0000${entry.text || ""}`,
        score: requiredDetailSemanticScore(entry),
        index,
      }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, requiredLimit)
      .map((entry) => entry.key)
  );

  return entries.map((entry) => {
    const key = `${entry.id || ""}\u0000${entry.text || ""}`;
    const rawRequired = entry.required === true;
    if (!rawRequired || keep.has(key)) {
      return {
        ...entry,
        required_limit: requiredLimit,
        raw_required: rawRequired,
      };
    }

    return {
      ...entry,
      required: false,
      raw_required: true,
      required_downgraded: true,
      required_limit: requiredLimit,
    };
  });
}

function buildStoryDetailLedger(context, options = {}) {
  const normalized = normalizeContext(context);
  const factSectionMap = buildFactSectionMap(normalized.song_map);
  const seen = new Set();
  const entries = [];
  const maxEntries = options.maxEntries === "all"
    ? Number.POSITIVE_INFINITY
    : (Number.isFinite(options.maxEntries) ? options.maxEntries : PROMPT_LEDGER_MAX_ENTRIES);

  const add = (input = {}) => {
    const text = sanitizeInput(input.text || input.idea || "");
    if (!text || text.length < 8) return;
    const key = normalizeLedgerText(text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const id = sanitizeInput(input.id || `detail_${entries.length + 1}`);
    const section = sanitizeInput(
      input.section ||
      inferSectionForBeat(input.beat) ||
      inferSectionForCategory(input.category) ||
      inferSectionForDetailText(text) ||
      ""
    );
    const required = input.required === true || input.must_keep === true || priorityForLedgerDetail({ ...input, section }) >= 90;
    const priority = priorityForLedgerDetail({ ...input, section, required });
    entries.push({
      id,
      text,
      section: section || "song",
      required,
      priority,
      source: sanitizeInput(input.source || "story"),
      category: sanitizeInput(input.category || input.beat || ""),
    });
  };

  const retained = normalized.completed_story_package?.retained_details || [];
  for (const detail of retained) {
    add({
      id: detail.id,
      text: detail.text,
      required: detail.required,
      category: detail.category,
      source: "completed_story",
    });
  }

  for (const fact of normalized.facts || []) {
    add({
      id: fact.id,
      text: fact.text,
      beat: fact.beat,
      section: factSectionMap.get(fact.id),
      source: "fact",
    });
  }

  if (normalized.primitives?.turning_point) {
    add({ text: normalized.primitives.turning_point, section: "verse2", required: true, source: "primitive", category: "turning_point" });
  }
  if (normalized.primitives?.resolution) {
    add({ text: normalized.primitives.resolution, section: "chorus", required: true, source: "primitive", category: "resolution" });
  }
  if (normalized.primitives?.theme) {
    add({ text: normalized.primitives.theme, section: "chorus", source: "primitive", category: "theme" });
  }
  if (normalized.atoms?.after) {
    add({ text: normalized.atoms.after, section: "bridge", source: "atom", category: "payoff" });
  }

  for (const answer of normalized.memory_answers || []) {
    add({
      id: answer.question_id,
      text: answer.answer,
      source: "memory_answer",
      category: "memory",
    });
  }

  if (hasSongMapContent(normalized.song_map)) {
    for (const sectionName of ["verse1", "pre", "chorus", "verse2", "bridge", "key_lines"]) {
      const entriesForSection = Array.isArray(normalized.song_map[sectionName]) ? normalized.song_map[sectionName] : [];
      for (const entry of entriesForSection) {
        add({
          text: getSongMapIdea(entry),
          section: sectionName === "key_lines" ? "chorus" : sectionName,
          required: false,
          source: "song_map",
        });
      }
    }
    if (normalized.song_map.hook) {
      add({
        text: getSongMapIdea(normalized.song_map.hook),
        section: "chorus",
        required: true,
        source: "song_map",
        category: "hook",
      });
    }
  }

  const proseForCheckpoints = normalized.completed_story_package?.prose || normalized.narrative || normalized.summary_text || "";
  const checkpointFloor = Number.isFinite(maxEntries) ? Math.min(maxEntries, 10) : 10;
  if (proseForCheckpoints && entries.length < checkpointFloor) {
    const checkpointCount = Number.isFinite(maxEntries)
      ? Math.min(8, maxEntries - entries.length)
      : 8;
    const checkpoints = extractStoryCheckpointSentences(proseForCheckpoints, checkpointCount);
    for (const checkpoint of checkpoints) {
      add({
        id: `story_checkpoint_${checkpoint.index + 1}`,
        text: checkpoint.text,
        section: inferSectionFromSentencePosition(checkpoint.index, checkpoint.total),
        required: false,
        source: "story_checkpoint",
        category: "story_checkpoint",
      });
    }
  }

  const sorted = entries
    .sort((a, b) => b.priority - a.priority)
    .slice(0, maxEntries)
    .map((entry, index) => ({
      ...entry,
      id: entry.id || `detail_${index + 1}`,
    }));

  return capCanonicalRequiredDetails(sorted, options);
}

function formatStoryDetailLedgerForPrompt(ledger = [], options = {}) {
  const details = Array.isArray(ledger) ? ledger : [];
  if (details.length === 0) return "";
  const maxTextChars = Number.isFinite(options.maxTextChars)
    ? options.maxTextChars
    : LEDGER_PROMPT_TEXT_CHAR_LIMIT;
  const lines = details.map((entry) => {
    const marker = entry.required ? "MUST KEEP" : "use if natural";
    return `- [${entry.id}] [${entry.section}] [${marker}] ${sanitizeForPrompt(summarizePromptCompactionText(entry.text, maxTextChars))}`;
  });
  return [
    "STORY DETAIL LEDGER (BINDING):",
    "These are the product-critical story details. Required details must survive in the lyrics through literal wording or clear paraphrase. Do not drop them just because the prose is long.",
    ...lines,
  ].join("\n");
}

function summarizeStoryDetailLedgerForLog(ledger = []) {
  const details = Array.isArray(ledger) ? ledger : [];
  const required = details.filter((entry) => entry.required);
  const rawRequired = details.filter((entry) => entry.raw_required === true || entry.required === true);
  const downgraded = details.filter((entry) => entry.required_downgraded === true);
  const bySection = {};
  for (const entry of details) {
    bySection[entry.section || "song"] = (bySection[entry.section || "song"] || 0) + 1;
  }
  return {
    count: details.length,
    required_limit: details[0]?.required_limit || CANONICAL_REQUIRED_DETAIL_LIMIT,
    raw_required_count: rawRequired.length,
    required_count: required.length,
    downgraded_required_count: downgraded.length,
    by_section: bySection,
    required_preview: summarizeArrayPreview(required.map((entry) => `${entry.id}: ${entry.text}`), 8),
  };
}

function splitStorySentences(text) {
  return sanitizeLongStoryInput(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 24 && sentence.length <= 280);
}

function scoreStoryCheckpointSentence(sentence, index, total) {
  const lower = sentence.toLowerCase();
  let score = 0;
  const signalWords = [
    "birth", "birthday", "pregnancy", "bleeding", "fear", "pain", "uncertainty",
    "appointment", "instruction", "sacrifice", "mother", "children", "family",
    "home", "work", "grateful", "appreciate", "respect", "strong", "strength",
    "changed", "never forget", "remember", "love", "care", "steady",
  ];
  for (const word of signalWords) {
    if (lower.includes(word)) score += 2;
  }
  if (index <= 1) score += 2;
  if (index >= total - 2) score += 2;
  if (/\b(i see you|thank you|never forget|because of you)\b/i.test(sentence)) score += 4;
  return score;
}

function extractStoryCheckpointSentences(text, maxEntries = 8) {
  const sentences = splitStorySentences(text);
  if (sentences.length === 0) return [];
  const scored = sentences.map((sentence, index) => ({
    sentence,
    index,
    score: scoreStoryCheckpointSentence(sentence, index, sentences.length),
  }));
  const selected = scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxEntries)
    .sort((a, b) => a.index - b.index);
  return selected.map((entry) => ({
    text: entry.sentence,
    index: entry.index,
    total: sentences.length,
  }));
}

function inferSectionFromSentencePosition(index, total) {
  if (!Number.isFinite(index) || !Number.isFinite(total) || total <= 1) return "song";
  const ratio = index / Math.max(1, total - 1);
  if (ratio < 0.35) return "verse1";
  if (ratio < 0.7) return "verse2";
  return "chorus";
}

function buildPromptStoryExcerpt(text, maxChars = PROMPT_STORY_EXCERPT_CHAR_LIMIT) {
  const prose = sanitizeLongStoryForPrompt(text);
  if (!prose || prose.length <= maxChars) {
    return {
      text: prose,
      compacted: false,
      originalChars: prose.length,
      excerptChars: prose.length,
    };
  }

  const headLength = Math.floor(maxChars * 0.55);
  const tailLength = Math.floor(maxChars * 0.35);
  const head = prose.slice(0, headLength).trim();
  const tail = prose.slice(Math.max(headLength, prose.length - tailLength)).trim();
  const excerpt = [
    head,
    `[Middle story prose compacted from ${prose.length} chars. Use the binding detail ledger and song map for omitted specifics.]`,
    tail,
  ].join("\n");

  return {
    text: excerpt,
    compacted: true,
    originalChars: prose.length,
    excerptChars: excerpt.length,
  };
}

function filterLedgerForSection(ledger, sectionName, maxEntries = SECTION_LEDGER_MAX_ENTRIES) {
  const normalizedSection = String(sectionName || "").toLowerCase();
  const entries = Array.isArray(ledger) ? ledger : [];
  return entries
    .filter((entry) =>
      entry.section === normalizedSection ||
      entry.section === "song" ||
      (normalizedSection === "chorus" && entry.section === "key_lines")
    )
    .sort((a, b) => Number(b.required) - Number(a.required) || b.priority - a.priority)
    .slice(0, maxEntries);
}

function filterLedgerAgainstCompletedStory(ledger, completedProse) {
  const details = Array.isArray(ledger) ? ledger : [];
  const proseWordSet = completedProse && completedProse.length >= 100
    ? new Set(getSignificantWords(completedProse))
    : null;
  if (!proseWordSet) return details;
  return details.filter((entry) => {
    if (entry.source === "story_checkpoint") return true;
    const words = getSignificantWords(entry.text);
    if (words.length === 0) return true;
    const overlap = significantWordOverlap(entry.text, proseWordSet);
    if (words.length < 3) return overlap > 0;
    return overlap > 0.3;
  });
}

function buildCompactStoryEvidenceBlock(storyContext) {
  const normalized = normalizeContext(storyContext);
  const completedProse = normalized.completed_story_package?.prose || "";
  const ledger = filterLedgerAgainstCompletedStory(
    buildStoryDetailLedger(normalized, { maxEntries: FIDELITY_LEDGER_MAX_ENTRIES }),
    completedProse
  );
  const parts = [];
  if (ledger.length > 0) {
    parts.push(formatStoryDetailLedgerForPrompt(ledger));
  }
  if (hasSongMapContent(normalized.song_map)) {
    const factMap = buildFactMap(normalized.facts || []);
    const lines = [];
    if (normalized.song_map.hook) {
      lines.push(`- hook: ${formatSongMapTextForPrompt(getSongMapIdea(normalized.song_map.hook))}`);
    }
    for (const sectionName of ["verse1", "pre", "chorus", "verse2", "bridge", "key_lines"]) {
      const entries = Array.isArray(normalized.song_map[sectionName]) ? normalized.song_map[sectionName] : [];
      if (entries.length === 0) continue;
      lines.push(`- ${sectionName}: ${entries.map((entry) => {
        const idea = formatSongMapTextForPrompt(getSongMapIdea(entry));
        const support = getSongMapSourceFacts(entry)
          .map((factId) => factMap.get(factId)?.text)
          .filter(Boolean)
          .map((text) => formatSongMapTextForPrompt(text, 180))
          .join("; ");
        return support ? `${idea} (${support})` : idea;
      }).join(" | ")}`);
    }
    if (lines.length > 0) {
      parts.push(`PRIMARY SONG MAP:\n${lines.join("\n")}`);
    }
  }
  const prose = completedProse || normalized.narrative || "";
  if (prose) {
    const excerpt = buildPromptStoryExcerpt(prose, 2200);
    parts.push(`STORY PROSE EXCERPT${excerpt.compacted ? " (HEAD/TAIL)" : ""}:\n${excerpt.text}`);
  }
  return parts.join("\n\n");
}

function assessRequiredDetailCoverage(lyrics, storyContext) {
  const lyricWordSet = new Set(getSignificantWords(flattenLyricsText(lyrics)));
  const required = buildStoryDetailLedger(storyContext, { maxEntries: "all" })
    .filter((entry) => entry.required);
  const requiredTokenFrequency = buildRequiredDetailTokenFrequency(required);
  const lyricCoverageTokenSet = new Set(getCoverageTokens(flattenLyricsText(lyrics)));
  const details = required.map((entry) => {
    const overlap = significantWordOverlap(entry.text, lyricWordSet);
    const distinctiveTokens = getCoverageTokens(entry.text)
      .filter((token) => (requiredTokenFrequency.get(token) || 0) <= 2);
    const distinctiveOverlap = distinctiveTokens.length > 0
      ? distinctiveTokens.filter((token) => lyricCoverageTokenSet.has(token)).length / distinctiveTokens.length
      : 1;
    return {
      id: entry.id,
      section: entry.section,
      text: entry.text,
      overlap,
      distinctive_tokens: distinctiveTokens,
      distinctive_overlap: distinctiveOverlap,
      covered: overlap >= 0.3 && distinctiveOverlap >= 0.5,
    };
  });
  const missing = details.filter((entry) => !entry.covered);
  return {
    required_count: required.length,
    covered_count: details.length - missing.length,
    missing_required: missing.map((entry) => `[${entry.id}] ${entry.text}`),
    detail_scores: details.map((entry) => ({
      id: entry.id,
      section: entry.section,
      overlap: Number(entry.overlap.toFixed(2)),
      distinctive_overlap: Number(entry.distinctive_overlap.toFixed(2)),
      covered: entry.covered,
    })),
  };
}

function buildSongReadinessFollowUp(blocker) {
  const detail = blocker?.detail || blocker?.message || "";
  if (blocker?.code === "missing_required_story_detail" && detail) {
    const cleanDetail = detail.replace(/^\[[^\]]+\]\s*/, "");
    return `Before I make this a song, give me one clear sentence about this part: ${cleanDetail}`;
  }
  if (blocker?.code === "too_many_required_details") {
    return "Before I make this a song, choose the few details that absolutely must be heard in the lyrics.";
  }
  if (blocker?.code === "missing_story") {
    return "Before I make this a song, give me one specific memory or moment you want the lyrics to carry.";
  }
  return "Before I make this a song, give me one more concrete detail that must not be lost.";
}

function assessSongReadiness(rawContext = {}) {
  const normalized = normalizeContext(rawContext);
  const blockers = [];
  const warnings = [];
  const checkedAt = new Date().toISOString();
  const hasStoryText = Boolean(
    normalized.completed_story_package?.prose ||
    normalized.narrative ||
    normalized.message ||
    normalized.specific_memory
  );

  if (!hasStoryText) {
    blockers.push({
      code: "missing_story",
      message: "No usable story text is available for lyric generation.",
    });
  }

  const requiredLedger = buildStoryDetailLedger(normalized, { maxEntries: "all" })
    .filter((entry) => entry.required);
  const totalRequired = requiredLedger.length;
  const canonicalRequired = buildStoryDetailLedger(normalized, { maxEntries: CANONICAL_REQUIRED_DETAIL_LIMIT })
    .filter((entry) => entry.required);

  if (totalRequired > CANONICAL_REQUIRED_DETAIL_LIMIT * 2) {
    warnings.push({
      code: "high_required_detail_pressure",
      message: `The story has ${totalRequired} required details; only the strongest details can fit cleanly in a short song.`,
      required_detail_count: totalRequired,
    });
  }

  if (canonicalRequired.length === 0 && hasStoryText) {
    warnings.push({
      code: "no_required_detail_ledger",
      message: "No required story-detail ledger entries were identified; final lyrics will rely on the narrative and song map.",
    });
  }

  const packageCoverage = normalized.completed_story_package?.detail_coverage_map ||
    normalized.completed_story_package?.coverage ||
    null;
  const missingRequiredFromPackage = Array.isArray(packageCoverage?.missingRequired)
    ? packageCoverage.missingRequired
    : [];
  const requiredMissingCount = Number(packageCoverage?.stats?.requiredMissing || 0);
  // Stats and the array can drift; trust whichever signal sees more missing.
  const effectiveMissingCount = Math.max(requiredMissingCount, missingRequiredFromPackage.length);
  if (effectiveMissingCount > 0) {
    for (const missing of missingRequiredFromPackage.slice(0, 3)) {
      blockers.push({
        code: "missing_required_story_detail",
        id: missing?.id || null,
        detail: missing?.text || String(missing || ""),
        message: "A required story detail is not present in the canonical story package.",
      });
    }
    if (missingRequiredFromPackage.length === 0) {
      blockers.push({
        code: "missing_required_story_detail",
        message: `${effectiveMissingCount} required story detail(s) are missing from the canonical story package.`,
      });
    }
  }

  const promptBuild = buildSongwriterPrompt(normalized, {
    returnMetadata: true,
    suppressLogs: true,
  });
  const promptBudget = {
    initialTokens: promptBuild.metadata.prompt_budget.initial_tokens,
    tokens: promptBuild.metadata.prompt_budget.final_tokens,
    tokenBudget: promptBuild.metadata.prompt_budget.token_budget,
    removedCharsTotal: promptBuild.metadata.prompt_budget.removed_chars_total,
    compactions: promptBuild.metadata.prompt_budget.compactions || [],
  };
  const hardCapCompaction = (promptBudget.compactions || [])
    .some((entry) => entry.stage === "song_brief_hard_cap");
  if (hardCapCompaction) {
    blockers.push({
      code: "prompt_budget_hard_cap",
      message: "The story contract is too large and would require hard prompt truncation before lyric generation.",
    });
  } else if ((promptBudget.compactions || []).length > 0) {
    warnings.push({
      code: "prompt_budget_compacted",
      message: "The story is large enough to require compact prompt evidence, but the required-detail ledger remains available.",
      compactions: promptBudget.compactions.map((entry) => entry.stage),
    });
  }

  const contract = validateSongContract(normalized);
  if (!contract.valid && (contract.missingSections || []).length > 0) {
    warnings.push({
      code: "song_contract_repair_needed",
      message: "The song map needs deterministic repair before lyric generation.",
      missing_sections: contract.missingSections,
    });
  }

  const ready = blockers.length === 0;
  const followUpQuestion = ready ? null : buildSongReadinessFollowUp(blockers[0]);
  return {
    ready,
    status: ready ? "ready" : "needs_input",
    checked_at: checkedAt,
    blockers,
    warnings,
    follow_up_question: followUpQuestion,
    suggestions: ready ? [] : [
      "Add the concrete moment in one sentence.",
      "Name what changed because of it.",
      "Say why this detail matters now.",
    ],
    required_detail_count: totalRequired,
    canonical_required_detail_count: canonicalRequired.length,
    prompt_budget: {
      initial_tokens: promptBudget.initialTokens,
      final_tokens: promptBudget.tokens,
      token_budget: promptBudget.tokenBudget,
      removed_chars_total: promptBudget.removedCharsTotal,
      compactions: (promptBudget.compactions || []).map((entry) => entry.stage),
    },
    contract: {
      valid: contract.valid,
      missing_sections: contract.missingSections || [],
      uncited_sections: contract.uncitedSections || [],
      broken_citations: contract.brokenCitations || [],
    },
  };
}

function getCoverageTokens(text) {
  return normalizeCoverageKey(text)
    .split(/\W+/)
    .filter(Boolean)
    .map((token) => token.replace(/s$/, ""))
    .filter((token) => (/^\d+$/.test(token) || (token.length > 2 && !STOP_WORDS_FOR_COVERAGE.has(token))));
}

function normalizeCoverageKey(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function buildRequiredDetailTokenFrequency(requiredDetails) {
  const frequency = new Map();
  for (const detail of requiredDetails || []) {
    const tokens = new Set(getCoverageTokens(detail?.text || ""));
    for (const token of tokens) {
      frequency.set(token, (frequency.get(token) || 0) + 1);
    }
  }
  return frequency;
}

function applySongwriterPromptBudget(prompt, {
  narrativeText = "",
  tokenBudget = 5500,
} = {}) {
  const compactions = [];
  let finalPrompt = String(prompt || "").trim();
  const initialChars = finalPrompt.length;
  const initialTokens = roughTokenEstimate(finalPrompt);
  let tokens = initialTokens;

  if (tokens > tokenBudget) {
    const overBy = tokens - tokenBudget;
    const charsToRemove = overBy * 4;
    if (narrativeText && narrativeText.length > charsToRemove + 100) {
      const targetLength = Math.max(900, narrativeText.length - charsToRemove - 50);
      const headLength = Math.ceil(targetLength * 0.55);
      const tailLength = Math.max(250, Math.floor(targetLength * 0.35));
      const head = narrativeText.slice(0, headLength);
      const tail = narrativeText.slice(Math.max(headLength, narrativeText.length - tailLength));
      const cleanNarrative = `${head.trim()}\n[Story prose compacted. Required details are preserved in the binding detail ledger.]\n${tail.trim()}`;
      finalPrompt = finalPrompt.replace(narrativeText, cleanNarrative);
      const nextTokens = roughTokenEstimate(finalPrompt);
      compactions.push({
        stage: "narrative_trim",
        removedChars: Math.max(0, narrativeText.length - cleanNarrative.length),
        removedPreview: summarizePromptCompactionText(narrativeText.slice(head.length, Math.max(head.length, narrativeText.length - tail.length))),
        beforeTokens: tokens,
        afterTokens: nextTokens,
      });
      tokens = nextTokens;
    }
  }

  if (tokens > tokenBudget) {
    const supportIdx = finalPrompt.indexOf("SUPPORTING STORY CONTEXT:");
    const altIdx = finalPrompt.indexOf("STORY-GROUNDED DETAILS:");
    const removeIdx = supportIdx !== -1 ? supportIdx : altIdx;
    if (removeIdx !== -1) {
      const nextSection = finalPrompt.indexOf("\n## ", removeIdx + 1);
      if (nextSection !== -1) {
        const removedSection = finalPrompt.slice(removeIdx, nextSection);
        finalPrompt = finalPrompt.slice(0, removeIdx) + finalPrompt.slice(nextSection);
        const nextTokens = roughTokenEstimate(finalPrompt);
        compactions.push({
          stage: "supporting_context_removed",
          removedSection: removedSection.split("\n")[0].replace(/:$/, ""),
          removedPreview: summarizePromptCompactionText(removedSection),
          beforeTokens: tokens,
          afterTokens: nextTokens,
        });
        tokens = nextTokens;
      }
    }
  }

  if (tokens > tokenBudget) {
    const detailsIdx = finalPrompt.indexOf("KEY DETAILS:");
    if (detailsIdx !== -1) {
      const detailsEnd = finalPrompt.indexOf("\n", detailsIdx + 200);
      const detailsSection = finalPrompt.slice(detailsIdx, detailsEnd !== -1 ? detailsEnd : undefined);
      const lines = detailsSection.split("\n").filter(l => l.startsWith("- "));
      if (lines.length > 5) {
        const droppedLines = lines.slice(5);
        const truncated = `KEY DETAILS:\n${lines.slice(0, 5).join("\n")}`;
        finalPrompt = finalPrompt.replace(detailsSection, truncated);
        const nextTokens = roughTokenEstimate(finalPrompt);
        compactions.push({
          stage: "key_details_trimmed",
          keptCount: 5,
          droppedCount: droppedLines.length,
          droppedPreview: summarizePromptCompactionText(droppedLines.join(" | ")),
          beforeTokens: tokens,
          afterTokens: nextTokens,
        });
        tokens = nextTokens;
      }
    }
  }

  if (tokens > tokenBudget && narrativeText) {
    const proseOmission = "[Full story prose omitted after extracting the binding detail ledger and song map. Use the ledger as the source of truth.]";
    const beforeChars = finalPrompt.length;
    if (finalPrompt.includes(narrativeText)) {
      finalPrompt = finalPrompt.replace(narrativeText, proseOmission);
    } else {
      finalPrompt = finalPrompt.replace(/\[Story prose compacted\. Required details are preserved in the binding detail ledger\.\][\s\S]*?(?=\n[A-Z][A-Z\s()/-]+:|\n## |\n$)/, proseOmission);
    }
    const nextTokens = roughTokenEstimate(finalPrompt);
    if (nextTokens < tokens) {
      compactions.push({
        stage: "story_prose_replaced_by_ledger",
        removedChars: Math.max(0, beforeChars - finalPrompt.length),
        removedPreview: "Full prose removed after ledger extraction",
        beforeTokens: tokens,
        afterTokens: nextTokens,
      });
      tokens = nextTokens;
    }
  }

  if (tokens > tokenBudget) {
    const briefIdx = finalPrompt.indexOf("## SONG BRIEF");
    const taskIdx = finalPrompt.indexOf("## YOUR TASK");
    if (briefIdx !== -1 && taskIdx !== -1 && taskIdx > briefIdx) {
      const header = finalPrompt.slice(0, briefIdx);
      const brief = finalPrompt.slice(briefIdx, taskIdx);
      const tail = finalPrompt.slice(taskIdx);
      const headerTokens = roughTokenEstimate(header);
      const tailTokens = roughTokenEstimate(tail);
      const briefBudget = (tokenBudget - headerTokens - tailTokens) * 4;
      if (briefBudget > 200) {
        const truncatedBrief = brief.slice(0, briefBudget);
        const lastNewline = truncatedBrief.lastIndexOf("\n");
        const cleanBrief = lastNewline > 100 ? truncatedBrief.slice(0, lastNewline + 1) : truncatedBrief;
        const removedBriefTail = brief.slice(cleanBrief.length);
        finalPrompt = `${header}${cleanBrief}\n\n${tail}`;
        const nextTokens = roughTokenEstimate(finalPrompt);
        compactions.push({
          stage: "song_brief_hard_cap",
          removedChars: Math.max(0, removedBriefTail.length),
          removedPreview: summarizePromptCompactionText(removedBriefTail),
          beforeTokens: tokens,
          afterTokens: nextTokens,
        });
        tokens = nextTokens;
      }
    }
  }

  return {
    prompt: finalPrompt,
    tokens,
    tokenBudget,
    initialTokens,
    initialChars,
    finalChars: finalPrompt.length,
    removedCharsTotal: Math.max(0, initialChars - finalPrompt.length),
    compactions,
  };
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

function formatSongMapTextForPrompt(text, maxChars = 220) {
  return sanitizeForPrompt(summarizePromptCompactionText(text || "", maxChars));
}

function formatSongMapEntry(entry, factMap) {
  const idea = formatSongMapTextForPrompt(getSongMapIdea(entry));
  if (!idea) return "";
  const support = getSongMapSourceFacts(entry)
    .map((factId) => factMap.get(factId)?.text)
    .filter(Boolean)
    .map((text) => formatSongMapTextForPrompt(text, 180));
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

/**
 * Compute fraction of significant words in `text` that appear in `referenceWordSet`.
 * Returns 0-1. Used to gate contract ideas and facts against completed story prose.
 *
 * LIMITATION: Lexical matching only. Semantically equivalent phrases using
 * different words (e.g., "became stronger" vs "grew into someone better")
 * score 0 overlap. Future work: embedding-based semantic similarity.
 *
 * Thresholds used across the system:
 *   0.3  — judge certification block (more permissive, broader context)
 *   0.4  — songwriter prompt suppression + contract validation
 *   0.5  — detail coverage "paraphrased" classification
 */
function significantWordOverlap(text, referenceWordSet) {
  if (!text || !referenceWordSet || referenceWordSet.size === 0) return 0;
  const words = getSignificantWords(text);
  if (words.length === 0) return 0;
  const matching = words.filter((w) => referenceWordSet.has(w));
  return matching.length / words.length;
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

  // Validate contract ideas against completed story prose when available
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

  let repaired = {
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

  // Replace contract ideas unsupported by the completed story prose
  const completedProse = context?.completed_story_package?.prose || "";
  if (completedProse) {
    const proseWordSet = new Set(getSignificantWords(completedProse));
    const proseSentences = sentenceSplit(completedProse);
    const usedSentences = new Set();
    const sectionKeys = ["verse1", "pre", "chorus", "verse2", "bridge", "key_lines"];

    // Collect already-supported ideas to track which prose sentences are "used"
    for (const sectionName of sectionKeys) {
      if (!Array.isArray(repaired[sectionName])) continue;
      for (const entry of repaired[sectionName]) {
        const idea = getSongMapIdea(entry);
        if (idea && significantWordOverlap(idea, proseWordSet) >= 0.3) {
          // Mark the best-matching prose sentence as used
          for (const sentence of proseSentences) {
            const ideaWordSet = new Set(getSignificantWords(idea));
            if (significantWordOverlap(sentence, ideaWordSet) > 0.3) {
              usedSentences.add(sentence);
            }
          }
        }
      }
    }

    for (const sectionName of sectionKeys) {
      if (!Array.isArray(repaired[sectionName])) continue;
      repaired[sectionName] = repaired[sectionName].map((entry) => {
        const idea = getSongMapIdea(entry);
        if (!idea) return entry;
        const overlap = significantWordOverlap(idea, proseWordSet);
        if (overlap >= 0.3) return entry;
        // Pick the best unused prose sentence as replacement
        let bestSentence = null;
        let bestScore = -1;
        for (const sentence of proseSentences) {
          if (usedSentences.has(sentence)) continue;
          // Prefer longer sentences (more content) as replacement candidates
          const score = getSignificantWords(sentence).length;
          if (score > bestScore) {
            bestScore = score;
            bestSentence = sentence;
          }
        }
        if (bestSentence) {
          usedSentences.add(bestSentence);
          return {
            idea: sanitizeInput(bestSentence),
            source_facts: inferSourceFactsForIdea(bestSentence, facts, []),
          };
        }
        return entry;
      });
    }
  }

  const semanticRepair = repairSongMapWithProfile(repaired, context, {
    blockProfile: deriveStoryBlockProfile(context),
  });
  repaired = semanticRepair.song_map;

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

  const initialBlockProfile = deriveStoryBlockProfile(context);
  const initialSemanticRepair = repairSongMapWithProfile(context?.song_map, context, {
    blockProfile: initialBlockProfile,
  });
  const initialReport = validateSongContract(context, {
    blockProfile: initialBlockProfile,
    semanticReport: initialSemanticRepair.report,
  });
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
  const repairedBlockProfile = deriveStoryBlockProfile(repairedContext);
  const repairedSemanticRepair = repairSongMapWithProfile(repairedSongMap, repairedContext, {
    blockProfile: repairedBlockProfile,
  });
  const repairedReport = validateSongContract(repairedContext, {
    blockProfile: repairedBlockProfile,
    semanticReport: repairedSemanticRepair.report,
  });
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
  const sectionStorySource = promptContext.completed_story_package?.prose ||
    promptContext.narrative ||
    promptContext.summary_text ||
    "";
  const narrativeExcerpt = buildPromptStoryExcerpt(sectionStorySource, 1000);
  const narrative = narrativeExcerpt.text;
  const message = sanitizeForPrompt(promptContext.message || "");
  const sectionLedger = filterLedgerForSection(
    filterLedgerAgainstCompletedStory(
      buildStoryDetailLedger(promptContext, { maxEntries: FIDELITY_LEDGER_MAX_ENTRIES }),
      promptContext.completed_story_package?.prose || ""
    ),
    normalizedSection
  );
  const sectionLedgerText = sectionLedger.length > 0
    ? `${formatStoryDetailLedgerForPrompt(sectionLedger, { maxTextChars: 240 }).replace("STORY DETAIL LEDGER (BINDING):", "BINDING DETAIL LEDGER FOR THIS SECTION:")}\n`
    : "";

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

${sectionLedgerText}
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
    logLabel: `songwriter:section:${normalizedSection}`,
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
  const reusedSections = [];
  const generatedSectionSummaries = [];

  console.log(`[Songwriter] Sectioned generation order=${JSON.stringify(order)} regenerate=${JSON.stringify(sectionsToRegenerate ? Array.from(sectionsToRegenerate) : [])}`);

  for (const sectionName of order) {
    const shouldReuse = sectionsToRegenerate
      && !sectionsToRegenerate.has(sectionName)
      && previousSectionsByName.has(sectionName);

    if (shouldReuse) {
      const reusedSection = previousSectionsByName.get(sectionName);
      reusedSections.push(sectionName);
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
    generatedSectionSummaries.push({
      section: sectionName,
      provider: sectionResult.provider || null,
      model: sectionResult.model || null,
      line_count: Array.isArray(sectionResult.section?.lines) ? sectionResult.section.lines.length : 0,
      story_elements_used_count: Array.isArray(sectionResult.story_elements_used) ? sectionResult.story_elements_used.length : 0,
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
    observability: {
      sectioned_generation: true,
      generated_sections: generatedSectionSummaries,
      reused_sections: reusedSections,
      generation_order: order,
    },
  };
}

function buildStoryCertificationBlock(storyContext) {
  const ensured = ensureSongContract(normalizeContext(storyContext));
  const normalized = ensured.context;
  const parts = [];
  const factMap = buildFactMap(normalized.facts);
  const hasCompletedStory = !!(normalized.completed_story_package?.prose);
  const completedProse = normalized.completed_story_package?.prose || "";
  const fidelityLedger = filterLedgerAgainstCompletedStory(
    buildStoryDetailLedger(normalized, { maxEntries: FIDELITY_LEDGER_MAX_ENTRIES }),
    completedProse
  );

  if (fidelityLedger.length > 0) {
    parts.push(formatStoryDetailLedgerForPrompt(fidelityLedger));
  }

  // CR-5: Build proseWordSet from completed_story_package.prose (not narrative).
  // After repair, prose and narrative can diverge; the judge must certify against prose.
  const proseWordSet = hasCompletedStory && completedProse.length >= 100
    ? new Set(getSignificantWords(completedProse))
    : null;

  // When completed story package exists, use it as primary narrative for the judge
  if (hasCompletedStory) {
    const excerpt = buildPromptStoryExcerpt(completedProse, 3200);
    parts.push(`Completed story ${excerpt.compacted ? "excerpt (PRIMARY — head/tail)" : "(PRIMARY — single source of truth)"}:\n${excerpt.text}`);
    parts.push("Primary check: every lyric detail must trace to the completed story above. Details that appear in lyrics but NOT in the completed story are invented and should fail faithfulness.");
  } else if (normalized.narrative) {
    // Legacy fallback: use narrative as before
    const excerpt = buildPromptStoryExcerpt(normalized.narrative, 2400);
    parts.push(`Narrative${excerpt.compacted ? " excerpt (head/tail)" : ""}:\n${excerpt.text}`);
  }

  // CR-4: When completed story exists, filter facts directly by prose overlap (> 0.3),
  // bypassing filterFactsForPrompt which double-filters via narrative word intersection.
  // Safety floor (R3): minimum 3 facts always survive.
  if (proseWordSet) {
    const allFacts = (normalized.facts || [])
      .map((fact) => ({ id: fact.id || "", text: factText(fact) }))
      .filter((fact) => fact.text);
    const scored = allFacts.map((fact) => {
      const overlap = significantWordOverlap(fact.text, proseWordSet);
      return { ...fact, overlap, include: overlap > 0.3 };
    });
    let included = scored.filter((f) => f.include);
    // Safety floor: if ALL facts filtered out, keep top-3 by overlap to avoid empty judge block
    if (included.length === 0 && scored.length > 0) {
      const sorted = [...scored].sort((a, b) => b.overlap - a.overlap);
      included = sorted.slice(0, Math.min(3, scored.length));
    }
    if (included.length > 0) {
      parts.push(`Key facts:\n${included.slice(0, 20).map((fact) => `- [${fact.id || "fact"}] ${fact.text}`).join("\n")}`);
    }
  } else {
    // No completed story: preserve original behavior with filterFactsForPrompt
    const facts = filterFactsForPrompt(normalized.facts || [], normalized.narrative)
      .map((fact) => ({ id: fact.id || "", text: factText(fact) }))
      .filter((fact) => fact.text);
    if (facts.length > 0) {
      parts.push(`Key facts:\n${facts.slice(0, 20).map((fact) => `- [${fact.id || "fact"}] ${fact.text}`).join("\n")}`);
    }
  }

  if (normalized.song_map && hasSongMapContent(normalized.song_map)) {
    const songMapLines = [];
    if (normalized.song_map.hook) {
      const hookIdea = formatSongMapTextForPrompt(getSongMapIdea(normalized.song_map.hook));
      const hookSources = getSongMapSourceFacts(normalized.song_map.hook);
      songMapLines.push(`- hook: ${hookIdea}${hookSources.length > 0 ? ` [source_facts: ${hookSources.join(", ")}]` : ""}`);
    }
    for (const key of ["verse1", "pre", "chorus", "verse2", "bridge", "key_lines"]) {
      const lines = normalized.song_map[key] || [];
      if (Array.isArray(lines) && lines.length > 0) {
        songMapLines.push(`- ${key}: ${lines.map((entry) => {
          const idea = formatSongMapTextForPrompt(getSongMapIdea(entry));
          const sources = getSongMapSourceFacts(entry);
          const support = sources
            .map((factId) => factMap.get(factId)?.text)
            .filter(Boolean)
            .map((text) => formatSongMapTextForPrompt(text, 180))
            .join("; ");
          return `${idea}${sources.length > 0 ? ` [source_facts: ${sources.join(", ")}${support ? ` => ${support}` : ""}]` : ""}`;
        }).join(" | ")}`);
      }
    }
    if (songMapLines.length > 0) {
      parts.push(`Primary song map:\n${songMapLines.join("\n")}`);
    }
  }

  // Primitives: gate through prose overlap when completed story exists
  const primitiveEntries = [
    ["turning_point", normalized.primitives?.turning_point],
    ["resolution", normalized.primitives?.resolution],
    ["theme", normalized.primitives?.theme],
    ["inciting_incident", normalized.primitives?.inciting_incident],
    ["conflict_external", normalized.primitives?.conflict?.external],
    ["conflict_internal", normalized.primitives?.conflict?.internal],
  ].filter(([, value]) => typeof value === "string" && value.trim());

  if (proseWordSet) {
    const scored = primitiveEntries.map(([key, value]) => {
      const shortBypass = getSignificantWords(value).length < 3;
      const overlap = shortBypass ? 1 : significantWordOverlap(value, proseWordSet);
      return { key, value, overlap, include: shortBypass || overlap > 0.3 };
    });
    let included = scored.filter((p) => p.include);
    // Safety floor: minimum 1 primitive survives
    if (included.length === 0 && scored.length > 0) {
      included = [...scored].sort((a, b) => b.overlap - a.overlap).slice(0, 1);
    }
    if (included.length > 0) {
      parts.push(`Story primitives:\n${included.map((p) => `- ${p.key}: ${p.value}`).join("\n")}`);
    }
  } else if (primitiveEntries.length > 0) {
    parts.push(`Story primitives:\n${primitiveEntries.map(([key, value]) => `- ${key}: ${value}`).join("\n")}`);
  }

  // Beats: leave as-is (structural metadata, not content)
  const beatEntries = (normalized.beats || [])
    .filter((beat) => beat && beat.id && (typeof beat.strength === "number" || beat.status))
    .sort((a, b) => (b.strength || 0) - (a.strength || 0))
    .slice(0, 8)
    .map((beat) => `- ${beat.id}: strength ${typeof beat.strength === "number" ? beat.strength.toFixed(2) : beat.status || "unknown"}`);
  if (beatEntries.length > 0) {
    parts.push(`Story beats:\n${beatEntries.join("\n")}`);
  }

  // Motifs: gate through prose overlap when completed story exists
  if (Array.isArray(normalized.motifs) && normalized.motifs.length > 0) {
    if (proseWordSet) {
      const scored = normalized.motifs.slice(0, 6).map((motif) => {
        const shortBypass = getSignificantWords(motif).length < 3;
        const overlap = shortBypass ? 1 : significantWordOverlap(motif, proseWordSet);
        return { motif, overlap, include: shortBypass || overlap > 0.3 };
      });
      let included = scored.filter((m) => m.include);
      // Safety floor: minimum 1 motif survives
      if (included.length === 0 && scored.length > 0) {
        included = [...scored].sort((a, b) => b.overlap - a.overlap).slice(0, 1);
      }
      if (included.length > 0) {
        parts.push(`Motifs:\n${included.map((m) => `- ${m.motif}`).join("\n")}`);
      }
    } else {
      parts.push(`Motifs:\n${normalized.motifs.slice(0, 6).map((motif) => `- ${motif}`).join("\n")}`);
    }
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

  const summary_text = sanitizeLongStoryInput(
    raw.summary?.summary_text || raw.summary?.text || raw.narrative || ""
  );
  const soul = sanitizeInput(raw.summary?.soul || raw.soul || raw.what_makes_them_special || "");
  const narrative = sanitizeLongStoryInput(raw.narrative || summary_text || "");

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
        answer: sanitizeLongStoryInput(a?.answer, 4000),
      }))
      .filter(a => a.question && a.answer)
    : [];

  // Pass through the completed story package when present (canonical authority source)
  const completed_story_package = raw.completed_story_package && typeof raw.completed_story_package === "object"
    ? {
      prose: sanitizeLongStoryInput(raw.completed_story_package.prose || ""),
      retained_details: Array.isArray(raw.completed_story_package.retained_details)
        ? raw.completed_story_package.retained_details
        : [],
      detail_coverage_map: raw.completed_story_package.detail_coverage_map || null,
      semantic_block_profile: raw.completed_story_package.semantic_block_profile || null,
    }
    : null;

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
    completed_story_package,
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
        answer: buildPromptStoryExcerpt(a.answer, 700).text,
      }))
      : [],
  };

  // When completed story package exists, it is the canonical narrative source
  const hasCompletedStory = !!(prepared.completed_story_package?.prose);
  const completedProse = prepared.completed_story_package?.prose || "";
  const proseIsSubstantial = hasCompletedStory
    && completedProse.length >= 100
    && completedProse.split(/[.!?]\s+/).filter(Boolean).length >= 2;
  const storyDetailLedger = filterLedgerAgainstCompletedStory(
    buildStoryDetailLedger(prepared, { maxEntries: PROMPT_LEDGER_MAX_ENTRIES }),
    prepared.completed_story_package?.prose || ""
  );
  const storyDetailLedgerText = formatStoryDetailLedgerForPrompt(storyDetailLedger);

  // Pre-compute prose word set for parallel-content and fact filtering.
  // When proseIsSubstantial, parallel fields with <40% overlap are suppressed
  // to prevent the LLM from seeing competing content sources.
  // Safety floor: if prose is too short (< 100 chars or < 2 sentences), keep everything.
  const proseWordSet = proseIsSubstantial
    ? new Set(getSignificantWords(completedProse))
    : null;

  const shouldIncludeParallel = (fieldValue) =>
    !proseIsSubstantial || significantWordOverlap(fieldValue, proseWordSet) > 0.4;

  const contextSections = [];
  contextSections.push(`RECIPIENT: ${safe.recipient_name || "someone special"}`);
  contextSections.push(`OCCASION: ${safe.occasion || "celebration"}`);
  contextSections.push(`MUSIC STYLE: ${styleName}`);

  if (safe.message && shouldIncludeParallel(safe.message)) {
    contextSections.push(`CORE MESSAGE: "${safe.message}"`);
  }

  if (relationshipDesc) {
    contextSections.push(`RELATIONSHIP: ${safe.recipient_name || "They"} is their ${relationshipDesc}`);
  }

  if (safe.years_known) {
    contextSections.push(`HISTORY: They have known each other for ${safe.years_known} years`);
  }

  if (storyDetailLedgerText) {
    contextSections.push(storyDetailLedgerText);
  }

  if (safe.specific_memory && shouldIncludeParallel(safe.specific_memory)) {
    contextSections.push(`SPECIFIC MEMORY: "${safe.specific_memory}"`);
  }

  if (safe.special_phrases && shouldIncludeParallel(safe.special_phrases)) {
    contextSections.push(`SPECIAL PHRASES/NICKNAMES: "${safe.special_phrases}"`);
  }

  if (safe.what_makes_them_special && shouldIncludeParallel(safe.what_makes_them_special)) {
    contextSections.push(`WHAT MAKES THEM SPECIAL: "${safe.what_makes_them_special}"`);
  }

  const narrativeText = hasCompletedStory
    ? prepared.completed_story_package.prose
    : (prepared.summary_text || prepared.narrative);
  const promptStoryExcerpt = buildPromptStoryExcerpt(narrativeText);
  if (promptStoryExcerpt.text) {
    if (hasCompletedStory) {
      const label = promptStoryExcerpt.compacted
        ? "AUTHORITATIVE COMPLETED STORY EXCERPT"
        : "AUTHORITATIVE COMPLETED STORY";
      contextSections.push(`${label}:\nThis is the single source of truth. Every lyric detail must trace to this story. If compacted, the binding ledger above carries the required details.\n${promptStoryExcerpt.text}`);
    } else {
      const label = promptStoryExcerpt.compacted
        ? "STORY NARRATIVE EXCERPT"
        : "STORY NARRATIVE";
      contextSections.push(`${label}:\n${promptStoryExcerpt.text}`);
    }
  }

  if (safe.soul && shouldIncludeParallel(safe.soul)) {
    contextSections.push(`THE SOUL (most important details):\n${safe.soul}`);
  }

  let motifsIncludedCount = 0;
  if (safe.motifs.length > 0) {
    // Gate motifs through prose overlap when completed story exists (consistent with judge block)
    let filteredMotifs = safe.motifs;
    if (proseIsSubstantial && proseWordSet) {
      filteredMotifs = safe.motifs.filter(
        (motif) => getSignificantWords(motif).length < 3 || significantWordOverlap(motif, proseWordSet) > 0.4
      );
      // Safety floor: minimum 1 motif survives
      if (filteredMotifs.length === 0 && safe.motifs.length > 0) {
        const scored = safe.motifs.map((m) => ({ m, ov: significantWordOverlap(m, proseWordSet) }));
        scored.sort((a, b) => b.ov - a.ov);
        filteredMotifs = [scored[0].m];
      }
    }
    if (filteredMotifs.length > 0) {
      motifsIncludedCount = filteredMotifs.length;
      contextSections.push(`RECURRING MOTIFS:\n${filteredMotifs.map((motif) => `- ${motif}`).join("\n")}`);
    }
  }

  const detailLines = [];
  for (const [key, value] of Object.entries(safe.elements || {})) {
    if (value && value.trim()) {
      const label = key.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
      detailLines.push(`- ${label}: ${value}`);
    }
  }
  // When completed story exists, single prose-overlap filter (no double-filter via filterFactsForPrompt).
  // Matches the judge block pattern in buildStoryCertificationBlock.
  if (proseWordSet) {
    const scoredFacts = (safe.facts || [])
      .filter((f) => f?.text)
      .map((fact) => ({
        fact,
        overlap: significantWordOverlap(fact.text, proseWordSet),
      }));
    let passingFacts = scoredFacts.filter((sf) => sf.overlap > 0.4);
    // Safety floor: if ALL facts filtered out, keep top-3 by overlap to avoid empty prompt
    if (passingFacts.length === 0 && scoredFacts.length > 0) {
      passingFacts = scoredFacts
        .sort((a, b) => b.overlap - a.overlap)
        .slice(0, Math.min(3, scoredFacts.length));
    }
    for (const { fact } of passingFacts) {
      const prefix = fact.id ? `[${fact.id}] ` : "";
      detailLines.push(`- ${prefix}${fact.text}`);
    }
  } else {
    // Legacy path: no completed story, use filterFactsForPrompt
    for (const fact of filterFactsForPrompt(safe.facts || [], narrativeText)) {
      if (fact?.text) {
        const prefix = fact.id ? `[${fact.id}] ` : "";
        detailLines.push(`- ${prefix}${fact.text}`);
      }
    }
  }
  if (detailLines.length > 0 && !hasCompletedStory) {
    contextSections.push(`KEY DETAILS:\n${detailLines.join("\n")}`);
  }

  const supportingStoryLines = [];

  // Atoms: gate through prose overlap when completed story exists
  const atomEntries = [
    ["Setting", safe.atoms?.where],
    ["When", safe.atoms?.when],
    ["Who", safe.atoms?.who],
    ["Sound", safe.atoms?.sound],
    ["Smell", safe.atoms?.smell],
    ["Physical detail", safe.atoms?.physical],
    ["Object", safe.atoms?.object],
  ].filter(([, v]) => v);

  if (proseIsSubstantial) {
    // Score each atom; short values (< 3 significant words) bypass the filter
    const scored = atomEntries.map(([label, value]) => {
      const sanitized = sanitizeForPrompt(value);
      const shortBypass = getSignificantWords(value).length < 3;
      const overlap = shortBypass ? 1 : significantWordOverlap(value, proseWordSet);
      return { label, sanitized, overlap, include: shortBypass || overlap > 0.4 };
    });
    let included = scored.filter(a => a.include);
    // Safety floor: if ALL atoms removed, keep top-2 by overlap score
    if (included.length === 0 && scored.length > 0) {
      included = [...scored].sort((a, b) => b.overlap - a.overlap).slice(0, 2);
    }
    for (const a of included) {
      supportingStoryLines.push(`- ${a.label}: ${a.sanitized}`);
    }
  } else {
    for (const [label, value] of atomEntries) {
      supportingStoryLines.push(`- ${label}: ${sanitizeForPrompt(value)}`);
    }
  }

  // Primitives: gate through prose overlap when completed story exists
  const primitiveEntries = [
    ["Theme", safe.primitives?.theme],
    ["Resolution", safe.primitives?.resolution],
    ["Turning point", safe.primitives?.turning_point],
  ].filter(([, v]) => v);

  if (proseIsSubstantial) {
    const scored = primitiveEntries.map(([label, value]) => {
      const sanitized = sanitizeForPrompt(value);
      const shortBypass = getSignificantWords(value).length < 3;
      const overlap = shortBypass ? 1 : significantWordOverlap(value, proseWordSet);
      return { label, sanitized, overlap, include: shortBypass || overlap > 0.4 };
    });
    let included = scored.filter(a => a.include);
    // Safety floor: if ALL primitives removed, keep top-1 by overlap score
    if (included.length === 0 && scored.length > 0) {
      included = [...scored].sort((a, b) => b.overlap - a.overlap).slice(0, 1);
    }
    for (const a of included) {
      supportingStoryLines.push(`- ${a.label}: ${a.sanitized}`);
    }
  } else {
    for (const [label, value] of primitiveEntries) {
      supportingStoryLines.push(`- ${label}: ${sanitizeForPrompt(value)}`);
    }
  }

  if (supportingStoryLines.length > 0) {
    const supportLabel = hasCompletedStory
      ? "STRUCTURAL HINTS (scene scaffolding — not independent content sources)"
      : "SUPPORTING STORY DETAILS";
    contextSections.push(`${supportLabel}:\n${supportingStoryLines.join("\n")}`);
  }

  if (hasStructuredStory && (ensured.repaired || !ensured.initialReport.valid)) {
    contextSections.push(
      `CONTRACT REPAIR:\n- valid: ${contractReport.valid}\n- repaired internally: ${ensured.repaired ? "yes" : "no"}\n- missing sections repaired: ${(ensured.initialReport.missingSections || []).join(", ") || "none"}\n- uncited sections repaired: ${(ensured.initialReport.uncitedSections || []).join(", ") || "none"}`
    );
  }

  let includedAnswers = [];
  if (Array.isArray(safe.memory_answers) && safe.memory_answers.length > 0) {
    includedAnswers = safe.memory_answers;
    if (hasCompletedStory && proseWordSet) {
      const scored = safe.memory_answers.map(a => {
        const overlap = significantWordOverlap(a.answer || "", proseWordSet);
        return { ...a, overlap, include: overlap > 0.4 };
      });
      includedAnswers = scored.filter(a => a.include);
      // Safety floor: if ALL memory_answers filtered out, keep top-1 by overlap
      if (includedAnswers.length === 0 && scored.length > 0) {
        includedAnswers = [...scored].sort((a, b) => b.overlap - a.overlap).slice(0, 1);
      }
    }
    if (includedAnswers.length > 0) {
      const answersText = includedAnswers
        .map(a => `- ${a.question}: "${a.answer}"`)
        .join("\n");
      contextSections.push(`DEEPER STORY DETAILS:\n${answersText}`);
    }
  }

  // Story arc mapping (only emitted when structured story data exists)
  const storyArcSection = buildStoryArcSection(safe, contractReport);

  const revisionSection = revisionNote
    ? `\n## REVISION NOTE\n${revisionNote}\n`
    : "";
  const previousDraftSection = previousDraft
    ? `\n## PREVIOUS DRAFT TO REWRITE\nThis draft has musical material worth preserving, but it failed story certification. Keep any grounded lines that already work. Rewrite the weak or unsupported parts until the full song tells the story faithfully.\n${previousDraft}\n`
    : "";

  const prompt = `${SONGWRITER_PERSONA}

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
}`;

  const budgetedPrompt = applySongwriterPromptBudget(prompt, {
    narrativeText: promptStoryExcerpt.text || narrativeText,
    tokenBudget: 5500,
  });
  const promptInputSummary = summarizePromptInputForLog(summarizeLyricsContextForLog(prepared), {
    hasStructuredStory,
    hasCompletedStory,
    proseIsSubstantial,
    detailLinesCount: detailLines.length,
    supportingStoryLinesCount: supportingStoryLines.length,
    memoryAnswersIncludedCount: includedAnswers.length,
    motifsIncludedCount,
    storyArcPresent: Boolean(storyArcSection),
    storyDetailLedger: summarizeStoryDetailLedgerForLog(storyDetailLedger),
    storyProseExcerpt: {
      compacted: promptStoryExcerpt.compacted,
      original_chars: promptStoryExcerpt.originalChars,
      excerpt_chars: promptStoryExcerpt.excerptChars,
    },
    revisionNote,
    previousDraft,
    previousDraftSectionCount: Array.isArray(options.previousDraft?.sections) ? options.previousDraft.sections.length : 0,
    contractValid: contractReport.valid,
    contractRepaired: ensured.repaired,
    missingSections: ensured.initialReport.missingSections || [],
    uncitedSections: ensured.initialReport.uncitedSections || [],
  });

  if (options.suppressLogs !== true) {
    console.log(`[Songwriter] Prompt input summary=${JSON.stringify({
      ...promptInputSummary,
      prompt_budget: {
        initial_tokens: budgetedPrompt.initialTokens,
        final_tokens: budgetedPrompt.tokens,
        token_budget: budgetedPrompt.tokenBudget,
        initial_chars: budgetedPrompt.initialChars,
        final_chars: budgetedPrompt.finalChars,
        removed_chars_total: budgetedPrompt.removedCharsTotal,
      },
    })}`);

    if (budgetedPrompt.compactions.length > 0) {
      console.warn(`[Songwriter] Prompt compaction summary=${JSON.stringify(budgetedPrompt.compactions)}`);
    }

    if (budgetedPrompt.compactions.some((entry) => entry.stage === "song_brief_hard_cap")) {
      console.warn(`[Songwriter] Hard-capped SONG BRIEF to fit budget: ~${budgetedPrompt.tokens} tokens`);
    }

    if (budgetedPrompt.tokens > budgetedPrompt.tokenBudget) {
      console.warn(`[Songwriter] Prompt still over budget after all truncation: ~${budgetedPrompt.tokens} tokens (max: ${budgetedPrompt.tokenBudget}). Proceeding with best effort.`);
    }
  }

  if (options.returnMetadata) {
    return {
      prompt: budgetedPrompt.prompt,
      metadata: {
        prompt_input_summary: promptInputSummary,
        prompt_budget: {
          initial_tokens: budgetedPrompt.initialTokens,
          final_tokens: budgetedPrompt.tokens,
          token_budget: budgetedPrompt.tokenBudget,
          initial_chars: budgetedPrompt.initialChars,
          final_chars: budgetedPrompt.finalChars,
          removed_chars_total: budgetedPrompt.removedCharsTotal,
          compactions: budgetedPrompt.compactions,
        },
      },
    };
  }

  return budgetedPrompt.prompt;
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
  const promptBuild = buildSongwriterPrompt(context, { ...options, returnMetadata: true });
  const prompt = promptBuild.prompt;
  const llmResult = await generateText({
    prompt,
    taskType: "lyrics",
    logLabel: "songwriter:lyrics",
    temperature: 0.7,
    responseMimeType: "application/json",
    maxOutputTokens: LYRICS_LLM_MAX_OUTPUT_TOKENS,
  });

  const lyrics = parseLyricsJson(llmResult.text, "lyrics");

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
    observability: promptBuild.metadata,
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

function getMissingRequiredDetails(fidelity) {
  const fromCoverage = Array.isArray(fidelity?.required_detail_coverage?.missing_required)
    ? fidelity.required_detail_coverage.missing_required
    : [];
  const fromBeats = Array.isArray(fidelity?.missing_story_beats)
    ? fidelity.missing_story_beats.filter((beat) => /^\[[^\]]+\]\s+/.test(String(beat || "")))
    : [];
  return [...new Set([...fromCoverage, ...fromBeats])]
    .map((detail) => sanitizeForPrompt(detail))
    .filter(Boolean);
}

function getInventedDetails(fidelity) {
  return (Array.isArray(fidelity?.invented_details) ? fidelity.invented_details : [])
    .map((detail) => sanitizeForPrompt(detail))
    .filter(Boolean);
}

function parseLyricsJson(rawText, errorPrefix = "lyrics") {
  // LLMs occasionally wrap JSON in ```json ... ``` fences despite responseMimeType.
  const text = String(rawText || "")
    .replace(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i, "$1")
    .trim();
  if (!text) {
    throw new Error(`E201_LYRICS_ERROR: No JSON found in ${errorPrefix} response`);
  }

  // Balanced-brace extraction: greedy `/{...}/` would concatenate two top-level
  // JSON blobs (e.g., when the LLM echoes the original lyrics) into invalid input.
  const start = text.indexOf("{");
  if (start === -1) {
    throw new Error(`E201_LYRICS_ERROR: No JSON found in ${errorPrefix} response`);
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === "\"") { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) {
    throw new Error(`E201_LYRICS_ERROR: Unterminated JSON in ${errorPrefix} response`);
  }
  const jsonText = text.slice(start, end + 1);
  try {
    return JSON.parse(jsonText);
  } catch (parseErr) {
    console.error(`[Songwriter] Failed to parse ${errorPrefix} JSON:`, parseErr.message);
    throw new Error(`Failed to parse ${errorPrefix}`);
  }
}

async function repairLyricsForRequiredDetails({
  lyrics,
  storyContext,
  fidelity,
  recipientName,
  style,
}) {
  const missingRequired = getMissingRequiredDetails(fidelity).slice(0, 4);
  if (missingRequired.length === 0) return null;
  const inventedDetails = getInventedDetails(fidelity).slice(0, 6);

  const draftJson = JSON.stringify(lyrics, null, 2);
  const compactEvidence = buildCompactStoryEvidenceBlock(storyContext);
  const prompt = `${SONGWRITER_PERSONA}

## SURGICAL REQUIRED-DETAIL REPAIR
The current lyrics are close, but they cannot ship because required story details are missing.

Repair goal:
- Preserve the existing song shape, title, style, and emotional tone.
- Make the smallest possible edits.
- Add or rewrite lines so EVERY missing required detail below survives through literal wording or clear paraphrase.
- Remove unsupported invented details if they appear.
- Do not add new people, places, objects, weather, books, roads, or events unless they are in the story evidence.
- Keep lines singable for ${MUSIC_STYLES[style] || style || "the selected"} style.

MISSING REQUIRED DETAILS:
${missingRequired.map((detail) => `- ${detail}`).join("\n")}

UNSUPPORTED INVENTED DETAILS TO REMOVE:
${inventedDetails.length > 0 ? inventedDetails.map((detail) => `- ${detail}`).join("\n") : "- none reported by the judge"}

COMPACT STORY EVIDENCE:
${compactEvidence}

CURRENT LYRICS JSON:
${draftJson}

Return ONLY the repaired lyrics JSON in the same schema:
{
  "title": "...",
  "style": "${style || "pop"}",
  "sections": [
    {"name": "verse1", "lines": ["..."]},
    {"name": "chorus", "lines": ["..."]},
    {"name": "verse2", "lines": ["..."]},
    {"name": "bridge", "lines": ["..."]}
  ],
  "anchor_line": "...",
  "story_elements_used": ["include the repaired required details here"]
}`;

  const promptTokens = roughTokenEstimate(prompt);
  console.warn(`[Songwriter] repair_attempted=${JSON.stringify({
    type: "targeted_required_detail",
    missing_required_count: missingRequired.length,
    invented_details_count: inventedDetails.length,
    prompt_tokens_estimate: promptTokens,
    max_output_tokens: LYRICS_LLM_REPAIR_MAX_OUTPUT_TOKENS,
  })}`);
  const llmResult = await generateText({
    prompt,
    taskType: "lyrics",
    logLabel: "songwriter:required_detail_repair",
    temperature: 0.25,
    responseMimeType: "application/json",
    maxOutputTokens: LYRICS_LLM_REPAIR_MAX_OUTPUT_TOKENS,
  });

  const repairedLyrics = parseLyricsJson(llmResult.text, "required detail repair");
  if (repairedLyrics && Array.isArray(repairedLyrics.sections)) {
    for (const section of repairedLyrics.sections) {
      if (Array.isArray(section.lines)) {
        section.lines = section.lines.map(line =>
          typeof line === "string" ? line : (line && line.text) || String(line || "")
        );
      }
    }
  }

  const validated = validateAndRepairLyrics(repairedLyrics, recipientName, style);
  const finalLyrics = validated.lyrics || repairedLyrics;
  const qualityScore = assessQuality(finalLyrics, storyContext);
  const repairCoverage = assessRequiredDetailCoverage(finalLyrics, storyContext);
  console.log(`[Songwriter] repair_result=${JSON.stringify({
    type: "targeted_required_detail",
    provider: llmResult.provider || null,
    model: llmResult.model || null,
    usage: llmResult.usage || null,
    quality_score: qualityScore,
    validation_issue_count: validated.issues.length,
    missing_required_before: missingRequired.length,
    missing_required_after: repairCoverage.missing_required.length,
    missing_required_preview: summarizeArrayPreview(repairCoverage.missing_required, 4),
    repair_passed_local_required_gate: repairCoverage.missing_required.length === 0,
    lyrics: summarizeLyricsOutputForLog(finalLyrics),
  })}`);

  return {
    lyrics: finalLyrics,
    provider: llmResult.provider,
    model: llmResult.model,
    usage: llmResult.usage,
    qualityScore,
    validationIssues: validated.issues,
  };
}

async function generateLyricsFromContext(context) {
  const normalized = normalizeContext(context);
  const ensured = ensureSongContract(normalized);
  const workingContext = ensured.context;
  const canUseSectionedGeneration = ensured.report.valid && ensured.initialReport.hasCitedContract;
  const contextSummary = summarizeLyricsContextForLog(workingContext);

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
  let targetedRepairTried = false;
  const hasStoryContext = !!(
    workingContext.narrative ||
    workingContext.completed_story_package?.prose ||
    (workingContext.facts && workingContext.facts.length > 0)
  );

  console.log(`[Songwriter] Starting lyric generation context=${JSON.stringify({
    ...contextSummary,
    has_story_context: hasStoryContext,
    sectioned_generation_enabled: canUseSectionedGeneration,
    contract_valid: ensured.report.valid,
    contract_repaired: ensured.repaired,
    missing_sections: ensured.initialReport.missingSections || [],
    uncited_sections: ensured.initialReport.uncitedSections || [],
  })}`);

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
      console.log(`[Songwriter] Attempt ${attempt + 1}/${SELF_CORRECTION_MAX + 1} revision=${JSON.stringify({
        quality_repair: attempt > 0 && lastQuality < QUALITY_MIN_SCORE,
        fidelity_repair: Boolean(safeFeedback),
        sections_to_regenerate: sectionsToRegenerate || [],
        last_quality: Number.isFinite(lastQuality) ? lastQuality : null,
        last_fidelity: summarizeFidelityForLog(lastFidelity),
      })}`);
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
      const lyricsSummary = summarizeLyricsOutputForLog(lyrics);

      console.log(`[Songwriter] Candidate lyrics summary=${JSON.stringify({
        attempt: attempt + 1,
        provider: llmResult.provider || null,
        model: llmResult.model || null,
        usage: llmResult.usage || null,
        validation_issue_count: validated.issues.length,
        lyrics: lyricsSummary,
        prompt_budget: llmResult.observability?.prompt_budget || null,
        generation_observability: llmResult.observability || null,
      })}`);
      console.log(`[Songwriter] Candidate quality attempt=${attempt + 1} score=${qualityScore}`);

      if (qualityScore >= QUALITY_MIN_SCORE) {
        // Track best quality-passing lyrics
        const candidateResult = {
          lyrics,
          lyrics_status: "generated",
          provider: llmResult.provider,
          model: llmResult.model,
          usage: llmResult.usage,
          filtered_fact_count: filterFactsForPrompt(workingContext.facts || [], workingContext.narrative).length,
          prompt_input_summary: llmResult.observability?.prompt_input_summary || contextSummary,
          prompt_budget: llmResult.observability?.prompt_budget || null,
          lyrics_summary: lyricsSummary,
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
            console.log(`[Songwriter] Fidelity summary=${JSON.stringify({
              attempt: attempt + 1,
              provider: llmResult.provider || null,
              model: llmResult.model || null,
              quality_score: qualityScore,
              fidelity: summarizeFidelityForLog(fidelity),
            })}`);
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
            console.warn("[Songwriter] Fidelity judge failed for story-backed lyrics:", judgeErr.message);
            lastFidelity = {
              total: 0,
              coverage: 0,
              flow: 0,
              specificity: 0,
              emotional_truth: 0,
              faithfulness: 0,
              missing_story_beats: ["fidelity judge unavailable"],
              invented_details: [],
              rewrite_targets: ["retry with a smaller, more explicit story-detail ledger"],
              feedback: `Fidelity judge unavailable: ${judgeErr.message}`,
            };
            if (attempt >= SELF_CORRECTION_MAX) {
              const fidelityError = new Error("LYRICS_FIDELITY_LOW");
              fidelityError.code = "LYRICS_FIDELITY_LOW";
              fidelityError.fidelity = lastFidelity;
              fidelityError.cause = judgeErr;
              throw fidelityError;
            }
            continue;
          }

          const missingRequiredDetails = getMissingRequiredDetails(lastFidelity);
          const inventedDetailsForAttempt = getInventedDetails(lastFidelity);
          const canTryTargetedRepair = !targetedRepairTried
            && missingRequiredDetails.length > 0
            && inventedDetailsForAttempt.length === 0
            && qualityScore >= QUALITY_MIN_SCORE
            && attempt >= 1;

          if (canTryTargetedRepair || (attempt >= SELF_CORRECTION_MAX && !targetedRepairTried)) {
            try {
              const targetedRepair = await repairLyricsForRequiredDetails({
                lyrics,
                storyContext: workingContext,
                fidelity: lastFidelity,
                recipientName: normalized.recipient_name,
                style: normalized.style,
              });
              // Burn the single-shot budget only after the LLM call returned —
              // transient errors (network, quota) should not consume the repair attempt.
              targetedRepairTried = true;
              const repairQualityFloor = QUALITY_MIN_SCORE - REPAIR_QUALITY_FIDELITY_OVERRIDE_MARGIN;
              if (targetedRepair && targetedRepair.qualityScore >= repairQualityFloor) {
                const repairedFidelity = await assessNarrativeFidelity(targetedRepair.lyrics, workingContext);
                console.log(`[Songwriter] Targeted repair fidelity summary=${JSON.stringify({
                  provider: targetedRepair.provider || null,
                  model: targetedRepair.model || null,
                  quality_score: targetedRepair.qualityScore,
                  fidelity: summarizeFidelityForLog(repairedFidelity),
                })}`);
                if (Number.isFinite(repairedFidelity.total) && repairedFidelity.total >= FIDELITY_MIN_SCORE) {
                  console.log(`[Songwriter] repair_passed=${JSON.stringify({
                    type: "targeted_required_detail",
                    attempt: attempt + 1,
                    quality_score: targetedRepair.qualityScore,
                    quality_below_normal_gate: targetedRepair.qualityScore < QUALITY_MIN_SCORE,
                    fidelity_total: repairedFidelity.total,
                  })}`);
                  return {
                    ...candidateResult,
                    lyrics: targetedRepair.lyrics,
                    provider: targetedRepair.provider || candidateResult.provider,
                    model: targetedRepair.model || candidateResult.model,
                    usage: aggregateUsage(candidateResult.usage || {}, targetedRepair.usage || {}),
                    validation_issues: targetedRepair.validationIssues.length > 0
                      ? targetedRepair.validationIssues
                      : candidateResult.validation_issues,
                    lyrics_summary: summarizeLyricsOutputForLog(targetedRepair.lyrics),
                    fidelity_debug: repairedFidelity,
                    acceptance_reason: "targeted_required_detail_repair_passed",
                  };
                }
                // Only adopt the repair's fidelity score if it didn't go backwards —
                // a worse repair must not flip a borderline-pass into a hard reject.
                const priorTotal = Number.isFinite(lastFidelity?.total) ? lastFidelity.total : -Infinity;
                const repairTotal = Number.isFinite(repairedFidelity.total) ? repairedFidelity.total : -Infinity;
                if (repairTotal >= priorTotal) {
                  lastFidelity = repairedFidelity;
                } else {
                  console.warn(`[Songwriter] repair_regression=${JSON.stringify({
                    type: "targeted_required_detail",
                    prior_fidelity: priorTotal,
                    repair_fidelity: repairTotal,
                  })}`);
                }
              } else if (targetedRepair) {
                console.warn(`[Songwriter] repair_failed=${JSON.stringify({
                  type: "targeted_required_detail",
                  reason: "quality_below_repair_floor",
                  quality_score: targetedRepair.qualityScore,
                  quality_floor: repairQualityFloor,
                })}`);
              }
            } catch (repairErr) {
              console.warn(`[Songwriter] repair_failed=${JSON.stringify({
                type: "targeted_required_detail",
                reason: "exception",
                message: repairErr.message || String(repairErr),
              })}`);
              // Do not flip targetedRepairTried on transient failures — leaves room
              // for the final-attempt fallback above (`attempt >= SELF_CORRECTION_MAX`)
              // to retry once if the failure was infra, not output quality.
            }
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
  const lyricsText = flattenLyricsText(lyrics);
  const buildPrompt = (storyBlock, compactMode = false) => `You are a story fidelity judge for song lyrics. Score how well these lyrics TELL the story (not just mention keywords).

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
${compactMode ? "\nThis is a compact evidence bundle built to fit the model context. Treat the binding detail ledger as the source of truth for required story details." : ""}

Return ONLY valid JSON:
{"scores":{"coverage":N,"flow":N,"specificity":N,"emotional_truth":N,"faithfulness":N},"total":N,"missed_facts":["fact not in lyrics"],"missing_story_beats":["missing setup/turn/payoff detail"],"uncovered_song_map_slots":["verse1/chorus/bridge slot not expressed"],"broken_citations":["contract item cites the wrong fact"],"unsupported_lines":["lyric line not supported by the story"],"invented_details":["detail not in story"],"flattened_emotional_arc":"short note or empty string","rewrite_targets":["line or issue to fix"],"feedback":"one sentence: what to fix"}`;

  const fullStoryBlock = buildStoryCertificationBlock(storyContext);
  let prompt = buildPrompt(fullStoryBlock, false);
  let compactJudge = false;
  if (roughTokenEstimate(prompt) > 5400) {
    const compactStoryBlock = buildCompactStoryEvidenceBlock(storyContext);
    prompt = buildPrompt(compactStoryBlock, true);
    compactJudge = true;
    console.warn(`[Songwriter] Fidelity judge using compact evidence: promptTokens~${roughTokenEstimate(prompt)}`);
  }

  const result = await generateText({
    prompt,
    taskType: "fidelity_judge",
    logLabel: "songwriter:fidelity_judge",
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
  const requiredCoverage = assessRequiredDetailCoverage(lyrics, storyContext);
  if (requiredCoverage.missing_required.length > 0) {
    parsed.missing_story_beats = [
      ...(Array.isArray(parsed.missing_story_beats) ? parsed.missing_story_beats : []),
      ...requiredCoverage.missing_required,
    ];
    parsed.rewrite_targets = [
      ...(Array.isArray(parsed.rewrite_targets) ? parsed.rewrite_targets : []),
      ...requiredCoverage.missing_required.map((detail) => `restore required story detail: ${detail}`),
    ];
    parsed.feedback = [
      parsed.feedback,
      `Required story details are missing: ${requiredCoverage.missing_required.slice(0, 4).join("; ")}`,
    ].filter(Boolean).join(" ");
  }
  parsed.required_detail_coverage = requiredCoverage;
  parsed.total = requiredCoverage.missing_required.length > 0
    ? Math.min(computed, FIDELITY_MIN_SCORE - 1)
    : computed;
  parsed.judge_compact_evidence = compactJudge;

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
    completed_story_package: storyContext.completed_story_package,
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
  validateSongContract,
  MUSIC_STYLES,
  RELATIONSHIP_DESCRIPTORS,
  TARGET_DURATION_SECONDS,
  SONGWRITER_PERSONA,
  assessNarrativeFidelity,
  assessQuality,
  buildStoryCertificationBlock,
  buildStoryDetailLedger,
  assessSongReadiness,
  buildCompactStoryEvidenceBlock,
  assessRequiredDetailCoverage,
  applySongwriterPromptBudget,
  summarizeLyricsOutputForLog,
  summarizeFidelityForLog,
  FIDELITY_MIN_SCORE,
};
