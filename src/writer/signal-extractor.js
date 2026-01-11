/**
 * Signal Extractor
 *
 * Extracts multiple story elements from a single user answer.
 * The key insight: users often mention multiple elements in one response.
 * "We met at a coffee shop and her smile lit up the room" contains:
 * - setting: coffee shop
 * - first_impression: her smile
 *
 * Uses LLM for accurate extraction, falls back to keyword heuristics.
 */

const { generateText, isAvailable } = require("../services/llm-provider");

/**
 * Extract story signals from a user's answer
 *
 * @param {string} answer - The user's answer text
 * @param {Object} storyContext - Current story context (for recipient name, arc, etc.)
 * @param {Object} model - The story model with STORY_ELEMENTS
 * @returns {Promise<Object>} {
 *   signals: { elementId: content },
 *   anchors: [{ word, context, sourceElement }],
 *   confidence: 'high' | 'medium' | 'low'
 * }
 */
async function extractStorySignals(answer, storyContext, model) {
  if (!answer || answer.trim().length === 0) {
    return { signals: {}, anchors: [], confidence: "low" };
  }

  const trimmedAnswer = answer.trim();

  // Try LLM extraction first
  if (isAvailable()) {
    try {
      const llmResult = await extractWithLLM(trimmedAnswer, storyContext, model);
      if (llmResult && Object.keys(llmResult.signals).length > 0) {
        return llmResult;
      }
    } catch (err) {
      console.error("[Signal Extractor] LLM extraction failed:", err.message);
    }
  }

  // Fallback to heuristic extraction
  return extractWithHeuristics(trimmedAnswer, storyContext, model);
}

/**
 * LLM-based signal extraction
 */
async function extractWithLLM(answer, storyContext, model) {
  const elements = model.STORY_ELEMENTS || {};
  const elementDescriptions = Object.values(elements)
    .map((e) => `- ${e.id}: ${e.description}`)
    .join("\n");

  const systemPrompt = `You are analyzing user responses to extract story elements for a personalized song.
You must output valid JSON only. No explanation, no markdown.`;

  const prompt = `The user is telling a story about ${storyContext.recipient_name || "someone special"} for a ${storyContext.arcContext?.arcDisplayName || storyContext.occasion || "special occasion"}.

Available story elements to detect:
${elementDescriptions}

User's answer:
"${answer}"

Extract which elements are present in this answer. For each detected element, extract the relevant content.
Also identify any specific words/phrases that could be anchor points for follow-up questions (names, places, specific details).

Respond with JSON only:
{
  "elements": {
    "element_id": "extracted content for that element"
  },
  "anchors": ["specific word or phrase 1", "specific word or phrase 2"]
}

If an element is not clearly present, do not include it. Be conservative - only extract what's clearly stated.`;

  const result = await generateText({
    prompt,
    taskType: "simple",
    systemPrompt,
    temperature: 0.3, // Lower temperature for more consistent extraction
  });

  const parsed = parseExtractionResult(result.text, model);

  return {
    signals: parsed.elements,
    anchors: buildAnchorObjects(parsed.anchors, answer, parsed.elements),
    confidence: Object.keys(parsed.elements).length > 0 ? "high" : "low",
    source: "llm",
  };
}

/**
 * Parse LLM extraction result, handling various formats
 */
function parseExtractionResult(text, model) {
  const validElementIds = new Set(Object.keys(model.STORY_ELEMENTS || {}));

  try {
    // Try to extract JSON from the response
    let jsonStr = text.trim();

    // Handle markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    // Validate and filter elements
    const elements = {};
    if (parsed.elements && typeof parsed.elements === "object") {
      for (const [id, content] of Object.entries(parsed.elements)) {
        if (validElementIds.has(id) && content && typeof content === "string") {
          elements[id] = content.trim();
        }
      }
    }

    // Validate anchors
    const anchors = [];
    if (Array.isArray(parsed.anchors)) {
      for (const anchor of parsed.anchors) {
        if (typeof anchor === "string" && anchor.trim().length > 0) {
          anchors.push(anchor.trim());
        }
      }
    }

    return { elements, anchors };
  } catch (err) {
    console.warn("[Signal Extractor] Failed to parse LLM response:", err.message);
    return { elements: {}, anchors: [] };
  }
}

/**
 * Heuristic-based signal extraction using anchor words from story model
 */
