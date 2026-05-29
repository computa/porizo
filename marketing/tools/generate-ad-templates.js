#!/usr/bin/env node
/**
 * Porizo Meta Ad Creative Templates — reusable, config-driven.
 *
 * Three standing templates, each rendered at 3 sizes (1:1, 4:5, 9:16):
 *   1. product     — iPhone showing the Porizo player (cover art, title, waveform, play). Highest install clarity.
 *   2. floral      — full-bleed song-artwork image + dark scrim + bold serif headline. "Better than flowers" hook.
 *   3. comparison  — before/after split (cliché gift vs the song) + footer headline. Gift-buyer framing.
 *
 * A "config" describes one campaign/occasion (copy, images, palette, CTA). Father's Day is the first config.
 * To make a new campaign: copy the config block, change strings/images, run.
 *
 *   node marketing/tools/generate-ad-templates.js                 # all templates, all sizes, default config
 *   node marketing/tools/generate-ad-templates.js --only product  # one template
 *   node marketing/tools/generate-ad-templates.js --config ./ad-configs/mothers-day.json
 *
 * Rasters are cover-cropped via Sharp, base64-embedded into the SVG, then rendered to PNG (single pass, deterministic).
 */

const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "../..");

// ---------- Palette (warm-dark, matches the live Porizo player + app) ----------
const PALETTE = {
  dark: "#0E0B08",
  darkTop: "#171310",
  darkBot: "#0C0907",
  cardDark: "#1A0F08",
  cream: "#F6EFE3",
  cream2: "#EDE2CC",
  accent: "#E8966E",
  accentDeep: "#C06030",
  playerAccent: "#E07A4B",
  mute: "#A89A88",
  dim: "#6D6357",
  frame: "#2A221B",
  serif: "Georgia, 'Times New Roman', serif",
  sans: "-apple-system, 'Helvetica Neue', Arial, sans-serif",
  mono: "'DM Mono', ui-monospace, Menlo, monospace",
};

const SIZES = [
  { id: "1x1", w: 1080, h: 1080 },
  { id: "4x5", w: 1080, h: 1350 },
  { id: "9x16", w: 1080, h: 1920 },
];

