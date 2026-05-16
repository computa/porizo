/**
 * Shared text utilities for OG image generators.
 *
 * These helpers are used by song-og-generator, poem-og-generator,
 * cover-generator, and the OG variant modules. They operate on
 * plain strings destined for SVG output (XML escaping, not HTML).
 */

/**
 * Escape XML special characters for safe SVG embedding.
 * Uses &apos; (XML entity) — NOT &#39; (HTML numeric reference).
 */
function escapeXml(value) {
  if (!value) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Map an occasion key to a human-readable label.
 * @param {string} occasion - Occasion key (e.g. "birthday", "custom")
 * @param {string} [fallback="Personalized Song"] - Default when occasion is unknown or unmapped
 */
function formatOccasion(occasion, fallback = "Personalized Song") {
  const mapping = {
    birthday: "Birthday",
    mothers_day: "Mother's Day",
    anniversary: "Anniversary",
    thank_you: "Thank You",
    i_love_you: "Love Song",
    wedding: "Wedding",
    graduation: "Graduation",
    celebration: "Celebration",
    apology: "Apology",
    encouragement: "Encouragement",
    advice: "Advice",
    bereavement: "Bereavement",
    friendship: "Friendship",
    get_well: "Get Well",
    custom: fallback,
  };
  return mapping[occasion] || fallback;
}

/**
 * Truncate text and append an ellipsis if it exceeds maxChars.
 */
function truncateWithEllipsis(value, maxChars) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}\u2026`;
}

/**
 * Append an ellipsis unconditionally; truncate first if text exceeds maxChars.
 */
function withEllipsis(value, maxChars) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length >= maxChars) {
    return `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}\u2026`;
  }
  return `${text}\u2026`;
}

/**
 * Word-wrap text into lines respecting maxCharsPerLine and maxLines.
 * Appends an ellipsis to the last line when words are left over.
 */
function wrapText(value, maxCharsPerLine, maxLines) {
  const words = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return [];

  const lines = [];
  let current = "";
  let index = 0;

  while (index < words.length) {
    const word = words[index];
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine || current.length === 0) {
      current = candidate;
      index += 1;
      continue;
    }
    lines.push(current);
    current = "";
    if (lines.length === maxLines) {
      break;
    }
  }

  if (lines.length < maxLines && current) {
    lines.push(current);
  }

  if (index < words.length && lines.length > 0) {
    const last = lines.length - 1;
    lines[last] = withEllipsis(lines[last], maxCharsPerLine);
  }

  return lines.slice(0, maxLines);
}

/**
 * Detect the writing direction of a recipient name.
 * Returns 'rtl' if the string contains any character in Arabic, Hebrew,
 * Farsi/Urdu (Arabic supplement), or related RTL ranges; otherwise 'ltr'.
 */
function detectDirection(value) {
  const text = String(value || "");
  // Arabic (؀-ۿ), Arabic Supplement (ݐ-ݿ), Hebrew (֐-׿),
  // Arabic Extended-A (ࢠ-ࣿ), Arabic Presentation Forms-A (ﭐ-﷿),
  // Arabic Presentation Forms-B (ﹰ-﻿).
  const rtlRegex = /[֐-׿؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
  return rtlRegex.test(text) ? "rtl" : "ltr";
}

/**
 * Returns the locale-aware "for X" prefix for a recipient name.
 *
 * LTR -> "For " (English default; the consumer can plug in localized LTR variants if needed).
 * RTL -> Arabic "لـ ", Hebrew "לְ ", Farsi/Urdu fall back to Arabic prefix.
 * Falls back to empty string when the script can't be detected confidently —
 * the composite still renders the name itself, just without a prefix.
 */
function localizedForPrefix(value) {
  const text = String(value || "");
  if (!text) return "";
  // Hebrew first (narrower range) before generic Arabic
  if (/[֐-׿יִ-ﭏ]/.test(text)) {
    return "לְ "; // "לְ " — Hebrew "to/for" preposition
  }
  if (/[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/.test(text)) {
    return "لـ "; // "لـ " — Arabic "for" with tatweel
  }
  return "For ";
}

module.exports = {
  escapeXml,
  formatOccasion,
  truncateWithEllipsis,
  withEllipsis,
  wrapText,
  detectDirection,
  localizedForPrefix,
};
