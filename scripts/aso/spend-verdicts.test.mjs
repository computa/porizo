import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeVerdict, aggregateWindow, VERDICT_COLORS } from './spend-verdicts.mjs';

const agg = (over) => ({
  impressions: 0, taps: 0, installs: 0, spend: 0, match_type: 'BROAD', ...over,
});

test('DATA_ANOMALY when installs > 0 and taps = 0', () => {
  assert.equal(computeVerdict(agg({ impressions: 80, taps: 0, installs: 1 })).label, 'DATA_ANOMALY');
});

test('TTR_PROBLEM when ≥50 impressions and 0 taps and 0 installs', () => {
  assert.equal(computeVerdict(agg({ impressions: 100, taps: 0, installs: 0 })).label, 'TTR_PROBLEM');
});

test('PROTECT_AND_SCALE when rate ≥30%, ≥3 taps, ≥50 imp, EXACT', () => {
  const v = computeVerdict(agg({ impressions: 200, taps: 10, installs: 4, match_type: 'EXACT' }));
  assert.equal(v.label, 'PROTECT_AND_SCALE');
  assert.equal(v.bucket, 'scale');
});

test('MATCH_TYPE_GRADUATION when rate ≥30%, ≥3 taps, BROAD', () => {
  const v = computeVerdict(agg({ impressions: 50, taps: 5, installs: 2, match_type: 'BROAD' }));
  assert.equal(v.label, 'MATCH_TYPE_GRADUATION');
  assert.equal(v.bucket, 'scale');
});

test('BID_UP_OR_VOLUME_CAPPED when rate ≥30% but <50 imp and <3 taps', () => {
  const v = computeVerdict(agg({ impressions: 20, taps: 2, installs: 1, match_type: 'BROAD' }));
  assert.equal(v.label, 'BID_UP_OR_VOLUME_CAPPED');
});

test('DEMOTE when rate <10% with ≥5 taps', () => {
  const v = computeVerdict(agg({ impressions: 500, taps: 20, installs: 1, match_type: 'BROAD' }));
  assert.equal(v.label, 'DEMOTE');
  assert.equal(v.bucket, 'cut');
});

test('MONITOR when nothing else fires (low data)', () => {
  const v = computeVerdict(agg({ impressions: 20, taps: 1, installs: 0 }));
  assert.equal(v.label, 'MONITOR');
});

test('MONITOR when zero impressions', () => {
  assert.equal(computeVerdict(agg({})).label, 'MONITOR');
});

test('verdict carries action color from VERDICT_COLORS', () => {
  const v = computeVerdict(agg({ impressions: 200, taps: 10, installs: 4, match_type: 'EXACT' }));
  assert.equal(v.color, VERDICT_COLORS.scale);
});

test('aggregateWindow sums per-day metrics across keyword.daily', () => {
  const kw = {
    term: 'song for mom', match_type: 'EXACT',
    daily: {
      '2026-05-10': { impressions: 100, taps: 5, installs: 1, spend: 2.00, avg_cpt: 0.40 },
      '2026-05-11': { impressions: 120, taps: 6, installs: 2, spend: 2.40, avg_cpt: 0.40 },
      '2026-05-12': { impressions: 80, taps: 4, installs: 1, spend: 1.60, avg_cpt: 0.40 },
    },
  };
  const w = aggregateWindow(kw, ['2026-05-10', '2026-05-11', '2026-05-12']);
  assert.equal(w.impressions, 300);
  assert.equal(w.taps, 15);
  assert.equal(w.installs, 4);
  assert.equal(w.spend, 6.0);
  assert.equal(w.match_type, 'EXACT');
  assert.equal(w.cpi, 1.5);
  assert.equal(w.install_rate, 4 / 15);
});

test('aggregateWindow ignores days outside the window', () => {
  const kw = {
    term: 'x', match_type: 'BROAD',
    daily: {
      '2026-05-09': { impressions: 999, taps: 999, installs: 999, spend: 999, avg_cpt: 1 },
      '2026-05-10': { impressions: 10, taps: 1, installs: 0, spend: 0.50, avg_cpt: 0.5 },
    },
  };
  const w = aggregateWindow(kw, ['2026-05-10']);
  assert.equal(w.impressions, 10);
  assert.equal(w.taps, 1);
});
