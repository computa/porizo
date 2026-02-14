/**
 * Poem OG Image Generator
 *
 * Generates 1200×630 social share card images for poems using SVG + Sharp.
 * Reuses occasion colors and XML escaping from cover-generator.js.
 *
 * Layout:
 * ┌──────────────────────────────────────────────┐
 * │  ✦ ─── ✦                                     │
 * │                                               │
 * │         A poem for Sarah                      │
 * │          ── Birthday ──                       │
 * │                                               │
 * │   "Verse line 1 goes here centered"           │
 * │   "Verse line 2 goes here centered"           │
 * │   "Verse line 3 goes here centered"           │
 * │   "Verse line 4 goes here centered"           │
 * │                                               │
 * │         ✦                     porizo.co       │
 * └──────────────────────────────────────────────┘
 */

const { OCCASION_COLORS } = require("./cover-generator");

/**
 * Escape XML special characters in user-provided text
 */
function escapeXml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Format occasion slug to display name
 */
function formatOccasion(occasion) {
  const mapping = {
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
    custom: "Poem",
  };
  return mapping[occasion] || "Poem";
}

/**
 * Generate a 1200×630 OG image for a poem share card
 *
 * @param {Object} params
 * @param {string} params.title - Poem title
 * @param {string} params.recipientName - Recipient's name
 * @param {string} params.occasion - Occasion slug
 * @param {string[]} params.verses - Array of verse strings
 * @returns {Promise<Buffer>} PNG image buffer
 */
async function generatePoemOgImage({ title, recipientName, occasion, verses }) {
  let sharp;
  try {
    sharp = require("sharp");
  } catch (err) {
    console.warn("[PoemOgGenerator] sharp not installed, skipping OG image generation");
    return null;
  }

  const width = 1200;
  const height = 630;
  const colors = OCCASION_COLORS[occasion] || OCCASION_COLORS.custom;

  // Extract up to 6 verse lines, truncating long lines
  const verseLines = [];
  for (const verse of (verses || [])) {
    if (typeof verse !== "string") continue;
    const lines = verse.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      if (verseLines.length >= 6) break;
      const trimmed = line.trim();
      verseLines.push(trimmed.length > 50 ? trimmed.slice(0, 48) + "…" : trimmed);
    }
    if (verseLines.length >= 6) break;
  }

  // If we hit the limit and there are more lines, add ellipsis indicator
  const totalLines = (verses || []).reduce((sum, v) => {
    if (typeof v !== "string") return sum;
    return sum + v.split("\n").filter((l) => l.trim()).length;
  }, 0);
  const hasMore = totalLines > 6;

  const svgContent = buildPoemSvg({
    width,
    height,
    colors,
    recipientName: recipientName || "",
    occasion,
    verseLines,
    hasMore,
  });

  const buffer = await sharp(Buffer.from(svgContent))
    .png({ quality: 90 })
    .toBuffer();

  console.log(`[PoemOgGenerator] Generated OG image for poem "${title}" (${verseLines.length} lines)`);
  return buffer;
}

/**
 * Build SVG content for the poem OG card
 */
function buildPoemSvg({ width, height, colors, recipientName, occasion, verseLines, hasMore }) {
  const safeRecipient = escapeXml(recipientName);
  const safeOccasion = escapeXml(formatOccasion(occasion));

  // Verse line positioning: start below the header, space evenly
  const verseStartY = 280;
  const verseSpacing = 38;

  const verseTextElements = verseLines.map((line, i) => {
    const y = verseStartY + i * verseSpacing;
    return `<text x="50%" y="${y}" font-family="Georgia, 'Times New Roman', serif" font-size="22" font-style="italic" fill="white" fill-opacity="0.9" text-anchor="middle">${escapeXml(line)}</text>`;
  }).join("\n    ");

  // If truncated, add "…" after last verse line
  const moreIndicator = hasMore
    ? `<text x="50%" y="${verseStartY + verseLines.length * verseSpacing}" font-family="Georgia, 'Times New Roman', serif" font-size="22" fill="white" fill-opacity="0.5" text-anchor="middle">…</text>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${colors.primary}"/>
      <stop offset="50%" style="stop-color:${colors.secondary}"/>
      <stop offset="100%" style="stop-color:${colors.primary}"/>
    </linearGradient>
    <linearGradient id="overlay" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:rgba(0,0,0,0.4)"/>
      <stop offset="50%" style="stop-color:rgba(0,0,0,0.6)"/>
      <stop offset="100%" style="stop-color:rgba(0,0,0,0.4)"/>
    </linearGradient>
    <linearGradient id="divider" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:${colors.accent};stop-opacity:0"/>
      <stop offset="50%" style="stop-color:${colors.accent};stop-opacity:0.6"/>
      <stop offset="100%" style="stop-color:${colors.accent};stop-opacity:0"/>
    </linearGradient>
  </defs>

  <!-- Background gradient -->
  <rect width="100%" height="100%" fill="url(#bg)"/>

  <!-- Dark overlay for text readability -->
  <rect width="100%" height="100%" fill="url(#overlay)"/>

  <!-- Decorative accent circles -->
  <circle cx="200" cy="100" r="180" fill="${colors.accent}" opacity="0.08"/>
  <circle cx="1000" cy="530" r="200" fill="${colors.accent}" opacity="0.06"/>

  <!-- Top ornament -->
  <text x="50%" y="60" font-family="Georgia, serif" font-size="18" fill="${colors.accent}" fill-opacity="0.7" text-anchor="middle">&#x2726; &#x2500;&#x2500;&#x2500; &#x2726;</text>

  <!-- "A poem for [Name]" -->
  <text x="50%" y="120" font-family="Georgia, 'Times New Roman', serif" font-size="36" font-weight="bold" fill="white" text-anchor="middle">A poem for ${safeRecipient}</text>

  <!-- Occasion label -->
  <text x="50%" y="160" font-family="Georgia, 'Times New Roman', serif" font-size="16" fill="${colors.accent}" text-anchor="middle" letter-spacing="2">&#x2500;&#x2500; ${safeOccasion} &#x2500;&#x2500;</text>

  <!-- Top divider line -->
  <rect x="350" y="190" width="500" height="1" fill="url(#divider)"/>

  <!-- Verse lines -->
  ${verseTextElements ? `
    <!-- Verse content -->
    ${verseTextElements}
    ${moreIndicator}
  ` : `
    <!-- No verses -->
    <text x="50%" y="340" font-family="Georgia, serif" font-size="20" font-style="italic" fill="white" fill-opacity="0.6" text-anchor="middle">A poem written just for you</text>
  `}

  <!-- Bottom divider line -->
  <rect x="350" y="${height - 100}" width="500" height="1" fill="url(#divider)"/>

  <!-- Bottom ornament -->
  <text x="50%" y="${height - 65}" font-family="Georgia, serif" font-size="16" fill="${colors.accent}" fill-opacity="0.6" text-anchor="middle">&#x2726;</text>

  <!-- Branding -->
  <text x="${width - 40}" y="${height - 20}" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="14" fill="white" fill-opacity="0.4" text-anchor="end">porizo.co</text>
</svg>`;
}

module.exports = { generatePoemOgImage };
