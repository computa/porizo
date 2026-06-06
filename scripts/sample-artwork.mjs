#!/usr/bin/env node
// One-off sample: birthday × all 3 styles for recipient "Chioma".
// Generates base images via gpt-image-2, composites "For Chioma / Happy Birthday"
// via the same sharp pipeline production uses.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const require = (await import("node:module")).createRequire(import.meta.url);

const { buildPrompt, VALID_STYLES } = require(
  path.join(projectRoot, "src/services/artwork-prompts"),
);
const { getImageProvider } = require(
  path.join(projectRoot, "src/services/image-providers"),
);
const { compositeArtworkWithText } = require(
  path.join(projectRoot, "src/services/cover-generator"),
);

const OCCASION = "birthday";
const RECIPIENT = "Chioma";
const OUT_DIR = path.join(projectRoot, "storage", "samples", "chioma-birthday");
fs.mkdirSync(OUT_DIR, { recursive: true });

const styles = Array.from(VALID_STYLES);
console.log(
  `[sample] occasion=${OCCASION} recipient=${RECIPIENT} styles=${styles.join(",")}`,
);
console.log(`[sample] output dir: ${OUT_DIR}`);

const provider = getImageProvider();

async function generateOne(style) {
  const t0 = Date.now();
  const styleDir = path.join(OUT_DIR, style);
  fs.mkdirSync(styleDir, { recursive: true });

  const prompt = buildPrompt({ occasion: OCCASION, style });
  console.log(`[${style}] generating (gpt-image-2 high, 1024x1536) …`);
  const buf = await provider.generate({
    prompt,
    size: "1024x1536",
    quality: "high",
  });
  const basePath = path.join(styleDir, "base.jpg");
  fs.writeFileSync(basePath, buf);
  console.log(
    `[${style}] base: ${basePath} (${(buf.length / 1024).toFixed(1)} KB, ${(Date.now() - t0) / 1000}s)`,
  );

  console.log(`[${style}] compositing typography …`);
  const finalPath = await compositeArtworkWithText({
    baseImagePath: basePath,
    recipientName: RECIPIENT,
    occasion: OCCASION,
    outputDir: styleDir,
    targetAspect: "9:16",
  });
  console.log(`[${style}] FINAL: ${finalPath}`);
  return { style, basePath, finalPath };
}

const results = await Promise.all(styles.map(generateOne));
console.log("\n=== Sample artwork ready ===");
for (const r of results) {
  console.log(`  ${r.style.padEnd(14)} → ${r.finalPath}`);
}
