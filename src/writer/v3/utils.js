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

module.exports = { normalizeText, trimText, normalizeOccasion };
