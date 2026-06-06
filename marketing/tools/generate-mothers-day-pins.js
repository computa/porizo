#!/usr/bin/env node
/**
 * Mother's Day 2026 Pinterest Pin Generator
 *
 * Produces 5 ready-to-upload Pinterest pins (1080x1620, 2:3 ratio) matching the
 * specs in marketing/archive/campaign-packs/mothers-day-2026-plan-pack/02-pinterest-pins.md.
 *
 * SVG-rendered to PNG via Sharp. Uses the Porizo "Warm Canvas" design tokens
 * shared with marketing/tools/generate-graphic.js — pixel-perfect, no AI drift.
 *
 * Usage:
 *   node generate-mothers-day-pins.js                  # generate all 5
 *   node generate-mothers-day-pins.js --pin 1          # generate only pin N
 */

const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const OUTPUT_DIR = path.resolve(
  __dirname,
  "../archive/campaign-packs/mothers-day-2026-plan-pack/pin-assets",
);

// Warm Canvas palette — synced with generate-graphic.js
const B = {
  bg: "#FBF7F2",
  card: "#FFFFFF",
  cardBorder: "#E8E2DC",
  accent: "#E07850",
  accentEnd: "#E8966E",
  accentDark: "#C06030",
  roseGold: "#D4894A",
  sage: "#7B8F6B",
  coralBubble: "#FDE8E0",
  sageBubble: "#E8F0E5",
  textPrimary: "#2C2420",
  textSecondary: "#6B6560",
  textTertiary: "#9E9890",
  textMuted: "#B5AFA8",
  white: "#FFFFFF",
  displayFont: "'Playfair Display', Georgia, serif",
  bodyFont: "-apple-system, 'SF Pro Text', 'Helvetica Neue', sans-serif",
  W: 1080,
  H: 1620,
};

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function text(x, y, content, opts = {}) {
  const size = opts.size || 24;
  const fill = opts.fill || B.textPrimary;
  const weight = opts.weight || "400";
  const anchor = opts.anchor || "start";
  const font = opts.display ? B.displayFont : B.bodyFont;
  const style = opts.italic ? ' font-style="italic"' : "";
  const tracking = opts.tracking ? ` letter-spacing="${opts.tracking}"` : "";
  return `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${style}${tracking}>${esc(content)}</text>`;
}

function sharedDefs() {
  return `<defs>
    <filter id="cardShadow" x="-4%" y="-2%" width="108%" height="112%">
      <feDropShadow dx="0" dy="6" stdDeviation="14" flood-color="${B.textPrimary}" flood-opacity="0.10"/>
    </filter>
    <linearGradient id="warmGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${B.coralBubble}"/>
      <stop offset="100%" stop-color="${B.bg}"/>
    </linearGradient>
    <linearGradient id="accentGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${B.accent}"/>
      <stop offset="100%" stop-color="${B.accentEnd}"/>
    </linearGradient>
    <linearGradient id="sunGradient" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${B.coralBubble}"/>
      <stop offset="60%" stop-color="${B.bg}"/>
      <stop offset="100%" stop-color="${B.sageBubble}"/>
    </linearGradient>
  </defs>`;
}

function brandFooter(y, label = "porizo.co") {
  return `${text(B.W / 2, y, label, { size: 28, weight: "600", anchor: "middle", fill: B.textSecondary, display: true, tracking: "2" })}`;
}

