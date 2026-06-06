// Live App Store keyword-rank tracking via Apple's iTunes Search API.
//
// IMPORTANT: the iTunes Search API is a *proxy* for App Store search. It models
// text relevance well but does NOT apply the full popularity/personalization
// weighting of on-device search, and it is storefront-specific. Treat these
// numbers as a real, comparable scoreboard over time — not as the exact pixel
// position a given user sees. They are dramatically closer to reality than a
// keyword-relevance *estimate* (e.g. an ASO tool's "potential rank").

export const PORIZO_APP_ID = 6758205028;

// Storefronts we care about, in reporting order.
export const DEFAULT_COUNTRIES = ['us', 'ca', 'au', 'nz', 'gb'];

// The 16 tracked terms (US App Store keyword set).
export const DEFAULT_KEYWORDS = [
  'ai song generator',
  'anniversary song gift',
  'birthday gift ideas',
  'birthday song',
  'birthday song gift',
  'custom song',
  'custom song gift',
  "father's day song",
  "father's day song for dad",
  'gift song',
  "mother's day song",
  'personalized song',
  'personalized song gift',
  'song gift',
  'song gift for dad',
  'song gift for mom',
];

const SEARCH_BASE = 'https://itunes.apple.com/search';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Find the 1-based rank of the target app within a results array.
 * Matches by trackId first, then by track name substring (case-insensitive).
 */
export function findRank(results, { appId = PORIZO_APP_ID, nameMatch = 'porizo' } = {}) {
  const wantName = String(nameMatch).toLowerCase();
  for (let i = 0; i < results.length; i += 1) {
    const app = results[i] || {};
    const name = String(app.trackName || '').toLowerCase();
    if (app.trackId === appId || (wantName && name.includes(wantName))) {
      return i + 1;
    }
  }
  return null;
}

/**
 * Query one storefront for one term and locate the target app.
 * `fetchImpl` is injectable so tests can run offline.
 */
export async function searchStore({
  term,
  country,
  appId = PORIZO_APP_ID,
  nameMatch = 'porizo',
  limit = 200,
  fetchImpl = fetch,
  retries = 2,
}) {
  const url = `${SEARCH_BASE}?${new URLSearchParams({
    term,
    country,
    entity: 'software',
    limit: String(limit),
  })}`;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetchImpl(url, { headers: { 'User-Agent': 'porizo-rank-track/1' } });
      if (res.status === 403 || res.status === 429) {
        // Apple throttling — back off and retry.
        lastErr = new Error(`throttled ${res.status}`);
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        throw new Error(`search ${country} "${term}" failed ${res.status}`);
      }
      const json = await res.json();
      const results = Array.isArray(json.results) ? json.results : [];
      const position = findRank(results, { appId, nameMatch });
      return {
        position,
        total: results.length,
        indexed: position != null,
        topApp: results[0]?.trackName ?? null,
      };
    } catch (err) {
      lastErr = err;
      await sleep(800 * (attempt + 1));
    }
  }
  throw lastErr ?? new Error(`search ${country} "${term}" failed`);
}

/**
 * Pull live ranks for every keyword × country.
 * Returns a structured snapshot suitable for CSV/JSON serialization.
 */
export async function pullRanks({
  keywords = DEFAULT_KEYWORDS,
  countries = DEFAULT_COUNTRIES,
  appId = PORIZO_APP_ID,
  nameMatch = 'porizo',
  fetchImpl = fetch,
  sleepMs = 500,
  log = () => {},
} = {}) {
  const date = new Date().toISOString().slice(0, 10);
  const rows = [];
  for (const term of keywords) {
    for (const country of countries) {
      let entry;
      try {
        const hit = await searchStore({ term, country, appId, nameMatch, fetchImpl });
        entry = { date, keyword: term, country, ...hit, error: null };
        log(`${country.toUpperCase()} "${term}" → ${hit.position ? `#${hit.position}` : '—'} of ${hit.total}`);
      } catch (err) {
        entry = {
          date, keyword: term, country,
          position: null, total: 0, indexed: false, topApp: null,
          error: err.message,
        };
        log(`${country.toUpperCase()} "${term}" → ERROR ${err.message}`);
      }
      rows.push(entry);
      if (sleepMs > 0) await sleep(sleepMs);
    }
  }
  return { pulled_at: new Date().toISOString(), date, appId, countries, keywords, rows };
}

export const RANK_CSV_HEADERS = [
  'Date', 'Keyword', 'Country', 'Platform', 'Rank', 'Total', 'Indexed', 'Top App',
];

export function ranksToCsvRows(pull) {
  return pull.rows.map((r) => ({
    Date: r.date,
    Keyword: r.keyword,
    Country: r.country.toUpperCase(),
    Platform: 'iOS',
    Rank: r.position == null ? '' : r.position,
    Total: r.total,
    Indexed: r.indexed ? 'yes' : 'no',
    'Top App': r.topApp ?? '',
  }));
}

/** Pretty pivot table: one row per keyword, one column per country (rank/total). */
export function formatRankTable(pull) {
  const cell = (r) => (r.error ? 'ERR' : r.position == null ? `—/${r.total}` : `${r.position}/${r.total}`);
  const byKw = new Map();
  for (const r of pull.rows) {
    if (!byKw.has(r.keyword)) byKw.set(r.keyword, {});
    byKw.get(r.keyword)[r.country] = cell(r);
  }
  const kwWidth = Math.max(7, ...pull.keywords.map((k) => k.length));
  const colWidth = 12;
  const head = 'Keyword'.padEnd(kwWidth) + '  ' +
    pull.countries.map((c) => c.toUpperCase().padEnd(colWidth)).join('');
  const sep = '-'.repeat(head.length);
  const lines = [head, sep];
  for (const kw of pull.keywords) {
    const cells = byKw.get(kw) ?? {};
    lines.push(
      kw.padEnd(kwWidth) + '  ' +
      pull.countries.map((c) => String(cells[c] ?? '—').padEnd(colWidth)).join(''),
    );
  }
  return lines.join('\n');
}