function extractWithHeuristics(answer, storyContext, model) {
  const elements = model.STORY_ELEMENTS || {};
  const answerLower = answer.toLowerCase();
  const signals = {};
  const detectedAnchors = [];

  for (const [elementId, element] of Object.entries(elements)) {
    const anchorWords = element.anchorWords || [];
    const matchedAnchors = [];

    for (const word of anchorWords) {
      // Use word boundary matching for accuracy
      const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, "i");
      if (regex.test(answerLower)) {
        matchedAnchors.push(word);
      }
    }

    if (matchedAnchors.length > 0) {
      // Element detected - assign the full answer as content
      // (Heuristic can't segment content as precisely as LLM)
      signals[elementId] = answer;

      // Track anchors for follow-up
      for (const anchor of matchedAnchors) {
        if (!detectedAnchors.some((a) => a.word === anchor)) {
          detectedAnchors.push({
            word: anchor,
            sourceElement: elementId,
          });
        }
      }
    }
  }

  return {
    signals,
    anchors: buildAnchorObjects(detectedAnchors, answer, signals),
    confidence: Object.keys(signals).length > 1 ? "medium" : "low",
    source: "heuristic",
  };
}

/**
 * Build anchor objects with context for follow-up questions
 */
function buildAnchorObjects(anchorInputs, answer, detectedElements) {
  if (!Array.isArray(anchorInputs)) return [];

  const anchors = [];
  for (const input of anchorInputs) {
    const word = typeof input === "string" ? input : input?.word;
    if (!word || typeof word !== "string") continue;

    // Skip very short or common words
    if (word.length < 3) continue;

    // Find which element this anchor came from
    let sourceElement = input?.sourceElement || null;
    if (!sourceElement) {
      for (const [elementId, content] of Object.entries(detectedElements)) {
        if (content && content.toLowerCase().includes(word.toLowerCase())) {
          sourceElement = elementId;
          break;
        }
      }
    }

    // Extract context around the anchor (5 words before/after)
    const regex = new RegExp(
      `(?:\\S+\\s+){0,5}\\b${escapeRegex(word)}\\b(?:\\s+\\S+){0,5}`,
      "i"
    );
    const contextMatch = answer.match(regex);
    const context = contextMatch ? contextMatch[0].trim() : word;

    anchors.push({
      word,
      context,
      sourceElement,
      element: input?.element || sourceElement || null,
      followUp: input?.followUp ?? true, // Indicates this anchor could benefit from follow-up
    });
  }

  return anchors;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Merge new signals into existing elements, preserving context
 *
 * @param {Object} existingElements - Current story elements
 * @param {Object} newSignals - Newly extracted signals
 * @returns {Object} Merged elements
 */
function mergeSignals(existingElements, newSignals) {
  const merged = { ...existingElements };

  for (const [elementId, newContent] of Object.entries(newSignals)) {
    if (!newContent || newContent.trim().length === 0) continue;

    const existing = merged[elementId];
    if (existing && existing.trim().length > 0) {
      // Append new content if it adds information
      // Avoid exact duplicates
      if (!existing.includes(newContent) && !newContent.includes(existing)) {
        merged[elementId] = `${existing} ${newContent}`;
      }
    } else {
      merged[elementId] = newContent.trim();
    }
  }

  return merged;
}

/**
 * Check if an answer is too vague/generic to extract meaningful signals
 *
 * @param {string} answer - User's answer
 * @returns {boolean} True if answer is likely too vague
 */
function isVagueAnswer(answer) {
  if (!answer) return true;

  const trimmed = answer.trim().toLowerCase();

  // Check length - very short answers are often vague
  if (trimmed.length < 15) return true;

  // Check for common non-answers
  const vaguePatterns = [
    /^i\s*(don't|dont)\s*know/i,
    /^not\s*sure/i,
    /^idk/i,
    /^nothing\s*(really|specific|special)?$/i,
    /^just\s*(normal|regular|usual)/i,
    /^i\s*guess/i,
    /^can't\s*(remember|think)/i,
    /^i\s*forgot/i,
  ];

  for (const pattern of vaguePatterns) {
    if (pattern.test(trimmed)) return true;
  }

  // Check word count - fewer than 4 words is often too vague
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < 4) return true;

  return false;
}

module.exports = {
  extractStorySignals,
  mergeSignals,
  isVagueAnswer,
  // Exported for testing
  extractWithHeuristics,
  parseExtractionResult,
};
