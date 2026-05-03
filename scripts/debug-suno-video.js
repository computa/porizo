#!/usr/bin/env node
/**
 * Debug helper: inspect Suno music + video task responses to fix the spike.
 */
require("dotenv/config");
const fs = require("fs");
const path = require("path");

const SUNO_API_KEY = process.env.SUNO_API_KEY;
const SUNO_BASE_URL = process.env.SUNO_BASE_URL || "https://api.sunoapi.org";

async function get(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${SUNO_API_KEY}` } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function post(pathPart, body) {
  const res = await fetch(`${SUNO_BASE_URL}${pathPart}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SUNO_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

(async () => {
  const meta = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "out", "suno-video-spike", "song-meta.json"), "utf8"));
  console.log(`taskId=${meta.taskId} audioId=${meta.audioId}`);

  // 1. Re-check music status — is the full song SUCCESS now?
  console.log("\n=== Music task status ===");
  const m = await get(`${SUNO_BASE_URL}/api/v1/generate/record-info?taskId=${meta.taskId}`);
  console.log(`HTTP ${m.status}`);
  console.log(JSON.stringify(m.body, null, 2));

  // 2. Try video gen again, log FULL response
  console.log("\n=== Trigger video gen ===");
  const v = await post("/api/v1/mp4/generate", {
    taskId: meta.taskId,
    audioId: meta.audioId,
    callBackUrl: "https://httpbin.org/post",
    author: "Porizo",
    domainName: "porizo.co",
  });
  console.log(`HTTP ${v.status}`);
  console.log(JSON.stringify(v.body, null, 2));

  const videoTaskId = v.body.data?.taskId;
  if (!videoTaskId) {
    console.log("\n⚠️ No video taskId returned. Exiting.");
    return;
  }
  console.log(`\nVideo taskId returned: ${videoTaskId} (different from music? ${videoTaskId !== meta.taskId})`);

  // 3. Wait 10s and check video status — full response
  await new Promise((r) => setTimeout(r, 10000));
  console.log("\n=== Video task status (after 10s) ===");
  const vs = await get(`${SUNO_BASE_URL}/api/v1/mp4/record-info?taskId=${videoTaskId}`);
  console.log(`HTTP ${vs.status}`);
  console.log(JSON.stringify(vs.body, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