// Phone mock used in pins 1 and 3
function phoneMock(cx, cy, opts = {}) {
  const w = opts.w || 320;
  const h = opts.h || 580;
  const x = cx - w / 2;
  const y = cy - h / 2;
  const songTitle = opts.songTitle || "Always Home";
  const subtitle = opts.subtitle || "A Mother's Day song for Mom";
  const occasion = opts.occasion || "Mother's Day · Pop Ballad";

  // Waveform bars
  let bars = "";
  for (let i = 0; i < 24; i++) {
    const barH = 12 + Math.abs(Math.sin(i * 0.6)) * 28 + Math.cos(i * 0.3) * 8;
    const barX = x + 40 + i * 10;
    const barY = y + 380 - barH / 2;
    const isActive = i < 12;
    bars += `<rect x="${barX}" y="${barY}" width="5" height="${barH}" rx="2.5" fill="${isActive ? B.accent : B.cardBorder}"/>`;
  }

  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="42" fill="${B.textPrimary}" filter="url(#cardShadow)"/>
    <rect x="${x + 8}" y="${y + 8}" width="${w - 16}" height="${h - 16}" rx="34" fill="${B.bg}"/>
    <rect x="${cx - 50}" y="${y + 18}" width="100" height="20" rx="10" fill="${B.textPrimary}"/>
    ${text(x + 32, y + 90, "Now Playing", { size: 14, fill: B.textTertiary, weight: "500", tracking: "1" })}
    ${text(x + 32, y + 116, occasion, { size: 16, fill: B.textSecondary, weight: "500" })}
    <rect x="${x + 32}" y="${y + 160}" width="${w - 64}" height="280" rx="20" fill="${B.white}" stroke="${B.cardBorder}" stroke-width="1"/>
    ${text(x + 56, y + 218, songTitle, { size: 28, weight: "700", fill: B.textPrimary, display: true })}
    ${text(x + 56, y + 252, subtitle, { size: 14, fill: B.textTertiary })}
    ${bars}
    ${text(x + 56, y + 422, "0:12", { size: 12, fill: B.textTertiary })}
    ${text(x + w - 56, y + 422, "0:28", { size: 12, fill: B.textTertiary, anchor: "end" })}
    <circle cx="${cx}" cy="${y + 510}" r="38" fill="url(#accentGradient)"/>
    <polygon points="${cx - 10},${y + 495} ${cx - 10},${y + 525} ${cx + 14},${y + 510}" fill="${B.white}"/>
  `;
}

// PIN 1 — "AI Mother's Day Song / In YOUR voice"
function pin1() {
  return `<svg width="${B.W}" height="${B.H}" viewBox="0 0 ${B.W} ${B.H}" xmlns="http://www.w3.org/2000/svg">
    ${sharedDefs()}
    <rect width="${B.W}" height="${B.H}" fill="url(#sunGradient)"/>

    ${text(B.W / 2, 130, "MOTHER'S DAY · MAY 11", { size: 22, weight: "600", anchor: "middle", fill: B.accentDark, tracking: "4" })}

    ${text(B.W / 2, 240, "AI Mother's Day", { size: 88, weight: "700", anchor: "middle", fill: B.textPrimary, display: true })}
    ${text(B.W / 2, 340, "Song", { size: 88, weight: "700", anchor: "middle", fill: B.textPrimary, display: true })}

    <rect x="${B.W / 2 - 220}" y="380" width="440" height="80" rx="40" fill="url(#accentGradient)"/>
    ${text(B.W / 2, 432, "In YOUR voice.", { size: 44, weight: "700", anchor: "middle", fill: B.white, display: true, italic: true })}

    ${text(B.W / 2, 530, "Last-minute? Done in 3 minutes.", { size: 28, anchor: "middle", fill: B.textSecondary })}

    ${phoneMock(B.W / 2, 1000, { songTitle: "Always Home", subtitle: "A Mother's Day song for Mom", occasion: "Mother's Day · Folk" })}

    ${brandFooter(1500)}
    ${text(B.W / 2, 1538, "Free to try · porizo.co/mothers-day-song", { size: 18, anchor: "middle", fill: B.textTertiary })}
  </svg>`;
}

// PIN 2 — "She'll cry. (In a good way.)"
function pin2() {
  return `<svg width="${B.W}" height="${B.H}" viewBox="0 0 ${B.W} ${B.H}" xmlns="http://www.w3.org/2000/svg">
    ${sharedDefs()}
    <rect width="${B.W}" height="${B.H}" fill="${B.bg}"/>

    <!-- Soft warm circle background -->
    <circle cx="${B.W / 2}" cy="700" r="380" fill="${B.coralBubble}" opacity="0.6"/>
    <circle cx="${B.W / 2 - 200}" cy="500" r="120" fill="${B.sageBubble}" opacity="0.4"/>
    <circle cx="${B.W / 2 + 220}" cy="900" r="160" fill="${B.coralBubble}" opacity="0.5"/>

    ${text(B.W / 2, 200, "FOR MOM, MAY 11", { size: 22, weight: "600", anchor: "middle", fill: B.accentDark, tracking: "4" })}

    <!-- Massive serif claim -->
    ${text(B.W / 2, 460, "She'll cry.", { size: 140, weight: "700", anchor: "middle", fill: B.textPrimary, display: true, italic: true })}

    ${text(B.W / 2, 560, "(in a good way)", { size: 56, weight: "400", anchor: "middle", fill: B.textSecondary, italic: true })}

    <!-- Decorative quote-style mark -->
    <path d="M ${B.W / 2 - 100} 700 Q ${B.W / 2} 760 ${B.W / 2 + 100} 700" stroke="${B.accent}" stroke-width="3" fill="none"/>

    <!-- Reasoning block -->
    <rect x="120" y="900" width="${B.W - 240}" height="320" rx="28" fill="${B.white}" stroke="${B.cardBorder}" stroke-width="1" filter="url(#cardShadow)"/>
    ${text(B.W / 2, 980, "The gift she keeps replaying.", { size: 36, weight: "600", anchor: "middle", fill: B.textPrimary, display: true })}
    ${text(B.W / 2, 1040, "An original song built from", { size: 26, anchor: "middle", fill: B.textSecondary })}
    ${text(B.W / 2, 1078, "one real memory about Mom.", { size: 26, anchor: "middle", fill: B.textSecondary })}
    ${text(B.W / 2, 1138, "Sung in YOUR voice.", { size: 30, weight: "700", anchor: "middle", fill: B.accentDark, italic: true })}
    ${text(B.W / 2, 1182, "Done in 3 minutes.", { size: 24, anchor: "middle", fill: B.textTertiary })}

    ${brandFooter(1480)}
    ${text(B.W / 2, 1518, "porizo.co/mothers-day-song", { size: 18, anchor: "middle", fill: B.textTertiary })}
  </svg>`;
}

// PIN 3 — "From one memory to a full song"
function pin3() {
  return `<svg width="${B.W}" height="${B.H}" viewBox="0 0 ${B.W} ${B.H}" xmlns="http://www.w3.org/2000/svg">
    ${sharedDefs()}
    <rect width="${B.W}" height="${B.H}" fill="${B.bg}"/>

    ${text(B.W / 2, 130, "PERSONALIZED SONG GIFT", { size: 22, weight: "600", anchor: "middle", fill: B.accentDark, tracking: "4" })}

    <!-- Quote card -->
    <rect x="100" y="200" width="${B.W - 200}" height="380" rx="28" fill="${B.white}" stroke="${B.cardBorder}" stroke-width="1" filter="url(#cardShadow)"/>

    ${text(140, 260, "“", { size: 120, weight: "700", fill: B.accent, display: true })}

    ${text(B.W / 2, 320, "She always woke before", { size: 38, weight: "500", anchor: "middle", fill: B.textPrimary, display: true, italic: true })}
    ${text(B.W / 2, 372, "the house, cooked before", { size: 38, weight: "500", anchor: "middle", fill: B.textPrimary, display: true, italic: true })}
    ${text(B.W / 2, 424, "the school bell, held the", { size: 38, weight: "500", anchor: "middle", fill: B.textPrimary, display: true, italic: true })}
    ${text(B.W / 2, 476, "door so we could run.", { size: 38, weight: "500", anchor: "middle", fill: B.textPrimary, display: true, italic: true })}
    ${text(B.W / 2, 540, "— for Mom, Mother's Day", { size: 22, anchor: "middle", fill: B.textTertiary })}

    <!-- Arrow -->
    <path d="M ${B.W / 2} 620 L ${B.W / 2} 700" stroke="${B.accent}" stroke-width="3"/>
    <polygon points="${B.W / 2 - 12},690 ${B.W / 2 + 12},690 ${B.W / 2},715" fill="${B.accent}"/>

    ${text(B.W / 2, 770, "One memory becomes a full song", { size: 32, weight: "600", anchor: "middle", fill: B.textPrimary, display: true })}
    ${text(B.W / 2, 810, "Original lyrics. Original music. Sung in your voice.", { size: 22, anchor: "middle", fill: B.textSecondary })}

    ${phoneMock(B.W / 2, 1170, { songTitle: "Always Home", subtitle: "A Mother's Day song for Mom", occasion: "Mother's Day · Folk" })}

    ${brandFooter(1500)}
    ${text(B.W / 2, 1538, "Try free at porizo.co/mothers-day-song", { size: 18, anchor: "middle", fill: B.textTertiary })}
  </svg>`;
}

// PIN 4 — Comparison: Songfinch vs Porizo
function pin4() {
  return `<svg width="${B.W}" height="${B.H}" viewBox="0 0 ${B.W} ${B.H}" xmlns="http://www.w3.org/2000/svg">
    ${sharedDefs()}
    <rect width="${B.W}" height="${B.H}" fill="${B.bg}"/>

    ${text(B.W / 2, 130, "MOTHER'S DAY IN 3 DAYS?", { size: 26, weight: "700", anchor: "middle", fill: B.accentDark, tracking: "3" })}

    ${text(B.W / 2, 220, "Pick the song service", { size: 56, weight: "700", anchor: "middle", fill: B.textPrimary, display: true })}
    ${text(B.W / 2, 290, "that fits your timeline.", { size: 56, weight: "700", anchor: "middle", fill: B.textPrimary, display: true })}

    <!-- LEFT: Songfinch -->
    <rect x="80" y="380" width="440" height="800" rx="28" fill="${B.white}" stroke="${B.cardBorder}" stroke-width="1" filter="url(#cardShadow)"/>
    ${text(300, 460, "SONGFINCH", { size: 28, weight: "700", anchor: "middle", fill: B.textTertiary, tracking: "3" })}
    ${text(300, 540, "~4–7 days", { size: 44, weight: "700", anchor: "middle", fill: B.textPrimary, display: true })}
    ${text(300, 580, "delivery", { size: 22, anchor: "middle", fill: B.textSecondary })}

    ${text(300, 680, "~$179.99", { size: 44, weight: "700", anchor: "middle", fill: B.textPrimary, display: true })}
    ${text(300, 720, "per song", { size: 22, anchor: "middle", fill: B.textSecondary })}

    ${text(300, 820, "Sung by", { size: 22, anchor: "middle", fill: B.textSecondary })}
    ${text(300, 850, "an artist", { size: 30, weight: "600", anchor: "middle", fill: B.textPrimary, italic: true })}

    ${text(300, 950, "Human composer", { size: 22, anchor: "middle", fill: B.textTertiary })}
    ${text(300, 982, "Per-song purchase", { size: 22, anchor: "middle", fill: B.textTertiary })}
    ${text(300, 1014, "Best for: 2+ weeks out", { size: 22, anchor: "middle", fill: B.textTertiary })}

    <!-- RIGHT: Porizo (highlighted) -->
    <rect x="560" y="380" width="440" height="800" rx="28" fill="url(#accentGradient)" filter="url(#cardShadow)"/>
    ${text(780, 460, "PORIZO", { size: 28, weight: "700", anchor: "middle", fill: B.white, tracking: "3" })}
    ${text(780, 540, "~3 minutes", { size: 44, weight: "700", anchor: "middle", fill: B.white, display: true })}
    ${text(780, 580, "delivery", { size: 22, anchor: "middle", fill: "#FFFFFFE0" })}

    ${text(780, 680, "$9.99/mo", { size: 44, weight: "700", anchor: "middle", fill: B.white, display: true })}
    ${text(780, 720, "(4 songs)", { size: 22, anchor: "middle", fill: "#FFFFFFE0" })}

    ${text(780, 820, "Sung in", { size: 22, anchor: "middle", fill: "#FFFFFFE0" })}
    ${text(780, 850, "YOUR voice", { size: 30, weight: "700", anchor: "middle", fill: B.white, italic: true })}

    ${text(780, 950, "AI voice cloning", { size: 22, anchor: "middle", fill: "#FFFFFFE0" })}
    ${text(780, 982, "Subscription", { size: 22, anchor: "middle", fill: "#FFFFFFE0" })}
    ${text(780, 1014, "Best for: this week", { size: 22, weight: "600", anchor: "middle", fill: B.white })}

    <!-- VS badge -->
    <circle cx="${B.W / 2}" cy="780" r="48" fill="${B.bg}" stroke="${B.cardBorder}" stroke-width="2"/>
    ${text(B.W / 2, 793, "vs", { size: 32, weight: "700", anchor: "middle", fill: B.textTertiary, italic: true })}

    ${text(B.W / 2, 1280, "If your gift is days away", { size: 30, weight: "600", anchor: "middle", fill: B.textPrimary, display: true })}
    ${text(B.W / 2, 1320, "→ Porizo is built for that.", { size: 26, anchor: "middle", fill: B.textSecondary, italic: true })}

    ${brandFooter(1500)}
    ${text(B.W / 2, 1538, "porizo.co/songfinch-alternative", { size: 18, anchor: "middle", fill: B.textTertiary })}
  </svg>`;
}

// PIN 5 — Recipe-card / How-to step style
function pin5() {
  function step(y, num, icon, title, body) {
    return `
      <circle cx="160" cy="${y + 30}" r="44" fill="url(#accentGradient)"/>
      ${text(160, y + 44, num, { size: 40, weight: "700", anchor: "middle", fill: B.white, display: true })}
      ${text(240, y + 14, icon + "  " + title, { size: 32, weight: "700", fill: B.textPrimary, display: true })}
      ${text(240, y + 56, body[0], { size: 22, fill: B.textSecondary })}
      ${body[1] ? text(240, y + 90, body[1], { size: 22, fill: B.textSecondary }) : ""}
    `;
  }

  return `<svg width="${B.W}" height="${B.H}" viewBox="0 0 ${B.W} ${B.H}" xmlns="http://www.w3.org/2000/svg">
    ${sharedDefs()}
    <rect width="${B.W}" height="${B.H}" fill="${B.bg}"/>

    ${text(B.W / 2, 130, "RECIPE · 3 MINUTES", { size: 22, weight: "700", anchor: "middle", fill: B.accentDark, tracking: "4" })}

    ${text(B.W / 2, 230, "How to make a", { size: 52, weight: "600", anchor: "middle", fill: B.textPrimary, display: true })}
    ${text(B.W / 2, 300, "personalized Mother's", { size: 52, weight: "700", anchor: "middle", fill: B.textPrimary, display: true })}
    ${text(B.W / 2, 370, "Day song", { size: 52, weight: "700", anchor: "middle", fill: B.accentDark, display: true, italic: true })}

    <!-- Recipe card container -->
    <rect x="80" y="450" width="${B.W - 160}" height="820" rx="28" fill="${B.white}" stroke="${B.cardBorder}" stroke-width="1" filter="url(#cardShadow)"/>

    <!-- Spec line -->
    <line x1="120" y1="510" x2="${B.W - 120}" y2="510" stroke="${B.cardBorder}" stroke-width="1"/>
    ${text(140, 540, "TIME", { size: 16, weight: "700", fill: B.textTertiary, tracking: "2" })}
    ${text(140, 568, "3 minutes", { size: 22, weight: "600", fill: B.textPrimary, display: true })}
    ${text(420, 540, "COST", { size: 16, weight: "700", fill: B.textTertiary, tracking: "2" })}
    ${text(420, 568, "Free to try", { size: 22, weight: "600", fill: B.textPrimary, display: true })}
    ${text(700, 540, "TOOL", { size: 16, weight: "700", fill: B.textTertiary, tracking: "2" })}
    ${text(700, 568, "porizo.co", { size: 22, weight: "600", fill: B.textPrimary, display: true })}
    <line x1="120" y1="610" x2="${B.W - 120}" y2="610" stroke="${B.cardBorder}" stroke-width="1"/>

    ${step(680, "1", "✍️", "Tell one memory", ["A phrase, a meal, a moment.", "Specific beats general — every time."])}
    ${step(840, "2", "🎵", "Pick a sound", ["Country, folk, pop, R&B...", "Whatever fits Mom's taste."])}
    ${step(1000, "3", "💝", "Send the link", ["She plays it instantly,", "no app install required."])}

    <!-- Bottom badge -->
    <rect x="${B.W / 2 - 220}" y="1190" width="440" height="56" rx="28" fill="${B.coralBubble}"/>
    ${text(B.W / 2, 1226, "Sung in YOUR voice on Plus", { size: 22, weight: "600", anchor: "middle", fill: B.accentDark })}

    ${brandFooter(1500)}
    ${text(B.W / 2, 1538, "porizo.co/mothers-day-song", { size: 18, anchor: "middle", fill: B.textTertiary })}
  </svg>`;
}

const PINS = [
  { id: 1, name: "ai-mothers-day-song", fn: pin1 },
  { id: 2, name: "shell-cry", fn: pin2 },
  { id: 3, name: "one-memory-full-song", fn: pin3 },
  { id: 4, name: "songfinch-vs-porizo", fn: pin4 },
  { id: 5, name: "recipe-3-minutes", fn: pin5 },
];

async function main() {
  const args = process.argv.slice(2);
  let only = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--pin") only = parseInt(args[++i], 10);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const targets = only ? PINS.filter((p) => p.id === only) : PINS;
  for (const p of targets) {
    const svg = p.fn();
    const out = path.join(OUTPUT_DIR, `pin-${p.id}-${p.name}.png`);
    await sharp(Buffer.from(svg)).png().toFile(out);
    const size = fs.statSync(out).size;
    console.log(`  pin-${p.id}-${p.name}.png  (${(size / 1024).toFixed(0)} KB)`);
  }
  console.log(`\nGenerated ${targets.length} pin(s) in ${OUTPUT_DIR}`);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
