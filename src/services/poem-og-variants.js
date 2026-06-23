/**
 * Poem OG Image Variants
 *
 * Three design variants for poem share OG images (1200x630 PNG).
 * Used by the debug preview page for visual comparison before selecting
 * a final production design.
 *
 * Variants:
 *   A: "Open Book"     — Parchment bg, left-aligned, vertical accent strip
 *   B: "Verse Window"  — Bold occasion gradient bg, floating white panel
 *   C: "Whisper"       — Deep dark bg, purely typographic, horizontal accent line
 */

const { OCCASION_COLORS } = require("./cover-generator");
const {
  escapeXml,
  truncateWithEllipsis,
  wrapText,
  formatOccasion,
} = require("../utils/og-text-utils");

const WIDTH = 1200;
const HEIGHT = 630;
const FONT_STACK = "Georgia, 'Times New Roman', serif";
const SANS_STACK =
  "'Avenir Next', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const { requireSharp: _requireSharp } = require("../utils/sharp-loader");
function requireSharp() {
  return _requireSharp("PoemOgVariants");
}

function collectPreviewLines(
  verses,
  { maxLines = 3, maxCharsPerLine = 44 } = {},
) {
  const rawLines = [];
  for (const verse of verses || []) {
    const sourceLines = [];
    if (typeof verse === "string") {
      sourceLines.push(...verse.split("\n"));
    } else if (Array.isArray(verse)) {
      for (const line of verse) {
        if (typeof line === "string") {
          sourceLines.push(line);
        }
      }
    }
    const lines = sourceLines.map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      rawLines.push(line);
      if (rawLines.length >= maxLines * 2) break;
    }
    if (rawLines.length >= maxLines * 2) break;
  }

  if (!rawLines.length) return ["A poem written just for you."];

  const wrapped = [];
  for (const line of rawLines) {
    const chunks = wrapText(line, maxCharsPerLine, 2);
    for (const chunk of chunks) {
      wrapped.push(chunk);
      if (wrapped.length >= maxLines) return wrapped;
    }
  }
  return wrapped.slice(0, maxLines);
}

// ---------------------------------------------------------------------------
// Variant A: Open Book
// ---------------------------------------------------------------------------

