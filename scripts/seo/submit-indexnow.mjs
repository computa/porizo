#!/usr/bin/env node
// Submit all live sitemap URLs to IndexNow (Bing, Yandex, Naver, Seznam).
//
// Google does NOT support IndexNow, so this won't move Google Search Console —
// but it gets pages into Bing/Yandex same-day, which is a free secondary
// discovery channel and an extra "this page exists" signal for a young domain.
//
// The ownership key is already served at /<key>.txt by src/routes/legal.js
// (INDEXNOW_KEY). This value MUST stay in sync with that file and the
// public/<key>.txt file.
//
// Usage:
//   node scripts/seo/submit-indexnow.mjs              # submit live sitemap URLs
//   node scripts/seo/submit-indexnow.mjs --dry-run    # print URLs, don't submit
//
// Run after a deploy that adds/changes public pages (e.g. after
// build-programmatic-pages.mjs), or on a periodic cron.

const HOST = "porizo.co";
const SITE_BASE = `https://${HOST}`;
const INDEXNOW_KEY = "dc6dd831f7b4b07b46d4b1f15bff6e3b"; // keep in sync with legal.js
const SITEMAP_URL = `${SITE_BASE}/sitemap.xml`;
const ENDPOINT = "https://api.indexnow.org/indexnow";
const DRY_RUN = process.argv.includes("--dry-run");

async function fetchSitemapUrls() {
  const res = await fetch(SITEMAP_URL, {
    headers: { "User-Agent": "porizo-indexnow/1.0" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch sitemap (${res.status}) from ${SITEMAP_URL}`);
  }
  const xml = await res.text();
  const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  // Only submit URLs on our own host — IndexNow rejects cross-host lists.
  return [...new Set(urls.filter((u) => u.startsWith(SITE_BASE)))];
}

async function submit(urlList) {
  // IndexNow accepts up to 10,000 URLs per request; we are far under that.
  const body = {
    host: HOST,
    key: INDEXNOW_KEY,
    keyLocation: `${SITE_BASE}/${INDEXNOW_KEY}.txt`,
    urlList,
  };
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": "porizo-indexnow/1.0",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  // IndexNow returns 200/202 on success; 422 = URL/key mismatch; 403 = bad key.
  return { status: res.status, body: text.trim() };
}

async function main() {
  const urls = await fetchSitemapUrls();
  console.log(`Found ${urls.length} URLs in ${SITEMAP_URL}`);

  if (DRY_RUN) {
    for (const u of urls) console.log(`  ${u}`);
    console.log("\n--dry-run: nothing submitted.");
    return;
  }

  const { status, body } = await submit(urls);
  if (status === 200 || status === 202) {
    console.log(`✓ IndexNow accepted ${urls.length} URLs (HTTP ${status}).`);
  } else {
    console.error(`✗ IndexNow returned HTTP ${status}: ${body || "(no body)"}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
