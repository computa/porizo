#!/usr/bin/env node
/**
 * Library curation tool.
 *
 * Walks storage/artwork-library/{occasion}/{style}/v1.jpg, generates an HTML
 * review grid, and serves it on a local port. Reviewer marks each tile as
 * accept / reject (rejections write to curation.json with reasons so the
 * bootstrap script can re-roll them).
 *
 * Usage:
 *   node scripts/curate-artwork-library.mjs                 # opens http://localhost:8765
 *   node scripts/curate-artwork-library.mjs --port=9000
 *   node scripts/curate-artwork-library.mjs --report-only   # print summary to stdout, skip server
 *
 * curation.json schema:
 *   {
 *     "<occasion>/<style>": {
 *       "status": "accept" | "reject" | "pending",
 *       "reason": "text leak" | "face visible" | ...,
 *       "reviewed_at": "2026-05-16T..."
 *     }
 *   }
 *
 * After curation, re-roll rejections via:
 *   node scripts/build-artwork-library.mjs --force --only=$(grep reject curation.json | ...)
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const require = (await import("node:module")).createRequire(import.meta.url);
const { listAllPrompts } = require(
  path.join(projectRoot, "src/services/artwork-prompts"),
);

const args = parseArgs(process.argv.slice(2));
const PORT = parseInt(args.port, 10) || 8765;
const REPORT_ONLY = !!args["report-only"];

const STORAGE_ROOT =
  process.env.STORAGE_ROOT || path.join(projectRoot, "storage");
const LIBRARY_ROOT = path.join(STORAGE_ROOT, "artwork-library");
const CURATION_FILE = path.join(LIBRARY_ROOT, "curation.json");

function loadCuration() {
  try {
    return JSON.parse(fs.readFileSync(CURATION_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveCuration(state) {
  fs.mkdirSync(LIBRARY_ROOT, { recursive: true });
  fs.writeFileSync(CURATION_FILE, JSON.stringify(state, null, 2));
}

function buildTiles() {
  const prompts = listAllPrompts();
  const state = loadCuration();
  return prompts.map(({ occasion, style, prompt }) => {
    const key = `${occasion}/${style}`;
    const imagePath = path.join(LIBRARY_ROOT, occasion, style, "v1.jpg");
    const exists = fs.existsSync(imagePath);
    return {
      key,
      occasion,
      style,
      prompt,
      exists,
      status: (state[key] && state[key].status) || "pending",
      reason: (state[key] && state[key].reason) || "",
      reviewedAt: state[key] && state[key].reviewed_at,
    };
  });
}

function summarize(tiles) {
  const buckets = { accept: 0, reject: 0, pending: 0, missing: 0 };
  for (const t of tiles) {
    if (!t.exists) buckets.missing += 1;
    else buckets[t.status] += 1;
  }
  return buckets;
}

if (REPORT_ONLY) {
  const tiles = buildTiles();
  const buckets = summarize(tiles);
  console.log(`[Curation] Library at ${LIBRARY_ROOT}`);
  console.log(`  total      : ${tiles.length}`);
  console.log(`  accept     : ${buckets.accept}`);
  console.log(`  reject     : ${buckets.reject}`);
  console.log(`  pending    : ${buckets.pending}`);
  console.log(`  missing    : ${buckets.missing}`);
  const rejects = tiles
    .filter((t) => t.status === "reject")
    .map((t) => `${t.key} — ${t.reason || "(no reason)"}`);
  if (rejects.length > 0) {
    console.log("\nRejections (re-roll with --force --only=...):");
    for (const line of rejects) console.log(`  ${line}`);
  }
  process.exit(0);
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    return renderIndex(res);
  }
  if (req.method === "GET" && req.url.startsWith("/img/")) {
    return serveImage(req, res);
  }
  if (req.method === "POST" && req.url === "/decision") {
    return recordDecision(req, res);
  }
  res.writeHead(404);
  res.end("not found");
});

function renderIndex(res) {
  const tiles = buildTiles();
  const buckets = summarize(tiles);
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Artwork Library Curation</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 1.5rem; background: #1a1a1a; color: #eee; }
  h1 { margin: 0 0 0.5rem; font-size: 1.5rem; }
  .summary { margin-bottom: 1.5rem; color: #aaa; font-size: 0.9rem; }
  .summary span { margin-right: 1rem; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
  .tile { background: #2a2a2a; border-radius: 6px; overflow: hidden; display: flex; flex-direction: column; }
  .tile img { width: 100%; height: auto; display: block; background: #444; }
  .tile.missing { padding: 2rem; text-align: center; color: #888; min-height: 200px; display: flex; align-items: center; justify-content: center; }
  .tile-body { padding: 0.75rem; }
  .tile-key { font-weight: 600; }
  .tile-prompt { color: #999; font-size: 0.75rem; margin-top: 0.25rem; line-height: 1.4; max-height: 4rem; overflow: hidden; }
  .actions { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
  .actions button { flex: 1; padding: 0.5rem; border: 0; border-radius: 4px; background: #444; color: #eee; cursor: pointer; font-size: 0.85rem; }
  .actions button.accept { background: #2a5a2a; }
  .actions button.reject { background: #5a2a2a; }
  .actions button.active { outline: 2px solid #888; }
  .reason-input { width: 100%; margin-top: 0.5rem; padding: 0.4rem; background: #1a1a1a; color: #eee; border: 1px solid #444; border-radius: 4px; font-family: inherit; font-size: 0.8rem; box-sizing: border-box; }
  .status-accept { color: #6a6; }
  .status-reject { color: #c66; }
  .status-pending { color: #aaa; }
</style></head><body>
<h1>Artwork Library Curation</h1>
<div class="summary">
  <span>Total: <strong>${tiles.length}</strong></span>
  <span class="status-accept">Accept: ${buckets.accept}</span>
  <span class="status-reject">Reject: ${buckets.reject}</span>
  <span class="status-pending">Pending: ${buckets.pending}</span>
  <span style="color: #c66;">Missing: ${buckets.missing}</span>
</div>
<div class="grid">
${tiles.map((t) => renderTile(t)).join("")}
</div>
<script>
async function decide(key, status) {
  const reason = document.getElementById('reason-' + key.replace('/','-')).value;
  await fetch('/decision', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ key, status, reason })});
  location.reload();
}
</script>
</body></html>`;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function renderTile(t) {
  const tileId = t.key.replace("/", "-");
  if (!t.exists) {
    return `<div class="tile missing">
      <div>
        <div class="tile-key">${escapeHtml(t.key)}</div>
        <div style="margin-top:0.5rem;">Not generated yet</div>
      </div>
    </div>`;
  }
  return `<div class="tile">
    <img src="/img/${encodeURIComponent(t.occasion)}/${encodeURIComponent(t.style)}" alt="${escapeHtml(t.key)}">
    <div class="tile-body">
      <div class="tile-key">${escapeHtml(t.key)} <span class="status-${t.status}">[${t.status}]</span></div>
      <div class="tile-prompt">${escapeHtml(t.prompt.slice(0, 280))}${t.prompt.length > 280 ? "…" : ""}</div>
      <input type="text" class="reason-input" id="reason-${tileId}"
        placeholder="reason (e.g. text leaked, face visible)"
        value="${escapeHtml(t.reason)}">
      <div class="actions">
        <button class="accept ${t.status === "accept" ? "active" : ""}"
          onclick="decide('${t.key}', 'accept')">Accept</button>
        <button class="reject ${t.status === "reject" ? "active" : ""}"
          onclick="decide('${t.key}', 'reject')">Reject</button>
      </div>
    </div>
  </div>`;
}

function serveImage(req, res) {
  const parts = req.url.split("/").slice(2).map((p) => decodeURIComponent(p));
  if (parts.length !== 2) {
    res.writeHead(400);
    return res.end("bad path");
  }
  const [occasion, style] = parts;
  // Whitelist via the prompt registry — prevents any '../' escape.
  const valid = listAllPrompts().some(
    (p) => p.occasion === occasion && p.style === style,
  );
  if (!valid) {
    res.writeHead(400);
    return res.end("invalid occasion/style");
  }
  const imagePath = path.join(LIBRARY_ROOT, occasion, style, "v1.jpg");
  if (!fs.existsSync(imagePath)) {
    res.writeHead(404);
    return res.end("not generated");
  }
  res.writeHead(200, {
    "Content-Type": "image/jpeg",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(imagePath).pipe(res);
}

function recordDecision(req, res) {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 10_000) req.destroy();
  });
  req.on("end", () => {
    try {
      const { key, status, reason } = JSON.parse(body);
      const valid = listAllPrompts().some(
        (p) => `${p.occasion}/${p.style}` === key,
      );
      if (!valid || !["accept", "reject", "pending"].includes(status)) {
        res.writeHead(400);
        return res.end("invalid");
      }
      const state = loadCuration();
      state[key] = {
        status,
        reason: (reason || "").slice(0, 200),
        reviewed_at: new Date().toISOString(),
      };
      saveCuration(state);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400);
      res.end(`bad request: ${err.message}`);
    }
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

server.listen(PORT, () => {
  console.log(`[Curation] http://localhost:${PORT}`);
  console.log(`[Curation] Library: ${LIBRARY_ROOT}`);
  console.log(`[Curation] State:   ${CURATION_FILE}`);
});
