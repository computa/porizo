const path = require("path");
const { initDb } = require("../src/db");
const config = require("../src/config");

function normalizeBaseUrl(value) {
  if (!value) {
    return "";
  }
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function rewriteUrl(url, baseUrl, fromHosts) {
  if (!url || !baseUrl) {
    return { value: url, changed: false };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    if (url.startsWith("/")) {
      const next = `${normalizeBaseUrl(baseUrl)}${url}`;
      return { value: next, changed: next !== url };
    }
    return { value: url, changed: false };
  }
  const host = parsed.hostname;
  if (host && fromHosts.length > 0 && !fromHosts.includes(host)) {
    return { value: url, changed: false };
  }
  const pathPart = parsed.pathname || "";
  if (!pathPart) {
    return { value: url, changed: false };
  }
  const next = `${normalizeBaseUrl(baseUrl)}${pathPart}${parsed.search || ""}`;
  return { value: next, changed: next !== url };
}

function parseArgs(argv) {
  const options = {
    dbPath: config.DB_PATH,
    baseUrl: null,
    dryRun: false,
    fromHosts: ["localhost", "127.0.0.1"],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--db") {
      options.dbPath = argv[i + 1];
      i += 1;
    } else if (arg === "--base-url") {
      options.baseUrl = argv[i + 1];
      i += 1;
    } else if (arg === "--from-host") {
      const raw = argv[i + 1] || "";
      options.fromHosts = raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      i += 1;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.baseUrl) {
    console.error("Usage: node scripts/fix-stream-urls.js --base-url http://<host>:<port> [--db <path>] [--from-host localhost,127.0.0.1] [--dry-run]");
    process.exit(1);
  }

  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fromHosts = options.fromHosts;
  const db = await initDb({
    dbPath: options.dbPath,
    migrationsDir: path.join(process.cwd(), "migrations"),
  });

  const rows = db.prepare(
    "SELECT id, preview_url, full_url, stream_base_url FROM track_versions WHERE preview_url IS NOT NULL OR full_url IS NOT NULL"
  ).all();

  const updateStmt = db.prepare(
    "UPDATE track_versions SET preview_url = ?, full_url = ?, stream_base_url = ? WHERE id = ?"
  );

  let updatedCount = 0;
  for (const row of rows) {
    const previewRewrite = rewriteUrl(row.preview_url, baseUrl, fromHosts);
    const fullRewrite = rewriteUrl(row.full_url, baseUrl, fromHosts);
    if (!previewRewrite.changed && !fullRewrite.changed) {
      continue;
    }
    updatedCount += 1;
    if (!options.dryRun) {
      updateStmt.run(
        previewRewrite.value,
        fullRewrite.value,
        baseUrl,
        row.id
      );
    }
  }

  if (options.dryRun) {
    console.log(`[fix-stream-urls] Would update ${updatedCount} track_versions rows.`);
  } else {
    db.save();
    console.log(`[fix-stream-urls] Updated ${updatedCount} track_versions rows.`);
  }
  db.close();
}

main().catch((err) => {
  console.error("[fix-stream-urls] Failed:", err.message);
  process.exit(1);
});
