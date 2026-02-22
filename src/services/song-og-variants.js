/**
 * Song OG Image Variants
 *
 * Three design variants for song share OG images (1200x630 JPEG).
 * Used by the debug preview page for visual comparison before selecting
 * a final production design.
 *
 * Variants:
 *   A: "Spotlight"      — Near-black bg with radial spotlight cone
 *   B: "Gilt Envelope"  — Diagonal occasion sash with deep warm dark
 *   C: "Greeting Card"  — Light warm cream/blush, dark text, max contrast
 */

const { OCCASION_COLORS } = require("./cover-generator");
const {
  escapeXml,
  truncateWithEllipsis,
  wrapText,
  formatOccasion,
} = require("./og-text-utils");

const WIDTH = 1200;
const HEIGHT = 630;
const COVER_SIZE = 160;
const FONT_STACK = "Georgia, 'Times New Roman', serif";
const SANS_STACK = "'Avenir Next', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireSharp() {
  try {
    return require("sharp");
  } catch {
    console.warn("[SongOgVariants] sharp not installed, skipping OG image generation");
    return null;
  }
}

function buildPlaceholderCover(colors, size) {
  return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="coverBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colors.primary}"/>
      <stop offset="100%" stop-color="${colors.secondary}"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="20" fill="url(#coverBg)"/>
  <text x="${size / 2}" y="${size / 2 + 22}" font-family="${SANS_STACK}" font-size="72" font-weight="600" fill="white" text-anchor="middle">&#9835;</text>
</svg>`;
}

async function loadCover(sharp, coverPath, colors, size) {
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" rx="20" fill="white"/></svg>`
  );

  if (coverPath) {
    try {
      return await sharp(coverPath)
        .resize(size, size, { fit: "cover", position: "center" })
        .composite([{ input: mask, blend: "dest-in" }])
        .png()
        .toBuffer();
    } catch {
      // fall through to placeholder
    }
  }

  return sharp(Buffer.from(buildPlaceholderCover(colors, size))).png().toBuffer();
}

// ---------------------------------------------------------------------------
// Variant A: Spotlight
// ---------------------------------------------------------------------------

