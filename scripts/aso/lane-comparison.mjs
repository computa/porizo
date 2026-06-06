import { readFile } from 'node:fs/promises';
import { parseAsaRows, normalizeTerm } from './rerank-core.mjs';

export const LANE_DEFINITIONS = [
  {
    id: 'ai_generator',
    label: 'AI generator',
    matches(term) {
      return /\b(ai|generator|maker|text to song|song from text|lyrics to song|my voice|your voice|voice song|voice cover|sing in my voice|song with my voice|clone my voice)\b/.test(term);
    },
  },
  {
    id: 'gift',
    label: 'Gift / occasion',
    matches(term) {
      return /\b(gift|birthday|anniversary|mother|mothers|mom|dad|wedding|valentine|keepsake|tribute|meaningful|personalized|personalised|custom)\b/.test(term);
    },
  },
];

const EMPTY_METRICS = Object.freeze({
  impressions: 0,
  taps: 0,
  installs: 0,
  spend: 0,
});

export function classifyLane(term) {
  const normalized = normalizeTerm(term);
  const lane = LANE_DEFINITIONS.find((definition) => definition.matches(normalized));
  return lane?.id ?? 'other';
}

function laneLabel(laneId) {
  return LANE_DEFINITIONS.find((definition) => definition.id === laneId)?.label ?? 'Other';
}

function round(value, digits = 2) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function metricsFromTotals(totals) {
  const impressions = totals.impressions ?? 0;
  const taps = totals.taps ?? 0;
  const installs = totals.installs ?? 0;
  const spend = totals.spend ?? 0;
  return {
    impressions,
    taps,
    installs,
    spend: round(spend, 2),
    ttr: impressions > 0 ? taps / impressions : 0,
    tapToInstall: taps > 0 ? installs / taps : 0,
    cpi: installs > 0 ? spend / installs : null,
    avgCpt: taps > 0 ? spend / taps : null,
  };
}

function scoreLane(metrics) {
  if (metrics.impressions === 0 && metrics.taps === 0 && metrics.installs === 0) return 0;

  const installScore = metrics.installs * 25;
  const conversionScore = metrics.tapToInstall * 60;
  const ttrScore = metrics.ttr * 100;
  const volumeScore = Math.log10(metrics.impressions + 1) * 8;
  const cpiPenalty = metrics.cpi == null ? 0 : Math.max(0, metrics.cpi - 5) * 4;
  const spendWithoutInstallsPenalty = metrics.installs === 0 ? Math.min(30, metrics.spend * 1.5) : 0;

  return round(installScore + conversionScore + ttrScore + volumeScore - cpiPenalty - spendWithoutInstallsPenalty, 2);
}

function confidence(metrics) {
  if (metrics.installs >= 5 || metrics.taps >= 20) return 'high';
  if (metrics.installs >= 2 || metrics.taps >= 8 || metrics.impressions >= 500) return 'medium';
  if (metrics.impressions > 0 || metrics.taps > 0 || metrics.installs > 0) return 'low';
  return 'none';
}

function laneVerdict(metrics) {
  if (metrics.installs >= 3 && metrics.cpi != null && metrics.cpi <= 8) return 'scale';
  if (metrics.taps >= 8 && metrics.installs === 0) return 'pause_or_reposition';
  if (metrics.impressions >= 500 && metrics.ttr < 0.01) return 'listing_mismatch';
  if (metrics.impressions < 100) return 'needs_more_volume';
  return 'monitor';
}

function topKeywords(rows, laneId, limit = 5) {
  const byTerm = new Map();
  for (const row of rows) {
    if (classifyLane(row.term) !== laneId) continue;
    const existing = byTerm.get(row.term) ?? { term: row.term, ...EMPTY_METRICS };
    existing.impressions += row.impressions ?? 0;
    existing.taps += row.taps ?? 0;
    existing.installs += row.installs ?? 0;
    existing.spend += row.spend ?? 0;
    byTerm.set(row.term, existing);
  }
  return [...byTerm.values()]
    .sort((a, b) => b.installs - a.installs || b.spend - a.spend || b.impressions - a.impressions)
    .slice(0, limit)
    .map((row) => ({
      term: row.term,
      impressions: row.impressions,
      taps: row.taps,
      installs: row.installs,
      spend: round(row.spend, 2),
    }));
}

