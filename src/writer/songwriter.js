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
const QUALITY_RETRY_MAX = 1;
const FIDELITY_MIN_SCORE = 28; // out of 40 (70%)

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
      .map(f => {
        if (typeof f === "string") return { text: f, beat: null, source_turn: null, confidence: null };
        if (!f?.text) return null;
        return {
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

  const atoms = (raw.atoms && typeof raw.atoms === "object")
    ? Object.fromEntries(
        Object.entries(raw.atoms)
          .filter(([_, v]) => v && String(v).trim())
          .map(([k, v]) => [k, sanitizeInput(String(v))])
      )
    : {};

  const primitives = (raw.primitives && typeof raw.primitives === "object")
    ? Object.fromEntries(
        Object.entries(raw.primitives)
          .filter(([_, v]) => v != null)
          .map(([k, v]) => {
            if (typeof v === "string") return [k, sanitizeInput(v)];
            if (typeof v === "object") return [k, v]; // nested objects like conflict, characters
            return [k, v];
          })
      )
    : {};

  const dials = (raw.dials && typeof raw.dials === "object")
    ? Object.fromEntries(
        Object.entries(raw.dials)
          .filter(([_, v]) => v && String(v).trim())
          .map(([k, v]) => [k, sanitizeInput(String(v))])
      )
    : {};

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
  };
}

function buildStoryArcSection(context) {
  const { beats, atoms, primitives, facts } = context;
  // Guard: skip if no structured story data
  if (!beats?.length && !atoms?.who && !primitives?.theme && !facts?.length) return "";

  // Sort facts by source_turn for temporal order (preserve beat metadata)
  const sortedFacts = [...(facts || [])]
    .sort((a, b) => (a.source_turn || 0) - (b.source_turn || 0));

  const sections = [];
  sections.push("## STORY ARC → SONG STRUCTURE\n");
  sections.push("Your song must tell this story in order. Each section has a specific job:\n");

  // VERSE 1: The Beginning
  const v1Details = [];
  if (atoms?.where) v1Details.push(`Setting: ${atoms.where}`);
  if (atoms?.when) v1Details.push(`When: ${atoms.when}`);
  if (atoms?.who) v1Details.push(`Who: ${atoms.who}`);
  const beginningFacts = sortedFacts
    .filter(f => ["context", "scene", "meeting", "relationship"].includes(f.beat?.toLowerCase()))
    .map(f => typeof f === "string" ? f : f.text)
    .filter(Boolean);
  if (beginningFacts.length) v1Details.push(`Story details:\n${beginningFacts.map(f => `  - ${f}`).join("\n")}`);
  if (v1Details.length) {
    sections.push(`VERSE 1 (THE BEGINNING):\n${v1Details.join("\n")}\n→ Paint the scene. Where did this story start?\n`);
  }

  // VERSE 2: The Development
  const v2Details = [];
  if (atoms?.action) v2Details.push(`What happened: ${atoms.action}`);
  if (atoms?.stakes) v2Details.push(`What was at stake: ${atoms.stakes}`);
  if (primitives?.inciting_incident) v2Details.push(`Key event: ${primitives.inciting_incident}`);
  if (primitives?.conflict?.external) v2Details.push(`Challenge: ${primitives.conflict.external}`);
  if (primitives?.conflict?.internal) v2Details.push(`Inner struggle: ${primitives.conflict.internal}`);
  const devFacts = sortedFacts
    .filter(f => ["moment", "struggle", "stakes", "discovery"].includes(f.beat?.toLowerCase()))
    .map(f => typeof f === "string" ? f : f.text)
    .filter(Boolean);
  if (devFacts.length) v2Details.push(`Story details:\n${devFacts.map(f => `  - ${f}`).join("\n")}`);
  if (v2Details.length) {
    sections.push(`VERSE 2 (THE DEVELOPMENT):\n${v2Details.join("\n")}\n→ What made this story worth telling?\n`);
  }

  // BRIDGE: The Turning Point
  const brDetails = [];
  if (atoms?.turn) brDetails.push(`The turn: ${atoms.turn}`);
  if (primitives?.turning_point) brDetails.push(`Turning point: ${primitives.turning_point}`);
  const turnFacts = sortedFacts
    .filter(f => ["turning_point", "impact"].includes(f.beat?.toLowerCase()))
    .map(f => typeof f === "string" ? f : f.text)
    .filter(Boolean);
  if (turnFacts.length) brDetails.push(`Story details:\n${turnFacts.map(f => `  - ${f}`).join("\n")}`);
  if (brDetails.length) {
    sections.push(`BRIDGE (THE TURNING POINT):\n${brDetails.join("\n")}\n→ The moment everything changed.\n`);
  }

  // CHORUS: The Emotional Truth
  const chDetails = [];
  if (primitives?.resolution) chDetails.push(`Resolution: ${primitives.resolution}`);
  if (primitives?.theme) chDetails.push(`Theme: ${primitives.theme}`);
  if (atoms?.after) chDetails.push(`After: ${atoms.after}`);
  const meaningFacts = sortedFacts
    .filter(f => ["meaning", "detail"].includes(f.beat?.toLowerCase()))
    .map(f => typeof f === "string" ? f : f.text)
    .filter(Boolean);
  if (meaningFacts.length) chDetails.push(`Emotional details:\n${meaningFacts.map(f => `  - ${f}`).join("\n")}`);
  if (chDetails.length) {
    sections.push(`CHORUS (THE EMOTIONAL TRUTH):\n${chDetails.join("\n")}\n→ What the story MEANS. Not a compliment list — the truth underneath.\n`);
  }

  // Sensory palette from atoms
  const sensory = [atoms?.sound, atoms?.smell, atoms?.physical, atoms?.object]
    .filter(Boolean);
  if (sensory.length) {
    sections.push(`SENSORY PALETTE (weave these in):\n${sensory.map(s => `- ${s}`).join("\n")}\n`);
  }

  return sections.join("\n");
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
      ? normalized.facts.map(f => ({
        ...f,
        text: sanitizeForPrompt(f.text),
      }))
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
    if (fact?.text) detailLines.push(`- ${fact.text}`);
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

  // Story arc mapping (only emitted when structured story data exists)
  const storyArcSection = buildStoryArcSection(safe);

  const revisionSection = revisionNote
    ? `\n## REVISION NOTE\n${revisionNote}\n`
    : "";

  return `${SONGWRITER_PERSONA}

## SONG BRIEF
${contextSections.join("\n")}
${storyArcSection ? `\n${storyArcSection}` : ""}
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
- Does every verse include at least one concrete sensory detail?
- Is the chorus the emotional truth of the story (not a compliment list)?
- Are there any clichés or generic praise lines? If yes, replace them.
- Does the anchor line feel singular and unforgettable?
- Do the lyrics clearly reflect the provided story details?
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

  if (!isAvailable()) {
    const err = new Error("AI_UNAVAILABLE");
    err.code = "AI_UNAVAILABLE";
    throw err;
  }

  let lastQuality = 0;
  let bestLyrics = null;
  let bestQuality = 0;
  let lastFidelityFeedback = null;
  const hasStoryContext = !!(normalized.narrative || (normalized.facts && normalized.facts.length > 0));

  for (let attempt = 0; attempt <= QUALITY_RETRY_MAX; attempt++) {
    try {
      // COR-5: Use fidelity feedback when available
      const revisionNote = lastFidelityFeedback
        ? `STORY FIDELITY: The lyrics don't tell the full story. ${lastFidelityFeedback}. Rewrite to narrate the events in sequence, not just mention keywords.`
        : (attempt > 0
          ? "The first draft was too generic. Use more concrete details from the story, add vivid imagery, avoid clichés, and make the anchor line singular and unforgettable."
          : "");

      const llmResult = await generateLyricsWithLLM(normalized, { revisionNote });
      const validated = validateAndRepairLyrics(llmResult.lyrics, normalized.recipient_name, normalized.style);
      const lyrics = validated.lyrics || llmResult.lyrics;
      const qualityScore = assessQuality(lyrics, normalized);
      lastQuality = qualityScore;

      if (qualityScore >= QUALITY_MIN_SCORE) {
        // Track best quality-passing lyrics
        const candidateResult = {
          lyrics,
          lyrics_status: "generated",
          provider: llmResult.provider,
          model: llmResult.model,
          usage: llmResult.usage,
          validation_issues: validated.issues.length > 0 ? validated.issues : undefined,
        };
        if (!bestLyrics || qualityScore > bestQuality) {
          bestLyrics = candidateResult;
          bestQuality = qualityScore;
        }

        // Run fidelity judge if story context exists
        if (hasStoryContext) {
          try {
            const fidelity = await assessNarrativeFidelity(lyrics, normalized);
            if (Number.isFinite(fidelity.total) && fidelity.total >= FIDELITY_MIN_SCORE) {
              return candidateResult; // PASS both gates
            }
            // Fidelity failed — store feedback for retry
            lastFidelityFeedback = typeof fidelity.feedback === "string" ? fidelity.feedback : null;
          } catch (judgeErr) {
            console.warn("[Songwriter] Fidelity judge failed, accepting quality-passing lyrics:", judgeErr.message);
            return candidateResult; // Graceful degradation — don't block on judge errors
          }

          // COR-1 fix: Last attempt — accept quality-passing lyrics even if fidelity failed
          if (attempt >= QUALITY_RETRY_MAX) {
            console.warn(`[Songwriter] Fidelity below threshold on final attempt (score: ${lastQuality}), accepting`);
            return { ...candidateResult, fidelity_passed: false };
          }
          continue; // retry with fidelity feedback
        }

        // No story context — skip judge, return immediately
        return candidateResult;
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
    ? storyContext.facts.map(f => (typeof f === "string" ? f : f?.text || "")).join(" ")
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
  if (storyConnectionRate > 0.5) score += 10;
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
  const verseSections = sections.filter(s => (s.name || "").toLowerCase().includes("verse"));
  for (const verse of verseSections) {
    const verseText = (verse.lines || []).join(" ").toLowerCase();
    const hasSensory = verseText.split(/\W+/).some(word => sensorySet.has(word));
    if (!hasSensory) score -= 8;
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
  const narrativeText = (storyContext.narrative || storyContext.summary_text || "").slice(0, 2000);
  const factTexts = (storyContext.facts || [])
    .slice(0, 8)
    .map(f => typeof f === "string" ? f : f.text)
    .filter(Boolean);
  const lyricsText = (lyrics.sections || [])
    .flatMap(s => s.lines || [])
    .join("\n");

  const storyBlock = [
    narrativeText,
    factTexts.length ? `\nKey facts:\n${factTexts.map(f => `- ${f}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");

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

Return ONLY valid JSON:
{"scores":{"coverage":N,"flow":N,"specificity":N,"emotional_truth":N},"total":N,"missed_facts":["fact not in lyrics"],"feedback":"one sentence: what to fix"}`;

  const result = await generateText({
    prompt,
    taskType: "fidelity_judge",
    temperature: 0.1,
    responseMimeType: "application/json",
  });

  const rawText = (result.text || "").trim();
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in fidelity judge response");

  const parsed = JSON.parse(jsonMatch[0]);

  // Validate (REL-03): reject malformed but parseable responses
  if (!Number.isFinite(parsed.total)) {
    throw new Error(`Invalid fidelity total: ${parsed.total}`);
  }

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