// ---------- helpers ----------
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Cover-crop an image to exactly w×h and return a base64 data URI. */
async function coverURI(absOrRel, w, h) {
  const p = path.isAbsolute(absOrRel) ? absOrRel : path.join(REPO, absOrRel);
  const buf = await sharp(p)
    .resize(Math.round(w), Math.round(h), { fit: "cover", position: "attention" })
    .jpeg({ quality: 88 })
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

/** Word-wrap to ~maxChars, returns array of lines. */
function wrap(text, maxChars) {
  const words = String(text).split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > maxChars && line) {
      lines.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines;
}

function tx(x, y, s, o = {}) {
  const size = o.size || 28;
  const weight = o.weight || "400";
  const fill = o.fill || PALETTE.cream;
  const anchor = o.anchor || "start";
  const family = o.family || PALETTE.sans;
  const ls = o.tracking != null ? ` letter-spacing="${o.tracking}"` : "";
  const op = o.opacity != null ? ` opacity="${o.opacity}"` : "";
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${ls}${op}>${esc(s)}</text>`;
}

/** Rounded-rect CTA pill, centered at cx. */
function ctaPill(cx, cy, label, w, h, fontSize) {
  const x = cx - w / 2;
  return `<rect x="${x}" y="${cy - h / 2}" width="${w}" height="${h}" rx="${h / 2}" fill="${PALETTE.accent}"/>
  ${tx(cx, cy + fontSize * 0.34, label, { size: fontSize, weight: "700", fill: PALETTE.cardDark, anchor: "middle", tracking: 1.2 })}`;
}

function k(scaleW) {
  return scaleW / 1080;
} // px scale off the 1080 baseline

// ---------- Template 1: PRODUCT (phone mockup) ----------
async function tplProduct(cfg, { w, h }) {
  const s = k(w);
  const c = cfg.product;
  const midX = w / 2;
  const headSize = Math.round(82 * s);
  const lines = c.headline;
  // phone geometry
  const phoneW = Math.round(w * 0.62);
  const phoneX = midX - phoneW / 2;
  const phoneTop = Math.round(h * (h / w > 1.5 ? 0.30 : 0.26));
  const screenPad = Math.round(phoneW * 0.045);
  const screenX = phoneX + screenPad;
  const screenW = phoneW - screenPad * 2;
  const coverDim = screenW * 0.86;
  const coverX = screenX + (screenW - coverDim) / 2;
  const coverY = phoneTop + screenPad + screenW * 0.12;
  const cover = await coverURI(c.coverImage, Math.round(coverDim), Math.round(coverDim));

  // waveform bars
  const heights = [30, 55, 80, 45, 95, 60, 38, 72, 50, 88, 42, 65, 30, 78, 52, 70, 40];
  const waveW = screenW * 0.74;
  const waveX = screenX + (screenW - waveW) / 2;
  const waveY = coverY + coverDim + screenW * 0.36;
  const barGap = waveW * 0.012;
  const barW = (waveW - barGap * (heights.length - 1)) / heights.length;
  const waveMaxH = screenW * 0.13;
  const waveBars = heights
    .map((ht, i) => {
      const bh = (ht / 100) * waveMaxH;
      const bx = waveX + i * (barW + barGap);
      return `<rect x="${bx}" y="${waveY - bh}" width="${barW}" height="${bh}" rx="${barW * 0.4}" fill="${PALETTE.playerAccent}" opacity="0.85"/>`;
    })
    .join("");
  const playR = screenW * 0.085;
  const playCY = waveY + screenW * 0.16;
  const screenBottom = playCY + playR + screenW * 0.12;
  const phoneH = screenBottom - phoneTop + screenPad;
  const titleY = coverY + coverDim + screenW * 0.16;
  const subY = titleY + 36 * s;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${PALETTE.darkTop}"/><stop offset="100%" stop-color="${PALETTE.darkBot}"/>
    </linearGradient>
    <clipPath id="screenClip"><rect x="${screenX}" y="${phoneTop + screenPad}" width="${screenW}" height="${phoneH - screenPad}" rx="${screenW * 0.06}"/></clipPath>
    <clipPath id="coverClip"><rect x="${coverX}" y="${coverY}" width="${coverDim}" height="${coverDim}" rx="${coverDim * 0.05}"/></clipPath>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>

  ${tx(midX, Math.round(h * 0.115), c.kicker, { size: Math.round(26 * s), family: PALETTE.mono, fill: PALETTE.mute, anchor: "middle", tracking: 3 })}
  ${lines
    .map((ln, i) =>
      tx(midX, Math.round(h * 0.18) + i * headSize * 1.02, ln, {
        size: headSize,
        weight: "700",
        family: PALETTE.serif,
        anchor: "middle",
        fill: i === lines.length - 1 ? PALETTE.accent : PALETTE.cream,
      }),
    )
    .join("\n  ")}

  <!-- phone -->
  <rect x="${phoneX}" y="${phoneTop}" width="${phoneW}" height="${phoneH}" rx="${phoneW * 0.085}" fill="#000" stroke="${PALETTE.frame}" stroke-width="${4 * s}"/>
  <rect x="${screenX}" y="${phoneTop + screenPad}" width="${screenW}" height="${phoneH - screenPad}" rx="${screenW * 0.06}" fill="${PALETTE.cardDark}"/>
  <g clip-path="url(#screenClip)">
    <image href="${cover}" x="${coverX}" y="${coverY}" width="${coverDim}" height="${coverDim}" clip-path="url(#coverClip)" preserveAspectRatio="xMidYMid slice"/>
    ${tx(midX, titleY, c.songTitle, { size: Math.round(52 * s), weight: "600", family: PALETTE.serif, anchor: "middle", fill: PALETTE.cream })}
    ${tx(midX, subY, c.songSub, { size: Math.round(26 * s), family: PALETTE.mono, anchor: "middle", fill: PALETTE.mute })}
    ${waveBars}
    <circle cx="${midX}" cy="${playCY}" r="${playR}" fill="${PALETTE.playerAccent}"/>
    <path d="M ${midX - playR * 0.28} ${playCY - playR * 0.42} L ${midX - playR * 0.28} ${playCY + playR * 0.42} L ${midX + playR * 0.45} ${playCY} Z" fill="${PALETTE.cardDark}"/>
  </g>

  ${ctaPill(midX, Math.round(h * 0.93), c.cta, Math.round(w * 0.62), Math.round(86 * s), Math.round(32 * s))}
</svg>`;
}

// ---------- Template 2: FLORAL (full-bleed + bold type) ----------
async function tplFloral(cfg, { w, h }) {
  const s = k(w);
  const c = cfg.floral;
  const midX = w / 2;
  const bg = await coverURI(c.bgImage, w, h);
  const headSize = Math.round(96 * s);
  const lines = c.headline;
  const subLines = wrap(c.sub, 42);
  const baseY = Math.round(h * 0.62);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(14,11,8,0.18)"/>
      <stop offset="45%" stop-color="rgba(14,11,8,0.34)"/>
      <stop offset="100%" stop-color="rgba(14,11,8,0.90)"/>
    </linearGradient>
  </defs>
  <image href="${bg}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>
  <rect width="${w}" height="${h}" fill="url(#scrim)"/>

  ${tx(midX, Math.round(h * 0.10), cfg.brand, { size: Math.round(42 * s), family: PALETTE.serif, anchor: "middle", fill: "rgba(246,239,227,0.88)", tracking: 4 })}

  ${lines
    .map((ln, i) =>
      tx(midX, baseY + i * headSize * 1.0, ln, {
        size: headSize,
        weight: "700",
        family: PALETTE.serif,
        anchor: "middle",
        fill: i === lines.length - 1 ? PALETTE.accent : PALETTE.cream,
      }),
    )
    .join("\n  ")}

  ${subLines
    .map((ln, i) =>
      tx(midX, baseY + lines.length * headSize * 1.0 + 30 * s + i * 38 * s, ln, {
        size: Math.round(30 * s),
        family: PALETTE.sans,
        anchor: "middle",
        fill: PALETTE.cream2,
        opacity: 0.92,
      }),
    )
    .join("\n  ")}

  ${ctaPill(midX, baseY + lines.length * headSize * 1.0 + 30 * s + subLines.length * 38 * s + 70 * s, c.cta, Math.round(w * 0.64), Math.round(86 * s), Math.round(32 * s))}
</svg>`;
}

// ---------- Template 3: COMPARISON (before / after) ----------
async function tplComparison(cfg, { w, h }) {
  const s = k(w);
  const c = cfg.comparison;
  const midX = w / 2;
  const footH = Math.round(h * 0.24);
  const splitH = h - footH;
  const halfW = w / 2;

  // after mini-player cover
  const miniW = halfW * 0.62;
  const miniH = miniW * (1350 / 1080);
  const miniX = halfW + (halfW - miniW) / 2;
  const miniY = splitH / 2 - miniH / 2;
  const afterImg = await coverURI(c.afterImage, Math.round(miniW), Math.round(miniH * 0.62));
  const imgH = miniH * 0.62;
  const playR = miniW * 0.16;
  const playCY = miniY + imgH + (miniH - imgH) / 2;

  const footLines = c.footerHeadline;
  const footHeadSize = Math.round(60 * s);

  // simple vector "gift/tie" mark for the before side (no emoji — librsvg can't color-render those)
  const giftCx = halfW / 2;
  const giftCy = splitH * 0.44;
  const giftR = halfW * 0.18;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="afterbg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#241813"/><stop offset="100%" stop-color="#1A0F08"/>
    </linearGradient>
    <clipPath id="miniClip"><rect x="${miniX}" y="${miniY}" width="${miniW}" height="${miniH}" rx="${miniW * 0.12}"/></clipPath>
    <clipPath id="miniImgClip"><rect x="${miniX + miniW * 0.07}" y="${miniY + miniW * 0.07}" width="${miniW * 0.86}" height="${imgH}" rx="${miniW * 0.08}"/></clipPath>
  </defs>

  <!-- before half -->
  <rect x="0" y="0" width="${halfW}" height="${splitH}" fill="#15120E"/>
  <!-- gift box vector -->
  <g opacity="0.5">
    <rect x="${giftCx - giftR}" y="${giftCy - giftR * 0.7}" width="${giftR * 2}" height="${giftR * 1.6}" rx="${giftR * 0.12}" fill="none" stroke="${PALETTE.dim}" stroke-width="${5 * s}"/>
    <line x1="${giftCx}" y1="${giftCy - giftR * 0.7}" x2="${giftCx}" y2="${giftCy + giftR * 0.9}" stroke="${PALETTE.dim}" stroke-width="${5 * s}"/>
    <path d="M ${giftCx} ${giftCy - giftR * 0.7} q ${-giftR * 0.5} ${-giftR * 0.5} ${-giftR * 0.05} ${-giftR * 0.55} q ${giftR * 0.3} ${giftR * 0.05} ${giftR * 0.05} ${giftR * 0.55} q ${giftR * 0.5} ${-giftR * 0.5} ${giftR * 0.05} ${-giftR * 0.55} q ${-giftR * 0.3} ${giftR * 0.05} ${-giftR * 0.05} ${giftR * 0.55} z" fill="none" stroke="${PALETTE.dim}" stroke-width="${4 * s}"/>
  </g>
  ${tx(giftCx, splitH * 0.72, c.beforeLabel, { size: Math.round(27 * s), family: PALETTE.mono, anchor: "middle", fill: PALETTE.dim, tracking: 1.5 })}

  <!-- after half -->
  <rect x="${halfW}" y="0" width="${halfW}" height="${splitH}" fill="url(#afterbg)"/>
  <rect x="${miniX}" y="${miniY}" width="${miniW}" height="${miniH}" rx="${miniW * 0.12}" fill="${PALETTE.cardDark}" stroke="${PALETTE.frame}" stroke-width="${5 * s}"/>
  <g clip-path="url(#miniClip)">
    <image href="${afterImg}" x="${miniX + miniW * 0.07}" y="${miniY + miniW * 0.07}" width="${miniW * 0.86}" height="${imgH}" clip-path="url(#miniImgClip)" preserveAspectRatio="xMidYMid slice"/>
    <circle cx="${miniX + miniW / 2}" cy="${playCY}" r="${playR}" fill="${PALETTE.playerAccent}"/>
    <path d="M ${miniX + miniW / 2 - playR * 0.28} ${playCY - playR * 0.42} L ${miniX + miniW / 2 - playR * 0.28} ${playCY + playR * 0.42} L ${miniX + miniW / 2 + playR * 0.45} ${playCY} Z" fill="${PALETTE.cardDark}"/>
  </g>
  ${tx(halfW + halfW / 2, splitH * 0.72, c.afterLabel, { size: Math.round(27 * s), family: PALETTE.mono, anchor: "middle", fill: PALETTE.accent, tracking: 1.5 })}

  <!-- divider -->
  <line x1="${midX}" y1="${splitH * 0.10}" x2="${midX}" y2="${splitH * 0.62}" stroke="rgba(246,239,227,0.15)" stroke-width="2"/>

  <!-- footer -->
  <rect x="0" y="${splitH}" width="${w}" height="${footH}" fill="${PALETTE.cardDark}"/>
  ${footLines
    .map((ln, i) =>
      tx(midX, splitH + footH * 0.32 + i * footHeadSize * 1.05, ln, {
        size: footHeadSize,
        weight: "700",
        family: PALETTE.serif,
        anchor: "middle",
        fill: i === footLines.length - 1 ? PALETTE.accent : PALETTE.cream,
      }),
    )
    .join("\n  ")}
  ${ctaPill(midX, splitH + footH * 0.78, c.cta, Math.round(w * 0.6), Math.round(82 * s), Math.round(32 * s))}
</svg>`;
}

const TEMPLATES = { product: tplProduct, floral: tplFloral, comparison: tplComparison };

// ---------- Default config: Father's Day 2026 ----------
const FATHERS_DAY_2026 = {
  name: "fathers-day-2026",
  brand: "Porizo",
  product: {
    kicker: "PORIZO · SONG GIFT MAKER",
    headline: ["Memories,", "in a song."],
    coverImage: "marketing/remotion/public/stock/drive-home/04-father-daughter-bike.png",
    songTitle: "For Dad",
    songSub: "made by Maya · 0:48",
    cta: "TRY FREE ON APP STORE",
  },
  floral: {
    bgImage: "storage/artwork-library/v2/i_love_you/0.jpg",
    headline: ["Forget Flowers.", "Make Him a Song."],
    sub: "Father's Day is June 21. A personalized song, sung in your voice — free, under 60s.",
    cta: "TRY FREE ON APP STORE",
  },
  comparison: {
    beforeLabel: "the same old gift",
    afterImage: "marketing/remotion/public/stock/drive-home/04-father-daughter-bike.png",
    afterLabel: "a song of your memories",
    footerHeadline: ["Give him something", "he'll keep."],
    cta: "MAKE HIS SONG — FREE",
  },
};

// ---------- main ----------
(async () => {
  const args = process.argv.slice(2);
  let cfg = FATHERS_DAY_2026;
  const cfgFlag = args.indexOf("--config");
  if (cfgFlag !== -1 && args[cfgFlag + 1]) {
    cfg = JSON.parse(fs.readFileSync(path.resolve(args[cfgFlag + 1]), "utf8"));
  }
  const onlyFlag = args.indexOf("--only");
  const only = onlyFlag !== -1 ? args[onlyFlag + 1] : null;

  const outDir = path.join(
    REPO,
    "marketing/campaigns/output",
    cfg.name,
    "templates",
  );
  fs.mkdirSync(outDir, { recursive: true });

  const names = only ? [only] : Object.keys(TEMPLATES);
  let count = 0;
  for (const name of names) {
    const fn = TEMPLATES[name];
    if (!fn) {
      console.error(`Unknown template "${name}". Options: ${Object.keys(TEMPLATES).join(", ")}`);
      process.exit(1);
    }
    for (const size of SIZES) {
      const svg = await fn(cfg, size);
      const out = path.join(outDir, `${name}-${size.id}.png`);
      await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(out);
      console.log(`  ✓ ${name}-${size.id}.png  (${size.w}×${size.h})`);
      count++;
    }
  }
  console.log(`\nDone. ${count} files → ${outDir}`);
})().catch((e) => {
  console.error("Generation failed:", e);
  process.exit(1);
});
