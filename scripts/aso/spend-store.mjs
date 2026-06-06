import { promises as fs } from 'node:fs';
import path from 'node:path';

export const SCHEMA_VERSION = '1.0';

export function emptyStore() {
  return {
    schema_version: SCHEMA_VERSION,
    updated_at: null,
    first_observed: null,
    campaigns: {},
    keywords: {},
  };
}

function isNonZero(row) {
  return (row.impressions ?? 0) > 0 || (row.taps ?? 0) > 0 || (row.spend ?? 0) > 0;
}

function metricsOnly(row) {
  return {
    impressions: row.impressions ?? 0,
    taps: row.taps ?? 0,
    installs: row.installs ?? 0,
    spend: Number((row.spend ?? 0).toFixed(4)),
    avg_cpt: Number((row.avg_cpt ?? 0).toFixed(4)),
  };
}

function earlierDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

export function mergeSpend(store, pull) {
  const merged = {
    ...emptyStore(),
    ...store,
    campaigns: { ...(store?.campaigns ?? {}) },
    keywords: { ...(store?.keywords ?? {}) },
  };
  merged.schema_version = SCHEMA_VERSION;
  merged.updated_at = pull.pulled_at ?? new Date().toISOString();

  for (const row of pull.campaigns ?? []) {
    if (!isNonZero(row)) continue;
    const id = String(row.campaign_id);
    const existing = merged.campaigns[id];
    const next = {
      name: row.name ?? existing?.name ?? id,
      first_seen: earlierDate(existing?.first_seen, row.date),
      daily: { ...(existing?.daily ?? {}) },
    };
    next.daily[row.date] = metricsOnly(row);
    merged.campaigns[id] = next;
  }

  for (const row of pull.keywords ?? []) {
    if (!isNonZero(row)) continue;
    const key = `${row.campaign_id}:${row.keyword_id}`;
    const existing = merged.keywords[key];
    const next = {
      campaign_id: String(row.campaign_id),
      keyword_id: String(row.keyword_id),
      term: row.term ?? existing?.term ?? key,
      match_type: row.match_type ?? existing?.match_type ?? 'UNKNOWN',
      max_cpt: row.max_cpt ?? existing?.max_cpt ?? null,
      first_seen: earlierDate(existing?.first_seen, row.date),
      daily: { ...(existing?.daily ?? {}) },
    };
    next.daily[row.date] = metricsOnly(row);
    merged.keywords[key] = next;
  }

  const allFirstSeen = [
    ...Object.values(merged.campaigns).map((c) => c.first_seen),
    ...Object.values(merged.keywords).map((k) => k.first_seen),
  ].filter(Boolean);
  merged.first_observed = allFirstSeen.length ? allFirstSeen.sort()[0] : null;

  return merged;
}

export async function loadStore(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return emptyStore();
    throw err;
  }
}

export async function saveStore(filePath, store) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2));
  await fs.rename(tmp, filePath);
}
