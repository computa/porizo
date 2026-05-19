#!/usr/bin/env node
/**
 * Generate the free-tier photoreal botanical library v2.
 *
 * For each of 15 occasions, generate 5 Flux variants using rotated slot
 * values, writing each image to:
 *   storage/artwork-library/v2/{occasion}/{n}.jpg   (n = 0..4)
 *
 * Cost: ~$4.50 (75 * $0.06).
 *
 * Usage:
 *   REPLICATE_API_TOKEN=... node scripts/build-artwork-library-v2.mjs
 *   REPLICATE_API_TOKEN=... node scripts/build-artwork-library-v2.mjs --occasions mothers_day,birthday
 */

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// Plain require()-equivalent via dynamic import — keeps the script ESM but
// reuses the CommonJS modules under src/.
const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);
const flux = require(path.join(repoRoot, "src/services/image-providers/flux-image"));
const { assemblePrompt, assembleNegativePrompt } = require(path.join(repoRoot, "src/services/artwork-prompts"));
const {
  OCCASIONS, SPECIES_BY_OCCASION, getDefault, LIGHTING, PALETTE, IMPERFECTION,
} = require(path.join(repoRoot, "src/services/artwork-vocab"));

const LIBRARY_ROOT = path.join(repoRoot, "storage/artwork-library/v2");
const VARIANTS_PER_OCCASION = 5;

function pickVariantVars(occasion, variantIndex) {
  const defaults = getDefault(occasion);
  const species = SPECIES_BY_OCCASION[occasion];
  const lightingKeys = Object.keys(LIGHTING);
  const paletteKeys = Object.keys(PALETTE);

  // Rotate slots to maximize visual diversity across the 5 variants.
  return {
    species: species[variantIndex % species.length],
    lighting: lightingKeys[variantIndex % lightingKeys.length],
    palette: paletteKeys[variantIndex % paletteKeys.length],
    density: defaults.density,
    imperfection: IMPERFECTION[variantIndex % IMPERFECTION.length],
    backdrop: defaults.backdrop,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const occasionsArg = args.find((a) => a.startsWith("--occasions"));
  const occasions = occasionsArg
    ? occasionsArg.split("=")[1].split(",")
    : OCCASIONS;

  fs.mkdirSync(LIBRARY_ROOT, { recursive: true });

  for (const occasion of occasions) {
    const dir = path.join(LIBRARY_ROOT, occasion);
    fs.mkdirSync(dir, { recursive: true });
    for (let n = 0; n < VARIANTS_PER_OCCASION; n++) {
      const outPath = path.join(dir, `${n}.jpg`);
      if (fs.existsSync(outPath)) {
        console.log(`[skip] ${occasion}/${n}.jpg already exists`);
        continue;
      }
      const vars = pickVariantVars(occasion, n);
      const prompt = assemblePrompt({ occasion, vars });
      const neg = assembleNegativePrompt();
      console.log(`[gen ] ${occasion}/${n}.jpg ← species=${vars.species} lighting=${vars.lighting} palette=${vars.palette}`);
      try {
        const buf = await flux.generate({ prompt, negativePrompt: neg });
        fs.writeFileSync(outPath, buf);
        console.log(`[ok  ] ${occasion}/${n}.jpg (${buf.length} bytes)`);
      } catch (err) {
        console.error(`[err ] ${occasion}/${n}.jpg failed: ${err.message}`);
        // continue; let the operator re-run with --occasions to retry
      }
    }
  }
  console.log(`Done. Library at ${LIBRARY_ROOT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
