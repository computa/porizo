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

const { generateText, isAvailable } = require("../services/llm-provider");
const { sanitizeForPrompt } = require("../services/content-filter");
const { getStoryContextV2 } = require("./v2");

// Syllable constraints for singability
const MIN_SYLLABLES_PER_LINE = 3;
const MAX_SYLLABLES_PER_LINE = 15;
const TARGET_DURATION_SECONDS = { min: 45, max: 60 };
const QUALITY_MIN_SCORE = 75;
const QUALITY_RETRY_MAX = 1;

// Music styles (expanded with African and South American genres)
const MUSIC_STYLES = {
  pop: "Pop",
  acoustic: "Acoustic",
  soul: "Soul",
  folk: "Folk",
  jazz: "Jazz",
  rnb: "R&B",
  rock: "Rock",
  country: "Country",
  afrobeats: "Afrobeats",
  highlife: "Highlife",
  ogene: "Ogene",
  juju: "Jùjú",
  fuji: "Fuji",
  afropop: "Afropop",
  reggaeton: "Reggaeton",
  salsa: "Salsa",
  bossa_nova: "Bossa Nova",
  cumbia: "Cumbia",
  bachata: "Bachata",
  samba: "Samba",
  latin_pop: "Latin Pop",
};

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
- ALWAYS include at least one specific sensory detail per verse
- The CHORUS is the emotional truth - what the story MEANS
- Each VERSE moves the story forward - no filler, no repetition
- The recipient should hear this and think "they remembered THAT about me?"
- Avoid clichés, greeting-card language, and AI-sounding symmetry
- Keep language precise; prefer strong nouns and verbs over adjectives
- If a detail is given, use it; do not invent unrelated facts

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

  const normalized = style.toLowerCase().replace(/[\s-]/g, "_");

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
      .match(/[aeiouy]{1,2}/g);
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

  const elements = {};
  if (raw.elements && typeof raw.elements === "object") {
    for (const [key, value] of Object.entries(raw.elements)) {
      const sanitized = sanitizeInput(String(value || ""));
      if (sanitized) {
        elements[key] = sanitized;
      }
    }
  }

  const facts = Array.isArray(raw.facts)
    ? raw.facts
      .map(f => (typeof f === "string" ? f : f?.text))
      .filter(Boolean)
      .map(sanitizeInput)
    : [];

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
  };
}

