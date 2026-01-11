/**
 * Poem Generator Service
 *
 * Generates personalized poems using LLM or fallback templates.
 * Supports multiple tones (heartfelt, funny, inspirational) and occasions.
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
 * Generate poem using LLM or fallback
 * @param {Object} options - Generation options
 * @param {string} options.recipient_name - Name of the poem recipient
 * @param {string} options.occasion - Occasion for the poem
 * @param {string} options.tone - Tone of the poem
 * @param {string} options.message - Optional personal message to incorporate
 * @returns {Promise<Object>} Generated poem with verses
 */
async function generatePoem({ recipient_name, occasion, tone = "heartfelt", message }) {
  // Validate required fields
  if (!occasion) {
    throw new Error("occasion is required");
  }

  // If LLM is available, try to use it
  if (isAvailable()) {
    try {
      const result = await generatePoemWithLLM({ recipient_name, occasion, tone, message });
      return { ...result, usedFallback: false };
    } catch (err) {
      console.error("[Poem Generator] LLM failed, using fallback:", err.message);
    }
  }

  // Use fallback template
  const result = buildPoemFallback({ recipient_name, occasion, tone, message });
  return { ...result, usedFallback: true };
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
    // Fall through to fallback
    throw new Error("Failed to parse poem response");
  }
}

/**
 * Build poem using fallback templates (no LLM)
 * @param {Object} options - Generation options
 * @returns {Object} Generated poem
 */
function buildPoemFallback({ recipient_name, occasion, tone = "heartfelt", message }) {
  const name = recipient_name || "you";
  const occasionTheme = OCCASION_THEMES[occasion] || OCCASION_THEMES.celebration;

  // Select opening based on occasion
  const opening = occasionTheme.openings[Math.floor(Math.random() * occasionTheme.openings.length)];

  // Build verses based on tone and occasion
  const verses = [];

  // Verse 1: Opening verse with recipient name
  if (tone === "funny") {
    verses.push({
      name: "verse1",
      lines: [
        `${opening}, ${name}, here we go,`,
        `Another year, another show,`,
        message ? `They say "${message.slice(0, 30)}..."` : "Life's an adventure, don't you know,",
        `With you, it's never boring though!`,
      ],
    });
  } else if (tone === "inspirational") {
    verses.push({
      name: "verse1",
      lines: [
        `${opening}, ${name}, stand tall,`,
        `You've conquered mountains, answered the call,`,
        `Your strength inspires one and all,`,
        `With each step forward, you never fall.`,
      ],
    });
  } else {
    // Heartfelt (default)
    verses.push({
      name: "verse1",
      lines: [
        `${opening}, ${name}, so dear,`,
        `Your presence fills our hearts right here,`,
        message ? `${message.slice(0, 40)}` : "Through every moment, year by year,",
        `Our love for you is crystal clear.`,
      ],
    });
  }

  // Verse 2: Theme development
  if (occasion === "birthday") {
    if (tone === "funny") {
      verses.push({
        name: "verse2",
        lines: [
          `Candles on the cake today,`,
          `We'll pretend they're not a display,`,
          `Of years gone by, but that's okay,`,
          `You're still young in every way!`,
        ],
      });
    } else {
      verses.push({
        name: "verse2",
        lines: [
          `With every candle burning bright,`,
          `We celebrate your guiding light,`,
          `May all your dreams take joyful flight,`,
          `And fill your days from morn to night.`,
        ],
      });
    }
  } else if (occasion === "anniversary") {
    verses.push({
      name: "verse2",
      lines: [
        `Through seasons changing, love remains,`,
        `Through sunshine's warmth and gentle rains,`,
        `Your bond grows stronger through the strains,`,
        `A love that conquers and sustains.`,
      ],
    });
  } else if (occasion === "thank_you") {
    verses.push({
      name: "verse2",
      lines: [
        `Your kindness touches every soul,`,
        `You make the broken feel whole,`,
        `In giving, you have found your role,`,
        `A heart of gold, that's your patrol.`,
      ],
    });
  } else if (occasion === "graduation") {
    verses.push({
      name: "verse2",
      lines: [
        `The future stretches bright and wide,`,
        `With knowledge as your trusted guide,`,
        `Go forth with courage and with pride,`,
        `Success awaits on the other side.`,
      ],
    });
  } else {
    // Default verse 2
    verses.push({
      name: "verse2",
      lines: [
        `In every moment that we share,`,
        `Your spirit shows how much you care,`,
        `A blessing beyond all compare,`,
        `Our gratitude beyond repair.`,
      ],
    });
  }

  // Verse 3: Closing verse (optional, for heartfelt poems)
  if (tone === "heartfelt" || tone === "romantic") {
    verses.push({
      name: "verse3",
      lines: [
        `So ${name}, know this to be true,`,
        `There's no one quite the same as you,`,
        `Our hearts are grateful through and through,`,
        `For all the wonderful things you do.`,
      ],
    });
  }

  return { verses };
}

module.exports = {
  generatePoem,
  generatePoemWithLLM,
  buildPoemFallback,
  POEM_TONES,
  OCCASIONS,
  TONE_STYLES,
  OCCASION_THEMES,
};
