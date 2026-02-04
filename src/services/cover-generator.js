/**
 * Cover Generator Service
 *
 * Generates programmatic cover art for tracks using sharp.
 * Creates gradient backgrounds based on occasion with styled text overlay.
 *
 * Output sizes:
 * - 3000x3000 (source/master)
 * - 1024x1024 (large - full player)
 * - 256x256 (small - list items)
 */

const path = require("path");
const { ensureDir } = require("../utils/common");

// Occasion-based color schemes (matches iOS DesignTokens)
const OCCASION_COLORS = {
  birthday: {
    primary: "#FF6B9D",    // Pink
    secondary: "#FF8E53",  // Orange
    accent: "#FFD93D",     // Gold
  },
  anniversary: {
    primary: "#E91E63",    // Rose
    secondary: "#9C27B0",  // Purple
    accent: "#FF5722",     // Deep orange
  },
  thank_you: {
    primary: "#4CAF50",    // Green
    secondary: "#2196F3",  // Blue
    accent: "#81C784",     // Light green
  },
  i_love_you: {
    primary: "#E91E63",    // Pink
    secondary: "#C2185B",  // Deep pink
    accent: "#FF80AB",     // Light pink
  },
  wedding: {
    primary: "#9C27B0",    // Purple
    secondary: "#673AB7",  // Deep purple
    accent: "#E1BEE7",     // Light purple
  },
  graduation: {
    primary: "#3F51B5",    // Indigo
    secondary: "#1A237E",  // Deep indigo
    accent: "#FFD700",     // Gold
  },
  celebration: {
    primary: "#FF9800",    // Orange
    secondary: "#F57C00",  // Deep orange
    accent: "#FFEB3B",     // Yellow
  },
  apology: {
    primary: "#607D8B",    // Blue grey
    secondary: "#455A64",  // Deep blue grey
    accent: "#90CAF9",     // Light blue
  },
  encouragement: {
    primary: "#00BCD4",    // Cyan
    secondary: "#0097A7",  // Deep cyan
    accent: "#4DD0E1",     // Light cyan
  },
  custom: {
    primary: "#9E9E9E",    // Grey
    secondary: "#616161",  // Deep grey
    accent: "#D4AF37",     // Gold
  },
};

// Style-based patterns (subtle variations)
const STYLE_PATTERNS = {
  pop: { rotation: 15, blur: 0 },
  acoustic: { rotation: -10, blur: 2 },
  soul: { rotation: 0, blur: 1 },
  folk: { rotation: -5, blur: 3 },
  jazz: { rotation: 20, blur: 1 },
  rnb: { rotation: 5, blur: 0 },
  rock: { rotation: -15, blur: 0 },
  country: { rotation: 10, blur: 2 },
  afrobeats: { rotation: 25, blur: 0 },
  reggaeton: { rotation: -20, blur: 1 },
  default: { rotation: 0, blur: 1 },
};

/**
 * Generate cover images for a track
 *
 * @param {Object} params
 * @param {string} params.versionDir - Directory to save covers to
 * @param {Object} params.track - Track metadata (occasion, style, recipient_name, title)
 * @param {Object} params.trackVersion - Track version with id
 * @param {string} params.streamBaseUrl - Base URL for serving covers
 * @returns {Promise<{coverUrl: string, smallUrl: string, largeUrl: string}>}
 */
async function generateCover({ versionDir, track, trackVersion, streamBaseUrl }) {
  // Lazy load sharp to avoid startup penalty if not used
  let sharp;
  try {
    sharp = require("sharp");
  } catch (err) {
    console.warn("[CoverGenerator] sharp not installed, skipping cover generation");
    return null;
  }

  ensureDir(versionDir);

  const occasion = track.occasion || "custom";
  const style = track.style || "default";
  const recipientName = track.recipient_name || "";
  const title = track.title || "Your Song";

  const colors = OCCASION_COLORS[occasion] || OCCASION_COLORS.custom;
  const pattern = STYLE_PATTERNS[style] || STYLE_PATTERNS.default;

  // Generate 3000x3000 source image with gradient and text
  const sourceSize = 3000;
  const svgContent = generateSVG({
    width: sourceSize,
    height: sourceSize,
    colors,
    pattern,
    title,
    recipientName,
    occasion,
  });

  // Create source image
  const sourcePath = path.join(versionDir, "cover_3000.jpg");
  await sharp(Buffer.from(svgContent))
    .jpeg({ quality: 90 })
    .toFile(sourcePath);

  // Generate size variants
  const sizes = [
    { name: "cover_1024.jpg", size: 1024 },
    { name: "cover_256.jpg", size: 256 },
  ];

  for (const { name, size } of sizes) {
    const outputPath = path.join(versionDir, name);
    await sharp(sourcePath)
      .resize(size, size)
      .jpeg({ quality: 85 })
      .toFile(outputPath);
  }

  // Build URLs
  const baseUrl = `${streamBaseUrl}/cover/${trackVersion.id}`;

  console.log(`[CoverGenerator] Generated covers for track ${track.id} version ${trackVersion.version_num}`);

  return {
    coverUrl: `${baseUrl}/1024`,
    smallUrl: `${baseUrl}/256`,
    largeUrl: `${baseUrl}/1024`,
  };
}

