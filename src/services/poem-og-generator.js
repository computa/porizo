/**
 * Poem OG Image Generator
 *
 * Builds a branded 1200x630 social preview image for poem shares.
 * Optimized for readability in Facebook/WhatsApp/X link cards.
 */

const { OCCASION_COLORS } = require("./cover-generator");

const WIDTH = 1200;
const HEIGHT = 630;
const PANEL_X = 80;
const PANEL_Y = 86;
const PANEL_W = 360;
const PANEL_H = 460;

function escapeXml(str) {
  if (!str) return "";
  return String(str)
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

function collectPoemPreviewLines(verses, { maxLines = 3, maxCharsPerLine = 44 } = {}) {
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
    const lines = sourceLines.map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      rawLines.push(line);
      if (rawLines.length >= maxLines * 2) break;
    }
    if (rawLines.length >= maxLines * 2) break;
  }

  if (!rawLines.length) {
    return ["A poem written just for you."];
  }

  const wrapped = [];
  for (const line of rawLines) {
    const lineWrap = wrapText(line, maxCharsPerLine, 2);
    for (const chunk of lineWrap) {
      wrapped.push(chunk);
      if (wrapped.length >= maxLines) {
        return wrapped;
      }
    }
  }
  return wrapped.slice(0, maxLines);
}

function buildBaseSvg({ colors }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0B0B12"/>
      <stop offset="45%" stop-color="${colors.secondary}"/>
      <stop offset="100%" stop-color="#0A0C12"/>
    </linearGradient>
    <radialGradient id="glowA" cx="20%" cy="22%" r="58%">
      <stop offset="0%" stop-color="${colors.primary}" stop-opacity="0.52"/>
      <stop offset="100%" stop-color="${colors.primary}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowB" cx="84%" cy="84%" r="54%">
      <stop offset="0%" stop-color="${colors.accent}" stop-opacity="0.32"/>
      <stop offset="100%" stop-color="${colors.accent}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="panel" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.15)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0.05)"/>
    </linearGradient>
    <linearGradient id="divider" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="rgba(255,255,255,0)"/>
      <stop offset="50%" stop-color="rgba(255,255,255,0.42)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </linearGradient>
  </defs>

  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect width="100%" height="100%" fill="url(#glowA)"/>
  <rect width="100%" height="100%" fill="url(#glowB)"/>

  <rect x="${PANEL_X}" y="${PANEL_Y}" width="${PANEL_W}" height="${PANEL_H}" rx="42" fill="url(#panel)" stroke="rgba(255,255,255,0.16)" stroke-width="1.5"/>
</svg>`;
}

function buildLeftPanelSvg({ colors }) {
  const iconX = PANEL_X + 68;
  const iconY = PANEL_Y + 56;
  const iconSize = 224;
  const quoteY = PANEL_Y + 336;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bookCard" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colors.primary}"/>
      <stop offset="100%" stop-color="${colors.secondary}"/>
    </linearGradient>
  </defs>

  <rect x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" rx="34" fill="url(#bookCard)"/>
  <circle cx="${iconX + iconSize / 2}" cy="${iconY + iconSize / 2}" r="72" fill="rgba(255,255,255,0.2)"/>
  <text x="${iconX + iconSize / 2}" y="${iconY + iconSize / 2 + 30}" font-family="'Avenir Next', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif" font-size="106" font-weight="600" fill="white" text-anchor="middle">&#10077;</text>

  <text x="${PANEL_X + PANEL_W / 2}" y="${quoteY}" font-family="'Avenir Next', 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif" font-size="26" fill="rgba(255,255,255,0.88)" text-anchor="middle">Someone wrote you</text>
  <text x="${PANEL_X + PANEL_W / 2}" y="${quoteY + 42}" font-family="'Avenir Next', 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif" font-size="34" font-weight="680" fill="white" text-anchor="middle">a poem</text>
</svg>`;
}

