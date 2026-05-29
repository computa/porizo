import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cpiStatus,
  ctrStatus,
  frequencyStatus,
  learningStatus,
  pacingStatus,
  evaluateEntity,
  abcVerdict,
  trendFlags,
  DEFAULT_THRESHOLDS,
} from './evaluate.mjs';

const T = DEFAULT_THRESHOLDS;

// ---- cpiStatus ----
test('cpiStatus: unknown when no installs / cpi null', () => {
  assert.equal(cpiStatus(null, T), 'unknown');
});
test('cpiStatus: good at/below target', () => {
  assert.equal(cpiStatus(3.5, T), 'good');
  assert.equal(cpiStatus(4.0, T), 'good');
});
test('cpiStatus: warn between target and warn-multiple', () => {
  assert.equal(cpiStatus(5.0, T), 'warn'); // 4.0..6.0
});
test('cpiStatus: bad above warn-multiple', () => {
  assert.equal(cpiStatus(7.0, T), 'bad'); // > 6.0
});

// ---- ctrStatus ----
test('ctrStatus: low below minLinkCtr', () => {
  assert.equal(ctrStatus(0.005, T), 'low');
});
test('ctrStatus: good at/above minLinkCtr', () => {
  assert.equal(ctrStatus(0.012, T), 'good');
});

// ---- frequencyStatus ----
test('frequencyStatus: fatigue above maxFrequency', () => {
  assert.equal(frequencyStatus(3.0, T), 'fatigue');
});
test('frequencyStatus: ok below maxFrequency', () => {
  assert.equal(frequencyStatus(1.4, T), 'ok');
});

// ---- learningStatus ----
test('learningStatus: learning when installs below floor', () => {
  assert.equal(learningStatus({ installs: 10, ageDays: 9 }, T), 'learning');
});
test('learningStatus: learning when too young even with installs', () => {
  assert.equal(learningStatus({ installs: 80, ageDays: 1 }, T), 'learning');
});
test('learningStatus: exited when enough installs and old enough', () => {
  assert.equal(learningStatus({ installs: 80, ageDays: 5 }, T), 'exited');
});

// ---- pacingStatus ----
test('pacingStatus: under when spend well below daily budget', () => {
  assert.equal(pacingStatus({ spend: 5, dailyBudget: 20 }, T), 'under'); // 25% < 70%
});
test('pacingStatus: ok when spend near budget', () => {
  assert.equal(pacingStatus({ spend: 18, dailyBudget: 20 }, T), 'ok');
});

// ---- evaluateEntity ----
test('evaluateEntity: learning entity returns HOLD verdict regardless of CPI', () => {
  const e = evaluateEntity(
    { installs: 4, ageDays: 1, spend: 2, dailyBudget: 20, frequency: 1.1, linkCtr: 0.02, cpi: 0.5 },
    T,
  );
  assert.equal(e.verdict, 'HOLD');
  assert.equal(e.flags.learning, 'learning');
});
test('evaluateEntity: healthy exited entity with good CPI → SCALE candidate', () => {
  const e = evaluateEntity(
    { installs: 120, ageDays: 7, spend: 300, dailyBudget: 20, frequency: 1.5, linkCtr: 0.02, cpi: 2.5 },
    T,
  );
  assert.equal(e.flags.learning, 'exited');
  assert.equal(e.flags.cpi, 'good');
  assert.equal(e.verdict, 'SCALE');
});
test('evaluateEntity: exited with bad CPI → PAUSE candidate', () => {
  const e = evaluateEntity(
    { installs: 60, ageDays: 7, spend: 600, dailyBudget: 20, frequency: 1.5, linkCtr: 0.02, cpi: 10 },
    T,
  );
  assert.equal(e.verdict, 'PAUSE');
});
test('evaluateEntity: high frequency → REFRESH (fatigue)', () => {
  const e = evaluateEntity(
    { installs: 60, ageDays: 7, spend: 200, dailyBudget: 20, frequency: 3.4, linkCtr: 0.02, cpi: 4 },
    T,
  );
  assert.equal(e.flags.frequency, 'fatigue');
  assert.equal(e.verdict, 'REFRESH');
});

// ---- abcVerdict ----
test('abcVerdict: inconclusive when ads below significance floor', () => {
  const v = abcVerdict(
    [
      { id: 'A', installs: 3, cpi: 2 },
      { id: 'B', installs: 1, cpi: 9 },
      { id: 'C', installs: 0, cpi: null },
    ],
    T,
  );
  assert.equal(v.conclusive, false);
  assert.equal(v.leaderId, null);
});
test('abcVerdict: leader when one ad clears floor with meaningfully lower CPI', () => {
  const v = abcVerdict(
    [
      { id: 'A', installs: 40, cpi: 2.5 },
      { id: 'B', installs: 20, cpi: 5.0 },
      { id: 'C', installs: 18, cpi: 4.8 },
    ],
    T,
  );
  assert.equal(v.conclusive, true);
  assert.equal(v.leaderId, 'A');
  assert.ok(v.laggardIds.includes('B'));
});
test('abcVerdict: inconclusive when CPIs are within significant gap', () => {
  const v = abcVerdict(
    [
      { id: 'A', installs: 30, cpi: 4.0 },
      { id: 'B', installs: 28, cpi: 4.3 }, // ~7% gap < 25%
    ],
    T,
  );
  assert.equal(v.conclusive, false);
});

// ---- trendFlags ----
test('trendFlags: ctr decay flagged as fatigue', () => {
  const series = [
    { ts: '2026-05-26', linkCtr: 0.02, cpi: 3 },
    { ts: '2026-05-29', linkCtr: 0.012, cpi: 3.2 }, // 40% drop > 30%
  ];
  const f = trendFlags(series, T);
  assert.equal(f.ctrDecay, true);
  assert.equal(f.fatigue, true);
});
test('trendFlags: rising cpi direction', () => {
  const series = [
    { ts: '2026-05-26', linkCtr: 0.02, cpi: 2 },
    { ts: '2026-05-29', linkCtr: 0.019, cpi: 5 },
  ];
  assert.equal(trendFlags(series, T).cpiDirection, 'rising');
});
test('trendFlags: insufficient history → flat/no-fatigue', () => {
  const f = trendFlags([{ ts: '2026-05-29', linkCtr: 0.02, cpi: 3 }], T);
  assert.equal(f.cpiDirection, 'flat');
  assert.equal(f.fatigue, false);
});
