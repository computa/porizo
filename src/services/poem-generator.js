/**
 * Poem Generator Service
 *
 * Generates personalized poems using LLM.
 * Supports multiple tones (heartfelt, funny, inspirational) and occasions.
 * Requires LLM availability - no fallback templates for quality consistency.
 */

const { generateText, isAvailable } = require("./llm-provider");

/**
 * Supported poem tones
 */
const POEM_TONES = {
  heartfelt: "Heartfelt",
  funny: "Funny",
  inspirational: "Inspirational",
  romantic: "Romantic",
  nostalgic: "Nostalgic",
  grateful: "Grateful",
};

/**
 * Supported occasions
 */
const OCCASIONS = {
  birthday: "Birthday",
  anniversary: "Anniversary",
  thank_you: "Thank You",
  graduation: "Graduation",
  wedding: "Wedding",
  celebration: "Celebration",
  get_well: "Get Well",
  sympathy: "Sympathy",
  retirement: "Retirement",
  new_baby: "New Baby",
};

/**
 * Tone-specific vocabulary and style guidance
 */
const TONE_STYLES = {
  heartfelt: {
    vocabulary: ["cherish", "treasure", "heart", "soul", "forever", "precious", "love", "warmth"],
    style: "sincere and emotionally deep",
    imagery: "warm, gentle, intimate moments",
  },
  funny: {
    vocabulary: ["laugh", "smile", "crazy", "silly", "adventure", "trouble", "fun", "chaos"],
    style: "lighthearted with clever wordplay",
    imagery: "humorous situations and playful exaggeration",
  },
  inspirational: {
    vocabulary: ["dream", "soar", "achieve", "strength", "courage", "believe", "rise", "shine"],
    style: "uplifting and empowering",
    imagery: "mountains, sunrise, flight, growth",
  },
  romantic: {
    vocabulary: ["love", "heart", "forever", "embrace", "passion", "destiny", "together", "adore"],
    style: "tender and passionate",
    imagery: "moonlight, roses, starlight, gentle touch",
  },
  nostalgic: {
    vocabulary: ["remember", "once", "years", "memories", "together", "through", "journey", "time"],
    style: "reflective and warm",
    imagery: "seasons changing, photographs, familiar places",
  },
  grateful: {
    vocabulary: ["thank", "blessed", "gift", "grateful", "appreciate", "kindness", "care", "support"],
    style: "appreciative and humble",
    imagery: "open hands, warm embrace, helping hand",
  },
};

/**
 * Occasion-specific themes
 */
const OCCASION_THEMES = {
  birthday: {
    themes: ["celebration of life", "another year of growth", "wishes for the future"],
    openings: [
      "On this special day",
      "Another year has come",
      "Today we celebrate",
    ],
  },
  anniversary: {
    themes: ["enduring love", "shared journey", "growing together"],
    openings: [
      "Through all the years",
      "From that first moment",
      "Year after year",
    ],
  },
  thank_you: {
    themes: ["gratitude", "impact on life", "recognition"],
    openings: [
      "For all you've done",
      "Words cannot express",
      "In this moment",
    ],
  },
  graduation: {
    themes: ["achievement", "new beginnings", "proud moments"],
    openings: [
      "You've reached this day",
      "The world awaits",
      "From here you soar",
    ],
  },
  wedding: {
    themes: ["eternal love", "two becoming one", "new journey"],
    openings: [
      "On this blessed day",
      "Two hearts unite",
      "Love brings you here",
    ],
  },
  celebration: {
    themes: ["joy", "achievement", "special moments"],
    openings: [
      "Today we gather",
      "This moment shines",
      "Celebration fills",
    ],
  },
  get_well: {
    themes: ["strength", "healing", "support"],
    openings: [
      "In times like these",
      "May healing come",
      "With gentle care",
    ],
  },
  sympathy: {
    themes: ["comfort", "memory", "peace"],
    openings: [
      "In quiet moments",
      "Though hearts are heavy",
      "May peace find you",
    ],
  },
  retirement: {
    themes: ["accomplishment", "new chapter", "well-deserved rest"],
    openings: [
      "The journey shifts",
      "New chapters wait",
      "A lifetime's work",
    ],
  },
  new_baby: {
    themes: ["new life", "wonder", "joy"],
    openings: [
      "A precious gift",
      "New life has come",
      "Tiny fingers",
    ],
  },
};

