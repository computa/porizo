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
const { getStoryContextV2 } = require("./v2");

// Syllable constraints for singability
const MAX_SYLLABLES_PER_LINE = 15;

// Music styles (imported from original lyrics.js)
const MUSIC_STYLES = {
  pop: "Pop", acoustic: "Acoustic", soul: "Soul", folk: "Folk",
  jazz: "Jazz", rnb: "R&B", rock: "Rock", country: "Country",
  afrobeats: "Afrobeats", highlife: "Highlife", ogene: "Ogene",
  juju: "Jùjú", fuji: "Fuji", afropop: "Afropop",
  reggaeton: "Reggaeton", salsa: "Salsa", bossa_nova: "Bossa Nova",
  cumbia: "Cumbia", bachata: "Bachata", samba: "Samba", latin_pop: "Latin Pop",
};

/**
 * The songwriter persona - defines the voice and approach
 */
const SONGWRITER_PERSONA = `You are a storyteller who writes songs. Not a poet. Not a greeting card writer.

YOUR CRAFT:
- Every song is a STORY with a beginning, middle, and end
- You paint PICTURES with words - what did they see, hear, smell, feel?
- You find the ONE MOMENT that captures everything
- You write like you're telling a friend about something that moved you

YOUR RULES:
- NEVER use generic phrases like "you mean the world to me", "you're amazing", "you're the best"
- ALWAYS include at least one specific sensory detail per verse
- The CHORUS is the emotional truth - what the story MEANS
- Each VERSE moves the story forward - no filler, no repetition
- The recipient should hear this and think "they remembered THAT about me?"

YOUR VOICE:
- Conversational, not formal
- Specific, not abstract
- Nostalgic but not cheesy
- Every line should feel inevitable, not forced`;

/**
 * Write a song from a confirmed story
 *
 * @param {string} story_id - The confirmed story session ID
 * @returns {Promise<Object>} { lyrics, quality_score, arc_used }
 */
async function writeSong(story_id) {
  // Get the full story context from V2 engine
  const storyContext = await getStoryContextV2(story_id);

  if (storyContext.state !== "confirmed") {
    throw new Error("Story must be confirmed before generating lyrics");
  }

  // Use occasion as arc (V2 unified approach)
  const arc = storyContext.occasion || "unified";

  // Build the song
  if (isAvailable()) {
    try {
      const lyrics = await generateLyricsWithLLM(storyContext);
      const validated = validateAndRepair(lyrics, storyContext.recipient_name);

      return {
        lyrics: validated.lyrics,
        quality_score: assessQuality(validated.lyrics, storyContext),
        arc_used: arc,
        validation_issues: validated.issues,
      };
    } catch (err) {
      console.error("[Songwriter] LLM generation failed:", err.message);
    }
  }

  // Fallback to template-based generation
  const fallbackLyrics = buildFallbackLyrics(storyContext);
  return {
    lyrics: fallbackLyrics,
    quality_score: 50, // Fallback is lower quality
    arc_used: arc,
    is_fallback: true,
  };
}

/**
 * Generate lyrics using LLM with full story context
 */