/**
 * Generate SVG content for cover art
 */
function generateSVG({ width, height, colors, pattern, title, recipientName, occasion }) {
  // Calculate text sizes based on canvas size
  const titleSize = Math.floor(width * 0.08);  // 8% of width
  const subtitleSize = Math.floor(width * 0.04);  // 4% of width
  const occasionSize = Math.floor(width * 0.035);  // 3.5% of width

  // Truncate title if too long
  const displayTitle = title.length > 20 ? title.substring(0, 18) + "…" : title;
  const displayRecipient = recipientName ? `For ${recipientName}` : "";

  // Occasion display name
  const occasionDisplay = formatOccasion(occasion);

  // Create gradient with rotation based on style
  const gradientRotation = pattern.rotation;
  const x1 = 50 - Math.cos((gradientRotation * Math.PI) / 180) * 50;
  const y1 = 50 - Math.sin((gradientRotation * Math.PI) / 180) * 50;
  const x2 = 50 + Math.cos((gradientRotation * Math.PI) / 180) * 50;
  const y2 = 50 + Math.sin((gradientRotation * Math.PI) / 180) * 50;

  // XML escape text content
  const safeTitle = escapeXml(displayTitle);
  const safeRecipient = escapeXml(displayRecipient);
  const safeOccasion = escapeXml(occasionDisplay);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">
      <stop offset="0%" style="stop-color:${colors.primary}"/>
      <stop offset="50%" style="stop-color:${colors.secondary}"/>
      <stop offset="100%" style="stop-color:${colors.primary}"/>
    </linearGradient>
    <filter id="blur">
      <feGaussianBlur stdDeviation="${pattern.blur * 10}"/>
    </filter>
    <linearGradient id="textGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:white"/>
      <stop offset="100%" style="stop-color:rgba(255,255,255,0.9)"/>
    </linearGradient>
  </defs>

  <!-- Background gradient -->
  <rect width="100%" height="100%" fill="url(#bg)"/>

  <!-- Decorative circles (blurred) -->
  <circle cx="${width * 0.2}" cy="${height * 0.3}" r="${width * 0.25}" fill="${colors.accent}" opacity="0.15" filter="url(#blur)"/>
  <circle cx="${width * 0.8}" cy="${height * 0.7}" r="${width * 0.3}" fill="${colors.accent}" opacity="0.1" filter="url(#blur)"/>
  <circle cx="${width * 0.5}" cy="${height * 0.1}" r="${width * 0.15}" fill="white" opacity="0.05" filter="url(#blur)"/>

  <!-- Accent line at bottom -->
  <rect x="0" y="${height * 0.92}" width="100%" height="${height * 0.08}" fill="${colors.accent}" opacity="0.3"/>

  <!-- Title text -->
  <text x="50%" y="45%" font-family="SF Pro Display, -apple-system, Helvetica Neue, Arial, sans-serif" font-size="${titleSize}" font-weight="700" fill="white" text-anchor="middle" dominant-baseline="middle">
    <tspan filter="drop-shadow(0 4px 8px rgba(0,0,0,0.3))">${safeTitle}</tspan>
  </text>

  <!-- Recipient text -->
  ${displayRecipient ? `
  <text x="50%" y="55%" font-family="SF Pro Display, -apple-system, Helvetica Neue, Arial, sans-serif" font-size="${subtitleSize}" font-weight="500" fill="rgba(255,255,255,0.85)" text-anchor="middle" dominant-baseline="middle">
    ${safeRecipient}
  </text>
  ` : ""}

  <!-- Occasion badge -->
  <text x="50%" y="${height * 0.85}" font-family="SF Pro Display, -apple-system, Helvetica Neue, Arial, sans-serif" font-size="${occasionSize}" font-weight="600" fill="${colors.accent}" text-anchor="middle" text-transform="uppercase" letter-spacing="0.1em">
    ${safeOccasion}
  </text>

  <!-- Porizo branding (subtle) -->
  <text x="50%" y="${height * 0.96}" font-family="SF Pro Display, -apple-system, Helvetica Neue, Arial, sans-serif" font-size="${Math.floor(width * 0.02)}" font-weight="400" fill="rgba(255,255,255,0.4)" text-anchor="middle">
    Made with Porizo
  </text>
</svg>`;
}

/**
 * Format occasion for display
 */
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
    custom: "Custom Song",
  };
  return mapping[occasion] || "Song";
}

/**
 * Escape XML special characters
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
 * Check if sharp is available
 */
function isSharpAvailable() {
  try {
    require("sharp");
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  generateCover,
  isSharpAvailable,
  OCCASION_COLORS,
};