/**
 * Generate poem using LLM
 * @param {Object} options - Generation options
 * @param {string} options.recipient_name - Name of the poem recipient
 * @param {string} options.occasion - Occasion for the poem
 * @param {string} options.tone - Tone of the poem
 * @param {string} options.message - Optional personal message to incorporate
 * @returns {Promise<Object>} Generated poem with verses
 * @throws {Error} AI_UNAVAILABLE if LLM service is not available
 * @throws {Error} POEM_GENERATION_FAILED if LLM fails to generate
 */
async function generatePoem({ recipient_name, occasion, tone = "heartfelt", message }) {
  // Validate required fields
  if (!occasion) {
    throw new Error("occasion is required");
  }

  // Require LLM availability - no fallback for quality consistency
  if (!isAvailable()) {
    const error = new Error("AI_UNAVAILABLE");
    error.code = "AI_UNAVAILABLE";
    throw error;
  }

  try {
    const result = await generatePoemWithLLM({ recipient_name, occasion, tone, message });
    return result;
  } catch (err) {
    console.error("[Poem Generator] LLM generation failed:", err.message);
    const error = new Error("POEM_GENERATION_FAILED");
    error.code = "POEM_GENERATION_FAILED";
    error.cause = err;
    throw error;
  }
}

/**
 * Generate poem using LLM
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} Generated poem
 */
async function generatePoemWithLLM({ recipient_name, occasion, tone, message }) {
  const toneStyle = TONE_STYLES[tone] || TONE_STYLES.heartfelt;

  const systemPrompt = `You are a skilled poet who writes beautiful, personalized poems.

TONE: ${toneStyle.style}
OCCASION: ${OCCASIONS[occasion] || occasion}
VOCABULARY TO USE: ${toneStyle.vocabulary.join(", ")}
IMAGERY STYLE: ${toneStyle.imagery}

RULES:
1. Each verse should have 4-6 lines
2. Lines should be 6-12 syllables for natural rhythm
3. Include the recipient's name naturally (if provided)
4. Incorporate the personal message theme (if provided)
5. Use concrete imagery and sensory details
6. Match the tone consistently throughout
7. Create 2-4 verses

OUTPUT FORMAT:
Return the poem in this exact JSON format:
{
  "verses": [
    { "name": "verse1", "lines": ["line1", "line2", "line3", "line4"] },
    { "name": "verse2", "lines": ["line1", "line2", "line3", "line4"] }
  ],
  "title": "Optional poem title"
}

Only output valid JSON, no markdown code blocks or explanations.`;

  const prompt = `Write a ${tone} poem for ${recipient_name || "someone special"} for their ${occasion}.
${message ? `Personal context to incorporate: "${message}"` : ""}

Generate 2-3 heartfelt verses.`;

  const response = await generateText({
    prompt,
    systemPrompt,
    taskType: "lyrics", // Use the creative model
    temperature: 0.8,
  });

  // Parse the response
  try {
    const parsed = JSON.parse(response.text);
    return {
      verses: parsed.verses || [],
      title: parsed.title || null,
    };
  } catch (err) {
    console.error("[Poem Generator] Failed to parse LLM response:", err.message);
    throw new Error("Failed to parse poem response");
  }
}

module.exports = {
  generatePoem,
  generatePoemWithLLM,
  POEM_TONES,
  OCCASIONS,
  TONE_STYLES,
  OCCASION_THEMES,
};
