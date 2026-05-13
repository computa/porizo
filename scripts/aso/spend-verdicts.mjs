export const VERDICT_COLORS = {
  scale: '#10b981',
  bid_up: '#f59e0b',
  cut: '#ef4444',
  watch: '#9ca3af',
};

export const VERDICT_META = {
  PROTECT_AND_SCALE: { bucket: 'scale', color: VERDICT_COLORS.scale, blurb: 'Already exact + converting. Hold + scale budget.' },
  MATCH_TYPE_GRADUATION: { bucket: 'scale', color: VERDICT_COLORS.scale, blurb: 'Broad + converting. Promote to EXACT.' },
  BID_UP_OR_VOLUME_CAPPED: { bucket: 'bid_up', color: VERDICT_COLORS.bid_up, blurb: 'Converts but low impressions. Bid up OR niche is volume-capped.' },
  TTR_PROBLEM: { bucket: 'cut', color: VERDICT_COLORS.cut, blurb: 'Impressions but no taps. Creative mismatch.' },
  DEMOTE: { bucket: 'cut', color: VERDICT_COLORS.cut, blurb: 'Spend with poor install rate. Reduce bid.' },
  DATA_ANOMALY: { bucket: 'watch', color: VERDICT_COLORS.watch, blurb: 'Installs without taps. Suspect data.' },
  MONITOR: { bucket: 'watch', color: VERDICT_COLORS.watch, blurb: 'Low data. Wait for more signal.' },
};

export function computeVerdict(agg) {
  const taps = agg.taps ?? 0;
  const installs = agg.installs ?? 0;
  const impressions = agg.impressions ?? 0;
  const rate = taps > 0 ? installs / taps : 0;
  const matchType = (agg.match_type ?? 'UNKNOWN').toUpperCase();

  let label;
  if (taps === 0 && installs > 0) label = 'DATA_ANOMALY';
  else if (impressions >= 50 && taps === 0) label = 'TTR_PROBLEM';
  else if (rate >= 0.3 && taps >= 3 && impressions >= 50 && matchType === 'EXACT') label = 'PROTECT_AND_SCALE';
  else if (rate >= 0.3 && taps >= 3 && matchType === 'BROAD') label = 'MATCH_TYPE_GRADUATION';
  else if (rate >= 0.3 && impressions < 50) label = 'BID_UP_OR_VOLUME_CAPPED';
  else if (rate < 0.1 && taps >= 5) label = 'DEMOTE';
  else label = 'MONITOR';

  return { label, ...VERDICT_META[label] };
}

export function aggregateWindow(group, dates) {
  let impressions = 0, taps = 0, installs = 0, spend = 0;
  for (const d of dates) {
    const row = group.daily?.[d];
    if (!row) continue;
    impressions += row.impressions ?? 0;
    taps += row.taps ?? 0;
    installs += row.installs ?? 0;
    spend += row.spend ?? 0;
  }
  return {
    impressions,
    taps,
    installs,
    spend,
    match_type: group.match_type,
    cpi: installs > 0 ? spend / installs : null,
    avg_cpt: taps > 0 ? spend / taps : 0,
    install_rate: taps > 0 ? installs / taps : 0,
    tap_rate: impressions > 0 ? taps / impressions : 0,
  };
}