function buildSongwriterPrompt(context, options = {}) {
  const normalized = normalizeContext(context);
  const revisionNote = sanitizeInput(options.revisionNote || "");
  const styleName = MUSIC_STYLES[normalized.style] || normalized.style || "Pop";
  const relationshipDesc = normalized.relationship_type
    ? RELATIONSHIP_DESCRIPTORS[normalized.relationship_type] || normalized.relationship_type
    : null;

  const safe = {
    ...normalized,
    message: sanitizeForPrompt(normalized.message),
    specific_memory: sanitizeForPrompt(normalized.specific_memory),
    special_phrases: sanitizeForPrompt(normalized.special_phrases),
    what_makes_them_special: sanitizeForPrompt(normalized.what_makes_them_special),
    narrative: sanitizeForPrompt(normalized.narrative),
    summary_text: sanitizeForPrompt(normalized.summary_text),
    soul: sanitizeForPrompt(normalized.soul),
    elements: Object.fromEntries(
      Object.entries(normalized.elements || {}).map(([key, value]) => [key, sanitizeForPrompt(value)])
    ),
    facts: Array.isArray(normalized.facts)
      ? normalized.facts.map(f => sanitizeForPrompt(f))
      : [],
    memory_answers: Array.isArray(normalized.memory_answers)
      ? normalized.memory_answers.map(a => ({
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

  const detailLines = [];
  for (const [key, value] of Object.entries(safe.elements || {})) {
    if (value && value.trim()) {
      const label = key.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
      detailLines.push(`- ${label}: ${value}`);
    }
  }
  for (const fact of safe.facts || []) {
    if (fact) detailLines.push(`- ${fact}`);
  }
  if (detailLines.length > 0) {
    contextSections.push(`KEY DETAILS:\n${detailLines.join("\n")}`);
  }

  if (Array.isArray(safe.memory_answers) && safe.memory_answers.length > 0) {
    const answersText = safe.memory_answers
      .map(a => `- ${a.question}: "${a.answer}"`)
      .join("\n");
    contextSections.push(`DEEPER STORY DETAILS:\n${answersText}`);
  }

  const revisionSection = revisionNote
    ? `\n## REVISION NOTE\n${revisionNote}\n`
    : "";

  return `${SONGWRITER_PERSONA}

## SONG BRIEF
${contextSections.join("\n")}

## YOUR TASK
Transform this story into a ${styleName} song that makes ${safe.recipient_name || "them"} feel truly SEEN.

Think like a legendary songwriter:
1. **EMOTIONAL EXCAVATION**: Find the specific moment or feeling that makes this relationship unique. Avoid generic praise.
2. **SCENE WORK**: Turn moments into scenes (place, object, sound, light, motion). Use grounded imagery.
3. **THE ANCHOR LINE**: Create one powerful line that captures the essence of the message and appears in the chorus.
4. **CADENCE**: Each line should be 6-12 syllables for singability in ${styleName} style. Prefer internal rhythm to obvious rhyme.
5. **PERSONAL TOUCHES**: If nicknames or special phrases were provided, incorporate them naturally.
6. **REVISION PASS**: Before output, remove any cliché or abstract line; replace with specific, story-rooted language.
${revisionSection}

## STRUCTURE
Create:
- 1 CHORUS (4-6 lines) - The emotional heart, featuring the anchor line and recipient's name
- 2-3 VERSES (4-6 lines each) - Story and details that build to the chorus
- 1 BRIDGE (optional, 2-4 lines) - A reflective or forward-looking moment

## QUALITY GATE (self-check before output)
- Does every verse include at least one concrete sensory detail?
- Is the chorus the emotional truth of the story (not a compliment list)?
- Are there any clichés or generic praise lines? If yes, replace them.
- Does the anchor line feel singular and unforgettable?
- Do the lyrics clearly reflect the provided story details?
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

async function generateLyricsWithLLM(context, options = {}) {
  const prompt = buildSongwriterPrompt(context, options);
  const llmResult = await generateText({
    prompt,
    taskType: "lyrics",
    temperature: 0.7,
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

  if (!isAvailable()) {
    const err = new Error("AI_UNAVAILABLE");
    err.code = "AI_UNAVAILABLE";
    throw err;
  }

  let lastQuality = 0;
  for (let attempt = 0; attempt <= QUALITY_RETRY_MAX; attempt++) {
    try {
      const revisionNote = attempt > 0
        ? "The first draft was too generic. Use more concrete details from the story, add vivid imagery, avoid clichés, and make the anchor line singular and unforgettable."
        : "";
      const llmResult = await generateLyricsWithLLM(normalized, { revisionNote });
      const validated = validateAndRepairLyrics(llmResult.lyrics, normalized.recipient_name, normalized.style);
      const lyrics = validated.lyrics || llmResult.lyrics;
      const qualityScore = assessQuality(lyrics, normalized);
      lastQuality = qualityScore;

      if (qualityScore >= QUALITY_MIN_SCORE) {
        return {
          lyrics,
          lyrics_status: "generated",
          provider: llmResult.provider,
          model: llmResult.model,
          usage: llmResult.usage,
          validation_issues: validated.issues.length > 0 ? validated.issues : undefined,
        };
      }
    } catch (err) {
      if (err && (err.code === "AI_UNAVAILABLE" || err.message === "AI_UNAVAILABLE")) {
        const error = new Error("AI_UNAVAILABLE");
        error.code = "AI_UNAVAILABLE";
        throw error;
      }
      throw err;
    }
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

  const recipient = storyContext.recipient_name || "";
  if (recipient) {
    const allLines = lyrics.sections?.flatMap(s => s.lines || []) || [];
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
  ];
  const allLines = lyrics.sections?.flatMap(s => s.lines || []) || [];
  for (const phrase of genericPhrases) {
    if (allLines.some(line => line.toLowerCase().includes(phrase))) {
      score -= 10;
    }
  }

  const elementsText = Object.values(storyContext.elements || {}).join(" ");
  const factsText = Array.isArray(storyContext.facts)
    ? storyContext.facts.map(f => (typeof f === "string" ? f : f?.text || "")).join(" ")
    : "";
  const storyContent = `${elementsText} ${factsText}`.toLowerCase();
  const storyWords = storyContent.split(/\s+/).filter(w => w.length > 4);
  const lyricsText = allLines.join(" ").toLowerCase();

  let storyConnectionCount = 0;
  for (const word of storyWords) {
    if (lyricsText.includes(word)) {
      storyConnectionCount++;
    }
  }
  const storyConnectionRate = storyWords.length > 0
    ? storyConnectionCount / Math.min(storyWords.length, 10)
    : 0;

  if (storyConnectionRate < 0.3) score -= 15;
  if (storyConnectionRate > 0.5) score += 10;

  return Math.max(0, Math.min(100, score));
}

/**
 * Write a song from a confirmed story
 */
async function writeSong(story_id) {
  const storyContext = await getStoryContextV2(story_id);
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
};
