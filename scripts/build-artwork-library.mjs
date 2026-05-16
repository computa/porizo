#!/usr/bin/env node
/**
 * One-time CLI: build the per-occasion artwork library.
 *
 * Walks the 15 × 3 prompt matrix and writes one base image per (occasion, style)
 * pair to storage/artwork-library/{occasion}/{style}/v1.jpg.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node scripts/build-artwork-library.mjs
 *
 * Flags:
 *   --quality=medium|high|low   default: medium  (cost: $0.053 / $0.211 / $0.006 per image)
 *   --dry-run                   print prompts, skip API calls
 *   --only=birthday,wedding     restrict to specific occasions
 *   --force                     re-roll even if file exists (otherwise skip existing)
 *   --concurrency=N             parallel requests (default 5)
 *
 * Idempotent: skips any (occasion, style) whose v1.jpg already exists unless --force.
 * Budget at default medium quality: 45 × $0.053 ≈ $2.40 (plus optional re-roll buffer).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

// CommonJS interop — the prompt module + provider are CJS
const require = (await import("node:module")).createRequire(import.meta.url);
const { listAllPrompts } = require(path.join(projectRoot, "src/services/artwork-prompts"));
const { getImageProvider } = require(path.join(projectRoot, "src/services/image-providers"));

const args = parseArgs(process.argv.slice(2));
const quality = args.quality || "medium";
const dryRun = !!args["dry-run"];
const force = !!args.force;
const only = args.only ? new Set(args.only.split(",").map((s) => s.trim())) : null;

const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(projectRoot, "storage");
const LIBRARY_ROOT = path.join(STORAGE_ROOT, "artwork-library");

const CONCURRENCY = Math.max(1, parseInt(args.concurrency, 10) || 5);

async function main() {
  const all = listAllPrompts();
  const work = only ? all.filter((p) => only.has(p.occasion)) : all;

  console.log(
    `[BuildLibrary] ${work.length} prompts (quality=${quality}, dryRun=${dryRun}, force=${force}, concurrency=${CONCURRENCY})`
  );
  console.log(`[BuildLibrary] Output root: ${LIBRARY_ROOT}`);

  if (!dryRun && !process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is required (or pass --dry-run)");
    process.exit(1);
  }

  const provider = dryRun ? null : getImageProvider();
  const counts = { generated: 0, skipped: 0, failed: 0 };

  await pMap(work, CONCURRENCY, (item) =>
    processOne(item, provider, counts),
  );

  console.log(
    `\n[BuildLibrary] Done. generated=${counts.generated} skipped=${counts.skipped} failed=${counts.failed}`
  );
  if (counts.failed > 0) process.exit(1);
}

async function processOne({ occasion, style, prompt }, provider, counts) {
  const outDir = path.join(LIBRARY_ROOT, occasion, style);
  const outPath = path.join(outDir, "v1.jpg");

  if (!force && fs.existsSync(outPath)) {
    console.log(`[BuildLibrary] SKIP ${occasion}/${style} (exists)`);
    counts.skipped += 1;
    return;
  }

  if (dryRun) {
    console.log(`[BuildLibrary] DRY ${occasion}/${style}`);
    console.log(`    ${prompt.slice(0, 200)}${prompt.length > 200 ? "…" : ""}`);
    return;
  }

  try {
    console.log(`[BuildLibrary] GEN ${occasion}/${style}`);
    const buf = await provider.generate({
      prompt,
      size: "1024x1536",
      quality,
    });
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, buf);
    console.log(`    -> ${outPath} (${(buf.length / 1024).toFixed(1)} KB)`);
    counts.generated += 1;
  } catch (err) {
    console.error(`[BuildLibrary] FAIL ${occasion}/${style}: ${err.message}`);
    counts.failed += 1;
  }
}

async function pMap(items, n, fn) {
  const queue = items.slice();
  const workers = Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await fn(item);
    }
  });
  await Promise.all(workers);
}

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const [k, v] = a.slice(2).split("=");
    out[k] = v === undefined ? true : v;
  }
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
