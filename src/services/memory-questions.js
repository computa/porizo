/**
 * Memory Questions Service
 *
 * Generates contextual follow-up questions based on a user's memory
 * to extract the emotional essence for personalized song creation.
 *
 * The AI analyzes the memory and generates 2-3 questions targeting:
 * 1. EMOTION - What were they feeling in that moment?
 * 2. SENSORY - What did they see/hear/feel?
 * 3. RESOLUTION - How did the moment end or change things?
 */

const { generateText } = require("./llm-provider");
const { sanitizeForPrompt } = require("./content-filter");
const { extractFirstJsonObject } = require("../utils/common");

/**
 * Generate contextual follow-up questions based on a memory
 *
 * @param {Object} options - Generation options
 * @param {string} options.memory - The user's memory description
 * @param {string} options.occasion - The occasion type (birthday, anniversary, etc.)
 * @param {string} options.recipientName - The recipient's name
 * @returns {Promise<Object>} Generated questions with placeholders
 */
async function generateMemoryQuestions({ memory, occasion, recipientName }) {
  // Validate inputs
  if (!memory || typeof memory !== "string" || memory.trim().length < 5) {
    throw new Error("Memory must be at least 5 characters");
  }

  // Sanitize inputs before sending to LLM
  const sanitizedMemory = sanitizeForPrompt(memory);
  const sanitizedRecipient = sanitizeForPrompt(recipientName || "them");
  const sanitizedOccasion = sanitizeForPrompt(occasion || "celebration");

  const systemPrompt = `You are helping extract emotional details from memories to create personalized songs.

Your task is to generate 2-3 follow-up questions based on a specific memory.

RULES:
1. Questions must be SPECIFIC to what they wrote, not generic
2. Questions should extract: emotions, sensory details, and how the moment ended
3. Keep questions warm and encouraging, not interrogative
4. Placeholders should give examples relevant to their memory
5. Return ONLY valid JSON, no markdown

OUTPUT FORMAT:
{
  "questions": [
    {
      "id": "q1",
      "question": "What were you feeling in that moment?",
      "placeholder": "e.g., Pure joy, peaceful, overwhelmed with love..."
    }
  ]
}`;

  const prompt = `Generate follow-up questions for this song creation:

MEMORY: "${sanitizedMemory}"
OCCASION: ${sanitizedOccasion}
RECIPIENT: ${sanitizedRecipient}

Generate 2-3 questions that will help extract the emotional essence of this specific memory.

Focus on:
1. The EMOTION of that moment (what were they feeling?)
2. SENSORY details specific to their memory (what did they experience?)
3. The RESOLUTION (how did this moment end or change things?)

Make questions specific to their memory, not generic.`;

  const result = await generateText({
    prompt,
    taskType: "simple", // Use Haiku for speed/cost
    systemPrompt,
    temperature: 0.6, // Lower temperature for more consistent formatting
    responseMimeType: "application/json",
  });

  // Parse and validate the response
  const parsed = parseQuestionsResponse(result.text);

  return {
    questions: parsed.questions,
    meta: {
      provider: result.provider,
      model: result.model,
      fallbackUsed: result.fallbackUsed,
    },
  };
}

/**
 * Parse the LLM response into structured questions
 *
 * @param {string} text - Raw LLM response
 * @returns {Object} Parsed questions object
 */
function parseQuestionsResponse(text) {
  if (!text || typeof text !== "string") {
    return { questions: getDefaultQuestions() };
  }

  try {
    const jsonText = extractFirstJsonObject(text);
    if (!jsonText) {
      console.warn("[memory-questions] No JSON found in response, using defaults");
      return { questions: getDefaultQuestions() };
    }

    const parsed = JSON.parse(jsonText);

    // Validate structure
    if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
      console.warn("[memory-questions] Invalid questions array, using defaults");
      return { questions: getDefaultQuestions() };
    }

    // Validate and normalize each question
    const validQuestions = parsed.questions
      .filter((q) => q && typeof q.question === "string" && q.question.trim())
      .slice(0, 3) // Max 3 questions
      .map((q, index) => ({
        id: q.id || `q${index + 1}`,
        question: q.question.trim(),
        placeholder: q.placeholder || "",
      }));

    if (validQuestions.length === 0) {
      return { questions: getDefaultQuestions() };
    }

    return { questions: validQuestions };
  } catch (err) {
    console.error("[memory-questions] Failed to parse response:", err.message);
    return { questions: getDefaultQuestions() };
  }
}

/**
 * Get default questions as fallback
 * These are generic but still useful for capturing memory details
 */
function getDefaultQuestions() {
  return [
    {
      id: "q1",
      question: "What were you feeling in that moment?",
      placeholder: "e.g., Pure joy, peaceful, overwhelmed with love...",
    },
    {
      id: "q2",
      question: "What details do you remember most vividly?",
      placeholder: "e.g., The way they smiled, the sounds around you...",
    },
    {
      id: "q3",
      question: "How did this moment end?",
      placeholder: "e.g., We laughed together, we made a promise...",
    },
  ];
}

module.exports = {
  generateMemoryQuestions,
  parseQuestionsResponse,
  getDefaultQuestions,
};
