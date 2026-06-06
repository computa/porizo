#!/usr/bin/env node
// Retry only paper-art with extended timeout.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const require = (await import("node:module")).createRequire(import.meta.url);

process.env.OPENAI_IMAGE_TIMEOUT_MS = "240000";

const { buildPrompt } = require(
  path.join(projectRoot, "src/services/artwork-prompts"),
);
const { getImageProvider } = require(
  path.join(projectRoot, "src/services/image-providers"),
);
const { compositeArtworkWithText } = require(
  path.join(projectRoot, "src/services/cover-generator"),
);

const styleDir = path.join(
  projectRoot,
  "storage/samples/chioma-birthday/paper-art",
);
fs.mkdirSync(styleDir, { recursive: true });

const t0 = Date.now();
const prompt = buildPrompt({ occasion: "birthday", style: "paper-art" });
console.log("[paper-art] generating (gpt-image-2 high, 1024x1536, 240s budget)…");
const buf = await getImageProvider().generate({
  prompt,
  size: "1024x1536",
  quality: "high",
});
const basePath = path.join(styleDir, "base.jpg");
fs.writeFileSync(basePath, buf);
console.log(
  `[paper-art] base: ${basePath} (${(buf.length / 1024).toFixed(1)} KB, ${(Date.now() - t0) / 1000}s)`,
);

const finalPath = await compositeArtworkWithText({
  baseImagePath: basePath,
  recipientName: "Chioma",
  occasion: "birthday",
  outputDir: styleDir,
  targetAspect: "9:16",
});
console.log(`[paper-art] FINAL: ${finalPath}`);