async function generateLyricsWithLLM(storyContext) {
  const recipientName = storyContext.recipient_name;
  const style = storyContext.style || "pop";
  const styleName = MUSIC_STYLES[style] || style;

  // Build the story details section
  const storyDetails = buildStoryDetails(storyContext);

  const prompt = `${SONGWRITER_PERSONA}

## THE STORY TO TELL
Recipient: ${recipientName}
Occasion: ${storyContext.occasion}
Music Style: ${styleName}

### THE STORY
${storyDetails}

### THE SOUL (most important details)
${storyContext.summary?.soul || "The specific moments that make this story unique"}

## YOUR TASK
Transform this story into a ${styleName} song that makes ${recipientName} feel truly SEEN.

### STRUCTURE
Create:
- 1 CHORUS (4-6 lines) - The emotional truth, the anchor. ${recipientName}'s name MUST appear here.
- 2-3 VERSES (4-6 lines each) - Tell the story chronologically or emotionally
- 1 BRIDGE (optional, 2-4 lines) - A moment of reflection or looking forward

### REQUIREMENTS
1. ${recipientName}'s name must appear in the chorus
2. Each verse must reference specific details from their story
3. At least one sensory detail per verse (what they saw, heard, felt)
4. Lines should be 6-12 syllables for singability in ${styleName} style
5. NO generic phrases - every line must connect to THIS story
6. The song should build emotionally (setup → tension → climax → resolution)

## OUTPUT FORMAT
Return ONLY valid JSON:
{
  "title": "Song title that captures the essence",
  "style": "${style}",
  "sections": [
    {"name": "verse1", "lines": ["line1", "line2", "line3", "line4"]},
    {"name": "chorus", "lines": ["line1 with ${recipientName}", "line2", "line3", "line4"]},
    {"name": "verse2", "lines": ["line1", "line2", "line3", "line4"]},
    {"name": "bridge", "lines": ["line1", "line2"]}
  ],
  "anchor_line": "The most powerful line from the chorus",
  "story_elements_used": ["list of story details woven into lyrics"]
}`;

  const response = await generateText({
    prompt,
    taskType: "lyrics",
    temperature: 0.8,
  });

  // Parse the response
  try {
    // Clean up potential markdown code blocks
    let text = response.text.trim();
    if (text.startsWith("```json")) {
      text = text.slice(7);
    }
    if (text.startsWith("```")) {
      text = text.slice(3);
    }
    if (text.endsWith("```")) {
      text = text.slice(0, -3);
    }

    const lyrics = JSON.parse(text.trim());
    return lyrics;
  } catch (parseErr) {
    console.error("[Songwriter] Failed to parse lyrics JSON:", parseErr.message);
    throw new Error("Failed to parse generated lyrics");
  }
}

/**
 * Build story details string for the prompt
 */
function buildStoryDetails(storyContext) {
  const parts = [];

  // Initial prompt
  if (storyContext.initial_prompt) {
    parts.push(`What they wanted to express: "${storyContext.initial_prompt}"`);
  }

  // Story summary
  if (storyContext.summary?.summary_text) {
    parts.push(`\nThe Story:\n${storyContext.summary.summary_text}`);
  }

  // Individual elements with labels
  parts.push("\nStory Elements:");
  for (const [key, value] of Object.entries(storyContext.elements || {})) {
    if (value && value.trim()) {
      const label = key.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
      parts.push(`- ${label}: ${value}`);
    }
  }

  // Conversation history (Q&A pairs)
  if (storyContext.conversation && storyContext.conversation.length > 0) {
    parts.push("\nDetails from conversation:");
    for (const qa of storyContext.conversation) {
      if (qa.answer) {
        parts.push(`- "${qa.answer}"`);
      }
    }
  }

  // Additional notes
  if (storyContext.additional_notes) {
    parts.push(`\nAdditional context: ${storyContext.additional_notes}`);
  }

  return parts.join("\n");
}

/**
 * Validate and repair lyrics
 */
function validateAndRepair(lyrics, recipientName) {
  const issues = [];

  if (!lyrics || !lyrics.sections) {
    return {
      lyrics,
      issues: ["Invalid lyrics structure"],
    };
  }

  // Ensure recipient name in chorus
  const hasNameInChorus = lyrics.sections.some(
    s => s.name === "chorus" &&
    s.lines?.some(line => line.toLowerCase().includes(recipientName.toLowerCase()))
  );

  if (!hasNameInChorus && recipientName) {
    // Repair: Add name to first chorus line
    const chorus = lyrics.sections.find(s => s.name === "chorus");
    if (chorus && chorus.lines && chorus.lines.length > 0) {
      chorus.lines[0] = `${recipientName}, ${chorus.lines[0].toLowerCase()}`;
      issues.push(`Repaired: Added ${recipientName} to chorus`);
    }
  }

  // Validate syllable counts
  for (const section of lyrics.sections) {
    if (!section.lines) continue;
    for (let i = 0; i < section.lines.length; i++) {
      const syllables = countSyllables(section.lines[i]);
      if (syllables > MAX_SYLLABLES_PER_LINE) {
        issues.push(`${section.name} line ${i + 1}: ${syllables} syllables (max ${MAX_SYLLABLES_PER_LINE})`);
      }
    }
  }

  return { lyrics, issues };
}

/**
 * Assess quality of generated lyrics
 */
