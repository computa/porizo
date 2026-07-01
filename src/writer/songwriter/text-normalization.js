"use strict";

const SHORT_FIELD_CHAR_LIMIT = 2000;
const LONG_STORY_CHAR_LIMIT = 12000;

/**
 * Sanitize input text for safe LLM processing.
 * Removes control characters, excessive whitespace, and prompt-injection vectors.
 */
function sanitizeText(text, maxLength = SHORT_FIELD_CHAR_LIMIT) {
  if (!text || typeof text !== "string") return "";

  return text
    // Remove control characters except newlines and tabs.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u00A0\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, maxLength)
    .trim();
}

function sanitizeInput(text) {
  return sanitizeText(text, SHORT_FIELD_CHAR_LIMIT);
}

function sanitizeLongStoryInput(text, maxLength = LONG_STORY_CHAR_LIMIT) {
  return sanitizeText(text, maxLength);
}

function sanitizeLongStoryForPrompt(text) {
  let sanitized = sanitizeLongStoryInput(text);
  sanitized = sanitized.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  sanitized = sanitized.replace(/<[^>]*>/g, "");
  sanitized = sanitized.replace(/```[^`]*```/g, "");
  sanitized = sanitized.replace(/###[^\n]*/g, "");
  sanitized = sanitized.replace(/\[\[[^\]]*\]\]/g, "");
  return sanitized.trim();
}

module.exports = {
  LONG_STORY_CHAR_LIMIT,
  SHORT_FIELD_CHAR_LIMIT,
  sanitizeInput,
  sanitizeLongStoryForPrompt,
  sanitizeLongStoryInput,
  sanitizeText,
};
