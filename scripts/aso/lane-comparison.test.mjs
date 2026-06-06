import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyLane,
  compareKeywordLanes,
  formatLaneComparison,
} from './lane-comparison.mjs';

test('classifyLane prioritizes AI generator terms over gift terms', () => {
  assert.equal(classifyLane('ai voice cover gift'), 'ai_generator');
  assert.equal(classifyLane('ai song generator'), 'ai_generator');
  assert.equal(classifyLane('birthday gift ideas'), 'gift');
  assert.equal(classifyLane('gift song'), 'gift');
  assert.equal(classifyLane('porizo'), 'other');
});

test('compareKeywordLanes scores installs, conversion, volume, and cost by lane', () => {
  const comparison = compareKeywordLanes([
    { term: 'ai song generator', impressions: 1000, taps: 30, installs: 6, spend: 24 },
    { term: 'ai music generator', impressions: 700, taps: 20, installs: 3, spend: 12 },
    { term: 'gift song', impressions: 80, taps: 8, installs: 3, spend: 2 },
    { term: 'birthday gift ideas', impressions: 250, taps: 5, installs: 2, spend: 9 },
    { term: 'porizo', impressions: 10, taps: 1, installs: 1, spend: 0.3 },
  ]);

  const ai = comparison.lanes.find((lane) => lane.id === 'ai_generator');
  const gift = comparison.lanes.find((lane) => lane.id === 'gift');
  assert.equal(ai.installs, 9);
  assert.equal(gift.installs, 5);
  assert.equal(comparison.winner, 'ai_generator');
  assert.match(comparison.recommendation, /AI generator|currently strongest/);
});

test('compareKeywordLanes warns when a lane has taps but no installs', () => {
  const comparison = compareKeywordLanes([
    { term: 'ai song generator', impressions: 900, taps: 12, installs: 0, spend: 18 },
    { term: 'gift song', impressions: 50, taps: 2, installs: 1, spend: 1 },
  ]);

  const ai = comparison.lanes.find((lane) => lane.id === 'ai_generator');
  assert.equal(ai.verdict, 'pause_or_reposition');
});

test('formatLaneComparison includes the key acquisition parameters', () => {
  const comparison = compareKeywordLanes([
    { term: 'gift song', impressions: 100, taps: 10, installs: 4, spend: 8 },
  ]);
  const output = formatLaneComparison(comparison);
  assert.match(output, /TTR/);
  assert.match(output, /tap→install/);
  assert.match(output, /CPI/);
  assert.match(output, /avg CPT/);
  assert.match(output, /Recommendation:/);
});