function summarizeLane(rows, laneId) {
  const totals = { ...EMPTY_METRICS };
  for (const row of rows) {
    if (classifyLane(row.term) !== laneId) continue;
    totals.impressions += row.impressions ?? 0;
    totals.taps += row.taps ?? 0;
    totals.installs += row.installs ?? 0;
    totals.spend += row.spend ?? 0;
  }
  const metrics = metricsFromTotals(totals);
  return {
    id: laneId,
    label: laneLabel(laneId),
    ...metrics,
    score: scoreLane(metrics),
    confidence: confidence(metrics),
    verdict: laneVerdict(metrics),
    topKeywords: topKeywords(rows, laneId),
  };
}

export function compareKeywordLanes(rows) {
  const laneIds = ['ai_generator', 'gift', 'other'];
  const lanes = laneIds.map((laneId) => summarizeLane(rows, laneId));
  const ranked = [...lanes].sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  const runnerUp = ranked[1];
  const enoughEvidence = winner.confidence !== 'none' && (winner.confidence !== 'low' || runnerUp.confidence === 'none');
  return {
    lanes,
    winner: enoughEvidence ? winner.id : null,
    recommendation: recommendationFor(winner, runnerUp, enoughEvidence),
  };
}

function recommendationFor(winner, runnerUp, enoughEvidence) {
  if (!enoughEvidence) {
    return 'Not enough data yet. Keep the exact-match test running until each strategic lane has at least 8 taps or 500 impressions.';
  }
  if (winner.id === 'ai_generator' && winner.verdict === 'scale') {
    return 'AI generator is winning. Scale exact-match budget and consider moving AI generator tokens into the next metadata release.';
  }
  if (winner.id === 'gift' && winner.verdict === 'scale') {
    return 'Gift / occasion is winning. Keep AI generator as a measured test, but protect gift terms as the primary acquisition lane.';
  }
  if (winner.verdict === 'pause_or_reposition') {
    return `${winner.label} has enough taps without installs. Do not scale spend until the App Store listing better matches that search intent.`;
  }
  if (runnerUp && winner.score - runnerUp.score < 10) {
    return 'No decisive winner. Keep both lanes live and judge on downstream song starts/completions, not installs alone.';
  }
  return `${winner.label} is currently strongest on the blended score. Keep monitoring taps, installs, CPI, and downstream activation.`;
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMoney(value) {
  return value == null ? 'n/a' : `$${value.toFixed(2)}`;
}

export function formatLaneComparison(comparison) {
  const lines = ['== Compare acquisition lanes =='];
  for (const lane of comparison.lanes) {
    lines.push(
      `${lane.label}: score ${lane.score}, ${lane.confidence} confidence, ${lane.verdict} ` +
        `(${lane.impressions} imp, ${lane.taps} taps, ${lane.installs} installs, ` +
        `${formatPercent(lane.ttr)} TTR, ${formatPercent(lane.tapToInstall)} tap→install, ` +
        `${formatMoney(lane.cpi)} CPI, ${formatMoney(lane.avgCpt)} avg CPT, $${lane.spend.toFixed(2)} spend)`,
    );
    if (lane.topKeywords.length) {
      lines.push(
        `  top: ${lane.topKeywords
          .map((kw) => `${kw.term} (${kw.impressions} imp, ${kw.taps} taps, ${kw.installs} installs, $${kw.spend.toFixed(2)})`)
          .join('; ')}`,
      );
    }
  }
  lines.push(`Recommendation: ${comparison.recommendation}`);
  return lines.join('\n');
}

export async function compareKeywordLanesFromAsaCsv(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return compareKeywordLanes(parseAsaRows(raw));
}