function spotlightSvg({ colors, titleLines, preamble, songTitle, brandName }) {
  const safeBrand = escapeXml(brandName.toUpperCase());
  const titleStartY = 260;
  const titleLineHeight = 88;

  const nameElements = titleLines.map((line, i) =>
    `<text x="600" y="${titleStartY + i * titleLineHeight}" font-family="${FONT_STACK}" font-size="80" font-weight="bold" fill="white" text-anchor="middle">${escapeXml(line)}</text>`
  ).join("\n  ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="spot" cx="50%" cy="0%" r="70%">
      <stop offset="0%" stop-color="${colors.primary}" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="${colors.primary}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="100%" height="100%" fill="#0A0A0A"/>
  <rect width="100%" height="100%" fill="url(#spot)"/>

  <text x="600" y="${titleStartY - 56}" font-family="${SANS_STACK}" font-size="28" font-weight="500" fill="rgba(255,255,255,0.65)" text-anchor="middle">${escapeXml(preamble)}</text>

  ${nameElements}

  <text x="600" y="${titleStartY + titleLines.length * titleLineHeight + 20}" font-family="${SANS_STACK}" font-size="32" font-weight="500" fill="rgba(255,255,255,0.72)" text-anchor="middle">${escapeXml(songTitle)}</text>

  <text x="600" y="590" font-family="${SANS_STACK}" font-size="18" font-weight="600" fill="rgba(255,255,255,0.40)" letter-spacing="2" text-anchor="middle">${safeBrand}</text>
</svg>`;
}

async function generateSongOgSpotlight({ title, recipientName, occasion, coverPath, brandName = "Porizo" }) {
  const sharp = requireSharp();
  if (!sharp) return null;

  const colors = OCCASION_COLORS[occasion] || OCCASION_COLORS.custom;
  const safeName = truncateWithEllipsis(recipientName || "You", 28);
  const nameLines = wrapText(safeName, 18, 2);
  const safeTitle = truncateWithEllipsis(title || "A personalized song", 48);
  const preamble = "A song for";
  const songTitle = `"${safeTitle}"`;

  const coverBuffer = await loadCover(sharp, coverPath, colors, COVER_SIZE);

  const base = sharp(Buffer.from(spotlightSvg({ colors, titleLines: nameLines, preamble, songTitle, brandName })));
  return base
    .composite([
      { input: coverBuffer, left: WIDTH - COVER_SIZE - 60, top: Math.round((HEIGHT - COVER_SIZE) / 2) },
    ])
    .jpeg({ quality: 90 })
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Variant B: Gilt Envelope
// ---------------------------------------------------------------------------

function envelopeSvg({ colors, nameLines, songTitle, brandName }) {
  const safeBrand = escapeXml(brandName.toUpperCase());
  const nameStartY = 220;
  const nameLineHeight = 80;

  const nameElements = nameLines.map((line, i) =>
    `<text x="80" y="${nameStartY + i * nameLineHeight}" font-family="${FONT_STACK}" font-size="72" font-weight="bold" fill="white">${escapeXml(line)}</text>`
  ).join("\n  ");

  // Diagonal sash: top-left corner sweeping to center-right
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="sash" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colors.primary}"/>
      <stop offset="100%" stop-color="${colors.secondary}"/>
    </linearGradient>
  </defs>

  <rect width="100%" height="100%" fill="#0F0D0B"/>

  <polygon points="0,0 850,0 650,${HEIGHT} 0,${HEIGHT}" fill="url(#sash)" opacity="0.85"/>

  <text x="80" y="60" font-family="${SANS_STACK}" font-size="18" font-weight="700" fill="rgba(255,255,255,0.70)" letter-spacing="2">${safeBrand}</text>

  ${nameElements}

  <text x="80" y="${nameStartY + nameLines.length * nameLineHeight + 16}" font-family="${SANS_STACK}" font-size="36" font-weight="500" fill="rgba(255,255,255,0.85)">${escapeXml(songTitle)}</text>

  <text x="1120" y="594" font-family="${SANS_STACK}" font-size="21" font-weight="600" fill="rgba(255,255,255,0.45)" text-anchor="end">porizo.co</text>
</svg>`;
}

async function generateSongOgEnvelope({ title, recipientName, occasion, coverPath, brandName = "Porizo" }) {
  const sharp = requireSharp();
  if (!sharp) return null;

  const colors = OCCASION_COLORS[occasion] || OCCASION_COLORS.custom;
  const safeName = truncateWithEllipsis(recipientName || "You", 28);
  const nameLines = wrapText(safeName, 16, 2);
  const safeTitle = truncateWithEllipsis(title || "A personalized song", 40);
  const songTitle = `"${safeTitle}"`;

  const coverSize = 200;
  const coverBuffer = await loadCover(sharp, coverPath, colors, coverSize);

  const base = sharp(Buffer.from(envelopeSvg({ colors, nameLines, songTitle, brandName })));
  return base
    .composite([
      { input: coverBuffer, left: WIDTH - coverSize - 60, top: HEIGHT - coverSize - 40 },
    ])
    .jpeg({ quality: 90 })
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Variant C: Greeting Card
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function lighten(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const mix = (c) => Math.min(255, Math.round(c + (255 - c) * amount));
  const toHex = (c) => mix(c).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function greetingCardSvg({ colors, nameLines, songTitle, occasionLabel }) {
  const bg1 = lighten(colors.primary, 0.88);
  const bg2 = lighten(colors.secondary, 0.92);
  const textColor = "#1A1A1A";
  const subtextColor = "#4A4A4A";
  const nameStartY = 260;
  const nameLineHeight = 76;

  const nameElements = nameLines.map((line, i) =>
    `<text x="600" y="${nameStartY + i * nameLineHeight}" font-family="${FONT_STACK}" font-size="68" font-weight="bold" fill="${textColor}" text-anchor="middle">${escapeXml(line)}</text>`
  ).join("\n  ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${bg1}"/>
      <stop offset="100%" stop-color="${bg2}"/>
    </linearGradient>
  </defs>

  <rect width="100%" height="100%" fill="url(#bg)"/>

  <text x="600" y="${nameStartY - 50}" font-family="${SANS_STACK}" font-size="26" font-weight="500" fill="${subtextColor}" text-anchor="middle">For</text>

  ${nameElements}

  <text x="600" y="${nameStartY + nameLines.length * nameLineHeight + 16}" font-family="${SANS_STACK}" font-size="30" font-weight="500" fill="${subtextColor}" text-anchor="middle">${escapeXml(songTitle)}</text>

  <text x="600" y="${nameStartY + nameLines.length * nameLineHeight + 60}" font-family="${SANS_STACK}" font-size="22" font-weight="600" fill="${colors.primary}" letter-spacing="1" text-anchor="middle">${escapeXml(occasionLabel.toUpperCase())}</text>

  <text x="600" y="596" font-family="${SANS_STACK}" font-size="18" font-weight="600" fill="rgba(0,0,0,0.30)" letter-spacing="2" text-anchor="middle">PORIZO</text>
</svg>`;
}

async function generateSongOgGreetingCard({ title, recipientName, occasion, coverPath, brandName: _brandName = "Porizo" }) {
  const sharp = requireSharp();
  if (!sharp) return null;

  const colors = OCCASION_COLORS[occasion] || OCCASION_COLORS.custom;
  const safeName = truncateWithEllipsis(recipientName || "You", 28);
  const nameLines = wrapText(`${safeName}`, 18, 2);
  const safeTitle = truncateWithEllipsis(title || "A personalized song", 44);
  const songTitle = `"${safeTitle}"`;
  const occasionLabel = formatOccasion(occasion, "Personalized Song");

  const coverSize = 180;
  const coverBuffer = await loadCover(sharp, coverPath, colors, coverSize);

  const base = sharp(Buffer.from(greetingCardSvg({ colors, nameLines, songTitle, occasionLabel })));
  return base
    .composite([
      { input: coverBuffer, left: Math.round((WIDTH - coverSize) / 2), top: 36 },
    ])
    .jpeg({ quality: 90 })
    .toBuffer();
}

module.exports = {
  generateSongOgSpotlight,
  generateSongOgEnvelope,
  generateSongOgGreetingCard,
};