function openBookSvg({ colors, headingLines, previewLines }) {
  const stripWidth = 8;
  const leftMargin = 100;
  const headingStartY = 180;
  const headingLineHeight = 62;

  const headingElements = headingLines
    .map(
      (line, i) =>
        `<text x="${leftMargin}" y="${headingStartY + i * headingLineHeight}" font-family="${FONT_STACK}" font-size="54" font-weight="bold" fill="#2A2017">${escapeXml(line)}</text>`,
    )
    .join("\n  ");

  const verseStartY =
    headingStartY + headingLines.length * headingLineHeight + 40;
  const verseLineHeight = 44;

  const verseElements = previewLines
    .map(
      (line, i) =>
        `<text x="${leftMargin}" y="${verseStartY + i * verseLineHeight}" font-family="${FONT_STACK}" font-size="28" font-style="italic" fill="#4A3F33">${escapeXml(line)}</text>`,
    )
    .join("\n  ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="parchment" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FAF6F0"/>
      <stop offset="100%" stop-color="#F0EBE3"/>
    </linearGradient>
  </defs>

  <rect width="100%" height="100%" fill="url(#parchment)"/>

  <rect x="60" y="80" width="${stripWidth}" height="${HEIGHT - 160}" rx="4" fill="${colors.primary}"/>

  ${headingElements}
  ${verseElements}

  <text x="${leftMargin}" y="576" font-family="${SANS_STACK}" font-size="18" font-weight="600" fill="rgba(42,32,23,0.35)" letter-spacing="2">PORIZO</text>
  <text x="1120" y="576" font-family="${SANS_STACK}" font-size="18" font-weight="500" fill="rgba(42,32,23,0.30)" text-anchor="end">porizo.co</text>
</svg>`;
}

async function generatePoemOgOpenBook({
  title: _title,
  recipientName,
  occasion,
  verses,
}) {
  const sharp = requireSharp();
  if (!sharp) return null;

  const colors = OCCASION_COLORS[occasion] || OCCASION_COLORS.custom;
  const safeName = truncateWithEllipsis(recipientName || "you", 28);
  const heading = `A poem for ${safeName}`;
  const headingLines = wrapText(heading, 28, 2);
  const previewLines = collectPreviewLines(verses, {
    maxLines: 3,
    maxCharsPerLine: 52,
  });

  return sharp(Buffer.from(openBookSvg({ colors, headingLines, previewLines })))
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Variant B: Verse Window
// ---------------------------------------------------------------------------

function verseWindowSvg({ colors, headingLines, previewLines, occasionLabel }) {
  const panelW = 680;
  const panelH = 430;
  const panelX = Math.round((WIDTH - panelW) / 2);
  const panelY = Math.round((HEIGHT - panelH) / 2);
  const textX = panelX + 48;
  const headingStartY = panelY + 72;
  const headingLineHeight = 54;

  const headingElements = headingLines
    .map(
      (line, i) =>
        `<text x="${textX}" y="${headingStartY + i * headingLineHeight}" font-family="${FONT_STACK}" font-size="46" font-weight="bold" fill="#1A1A1A">${escapeXml(line)}</text>`,
    )
    .join("\n  ");

  const verseStartY =
    headingStartY + headingLines.length * headingLineHeight + 32;
  const verseLineHeight = 40;

  const verseElements = previewLines
    .map(
      (line, i) =>
        `<text x="${textX}" y="${verseStartY + i * verseLineHeight}" font-family="${FONT_STACK}" font-size="26" font-style="italic" fill="#3A3A3A">${escapeXml(line)}</text>`,
    )
    .join("\n  ");

  const chipY = verseStartY + previewLines.length * verseLineHeight + 28;
  const chipW = Math.max(140, occasionLabel.length * 13 + 48);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="vivid" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colors.primary}"/>
      <stop offset="100%" stop-color="${colors.secondary}"/>
    </linearGradient>
  </defs>

  <rect width="100%" height="100%" fill="url(#vivid)"/>

  <rect x="${panelX}" y="${panelY}" width="${panelW}" height="${panelH}" rx="24" fill="rgba(255,255,255,0.92)"/>

  ${headingElements}
  ${verseElements}

  <rect x="${textX}" y="${chipY}" width="${chipW}" height="36" rx="18" fill="${colors.primary}" opacity="0.15"/>
  <text x="${textX + chipW / 2}" y="${chipY + 24}" font-family="${SANS_STACK}" font-size="16" font-weight="700" fill="${colors.primary}" letter-spacing="1" text-anchor="middle">${escapeXml(occasionLabel.toUpperCase())}</text>

  <text x="${WIDTH / 2}" y="600" font-family="${SANS_STACK}" font-size="18" font-weight="600" fill="rgba(255,255,255,0.60)" letter-spacing="2" text-anchor="middle">PORIZO</text>
</svg>`;
}

async function generatePoemOgVerseWindow({
  title: _title,
  recipientName,
  occasion,
  verses,
}) {
  const sharp = requireSharp();
  if (!sharp) return null;

  const colors = OCCASION_COLORS[occasion] || OCCASION_COLORS.custom;
  const safeName = truncateWithEllipsis(recipientName || "you", 24);
  const heading = `A poem for ${safeName}`;
  const headingLines = wrapText(heading, 24, 2);
  const previewLines = collectPreviewLines(verses, {
    maxLines: 3,
    maxCharsPerLine: 42,
  });
  const occasionLabel = formatOccasion(occasion, "Poem");

  return sharp(
    Buffer.from(
      verseWindowSvg({ colors, headingLines, previewLines, occasionLabel }),
    ),
  )
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Variant C: Whisper
// ---------------------------------------------------------------------------

function whisperSvg({ colors, nameLines, previewLines }) {
  const nameStartY = 210;
  const nameLineHeight = 80;

  const nameElements = nameLines
    .map(
      (line, i) =>
        `<text x="600" y="${nameStartY + i * nameLineHeight}" font-family="${FONT_STACK}" font-size="72" font-weight="bold" fill="white" text-anchor="middle">${escapeXml(line)}</text>`,
    )
    .join("\n  ");

  // Horizontal accent line (occasion gradient)
  const lineY = nameStartY + nameLines.length * nameLineHeight + 24;

  const verseStartY = lineY + 48;
  const verseLineHeight = 44;

  const verseElements = previewLines
    .map(
      (line, i) =>
        `<text x="600" y="${verseStartY + i * verseLineHeight}" font-family="${FONT_STACK}" font-size="30" font-style="italic" fill="rgba(255,255,255,0.82)" text-anchor="middle">${escapeXml(line)}</text>`,
    )
    .join("\n  ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${colors.primary}" stop-opacity="0"/>
      <stop offset="30%" stop-color="${colors.primary}"/>
      <stop offset="70%" stop-color="${colors.secondary}"/>
      <stop offset="100%" stop-color="${colors.secondary}" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="100%" height="100%" fill="#0C0A08"/>

  <text x="600" y="${nameStartY - 56}" font-family="${SANS_STACK}" font-size="24" font-weight="500" fill="rgba(255,255,255,0.50)" text-anchor="middle">A poem for</text>

  ${nameElements}

  <line x1="300" y1="${lineY}" x2="900" y2="${lineY}" stroke="url(#accent)" stroke-width="2"/>

  ${verseElements}

  <text x="600" y="590" font-family="${SANS_STACK}" font-size="18" font-weight="600" fill="rgba(255,255,255,0.30)" letter-spacing="2" text-anchor="middle">PORIZO</text>
</svg>`;
}

async function generatePoemOgWhisper({
  title: _title,
  recipientName,
  occasion,
  verses,
}) {
  const sharp = requireSharp();
  if (!sharp) return null;

  const colors = OCCASION_COLORS[occasion] || OCCASION_COLORS.custom;
  const safeName = truncateWithEllipsis(recipientName || "you", 28);
  const nameLines = wrapText(safeName, 18, 2);
  const previewLines = collectPreviewLines(verses, {
    maxLines: 3,
    maxCharsPerLine: 40,
  });

  return sharp(Buffer.from(whisperSvg({ colors, nameLines, previewLines })))
    .png()
    .toBuffer();
}

module.exports = {
  generatePoemOgOpenBook,
  generatePoemOgVerseWindow,
  generatePoemOgWhisper,
};
