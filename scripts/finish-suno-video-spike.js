#!/usr/bin/env node
/**
 * Continue the spike: poll an existing video taskId, download, inspect.
 * Use after debug-suno-video.js created a PENDING video task.
 */
require("dotenv/config");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const ffprobe = require("@ffprobe-installer/ffprobe");

const SUNO_API_KEY = process.env.SUNO_API_KEY;
const SUNO_BASE_URL = process.env.SUNO_BASE_URL || "https://api.sunoapi.org";
const VIDEO_TASK_ID = process.argv[2] || "e7a6b9f3d91c93282a5bb2e610520e7f";
const OUT_DIR = path.join(__dirname, "..", "out", "suno-video-spike");

(async () => {
  console.log(`Polling video taskId=${VIDEO_TASK_ID}\n`);

  let videoUrl = null;
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`${SUNO_BASE_URL}/api/v1/mp4/record-info?taskId=${VIDEO_TASK_ID}`, {
      headers: { Authorization: `Bearer ${SUNO_API_KEY}` },
    });
    const body = await res.json();
    const flag = body.data?.successFlag;
    const url = body.data?.response?.videoUrl;
    console.log(`Poll ${i + 1}/60: successFlag=${flag} videoUrl=${url ? "✅" : "—"}`);

    if (flag === "SUCCESS" && url) { videoUrl = url; break; }
    if (flag && /FAIL|EXCEPTION/i.test(flag)) {
      console.error(`❌ ${flag}: ${body.data?.errorMessage || "unknown"}`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }

  if (!videoUrl) { console.error("Timed out"); process.exit(1); }

  console.log(`\nDownloading: ${videoUrl}`);
  const buf = Buffer.from(await (await fetch(videoUrl)).arrayBuffer());
  const outPath = path.join(OUT_DIR, `porizo-suno-${VIDEO_TASK_ID}.mp4`);
  fs.writeFileSync(outPath, buf);
  console.log(`Saved: ${outPath} (${(buf.length / 1024 / 1024).toFixed(2)} MB)\n`);

  console.log("━━━ ffprobe ━━━");
  const probe = JSON.parse(execFileSync(ffprobe.path, [
    "-v", "error", "-print_format", "json", "-show_format", "-show_streams", outPath,
  ], { encoding: "utf8" }));

  const v = probe.streams.find((s) => s.codec_type === "video");
  const a = probe.streams.find((s) => s.codec_type === "audio");
  const ratio = v ? v.width / v.height : 0;
  const orientation = ratio > 1.1 ? "LANDSCAPE 16:9-ish" : ratio < 0.9 ? "VERTICAL 9:16-ish" : "SQUARE 1:1";

  console.log(`Resolution:  ${v?.width}x${v?.height} (${ratio.toFixed(2)}:1) — ${orientation}`);
  console.log(`Duration:    ${parseFloat(probe.format.duration).toFixed(2)}s`);
  console.log(`Video codec: ${v?.codec_name} @ ${v?.r_frame_rate} fps`);
  console.log(`Audio codec: ${a?.codec_name} @ ${a?.sample_rate}Hz`);
  console.log(`Bitrate:     ${(parseInt(probe.format.bit_rate) / 1000).toFixed(0)} kbps`);
  console.log(`File size:   ${(parseInt(probe.format.size) / 1024 / 1024).toFixed(2)} MB`);
  console.log(`\nOpen it:     open "${outPath}"`);
})().catch((e) => { console.error(e); process.exit(1); });
