/**
 * Lyrics generation with LLM integration and singability validation
 *
 * Enhanced with story extraction for emotionally resonant, personalized songs.
 * Uses professional songwriter techniques: emotional excavation, sensory details,
 * and narrative arc construction.
 */

const { generateLyricsWithLLM, isAvailable } = require("../services/llm-provider");
const { sanitizeForPrompt } = require("../services/content-filter");

const MAX_SYLLABLES_PER_LINE = 15;
const MIN_SYLLABLES_PER_LINE = 3;
const TARGET_DURATION_SECONDS = { min: 45, max: 60 }; // MVP target

/**
 * Supported music styles - expanded with African and South American genres
 */
const MUSIC_STYLES = {
  // Original styles
  pop: "Pop",
  acoustic: "Acoustic",
  soul: "Soul",
  folk: "Folk",
  jazz: "Jazz",
  rnb: "R&B",
  rock: "Rock",
  country: "Country",

  // African styles
  afrobeats: "Afrobeats",
  highlife: "Highlife",
  ogene: "Ogene",
  juju: "Jùjú",
  fuji: "Fuji",
  afropop: "Afropop",

  // South American styles
  reggaeton: "Reggaeton",
  salsa: "Salsa",
  bossa_nova: "Bossa Nova",
  cumbia: "Cumbia",
  bachata: "Bachata",
  samba: "Samba",
  latin_pop: "Latin Pop",
};

/**
 * Relationship type descriptors for richer context
 */
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
 * Smart fallback template that actually uses the context provided.
 * Used when ANTHROPIC_API_KEY is not available.
 */
function buildLyrics({
  title,
  recipient_name,
  message,
  style,
  occasion,
  relationship_type,
  years_known,
  specific_memory,
  special_phrases,
  what_makes_them_special,
}) {
  const name = recipient_name || "";
  const hasName = Boolean(recipient_name);

  // Build anchor line that feels personal
  const anchorTemplates = {
    birthday: hasName ? `Happy birthday ${name}, you shine so bright` : "Happy birthday, you shine so bright",
    anniversary: hasName ? `${name}, my heart is yours tonight` : "My heart is yours tonight",
    graduation: hasName ? `${name}, look how far you've come` : "Look how far you've come",
    thank_you: hasName ? `${name}, thank you for all you've done` : "Thank you for all you've done",
    celebration: hasName ? `${name}, this moment is for you` : "This moment is for you",
  };
  const defaultAnchor = hasName ? `${name}, this one's for you` : "This one's for you";
  const anchor = anchorTemplates[occasion] || defaultAnchor;

  // Build chorus with actual message context - aim for 4 lines for richness
  const chorusLines = [anchor];
  if (message) {
    // Transform message into a singable line (keep it short)
    const words = message.split(" ").slice(0, 8);
    chorusLines.push(words.join(" "));
  } else {
    chorusLines.push("You mean the world to me");
  }
  // Add what makes them special as emotional climax line
  if (what_makes_them_special) {
    const specialWords = what_makes_them_special.split(" ").slice(0, 8).join(" ");
    chorusLines.push(specialWords);
  }
  chorusLines.push(anchor);

  // Build verse with relationship/memory context
  const verse1Lines = [];
  const verse2Lines = [];

  // Verse 1: About the relationship
  if (years_known) {
    verse1Lines.push(`${years_known} years together, still feels brand new`);
  } else {
    verse1Lines.push("From the moment we met, I knew");
  }

  if (relationship_type) {
    const relationshipLines = {
      spouse: "You're my partner, my best friend, my soul",
      partner: "Side by side, together we are whole",
      parent: "You raised me up with love so true",
      child: "Watching you grow fills my heart anew",
      sibling: "Through thick and thin, we've been a team",
      friend: "A friend like you is like a dream",
      colleague: "Working with you, we've built so much",
      mentor: "You guided me with your gentle touch",
      grandparent: "Your wisdom and love lights the way",
    };
    verse1Lines.push(relationshipLines[relationship_type] || "You've always been there, come what may");
  } else {
    verse1Lines.push("Everything you do, everything you say");
  }

  // Verse 2: Memory or special details
  if (specific_memory) {
    // Clean up memory text - strip common prefixes to avoid "I remember when When..."
    let cleanMemory = specific_memory.trim();
    const prefixesToStrip = [/^when\s+/i, /^i remember\s+/i, /^remember\s+/i, /^that time\s+/i];
    for (const prefix of prefixesToStrip) {
      cleanMemory = cleanMemory.replace(prefix, "");
    }
    // Cap at 6 words for singability (plus "I remember" = ~8 total)
    const memoryWords = cleanMemory.split(" ").slice(0, 6).join(" ");
    verse2Lines.push(`I remember ${memoryWords}`);
  } else {
    verse2Lines.push("All the memories we've made together");
  }

  if (special_phrases) {
    // Make the special phrase line feel more natural
    verse2Lines.push(`You'll always be ${special_phrases} to me`);
  } else {
    verse2Lines.push("These moments last forever and a day");
  }

  return {
    title: title || (hasName ? `Song for ${name}` : "A Song for You"),
    style: style || "pop",
    sections: [
      { name: "chorus", lines: chorusLines },
      { name: "verse1", lines: verse1Lines },
      { name: "verse2", lines: verse2Lines },
    ],
    anchor_line: anchor,
  };
}

