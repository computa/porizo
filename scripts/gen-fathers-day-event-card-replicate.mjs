/**
 * One-off: generate the Father's Day in-app-event card via Replicate Flux 1.1 Pro.
 *
 *   node scripts/gen-fathers-day-event-card-replicate.mjs
 *
 * Used because the OpenAI account hit its billing hard limit. Flux supports native
 * 16:9, so no crop is needed; sharp only normalizes to exactly 1920x1080 (no alpha).
 * NO text is requested — Apple overlays the event name and rejects baked-in duplicate text.
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
require("dotenv").config();
const sharp = require("sharp");

const TOKEN = process.env.REPLICATE_API_TOKEN;
const WARM_CANVAS_BG = "#F5F0EB";
const MODEL = "black-forest-labs/flux-1.1-pro";

const PROMPT = [
  "Vertical 9:16 warm, cinematic editorial photograph for a premium personalized-song gift brand.",
  "Intimate Father's Day mood, shot looking down: a father's hand and a small child's hand",
  "resting together on an old vinyl record on a vintage record player, a pair of headphones nearby.",
  "Golden-hour sunlight, soft shallow depth of field, gentle film grain, a faint warm",
  "glow of soundwaves in the background. Palette: warm cream, soft beige, honeyed gold,",
  "muted terracotta — cozy, nostalgic, understated, emotionally tender.",
  "Vertical composition with the hands in the lower-center third and calm warm bokeh in the",
  "upper area, generous empty margins.",
  "Absolutely no text, no words, no letters, no numbers, no logos, no watermarks, no UI.",
  "Photorealistic, magazine-quality, no human faces.",
].join(" ");

const OUT_DIR = "marketing/appstore/aso";
const RAW = path.join(OUT_DIR, "fathers-day-event-card-raw.png");
const FINAL = path.join(OUT_DIR, "fathers-day-event-details-1080x1920.jpg");

async function main() {
  if (!TOKEN) throw new Error("REPLICATE_API_TOKEN not set");
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Generating via Replicate ${MODEL} (16:9)…`);
  const res = await fetch(
    `https://api.replicate.com/v1/models/${MODEL}/predictions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      body: JSON.stringify({
        input: {
          prompt: PROMPT,
          aspect_ratio: "9:16",
          output_format: "png",
          prompt_upsampling: true,
          safety_tolerance: 2,
        },
      }),
    },
  );

  const pred = await res.json();
  if (!res.ok) {
    throw new Error(`Replicate ${res.status}: ${JSON.stringify(pred).slice(0, 300)}`);
  }

  // With Prefer: wait the prediction is usually terminal; poll briefly if not.
  let out = pred;
  for (let i = 0; i < 30 && out.status !== "succeeded" && out.status !== "failed"; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const p = await fetch(out.urls.get, { headers: { Authorization: `Bearer ${TOKEN}` } });
    out = await p.json();
  }
  if (out.status !== "succeeded") {
    throw new Error(`prediction ${out.status}: ${out.error || "unknown"}`);
  }

  const url = Array.isArray(out.output) ? out.output[0] : out.output;
  const img = await fetch(url);
  const buf = Buffer.from(await img.arrayBuffer());
  fs.writeFileSync(RAW, buf);
  console.log(`raw written: ${RAW} (${(buf.length / 1024).toFixed(0)} KB)`);

  await sharp(buf)
    .resize(1080, 1920, { fit: "cover", position: "centre" })
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