function buildTextSvg({
  recipientName,
  occasionLabel,
  titleLines,
  previewLines,
}) {
  const safeRecipient = escapeXml(recipientName || "you");
  const safeOccasion = escapeXml(occasionLabel.toUpperCase());
  const headingLine1 = `A poem for ${safeRecipient}`;
  const headingLines = wrapText(headingLine1, 24, 2);
  const resolvedHeading = headingLines.length ? headingLines : ["A poem for you"];
  const headingElements = resolvedHeading.map((line, index) => (
    `<text x="500" y="${176 + index * 66}" font-family="'Avenir Next', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif" font-size="58" font-weight="750" fill="white">${escapeXml(line)}</text>`
  )).join("\n  ");

  const occasionChipWidth = Math.max(176, Math.min(320, occasionLabel.length * 14 + 76));
  const occasionChipX = 500;
  const poemTitle = titleLines.length ? titleLines : ["A personalized poem"];
  const titleElements = poemTitle.map((line, index) => (
    `<text x="500" y="${312 + index * 44}" font-family="'Avenir Next', 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif" font-size="36" font-weight="620" fill="rgba(255,255,255,0.9)">${escapeXml(line)}</text>`
  )).join("\n  ");

  const previewStartY = 430;
  const previewElements = previewLines.map((line, index) => (
    `<text x="500" y="${previewStartY + index * 42}" font-family="Georgia, 'Times New Roman', serif" font-size="31" font-style="italic" fill="rgba(255,255,255,0.9)">${escapeXml(line)}</text>`
  )).join("\n  ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect x="500" y="88" width="196" height="38" rx="19" fill="rgba(255,255,255,0.16)"/>
  <text x="598" y="113" font-family="'Avenir Next', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif" font-size="17" font-weight="700" letter-spacing="1.1" fill="white" text-anchor="middle">PORIZO POEM</text>

  ${headingElements}

  <rect x="${occasionChipX}" y="244" width="${occasionChipWidth}" height="50" rx="25" fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.24)" stroke-width="1"/>
  <text x="${occasionChipX + occasionChipWidth / 2}" y="276" font-family="'Avenir Next', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif" font-size="22" font-weight="700" letter-spacing="1.1" fill="white" text-anchor="middle">${safeOccasion}</text>

  ${titleElements}

  <line x1="500" y1="388" x2="1090" y2="388" stroke="rgba(255,255,255,0.24)" stroke-width="2"/>
  ${previewElements}

  <text x="500" y="574" font-family="'Avenir Next', 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif" font-size="27" font-weight="560" fill="rgba(255,255,255,0.84)">Tap to read full poem</text>
  <text x="1120" y="594" font-family="'Avenir Next', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif" font-size="21" font-weight="600" fill="rgba(255,255,255,0.58)" text-anchor="end">porizo.co</text>
</svg>`;
}

/**
 * Generate a 1200x630 OG image for poem sharing.
 */
async function generatePoemOgImage({ title, recipientName, occasion, verses }) {
  let sharp;
  try {
    sharp = require("sharp");
  } catch (err) {
    console.warn("[PoemOgGenerator] sharp not installed, skipping OG image generation");
    return null;
  }

  const colors = OCCASION_COLORS[occasion] || OCCASION_COLORS.custom;
  const safeTitle = truncateWithEllipsis(title || "A personalized poem", 56);
  const titleLines = wrapText(safeTitle, 28, 2);
  const previewLines = collectPoemPreviewLines(verses, {
    maxLines: 3,
    maxCharsPerLine: 42,
  });
  const occasionLabel = formatOccasion(occasion);

  const image = await sharp(Buffer.from(buildBaseSvg({ colors })))
    .composite([
      { input: Buffer.from(buildLeftPanelSvg({ colors })), left: 0, top: 0 },
      {
        input: Buffer.from(
          buildTextSvg({
            recipientName: truncateWithEllipsis(recipientName || "you", 30),
            occasionLabel,
            titleLines,
            previewLines,
          })
        ),
        left: 0,
        top: 0,
      },
    ])
    .png({ quality: 90 })
    .toBuffer();

  console.log(
    `[PoemOgGenerator] Generated OG image for poem "${safeTitle}" (${previewLines.length} preview lines)`
  );
  return image;
}

module.exports = { generatePoemOgImage };
