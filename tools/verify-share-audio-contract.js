#!/usr/bin/env node

const DEFAULT_BASE_URL = process.env.PUBLIC_BASE_URL || "https://porizo.co";
const DEFAULT_RANGE = "bytes=0-999";

function readArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

function usage() {
  console.error(
    [
      "Usage:",
      "  npm run verify:share-audio -- --share-id <id> [--base-url https://porizo.co]",
      "  npm run verify:share-audio -- --url https://porizo.co/share/<id>/audio",
      "",
      "Env fallback:",
      "  SHARE_AUDIO_SMOKE_SHARE_ID=<id>",
    ].join("\n"),
  );
}

function buildAudioUrl() {
  const explicitUrl = readArg("--url") || process.env.SHARE_AUDIO_SMOKE_URL;
  if (explicitUrl) return explicitUrl;

  const shareId =
    readArg("--share-id") || process.env.SHARE_AUDIO_SMOKE_SHARE_ID;
  if (!shareId) {
    usage();
    process.exit(2);
  }

  const baseUrl = (readArg("--base-url") || DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  return `${baseUrl}/share/${encodeURIComponent(shareId)}/audio`;
}

function assertContract(condition, message, details = {}) {
  if (condition) return;
  const suffix = Object.keys(details).length
    ? ` ${JSON.stringify(details)}`
    : "";
  throw new Error(`${message}${suffix}`);
}

async function verifyShareAudioContract(url) {
  const head = await fetch(url, { method: "HEAD" });
  const headLength = Number(head.headers.get("content-length") || "0");
  const headType = head.headers.get("content-type") || "";
  assertContract(head.ok, "HEAD must return success", {
    status: head.status,
    url,
  });
  assertContract(headLength > 0, "HEAD content-length must be positive", {
    contentLength: head.headers.get("content-length"),
    url,
  });
  assertContract(
    headType.startsWith("audio/"),
    "HEAD content-type must be audio",
    { contentType: headType, url },
  );

  const ranged = await fetch(url, { headers: { Range: DEFAULT_RANGE } });
  const body = Buffer.from(await ranged.arrayBuffer());
  const rangeLength = Number(ranged.headers.get("content-length") || "0");
  assertContract(
    ranged.status === 206,
    "Range GET must return 206 Partial Content",
    { status: ranged.status, url },
  );
  assertContract(body.length > 0, "Range GET body must contain bytes", {
    bodyLength: body.length,
    url,
  });
  assertContract(
    rangeLength === body.length,
    "Range GET content-length must match body bytes",
    { contentLength: rangeLength, bodyLength: body.length, url },
  );
  assertContract(
    /^bytes 0-999\/\d+$/.test(ranged.headers.get("content-range") || ""),
    "Range GET content-range must describe the requested slice",
    { contentRange: ranged.headers.get("content-range"), url },
  );

  return {
    url,
    headStatus: head.status,
    totalBytes: headLength,
    rangeStatus: ranged.status,
    rangeBytes: body.length,
    contentRange: ranged.headers.get("content-range"),
  };
}

async function main() {
  const url = buildAudioUrl();
  const result = await verifyShareAudioContract(url);
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main().catch((err) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: err.message,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