function countSyllables(text) {
  if (!text) return 0;
  const word = text.toLowerCase().replace(/[^a-z]/g, "");
  if (word.length <= 3) return 1;
  
  let count = 0;
  const vowels = "aeiouy";
  let prevVowel = false;
  
  for (let i = 0; i < word.length; i++) {
    const isVowel = vowels.includes(word[i]);
    if (isVowel && !prevVowel) count++;
    prevVowel = isVowel;
  }
  
  if (word.endsWith("e") && count > 1) count--;
  if (word.endsWith("le") && word.length > 2 && !vowels.includes(word[word.length - 3])) count++;
  
  return Math.max(1, count);
}

function countLineSyllables(line) {
  if (!line) return 0;
  return line.split(/\s+/).reduce((sum, word) => sum + countSyllables(word), 0);
}

function validateSingability(lyrics) {
  const issues = [];
  
  if (!lyrics || !lyrics.sections || lyrics.sections.length === 0) {
    issues.push("No sections found in lyrics");
    return { valid: false, issues };
  }
  
  for (const section of lyrics.sections) {
    if (!section.lines || section.lines.length === 0) {
      issues.push("Section '" + section.name + "' has no lines");
      continue;
    }
    
    for (let i = 0; i < section.lines.length; i++) {
      const line = section.lines[i];
      const syllables = countLineSyllables(line);
      
      if (syllables > MAX_SYLLABLES_PER_LINE) {
        issues.push("Line " + (i + 1) + " in " + section.name + " has " + syllables + " syllables (max " + MAX_SYLLABLES_PER_LINE + ")");
      }
      if (syllables < MIN_SYLLABLES_PER_LINE && line.trim().length > 0) {
        issues.push("Line " + (i + 1) + " in " + section.name + " has only " + syllables + " syllables (min " + MIN_SYLLABLES_PER_LINE + ")");
      }
    }
  }
  
  return { valid: issues.length === 0, issues };
}

