import { readdir } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_TRAFFIC = 5;
const DEFAULT_DIFFICULTY = 50;
const DEFAULT_INTENT_BONUS = { painkiller: 10, brand: 15, category: 5, vitamin: 0 };
const DEFAULT_INTENT_MULTIPLIER = { painkiller: 1.3, brand: 1.2, category: 1, vitamin: 0.7 };

export function normalizeTerm(term) {
  return String(term ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function parseNumber(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).replace(/[$,%]/g, '').trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const [headersRaw, ...body] = rows.filter((r) => r.some((v) => String(v).trim() !== ''));
  if (!headersRaw) return [];
  const headers = headersRaw.map((h) => String(h).trim());
  return body.map((values) => {
    const out = {};
    headers.forEach((header, idx) => {
      out[header] = values[idx] ?? '';
    });
    return out;
  });
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (!/[",\n\r]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(rows, headers) {
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ].join('\n') + '\n';
}

function firstValue(row, names) {
  for (const name of names) {
    if (row[name] != null && row[name] !== '') return row[name];
  }
  return '';
}

export function parseAsaRows(text) {
  return parseCsv(text)
    .map((row) => {
      const term = normalizeTerm(firstValue(row, ['Keyword', 'keyword', 'Search Term', 'Search term']));
      if (!term) return null;
      const taps = parseNumber(firstValue(row, ['Taps', 'taps']));
      const spend = parseNumber(firstValue(row, ['Spend', 'spend', 'Local Spend']));
      return {
        term,
        match_type: String(firstValue(row, ['Match Type', 'match_type', 'Match type']) || 'UNKNOWN').toUpperCase(),
        max_cpt: parseNumber(firstValue(row, ['Max CPT', 'max_cpt', 'Max Cpt', 'Bid'])),
        impressions: parseNumber(firstValue(row, ['Impressions', 'impressions'])),
        taps,
        installs: parseNumber(firstValue(row, ['Conversions', 'Installs', 'installs', 'Total Installs'])),
        spend,
        cpt: parseNumber(firstValue(row, ['Avg CPT', 'avg_cpt'])) || (taps > 0 ? spend / taps : null),
      };
    })
    .filter(Boolean);
}

export function parseAscRows(text) {
  return parseCsv(text)
    .map((row) => {
      const term = normalizeTerm(firstValue(row, ['Search Term', 'Search term', 'Term', 'Keyword']));
      if (!term) return null;
      return {
        term,
        search_impressions: parseNumber(firstValue(row, ['Search Impressions', 'Impressions', 'Search impressions'])),
        product_page_views: parseNumber(firstValue(row, ['Product Page Views', 'Product page views', 'Page Views'])),
        downloads: parseNumber(firstValue(row, ['Downloads', 'First-Time Downloads', 'App Units', 'Units'])),
      };
    })
    .filter(Boolean);
}

export function parseExternalRows(text) {
  return parseCsv(text)
    .map((row) => {
      const term = normalizeTerm(firstValue(row, ['Keyword', 'Term', 'Search Term']));
      if (!term) return null;
      return {
        term,
        traffic: nullableNumber(firstValue(row, ['Traffic', 'traffic', 'Popularity'])),
        chance: nullableNumber(firstValue(row, ['Chance', 'chance'])),
        difficulty: nullableNumber(firstValue(row, ['Difficulty', 'difficulty'])),
        competing_apps: nullableNumber(firstValue(row, ['Competing Apps', 'competing_apps'])),
        our_rank: nullableNumber(firstValue(row, ['Our Rank', 'our_rank', 'Rank'])),
      };
    })
    .filter(Boolean);
}

function nullableNumber(value) {
  if (value == null || value === '') return null;
  const n = parseNumber(value);
  return Number.isFinite(n) ? n : null;
}

function aggregateByTerm(rows, merge) {
  const map = new Map();
  for (const row of rows) {
    const existing = map.get(row.term);
    map.set(row.term, existing ? merge(existing, row) : { ...row });
  }
  return map;
}

export function aggregateAsaRows(rows) {
  return aggregateByTerm(rows, (a, b) => {
    const taps = a.taps + b.taps;
    const spend = a.spend + b.spend;
    return {
      term: a.term,
      match_type: preferMatchType(a.match_type, b.match_type),
      max_cpt: Math.max(a.max_cpt || 0, b.max_cpt || 0),
      impressions: a.impressions + b.impressions,
      taps,
      installs: a.installs + b.installs,
      spend,
      cpt: taps > 0 ? spend / taps : null,
    };
  });
}

export function aggregateAscRows(rows) {
  return aggregateByTerm(rows, (a, b) => ({
    term: a.term,
    search_impressions: a.search_impressions + b.search_impressions,
    product_page_views: a.product_page_views + b.product_page_views,
    downloads: a.downloads + b.downloads,
  }));
}

function preferMatchType(a, b) {
  if (String(a).toUpperCase() === 'EXACT' || String(b).toUpperCase() === 'EXACT') return 'EXACT';
  if (String(a).toUpperCase() === 'BROAD' || String(b).toUpperCase() === 'BROAD') return 'BROAD';
  return String(a || b || 'UNKNOWN').toUpperCase();
}

function baseKeyword(term, date) {
  return {
    term,
    tier: 4,
    intent_class: inferIntentClass(term),
    status: 'testing',
    char_count: term.length,
    external: {
      traffic: null,
      chance: null,
      difficulty: null,
      competing_apps: null,
      our_rank: null,
    },
    asa: emptyAsa(),
    asc_organic: emptyAsc(),
    backend: {
      registered: 0,
      song_created: 0,
      song_completed: 0,
      day7_retained: 0,
    },
    cluster_id: null,
    seasonality: null,
    effectiveness_score: 0,
    best_surface: null,
    notes: `Discovered via ASA ${date}`,
    history: [{ date, event: 'seeded' }],
  };
}

function inferIntentClass(term) {
  if (/\b(porizo|porizo)\b/.test(term)) return 'brand';
  if (/\b(gift|birthday|anniversary|wedding|mother|father|mom|dad|wife|husband|valentine|tribute)\b/.test(term)) return 'painkiller';
  if (/\b(song|music|poem|custom|personalized)\b/.test(term)) return 'category';
  return 'vitamin';
}

function emptyAsa() {
  return {
    impressions: 0,
    taps: 0,
    installs: 0,
    spend: 0,
    cpt: null,
    ttr: null,
    cr: null,
    match_type: null,
    max_cpt: null,
  };
}

function emptyAsc() {
  return {
    search_impressions: 0,
    product_page_views: 0,
    downloads: 0,
  };
}

function scoringConfig(bank) {
  return {
    intentBonus: bank.scoring?.intent_bonus ?? DEFAULT_INTENT_BONUS,
    intentMultiplier: bank.scoring?.intent_multiplier ?? DEFAULT_INTENT_MULTIPLIER,
  };
}

export function scoreKeyword(keyword, bank) {
  const { intentBonus, intentMultiplier } = scoringConfig(bank);
  const intent = keyword.intent_class || 'vitamin';
  const asa = keyword.asa ?? emptyAsa();
  const asc = keyword.asc_organic ?? emptyAsc();
  const anomaly = asa.installs > 0 && asa.taps === 0;
  const hasAsaSignal = asa.impressions > 0 || asa.taps > 0 || asa.installs > 0 || asa.spend > 0;

  if (hasAsaSignal && !anomaly) {
    const installRate = asa.taps > 0 ? asa.installs / asa.taps : 0;
    const cpi = asa.installs > 0 ? asa.spend / asa.installs : null;
    const cpiPenalty = cpi == null ? 0 : Math.max(0, cpi - 3) * 5;
    const tested =
      installRate *
        Math.log10((asa.impressions ?? 0) + 1) *
        100 *
        (intentMultiplier[intent] ?? 1) -
      cpiPenalty;
    return Math.max(0, tested + organicBoost(asc));
  }

  if (anomaly) {
    return 0;
  }

  const external = keyword.external ?? {};
  const traffic = external.traffic ?? DEFAULT_TRAFFIC;
  const difficulty = external.difficulty ?? DEFAULT_DIFFICULTY;
  return traffic - 0.6 * difficulty + (intentBonus[intent] ?? 0) + organicBoost(asc);
}

function organicBoost(asc) {
  const impressions = asc?.search_impressions ?? 0;
  const views = asc?.product_page_views ?? 0;
  const downloads = asc?.downloads ?? 0;
  return Math.min(60, downloads * 25 + views * 3 + Math.log10(impressions + 1) * 4);
}

export function classifyAction(keyword) {
  const asa = keyword.asa ?? emptyAsa();
  const taps = asa.taps ?? 0;
  const installs = asa.installs ?? 0;
  const impressions = asa.impressions ?? 0;
  const rate = taps > 0 ? installs / taps : 0;
  const matchType = String(asa.match_type ?? 'UNKNOWN').toUpperCase();
  const cpt = asa.cpt ?? (taps > 0 ? asa.spend / taps : null);
  const maxCpt = asa.max_cpt ?? null;
  const bidRatio = maxCpt && cpt != null ? cpt / maxCpt : null;

  if (taps === 0 && installs > 0) return 'DATA_ANOMALY';
  if (impressions >= 50 && taps === 0) return 'TTR_PROBLEM';
  if (rate >= 0.3 && taps >= 3 && impressions >= 50 && matchType === 'EXACT') return 'PROTECT_AND_SCALE';
  if (rate >= 0.3 && taps >= 3 && matchType === 'BROAD') return 'MATCH_TYPE_GRADUATION';
  if (rate >= 0.3 && impressions < 50) {
    if (bidRatio != null && bidRatio >= 0.7) return 'BID_UP';
    if (bidRatio != null && bidRatio < 0.25) return 'VOLUME_CAPPED';
    return 'BID_UP_OR_VOLUME_CAPPED';
  }
  if (rate < 0.1 && taps >= 5) return 'DEMOTE';
  return 'MONITOR';
}

export function mergeSignals(bank, { asaRows = [], ascRows = [], externalRows = [], date, note = '' } = {}) {
  const next = structuredClone(bank);
  const byTerm = new Map(next.keywords.map((kw) => [normalizeTerm(kw.term), kw]));
  const beforeRank = rankMap(next.keywords);
  const asaByTerm = aggregateAsaRows(asaRows);
  const ascByTerm = aggregateAscRows(ascRows);
  const externalByTerm = new Map(externalRows.map((row) => [row.term, row]));
  const discoveryCandidates = [];
  let rowsMatched = 0;
  let rowsDiscovered = 0;

  for (const [term, asa] of asaByTerm) {
    let keyword = byTerm.get(term);
    if (!keyword) {
      keyword = baseKeyword(term, date);
      next.keywords.push(keyword);
      byTerm.set(term, keyword);
      discoveryCandidates.push(term);
      rowsDiscovered += 1;
    }
    rowsMatched += 1;
    keyword.asa = {
      ...emptyAsa(),
      ...keyword.asa,
      impressions: asa.impressions,
      taps: asa.taps,
      installs: asa.installs,
      spend: Number(asa.spend.toFixed(2)),
      cpt: asa.cpt == null ? null : Number(asa.cpt.toFixed(2)),
      ttr: asa.impressions > 0 ? Number((asa.taps / asa.impressions).toFixed(4)) : null,
      cr: asa.taps > 0 ? Number((asa.installs / asa.taps).toFixed(4)) : null,
      match_type: asa.match_type,
      max_cpt: asa.max_cpt || keyword.asa?.max_cpt || null,
    };
    keyword.status = keyword.status === 'untested' ? 'testing' : keyword.status;
  }

  for (const [term, asc] of ascByTerm) {
    let keyword = byTerm.get(term);
    if (!keyword) {
      keyword = baseKeyword(term, date);
      keyword.status = 'untested';
      next.keywords.push(keyword);
      byTerm.set(term, keyword);
      discoveryCandidates.push(term);
    }
    keyword.asc_organic = { ...emptyAsc(), ...keyword.asc_organic, ...asc };
  }

  for (const [term, external] of externalByTerm) {
    let keyword = byTerm.get(term);
    if (!keyword) {
      keyword = baseKeyword(term, date);
      keyword.status = 'untested';
      next.keywords.push(keyword);
      byTerm.set(term, keyword);
      discoveryCandidates.push(term);
    }
    keyword.external = { ...(keyword.external ?? {}), ...external };
  }

  for (const keyword of next.keywords) {
    keyword.term = normalizeTerm(keyword.term);
    keyword.char_count = keyword.term.length;
    keyword.asa = { ...emptyAsa(), ...(keyword.asa ?? {}) };
    keyword.asc_organic = { ...emptyAsc(), ...(keyword.asc_organic ?? {}) };
    keyword.effectiveness_score = scoreKeyword(keyword, next);
    keyword.action = classifyAction(keyword);
    keyword.history = Array.isArray(keyword.history) ? keyword.history : [];
    keyword.history.push({
      date,
      event: `reviewed score=${keyword.effectiveness_score.toFixed(2)}`,
    });
  }

  next.keywords.sort(compareKeywords);
  const packed = packKeywordsField(next.keywords, next.shipping_target_count ?? 10);
  next.last_reviewed = date;
  next.review_log = Array.isArray(next.review_log) ? next.review_log : [];
  next.review_log.push({
    date,
    note,
    inputs: {
      asa: asaRows.length ? { rowsMatched, rowsDiscovered } : null,
      asc: ascRows.length ? { rowsMatched: ascByTerm.size } : null,
      external: externalRows.length ? { rowsMatched: externalByTerm.size } : null,
    },
    top10: packed.terms,
    keywords_field_string: packed.string,
    keywords_field_chars: packed.chars,
  });

  const afterRank = rankMap(next.keywords);
  return {
    bank: next,
    report: {
      asaRowsMerged: rowsMatched,
      asaRowsDiscovered: rowsDiscovered,
      ascRowsMerged: ascByTerm.size,
      externalRowsMerged: externalByTerm.size,
      discoveryCandidates,
      packed,
      movers: computeMovers(beforeRank, afterRank),
      actions: next.keywords
        .filter((kw) => kw.asa?.impressions > 0 || kw.asa?.taps > 0 || kw.asa?.spend > 0 || kw.asa?.installs > 0)
        .slice(0, 50)
        .map((kw) => ({ term: kw.term, score: kw.effectiveness_score, action: kw.action, asa: kw.asa })),
    },
  };
}

function compareKeywords(a, b) {
  if (a.status === 'excluded' && b.status !== 'excluded') return 1;
  if (a.status !== 'excluded' && b.status === 'excluded') return -1;
  return (b.effectiveness_score ?? -Infinity) - (a.effectiveness_score ?? -Infinity) || a.term.localeCompare(b.term);
}

export function packKeywordsField(keywords, targetCount = 10, maxChars = 100) {
  const terms = [];
  let output = '';
  for (const keyword of keywords) {
    if (keyword.status === 'excluded') continue;
    if ((keyword.effectiveness_score ?? 0) <= 0) continue;
    if (!hasShippingConfidence(keyword)) continue;
    const term = normalizeTerm(keyword.term);
    if (!term || terms.includes(term)) continue;
    const candidate = output ? `${output},${term}` : term;
    if (candidate.length > maxChars) continue;
    output = candidate;
    terms.push(term);
    if (terms.length >= targetCount) break;
  }
  return { terms, string: output, chars: output.length };
}

export function hasShippingConfidence(keyword) {
  const asa = keyword.asa ?? {};
  const taps = asa.taps ?? 0;
  const installs = asa.installs ?? 0;
  const impressions = asa.impressions ?? 0;
  if (taps === 0 && installs > 0) return false;
  if (taps >= 3 || installs >= 2) return true;
  const asc = keyword.asc_organic ?? {};
  return (asc.downloads ?? 0) >= 2 || (asc.product_page_views ?? 0) >= 10 || impressions >= 150;
}

function rankMap(keywords) {
  const sorted = [...keywords].sort(compareKeywords);
  return new Map(sorted.map((kw, idx) => [normalizeTerm(kw.term), idx + 1]));
}

function computeMovers(before, after) {
  const movers = [];
  for (const [term, afterRank] of after) {
    const beforeRank = before.get(term);
    if (!beforeRank) continue;
    const delta = beforeRank - afterRank;
    if (delta !== 0) movers.push({ term, before: beforeRank, after: afterRank, delta });
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return movers.slice(0, 10);
}

export async function latestInputFile(dir, prefix, date = null) {
  const files = await readdir(dir).catch(() => []);
  const filtered = files
    .filter((file) => file.startsWith(`${prefix}-`) && file.endsWith('.csv'))
    .filter((file) => (date ? file.includes(date) : true))
    .sort();
  const latest = filtered.at(-1);
  return latest ? path.join(dir, latest) : null;
}

export function asaRowsToCsvRows(rows) {
  const byTerm = aggregateAsaRows(rows);
  return [...byTerm.values()]
    .sort((a, b) => b.spend - a.spend || b.impressions - a.impressions || a.term.localeCompare(b.term))
    .map((row) => ({
      Keyword: row.term,
      'Match Type': row.match_type,
      'Max CPT': row.max_cpt ? row.max_cpt.toFixed(2) : '',
      Impressions: row.impressions,
      Taps: row.taps,
      Conversions: row.installs,
      Spend: row.spend.toFixed(2),
      'Avg CPT': row.cpt == null ? '' : row.cpt.toFixed(2),
    }));
}

export const ASA_CSV_HEADERS = ['Keyword', 'Match Type', 'Max CPT', 'Impressions', 'Taps', 'Conversions', 'Spend', 'Avg CPT'];
