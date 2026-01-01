/**
 * Moderation Provider
 *
 * Orchestrates content moderation for user inputs and generated outputs.
 * Uses content-filter service for detection logic.
 */

const {
  moderateContent,
  moderateLyrics,
  sanitizeForPrompt,
  detectInjection,
} = require('../services/content-filter');

// Impersonation patterns (voice cloning prevention)
const IMPERSONATION_PATTERNS = [
  /sounds?\s+like/i,        // "sound like" or "sounds like"
  /in\s+the\s+style\s+of/i,
  /impersonate/i,
  /pretend\s+to\s+be/i,
  /voice\s+of/i,
  /sings?\s+like/i,         // "sing like" or "sings like"
  /copy\s+(the\s+)?voice/i,
  /mimic/i,
  /imitat(e|es|ing)/i,      // "imitate", "imitates", "imitating"
];

/**
 * Check for impersonation attempts (voice cloning prevention)
 * @param {string} text - Text to check
 * @returns {{ allowed: boolean, reason?: string }}
 */
function checkImpersonation(text) {
  if (!text) return { allowed: true };

  for (const pattern of IMPERSONATION_PATTERNS) {
    if (pattern.test(text)) {
      return {
        allowed: false,
        reason: 'IMPERSONATION_ATTEMPT',
      };
    }
  }

  return { allowed: true };
}

/**
 * Full moderation check for track creation inputs
 * @param {Object} input - User input to moderate
 * @param {string} [input.title] - Track title
 * @param {string} [input.recipient_name] - Recipient name
 * @param {string} [input.message] - Personal message
 * @param {string} [input.occasion] - Occasion type
 * @param {string} [input.relationship_type] - Relationship type
 * @param {string} [input.specific_memory] - Specific memory
 * @param {string} [input.special_phrases] - Special phrases
 * @param {string} [input.what_makes_them_special] - What makes them special
 * @param {string} [input.story_context] - Story context (legacy)
 * @param {string} [input.lyrics] - Lyrics (for post-generation check)
 * @returns {{
 *   allowed: boolean,
 *   reason?: string,
 *   category?: string,
 *   severity?: string,
 *   details?: Object
 * }}
 */
function moderationCheck(input) {
  const {
    title,
    recipient_name,
    message,
    occasion,
    relationship_type,
    specific_memory,
    special_phrases,
    what_makes_them_special,
    story_context,
    lyrics,
  } = input || {};

  // Combine ALL text fields for moderation check
  const allText = [
    title,
    recipient_name,
    message,
    occasion,
    relationship_type,
    specific_memory,
    special_phrases,
    what_makes_them_special,
    story_context,
    lyrics,
  ]
    .filter(Boolean)
    .join(' ');

  if (!allText.trim()) {
    return { allowed: true };
  }

  // Check impersonation first (voice safety)
  const impersonationCheck = checkImpersonation(allText);
  if (!impersonationCheck.allowed) {
    return {
      ...impersonationCheck,
      severity: 'severe',
    };
  }

  // Build combined story context from all memory fields
  const combinedStoryContext = [
    occasion,
    relationship_type,
    specific_memory,
    special_phrases,
    what_makes_them_special,
    story_context,
  ]
    .filter(Boolean)
    .join(' ');

  // Run comprehensive content moderation
  const contentResult = moderateContent({
    recipientName: recipient_name,
    message,
    storyContext: combinedStoryContext,
    lyrics,
  });

  return contentResult;
}

/**
 * Moderate memory capture input (pre-LLM)
 * @param {Object} memoryInput - Memory capture data
 * @param {string} memoryInput.recipientName - Who the song is for
 * @param {string} memoryInput.occasion - The occasion
 * @param {string} memoryInput.coreMemory - The main memory
 * @param {Array<{question: string, answer: string}>} [memoryInput.additionalAnswers] - Follow-up answers
 * @returns {{ allowed: boolean, reason?: string, sanitized?: Object }}
 */
function moderateMemoryInput(memoryInput) {
  const { recipientName, occasion, coreMemory, additionalAnswers = [] } = memoryInput || {};

  // Combine all user-provided text
  const allAnswers = additionalAnswers.map(a => a.answer).join(' ');
  const allText = [recipientName, occasion, coreMemory, allAnswers].filter(Boolean).join(' ');

  // Check for injection attempts
  const injectionCheck = detectInjection(allText);
  if (!injectionCheck.clean) {
    return {
      allowed: false,
      reason: 'PROMPT_INJECTION',
      severity: 'severe',
    };
  }

  // Run full moderation
  const result = moderateContent({
    recipientName,
    message: occasion,
    storyContext: [coreMemory, allAnswers].filter(Boolean).join(' '),
  });

  if (!result.allowed) {
    return result;
  }

  // Return sanitized version for LLM
  return {
    allowed: true,
    sanitized: {
      recipientName: sanitizeForPrompt(recipientName),
      occasion: sanitizeForPrompt(occasion),
      coreMemory: sanitizeForPrompt(coreMemory),
      additionalAnswers: additionalAnswers.map(a => ({
        question: a.question,
        answer: sanitizeForPrompt(a.answer),
      })),
    },
  };
}

/**
 * Validate generated lyrics (post-LLM)
 * Re-moderates to catch any issues the LLM may have introduced
 * @param {string} lyrics - Generated lyrics
 * @param {string} recipientName - Expected recipient name
 * @returns {{ allowed: boolean, reason?: string, hasAnchor: boolean }}
 */
function validateGeneratedLyrics(lyrics, recipientName) {
  if (!lyrics) {
    return { allowed: false, reason: 'EMPTY_LYRICS', hasAnchor: false };
  }

  // Check lyrics content
  const lyricsResult = moderateLyrics(lyrics);
  if (!lyricsResult.allowed) {
    return {
      ...lyricsResult,
      hasAnchor: false,
    };
  }

  // Check for recipient name anchor (should appear in lyrics)
  const hasAnchor = recipientName
    ? lyrics.toLowerCase().includes(recipientName.toLowerCase())
    : true;

  return {
    allowed: true,
    hasAnchor,
  };
}

/**
 * Get severity level for logging/metrics
 * @param {string} reason - Moderation reason code
 * @returns {'none'|'minor'|'moderate'|'severe'}
 */
function getSeverityLevel(reason) {
  if (!reason) return 'none';

  const severityMap = {
    PROMPT_INJECTION: 'severe',
    IMPERSONATION_ATTEMPT: 'severe',
    HATE_SPEECH: 'severe',
    PROFANITY: 'moderate',
    EMPTY_LYRICS: 'minor',
  };

  return severityMap[reason] || 'moderate';
}

module.exports = {
  moderationCheck,
  moderateMemoryInput,
  validateGeneratedLyrics,
  checkImpersonation,
  getSeverityLevel,
  // Re-export from content-filter for convenience
  sanitizeForPrompt,
};
