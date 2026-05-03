#!/usr/bin/env node
/**
 * Spike: Suno Music Video API
 *
 * Generates a Porizo-style birthday song via sunoapi.org, then converts it to an
 * MP4 via the /api/v1/mp4/generate endpoint. Downloads the resulting video and
 * prints its specs (dimensions, duration, codec, bitrate) via ffprobe.
 *
 * Goal: see the actual visual output and decide whether to add a "share as
 * video" feature to Porizo.
 *
 * Run:
 *   node scripts/test-suno-video-spike.js
 *   node scripts/test-suno-video-spike.js --task-id=<existing> --audio-id=<existing>
 *
 * Requires: SUNO_API_KEY in .env
 */
require("dotenv/config");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const ffprobe = require("@ffprobe-installer/ffprobe");

const SUNO_API_KEY = process.env.SUNO_API_KEY;
const SUNO_BASE_URL = process.env.SUNO_BASE_URL || "https://api.sunoapi.org";
const OUT_DIR = path.join(__dirname, "..", "out", "suno-video-spike");
const POLL_DUMMY_CALLBACK = "https://httpbin.org/post";

// Parse CLI args
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? true];
    })
);

const log = (msg) => console.log(msg);
const die = (msg) => { console.error(`❌ ${msg}`); process.exit(1); };

if (!SUNO_API_KEY) die("SUNO_API_KEY not set in .env");

fs.mkdirSync(OUT_DIR, { recursive: true });

async function authedFetch(pathOrUrl, init = {}) {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${SUNO_BASE_URL}${pathOrUrl}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${SUNO_API_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function generateSong() {
  log("\n━━━ STEP 1: Generate Porizo-style song ━━━");
  const { ok, status, body } = await authedFetch("/api/v1/generate", {
    method: "POST",
    body: JSON.stringify({
      customMode: true,
      instrumental: false,
      model: "V4",
      title: "Birthday for Sarah",
      style: "warm acoustic, intimate, gentle indie folk",
      prompt:
        "[Verse]\nSarah, today the sun is shining just for you\nAnother year of being kind, of being true\n\n[Chorus]\nHappy birthday Sarah, may your day be golden\nEvery wish you whisper softly, may it be chosen",
      callBackUrl: POLL_DUMMY_CALLBACK,
    }),
  });
  if (!ok) die(`Music generation failed (${status}): ${JSON.stringify(body)}`);

  const taskId = body.data?.taskId || body.task_id || body.data?.task_id;
  if (!taskId) die(`No taskId in response: ${JSON.stringify(body)}`);
  log(`   ✅ Task started: ${taskId}`);
  return taskId;
}

async function pollSong(taskId) {
  log("\n━━━ STEP 2: Poll music generation ━━━");
  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const { body } = await authedFetch(`/api/v1/generate/record-info?taskId=${taskId}`);
    const items = Array.isArray(body.data) ? body.data : body.data?.response?.sunoData || [];
    const flag = body.data?.successFlag || body.data?.status;
    log(`   Poll ${i + 1}/36: status=${flag} tracks=${items.length}`);

    if (flag === "SUCCESS" || items.some((t) => t.audioUrl || t.audio_url)) {
      const tracks = items.filter((t) => t.audioUrl || t.audio_url);
      log(`   ✅ ${tracks.length} track(s) ready`);
      tracks.forEach((t, idx) =>
        log(`     [${idx}] id=${t.id} duration=${t.duration ?? "?"}s url=${(t.audioUrl || t.audio_url).slice(0, 60)}...`)
      );
      return tracks;
    }

    if (flag && /FAIL|ERROR/i.test(flag)) {
      die(`Music gen failed: ${flag} — ${JSON.stringify(body.data)}`);
    }
  }
  die("Music generation polling timed out (3 minutes)");
}

async function generateVideo(taskId, audioId) {
  log("\n━━━ STEP 3: Trigger MP4 generation ━━━");
  log(`   taskId=${taskId} audioId=${audioId}`);
  const { ok, status, body } = await authedFetch("/api/v1/mp4/generate", {
    method: "POST",
    body: JSON.stringify({
      taskId,
      audioId,
      callBackUrl: POLL_DUMMY_CALLBACK,
      author: "Porizo",
      domainName: "porizo.co",
    }),
  });
  if (!ok) die(`Video generation failed (${status}): ${JSON.stringify(body)}`);

  const videoTaskId = body.data?.taskId || taskId;
  log(`   ✅ Video task started: ${videoTaskId}`);
  return videoTaskId;
}

async function pollVideo(videoTaskId) {
  log("\n━━━ STEP 4: Poll MP4 generation ━━━");
  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const { body } = await authedFetch(`/api/v1/mp4/record-info?taskId=${videoTaskId}`);
    const flag = body.data?.successFlag;
    const videoUrl = body.data?.response?.videoUrl;
    log(`   Poll ${i + 1}/36: successFlag=${flag}`);

    if (flag === "SUCCESS" && videoUrl) {
      log(`   ✅ Video ready: ${videoUrl.slice(0, 80)}...`);
      return videoUrl;
    }
    if (flag && /FAIL|ERROR|EXCEPTION/i.test(flag)) {
      die(`Video gen failed: ${flag} — code=${body.data?.errorCode} msg=${body.data?.errorMessage}`);
    }
  }
  die("Video generation polling timed out (3 minutes)");
}

