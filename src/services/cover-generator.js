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
const fs = require("fs");
const { ensureDir } = require("../utils/common");
const {
  escapeXml,
  formatOccasion,
  detectDirection,
  localizedForPrefix,
} = require("../utils/og-text-utils");

// Occasion-based color schemes (matches iOS DesignTokens)
const OCCASION_COLORS = {
  birthday: {
    primary: "#FF6B9D", // Pink
    secondary: "#FF8E53", // Orange
    accent: "#FFD93D", // Gold
  },
  anniversary: {
    primary: "#E91E63", // Rose
    secondary: "#9C27B0", // Purple
    accent: "#FF5722", // Deep orange
  },
  thank_you: {
    primary: "#4CAF50", // Green
    secondary: "#2196F3", // Blue
    accent: "#81C784", // Light green
  },
  i_love_you: {
    primary: "#E91E63", // Pink
    secondary: "#C2185B", // Deep pink
    accent: "#FF80AB", // Light pink
  },
  wedding: {
    primary: "#9C27B0", // Purple
    secondary: "#673AB7", // Deep purple
    accent: "#E1BEE7", // Light purple
  },
  graduation: {
    primary: "#3F51B5", // Indigo
    secondary: "#1A237E", // Deep indigo
    accent: "#FFD700", // Gold
  },
  celebration: {
    primary: "#FF9800", // Orange
    secondary: "#F57C00", // Deep orange
    accent: "#FFEB3B", // Yellow
  },
  apology: {
    primary: "#607D8B", // Blue grey
    secondary: "#455A64", // Deep blue grey
    accent: "#90CAF9", // Light blue
  },
  encouragement: {
    primary: "#00BCD4", // Cyan
    secondary: "#0097A7", // Deep cyan
    accent: "#4DD0E1", // Light cyan
  },
  advice: {
    primary: "#5D8AA8", // Air force blue
    secondary: "#3E5C76", // Steel blue
    accent: "#C8E1F0", // Light blue tint
  },
  bereavement: {
    primary: "#6B6F82", // Slate grey
    secondary: "#4A4E61", // Charcoal slate
    accent: "#C7CBD8", // Soft silver
  },
  mothers_day: {
    primary: "#F5A8A8", // Soft blush rose
    secondary: "#9CAF88", // Muted sage green
    accent: "#FFF0E6", // Pale ivory
  },
  friendship: {
    primary: "#C97B5C", // Warm terracotta
    secondary: "#9CAF88", // Sage green
    accent: "#F4E4D7", // Warm cream
  },
  get_well: {
    primary: "#E8B658", // Honey amber
    secondary: "#F4E07A", // Pale yellow
    accent: "#FFFBEA", // Cream
  },
  custom: {
    primary: "#9E9E9E", // Grey
    secondary: "#616161", // Deep grey
    accent: "#D4AF37", // Gold
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
  highlife: { rotation: 18, blur: 1 },
  ogene: { rotation: 22, blur: 0 },
  juju: { rotation: 12, blur: 1 },
  fuji: { rotation: 20, blur: 0 },
  afropop: { rotation: 16, blur: 1 },
  reggaeton: { rotation: -20, blur: 1 },
  salsa: { rotation: -24, blur: 0 },
  bossa_nova: { rotation: -8, blur: 2 },
  cumbia: { rotation: -14, blur: 1 },
  bachata: { rotation: -10, blur: 1 },
  samba: { rotation: -18, blur: 0 },
  latin_pop: { rotation: -12, blur: 1 },
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
async function generateCover({
  versionDir,
  track,
  trackVersion,
  streamBaseUrl,
}) {
  // Lazy load sharp to avoid startup penalty if not used
  let sharp;
  try {
    sharp = require("sharp");
  } catch (err) {
    console.warn(
      "[CoverGenerator] sharp not installed, skipping cover generation",
    );
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
  await sharp(Buffer.from(svgContent)).jpeg({ quality: 90 }).toFile(sourcePath);

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

  console.log(
    `[CoverGenerator] Generated covers for track ${track.id} version ${trackVersion.version_num}`,
  );

  return {
    coverUrl: `${baseUrl}/1024`,
    smallUrl: `${baseUrl}/256`,
    largeUrl: `${baseUrl}/1024`,
  };
}

/**
 * Generate SVG content for cover art
 */
function generateSVG({
  width,
  height,
  colors,
  pattern,
  title,
  recipientName,
  occasion,
}) {
  // Calculate text sizes based on canvas size
  const titleSize = Math.floor(width * 0.08); // 8% of width
  const subtitleSize = Math.floor(width * 0.04); // 4% of width
  const occasionSize = Math.floor(width * 0.035); // 3.5% of width

  // Truncate title if too long
  const displayTitle = title.length > 20 ? title.substring(0, 18) + "…" : title;
  const displayRecipient = recipientName ? `For ${recipientName}` : "";

  // Occasion display name
  const occasionDisplay = formatOccasion(occasion, "Custom Song");

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
  ${
    displayRecipient
      ? `
  <text x="50%" y="55%" font-family="SF Pro Display, -apple-system, Helvetica Neue, Arial, sans-serif" font-size="${subtitleSize}" font-weight="500" fill="rgba(255,255,255,0.85)" text-anchor="middle" dominant-baseline="middle">
    ${safeRecipient}
  </text>
  `
      : ""
  }

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

// ---------------------------------------------------------------------------
// Per-song occasion artwork composite (modeled on the "For Sarah" mock).
// Lays Fraunces typography over an AI-generated or library base image.
// ---------------------------------------------------------------------------

const TARGET_DIMENSIONS = {
  "9:16": { width: 1024, height: 1536 },
  "1.91:1": { width: 1200, height: 630 },
  "1:1": { width: 1200, height: 1200 },
};

// sharp's librsvg backend resolves fonts via fontconfig + the system font cache.
// The Fraunces TTF lives at src/services/fonts/Fraunces-VariableFont.ttf
// (OFL-licensed; see fonts/LICENSE.txt). If fontconfig can't locate it (e.g.
// inside a stripped-down Docker image), the SVG renderer falls through to the
// next family — Georgia is a close visual match available on macOS/iOS and most
// Linux distros.
const FRAUNCES_FAMILY = "Fraunces, Georgia, 'Times New Roman', serif";

/**
 * Five-tier name fitting. Returns the layout for the recipient name only —
 * the visible string is rendered as `<prefix><name>` where prefix is
 * locale-aware ("For ", "لـ ", "לְ ").
 */
function fitName(name) {
  const raw = String(name || "").trim();
  if (!raw) return { lines: [], fontSizeFraction: 0.07 };

  // Tier 5: >18 chars with no space → truncate at 16 + ellipsis
  if (!/\s/.test(raw) && raw.length > 18) {
    return { lines: [`${raw.slice(0, 16)}…`], fontSizeFraction: 0.07 };
  }
  // Tier 4: >28 chars (even with spaces) → truncate at 26 + ellipsis
  if (raw.length > 28) {
    return { lines: [`${raw.slice(0, 26)}…`], fontSizeFraction: 0.05 };
  }
  // Tier 3: 19-28 chars → break on first space into two lines
  if (raw.length >= 19) {
    const firstSpace = raw.indexOf(" ");
    if (firstSpace > 0) {
      return {
        lines: [raw.slice(0, firstSpace), raw.slice(firstSpace + 1)],
        fontSizeFraction: 0.05,
      };
    }
    return { lines: [raw], fontSizeFraction: 0.05 };
  }
  // Tier 2: 13-18 chars → shrink to 5.5% of frame width, single line
  if (raw.length >= 13) {
    return { lines: [raw], fontSizeFraction: 0.055 };
  }
  // Tier 1: <=12 chars → standard size
  return { lines: [raw], fontSizeFraction: 0.07 };
}

/**
 * Build the SVG name + occasion overlay sized to the target frame.
 */
function buildOverlaySvg({ width, height, recipientName, occasion }) {
  const colors = OCCASION_COLORS[occasion] || OCCASION_COLORS.custom;
  const occasionDisplay = formatOccasion(occasion, "A Song");
  const direction = detectDirection(recipientName);
  const prefix = localizedForPrefix(recipientName);
  const { lines, fontSizeFraction } = fitName(recipientName);

  const nameSize = Math.round(width * fontSizeFraction);
  const occasionSize = Math.round(width * 0.034);
  const brandingSize = Math.round(width * 0.018);

  const safeOccasion = escapeXml(occasionDisplay);
  // Bottom safe zone: text vertically centered around 84% of frame height for portrait;
  // for landscape (1.91:1) we shift left third, so we keep y central.
  const isLandscape = width / height > 1.5;
  const isSquare = Math.abs(width / height - 1) < 0.1;
  const textAnchor = isLandscape ? "start" : "middle";
  const baseX = isLandscape ? Math.round(width * 0.06) : width / 2;
  const baseY = Math.round(height * (isSquare ? 0.82 : 0.84));
  const lineSpacing = Math.round(nameSize * 1.05);

  const directionAttr =
    direction === "rtl" ? ` direction="rtl" unicode-bidi="embed"` : "";

  // Two-line layout: stack lines vertically with the prefix on the first line.
  const nameLineSvgs = lines.map((line, i) => {
    const y = baseY + i * lineSpacing - (lines.length - 1) * (lineSpacing / 2);
    const display = i === 0 ? `${prefix}${escapeXml(line)}` : escapeXml(line);
    return `<text x="${baseX}" y="${y}" font-family="${FRAUNCES_FAMILY}" font-size="${nameSize}" font-weight="700" fill="${colors.secondary}" text-anchor="${textAnchor}"${directionAttr}>${display}</text>`;
  });

  const occasionY =
    baseY +
    lines.length * lineSpacing -
    (lines.length - 1) * (lineSpacing / 2) +
    Math.round(nameSize * 0.4);
  const brandingY = height - Math.round(height * 0.025);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  ${nameLineSvgs.join("\n  ")}
  <text x="${baseX}" y="${occasionY}" font-family="${FRAUNCES_FAMILY}" font-size="${occasionSize}" font-style="italic" font-weight="400" fill="${colors.primary}" fill-opacity="0.85" text-anchor="${textAnchor}"${directionAttr}>${safeOccasion}</text>
  <text x="${width / 2}" y="${brandingY}" font-family="${FRAUNCES_FAMILY}" font-size="${brandingSize}" font-weight="400" fill="#6b6f7a" fill-opacity="0.45" text-anchor="middle">porizo</text>
</svg>`;
}

/**
 * Composite a base artwork image with recipient name + occasion typography.
 * Supports three target aspects; the base is resized/cropped/letterboxed
 * intelligently so the subject (positioned in upper 60% of the base by prompt
 * contract) is preserved.
 *
 * @param {Object} params
 * @param {string} params.baseImagePath  Path to the source artwork (typically 1024×1536 9:16)
 * @param {string} params.recipientName  Name to render — composited via SVG, never sent to AI
 * @param {string} params.occasion       Occasion key (for color + label)
 * @param {string} params.outputDir      Directory to write outputs
 * @param {string} [params.targetAspect] '9:16' | '1.91:1' | '1:1' (default: '9:16')
 * @returns {Promise<string>} Path to the generated composite
 */
async function compositeArtworkWithText({
  baseImagePath,
  recipientName,
  occasion,
  outputDir,
  targetAspect = "9:16",
}) {
  let sharp;
  try {
    sharp = require("sharp");
  } catch {
    throw new Error(
      "sharp is required for compositeArtworkWithText but is not installed",
    );
  }
  if (!baseImagePath || !fs.existsSync(baseImagePath)) {
    throw new Error(
      `compositeArtworkWithText: baseImagePath does not exist: ${baseImagePath}`,
    );
  }

  const dims = TARGET_DIMENSIONS[targetAspect];
  if (!dims) {
    throw new Error(`Unsupported targetAspect: ${targetAspect}`);
  }
  ensureDir(outputDir);

  const suffix = targetAspect.replace(":", "x"); // "9:16" -> "9x16"
  const outputName =
    targetAspect === "9:16" ? "artwork.jpg" : `artwork_${suffix}.jpg`;
  const outputPath = path.join(outputDir, outputName);

  // Step 1: prepare the base at the target aspect
  let baseLayer;
  const base = sharp(baseImagePath);
  const baseMeta = await base.metadata();
  const targetRatio = dims.width / dims.height;
  const sourceRatio = (baseMeta.width || 1024) / (baseMeta.height || 1536);

  if (Math.abs(sourceRatio - targetRatio) < 0.02) {
    // Same aspect — straight resize
    baseLayer = base.resize(dims.width, dims.height, { fit: "cover" });
  } else if (targetRatio > sourceRatio) {
    // Target is wider than source (e.g. 1.91:1 from 9:16):
    // Resize base to target height, then extend horizontally with a blurred
    // copy of the same image so the subject sits in the left third.
    const innerHeight = dims.height;
    const innerWidth = Math.round(innerHeight * sourceRatio);
    const padTotal = dims.width - innerWidth;
    // Inner subject sits in the LEFT third for landscape; padding goes on the right.
    const padLeft = Math.round(padTotal * 0.15);

    const backgroundBuf = await sharp(baseImagePath)
      .resize(dims.width, dims.height, { fit: "cover" })
      .blur(40)
      .modulate({ brightness: 0.85 })
      .jpeg({ quality: 80 })
      .toBuffer();

    const innerBuf = await sharp(baseImagePath)
      .resize(innerWidth, innerHeight, { fit: "cover" })
      .jpeg({ quality: 92 })
      .toBuffer();

    baseLayer = sharp(backgroundBuf).composite([
      { input: innerBuf, left: padLeft, top: 0 },
    ]);
  } else {
    // Target is taller than source — pad top/bottom with blurred extension
    const innerWidth = dims.width;
    const innerHeight = Math.round(innerWidth / sourceRatio);
    const padTotal = dims.height - innerHeight;
    const padTop = Math.round(padTotal * 0.4); // subject toward upper 60%

    const backgroundBuf = await sharp(baseImagePath)
      .resize(dims.width, dims.height, { fit: "cover" })
      .blur(40)
      .modulate({ brightness: 0.9 })
      .jpeg({ quality: 80 })
      .toBuffer();

    const innerBuf = await sharp(baseImagePath)
      .resize(innerWidth, innerHeight, { fit: "cover" })
      .jpeg({ quality: 92 })
      .toBuffer();

    baseLayer = sharp(backgroundBuf).composite([
      { input: innerBuf, left: 0, top: padTop },
    ]);
  }

  // Step 2: overlay SVG typography
  const overlaySvg = buildOverlaySvg({
    width: dims.width,
    height: dims.height,
    recipientName,
    occasion,
  });

  await baseLayer
    .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
    .jpeg({ quality: 88 })
    .toFile(outputPath);

  return outputPath;
}

module.exports = {
  generateCover,
  isSharpAvailable,
  compositeArtworkWithText,
  fitName,
  buildOverlaySvg,
  OCCASION_COLORS,
};
