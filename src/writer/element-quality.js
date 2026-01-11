/**
 * Element Quality Assessment
 *
 * Replaces the simple `length > 10` check with proper specificity scoring.
 * An element is "filled" when it has meaningful, specific content that
 * will contribute to a good song lyric.
 *
 * Key insight: "I don't know" has 12 chars but is NOT a filled element.
 */

/**
 * Generic phrases that indicate low-quality content
 */
const GENERIC_PHRASES = [
  "i don't know",
  "i dont know",
  "not sure",
  "nothing special",
  "just normal",
  "like everyone else",
  "the usual",
  "same as always",
  "pretty typical",
  "nothing really",
  "can't remember",
  "i forgot",
  "hard to say",
  "i guess",
  "maybe",
  "probably",
  "sort of",
  "kind of",
];

/**
 * Words that indicate specificity (good content)
 */
const SPECIFICITY_MARKERS = [
  // Time specificity
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(\d{1,2}(?:st|nd|rd|th)?)\b/i, // 1st, 2nd, 3rd, etc.
  /\b(morning|afternoon|evening|night|midnight|dawn|dusk)\b/i,
  /\b(\d{4})\b/, // Years like 2020

  // Place specificity
  /\b(at the|in the|on the|at a|in a)\s+\w+/i, // "at the park", "in the cafe"

  // Sensory detail markers
  /\b(saw|heard|felt|smelled|tasted)\b/i,
  /\b(wearing|dressed|looked like)\b/i,
  /\b(voice|laugh|smile|eyes|hands)\b/i,
  /\b(warm|cold|soft|loud|quiet|bright|dark)\b/i,

  // Emotional markers
  /\b(realized|knew|understood|felt)\s+that\b/i,
  /\b(never forget|always remember|still)\b/i,
  /\b(heart|soul|breath|tears)\b/i,

  // Unique details
  /\b(only|exactly|specifically|particularly)\b/i,
  /\b(because|that's when|that's why)\b/i,
];

/**
 * Assess the quality of content for a story element
 *
 * @param {string} content - The content to assess
 * @param {string} elementId - Which element this is (for context-specific scoring)
 * @returns {Object} { filled: boolean, score: 0-1, issues: string[] }
 */
function assessElementQuality(content, elementId = "generic") {
  const issues = [];

  if (!content || typeof content !== "string") {
    return {
      filled: false,
      score: 0,
      issues: ["No content provided"],
    };
  }

  const trimmed = content.trim();

  // Basic length check (minimum 15 chars)
  if (trimmed.length < 15) {
    issues.push("Too short - need more detail");
    return { filled: false, score: 0.1, issues };
  }

  // Word count check (minimum 4 meaningful words)
  const words = trimmed.split(/\s+/).filter((w) => w.length > 2);
  if (words.length < 4) {
    issues.push("Too few words - need more detail");
    return { filled: false, score: 0.2, issues };
  }

  const lowerContent = trimmed.toLowerCase();

  // Check for generic phrases
  let genericCount = 0;
  for (const phrase of GENERIC_PHRASES) {
    if (lowerContent.includes(phrase)) {
      genericCount++;
    }
  }

  if (genericCount >= 2) {
    issues.push("Content is too generic - need specific details");
    return { filled: false, score: 0.2, issues };
  }

  if (genericCount === 1 && words.length < 10) {
    issues.push("Content seems vague - can you be more specific?");
    return { filled: false, score: 0.3, issues };
  }

  // Count specificity markers
  let specificityScore = 0;
  for (const pattern of SPECIFICITY_MARKERS) {
    if (pattern.test(trimmed)) {
      specificityScore++;
    }
  }

  // Calculate base score
  let score = 0.4; // Base score for passing basic checks

  // Add points for length
  score += Math.min(0.2, words.length / 50); // Up to 0.2 for word count

  // Add points for specificity
  score += Math.min(0.3, specificityScore * 0.1); // Up to 0.3 for specificity

  // Reduce score for generic phrases
  score -= genericCount * 0.1;

  // Clamp to 0-1
  score = Math.max(0, Math.min(1, score));

  // Element-specific bonuses
  if (elementId === "sensory_anchor" && specificityScore >= 2) {
    score += 0.1;
  }

  if (elementId === "setting" && /\b(at|in|on)\s+the\s+\w+/i.test(trimmed)) {
    score += 0.1;
  }

  // Final clamp
  score = Math.max(0, Math.min(1, score));

  // Determine if filled
  // Require score >= 0.4 (meaningful content with some specificity)
  const filled = score >= 0.4 && issues.length === 0;

  if (!filled && issues.length === 0) {
    issues.push("Could use more vivid details");
  }

  return { filled, score, issues };
}

/**
 * Check if a story context has an element filled with quality content
 *
 * @param {Object} storyContext - Current story context
 * @param {string} elementId - Element to check
 * @returns {boolean} Whether element has meaningful, quality content
 */
function hasElement(storyContext, elementId) {
  const value = storyContext.elements?.[elementId];
  const assessment = assessElementQuality(value, elementId);
  return assessment.filled;
}

/**
 * Get quality assessment for all elements in a story
 *
 * @param {Object} storyContext - Current story context
 * @param {Array} elementIds - List of element IDs to assess
 * @returns {Object} Map of elementId to { filled, score, issues }
 */
function assessAllElements(storyContext, elementIds) {
  const assessments = {};

  for (const elementId of elementIds) {
    const content = storyContext.elements?.[elementId];
    assessments[elementId] = assessElementQuality(content, elementId);
  }

  return assessments;
}

/**
 * Identify weak elements that could benefit from more detail
 *
 * @param {Object} storyContext - Current story context
 * @param {Array} elementIds - List of element IDs to check
 * @returns {Array} List of { elementId, score, issues } for elements scoring < 0.6
 */
function findWeakElements(storyContext, elementIds) {
  const weak = [];

  for (const elementId of elementIds) {
    const content = storyContext.elements?.[elementId];
    const assessment = assessElementQuality(content, elementId);

    // Include elements that are technically "filled" but low quality
    if (assessment.score > 0 && assessment.score < 0.6) {
      weak.push({
        elementId,
        score: assessment.score,
        issues: assessment.issues,
        currentContent: content?.substring(0, 100) + (content?.length > 100 ? "..." : ""),
      });
    }
  }

  // Sort by score (lowest first)
  weak.sort((a, b) => a.score - b.score);

  return weak;
}

module.exports = {
  assessElementQuality,
  hasElement,
  assessAllElements,
  findWeakElements,
  // Exported for testing
  GENERIC_PHRASES,
  SPECIFICITY_MARKERS,
};
