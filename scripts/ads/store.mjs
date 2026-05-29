/**
 * Append a pull snapshot to the time-series history file so trends/fatigue can
 * be computed across runs. Data lives under marketing/ (gitignored, local).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(
  new URL('../../', import.meta.url).pathname,
  'marketing/ads-analytics',
);
const HISTORY = path.join(DATA_DIR, 'snapshots', 'history.json');

export async function loadHistory() {
  try {
    return JSON.parse(await fs.readFile(HISTORY, 'utf8'));
  } catch {
    return [];
  }
}

/** Append a compact snapshot (one entry per pull). Returns the full history. */
export async function appendSnapshot(pull) {
  await fs.mkdir(path.dirname(HISTORY), { recursive: true });
  const history = await loadHistory();
  // store only what trends need, keyed by entity id
  const adRows = pull.rows.filter((r) => r.level === 'ad' && r.window === 'maximum' && !r.error);
  history.push({
    ts: pull.pulledAt,
    campaignId: pull.campaign.id,
    ads: adRows.map((r) => ({
      id: r.id,
      name: r.name,
      spend: r.spend,
      installs: r.installs,
      cpi: r.cpi,
      linkCtr: r.linkCtr,
      frequency: r.frequency,
      impressions: r.impressions,
    })),
  });
  await fs.writeFile(HISTORY, JSON.stringify(history, null, 2));
  return history;
}

/** Time-ordered series for one ad id, across all snapshots. */
export function seriesForAd(history, adId) {
  return history
    .flatMap((snap) => {
      const a = (snap.ads || []).find((x) => x.id === adId);
      return a ? [{ ts: snap.ts, ...a }] : [];
    })
    .sort((x, y) => x.ts.localeCompare(y.ts));
}
