/**
 * One-off: generate the Father's Day in-app-event card.
 *
 *   node scripts/gen-fathers-day-event-card.mjs
 *
 * gpt-image-2 only does 1024x1024 / 1024x1536 / 1536x1024, none of which is 16:9.
 * So we generate the landscape 1536x1024 (3:2) and sharp cover-crops it to the
 * exact 1920x1080 (16:9) Apple requires, flattened onto the Warm Canvas bg so
 * there's no alpha. NO text is requested in the prompt — Apple overlays the event
 * name and rejects cards that bake in duplicate text.
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
require("dotenv").config();
const sharp = require("sharp");
const { generate } = require("../src/services/image-providers/openai-image.js");

const WARM_CANVAS_BG = "#F5F0EB";

const PROMPT = [
  "Warm, cinematic editorial photograph for a premium personalized-song gift brand.",
  "Intimate Father's Day mood: a father's hand and a small child's hand resting together",
  "on an old vinyl record beside a vintage record player, a pair of headphones nearby.",
  "Golden-hour sunlight, soft shallow depth of field, gentle film grain, a faint warm",
  "glow of soundwaves in the background. Palette: warm cream, soft beige, honeyed gold,",
  "muted terracotta — cozy, nostalgic, understated, emotionally tender.",
  "Centered composition with generous empty margins and headroom so it crops cleanly to 16:9.",
  "Absolutely NO text, NO words, NO letters, NO numbers, NO logos, NO watermarks, NO UI.",
  "Photorealistic, magazine-quality, no human faces.",
].join(" ");

const OUT_DIR = "marketing/appstore/aso";
const RAW = path.join(OUT_DIR, "fathers-day-event-card-raw-1536x1024.png");
const FINAL = path.join(OUT_DIR, "fathers-day-event-card-1920x1080.jpg");

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log("Generating (gpt-image-2, 1536x1024, high)… this can take ~2 min.");
  const buf = await generate({ prompt: PROMPT, size: "1536x1024", quality: "high" });
  fs.writeFileSync(RAW, buf);
  console.log(`raw written: ${RAW} (${(buf.length / 1024).toFixed(0)} KB)`);

  await sharp(buf)
    .resize(1920, 1080, { fit: "cover", position: "centre" })
    .flatten({ background: WARM_CANVAS_BG })
    .jpeg({ quality: 90 })
    .toFile(FINAL);

  const meta = await sharp(FINAL).metadata();
  console.log(`final written: ${FINAL} — ${meta.width}x${meta.height} ${meta.format}, hasAlpha=${meta.hasAlpha}`);
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
