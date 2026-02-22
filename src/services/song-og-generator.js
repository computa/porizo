/**
 * Song OG Image Generator
 *
 * Builds a branded 1200x630 social preview image for song shares.
 * The output is optimized for Facebook/Twitter/LinkedIn link cards.
 */

const { OCCASION_COLORS } = require("./cover-generator");

const WIDTH = 1200;
const HEIGHT = 630;
const COVER_SIZE = 390;

function escapeXml(value) {
  if (!value) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatOccasion(occasion) {
  const mapping = {
    birthday: "Birthday",
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
    custom: "Personalized Song",
  };
  return mapping[occasion] || "Personalized Song";
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

function buildBaseSvg({ colors, brandName }) {
  const safeBrandName = escapeXml(brandName.toUpperCase());
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#090B10"/>
      <stop offset="45%" stop-color="${colors.secondary}"/>
      <stop offset="100%" stop-color="#0A0C13"/>
    </linearGradient>
    <radialGradient id="glowA" cx="20%" cy="22%" r="56%">
      <stop offset="0%" stop-color="${colors.primary}" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="${colors.primary}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowB" cx="80%" cy="85%" r="52%">
      <stop offset="0%" stop-color="${colors.accent}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${colors.accent}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="panel" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.12)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0.03)"/>
    </linearGradient>
  </defs>

  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect width="100%" height="100%" fill="url(#glowA)"/>
  <rect width="100%" height="100%" fill="url(#glowB)"/>

  <rect x="64" y="72" width="464" height="486" rx="48" fill="url(#panel)" stroke="rgba(255,255,255,0.15)" stroke-width="1.5"/>

  <rect x="560" y="86" width="224" height="42" rx="21" fill="rgba(255,255,255,0.14)" />
  <text x="672" y="113" font-family="'Avenir Next', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif" font-size="18" font-weight="700" fill="white" letter-spacing="1.2" text-anchor="middle">${safeBrandName} ORIGINAL</text>

  <text x="1120" y="594" font-family="'Avenir Next', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif" font-size="21" font-weight="600" fill="rgba(255,255,255,0.60)" text-anchor="end">porizo.co</text>
</svg>`;
}

function buildTextSvg({ titleLines, subtitle, occasionLabel, brandName }) {
  const safeBrandName = escapeXml(brandName);
  const safeSubtitle = escapeXml(subtitle);
  const safeOccasion = escapeXml(occasionLabel.toUpperCase());
  const occasionChipWidth = Math.max(180, Math.min(360, occasionLabel.length * 16 + 84));
  const occasionChipX = 560;
  const titleStartY = 222;
  const titleLineHeight = 72;

  const titleElements = titleLines.map((line, index) => {
    const y = titleStartY + index * titleLineHeight;
    return `<text x="560" y="${y}" font-family="'Avenir Next', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif" font-size="62" font-weight="750" fill="white">${escapeXml(line)}</text>`;
  }).join("\n  ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  ${titleElements}

  <text x="560" y="370" font-family="'Avenir Next', 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif" font-size="38" font-weight="600" fill="rgba(255,255,255,0.90)">${safeSubtitle}</text>

  <rect x="${occasionChipX}" y="403" width="${occasionChipWidth}" height="54" rx="27" fill="rgba(255,255,255,0.13)" stroke="rgba(255,255,255,0.24)" stroke-width="1"/>
  <text x="${occasionChipX + occasionChipWidth / 2}" y="437" font-family="'Avenir Next', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif" font-size="24" font-weight="700" letter-spacing="1.2" fill="white" text-anchor="middle">${safeOccasion}</text>

  <text x="560" y="506" font-family="'Avenir Next', 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif" font-size="30" font-weight="500" fill="rgba(255,255,255,0.84)">Tap to listen</text>

  <line x1="560" y1="534" x2="1088" y2="534" stroke="rgba(255,255,255,0.22)" stroke-width="2"/>
  <text x="560" y="572" font-family="'Avenir Next', 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif" font-size="22" font-weight="500" fill="rgba(255,255,255,0.55)">Made for sharing by ${safeBrandName}</text>
</svg>`;
}

function buildPlaceholderCoverSvg({ colors }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${COVER_SIZE}" height="${COVER_SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="coverBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colors.primary}"/>
      <stop offset="100%" stop-color="${colors.secondary}"/>
    </linearGradient>
  </defs>
  <rect width="${COVER_SIZE}" height="${COVER_SIZE}" rx="38" fill="url(#coverBg)"/>
  <circle cx="${COVER_SIZE / 2}" cy="${COVER_SIZE / 2}" r="92" fill="rgba(255,255,255,0.20)"/>
  <text x="${COVER_SIZE / 2}" y="${COVER_SIZE / 2 + 36}" font-family="'Avenir Next', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif" font-size="128" font-weight="600" fill="white" text-anchor="middle">&#9835;</text>
</svg>`;
}

function buildCoverShadowSvg() {
  const shadowSize = COVER_SIZE + 44;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${shadowSize}" height="${shadowSize}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="10"/>
      <feOffset dx="0" dy="10" result="offsetblur"/>
      <feComponentTransfer>
        <feFuncA type="linear" slope="0.55"/>
      </feComponentTransfer>
      <feMerge>
        <feMergeNode/>
      </feMerge>
    </filter>
  </defs>
  <rect x="22" y="12" width="${COVER_SIZE}" height="${COVER_SIZE}" rx="38" fill="black" filter="url(#shadow)"/>
</svg>`;
}

/**
 * Generate a branded 1200x630 song OG image.
 *
 * @param {Object} params
 * @param {string} params.title
 * @param {string} params.recipientName
 * @param {string} params.occasion
 * @param {string|null} params.coverPath
 * @param {string} [params.brandName]
 * @returns {Promise<Buffer|null>} JPEG buffer or null if sharp unavailable
 */
async function generateSongOgImage({ title, recipientName, occasion, coverPath, brandName = "Porizo" }) {
  let sharp;
  try {
    sharp = require("sharp");
  } catch (err) {
    console.warn("[SongOgGenerator] sharp not installed, skipping OG image generation");
    return null;
  }

  const colors = OCCASION_COLORS[occasion] || OCCASION_COLORS.custom;
  const safeTitle = truncateWithEllipsis(title || "Someone made you a song", 64);
  const safeRecipient = truncateWithEllipsis(recipientName || "", 38);
  const titleLines = wrapText(safeTitle, 24, 2);
  const subtitle = safeRecipient
    ? `A song for ${safeRecipient}`
    : "A personalized song made just for you";
  const occasionLabel = formatOccasion(occasion);

  const coverMask = Buffer.from(
    `<svg width="${COVER_SIZE}" height="${COVER_SIZE}" xmlns="http://www.w3.org/2000/svg"><rect width="${COVER_SIZE}" height="${COVER_SIZE}" rx="38" fill="white"/></svg>`
  );

  let artworkBuffer = null;
  if (coverPath) {
    try {
      artworkBuffer = await sharp(coverPath)
        .resize(COVER_SIZE, COVER_SIZE, { fit: "cover", position: "center" })
        .composite([{ input: coverMask, blend: "dest-in" }])
        .jpeg({ quality: 90 })
        .toBuffer();
    } catch (err) {
      console.warn(`[SongOgGenerator] Failed to use cover at ${coverPath}:`, err.message);
    }
  }

  if (!artworkBuffer) {
    artworkBuffer = await sharp(Buffer.from(buildPlaceholderCoverSvg({ colors })))
      .png()
      .toBuffer();
  }

  const base = sharp(Buffer.from(buildBaseSvg({ colors, brandName })));
  const finalBuffer = await base
    .composite([
      { input: Buffer.from(buildCoverShadowSvg()), left: 82, top: 109 },
      { input: artworkBuffer, left: 100, top: 120 },
      {
        input: Buffer.from(
          buildTextSvg({
            titleLines: titleLines.length ? titleLines : ["Someone made", "you a song"],
            subtitle,
            occasionLabel,
            brandName,
          })
        ),
        left: 0,
        top: 0,
      },
    ])
    .jpeg({ quality: 90 })
    .toBuffer();

  return finalBuffer;
}

module.exports = {
  generateSongOgImage,
};
