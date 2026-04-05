/**
 * Shared text utilities for V3 writer modules.
 */

/** Collapse whitespace and trim. Coerces non-strings to "". */
function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

/** Trim only (no whitespace collapsing). Coerces non-strings to "". */
function trimText(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

/** Normalize occasion-like values into a canonical lookup form. */
function normalizeOccasion(value) {
  return trimText(value).toLowerCase().replace(/[\s_]+/g, "-");
}

/**
 * Strip formulaic openers that the LLM persistently generates despite prompt rules.
 * E.g., "This birthday story is about Sarah. It happened..." → "It happened..."
 */
function stripFormulaicOpener(text) {
  if (typeof text !== "string") return "";
  return text.replace(/^This\s+\w+\s+story\s+is\s+about\s+\w+[\w\s]*\.\s*/i, "").trim();
}

module.exports = { normalizeText, trimText, normalizeOccasion, stripFormulaicOpener };