async function downloadFile(url, outPath) {
  log(`\n━━━ STEP 5: Download MP4 ━━━`);
  log(`   → ${outPath}`);
  const res = await fetch(url);
  if (!res.ok) die(`Download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buf);
  log(`   ✅ ${(buf.length / 1024 / 1024).toFixed(2)} MB`);
}

function inspectVideo(filePath) {
  log("\n━━━ STEP 6: Inspect with ffprobe ━━━");
  const out = execFileSync(ffprobe.path, [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ], { encoding: "utf8" });
  const data = JSON.parse(out);
  const v = data.streams.find((s) => s.codec_type === "video");
  const a = data.streams.find((s) => s.codec_type === "audio");
  const aspect = v ? `${v.width}x${v.height} (${(v.width / v.height).toFixed(2)}:1)` : "n/a";

  log(`   📐 Resolution:    ${aspect}`);
  log(`   ⏱  Duration:     ${parseFloat(data.format.duration).toFixed(2)}s`);
  log(`   🎬 Video codec:   ${v?.codec_name} @ ${v?.r_frame_rate} fps`);
  log(`   🎵 Audio codec:   ${a?.codec_name} @ ${a?.sample_rate}Hz`);
  log(`   📦 Bitrate:       ${(parseInt(data.format.bit_rate) / 1000).toFixed(0)} kbps`);
  log(`   💾 Size:          ${(parseInt(data.format.size) / 1024 / 1024).toFixed(2)} MB`);

  const ratio = v ? v.width / v.height : 0;
  const orientation = ratio > 1.1 ? "LANDSCAPE 16:9-ish" : ratio < 0.9 ? "VERTICAL 9:16-ish" : "SQUARE 1:1";
  log(`   🧭 Orientation:   ${orientation}`);
  return { aspect, orientation, ratio };
}

(async function main() {
  log("=== Suno Music Video Spike ===");
  log(`Base URL: ${SUNO_BASE_URL}`);
  log(`Output:   ${OUT_DIR}\n`);

  let taskId = args["task-id"];
  let audioId = args["audio-id"];

  if (!taskId || !audioId) {
    taskId = await generateSong();
    const tracks = await pollSong(taskId);
    audioId = tracks[0].id;
    fs.writeFileSync(
      path.join(OUT_DIR, "song-meta.json"),
      JSON.stringify({ taskId, audioId, tracks }, null, 2)
    );
    log(`   💾 Saved song metadata → out/suno-video-spike/song-meta.json`);
  } else {
    log(`Using provided taskId=${taskId} audioId=${audioId}`);
  }

  const videoTaskId = await generateVideo(taskId, audioId);
  const videoUrl = await pollVideo(videoTaskId);

  const outPath = path.join(OUT_DIR, `porizo-suno-${videoTaskId}.mp4`);
  await downloadFile(videoUrl, outPath);
  const specs = inspectVideo(outPath);

  log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  log("VERDICT");
  log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  log(`File:        ${outPath}`);
  log(`Format:      ${specs.aspect} — ${specs.orientation}`);
  log(`Open it:     open "${outPath}"`);
  if (specs.orientation === "LANDSCAPE 16:9-ish") {
    log(`\n⚠️  Landscape only — likely not great for Stories/Reels (9:16).`);
    log(`   Could still work as a "share to WhatsApp / iMessage" feature.`);
  } else if (specs.orientation === "VERTICAL 9:16-ish") {
    log(`\n✅ Vertical — natively shareable to TikTok/Reels/Stories.`);
  }
})().catch((err) => die(err.stack || err.message));
