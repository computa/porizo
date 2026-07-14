import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const assetDir = new URL("../dist/assets/", import.meta.url);
const scripts = readdirSync(assetDir).filter((name) => name.endsWith(".js"));
const gzipBytes = scripts.reduce(
  (total, name) => total + gzipSync(readFileSync(join(assetDir.pathname, name))).byteLength,
  0,
);
const limit = 150 * 1024;

if (gzipBytes > limit) {
  throw new Error(`JavaScript bundle is ${gzipBytes} bytes gzipped; limit is ${limit}.`);
}

console.log(`JavaScript bundle: ${gzipBytes} bytes gzipped (limit ${limit}).`);