function assessQuality(lyrics, storyContext) {
  let score = 100;

  // Check if recipient name is present
  const allLines = lyrics.sections?.flatMap(s => s.lines || []) || [];
  const hasRecipientName = allLines.some(
    line => line.toLowerCase().includes(storyContext.recipient_name.toLowerCase())
  );
  if (!hasRecipientName) score -= 20;

  // Check for generic phrases (deductions)
  const genericPhrases = [
    "you mean the world",
    "you're amazing",
    "you're the best",
    "i love you so much",
    "you're so special",
  ];
  for (const phrase of genericPhrases) {
    if (allLines.some(line => line.toLowerCase().includes(phrase))) {
      score -= 10;
    }
  }

  // Check for story element usage
  const storyContent = Object.values(storyContext.elements || {}).join(" ").toLowerCase();
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

  if (storyConnectionRate < 0.3) score -= 15; // Weak story connection
  if (storyConnectionRate > 0.5) score += 10; // Strong story connection

  return Math.max(0, Math.min(100, score));
}

/**
 * Build fallback lyrics without LLM
 */
function buildFallbackLyrics(storyContext) {
  const name = storyContext.recipient_name;
  const elements = storyContext.elements || {};

  // Extract key details
  const setting = elements.setting || elements.context || "";
  const impression = elements.first_impression || elements.their_action || elements.defining_memory || "";
  const emotional = elements.emotional_moment || elements.impact || elements.their_impact || "";
  const special = elements.what_makes_them_special || elements.who_they_are || elements.character_trait || "";

  // Build sections
  const sections = [];

  // Verse 1 - Setup/Context
  sections.push({
    name: "verse1",
    lines: [
      setting ? setting.split(" ").slice(0, 8).join(" ") : "From the very start",
      impression ? impression.split(" ").slice(0, 8).join(" ") : "Something caught my eye",
      "I knew right then and there",
      "This moment would define",
    ],
  });

  // Chorus - Emotional truth with name
  sections.push({
    name: "chorus",
    lines: [
      `${name}, ${emotional ? emotional.split(" ").slice(0, 6).join(" ") : "you changed everything"}`,
      special ? special.split(" ").slice(0, 8).join(" ") : "You're like no one else",
      storyContext.initial_prompt?.split(" ").slice(0, 8).join(" ") || "This is your story",
      `${name}, this song's for you`,
    ],
  });

  // Verse 2 - More details
  sections.push({
    name: "verse2",
    lines: [
      "Looking back now I can see",
      "Every moment led to this",
      emotional ? `When ${emotional.split(" ").slice(0, 6).join(" ")}` : "When our paths aligned",
      "Nothing was the same",
    ],
  });

  return {
    title: `For ${name}`,
    style: storyContext.style || "pop",
    sections,
    anchor_line: sections[1].lines[0],
  };
}

/**
 * Count syllables in a line (approximate)
 */
function countSyllables(text) {
  if (!text) return 0;

  const word = text.toLowerCase().replace(/[^a-z]/g, " ");
  const words = word.split(/\s+/).filter(Boolean);

  let total = 0;
  for (const w of words) {
    // Simple syllable counting heuristic
    let count = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
      .replace(/^y/, "")
      .match(/[aeiouy]{1,2}/g);
    total += count ? count.length : 1;
  }

  return total;
}

/**
 * Generate lyrics directly from story context (without story_id)
 * For backwards compatibility or direct generation
 */
async function writeSongFromContext(context) {
  // Build a minimal story context
  const storyContext = {
    recipient_name: context.recipient_name,
    occasion: context.occasion,
    style: context.style,
    initial_prompt: context.message || context.initial_prompt,
    elements: context.elements || {},
    summary: context.summary || { soul: context.message },
    state: "confirmed",
  };

  if (isAvailable()) {
    try {
      const lyrics = await generateLyricsWithLLM(storyContext);
      const validated = validateAndRepair(lyrics, storyContext.recipient_name);
      return {
        lyrics: validated.lyrics,
        quality_score: assessQuality(validated.lyrics, storyContext),
      };
    } catch (err) {
      console.error("[Songwriter] Direct generation failed:", err.message);
    }
  }

  return {
    lyrics: buildFallbackLyrics(storyContext),
    quality_score: 50,
    is_fallback: true,
  };
}

module.exports = {
  writeSong,
  writeSongFromContext,
  MUSIC_STYLES,
  SONGWRITER_PERSONA,
};
