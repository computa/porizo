#!/usr/bin/env node
/**
 * Synthetic probe for share audio playback.
 *
 * Hits a canonical /share/:id/audio URL on production and asserts the
 * end-to-end byte flow (the contract that broke silently on 2026-05-10).
 *
 * Exit codes:
 *   0  — all assertions pass
 *   1  — assertion failed (audio not playable)
 *   2  — network/transport error
 *
 * Usage:
 *   node scripts/probe-share-audio.mjs                        # default canary
 *   PROBE_SHARE_ID=<id> node scripts/probe-share-audio.mjs    # custom token
 *   PROBE_BASE_URL=https://staging.example node scripts/...   # custom env
 *
 * Schedule daily via launchd (~/Library/LaunchAgents/co.porizo.audio-probe.plist):
 *
 *   <key>ProgramArguments</key>
 *   <array>
 *     <string>/opt/homebrew/bin/node</string>
 *     <string>/Users/ao/Documents/projects/porizo/scripts/probe-share-audio.mjs</string>
 *   </array>
 *   <key>StartCalendarInterval</key>
 *   <dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
 *   <key>StandardErrorPath</key>
 *   <string>/Users/ao/Documents/projects/porizo/.state/probe-stderr.log</string>
 *
 * launchd will email the user on non-zero exit if MAILTO is set, or you can
 * tail the stderr log. For Slack/Discord alerts wrap this script in a shell
 * one-liner that posts to a webhook on failure.
 */

const BASE_URL = process.env.PROBE_BASE_URL || "https://api.porizo.co";
const SHARE_ID = process.env.PROBE_SHARE_ID || "Rrm8PRM3tlwV";
const URL = `${BASE_URL}/share/${SHARE_ID}/audio`;
const RANGE_BYTES = 1024 * 32; // 32 KB sample is enough to verify byte flow

const FAILURES = [];
function fail(reason) {
  FAILURES.push(reason);
}

function ok(label, msg) {
  process.stdout.write(`  ✓ ${label}: ${msg}\n`);
}

async function main() {
  const start = Date.now();
  console.log(`Probing ${URL}`);

  let r;
  try {
    r = await fetch(URL, {
      headers: {
        Range: `bytes=0-${RANGE_BYTES - 1}`,
        "User-Agent": "porizo-share-probe/1.0",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    console.error(`✖ network error: ${err.message}`);
    process.exit(2);
  }

  // 1. Status
  if (r.status === 200 || r.status === 206) {
    ok("status", String(r.status));
  } else {
    fail(`expected 200/206, got ${r.status}`);
  }

  // 2. Content-type must start with audio/
  const ct = r.headers.get("content-type") || "";
  if (/^audio\//i.test(ct)) {
    ok("content-type", ct);
  } else {
    fail(`content-type must start with audio/, got "${ct}"`);
  }

  // 3. Content-Length advertised
  const cl = Number(r.headers.get("content-length") || 0);
  if (cl > 0) {
    ok("content-length", `${cl} bytes`);
  } else {
    fail(`content-length must be > 0, got ${cl}`);
  }

  // 4. Body actually contains bytes
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 0) {
    ok("body bytes", `${buf.length} received`);
  } else {
    fail(`body must contain bytes, got 0`);
  }

  // 5. Body matches advertised length
  if (cl > 0 && buf.length !== cl) {
    fail(`content-length=${cl} but received ${buf.length} bytes`);
  } else if (cl > 0) {
    ok("byte-flow integrity", "content-length matches body size");
  }

  // 6. Magic bytes — m4a containers begin with `<size:4>ftyp...` (ISO-BMFF).
  //    Skip this check on Range requests that don't include byte 0.
  const cr = r.headers.get("content-range") || "";
  const startsAtZero = cr.startsWith("bytes 0-") || !cr;
  if (startsAtZero && buf.length >= 8) {
    const atom = buf.subarray(4, 8).toString("ascii");
    if (atom === "ftyp") {
      ok("m4a header", `valid ftyp atom`);
    } else {
      fail(`expected ftyp atom at byte 4, got "${atom}"`);
    }
  }

  const elapsed = Date.now() - start;
  if (FAILURES.length === 0) {
    console.log(`\n✓ AUDIO PROBE OK (${elapsed}ms)`);
    process.exit(0);
  }

  console.error(`\n✖ AUDIO PROBE FAILED (${elapsed}ms)`);
  for (const f of FAILURES) console.error(`  ✖ ${f}`);
  // Dump headers + a sample of the body to make Railway log triage trivial.
  console.error("\nresponse headers:");
  for (const [k, v] of r.headers) console.error(`  ${k}: ${v}`);
  console.error(
    `\nbody preview (first 80 hex bytes): ${buf.subarray(0, 80).toString("hex")}`,
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(`unhandled error: ${err.stack || err.message}`);
  process.exit(2);
});
