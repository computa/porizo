/**
 * Shared text utilities for OG image generators.
 *
 * Extracted from song-og-generator.js and poem-og-generator.js
 * to eliminate duplication across all OG image variants.
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

function truncateWithEllipsis(value, maxChars) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function withEllipsis(value, maxChars) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length >= maxChars) {
    return `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
  }
  return `${text}…`;
}

function wrapText(value, maxCharsPerLine, maxLines) {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
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

const OCCASION_FORMAT = {
  birthday: "Birthday",
  anniversary: "Anniversary",
  thank_you: "Thank You",
  i_love_you: "Love",
  wedding: "Wedding",
  graduation: "Graduation",
  celebration: "Celebration",
  apology: "Apology",
  encouragement: "Encouragement",
  advice: "Advice",
  bereavement: "Bereavement",
  custom: null, // caller provides default
};

function formatOccasion(occasion, defaultLabel = "Personalized") {
  return OCCASION_FORMAT[occasion] || defaultLabel;
}

module.exports = {
  escapeXml,
  truncateWithEllipsis,
  withEllipsis,
  wrapText,
  formatOccasion,
};