function anchorMessage(lyrics, message) {
  if (!lyrics || !message) return lyrics;

  const messageLower = message.toLowerCase();
  const allLines = lyrics.sections.flatMap(s => s.lines);
  const hasMessage = allLines.some(line =>
    line.toLowerCase().includes(messageLower) ||
    messageLower.split(" ").some(word => word.length > 3 && line.toLowerCase().includes(word))
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
 * Check if recipient name appears in lyrics (anchor enforcement)
 * @param {Object} lyrics - Lyrics object with sections
 * @param {string} recipientName - Expected recipient name
 * @returns {{ hasAnchor: boolean, locations: string[] }} - Whether name is present and where
 */
function validateRecipientAnchor(lyrics, recipientName) {
  if (!recipientName || !lyrics) {
    return { hasAnchor: true, locations: [] }; // No anchor needed if no name
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

  // Also check anchor_line
  if (lyrics.anchor_line && lyrics.anchor_line.toLowerCase().includes(nameLower)) {
    if (!locations.includes("anchor_line")) {
      locations.push("anchor_line");
    }
  }

  return { hasAnchor: locations.length > 0, locations };
}

/**
 * Auto-repair lyrics to ensure recipient name appears in chorus
 * @param {Object} lyrics - Lyrics object
 * @param {string} recipientName - Recipient name to inject
 * @returns {Object} - Repaired lyrics with anchor guaranteed
 */
function repairRecipientAnchor(lyrics, recipientName) {
  if (!recipientName || !lyrics) return lyrics;

  const validation = validateRecipientAnchor(lyrics, recipientName);
  if (validation.hasAnchor) return lyrics; // Already has anchor

  const result = JSON.parse(JSON.stringify(lyrics));

  // Find chorus and inject name into first line
  for (const section of result.sections) {
    if (section.name === "chorus" && section.lines && section.lines.length > 0) {
      // Prepend name to first chorus line
      const firstLine = section.lines[0];
      // Avoid double name if it's already there (case-insensitive check)
      if (!firstLine.toLowerCase().includes(recipientName.toLowerCase())) {
        section.lines[0] = `${recipientName}, ${firstLine.charAt(0).toLowerCase()}${firstLine.slice(1)}`;
      }
      // Update anchor_line too
      result.anchor_line = section.lines[0];
      break;
    }
  }

  return result;
}

/**
 * Full lyrics validation with all checks
 * @param {Object} lyrics - Generated lyrics
 * @param {string} recipientName - Expected recipient name
 * @param {string} style - Expected style
 * @returns {{ valid: boolean, lyrics: Object, issues: string[] }}
 */
function validateAndRepairLyrics(lyrics, recipientName, style) {
  const issues = [];
  let result = lyrics;

  if (!lyrics || !lyrics.sections) {
    return { valid: false, lyrics: null, issues: ["Invalid lyrics structure"] };
  }

  // Check singability
  const singability = validateSingability(lyrics);
  if (!singability.valid) {
    issues.push(...singability.issues);
  }

  // Check style
  const styleCheck = validateStyle(style);
  if (!styleCheck.valid) {
    issues.push(`Unknown style "${style}", using "${styleCheck.normalized}"`);
  }

  // Check and repair recipient anchor
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

/**
 * Build a professional songwriter prompt that extracts emotional narrative
 * from the provided context. Uses "emotional excavation" technique.
 *
 * @param {Object} context - Story context for the song
 * @param {string} context.recipient_name - Who the song is for (required)
 * @param {string} context.message - Core message to convey
 * @param {string} context.occasion - The occasion (birthday, anniversary, etc.)
 * @param {string} context.style - Music style
 * @param {string} [context.relationship_type] - Type of relationship
 * @param {string} [context.specific_memory] - A specific memory or moment
 * @param {number} [context.years_known] - How long they've known each other
 * @param {string} [context.special_phrases] - Inside jokes, nicknames, catchphrases
 * @param {string} [context.what_makes_them_special] - Core emotional anchor
 * @param {Array} [context.memory_answers] - AI-generated follow-up Q&A pairs about the memory
 * @returns {string} The prompt for the LLM
 */
function buildSongwriterPrompt(context) {
  const {
    recipient_name,
    message,
    occasion,
    style,
    relationship_type,
    specific_memory,
    years_known,
    special_phrases,
    what_makes_them_special,
    memory_answers,
  } = context;

  // Get style display name
  const styleName = MUSIC_STYLES[style] || style || "Pop";

  // Get relationship descriptor
  const relationshipDesc = relationship_type
    ? RELATIONSHIP_DESCRIPTORS[relationship_type] || relationship_type
    : null;

  // Build context sections
  const contextSections = [];

  // Core info (always included)
  contextSections.push(`RECIPIENT: ${recipient_name}`);
  contextSections.push(`OCCASION: ${occasion || "celebration"}`);
  contextSections.push(`MUSIC STYLE: ${styleName}`);

  if (message) {
    contextSections.push(`CORE MESSAGE: "${message}"`);
  }

  // Enhanced context (when provided)
  if (relationshipDesc) {
    contextSections.push(`RELATIONSHIP: ${recipient_name} is their ${relationshipDesc}`);
  }

  if (years_known) {
    contextSections.push(`HISTORY: They have known each other for ${years_known} years`);
  }

  if (specific_memory) {
    contextSections.push(`SPECIFIC MEMORY: "${specific_memory}"`);
  }

  if (special_phrases) {
    contextSections.push(`SPECIAL PHRASES/NICKNAMES: "${special_phrases}"`);
  }

  if (what_makes_them_special) {
    contextSections.push(`WHAT MAKES THEM SPECIAL: "${what_makes_them_special}"`);
  }

  // Memory answers from AI follow-up questions (the emotional essence)
  if (Array.isArray(memory_answers) && memory_answers.length > 0) {
    const answersText = memory_answers
      .filter(a => a && a.question && a.answer)
      .map(a => `- ${a.question}: "${a.answer}"`)
      .join("\n");
    if (answersText) {
      contextSections.push(`DEEPER STORY DETAILS:\n${answersText}`);
    }
  }

  // Build the prompt
  const prompt = `You are a professional songwriter known for writing deeply personal, emotionally resonant songs.

## SONG BRIEF
${contextSections.join("\n")}

## YOUR TASK
Write lyrics for a personalized ${styleName} song. Think like a songwriter:

1. **EMOTIONAL EXCAVATION**: Find the specific moment or feeling that makes this relationship unique. Don't write generic "you're amazing" lyrics—dig deeper into WHY they're amazing.

2. **SENSORY DETAILS**: If a memory was provided, weave in sensory details (what they saw, heard, felt) to make the song vivid and real.

3. **THE ANCHOR LINE**: Create one powerful line that captures the essence of the message. This line should appear in the chorus and be the emotional climax.

4. **NATURAL FLOW**: Each line should be 6-12 syllables for singability. The words should flow naturally when sung in ${styleName} style.

5. **PERSONAL TOUCHES**: ${special_phrases ? `Weave in these special phrases naturally: "${special_phrases}"` : "If nicknames or special phrases were provided, incorporate them naturally."}

## STRUCTURE
Create:
- 1 CHORUS (4-6 lines) - The emotional heart, featuring the anchor line and recipient's name
- 2 VERSES (4-6 lines each) - Story and details that build to the chorus
${specific_memory ? "- Reference the specific memory in at least one verse" : ""}

## OUTPUT FORMAT
Return ONLY valid JSON:
{
  "title": "Song title",
  "style": "${style || "pop"}",
  "sections": [
    {"name": "chorus", "lines": ["line1", "line2", ...]},
    {"name": "verse1", "lines": ["line1", "line2", ...]},
    {"name": "verse2", "lines": ["line1", "line2", ...]}
  ],
  "anchor_line": "The most powerful line from the chorus"
}

Remember: This song will be sung TO ${recipient_name}. Make them feel truly seen and loved.`;

  return prompt;
}

async function generateLyrics({ title, recipient_name, message, style, occasion, relationship_type, specific_memory, years_known, special_phrases, what_makes_them_special, memory_answers }) {
  // Sanitize all inputs before processing
  const sanitized = {
    title: sanitizeInput(title),
    recipient_name: sanitizeInput(recipient_name),
    message: sanitizeInput(message),
    style: sanitizeInput(style),
    occasion: sanitizeInput(occasion),
    relationship_type: sanitizeInput(relationship_type),
    specific_memory: sanitizeInput(specific_memory),
    years_known: years_known, // Number, no sanitization needed
    special_phrases: sanitizeInput(special_phrases),
    what_makes_them_special: sanitizeInput(what_makes_them_special),
    // Sanitize memory answers array
    memory_answers: Array.isArray(memory_answers)
      ? memory_answers.map(a => ({
          question_id: sanitizeInput(a?.question_id),
          question: sanitizeInput(a?.question),
          answer: sanitizeInput(a?.answer),
        })).filter(a => a.question && a.answer)
      : [],
  };

  // Validate and normalize style
  const styleCheck = validateStyle(sanitized.style);
  sanitized.style = styleCheck.normalized;

  // Check if LLM provider is available (Anthropic or OpenAI)
  if (!isAvailable()) {
    const rawLyrics = buildLyrics(sanitized);
    // Validate and repair anchor even for fallback lyrics
    const validated = validateAndRepairLyrics(rawLyrics, sanitized.recipient_name, sanitized.style);
    return {
      lyrics: validated.lyrics || rawLyrics,
      lyrics_status: "fallback",
      fallback_reason: "no_llm_provider",
      validation_issues: validated.issues,
    };
  }

  // Apply injection-resistant sanitization to story context fields before LLM
  // These fields are user-provided and could contain prompt injection attempts
  const safeContext = {
    specific_memory: sanitizeForPrompt(sanitized.specific_memory),
    special_phrases: sanitizeForPrompt(sanitized.special_phrases),
    what_makes_them_special: sanitizeForPrompt(sanitized.what_makes_them_special),
    message: sanitizeForPrompt(sanitized.message),
    // Sanitize memory answer content (questions and answers are user-provided)
    memory_answers: sanitized.memory_answers.map(a => ({
      question_id: a.question_id,
      question: sanitizeForPrompt(a.question),
      answer: sanitizeForPrompt(a.answer),
    })),
  };

  // Use enhanced prompt builder with sanitized story context
  const prompt = buildSongwriterPrompt({
    recipient_name: sanitized.recipient_name || "someone special",
    message: safeContext.message || "You are amazing",
    occasion: sanitized.occasion || "celebration",
    style: sanitized.style,
    relationship_type: sanitized.relationship_type,
    specific_memory: safeContext.specific_memory,
    years_known: sanitized.years_known,
    special_phrases: safeContext.special_phrases,
    what_makes_them_special: safeContext.what_makes_them_special,
    memory_answers: safeContext.memory_answers,
  });

  try {
    // Use unified LLM provider with Anthropic primary + OpenAI fallback
    const llmResult = await generateLyricsWithLLM({
      songwriterPrompt: prompt,
      style: sanitized.style,
    });

    // Parse JSON from LLM response
    const content = llmResult.text || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("E201_LYRICS_ERROR: No JSON found in response");
    }

    const rawLyrics = JSON.parse(jsonMatch[0]);

    if (!rawLyrics.sections || !Array.isArray(rawLyrics.sections)) {
      throw new Error("E201_LYRICS_ERROR: Invalid lyrics structure");
    }

    // Validate and repair the generated lyrics
    const validated = validateAndRepairLyrics(rawLyrics, sanitized.recipient_name, sanitized.style);

    return {
      lyrics: validated.lyrics || rawLyrics,
      lyrics_status: "generated",
      provider: llmResult.provider,
      model: llmResult.model,
      usage: llmResult.usage,
      validation_issues: validated.issues.length > 0 ? validated.issues : undefined,
    };
  } catch (err) {
    // Fallback to template on any error
    console.warn("[Lyrics] LLM generation failed, using fallback:", err.message);
    const rawLyrics = buildLyrics(sanitized);
    const validated = validateAndRepairLyrics(rawLyrics, sanitized.recipient_name, sanitized.style);
    return {
      lyrics: validated.lyrics || rawLyrics,
      lyrics_status: "fallback",
      fallback_reason: err.message,
      validation_issues: validated.issues,
    };
  }
}

module.exports = {
  // Constants
  MUSIC_STYLES,
  RELATIONSHIP_DESCRIPTORS,
  TARGET_DURATION_SECONDS,
  // Functions
  buildLyrics,
  buildSongwriterPrompt,
  countSyllables,
  countLineSyllables,
  validateSingability,
  anchorMessage,
  generateLyrics,
  // New validation functions
  sanitizeInput,
  validateStyle,
  validateRecipientAnchor,
  repairRecipientAnchor,
  validateAndRepairLyrics,
};
